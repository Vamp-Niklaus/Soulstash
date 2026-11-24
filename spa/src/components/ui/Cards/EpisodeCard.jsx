import React from 'react';
import { FALLBACK_AVATAR } from '../../../utils/constants.js';
import { formatRuntime, imageUrl } from '../../../utils/formatters.js';

export function EpisodeCard({
  episode,
  onPlay,
  isWatched = false,
  isNext = false,
  isResume = false,
  onToggleWatched,
}) {
  let playBtnLabel = 'Watch Episode';
  let playBtnIcon = 'fa-play';
  if (isResume) {
    playBtnLabel = 'Resume Episode';
  } else if (isNext) {
    playBtnLabel = 'Watch Next';
    playBtnIcon = 'fa-forward-step';
  } else if (isWatched) {
    playBtnLabel = 'Watch Again';
    playBtnIcon = 'fa-rotate-right';
  }

  return (
    <article
      data-episode-number={episode.episode_number}
      className={`w-[260px] shrink-0 overflow-hidden rounded-[20px] border transition-all duration-300 ${
        isResume || isNext
          ? 'border-purple-500/60 bg-purple-950/20 shadow-[0_0_24px_rgba(168,85,247,0.18)] ring-1 ring-purple-500/40'
          : isWatched
          ? 'border-white/10 bg-white/[0.02] opacity-90 hover:opacity-100'
          : 'border-white/8 bg-white/[0.03]'
      }`}
    >
      <div className="relative aspect-video bg-[#121212] overflow-hidden group">
        <img
          src={imageUrl(episode.still_path, 'w500')}
          alt={episode.name}
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          onError={(event) => {
            event.currentTarget.src = FALLBACK_AVATAR;
          }}
        />

        {/* Status Pills */}
        <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5 z-10 pointer-events-none">
          {isWatched && (
            <span className="flex items-center gap-1 rounded-full bg-black/80 px-2 py-0.5 text-[10px] font-semibold text-emerald-400 border border-emerald-500/50 backdrop-blur-md shadow-md">
              <i className="fas fa-check text-[8px]" /> Watched
            </span>
          )}
          {isResume && (
            <span className="flex items-center gap-1 rounded-full bg-purple-950/90 px-2 py-0.5 text-[10px] font-semibold text-purple-200 border border-purple-400/50 backdrop-blur-md shadow-md animate-pulse">
              <i className="fas fa-play text-[7px]" /> Resume
            </span>
          )}
          {isNext && (
            <span className="flex items-center gap-1 rounded-full bg-indigo-950/90 px-2 py-0.5 text-[10px] font-semibold text-indigo-200 border border-indigo-400/50 backdrop-blur-md shadow-md">
              <i className="fas fa-forward-step text-[7px]" /> Up Next
            </span>
          )}
        </div>

        {/* Hover play button */}
        {onPlay ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              type="button"
              onClick={() => onPlay(episode)}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-black/70 text-white backdrop-blur-sm hover:bg-black/90 hover:scale-105 transition-all shadow-lg"
              aria-label={`Play episode ${episode.episode_number}`}
            >
              <i className="fas fa-play translate-x-[1px] text-sm"></i>
            </button>
          </div>
        ) : null}
      </div>

      <div className="p-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-[0.2em] text-[#d0a4ff]">
              Episode {episode.episode_number}
            </span>
            {isWatched && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400" title="Watched">
                <i className="fas fa-check-circle text-[10px]" />
              </span>
            )}
          </div>
          <span className="text-xs text-[#9f9f9f]">
            {episode.runtime ? formatRuntime(episode.runtime) : (episode.air_date || 'TBA')}
          </span>
        </div>
        <h4 className="text-[15px] font-semibold leading-5 text-white line-clamp-1">{episode.name}</h4>
        <p className="mt-2 text-[13px] leading-5 text-[#b7b7b7] line-clamp-3">
          {episode.overview || 'Episode overview is not available yet.'}
        </p>
        <div className="mt-3 flex items-center gap-2">
          {onPlay ? (
            <button
              type="button"
              onClick={() => onPlay(episode)}
              className={`flex-1 flex items-center justify-center gap-2 rounded-2xl py-2 text-[13px] font-medium transition-all ${
                isResume || isNext
                  ? 'bg-purple-600 text-white hover:bg-purple-500 shadow-md shadow-purple-900/30'
                  : 'bg-white/[0.08] text-white hover:bg-white/[0.14]'
              }`}
            >
              <i className={`fas ${playBtnIcon} text-[11px] translate-x-[1px]`}></i>
              {playBtnLabel}
            </button>
          ) : null}
          {onToggleWatched ? (
            <button
              type="button"
              onClick={onToggleWatched}
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border transition-colors ${
                isWatched
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                  : 'border-white/10 bg-white/[0.05] text-[#888] hover:bg-white/10 hover:text-white'
              }`}
              title={isWatched ? 'Mark as unwatched' : 'Mark as watched'}
              aria-label={isWatched ? 'Mark as unwatched' : 'Mark as watched'}
            >
              <i className="fas fa-check text-xs" />
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}
