import express from 'express';
import cors from 'cors';
import { generatePingHtml } from '../../shared/src/utils/pingTemplate';
import { AuthController } from './AuthController';
import { UserService } from './UserService';
import { MongoUserRepository } from './repositories/MongoUserRepository';
import { logger } from '../../shared/src/utils/Logger';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
const app = express();
app.use(express.json());
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

import jwt from 'jsonwebtoken';
import { config } from '../../shared/src/utils/ConfigManager';
import { UserCollectionController } from './UserCollectionController';

// Bootstrapping dependencies
const userRepository = new MongoUserRepository();
// userRepository.connect() is handled lazily inside the repo calls
const userService = new UserService(userRepository);
const authController = new AuthController(userService);
const collectionController = new UserCollectionController(userRepository);

// Routing
app.post('/register', (req, res) => authController.register(req, res));
app.post('/login', (req, res) => authController.login(req, res));
app.post('/send-otp', (req, res) => authController.sendOtp(req, res));
app.post('/verify-otp-and-register', (req, res) => authController.verifyOtpAndRegister(req, res));
app.get('/check-username', (req, res) => authController.checkUsername(req, res));
app.get('/me', (req, res) => authController.me(req, res));
app.post('/forgot-password', (req, res) => authController.forgotPassword(req, res));
app.post('/reset-password', (req, res) => authController.resetPassword(req, res));


// User Collections (Proxied from Gateway)
const extractUser = (req: any, res: any, next: any) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (token) {
    try {
      const secret = config.get('jwtSecret') || 'fallback_secret';
      req.user = jwt.verify(token, secret);
    } catch (e) {}
  }
  next();
};

// Profile API
app.get('/profile/:username', extractUser, async (req: any, res: any) => {
  try {
    const coll = await userRepository.connect();
    const profileUser = await coll.findOne({ username: req.params.username }, { projection: { password: 0 } });
    if (!profileUser) return res.status(404).json({ error: 'User not found' });
    
    const loggedInUser = req.user ? await coll.findOne({ username: req.user.username }, { projection: { password: 0 } }) : null;
    const isOwner = loggedInUser?.username === profileUser.username;
    
    const followers = Array.isArray(profileUser.followers) ? profileUser.followers : [];
    const following = Array.isArray(profileUser.following) ? profileUser.following : [];
    const loggedInFollowing = Array.isArray(loggedInUser?.following) ? (loggedInUser as any).following : [];
    const loggedInFollowers = Array.isArray(loggedInUser?.followers) ? (loggedInUser as any).followers : [];
    
    const isFollowing = !!loggedInUser && loggedInFollowing.includes(profileUser.username);
    const isFollowedBy = !!loggedInUser && loggedInFollowers.includes(profileUser.username);
    
    const userData: any = isOwner ? profileUser : {
      _id: profileUser._id, username: profileUser.username,
      firstName: profileUser.firstName, lastName: profileUser.lastName,
      bio: profileUser.bio, avatar: profileUser.avatar, createdAt: profileUser.createdAt,
      followersCount: followers.length,
      followingCount: following.length,
      collections: (profileUser.collections || []).filter((c: any) => c.isPublic === true || c.isPublished === true)
    };
    
    if (isOwner) {
      userData.followersCount = followers.length;
      userData.followingCount = following.length;
    }
    
    res.json({ user: userData, isOwner, accessLevel: isOwner ? 'owner' : 'public', isFollowing, isFollowedBy });
  } catch (err) {
    logger.error('Profile API error:', err);
    res.status(500).json({ error: 'Failed to fetch profile data' });
  }
});

app.get('/profile', extractUser, async (req: any, res: any) => {
  try {
    const username = req.user?.username;
    if (!username) return res.status(401).json({ error: 'Unauthorized' });
    const coll = await userRepository.connect();
    const profileUser = await coll.findOne({ username }, { projection: { password: 0 } });
    if (!profileUser) return res.status(404).json({ error: 'User not found' });
    res.json({
      ...profileUser,
      fullName: profileUser.fullName || [profileUser.firstName, profileUser.lastName].filter(Boolean).join(' ').trim() || profileUser.username,
      avatar: profileUser.avatar || null
    });
  } catch (err) {
    logger.error('Profile self API error:', err);
    res.status(500).json({ error: 'Failed to fetch profile data' });
  }
});

app.post('/update-profile', extractUser, upload.single('avatar'), async (req: any, res: any) => {
  try {
    const username = req.user?.username;
    if (!username) return res.status(401).json({ error: 'Unauthorized' });

    const coll = await userRepository.connect();
    const existing = await coll.findOne({ username }, { projection: { password: 0 } });
    if (!existing) return res.status(404).json({ error: 'User not found' });

    const nextFirstName = typeof req.body?.firstName === 'string' ? req.body.firstName : existing.firstName || '';
    const nextLastName = typeof req.body?.lastName === 'string' ? req.body.lastName : existing.lastName || '';
    const nextBio = typeof req.body?.bio === 'string' ? req.body.bio : existing.bio || '';
    const nextDateOfBirth = typeof req.body?.dateOfBirth === 'string' ? req.body.dateOfBirth : existing.dateOfBirth || '';
    const nextInstagram = typeof req.body?.instagramHandle === 'string' ? req.body.instagramHandle : existing.instagramHandle || '';
    const nextX = typeof req.body?.xHandle === 'string' ? req.body.xHandle : existing.xHandle || '';
    const nextYouTube = typeof req.body?.youtubeHandle === 'string' ? req.body.youtubeHandle : existing.youtubeHandle || '';
    const updates: any = {
      firstName: nextFirstName,
      lastName: nextLastName,
      dateOfBirth: nextDateOfBirth,
      bio: nextBio,
      instagramHandle: nextInstagram,
      xHandle: nextX,
      youtubeHandle: nextYouTube
    };
    updates.fullName = [updates.firstName, updates.lastName].filter(Boolean).join(' ').trim() || existing.fullName || username;
    if (req.file?.buffer) {
      // Keep it simple for now: store avatar as a data URL so the UI can render it immediately.
      const mimeType = req.file.mimetype || 'image/png';
      updates.avatar = `data:${mimeType};base64,${req.file.buffer.toString('base64')}`;
    }

    const result = await coll.findOneAndUpdate(
      { username },
      { $set: updates },
      { returnDocument: 'after', projection: { password: 0 } }
    );

    const user = result?.value || await coll.findOne({ username }, { projection: { password: 0 } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({
      ...user,
      fullName: user.fullName || [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.username,
      avatar: user.avatar || null
    });
  } catch (err) {
    logger.error('Update profile API error:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

app.use('/collections', extractUser);
app.get('/collections', (req, res) => collectionController.getCollections(req, res));
app.post('/collections', (req, res) => collectionController.createCollection(req, res));
app.put('/collections/:id', (req, res) => collectionController.updateCollection(req, res));
app.delete('/collections/:id', (req, res) => collectionController.deleteCollection(req, res));
app.post('/collections/reorder', (req, res) => collectionController.reorder(req, res));
app.post('/collections/:id/add', (req, res) => collectionController.addItem(req, res));
app.post('/collections/:id/remove', (req, res) => collectionController.removeItem(req, res));

app.post('/collections/:id/publish', async (req: any, res: any) => {
  try {
    const user = req.user;
    const collectionId = req.params.id;
    const publish = req.body?.publish === true;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const coll = await userRepository.connect();
    const doc = await coll.findOne({ username: user.username });
    if (!doc) return res.status(404).json({ error: 'User not found' });

    const idx = Array.isArray(doc.collections) ? doc.collections.findIndex((c: any) => String(c._id || c.name) === String(collectionId)) : -1;
    if (idx === -1) return res.status(404).json({ error: 'Collection not found' });

    const current = doc.collections[idx];
    if (['Watched', 'Watchlist'].includes(current.name)) {
      return res.status(400).json({ error: 'Default collections cannot be published' });
    }
    const movieCount = Array.isArray(current.movies) ? current.movies.length : 0;
    if (publish && movieCount < 6) {
      return res.status(400).json({ error: 'At least 6 titles are required to publish this collection' });
    }

    await coll.updateOne(
      { username: user.username, 'collections._id': collectionId },
      { $set: { 'collections.$.isPublished': publish, 'collections.$.isPublic': publish ? true : false, 'collections.$.updatedAt': new Date(), updatedAt: new Date() } as any }
    );
    await coll.updateOne(
      { username: user.username, 'collections.name': collectionId, 'collections._id': { $exists: false } },
      { $set: { 'collections.$.isPublished': publish, 'collections.$.isPublic': publish ? true : false, 'collections.$.updatedAt': new Date(), updatedAt: new Date() } as any }
    );

    const latest = await coll.findOne({ username: user.username }, { projection: { password: 0 } });
    res.json({
      message: publish ? 'Collection published' : 'Collection unpublished',
      collections: latest?.collections || [],
      collectionVersion: Number(latest?.collectionVersion || 0)
    });
  } catch (err: any) {
    logger.error(`[UserService] publish collection error: ${err.message}`);
    res.status(500).json({ error: 'Failed to publish collection' });
  }
});

app.post('/collections/reorder', extractUser, async (req: any, res: any) => {
  try {
    const user = req.user;
    const order = Array.isArray(req.body?.order) ? req.body.order : [];
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    if (!order.length) return res.status(400).json({ error: 'Collection order is required' });

    const coll = await userRepository.connect();
    const doc = await coll.findOne({ username: user.username });
    if (!doc) return res.status(404).json({ error: 'User not found' });

    const current = Array.isArray(doc.collections) ? doc.collections : [];
    const defaults = current.filter((c: any) => ['Watched', 'Watchlist'].includes(c.name));
    const others = current.filter((c: any) => !['Watched', 'Watchlist'].includes(c.name));
    const byKey = new Map<string, any>();
    current.forEach((collection: any) => {
      byKey.set(String(collection._id || collection.name), collection);
      byKey.set(String(collection.name), collection);
    });

    const reordered: any[] = [];
    for (const id of order) {
      const found = byKey.get(String(id));
      if (found && !['Watched', 'Watchlist'].includes(found.name) && !reordered.find((c) => c.name === found.name)) {
        reordered.push(found);
      }
    }
    others.forEach((collection: any) => {
      if (!reordered.find((c) => c.name === collection.name)) {
        reordered.push(collection);
      }
    });

    const finalCollections = [
      ...defaults.filter((c: any) => c.name === 'Watched'),
      ...defaults.filter((c: any) => c.name === 'Watchlist'),
      ...reordered
    ];

    await coll.updateOne(
      { username: user.username },
      { $set: { collections: finalCollections, updatedAt: new Date() }, $inc: { collectionVersion: 1 } }
    );

    const latest = await coll.findOne({ username: user.username }, { projection: { password: 0 } });
    res.json({
      success: true,
      collections: latest?.collections || finalCollections,
      collectionVersion: Number(latest?.collectionVersion || 0)
    });
  } catch (err: any) {
    logger.error(`[UserService] reorder collections error: ${err.message}`);
    res.status(500).json({ error: 'Failed to reorder collections' });
  }
});

app.post('/collections/:id/enrich-metadata', async (req: any, res: any) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    const collectionId = req.params.id;
    const items = Array.isArray(req.body?.items) ? req.body.items : [];

    const coll = await userRepository.connect();
    const doc = await coll.findOne({ username: user.username }, { projection: { password: 0 } });
    if (!doc) return res.status(404).json({ error: 'User not found' });

    // Key resolved items by mediaType:contentId so each stored movie/series
    // entry in the target collection can be matched and updated in place.
    const resolvedByKey = new Map(
      items.map((item: any) => [`${String(item.mediaType)}:${Number(item.contentId)}`, item])
    );

    let modified = false;
    const updatedCollections = (doc.collections || []).map((c: any) => {
      if (String(c._id) !== String(collectionId) && c.name !== collectionId) return c;

      const movies = (c.movies || []).map((m: any) => {
        const mediaType = m.media_type === 'Series' || m.seriesId ? 'Series' : 'Movie';
        const contentId = Number(m.movieId || m.seriesId || m.id || 0);
        const resolved: any = resolvedByKey.get(`${mediaType}:${contentId}`);
        if (!resolved) return m;

        modified = true;
        return {
          ...m,
          imdb_rating: resolved.imdb_rating ?? null,
          vote_average: resolved.vote_average ?? m.vote_average ?? null,
          imdb_id: resolved.imdb_id || m.imdb_id || '',
          // Persist the attempt flag even on a failed lookup so this item
          // isn't re-queued for enrichment on every future page load.
          rating_lookup_attempted: resolved.rating_lookup_attempted === true
        };
      });

      return { ...c, movies, updatedAt: new Date() };
    });

    if (!modified) {
      return res.json({
        message: 'Nothing to update',
        collections: doc.collections || [],
        collectionVersion: Number(doc.collectionVersion || 0)
      });
    }

    const latest = await coll.findOneAndUpdate(
      { username: user.username },
      { $set: { collections: updatedCollections }, $inc: { collectionVersion: 1 } },
      { returnDocument: 'after' }
    );

    res.json({
      message: 'Collection metadata updated',
      collections: latest?.collections || updatedCollections,
      collectionVersion: Number(latest?.collectionVersion || 0)
    });
  } catch (err: any) {
    logger.error(`[UserService] enrich metadata error: ${err.message}`);
    res.status(500).json({ error: 'Failed to enrich collection metadata' });
  }
});

// Social API
app.get('/:username/followers', extractUser, async (req: any, res: any) => {
  try {
    const coll = await userRepository.connect();
    const targetUser = await coll.findOne({ username: req.params.username });
    if (!targetUser) return res.status(404).json({ error: 'User not found' });
    
    const loggedInUser = req.user ? await coll.findOne({ username: req.user.username }) : null;
    const loggedInFollowing = Array.isArray(loggedInUser?.following) ? loggedInUser!.following : [];

    const followerUsernames = Array.isArray(targetUser.followers) ? targetUser.followers : [];
    if (!followerUsernames.length) return res.json({ users: [] });

    const followerDocs = await coll.find({ username: { $in: followerUsernames } }).toArray();
    const users = followerDocs.map((u: any) => ({
      username: u.username,
      avatar: u.avatar || null,
      fullName: u.fullName || [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.username,
      bio: u.bio || '',
      isFollowing: !!loggedInUser && loggedInFollowing.includes(u.username)
    }));
    
    res.json({ users });
  } catch (err) {
    logger.error('Followers fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch followers' });
  }
});

app.get('/:username/following', extractUser, async (req: any, res: any) => {
  try {
    const coll = await userRepository.connect();
    const targetUser = await coll.findOne({ username: req.params.username });
    if (!targetUser) return res.status(404).json({ error: 'User not found' });
    
    const loggedInUser = req.user ? await coll.findOne({ username: req.user.username }) : null;
    const loggedInFollowing = Array.isArray(loggedInUser?.following) ? loggedInUser!.following : [];

    const followingUsernames = Array.isArray(targetUser.following) ? targetUser.following : [];
    if (!followingUsernames.length) return res.json({ users: [] });

    const followingDocs = await coll.find({ username: { $in: followingUsernames } }).toArray();
    const users = followingDocs.map((u: any) => ({
      username: u.username,
      avatar: u.avatar || null,
      fullName: u.fullName || [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.username,
      bio: u.bio || '',
      isFollowing: !!loggedInUser && loggedInFollowing.includes(u.username)
    }));
    
    res.json({ users });
  } catch (err) {
    logger.error('Following fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch following' });
  }
});

app.post('/follow', extractUser, async (req: any, res: any) => {
  try {
    const username = req.user?.username;
    const targetUsername = req.body?.username;
    if (!username) return res.status(401).json({ error: 'Unauthorized' });
    if (!targetUsername || username === targetUsername) return res.status(400).json({ error: 'Invalid target' });

    const coll = await userRepository.connect();
    const target = await coll.findOne({ username: targetUsername });
    if (!target) return res.status(404).json({ error: 'User not found' });

    await coll.updateOne({ username }, { $addToSet: { following: targetUsername } });
    await coll.updateOne({ username: targetUsername }, { $addToSet: { followers: username } });

    res.json({ success: true, message: `Followed ${targetUsername}` });
  } catch (err) {
    logger.error('Follow error:', err);
    res.status(500).json({ error: 'Failed to follow user' });
  }
});

app.post('/unfollow', extractUser, async (req: any, res: any) => {
  try {
    const username = req.user?.username;
    const targetUsername = req.body?.username;
    if (!username) return res.status(401).json({ error: 'Unauthorized' });
    if (!targetUsername) return res.status(400).json({ error: 'Invalid target' });

    const coll = await userRepository.connect();
    await coll.updateOne({ username }, { $pull: { following: targetUsername } });
    await coll.updateOne({ username: targetUsername }, { $pull: { followers: username } });

    res.json({ success: true, message: `Unfollowed ${targetUsername}` });
  } catch (err) {
    logger.error('Unfollow error:', err);
    res.status(500).json({ error: 'Failed to unfollow user' });
  }
});

// Public Collection
app.get('/public-collection/:username/:collectionName', (req, res) => collectionController.getPublicCollection(req, res));

app.get('/health', (req, res) => { res.status(200).json({ status: 'User Service is healthy' }) });

app.get('/ping', (req, res) => {
  res.send(generatePingHtml({
    serviceName: 'User Service',
    role: 'Handles authentication, user profiles, and private collections.',
    parents: ['API Gateway'],
    children: ['MongoDB'],
    endpoints: [
      '/login', '/register', '/me', '/profile', 
      '/collections', '/collections/:id', '/check-username', '/forgot-password'
    ]
  }));
});

app.listen(PORT, '0.0.0.0', () => {
  logger.info(`User Service listening on port ${PORT}`);
});
