"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GatewayFacade = void 0;
// @ts-nocheck
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const pingTemplate_1 = require("../../shared/src/utils/pingTemplate");
const Logger_1 = require("../../shared/src/utils/Logger");
const middleware_1 = require("./middleware");
const path_1 = __importDefault(require("path"));
/**
 * Facade Pattern: GatewayFacade
 * Provides a simplified interface to bootstrap the complex API Gateway routing
 * and middleware subsystems.
 */
const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://127.0.0.1:3001';
const CONTENT_SERVICE_URL = process.env.CONTENT_SERVICE_URL || 'http://127.0.0.1:3002';
const COLLECTION_SERVICE_URL = process.env.COLLECTION_SERVICE_URL || 'http://127.0.0.1:3003';
class GatewayFacade {
    constructor() {
        this.app = (0, express_1.default)();
        this.app.use((0, cors_1.default)({ origin: '*' }));
        this.app.use(express_1.default.json({ limit: '10mb' }));
        // Add traffic logger middleware
        let logBuffer = [];
        const TRAFFIC_URL = process.env.USER_SERVICE_URL ? `${process.env.USER_SERVICE_URL}/admin/trafficLogs` : 'http://127.0.0.1:3001/admin/trafficLogs';
        this.app.use((req, res, next) => {
            const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
            const userAgent = req.headers['user-agent'] || '';
            let username = 'anonymous';
            if (req.headers['x-user-name']) {
                username = req.headers['x-user-name'];
            }
            else if (req.headers.authorization) {
                try {
                    const token = req.headers.authorization.split(' ')[1];
                    // simple base64 decode of jwt payload, no verification
                    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
                    if (payload.username)
                        username = payload.username;
                }
                catch (e) { }
            }
            logBuffer.push({
                ip: Array.isArray(ip) ? ip[0] : (typeof ip === 'string' ? ip.split(',')[0] : ip),
                path: req.path,
                method: req.method,
                username,
                userAgent
            });
            next();
        });
        setInterval(() => {
            if (logBuffer.length > 0) {
                const batch = [...logBuffer];
                logBuffer = [];
                const fetch = global.fetch || require('node-fetch');
                fetch(TRAFFIC_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(batch)
                }).catch((err) => {
                    Logger_1.logger.error(`Failed to flush traffic logs: ${err}`);
                });
            }
        }, 5000);
        // Serve transitional static assets for the legacy frontend UI
        const rootDir = path_1.default.resolve(__dirname, '../../..');
        this.app.use('/images', express_1.default.static(path_1.default.join(rootDir, 'assets', 'images')));
        this.app.use('/js', express_1.default.static(path_1.default.join(rootDir, 'spa', 'public', 'js')));
        this.app.use('/assets', express_1.default.static(path_1.default.join(rootDir, 'spa', 'dist', 'assets')));
        this.setupMiddlewareChain();
        this.setupRoutes();
    }
    /**
     * Sets up the Chain of Responsibility for incoming requests.
     */
    setupMiddlewareChain() {
        const rateLimiter = new middleware_1.RateLimitMiddleware();
        const authHandler = new middleware_1.AuthMiddleware();
        // Chain: Rate Limiting -> Auth -> Route
        rateLimiter.setNext(authHandler);
        this.app.use('/api/protected', (req, res, next) => {
            // Initiate the chain
            rateLimiter.handle(req, res, next).catch(next);
        });
    }
    setupRoutes() {
        // Health check route
        this.app.get('/health', (req, res) => {
            res.status(200).json({ status: 'Gateway is healthy' });
        });
        this.app.get('/ping', (req, res) => {
            res.send((0, pingTemplate_1.generatePingHtml)({
                serviceName: 'API Gateway',
                role: 'The central traffic director and reverse proxy for all frontend requests.',
                parents: ['Frontend SPA'],
                children: ['User Service', 'Content Service', 'Collection Service'],
                endpoints: [
                    '/api/auth', '/api/user', '/api/collection', '/api/home',
                    '/api/trending', '/api/movies', '/api/series', '/api/search', '/api/ratings'
                ]
            }));
        });
        // Reverse Proxy Routing (Auth/User Service - Port 3001)
        this.app.use('/api/auth', async (req, res) => {
            try {
                const fetch = global.fetch || require('node-fetch');
                const url = `${USER_SERVICE_URL}${req.url}`; // e.g. /login
                const headers = { ...req.headers };
                delete headers['content-length'];
                delete headers['content-type'];
                delete headers['host'];
                const initOpts = {
                    method: req.method,
                    headers
                };
                if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
                    initOpts.body = JSON.stringify(req.body);
                    initOpts.headers['Content-Type'] = 'application/json';
                }
                const proxyRes = await fetch(url, initOpts);
                const data = await proxyRes.json().catch(() => ({}));
                res.status(proxyRes.status).json(data);
            }
            catch (err) {
                Logger_1.logger.error(`User Service Proxy Error: ${err}`);
                res.status(502).json({ error: 'User Service is unavailable' });
            }
        });
        this.app.use('/api/user', async (req, res, next) => {
            try {
                const fetch = global.fetch || require('node-fetch');
                const url = `${USER_SERVICE_URL}${req.url}`;
                const headers = { ...req.headers };
                delete headers['content-length'];
                delete headers['content-type'];
                delete headers['host']; // Let fetch set the host
                const initOpts = {
                    method: req.method,
                    headers
                };
                if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
                    if (req.is('multipart/form-data')) {
                        headers['content-type'] = String(req.headers['content-type'] || 'multipart/form-data');
                        initOpts.body = req;
                        initOpts.duplex = 'half';
                    }
                    else if (req.body && Object.keys(req.body).length > 0) {
                        initOpts.body = JSON.stringify(req.body);
                        headers['content-type'] = 'application/json';
                    }
                }
                const proxyRes = await fetch(url, initOpts);
                const data = await proxyRes.json().catch(() => ({}));
                res.status(proxyRes.status).json(data);
            }
            catch (err) {
                Logger_1.logger.error(`User Proxy Error: ${err}`);
                res.status(502).json({ error: 'User Service is unavailable' });
            }
        });
        this.app.use('/api/admin', async (req, res, next) => {
            try {
                const fetch = global.fetch || require('node-fetch');
                const url = `${USER_SERVICE_URL}/admin${req.url}`;
                const headers = { ...req.headers };
                delete headers['content-length'];
                delete headers['content-type'];
                delete headers['host'];
                const initOpts = {
                    method: req.method,
                    headers
                };
                if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
                    initOpts.body = JSON.stringify(req.body);
                    initOpts.headers['Content-Type'] = 'application/json';
                }
                const proxyRes = await fetch(url, initOpts);
                const data = await proxyRes.json().catch(() => ({}));
                res.status(proxyRes.status).json(data);
            }
            catch (err) {
                Logger_1.logger.error(`Admin Proxy Error: ${err}`);
                res.status(502).json({ error: 'User Service is unavailable' });
            }
        });
        this.app.use('/api/collection', async (req, res) => {
            try {
                const fetch = global.fetch || require('node-fetch');
                const url = `${USER_SERVICE_URL}/public-collection${req.url}`;
                const headers = { ...req.headers };
                delete headers['content-length'];
                delete headers['content-type'];
                delete headers['host']; // Let fetch set the host
                const initOpts = {
                    method: req.method,
                    headers
                };
                const proxyRes = await fetch(url, initOpts);
                const data = await proxyRes.json().catch(() => ({}));
                res.status(proxyRes.status).json(data);
            }
            catch (err) {
                Logger_1.logger.error(`Public Collection Proxy Error: ${err}`);
                res.status(502).json({ error: 'User Service is unavailable' });
            }
        });
        this.app.use('/api/protected/content', (req, res) => {
            Logger_1.logger.info(`Proxying request to Content Service: ${req.url}`);
            res.json({ message: 'Proxied to Content Service' });
        });
        // Content Service Proxy (Port 3002)
        this.app.use('/api/player/sources', async (req, res) => {
            try {
                const fetch = global.fetch || require('node-fetch');
                const queryStr = new URLSearchParams(req.query).toString();
                const proxyUrl = `${CONTENT_SERVICE_URL}/player/sources${queryStr ? '?' + queryStr : ''}`;
                const initOpts = { method: req.method, headers: { ...req.headers } };
                delete initOpts.headers['content-length'];
                delete initOpts.headers['content-type'];
                delete initOpts.headers['host'];
                const proxyRes = await fetch(proxyUrl, initOpts);
                const data = await proxyRes.json();
                res.status(proxyRes.status).json(data);
            }
            catch (err) {
                Logger_1.logger.error(`Content Service Proxy Error (/api/player/sources): ${err}`);
                res.status(502).json({ error: 'Content Service is unavailable' });
            }
        });
        this.app.use('/api/home', async (req, res) => {
            try {
                const fetch = global.fetch || require('node-fetch');
                const proxyRes = await fetch(`${CONTENT_SERVICE_URL}/home`);
                const data = await proxyRes.json();
                res.json(data);
            }
            catch (err) {
                Logger_1.logger.error(`Content Service Proxy Error (/api/home): ${err}`);
                res.status(502).json({ error: 'Content Service is unavailable' });
            }
        });
        this.app.use('/api/trending', async (req, res) => {
            try {
                const fetch = global.fetch || require('node-fetch');
                const proxyRes = await fetch(`${CONTENT_SERVICE_URL}/trending?page=${req.query.page || 1}&limit=${req.query.limit || 18}`);
                const data = await proxyRes.json();
                res.json(data);
            }
            catch (err) {
                Logger_1.logger.error(`Content Service Proxy Error (/api/trending): ${err}`);
                res.status(502).json({ error: 'Content Service is unavailable' });
            }
        });
        const proxyTMDB = async (req, res, tmdbEndpoint) => {
            try {
                const fetch = global.fetch || require('node-fetch');
                const proxyRes = await fetch(`${CONTENT_SERVICE_URL}/tmdb-proxy`, {
                    headers: { 'x-tmdb-endpoint': tmdbEndpoint }
                });
                const data = await proxyRes.json();
                res.status(proxyRes.status).json(data);
            }
            catch (err) {
                Logger_1.logger.error(`Content Service Proxy Error (TMDB): ${err}`);
                res.status(502).json({ error: 'Content Service is unavailable' });
            }
        };
        this.app.get('/api/movies', async (req, res) => {
            try {
                const fetch = global.fetch || require('node-fetch');
                const searchParams = new URLSearchParams(req.query).toString();
                const proxyRes = await fetch(`${CONTENT_SERVICE_URL}/movies?${searchParams}`, {
                    headers: { ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}) }
                });
                const data = await proxyRes.json();
                res.json(data);
            }
            catch (err) {
                Logger_1.logger.error(`Content Service Proxy Error (/api/movies): ${err}`);
                res.status(502).json({ error: 'Content Service is unavailable' });
            }
        });
        this.app.get('/api/movies/:id', (req, res) => proxyTMDB(req, res, `/3/movie/${req.params.id}?append_to_response=videos,similar,images`));
        this.app.get('/api/movies/:id/similar', async (req, res) => {
            try {
                const fetch = global.fetch || require('node-fetch');
                const proxyRes = await fetch(`${CONTENT_SERVICE_URL}/movies/${req.params.id}/similar?page=${req.query.page || 1}`, {
                    headers: { ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}) }
                });
                if (proxyRes.headers.get('content-type')?.includes('application/json')) {
                    res.status(proxyRes.status).json(await proxyRes.json());
                }
                else {
                    res.status(proxyRes.status).send(await proxyRes.text());
                }
            }
            catch (err) {
                Logger_1.logger.error(`Content Service Proxy Error (similar): ${err}`);
                res.status(502).json({ error: 'Content Service is unavailable' });
            }
        });
        this.app.get('/api/movie/:id/credits', (req, res) => proxyTMDB(req, res, `/3/movie/${req.params.id}/credits`));
        this.app.get('/api/series/:id', (req, res) => proxyTMDB(req, res, `/3/tv/${req.params.id}?append_to_response=videos,similar,images`));
        this.app.get('/api/series/:id/similar', async (req, res) => {
            try {
                const fetch = global.fetch || require('node-fetch');
                const proxyRes = await fetch(`${CONTENT_SERVICE_URL}/series/${req.params.id}/similar?page=${req.query.page || 1}`, {
                    headers: { ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}) }
                });
                if (proxyRes.headers.get('content-type')?.includes('application/json')) {
                    res.status(proxyRes.status).json(await proxyRes.json());
                }
                else {
                    res.status(proxyRes.status).send(await proxyRes.text());
                }
            }
            catch (err) {
                Logger_1.logger.error(`Content Service Proxy Error (similar series): ${err}`);
                res.status(502).json({ error: 'Content Service is unavailable' });
            }
        });
        this.app.get('/api/series/:id/credits', (req, res) => proxyTMDB(req, res, `/3/tv/${req.params.id}/credits`));
        this.app.get('/api/series/:id/season/:season', (req, res) => proxyTMDB(req, res, `/3/tv/${req.params.id}/season/${req.params.season}`));
        this.app.get('/api/person/:id', (req, res) => proxyTMDB(req, res, `/3/person/${req.params.id}?language=en-US`));
        //  PASTE THIS UPDATED BLOCK INSTEAD:
        this.app.get('/api/person/:id/credits', (req, res) => {
            const url = new URL(`${CONTENT_SERVICE_URL}/person/${req.params.id}/credits`);
            // Dynamically choose between http and https modules
            const isHttps = url.protocol === 'https:';
            const transport = isHttps ? require('https') : require('http');
            const options = {
                hostname: url.hostname,
                port: url.port || (isHttps ? 443 : 80), // Swaps to 443 on Render production
                path: url.pathname + url.search,
                method: 'GET',
                headers: {
                    ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {})
                }
            };
            const proxyReq = transport.request(options, (proxyRes) => {
                if (proxyRes.statusCode !== 200) {
                    let body = '';
                    proxyRes.on('data', (chunk) => { body += chunk; });
                    proxyRes.on('end', () => {
                        try {
                            res.status(proxyRes.statusCode).json(JSON.parse(body));
                        }
                        catch {
                            res.status(proxyRes.statusCode).send(body);
                        }
                    });
                    return;
                }
                res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
                res.setHeader('X-Accel-Buffering', 'no');
                proxyRes.pipe(res);
            });
            proxyReq.on('error', (err) => {
                Logger_1.logger.error(`[Gateway] person credits proxy error: ${err.message}`);
                if (!res.headersSent)
                    res.status(502).json({ error: 'Failed to proxy person credits' });
            });
            proxyReq.end();
        });
        // this.app.get('/api/person/:id/credits', (req: Request, res: Response) => {
        //   const http = require('http');
        //   const url = new URL(`${CONTENT_SERVICE_URL}/person/${req.params.id}/credits`);
        //   const options = {
        //     hostname: url.hostname,
        //     port: url.port || 80,
        //     path: url.pathname,
        //     method: 'GET',
        //     headers: {
        //       ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {})
        //     }
        //   };
        //   const proxyReq = http.request(options, (proxyRes: any) => {
        //     if (proxyRes.statusCode !== 200) {
        //       let body = '';
        //       proxyRes.on('data', (chunk: any) => { body += chunk; });
        //       proxyRes.on('end', () => {
        //         try { res.status(proxyRes.statusCode).json(JSON.parse(body)); }
        //         catch { res.status(proxyRes.statusCode).send(body); }
        //       });
        //       return;
        //     }
        //     res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
        //     res.setHeader('X-Accel-Buffering', 'no');
        //     proxyRes.pipe(res);
        //   });
        //   proxyReq.on('error', (err: any) => {
        //     logger.error(`[Gateway] person credits proxy error: ${err.message}`);
        //     if (!res.headersSent) res.status(502).json({ error: 'Failed to proxy person credits' });
        //   });
        //   proxyReq.end();
        // });
        this.app.use('/api/search', async (req, res) => {
            try {
                const fetch = global.fetch || require('node-fetch');
                const searchParams = new URLSearchParams(req.query).toString();
                const suffix = req.path === '/' ? '' : req.path;
                const proxyUrl = `${CONTENT_SERVICE_URL}/search${suffix}${searchParams ? '?' + searchParams : ''}`;
                const proxyRes = await fetch(proxyUrl, {
                    headers: { ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}) }
                });
                if (req.query.stream === '1') {
                    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
                    const text = await proxyRes.text();
                    res.send(text);
                }
                else {
                    const data = await proxyRes.json();
                    res.json(data);
                }
            }
            catch (err) {
                Logger_1.logger.error(`Content Service Proxy Error (/api/search): ${err}`);
                res.status(502).json({ error: 'Content Service is unavailable' });
            }
        });
        this.app.use('/api/ratings', async (req, res) => {
            try {
                const fetch = global.fetch || require('node-fetch');
                const queryStr = new URLSearchParams(req.query).toString();
                const suffix = req.path === '/' ? '' : req.path;
                const proxyUrl = `${CONTENT_SERVICE_URL}/ratings${suffix}${queryStr ? '?' + queryStr : ''}`;
                const initOpts = {
                    method: req.method,
                    headers: { ...req.headers }
                };
                delete initOpts.headers['content-length'];
                delete initOpts.headers['content-type'];
                delete initOpts.headers['host'];
                if (req.method !== 'GET' && req.method !== 'HEAD') {
                    initOpts.body = JSON.stringify(req.body);
                    initOpts.headers['content-type'] = 'application/json';
                }
                const proxyRes = await fetch(proxyUrl, initOpts);
                const data = await proxyRes.json();
                res.status(proxyRes.status).json(data);
            }
            catch (err) {
                Logger_1.logger.error(`Content Service Proxy Error (/api/ratings): ${err}`);
                res.status(502).json({ error: 'Content Service is unavailable' });
            }
        });
        // Collection Service Proxy (Port 3003)
        this.app.use('/api/collections/published', async (req, res) => {
            try {
                const fetch = global.fetch || require('node-fetch');
                const proxyRes = await fetch(`${COLLECTION_SERVICE_URL}/published`);
                const data = await proxyRes.json();
                res.json(data);
            }
            catch (err) {
                Logger_1.logger.error(`Collection Service Proxy Error: ${err}`);
                res.status(502).json({ error: 'Collection Service is unavailable' });
            }
        });
    }
    start(port) {
        this.app.listen(port, '0.0.0.0', () => {
            Logger_1.logger.info(`API Gateway started on port ${port}`);
        });
    }
}
exports.GatewayFacade = GatewayFacade;
//# sourceMappingURL=GatewayFacade.js.map