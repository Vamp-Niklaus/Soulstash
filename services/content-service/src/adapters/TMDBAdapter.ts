import { IContentProvider, CategoryResult } from '../../../shared/src/interfaces/IContentProvider';
import { config } from '../../../shared/src/utils/ConfigManager';
import { logger } from '../../../shared/src/utils/Logger';

/**
 * Adapter Pattern: TMDBAdapter
 * Adapts the external TMDB API to our internal IContentProvider interface.
 */
export class TMDBAdapter implements IContentProvider {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor() {
    this.baseUrl = config.get('tmdbBaseUrl') || 'https://api.themoviedb.org';
    this.token = config.get('tmdbBearerToken') || '';
  }

  private async fetchFromTMDB(endpoint: string, retries = 3): Promise<any> {
    const url = `${this.baseUrl}${endpoint}`;
    logger.info(`[TMDBAdapter] Fetching: ${url}`);
    
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await fetch(url, {
          headers: {
            accept: 'application/json',
            Authorization: `Bearer ${this.token}`,
          },
        });

        if (!response.ok) {
          throw new Error(`TMDB API Error: ${response.status} ${response.statusText}`);
        }

        return await response.json();
      } catch (err: any) {
        const isRetryable = err.cause?.code === 'ECONNRESET' || err.message === 'fetch failed';
        if (isRetryable && attempt < retries) {
          const delay = 300 * attempt;
          logger.warn(`[TMDBAdapter] Attempt ${attempt} failed (${err.cause?.code ?? err.message}), retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          throw err;
        }
      }
    }
  }

  public async getTrending(page: number = 1, limit: number = 18): Promise<any[]> {
    const [movieData, tvData] = await Promise.all([
      this.fetchFromTMDB(`/3/trending/movie/day?language=en-US&page=${page}`),
      this.fetchFromTMDB(`/3/trending/tv/day?language=en-US&page=${page}`)
    ]);

    const mItems = (movieData.results || []).map((i: any) => ({ ...i, media_type: 'Movie' }));
    const tItems = (tvData.results || []).map((i: any) => ({ ...i, media_type: 'Series' }));

    const all = [...mItems, ...tItems].sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    return all.slice(0, limit);
  }

  public async getGenres(): Promise<any[]> {
    const data = await this.fetchFromTMDB('/3/genre/movie/list?language=en-US');
    return (data.genres || [])
      .map((g: any) => ({ id: g.id, name: g.name }))
      .sort((a: any, b: any) => a.name.localeCompare(b.name));
  }

  public async getCategoryItems(genreId: string, page: number = 1, limit: number = 20): Promise<CategoryResult> {
    const adultFilter = '&include_adult=false';
    const strictRatingFilter = '&certification_country=US&certification.lte=R&vote_average.gte=0.1&vote_count.gte=5';
    
    let movieUrl = '';

    if (genreId === 'bollywood') {
      movieUrl = `/3/discover/movie?language=en-US&page=${page}${adultFilter}&with_original_language=hi&sort_by=primary_release_date.desc&vote_count.gte=5`;
    } else {
      movieUrl = `/3/discover/movie?language=en-US&page=${page}${adultFilter}${strictRatingFilter}&sort_by=popularity.desc&with_genres=${genreId}`;
    }

    const movieData = await this.fetchFromTMDB(movieUrl);
    const mItems = (movieData.results || []).map((i: any) => ({ ...i, media_type: 'Movie' }));
    const totalPages: number = typeof movieData.total_pages === 'number' ? movieData.total_pages : 1;

    return { movies: mItems.slice(0, limit), totalPages };
  }

  public async search(query: string, type: string = 'content'): Promise<any[]> {
    const encoded = encodeURIComponent(query);
    const data = await this.fetchFromTMDB(`/3/search/multi?query=${encoded}&include_adult=false&language=en-US&page=1`);
    
    const results = (data.results || []).map((i: any) => ({
      ...i,
      media_type: i.media_type === 'tv' ? 'Series' : i.media_type === 'movie' ? 'Movie' : i.media_type
    }));

    return results;
  }

  public async getRawTMDB(endpoint: string): Promise<any> {
    return this.fetchFromTMDB(endpoint);
  }
}
