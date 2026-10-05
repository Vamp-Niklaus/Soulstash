import { IPlayerIdentity, IPlayerSource } from '../../shared/src/interfaces/IVideoScraper';
import { PlayerSourcesRepository } from './repositories/PlayerSourcesRepository';
/** In-process lock set — prevents concurrent duplicate scrapes */
export declare const refreshLocks: Set<string>;
/**
 * PlayerSourcesService
 * Orchestrates the three-method source resolution pipeline:
 *   Method 1 — PlayerSources DB cache
 *   Method 2 — Movie_Sources / TVShowURLs synopsis match (inside legacyPlayerSources)
 *   Method 3 — Multimovies Playwright scrape (inside legacyPlayerSources)
 *
 * This class holds zero scraping logic itself.
 * It delegates to legacyPlayerSources.js for Methods 2 & 3 and
 * to PlayerSourcesRepository for all DB reads/writes.
 */
export declare class PlayerSourcesService {
    private readonly repo;
    constructor(repo: PlayerSourcesRepository);
    isLocked(identity: IPlayerIdentity): boolean;
    buildDirectSources(identity: IPlayerIdentity): IPlayerSource[];
    /**
     * Kicks off the full scrape pipeline (Methods 2 + 3) in the background.
     * Returns immediately — callers poll via getPlayerSources.
     */
    startBackgroundRefresh(identity: IPlayerIdentity): Promise<void>;
    /**
     * Waits up to maxWaitMs for at least one source to appear in DB.
     * Used by the initial request when there is no cached record.
     */
    waitForFirstSource(identity: IPlayerIdentity, maxWaitMs?: number): Promise<any | null>;
}
//# sourceMappingURL=PlayerSourcesService.d.ts.map