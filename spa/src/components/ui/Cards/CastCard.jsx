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

export function CastCard({ person }) {
  const navigate = useNavigate();

  return (
    <button
      type="button"
      className="w-[130px] shrink-0 text-left rounded-2xl overflow-hidden border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] transition-colors relative group cursor-pointer"
      onClick={() => navigate(`/person/${person.id}`)}
    >
      <div className="aspect-[2/3] overflow-hidden relative">
        <img
          src={imageUrl(person.profile_path, 'w300_and_h450_face')}
          alt={person.name}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          onError={(event) => {
            event.currentTarget.src = FALLBACK_AVATAR;
          }}
        />
        {/* Ranking badge for series cast */}
        {person.ranking ? (
          <div className="absolute top-1.5 left-1.5 rounded-md bg-black/80 backdrop-blur-md px-1.5 py-0.5 text-[10px] font-bold text-amber-400 border border-amber-400/30 shadow">
            #{person.ranking}
          </div>
        ) : null}
        {/* Frequency badge (episode count across seasons) */}
        {person.total_episode_count > 0 ? (
          <div className="absolute bottom-1.5 right-1.5 rounded-md bg-black/80 backdrop-blur-md px-1.5 py-0.5 text-[10px] font-medium text-white/90 border border-white/20 shadow">
            {person.total_episode_count} {person.total_episode_count === 1 ? 'ep' : 'eps'}
          </div>
        ) : null}
      </div>
      <div className="p-3">
        <h3 className="text-sm font-semibold text-white truncate" title={person.name}>{person.name}</h3>
        <p className="text-xs text-[#a6a6a6] truncate mt-1" title={person.character || person.job || 'Cast'}>
          {person.character || person.job || 'Cast'}
        </p>
      </div>
    </button>
  );
}
