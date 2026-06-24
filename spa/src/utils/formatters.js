import { IMAGE_BASE, FALLBACK_AVATAR } from './constants.js';

export function contentIdFromItem(item) {
  return Number(item?.contentId || item?.movieId || item?.seriesId || item?.tmdbId || item?.id || item?._id || 0);
}

export function normalizeMediaType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['tv', 'series', 'show'].includes(normalized)) return 'Series';
  if (['movie', 'movies', 'film'].includes(normalized)) return 'Movie';
  return value || '';
}

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

export function getValidImdbRating(value) {
  const rating = Number(value);
  if (!Number.isFinite(rating) || rating <= 0 || rating === 10 || rating >= 9.4) return null;
  return rating;
}

export function getValidVoteAverage(value) {
  const rating = Number(value);
  if (!Number.isFinite(rating) || rating <= 0 || rating === 10 || rating >= 9.4) return null;
  return rating;
}

export function getPreferredRating(item) {
  return getValidImdbRating(item?.imdb_rating) ?? getValidVoteAverage(item?.vote_average);
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

export function buildVideasyUrl({ mediaType, tmdbId, seasonNumber, episodeNumber }) {
  const type = String(mediaType || '').toLowerCase();
  const baseUrl =
    type === 'movie'
      ? `https://player.videasy.to/movie/${tmdbId}`
      : `https://player.videasy.to/tv/${tmdbId}/${seasonNumber || 1}/${episodeNumber || 1}`;

  const params = new URLSearchParams({
    color: 'F97316',
    overlay: 'true'
  });

  if (type !== 'movie') {
    params.set('nextEpisode', 'true');
    params.set('autoplayNextEpisode', 'true');
    params.set('episodeSelector', 'true');
  }

  return `${baseUrl}?${params.toString()}`;
}

export function buildVideasyHindiAttemptUrl({ mediaType, tmdbId, seasonNumber, episodeNumber }) {
  const url = new URL(buildVideasyUrl({ mediaType, tmdbId, seasonNumber, episodeNumber }));
  // Best-effort only: VIDEASY does not document a supported movie/TV Hindi-default parameter.
  url.searchParams.set('lang', 'hi');
  url.searchParams.set('audio', 'hindi');
  url.searchParams.set('language', 'hindi');
  return url.toString();
}

export function buildVidnestUrl({ mediaType, tmdbId, seasonNumber, episodeNumber }) {
  const type = String(mediaType || '').toLowerCase();
  if (type === 'movie') {
    return `https://vidnest.fun/movie/${tmdbId}`;
  }
  return `https://vidnest.fun/tv/${tmdbId}/${seasonNumber || 1}/${episodeNumber || 1}`;
}

export function buildVidfastUrl({ mediaType, tmdbId, seasonNumber, episodeNumber }) {
  const type = String(mediaType || '').toLowerCase();
  const baseUrl = type === 'movie'
    ? `https://vidfast.pro/movie/${tmdbId}`
    : `https://vidfast.pro/tv/${tmdbId}/${seasonNumber || 1}/${episodeNumber || 1}`;

  const params = new URLSearchParams({
    theme: 'F97316',
    autoPlay: 'true',
    title: 'true',
    poster: 'true'
  });

  if (type !== 'movie') {
    params.set('nextButton', 'true');
    params.set('autoNext', 'true');
  }

  return `${baseUrl}?${params.toString()}`;
}

export function buildStreamexaScrapeUrl({ mediaType, tmdbId, seasonNumber, episodeNumber }) {
  const type = String(mediaType || '').toLowerCase();
  let targetUrl = `https://streamexa.to/watch/${type}/${tmdbId}`;
  if (type === 'tv') {
    targetUrl += `/${seasonNumber || 1}/${episodeNumber || 1}`;
  }
  return `/api/scrape-embed?url=${encodeURIComponent(targetUrl)}`;
}

export function buildCinesuUrl({ mediaType, tmdbId, seasonNumber, episodeNumber }) {
  const type = String(mediaType || '').toLowerCase();
  if (type === 'movie') {
    return `https://cine.su/en/watch-movie/${tmdbId}`;
  }
  return `https://cine.su/en/watch-tv/${tmdbId}?provider=cine&season=${seasonNumber || 1}&episode=${episodeNumber || 1}`;
}

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

export function compareRatingsForSort(a, b, direction = 'desc') {
  const ratingA = getPreferredRating(a);
  const ratingB = getPreferredRating(b);
  const aMissing = ratingA == null;
  const bMissing = ratingB == null;
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  return direction === 'asc' ? ratingA - ratingB : ratingB - ratingA;
}

export function hasStoredRating(item) {
  return getPreferredRating(item) != null || item?.rating_lookup_attempted === true;
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

export function imageUrl(path, size = 'w500') {
  return path ? `${IMAGE_BASE}/${size}${path}` : FALLBACK_AVATAR;
}

export function getLanguageName(languageCode, fallback = 'Unknown') {
  if (!languageCode) return fallback;

  try {
    const displayNames = new Intl.DisplayNames(['en'], { type: 'language' });
    const resolved = displayNames.of(String(languageCode).toLowerCase());
    return resolved || fallback;
  } catch {
    return fallback;
  }
}

export function yearFrom(item) {
  const dateValue = item?.release_date || item?.first_air_date;
  return dateValue ? new Date(dateValue).getFullYear() : 'N/A';
}

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

export function getDirectorLabel(content, crew = [], type = 'movie') {
  if (type === 'series') {
    if (Array.isArray(content?.created_by) && content.created_by.length) {
      return content.created_by.map((person) => person?.name).filter(Boolean).join(', ');
    }
    if (content?.director) return Array.isArray(content.director) ? content.director.filter(Boolean).join(', ') : content.director;
    return 'Unknown';
  }

  if (Array.isArray(content?.director)) {
    const directors = content.director.filter(Boolean);
    if (directors.length) return directors.join(', ');
  }

  if (typeof content?.director === 'string' && content.director.trim()) {
    return content.director;
  }

  const crewList = Array.isArray(crew) && crew.length ? crew : Array.isArray(content?.crew) ? content.crew : [];
  if (crewList.length) {
    const jobDirectors = crewList.filter((person) => person?.job === 'Director');
    const jobDirectorNames = [...new Set(jobDirectors.map((person) => person?.name).filter(Boolean))];

    let directors = [];

    if (jobDirectorNames.length >= 3) {
      directors = jobDirectorNames;
    } else if (jobDirectorNames.length > 0) {
      directors = [...jobDirectorNames];
      const deptDirectors = crewList
        .filter(
          (person) =>
            person?.known_for_department === 'Directing' &&
            person?.name &&
            !jobDirectorNames.includes(person.name)
        )
        .map((person) => person.name);
      directors.push(...deptDirectors);
    } else {
      directors = crewList
        .filter((person) => person?.known_for_department === 'Directing')
        .map((person) => person?.name)
        .filter(Boolean);
    }

    const finalDirectors = [...new Set(directors)].slice(0, 4);
    if (finalDirectors.length) return finalDirectors.join(', ');
  }

  return 'Unknown';
}

export function getDirectorPeople(content, crew = [], type = 'movie') {
  const uniquePeople = (people = []) => {
    const seen = new Set();
    return people
      .filter((person) => person?.id && person?.name)
      .filter((person) => {
        const key = String(person.id);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 4)
      .map((person) => ({ id: person.id, name: person.name }));
  };

  if (type === 'series') {
    return uniquePeople(Array.isArray(content?.created_by) ? content.created_by : []);
  }

  const crewList = Array.isArray(crew) && crew.length ? crew : Array.isArray(content?.crew) ? content.crew : [];
  if (!crewList.length) return [];

  const jobDirectors = crewList.filter((person) => person?.job === 'Director');
  if (jobDirectors.length >= 3) return uniquePeople(jobDirectors);

  if (jobDirectors.length > 0) {
    const jobDirectorNames = new Set(jobDirectors.map((person) => person?.name).filter(Boolean));
    const deptDirectors = crewList.filter(
      (person) =>
        person?.known_for_department === 'Directing' &&
        person?.name &&
        !jobDirectorNames.has(person.name)
    );
    return uniquePeople([...jobDirectors, ...deptDirectors]);
  }

  return uniquePeople(crewList.filter((person) => person?.known_for_department === 'Directing'));
}

export function formatRuntime(minutes) {
  if (!minutes || Number(minutes) <= 0) return 'N/A';
  const total = Number(minutes);
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (!hours) return `${mins}m`;
  if (!mins) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

export function mediaRoute(item) {
  if (!item) return '#';
  const type = String(item.media_type || item.type || (item.seriesId ? 'Series' : 'Movie')).toLowerCase();
  const id = item.id || item.tmdbID || item.movieId || item.seriesId || item._id;
  if (!id) return '#';
  if (type === 'person') return `/person/${id}`;
  if (type === 'series' || type === 'tv') return `/series/${id}`;
  return `/movie/${id}`;
}

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