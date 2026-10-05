"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminController = void 0;
const Logger_1 = require("../../shared/src/utils/Logger");
const ConfigManager_1 = require("../../shared/src/utils/ConfigManager");
class AdminController {
    constructor(userRepository) {
        this.userRepository = userRepository;
    }
    async checkAdmin(req, res) {
        const user = req.user;
        if (!user) {
            res.status(401).json({ error: 'Unauthorized' });
            return null;
        }
        const coll = await this.userRepository.connect();
        const dbName = ConfigManager_1.config.get('mongoDbName') || 'test';
        const db = this.userRepository.client.db(dbName);
        const dbUser = await coll.findOne({ username: user.username });
        if (!dbUser || dbUser.admin !== true) {
            res.status(403).json({ error: 'Forbidden: Admin access only' });
            return null;
        }
        return { coll, dbUser, db };
    }
    async getMe(req, res) {
        try {
            const auth = await this.checkAdmin(req, res);
            if (!auth)
                return;
            const { db, dbUser } = auth;
            const sourceConfigsColl = db.collection('SourceConfigs');
            const multimoviesConfig = await sourceConfigsColl.findOne({ _id: 'multimovies' });
            const adminMode = Number(dbUser.adminMode ?? (dbUser.showAdult === true ? 1 : 0));
            res.json({
                admin: true,
                adminMode,
                showAdult: adminMode === 1,
                multimovies: {
                    available: multimoviesConfig?.available !== false,
                    baseUrl: multimoviesConfig?.baseUrls?.[0] || 'https://multimovies.wtf/',
                    rootUrl: multimoviesConfig?.rootUrls?.[0] || 'https://multimovies.wtf/'
                }
            });
        }
        catch (err) {
            Logger_1.logger.error(`[AdminController] getMe error: ${err.message}`);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }
    async getUsers(req, res) {
        try {
            const auth = await this.checkAdmin(req, res);
            if (!auth)
                return;
            const { coll } = auth;
            const users = await coll.find({}, { projection: { password: 0, passwordHash: 0 } }).toArray();
            const formattedUsers = users.map((u) => {
                const collections = Array.isArray(u.collections) ? u.collections : [];
                const watched = collections.find((c) => c.name === 'Watched');
                const watchlist = collections.find((c) => c.name === 'Watchlist');
                const watchedCount = Array.isArray(watched?.movies) ? watched.movies.length : 0;
                const watchlistCount = Array.isArray(watchlist?.movies) ? watchlist.movies.length : 0;
                const totalSavedItems = collections.reduce((sum, c) => sum + (Array.isArray(c.movies) ? c.movies.length : 0), 0);
                const id = u._id?.toString?.() || String(u.id || u.username);
                const followers = Array.isArray(u.followers) ? u.followers : [];
                const following = Array.isArray(u.following) ? u.following : [];
                return {
                    _id: id,
                    id,
                    username: u.username,
                    email: u.email || '',
                    firstName: u.firstName || '',
                    lastName: u.lastName || '',
                    fullName: u.fullName || [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.username || '',
                    bio: u.bio || '',
                    dateOfBirth: u.dateOfBirth || '',
                    instagramHandle: u.instagramHandle || '',
                    xHandle: u.xHandle || '',
                    youtubeHandle: u.youtubeHandle || '',
                    avatar: u.avatar || null,
                    admin: !!u.admin,
                    showAdult: !!u.showAdult,
                    followersCount: followers.length,
                    followingCount: following.length,
                    createdAt: u.createdAt,
                    collections: collections.map((c) => ({
                        name: c.name,
                        movies: c.movies || []
                    })),
                    collectionCount: collections.length,
                    watchedCount,
                    watchlistCount,
                    totalSavedItems
                };
            });
            res.json({
                totalUsers: formattedUsers.length,
                users: formattedUsers
            });
        }
        catch (err) {
            Logger_1.logger.error(`[AdminController] getUsers error: ${err.message}`);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }
    async getUserProfile(req, res) {
        try {
            const auth = await this.checkAdmin(req, res);
            if (!auth)
                return;
            const { coll } = auth;
            const username = req.params.username;
            const profileUser = await coll.findOne({ username }, { projection: { password: 0, passwordHash: 0 } });
            if (!profileUser) {
                return res.status(404).json({ error: 'User not found' });
            }
            const followers = Array.isArray(profileUser.followers) ? profileUser.followers : [];
            const following = Array.isArray(profileUser.following) ? profileUser.following : [];
            // Admin sees everything (like an owner)
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
        }
        catch (err) {
            Logger_1.logger.error(`[AdminController] getUserProfile error: ${err.message}`);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }
    async updatePreferences(req, res) {
        try {
            const auth = await this.checkAdmin(req, res);
            if (!auth)
                return;
            const { coll, dbUser } = auth;
            const { adminMode: rawMode, showAdult: rawShowAdult } = req.body;
            let adminMode = Number(rawMode);
            // Backward compatibility for old frontend clients sending { showAdult: true/false }
            if (Number.isNaN(adminMode) && rawShowAdult !== undefined) {
                adminMode = rawShowAdult === true || String(rawShowAdult) === 'true' ? 1 : 0;
            }
            if (![0, 1, 2].includes(adminMode)) {
                return res.status(400).json({ error: 'adminMode must be 0, 1, or 2' });
            }
            await coll.updateOne({ username: dbUser.username }, { $set: { adminMode, showAdult: adminMode === 1, updatedAt: new Date() } });
            res.json({ success: true, adminMode, showAdult: adminMode === 1 });
        }
        catch (err) {
            Logger_1.logger.error(`[AdminController] updatePreferences error: ${err.message}`);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }
    async updateMultimovies(req, res) {
        try {
            const auth = await this.checkAdmin(req, res);
            if (!auth)
                return;
            const { db } = auth;
            const { rootUrl, baseUrl, available } = req.body;
            const sourceConfigsColl = db.collection('SourceConfigs');
            const existingDoc = await sourceConfigsColl.findOne({ _id: 'multimovies' });
            let nextBaseUrls = existingDoc?.baseUrls || [];
            let nextRootUrls = existingDoc?.rootUrls || [];
            // Prepend new URLs, removing any existing identical entries to avoid duplicates
            nextBaseUrls = [baseUrl, ...nextBaseUrls.filter((u) => u !== baseUrl)];
            nextRootUrls = [rootUrl, ...nextRootUrls.filter((u) => u !== rootUrl)];
            await sourceConfigsColl.updateOne({ _id: 'multimovies' }, {
                $set: {
                    className: 'multimovies',
                    rootUrls: nextRootUrls,
                    baseUrls: nextBaseUrls,
                    available: available !== false,
                    updatedAt: new Date()
                }
            }, { upsert: true });
            res.json({
                success: true,
                multimovies: {
                    available: available !== false,
                    rootUrl: rootUrl,
                    baseUrl: baseUrl
                }
            });
        }
        catch (err) {
            Logger_1.logger.error(`[AdminController] updateMultimovies error: ${err.message}`);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }
    async postTrafficLogs(req, res) {
        try {
            const logs = req.body;
            if (!Array.isArray(logs) || logs.length === 0) {
                return res.json({ success: true });
            }
            const coll = await this.userRepository.connect();
            const dbName = ConfigManager_1.config.get('mongoDbName') || 'test';
            const db = this.userRepository.client.db(dbName);
            const trafficColl = db.collection('TrafficLogs');
            // Ensure TTL index
            await trafficColl.createIndex({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });
            const geoip = require('geoip-lite');
            const docs = logs.map((log) => {
                const geo = geoip.lookup(log.ip);
                return {
                    ...log,
                    country: geo ? geo.country : 'Unknown',
                    city: geo ? geo.city : 'Unknown',
                    ll: geo ? geo.ll : null,
                    createdAt: new Date()
                };
            });
            if (docs.length > 0) {
                await trafficColl.insertMany(docs);
            }
            res.json({ success: true, count: docs.length });
        }
        catch (err) {
            Logger_1.logger.error(`[AdminController] postTrafficLogs error: ${err.message}`);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }
    async getTrafficStats(req, res) {
        try {
            const auth = await this.checkAdmin(req, res);
            if (!auth)
                return;
            const { db } = auth;
            const trafficColl = db.collection('TrafficLogs');
            const ipFilter = req.query.ip ? String(req.query.ip) : null;
            const matchStage = ipFilter ? { $match: { ip: { $regex: ipFilter, $options: 'i' } } } : { $match: {} };
            const totalRequests = await trafficColl.countDocuments(ipFilter ? { ip: { $regex: ipFilter, $options: 'i' } } : {});
            const methods = await trafficColl.aggregate([
                matchStage,
                { $group: { _id: "$method", count: { $sum: 1 } } }
            ]).toArray();
            const requestTypes = methods.map((m) => ({ type: m._id || 'UNKNOWN', count: m.count }));
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
                return {
                    ip: loc._id || 'Unknown',
                    city: loc.city,
                    country: loc.country,
                    count: loc.count,
                    lastActive: loc.lastActive,
                    users: activeUsers.length > 0 ? activeUsers : null
                };
            });
            // Time series: Group by YYYY-MM-DD
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
        }
        catch (err) {
            Logger_1.logger.error(`[AdminController] getTrafficStats error: ${err.message}`);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }
    async updateAvatar(req, res) {
        try {
            const auth = await this.checkAdmin(req, res);
            if (!auth)
                return;
            const { coll } = auth;
            const { username } = req.params;
            const targetUser = await coll.findOne({ username });
            if (!targetUser)
                return res.status(404).json({ error: 'User not found' });
            let avatar = targetUser.avatar;
            const file = req.file;
            if (file?.buffer) {
                const mimeType = file.mimetype || 'image/png';
                avatar = `data:${mimeType};base64,${file.buffer.toString('base64')}`;
            }
            else if (req.body.avatarUrl) {
                avatar = req.body.avatarUrl;
            }
            await coll.updateOne({ username }, { $set: { avatar, updatedAt: new Date() } });
            res.json({ success: true, avatar });
        }
        catch (err) {
            Logger_1.logger.error(`[AdminController] updateAvatar error: ${err.message}`);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }
}
exports.AdminController = AdminController;
//# sourceMappingURL=AdminController.js.map