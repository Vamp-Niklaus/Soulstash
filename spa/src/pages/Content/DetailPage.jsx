/**
 * DetailPage.jsx
 *
 * Route component for /movie/:id and /series/:id.
 *
 * This file is intentionally short ΓÇö it is an orchestrator, not a god component.
 * All data-fetching and state live in useDetailPage.js.
 * All JSX sections live in their own subcomponent files.
 *
 * Reading this file should feel like reading a table of contents:
 *   1. Get all data/state from the hook
 *   2. Compute a few display values (title, meta, directorStatΓÇª)
 *   3. Render subcomponents in order
 */

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useParams, Link, useLocation } from 'react-router-dom';
import { useAuthSession } from '../../hooks/index.js';
import { useDetailPage } from '../../hooks/useDetailPage.js';
import { toast } from '../../utils/toast.js';
import { getLastWatchedForSeries } from '../../utils/watchProgress.js';

import { DetailPageSkeleton } from '../../components/ui/Skeletons/index.js';
import { CastCard } from '../../components/ui/Cards/CastCard.jsx';
import { CastRowSkeleton } from '../../components/ui/Skeletons/index.js';
import { DetailStat } from '../../components/ui/Cards/DetailStat.jsx';
import { DetailPeopleStat } from '../../components/ui/Cards/DetailPeopleStat.jsx';
import { SectionHeader } from '../../components/ui/SectionHeader.jsx';
import { VideoPlayerModal } from '../../components/player/VideoPlayerModal.jsx';
import { SaveToCollectionModal } from '../../components/ui/Modals/SaveToCollectionModal.jsx';
import { CreateCollectionModal } from '../../components/ui/Modals/CreateCollectionModal.jsx';
import { PlayerErrorBoundary } from '../../components/player/PlayerErrorBoundary.jsx';

import { DetailHero } from './DetailHero.jsx';
import { SeasonEpisodeSection } from './SeasonEpisodeSection.jsx';
import { SimilarSection } from './SimilarSection.jsx';
import { TMDBCollectionSection } from './TMDBCollectionSection.jsx';
import { fetchTrailer } from '../../api/trailers.js';

import {
  formatRuntime, yearFrom, getLanguageName, getPrimaryCountry,
  getDirectorLabel, getDirectorPeople,
  getValidImdbRating, getValidVoteAverage,
  isContentInCollection, imageUrl,
  isUnreleasedTitle, findTrailerVideo
} from '../../utils/formatters.js';
import { createPlayerRequest, createEmptyCollectionDraft } from '../../utils/formatters.js';

const GENRE_NAME_TO_ID = {
  action: 28,
  adventure: 12,
  animation: 16,
  comedy: 35,
  crime: 80,
  documentary: 99,
  drama: 18,
  family: 10751,
  fantasy: 14,
  history: 36,
  horror: 27,
  music: 10402,
  mystery: 9648,
  romance: 10749,
  'science fiction': 878,
  'sci-fi': 878,
  'tv movie': 10770,
  thriller: 53,
  war: 10752,
  western: 37,
  'action & adventure': 10759,
  kids: 10762,
  // Hidden genres:
  // news: 10763,
  // reality: 10764,
  'sci-fi & fantasy': 10765,
  // soap: 10766,
  // talk: 10767,
  'war & politics': 10768,
  bollywood: 'bollywood',
  'latest in india': 'bollywood'
};

export function DetailPage({ type }) {
  const { id } = useParams();
  const location = useLocation();
  const auth = useAuthSession();
  const page = useDetailPage(id, type, auth);
  const autoPlayHandledRef = useRef(false);

  const content = page.content;
  const kartoonsSlug = location.state?.kartoonsSlug || content?.kartoons_slug || '';

  const [creditsTab, setCreditsTab] = useState('cast');
  const [castSortMode, setCastSortMode] = useState('ranked');
  const [castLimit, setCastLimit] = useState(25);

  const handlePlayClick = useCallback((customResumeTime = null, customSeason = null, customEpisode = null) => {
    if (!content) return;
    const tmdbId = content?.id || id;
    const originalTitle = content?.original_title || content?.original_name || '';
    const originalName = content?.original_name || content?.original_title || '';
    const yearVal = content?.release_date ? parseInt(content.release_date.slice(0, 4)) : (content?.first_air_date ? parseInt(content.first_air_date.slice(0, 4)) : null);
    const posterVal = content?.poster_path || content?.image || '';
    const backdropVal = content?.backdrop_path || content?.backdrop || '';
    const titleVal = content?.title || content?.name || 'Unknown title';

    // Unreleased content check: if release_date > current date + 1 day, play official trailer from TMDB metadata
    const isUnreleased = isUnreleasedTitle(content);
    if (isUnreleased) {
      const existingTrailer = findTrailerVideo(content);
      const openTrailer = (trailer) => page.setPlayerRequest(
        createPlayerRequest({
          mediaType: type,
          tmdbId,
          imdbId: content?.imdb_id,
          title: `${titleVal} - ${trailer?.name || 'Trailer'}`,
          originalTitle,
          originalName,
          seriesTitle: titleVal,
          year: yearVal,
          isTrailer: true,
          youtubeTrailerKey: trailer?.key || '',
          poster_path: posterVal,
          backdrop_path: backdropVal,
          image: posterVal
        })
      );

      if (existingTrailer?.key) {
        openTrailer(existingTrailer);
      }
      // TMDB /videos endpoint first (best quality trailer), then the metadata already on the page.
      fetchTrailer({ type: type === 'movie' ? 'movie' : 'series', id: tmdbId })
        .then((trailer) => {
          if (trailer?.key && trailer.key !== existingTrailer?.key) {
            openTrailer(trailer);
          } else if (!existingTrailer?.key) {
            openTrailer(trailer || findTrailerVideo(content));
          }
        })
        .catch(() => {
          if (!existingTrailer?.key) openTrailer(findTrailerVideo(content));
        });
      return;
    }

    if (type === 'movie') {
      page.setPlayerRequest(
        createPlayerRequest({
          mediaType: 'movie',
          tmdbId,
          imdbId: content?.imdb_id,
          title: titleVal,
          originalTitle,
          originalName,
          seriesTitle: titleVal,
          year: yearVal,
          kartoonsSlug,
          isKartoons: Boolean(kartoonsSlug),
          poster_path: posterVal,
          backdrop_path: backdropVal,
          image: posterVal,
          resumeTime: customResumeTime
        })
      );
    } else {
      const lastWatched = getLastWatchedForSeries(tmdbId);
      const targetSeason = customSeason != null
        ? Number(customSeason)
        : (lastWatched?.seasonNumber != null ? Number(lastWatched.seasonNumber) : (page.selectedSeason || 1));
      const targetEp = customEpisode != null
        ? Number(customEpisode)
        : (lastWatched?.episodeNumber != null ? Number(lastWatched.episodeNumber) : (page.seasonDetails?.episodes?.[0]?.episode_number || 1));
      const resume = customResumeTime != null ? customResumeTime : (lastWatched?.currentTime || 0);

      if (targetSeason !== page.selectedSeason) {
        page.setSelectedSeason?.(targetSeason);
      }

      page.setPlayerRequest(
        createPlayerRequest({
          mediaType: 'series',
          tmdbId,
          seasonNumber: targetSeason,
          episodeNumber: targetEp,
          episodeTitle: lastWatched?.episodeTitle || '',
          kartoonsEpisodeId: lastWatched?.kartoons_episode_id || '',
          kartoonsSlug: lastWatched?.kartoons_slug || kartoonsSlug || '',
          isKartoons: Boolean(lastWatched?.kartoons_slug || kartoonsSlug),
          imdbId: content?.imdb_id,
          title: `${titleVal} S${targetSeason}E${targetEp}`,
          originalTitle,
          originalName,
          seriesTitle: titleVal,
          year: yearVal,
          poster_path: posterVal,
          backdrop_path: backdropVal,
          image: posterVal,
          resumeTime: resume
        })
      );
    }
  }, [content, id, type, kartoonsSlug, page]);

  useEffect(() => {
    if (autoPlayHandledRef.current || !content) return;
    if (location.state?.autoPlay) {
      autoPlayHandledRef.current = true;
      try {
        const nextState = { ...(location.state || {}), autoPlay: false };
        window.history.replaceState({ ...window.history.state, usr: nextState }, '');
      } catch (_) {}
      handlePlayClick(
        location.state.resumeTime,
        location.state.seasonNumber,
        location.state.episodeNumber
      );
    }
  }, [content, location.state, handlePlayClick]);

  const handlePlayEpisode = useCallback((episode) => {
    if (!content) return;
    const originalTitle = content?.original_title || content?.original_name || '';
    const originalName = content?.original_name || content?.original_title || '';
    const yearVal = content?.release_date ? parseInt(content.release_date.slice(0, 4)) : (content?.first_air_date ? parseInt(content.first_air_date.slice(0, 4)) : null);
    const posterVal = content?.poster_path || content?.image || '';
    const backdropVal = content?.backdrop_path || content?.backdrop || '';
    const titleVal = content?.title || content?.name || 'Unknown title';

    // Episode not aired yet: play its trailer (episode videos, then season, then series).
    const airTs = Date.parse(episode?.air_date || '');
    if (Number.isFinite(airTs) && airTs > Date.now() + 36 * 60 * 60 * 1000) {
      const existingTrailer = findTrailerVideo(content);
      const openEpisodeTrailer = (trailer) => page.setPlayerRequest(
        createPlayerRequest({
          mediaType: 'series',
          tmdbId: content?.id || id,
          seasonNumber: episode.season_number,
          episodeNumber: episode.episode_number,
          imdbId: content?.imdb_id,
          title: `${titleVal} S${episode.season_number}E${episode.episode_number} - ${trailer?.name || 'Trailer'}`,
          originalTitle,
          originalName,
          seriesTitle: titleVal,
          year: yearVal,
          isTrailer: true,
          youtubeTrailerKey: trailer?.key || '',
          poster_path: posterVal,
          backdrop_path: backdropVal,
          image: posterVal
        })
      );

      if (existingTrailer?.key) {
        openEpisodeTrailer(existingTrailer);
      }
      fetchTrailer({
        type: 'series',
        id: content?.id || id,
        season: episode.season_number,
        episode: episode.episode_number
      })
        .then((trailer) => {
          if (trailer?.key && trailer.key !== existingTrailer?.key) {
            openEpisodeTrailer(trailer);
          } else if (!existingTrailer?.key) {
            openEpisodeTrailer(trailer || findTrailerVideo(content));
          }
        })
        .catch(() => {
          if (!existingTrailer?.key) openEpisodeTrailer(findTrailerVideo(content));
        });
      return;
    }


    page.setPlayerRequest(
      createPlayerRequest({
        mediaType: 'series',
        tmdbId: content?.id || id,
        seasonNumber: episode.season_number,
        episodeNumber: episode.episode_number,
        episodeTitle: episode.name || '',
        kartoonsEpisodeId: episode.kartoons_episode_id || episode.kartoonsEpisodeId || '',
        kartoonsSlug: episode.kartoons_slug || episode.kartoonsSlug || kartoonsSlug || '',
        isKartoons: Boolean(episode.kartoons_slug || episode.kartoonsSlug || kartoonsSlug),
        imdbId: content?.imdb_id,
        title: `${titleVal} S${episode.season_number}E${episode.episode_number}`,
        originalTitle,
        originalName,
        seriesTitle: titleVal,
        year: yearVal,
        poster_path: posterVal,
        backdrop_path: backdropVal,
        image: posterVal
      })
    );
  }, [content, id, kartoonsSlug, page]);

  const displayedCast = useMemo(() => {
    const list = [...(page.credits || [])];
    if (type === 'series') {
      if (castSortMode === 'episodes') {
        list.sort((a, b) => (b.total_episode_count || 0) - (a.total_episode_count || 0));
      } else {
        list.sort((a, b) => (b.score || 0) - (a.score || 0) || (a.ranking || 999) - (b.ranking || 999));
      }
    }
    return list;
  }, [page.credits, type, castSortMode]);

  const activeCreditList = creditsTab === 'cast' ? displayedCast : (page.creditsCrew || []);
  const visibleCreditList = activeCreditList.slice(0, castLimit);

  // Loading / error states
  if (page.loading || !content) {
    return <DetailPageSkeleton type={type} />;
  }

  // Computed display values
  const title = content.title || content.name || 'Unknown title';
  const languageName = getLanguageName(
    content.language || content.original_language,
    content.language || content.original_language || 'Unknown'
  );
  const countryLabel = getPrimaryCountry(content);
  const ageRatingLabel =
    content.age_rating || content.certification || content.release_rating ||
    content.content_rating || 'N/A';

  const imdbRating = getValidImdbRating(content.imdb_rating);
  const rawTmdbRating = getValidVoteAverage(content.vote_average);
  const tmdbRating = rawTmdbRating != null && rawTmdbRating <= 8.2 ? rawTmdbRating : null;
  const displayRating = imdbRating ?? tmdbRating;
  const ratingSource = imdbRating != null ? 'IMDB' : tmdbRating != null ? 'TMDB' : null;

  // The metadata pill row: "Movie | 2023 | 2h 18m | IMDB 8.4"
  const meta = [
    type === 'movie' ? 'Movie' : 'Series',
    yearFrom(content),
    (() => {
      const r = type === 'movie'
        ? formatRuntime(content.runtime)
        : Array.isArray(content.episode_run_time) && content.episode_run_time.length
          ? formatRuntime(content.episode_run_time[0])
          : formatRuntime(content.runtime);
      return r !== 'N/A' ? r : '';
    })(),
    displayRating && ratingSource ? `${ratingSource} ${displayRating.toFixed(1)}` : null
  ].filter(Boolean);

  // Director / creator stat
  const directorPeople = getDirectorPeople(content, page.creditsCrew, type);
  const directorLabel = getDirectorLabel(content, page.creditsCrew, type);
  const directorStat = directorPeople.length ? (
    <DetailPeopleStat
      label={type === 'series' ? 'Creator' : 'Directed By'}
      people={directorPeople}
      navigate={page.navigate}
    />
  ) : (
    <DetailStat label={type === 'series' ? 'Creator' : 'Directed By'} value={directorLabel} />
  );

  return (
    <div className="space-y-10">

      {/* 1. Hero — backdrop, poster, metadata, action buttons */}
      <DetailHero
        content={content}
        type={type}
        title={title}
        meta={meta}
        status={page.status}
        pendingAction={page.pendingAction}
        directorStat={directorStat}
        countryLabel={countryLabel}
        languageName={languageName}
        ageRatingLabel={ageRatingLabel}
        onToggleWatched={() => page.toggleCollection('Watched')}
        onToggleWatchlist={() => page.toggleCollection('Watchlist')}
        onOpenSaveModal={() => {
          if (!page.currentUsername) {
            // toast is imported inside useDetailPage but we can call it here too
            toast('Please login first', 'error');
            return;
          }
          page.setSaveModalOpen(true);
        }}
        onPlay={handlePlayClick}
        isPlayerOpen={!!page.playerRequest?.tmdbId}
        isUnreleased={isUnreleasedTitle(content)}
      />

      {/* 2. Overview + genres */}
      <section className="content-section relative z-10">
        <div className="rounded-[28px] border border-white/8 bg-[rgba(12,12,12,0.72)] p-5 md:p-6">
          <SectionHeader title="Overview" />
          <p className="mt-4 text-[14px] leading-[22px] text-[#B3B3B3] md:text-[16px] md:leading-[26px]">
            {content.overview || 'No overview available yet.'}
          </p>
          {Array.isArray(content.genres) && content.genres.length > 0 && (
            <div className="mt-5 flex flex-wrap gap-2">
              {content.genres.map((genre) => {
                const label = typeof genre === 'string' ? genre : (genre?.name || '');
                if (!label) return null;
                const genreId = genre?.id || GENRE_NAME_TO_ID[label.toLowerCase()] || label;
                return (
                  <Link
                    key={label}
                    to={`/genre/${genreId}/${encodeURIComponent(label)}`}
                    className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-sm text-[#d8d8d8] hover:border-white/25 hover:bg-white/[0.1] hover:text-white transition-all cursor-pointer select-none"
                  >
                    {label}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* 3. Seasons & Episodes (series only) */}
      {type === 'series' && (
        <SeasonEpisodeSection
          content={content}
          selectedSeason={page.selectedSeason}
          setSelectedSeason={page.setSelectedSeason}
          seasonDetails={page.seasonDetails}
          seasonLoading={page.seasonLoading}
          seasonScrollerRef={page.seasonScrollerRef}
          episodeScrollerRef={page.episodeScrollerRef}
          onPlayEpisode={handlePlayEpisode}
        />
      )}

      {/* 4. Cast & Crew */}
      <section className="content-section">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <SectionHeader title={type === 'series' ? 'Cast & Crew' : 'Cast'} />
            {type === 'series' && page.creditsCrew.length > 0 && (
              <div className="flex rounded-full bg-white/[0.06] p-1 border border-white/10 text-xs">
                <button
                  type="button"
                  onClick={() => { setCreditsTab('cast'); setCastLimit(25); }}
                  className={`rounded-full px-3 py-1 font-medium transition-all cursor-pointer ${creditsTab === 'cast' ? 'bg-white text-black shadow' : 'text-white/70 hover:text-white'}`}
                >
                  Cast ({page.credits.length})
                </button>
                <button
                  type="button"
                  onClick={() => { setCreditsTab('crew'); setCastLimit(25); }}
                  className={`rounded-full px-3 py-1 font-medium transition-all cursor-pointer ${creditsTab === 'crew' ? 'bg-white text-black shadow' : 'text-white/70 hover:text-white'}`}
                >
                  Crew ({page.creditsCrew.length})
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* Sort pills for series cast */}
            {type === 'series' && creditsTab === 'cast' && page.credits.length > 1 && (
              <div className="flex items-center gap-1.5 text-xs text-white/60">
                <span className="hidden sm:inline text-white/40">Sort:</span>
                <button
                  type="button"
                  onClick={() => setCastSortMode('ranked')}
                  className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${castSortMode === 'ranked' ? 'bg-amber-500/20 text-amber-300 font-semibold border border-amber-500/40' : 'bg-white/[0.04] text-white/60 hover:text-white'}`}
                >
                  Ranked
                </button>
                <button
                  type="button"
                  onClick={() => setCastSortMode('episodes')}
                  className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${castSortMode === 'episodes' ? 'bg-amber-500/20 text-amber-300 font-semibold border border-amber-500/40' : 'bg-white/[0.04] text-white/60 hover:text-white'}`}
                >
                  Episodes
                </button>
              </div>
            )}

            {/* Scroll navigation arrows */}
            {activeCreditList.length > 0 && (
              <div className="hidden items-center gap-2 md:flex">
                <button
                  type="button"
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/18 cursor-pointer"
                  onClick={() => page.castScrollerRef.current?.scrollBy({ left: -320, behavior: 'smooth' })}
                  aria-label="Scroll left"
                >
                  <i className="fas fa-chevron-left" />
                </button>
                <button
                  type="button"
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/18 cursor-pointer"
                  onClick={() => page.castScrollerRef.current?.scrollBy({ left: 320, behavior: 'smooth' })}
                  aria-label="Scroll right"
                >
                  <i className="fas fa-chevron-right" />
                </button>
              </div>
            )}
          </div>
        </div>

        {page.creditsLoading ? (
          <CastRowSkeleton />
        ) : visibleCreditList.length > 0 ? (
          <>
            <div ref={page.castScrollerRef} className="cast-scroll flex gap-4 overflow-x-auto pb-2">
              {visibleCreditList.map((person) => (
                <CastCard key={`${person.id}-${person.credit_id || person.character || person.job}`} person={person} />
              ))}
            </div>
            {activeCreditList.length > 25 && (
              <div className="mt-3 flex justify-center">
                <button
                  type="button"
                  onClick={() => setCastLimit((prev) => (prev >= activeCreditList.length ? 25 : prev + 35))}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-1.5 text-xs font-medium text-white/80 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
                >
                  <span>{castLimit >= activeCreditList.length ? 'Show Less' : `Show More (${activeCreditList.length - visibleCreditList.length} more)`}</span>
                  <i className={`fas fa-chevron-${castLimit >= activeCreditList.length ? 'up' : 'down'} text-[10px]`} />
                </button>
              </div>
            )}
          </>
        ) : page.creditsError ? (
          <div className="empty-state">Unable to load {creditsTab} right now.</div>
        ) : (
          <div className="empty-state">No {creditsTab} information available.</div>
        )}
      </section>

      {/* 4.5. Belongs to Collection (Movies/Series franchise collections) */}
      {content.belongs_to_collection && (
        <TMDBCollectionSection
          collection={content.belongs_to_collection}
          collections={page.collections}
          type={type}
          currentId={id}
        />
      )}

      {/* 5. Similar Content */}
      <SimilarSection 
        similar={content.similar?.results || content.recommendations?.results}
        totalPages={content.similar?.total_pages || content.recommendations?.total_pages} 
        collections={page.collections} 
        type={type} 
      />

      {/* 6. Modals */}
      <SaveToCollectionModal
        open={page.saveModalOpen}
        onClose={() => page.setSaveModalOpen(false)}
        collections={page.collections}
        contentId={Number(id)}
        onToggleCollection={page.handleToggleCustomCollection}
        onCreateNew={() => {
          page.setSaveModalOpen(false);
          page.setCreateModalOpen(true);
        }}
      />
      <CreateCollectionModal
        open={page.createModalOpen}
        values={page.createDraft}
        onChange={page.setCreateDraft}
        onClose={() => {
          page.setCreateModalOpen(false);
          page.setCreateDraft(createEmptyCollectionDraft());
        }}
        onSubmit={page.handleCreateCustomCollection}
        saving={page.createLoading}
      />

      {/* 7. Video player (rendered only when a play request is active) */}
      {page.playerRequest?.tmdbId && (
        <PlayerErrorBoundary onClose={() => page.setPlayerRequest(null)}>
          <VideoPlayerModal
            request={page.playerRequest}
            onClose={() => page.setPlayerRequest(null)}
          />
        </PlayerErrorBoundary>
      )}
    </div>
  );
}