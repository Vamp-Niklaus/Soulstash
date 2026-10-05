"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MongoRatingsRepository = exports.SEVEN_DAYS_MS = exports.INVALID_IMDB_SENTINEL = void 0;
const mongodb_1 = require("mongodb");
const Logger_1 = require("../../../shared/src/utils/Logger");
const ConfigManager_1 = require("../../../shared/src/utils/ConfigManager");
// Sentinel stored in DB when we successfully attempted a lookup but got no
// valid numeric rating (no IMDB ID found, or OMDB returned N/A / error).
// Matches the monolith's INVALID_IMDB_SENTINEL so shared DB records stay compatible.
exports.INVALID_IMDB_SENTINEL = 10.0;
exports.SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
class MongoRatingsRepository {
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
            this.collection = this.client.db(dbName).collection('Ratings');
            Logger_1.logger.info(`MongoRatingsRepository: Connected to database '${dbName}'`);
        }
        return this.collection;
    }
    async getRatings(query, limit) {
        const coll = await this.connect();
        return coll.find(query).sort({ updatedAt: -1, tmdbID: 1 }).limit(limit).toArray();
    }
    async getRating(tmdbID, mediaType) {
        const coll = await this.connect();
        return coll.findOne({ tmdbID, mediaType });
    }
    /**
     * Returns a cached record if it should be trusted (i.e. we should NOT re-fetch).
     *
     * Rules:
     *  - If the record has a real numeric IMDB rating  → always use it (ratings don't change much).
     *  - If the record has the sentinel (10.0) meaning "looked up, got N/A" → use it for 7 days,
     *    then allow one retry after that window.
     *  - If the record has imdb_rating === null with no updatedAt → treat as missing (re-fetch).
     */
    async findCachedRating(tmdbID, mediaType) {
        const coll = await this.connect();
        const record = await coll.findOne({ tmdbID, mediaType });
        if (!record)
            return null;
        const isSentinel = record.imdb_rating === exports.INVALID_IMDB_SENTINEL;
        const hasRealRating = typeof record.imdb_rating === 'number' &&
            Number.isFinite(record.imdb_rating) &&
            record.imdb_rating > 0 &&
            record.imdb_rating !== exports.INVALID_IMDB_SENTINEL;
        if (hasRealRating) {
            // We have an actual rating — use it forever (or until a manual refresh).
            return record;
        }
        if (isSentinel) {
            // We looked it up before but got nothing. Respect the 7-day retry window.
            const ageMs = record.updatedAt ? Date.now() - new Date(record.updatedAt).getTime() : Infinity;
            if (ageMs < exports.SEVEN_DAYS_MS) {
                return record; // Still within 7 days — skip re-fetch.
            }
            // Older than 7 days — allow a retry by returning null.
            return null;
        }
        // imdb_rating is null or something unexpected — allow a re-fetch.
        return null;
    }
    async saveRating(rating) {
        const coll = await this.connect();
        return coll.updateOne({ tmdbID: rating.tmdbID, mediaType: rating.mediaType }, { $set: { ...rating, updatedAt: new Date() } }, { upsert: true });
    }
}
exports.MongoRatingsRepository = MongoRatingsRepository;
//# sourceMappingURL=MongoRatingsRepository.js.map