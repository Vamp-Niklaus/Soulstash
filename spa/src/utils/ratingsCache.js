/**
 * ratingsCache.js
 *
 * In-memory cache for the user's ratings table.
 * Fetches all ratings once per session and keeps them in memory
 * so individual detail pages don't each fire separate API calls.
 *
 * Cache shape: { data: Array|null, promise: Promise|null, expiresAt: number }
 */

import { getToken } from '../api/client.js';
import { apiFetch } from '../api/client.js';
import { normalizeMediaType } from './formatters.js';
import {
  getValidImdbRating,
  getValidVoteAverage,
  contentIdFromItem,
  mediaTypeFromItem
} from './formatters.js';

const RATINGS_TABLE_TTL = 60 * 60 * 1000; // 1 hour

// Module-level in-memory cache — persists for the lifetime of the browser tab.
export let ratingsTableCache = { data: null, promise: null, expiresAt: 0 };

// ---------------------------------------------------------------------------
// Cache key helper
// ---------------------------------------------------------------------------

export function ratingsCacheKey(tmdbID, mediaType) {
  return `${normalizeMediaType(mediaType)}:${Number(tmdbID)}`;
}

// ---------------------------------------------------------------------------
// Load ratings table
// Fetches all user ratings once; subsequent calls within TTL return from cache.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Cache map helpers
// ---------------------------------------------------------------------------

export function getRatingsCacheMap() {
  return new Map(
    (ratingsTableCache.data || []).map((item) => [
      ratingsCacheKey(item.tmdbID, item.mediaType),
      item
    ])
  );
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

// ---------------------------------------------------------------------------
// Merge ratings into a content item list
// Used to enrich collections / person credits with IMDB scores.
// ---------------------------------------------------------------------------

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
    const fallbackPoster =
      ratingMatch.poster_path || ratingMatch.poster_url || ratingMatch.imdb_poster_url || '';
    return {
      ...item,
      imdb_rating: nextRating ?? item?.imdb_rating,
      vote_average: nextVoteAverage ?? item?.vote_average,
      imdb_id: ratingMatch.imdbID || ratingMatch.imdb_id || item?.imdb_id || '',
      poster_path: item?.poster_path || fallbackPoster,
      rating_lookup_attempted:
        ratingMatch?.lookup_attempted === true || item?.rating_lookup_attempted === true
    };
  });
}
