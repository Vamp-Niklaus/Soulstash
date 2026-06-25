// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getDb } = require('../utils/dbProvider');

export interface ICacheRecord {
  _id: string;
  data: any;
  updatedAt: Date;
}

export class ContentCacheRepository {
  private collectionName = 'ContentCache';

  private get collection() {
    return getDb().collection(this.collectionName);
  }

  public async getCache(key: string): Promise<ICacheRecord | null> {
    try {
      const record = await this.collection.findOne({ _id: key });
      return record as ICacheRecord | null;
    } catch (err: any) {
      console.error(`[ContentCacheRepository] Failed to get cache for key ${key}: ${err.message}`);
      return null;
    }
  }

  public async setCache(key: string, data: any): Promise<void> {
    try {
      await this.collection.updateOne(
        { _id: key },
        {
          $set: {
            data,
            updatedAt: new Date()
          }
        },
        { upsert: true }
      );
    } catch (err: any) {
      console.error(`[ContentCacheRepository] Failed to set cache for key ${key}: ${err.message}`);
    }
  }
}
