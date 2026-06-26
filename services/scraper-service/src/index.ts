import 'dotenv/config';
import express from 'express';
import { generatePingHtml } from '../../shared/src/utils/pingTemplate';
import { ScraperController } from './ScraperController';

const { initDb } = require('./utils/dbProvider');

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3004;
const app = express();
app.use(express.json());

const scraperController = new ScraperController();
app.post('/api/scrape', scraperController.scrape.bind(scraperController));
app.get('/api/imdb/person/:personId/filmography', scraperController.getImdbFilmography.bind(scraperController));

app.get('/ping', (req, res) => {
  res.send(generatePingHtml({
    serviceName: 'Scraper Service',
    role: 'Uses headless browsers to scrape background metadata (e.g., IMDb IDs and video links).',
    parents: ['Content Service'],
    children: ['Playwright', 'MongoDB'],
    endpoints: ['/api/scrape', '/api/imdb/person/:personId/filmography']
  }));
});

initDb().then(() => {
  console.log('Database initialized for scraper service.');
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Scraper Service listening on port ${PORT}`);
  });
}).catch((err: any) => {
  console.error(`Failed to initialize database: ${err}`);
  process.exit(1);
});
