import React, { useRef } from 'react';
import { useNavigate, NavLink } from 'react-router-dom';
import { FALLBACK_AVATAR } from '../../../utils/constants.js';
import {
  formatRuntime, yearFrom, getLanguageName, getPrimaryCountry,
  getDirectorLabel, getDirectorPeople, getValidImdbRating,
  getValidVoteAverage, getPreferredRating, creditItemKey,
  creditMatchesCollectionItem, filterCreditsByCollectionItems,
  isContentInCollection, imageUrl
} from '../../../utils/formatters.js';

export function EpisodeCard({ episode, onPlay }) {
  return (
    <article className="w-[260px] shrink-0 overflow-hidden rounded-[20px] border border-white/8 bg-white/[0.03]">
      <div className="relative aspect-video bg-[#121212] overflow-hidden group">
        <img
          src={imageUrl(episode.still_path, 'w500')}
          alt={episode.name}
          className="w-full h-full object-cover"
          onError={(event) => {
            event.currentTarget.src = FALLBACK_AVATAR;
          }}
        />
        {onPlay ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              type="button"
              onClick={() => onPlay(episode)}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm hover:bg-black/80 transition-colors"
              aria-label={`Play episode ${episode.episode_number}`}
            >
              <i className="fas fa-play translate-x-[1px] text-sm"></i>
            </button>
          </div>
        ) : null}
      </div>
      <div className="p-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-xs uppercase tracking-[0.2em] text-[#d0a4ff]">
            Episode {episode.episode_number}
          </span>
          <span className="text-xs text-[#9f9f9f]">
            {episode.runtime ? formatRuntime(episode.runtime) : (episode.air_date || 'TBA')}
          </span>
        </div>
        <h4 className="text-[15px] font-semibold leading-5 text-white">{episode.name}</h4>
        <p className="mt-2 text-[13px] leading-5 text-[#b7b7b7] line-clamp-3">
          {episode.overview || 'Episode overview is not available yet.'}
        </p>
        {onPlay ? (
          <button
            type="button"
            onClick={() => onPlay(episode)}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-white/[0.08] py-2 text-[13px] font-medium text-white hover:bg-white/[0.14] transition-colors"
          >
            <i className="fas fa-play text-[11px] translate-x-[1px]"></i>
            Watch Episode
          </button>
        ) : null}
      </div>
    </article>
  );
}
