import { apiFetch } from './client.js';

const KARTOONS_API = 'https://api.kartoons.me/api';
const KARTOONS_STREMIO = `${KARTOONS_API}/stremio`;
const KARTOONS_TOKEN = 'OK_DGA031TQOAsyYaGa3LrOu9xdIjNCDRsxbos0-XCs';

// Cache for Stremio streams (5 min — m3u8 hashes rotate)
const _streamCache = {};
// Cache for the full movie catalog (6 h)
const _movieCatalogCache = { at: 0, data: null };
// Cache for episode IDs (stable — never expire)
const _episodeIdCache = {};

/**
 * Fetch direct streams from the Kartoons Stremio addon.
 * Returns an array of { url, label } objects — each is a dub/language variant.
 * These are direct .m3u8 HLS URLs with CORS open — no iframe needed.
 *
 * @param {'series'|'movie'} type
 * @param {string} id  — episode _id for series, movie _id for movies
 * @param {boolean} force — bypass 5-min cache
 */
export async function fetchKartoonsStremioStreams(type, id, force = false) {
  const cacheKey = `${type}|${id}`;
  if (!force) {
    const cached = _streamCache[cacheKey];
    if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.streams;
  }

  // 1. Try our backend stream resolver first (fetches and un-proxies worker m3u8 playlists).
  // Retry once: the backend can briefly return nothing when the upstream hiccups.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const backendData = await apiFetch(`/api/kartoons/resolve-stream?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`);
      if (backendData?.success && Array.isArray(backendData.streams) && backendData.streams.length > 0) {
        _streamCache[cacheKey] = { at: Date.now(), streams: backendData.streams };
        return backendData.streams;
      }
    } catch (_) {}
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 800));
  }

  // 2. Direct client fallback
  const url = `${KARTOONS_STREMIO}/stream/${type}/${encodeURIComponent(id)}.json?token=${KARTOONS_TOKEN}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Kartoons Stremio ${res.status}`);
  const json = await res.json().catch(() => ({}));
  const streams = (json.streams || [])
    .filter((s) => s.url)
    .map((s, i) => ({
      url: s.url,
      label: String(s.title || `Server ${i + 1}`).replace(/\s*-\s*S\d+E\d+\s*$/i, '').trim() || `Server ${i + 1}`
    }));
  if (!streams.length) throw new Error('No streams available');
  _streamCache[cacheKey] = { at: Date.now(), streams };
  return streams;
}

/**
 * Resolve a movie _id from its slug using direct movie lookup or Stremio catalog.
 */
export async function resolveKartoonsMovieId(slug) {
  if (!slug) return null;
  if (/^[0-9a-f]{24}$/i.test(slug)) return slug;

  // 1. Fast direct movie detail lookup (returns exact _id and preserves related metadata)
  try {
    const res = await fetch(`https://api.kartoons.to/api/movies/${encodeURIComponent(slug)}`, { cache: 'no-store' });
    if (res.ok) {
      const json = await res.json();
      if (json?.data?._id) return json.data._id;
    }
  } catch (_) {}

  // 2. Catalog fallback
  const hex = String((slug || '').split('-').pop() || '').toLowerCase();
  if (!hex) return null;
  if (!_movieCatalogCache.data || Date.now() - _movieCatalogCache.at > 6 * 3600 * 1000) {
    const url = `${KARTOONS_STREMIO}/catalog/movie/kartoons_movies.json?token=${KARTOONS_TOKEN}`;
    const res = await fetch(url, { cache: 'no-store' });
    const json = await res.json().catch(() => ({}));
    _movieCatalogCache.data = json.metas || [];
    _movieCatalogCache.at = Date.now();
  }
  const hit = (_movieCatalogCache.data || []).find((m) =>
    String((m.id || '').split(':').pop() || '').toLowerCase().startsWith(hex)
  );
  return hit ? String(hit.id || '').split(':').pop() : null;
}

/**
 * Resolve a stable episode _id for a given slug / season / episode.
 * Falls back to the first available season if the requested one has no episodes.
 */
export async function resolveKartoonsEpisodeId(slug, season, episode) {
  const key = `${slug}|${season}|${episode}`;
  if (_episodeIdCache[key]) return _episodeIdCache[key];
  let eps = await fetchKartoonsEpisodes(slug, season);
  let ep = eps.find((e) => String(e.episodeNumber) === String(episode));
  if (!ep) {
    // Never substitute a different episode (that made every missing episode play episode 1).
    throw new Error(`Episode ${episode} of season ${season} not found on Kartoons`);
  }
  if (!ep?._id) throw new Error('Episode not found');
  _episodeIdCache[key] = ep._id;
  return ep._id;
}

async function kartFetch(path, { signal } = {}) {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(signal?.reason);
  if (signal?.aborted) abortFromCaller();
  else signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timeout = window.setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${KARTOONS_API}${path}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      mode: 'cors',
      credentials: 'omit'
    });
    if (!response.ok) {
      throw new Error(`Kartoons request failed (${response.status})`);
    }
    const payload = await response.json();
    if (payload?.success === false) {
      throw new Error(payload.message || 'Kartoons request failed');
    }
    return payload?.data ?? payload;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}

export async function searchKartoonsShows(query, { signal } = {}) {
  const value = String(query || '').trim();
  if (value.length < 2) return { data: [], pagination: null };
  const params = new URLSearchParams({ page: '1', search: value });
  const payload = await kartFetch(`/shows?${params}`, { signal });
  return {
    data: Array.isArray(payload) ? payload : [],
    pagination: payload?.pagination || null
  };
}

export async function searchKartoonsMovies(query, { signal } = {}) {
  const value = String(query || '').trim();
  if (value.length < 2) return { data: [], pagination: null };
  const params = new URLSearchParams({ page: '1', search: value });
  const payload = await kartFetch(`/movies?${params}`, { signal });
  return {
    data: (Array.isArray(payload) ? payload : []).map((item) => ({
      ...item,
      type: 'movie',
      startYear: Number(item.startYear || item.releaseYear) || null
    })),
    pagination: payload?.pagination || null
  };
}

export async function fetchKartoonsMovieDetail(slug, { signal } = {}) {
  const value = String(slug || '').trim();
  if (!value) throw new Error('Kartoons movie not found');

  // Direct fetch from /movies/:slug (returns full movie details + related titles)
  try {
    const res = await fetch(`${KARTOONS_API}/movies/${encodeURIComponent(value)}`, {
      headers: { Accept: 'application/json' },
      signal,
      mode: 'cors'
    });
    if (res.ok) {
      const payload = await res.json();
      const item = payload?.data || payload;
      if (item && (item.title || item._id)) {
        return {
          id: item._id || item.slug || '',
          slug: item.slug || '',
          title: item.title || 'Unknown title',
          category: item.category || '',
          image: item.image || '',
          coverImage: item.coverImage || item.image || '',
          startYear: Number(item.startYear || item.releaseYear) || null,
          rating: Number(item.rating) || 0,
          tags: Array.isArray(item.tags) ? item.tags : [],
          description: item.description || item.overview || '',
          related: Array.isArray(payload.related) ? payload.related : (Array.isArray(item.related) ? item.related : [])
        };
      }
    }
  } catch (_) {}

  const titleQuery = value
    .replace(/-[a-f0-9]{5,24}$/i, '')
    .replace(/-/g, ' ')
    .trim();
  if (titleQuery.length < 2) throw new Error('Kartoons movie not found');

  const { data } = await searchKartoonsMovies(titleQuery, { signal });
  const item = data.find((candidate) => candidate.slug === value);
  if (!item) throw new Error('Kartoons movie not found');

  return {
    id: item._id || item.slug || '',
    slug: item.slug || '',
    title: item.title || 'Unknown title',
    category: item.category || '',
    image: item.image || '',
    coverImage: item.coverImage || item.image || '',
    startYear: Number(item.startYear || item.releaseYear) || null,
    rating: Number(item.rating) || 0,
    tags: Array.isArray(item.tags) ? item.tags : [],
    description: item.description || item.overview || '',
    related: Array.isArray(item.related) ? item.related : []
  };
}

export function getKartoonsSearchQueries(query) {
  const value = String(query || '').trim();
  const normalized = normalizeKartoonsSearchTerm(value).replace(/\b(19\d{2}|20\d{2})\b/g, '').replace(/\s+/g, ' ').trim();
  if (!normalized) return value ? [value] : [];

  const titlePairs = [
    { key: 'haddi mera buddy', alternate: 'Hadi Mera Buddy' },
    { key: 'hadi mera buddy', alternate: 'Haddi Mera Buddy' },
    { key: 'grim adventures of billy and mandy', alternate: 'Billy and Mandy' },
    { key: 'billy and mandy', alternate: 'The Grim Adventures of Billy and Mandy' }
  ];
  const pair = titlePairs.find((item) => normalized === item.key);
  return pair ? [...new Set([value, pair.alternate])] : [value];
}

function normalizeKartoonsSearchTerm(value = '') {
  const normalized = String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(the|a|an)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized;
}

export async function fetchKartoonsShowDetail(slug, { signal } = {}) {
  const data = await kartFetch(`/shows/${encodeURIComponent(slug)}`, { signal });
  return normalizeKartoonsShow(data);
}

export async function fetchKartoonsEpisodes(slug, seasonNumber, { signal } = {}) {
  const path = `/shows/${encodeURIComponent(slug)}/season/season-${Number(seasonNumber) || 1}/all-episodes`;
  const data = await kartFetch(path, { signal });
  return Array.isArray(data) ? data : [];
}

export function normalizeKartoonsShow(item = {}) {
  return {
    id: item._id || item.slug || '',
    slug: item.slug || '',
    title: item.title || 'Unknown title',
    category: item.category || '',
    image: item.image || '',
    coverImage: item.coverImage || item.image || '',
    startYear: Number(item.startYear || item.releaseYear) || null,
    endYear: Number(item.endYear) || null,
    rating: Number(item.rating) || 0,
    tags: Array.isArray(item.tags) ? item.tags : [],
    featured: item.featured === true,
    status: item.status || '',
    seasons: Array.isArray(item.seasons) ? item.seasons : [],
    description: item.description || '',
    episodeCount: Number(item.episodeCount) || 0,
    related: Array.isArray(item.related) ? item.related : []
  };
}
