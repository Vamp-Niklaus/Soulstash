/**
 * collectionsApi.js
 *
 * All network calls related to user collections.
 * Sits between the UI and the backend — it never touches the DOM.
 *
 * Depends on:
 *   - collectionsCache.js  →  for reading/writing localStorage
 *   - client.js            →  for authenticated fetch helpers
 */

import { getToken, API_BASE_URL, apiFetch } from '../api/client.js';
import {
  readCollectionsCache,
  updateCollectionsCache,
  writeCollectionsCache,
  normalizeCollections,
  broadcastCollections,
  lastKnownCollectionVersion,
  setLastKnownCollectionVersion
} from './collectionsCache.js';
import {
  mergeRatingsTableCache
} from './ratingsCache.js';
import {
  contentIdFromItem,
  mediaTypeFromItem,
  normalizeMediaType,
  getValidImdbRating,
  getValidVoteAverage
} from './formatters.js';

// Re-export so callers that do:
//   import { lastKnownCollectionVersion } from './collectionsCache.js';
// still work via the re-exports we'll add to helpers.js.
export { lastKnownCollectionVersion, setLastKnownCollectionVersion };

// ---------------------------------------------------------------------------
// Fetch collections from the server
// Sends the current cached version so the server can respond 304 Not Modified
// when nothing has changed, saving bandwidth.
// ---------------------------------------------------------------------------

export async function fetchUserCollectionsWithVersion(cached) {
  const token = getToken();
  if (!token) {
    return { collections: [], version: 0 };
  }

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`
  };
  if (cached?.version != null) {
    headers['X-Collection-Version'] = String(cached.version);
  }

  const response = await fetch(`${API_BASE_URL}/api/user/collections`, { headers });

  // 304 = server says "nothing changed, use your cached copy"
  if (response.status === 304 && cached) {
    return { collections: cached.collections, version: cached.version, fromCache: true };
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const error = new Error(payload.error || `Request failed with status ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  const data = await response.json();
  const versionHeader = response.headers.get('x-collection-version');
  const version = Number.isFinite(Number(versionHeader))
    ? Number(versionHeader)
    : ((cached?.version || 0) + 1);

  const collectionsList = Array.isArray(data)
    ? data
    : (Array.isArray(data?.collections) ? data.collections : []);

  if (collectionsList.length || Array.isArray(data)) {
    writeCollectionsCache(collectionsList, version);
    broadcastCollections(collectionsList, version);
  }

  return { collections: collectionsList, version };
}

// ---------------------------------------------------------------------------
// Load user collections
// Uses cached data when available to avoid redundant network calls.
// Flag prevents React StrictMode from firing this twice in dev.
// ---------------------------------------------------------------------------

export async function loadUserCollections() {
  // Native app or Capacitor: delegate to the native CollectionStore bridge
  if (window.CollectionStore?.getCollections) {
    return window.CollectionStore.getCollections();
  }

  if (!getToken()) return [];

  const cached = readCollectionsCache();

  if (cached?.collections?.length) {
    // Offline: serve from cache
    if (!navigator.onLine) return cached.collections;

    // Prevent network spam on tab switch (only fetch once per hard refresh)
    if (window.__soulstash_collections_fetched_this_session) {
      return cached.collections;
    }

    try {
      // Set the flag BEFORE the await to prevent React StrictMode double-fetching
      window.__soulstash_collections_fetched_this_session = true;
      const response = await fetchUserCollectionsWithVersion(cached);
      return response.collections;
    } catch {
      return cached.collections;
    }
  }

  // No cache at all — do a fresh fetch
  try {
    window.__soulstash_collections_fetched_this_session = true;
    const response = await fetchUserCollectionsWithVersion(null);
    return response.collections;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Refresh the live view
// Fetches fresh collections and fires the broadcast event so every
// subscriber (useLiveCollections) gets the update without a page reload.
// ---------------------------------------------------------------------------

export async function refreshCollectionsView() {
  const latestCollections = normalizeCollections(await loadUserCollections());
  window.dispatchEvent(
    new CustomEvent(
      window.CollectionStore?.COLLECTIONS_UPDATED_EVENT || 'soulstash:collections-updated',
      { detail: { collections: latestCollections } }
    )
  );
  return latestCollections;
}

// ---------------------------------------------------------------------------
// Background rating enrichment
// ---------------------------------------------------------------------------
// Background collection rating enrichment (lazy POST after initial render)
// ---------------------------------------------------------------------------

const SENTINEL_REFRESH_MS = 14 * 24 * 60 * 60 * 1000;
const inFlightEnrichRequests = new Map();

function isRatingCheckExpired(item) {
  if (!item?.rating_checked_at) return false;
  const checkedMs = Date.parse(item.rating_checked_at);
  return Number.isFinite(checkedMs) && Date.now() - checkedMs > SENTINEL_REFRESH_MS;
}

export function buildCollectionItemPayload(item, mediaTypeOverride) {
  const resolvedMediaType = normalizeMediaType(mediaTypeOverride || mediaTypeFromItem(item) || 'Movie') || 'Movie';
  const isSeries = resolvedMediaType === 'Series';
  const rawId = item?.movieId || item?.seriesId || item?.id || item?._id || 0;
  const numericId = Number(rawId);
  const resolvedId = Number.isFinite(numericId) && numericId > 0 ? numericId : rawId;

  const validImdb = getValidImdbRating(item?.imdb_rating);
  const validVote = getValidVoteAverage(item?.vote_average);
  const releaseDate = item?.release_date || (isSeries ? item?.first_air_date || '' : '') || '';

  const payload = {
    id: resolvedId,
    ...(isSeries ? { seriesId: resolvedId } : { movieId: resolvedId }),
    title: item?.title || item?.name || 'Unknown',
    poster_path: item?.poster_path || '',
    backdrop_path: item?.backdrop_path || '',
    release_date: releaseDate,
    ...(isSeries && item?.first_air_date ? { first_air_date: item.first_air_date } : {}),
    media_type: resolvedMediaType
  };

  if (validImdb != null) payload.imdb_rating = validImdb;
  if (validVote != null) payload.vote_average = validVote;
  if (item?.imdb_id || item?.imdbID) payload.imdb_id = item.imdb_id || item.imdbID;
  if (item?.rating_lookup_attempted === true) payload.rating_lookup_attempted = true;
  if (item?.rating_checked_at) payload.rating_checked_at = item.rating_checked_at;
  return payload;
}

export function itemNeedsRatingEnrichment(item) {
  const contentId = contentIdFromItem(item);
  if (!contentId || (typeof contentId === 'string' && contentId.startsWith('kartoons'))) {
    return false;
  }
  const hasImdb = getValidImdbRating(item?.imdb_rating) != null;
  const hasVote = getValidVoteAverage(item?.vote_average) != null;
  if (hasImdb && hasVote) return false;
  if (item?.rating_lookup_attempted !== true) return true;
  if (!hasImdb && isRatingCheckExpired(item)) return true;
  return false;
}

function buildEnrichRequestItems(items) {
  return (items || [])
    .map((item) => {
      const contentId = contentIdFromItem(item);
      if (!contentId) return null;
      const mediaType = mediaTypeFromItem(item) || 'Movie';
      const validVote = getValidVoteAverage(item?.vote_average);
      return {
        id: Number(contentId) || contentId,
        contentId,
        mediaType,
        ...(validVote != null ? { vote_average: validVote } : {}),
        ...(item?.imdb_id || item?.imdbID ? { imdb_id: item.imdb_id || item.imdbID } : {}),
        poster_path: item?.poster_path || '',
        release_date: item?.release_date || '',
        first_air_date: item?.first_air_date || '',
        title: item?.title || item?.name || 'Unknown'
      };
    })
    .filter(Boolean);
}

export async function enrichCollectionRatingsInBackground(
  collection,
  logPrefix = '[Soulstash][React]'
) {
  const colIdentifier = collection?._id || collection?.name;
  if (!colIdentifier || !getToken()) return null;

  const needsEnrich = (collection.movies || []).filter(itemNeedsRatingEnrichment);
  if (!needsEnrich.length) {
    return null;
  }

  const items = buildEnrichRequestItems(needsEnrich);
  if (!items.length) return null;

  const dedupKey = `owner:${colIdentifier}:${items.map((it) => `${it.mediaType}:${it.contentId}`).sort().join(',')}`;
  if (inFlightEnrichRequests.has(dedupKey)) {
    return inFlightEnrichRequests.get(dedupKey);
  }

  console.log(
    `${logPrefix} enrichCollectionRatingsInBackground START collection="${collection.name}" needsEnrich=${items.length}/${collection.movies?.length || 0}`
  );

  const task = apiFetch(
    `/api/user/collections/${encodeURIComponent(colIdentifier)}/enrich-metadata`,
    {
      method: 'POST',
      body: JSON.stringify({ items })
    }
  )
    .then((response) => {
      const enrichedItems = Array.isArray(response?.extra?.items) ? response.extra.items : [];
      if (enrichedItems.length) {
        mergeRatingsTableCache(enrichedItems);
      }
      if (Array.isArray(response?.collections)) {
        broadcastCollections(response.collections, response.collectionVersion);
      }
      console.log(
        `${logPrefix} enrichCollectionRatingsInBackground DONE collection="${collection.name}" updatedCount=${enrichedItems.length}`
      );
      return response;
    })
    .finally(() => {
      inFlightEnrichRequests.delete(dedupKey);
    });

  inFlightEnrichRequests.set(dedupKey, task);
  return task;
}

export async function enrichPublicItemsRatingsInBackground(items) {
  const needsEnrich = (items || []).filter(itemNeedsRatingEnrichment);
  if (!needsEnrich.length) return [];

  const payloadItems = buildEnrichRequestItems(needsEnrich);
  if (!payloadItems.length) return [];

  const dedupKey = `public:${payloadItems.map((it) => `${it.mediaType}:${it.contentId}`).sort().join(',')}`;
  if (inFlightEnrichRequests.has(dedupKey)) {
    return inFlightEnrichRequests.get(dedupKey);
  }

  const task = apiFetch('/api/ratings/imdb/enrich', {
    method: 'POST',
    body: JSON.stringify({ items: payloadItems })
  })
    .then((response) => {
      const enriched = Array.isArray(response?.items) ? response.items : [];
      if (enriched.length) {
        mergeRatingsTableCache(enriched);
      }
      return enriched;
    })
    .finally(() => {
      inFlightEnrichRequests.delete(dedupKey);
    });

  inFlightEnrichRequests.set(dedupKey, task);
  return task;
}
