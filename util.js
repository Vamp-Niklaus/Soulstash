// assets/js/util.js

const INDIAN_LANGS = new Set([
  'hi', 'ta', 'te', 'ml', 'kn', 'bn', 'mr', 'gu', 'pa', 'ur'
]);

const PENALTIES = {
  NO_LANGUAGE: -15,
  NO_COUNTRY: -20
};

// ---------- helpers ----------
function normalizeText(str = '') {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------- title score ----------
function titleScore(query, title, originalTitle) {
  const q = normalizeText(query);
  const t1 = normalizeText(title);
  const t2 = normalizeText(originalTitle);

  if (!q) return 0;
  if (t1 === q || t2 === q) return 120;
  if (t1.startsWith(q) || t2.startsWith(q)) return 90;
  if (t1.includes(q) || t2.includes(q)) return 60;

  return 0;
}

// ---------- indian + completeness ----------
function indianAndCompletenessScore(item) {
  let score = 0;

  if (Array.isArray(item.originCountry) && item.originCountry.includes('IN')) {
    score += 50;
  }

  if (INDIAN_LANGS.has(item.originalLanguage)) {
    score += 35;
  }

  if (!item.originalLanguage) score += PENALTIES.NO_LANGUAGE;
  if (!item.originCountry || item.originCountry.length === 0) {
    score += PENALTIES.NO_COUNTRY;
  }

  return score;
}

// ---------- credibility ----------
function credibilityScore(voteCount = 0, voteAverage = 0, popularity = 0) {
  let score = 0;

  score += Math.min(voteCount / 100, 40); // vote count strongest
  score += voteAverage * 2;
  score += Math.min(popularity / 20, 10);

  return score;
}

// ---------- final score ----------
function computeFinalScore(item, query,year_query) {
  let score = 0;

  const q = query.toLowerCase();
  const t1 = (item.title || '').toLowerCase();
  const t2 = (item.originalTitle || '').toLowerCase();

  // Exact title match (highest priority)
  if (t1 === q || t2 === q) {
    score += 200;
  } 
  // Contains query (high priority)
  else if (t1.includes(q) || t2.includes(q)) {
    score += 100;
  }
  // Partial word match (medium priority)
  else if (t1.split(' ').some(word => word.includes(q)) || t2.split(' ').some(word => word.includes(q))) {
    score += 40;
  }

  // Penalty for missing critical data
  if (!item.title) score -= 50;
  if (!item.poster_path) score -= 30;
  // if (!item.overview) score -= 20;
  if (year_query && item.release_year  === Number(year_query)) {
    score += 70; // HARD BOOST
  }
  // Indian priority (lowered)
  if (item.originCountry.includes('IN')) {
    score += 50;
  }
  if (INDIAN_LANGS.has(item.originalLanguage)) {
    score += 15;
  }

  // Credibility (lowered)
  score += Math.min(item.voteCount / 200, 20);
  score += item.voteAverage;

  return score;
}

function normalize(item, type) {
  const isMovie = type === 'movie';

  const releaseDate = isMovie
    ? item.release_date
    : item.first_air_date;

  // Extract year safely from YYYY-MM-DD
  const releaseYear = releaseDate?.length >= 4
    ? Number(releaseDate.slice(0, 4))
    : null;

  return {
    id: item.id,
    type,
    media_type: isMovie ? 'Movie' : 'Series',

    title: item.title || item.name || '',
    originalTitle: item.original_title || item.original_name || '',

    // --- poster (IMPORTANT for frontend) ---
    poster_path: item.poster_path || null,
    backdrop_path: item.backdrop_path || null,

    release_date: releaseDate || null,
    release_year: releaseYear  ?? null,

    originalLanguage: item.original_language || null,
    originCountry: item.origin_country || [],

    voteCount: item.vote_count || 0,
    voteAverage: item.vote_average || 0,
    popularity: item.popularity || 0
  };
}


module.exports = {
  INDIAN_LANGS,
  normalize,
  computeFinalScore
};
