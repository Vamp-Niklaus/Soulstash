import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client.js';
import { getLastWatchedForSeries, getLastViewedEpisode } from '../utils/watchProgress.js';

export function useSeasonDetails(id, type, content) {
  const [selectedSeason, setSelectedSeasonState] = useState(null);
  const manualSeasonRef = useRef(false);

  const setSelectedSeason = useCallback((seasonNum) => {
    manualSeasonRef.current = true;
    setSelectedSeasonState(seasonNum);
  }, []);

  useEffect(() => {
    manualSeasonRef.current = false;
  }, [id]);

  useEffect(() => {
    if (type !== 'series' || !Array.isArray(content?.seasons) || !content.seasons.length) {
      setSelectedSeasonState(null);
      return;
    }

    const resolveSeason = () => {
      const seriesId = id || content?.id;
      const lastWatched = getLastWatchedForSeries(seriesId) || getLastViewedEpisode(seriesId);
      const targetSeasonNum = lastWatched?.seasonNumber != null ? Number(lastWatched.seasonNumber) : null;
      const matchedSeason = targetSeasonNum != null
        ? content.seasons.find((s) => Number(s.season_number) === targetSeasonNum)
        : null;

      return (
        matchedSeason?.season_number ??
        content.seasons.find((s) => Number(s.season_number) > 0)?.season_number ??
        content.seasons[0]?.season_number ??
        null
      );
    };

    setSelectedSeasonState(resolveSeason());

    const handleSyncUpdate = () => {
      if (!manualSeasonRef.current) {
        const synced = resolveSeason();
        if (synced != null) setSelectedSeasonState(synced);
      }
    };

    window.addEventListener('soulstash:continue-watching-updated', handleSyncUpdate);
    window.addEventListener('soulstash:last-viewed-updated', handleSyncUpdate);
    return () => {
      window.removeEventListener('soulstash:continue-watching-updated', handleSyncUpdate);
      window.removeEventListener('soulstash:last-viewed-updated', handleSyncUpdate);
    };
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
