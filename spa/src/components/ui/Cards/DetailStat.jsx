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

export function DetailStat({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <p className="text-[13px] leading-4 text-[#ABABAB] font-medium">{label}</p>
      <p className="mt-2 whitespace-normal break-words text-[14px] leading-[20px] text-[#E2E2E2] font-semibold">{value}</p>
    </div>
  );
}
