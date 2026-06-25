import 'dotenv/config';
import express from 'express';
import { ScraperController } from './ScraperController';

const { initDb } = require('./utils/dbProvider');

const PORT = 3004;
const app = express();
app.use(express.json());

const scraperController = new ScraperController();
app.post('/api/scrape', scraperController.scrape.bind(scraperController));
app.get('/api/imdb/person/:personId/filmography', scraperController.getImdbFilmography.bind(scraperController));

initDb().then(() => {
  console.log('Database initialized for scraper service.');
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Scraper Service listening on port ${PORT}`);
  });
}).catch((err: any) => {
  console.error(`Failed to initialize database: ${err}`);
  process.exit(1);
});
