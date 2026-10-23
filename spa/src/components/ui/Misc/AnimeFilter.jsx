import React from 'react';
export function AnimeFilterIcon({ mode, className = '' }) {
  if (mode === 'no') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden="true">
        <circle cx="12" cy="12" r="8"></circle>
      </svg>
    );
  }

  if (mode === 'only') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden="true">
        <rect x="5" y="5" width="14" height="14" rx="2.5"></rect>
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden="true">
      <circle cx="10" cy="10" r="5.5"></circle>
      <rect x="11.5" y="11.5" width="7.5" height="7.5" rx="1.7"></rect>
    </svg>
  );
}

function filterLabel(filters) {
  switch (filters.anime) {
    case 'no':
      return 'Hide anime';
    case 'only':
      return 'Only anime';
    default:
      return 'Show anime';
  }
}

function sortLabel(filters) {
  switch (filters.sortBy) {
    case 'oldest':
      return 'Oldest';
    case 'rating-desc':
      return 'Rating high';
    case 'rating-asc':
      return 'Rating low';
    case 'title-asc':
      return 'Title A-Z';
    case 'title-desc':
      return 'Title Z-A';
    case 'year-desc':
      return 'Year new';
    case 'year-asc':
      return 'Year old';
    default:
      return 'Recent';
  }
}

