import { IContentProvider, CategoryResult } from '../../../shared/src/interfaces/IContentProvider';
/**
 * Adapter Pattern: TMDBAdapter
 * Adapts the external TMDB API to our internal IContentProvider interface.
 */
export declare class TMDBAdapter implements IContentProvider {
    private readonly baseUrl;
    private readonly token;
    constructor();
    private fetchFromTMDB;
    getTrending(page?: number, limit?: number): Promise<any[]>;
    getGenres(): Promise<any[]>;
    getCategoryItems(genreId: string, page?: number, limit?: number): Promise<CategoryResult>;
    search(query: string, type?: string): Promise<any[]>;
    getRawTMDB(endpoint: string): Promise<any>;
}
//# sourceMappingURL=TMDBAdapter.d.ts.map