import { useState, useEffect } from 'react';
import { contentIdFromItem, mediaTypeFromItem, compareRatingsForSort, buildLegacyPlayerSources, getPreferredRating, getValidImdbRating, getValidVoteAverage, yearFrom, normalizeMediaType } from './formatters.js';
import { HOME_TRENDING_TTL } from './constants.js';
import { cachedApiFetch, getToken, getCurrentUsername, emitAuthChange } from '../api/client.js';
import { Capacitor } from '@capacitor/core';

import { apiFetch, streamApiFetch } from '../api/client.js';
import { toast } from './toast.js';

export let lastKnownCollectionVersion = null;
export function setLastKnownCollectionVersion(v) { lastKnownCollectionVersion = v; }
export let homeTrendingCache = { data: null, promise: null, expiresAt: 0 };
export let ratingsTableCache = { data: null, promise: null, expiresAt: 0 };
const RATINGS_TABLE_TTL = 60 * 60 * 1000;
export function createEmptyCollectionDraft() {
  return {
    name: '',
    description: '',
    isPublic: false
  };
}

export function navigateWithoutReload(to, options = {}) {
  if (typeof window.soulstashNavigate === 'function') {
    window.soulstashNavigate(to, options);
    return;
  }

  if (options.replace) {
    window.history.replaceState(null, '', to);
  } else {
    window.history.pushState(null, '', to);
  }

  try {
    window.dispatchEvent(new PopStateEvent('popstate'));
  } catch {
    window.dispatchEvent(new Event('popstate'));
  }
}

export function readCollectionsCache() {
  try {
    const raw = localStorage.getItem(COLLECTIONS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.collections)) return null;
    return {
      collections: parsed.collections,
      version: Number.isFinite(Number(parsed.version)) ? Number(parsed.version) : 0,
      fetchedAt: Number(parsed.fetchedAt) || 0
    };
  } catch {
    return null;
  }
}

export function writeCollectionsCache(collections, version) {
  try {
    const resolvedVersion = Number.isFinite(Number(version)) ? Number(version) : 0;
    localStorage.setItem(
      COLLECTIONS_CACHE_KEY,
      JSON.stringify({
        collections,
        version: resolvedVersion,
        fetchedAt: Date.now()
      })
    );
    lastKnownCollectionVersion = resolvedVersion;
  } catch {}
}

export function updateCollectionsCache(collections, version) {
  if (!Array.isArray(collections)) return;
  const existing = readCollectionsCache();
  const resolvedVersion = Number.isFinite(Number(version))
    ? Number(version)
    : (Number.isFinite(Number(existing?.version)) ? Number(existing.version) : 0);
  writeCollectionsCache(collections, resolvedVersion);
}

export function getCachedCollectionVersion() {
  const cached = readCollectionsCache();
  return Number.isFinite(Number(cached?.version)) ? Number(cached.version) : 0;
}

export function optimisticRemoveCollectionFromCache(collectionId) {
  const current = normalizeCollections(getCachedUserCollections());
  const id = String(collectionId);
  const next = current.filter(
    (collection) => String(collection._id || collection.name) !== id && String(collection.name) !== id
  );
  broadcastCollections(next, lastKnownCollectionVersion);
  return current;
}

export function optimisticUpdateCollectionItems(collectionId, updateFn) {
  const current = normalizeCollections(getCachedUserCollections());
  const id = String(collectionId);
  const next = current.map((collection) => {
    if (String(collection._id || collection.name) !== id && String(collection.name) !== id) return collection;
    const movies = Array.isArray(collection.movies) ? collection.movies : [];
    const updated = updateFn(movies);
    return { ...collection, movies: updated, movieCount: updated.length };
  });
  broadcastCollections(next, lastKnownCollectionVersion);
  return current;
}

export function readTrashCache() {
  try {
    const raw = localStorage.getItem(COLLECTIONS_TRASH_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeTrashCache(entries) {
  try {
    localStorage.setItem(COLLECTIONS_TRASH_CACHE_KEY, JSON.stringify(entries));
  } catch {}
}

export function trashItemFromCollectionCache(collectionId, itemId) {
  const current = normalizeCollections(getCachedUserCollections());
  const id = String(collectionId);
  let trashedItem = null;
  let collectionName = '';

  const next = current.map((collection) => {
    const isTarget =
      String(collection._id || collection.name) === id ||
      String(collection.name) === id;
    if (!isTarget) return collection;
    collectionName = collection.name || '';
    const movies = Array.isArray(collection.movies) ? collection.movies : [];
    const remaining = movies.filter((m) => {
      const mid = Number(m.movieId || m.seriesId || m.id || m._id || 0);
      if (mid === Number(itemId)) {
        trashedItem = m;
        return false;
      }
      return true;
    });
    return { ...collection, movies: remaining, movieCount: remaining.length };
  });

  if (trashedItem) {
    const trash = readTrashCache();
    trash.push({
      collectionId: id,
      collectionName,
      item: trashedItem,
      removedAt: Date.now()
    });
    writeTrashCache(trash);
  }

  broadcastCollections(next, lastKnownCollectionVersion);
  return current; // snapshot for rollback
}

export function confirmTrashItem(collectionId, itemId) {
  const trash = readTrashCache();
  const filtered = trash.filter(
    (t) =>
      !(
        String(t.collectionId) === String(collectionId) &&
        Number(t.item?.movieId || t.item?.seriesId || t.item?.id || t.item?._id || 0) === Number(itemId)
      )
  );
  writeTrashCache(filtered);
}

export function restoreTrashItem(collectionId, itemId) {
  const trash = readTrashCache();
  const entryIdx = trash.findIndex(
    (t) =>
      String(t.collectionId) === String(collectionId) &&
      Number(t.item?.movieId || t.item?.seriesId || t.item?.id || t.item?._id || 0) === Number(itemId)
  );
  if (entryIdx === -1) return;

  const [entry] = trash.splice(entryIdx, 1);
  writeTrashCache(trash);

  // Re-insert item back into the live cache
  const current = normalizeCollections(getCachedUserCollections());
  const id = String(collectionId);
  const next = current.map((collection) => {
    const isTarget =
      String(collection._id || collection.name) === id ||
      String(collection.name) === id;
    if (!isTarget) return collection;
    const movies = Array.isArray(collection.movies) ? collection.movies : [];
    // Avoid duplicates in case it was already restored by a broadcast
    const alreadyPresent = movies.some(
      (m) =>
        Number(m.movieId || m.seriesId || m.id || m._id || 0) ===
        Number(entry.item?.movieId || entry.item?.seriesId || entry.item?.id || entry.item?._id || 0)
    );
    const restored = alreadyPresent ? movies : [...movies, entry.item];
    return { ...collection, movies: restored, movieCount: restored.length };
  });
  broadcastCollections(next, lastKnownCollectionVersion);
}

export function optimisticSetCollectionMembership(collectionName, item, shouldInclude, options = {}) {
  const current = normalizeCollections(getCachedUserCollections());
  const targetId = String(collectionName);
  const itemContentId = contentIdFromItem(item);
  const exclusiveCollections = shouldInclude ? new Set(options.exclusiveCollections || []) : new Set();
  const next = current.map((collection) => {
    const collectionId = String(collection._id || collection.name);
    const movies = Array.isArray(collection.movies) ? collection.movies : [];
    const hasItem = movies.some((entry) => contentIdFromItem(entry) === itemContentId);

    if (collectionId === targetId || String(collection.name) === targetId) {
      if (shouldInclude) {
        if (hasItem) return collection;
        const updated = [...movies, item];
        return { ...collection, movies: updated, movieCount: updated.length };
      }
      if (!hasItem) return collection;
      const updated = movies.filter((entry) => contentIdFromItem(entry) !== itemContentId);
      return { ...collection, movies: updated, movieCount: updated.length };
    }

    if (!exclusiveCollections.has(collection.name) || !hasItem) return collection;
    const updated = movies.filter((entry) => contentIdFromItem(entry) !== itemContentId);
    return { ...collection, movies: updated, movieCount: updated.length };
  });
  broadcastCollections(next, lastKnownCollectionVersion);
  return current;
}

export async function refreshCollectionsView() {
  const latestCollections = normalizeCollections(await loadUserCollections());
  window.dispatchEvent(
    new CustomEvent(window.CollectionStore?.COLLECTIONS_UPDATED_EVENT || 'soulstash:collections-updated', {
      detail: { collections: latestCollections }
    })
  );
  return latestCollections;
}

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

  const response = await fetch('/api/user/collections', { headers });
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
  const version = Number.isFinite(Number(versionHeader)) ? Number(versionHeader) : (cached?.version || 0);
  updateCollectionsCache(data, version);
  return { collections: data, version };
}

export async function loadTrendingHome(force = false) {
  const now = Date.now();

  if (!force && homeTrendingCache.data && homeTrendingCache.expiresAt > now) {
    return homeTrendingCache.data;
  }

  if (!force && homeTrendingCache.promise) {
    return homeTrendingCache.promise;
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 7000);
  const request = apiFetch('/api/trending?limit=18', { signal: controller.signal })
    .then((data) => {
      const arr = Array.isArray(data?.movies) ? data.movies : (Array.isArray(data) ? data : []);
      homeTrendingCache.data = arr;
      homeTrendingCache.expiresAt = Date.now() + HOME_TRENDING_TTL;
      return arr;
    })
    .catch((error) => {
      if (homeTrendingCache.data) return homeTrendingCache.data;
      console.warn('[Soulstash][React] Home trending unavailable', {
        message: error?.message,
        status: error?.status
      });
      return [];
    })
    .finally(() => {
      window.clearTimeout(timeout);
      homeTrendingCache.promise = null;
    });

  homeTrendingCache.promise = request;
  return request;
}

export async function loadUserCollections() {
  if (window.CollectionStore?.getCollections) {
    return window.CollectionStore.getCollections();
  }
  if (!getToken()) return [];

  const cached = readCollectionsCache();
  if (cached?.collections?.length) {
    if (!navigator.onLine) {
      return cached.collections;
    }
    try {
      const response = await fetchUserCollectionsWithVersion(cached);
      return response.collections;
    } catch {
      return cached.collections;
    }
  }

  try {
    const response = await fetchUserCollectionsWithVersion(null);
    return response.collections;
  } catch {
    return [];
  }
}

export async function loadRatingsTable(force = false) {
  if (!getToken()) return [];

  const now = Date.now();
  if (!force && ratingsTableCache.data && ratingsTableCache.expiresAt > now) {
    return ratingsTableCache.data;
  }
  if (!force && ratingsTableCache.promise) {
    return ratingsTableCache.promise;
  }

  const request = apiFetch('/api/ratings?limit=5000')
    .then((payload) => {
      const items = Array.isArray(payload?.items) ? payload.items : [];
      ratingsTableCache.data = items;
      ratingsTableCache.expiresAt = Date.now() + RATINGS_TABLE_TTL;
      return items;
    })
    .finally(() => {
      ratingsTableCache.promise = null;
    });

  ratingsTableCache.promise = request;
  return request;
}

export function ratingsCacheKey(tmdbID, mediaType) {
  return `${normalizeMediaType(mediaType)}:${Number(tmdbID)}`;
}

export function getRatingsCacheMap() {
  return new Map((ratingsTableCache.data || []).map((item) => [ratingsCacheKey(item.tmdbID, item.mediaType), item]));
}

export function mergeRatingsTableCache(items) {
  if (!Array.isArray(items) || !items.length) return ratingsTableCache.data || [];
  const merged = new Map(getRatingsCacheMap());
  items.forEach((item) => {
    merged.set(ratingsCacheKey(item.tmdbID, item.mediaType), item);
  });
  ratingsTableCache.data = Array.from(merged.values());
  ratingsTableCache.expiresAt = Date.now() + RATINGS_TABLE_TTL;
  return ratingsTableCache.data;
}

export function getCachedUserCollections() {
  if (window.CollectionStore?.getCachedCollections) {
    return window.CollectionStore.getCachedCollections() || [];
  }
  const cached = readCollectionsCache();
  return Array.isArray(cached?.collections) ? cached.collections : [];
}

export function normalizeCollection(collection) {
  const movies = Array.isArray(collection?.movies) ? collection.movies : [];
  const isPublic = collection?.isPublic === true || collection?.isPublished === true;
  return {
    ...collection,
    _id: collection?._id || collection?.name,
    name: collection?.name || '',
    movies,
    movieCount: movies.length,
    isPublic,
    isPublished: collection?.isPublished === true
  };
}

export function collectionItemCount(collection) {
  if (!collection) return 0;
  if (Number.isFinite(Number(collection.movieCount))) return Number(collection.movieCount) || 0;
  if (Array.isArray(collection.movies)) return collection.movies.length;
  return 0;
}

export function normalizeCollections(collections) {
  return Array.isArray(collections) ? collections.map(normalizeCollection) : [];
}

export function hasCollectionCache() {
  if (window.CollectionStore?.hasCollectionsCache?.()) return true;
  return !!readCollectionsCache();
}

export async function enrichCollectionRatingsInBackground(collection, logPrefix = '[Soulstash][React]') {
  if (!collection?._id) return null;

  // Enrich items missing imdb_rating OR vote_average
  const needsEnrich = (collection.movies || []).filter(
    (item) =>
      item?.rating_lookup_attempted !== true &&
      (getValidImdbRating(item?.imdb_rating) == null || getValidVoteAverage(item?.vote_average) == null)
  );
  if (!needsEnrich.length) {
    console.log(`${logPrefix} enrichCollectionRatingsInBackground SKIP - all ratings present collection="${collection.name}"`);
    return null;
  }

  console.log(`${logPrefix} enrichCollectionRatingsInBackground START collection="${collection.name}" needsEnrich=${needsEnrich.length}/${collection.movies?.length || 0}`, needsEnrich.map(i => ({ title: i.title, imdb_rating: i.imdb_rating, vote_average: i.vote_average })));

  const cachedRatings = await loadRatingsTable();
  const ratingsByKey = new Map(
    (cachedRatings || []).map((item) => [ratingsCacheKey(item.tmdbID, item.mediaType), item])
  );
  const needsBackendEnrich = needsEnrich.filter(
    (item) => !ratingsByKey.has(ratingsCacheKey(contentIdFromItem(item), mediaTypeFromItem(item)))
  );

  if (needsBackendEnrich.length) {
    // Stream results back item-by-item instead of waiting for the whole
    // batch: each rating gets merged into the local cache and written back
    // to the collection as soon as it arrives, so already-resolved titles
    // show up in the UI while the rest are still being looked up.
    const streamedItems = [];
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
        console.log(`${logPrefix} enrichCollectionRatingsInBackground /enrich item`, event.item, `(${event.resolved}/${event.total})`);
        streamedItems.push(event.item);
        mergeRatingsTableCache([event.item]);
        ratingsByKey.set(ratingsCacheKey(event.item.tmdbID, event.item.mediaType), event.item);
      }
    });

    console.log(`${logPrefix} enrichCollectionRatingsInBackground /enrich stream DONE count=${streamedItems.length}`);
  }


  const items = needsEnrich
    .map((item) => {
      const contentId = contentIdFromItem(item);
      if (!contentId) return null;
      const mediaType = mediaTypeFromItem(item);
      const ratingMatch = ratingsByKey.get(ratingsCacheKey(contentId, mediaType));
      const imdb_rating = getValidImdbRating(ratingMatch?.imdb_rating);
      // Prefer vote_average from backend response (Ratings table), fall back to existing item value
      const vote_average = getValidVoteAverage(ratingMatch?.vote_average) ?? getValidVoteAverage(item?.vote_average);

      console.log(`${logPrefix}   "${item.title || item.name}" (${mediaType}:${contentId}) imdb_rating: ${item.imdb_rating} Ã¢â€ â€™ ${imdb_rating} | vote_average: ${item.vote_average} Ã¢â€ â€™ ${vote_average} | source=${ratingMatch?.source}`);

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

  if (!items.length) {
    console.log(`${logPrefix} enrichCollectionRatingsInBackground nothing to write back collection="${collection.name}"`);
    return null;
  }

  console.log(`${logPrefix} enrichCollectionRatingsInBackground Ã¢â€ â€™ /enrich-metadata collection="${collection.name}" itemCount=${items.length}`);

  const response = await apiFetch(`/api/user/collections/${encodeURIComponent(collection._id)}/enrich-metadata`, {
    method: 'POST',
    body: JSON.stringify({ items })
  });

  console.log(`${logPrefix} enrichCollectionRatingsInBackground DONE collection="${collection.name}" updatedCount=${items.length}`);

  return response;
}

export function broadcastCollections(nextCollections, version) {
  const collections = normalizeCollections(nextCollections);
  updateCollectionsCache(collections, version ?? lastKnownCollectionVersion ?? getCachedCollectionVersion());
  window.dispatchEvent(
    new CustomEvent(window.CollectionStore?.COLLECTIONS_UPDATED_EVENT || 'soulstash:collections-updated', {
      detail: { collections }
    })
  );
  return collections;
}

export function filteredCollectionMovies(collection, filters, watchedIds) {
  const base = Array.isArray(collection?.movies) ? [...collection.movies] : [];
  const filtered = base.filter((movie) => {
    const isSeries = movie?.media_type === 'Series' || movie?.media_type === 'tv' || !!movie?.seriesId;
    const isAnime = !!movie?.isAnime;
    const id = Number(movie?.movieId || movie?.seriesId || movie?.id || movie?._id || 0);
    const isWatched = watchedIds.has(id);

    if (filters.contentType === 'movies' && isSeries) return false;
    if (filters.contentType === 'series' && !isSeries) return false;
    if (filters.anime === 'no' && isAnime) return false;
    if (filters.anime === 'only' && !isAnime) return false;
    if (filters.hideWatched && isWatched) return false;

    return true;
  });

  filtered.sort((a, b) => {
    const voteA = getPreferredRating(a) ?? 0;
    const voteB = getPreferredRating(b) ?? 0;
    const titleA = String(a?.title || a?.name || '').toLowerCase();
    const titleB = String(b?.title || b?.name || '').toLowerCase();
    const yearA = Number(yearFrom(a)) || 0;
    const yearB = Number(yearFrom(b)) || 0;
    const addedA = new Date(a?.addedAt || a?.updatedAt || a?.release_date || 0).getTime() || 0;
    const addedB = new Date(b?.addedAt || b?.updatedAt || b?.release_date || 0).getTime() || 0;
    if (filters.sortBy === 'oldest') return addedA - addedB;
    if (filters.sortBy === 'rating-desc') return compareRatingsForSort(a, b, 'desc');
    if (filters.sortBy === 'rating-asc') return compareRatingsForSort(a, b, 'asc');
    if (filters.sortBy === 'title-asc') return titleA.localeCompare(titleB);
    if (filters.sortBy === 'title-desc') return titleB.localeCompare(titleA);
    if (filters.sortBy === 'year-desc') return yearB - yearA;
    if (filters.sortBy === 'year-asc') return yearA - yearB;
    return addedB - addedA;
  });

  return filtered;
}

export function getDrawerColumnCount() {
  const width = window.innerWidth;
  if (width >= 1600) return 5;
  if (width >= 1280) return 4;
  if (width >= 900) return 3;
  if (width >= 600) return 2;
  return 1;
}

export function filterLabel(filters) {
  switch (filters.anime) {
    case 'no':
      return 'Hide anime';
    case 'only':
      return 'Only anime';
    default:
      return 'Show anime';
  }
}

export function sortLabel(filters) {
  switch (filters.sortBy) {
    case 'oldest':
      return 'Oldest';
    case 'rating-desc':
      return 'Rating high';
    case 'rating-asc':
      return 'Rating low';
    case 'title-asc':
      return 'Title A-Z';
    case 'title-desc':
      return 'Title Z-A';
    case 'year-desc':
      return 'Year new';
    case 'year-asc':
      return 'Year old';
    default:
      return 'Recent';
  }
}

export function splitTrendingIntoColumns(items) {
  const columns = [[], [], []];
  items.forEach((item, index) => {
    const columnIndex = index % 3;
    if (columns[columnIndex].length < 12) {
      columns[columnIndex].push(item);
    }
  });
  return columns;
}

export function getHomeGridColumns(width = window.innerWidth) {
  if (width >= 1280) return 7;
  if (width >= 1024) return 6;
  if (width >= 768) return 5;
  if (width >= 640) return 4;
  return 3;
}

export function getSearchHistory() {
  try {
    const raw = localStorage.getItem(SEARCH_HISTORY_KEY);
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveSearchHistoryItem(item) {
  try {
    const next = [
      {
        id: item.id,
        title: item.title || item.name || item.username || 'Unknown',
        name: item.name || item.title || '',
        username: item.username || '',
        poster_path: item.poster_path || item.profile_path || item.avatar || '',
        media_type: item.media_type,
        release_date: item.release_date || item.first_air_date || '',
        fullName: item.fullName || ''
      },
      ...getSearchHistory().filter((entry) => `${entry.media_type}:${entry.id || entry.username}` !== `${item.media_type}:${item.id || item.username}`)
    ].slice(0, 20);
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(next));
  } catch {}
}

export function getOverlayColumnCount() {
  const width = window.innerWidth;
  if (width >= 1024) return 4;
  if (width >= 768) return 3;
  if (width >= 640) return 2;
  return 1;
}

export function mergeSearchResults(currentResults, incomingResults, limit = 40) {
  const merged = [];
  const seen = new Set();
  for (const item of [...currentResults, ...incomingResults]) {
    if (!item || item.adult === true) continue;
    if (['Movie', 'Series', 'tv'].includes(item.media_type) && Number(item.score || 0) <= 25) continue;
    const key = `${item.media_type}:${item.id || item.username || item.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged
    .sort((a, b) => {
      const aType = String(a.media_type || '');
      const bType = String(b.media_type || '');
      const aIsContent = ['Movie', 'Series', 'tv'].includes(aType);
      const bIsContent = ['Movie', 'Series', 'tv'].includes(bType);

      if (aIsContent && bIsContent) {
        return Number(b.score || 0) - Number(a.score || 0);
      }
      if (aIsContent !== bIsContent) {
        return aIsContent ? -1 : 1;
      }

      return Number(b.score || b.popularity || 0) - Number(a.score || a.popularity || 0);
    })
    .slice(0, limit);
}

export function sourceKeyText(source = {}) {
  return `${source.id || ''} ${source.key || ''} ${source.label || ''}`.toLowerCase();
}

export function firstPlayableUrl(source) {
  if (!source) return '';
  if (source.url) return source.url;
  if (Array.isArray(source.urls)) return source.urls.find(Boolean) || '';
  return '';
}

export function buildPlayerSourceSlots(incomingSources = [], fallbackSources = [], isLoading = false) {
  const pool = [...incomingSources, ...fallbackSources].filter(Boolean);
  const used = new Set();

  return PLAYER_SOURCE_SLOTS.map((slot) => {
    const foundIndex = pool.findIndex((source, index) => {
      if (used.has(index)) return false;
      if (slot.key && (source.key === slot.key || source.id === slot.key)) return true;
      return slot.match ? slot.match(source) : false;
    });
    const found = foundIndex >= 0 ? pool[foundIndex] : null;
    if (foundIndex >= 0) used.add(foundIndex);

    const url = firstPlayableUrl(found);
    const isMissing = !url;
    // If we're loading, any slot that hasn't found a URL yet is considered 'pending' (loading)
    const isPending = Boolean(found?.pending) || (isLoading && isMissing);

    return {
      ...(found || {}),
      id: found?.id || slot.id,
      key: found?.key || slot.key || slot.id,
      label: slot.label,
      url,
      urls: found?.urls || (url ? [url] : []),
      embeddable: found?.embeddable !== false,
      pending: isPending,
      disabled: isPending || isMissing
    };
  });
}

export function getCollectionStatus(collections, contentId) {
  const numericId = Number(contentId);
  const watchedCollection = collections.find((collection) => collection.name === 'Watched');
  const watchlistCollection = collections.find((collection) => collection.name === 'Watchlist');
  const customCollections = collections.filter((collection) => !['Watched', 'Watchlist'].includes(collection.name));

  const hasContent = (collection) =>
    Array.isArray(collection?.movies) &&
    collection.movies.some((item) => item.movieId === numericId || item.seriesId === numericId);

  return {
    watched: hasContent(watchedCollection),
    watchlist: hasContent(watchlistCollection),
    customSaved: customCollections.some(hasContent)
  };
}

export function normalizeCredit(item) {
  return {
    id: item.id,
    title: item.title || item.name,
    name: item.name,
    poster_path: item.poster_path,
    release_date: item.release_date,
    first_air_date: item.first_air_date,
    vote_average: item.vote_average,
    imdb_rating: item.imdb_rating,
    imdb_id: item.imdb_id || '',
    rating_lookup_attempted: item?.rating_lookup_attempted === true,
    media_type: item.media_type === 'tv' ? 'Series' : 'Movie'
  };
}

export const setNativeScale = async (scale) => {
  if (isAndroidApp()) {
    try {
      const { Capacitor } = window;
      if (Capacitor && Capacitor.registerPlugin) {
        const ZoomPlugin = Capacitor.registerPlugin('ZoomPlugin');
        if (ZoomPlugin) {
          await ZoomPlugin.setScale({ scale });
        }
      }
    } catch (e) {
      console.log('ZoomPlugin error:', e);
    }
  }
};

export function createPlayerRequest({ mediaType, tmdbId, seasonNumber, episodeNumber, imdbId, title }) {
  const normalizedType = String(mediaType || '').toLowerCase() === 'movie' ? 'movie' : 'series';
  const resolvedTmdbId = Number(tmdbId);
  const resolvedSeasonNumber = normalizedType === 'series' ? Number(seasonNumber || 1) : null;
  const resolvedEpisodeNumber = normalizedType === 'series' ? Number(episodeNumber || 1) : null;

  return {
    mediaType: normalizedType,
    tmdbId: resolvedTmdbId,
    seasonNumber: resolvedSeasonNumber,
    episodeNumber: resolvedEpisodeNumber,
    imdbId: imdbId || '',
    title: title || '',
    fallbackSources: buildLegacyPlayerSources({
      mediaType: normalizedType,
      tmdbId: resolvedTmdbId,
      seasonNumber: resolvedSeasonNumber,
      episodeNumber: resolvedEpisodeNumber,
    })
  };
}

export function hasActivePersonFilters({ contentType, quickFilter, collectionFilter, sortBy }) {
  return (
    contentType !== 'all' ||
    quickFilter !== 'all' ||
    !!collectionFilter ||
    sortBy !== 'year-desc'
  );
}

export function mergeImdbRatings(items, ratingItems) {
  const ratingsByKey = new Map(
    (ratingItems || []).map((item) => [ratingsCacheKey(item.tmdbID, item.mediaType), item])
  );

  return (items || []).map((item) => {
    const contentId = contentIdFromItem(item);
    const mediaType = mediaTypeFromItem(item);
    const ratingMatch = ratingsByKey.get(ratingsCacheKey(contentId, mediaType));
    if (!ratingMatch) return item;

    const nextRating = getValidImdbRating(ratingMatch.imdb_rating);
    const nextVoteAverage = getValidVoteAverage(ratingMatch.vote_average);
    return {
      ...item,
      imdb_rating: nextRating ?? item?.imdb_rating,
      vote_average: nextVoteAverage ?? item?.vote_average,
      imdb_id: ratingMatch.imdbID || item?.imdb_id || '',
      rating_lookup_attempted: ratingMatch?.lookup_attempted === true || item?.rating_lookup_attempted === true
    };
  });
}

export function hasActiveCollectionContentFilters(filters) {
  return !!filters && (
    filters.contentType !== 'all' ||
    filters.anime !== 'yes' ||
    filters.sortBy !== 'recent' ||
    filters.hideWatched === true
  );
}

export function hasStoredRating(item) {
  return getPreferredRating(item) != null || item?.rating_lookup_attempted === true;
}

export function isDirectMediaUrl(url = '') {
  const normalized = String(url).toLowerCase();
  return (
    normalized.endsWith('.mp4') ||
    normalized.endsWith('.m3u8') ||
    normalized.endsWith('.webm') ||
    normalized.endsWith('.ogg')
  );
}



export function clearClientDataCaches() {
  apiResponseCache.clear();
  homeTrendingCache.data = null;
  homeTrendingCache.promise = null;
  homeTrendingCache.expiresAt = 0;
}

export function clearAuthSession() {
  clearClientDataCaches();
  localStorage.removeItem('userToken');
  localStorage.removeItem('user');
  emitAuthChange();
}

export function saveAuthSession(token, user) {
  clearClientDataCaches();
  localStorage.setItem('userToken', token);
  localStorage.setItem('user', JSON.stringify(user));
  emitAuthChange();
}

export function useAuthSession() {
  const [session, setSession] = useState(() => {
    const token = getToken();
    const username = getCurrentUsername();
    return {
      token,
      username,
      isLoggedIn: Boolean(token && username),
      user: (() => {
        try {
          return JSON.parse(localStorage.getItem('user') || '{}');
        } catch {
          return {};
        }
      })()
    };
  });

  useEffect(() => {
    function syncSession() {
      const token = getToken();
      const username = getCurrentUsername();
      let user = {};
      try {
        user = JSON.parse(localStorage.getItem('user') || '{}');
      } catch {}
      setSession({
        token,
        username,
        isLoggedIn: Boolean(token && username),
        user
      });
    }

    window.addEventListener('storage', syncSession);
    window.addEventListener('soulstash:auth-changed', syncSession);
    return () => {
      window.removeEventListener('storage', syncSession);
      window.removeEventListener('soulstash:auth-changed', syncSession);
    };
  }, []);

  return session;
}

export function useSessionState(key, initialValue) {
  const [state, setState] = useState(() => {
    try {
      const raw = sessionStorage.getItem(key);
      if (raw != null) {
        return JSON.parse(raw);
      }
    } catch {}
    return typeof initialValue === 'function' ? initialValue() : initialValue;
  });

  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(state));
    } catch {}
  }, [key, state]);

  return [state, setState];
}

export function useHomeTwoRowLimit() {
  const [limit, setLimit] = useState(() => getHomeGridColumns() * 2);

  useEffect(() => {
    function handleResize() {
      setLimit(getHomeGridColumns() * 2);
    }

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return limit;
}

export function useGridKeyNav(containerRef, itemSelector = 'button[data-card]') {
  useEffect(() => {
    // D-pad grid navigation is owned by tvNav.js. Keep this hook as a no-op
    // for older call sites while avoiding a second window key handler.
    return undefined;

    // IMPORTANT: Listen on window, not the container.
    // The container ref may be null at mount time (skeleton shown first).
    // We look up containerRef.current on EVERY key press instead.
    const handleKeyDown = (event) => {
      if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)) return;

      const container = containerRef.current;
      if (!container) {
        console.log('[NAV-DEBUG] useGridKeyNav: key pressed but container still null - skipping');
        return;
      }

      const cards = Array.from(container.querySelectorAll(itemSelector));
      const current = document.activeElement;
      const currentIndex = cards.indexOf(current);
      console.log(`[NAV-DEBUG] useGridKeyNav key=${event.key} | cards found=${cards.length} | currentIndex=${currentIndex} | activeEl=`, current);

      if (currentIndex === -1) {
        console.log('[NAV-DEBUG] useGridKeyNav: focused element not in card list - no-op');
        return;
      }

      // Calculate columns from grid layout
      let cols = 1;
      if (cards.length > 1) {
        const firstRect = cards[0].getBoundingClientRect();
        cols = cards.filter(c => Math.abs(c.getBoundingClientRect().top - firstRect.top) < 5).length;
        if (cols === 0) cols = 1;
      }
      console.log(`[NAV-DEBUG] useGridKeyNav: detected ${cols} columns`);

      let nextIndex = -1;
      if (event.key === 'ArrowRight') nextIndex = currentIndex + 1;
      if (event.key === 'ArrowLeft') nextIndex = currentIndex - 1;
      if (event.key === 'ArrowDown') nextIndex = currentIndex + cols;
      if (event.key === 'ArrowUp') nextIndex = currentIndex - cols;

      if (nextIndex >= 0 && nextIndex < cards.length) {
        event.preventDefault();
        console.log(`[NAV-DEBUG] useGridKeyNav: moving to card index ${nextIndex}`, cards[nextIndex]);
        cards[nextIndex].focus();
        cards[nextIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } else {
        console.log(`[NAV-DEBUG] useGridKeyNav: nextIndex=${nextIndex} out of range [0..${cards.length-1}] - at edge`);
      }
    };

    console.log('[NAV-DEBUG] useGridKeyNav: window keydown listener registered (will resolve container on each key press)');
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  // Empty deps - register once, resolve ref dynamically on every key press
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export function useDropdownKeyNav(dropdownRef, onClose) {
  useEffect(() => {
    const dropdown = dropdownRef.current;
    if (!dropdown) return;

    // Auto-focus first item when dropdown opens
    const firstBtn = dropdown.querySelector('button');
    if (firstBtn) firstBtn.focus();

    const handleKeyDown = (event) => {
      const buttons = Array.from(dropdown.querySelectorAll('button'));
      const currentIndex = buttons.indexOf(document.activeElement);

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        buttons[currentIndex + 1]?.focus();
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (currentIndex === 0) onClose();
        else buttons[currentIndex - 1]?.focus();
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    dropdown.addEventListener('keydown', handleKeyDown);
    return () => dropdown.removeEventListener('keydown', handleKeyDown);
  }, [dropdownRef, onClose]);
}
