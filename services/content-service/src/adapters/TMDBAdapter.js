"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TMDBAdapter = void 0;
const ConfigManager_1 = require("../../../shared/src/utils/ConfigManager");
const Logger_1 = require("../../../shared/src/utils/Logger");
/**
 * Adapter Pattern: TMDBAdapter
 * Adapts the external TMDB API to our internal IContentProvider interface.
 */
class TMDBAdapter {
    constructor() {
        this.baseUrl = (ConfigManager_1.config.get('tmdbBaseUrl') || 'https://api.tmdb.org').replace('api.themoviedb.org', 'api.tmdb.org');
        this.token = ConfigManager_1.config.get('tmdbBearerToken') || '';
    }
    async fetchFromTMDB(endpoint, retries = 3) {
        const url = `${this.baseUrl}${endpoint}`;
        Logger_1.logger.info(`[TMDBAdapter] Fetching: ${url}`);
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                const response = await fetch(url, {
                    headers: {
                        accept: 'application/json',
                        Authorization: `Bearer ${this.token}`,
                    },
                });
                if (!response.ok) {
                    throw new Error(`TMDB API Error: ${response.status} ${response.statusText}`);
                }
                return await response.json();
            }
            catch (err) {
                const isRetryable = err.cause?.code === 'ECONNRESET' || err.message === 'fetch failed';
                if (isRetryable && attempt < retries) {
                    const delay = 300 * attempt;
                    Logger_1.logger.warn(`[TMDBAdapter] Attempt ${attempt} failed (${err.cause?.code ?? err.message}), retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
                else {
                    throw err;
                }
            }
        }
    }
    async getTrending(page = 1, limit = 18) {
        const [movieData, tvData] = await Promise.all([
            this.fetchFromTMDB(`/3/trending/movie/day?language=en-US&page=${page}`),
            this.fetchFromTMDB(`/3/trending/tv/day?language=en-US&page=${page}`)
        ]);
        const mItems = (movieData.results || []).map((i) => ({ ...i, media_type: 'Movie' }));
        const tItems = (tvData.results || []).map((i) => ({ ...i, media_type: 'Series' }));
        const all = [...mItems, ...tItems].sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
        return all.slice(0, limit);
    }
    async getGenres() {
        const data = await this.fetchFromTMDB('/3/genre/movie/list?language=en-US');
        return (data.genres || [])
            .map((g) => ({ id: g.id, name: g.name }))
            .sort((a, b) => a.name.localeCompare(b.name));
    }
    async getCategoryItems(genreId, page = 1, limit = 20) {
        const adultFilter = '&include_adult=false';
        const strictRatingFilter = '&certification_country=US&certification.lte=R&vote_average.gte=0.1&vote_count.gte=5';
        let movieUrl = '';
        if (genreId === 'bollywood') {
            movieUrl = `/3/discover/movie?language=en-US&page=${page}${adultFilter}&with_original_language=hi&sort_by=primary_release_date.desc&vote_count.gte=5`;
        }
        else {
            movieUrl = `/3/discover/movie?language=en-US&page=${page}${adultFilter}${strictRatingFilter}&sort_by=popularity.desc&with_genres=${genreId}`;
        }
        const movieData = await this.fetchFromTMDB(movieUrl);
        const mItems = (movieData.results || []).map((i) => ({ ...i, media_type: 'Movie' }));
        const totalPages = typeof movieData.total_pages === 'number' ? movieData.total_pages : 1;
        return { movies: mItems.slice(0, limit), totalPages };
    }
    async search(query, type = 'content') {
        const encoded = encodeURIComponent(query);
        const data = await this.fetchFromTMDB(`/3/search/multi?query=${encoded}&include_adult=false&language=en-US&page=1`);
        const results = (data.results || []).map((i) => ({
            ...i,
            media_type: i.media_type === 'tv' ? 'Series' : i.media_type === 'movie' ? 'Movie' : i.media_type
        }));
        return results;
    }
    async getRawTMDB(endpoint) {
        return this.fetchFromTMDB(endpoint);
    }
}
exports.TMDBAdapter = TMDBAdapter;
//# sourceMappingURL=TMDBAdapter.js.map