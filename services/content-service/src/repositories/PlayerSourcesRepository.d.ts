import { IPlayerIdentity, IPlayerSource, IPlayerSourceResult } from '../../../shared/src/interfaces/IVideoScraper';
/**
 * PlayerSourcesRepository
 * Single place for all PlayerSources MongoDB reads and writes.
 * Content-service's ContentController and the scraping pipeline
 * both go through here — never talk to the collection directly.
 */
export declare class PlayerSourcesRepository {
    private readonly collection;
    constructor(db: any);
    findByTmdbId(tmdbId: number, mediaType: string): Promise<any | null>;
    findBySearchKey(searchKey: string): Promise<any | null>;
    /**
     * Incremental upsert — merges incoming sources with whatever is already in DB.
     * Called by onSource callbacks as the scraper finds sources one-by-one.
     */
    mergeSources(identity: IPlayerIdentity, incomingSources: IPlayerSource[]): Promise<void>;
    /**
     * Final upsert after scrape completes — writes merged sources + all identity fields.
     */
    saveFinalResult(identity: IPlayerIdentity, result: IPlayerSourceResult): Promise<void>;
    /**
     * Stamps lastScrapeAttempt (and optionally notAvailable) after a failed scrape.
     */
    stampFailure(identity: IPlayerIdentity, notAvailable?: boolean): Promise<void>;
    hasSources(doc: any, identity: IPlayerIdentity): boolean;
    countSources(doc: any, identity: IPlayerIdentity): number;
}
//# sourceMappingURL=PlayerSourcesRepository.d.ts.map