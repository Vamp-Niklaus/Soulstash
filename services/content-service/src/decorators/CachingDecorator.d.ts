import { IContentProvider, CategoryResult } from '../../../shared/src/interfaces/IContentProvider';
/**
 * Decorator Pattern: CachingDecorator
 * Wraps an IContentProvider to add in-memory caching to all its methods.
 */
export declare class CachingDecorator implements IContentProvider {
    private readonly provider;
    private trendingCache;
    private trendingCacheTime;
    private genresCache;
    private genresCacheTime;
    private categoriesCache;
    private readonly CACHE_DURATION;
    constructor(provider: IContentProvider);
    getTrending(page?: number, limit?: number): Promise<any[]>;
    getGenres(): Promise<any[]>;
    getCategoryItems(genreId: string, page?: number, limit?: number): Promise<CategoryResult>;
    search(query: string, type?: string): Promise<any[]>;
    getRawTMDB(endpoint: string): Promise<any>;
}
//# sourceMappingURL=CachingDecorator.d.ts.map