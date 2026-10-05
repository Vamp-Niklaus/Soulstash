"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MongoUserRepository = void 0;
// @ts-nocheck
const mongodb_1 = require("mongodb");
const User_1 = require("../../../shared/src/entities/User");
const Logger_1 = require("../../../shared/src/utils/Logger");
const ConfigManager_1 = require("../../../shared/src/utils/ConfigManager");
/**
 * Adapter Pattern: MongoUserRepository
 * Connects the abstract IUserRepository interface to real MongoDB logic.
 */
class MongoUserRepository {
    constructor() {
        this.collection = null;
        const uri = ConfigManager_1.config.get('mongoUri');
        if (!uri) {
            throw new Error('Mongo URI is not defined in environment variables');
        }
        this.client = new mongodb_1.MongoClient(uri);
    }
    async connect() {
        if (!this.collection) {
            await this.client.connect();
            const dbName = ConfigManager_1.config.get('mongoDbName') || 'test';
            this.collection = this.client.db(dbName).collection('users');
            Logger_1.logger.info(`MongoUserRepository: Connected to database '${dbName}'`);
        }
        return this.collection;
    }
    async save(user) {
        const coll = await this.connect();
        const defaultBanner = 'https://cdn.imgchest.com/files/b23d0bfcaa8b.jpg';
        // Add default collections to mimic legacy
        const defaultCollections = () => [
            { name: 'Watched', isDeletable: true, isPublic: false, isPublished: false, banner: defaultBanner, movieCount: 0, movies: [], createdAt: new Date(), updatedAt: new Date() },
            { name: 'Watchlist', isDeletable: true, isPublic: false, isPublished: false, banner: defaultBanner, movieCount: 0, movies: [], createdAt: new Date(), updatedAt: new Date() }
        ];
        const result = await coll.insertOne({
            username: user.username,
            password: user.passwordHash,
            fullName: user.username, // Can be improved
            email: user.email,
            collections: defaultCollections(),
            favoritePeople: [],
            followers: [],
            following: [],
            admin: false,
            showAdult: false,
            collectionVersion: 1,
            createdAt: new Date(),
            updatedAt: new Date()
        });
        const props = {
            id: result.insertedId.toString(),
            username: user.username,
            email: user.email,
            role: user.role,
            createdAt: user.createdAt
        };
        if (user.passwordHash) {
            props.passwordHash = user.passwordHash;
        }
        return User_1.User.create(props);
    }
    async findByUsername(username) {
        const coll = await this.connect();
        const doc = await coll.findOne({ username: { $regex: new RegExp(`^${username}$`, 'i') } });
        if (!doc)
            return null;
        return {
            id: doc._id.toString(),
            username: doc.username,
            email: doc.email || '',
            passwordHash: doc.password,
            // Keep these persisted profile fields available to auth/session callers.
            // The API layer still controls which fields are sent to clients.
            fullName: doc.fullName || '',
            firstName: doc.firstName || '',
            lastName: doc.lastName || '',
            bio: doc.bio || '',
            avatar: doc.avatar || null,
            admin: doc.admin === true,
            showAdult: doc.showAdult === true,
            createdAt: doc.createdAt
        };
    }
    async findById(id) {
        const coll = await this.connect();
        let objectId;
        try {
            const { ObjectId } = require('mongodb');
            objectId = new ObjectId(id);
        }
        catch (e) {
            return null;
        }
        const doc = await coll.findOne({ _id: objectId });
        if (!doc)
            return null;
        return {
            id: doc._id.toString(),
            username: doc.username,
            email: doc.email || '',
            passwordHash: doc.password
        };
    }
}
exports.MongoUserRepository = MongoUserRepository;
//# sourceMappingURL=MongoUserRepository.js.map