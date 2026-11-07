const TITLE_ALIASES = {
  'grim adventures of billy and mandy': 'billy and mandy',
  'hadi mera buddy': 'haddi mera buddy'
};

export function normalizeKartoonsTitle(value = '') {
  const normalized = String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(the|a|an)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return TITLE_ALIASES[normalized] || normalized;
}

function bigrams(value) {
  const compact = value.replace(/\s/g, '');
  const counts = new Map();
  for (let i = 0; i < compact.length - 1; i += 1) {
    const pair = compact.slice(i, i + 2);
    counts.set(pair, (counts.get(pair) || 0) + 1);
  }
  return counts;
}

function similarity(left, right) {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const a = bigrams(left);
  const b = bigrams(right);
  let overlap = 0;
  let totalA = 0;
  let totalB = 0;
  for (const count of a.values()) totalA += count;
  for (const count of b.values()) totalB += count;
  for (const [pair, count] of a) overlap += Math.min(count, b.get(pair) || 0);
  return totalA + totalB ? (2 * overlap) / (totalA + totalB) : 0;
}

function posterFile(path = '') {
  const clean = String(path).split(/[?#]/, 1)[0];
  return clean.slice(clean.lastIndexOf('/') + 1).toLowerCase();
}

function contentKind(item) {
  const kind = String(item?.type || item?.media_type || '').toLowerCase();
  if (['tv', 'series', 'show'].includes(kind)) return 'series';
  if (['movie', 'film'].includes(kind)) return 'movie';
  return '';
}

function matchScore(item, kartoon) {
  const itemKind = contentKind(item);
  const kartoonKind = contentKind(kartoon);
  if (!itemKind || (kartoonKind && itemKind !== kartoonKind)) return 0;

  const itemYear = Number(item.release_year || item.release_date?.slice?.(0, 4) || item.first_air_date?.slice?.(0, 4) || 0);
  const kartoonYear = Number(kartoon.startYear || kartoon.releaseYear || 0);
  if (itemYear && kartoonYear && Math.abs(itemYear - kartoonYear) > 1) return 0;

  const left = normalizeKartoonsTitle(item.title || item.name || item.originalTitle || item.original_name);
  const right = normalizeKartoonsTitle(kartoon.title);
  const titleSimilarity = similarity(left, right);
  const containsTitle = left.length >= 6 && right.length >= 6 && (left.includes(right) || right.includes(left));

  // A shared poster can strengthen a title match but cannot override a title mismatch.
  const samePoster = Boolean(posterFile(item.poster_path) && posterFile(item.poster_path) === posterFile(kartoon.image));
  if (titleSimilarity >= 0.88) return samePoster ? 1 : titleSimilarity;
  if (containsTitle && titleSimilarity >= 0.6) return samePoster ? 0.9 : 0.8;
  return 0;
}

export function findKartoonsMatch(item, kartoonItems = []) {
  return (Array.isArray(kartoonItems) ? kartoonItems : [])
    .map((kartoon) => ({ kartoon, score: matchScore(item, kartoon) }))
    .filter(({ kartoon, score }) => score > 0 && kartoon?.slug)
    .sort((left, right) => right.score - left.score)[0]?.kartoon || null;
}

function toKartoonsMetadata(item) {
  return {
    id: item._id || '',
    slug: item.slug || '',
    rating: Number(item.rating) || 0,
    startYear: Number(item.startYear) || null,
    endYear: Number(item.endYear) || null,
    tags: Array.isArray(item.tags) ? item.tags : [],
    image: item.image || '',
    category: item.category || '',
    featured: item.featured === true
  };
}

export function mergeKartoonsSearchResults(soulstashResults = [], kartoonPayload = null) {
  const soulItems = (Array.isArray(soulstashResults) ? soulstashResults : [])
    .filter((item) => item && item.source !== 'kartoons');
  const rawKartItems = Array.isArray(kartoonPayload?.data) ? kartoonPayload.data : [];
  const kartItems = [...new Map(rawKartItems.filter((item) => item?.slug).map((item) => [item.slug, item])).values()];
  const pairs = [];

  soulItems.forEach((item, soulIndex) => {
    kartItems.forEach((kartoon, kartIndex) => {
      const score = matchScore(item, kartoon);
      if (score > 0) pairs.push({ soulIndex, kartIndex, score });
    });
  });
  pairs.sort((a, b) => b.score - a.score);

  const soulToKart = new Map();
  const usedKart = new Set();
  for (const { soulIndex, kartIndex } of pairs) {
    if (soulToKart.has(soulIndex) || usedKart.has(kartIndex)) continue;
    soulToKart.set(soulIndex, kartIndex);
    usedKart.add(kartIndex);
  }

  const merged = soulItems.map((item, index) => {
    const kartIndex = soulToKart.get(index);
    if (kartIndex === undefined) return item;
    return { ...item, kartoons: toKartoonsMetadata(kartItems[kartIndex]) };
  });

  const extras = kartItems
    .filter((_, index) => !usedKart.has(index))
    .filter((item) => item?.slug && item?.title && (item?.image || item?.coverImage))
    .map((item) => ({
      id: `kartoons:${item.slug}`,
      title: item.title?.trim() || item.title,
      media_type: 'Series',
      type: 'tv',
      release_year: Number(item.startYear) || null,
      release_date: item.startYear ? `${item.startYear}-01-01` : null,
      voteAverage: Number(item.rating) || 0,
      poster_path: item.image || item.coverImage || null,
      posterUrl: item.image || item.coverImage || '',
      image: item.image || item.coverImage || '',
      backdrop_path: item.coverImage || item.image || null,
      source: 'kartoons',
      score: 0,
      kartoons: toKartoonsMetadata(item)
    }));

  return [...merged, ...extras];
}
