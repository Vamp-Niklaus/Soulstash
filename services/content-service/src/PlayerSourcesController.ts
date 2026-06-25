import { Request, Response } from 'express';
import { PlayerSourcesService } from './PlayerSourcesService';
import { PlayerSourcesRepository } from './repositories/PlayerSourcesRepository';
import { IPlayerIdentity } from '../../shared/src/interfaces/IVideoScraper';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getDb } = require('./utils/dbProvider');
import { buildPlayerSourcePayload, fetchTmdbPlayerIdentity } from './utils/playerSourcesHelpers';

export class PlayerSourcesController {
  private service: PlayerSourcesService;
  private repo: PlayerSourcesRepository;

  constructor() {
    this.repo = new PlayerSourcesRepository(getDb());
    this.service = new PlayerSourcesService(this.repo);
  }

  public async getPlayerSources(req: Request, res: Response): Promise<any> {
    try {
      let mediaTypeRaw = (req.query.mediaType as string || 'movie').toLowerCase();
      const mediaType: 'movie' | 'series' = (mediaTypeRaw === 'tv' || mediaTypeRaw === 'series') ? 'series' : 'movie';
      const tmdbId = Number(req.query.tmdbId || 0);
      const imdbIdFromQuery = String(req.query.imdbId || '').trim();
      const seasonNumber = mediaType === 'series' ? Number(req.query.seasonNumber || 1) : null;
      const episodeNumber = mediaType === 'series' ? Number(req.query.episodeNumber || 1) : null;
      const forceRefresh = String(req.query.refresh || '').trim() === '1';

      if (!tmdbId) {
        return res.status(400).json({ error: 'tmdbId is required.' });
      }

      // 1. Initial Cache Check
      const cachedDoc = await this.repo.findByTmdbId(tmdbId, mediaType);
      
      let identity: IPlayerIdentity | null = null;
      let cachedRecord = null;

      if (cachedDoc) {
        if (mediaType === 'series') {
          const epKey = `s${seasonNumber}e${episodeNumber}`;
          const epData = cachedDoc.episodes?.[epKey];
          if (epData) {
            cachedRecord = {
              ...cachedDoc,
              seasonNumber,
              episodeNumber,
              sources: epData.sources || epData,
              downloads: epData.downloads || [],
              lastScrapeAttempt: epData.lastScrapeAttempt || cachedDoc.lastScrapeAttempt || 0,
              notAvailable: false
            };
          } else {
             identity = {
                mediaType,
                tmdbId,
                imdbId: cachedDoc.imdbId || imdbIdFromQuery || '',
                title: cachedDoc.title || '',
                year: cachedDoc.year || null,
                seasonNumber,
                episodeNumber,
                overview: cachedDoc.overview || '',
                episodeTitle: '',
                directors: [],
                cast: []
             };
          }
        } else {
          cachedRecord = cachedDoc;
        }
      }

      // Check if we should return cached data immediately
      if (cachedRecord && !forceRefresh) {
        const lastAttempt = cachedRecord.lastScrapeAttempt || 0;
        const isRecentlyAttempted = (Date.now() - lastAttempt) < 120000;

        // Build a temp identity from cached record so we can check the lock
        const cachedIdentity: IPlayerIdentity = identity || {
          mediaType,
          tmdbId,
          imdbId: cachedRecord.imdbId || imdbIdFromQuery,
          title: cachedRecord.title || cachedRecord.metadata?.title || '',
          year: cachedRecord.year || null,
          seasonNumber,
          episodeNumber,
          overview: cachedRecord.overview || '',
          episodeTitle: '',
          directors: [],
          cast: []
        };

        // If the background scraper is still running, return `scraping: true`
        // so the UI keeps polling instead of stopping prematurely.
        const stillScraping = this.service.isLocked(cachedIdentity);
        const isScraping = stillScraping || (!this.repo.hasSources(cachedRecord, cachedIdentity) && isRecentlyAttempted);

        const payload = buildPlayerSourcePayload(cachedRecord, cachedIdentity, isScraping);
        const hasRealSources = payload.sources.some((s: any) => !s.isDirect && !s.pending && s.url);

        if (hasRealSources || isScraping || (cachedRecord.notAvailable && isRecentlyAttempted) || isRecentlyAttempted) {
          if (!isRecentlyAttempted && !stillScraping) {
            fetchTmdbPlayerIdentity({ mediaType, tmdbId, seasonNumber, episodeNumber })
              .then((ident: any) => this.service.startBackgroundRefresh(ident))
              .catch(console.error);
          }
          console.log(`[Player Sources API] Cache hit -> scraping: ${isScraping}, hasRealSources: ${hasRealSources}`);
          return res.json({
            ...payload,
            cacheHit: true,
            scraping: isScraping
          });
        }
      }

      // 2. Resolve Identity
      if (!identity) {
        if (cachedRecord || cachedDoc) {
          identity = {
            mediaType,
            tmdbId,
            imdbId: (cachedRecord || cachedDoc).imdbId || imdbIdFromQuery,
            title: (cachedRecord || cachedDoc).title || (cachedRecord || cachedDoc).metadata?.title || '',
            year: (cachedRecord || cachedDoc).year || (cachedRecord || cachedDoc).metadata?.year || null,
            seasonNumber,
            episodeNumber,
            overview: (cachedRecord || cachedDoc).overview || (cachedRecord || cachedDoc).metadata?.overview || '',
            episodeTitle: (cachedRecord || cachedDoc).episodeTitle || '',
            directors: [],
            cast: []
          };
        } else {
          try {
            identity = await fetchTmdbPlayerIdentity({ mediaType, tmdbId, seasonNumber, episodeNumber });
          } catch (err: any) {
            console.error('[Player Sources] TMDB identity lookup failed', err.message);
            return res.status(503).json({ error: 'TMDB unavailable. Please try again.', details: err.message });
          }
        }
      }

      // 3. Start Background Refresh
      // We pass the resolved non-null identity here
      const scrapePromise = this.service.startBackgroundRefresh(identity as IPlayerIdentity).catch(console.error);

      // 4. Fast-Path / Wait for first source
      let finalDoc = await this.service.waitForFirstSource(identity as IPlayerIdentity, 60000);
      
      if (!finalDoc) {
        finalDoc = await this.repo.findByTmdbId(tmdbId, mediaType);
      }

      const finalPayload = buildPlayerSourcePayload(finalDoc || { mediaType, tmdbId, seasonNumber, episodeNumber }, identity, true);
      
      console.log(`[Player Sources API] Sending ${finalPayload.sources?.length || 0} sources to UI.`);
      console.log(JSON.stringify(finalPayload.sources, null, 2));

      const responsePayload = {
        ...finalPayload,
        cacheHit: Boolean(finalDoc),
        scraping: this.service.isLocked(identity as IPlayerIdentity)
      };
      console.log(`[Player Sources API] Returning to UI -> scraping: ${responsePayload.scraping}, cacheHit: ${responsePayload.cacheHit}`);
      
      return res.json(responsePayload);

    } catch (err: any) {
      console.error('Error resolving player sources:', err);
      if (err.message === 'no-player-links-found' || err.message === 'page-not-found' || err.message === 'no-matching-slug') {
        return res.status(404).json({ error: err.message });
      }
      return res.status(500).json({ error: 'Failed to resolve player sources', details: err.message });
    }
  }
}
