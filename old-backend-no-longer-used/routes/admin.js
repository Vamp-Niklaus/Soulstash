const multer = require('multer');
const upload = multer({ limits: { fileSize: 5 * 1024 * 1024 } });
const router = require('express').Router();
const { ObjectId } = require('mongodb');
const { getDb, SOURCE_CONFIGS_COLLECTION, MULTIMOVIES_CONFIG_DOC_ID } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const {
  DEFAULT_TREE,
  loadAdultTree,
  saveAdultTree,
  resetAdultTree,
  testTreeWithItem,
  loadAdultKeywords,
  saveAdultKeywords,
  resetAdultKeywords,
  DEFAULT_KEYWORDS
} = require('../util/adultDecisionTree');

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
      .findOne({ _id: new ObjectId(userId) }, { projection: { admin: 1, adminMode: 1, showAdult: 1 } });
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
      adminMode: Number(req.adminUser?.adminMode ?? (req.adminUser?.showAdult ? 1 : 0)),
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
    const { showAdult, adminMode } = req.body || {};
    const nextMode = Number.isInteger(Number(adminMode)) ? Number(adminMode) : (Boolean(showAdult) ? 1 : 0);
    const nextValue = nextMode === 1;
    await getDb()
      .collection('users')
      .updateOne(
        { _id: new ObjectId(req.user.userId) },
        { $set: { showAdult: nextValue, adminMode: nextMode, updatedAt: new Date() } }
      );
    try {
      const contentRouter = require('./content');
      if (typeof contentRouter.clearCategoriesCache === 'function') {
        contentRouter.clearCategoriesCache();
      }
    } catch {}
    res.json({ success: true, showAdult: nextValue, adminMode: nextMode });
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


const TRAFFIC_COLLECTION_NAME = 'TrafficLogsMonolith';

// POST /api/admin/trafficLogs
router.post('/trafficLogs', async (req, res) => {
  try {
    const logs = req.body;
    if (!Array.isArray(logs) || logs.length === 0) {
      return res.json({ success: true });
    }

    const trafficColl = getDb().collection(TRAFFIC_COLLECTION_NAME);
    await trafficColl.createIndex({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 }).catch(() => {});

    let geoip = null;
    try { geoip = require('geoip-lite'); } catch {}

    const docs = logs.map((log) => {
      let country = 'Unknown';
      let city = 'Unknown';
      let ll = null;
      if (log.ip) {
        const isLocal = log.ip === '127.0.0.1' || log.ip === '::1' || log.ip.startsWith('192.168.') || log.ip.startsWith('10.');
        if (isLocal) {
          country = 'Local';
          city = 'Localhost';
        } else if (geoip) {
          const geo = geoip.lookup(log.ip);
          if (geo) {
            country = geo.country || 'Unknown';
            city = geo.city || geo.region || 'Unknown';
            ll = geo.ll || null;
          }
        }
      }
      return {
        ...log,
        country,
        city,
        ll,
        createdAt: log.createdAt ? new Date(log.createdAt) : new Date()
      };
    });

    if (docs.length > 0) {
      await trafficColl.insertMany(docs);
    }
    res.json({ success: true, count: docs.length });
  } catch (err) {
    console.error('[Admin] postTrafficLogs error:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /api/admin/trafficLogs/stats
router.get('/trafficLogs/stats', authenticateToken, ensureAdmin, async (req, res) => {
  try {
    const trafficColl = getDb().collection(TRAFFIC_COLLECTION_NAME);
    const ipFilter = req.query.ip ? String(req.query.ip) : null;
    const matchStage = ipFilter ? { $match: { ip: { $regex: ipFilter, $options: 'i' } } } : { $match: {} };

    const totalRequests = await trafficColl.countDocuments(ipFilter ? { ip: { $regex: ipFilter, $options: 'i' } } : {});

    const methods = await trafficColl.aggregate([
      matchStage,
      { $group: { _id: "$method", count: { $sum: 1 } } }
    ]).toArray();
    const requestTypes = methods.map((m) => ({ type: m._id || 'UNKNOWN', count: m.count }));

    let geoip = null;
    try { geoip = require('geoip-lite'); } catch {}

    const locationsData = await trafficColl.aggregate([
      matchStage,
      { 
        $group: { 
          _id: "$ip", 
          count: { $sum: 1 },
          city: { $first: "$city" },
          country: { $first: "$country" },
          lastActive: { $max: "$createdAt" },
          usernames: { $addToSet: "$username" }
        } 
      },
      { $sort: { count: -1 } },
      { $limit: 50 }
    ]).toArray();
    const locations = locationsData.map((loc) => {
      const activeUsers = (loc.usernames || []).filter((u) => u && u !== 'anonymous');
      let city = loc.city;
      let country = loc.country;
      if ((!country || country === 'Unknown') && geoip && loc._id) {
        const isLocal = loc._id === '127.0.0.1' || loc._id === '::1' || loc._id.startsWith('192.168.') || loc._id.startsWith('10.');
        if (isLocal) {
          country = 'Local';
          city = 'Localhost';
        } else {
          const geo = geoip.lookup(loc._id);
          if (geo) {
            country = geo.country || 'Unknown';
            city = geo.city || geo.region || 'Unknown';
          }
        }
      }
      return {
        ip: loc._id || 'Unknown',
        city: city || 'Unknown',
        country: country || 'Unknown',
        count: loc.count,
        lastActive: loc.lastActive,
        users: activeUsers.length > 0 ? activeUsers : null
      };
    });

    const timeSeriesData = await trafficColl.aggregate([
      matchStage,
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]).toArray();
    const timeSeries = timeSeriesData.map((ts) => ({
      time: ts._id,
      count: ts.count
    }));

    res.json({
      totalRequests,
      requestTypes,
      locations,
      timeSeries
    });
  } catch (err) {
    console.error('[Admin] getTrafficStats error:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /api/admin/users/:username/profile
router.get('/users/:username/profile', authenticateToken, ensureAdmin, async (req, res) => {
  try {
    const username = req.params.username;
    const profileUser = await getDb().collection('users').findOne({ username }, { projection: { password: 0 } });
    if (!profileUser) return res.status(404).json({ error: 'User not found' });

    const followers = Array.isArray(profileUser.followers) ? profileUser.followers : [];
    const following = Array.isArray(profileUser.following) ? profileUser.following : [];

    const userData = {
      ...profileUser,
      followersCount: followers.length,
      followingCount: following.length,
      favoritePeoplePublic: profileUser.favoritePeoplePublic === true,
      collections: profileUser.collections || [],
      favoritePeople: Array.isArray(profileUser.favoritePeople) ? profileUser.favoritePeople : []
    };

    res.json({
      user: userData,
      isOwner: false,
      isAdminView: true,
      isFollowing: false,
      isFollowedBy: false
    });
  } catch (err) {
    console.error('[Admin] getUserProfile error:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST /api/admin/users/:username/avatar
router.post('/users/:username/avatar', authenticateToken, ensureAdmin, upload.single('avatar'), async (req, res) => {
  try {
    const { username } = req.params;
    const targetUser = await getDb().collection('users').findOne({ username });
    if (!targetUser) return res.status(404).json({ error: 'User not found' });

    let avatar = targetUser.avatar;
    if (req.file?.buffer) {
      const mimeType = req.file.mimetype || 'image/png';
      avatar = `data:${mimeType};base64,${req.file.buffer.toString('base64')}`;
    } else if (req.body.avatarUrl) {
      avatar = req.body.avatarUrl;
    }

    await getDb().collection('users').updateOne(
      { username },
      { $set: { avatar, updatedAt: new Date() } }
    );

    res.json({ success: true, avatar });
  } catch (err) {
    console.error('[Admin] updateAvatar error:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /api/admin/adult-criteria
router.get('/adult-criteria', authenticateToken, ensureAdmin, async (req, res) => {
  try {
    const tree = await loadAdultTree();
    res.json({ tree, defaultTree: DEFAULT_TREE });
  } catch (err) {
    console.error('[Admin] get adult-criteria error:', err.message);
    res.status(500).json({ error: 'Failed to load adult criteria' });
  }
});

// POST /api/admin/adult-criteria
router.post('/adult-criteria', authenticateToken, ensureAdmin, async (req, res) => {
  try {
    const { tree } = req.body;
    if (!tree) return res.status(400).json({ error: 'Decision tree is required' });
    const saved = await saveAdultTree(tree);
    try {
      const contentRouter = require('./content');
      if (typeof contentRouter.clearCategoriesCache === 'function') {
        contentRouter.clearCategoriesCache();
      }
    } catch {}
    res.json({ success: true, tree: saved });
  } catch (err) {
    console.error('[Admin] save adult-criteria error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to save adult criteria' });
  }
});

// POST /api/admin/adult-criteria/reset
router.post('/adult-criteria/reset', authenticateToken, ensureAdmin, async (req, res) => {
  try {
    const reset = await resetAdultTree();
    try {
      const contentRouter = require('./content');
      if (typeof contentRouter.clearCategoriesCache === 'function') {
        contentRouter.clearCategoriesCache();
      }
    } catch {}
    res.json({ success: true, tree: reset });
  } catch (err) {
    console.error('[Admin] reset adult-criteria error:', err.message);
    res.status(500).json({ error: 'Failed to reset adult criteria' });
  }
});

// POST /api/admin/adult-criteria/test
router.post('/adult-criteria/test', authenticateToken, ensureAdmin, async (req, res) => {
  try {
    const { tree, item } = req.body;
    const testItem = item || {};
    const result = testTreeWithItem(tree, testItem);
    res.json(result);
  } catch (err) {
    console.error('[Admin] test adult-criteria error:', err.message);
    res.status(500).json({ error: 'Failed to test adult criteria' });
  }
});

// GET /api/admin/adult-criteria/import/:type/:id
router.get('/adult-criteria/import/:type/:id', authenticateToken, ensureAdmin, async (req, res) => {
  try {
    const rawType = String(req.params.type || 'movie').toLowerCase();
    const isSeries = rawType === 'tv' || rawType === 'series';
    const tmdbType = isSeries ? 'tv' : 'movie';
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'TMDB ID is required' });

    const contentRouter = require('./content');
    const fetchFn = contentRouter.tmdbFetch || fetch;
    const headers = contentRouter.tmdbHeaders ? contentRouter.tmdbHeaders() : { accept: 'application/json' };

    const url = `https://api.themoviedb.org/3/${tmdbType}/${id}?language=en-US`;
    const response = await fetchFn(url, { headers }, `Admin Import ${tmdbType} ${id}`);
    if (!response || !response.ok) {
      return res.status(404).json({ error: `Content not found on TMDB (${response ? response.status : 'network error'})` });
    }

    const data = await response.json();
    const originCountries = Array.isArray(data.origin_country)
      ? data.origin_country
      : (Array.isArray(data.production_countries) ? data.production_countries.map(c => c.iso_3166_1).filter(Boolean) : []);

    const importedItem = {
      id: data.id,
      title: data.title || data.name || '',
      adult: Boolean(data.adult),
      vote_count: Number(data.vote_count || 0),
      release_date: data.release_date || data.first_air_date || '',
      imdb_id: data.imdb_id || '',
      origin_country: originCountries,
      original_language: data.original_language || '',
      overview: data.overview || '',
      genres: data.genres || [],
      is_bollywood_endpoint: false
    };

    res.json({ success: true, item: importedItem });
  } catch (err) {
    console.error('[Admin] import adult metadata error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to import metadata' });
  }
});

// GET /api/admin/adult-keywords
router.get('/adult-keywords', authenticateToken, ensureAdmin, async (req, res) => {
  try {
    const keywords = await loadAdultKeywords();
    res.json({ keywords, defaultKeywords: DEFAULT_KEYWORDS });
  } catch (err) {
    console.error('[Admin] get adult-keywords error:', err.message);
    res.status(500).json({ error: 'Failed to load adult keywords' });
  }
});

// POST /api/admin/adult-keywords
router.post('/adult-keywords', authenticateToken, ensureAdmin, async (req, res) => {
  try {
    const { keywords } = req.body;
    if (!Array.isArray(keywords)) return res.status(400).json({ error: 'Keywords array required' });
    const saved = await saveAdultKeywords(keywords);
    try {
      const contentRouter = require('./content');
      if (typeof contentRouter.clearCategoriesCache === 'function') {
        contentRouter.clearCategoriesCache();
      }
    } catch {}
    res.json({ success: true, keywords: saved });
  } catch (err) {
    console.error('[Admin] save adult-keywords error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to save adult keywords' });
  }
});

// POST /api/admin/adult-keywords/reset
router.post('/adult-keywords/reset', authenticateToken, ensureAdmin, async (req, res) => {
  try {
    const reset = await resetAdultKeywords();
    try {
      const contentRouter = require('./content');
      if (typeof contentRouter.clearCategoriesCache === 'function') {
        contentRouter.clearCategoriesCache();
      }
    } catch {}
    res.json({ success: true, keywords: reset });
  } catch (err) {
    console.error('[Admin] reset adult-keywords error:', err.message);
    res.status(500).json({ error: 'Failed to reset adult keywords' });
  }
});

module.exports = router;
