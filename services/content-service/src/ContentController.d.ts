import { Request, Response } from 'express';
import { IContentProvider } from '../../shared/src/interfaces/IContentProvider';
import { MongoRatingsRepository } from './repositories/MongoRatingsRepository';
/**
 * Controller for Content-related routes.
 */
export declare class ContentController {
    private readonly provider;
    private readonly ratingsRepo?;
    private usersClient;
    private cacheRepo;
    constructor(provider: IContentProvider, ratingsRepo?: MongoRatingsRepository | undefined);
    private isAdult;
    private shouldShow;
    private searchUsers;
    /** Returns the admin mode (0=filter, 1=show all, 2=adult only). Non-admins always get 0. */
    private getAdminMode;
    private shouldSendPersonCredit;
    private fetchHomePayload;
    getHome(req: Request, res: Response): Promise<void>;
    getTrending(req: Request, res: Response): Promise<void>;
    getMoviesByGenre(req: Request, res: Response): Promise<void>;
    getSimilar(req: Request, res: Response, mediaType: 'movie' | 'tv'): Promise<void>;
    search(req: Request, res: Response): Promise<void>;
    private static sanitizeRating;
    private static sanitizePosterUrl;
    /**
     * Resolve ratings for a batch of credit items.
     *
     * Strategy per item:
     *  1. Check DB cache via findCachedRating (cache-first, no external call needed).
     *  2. Cache miss → fetch TMDB detail to get imdb_id + vote_average.
     *  3. If imdb_id found → fetch OMDB for imdb_rating (retries on network fail).
     *  4. If OMDB network fails after all retries → fall back to vote_average only.
     *  5. If OMDB returns N/A or no rating → sentinel stored, vote_average used.
     *  6. If no imdb_id from TMDB → sentinel stored, vote_average used.
     *  7. vote_average >= 9.4 is stripped (treated as unreliable placeholder).
     *
     * Both imdb_rating and vote_average are included in the result so the UI
     * can prefer imdb_rating and fall back to vote_average automatically.
     */
    private resolveAllRatings;
    getPersonCredits(req: Request, res: Response): Promise<void>;
    proxyTMDB(req: Request, res: Response): Promise<void>;
    getRatings(req: Request, res: Response): Promise<void>;
    getRating(req: Request, res: Response): Promise<void>;
    private fetchTmdbDetailWithRetry;
    private fetchOmdbWithRetry;
    private resolveOneRating;
    enrichRatings(req: Request, res: Response): Promise<void>;
}
//# sourceMappingURL=ContentController.d.ts.map