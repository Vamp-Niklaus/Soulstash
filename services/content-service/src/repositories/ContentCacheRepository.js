"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContentCacheRepository = void 0;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getDb } = require('../utils/dbProvider');
class ContentCacheRepository {
    constructor() {
        this.collectionName = 'ContentCache';
    }
    get collection() {
        return getDb().collection(this.collectionName);
    }
    async getCache(key) {
        try {
            const record = await this.collection.findOne({ _id: key });
            return record;
        }
        catch (err) {
            console.error(`[ContentCacheRepository] Failed to get cache for key ${key}: ${err.message}`);
            return null;
        }
    }
    async setCache(key, data) {
        try {
            await this.collection.updateOne({ _id: key }, {
                $set: {
                    data,
                    updatedAt: new Date()
                }
            }, { upsert: true });
        }
        catch (err) {
            console.error(`[ContentCacheRepository] Failed to set cache for key ${key}: ${err.message}`);
        }
    }
}
exports.ContentCacheRepository = ContentCacheRepository;
//# sourceMappingURL=ContentCacheRepository.js.map