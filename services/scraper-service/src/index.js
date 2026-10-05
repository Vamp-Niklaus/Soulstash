"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const pingTemplate_1 = require("../../shared/src/utils/pingTemplate");
const ScraperController_1 = require("./ScraperController");
const { initDb } = require('./utils/dbProvider');
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3004;
const app = (0, express_1.default)();
app.use(express_1.default.json());
const scraperController = new ScraperController_1.ScraperController();
app.post('/api/scrape', scraperController.scrape.bind(scraperController));
app.get('/api/imdb/person/:personId/filmography', scraperController.getImdbFilmography.bind(scraperController));
app.get('/ping', (req, res) => {
    res.send((0, pingTemplate_1.generatePingHtml)({
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
}).catch((err) => {
    console.error(`Failed to initialize database: ${err}`);
    process.exit(1);
});
//# sourceMappingURL=index.js.map