import { MongoClient, Collection as MongoCollection } from 'mongodb';
import { logger } from '../../../shared/src/utils/Logger';
import { config } from '../../../shared/src/utils/ConfigManager';

// Sentinel stored in DB when we successfully attempted a lookup but got no
// valid numeric rating (no IMDB ID found, or OMDB returned N/A / error).
// Matches the monolith's INVALID_IMDB_SENTINEL so shared DB records stay compatible.
export const INVALID_IMDB_SENTINEL = 10.0;
export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export class MongoRatingsRepository {
  private client: MongoClient;
  private collection: MongoCollection | null = null;

  constructor() {
    const uri = config.get('mongoUri');
    if (!uri) {
      throw new Error('Mongo URI is not defined in environment variables');
    }
    this.client = new MongoClient(uri);
  }

  public async connect(): Promise<MongoCollection> {
    if (!this.collection) {
      await this.client.connect();
      const dbName = config.get('mongoDbName') || 'test';
      this.collection = this.client.db(dbName).collection('Ratings');
      logger.info(`MongoRatingsRepository: Connected to database '${dbName}'`);
    }
    return this.collection;
  }

  public async getRatings(query: any, limit: number) {
    const coll = await this.connect();
    return coll.find(query).sort({ updatedAt: -1, tmdbID: 1 }).limit(limit).toArray();
  }

  public async getRating(tmdbID: number, mediaType: string) {
    const coll = await this.connect();
    return coll.findOne({ tmdbID, mediaType });
  }

  /**
   * Returns a cached record if it should be trusted (i.e. we should NOT re-fetch).
   *
   * Rules:
   *  - If the record has a real numeric IMDB rating  → always use it (ratings don't change much).
   *  - If the record has the sentinel (10.0) meaning "looked up, got N/A" → use it for 7 days,
   *    then allow one retry after that window.
   *  - If the record has imdb_rating === null with no updatedAt → treat as missing (re-fetch).
   */
  public async findCachedRating(tmdbID: number, mediaType: string): Promise<any | null> {
    const coll = await this.connect();
    const record = await coll.findOne({ tmdbID, mediaType });
    if (!record) return null;

    const isSentinel = record.imdb_rating === INVALID_IMDB_SENTINEL;
    const hasRealRating = typeof record.imdb_rating === 'number' &&
                          Number.isFinite(record.imdb_rating) &&
                          record.imdb_rating > 0 &&
                          record.imdb_rating !== INVALID_IMDB_SENTINEL;

    if (hasRealRating) {
      // We have an actual rating — use it forever (or until a manual refresh).
      return record;
    }

    if (isSentinel) {
      // We looked it up before but got nothing. Respect the 7-day retry window.
      const ageMs = record.updatedAt ? Date.now() - new Date(record.updatedAt).getTime() : Infinity;
      if (ageMs < SEVEN_DAYS_MS) {
        return record; // Still within 7 days — skip re-fetch.
      }
      // Older than 7 days — allow a retry by returning null.
      return null;
    }

    // imdb_rating is null or something unexpected — allow a re-fetch.
    return null;
  }

  public async saveRating(rating: any) {
    const coll = await this.connect();
    return coll.updateOne(
      { tmdbID: rating.tmdbID, mediaType: rating.mediaType },
      { $set: { ...rating, updatedAt: new Date() } },
      { upsert: true }
    );
  }
}
