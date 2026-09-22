import { IMAGE_BASE, FALLBACK_AVATAR } from './constants.js';
import { PLAYER_SOURCE_SLOTS } from './playerUtils.js';
import { Capacitor } from '@capacitor/core';

// ==========================================
// TYPE NORMALIZATION & IDs
// ==========================================

/**
 * Extracts a numeric content ID from any media item object.
 * Useful for normalizing IDs coming from different APIs (TMDB vs MongoDB).
 */
export function contentIdFromItem(item) {
  return Number(item?.contentId || item?.movieId || item?.seriesId || item?.tmdbId || item?.id || item?._id || 0);
}

/**
 * Normalizes a media type string into exactly 'Movie' or 'Series'.
 */
export function normalizeMediaType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['tv', 'series', 'show'].includes(normalized)) return 'Series';
  if (['movie', 'movies', 'film'].includes(normalized)) return 'Movie';
  return value || '';
}

/**
 * Derives the media type (Movie or Series) from an item object based on its properties.
 */
export function mediaTypeFromItem(item) {
  return normalizeMediaType(
    item?.media_type ||
      item?.mediaType ||
      item?.type ||
      (item?.seriesId ? 'Series' : '') ||
      (item?.movieId ? 'Movie' : '') ||
      (!item?.release_date && item?.first_air_date ? 'Series' : '') ||
      (item?.title || item?.release_date ? 'Movie' : '')
  );
}

// ==========================================
// RATING & METADATA UTILS
// ==========================================

/**
 * Validates and returns an IMDB rating, throwing out extreme outliers (10 or >= 9.4) that are usually fake.
 */
export function getValidImdbRating(value) {
  const rating = Number(value);
  if (!Number.isFinite(rating) || rating <= 0 || rating === 10 || rating >= 9.4) return null;
  return rating;
}

/**
 * Validates and returns a TMDB vote average.
 */
export function getValidVoteAverage(value) {
  const rating = Number(value);
  if (!Number.isFinite(rating) || rating <= 0 || rating === 10 || rating >= 9.4) return null;
  return rating;
}

/**
 * Prefers the IMDB rating if available, otherwise falls back to TMDB vote average.
 */
export function getPreferredRating(item) {
  return getValidImdbRating(item?.imdb_rating) ?? getValidVoteAverage(item?.vote_average);
}

/**
 * Merges external IMDB ratings into a list of TMDB items.
 */
export function mergeImdbRatings(items, ratingItems) {
  const ratingsByKey = new Map(
    (ratingItems || []).map((item) => [`${item.mediaType}:${item.tmdbID}`, item])
  );

  return (items || []).map((item) => {
    const contentId = contentIdFromItem(item);
    const mediaType = mediaTypeFromItem(item);
    const ratingMatch = ratingsByKey.get(`${mediaType}:${contentId}`);
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

/**
 * Checks if a specific item has a valid rating or if a lookup was already attempted.
 */
export function hasStoredRating(item) {
  return getPreferredRating(item) != null || item?.rating_lookup_attempted === true;
}

/**
 * Formats a runtime in minutes into a readable "Xh Ym" format.
 */
export function formatRuntime(minutes) {
  if (!minutes || Number(minutes) <= 0) return 'N/A';
  const total = Number(minutes);
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (!hours) return `${mins}m`;
  if (!mins) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

/**
 * Extracts the release year from a media item.
 */
export function yearFrom(item) {
  const dateValue = item?.release_date || item?.first_air_date;
  return dateValue ? new Date(dateValue).getFullYear() : 'N/A';
}

/**
 * Gets the primary country of origin for a media item.
 */
export function getPrimaryCountry(content) {
  if (content?.country) return content.country;
  if (Array.isArray(content?.production_countries) && content.production_countries.length) {
    return content.production_countries
      .map((country) => (typeof country === 'string' ? country : country?.name))
      .filter(Boolean)
      .join(', ');
  }
  return 'Unknown';
}

/**
 * Returns a readable, comma-separated string of director(s) or creator(s).
 * SIMPLIFIED: Uses optional chaining and standard set filtering.
 */
export function getDirectorLabel(content, crew = [], type = 'movie') {
  if (type === 'series') {
    const creators = content?.created_by?.map((c) => c?.name).filter(Boolean) || [];
    if (creators.length) return creators.join(', ');
    const dirs = Array.isArray(content?.director) ? content.director : [content?.director];
    const validDirs = dirs.filter(Boolean);
    return validDirs.length ? validDirs.join(', ') : 'Unknown';
  }

  // Check pre-populated director array/string
  if (Array.isArray(content?.director) && content.director.length) {
    return content.director.filter(Boolean).join(', ');
  }
  if (typeof content?.director === 'string' && content.director.trim()) {
    return content.director;
  }

  // Search crew array
  const crewList = (crew?.length ? crew : content?.crew) || [];
  const directors = crewList
    .filter((p) => p?.job === 'Director' || p?.known_for_department === 'Directing')
    .map((p) => p?.name)
    .filter(Boolean);

  const uniqueDirectors = [...new Set(directors)].slice(0, 4);
  return uniqueDirectors.length ? uniqueDirectors.join(', ') : 'Unknown';
}

/**
 * Returns an array of director objects ({id, name}) for linking.
 * SIMPLIFIED: Filters crew natively with Set tracking.
 */
export function getDirectorPeople(content, crew = [], type = 'movie') {
  const getUnique = (people) => {
    const seen = new Set();
    return (people || [])
      .filter((p) => p?.id && p?.name)
      .filter((p) => seen.has(p.id) ? false : seen.add(p.id))
      .slice(0, 4)
      .map((p) => ({ id: p.id, name: p.name }));
  };

  if (type === 'series') return getUnique(content?.created_by);

  const crewList = (crew?.length ? crew : content?.crew) || [];
  return getUnique(crewList.filter((p) => p?.job === 'Director' || p?.known_for_department === 'Directing'));
}

/**
 * Uses the native Intl.DisplayNames API to convert a language code to a full readable string.
 */
export function getLanguageName(languageCode, fallback = 'Unknown') {
  if (!languageCode) return fallback;
  try {
    const displayNames = new Intl.DisplayNames(['en'], { type: 'language' });
    return displayNames.of(String(languageCode).toLowerCase()) || fallback;
  } catch {
    return fallback;
  }
}

// ==========================================
// IMAGE & URL FORMATTING
// ==========================================

/**
 * Generates a full TMDB image URL, handling external links and fallbacks.
 */
export function imageUrl(path, size = 'w500') {
  if (!path) return FALLBACK_AVATAR;
  if (/^https?:\/\//i.test(String(path))) return path;
  return `${IMAGE_BASE}/${size}${path}`;
}

/**
 * Determines the correct application route path (e.g. /movie/123) for an item.
 */
export function mediaRoute(item) {
  if (!item) return '#';
  const type = String(item.media_type || item.type || (item.seriesId ? 'Series' : 'Movie')).toLowerCase();
  const id = item.id || item.tmdbID || item.movieId || item.seriesId || item._id;
  if (!id) return '#';
  if (type === 'person') return `/person/${id}`;
  if (type === 'series' || type === 'tv') return `/series/${id}`;
  return `/movie/${id}`;
}

// ==========================================
// COLLECTION & FILTERING UTILS
// ==========================================

export function collectionItemKey(item) {
  return `${mediaTypeFromItem(item)}:${contentIdFromItem(item)}`;
}

export function creditItemKey(item) {
  return `${mediaTypeFromItem(item)}:${Number(item?.id || item?.movieId || item?.seriesId || item?.contentId || 0)}`;
}

export function creditMatchesCollectionItem(credit, collectionItem) {
  const creditId = contentIdFromItem(credit);
  const collectionId = contentIdFromItem(collectionItem);
  if (!creditId || !collectionId || creditId !== collectionId) return false;

  const creditType = mediaTypeFromItem(credit);
  const collectionType = mediaTypeFromItem(collectionItem);
  if (!creditType || !collectionType) return true;
  return creditType === collectionType;
}

/**
 * Filters a list of actor credits to only show the ones that exist in the user's collection.
 */
export function filterCreditsByCollectionItems(credits, collection, debugLabel = '', debugEnabled = true) {
  const collectionItems = Array.isArray(collection?.movies) ? collection.movies : [];
  if (!collectionItems.length) return [];
  return credits.filter((credit) => {
    const matchedItem = collectionItems.find((item) => creditMatchesCollectionItem(credit, item));
    if (debugEnabled && debugLabel && matchedItem) {
      console.log(
        `${debugLabel} cast "${credit?.title || credit?.name || 'Unknown'}" (${mediaTypeFromItem(credit)} ${contentIdFromItem(credit)}) matches collection "${matchedItem?.title || matchedItem?.name || 'Unknown'}" (${mediaTypeFromItem(matchedItem)} ${contentIdFromItem(matchedItem)})`
      );
    }
    return !!matchedItem;
  });
}

/**
 * Standardizes a collection item object.
 */
export function normalizeStoredCollectionItem(item) {
  const isSeries = item?.media_type === 'Series' || item?.media_type === 'tv' || !!item?.seriesId;
  const id = Number(item?.movieId || item?.seriesId || item?.id || item?._id || 0);

  return {
    id,
    title: item?.title || item?.name || 'Unknown',
    name: item?.name || item?.title || 'Unknown',
    poster_path: item?.poster_path || '',
    release_date: item?.release_date || '',
    first_air_date: item?.first_air_date || '',
    vote_average: item?.vote_average || 0,
    imdb_rating: item?.imdb_rating,
    imdb_id: item?.imdb_id || '',
    rating_lookup_attempted: item?.rating_lookup_attempted === true,
    media_type: isSeries ? 'Series' : 'Movie'
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

export function createEmptyCollectionDraft() {
  return { name: '', description: '', isPublic: false };
}

/**
 * Returns booleans indicating which default collections a piece of content is currently in.
 */
export function getCollectionStatus(collections, contentId) {
  const numericId = Number(contentId);
  const watchedCollection = collections.find((c) => c.name === 'Watched');
  const watchlistCollection = collections.find((c) => c.name === 'Watchlist');
  const customCollections = collections.filter((c) => !['Watched', 'Watchlist'].includes(c.name));

  const hasContent = (collection) =>
    Array.isArray(collection?.movies) &&
    collection.movies.some((item) => item.movieId === numericId || item.seriesId === numericId);

  return {
    watched: hasContent(watchedCollection),
    watchlist: hasContent(watchlistCollection),
    customSaved: customCollections.some(hasContent)
  };
}

export function isContentInCollection(collections, collectionName, contentId, mediaType = '') {
  const collection = collections.find((item) => item.name === collectionName || item._id === collectionName);
  if (!collection || !Array.isArray(collection.movies)) return false;
  const normalizedMediaType = normalizeMediaType(mediaType);
  return collection.movies.some((movie) => {
    const sameId = contentIdFromItem(movie) === Number(contentId);
    if (!sameId) return false;
    if (!normalizedMediaType) return true;
    return normalizeMediaType(movie?.media_type || (movie?.seriesId ? 'Series' : 'Movie')) === normalizedMediaType;
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

export function hasActivePersonFilters({ contentType, quickFilter, collectionFilter, sortBy }) {
  return (
    contentType !== 'all' ||
    quickFilter !== 'all' ||
    !!collectionFilter ||
    sortBy !== 'year-desc'
  );
}

/**
 * SIMPLIFIED: Filters and sorts a collection based on the user's active filter criteria.
 */
export function filteredCollectionMovies(collection, filters, watchedIds) {
  const base = Array.isArray(collection?.movies) ? collection.movies : [];
  
  // 1. Filter
  const filtered = base.filter((movie) => {
    const isSeries = movie?.media_type === 'Series' || movie?.media_type === 'tv' || !!movie?.seriesId;
    const isAnime = !!movie?.isAnime;
    const id = Number(movie?.movieId || movie?.seriesId || movie?.id || movie?._id || 0);

    if (filters.contentType === 'movies' && isSeries) return false;
    if (filters.contentType === 'series' && !isSeries) return false;
    if (filters.anime === 'no' && isAnime) return false;
    if (filters.anime === 'only' && !isAnime) return false;
    if (filters.hideWatched && watchedIds.has(id)) return false;
    return true;
  });

  // 2. Sort
  return filtered.sort((a, b) => {
    if (filters.sortBy === 'oldest') {
        const addedA = new Date(a?.addedAt || a?.updatedAt || a?.release_date || 0).getTime();
        const addedB = new Date(b?.addedAt || b?.updatedAt || b?.release_date || 0).getTime();
        return addedA - addedB;
    }
    if (filters.sortBy === 'rating-desc') return compareRatingsForSort(a, b, 'desc');
    if (filters.sortBy === 'rating-asc') return compareRatingsForSort(a, b, 'asc');
    if (filters.sortBy === 'title-asc') return String(a?.title || a?.name || '').localeCompare(String(b?.title || b?.name || ''));
    if (filters.sortBy === 'title-desc') return String(b?.title || b?.name || '').localeCompare(String(a?.title || a?.name || ''));
    
    const yearA = Number(yearFrom(a)) || 0;
    const yearB = Number(yearFrom(b)) || 0;
    if (filters.sortBy === 'year-desc') return yearB - yearA;
    if (filters.sortBy === 'year-asc') return yearA - yearB;
    
    // Default: recent (newest added)
    const addedA = new Date(a?.addedAt || a?.updatedAt || a?.release_date || 0).getTime();
    const addedB = new Date(b?.addedAt || b?.updatedAt || b?.release_date || 0).getTime();
    return addedB - addedA;
  });
}

export function compareRatingsForSort(a, b, direction = 'desc') {
  const ratingA = getPreferredRating(a);
  const ratingB = getPreferredRating(b);
  if (ratingA == null && ratingB == null) return 0;
  if (ratingA == null) return 1;
  if (ratingB == null) return -1;
  return direction === 'asc' ? ratingA - ratingB : ratingB - ratingA;
}

export function filterLabel(filters) {
  switch (filters.anime) {
    case 'no': return 'Hide anime';
    case 'only': return 'Only anime';
    default: return 'Show anime';
  }
}

export function sortLabel(filters) {
  switch (filters.sortBy) {
    case 'oldest': return 'Oldest';
    case 'rating-desc': return 'Rating high';
    case 'rating-asc': return 'Rating low';
    case 'title-asc': return 'Title A-Z';
    case 'title-desc': return 'Title Z-A';
    case 'year-desc': return 'Year new';
    case 'year-asc': return 'Year old';
    default: return 'Recent';
  }
}

// ==========================================
// SEARCH & HISTORY UTILS
// ==========================================

const SEARCH_HISTORY_KEY = 'ss_search_history';

/**
 * Retrieves the search history from local storage.
 */
export function getSearchHistory() {
  try {
    const raw = localStorage.getItem(SEARCH_HISTORY_KEY);
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Truncates and saves a lightweight version of a searched item to local storage history.
 */
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
      ...getSearchHistory().filter(
        (entry) =>
          `${entry.media_type}:${entry.id || entry.username}` !==
          `${item.media_type}:${item.id || item.username}`
      )
    ].slice(0, 20);
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(next));
  } catch {}
}

/**
 * SIMPLIFIED: Merges incoming streaming API search results with current results, deduplicating via Set,
 * and sorts by relevance/score.
 * @param {number} adminMode - 0=filter adult, 1=show all, 2=adult only (only applies to Movie/Series, not People)
 */
export function mergeSearchResults(currentResults, incomingResults, limit = 40, adminMode = 0) {
  const mergedMap = new Map();

  // Deduplicate and filter bad data
  for (const item of [...currentResults, ...incomingResults]) {
    if (!item) continue;
    
    // Apply adult filter only to content (Movie/Series), not people
    const isContent = ['Movie', 'Series', 'tv', 'movie'].includes(item.media_type);
    if (isContent) {
      if (adminMode === 2 && item.adult !== true) continue;        // adult only: skip non-adult
      if (adminMode === 0 && item.adult === true) continue;         // filter on: skip adult
      // adminMode === 1: allow everything
    }

    if (isContent && Number(item.score || 0) <= 25) continue;
    
    const key = `${item.media_type}:${item.id || item.username || item.title}`;
    if (!mergedMap.has(key)) mergedMap.set(key, item);
  }

  // Sort
  return Array.from(mergedMap.values())
    .sort((a, b) => {
      const aIsContent = ['Movie', 'Series', 'tv'].includes(String(a.media_type || ''));
      const bIsContent = ['Movie', 'Series', 'tv'].includes(String(b.media_type || ''));
      
      // Prioritize Content over People/Users
      if (aIsContent !== bIsContent) return aIsContent ? -1 : 1;
      
      // Sort by score or popularity
      return (Number(b.score || b.popularity || 0)) - (Number(a.score || a.popularity || 0));
    })
    .slice(0, limit);
}


// ==========================================
// VIDEO PLAYER URL BUILDERS
// ==========================================

export function isDirectMediaUrl(url = '') {
  const normalized = String(url).toLowerCase();
  return (
    normalized.endsWith('.mp4') ||
    normalized.endsWith('.m3u8') ||
    normalized.endsWith('.webm') ||
    normalized.endsWith('.ogg')
  );
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

/**
 * Generates an array of fallback third-party streaming iframes for when the main server fails.
 */
export function buildLegacyPlayerSources({ mediaType, tmdbId, seasonNumber, episodeNumber }) {
  const input = { mediaType, tmdbId, seasonNumber, episodeNumber };
  const type = String(mediaType || '').toLowerCase();
  const isMovie = type === 'movie';
  const s = seasonNumber || 1;
  const e = episodeNumber || 1;
  
  return [
    {
      id: 'legacy-videasy-hi',
      key: 'legacy-videasy-hi',
      label: 'VIDEASY',
      url: buildVideasyHindiAttemptUrl(input),
      urls: [buildVideasyHindiAttemptUrl(input)],
      embeddable: true,
      fallback: true
    },
    {
      id: 'legacy-vidfast',
      key: 'legacy-vidfast',
      label: 'vidfast',
      url: buildVidfastUrl(input),
      urls: [buildVidfastUrl(input)],
      embeddable: true,
      fallback: true
    },
    {
      id: 'legacy-vidnest',
      key: 'legacy-vidnest',
      label: 'VidNest',
      url: buildVidnestUrl(input),
      urls: [buildVidnestUrl(input)],
      embeddable: true,
      fallback: true
    },
    { id: 'legacy-vidsrc-pro', key: 'legacy-vidsrc-pro', label: 'VidSrc PRO', url: isMovie ? `https://vidsrc.pro/embed/movie/${tmdbId}` : `https://vidsrc.pro/embed/tv/${tmdbId}/${s}/${e}`, urls: [isMovie ? `https://vidsrc.pro/embed/movie/${tmdbId}` : `https://vidsrc.pro/embed/tv/${tmdbId}/${s}/${e}`], embeddable: true, fallback: true },
    { id: 'legacy-vidsrc-in', key: 'legacy-vidsrc-in', label: 'VidSrc IN', url: isMovie ? `https://vidsrc.in/embed/movie/${tmdbId}` : `https://vidsrc.in/embed/tv/${tmdbId}/${s}/${e}`, urls: [isMovie ? `https://vidsrc.in/embed/movie/${tmdbId}` : `https://vidsrc.in/embed/tv/${tmdbId}/${s}/${e}`], embeddable: true, fallback: true },
    { id: 'legacy-vidsrc-pm', key: 'legacy-vidsrc-pm', label: 'VidSrc PM', url: isMovie ? `https://vidsrc.pm/embed/movie/${tmdbId}` : `https://vidsrc.pm/embed/tv/${tmdbId}/${s}/${e}`, urls: [isMovie ? `https://vidsrc.pm/embed/movie/${tmdbId}` : `https://vidsrc.pm/embed/tv/${tmdbId}/${s}/${e}`], embeddable: true, fallback: true },
    { id: 'legacy-vidsrc-net', key: 'legacy-vidsrc-net', label: 'VidSrc NET', url: isMovie ? `https://vidsrc.net/embed/movie/${tmdbId}` : `https://vidsrc.net/embed/tv/${tmdbId}/${s}/${e}`, urls: [isMovie ? `https://vidsrc.net/embed/movie/${tmdbId}` : `https://vidsrc.net/embed/tv/${tmdbId}/${s}/${e}`], embeddable: true, fallback: true },
    { id: 'legacy-vidsrc-xyz', key: 'legacy-vidsrc-xyz', label: 'VidSrc XYZ', url: isMovie ? `https://vidsrc.xyz/embed/movie/${tmdbId}` : `https://vidsrc.xyz/embed/tv/${tmdbId}/${s}/${e}`, urls: [isMovie ? `https://vidsrc.xyz/embed/movie/${tmdbId}` : `https://vidsrc.xyz/embed/tv/${tmdbId}/${s}/${e}`], embeddable: true, fallback: true },
    { id: 'legacy-superembed', key: 'legacy-superembed', label: 'SuperEmbed', url: isMovie ? `https://multiembed.mov/directstream.php?video_id=${tmdbId}&tmdb=1` : `https://multiembed.mov/directstream.php?video_id=${tmdbId}&tmdb=1&s=${s}&e=${e}`, urls: [isMovie ? `https://multiembed.mov/directstream.php?video_id=${tmdbId}&tmdb=1` : `https://multiembed.mov/directstream.php?video_id=${tmdbId}&tmdb=1&s=${s}&e=${e}`], embeddable: true, fallback: true },
    { id: 'legacy-autoembed', key: 'legacy-autoembed', label: 'AutoEmbed', url: isMovie ? `https://autoembed.co/movie/tmdb/${tmdbId}` : `https://autoembed.co/tv/tmdb/${tmdbId}-${s}-${e}`, urls: [isMovie ? `https://autoembed.co/movie/tmdb/${tmdbId}` : `https://autoembed.co/tv/tmdb/${tmdbId}-${s}-${e}`], embeddable: true, fallback: true },
    { id: 'legacy-vidbinge', key: 'legacy-vidbinge', label: 'VidBinge', url: isMovie ? `https://vidbinge.dev/embed/movie/${tmdbId}` : `https://vidbinge.dev/embed/tv/${tmdbId}/${s}/${e}`, urls: [isMovie ? `https://vidbinge.dev/embed/movie/${tmdbId}` : `https://vidbinge.dev/embed/tv/${tmdbId}/${s}/${e}`], embeddable: true, fallback: true },
    { id: 'legacy-multiembed', key: 'legacy-multiembed', label: 'MultiEmbed', url: isMovie ? `https://multiembed.mov/?video_id=${tmdbId}&tmdb=1` : `https://multiembed.mov/?video_id=${tmdbId}&tmdb=1&s=${s}&e=${e}`, urls: [isMovie ? `https://multiembed.mov/?video_id=${tmdbId}&tmdb=1` : `https://multiembed.mov/?video_id=${tmdbId}&tmdb=1&s=${s}&e=${e}`], embeddable: true, fallback: true },
    { id: 'legacy-2embed', key: 'legacy-2embed', label: '2Embed', url: isMovie ? `https://www.2embed.cc/embed/${tmdbId}` : `https://www.2embed.cc/embedtv/${tmdbId}&s=${s}&e=${e}`, urls: [isMovie ? `https://www.2embed.cc/embed/${tmdbId}` : `https://www.2embed.cc/embedtv/${tmdbId}&s=${s}&e=${e}`], embeddable: true, fallback: true },
    {
      id: 'legacy-cinesu',
      key: 'legacy-cinesu',
      label: 'Cine.su',
      url: buildCinesuUrl(input),
      urls: [buildCinesuUrl(input)],
      embeddable: true,
      fallback: true
    }
  ].filter((source) => source.url);
}

export function buildVideasyUrl({ mediaType, tmdbId, seasonNumber, episodeNumber }) {
  const type = String(mediaType || '').toLowerCase();
  const baseUrl = type === 'movie' ? `https://player.videasy.to/movie/${tmdbId}` : `https://player.videasy.to/tv/${tmdbId}/${seasonNumber || 1}/${episodeNumber || 1}`;
  const params = new URLSearchParams({ color: 'F97316', overlay: 'true' });
  if (type !== 'movie') {
    params.set('nextEpisode', 'true');
    params.set('autoplayNextEpisode', 'true');
    params.set('episodeSelector', 'true');
  }
  return `${baseUrl}?${params.toString()}`;
}

export function buildVideasyHindiAttemptUrl({ mediaType, tmdbId, seasonNumber, episodeNumber }) {
  const url = new URL(buildVideasyUrl({ mediaType, tmdbId, seasonNumber, episodeNumber }));
  url.searchParams.set('lang', 'hi');
  url.searchParams.set('audio', 'hindi');
  url.searchParams.set('language', 'hindi');
  return url.toString();
}

export function buildVidnestUrl({ mediaType, tmdbId, seasonNumber, episodeNumber }) {
  const type = String(mediaType || '').toLowerCase();
  if (type === 'movie') return `https://vidnest.fun/movie/${tmdbId}`;
  return `https://vidnest.fun/tv/${tmdbId}/${seasonNumber || 1}/${episodeNumber || 1}`;
}

export function buildVidfastUrl({ mediaType, tmdbId, seasonNumber, episodeNumber }) {
  const type = String(mediaType || '').toLowerCase();
  const baseUrl = type === 'movie' ? `https://vidfast.pro/movie/${tmdbId}` : `https://vidfast.pro/tv/${tmdbId}/${seasonNumber || 1}/${episodeNumber || 1}`;
  const params = new URLSearchParams({ theme: 'F97316', autoPlay: 'true', title: 'true', poster: 'true' });
  if (type !== 'movie') {
    params.set('nextButton', 'true');
    params.set('autoNext', 'true');
  }
  return `${baseUrl}?${params.toString()}`;
}

export function buildStreamexaScrapeUrl({ mediaType, tmdbId, seasonNumber, episodeNumber }) {
  const type = String(mediaType || '').toLowerCase();
  let targetUrl = `https://streamexa.to/watch/${type}/${tmdbId}`;
  if (type === 'tv') targetUrl += `/${seasonNumber || 1}/${episodeNumber || 1}`;
  return `/api/scrape-embed?url=${encodeURIComponent(targetUrl)}`;
}

export function buildCinesuUrl({ mediaType, tmdbId, seasonNumber, episodeNumber }) {
  const type = String(mediaType || '').toLowerCase();
  if (type === 'movie') return `https://cine.su/en/watch-movie/${tmdbId}`;
  return `https://cine.su/en/watch-tv/${tmdbId}?provider=cine&season=${seasonNumber || 1}&episode=${episodeNumber || 1}`;
}

/**
 * Structures the complete payload required by the player components to begin streaming.
 */
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

/**
 * Matches incoming API sources with local fallback sources to populate the player UI.
 */
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

// ==========================================
// GRID & UI CALCULATIONS
// ==========================================

export function getDrawerColumnCount() {
  const width = window.innerWidth;
  if (width >= 1600) return 5;
  if (width >= 1280) return 4;
  if (width >= 900) return 3;
  if (width >= 600) return 2;
  return 1;
}

export function getOverlayColumnCount() {
  const width = window.innerWidth;
  if (width >= 1024) return 4;
  if (width >= 768) return 3;
  if (width >= 640) return 2;
  return 1;
}

export function getHomeGridColumns(width = window.innerWidth) {
  if (width >= 1280) return 7;
  if (width >= 1024) return 6;
  if (width >= 768) return 5;
  if (width >= 640) return 4;
  return 3;
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

// ==========================================
// NATIVE DEVICE HACKS
// ==========================================

/**
 * Checks if the application is running inside a native Capacitor Android Wrapper.
 */
export function isAndroidApp() {
  try {
    return Capacitor?.getPlatform?.() === 'android';
  } catch {
    return false;
  }
}

/**
 * Interfaces with a native Java/Kotlin plugin to physically zoom the Android webview.
 */
export const setNativeScale = async (scale) => {
  if (isAndroidApp()) {
    try {
      const { Capacitor: Cap } = window;
      if (Cap && Cap.registerPlugin) {
        const ZoomPlugin = Cap.registerPlugin('ZoomPlugin');
        if (ZoomPlugin) {
          await ZoomPlugin.setScale({ scale });
        }
      }
    } catch (e) {
      console.log('ZoomPlugin error:', e);
    }
  }
};

/**
 * Hack to forcefully bypass React Router and trigger a raw HTML5 history navigation.
 */
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
