import { MongoClient, Collection as MongoCollection } from 'mongodb';
import { config } from '../../../shared/src/utils/ConfigManager';
import { logger } from '../../../shared/src/utils/Logger';

/**
 * Repository Pattern: MongoCollectionRepository
 * Handles complex MongoDB aggregation pipelines for user collections.
 */
export class MongoCollectionRepository {
  private client: MongoClient;
  private collection: MongoCollection | null = null;

  constructor() {
    const uri = config.get('mongoUri');
    if (!uri) throw new Error('Mongo URI is not defined');
    this.client = new MongoClient(uri);
  }

  private async connect(): Promise<MongoCollection> {
    if (!this.collection) {
      await this.client.connect();
      const dbName = config.get('mongoDbName') || 'test';
      this.collection = this.client.db(dbName).collection('users');
      logger.info(`MongoCollectionRepository: Connected to database '${dbName}'`);
    }
    return this.collection;
  }

  public async getPublishedCollections(): Promise<any[]> {
    const coll = await this.connect();
    
    // Exact aggregation pipeline from legacy monolithic server
    const results = await coll.aggregate([
      { $unwind: '$collections' },
      {
        $match: {
          'collections.isPublished': true,
          'collections.name': { $nin: ['Watched', 'Watchlist'] }
        }
      },
      {
        $addFields: {
          collectionSize: { $size: { $ifNull: ['$collections.movies', []] } }
        }
      },
      { $match: { collectionSize: { $gte: 7 } } },
      {
        $project: {
          _id: 0,
          username: 1,
          collection: '$collections'
        }
      }
    ]).toArray();

    return results
      .map((entry: any) => ({
        username: entry.username,
        name: entry.collection?.name,
        banner: entry.collection?.banner,
        movieCount: Array.isArray(entry.collection?.movies) ? entry.collection.movies.length : entry.collection?.movieCount || 0,
        description: entry.collection?.description || '',
        movies: Array.isArray(entry.collection?.movies) ? entry.collection.movies : []
      }))
      .filter((entry: any) => entry.name);
  }
}
