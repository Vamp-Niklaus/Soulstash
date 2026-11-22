// Single place that knows about TMDB-sourced and Letterboxd-sourced collections.
// User collections, Letterboxd lists, and TMDB collections share the same shape and the same UI.

export const TMDB_PUBLISHER = 'tmdb';
export const TMDB_PUBLISHER_LABEL = 'TMDB';

export const LETTERBOXD_PUBLISHER = 'letterboxd';
export const LETTERBOXD_PUBLISHER_LABEL = 'Letterboxd';

/** True for a published-collection entry, a collection object, or a route username that comes from TMDB. */
export function isTmdbSource(input) {
  if (!input) return false;
  if (typeof input === 'string') return input.toLowerCase() === TMDB_PUBLISHER;
  return input.source === 'tmdb' || String(input.username || '').toLowerCase() === TMDB_PUBLISHER;
}

/** True for a published-collection entry, a collection object, or a route username that comes from Letterboxd. */
export function isLetterboxdSource(input) {
  if (!input) return false;
  if (typeof input === 'string') return input.toLowerCase() === LETTERBOXD_PUBLISHER;
  return input.source === 'letterboxd' || String(input.username || '').toLowerCase() === LETTERBOXD_PUBLISHER;
}

/** Link to a collection's detail page, for user, Letterboxd, and TMDB collections. */
export function collectionDetailPath(entry) {
  const rawName = entry?.name || entry?.collection?.name || 'Collection';
  const cleanName = rawName.replace(/\s+collection$/i, '').trim() || rawName;
  const name = encodeURIComponent(cleanName);
  if (isTmdbSource(entry)) {
    const tmdbId = entry.tmdbId || entry.id || entry.collection?.tmdbId || entry.collection?.id;
    return `/user/${TMDB_PUBLISHER}/collection/${name}?id=${tmdbId}`;
  }
  if (isLetterboxdSource(entry)) {
    return `/user/${LETTERBOXD_PUBLISHER}/collection/${name}`;
  }
  return `/user/${encodeURIComponent(entry.username)}/collection/${name}`;
}

/** Profile link target, or null when the publisher has no profile (TMDB / Letterboxd). */
export function publisherProfilePath(entry) {
  if (isTmdbSource(entry) || isLetterboxdSource(entry)) return null;
  return `/user/${encodeURIComponent(entry.username)}`;
}
