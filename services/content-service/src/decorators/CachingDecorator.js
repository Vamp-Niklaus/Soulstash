"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CachingDecorator = void 0;
const Logger_1 = require("../../../shared/src/utils/Logger");
/**
 * Decorator Pattern: CachingDecorator
 * Wraps an IContentProvider to add in-memory caching to all its methods.
 */
class CachingDecorator {
    constructor(provider) {
        this.provider = provider;
        this.trendingCache = [];
        this.trendingCacheTime = 0;
        this.genresCache = [];
        this.genresCacheTime = 0;
        this.categoriesCache = new Map();
        this.CACHE_DURATION = 1000 * 60 * 60; // 1 hour
    }
    async getTrending(page = 1, limit = 18) {
        if (page === 1 && this.trendingCache.length > 0 && Date.now() - this.trendingCacheTime < this.CACHE_DURATION) {
            Logger_1.logger.info('[CachingDecorator] Returning Trending from cache');
            return this.trendingCache.slice(0, limit);
        }
        const data = await this.provider.getTrending(page, limit);
        if (page === 1 && data.length > 0) {
            this.trendingCache = data;
            this.trendingCacheTime = Date.now();
        }
        return data;
    }
    async getGenres() {
        if (this.genresCache.length > 0 && Date.now() - this.genresCacheTime < this.CACHE_DURATION) {
            Logger_1.logger.info('[CachingDecorator] Returning Genres from cache');
            return this.genresCache;
        }
        const data = await this.provider.getGenres();
        if (data.length > 0) {
            this.genresCache = data;
            this.genresCacheTime = Date.now();
        }
        return data;
    }
    async getCategoryItems(genreId, page = 1, limit = 20) {
        const cacheKey = `${genreId}:p${page}`;
        const cached = this.categoriesCache.get(cacheKey);
        if (cached && Date.now() - cached.time < this.CACHE_DURATION) {
            Logger_1.logger.info(`[CachingDecorator] Returning Category ${genreId} page ${page} from cache`);
            return cached.data;
        }
        const data = await this.provider.getCategoryItems(genreId, page, limit);
        if (data.movies.length > 0) {
            this.categoriesCache.set(cacheKey, { time: Date.now(), data });
        }
        return data;
    }
    async search(query, type) {
        // Pass-through without caching for search
        return this.provider.search(query, type);
    }
    async getRawTMDB(endpoint) {
        const cached = this.categoriesCache.get(endpoint);
        if (cached && Date.now() - cached.time < this.CACHE_DURATION) {
            Logger_1.logger.info(`[CachingDecorator] Returning TMDB ${endpoint} from cache`);
            return cached.data;
        }
        const data = await this.provider.getRawTMDB(endpoint);
        if (data) {
            // Reuse categoriesCache or create a new tmdbCache if needed, categoriesCache is fine for any object mapped by string
            this.categoriesCache.set(endpoint, { time: Date.now(), data: data });
        }
        return data;
    }
}
exports.CachingDecorator = CachingDecorator;
//# sourceMappingURL=CachingDecorator.js.map