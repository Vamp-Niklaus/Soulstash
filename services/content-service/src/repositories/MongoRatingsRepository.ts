import { MongoClient, Collection as MongoCollection } from 'mongodb';
import { logger } from '../../../shared/src/utils/Logger';
import { config } from '../../../shared/src/utils/ConfigManager';

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

  public async saveRating(rating: any) {
    const coll = await this.connect();
    return coll.updateOne(
      { tmdbID: rating.tmdbID, mediaType: rating.mediaType },
      { $set: rating },
      { upsert: true }
    );
  }
}
