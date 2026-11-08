import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client.js';

export function useSeasonDetails(id, type, content) {
  const [selectedSeason, setSelectedSeason] = useState(null);
  
  useEffect(() => {
    if (type === 'series' && Array.isArray(content?.seasons) && content.seasons.length) {
      const initialSeason =
        content.seasons.find((s) => Number(s.season_number) > 0)?.season_number ??
        content.seasons[0]?.season_number ??
        null;
      setSelectedSeason(initialSeason);
    } else {
      setSelectedSeason(null);
    }
  }, [type, content]);

  const seriesTitle = content?.name || content?.title || content?.original_name || '';
  const seriesYear = content?.first_air_date ? String(content.first_air_date).slice(0, 4) : '';

  const {
    data: seasonDetailsData,
    isLoading: seasonLoading
  } = useQuery({
    queryKey: ['season', type, id, selectedSeason, seriesTitle],
    queryFn: () => {
      const params = new URLSearchParams();
      if (seriesTitle) params.set('title', seriesTitle);
      if (seriesYear) params.set('year', seriesYear);
      const q = params.toString();
      return apiFetch(`/api/series/${id}/season/${selectedSeason}${q ? `?${q}` : ''}`);
    },
    enabled: type === 'series' && selectedSeason !== null,
    retry: 3,
    retryDelay: 2500,
  });
  
  const seasonDetails = seasonDetailsData || null;

  return { selectedSeason, setSelectedSeason, seasonDetails, seasonLoading };
}
