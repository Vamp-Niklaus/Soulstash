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

import { getToken, API_BASE_URL, apiFetch, streamApiFetch } from '../api/client.js';
import {
  readCollectionsCache,
  updateCollectionsCache,
  normalizeCollections,
  broadcastCollections,
  lastKnownCollectionVersion,
  setLastKnownCollectionVersion
} from './collectionsCache.js';
import {
  loadRatingsTable,
  ratingsCacheKey,
  mergeRatingsTableCache
} from './ratingsCache.js';
import {
  contentIdFromItem,
  mediaTypeFromItem,
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
    : (cached?.version || 0);

  updateCollectionsCache(data, version);
  return { collections: data, version };
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
// For items in a collection that are missing IMDB/vote_average ratings,
// this streams the results back one item at a time from the backend
// so the UI updates as results arrive rather than waiting for the whole batch.
// ---------------------------------------------------------------------------

export async function enrichCollectionRatingsInBackground(
  collection,
  logPrefix = '[Soulstash][React]'
) {
  if (!collection?._id) return null;

  // Only enrich items that are actually missing ratings
  const needsEnrich = (collection.movies || []).filter(
    (item) =>
      item?.rating_lookup_attempted !== true &&
      (getValidImdbRating(item?.imdb_rating) == null ||
        getValidVoteAverage(item?.vote_average) == null)
  );

  if (!needsEnrich.length) {
    console.log(
      `${logPrefix} enrichCollectionRatingsInBackground SKIP - all ratings present collection="${collection.name}"`
    );
    return null;
  }

  console.log(
    `${logPrefix} enrichCollectionRatingsInBackground START collection="${collection.name}" needsEnrich=${needsEnrich.length}/${collection.movies?.length || 0}`
  );

  const cachedRatings = await loadRatingsTable();
  const ratingsByKey = new Map(
    (cachedRatings || []).map((item) => [ratingsCacheKey(item.tmdbID, item.mediaType), item])
  );

  // Only ask the backend for items not already in our local ratings cache
  const needsBackendEnrich = needsEnrich.filter(
    (item) => !ratingsByKey.has(ratingsCacheKey(contentIdFromItem(item), mediaTypeFromItem(item)))
  );

  if (needsBackendEnrich.length) {
    // Stream results back item-by-item \u2014 each resolved rating is merged into
    // the local cache immediately so already-resolved titles show up while
    // the rest are still being looked up.
    await streamApiFetch('/api/ratings/imdb/enrich', {
      method: 'POST',
      body: JSON.stringify({
        items: needsBackendEnrich.map((item) => ({
          contentId: contentIdFromItem(item),
          mediaType: mediaTypeFromItem(item)
        }))
      }),
      onEvent(event) {
        if (event?.type !== 'item' || !event.item) return;
        mergeRatingsTableCache([event.item]);
        ratingsByKey.set(ratingsCacheKey(event.item.tmdbID, event.item.mediaType), event.item);
      }
    });
  }

  // Build the enriched items array
  const items = needsEnrich
    .map((item) => {
      const contentId = contentIdFromItem(item);
      if (!contentId) return null;
      const mediaType = mediaTypeFromItem(item);
      const ratingMatch = ratingsByKey.get(ratingsCacheKey(contentId, mediaType));
      const imdb_rating = getValidImdbRating(ratingMatch?.imdb_rating);
      const vote_average =
        getValidVoteAverage(ratingMatch?.vote_average) ?? getValidVoteAverage(item?.vote_average);

      return {
        contentId,
        mediaType,
        vote_average: vote_average ?? null,
        imdb_rating: imdb_rating ?? null,
        imdb_id: ratingMatch?.imdbID || item?.imdb_id || '',
        rating_lookup_attempted: ratingMatch?.lookup_attempted === true,
        poster_path: item?.poster_path || '',
        release_date: item?.release_date || '',
        first_air_date: item?.first_air_date || '',
        title: item?.title || item?.name || 'Unknown'
      };
    })
    .filter(Boolean);

  if (!items.length) return null;

  const response = await apiFetch(
    `/api/user/collections/${encodeURIComponent(collection._id)}/enrich-metadata`,
    {
      method: 'POST',
      body: JSON.stringify({ items })
    }
  );

  console.log(
    `${logPrefix} enrichCollectionRatingsInBackground DONE collection="${collection.name}" updatedCount=${items.length}`
  );

  return response;
}
