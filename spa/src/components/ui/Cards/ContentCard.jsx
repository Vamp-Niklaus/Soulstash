import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { FALLBACK_AVATAR, FALLBACK_POSTER } from '../../../utils/constants.js';
import {
  formatRuntime, yearFrom, getLanguageName, getPrimaryCountry,
  getDirectorLabel, getDirectorPeople, getValidImdbRating,
  getValidVoteAverage, getPreferredRating, creditItemKey,
  creditMatchesCollectionItem, filterCreditsByCollectionItems,
  isContentInCollection, imageUrl, normalizeStoredCollectionItem, mediaRoute
} from '../../../utils/formatters.js';

export const ContentCard = React.forwardRef(function ContentCard({ item, status = null, onRemove, itemId, ...props }, ref) {
  const navigate = useNavigate();
  const title = item.title || item.name || 'Unknown';
  const contentType = item.media_type || (item.title ? 'Movie' : 'Series');

  return (
    <button
      ref={ref}
      type="button"
      {...props}
      className="card group relative"
      onClick={() => navigate(mediaRoute(item))}
      aria-label={title}
    >
      <div className="cardImageWrap relative">
        <img
          src={imageUrl(item.poster_path, 'w500')}
          alt={title}
          className="cardImg fadeImg"
          loading="lazy"
          decoding="async"
          onError={(event) => {
            event.currentTarget.src = FALLBACK_POSTER;
          }}
        />
        {status?.watched ? (
          <span className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#10B981] text-white shadow-[0_8px_18px_rgba(0,0,0,0.28)] z-10">
            <i className="fas fa-eye text-[15px] text-black"></i>
          </span>
        ) : null}
        {!status?.watched && status?.watchlist ? (
          <span className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#F59E0B] text-white shadow-[0_8px_18px_rgba(0,0,0,0.28)] z-10">
            <i className="fas fa-clock text-[15px] text-black"></i>
          </span>
        ) : null}
        {onRemove ? (
          <div
            className="absolute top-2 right-2 remove-btn w-8 h-8 rounded-full bg-black/72 text-white hover:bg-black/90 transition-colors flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-white z-20"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onRemove(itemId || item.id, title);
            }}
            aria-label={`Remove ${title}`}
            role="button"
            tabIndex={0}
          >
            <i className="fas fa-times text-[12px]"></i>
          </div>
        ) : null}
      </div>
      <div className="cardMeta">
        <div className="cardTitleWrap">
          <h3 className={`cardTitle ${title.length > 18 ? 'marquee-on-hover' : ''}`} data-title={title}>{title}</h3>
        </div>
        <div className="cardSubMeta">
          <span className="cardSubMetaItem">
            <svg className="cardSubMetaStar" viewBox="0 0 24 24" width="11" height="11" aria-hidden="true">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
            </svg>
            <span className="cardSubMetaNum">{getPreferredRating(item)?.toFixed(1) || 'N/A'}</span>
          </span>
          <span className="cardSubMetaSep" aria-hidden="true">·</span>
          <span className="cardSubMetaItem cardSubMetaNum">{yearFrom(item)}</span>
          <span className="cardSubMetaSep" aria-hidden="true">·</span>
          <span className="cardSubMetaItem">{contentType}</span>
        </div>
      </div>
    </button>
  );
});

function getHomeGridColumns(width = window.innerWidth) {
  if (width >= 1280) return 7;
  if (width >= 1024) return 6;
  if (width >= 768) return 5;
  if (width >= 640) return 4;
  return 3;
}

function useGridKeyNav(containerRef, itemSelector = 'button[data-card]') {
  useEffect(() => {
    // D-pad grid navigation is owned by tvNav.js. Keep this hook as a no-op
    // for older call sites while avoiding a second window key handler.
    return undefined;

    // IMPORTANT: Listen on window, not the container.
    // The container ref may be null at mount time (skeleton shown first).
    // We look up containerRef.current on EVERY key press instead.
    const handleKeyDown = (event) => {
      if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)) return;

      const container = containerRef.current;
      if (!container) {
        console.log('[NAV-DEBUG] useGridKeyNav: key pressed but container still null - skipping');
        return;
      }

      const cards = Array.from(container.querySelectorAll(itemSelector));
      const current = document.activeElement;
      const currentIndex = cards.indexOf(current);
      console.log(`[NAV-DEBUG] useGridKeyNav key=${event.key} | cards found=${cards.length} | currentIndex=${currentIndex} | activeEl=`, current);

      if (currentIndex === -1) {
        console.log('[NAV-DEBUG] useGridKeyNav: focused element not in card list - no-op');
        return;
      }

      // Calculate columns from grid layout
      let cols = 1;
      if (cards.length > 1) {
        const firstRect = cards[0].getBoundingClientRect();
        cols = cards.filter(c => Math.abs(c.getBoundingClientRect().top - firstRect.top) < 5).length;
        if (cols === 0) cols = 1;
      }
      console.log(`[NAV-DEBUG] useGridKeyNav: detected ${cols} columns`);

      let nextIndex = -1;
      if (event.key === 'ArrowRight') nextIndex = currentIndex + 1;
      if (event.key === 'ArrowLeft') nextIndex = currentIndex - 1;
      if (event.key === 'ArrowDown') nextIndex = currentIndex + cols;
      if (event.key === 'ArrowUp') nextIndex = currentIndex - cols;

      if (nextIndex >= 0 && nextIndex < cards.length) {
        event.preventDefault();
        console.log(`[NAV-DEBUG] useGridKeyNav: moving to card index ${nextIndex}`, cards[nextIndex]);
        cards[nextIndex].focus();
        cards[nextIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } else {
        console.log(`[NAV-DEBUG] useGridKeyNav: nextIndex=${nextIndex} out of range [0..${cards.length-1}] - at edge`);
      }
    };

    console.log('[NAV-DEBUG] useGridKeyNav: window keydown listener registered (will resolve container on each key press)');
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  // Empty deps - register once, resolve ref dynamically on every key press
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function useDropdownKeyNav(dropdownRef, onClose) {
  useEffect(() => {
    const dropdown = dropdownRef.current;
    if (!dropdown) return;

    // Auto-focus first item when dropdown opens
    const firstBtn = dropdown.querySelector('button');
    if (firstBtn) firstBtn.focus();

    const handleKeyDown = (event) => {
      const buttons = Array.from(dropdown.querySelectorAll('button'));
      const currentIndex = buttons.indexOf(document.activeElement);

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        buttons[currentIndex + 1]?.focus();
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (currentIndex === 0) onClose();
        else buttons[currentIndex - 1]?.focus();
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    dropdown.addEventListener('keydown', handleKeyDown);
    return () => dropdown.removeEventListener('keydown', handleKeyDown);
  }, [dropdownRef, onClose]);
}

function useHomeTwoRowLimit() {
  const [limit, setLimit] = useState(() => getHomeGridColumns() * 2);

  useEffect(() => {
    function handleResize() {
      setLimit(getHomeGridColumns() * 2);
    }

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return limit;
}
