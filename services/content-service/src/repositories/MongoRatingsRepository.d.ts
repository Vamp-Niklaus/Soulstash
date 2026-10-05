import { Collection as MongoCollection } from 'mongodb';
export declare const INVALID_IMDB_SENTINEL = 10;
export declare const SEVEN_DAYS_MS: number;
export declare class MongoRatingsRepository {
    private client;
    private collection;
    constructor();
    connect(): Promise<MongoCollection>;
    getRatings(query: any, limit: number): Promise<import("mongodb").WithId<import("bson").Document>[]>;
    getRating(tmdbID: number, mediaType: string): Promise<import("mongodb").WithId<import("bson").Document> | null>;
    /**
     * Returns a cached record if it should be trusted (i.e. we should NOT re-fetch).
     *
     * Rules:
     *  - If the record has a real numeric IMDB rating  → always use it (ratings don't change much).
     *  - If the record has the sentinel (10.0) meaning "looked up, got N/A" → use it for 7 days,
     *    then allow one retry after that window.
     *  - If the record has imdb_rating === null with no updatedAt → treat as missing (re-fetch).
     */
    findCachedRating(tmdbID: number, mediaType: string): Promise<any | null>;
    saveRating(rating: any): Promise<import("mongodb").UpdateResult<import("bson").Document>>;
}
//# sourceMappingURL=MongoRatingsRepository.d.ts.map