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

import { useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuthSession } from '../../hooks/index.js';
import { useDetailPage } from '../../hooks/useDetailPage.js';
import { toast } from '../../utils/toast.js';

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

import {
  formatRuntime, yearFrom, getLanguageName, getPrimaryCountry,
  getDirectorLabel, getDirectorPeople,
  getValidImdbRating, getValidVoteAverage,
  isContentInCollection, imageUrl
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
  const auth = useAuthSession();
  const page = useDetailPage(id, type, auth);

  // ΓöÇΓöÇ Loading / error states ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
  if (page.loading || !page.content) {
    return <DetailPageSkeleton type={type} />;
  }

  const { content } = page;

  // ΓöÇΓöÇ Computed display values ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
  // These are pure derivations ΓÇö no side effects, no state.

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
  const tmdbRating = getValidVoteAverage(content.vote_average);
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
    displayRating ? `${ratingSource} ${displayRating.toFixed(1)}` : 'No rating'
  ].filter(Boolean);

  // Director / creator stat ΓÇö renders as a clickable people stat when possible,
  // or falls back to a plain text stat
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

  // ΓöÇΓöÇ Play button handler ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

  function handlePlayClick() {
    const tmdbId = content?.id || id;
    const originalTitle = content?.original_title || content?.original_name || '';
    const originalName = content?.original_name || content?.original_title || '';
    const yearVal = content?.release_date ? parseInt(content.release_date.slice(0, 4)) : (content?.first_air_date ? parseInt(content.first_air_date.slice(0, 4)) : null);
    if (type === 'movie') {
      page.setPlayerRequest(
        createPlayerRequest({ mediaType: 'movie', tmdbId, imdbId: content?.imdb_id, title, originalTitle, originalName, seriesTitle: title, year: yearVal })
      );
    } else {
      const season = page.selectedSeason || 1;
      const firstEp = page.seasonDetails?.episodes?.[0];
      const ep = firstEp?.episode_number || 1;
      page.setPlayerRequest(
        createPlayerRequest({
          mediaType: 'series',
          tmdbId,
          seasonNumber: season,
          episodeNumber: ep,
          episodeTitle: firstEp?.name || '',
          kartoonsEpisodeId: firstEp?.kartoons_episode_id || firstEp?.kartoonsEpisodeId || '',
          kartoonsSlug: firstEp?.kartoons_slug || firstEp?.kartoonsSlug || '',
          imdbId: content?.imdb_id,
          title: `${title} S${season}E${ep}`,
          originalTitle,
          originalName,
          seriesTitle: title,
          year: yearVal
        })
      );
    }
  }

  function handlePlayEpisode(episode) {
    const originalTitle = content?.original_title || content?.original_name || '';
    const originalName = content?.original_name || content?.original_title || '';
    const yearVal = content?.release_date ? parseInt(content.release_date.slice(0, 4)) : (content?.first_air_date ? parseInt(content.first_air_date.slice(0, 4)) : null);
    page.setPlayerRequest(
      createPlayerRequest({
        mediaType: 'series',
        tmdbId: content?.id || id,
        seasonNumber: episode.season_number,
        episodeNumber: episode.episode_number,
        episodeTitle: episode.name || '',
        kartoonsEpisodeId: episode.kartoons_episode_id || episode.kartoonsEpisodeId || '',
        kartoonsSlug: episode.kartoons_slug || episode.kartoonsSlug || '',
        imdbId: content?.imdb_id,
        title: `${title} S${episode.season_number}E${episode.episode_number}`,
        originalTitle,
        originalName,
        seriesTitle: title,
        year: yearVal
      })
    );
  }

  // ΓöÇΓöÇ Render ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
  return (
    <div className="space-y-10">

      {/* 1. Hero ΓÇö backdrop, poster, metadata, action buttons */}
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

      {/* 4. Cast */}
      <section className="content-section">
        <div className="mb-5 flex items-center justify-between gap-4">
          <SectionHeader title="Cast" />
          {page.credits.length > 0 && (
            <div className="hidden items-center gap-2 md:flex">
              <button
                type="button"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/18"
                onClick={() => page.castScrollerRef.current?.scrollBy({ left: -320, behavior: 'smooth' })}
                aria-label="Scroll cast left"
              >
                <i className="fas fa-chevron-left" />
              </button>
              <button
                type="button"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/18"
                onClick={() => page.castScrollerRef.current?.scrollBy({ left: 320, behavior: 'smooth' })}
                aria-label="Scroll cast right"
              >
                <i className="fas fa-chevron-right" />
              </button>
            </div>
          )}
        </div>

        {page.creditsLoading ? (
          <CastRowSkeleton />
        ) : page.credits.length > 0 ? (
          <div ref={page.castScrollerRef} className="cast-scroll flex gap-4 overflow-x-auto pb-2">
            {page.credits.map((person) => (
              <CastCard key={person.id} person={person} />
            ))}
          </div>
        ) : page.creditsError ? (
          <div className="empty-state">Unable to load cast right now.</div>
        ) : (
          <div className="empty-state">No cast information available.</div>
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