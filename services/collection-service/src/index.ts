import express from 'express';
import { generatePingHtml } from '../../shared/src/utils/pingTemplate';
import { CollectionController } from './CollectionController';
import { MongoCollectionRepository } from './repositories/MongoCollectionRepository';
import { logger } from '../../shared/src/utils/Logger';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3003;
const app = express();
app.use(express.json());

// Bootstrapping dependencies
const collectionRepository = new MongoCollectionRepository();
const collectionController = new CollectionController(collectionRepository);

app.get('/published', collectionController.getPublishedCollections.bind(collectionController));

app.get('/ping', (req, res) => {
  res.send(generatePingHtml({
    serviceName: 'Collection Service',
    role: 'Handles public-facing published collections.',
    parents: ['API Gateway'],
    children: ['MongoDB'],
    endpoints: ['/published']
  }));
});

app.listen(PORT, '0.0.0.0', () => {
  logger.info(`Collection Service listening on port ${PORT}`);
});
