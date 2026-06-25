import express from 'express';
import { ContentController } from './ContentController';
import { TMDBAdapter } from './adapters/TMDBAdapter';
import { CachingDecorator } from './decorators/CachingDecorator';
import { logger } from '../../shared/src/utils/Logger';

const PORT = 3002;
const app = express();
app.use(express.json());

import { MongoRatingsRepository } from './repositories/MongoRatingsRepository';
import { PlayerSourcesController } from './PlayerSourcesController';
const { initDb } = require('./utils/dbProvider');
// Bootstrapping dependencies
const tmdbAdapter = new TMDBAdapter();
const cachingProvider = new CachingDecorator(tmdbAdapter);

const ratingsRepo = new MongoRatingsRepository();
const contentController = new ContentController(cachingProvider, ratingsRepo);

app.get('/home', contentController.getHome.bind(contentController));
app.get('/trending', contentController.getTrending.bind(contentController));
app.get('/movies', contentController.getMoviesByGenre.bind(contentController));
app.get('/search', contentController.search.bind(contentController));
app.get('/tmdb-proxy', contentController.proxyTMDB.bind(contentController));
app.get('/person/:id/credits', contentController.getPersonCredits.bind(contentController));
app.get('/ratings', contentController.getRatings.bind(contentController));
app.get('/ratings/:mediaType/:tmdbID', contentController.getRating.bind(contentController));
app.post('/ratings/imdb/enrich', contentController.enrichRatings.bind(contentController));
initDb().then(() => {
  logger.info('Database initialized for player sources.');

  const playerSourcesController = new PlayerSourcesController();
  app.get('/player/sources', playerSourcesController.getPlayerSources.bind(playerSourcesController));

  app.listen(PORT, '0.0.0.0', () => {
    logger.info(`Content Service listening on port ${PORT}`);
  });
}).catch((err: any) => {
  logger.error(`Failed to initialize database: ${err}`);
  process.exit(1);
});
