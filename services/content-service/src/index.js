"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const pingTemplate_1 = require("../../shared/src/utils/pingTemplate");
const ContentController_1 = require("./ContentController");
const TMDBAdapter_1 = require("./adapters/TMDBAdapter");
const CachingDecorator_1 = require("./decorators/CachingDecorator");
const Logger_1 = require("../../shared/src/utils/Logger");
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3002;
const app = (0, express_1.default)();
app.use(express_1.default.json({ limit: '10mb' }));
const MongoRatingsRepository_1 = require("./repositories/MongoRatingsRepository");
const PlayerSourcesController_1 = require("./PlayerSourcesController");
const { initDb } = require('./utils/dbProvider');
// Bootstrapping dependencies
const tmdbAdapter = new TMDBAdapter_1.TMDBAdapter();
const cachingProvider = new CachingDecorator_1.CachingDecorator(tmdbAdapter);
const ratingsRepo = new MongoRatingsRepository_1.MongoRatingsRepository();
const contentController = new ContentController_1.ContentController(cachingProvider, ratingsRepo);
app.get('/home', contentController.getHome.bind(contentController));
app.get('/ping', (req, res) => {
    res.send((0, pingTemplate_1.generatePingHtml)({
        serviceName: 'Content Service',
        role: 'Fetches and caches movie/TV data from TMDB and handles media streaming sources.',
        parents: ['API Gateway'],
        children: ['TMDB API', 'Scraper Service', 'MongoDB'],
        endpoints: [
            '/home', '/trending', '/movies', '/search',
            '/tmdb-proxy', '/ratings', '/player/sources'
        ]
    }));
});
app.get('/trending', contentController.getTrending.bind(contentController));
app.get('/movies', contentController.getMoviesByGenre.bind(contentController));
app.get('/movies/:id/similar', (req, res) => contentController.getSimilar(req, res, 'movie'));
app.get('/series/:id/similar', (req, res) => contentController.getSimilar(req, res, 'tv'));
app.get('/search', contentController.search.bind(contentController));
app.get('/tmdb-proxy', contentController.proxyTMDB.bind(contentController));
app.get('/person/:id/credits', contentController.getPersonCredits.bind(contentController));
app.get('/ratings', contentController.getRatings.bind(contentController));
app.get('/ratings/:mediaType/:tmdbID', contentController.getRating.bind(contentController));
app.post('/ratings/imdb/enrich', contentController.enrichRatings.bind(contentController));
initDb().then(() => {
    Logger_1.logger.info('Database initialized for player sources.');
    const playerSourcesController = new PlayerSourcesController_1.PlayerSourcesController();
    app.get('/player/sources', playerSourcesController.getPlayerSources.bind(playerSourcesController));
    app.listen(PORT, '0.0.0.0', () => {
        Logger_1.logger.info(`Content Service listening on port ${PORT}`);
    });
}).catch((err) => {
    Logger_1.logger.error(`Failed to initialize database: ${err}`);
    process.exit(1);
});
//# sourceMappingURL=index.js.map