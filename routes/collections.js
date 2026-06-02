const router = require('express').Router();
const { ObjectId } = require('mongodb');
const { getDb } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { resolveImdbRating, validImdbRating, validVoteAverage } = require('../util/imdbRatings');

const fetch = global.fetch;
const TMDB_BEARER_TOKEN = process.env.TMDB_BEARER_TOKEN;
const TMDB_BASE_URL = process.env.TMDB_BASE_URL || 'https://api.tmdb.org';
const COLLECTION_NAME_MAX_LENGTH = 25;
const DEFAULT_COLLECTION_NAMES = ['Watched', 'Watchlist'];
const PUBLISH_MIN_COLLECTION_TITLES = 6;

// ── Anime detection helper ────────────────────────────────────────────────────
function isAnimeContent(item) {
  const hasAnimation = item.genres && item.genres.some(g => (typeof g === 'string' ? g : g.name) === 'Animation');
  if (!hasAnimation) return false;
  const asianCountries = ['JP', 'CN', 'KR'];
  const asianLangs = ['ja', 'zh', 'ko'];
  const isAsianCountry = item.origin_country && (
    (Array.isArray(item.origin_country) && item.origin_country.some(c => asianCountries.includes(c))) ||
    (typeof item.origin_country === 'string' && asianCountries.includes(item.origin_country))
  );
  return asianLangs.includes(item.original_language) && isAsianCountry;
}

// ── Map collection to safe response shape ────────────────────────────────────
function mapCollection(col) {
  return {
    _id: col._id || col.name,
    name: col.name,
    isDeletable: col.isDeletable,
    isPublic: col.isPublic === true,
    isPublished: col.isPublished === true,
    description: col.description || '',
    banner: col.banner || 'https://cdn.imgchest.com/files/b23d0bfcaa8b.jpg',
    movieCount: col.movies ? col.movies.length : 0,
    movies: col.movies || [],
    createdAt: col.createdAt,
    updatedAt: col.updatedAt
  };
}

function getClientCollectionVersion(req) {
  const raw = req.headers['x-collection-version'];
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeUserCollectionVersion(user) {
  return Number.isFinite(Number(user?.collectionVersion)) ? Number(user.collectionVersion) : 0;
}

async function loadUserWithCollections(userId) {
  return getDb().collection('users').findOne({ _id: new ObjectId(userId) });
}

async function snapshotCollections(userId) {
  const freshUser = await getDb().collection('users').findOne(
    { _id: new ObjectId(userId) },
    { projection: { collections: 1, collectionVersion: 1 } }
  );

  return {
    collections: (freshUser?.collections || []).map(mapCollection),
    collectionVersion: normalizeUserCollectionVersion(freshUser)
  };
}

function setCollectionVersionHeaders(res, collectionVersion, stale = false) {
  res.setHeader('X-Collection-Version', String(collectionVersion));
  if (stale) {
    res.setHeader('X-Collection-Stale', 'true');
  }
}

function buildMutationResponse({ message, snapshot, stale, extra = {} }) {
  return {
    message,
    ...extra,
    collectionVersion: snapshot.collectionVersion,
    staleResolved: stale,
    collections: snapshot.collections
  };
}

// GET /api/user/collections
router.get('/user/collections', authenticateToken, async (req, res) => {
  try {
    const clientVersion = getClientCollectionVersion(req);
    const user = await getDb().collection('users').findOne(
      { _id: new ObjectId(req.user.userId) },
      { projection: { collections: 1, collectionVersion: 1 } }
    );
    if (!user) return res.status(404).json({ error: 'User not found' });
    const collections = Array.isArray(user.collections) ? user.collections : [];
    const migrated = collections.map((col) => ({
      ...col,
      isPublished: col.isPublished === true
    }));
    const currentVersion = normalizeUserCollectionVersion(user);
    setCollectionVersionHeaders(res, currentVersion);
    if (clientVersion !== null && clientVersion === currentVersion) {
      return res.status(304).end();
    }
    res.json(migrated.map(mapCollection));
  } catch (err) {
    console.error('Error fetching collections:', err);
    res.status(500).json({ error: 'Failed to fetch collections' });
  }
});

// POST /api/user/collections
router.post('/user/collections', authenticateToken, async (req, res) => {
  try {
    const clientVersion = getClientCollectionVersion(req);
    const { name, isPublic, description } = req.body;
    if (!name) return res.status(400).json({ error: 'Collection name is required' });
    if (name.length < 1 || name.length > COLLECTION_NAME_MAX_LENGTH)
      return res.status(400).json({ error: `Collection name must be between 1 and ${COLLECTION_NAME_MAX_LENGTH} characters` });

    const user = await loadUserWithCollections(req.user.userId);
    if (user.collections?.find(c => c.name.toLowerCase() === name.toLowerCase()))
      return res.status(409).json({ error: 'Collection with this name already exists' });

    const newCol = {
      name, description: description || '', isDeletable: true,
      isPublic: isPublic === true,
      isPublished: false,
      banner: 'https://cdn.imgchest.com/files/b23d0bfcaa8b.jpg',
      movieCount: 0, movies: [], createdAt: new Date(), updatedAt: new Date()
    };
    await getDb().collection('users').updateOne(
      { _id: new ObjectId(req.user.userId) },
      { $push: { collections: newCol }, $set: { updatedAt: new Date() }, $inc: { collectionVersion: 1 } }
    );
    const snapshot = await snapshotCollections(req.user.userId);
    const stale = clientVersion !== null && clientVersion !== normalizeUserCollectionVersion(user);
    setCollectionVersionHeaders(res, snapshot.collectionVersion, stale);
    res.status(201).json(buildMutationResponse({
      message: `Collection "${name}" created successfully!`,
      snapshot,
      stale,
      extra: { ...newCol, _id: name }
    }));
  } catch (err) {
    console.error('Error creating collection:', err);
    res.status(500).json({ error: 'Failed to create collection' });
  }
});

// PUT /api/user/collections/:id
router.put('/user/collections/:id', authenticateToken, async (req, res) => {
  try {
    const clientVersion = getClientCollectionVersion(req);
    const collectionId = req.params.id;
    const { name, isPublic, description } = req.body;
    if (!name) return res.status(400).json({ error: 'Collection name is required' });
    if (name.length < 1 || name.length > COLLECTION_NAME_MAX_LENGTH)
      return res.status(400).json({ error: `Collection name must be between 1 and ${COLLECTION_NAME_MAX_LENGTH} characters` });

    const user = await loadUserWithCollections(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const colIdx = user.collections.findIndex(c => (c._id || c.name) === collectionId);
    if (colIdx === -1) return res.status(404).json({ error: 'Collection not found' });
    const col = user.collections[colIdx];
    const isDefaultCollection = DEFAULT_COLLECTION_NAMES.includes(col.name);
    if (isDefaultCollection && name !== col.name) {
      return res.status(400).json({ error: 'Default collection names cannot be changed' });
    }
    if (col.isPublished === true && isPublic === false) {
      return res.status(400).json({ error: 'Unpublish this collection before making it private' });
    }

    if (name !== col.name && user.collections.find(c => c.name.toLowerCase() === name.toLowerCase() && (c._id || c.name) !== collectionId))
      return res.status(409).json({ error: 'Collection with this name already exists' });

    const setData = {
      'collections.$.name': isDefaultCollection ? col.name : name,
      'collections.$.isPublic': isPublic !== undefined ? isPublic : col.isPublic,
      'collections.$.description': description !== undefined ? description : col.description,
      'collections.$.updatedAt': new Date()
    };

    // Try by _id first, then by name
    let result = await getDb().collection('users').updateOne(
      { _id: new ObjectId(req.user.userId), 'collections._id': collectionId },
      { $set: setData, $inc: { collectionVersion: 1 } }
    );
    if (result.modifiedCount === 0) {
      result = await getDb().collection('users').updateOne(
        { _id: new ObjectId(req.user.userId), 'collections.name': col.name },
        { $set: setData, $inc: { collectionVersion: 1 } }
      );
    }
    if (result.modifiedCount === 0)
      return res.status(500).json({ error: 'Failed to update collection in database' });

    const snapshot = await snapshotCollections(req.user.userId);
    const stale = clientVersion !== null && clientVersion !== normalizeUserCollectionVersion(user);
    setCollectionVersionHeaders(res, snapshot.collectionVersion, stale);
    res.json(buildMutationResponse({
      message: `Collection "${setData['collections.$.name']}" updated successfully!`,
      snapshot,
      stale,
      extra: { ...col, _id: col._id || col.name, name: setData['collections.$.name'], isPublic: setData['collections.$.isPublic'], description: setData['collections.$.description'], updatedAt: new Date() }
    }));
  } catch (err) {
    console.error('Error updating collection:', err);
    res.status(500).json({ error: 'Failed to update collection' });
  }
});

router.post('/user/collections/:id/enrich-metadata', authenticateToken, async (req, res) => {
  try {
    const clientVersion = getClientCollectionVersion(req);
    const collectionId = req.params.id;
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return res.status(400).json({ error: 'Items are required' });

    console.log(`[Collections/enrich-metadata] START collection="${collectionId}" itemCount=${items.length}`);
    items.forEach((item) => {
      console.log(`[Collections/enrich-metadata]   item contentId=${item.contentId} mediaType=${item.mediaType} title="${item.title}" vote_average=${item.vote_average} imdb_rating=${item.imdb_rating}`);
    });

    const user = await loadUserWithCollections(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const colIdx = user.collections.findIndex(c => (c._id || c.name) === collectionId);
    if (colIdx === -1) return res.status(404).json({ error: 'Collection not found' });

    const enrichMap = new Map(
      items.map((item) => [
        `${String(item.mediaType || 'Movie').toLowerCase()}:${parseInt(item.contentId)}`,
        item
      ])
    );

    const updateObj = { updatedAt: new Date(), [`collections.${colIdx}.updatedAt`]: new Date() };
    const movies = user.collections[colIdx].movies || [];
    let updatedAny = false;

    movies.forEach((movie, mIdx) => {
      const isSeries = movie.media_type === 'Series' || movie.media_type === 'tv' || !!movie.seriesId;
      const contentId = parseInt(movie.movieId || movie.seriesId || movie.id || 0);
      const match = enrichMap.get(`${isSeries ? 'series' : 'movie'}:${contentId}`);
      if (!match) return;

      const next_vote_average = validVoteAverage(match.vote_average) ?? validVoteAverage(movie.vote_average) ?? null;
      const next_imdb_rating = validImdbRating(match.imdb_rating) ?? validImdbRating(movie.imdb_rating) ?? null;
      
      const prefix = `collections.${colIdx}.movies.${mIdx}`;
      updateObj[`${prefix}.vote_average`] = next_vote_average;
      updateObj[`${prefix}.imdb_rating`] = next_imdb_rating;
      updateObj[`${prefix}.imdb_id`] = match.imdb_id || movie.imdb_id || '';
      updateObj[`${prefix}.rating_lookup_attempted`] = match.rating_lookup_attempted === true || movie.rating_lookup_attempted === true;
      if (match.title) updateObj[`${prefix}.title`] = match.title;
      if (match.poster_path) updateObj[`${prefix}.poster_path`] = match.poster_path;
      
      updatedAny = true;
    });

    if (updatedAny) {
      await getDb().collection('users').updateOne(
        { _id: new ObjectId(req.user.userId) },
        { $set: updateObj, $inc: { collectionVersion: 1 } }
      );
    }

    console.log(`[Collections/enrich-metadata] DONE collection="${collectionId}" DB updated`);

    const snapshot = await snapshotCollections(req.user.userId);
    const stale = clientVersion !== null && clientVersion !== normalizeUserCollectionVersion(user);
    setCollectionVersionHeaders(res, snapshot.collectionVersion, stale);
    res.json(buildMutationResponse({
      message: 'Collection metadata updated',
      snapshot,
      stale
    }));
  } catch (err) {
    console.error('Error enriching collection metadata:', err);
    res.status(500).json({ error: 'Failed to enrich collection metadata' });
  }
});

// POST /api/user/collections/:id/publish
router.post('/user/collections/:id/publish', authenticateToken, async (req, res) => {
  try {
    const clientVersion = getClientCollectionVersion(req);
    const collectionId = req.params.id;
    const publish = req.body?.publish === true;
    const user = await loadUserWithCollections(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const colIdx = user.collections.findIndex(c => (c._id || c.name) === collectionId);
    if (colIdx === -1) return res.status(404).json({ error: 'Collection not found' });
    const col = user.collections[colIdx];
    const movieCount = Array.isArray(col.movies) ? col.movies.length : 0;

    if (DEFAULT_COLLECTION_NAMES.includes(col.name)) {
      return res.status(400).json({ error: 'Default collections cannot be published' });
    }

    if (publish && movieCount < PUBLISH_MIN_COLLECTION_TITLES) {
      return res.status(400).json({ error: `At least ${PUBLISH_MIN_COLLECTION_TITLES} titles are required to publish this collection` });
    }

    const nextPublished = publish;
    const setData = {
      'collections.$.isPublished': nextPublished,
      'collections.$.isPublic': nextPublished ? true : false,
      'collections.$.updatedAt': new Date()
    };

    let result = await getDb().collection('users').updateOne(
      { _id: new ObjectId(req.user.userId), 'collections._id': collectionId },
      { $set: setData, $inc: { collectionVersion: 1 } }
    );
    if (result.modifiedCount === 0) {
      result = await getDb().collection('users').updateOne(
        { _id: new ObjectId(req.user.userId), 'collections.name': col.name },
        { $set: setData, $inc: { collectionVersion: 1 } }
      );
    }
    if (result.modifiedCount === 0) {
      return res.status(500).json({ error: 'Failed to update collection in database' });
    }

    const snapshot = await snapshotCollections(req.user.userId);
    const stale = clientVersion !== null && clientVersion !== normalizeUserCollectionVersion(user);
    setCollectionVersionHeaders(res, snapshot.collectionVersion, stale);
    res.json(buildMutationResponse({
      message: nextPublished ? 'Collection published' : 'Collection unpublished',
      snapshot,
      stale,
      extra: { ...col, _id: col._id || col.name, isPublished: nextPublished }
    }));
  } catch (err) {
    console.error('Publish collection error:', err);
    res.status(500).json({ error: 'Failed to publish collection' });
  }
});

// POST /api/user/collections/reorder
router.post('/user/collections/reorder', authenticateToken, async (req, res) => {
  try {
    const clientVersion = getClientCollectionVersion(req);
    const { order } = req.body;
    if (!Array.isArray(order) || !order.length) {
      return res.status(400).json({ error: 'Collection order is required' });
    }

    const user = await loadUserWithCollections(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const currentCollections = Array.isArray(user.collections) ? [...user.collections] : [];
    const byKey = new Map();
    currentCollections.forEach((collection) => {
      byKey.set(String(collection._id || collection.name), collection);
      byKey.set(String(collection.name), collection);
    });

    const reordered = [];
    const seen = new Set();

    order.forEach((item) => {
      const key = String(item);
      const collection = byKey.get(key);
      if (collection && !seen.has(collection.name)) {
        reordered.push(collection);
        seen.add(collection.name);
      }
    });

    currentCollections.forEach((collection) => {
      if (!seen.has(collection.name)) {
        reordered.push(collection);
      }
    });

    await getDb().collection('users').updateOne(
      { _id: new ObjectId(req.user.userId) },
      { $set: { collections: reordered, updatedAt: new Date() }, $inc: { collectionVersion: 1 } }
    );

    const snapshot = await snapshotCollections(req.user.userId);
    const stale = clientVersion !== null && clientVersion !== normalizeUserCollectionVersion(user);
    setCollectionVersionHeaders(res, snapshot.collectionVersion, stale);
    res.json(buildMutationResponse({
      message: 'Collection order updated',
      snapshot,
      stale
    }));
  } catch (err) {
    console.error('Error reordering collections:', err);
    res.status(500).json({ error: 'Failed to reorder collections' });
  }
});

// DELETE /api/user/collections/:id
router.delete('/user/collections/:id', authenticateToken, async (req, res) => {
  try {
    const clientVersion = getClientCollectionVersion(req);
    const collectionId = req.params.id;
    const user = await loadUserWithCollections(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const col = user.collections.find(c => (c._id || c.name) === collectionId);
    if (!col) return res.status(404).json({ error: 'Collection not found' });
    if (['Watched', 'Watchlist'].includes(col.name))
      return res.status(403).json({ error: 'Cannot delete default collections' });

    await getDb().collection('users').updateOne(
      { _id: new ObjectId(req.user.userId) },
      { $pull: { collections: { name: col.name } }, $set: { updatedAt: new Date() }, $inc: { collectionVersion: 1 } }
    );
    const snapshot = await snapshotCollections(req.user.userId);
    const stale = clientVersion !== null && clientVersion !== normalizeUserCollectionVersion(user);
    setCollectionVersionHeaders(res, snapshot.collectionVersion, stale);
    res.json(buildMutationResponse({
      message: `Collection "${col.name}" deleted successfully!`,
      snapshot,
      stale
    }));
  } catch (err) {
    console.error('Error deleting collection:', err);
    res.status(500).json({ error: 'Failed to delete collection' });
  }
});

// POST /api/user/collections/:id/add
router.post('/user/collections/:id/add', authenticateToken, async (req, res) => {
  try {
    const clientVersion = getClientCollectionVersion(req);
    const collectionId = req.params.id;
    const { movieId, seriesId, title, poster_path, release_date, media_type } = req.body;
    if (!movieId && !seriesId)
      return res.status(400).json({ error: 'Movie ID or Series ID is required' });

    const contentId = movieId || seriesId;
    const contentType = media_type || (seriesId ? 'Series' : 'Movie');

    const users = getDb().collection('users');
    const user = await users.findOne({ _id: new ObjectId(req.user.userId) });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const colIdx = user.collections.findIndex(c => (c._id || c.name) === collectionId);
    if (colIdx === -1) return res.status(404).json({ error: 'Collection not found' });
    const col = user.collections[colIdx];

    const alreadyIn = col.movies?.find(m => m.movieId === parseInt(contentId) || m.seriesId === parseInt(contentId));
    if (alreadyIn) return res.status(409).json({ error: 'Content already in collection' });

    // Handle Watched <-> Watchlist mutual exclusion
    if (collectionId === 'Watchlist' || collectionId === 'Watched') {
      const opposite = collectionId === 'Watchlist' ? 'Watched' : 'Watchlist';
      const oppCol = user.collections.find(c => (c._id || c.name) === opposite);
      if (oppCol?.movies?.find(m => m.movieId === parseInt(contentId) || m.seriesId === parseInt(contentId))) {
        // Try $pull first
        const pullResult = await users.updateOne(
          { _id: new ObjectId(req.user.userId), 'collections.name': opposite },
          { $pull: { 'collections.$.movies': { movieId: parseInt(contentId), seriesId: parseInt(contentId) } } }
        );
        // Fallback: fetch + filter
        if (pullResult.modifiedCount === 0) {
          const fresh = await users.findOne({ _id: new ObjectId(req.user.userId) });
          const freshOpp = fresh.collections.find(c => (c.name || c._id) === opposite);
          if (freshOpp) {
            await users.updateOne(
              { _id: new ObjectId(req.user.userId), 'collections.name': opposite },
              { $set: { 'collections.$.movies': freshOpp.movies.filter(m => m.movieId !== parseInt(contentId) && m.seriesId !== parseInt(contentId)) } }
            );
          }
        }
      }
    }

    // Anime detection + rating resolution
    console.log(`[Collections/add] START contentId=${contentId} contentType=${contentType} collection="${collectionId}"`);
    let isAnime = false;
    let vote_average = null;
    let imdb_rating = null;
    let imdb_id = '';
    let resolvedPosterPath = poster_path || '';
    let resolvedReleaseDate = release_date || new Date().toISOString().split('T')[0];
    let resolvedTitle = title || `${contentType} ${contentId}`;
    try {
      const tmdbUrl = contentType === 'Series'
        ? `${TMDB_BASE_URL}/3/tv/${contentId}?language=en-US`
        : `${TMDB_BASE_URL}/3/movie/${contentId}?language=en-US`;
      console.log(`[Collections/add] fetching TMDB detail url=${tmdbUrl}`);
      const resp = await fetch(tmdbUrl, { method: 'GET', headers: { accept: 'application/json', Authorization: `Bearer ${TMDB_BEARER_TOKEN}` } });
      console.log(`[Collections/add] TMDB detail response status=${resp.status} contentId=${contentId}`);
      if (resp.ok) {
        const details = await resp.json();
        isAnime = isAnimeContent({ genres: details.genres, original_language: details.original_language, origin_country: details.origin_country || details.production_countries });
        vote_average = validVoteAverage(details.vote_average);
        imdb_id = String(details.imdb_id || '').trim();
        resolvedPosterPath = details.poster_path || resolvedPosterPath;
        resolvedReleaseDate = details.release_date || details.first_air_date || resolvedReleaseDate;
        resolvedTitle = details.title || details.name || resolvedTitle;
        console.log(`[Collections/add] TMDB detail parsed title="${resolvedTitle}" vote_average=${vote_average} imdb_id="${imdb_id}" isAnime=${isAnime}`);
        // Pass vote_average as seedVoteAverage — avoids an extra TMDB call inside resolveImdbRating
        console.log(`[Collections/add] calling resolveImdbRating contentId=${contentId} contentType=${contentType}`);
        const imdbResult = await resolveImdbRating(contentId, contentType, details, vote_average).catch((err) => {
          console.warn(`[Collections/add] resolveImdbRating failed contentId=${contentId}:`, err.message);
          return null;
        });
        imdb_id = imdbResult?.imdbID || imdb_id;
        imdb_rating = validImdbRating(imdbResult?.imdb_rating);
        // Use vote_average from Ratings if we already got it there, else keep TMDB value
        if (imdbResult?.vote_average != null && vote_average == null) {
          vote_average = validVoteAverage(imdbResult.vote_average);
        }
        console.log(`[Collections/add] rating resolved imdb_id="${imdb_id}" imdb_rating=${imdb_rating} vote_average=${vote_average} source=${imdbResult?.source}`);
        await getDb().collection('details').updateOne(
          { id: parseInt(contentId) },
          { $set: { ...details, id: parseInt(contentId), updatedAt: new Date() } },
          { upsert: true }
        );
      } else {
        console.warn(`[Collections/add] TMDB detail non-ok status=${resp.status} contentId=${contentId} — skipping rating resolution`);
      }
    } catch (e) {
      console.error(`[Collections/add] TMDB/rating fetch error contentId=${contentId}:`, e.message);
    }

    console.log(`[Collections/add] saving contentData title="${resolvedTitle}" vote_average=${vote_average} imdb_rating=${imdb_rating} imdb_id="${imdb_id}"`);
    const contentData = contentType === 'Series'
      ? { seriesId: parseInt(contentId), title: resolvedTitle, poster_path: resolvedPosterPath, release_date: resolvedReleaseDate, media_type: 'Series', isAnime, vote_average, imdb_id, imdb_rating, addedAt: new Date() }
      : { movieId: parseInt(contentId), title: resolvedTitle, poster_path: resolvedPosterPath, release_date: resolvedReleaseDate, media_type: 'Movie', isAnime, vote_average, imdb_id, imdb_rating, addedAt: new Date() };

    const updateResult = await users.updateOne(
      { _id: new ObjectId(req.user.userId), 'collections.name': col.name },
      { $push: { 'collections.$.movies': contentData }, $set: { updatedAt: new Date(), 'collections.$.updatedAt': new Date() }, $inc: { collectionVersion: 1 } }
    );
    if (updateResult.modifiedCount === 0)
      return res.status(500).json({ error: 'Failed to update collection' });

    const snapshot = await snapshotCollections(req.user.userId);
    const stale = clientVersion !== null && clientVersion !== normalizeUserCollectionVersion(user);
    setCollectionVersionHeaders(res, snapshot.collectionVersion, stale);
    res.json(buildMutationResponse({
      message: `Added "${contentData.title}" to Collection!`,
      snapshot,
      stale,
      extra: { isAnime }
    }));
  } catch (err) {
    console.error('Error adding to collection:', err);
    res.status(500).json({ error: 'Failed to add content to collection' });
  }
});

// POST /api/user/collections/:id/remove
router.post('/user/collections/:id/remove', authenticateToken, async (req, res) => {
  try {
    const clientVersion = getClientCollectionVersion(req);
    const collectionId = req.params.id;
    const { movieId, seriesId } = req.body;

    const user = await loadUserWithCollections(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const colIdx = user.collections.findIndex(c => (c._id || c.name) === collectionId);
    if (colIdx === -1) return res.status(404).json({ error: 'Collection not found' });

    if (!movieId && !seriesId)
      return res.status(400).json({ error: 'Either movieId or seriesId is required' });

    const col = user.collections[colIdx];
    const pullCondition = movieId ? { movieId: parseInt(movieId) } : { seriesId: parseInt(seriesId) };

    await getDb().collection('users').updateOne(
      { _id: new ObjectId(req.user.userId), 'collections.name': col.name },
      { $pull: { 'collections.$.movies': pullCondition }, $set: { 'collections.$.updatedAt': new Date(), updatedAt: new Date() }, $inc: { collectionVersion: 1 } }
    );
    const snapshot = await snapshotCollections(req.user.userId);
    const stale = clientVersion !== null && clientVersion !== normalizeUserCollectionVersion(user);
    setCollectionVersionHeaders(res, snapshot.collectionVersion, stale);
    res.json(buildMutationResponse({
      message: 'Removed from Collection!',
      snapshot,
      stale
    }));
  } catch (err) {
    console.error('Error removing from collection:', err);
    res.status(500).json({ error: 'Failed to remove content from collection' });
  }
});

// GET /api/user/collections/:id/movies (legacy endpoint)
router.get('/user/collections/:id/movies', authenticateToken, async (req, res) => {
  try {
    const collectionId = req.params.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    const user = await getDb().collection('users').findOne({ _id: new ObjectId(req.user.userId) });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const col = user.collections.find(c => (c._id || c.name) === collectionId);
    if (!col) return res.status(404).json({ error: 'Collection not found' });

    const all = col.movies || [];
    const total = all.length;
    const paged = all.slice((page - 1) * limit, page * limit);
    res.json({ movies: paged, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err) {
    console.error('Error fetching collection movies:', err);
    res.status(500).json({ error: 'Failed to fetch collection movies' });
  }
});

// POST /api/content/anime-detection
router.post('/content/anime-detection', authenticateToken, async (req, res) => {
  try {
    const { contentIds } = req.body;
    if (!contentIds || !Array.isArray(contentIds))
      return res.status(400).json({ error: 'Content IDs array is required' });

    const details = await getDb().collection('details').find({
      $or: [
        { id: { $in: contentIds.map(Number) } },
        { _id: { $in: contentIds.map(Number) } }
      ]
    }).toArray();

    const result = {};
    details.forEach(item => {
      const id = item.id || item._id;
      result[id.toString()] = {
        id, title: item.title || item.original_title,
        genres: item.genres, original_language: item.original_language,
        origin_country: item.origin_country, media_type: item.media_type || 'Movie',
        isAnime: isAnimeContent(item)
      };
    });
    res.json(result);
  } catch (err) {
    console.error('Error fetching anime detection data:', err);
    res.status(500).json({ error: 'Failed to fetch anime detection data' });
  }
});

// GET /api/user/profile/:username (public profile API)
router.get('/user/profile/:username', async (req, res) => {
  try {
    const { username } = req.params;
    let loggedInUser = null;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(authHeader.substring(7), process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production');
        loggedInUser = await getDb().collection('users').findOne({ _id: new ObjectId(decoded.userId) }, { projection: { password: 0 } });
      } catch {}
    }
    const profileUser = await getDb().collection('users').findOne({ username }, { projection: { password: 0 } });
    if (!profileUser) return res.status(404).json({ error: 'User not found' });

    const isOwner = loggedInUser?.username === username;
    const followers = Array.isArray(profileUser.followers) ? profileUser.followers : [];
    const following = Array.isArray(profileUser.following) ? profileUser.following : [];
    const loggedInFollowing = Array.isArray(loggedInUser?.following) ? loggedInUser.following : [];
    const loggedInFollowers = Array.isArray(loggedInUser?.followers) ? loggedInUser.followers : [];
    const isFollowing = !!loggedInUser && loggedInFollowing.includes(profileUser.username);
    const isFollowedBy = !!loggedInUser && loggedInFollowers.includes(profileUser.username);
    const userData = isOwner ? profileUser : {
      _id: profileUser._id, username: profileUser.username,
      firstName: profileUser.firstName, lastName: profileUser.lastName,
      bio: profileUser.bio, avatar: profileUser.avatar, createdAt: profileUser.createdAt,
      followersCount: followers.length,
      followingCount: following.length,
      collections: (profileUser.collections || []).filter(c => c.isPublic === true || c.isPublished === true)
    };
    if (isOwner) {
      userData.followersCount = followers.length;
      userData.followingCount = following.length;
    }
    res.json({ user: userData, isOwner, accessLevel: isOwner ? 'owner' : 'public', isFollowing, isFollowedBy });
  } catch (err) {
    console.error('Profile API error:', err);
    res.status(500).json({ error: 'Failed to fetch profile data' });
  }
});

// POST /api/user/follow
router.post('/user/follow', authenticateToken, async (req, res) => {
  try {
    const { username } = req.body || {};
    if (!username) return res.status(400).json({ error: 'Username is required' });

    const userId = new ObjectId(req.user.userId);
    const targetUser = await getDb().collection('users').findOne({ username }, { projection: { username: 1 } });
    if (!targetUser) return res.status(404).json({ error: 'User not found' });
    const currentUser = await getDb().collection('users').findOne({ _id: userId }, { projection: { username: 1 } });
    if (!currentUser) return res.status(404).json({ error: 'User not found' });
    if (currentUser.username === username) return res.status(400).json({ error: 'Cannot follow yourself' });

    await getDb().collection('users').updateOne(
      { _id: userId },
      { $addToSet: { following: username }, $set: { updatedAt: new Date() } }
    );
    await getDb().collection('users').updateOne(
      { _id: targetUser._id },
      { $addToSet: { followers: currentUser.username }, $set: { updatedAt: new Date() } }
    );
    res.json({ message: 'Followed user' });
  } catch (err) {
    console.error('Follow error:', err);
    res.status(500).json({ error: 'Failed to follow user' });
  }
});

// POST /api/user/unfollow
router.post('/user/unfollow', authenticateToken, async (req, res) => {
  try {
    const { username } = req.body || {};
    if (!username) return res.status(400).json({ error: 'Username is required' });

    const userId = new ObjectId(req.user.userId);
    const currentUser = await getDb().collection('users').findOne({ _id: userId }, { projection: { username: 1 } });
    if (!currentUser) return res.status(404).json({ error: 'User not found' });

    await getDb().collection('users').updateOne(
      { _id: userId },
      { $pull: { following: username }, $set: { updatedAt: new Date() } }
    );
    await getDb().collection('users').updateOne(
      { username },
      { $pull: { followers: currentUser.username }, $set: { updatedAt: new Date() } }
    );
    res.json({ message: 'Unfollowed user' });
  } catch (err) {
    console.error('Unfollow error:', err);
    res.status(500).json({ error: 'Failed to unfollow user' });
  }
});

// GET /api/user/:username/followers
router.get('/user/:username/followers', async (req, res) => {
  try {
    const { username } = req.params;
    const profileUser = await getDb().collection('users').findOne({ username }, { projection: { password: 0 } });
    if (!profileUser) return res.status(404).json({ error: 'User not found' });

    const followers = Array.isArray(profileUser.followers) ? profileUser.followers : [];
    const followerUsers = followers.length
      ? await getDb().collection('users').find({ username: { $in: followers } }, { projection: { password: 0 } }).toArray()
      : [];

    let loggedInUser = null;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(authHeader.substring(7), process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production');
        loggedInUser = await getDb().collection('users').findOne({ _id: new ObjectId(decoded.userId) }, { projection: { password: 0 } });
      } catch {}
    }

    const loggedFollowing = new Set(Array.isArray(loggedInUser?.following) ? loggedInUser.following : []);
    const loggedFollowers = new Set(Array.isArray(loggedInUser?.followers) ? loggedInUser.followers : []);

    const results = followerUsers.map((user) => ({
      username: user.username,
      fullName: user.fullName || `${user.firstName || ''} ${user.lastName || ''}`.trim(),
      avatar: user.avatar || null,
      bio: user.bio || '',
      isFollowing: loggedFollowing.has(user.username),
      isFollowedBy: loggedFollowers.has(user.username)
    }));

    res.json({ users: results });
  } catch (err) {
    console.error('Followers fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch followers' });
  }
});

// GET /api/user/:username/following
router.get('/user/:username/following', async (req, res) => {
  try {
    const { username } = req.params;
    const profileUser = await getDb().collection('users').findOne({ username }, { projection: { password: 0 } });
    if (!profileUser) return res.status(404).json({ error: 'User not found' });

    const following = Array.isArray(profileUser.following) ? profileUser.following : [];
    const followingUsers = following.length
      ? await getDb().collection('users').find({ username: { $in: following } }, { projection: { password: 0 } }).toArray()
      : [];

    let loggedInUser = null;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(authHeader.substring(7), process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production');
        loggedInUser = await getDb().collection('users').findOne({ _id: new ObjectId(decoded.userId) }, { projection: { password: 0 } });
      } catch {}
    }

    const loggedFollowing = new Set(Array.isArray(loggedInUser?.following) ? loggedInUser.following : []);
    const loggedFollowers = new Set(Array.isArray(loggedInUser?.followers) ? loggedInUser.followers : []);

    const results = followingUsers.map((user) => ({
      username: user.username,
      fullName: user.fullName || `${user.firstName || ''} ${user.lastName || ''}`.trim(),
      avatar: user.avatar || null,
      bio: user.bio || '',
      isFollowing: loggedFollowing.has(user.username),
      isFollowedBy: loggedFollowers.has(user.username)
    }));

    res.json({ users: results });
  } catch (err) {
    console.error('Following fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch following' });
  }
});

// GET /api/user/favorites (authenticated)
router.get('/user/favorites', authenticateToken, async (req, res) => {
  try {
    const user = await getDb().collection('users').findOne(
      { _id: new ObjectId(req.user.userId) },
      { projection: { favoritePeople: 1 } }
    );
    res.json({ favorites: user?.favoritePeople || [] });
  } catch (err) {
    console.error('Favorites fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch favorites' });
  }
});

// POST /api/user/favorites/add
router.post('/user/favorites/add', authenticateToken, async (req, res) => {
  try {
    const { id, name, profile_path, known_for_department } = req.body || {};
    if (!id || !name) {
      return res.status(400).json({ error: 'Person id and name are required' });
    }
    const userId = new ObjectId(req.user.userId);
    const user = await getDb().collection('users').findOne({ _id: userId }, { projection: { favoritePeople: 1 } });
    const existing = (user?.favoritePeople || []).find((person) => String(person.id) === String(id));
    if (existing) {
      return res.status(409).json({ error: 'Already in favorites' });
    }
    const favoritePerson = {
      id: Number(id),
      name,
      profile_path: profile_path || null,
      known_for_department: known_for_department || '',
      addedAt: new Date()
    };
    await getDb().collection('users').updateOne(
      { _id: userId },
      { $push: { favoritePeople: favoritePerson }, $set: { updatedAt: new Date() } }
    );
    res.json({ message: 'Added to favorites', favorite: favoritePerson });
  } catch (err) {
    console.error('Favorites add error:', err);
    res.status(500).json({ error: 'Failed to add favorite' });
  }
});

// POST /api/user/favorites/remove
router.post('/user/favorites/remove', authenticateToken, async (req, res) => {
  try {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Person id is required' });
    const userId = new ObjectId(req.user.userId);
    await getDb().collection('users').updateOne(
      { _id: userId },
      { $pull: { favoritePeople: { id: Number(id) } }, $set: { updatedAt: new Date() } }
    );
    res.json({ message: 'Removed from favorites' });
  } catch (err) {
    console.error('Favorites remove error:', err);
    res.status(500).json({ error: 'Failed to remove favorite' });
  }
});

// GET /api/collection/:username/:collectionName (public collection fallback)
router.get('/collection/:username/:collectionName', async (req, res) => {
  try {
    const { username, collectionName } = req.params;
    const owner = await getDb().collection('users').findOne({ username }, { projection: { password: 0, email: 0 } });
    if (!owner) return res.status(404).json({ error: 'User not found' });

    const col = owner.collections?.find(c => c.name === decodeURIComponent(collectionName));
    if (!col) return res.status(404).json({ error: 'Collection not found' });
    if (!col.isPublic && col.visibility !== 'public' && !col.isPublished)
      return res.status(403).json({ error: 'Collection is private' });

    res.json([mapCollection(col)]);
  } catch (err) {
    console.error('Fallback collection API error:', err);
    res.status(500).json({ error: 'Failed to fetch collection' });
  }
});

// GET /api/collections/published
router.get('/collections/published', async (req, res) => {
  try {
    const results = await getDb().collection('users').aggregate([
      { $unwind: '$collections' },
      {
        $match: {
          'collections.isPublished': true,
          'collections.name': { $nin: ['Watched', 'Watchlist'] }
        }
      },
      {
        $addFields: {
          collectionSize: { $size: { $ifNull: ['$collections.movies', []] } }
        }
      },
      { $match: { collectionSize: { $gte: 7 } } },
      {
        $project: {
          _id: 0,
          username: 1,
          collection: '$collections'
        }
      }
    ]).toArray();

    const payload = results
      .map((entry) => ({
        username: entry.username,
        name: entry.collection?.name,
        banner: entry.collection?.banner,
        movieCount: Array.isArray(entry.collection?.movies) ? entry.collection.movies.length : entry.collection?.movieCount || 0,
        description: entry.collection?.description || '',
        movies: Array.isArray(entry.collection?.movies) ? entry.collection.movies : []
      }))
      .filter((entry) => entry.name);

    res.json({ collections: payload });
  } catch (err) {
    console.error('Published collections fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch published collections' });
  }
});

module.exports = router;
