"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MongoCollectionRepository = void 0;
const mongodb_1 = require("mongodb");
const ConfigManager_1 = require("../../../shared/src/utils/ConfigManager");
const Logger_1 = require("../../../shared/src/utils/Logger");
/**
 * Repository Pattern: MongoCollectionRepository
 * Handles complex MongoDB aggregation pipelines for user collections.
 */
class MongoCollectionRepository {
    constructor() {
        this.collection = null;
        const uri = ConfigManager_1.config.get('mongoUri');
        if (!uri)
            throw new Error('Mongo URI is not defined');
        this.client = new mongodb_1.MongoClient(uri);
    }
    async connect() {
        if (!this.collection) {
            await this.client.connect();
            const dbName = ConfigManager_1.config.get('mongoDbName') || 'test';
            this.collection = this.client.db(dbName).collection('users');
            Logger_1.logger.info(`MongoCollectionRepository: Connected to database '${dbName}'`);
        }
        return this.collection;
    }
    async getPublishedCollections() {
        const coll = await this.connect();
        // Exact aggregation pipeline from legacy monolithic server
        const results = await coll.aggregate([
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
        return results
            .map((entry) => ({
            username: entry.username,
            name: entry.collection?.name,
            banner: entry.collection?.banner,
            movieCount: Array.isArray(entry.collection?.movies) ? entry.collection.movies.length : entry.collection?.movieCount || 0,
            description: entry.collection?.description || '',
            movies: Array.isArray(entry.collection?.movies) ? entry.collection.movies : []
        }))
            .filter((entry) => entry.name);
    }
}
exports.MongoCollectionRepository = MongoCollectionRepository;
//# sourceMappingURL=MongoCollectionRepository.js.map