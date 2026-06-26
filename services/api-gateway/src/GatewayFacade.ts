import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { generatePingHtml } from '../../shared/src/utils/pingTemplate';
import { logger } from '../../shared/src/utils/Logger';
import { RateLimitMiddleware, AuthMiddleware } from './middleware';

import path from 'path';

/**
 * Facade Pattern: GatewayFacade
 * Provides a simplified interface to bootstrap the complex API Gateway routing 
 * and middleware subsystems.
 */
const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://127.0.0.1:3001';
const CONTENT_SERVICE_URL = process.env.CONTENT_SERVICE_URL || 'http://127.0.0.1:3002';
const COLLECTION_SERVICE_URL = process.env.COLLECTION_SERVICE_URL || 'http://127.0.0.1:3003';

export class GatewayFacade {
  private app: Express;

  constructor() {
    this.app = express();
    this.app.use(cors({ origin: '*' }));
    this.app.use(express.json());
    
    // Serve transitional static assets for the legacy frontend UI
    const rootDir = path.resolve(__dirname, '../../..');
    this.app.use('/images', express.static(path.join(rootDir, 'assets', 'images')));
    this.app.use('/js', express.static(path.join(rootDir, 'spa', 'public', 'js')));
    this.app.use('/assets', express.static(path.join(rootDir, 'spa', 'dist', 'assets')));
    
    this.setupMiddlewareChain();
    this.setupRoutes();
  }

  /**
   * Sets up the Chain of Responsibility for incoming requests.
   */
  private setupMiddlewareChain(): void {
    const rateLimiter = new RateLimitMiddleware();
    const authHandler = new AuthMiddleware();

    // Chain: Rate Limiting -> Auth -> Route
    rateLimiter.setNext(authHandler);

    this.app.use('/api/protected', (req: Request, res: Response, next: NextFunction) => {
      // Initiate the chain
      rateLimiter.handle(req, res, next).catch(next);
    });
  }

  private setupRoutes(): void {
    // Health check route
    this.app.get('/health', (req: Request, res: Response) => {
      res.status(200).json({ status: 'Gateway is healthy' });
    });

    this.app.get('/ping', (req: Request, res: Response) => {
      res.send(generatePingHtml({
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
    this.app.use('/api/auth', async (req: Request, res: Response) => {
      try {
        const fetch = global.fetch || require('node-fetch');
        const url = `${USER_SERVICE_URL}${req.url}`; // e.g. /login
        const headers = { ...req.headers };
        delete headers['content-length'];
        delete headers['content-type'];
        delete headers['host'];
        const initOpts: any = {
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
      } catch (err) {
        logger.error(`User Service Proxy Error: ${err}`);
        res.status(502).json({ error: 'User Service is unavailable' });
      }
    });

    this.app.use('/api/user', async (req: Request, res: Response, next: NextFunction) => {
      try {
        const fetch = global.fetch || require('node-fetch');
        const url = `${USER_SERVICE_URL}${req.url}`;
        const headers = { ...req.headers };
        delete headers['content-length'];
        delete headers['content-type'];
        delete headers['host']; // Let fetch set the host
        const initOpts: any = {
          method: req.method,
          headers
        };
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
          if (req.is('multipart/form-data')) {
            headers['content-type'] = String(req.headers['content-type'] || 'multipart/form-data');
            initOpts.body = req;
            initOpts.duplex = 'half';
          } else if (req.body && Object.keys(req.body).length > 0) {
            initOpts.body = JSON.stringify(req.body);
            headers['content-type'] = 'application/json';
          }
        }
        const proxyRes = await fetch(url, initOpts);
        
        const data = await proxyRes.json().catch(() => ({}));
        res.status(proxyRes.status).json(data);
      } catch (err) {
        logger.error(`User Proxy Error: ${err}`);
        res.status(502).json({ error: 'User Service is unavailable' });
      }
    });

    this.app.use('/api/collection', async (req: Request, res: Response) => {
      try {
        const fetch = global.fetch || require('node-fetch');
        const url = `${USER_SERVICE_URL}/public-collection${req.url}`;
        const headers = { ...req.headers };
        delete headers['content-length'];
        delete headers['content-type'];
        delete headers['host']; // Let fetch set the host
        const initOpts: any = {
          method: req.method,
          headers
        };
        const proxyRes = await fetch(url, initOpts);
        
        const data = await proxyRes.json().catch(() => ({}));
        res.status(proxyRes.status).json(data);
      } catch (err) {
        logger.error(`Public Collection Proxy Error: ${err}`);
        res.status(502).json({ error: 'User Service is unavailable' });
      }
    });

    this.app.use('/api/protected/content', (req: Request, res: Response) => {
      logger.info(`Proxying request to Content Service: ${req.url}`);
      res.json({ message: 'Proxied to Content Service' });
    });

    // Content Service Proxy (Port 3002)
    this.app.use('/api/player/sources', async (req: Request, res: Response) => {
      try {
        const fetch = global.fetch || require('node-fetch');
        const queryStr = new URLSearchParams(req.query as any).toString();
        const proxyUrl = `${CONTENT_SERVICE_URL}/player/sources${queryStr ? '?' + queryStr : ''}`;
        const initOpts: any = { method: req.method, headers: { ...req.headers } };
        delete initOpts.headers['content-length'];
        delete initOpts.headers['content-type'];
        delete initOpts.headers['host'];
        const proxyRes = await fetch(proxyUrl, initOpts);
        const data = await proxyRes.json();
        res.status(proxyRes.status).json(data);
      } catch (err) {
        logger.error(`Content Service Proxy Error (/api/player/sources): ${err}`);
        res.status(502).json({ error: 'Content Service is unavailable' });
      }
    });

    this.app.use('/api/home', async (req: Request, res: Response) => {
      try {
        const fetch = global.fetch || require('node-fetch');
        const proxyRes = await fetch(`${CONTENT_SERVICE_URL}/home`);
        const data = await proxyRes.json();
        res.json(data);
      } catch (err) {
        logger.error(`Content Service Proxy Error (/api/home): ${err}`);
        res.status(502).json({ error: 'Content Service is unavailable' });
      }
    });

    this.app.use('/api/trending', async (req: Request, res: Response) => {
      try {
        const fetch = global.fetch || require('node-fetch');
        const proxyRes = await fetch(`${CONTENT_SERVICE_URL}/trending?page=${req.query.page || 1}&limit=${req.query.limit || 18}`);
        const data = await proxyRes.json();
        res.json(data);
      } catch (err) {
        logger.error(`Content Service Proxy Error (/api/trending): ${err}`);
        res.status(502).json({ error: 'Content Service is unavailable' });
      }
    });

    const proxyTMDB = async (req: Request, res: Response, tmdbEndpoint: string) => {
      try {
        const fetch = global.fetch || require('node-fetch');
        const proxyRes = await fetch(`${CONTENT_SERVICE_URL}/tmdb-proxy`, {
          headers: { 'x-tmdb-endpoint': tmdbEndpoint }
        });
        const data = await proxyRes.json();
        res.status(proxyRes.status).json(data);
      } catch (err) {
        logger.error(`Content Service Proxy Error (TMDB): ${err}`);
        res.status(502).json({ error: 'Content Service is unavailable' });
      }
    };

    this.app.get('/api/movies', async (req: Request, res: Response) => {
      try {
        const fetch = global.fetch || require('node-fetch');
        const searchParams = new URLSearchParams(req.query as any).toString();
        const proxyRes = await fetch(`${CONTENT_SERVICE_URL}/movies?${searchParams}`);
        const data = await proxyRes.json();
        res.json(data);
      } catch (err) {
        logger.error(`Content Service Proxy Error (/api/movies): ${err}`);
        res.status(502).json({ error: 'Content Service is unavailable' });
      }
    });

    this.app.get('/api/movies/:id', (req, res) => proxyTMDB(req, res, `/3/movie/${req.params.id}?append_to_response=videos,similar`));
    this.app.get('/api/movie/:id/credits', (req, res) => proxyTMDB(req, res, `/3/movie/${req.params.id}/credits`));
    this.app.get('/api/series/:id', (req, res) => proxyTMDB(req, res, `/3/tv/${req.params.id}?append_to_response=videos,similar`));
    this.app.get('/api/series/:id/credits', (req, res) => proxyTMDB(req, res, `/3/tv/${req.params.id}/credits`));
    this.app.get('/api/series/:id/season/:season', (req, res) => proxyTMDB(req, res, `/3/tv/${req.params.id}/season/${req.params.season}`));
    this.app.get('/api/person/:id', (req, res) => proxyTMDB(req, res, `/3/person/${req.params.id}?append_to_response=combined_credits`));
    this.app.get('/api/person/:id/credits', (req, res) => proxyTMDB(req, res, `/3/person/${req.params.id}/combined_credits`));

    this.app.use('/api/search', async (req: Request, res: Response) => {
      try {
        const fetch = global.fetch || require('node-fetch');
        const searchParams = new URLSearchParams(req.query as any).toString();
        const suffix = req.path === '/' ? '' : req.path;
        const proxyUrl = `${CONTENT_SERVICE_URL}/search${suffix}${searchParams ? '?' + searchParams : ''}`;
        const proxyRes = await fetch(proxyUrl);
        
        // Check if response is ndjson
        if (req.query.stream === '1') {
          res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
          const text = await proxyRes.text();
          res.send(text);
        } else {
          const data = await proxyRes.json();
          res.json(data);
        }
      } catch (err) {
        logger.error(`Content Service Proxy Error (/api/search): ${err}`);
        res.status(502).json({ error: 'Content Service is unavailable' });
      }
    });

    this.app.use('/api/ratings', async (req: Request, res: Response) => {
      try {
        const fetch = global.fetch || require('node-fetch');
        const queryStr = new URLSearchParams(req.query as any).toString();
        const suffix = req.path === '/' ? '' : req.path;
        const proxyUrl = `${CONTENT_SERVICE_URL}/ratings${suffix}${queryStr ? '?' + queryStr : ''}`;
        
        const initOpts: any = {
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
      } catch (err) {
        logger.error(`Content Service Proxy Error (/api/ratings): ${err}`);
        res.status(502).json({ error: 'Content Service is unavailable' });
      }
    });

    // Collection Service Proxy (Port 3003)
    this.app.use('/api/collections/published', async (req: Request, res: Response) => {
      try {
        const fetch = global.fetch || require('node-fetch');
        const proxyRes = await fetch(`${COLLECTION_SERVICE_URL}/published`);
        const data = await proxyRes.json();
        res.json(data);
      } catch (err) {
        logger.error(`Collection Service Proxy Error: ${err}`);
        res.status(502).json({ error: 'Collection Service is unavailable' });
      }
    });
  }

  public start(port: number): void {
    this.app.listen(port, '0.0.0.0', () => {
      logger.info(`API Gateway started on port ${port}`);
    });
  }
}
