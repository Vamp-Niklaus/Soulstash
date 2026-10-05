/**
 * Shared domain types for video source resolution.
 * Used by content-service (consumer) and scraper-service (producer).
 */
export interface IPlayerSource {
    sourceKey: string;
    serverName: string;
    url: string;
    urls?: string[];
    available: boolean;
    preferred: boolean;
    meta?: string;
    isDirect?: boolean;
    pending?: boolean;
}
export interface IPlayerIdentity {
    mediaType: 'movie' | 'series';
    tmdbId: number;
    imdbId: string;
    title: string;
    year: number | null;
    seasonNumber: number | null;
    episodeNumber: number | null;
    overview: string;
    episodeTitle?: string;
    runtime?: number;
    episodeRuntime?: number;
    directors?: string[];
    cast?: string[];
    episode1Overview?: string;
    seriesOverview?: string;
}
export interface IPlayerSourceResult {
    ok: boolean;
    status: 'success' | 'failure';
    reason: string;
    searchKey: string;
    pageUrl?: string;
    players: IPlayerSource[];
    downloads: string[];
}
export interface IVideoScraper {
    /** Unique name for this scraper provider */
    getProviderName(): string;
    /**
     * Resolves streaming sources for the given media identity.
     * Calls onSource incrementally as each source is found (for real-time DB updates).
     */
    extractSources(identity: IPlayerIdentity, options?: {
        onSource?: (sources: IPlayerSource[]) => Promise<void>;
        reqId?: string;
    }): Promise<IPlayerSourceResult>;
}
//# sourceMappingURL=IVideoScraper.d.ts.map