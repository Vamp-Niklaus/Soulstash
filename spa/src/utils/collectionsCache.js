/**
 * collectionsCache.js
 *
 * Handles all localStorage read/write operations for the user's collections.
 * This is a pure utility module — no React, no network calls.
 *
 * Storage key pattern: ss_collections_<token|'anon'>
 * Storage shape: { collections: Array, version: number, fetchedAt: timestamp }
 */

import { getToken } from '../api/client.js';
import { contentIdFromItem } from './formatters.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getCollectionsCacheKey() {
  return `ss_collections_${getToken() || 'anon'}`;
}

function getCollectionsTrashCacheKey() {
  return `ss_collections_trash_${getToken() || 'anon'}`;
}

// ---------------------------------------------------------------------------
// Normalisation helpers
// ---------------------------------------------------------------------------

/**
 * Deduplicates movies in a collection and normalises the shape.
 * Returns a new object — never mutates the input.
 */
export function normalizeCollection(collection) {
  const rawMovies = Array.isArray(collection?.movies) ? collection.movies : [];
  let movies = rawMovies;

  // Dedup by numeric content ID
  const seenIds = new Set();
  let hasDuplicates = false;
  for (let i = 0; i < rawMovies.length; i++) {
    const m = rawMovies[i];
    const id = Number(m.movieId || m.seriesId || m.id || m._id || 0);
    if (id !== 0 && seenIds.has(id)) {
      hasDuplicates = true;
      break;
    }
    if (id !== 0) seenIds.add(id);
  }

  if (hasDuplicates) {
    seenIds.clear();
    movies = [];
    for (let i = 0; i < rawMovies.length; i++) {
      const m = rawMovies[i];
      const id = Number(m.movieId || m.seriesId || m.id || m._id || 0);
      if (id !== 0 && !seenIds.has(id)) {
        seenIds.add(id);
        movies.push(m);
      } else if (id === 0) {
        movies.push(m);
      }
    }
  }

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

// ---------------------------------------------------------------------------
// Collections cache — read / write
// ---------------------------------------------------------------------------

export function readCollectionsCache() {
  try {
    const raw = localStorage.getItem(getCollectionsCacheKey());
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
      getCollectionsCacheKey(),
      JSON.stringify({
        collections,
        version: resolvedVersion,
        fetchedAt: Date.now()
      })
    );
    // Keep the module-level version counter in sync
    lastKnownCollectionVersion = resolvedVersion;
  } catch {}
}

export function updateCollectionsCache(collections, version) {
  if (!Array.isArray(collections)) return;
  const existing = readCollectionsCache();
  const resolvedVersion = Number.isFinite(Number(version))
    ? Number(version)
    : (Number.isFinite(Number(existing?.version)) ? Number(existing.version) : 0);

  if (existing && existing.version > resolvedVersion) {
    console.warn(
      `[Soulstash] Ignoring stale collection update (v${resolvedVersion} < v${existing.version})`
    );
    return;
  }
  writeCollectionsCache(collections, resolvedVersion);
}

export function getCachedCollectionVersion() {
  const cached = readCollectionsCache();
  return Number.isFinite(Number(cached?.version)) ? Number(cached.version) : 0;
}

export function hasCollectionCache() {
  if (window.CollectionStore?.hasCollectionsCache?.()) return true;
  return !!readCollectionsCache();
}

// ---------------------------------------------------------------------------
// Read cached data
// ---------------------------------------------------------------------------

export function getCachedUserCollections() {
  if (window.CollectionStore?.getCachedCollections) {
    return window.CollectionStore.getCachedCollections() || [];
  }
  const cached = readCollectionsCache();
  return Array.isArray(cached?.collections) ? cached.collections : [];
}

// ---------------------------------------------------------------------------
// Broadcast — write to cache then fire the window event so every
// useLiveCollections subscriber updates without a network round-trip.
// ---------------------------------------------------------------------------

/** Module-level version counter — updated whenever we write to cache */
export let lastKnownCollectionVersion = null;
export function setLastKnownCollectionVersion(v) {
  lastKnownCollectionVersion = v;
}

export function broadcastCollections(nextCollections, version) {
  const collections = normalizeCollections(nextCollections);
  updateCollectionsCache(
    collections,
    version ?? lastKnownCollectionVersion ?? getCachedCollectionVersion()
  );
  window.dispatchEvent(
    new CustomEvent(
      window.CollectionStore?.COLLECTIONS_UPDATED_EVENT || 'soulstash:collections-updated',
      { detail: { collections } }
    )
  );
  return collections;
}

// ---------------------------------------------------------------------------
// Optimistic UI updates
// These mutate the cache instantly so the UI feels instant,
// even before the server confirms the change.
// ---------------------------------------------------------------------------

export function optimisticRemoveCollectionFromCache(collectionId) {
  const current = normalizeCollections(getCachedUserCollections());
  const id = String(collectionId);
  const next = current.filter(
    (c) => String(c._id || c.name) !== id && String(c.name) !== id
  );
  broadcastCollections(next, lastKnownCollectionVersion);
  return current; // snapshot for rollback
}

export function optimisticUpdateCollectionItems(collectionId, updateFn) {
  const current = normalizeCollections(getCachedUserCollections());
  if (!current || current.length === 0) return null;
  const id = String(collectionId);
  let modified = false;
  const next = current.map((collection) => {
    if (String(collection._id || collection.name) !== id && String(collection.name) !== id)
      return collection;
    const movies = Array.isArray(collection.movies) ? collection.movies : [];
    const updated = updateFn(movies);
    modified = true;
    return { ...collection, movies: updated, movieCount: updated.length };
  });
  if (modified) broadcastCollections(next, lastKnownCollectionVersion);
  return current;
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

// ---------------------------------------------------------------------------
// Trash cache — soft-delete items so they can be restored (undo)
// ---------------------------------------------------------------------------

export function readTrashCache() {
  try {
    const raw = localStorage.getItem(getCollectionsTrashCacheKey());
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeTrashCache(entries) {
  try {
    localStorage.setItem(getCollectionsTrashCacheKey(), JSON.stringify(entries));
  } catch {}
}

export function trashItemFromCollectionCache(collectionId, itemId) {
  const current = normalizeCollections(getCachedUserCollections());
  if (!current || current.length === 0) return null;
  const id = String(collectionId);
  let trashedItem = null;
  let collectionName = '';

  const next = current.map((collection) => {
    const isTarget =
      String(collection._id || collection.name) === id || String(collection.name) === id;
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
      itemId: String(itemId),
      item: trashedItem,
      trashedAt: Date.now()
    });
    writeTrashCache(trash);
    broadcastCollections(next, lastKnownCollectionVersion);
  }
  return current; // snapshot for rollback
}

export function confirmTrashItem(collectionId, itemId) {
  const trash = readTrashCache();
  const filtered = trash.filter(
    (t) =>
      !(
        String(t.collectionId) === String(collectionId) &&
        Number(t.item?.movieId || t.item?.seriesId || t.item?.id || t.item?._id || 0) ===
          Number(itemId)
      )
  );
  writeTrashCache(filtered);
}

export function restoreTrashItem(collectionId, itemId) {
  const trash = readTrashCache();
  const entryIdx = trash.findIndex(
    (t) =>
      String(t.collectionId) === String(collectionId) &&
      Number(t.item?.movieId || t.item?.seriesId || t.item?.id || t.item?._id || 0) ===
        Number(itemId)
  );
  if (entryIdx === -1) return;

  const [entry] = trash.splice(entryIdx, 1);
  writeTrashCache(trash);

  const current = normalizeCollections(getCachedUserCollections());
  const id = String(collectionId);
  const next = current.map((collection) => {
    const isTarget =
      String(collection._id || collection.name) === id || String(collection.name) === id;
    if (!isTarget) return collection;
    const movies = Array.isArray(collection.movies) ? collection.movies : [];
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
