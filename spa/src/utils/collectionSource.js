// Single place that knows about TMDB-sourced collections.
// User collections and TMDB collections share the same shape and the same UI;
// the only difference is that a TMDB collection has no profile to open.

export const TMDB_PUBLISHER = 'tmdb';
export const TMDB_PUBLISHER_LABEL = 'TMDB';

/** True for a published-collection entry, a collection object, or a route username that comes from TMDB. */
export function isTmdbSource(input) {
  if (!input) return false;
  if (typeof input === 'string') return input.toLowerCase() === TMDB_PUBLISHER;
  return input.source === 'tmdb' || String(input.username || '').toLowerCase() === TMDB_PUBLISHER;
}

/** Link to a collection's detail page, for both user and TMDB collections. */
export function collectionDetailPath(entry) {
  const name = encodeURIComponent(entry?.name || entry?.collection?.name || 'Collection');
  if (isTmdbSource(entry)) {
    return `/user/${TMDB_PUBLISHER}/collection/${name}?id=${entry.tmdbId}`;
  }
  return `/user/${encodeURIComponent(entry.username)}/collection/${name}`;
}

/** Profile link target, or null when the publisher has no profile (TMDB). */
export function publisherProfilePath(entry) {
  return isTmdbSource(entry) ? null : `/user/${encodeURIComponent(entry.username)}`;
}
