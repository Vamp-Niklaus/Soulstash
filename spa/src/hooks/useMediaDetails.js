import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client.js';

export function useMediaDetails(id, type) {
  const {
    data: contentData,
    isLoading: loading,
    error: loadErrorObj
  } = useQuery({
    queryKey: ['detail', type, id],
    queryFn: async () => {
      let detailPath;
      if (type === 'movie') detailPath = `/api/movies/${id}`;
      else if (type === 'person') detailPath = `/api/people/${id}`;
      else detailPath = `/api/series/${id}`;
      
      const detailResult = await apiFetch(detailPath);

      if (detailResult?.id && type !== 'person') {
        try {
          const mediaType = type === 'series' ? 'Series' : 'Movie';
          const rating = await apiFetch(`/api/ratings/${mediaType}/${detailResult.id}`);
          const imdbRating = Number(rating?.imdb_rating);
          const voteAverage = Number(rating?.vote_average);
          
          if (
            (Number.isFinite(imdbRating) && imdbRating > 0) ||
            (Number.isFinite(voteAverage) && voteAverage > 0)
          ) {
            detailResult.imdb_rating = Number.isFinite(imdbRating) && imdbRating > 0
              ? imdbRating
              : detailResult.imdb_rating;
            detailResult.vote_average = Number.isFinite(voteAverage) && voteAverage > 0
              ? voteAverage
              : detailResult.vote_average;
            detailResult.imdb_id = rating?.imdbID || detailResult.imdb_id || '';
          }
        } catch (e) {
          // silently ignore — TMDB rating is the fallback
        }
      }
      return detailResult;
    },
    retry: 3,
    retryDelay: 2500,
  });

  const content = contentData || null;
  const loadError = loadErrorObj ? loadErrorObj.message || 'Unable to load this page.' : '';

  useEffect(() => {
    if (content) {
      document.title = `${content.title || content.name} | Soulstash`;
    }
  }, [content]);

  return { content, loading, loadError };
}
