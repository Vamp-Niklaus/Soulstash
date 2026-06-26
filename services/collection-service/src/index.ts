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

app.get('/ping', (req, res) => {
  res.send(`
    <html>
      <head><title>Collection Service Ping</title></head>
      <body style="font-family: sans-serif; padding: 2rem;">
        <h1>Collection Service is up!</h1>
        <p>This service is part of the Soulstash Microservices Architecture.</p>
        <p>Dependencies: MongoDB</p>
      </body>
    </html>
  `);
});

app.listen(PORT, '0.0.0.0', () => {
  logger.info(`Collection Service listening on port ${PORT}`);
});
