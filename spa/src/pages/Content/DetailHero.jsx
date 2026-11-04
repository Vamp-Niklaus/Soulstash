/**
 * DetailHero.jsx
 *
 * The hero section of a movie/series detail page.
 * Renders: backdrop image, poster, metadata stats, and action buttons.
 *
 * Props:
 *   content         — the full movie/series object from the API
 *   type            — 'movie' | 'series'
 *   title           — pre-computed display title string
 *   meta            — pre-computed array of metadata strings (year, runtime, rating…)
 *   status          — { watched, watchlist, customSaved } booleans
 *   pendingAction   — name of the collection currently being toggled (or null)
 *   directorStat    — JSX element rendered for director/creator stat
 *   countryLabel    — e.g. "United States"
 *   languageName    — e.g. "English"
 *   ageRatingLabel  — e.g. "PG-13"
 *   onToggleWatched    — () => void
 *   onToggleWatchlist  — () => void
 *   onOpenSaveModal    — () => void
 *   onPlay             — () => void  (play button click)
 *   selectedSeason     — currently selected season number (series only)
 *   seasonDetails      — season detail object with episodes[] (series only)
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import { FALLBACK_AVATAR, FALLBACK_POSTER } from '../../utils/constants.js';
import { imageUrl } from '../../utils/formatters.js';
import { ActionButton } from '../../components/ui/ActionButton.jsx';
import { DetailStat } from '../../components/ui/Cards/DetailStat.jsx';
import { useArtworkAtmosphere } from '../../hooks/useArtworkAtmosphere.js';
import { ZoomablePosterModal } from '../../components/ui/Modals/ZoomablePosterModal.jsx';

export function DetailHero({
  content,
  type,
  title,
  meta,
  status,
  pendingAction,
  directorStat,
  countryLabel,
  languageName,
  ageRatingLabel,
  onToggleWatched,
  onToggleWatchlist,
  onOpenSaveModal,
  onPlay,
  isPlayerOpen,
}) {
  const [viewerOpen, setViewerOpen] = useState(false);
  
  // Posters logic (combines posters from API with primary poster_path)
  const posters = useMemo(() => {
    const list = Array.isArray(content?.images?.posters) ? [...content.images.posters] : [];
    if (content?.poster_path && !list.some((p) => (p?.file_path || p) === content.poster_path)) {
      list.unshift({ file_path: content.poster_path });
    }
    return list;
  }, [content?.images?.posters, content?.poster_path]);

  const hasPosters = posters.length > 0;
  const [currentPosterIndex, setCurrentPosterIndex] = useState(0);
  const [modalImageIndex, setModalImageIndex] = useState(0);

  // Backdrops logic (combines backdrops from API with primary backdrop_path)
  const backdrops = useMemo(() => {
    const list = Array.isArray(content?.images?.backdrops) ? [...content.images.backdrops] : [];
    if (content?.backdrop_path && !list.some((b) => (b?.file_path || b) === content.backdrop_path)) {
      list.unshift({ file_path: content.backdrop_path });
    }
    return list.slice(0, 15);
  }, [content?.images?.backdrops, content?.backdrop_path]);

  // Combined vertical posters and landscape backdrops for full gallery viewer
  const viewerImages = useMemo(() => {
    const all = [...posters, ...backdrops];
    if (all.length > 0) return all;
    if (content?.poster_path) return [content.poster_path];
    if (content?.backdrop_path) return [content.backdrop_path];
    return [FALLBACK_AVATAR];
  }, [posters, backdrops, content?.poster_path, content?.backdrop_path]);

  // Instantly preload the full-resolution first image so tapping the poster displays instantly with zero wait
  useEffect(() => {
    const firstImg = viewerImages[0]?.file_path || viewerImages[0];
    if (firstImg) {
      const fullUrl = imageUrl(firstImg, 'original');
      const img = new Image();
      if ('fetchPriority' in img) img.fetchPriority = 'high';
      img.src = fullUrl;
    }
  }, [viewerImages]);

  const hasBackdrops = backdrops.length > 0;
  const [currentBackdropIndex, setCurrentBackdropIndex] = useState(0);
  const loadedSetRef = useRef(new Set([0]));

  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.innerWidth >= 768;
  });

  useEffect(() => {
    const handleResize = () => {
      setIsDesktop(window.innerWidth >= 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Compute primary landscape and portrait paths for high-priority loading and responsive background
  const landscapePath = content?.backdrop_path || backdrops?.[0]?.file_path;
  const posterPath = content?.poster_path || posters?.[0]?.file_path;

  // In desktop mode: use landscape as background image (with vertical poster fallback).
  // In mobile mode: use vertical poster as background image (with landscape fallback).
  const bgPath = isDesktop
    ? (landscapePath || posterPath)
    : (posterPath || landscapePath);

  const backgroundUrl = bgPath ? imageUrl(bgPath, isDesktop ? 'w1280' : 'w780') : '';
  const sampleUrl = bgPath ? `${imageUrl(bgPath, 'w92')}?tint=1` : '';

  useArtworkAtmosphere(backgroundUrl, sampleUrl);

  // Top priority preload for landscape poster / backdrop first to eliminate black screen
  useEffect(() => {
    if (landscapePath) {
      const fastLandscapeUrl = imageUrl(landscapePath, 'w1280');
      const img = new Image();
      if ('fetchPriority' in img) img.fetchPriority = 'high';
      img.src = fastLandscapeUrl;
    }
  }, [landscapePath]);

  // Preload backdrops so they never appear half-loaded (priority 'w1280', then 'original')
  useEffect(() => {
    loadedSetRef.current = new Set([0]);
    setCurrentBackdropIndex(0);
    if (backdrops.length <= 1) return;

    backdrops.forEach((backdrop, idx) => {
      const fastUrl = imageUrl(backdrop.file_path, 'w1280');
      const img = new Image();
      img.src = fastUrl;
      img.onload = () => {
        loadedSetRef.current.add(idx);
      };
      img.onerror = () => {
        const fallback = imageUrl(backdrop.file_path, 'original');
        const img2 = new Image();
        img2.src = fallback;
        img2.onload = () => loadedSetRef.current.add(idx);
      };
    });
  }, [backdrops]);

  // Smooth rotation every 5s across available landscape backdrops
  useEffect(() => {
    if (backdrops.length <= 1 || isPlayerOpen) return;

    const interval = setInterval(() => {
      setCurrentBackdropIndex((prev) => (prev + 1) % backdrops.length);
    }, 5000);

    return () => clearInterval(interval);
  }, [backdrops.length, isPlayerOpen]);

  // Smooth poster rotation every 6s when multiple posters are available
  useEffect(() => {
    if (posters.length <= 1 || isPlayerOpen || viewerOpen) return;
    const interval = setInterval(() => {
      setCurrentPosterIndex((prev) => (prev + 1) % posters.length);
    }, 6000);
    return () => clearInterval(interval);
  }, [posters.length, isPlayerOpen, viewerOpen]);

  const currentPosterPath = hasPosters
    ? (posters[currentPosterIndex]?.file_path || posters[0]?.file_path || content?.poster_path)
    : content?.poster_path;

  const fallbackBackdropUrl = landscapePath
    ? imageUrl(landscapePath, 'w1280')
    : currentPosterPath
    ? imageUrl(currentPosterPath, 'w780')
    : FALLBACK_POSTER;

  return (
    <section className="relative -mx-4 overflow-hidden bg-transparent sm:mx-0 sm:rounded-[28px] sm:border sm:border-white/10">
      {/* ── Backdrop image + play button ── */}
      <div className="detail-backdrop-artwork relative aspect-[1.6/1] sm:aspect-[2.1/1] lg:aspect-[2.68/1] w-full overflow-hidden bg-black">
        {hasBackdrops ? (
          backdrops.map((backdrop, index) => {
            const isCurrent = index === currentBackdropIndex;
            return (
              <img
                key={backdrop.file_path || index}
                src={imageUrl(backdrop.file_path, 'w1280')}
                alt={`${title} backdrop ${index + 1}`}
                fetchPriority={index === 0 ? 'high' : 'auto'}
                decoding={index === 0 ? 'sync' : 'async'}
                className={`absolute inset-0 h-full w-full object-cover object-[center_22%] transition-opacity duration-[1200ms] ease-in-out will-change-[opacity] ${
                  isCurrent ? 'opacity-100 z-[2]' : 'opacity-0 z-[1] pointer-events-none'
                }`}
                onLoad={() => loadedSetRef.current.add(index)}
                onError={(e) => {
                  const src = e.currentTarget.src;
                  if (src.includes('/w1280/')) {
                    e.currentTarget.src = src.replace('/w1280/', '/original/');
                  } else if (src.includes('/original/')) {
                    e.currentTarget.src = src.replace('/original/', '/w780/');
                  }
                }}
              />
            );
          })
        ) : fallbackBackdropUrl ? (
          <img
            src={fallbackBackdropUrl}
            alt={title}
            fetchPriority="high"
            decoding="sync"
            className={`absolute inset-0 h-full w-full object-cover ${
              landscapePath
                ? 'object-[center_22%]'
                : 'scale-125 object-[center_28%] blur-[0.5px] sm:blur-none transition-transform duration-700'
            }`}
            onError={(e) => {
              const src = e.currentTarget.src;
              if (src.includes('/w1280/')) {
                e.currentTarget.src = src.replace('/w1280/', '/original/');
              } else if (src.includes('/original/')) {
                e.currentTarget.src = src.replace('/original/', '/w780/');
              } else if (currentPosterPath && !src.includes(currentPosterPath)) {
                e.currentTarget.src = imageUrl(currentPosterPath, 'w780');
                e.currentTarget.className = "absolute inset-0 h-full w-full object-cover scale-125 object-[center_28%]";
              } else {
                e.currentTarget.src = FALLBACK_POSTER;
              }
            }}
          />
        ) : (
          <div className="absolute inset-0 h-full w-full bg-neutral-900" />
        )}

        <button
          type="button"
          data-play-btn="true"
          className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/65 active:scale-95 active:bg-black/70 lg:h-16 lg:w-16 touch-manipulation ${isPlayerOpen ? 'pointer-events-none opacity-50' : ''}`}
          aria-label={`Play ${title}`}
          onClick={isPlayerOpen ? undefined : onPlay}
          disabled={isPlayerOpen}
        >
          <i className="fas fa-play translate-x-[1px] text-sm lg:text-base" />
        </button>

        <div className="detail-backdrop-fade absolute inset-x-0 bottom-0 h-[38%] sm:h-[44%] z-10" aria-hidden="true" />
      </div>

      {/* ── Poster + metadata (below backdrop) ── */}
      <div className="relative z-10 px-4 pb-6 sm:px-6 sm:pb-8 lg:px-8 lg:pb-10 xl:px-12">

        {/* Mobile / tablet layout (hidden on xl+) */}
        <MobileLayout
          content={content}
          title={title}
          type={type}
          meta={meta}
          status={status}
          pendingAction={pendingAction}
          directorStat={directorStat}
          countryLabel={countryLabel}
          languageName={languageName}
          ageRatingLabel={ageRatingLabel}
          onToggleWatched={onToggleWatched}
          onToggleWatchlist={onToggleWatchlist}
          onOpenSaveModal={onOpenSaveModal}
          onPosterClick={isPlayerOpen ? undefined : () => {
            setModalImageIndex(currentPosterIndex);
            setViewerOpen(true);
          }}
          isPlayerOpen={isPlayerOpen}
        />

        {/* Desktop layout (xl+) */}
        <DesktopLayout
          content={content}
          title={title}
          type={type}
          meta={meta}
          status={status}
          pendingAction={pendingAction}
          directorStat={directorStat}
          countryLabel={countryLabel}
          languageName={languageName}
          ageRatingLabel={ageRatingLabel}
          onToggleWatched={onToggleWatched}
          onToggleWatchlist={onToggleWatchlist}
          onOpenSaveModal={onOpenSaveModal}
          onPosterClick={isPlayerOpen ? undefined : () => {
            setModalImageIndex(currentPosterIndex);
            setViewerOpen(true);
          }}
          isPlayerOpen={isPlayerOpen}
        />
      </div>

      <ZoomablePosterModal
        open={viewerOpen}
        onClose={() => setViewerOpen(false)}
        images={viewerImages}
        currentIndex={modalImageIndex}
        onIndexChange={setModalImageIndex}
        alt={title}
        fallbackImage={FALLBACK_AVATAR}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Mobile / tablet layout
// ---------------------------------------------------------------------------

function MobileLayout({
  content, title, type, meta, status, pendingAction,
  directorStat, countryLabel, languageName, ageRatingLabel,
  onToggleWatched, onToggleWatchlist, onOpenSaveModal, onPosterClick, isPlayerOpen,
}) {
  return (
    <div className="-mt-16 sm:-mt-20 lg:-mt-24 xl:hidden">
      <div className="flex items-start gap-3.5 sm:gap-4">
        {/* Poster */}
        <div className="w-[110px] sm:w-[140px] flex-shrink-0 space-y-2">
          <button 
            type="button"
            onClick={onPosterClick}
            disabled={isPlayerOpen}
            className={`aspect-[2/3] w-full overflow-hidden rounded-xl shadow-2xl ring-1 ring-white/10 hover:ring-white/30 transition-all cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[#64FFDA] block ${isPlayerOpen ? 'pointer-events-none opacity-60' : ''}`}
          >
            <img
              src={content?.poster_path ? imageUrl(content.poster_path, 'w500') : FALLBACK_AVATAR}
              alt={title}
              className="w-full h-full object-cover"
              onError={(e) => { e.currentTarget.src = FALLBACK_AVATAR; }}
            />
          </button>
          <DetailStat label="Language" value={languageName} />
        </div>

        {/* Title + stats */}
        <div className="min-w-0 flex-1 self-end">
          <div className="text-[13px] text-[#ABABAB] overflow-x-auto whitespace-nowrap no-scrollbar">
            {meta.join(' | ')}
          </div>
          <h1 className="mt-1 text-[20px] leading-[28px] sm:text-[24px] sm:leading-[30px] font-semibold text-white">
            {title}
          </h1>
          <div className="mt-3 grid grid-rows-[auto_1fr] gap-2">
            <div className="grid grid-cols-2 gap-2">
              <DetailStat label="Country" value={countryLabel} />
              <DetailStat
                label={type === 'series' ? 'Seasons' : 'Age Rating'}
                value={type === 'series' ? String(content.number_of_seasons || 'N/A') : ageRatingLabel}
              />
            </div>
            <div className="self-end">{directorStat}</div>
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="mt-4 flex flex-col gap-2">
        <div className="flex gap-2">
          <div className="w-1/2">
            <ActionButton
              active={status.watched}
              label={status.watched ? 'Watched' : 'Mark as Watched'}
              onClick={onToggleWatched}
              icon="fas fa-eye"
              activeIcon="fas fa-check"
              loading={pendingAction === 'Watched'}
              tone="watched"
            />
          </div>
          <div className="w-1/2">
            <ActionButton
              active={status.watchlist}
              label={status.watchlist ? 'In Watchlist' : 'Add to Watchlist'}
              onClick={onToggleWatchlist}
              icon="fas fa-clock"
              activeIcon="fas fa-check"
              loading={pendingAction === 'Watchlist'}
              tone="watchlist"
            />
          </div>
        </div>
        <SaveButton status={status} pendingAction={pendingAction} onClick={onOpenSaveModal} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Desktop layout (xl+)
// ---------------------------------------------------------------------------

function DesktopLayout({
  content, title, type, meta, status, pendingAction,
  directorStat, countryLabel, languageName, ageRatingLabel,
  onToggleWatched, onToggleWatchlist, onOpenSaveModal, onPosterClick, isPlayerOpen,
}) {
  return (
    <div className="hidden xl:block">
      <div className="-mt-[13rem] flex w-full flex-row items-end gap-8">
        {/* Poster */}
        <button 
          type="button"
          onClick={onPosterClick}
          disabled={isPlayerOpen}
          className={`w-[200px] aspect-[2/3] overflow-hidden rounded-2xl shadow-2xl flex-shrink-0 ring-1 ring-white/10 hover:ring-white/30 transition-all cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[#64FFDA] block ${isPlayerOpen ? 'pointer-events-none opacity-60' : ''}`}
        >
          <img
            src={content?.poster_path ? imageUrl(content.poster_path, 'w500') : FALLBACK_AVATAR}
            alt={title}
            className="w-full h-full object-cover"
            onError={(e) => { e.currentTarget.src = FALLBACK_AVATAR; }}
          />
        </button>

        {/* Title + stats */}
        <div className="min-w-0 flex-1">
          <div className="text-sm text-[#ABABAB] overflow-x-auto whitespace-nowrap no-scrollbar">
            {meta.join(' | ')}
          </div>
          <h1 className="mt-1 text-[28px] leading-[36px] font-semibold text-white">{title}</h1>
          <div className="mt-6 grid grid-cols-4 gap-5">
            {directorStat}
            <DetailStat label="Country" value={countryLabel} />
            <DetailStat label="Language" value={languageName} />
            <DetailStat
              label={type === 'series' ? 'Seasons' : 'Age Rating'}
              value={type === 'series' ? String(content.number_of_seasons || 'N/A') : (content.age_rating || content.status || 'N/A')}
            />
          </div>
        </div>

        {/* Action buttons */}
        <div className="xl:w-[376px] xl:flex xl:flex-col xl:gap-2.5 xl:self-end">
          <div className="flex h-[40px] gap-2.5">
            <div className="w-1/2">
              <ActionButton
                active={status.watched}
                label={status.watched ? 'Watched' : 'Mark as Watched'}
                onClick={onToggleWatched}
                icon="fas fa-eye"
                activeIcon="fas fa-check"
                loading={pendingAction === 'Watched'}
                tone="watched"
              />
            </div>
            <div className="w-1/2">
              <ActionButton
                active={status.watchlist}
                label={status.watchlist ? 'In Watchlist' : 'Add to Watchlist'}
                onClick={onToggleWatchlist}
                icon="fas fa-clock"
                activeIcon="fas fa-check"
                loading={pendingAction === 'Watchlist'}
                tone="watchlist"
              />
            </div>
          </div>
          <SaveButton status={status} pendingAction={pendingAction} onClick={onOpenSaveModal} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared save-to-collection button
// ---------------------------------------------------------------------------

function SaveButton({ status, pendingAction, onClick }) {
  const isCustomPending = pendingAction && !['Watched', 'Watchlist'].includes(pendingAction);
  return (
    <button
      type="button"
      disabled={!!pendingAction}
      className={`flex h-[40px] w-full items-center justify-center whitespace-nowrap rounded-full bg-white/10 px-6 text-white font-medium hover:bg-white/20 transition-colors ${pendingAction ? 'opacity-70 cursor-wait' : ''}`}
      onClick={onClick}
    >
      {isCustomPending ? (
        <i className="fas fa-spinner fa-spin mr-2 text-[13px]" />
      ) : (
        <i className={`${status.customSaved ? 'fas' : 'far'} fa-bookmark mr-2 text-[13px]`} />
      )}
      {isCustomPending
        ? 'Updating...'
        : status.customSaved
        ? 'Added to Collection'
        : 'Add to Collection'}
    </button>
  );
}
