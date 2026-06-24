import express from 'express';
import { CollectionController } from './CollectionController';
import { MongoCollectionRepository } from './repositories/MongoCollectionRepository';
import { logger } from '../../shared/src/utils/Logger';

const PORT = 3003;
const app = express();
app.use(express.json());

// Bootstrapping dependencies
const collectionRepository = new MongoCollectionRepository();
const collectionController = new CollectionController(collectionRepository);

app.get('/published', collectionController.getPublishedCollections.bind(collectionController));

app.listen(PORT, '0.0.0.0', () => {
  logger.info(`Collection Service listening on port ${PORT}`);
});
