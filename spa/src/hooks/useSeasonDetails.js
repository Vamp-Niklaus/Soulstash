import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client.js';
import { getLastWatchedForSeries, getLastViewedEpisode } from '../utils/watchProgress.js';

export function useSeasonDetails(id, type, content) {
  const [selectedSeason, setSelectedSeason] = useState(null);
  
  useEffect(() => {
    if (type === 'series' && Array.isArray(content?.seasons) && content.seasons.length) {
      const seriesId = id || content?.id;
      const lastWatched = getLastWatchedForSeries(seriesId) || getLastViewedEpisode(seriesId);
      const targetSeasonNum = lastWatched?.seasonNumber != null ? Number(lastWatched.seasonNumber) : null;
      const matchedSeason = targetSeasonNum != null
        ? content.seasons.find((s) => Number(s.season_number) === targetSeasonNum)
        : null;

      const initialSeason =
        matchedSeason?.season_number ??
        content.seasons.find((s) => Number(s.season_number) > 0)?.season_number ??
        content.seasons[0]?.season_number ??
        null;
      setSelectedSeason(initialSeason);
    } else {
      setSelectedSeason(null);
    }
  }, [type, content, id]);

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
