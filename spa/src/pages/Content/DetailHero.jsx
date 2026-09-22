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

import { useState, useEffect } from 'react';
import { FALLBACK_AVATAR } from '../../utils/constants.js';
import { imageUrl } from '../../utils/formatters.js';
import { ActionButton } from '../../components/ui/ActionButton.jsx';
import { DetailStat } from '../../components/ui/Cards/DetailStat.jsx';

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
  
  // Posters logic
  const posters = content?.images?.posters || [];
  const hasPosters = posters.length > 0;
  const [currentPosterIndex, setCurrentPosterIndex] = useState(0);

  // Backdrops logic
  // Limit to max 5 backdrops to prevent massive network payload and memory usage
  const backdrops = (content?.images?.backdrops || []).slice(0, 5);
  const hasBackdrops = backdrops.length > 0;
  const [currentBackdropIndex, setCurrentBackdropIndex] = useState(0);
  const [failedBackdrops, setFailedBackdrops] = useState(new Set());

  useEffect(() => {
    if (!hasBackdrops || backdrops.length <= 1 || isPlayerOpen) return;
    const interval = setInterval(() => {
      setCurrentBackdropIndex((prev) => {
        let nextIndex = (prev + 1) % backdrops.length;
        // Skip failed backdrops
        let attempts = 0;
        while (failedBackdrops.has(nextIndex) && attempts < backdrops.length) {
          nextIndex = (nextIndex + 1) % backdrops.length;
          attempts++;
        }
        return nextIndex;
      });
    }, 3500);
    return () => clearInterval(interval);
  }, [backdrops.length, failedBackdrops, hasBackdrops, isPlayerOpen]);

  const handleBackdropError = (index) => {
    setFailedBackdrops(prev => new Set(prev).add(index));
  };

  const currentPosterPath = hasPosters
    ? posters[currentPosterIndex].file_path
    : content.poster_path;

  return (
    <section className="relative -mx-4 overflow-hidden bg-transparent sm:mx-0 sm:rounded-[28px] sm:border sm:border-white/10">
      {/* ── Backdrop image + play button ── */}
      <div className="relative aspect-[1.6/1] sm:aspect-[2.1/1] lg:aspect-[2.68/1] w-full overflow-hidden bg-black">
        {hasBackdrops ? (
          backdrops.map((backdrop, index) => (
            <img
              key={backdrop.file_path}
              src={imageUrl(backdrop.file_path, 'original')}
              alt={`${title} backdrop ${index + 1}`}
              className={`absolute inset-0 h-full w-full object-cover object-[center_22%] transition-opacity duration-1000 ease-in-out ${
                index === currentBackdropIndex ? 'opacity-100' : 'opacity-0'
              }`}
              onError={() => handleBackdropError(index)}
            />
          ))
        ) : (
          <img
            src={imageUrl(content.backdrop_path, 'original')}
            alt={title}
            className="absolute inset-0 h-full w-full object-cover object-[center_22%]"
            onError={(e) => { e.currentTarget.src = FALLBACK_AVATAR; }}
          />
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

        <div className="absolute inset-x-0 bottom-0 h-[48%] bg-gradient-to-t from-[#080808] via-[#080808]/78 to-transparent z-10" />
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
          onPosterClick={isPlayerOpen ? undefined : () => setViewerOpen(true)}
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
          onPosterClick={isPlayerOpen ? undefined : () => setViewerOpen(true)}
          isPlayerOpen={isPlayerOpen}
        />
      </div>

      {viewerOpen && (
        <div 
          className="fixed inset-0 z-[9999] flex items-center justify-center animate-in fade-in duration-200"
          style={{ background: 'radial-gradient(circle at center, rgba(30, 30, 30, 0.8) 0%, rgba(0, 0, 0, 0.2) 60%, transparent 100%)' }}
          onClick={() => setViewerOpen(false)}
        >
          {hasPosters && posters.length > 1 && (
            <button
              className="absolute left-4 z-20 flex h-12 w-12 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 md:left-10"
              onClick={(e) => {
                e.stopPropagation();
                setCurrentPosterIndex((prev) => (prev - 1 + posters.length) % posters.length);
              }}
            >
              <i className="fas fa-chevron-left" />
            </button>
          )}

          <img 
            key={currentPosterPath}
            src={imageUrl(currentPosterPath, 'original')}
            alt={title}
            className="relative z-10 max-h-[85vh] max-w-[90vw] rounded-2xl object-contain shadow-[0_0_80px_rgba(0,0,0,0.8)] animate-in fade-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
            onError={(event) => {
              event.currentTarget.src = FALLBACK_AVATAR;
            }}
          />

          {hasPosters && posters.length > 1 && (
            <button
              className="absolute right-4 z-20 flex h-12 w-12 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 md:right-10"
              onClick={(e) => {
                e.stopPropagation();
                setCurrentPosterIndex((prev) => (prev + 1) % posters.length);
              }}
            >
              <i className="fas fa-chevron-right" />
            </button>
          )}
          
          {hasPosters && posters.length > 1 && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-4 py-1 text-sm text-white">
              {currentPosterIndex + 1} / {posters.length}
            </div>
          )}

          {/* Preload adjacent posters for smooth swiping */}
          {hasPosters && posters.length > 1 && [-2, -1, 1, 2].map(offset => {
            const index = (currentPosterIndex + offset + posters.length) % posters.length;
            return (
              <img 
                key={`preload-${index}`} 
                src={imageUrl(posters[index].file_path, 'original')} 
                alt="" 
                className="hidden" 
              />
            );
          })}
        </div>
      )}
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
    <div className="-mt-10 sm:-mt-14 lg:-mt-20 xl:hidden">
      <div className="mt-4 flex items-start gap-4">
        {/* Poster */}
        <div className="w-[110px] sm:w-[140px] flex-shrink-0 space-y-2">
          <button 
            type="button"
            onClick={onPosterClick}
            disabled={isPlayerOpen}
            className={`aspect-[2/3] w-full overflow-hidden rounded-xl shadow-2xl ring-1 ring-white/10 hover:ring-white/30 transition-all cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[#64FFDA] block ${isPlayerOpen ? 'pointer-events-none opacity-60' : ''}`}
          >
            <img
              src={imageUrl(content.poster_path, 'w500')}
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
            src={imageUrl(content.poster_path, 'w500')}
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
