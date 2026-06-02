const router = require('express').Router();
const { ObjectId } = require('mongodb');
const { getDb, SOURCE_CONFIGS_COLLECTION, MULTIMOVIES_CONFIG_DOC_ID } = require('../db');
const { authenticateToken } = require('../middleware/auth');

const DEFAULT_MULTIMOVIES_BASE_URL = 'https://multimovies.fyi/';
const DEFAULT_MULTIMOVIES_ROOT_URL = 'https://multimovies.fyi/';

function normalizeUrlList(values = [], fallback = '') {
  const list = Array.isArray(values) ? values : [];
  const normalized = list
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return normalized.length ? normalized : (fallback ? [fallback] : []);
}

function prependConfigValue(values = [], nextValue = '') {
  const normalizedValue = String(nextValue || '').trim();
  const normalizedValues = normalizeUrlList(values);
  if (!normalizedValue) return normalizedValues;
  if (normalizedValues[0] === normalizedValue) return normalizedValues;
  return [normalizedValue, ...normalizedValues];
}

async function getMultimoviesConfig() {
  const stored = await getDb().collection(SOURCE_CONFIGS_COLLECTION).findOne({ _id: MULTIMOVIES_CONFIG_DOC_ID });
  return {
    available: stored?.available !== false,
    rootUrls: normalizeUrlList(stored?.rootUrls, DEFAULT_MULTIMOVIES_ROOT_URL),
    baseUrls: normalizeUrlList(stored?.baseUrls, DEFAULT_MULTIMOVIES_BASE_URL),
    updatedAt: stored?.updatedAt || null
  };
}

async function ensureAdmin(req, res, next) {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Access token required' });
    const user = await getDb()
      .collection('users')
      .findOne({ _id: new ObjectId(userId) }, { projection: { admin: 1, showAdult: 1 } });
    const isAdmin = user?.admin === true || user?.admin === 'true' || user?.admin === 1;
    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    req.adminUser = { ...user, admin: true };
    next();
  } catch (error) {
    console.error('Admin auth error:', error);
    res.status(500).json({ error: 'Failed to verify admin access' });
  }
}

// Admin-only: Password hashes are always excluded from the response.
router.get('/users', authenticateToken, ensureAdmin, async (req, res) => {
  try {
    const users = await getDb()
      .collection('users')
      .find({}, { projection: { password: 0 } })
      .sort({ createdAt: -1 })
      .toArray();

    const formattedUsers = users.map((user) => {
      const collections = Array.isArray(user.collections) ? user.collections : [];
      const watched = collections.find((collection) => collection.name === 'Watched');
      const watchlist = collections.find((collection) => collection.name === 'Watchlist');

      return {
        ...user,
        collectionCount: collections.length,
        totalSavedItems: collections.reduce(
          (sum, collection) => sum + (Array.isArray(collection.movies) ? collection.movies.length : 0),
          0
        ),
        watchedCount: Array.isArray(watched?.movies) ? watched.movies.length : 0,
        watchlistCount: Array.isArray(watchlist?.movies) ? watchlist.movies.length : 0
      };
    });

    res.json({
      totalUsers: formattedUsers.length,
      users: formattedUsers
    });
  } catch (error) {
    console.error('Admin users error:', error);
    res.status(500).json({ error: 'Failed to fetch admin user data' });
  }
});

// Admin-only: return admin preferences for the current user.
router.get('/me', authenticateToken, ensureAdmin, async (req, res) => {
  try {
    const multimovies = await getMultimoviesConfig();
    res.json({
      admin: true,
      showAdult: Boolean(req.adminUser?.showAdult),
      multimovies
    });
  } catch (error) {
    console.error('Admin me error:', error);
    res.status(500).json({ error: 'Failed to fetch admin info' });
  }
});

// Admin-only: update adult content preference (self-only).
router.post('/preferences', authenticateToken, ensureAdmin, async (req, res) => {
  try {
    const { showAdult } = req.body || {};
    const nextValue = Boolean(showAdult);
    await getDb()
      .collection('users')
      .updateOne(
        { _id: new ObjectId(req.user.userId) },
        { $set: { showAdult: nextValue, updatedAt: new Date() } }
      );
    res.json({ success: true, showAdult: nextValue });
  } catch (error) {
    console.error('Admin preferences error:', error);
    res.status(500).json({ error: 'Failed to update admin preferences' });
  }
});

router.post('/multimovies', authenticateToken, ensureAdmin, async (req, res) => {
  try {
    const rootUrl = String(req.body?.rootUrl || '').trim();
    const baseUrl = String(req.body?.baseUrl || '').trim();
    const current = await getMultimoviesConfig();
    const nextRootUrls = prependConfigValue(current.rootUrls, rootUrl);
    const nextBaseUrls = prependConfigValue(current.baseUrls, baseUrl);

    await getDb().collection(SOURCE_CONFIGS_COLLECTION).updateOne(
      { _id: MULTIMOVIES_CONFIG_DOC_ID },
      {
        $set: {
          className: 'multimovies',
          available: true,
          rootUrls: nextRootUrls,
          baseUrls: nextBaseUrls,
          updatedAt: new Date()
        },
        $setOnInsert: {
          createdAt: new Date()
        }
      },
      { upsert: true }
    );

    res.json({
      success: true,
      multimovies: {
        available: true,
        rootUrls: nextRootUrls,
        baseUrls: nextBaseUrls
      }
    });
  } catch (error) {
    console.error('Admin multimovies config error:', error);
    res.status(500).json({ error: 'Failed to update Multimovies config' });
  }
});

module.exports = router;
