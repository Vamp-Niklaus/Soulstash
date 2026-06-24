import { Request, Response } from 'express';
import { MongoCollectionRepository } from './repositories/MongoCollectionRepository';
import { logger } from '../../shared/src/utils/Logger';

export class CollectionController {
  constructor(private readonly repository: MongoCollectionRepository) {}

  public async getPublishedCollections(req: Request, res: Response): Promise<void> {
    try {
      logger.info('[CollectionController] Fetching published collections');
      const payload = await this.repository.getPublishedCollections();
      res.json({ collections: payload });
    } catch (error: any) {
      logger.error(`[CollectionController] Published collections fetch error: ${error.message}`);
      res.status(500).json({ error: 'Failed to fetch published collections' });
    }
  }
}
