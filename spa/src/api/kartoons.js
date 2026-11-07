const KARTOONS_API = 'https://api.kartoons.me/api';
export const KARTOONS_ORIGIN = 'https://kartoons.to';

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
    episodeCount: Number(item.episodeCount) || 0
  };
}

export function kartoonEpisodePlayerUrl(episodeId) {
  return `${KARTOONS_ORIGIN}/player?episodeId=${encodeURIComponent(episodeId)}`;
}
