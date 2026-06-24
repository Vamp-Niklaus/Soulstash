import { IContentProvider, CategoryResult } from '../../../shared/src/interfaces/IContentProvider';
import { logger } from '../../../shared/src/utils/Logger';

/**
 * Decorator Pattern: CachingDecorator
 * Wraps an IContentProvider to add in-memory caching to all its methods.
 */
export class CachingDecorator implements IContentProvider {
  private trendingCache: any[] = [];
  private trendingCacheTime: number = 0;
  
  private genresCache: any[] = [];
  private genresCacheTime: number = 0;

  private categoriesCache = new Map<string, { time: number; data: CategoryResult }>();

  private readonly CACHE_DURATION = 1000 * 60 * 60; // 1 hour

  constructor(private readonly provider: IContentProvider) {}

  public async getTrending(page: number = 1, limit: number = 18): Promise<any[]> {
    if (page === 1 && this.trendingCache.length > 0 && Date.now() - this.trendingCacheTime < this.CACHE_DURATION) {
      logger.info('[CachingDecorator] Returning Trending from cache');
      return this.trendingCache.slice(0, limit);
    }

    const data = await this.provider.getTrending(page, limit);
    if (page === 1 && data.length > 0) {
      this.trendingCache = data;
      this.trendingCacheTime = Date.now();
    }
    return data;
  }

  public async getGenres(): Promise<any[]> {
    if (this.genresCache.length > 0 && Date.now() - this.genresCacheTime < this.CACHE_DURATION) {
      logger.info('[CachingDecorator] Returning Genres from cache');
      return this.genresCache;
    }

    const data = await this.provider.getGenres();
    if (data.length > 0) {
      this.genresCache = data;
      this.genresCacheTime = Date.now();
    }
    return data;
  }

  public async getCategoryItems(genreId: string, page: number = 1, limit: number = 20): Promise<CategoryResult> {
    const cacheKey = `${genreId}:p${page}`;
    const cached = this.categoriesCache.get(cacheKey);
    if (cached && Date.now() - cached.time < this.CACHE_DURATION) {
      logger.info(`[CachingDecorator] Returning Category ${genreId} page ${page} from cache`);
      return cached.data;
    }

    const data: CategoryResult = await this.provider.getCategoryItems(genreId, page, limit);
    if (data.movies.length > 0) {
      this.categoriesCache.set(cacheKey, { time: Date.now(), data });
    }
    return data;
  }

  public async search(query: string, type?: string): Promise<any[]> {
    // Pass-through without caching for search
    return this.provider.search(query, type);
  }

  public async getRawTMDB(endpoint: string): Promise<any> {
    const cached = this.categoriesCache.get(endpoint);
    if (cached && Date.now() - cached.time < this.CACHE_DURATION) {
      logger.info(`[CachingDecorator] Returning TMDB ${endpoint} from cache`);
      return cached.data;
    }
    const data = await this.provider.getRawTMDB(endpoint);
    if (data) {
      // Reuse categoriesCache or create a new tmdbCache if needed, categoriesCache is fine for any object mapped by string
      this.categoriesCache.set(endpoint, { time: Date.now(), data: data as any });
    }
    return data;
  }
}
