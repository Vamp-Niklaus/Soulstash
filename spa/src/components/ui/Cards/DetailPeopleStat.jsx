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

export function DetailPeopleStat({ label, people, navigate }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <p className="text-[13px] leading-4 text-[#ABABAB] font-medium">{label}</p>
      <p className="mt-2 whitespace-normal break-words text-[14px] leading-[20px] text-[#E2E2E2] font-semibold">
        {people.map((person, index) => (
          <React.Fragment key={person.id}>
            {index > 0 ? <span className="text-[#8f8f8f]">, </span> : null}
            <button
              type="button"
              className="font-semibold text-[#E2E2E2] underline-offset-4 transition-colors hover:text-white hover:underline"
              onClick={() => navigate(`/person/${person.id}`)}
            >
              {person.name}
            </button>
          </React.Fragment>
        ))}
      </p>
    </div>
  );
}
