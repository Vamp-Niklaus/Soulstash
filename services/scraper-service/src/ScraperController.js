"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScraperController = void 0;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { refreshPlayerSourceRecord } = require('./utils/legacyPlayerSources');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { scrapeImdbFilmography } = require('./utils/imdbScraper');
class ScraperController {
    async scrape(req, res) {
        try {
            const identity = req.body.identity;
            if (!identity || !identity.tmdbId) {
                res.status(400).json({ error: 'Valid identity is required.' });
                return;
            }
            // Run scraping synchronously for the HTTP request duration
            // refreshPlayerSourceRecord manages locks, scrapes, and inserts into MongoDB.
            await refreshPlayerSourceRecord(identity);
            console.log(`[ScraperController] DONE background scrape for tmdbId=${identity.tmdbId}`);
            res.json({ message: 'Scraping finished' });
        }
        catch (err) {
            console.error('[ScraperController] background scrape failed:', err.message);
        }
    }
    async getImdbFilmography(req, res) {
        try {
            const personId = req.params.personId;
            if (!personId) {
                res.status(400).json({ error: 'personId is required' });
                return;
            }
            const filmography = await scrapeImdbFilmography(personId);
            res.json(filmography);
        }
        catch (err) {
            console.error('[ScraperController] IMDB scrape failed:', err.message);
            res.status(500).json({ error: 'Failed to scrape IMDB', details: err.message });
        }
    }
}
exports.ScraperController = ScraperController;
//# sourceMappingURL=ScraperController.js.map