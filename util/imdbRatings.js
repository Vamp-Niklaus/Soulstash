const { getDb } = require('../db');

const fetch = global.fetch;
const TMDB_BEARER_TOKEN = process.env.TMDB_BEARER_TOKEN;
const TMDB_BASE_URL = (process.env.TMDB_BASE_URL || 'https://api.tmdb.org').replace('api.themoviedb.org', 'api.tmdb.org');
const OMDB_API_KEY = process.env.OMDB_API_KEY || '';
const INVALID_IMDB_SENTINEL = 10.0;
const RATINGS_COLLECTION = 'Ratings';
const METRICS_COLLECTION = 'AppMetrics';
const RATINGS_METRICS_DOC_ID = 'ratings_api_counters';
const TAG = '[Ratings]';

function normalizeMediaType(mediaType) {
  const normalized = String(mediaType || '').trim().toLowerCase();
  if (['series', 'tv', 'show'].includes(normalized)) return 'Series';
  return 'Movie';
}

function validImdbRating(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  if (parsed === INVALID_IMDB_SENTINEL) return null;
  return parsed;
}

function validVoteAverage(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function buildTmdbHeaders() {
  return {
    accept: 'application/json',
    Authorization: `Bearer ${String(process.env.TMDB_BEARER_TOKEN || TMDB_BEARER_TOKEN || '').trim()}`
  };
}

async function incrementRatingsMetric(fieldName) {
  try {
    await getDb().collection(METRICS_COLLECTION).updateOne(
      { _id: RATINGS_METRICS_DOC_ID },
      {
        $inc: { [fieldName]: 1 },
        $set: { updatedAt: new Date() },
        $setOnInsert: {
          createdAt: new Date()
        }
      },
      { upsert: true }
    );
  } catch (error) {
    console.warn(`${TAG} metrics update failed field=${fieldName}: ${error.message}`);
  }
}

async function fetchTmdbJson(url, context) {
  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: buildTmdbHeaders()
      });

      if (!response.ok) {
        console.error(`${TAG} fetchTmdbJson ERROR: ${context} failed with ${response.status} on attempt ${attempt}`);
        if (response.status === 404) return null; // If TMDB returns 404, just return null
        if (attempt === maxRetries) throw new Error(`${context} failed with ${response.status}`);
        await new Promise(r => setTimeout(r, 1000 * attempt));
        continue;
      }

      return await response.json();
    } catch (err) {
      console.warn(`${TAG} fetchTmdbJson network error: ${context} attempt ${attempt} threw ${err.message}`);
      if (attempt === maxRetries) {
        throw err;
      }
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
}

async function fetchTmdbDetail(tmdbID, mediaType) {
  const normalizedMediaType = normalizeMediaType(mediaType);
  await incrementRatingsMetric('tmdbDetailFetchCount');

  try {
    if (normalizedMediaType === 'Movie') {
      const payload = await fetchTmdbJson(
        `${TMDB_BASE_URL}/3/movie/${tmdbID}?language=en-US`,
        `TMDB movie detail ${tmdbID}`
      );
      return {
        imdb_id: String(payload?.imdb_id || '').trim(),
        vote_average: validVoteAverage(payload?.vote_average)
      };
    }

    const [detail, extIds] = await Promise.all([
      fetchTmdbJson(
        `${TMDB_BASE_URL}/3/tv/${tmdbID}?language=en-US`,
        `TMDB tv detail ${tmdbID}`
      ).catch(() => null),
      fetchTmdbJson(
        `${TMDB_BASE_URL}/3/tv/${tmdbID}/external_ids?language=en-US`,
        `TMDB tv external ids ${tmdbID}`
      ).catch(() => null)
    ]);

    return {
      imdb_id: String(extIds?.imdb_id || '').trim(),
      vote_average: validVoteAverage(detail?.vote_average)
    };
  } catch {
    return { imdb_id: '', vote_average: null };
  }
}

async function fetchOmdbRating(imdbID) {
  if (!OMDB_API_KEY) {
    console.warn(`${TAG} OMDb skipped imdbID="${imdbID}" reason=no-api-key`);
    return { imdb_rating: null, payload: null };
  }

  await incrementRatingsMetric('omdbFetchCount');
  console.log(`${TAG} OMDb fetch START imdbID="${imdbID}"`);

  const response = await fetch(
    `https://www.omdbapi.com/?i=${encodeURIComponent(imdbID)}&apikey=${encodeURIComponent(OMDB_API_KEY)}`,
    { method: 'GET', headers: { accept: 'application/json' } }
  );

  if (!response.ok) {
    throw new Error(`OMDb request failed with ${response.status}`);
  }

  const payload = await response.json();
  if (payload?.Response !== 'True') {
    console.warn(`${TAG} OMDb fetch MISS imdbID="${imdbID}" response=${payload?.Response || 'False'}`);
    return { imdb_rating: null, payload };
  }

  const rating = validImdbRating(payload?.imdbRating);
  console.log(`${TAG} OMDb fetch DONE imdbID="${imdbID}" raw="${payload?.imdbRating}" parsed=${rating}`);
  return { imdb_rating: rating, payload };
}

async function resolveImdbRating(tmdbID, mediaType, seedData = null, seedVoteAverage = null) {
  const normalizedMediaType = normalizeMediaType(mediaType);
  const numericTmdbID = Number(tmdbID);

  if (!numericTmdbID) {
    return {
      tmdbID: numericTmdbID,
      type: normalizedMediaType,
      mediaType: normalizedMediaType,
      imdbID: '',
      imdb_rating: null,
      vote_average: null,
      lookup_attempted: false,
      source: 'invalid-tmdb-id'
    };
  }

  const ratingsCol = getDb().collection(RATINGS_COLLECTION);
  const cachedRecord = await ratingsCol.findOne({
    tmdbID: numericTmdbID,
    mediaType: normalizedMediaType
  });

  if (cachedRecord) {
    const hasValidImdbId = typeof cachedRecord.imdbID === 'string' && cachedRecord.imdbID.trim() !== '';
    const cacheAgeMs = cachedRecord.updatedAt ? Date.now() - cachedRecord.updatedAt.getTime() : Infinity;
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

    // Use cache only if we have a valid ID. Do not cache missing/empty IDs to avoid permanent 404s
    if (hasValidImdbId) {
      return {
        tmdbID: numericTmdbID,
        type: normalizedMediaType,
        mediaType: normalizedMediaType,
        imdbID: cachedRecord.imdbID ? cachedRecord.imdbID.trim() : '',
        imdb_rating: validImdbRating(cachedRecord.imdb_rating),
        vote_average: validVoteAverage(cachedRecord.vote_average),
        lookup_attempted: true,
        source: 'cache'
      };
    }
  }

  let imdbID = '';
  let tmdbVoteAverage = validVoteAverage(seedVoteAverage) ?? validVoteAverage(seedData?.vote_average);

  if (typeof seedData?.imdb_id === 'string' && seedData.imdb_id.trim()) {
    imdbID = seedData.imdb_id.trim();
  } else {
    const tmdbDetail = await fetchTmdbDetail(numericTmdbID, normalizedMediaType);
    imdbID = tmdbDetail.imdb_id;
    if (tmdbVoteAverage == null) {
      tmdbVoteAverage = tmdbDetail.vote_average;
    }
  }

  if (!imdbID) {
    await ratingsCol.updateOne(
      { tmdbID: numericTmdbID, mediaType: normalizedMediaType },
      {
        $set: {
          imdbID: '',
          tmdbID: numericTmdbID,
          type: normalizedMediaType,
          mediaType: normalizedMediaType,
          imdb_rating: INVALID_IMDB_SENTINEL,
          vote_average: tmdbVoteAverage ?? null,
          updatedAt: new Date()
        }
      },
      { upsert: true }
    );

    return {
      tmdbID: numericTmdbID,
      type: normalizedMediaType,
      mediaType: normalizedMediaType,
      imdbID: '',
      imdb_rating: null,
      vote_average: tmdbVoteAverage,
      lookup_attempted: true,
      source: 'missing-imdb-id'
    };
  }

  let omdbResult = { imdb_rating: null };
  try {
    omdbResult = await fetchOmdbRating(imdbID);
  } catch (error) {
    console.warn(`${TAG} OMDb fetch ERROR imdbID="${imdbID}" tmdbID=${numericTmdbID}: ${error.message}`);
  }

  const ratingToStore = omdbResult.imdb_rating ?? INVALID_IMDB_SENTINEL;

  await ratingsCol.updateOne(
    { tmdbID: numericTmdbID, mediaType: normalizedMediaType },
    {
      $set: {
        imdbID,
        tmdbID: numericTmdbID,
        type: normalizedMediaType,
        mediaType: normalizedMediaType,
        imdb_rating: ratingToStore,
        vote_average: tmdbVoteAverage ?? null,
        updatedAt: new Date()
      }
    },
    { upsert: true }
  );

  return {
    tmdbID: numericTmdbID,
    type: normalizedMediaType,
    mediaType: normalizedMediaType,
    imdbID,
    imdb_rating: omdbResult.imdb_rating,
    vote_average: tmdbVoteAverage,
    lookup_attempted: true,
    source: omdbResult.imdb_rating == null ? 'omdb-invalid' : 'omdb'
  };
}

module.exports = {
  INVALID_IMDB_SENTINEL,
  METRICS_COLLECTION,
  RATINGS_COLLECTION,
  RATINGS_METRICS_DOC_ID,
  normalizeMediaType,
  validImdbRating,
  validVoteAverage,
  resolveImdbRating
};
