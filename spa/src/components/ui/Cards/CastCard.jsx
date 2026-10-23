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
      className="w-[130px] shrink-0 text-left rounded-2xl overflow-hidden border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] transition-colors"
      onClick={() => navigate(`/person/${person.id}`)}
    >
      <div className="aspect-[2/3] overflow-hidden">
        <img
          src={imageUrl(person.profile_path, 'w300_and_h450_face')}
          alt={person.name}
          className="w-full h-full object-cover"
          onError={(event) => {
            event.currentTarget.src = FALLBACK_AVATAR;
          }}
        />
      </div>
      <div className="p-3">
        <h3 className="text-sm font-semibold text-white truncate">{person.name}</h3>
        <p className="text-xs text-[#a6a6a6] truncate mt-1">{person.character || person.job || 'Cast'}</p>
      </div>
    </button>
  );
}
