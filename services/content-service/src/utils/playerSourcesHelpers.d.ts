export declare const PREFERRED_SERVER_ORDER: string[];
export declare function normalizeMultimoviesSlug(title?: string): string;
export declare function buildSearchKey({ mediaType, title, seasonNumber, episodeNumber }: any): string;
export declare function uniqueStrings(values: any[]): string[];
export declare function mergeSourceHistory(previousUrls?: string[], latestUrl?: string): string[];
export declare function buildSourceHistoryRecord(result: any, identity?: any): {
    searchKey: any;
    mediaType: any;
    tmdbId: number | null;
    imdbId: string;
    title: string;
    year: number | null;
    seasonNumber: number | null;
    episodeNumber: number | null;
    sources: any;
    downloads: string[];
    updatedAt: Date;
};
export declare function mergeSourceHistoryRecord(existingRecord?: any, incomingRecord?: any): any;
export declare function buildPlayerSourcePayload(record?: any, identity?: any, isScraping?: boolean): {
    searchKey: any;
    tmdbId: any;
    imdbId: any;
    mediaType: any;
    seasonNumber: any;
    episodeNumber: any;
    updatedAt: any;
    scraping: boolean;
    notAvailable: boolean;
    downloads: any;
    sources: ({
        id: string;
        key: string;
        label: string;
        url: string;
        pending: boolean;
        embeddable: boolean;
        urls?: never;
    } | {
        id: string;
        key: string;
        label: string;
        url: string;
        embeddable: boolean;
        isDirect: boolean;
    } | {
        id: string;
        key: string;
        label: string;
        urls: any[];
        url: any;
        embeddable: boolean;
    } | null)[];
};
export declare function fetchTmdbPlayerIdentity({ mediaType, tmdbId, seasonNumber, episodeNumber }: any): Promise<{
    mediaType: "movie" | "series";
    tmdbId: number;
    imdbId: string;
    title: any;
    year: number | null;
    seasonNumber: number | null;
    episodeNumber: number | null;
    overview: string;
    seriesOverview: string;
    episode1Overview: string;
    episodeTitle: string;
    directors: never[];
    cast: never[];
    runtime: any;
    episodeRuntime: any;
}>;
//# sourceMappingURL=playerSourcesHelpers.d.ts.map