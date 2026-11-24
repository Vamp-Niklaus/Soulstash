import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client.js';
import { getValidImdbRating, getValidVoteAverage } from '../utils/formatters.js';

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
        // Guarantee images (backdrops & posters) are always present even if parent response lacked them
        if (!detailResult.images?.backdrops?.length || !detailResult.images?.posters?.length) {
          try {
            const imgEndpoint = type === 'series' ? `/api/series/${id}/images` : `/api/movies/${id}/images`;
            const imgData = await apiFetch(imgEndpoint);
            if (imgData && (imgData.backdrops || imgData.posters)) {
              detailResult.images = {
                ...(detailResult.images || {}),
                backdrops: imgData.backdrops || detailResult.images?.backdrops || [],
                posters: imgData.posters || detailResult.images?.posters || []
              };
            }
          } catch (e) {}
        }

        try {
          const mediaType = type === 'series' ? 'Series' : 'Movie';
          const rating = await apiFetch(`/api/ratings/${mediaType}/${detailResult.id}`);
          const imdbRating = getValidImdbRating(rating?.imdb_rating);
          const voteAverage = getValidVoteAverage(rating?.vote_average);
          
          if (imdbRating != null) {
            detailResult.imdb_rating = imdbRating;
          }
          if (voteAverage != null) {
            detailResult.vote_average = voteAverage;
          }
          if (rating?.imdbID) {
            detailResult.imdb_id = rating.imdbID;
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
