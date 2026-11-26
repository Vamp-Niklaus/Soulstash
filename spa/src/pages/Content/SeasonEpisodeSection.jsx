/**
 * SeasonEpisodeSection.jsx
 *
 * Renders the "Seasons & Episodes" section for series detail pages.
 * Includes: season selector tabs, episode cards horizontal scroll row.
 *
 * Props:
 *   content             — the full series object (for seasons array, episode counts)
 *   selectedSeason      — currently selected season number
 *   setSelectedSeason   — (seasonNumber) => void
 *   seasonDetails       — { name, episodes: [] } for the selected season
 *   seasonLoading       — boolean
 *   seasonScrollerRef   — ref for the seasons tab scroller div
 *   episodeScrollerRef  — ref for the episodes row scroller div
 *   onPlayEpisode       — (episode) => void — called when user clicks play on an episode
 *   title               — series title (used to build episode play labels)
 */

import React, { useState, useEffect } from 'react';
import { EpisodeRowSkeleton } from '../../components/ui/Skeletons/index.js';
import { EpisodeCard } from '../../components/ui/Cards/EpisodeCard.jsx';
import { SectionHeader } from '../../components/ui/SectionHeader.jsx';
import { formatRuntime } from '../../utils/formatters.js';
import {
  getWatchedEpisodes,
  markEpisodeWatched,
  unmarkEpisodeWatched,
  getLastWatchedForSeries,
  getLastViewedEpisode,
  saveLastViewedEpisode,
  normalizeSeriesEpisodeKey,
} from '../../utils/watchProgress.js';

export function SeasonEpisodeSection({
  content,
  selectedSeason,
  setSelectedSeason,
  seasonDetails,
  seasonLoading,
  seasonScrollerRef,
  episodeScrollerRef,
  onPlayEpisode,
}) {
  const seriesId = content?.id || content?.tmdbId || content?.kartoons_slug || content?.slug;
  const [watchedSet, setWatchedSet] = useState(() => getWatchedEpisodes(seriesId));
  const [lastWatched, setLastWatched] = useState(() => getLastWatchedForSeries(seriesId) || getLastViewedEpisode(seriesId));

  useEffect(() => {
    const updateState = () => {
      setWatchedSet(getWatchedEpisodes(seriesId));
      setLastWatched(getLastWatchedForSeries(seriesId) || getLastViewedEpisode(seriesId));
    };
    updateState();
    window.addEventListener('soulstash:watched-episodes-updated', updateState);
    window.addEventListener('soulstash:continue-watching-updated', updateState);
    window.addEventListener('soulstash:last-viewed-updated', updateState);
    return () => {
      window.removeEventListener('soulstash:watched-episodes-updated', updateState);
      window.removeEventListener('soulstash:continue-watching-updated', updateState);
      window.removeEventListener('soulstash:last-viewed-updated', updateState);
    };
  }, [seriesId]);

  // Auto-scroll active season button into view
  useEffect(() => {
    if (!selectedSeason || !seasonScrollerRef?.current) return;
    const activeBtn = seasonScrollerRef.current.querySelector(`[data-season="${selectedSeason}"]`);
    if (activeBtn) {
      activeBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, [selectedSeason, seasonScrollerRef]);

  // Auto-scroll episode row to the active / resume / next episode
  useEffect(() => {
    if (seasonLoading || !seasonDetails?.episodes?.length || !episodeScrollerRef?.current) return;
    const currentLast = getLastWatchedForSeries(seriesId) || getLastViewedEpisode(seriesId);
    if (!currentLast || Number(currentLast.seasonNumber) !== Number(selectedSeason)) return;

    const targetEp = Number(currentLast.episodeNumber);
    if (!targetEp) return;

    const timer = setTimeout(() => {
      if (!episodeScrollerRef?.current) return;
      const targetCard = episodeScrollerRef.current.querySelector(`[data-episode-number="${targetEp}"]`);
      if (targetCard) {
        targetCard.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [selectedSeason, seasonLoading, seasonDetails?.episodes, seriesId, episodeScrollerRef, lastWatched?.seasonNumber, lastWatched?.episodeNumber]);

  const visibleSeasonList = [...(Array.isArray(content.seasons) ? content.seasons : [])].sort((a, b) => Number(a?.season_number) - Number(b?.season_number)).filter(
    (s) => Number(s?.season_number) > 0
  );

  return (
    <section className="content-section">
      <SectionHeader title="Seasons & Episodes" />
      <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(15,15,15,0.96),rgba(9,9,9,0.98))] p-4 md:p-6">

        {/* ── Season overview row ── */}
        <div className="mb-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-[#b7b7b7]">
              {content.number_of_seasons || 0} seasons &bull; {content.number_of_episodes || 0} episodes &bull; Avg runtime {formatRuntime(content.runtime)}
            </p>

            {/* Desktop scroll arrows for seasons */}
            {visibleSeasonList.length > 1 && (
              <div className="hidden shrink-0 items-center gap-2 md:flex">
                <ScrollArrow direction="left" onClick={() => seasonScrollerRef.current?.scrollBy({ left: -220, behavior: 'smooth' })} label="Scroll seasons left" />
                <ScrollArrow direction="right" onClick={() => seasonScrollerRef.current?.scrollBy({ left: 220, behavior: 'smooth' })} label="Scroll seasons right" />
              </div>
            )}
          </div>

          {/* ── Season title + tab pills ── */}
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <h3 className="text-2xl font-semibold text-white">
              {seasonDetails?.name || (selectedSeason ? `Season ${selectedSeason}` : 'Season guide')}
            </h3>

            {visibleSeasonList.length > 0 && (
              <div ref={seasonScrollerRef} className="filter-scrollbar-hidden min-w-0 overflow-x-auto overflow-y-hidden">
                <div className="flex min-w-max flex-nowrap items-center gap-2 pr-1">
                  {visibleSeasonList.map((season) => (
                    <button
                      key={season.id || season.season_number}
                      data-season={season.season_number}
                      type="button"
                      className={`px-4 py-2 rounded-2xl text-sm font-medium transition-colors ${
                        Number(selectedSeason) === Number(season.season_number)
                          ? 'bg-white text-black'
                          : 'bg-white/6 text-white hover:bg-white/12'
                      }`}
                      onClick={() => {
                        setSelectedSeason(season.season_number);
                        saveLastViewedEpisode(seriesId, season.season_number, 1);
                      }}
                    >
                      S{season.season_number}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Episode count + scroll arrows ── */}
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-[#b7b7b7]">{seasonDetails?.episodes?.length || 0} episodes</p>
            {seasonDetails?.episodes?.length > 0 && (
              <div className="hidden shrink-0 items-center gap-2 md:flex">
                <ScrollArrow direction="left" onClick={() => episodeScrollerRef.current?.scrollBy({ left: -320, behavior: 'smooth' })} label="Scroll episodes left" />
                <ScrollArrow direction="right" onClick={() => episodeScrollerRef.current?.scrollBy({ left: 320, behavior: 'smooth' })} label="Scroll episodes right" />
              </div>
            )}
          </div>
        </div>

        {/* ── Episode cards ── */}
        {seasonLoading && <EpisodeRowSkeleton />}

        {!seasonLoading && seasonDetails?.episodes?.length > 0 && (
          <div ref={episodeScrollerRef} className="cast-scroll flex gap-3 overflow-x-auto pb-2">
            {seasonDetails.episodes.map((episode) => {
              const epNum = Number(episode.episode_number);
              const seasonNum = Number(episode.season_number || selectedSeason);
              const epKey = normalizeSeriesEpisodeKey(seriesId, seasonNum, epNum);
              const isWatched = watchedSet.has(epKey);
              const isTargetEp = lastWatched && Number(lastWatched.seasonNumber) === seasonNum && Number(lastWatched.episodeNumber) === epNum;
              const isNext = Boolean(isTargetEp && (lastWatched.isNextEpisode || isWatched));
              const isResume = Boolean(isTargetEp && !lastWatched.isNextEpisode && !isWatched && (Number(lastWatched.currentTime) > 5));

              return (
                <EpisodeCard
                  key={episode.id || `${seasonNum}-${epNum}`}
                  episode={episode}
                  onPlay={onPlayEpisode}
                  isWatched={isWatched}
                  isNext={isNext}
                  isResume={isResume}
                  onToggleWatched={() => {
                    if (isWatched) {
                      unmarkEpisodeWatched(seriesId, seasonNum, epNum);
                    } else {
                      markEpisodeWatched(seriesId, seasonNum, epNum);
                    }
                  }}
                />
              );
            })}
          </div>
        )}

        {!seasonLoading && !seasonDetails?.episodes?.length && (
          <div className="empty-state">No episode details available for this season yet.</div>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Shared scroll arrow button
// ---------------------------------------------------------------------------

function ScrollArrow({ direction, onClick, label }) {
  return (
    <button
      type="button"
      className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/18"
      onClick={onClick}
      aria-label={label}
    >
      <i className={`fas fa-chevron-${direction}`} />
    </button>
  );
}
