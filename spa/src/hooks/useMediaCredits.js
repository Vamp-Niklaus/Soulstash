import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client.js';

export function useMediaCredits(id, type) {
  const {
    data: creditsData,
    isLoading: creditsLoading,
    error: creditsErrorObj
  } = useQuery({
    queryKey: ['credits', type, id],
    queryFn: async () => {
      let creditPath = `/api/series/${id}/credits`;
      if (type === 'movie') creditPath = `/api/movie/${id}/credits`;
      if (type === 'person') creditPath = `/api/people/${id}/credits`;
      return apiFetch(creditPath);
    },
    retry: 3,
    retryDelay: 2500,
  });

  const credits = creditsData ? (creditsData.cast || []).slice(0, 16) : [];
  const creditsCrew = creditsData ? (Array.isArray(creditsData.crew) ? creditsData.crew : []) : [];
  const creditsError = creditsErrorObj ? creditsErrorObj.message || '' : '';

  return { credits, creditsCrew, creditsLoading, creditsError };
}
