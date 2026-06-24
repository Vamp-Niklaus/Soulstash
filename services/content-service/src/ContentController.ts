import { Request, Response } from 'express';
import { MongoClient } from 'mongodb';
import { IContentProvider } from '../../shared/src/interfaces/IContentProvider';
import { logger } from '../../shared/src/utils/Logger';
import { config } from '../../shared/src/utils/ConfigManager';

import { MongoRatingsRepository } from './repositories/MongoRatingsRepository';

/**
 * Controller for Content-related routes.
 */
export class ContentController {
  private usersClient: MongoClient | null = null;

  constructor(
    private readonly provider: IContentProvider,
    private readonly ratingsRepo?: MongoRatingsRepository
  ) {}

  private async searchUsers(query: string, limit: number): Promise<any[]> {
    const mongoUri = config.get('mongoUri');
    if (!mongoUri) return [];

    if (!this.usersClient) {
      this.usersClient = new MongoClient(mongoUri);
      await this.usersClient.connect();
    }

    const dbName = config.get('mongoDbName') || 'test';
    return this.usersClient.db(dbName).collection('users')
      .find({
        $or: [
          { username: { $regex: query, $options: 'i' } },
          { fullName: { $regex: query, $options: 'i' } }
        ]
      })
      .project({ username: 1, fullName: 1, avatar: 1, bio: 1 })
      .limit(Math.max(limit, 10))
      .toArray()
      .catch(() => []);
  }

  public async getHome(req: Request, res: Response): Promise<void> {
    try {
      logger.info('[ContentController] Building home payload');
      
      const trending = await this.provider.getTrending();
      const genresList = await this.provider.getGenres();
      
      // Fetch the first 8 predefined genres as it was in the old monolith
      const targetGenres = [{ id: 'bollywood', name: 'Latest in India' }, ...genresList.slice(0, 7)];
      const categories: Record<string, any[]> = {};

      // Fetch all genres in parallel
      const genreResults = await Promise.all(
        targetGenres.map(async (genre) => {
          try {
            const { movies } = await this.provider.getCategoryItems(String(genre.id));
            return { id: genre.id, movies };
          } catch (err) {
            logger.warn(`Failed to fetch category ${genre.id}`);
            return { id: genre.id, movies: [] };
          }
        })
      );

      genreResults.forEach(result => {
        if (result.movies.length > 0) {
          categories[String(result.id)] = result.movies;
        }
      });

      res.json({
        trending,
        genres: [{ id: 'bollywood', name: 'Latest in India' }, ...genresList],
        categories
      });
    } catch (error: any) {
      logger.error(`[ContentController] Error fetching home payload: ${error.message} (Cause: ${error.cause})`);
      res.status(500).json({ error: 'Failed to load home data' });
    }
  }

  public async getTrending(req: Request, res: Response): Promise<void> {
    try {
      const limit = parseInt(req.query.limit as string) || 12;
      const page = parseInt(req.query.page as string) || 1;
      logger.info(`[ContentController] Fetching trending page=${page} limit=${limit}`);

      const trending = await this.provider.getTrending(page, limit);
      res.json({ movies: trending, pagination: { page, limit, pages: 500 } });
    } catch (error: any) {
      logger.error(`[ContentController] Error fetching trending payload: ${error.message}`);
      res.status(500).json({ error: 'Failed to load trending data' });
    }
  }

  public async getMoviesByGenre(req: Request, res: Response): Promise<void> {
    try {
      const genre = req.query.genre as string;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 36;

      if (!genre) {
        res.status(400).json({ error: 'genre query param is required' });
        return;
      }

      logger.info(`[ContentController] Fetching movies for genre=${genre} page=${page} limit=${limit}`);
      const { movies, totalPages } = await this.provider.getCategoryItems(genre, page, limit);
      res.json({ movies, pagination: { page, limit, pages: totalPages } });
    } catch (error: any) {
      logger.error(`[ContentController] Error fetching movies by genre: ${error.message}`);
      res.status(500).json({ error: 'Failed to load genre movies' });
    }
  }

  public async search(req: Request, res: Response): Promise<void> {
    try {
      const q = req.query.q as string;
      const stream = req.query.stream as string;
      const type = (req.query.type as string) || 'content';
      const limit = parseInt(req.query.limit as string) || 40;

      if (!q || q.length < 2) {
        res.json({ query: q || '', results: [] });
        return;
      }

      const { normalize, computeFinalScore, INDIAN_LANGS, normalizePerson, normalizeUser, isIndianPerson } = require('./utils/legacyScores');

      logger.info(`[ContentController] Searching for ${q}`);

      const base_query = q.trim();
      const yearMatch = base_query.match(/\b(19\d{2}|20\d{2})\b/);
      const year_query = yearMatch ? yearMatch[1] : null;
      const altered_query = year_query ? base_query.replace(year_query, '').replace(/\s+/g, ' ').trim() : base_query;
      const hasYear = Boolean(year_query);

      if (type === 'users') {
        const users = await this.searchUsers(base_query, limit);
        const results = users
          .filter((user) => user?.username)
          .slice(0, limit)
          .map(normalizeUser);
        res.json({ query: q, results });
        return;
      }

      if (stream === '1') {
        res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders?.();
        let clientClosed = false;
        const seen = new Set<string>();
        req.on('close', () => { clientClosed = true; });

        const writeEvent = (payload: any) => {
          if (!clientClosed && !res.writableEnded) res.write(`${JSON.stringify(payload)}\n`);
        };

        const normalizeChunk = (items: any[], mediaType: string) => {
          return (Array.isArray(items) ? items : [])
            .filter(item => item?.id && item?.adult !== true)
            .map(item => {
              if (mediaType === 'person') {
                return {
                  ...normalizePerson(item),
                  _isIndian: isIndianPerson(item),
                  _popularity: Number(item?.popularity || 0)
                };
              }
              const normalized = normalize(item, mediaType === 'movie' ? 'movie' : 'tv');
              return {
                ...normalized,
                media_type: mediaType === 'movie' ? 'Movie' : 'Series',
                score: computeFinalScore(normalized, hasYear ? altered_query : q, year_query),
                isIndian: INDIAN_LANGS.has(normalized.originalLanguage) || normalized.originCountry.includes('IN')
              };
            })
            .filter(item => mediaType === 'person' || item.score > 25)
            .sort((a: any, b: any) => {
              if (mediaType === 'person') {
                if (a._isIndian !== b._isIndian) return a._isIndian ? -1 : 1;
                return b._popularity - a._popularity;
              }
              if (hasYear) {
                const yr = Number(year_query);
                const aExact = a.release_year === yr ? 1 : 0;
                const bExact = b.release_year === yr ? 1 : 0;
                if (aExact !== bExact) return bExact - aExact;
              }
              return b.score - a.score;
            })
            .map(({ _isIndian, _popularity, ...item }) => item);
        };

        const fetchPage = async (tmdbType: string, query: string, page: number, year: string | null = null) => {
          if (clientClosed) return;
          let url = `/3/search/${tmdbType}?query=${encodeURIComponent(query)}&include_adult=false&language=en-US&page=${page}`;
          if (year && tmdbType !== 'person') url += (tmdbType === 'movie' ? `&year=${year}` : `&first_air_date_year=${year}`);
          
          try {
            const data = await this.provider.getRawTMDB(url);
            if (data?.results?.length) {
              const normalized = normalizeChunk(data.results, tmdbType)
                .filter((item: any) => {
                  const key = `${item.media_type}:${item.id}`;
                  if (seen.has(key)) return false;
                  seen.add(key);
                  return true;
                })
                .slice(0, Math.max(limit, 20));
              if (normalized.length > 0) writeEvent({ type: 'results', query: q, page, source: tmdbType, results: normalized });
            }
          } catch (error: any) {
            logger.error(`[ContentController] Stream fetch error for ${tmdbType} p${page}: ${error.message}`);
            writeEvent({ type: 'page-error', query: q, page, source: tmdbType });
          }
        };

        writeEvent({ type: 'start', query: q });
        const mainPages = hasYear ? 3 : 7;
        const pagePromises = [];

        if (type === 'content' || type === 'all') {
          for (let page = 1; page <= mainPages; page++) {
            pagePromises.push(fetchPage('movie', altered_query, page));
            pagePromises.push(fetchPage('tv', altered_query, page));
          }
          if (hasYear && altered_query.length >= 2) {
            for (let page = 1; page <= 2; page++) {
              pagePromises.push(fetchPage('movie', altered_query, page, year_query));
              pagePromises.push(fetchPage('tv', altered_query, page, year_query));
            }
          }
        }

        if (type === 'cast' || type === 'all') {
          for (let page = 1; page <= 3; page++) {
            pagePromises.push(fetchPage('person', base_query, page));
          }
        }

        Promise.allSettled(pagePromises).finally(() => {
          writeEvent({ type: 'done', query: q });
          res.end();
        });
        return;
      }

      const allMovies: any[] = [];
      const allTv: any[] = [];
      const allPeople: any[] = [];
      const promises: Promise<void>[] = [];

      const queuePages = (tmdbType: string, query: string, maxPages: number, year: string | null = null) => {
        for (let page = 1; page <= maxPages; page++) {
          let url = `/3/search/${tmdbType}?query=${encodeURIComponent(query)}&include_adult=false&language=en-US&page=${page}`;
          if (year && tmdbType !== 'person') url += (tmdbType === 'movie' ? `&year=${year}` : `&first_air_date_year=${year}`);
          promises.push(
            this.provider.getRawTMDB(url)
              .then((data) => {
                if (tmdbType === 'movie') allMovies.push(...(data.results || []));
                else if (tmdbType === 'tv') allTv.push(...(data.results || []));
                else if (tmdbType === 'person') allPeople.push(...(data.results || []));
              })
              .catch(() => {})
          );
        }
      };

      if (type === 'content' || type === 'all') {
        if (!hasYear) {
          queuePages('movie', base_query, 7);
          queuePages('tv', base_query, 7);
        } else {
          queuePages('movie', base_query, 3);
          queuePages('tv', base_query, 3);
          if (altered_query.length >= 2) {
            queuePages('movie', altered_query, 2, year_query);
            queuePages('tv', altered_query, 2, year_query);
          }
        }
      }

      if (type === 'cast' || type === 'all') {
        queuePages('person', base_query, 3);
      }

      await Promise.all(promises);

      let results: any[] = [];
      if (type === 'content' || type === 'all') {
        const seen = new Set<string>();
        const scored = [
          ...allMovies.filter((item) => item?.adult !== true).map((m) => normalize(m, 'movie')),
          ...allTv.filter((item) => item?.adult !== true).map((t) => normalize(t, 'tv'))
        ]
          .map((item) => ({
            ...item,
            score: computeFinalScore(item, hasYear ? altered_query : q, year_query),
            isIndian: INDIAN_LANGS.has(item.originalLanguage) || item.originCountry.includes('IN')
          }))
          .filter((item) => {
            if (item.score <= 25) return false;
            const key = `${item.media_type}:${item.id}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });

        if (hasYear) {
          const yr = Number(year_query);
          const exact = scored.filter((i) => i.release_year === yr).sort((a, b) => b.score - a.score);
          const rest = scored.filter((i) => i.release_year !== yr).sort((a, b) => b.score - a.score);
          results = [...exact, ...rest].slice(0, limit);
        } else {
          results = scored.sort((a, b) => b.score - a.score).slice(0, limit);
        }
      }

      const personResults = allPeople
        .filter((person) => person?.id && person?.name)
        .map((person) => ({
          ...normalizePerson(person),
          _isIndian: isIndianPerson(person),
          _popularity: Number(person?.popularity || 0)
        }))
        .sort((a, b) => {
          if (a._isIndian !== b._isIndian) return a._isIndian ? -1 : 1;
          return b._popularity - a._popularity;
        })
        .map(({ _isIndian, _popularity, ...item }) => item);

      if (type === 'cast') {
        results = personResults.slice(0, limit);
      } else if (type === 'all') {
        const topPeople = personResults.slice(0, 4);
        const reservedSlots = Math.min(topPeople.length, 4, limit);
        const primarySlots = Math.max(limit - reservedSlots, 0);
        results = [...results.slice(0, primarySlots), ...topPeople].slice(0, limit);
      }

      res.json({ query: q, results });
    } catch (error: any) {
      logger.error(`[ContentController] Error fetching search payload: ${error.message}`);
      res.status(500).json({ error: 'Failed to fetch search data' });
    }
  }

  public async proxyTMDB(req: Request, res: Response): Promise<void> {
    try {
      const endpoint = req.header('x-tmdb-endpoint');
      if (!endpoint) {
        res.status(400).json({ error: 'Missing TMDB endpoint header' });
        return;
      }
      logger.info(`[ContentController] Proxying TMDB endpoint: ${endpoint}`);
      const data = await this.provider.getRawTMDB(endpoint);
      res.json(data);
    } catch (error: any) {
      logger.error(`[ContentController] Error proxying TMDB: ${error.message}`);
      res.status(500).json({ error: 'Failed to proxy TMDB data' });
    }
  }

  public async getRatings(req: Request, res: Response): Promise<void> {
    try {
      const limit = Math.min(Math.max(Number(req.query.limit) || 5000, 1), 10000);
      const mediaType = req.query.mediaType ? String(req.query.mediaType) : '';
      const query = mediaType ? { mediaType } : {};

      const items = await this.ratingsRepo?.getRatings(query, limit);
      res.json({ items: items || [] });
    } catch (error: any) {
      logger.error(`[ContentController] Error fetching ratings table: ${error.message}`);
      res.status(500).json({ error: 'Failed to fetch ratings table' });
    }
  }

  public async getRating(req: Request, res: Response): Promise<void> {
    try {
      const mediaType = String(req.params.mediaType);
      const tmdbID = Number(req.params.tmdbID);
      if (!tmdbID) {
        res.status(400).json({ error: 'Valid tmdbID is required' });
        return;
      }

      const item = await this.ratingsRepo?.getRating(tmdbID, mediaType);
      if (!item) {
        res.status(404).json({ error: 'Rating row not found' });
        return;
      }

      res.json(item);
    } catch (error: any) {
      logger.error(`[ContentController] Error fetching rating: ${error.message}`);
      res.status(500).json({ error: 'Failed to fetch rating' });
    }
  }

  public async enrichRatings(req: Request, res: Response): Promise<void> {
    try {
      const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
      if (!rawItems.length) {
        res.status(400).json({ error: 'Items are required' });
        return;
      }

      // Simplified placeholder for the original IMDB resolution.
      const results = [];
      for (const rawItem of rawItems) {
        const tmdbID = Number(rawItem?.tmdbID || rawItem?.contentId || rawItem?.id || 0);
        const mediaType = String(rawItem?.mediaType || rawItem?.media_type || rawItem?.type);
        if (!tmdbID) continue;
        
        results.push({
          tmdbID,
          mediaType,
          imdbID: '',
          imdb_rating: null,
          vote_average: null,
          source: 'error'
        });
      }

      res.json({ items: results });
    } catch (error: any) {
      logger.error(`[ContentController] Error enriching ratings: ${error.message}`);
      res.status(500).json({ error: 'Failed to enrich IMDB ratings' });
    }
  }
}
