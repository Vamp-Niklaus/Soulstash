import { Request, Response } from 'express';
import { MongoClient } from 'mongodb';
import { IContentProvider } from '../../shared/src/interfaces/IContentProvider';
import { logger } from '../../shared/src/utils/Logger';
import { config } from '../../shared/src/utils/ConfigManager';

import { MongoRatingsRepository, INVALID_IMDB_SENTINEL, SEVEN_DAYS_MS } from './repositories/MongoRatingsRepository';
import { ContentCacheRepository } from './repositories/ContentCacheRepository';

// eslint-disable-next-line @typescript-eslint/no-require-imports
import fetch from 'node-fetch';

let omdbKeyIndex = 0;
function getOmdbKey(): string {
  const keys = [
    process.env.OMDB_API_KEY1,
    process.env.OMDB_API_KEY2,
    process.env.OMDB_API_KEY3,
    process.env.OMDB_API_KEY4,
    process.env.OMDB_API_KEY5,
  ].filter(k => typeof k === 'string' && k.trim() !== '');

  if (keys.length === 0) return 'e2abb062';
  
  const key = keys[omdbKeyIndex % keys.length] as string;
  omdbKeyIndex++;
  return key;
}
/**
 * Controller for Content-related routes.
 */
export class ContentController {
  private usersClient: MongoClient | null = null;
  private cacheRepo = new ContentCacheRepository();

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

  private async fetchHomePayload() {
    // Only apply vote_count filter to these genres (IDs from TMDB)
    const VOTE_FILTERED_GENRE_IDS = new Set(['27', '10749', '99']); // Horror, Romance, Documentary
    const MIN_VOTE_COUNT = 1000;
    const TARGET_COUNT = 20;   // minimum items per filtered genre in cache
    const MAX_PAGES = 5;       // max pages to try per filtered genre

    /**
     * For vote-filtered genres: keep fetching pages until we have TARGET_COUNT items
     * with vote_count >= MIN_VOTE_COUNT, or we exhaust MAX_PAGES.
     */
    const fetchFilteredGenre = async (genreId: string): Promise<any[]> => {
      const collected: any[] = [];
      for (let page = 1; page <= MAX_PAGES && collected.length < TARGET_COUNT; page++) {
        try {
          const { movies } = await this.provider.getCategoryItems(genreId, page, 20);
          const passing = movies.filter((m: any) => (m.vote_count || 0) >= MIN_VOTE_COUNT);
          collected.push(...passing);
          logger.info(`[ContentController] Genre ${genreId} page ${page}: ${movies.length} raw, ${passing.length} passing vote filter — total ${collected.length}/${TARGET_COUNT}`);
          if (movies.length === 0) break; // TMDB returned no more results
        } catch (err: any) {
          logger.warn(`[ContentController] Genre ${genreId} page ${page} fetch failed: ${err.message}`);
          break;
        }
      }
      return collected.slice(0, TARGET_COUNT);
    };

    const trendingRaw = await this.provider.getTrending();
    const genresList = await this.provider.getGenres();

    const targetGenres = [{ id: 'bollywood', name: 'Latest in India' }, ...genresList];
    const categories: Record<string, any[]> = {};

    const genreResults = await Promise.all(
      targetGenres.map(async (genre) => {
        const gid = String(genre.id);
        try {
          let movies: any[];
          if (VOTE_FILTERED_GENRE_IDS.has(gid)) {
            movies = await fetchFilteredGenre(gid);
            logger.info(`[ContentController] Genre ${gid} (filtered): ${movies.length} items cached after vote_count>=${MIN_VOTE_COUNT} filter.`);
          } else {
            const result = await this.provider.getCategoryItems(gid);
            movies = result.movies;
            logger.info(`[ContentController] Genre ${gid}: ${movies.length} movies.`);
          }
          return { id: gid, movies };
        } catch (err: any) {
          logger.warn(`Failed to fetch category ${gid}: ${err.message}`);
          return { id: gid, movies: [] };
        }
      })
    );

    genreResults.forEach(result => {
      if (result.movies.length > 0) {
        categories[String(result.id)] = result.movies;
      } else {
        logger.warn(`[ContentController] Skipping genre ${result.id} because movies array is empty.`);
      }
    });

    logger.info(`[ContentController] Successfully fetched ${Object.keys(categories).length} categories out of ${targetGenres.length} target genres.`);

    return {
      trending: trendingRaw,
      genres: [{ id: 'bollywood', name: 'Latest in India' }, ...genresList],
      categories
    };
  }

  public async getHome(req: Request, res: Response): Promise<void> {
    try {
      const cacheKey = 'home_payload';
      const cached = await this.cacheRepo.getCache(cacheKey);

      if (cached && cached.data) {
        const ageHours = (Date.now() - new Date(cached.updatedAt).getTime()) / (1000 * 60 * 60);
        if (ageHours > 24) {
          logger.info(`[ContentController] home_payload cache stale (${ageHours.toFixed(1)}h). Triggering background refresh.`);
          this.fetchHomePayload()
            .then(data => this.cacheRepo.setCache(cacheKey, data))
            .catch(err => logger.error(`Background refresh failed: ${err.message}`));
        } else {
          logger.info('[ContentController] Serving home_payload from cache');
        }
        res.json(cached.data);
        return;
      }

      logger.info('[ContentController] Cache miss for home_payload. Fetching live...');
      const payload = await this.fetchHomePayload();
      await this.cacheRepo.setCache(cacheKey, payload);
      res.json(payload);
    } catch (error: any) {
      logger.error(`[ContentController] Error fetching home payload: ${error.message} (Cause: ${error.cause})`);
      res.status(500).json({ error: 'Failed to load home data' });
    }
  }

  public async getTrending(req: Request, res: Response): Promise<void> {
    try {
      const limit = parseInt(req.query.limit as string) || 12;
      const page = parseInt(req.query.page as string) || 1;

      if (page === 1 && limit === 12) {
        const cacheKey = 'trending_page_1';
        const cached = await this.cacheRepo.getCache(cacheKey);

        if (cached && cached.data) {
          const ageHours = (Date.now() - new Date(cached.updatedAt).getTime()) / (1000 * 60 * 60);
          if (ageHours > 24) {
            logger.info(`[ContentController] trending_page_1 cache stale (${ageHours.toFixed(1)}h). Triggering background refresh.`);
            this.provider.getTrending(page, limit)
              .then(trending => this.cacheRepo.setCache(cacheKey, { movies: trending, pagination: { page, limit, pages: 500 } }))
              .catch(err => logger.error(`Trending background refresh failed: ${err.message}`));
          } else {
            logger.info('[ContentController] Serving trending_page_1 from cache');
          }
          res.json(cached.data);
          return;
        }

        logger.info(`[ContentController] Cache miss for trending_page_1. Fetching live...`);
        const trending = await this.provider.getTrending(page, limit);
        const payload = { movies: trending, pagination: { page, limit, pages: 500 } };
        await this.cacheRepo.setCache(cacheKey, payload);
        res.json(payload);
        return;
      }

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

      if (page === 1 && limit === 36) {
        const cacheKey = `genre_${genre}_page_1`;
        const cached = await this.cacheRepo.getCache(cacheKey);

        if (cached && cached.data) {
          const ageHours = (Date.now() - new Date(cached.updatedAt).getTime()) / (1000 * 60 * 60);
          if (ageHours > 24) {
            logger.info(`[ContentController] ${cacheKey} cache stale (${ageHours.toFixed(1)}h). Triggering background refresh.`);
            this.provider.getCategoryItems(genre, page, limit)
              .then(({ movies, totalPages }) => this.cacheRepo.setCache(cacheKey, { movies, pagination: { page, limit, pages: totalPages } }))
              .catch(err => logger.error(`Genre background refresh failed: ${err.message}`));
          } else {
            logger.info(`[ContentController] Serving ${cacheKey} from cache`);
          }
          res.json(cached.data);
          return;
        }

        logger.info(`[ContentController] Cache miss for ${cacheKey}. Fetching live...`);
        const { movies, totalPages } = await this.provider.getCategoryItems(genre, page, limit);
        const payload = { movies, pagination: { page, limit, pages: totalPages } };
        await this.cacheRepo.setCache(cacheKey, payload);
        res.json(payload);
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

  // Same "looks fake / not a real rating" guard used on the frontend
  // (getValidImdbRating / getValidVoteAverage): treat <=0, exactly 10, or
  // >=9.4 as unreliable and report it as null so it renders "N/A" instead
  // of a number nobody asked to fetch.
  private static sanitizeRating(value: any): number | null {
    const rating = Number(value);
    if (!Number.isFinite(rating) || rating <= 0 || rating === 10 || rating >= 9.4) return null;
    return rating;
  }

  /**
   * Resolve ratings for a batch of credit items.
   *
   * Strategy per item:
   *  1. Check DB cache via findCachedRating (cache-first, no external call needed).
   *  2. Cache miss → fetch TMDB detail to get imdb_id + vote_average.
   *  3. If imdb_id found → fetch OMDB for imdb_rating (retries on network fail).
   *  4. If OMDB network fails after all retries → fall back to vote_average only.
   *  5. If OMDB returns N/A or no rating → sentinel stored, vote_average used.
   *  6. If no imdb_id from TMDB → sentinel stored, vote_average used.
   *  7. vote_average >= 9.4 is stripped (treated as unreliable placeholder).
   *
   * Both imdb_rating and vote_average are included in the result so the UI
   * can prefer imdb_rating and fall back to vote_average automatically.
   */
  private async resolveAllRatings(items: any[] = []): Promise<any[]> {
    const list = Array.isArray(items) ? items : [];
    const eligible = list.filter(
      (item) => item?.id && (item?.media_type === 'movie' || item?.media_type === 'tv')
    );
    if (!eligible.length || !this.ratingsRepo) return list;

    // ── Step 1: Bulk cache lookup for all items at once ──────────────────────
    const tmdbIds = [...new Set(eligible.map((item) => Number(item.id)).filter(Boolean))];
    const cachedRecords = await this.ratingsRepo.getRatings({ tmdbID: { $in: tmdbIds } }, tmdbIds.length).catch(() => []);

    // Build a map of valid cached records (same rules as findCachedRating).
    const cacheMap = new Map<string, any>();
    for (const record of cachedRecords) {
      const isSentinel = record.imdb_rating === INVALID_IMDB_SENTINEL;
      const hasRealRating = typeof record.imdb_rating === 'number' &&
        Number.isFinite(record.imdb_rating) &&
        record.imdb_rating > 0 &&
        !isSentinel;

      if (hasRealRating) {
        cacheMap.set(`${record.mediaType}:${record.tmdbID}`, record);
        continue;
      }
      if (isSentinel) {
        const ageMs = record.updatedAt ? Date.now() - new Date(record.updatedAt).getTime() : Infinity;
        if (ageMs < SEVEN_DAYS_MS) {
          cacheMap.set(`${record.mediaType}:${record.tmdbID}`, record);
        }
        // Older than 7 days → not added to cacheMap → will be re-fetched.
      }
      // null rating with no sentinel → not added → will be re-fetched.
    }

    // ── Step 2: Live-fetch everything not in cache (parallel, concurrency=6) ─
    const needsFetch = eligible.filter((item) => {
      const mediaType = item.media_type === 'tv' ? 'Series' : 'Movie';
      return !cacheMap.has(`${mediaType}:${Number(item.id)}`);
    });

    if (needsFetch.length) {
      logger.info(`[resolveAllRatings] cache=${eligible.length - needsFetch.length} fetch=${needsFetch.length}`);
      const CONCURRENCY = 6;
      let nextIndex = 0;
      const worker = async () => {
        while (true) {
          const idx = nextIndex++;
          if (idx >= needsFetch.length) return;
          const item = needsFetch[idx];
          const tmdbID = Number(item.id);
          const mediaType = item.media_type === 'tv' ? 'Series' : 'Movie';
          const tmdbEndpoint = item.media_type === 'tv' ? 'tv' : 'movie';
          const cacheKey = `${mediaType}:${tmdbID}`;

          try {
            const tmdbApiKey = config.get('tmdbApiKey') || process.env.TMDB_API_KEY;

            // Use imdb_id already on the TMDB credit object when available
            // (movies usually have it; TV shows don't — need external_ids).
            let imdbId: string = typeof item.imdb_id === 'string' ? item.imdb_id.trim() : '';
            let voteAverage: number | null = null;

            // Always fetch TMDB detail: we need vote_average + imdb_id for TV,
            // and vote_average is more accurate from the detail endpoint anyway.
            const tmdbData = await this.fetchTmdbDetailWithRetry(
              `https://api.themoviedb.org/3/${tmdbEndpoint}/${tmdbID}?api_key=${tmdbApiKey}&append_to_response=external_ids&language=en-US`,
              `TMDB detail tmdbID=${tmdbID}`
            );
            imdbId = imdbId || tmdbData.imdb_id || tmdbData.external_ids?.imdb_id || '';
            voteAverage = ContentController.sanitizeRating(tmdbData.vote_average ?? item.vote_average);

            if (!imdbId) {
              // No IMDB ID available — store sentinel, use vote_average only.
              const doc = {
                tmdbID, mediaType, imdbID: '',
                imdb_rating: INVALID_IMDB_SENTINEL,
                vote_average: voteAverage,
                lookup_attempted: true, source: 'no_imdb_id'
              };
              await this.ratingsRepo!.saveRating(doc).catch(() => {});
              cacheMap.set(cacheKey, doc);
              continue;
            }

            // Fetch OMDB. fetchOmdbWithRetry already retries on network failure.
            const omdbData: any = await this.fetchOmdbWithRetry(imdbId);
            const omdbRatingStr: string = omdbData?.imdbRating || '';
            const imdbRating = omdbRatingStr && omdbRatingStr !== 'N/A'
              ? ContentController.sanitizeRating(parseFloat(omdbRatingStr))
              : null;

            const doc = {
              tmdbID, mediaType, imdbID: imdbId,
              // Store sentinel when imdb_rating is null so we don't re-fetch for 7 days.
              imdb_rating: imdbRating ?? INVALID_IMDB_SENTINEL,
              vote_average: voteAverage,
              lookup_attempted: true,
              source: imdbRating != null ? 'omdb'
                : omdbRatingStr === 'N/A' ? 'omdb_na'
                : Object.keys(omdbData).length === 0 ? 'omdb_network_fail'
                : 'omdb_failed'
            };
            await this.ratingsRepo!.saveRating(doc).catch(() => {});
            cacheMap.set(cacheKey, doc);

          } catch (err: any) {
            // Transient error — don't write sentinel, allow retry next time.
            logger.warn(`[resolveAllRatings] error tmdbID=${tmdbID}: ${err.message}`);
          }
        }
      };

      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, needsFetch.length) }, () => worker()));
    }

    // ── Step 3: Merge resolved ratings back onto the original list ───────────
    return list.map((item) => {
      if (!item?.id || (item?.media_type !== 'movie' && item?.media_type !== 'tv')) return item;

      const mediaType = item.media_type === 'tv' ? 'Series' : 'Movie';
      const record = cacheMap.get(`${mediaType}:${Number(item.id)}`);
      if (!record) return item; // fetch failed transiently — send raw item

      const isSentinel = record.imdb_rating === INVALID_IMDB_SENTINEL;
      return {
        ...item,
        imdb_id: String(record.imdbID || item.imdb_id || '').trim(),
        // Return null when sentinel — UI will show N/A.
        imdb_rating: isSentinel ? null : ContentController.sanitizeRating(record.imdb_rating),
        // Prefer the more-accurate detail-endpoint vote_average from our record;
        // sanitizeRating strips >= 9.4 here too.
        vote_average: record.vote_average ?? ContentController.sanitizeRating(item.vote_average),
        rating_lookup_attempted: true
      };
    });
  }


  public async getPersonCredits(req: Request, res: Response): Promise<void> {
    try {
      const personId = req.params.id;
      logger.info(`[ContentController] Fetching person credits personId=${personId}`);

      // Fetch person detail (for imdb_id) + credits in parallel
      const [personDetail, payload] = await Promise.all([
        this.provider.getRawTMDB(`/3/person/${personId}?language=en-US`).catch(() => ({})),
        this.provider.getRawTMDB(`/3/person/${personId}/combined_credits?language=en-US`)
      ]);
      const imdbPersonId: string = (personDetail as any)?.imdb_id || '';

      const cast: any[] = Array.isArray(payload.cast) ? payload.cast : [];
      const crew: any[] = Array.isArray(payload.crew) ? payload.crew : [];

      // Stream response as NDJSON so the frontend can render credits immediately
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();

      let clientClosed = false;
      req.on('close', () => { clientClosed = true; });

      const write = (obj: any) => {
        if (!clientClosed && !res.writableEnded) res.write(`${JSON.stringify(obj)}\n`);
      };

      // First line: raw credits — frontend renders the grid instantly.
      write({ type: 'credits', cast, crew });

      // De-dupe by tmdbID+mediaType
      const eligible = [...cast, ...crew].filter(
        (item) => item?.id && (item?.media_type === 'movie' || item?.media_type === 'tv')
      );
      const seen = new Set<string>();
      const unique = eligible.filter((item) => {
        const key = `${item.media_type === 'tv' ? 'Series' : 'Movie'}:${Number(item.id)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      if (!unique.length || !this.ratingsRepo) {
        write({ type: 'done' });
        if (!res.writableEnded) res.end();
        return;
      }

      // Kick off IMDB scrape in parallel with the DB cache check (if we have an imdb person id)
      const SCRAPER_SERVICE_URL = process.env.SCRAPER_SERVICE_URL || 'http://localhost:3004';
      const imdbScrapePromise: Promise<Map<string, any>> = imdbPersonId
        ? fetch(`${SCRAPER_SERVICE_URL}/api/imdb/person/${imdbPersonId}/filmography`)
            .then(res => res.json())
            .then(filmography => {
               // Ported matchCreditsToFilmography logic locally since it's just array mapping
               const imdbMap = new Map<string, any>();
               if (Array.isArray(filmography)) {
                  filmography.forEach((entry: any) => {
                     const normTitle = String(entry.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                     const year = Number(entry.year) || 0;
                     if (normTitle && year) {
                       imdbMap.set(`${normTitle}_${year}`, entry);
                       imdbMap.set(`${normTitle}_${year - 1}`, entry);
                       imdbMap.set(`${normTitle}_${year + 1}`, entry);
                     }
                  });
               }
               return imdbMap;
            })
            .catch(err => {
              logger.error(`[getPersonCredits] IMDB scrape failed for ${imdbPersonId}: ${err.message}`);
              return new Map();
            })
        : Promise.resolve(new Map());

      // Bulk cache check up-front
      const tmdbIds = unique.map((item) => Number(item.id));
      const cachedRecords = await this.ratingsRepo.getRatings({ tmdbID: { $in: tmdbIds } }, tmdbIds.length).catch(() => []);
      const cacheMap = new Map<string, any>();
      for (const record of cachedRecords) {
        const isSentinel = record.imdb_rating === INVALID_IMDB_SENTINEL;
        const hasRealRating = typeof record.imdb_rating === 'number' &&
          Number.isFinite(record.imdb_rating) && record.imdb_rating > 0 && !isSentinel;
        if (hasRealRating) { cacheMap.set(`${record.mediaType}:${record.tmdbID}`, record); continue; }
        if (isSentinel) {
          const ageMs = record.updatedAt ? Date.now() - new Date(record.updatedAt).getTime() : Infinity;
          if (ageMs < SEVEN_DAYS_MS) cacheMap.set(`${record.mediaType}:${record.tmdbID}`, record);
        }
      }

      // Flush cached items immediately
      const cachedResults: any[] = [];
      const needsFetch: any[] = [];
      for (const item of unique) {
        const key = `${item.media_type === 'tv' ? 'Series' : 'Movie'}:${Number(item.id)}`;
        const record = cacheMap.get(key);
        if (record) {
          const isSentinel = record.imdb_rating === INVALID_IMDB_SENTINEL;
          cachedResults.push({
            tmdbID: Number(item.id),
            mediaType: item.media_type === 'tv' ? 'Series' : 'Movie',
            imdb_id: String(record.imdbID || item.imdb_id || '').trim(),
            imdb_rating: isSentinel ? null : ContentController.sanitizeRating(record.imdb_rating),
            vote_average: record.vote_average ?? ContentController.sanitizeRating(item.vote_average),
            rating_lookup_attempted: true
          });
        } else {
          needsFetch.push(item);
        }
      }

      if (cachedResults.length) write({ type: 'ratings', items: cachedResults });

      if (needsFetch.length) {
        // Wait for the IMDB scrape to settle before processing needsFetch
        const imdbMatchMap = await imdbScrapePromise;
        logger.info(`[getPersonCredits] IMDB scrape matched ${imdbMatchMap.size}/${needsFetch.length} items`);

        // Split: IMDB-matched (fast path) vs still-needs-TMDB+OMDB
        const imdbMatched: any[] = [];
        const stillNeedsFetch: any[] = [];

        for (const item of needsFetch) {
          const tmdbID = Number(item.id);
          const mediaType = item.media_type === 'tv' ? 'Series' : 'Movie';
          const mapKey = `${tmdbID}:${mediaType}`;
          const match = imdbMatchMap.get(mapKey);
          if (match && match.imdb_rating != null) {
            imdbMatched.push({ item, match });
          } else {
            stillNeedsFetch.push(item);
          }
        }

        // Flush IMDB-scraped ratings immediately + persist to DB
        if (imdbMatched.length) {
          const imdbResults = await Promise.all(imdbMatched.map(async ({ item, match }) => {
            const tmdbID = Number(item.id);
            const mediaType = item.media_type === 'tv' ? 'Series' : 'Movie';
            const imdbRating = ContentController.sanitizeRating(match.imdb_rating);
            const voteAverage = ContentController.sanitizeRating(item.vote_average);
            const imdbId: string = match.imdb_id || '';
            const doc = {
              tmdbID, mediaType, imdbID: imdbId,
              imdb_rating: imdbRating ?? INVALID_IMDB_SENTINEL,
              vote_average: voteAverage,
              lookup_attempted: true,
              source: 'imdb_scrape'
            };
            await this.ratingsRepo!.saveRating(doc).catch(() => {});
            return { tmdbID, mediaType, imdb_id: imdbId, imdb_rating: imdbRating, vote_average: voteAverage, rating_lookup_attempted: true };
          }));
          write({ type: 'ratings', items: imdbResults });
        }

        // Fall through to TMDB+OMDB for anything the scrape didn't cover
        const BATCH_SIZE = 6;
        let i = 0;
        while (!clientClosed && i < stillNeedsFetch.length) {
          const batch = stillNeedsFetch.slice(i, i + BATCH_SIZE);
          i += BATCH_SIZE;

          const batchResults = await Promise.all(batch.map(async (item) => {
            const tmdbID = Number(item.id);
            const mediaType = item.media_type === 'tv' ? 'Series' : 'Movie';
            const tmdbEndpoint = item.media_type === 'tv' ? 'tv' : 'movie';
            try {
              const tmdbApiKey = config.get('tmdbApiKey') || process.env.TMDB_API_KEY;
              let imdbId: string = typeof item.imdb_id === 'string' ? item.imdb_id.trim() : '';
              const tmdbData = await this.fetchTmdbDetailWithRetry(
                `https://api.themoviedb.org/3/${tmdbEndpoint}/${tmdbID}?api_key=${tmdbApiKey}&append_to_response=external_ids&language=en-US`,
                `TMDB detail tmdbID=${tmdbID}`
              );
              imdbId = imdbId || tmdbData.imdb_id || tmdbData.external_ids?.imdb_id || '';
              const voteAverage = ContentController.sanitizeRating(tmdbData.vote_average ?? item.vote_average);

              if (!imdbId) {
                const doc = { tmdbID, mediaType, imdbID: '', imdb_rating: INVALID_IMDB_SENTINEL, vote_average: voteAverage, lookup_attempted: true, source: 'no_imdb_id' };
                await this.ratingsRepo!.saveRating(doc).catch(() => {});
                return { tmdbID, mediaType, imdb_id: '', imdb_rating: null, vote_average: voteAverage, rating_lookup_attempted: true };
              }

              const omdbData: any = await this.fetchOmdbWithRetry(imdbId);
              const omdbRatingStr: string = omdbData?.imdbRating || '';
              const imdbRating = omdbRatingStr && omdbRatingStr !== 'N/A'
                ? ContentController.sanitizeRating(parseFloat(omdbRatingStr)) : null;

              const doc = { tmdbID, mediaType, imdbID: imdbId, imdb_rating: imdbRating ?? INVALID_IMDB_SENTINEL, vote_average: voteAverage, lookup_attempted: true, source: imdbRating != null ? 'omdb' : omdbRatingStr === 'N/A' ? 'omdb_na' : 'omdb_failed' };
              await this.ratingsRepo!.saveRating(doc).catch(() => {});
              return { tmdbID, mediaType, imdb_id: imdbId, imdb_rating: imdbRating, vote_average: voteAverage, rating_lookup_attempted: true };
            } catch (err: any) {
              logger.warn(`[getPersonCredits] error tmdbID=${tmdbID}: ${err.message}`);
              return null;
            }
          }));

          const validResults = batchResults.filter(Boolean);
          if (validResults.length) write({ type: 'ratings', items: validResults });
        }
      }

      write({ type: 'done' });
      if (!res.writableEnded) res.end();
    } catch (error: any) {
      logger.error(`[ContentController] Error fetching person credits: ${error.message}`);
      if (!res.headersSent) res.status(500).json({ error: 'Failed to fetch person credits', details: error.message });
      else if (!res.writableEnded) res.end();
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

  // Small retry-with-backoff wrapper for the TMDB detail call. A dropped
  // connection (ECONNRESET, timeout, DNS hiccup) shouldn't permanently sink
  // an item — retry a couple of times with a short backoff before giving up.
  private async fetchTmdbDetailWithRetry(url: string, context: string, maxRetries = 3): Promise<any> {
    const fetch = global.fetch || require('node-fetch');
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          if (response.status === 404) return {};
          if (attempt === maxRetries) {
            logger.warn(`[ContentController] ${context} failed with status ${response.status} after ${attempt} attempts`);
            return {};
          }
          await new Promise((r) => setTimeout(r, 300 * attempt));
          continue;
        }
        return await response.json().catch(() => ({}));
      } catch (err: any) {
        if (attempt === maxRetries) {
          logger.warn(`[ContentController] ${context} network error after ${attempt} attempts: ${err.message}`);
          return {};
        }
        logger.warn(`[ContentController] ${context} network error attempt ${attempt}/${maxRetries}, retrying: ${err.message}`);
        await new Promise((r) => setTimeout(r, 300 * attempt));
      }
    }
    return {};
  }

  // Same idea for OMDB, but layered on top of the existing key-rotation logic:
  // an "Invalid API key" response rotates to the next key immediately (no
  // delay needed), while a network-level failure (ECONNRESET, timeout) gets
  // a short backoff before retrying with a (possibly different) key.
  private async fetchOmdbWithRetry(imdbId: string, maxAttempts = 4): Promise<any> {
    const fetch = global.fetch || require('node-fetch');
    let networkFailures = 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const currentOmdbKey = getOmdbKey();
      try {
        logger.info(`Fetching OMDB data for imdbID=${imdbId} using key starting with ${currentOmdbKey.substring(0, 2)}... (attempt ${attempt}/${maxAttempts})`);
        const omdbRes = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=${currentOmdbKey}`);
        const omdbData = await omdbRes.json().catch(() => ({}));

        if (omdbData.Response === 'False' && omdbData.Error === 'Invalid API key!') {
          logger.warn(`OMDB Key Invalid (${currentOmdbKey.substring(0, 2)}...), retrying with next key...`);
          continue;
        }
        return omdbData;
      } catch (err: any) {
        networkFailures++;
        if (attempt === maxAttempts) {
          logger.warn(`[ContentController] OMDB fetch network error imdbID=${imdbId} after ${attempt} attempts: ${err.message}`);
          return {};
        }
        logger.warn(`[ContentController] OMDB fetch network error imdbID=${imdbId} attempt ${attempt}/${maxAttempts}, retrying: ${err.message}`);
        await new Promise((r) => setTimeout(r, 300 * networkFailures));
      }
    }
    return {};
  }

  private async resolveOneRating(rawItem: any): Promise<any> {
    const tmdbID = Number(rawItem?.tmdbID || rawItem?.contentId || rawItem?.id || 0);
    let mediaType = String(rawItem?.mediaType || rawItem?.media_type || rawItem?.type).toLowerCase();
    if (mediaType === 'series') mediaType = 'tv';
    const normalizedMediaType = mediaType === 'tv' ? 'Series' : 'Movie';
    if (!tmdbID) return null;

    // ── Cache-first: check DB before hitting any external API ──────────────
    // findCachedRating returns the record if it's still valid (real rating or
    // sentinel < 7 days old). A null means we must go fetch.
    try {
      const cached = await this.ratingsRepo?.findCachedRating(tmdbID, normalizedMediaType);
      if (cached) {
        const isSentinel = cached.imdb_rating === INVALID_IMDB_SENTINEL;
        logger.info(`[resolveOneRating] cache HIT tmdbID=${tmdbID} mediaType=${normalizedMediaType} sentinel=${isSentinel}`);
        return {
          tmdbID,
          mediaType: normalizedMediaType,
          imdbID: cached.imdbID || '',
          // Sentinel means we successfully determined there's no real rating.
          // Return null so the UI shows "N/A" — but we still report lookup_attempted
          // so the UI knows we tried and won't re-queue this item.
          imdb_rating: isSentinel ? null : ContentController.sanitizeRating(cached.imdb_rating),
          vote_average: ContentController.sanitizeRating(cached.vote_average),
          lookup_attempted: true,
          source: cached.source || 'cache'
        };
      }
    } catch (cacheErr: any) {
      // Non-fatal — just log and continue to live fetch.
      logger.warn(`[resolveOneRating] cache lookup failed tmdbID=${tmdbID}: ${cacheErr.message}`);
    }

    // ── Live fetch: TMDB → OMDB ────────────────────────────────────────────
    try {
      // If the frontend already gave us the IMDB ID on the item, use it directly
      // to skip one TMDB round-trip.
      let imdbId: string = typeof rawItem?.imdb_id === 'string' ? rawItem.imdb_id.trim() : '';
      let voteAverage: number | null = null;

      if (!imdbId) {
        const tmdbApiKey = config.get('tmdbApiKey') || process.env.TMDB_API_KEY;
        logger.info(`[resolveOneRating] TMDB fetch START tmdbID=${tmdbID} mediaType=${mediaType}`);
        const tmdbData = await this.fetchTmdbDetailWithRetry(
          `https://api.themoviedb.org/3/${mediaType === 'movie' ? 'movie' : 'tv'}/${tmdbID}?api_key=${tmdbApiKey}&append_to_response=external_ids&language=en-US`,
          `TMDB detail tmdbID=${tmdbID}`
        );
        imdbId = tmdbData.imdb_id || tmdbData.external_ids?.imdb_id || '';
        voteAverage = tmdbData.vote_average ?? null;
        logger.info(`[resolveOneRating] TMDB response tmdbID=${tmdbID} imdb_id=${imdbId || 'null'} vote_average=${voteAverage}`);
      } else {
        voteAverage = rawItem?.vote_average ?? null;
      }

      if (!imdbId) {
        // No IMDB ID found — save sentinel so we don't hammer TMDB for 7 days.
        const sentinelDoc = {
          tmdbID,
          mediaType: normalizedMediaType,
          imdbID: '',
          imdb_rating: INVALID_IMDB_SENTINEL,
          vote_average: ContentController.sanitizeRating(voteAverage),
          lookup_attempted: true,
          source: 'no_imdb_id'
        };
        await this.ratingsRepo?.saveRating(sentinelDoc).catch(() => {});
        return { ...sentinelDoc, imdb_rating: null }; // return null to UI (sentinel is internal)
      }

      // Fetch OMDB rating using the IMDB ID.
      const omdbData: any = await this.fetchOmdbWithRetry(imdbId);

      if (omdbData.Response === 'True' && omdbData.imdbRating && omdbData.imdbRating !== 'N/A') {
        const realRating = ContentController.sanitizeRating(parseFloat(omdbData.imdbRating));
        const doc = {
          tmdbID,
          mediaType: normalizedMediaType,
          imdbID: imdbId,
          // If sanitizeRating filtered it out (e.g. suspicious score), store sentinel
          // so we don't keep retrying, but return null to the UI.
          imdb_rating: realRating ?? INVALID_IMDB_SENTINEL,
          vote_average: ContentController.sanitizeRating(voteAverage),
          lookup_attempted: true,
          source: 'omdb'
        };
        await this.ratingsRepo?.saveRating(doc).catch(() => {});
        return { ...doc, imdb_rating: realRating };
      }

      // OMDB returned N/A or nothing usable — save sentinel for 7-day cooldown.
      if (omdbData.imdbRating === 'N/A') {
        logger.info(`[resolveOneRating] OMDB N/A for imdbID=${imdbId} (unreleased/unknown)`);
      } else {
        logger.warn(`[resolveOneRating] OMDB miss for imdbID=${imdbId}: ${omdbData.Error || 'no rating field'}`);
      }

      const sentinelDoc = {
        tmdbID,
        mediaType: normalizedMediaType,
        imdbID: imdbId,
        imdb_rating: INVALID_IMDB_SENTINEL,
        vote_average: ContentController.sanitizeRating(voteAverage),
        lookup_attempted: true,
        source: omdbData.imdbRating === 'N/A' ? 'omdb_na' : 'omdb_failed'
      };
      await this.ratingsRepo?.saveRating(sentinelDoc).catch(() => {});
      return { ...sentinelDoc, imdb_rating: null }; // return null to UI

    } catch (itemErr: any) {
      logger.error(`[resolveOneRating] unhandled error tmdbID=${tmdbID}: ${itemErr.message}`);
      // Do NOT save sentinel here — this was a network/runtime error, not a
      // confirmed "no rating" result. Let the next request retry.
      return { tmdbID, mediaType: normalizedMediaType, imdbID: '', imdb_rating: null, lookup_attempted: true, source: 'error' };
    }
  }


  public async enrichRatings(req: Request, res: Response): Promise<void> {
    try {
      const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
      logger.info(`Received enrichRatings request with ${rawItems.length} items`);
      if (!rawItems.length) {
        res.status(400).json({ error: 'Items are required' });
        return;
      }

      // Stream results back as NDJSON: each item is resolved (TMDB -> imdbID -> OMDB
      // rating) and written to the response the moment it's ready, instead of
      // buffering the whole batch and sending one big JSON payload at the end.
      // A small worker pool keeps several lookups in flight at once without making
      // any single item wait on the rest of a fixed-size chunk to finish.
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();

      let clientClosed = false;
      req.on('close', () => { clientClosed = true; });

      const writeEvent = (payload: any) => {
        if (!clientClosed && !res.writableEnded) res.write(`${JSON.stringify(payload)}\n`);
      };

      const CONCURRENCY = 6;
      let nextIndex = 0;
      let resolvedCount = 0;

      const worker = async () => {
        while (!clientClosed) {
          const index = nextIndex++;
          if (index >= rawItems.length) return;
          const result = await this.resolveOneRating(rawItems[index]);
          resolvedCount++;
          if (result) {
            writeEvent({ type: 'item', item: result, resolved: resolvedCount, total: rawItems.length });
          }
        }
      };

      const workers = Array.from({ length: Math.min(CONCURRENCY, rawItems.length) }, () => worker());
      await Promise.all(workers);

      writeEvent({ type: 'done', total: rawItems.length, resolved: resolvedCount });
      res.end();
    } catch (error: any) {
      logger.error(`[ContentController] Error enriching ratings: ${error.message}`);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to enrich ratings' });
      } else {
        res.end();
      }
    }
  }
}
