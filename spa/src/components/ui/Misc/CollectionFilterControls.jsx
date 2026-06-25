import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AnimeFilterIcon } from './AnimeFilter.jsx';
import { filterLabel, sortLabel } from '../../../utils/helpers.js';
import { useDropdownKeyNav } from '../../../hooks/index.js';
export function CollectionFilterControls({
  filters,
  setFilters,
  noWrap = false,
  stacked = false,
  size = 'default'
}) {
  const triggerRef = useRef(null);
  const dropdownRef = useRef(null);
  const [animeMenuOpen, setAnimeMenuOpen] = useState(false);
  const [animeMenuStyle, setAnimeMenuStyle] = useState({});
  const sortTriggerRef = useRef(null);
  const sortDropdownRef = useRef(null);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [sortMenuStyle, setSortMenuStyle] = useState({});

  const sortOptions = [
    { value: 'recent', label: 'Recent' },
    { value: 'oldest', label: 'Oldest' },
    { value: 'rating-desc', label: 'Rating high' },
    { value: 'rating-asc', label: 'Rating low' },
    { value: 'title-asc', label: 'Title A-Z' },
    { value: 'title-desc', label: 'Title Z-A' },
    { value: 'year-desc', label: 'Year new' },
    { value: 'year-asc', label: 'Year old' }
  ];

  function buildAnimeMenuPosition(trigger) {
    if (!trigger) return {};
    const rect = trigger.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const estimatedWidth = 176;
    const estimatedHeight = 148;
    const left = Math.min(Math.max(8, rect.left), Math.max(8, viewportWidth - estimatedWidth - 8));
    const belowTop = rect.bottom + 6;
    const aboveTop = rect.top - estimatedHeight - 6;
    const top = belowTop + estimatedHeight <= viewportHeight - 8 || aboveTop < 8
      ? Math.min(belowTop, Math.max(8, viewportHeight - estimatedHeight - 8))
      : aboveTop;
    return {
      position: 'fixed',
      zIndex: 2147483647,
      top: `${top}px`,
      left: `${left}px`,
      boxSizing: 'border-box'
    };
  }

  function buildSortMenuPosition(trigger) {
    if (!trigger) return {};
    const rect = trigger.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const estimatedWidth = Math.min(332, viewportWidth - 16);
    const estimatedHeight = 214;
    const left = Math.min(
      Math.max(8, rect.left),
      Math.max(8, viewportWidth - estimatedWidth - 8)
    );
    const belowTop = rect.bottom + 6;
    const aboveTop = rect.top - estimatedHeight - 6;
    const top = belowTop + estimatedHeight <= viewportHeight - 8 || aboveTop < 8
      ? Math.min(belowTop, Math.max(8, viewportHeight - estimatedHeight - 8))
      : aboveTop;
    return {
      position: 'fixed',
      zIndex: 2147483647,
      top: `${top}px`,
      left: `${left}px`,
      width: `${estimatedWidth}px`,
      maxWidth: 'calc(100vw - 16px)',
      boxSizing: 'border-box'
    };
  }

  // Always track scroll + resize to keep dropdown pinned to the trigger
  useEffect(() => {
    if (!animeMenuOpen && !sortMenuOpen) return undefined;

    function updatePosition() {
      if (triggerRef.current) {
        setAnimeMenuStyle(buildAnimeMenuPosition(triggerRef.current));
      }
      if (sortTriggerRef.current) {
        setSortMenuStyle(buildSortMenuPosition(sortTriggerRef.current));
      }
    }

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [animeMenuOpen, sortMenuOpen]);

  // Close on outside click - but ignore clicks on the trigger itself (handled by toggle)
  useEffect(() => {
    if (!animeMenuOpen && !sortMenuOpen) return undefined;

    function handleOutsideClick(event) {
      if (triggerRef.current && triggerRef.current.contains(event.target)) return;
      if (dropdownRef.current && dropdownRef.current.contains(event.target)) return;
      if (sortTriggerRef.current && sortTriggerRef.current.contains(event.target)) return;
      if (sortDropdownRef.current && sortDropdownRef.current.contains(event.target)) return;
      setAnimeMenuOpen(false);
      setSortMenuOpen(false);
    }

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [animeMenuOpen, sortMenuOpen]);

  const sizing = size === 'desktop'
    ? {
        rowGap: 'gap-2',
        outerHeight: 'h-10',
        pillInnerHeight: 'h-10',
        pillPadding: 'px-3',
        text: 'text-[13px]',
        icon: 'h-4 w-4',
        pillWidth: 'w-auto',
        watchedWidth: 'w-auto'
      }
    : {
        rowGap: 'gap-2',
        outerHeight: 'h-9',
        pillInnerHeight: 'h-8',
        pillPadding: 'px-3',
        text: 'text-[13px]',
        icon: 'h-3.5 w-3.5',
        pillWidth: 'w-auto',
        watchedWidth: 'w-auto'
      };

  const AnimeDropdownContent = () => {
    const ref = useRef(null);
    useDropdownKeyNav(ref, () => setAnimeMenuOpen(false));

    return (
      <div
        ref={(el) => { dropdownRef.current = el; ref.current = el; }}
        style={animeMenuStyle}
        className="inline-flex min-w-max flex-col items-stretch rounded-[16px] border border-white/12 bg-[#111111] p-2 shadow-[0_24px_60px_rgba(0,0,0,0.55)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {[
          { value: 'yes', label: 'Show Anime' },
          { value: 'no', label: 'Hide Anime' },
          { value: 'only', label: 'Only Anime' }
        ].map((option) => (
          <button
            key={option.value}
            type="button"
            className={`inline-flex w-full items-center gap-2 whitespace-nowrap rounded-[12px] px-3 py-2.5 ${sizing.text} text-left focus:outline-none focus:ring-2 focus:ring-white ${
              filters.anime === option.value ? 'bg-white/[0.08] text-white' : 'text-[#d0d0d0] hover:bg-white/[0.05]'
            }`}
            onClick={() => {
              setFilters((current) => ({ ...current, anime: option.value }));
              setAnimeMenuOpen(false);
            }}
          >
            <AnimeFilterIcon mode={option.value} className="h-4 w-4 shrink-0" />
            <span>{option.label}</span>
          </button>
        ))}
      </div>
    );
  };

  const SortDropdownContent = () => {
    const ref = useRef(null);
    useDropdownKeyNav(ref, () => setSortMenuOpen(false));

    return (
      <div
        ref={(el) => { sortDropdownRef.current = el; ref.current = el; }}
        style={sortMenuStyle}
        className="inline-flex min-w-max flex-col items-stretch rounded-[16px] border border-white/12 bg-[#111111] p-2 shadow-[0_24px_60px_rgba(0,0,0,0.55)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="grid grid-cols-2 gap-1.5">
          {sortOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`inline-flex w-full items-center gap-2 whitespace-nowrap rounded-[12px] px-3 py-2.5 ${sizing.text} text-left focus:outline-none focus:ring-2 focus:ring-white ${
                filters.sortBy === option.value ? 'bg-white/[0.08] text-white' : 'text-[#d0d0d0] hover:bg-white/[0.05]'
              }`}
              onClick={() => {
                setFilters((current) => ({ ...current, sortBy: option.value }));
                setSortMenuOpen(false);
              }}
            >
              <i className="fas fa-sort h-4 w-4 shrink-0 text-center"></i>
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      </div>
    );
  };

  const dropdown = animeMenuOpen
    ? createPortal(<AnimeDropdownContent />, document.body)
    : null;

  const sortDropdown = sortMenuOpen
    ? createPortal(<SortDropdownContent />, document.body)
    : null;

  return (
    <div
      data-tv-filters="true"
      className={`${noWrap ? 'w-max min-w-max' : stacked ? 'w-max max-w-full' : 'max-w-full'} ${stacked ? `flex flex-col items-start ${sizing.rowGap}` : `filter-scrollbar-hidden flex items-center ${sizing.rowGap} ${noWrap ? 'flex-nowrap overflow-visible' : 'flex-nowrap overflow-x-auto overflow-y-visible'}`}`}
    >
      {/* All / Movies / Series pill group */}
      <div className={`inline-flex items-center self-start ${sizing.rowGap} flex-shrink-0`}>
        {['all', 'movies', 'series'].map((type) => (
          <button
            key={type}
            type="button"
            className={`inline-flex items-center justify-center whitespace-nowrap ${sizing.pillWidth} ${sizing.pillInnerHeight} ${sizing.pillPadding} py-0.5 ${sizing.text} font-medium ${size === 'desktop' ? 'rounded-[20px]' : 'rounded-[18px]'} transition-colors focus:outline-none focus:ring-2 focus:ring-white`}
            style={{
              color: filters.contentType === type ? 'rgb(226, 226, 226)' : 'rgb(168, 168, 168)',
              backgroundColor: filters.contentType === type ? 'rgb(71, 71, 71)' : 'rgb(21, 21, 21)'
            }}
            onClick={() => setFilters((current) => ({ ...current, contentType: type }))}
          >
            {type === 'all' ? 'All' : type === 'movies' ? 'Movies' : 'Series'}
          </button>
        ))}
      </div>

      {/* Anime filter trigger - dropdown rendered via portal into document.body */}
      <div className={`relative flex-shrink-0 ${stacked ? 'max-w-full' : ''}`}>
        <button
          ref={triggerRef}
          type="button"
          className={`inline-flex ${sizing.outerHeight} max-w-full items-center justify-between gap-1.5 ${size === 'desktop' ? 'rounded-[20px]' : 'rounded-[18px]'} bg-[#151515] ${size === 'desktop' ? 'px-3' : 'px-2.5'} ${sizing.text} font-medium text-[#d9d9d9] focus:outline-none focus:ring-2 focus:ring-white`}
          onClick={(event) => {
            // Recompute position from live trigger rect on every toggle
            setAnimeMenuStyle(buildAnimeMenuPosition(event.currentTarget));
            setSortMenuOpen(false);
            setAnimeMenuOpen((current) => !current);
          }}
          title={filterLabel(filters)}
        >
          <span className="inline-flex items-center gap-1.5 min-w-0">
            <AnimeFilterIcon mode={filters.anime} className={`${sizing.icon} shrink-0 text-[#d4d4d4]`} />
            <span className="truncate">{filterLabel(filters)}</span>
          </span>
          <i className={`fas fa-chevron-down ${size === 'desktop' ? 'text-[10px]' : 'text-[9px]'} text-[#7f7f7f] flex-shrink-0 ml-1`}></i>
        </button>
        {dropdown}
      </div>

      <div className={`relative flex-shrink-0 ${stacked ? 'max-w-full' : ''}`}>
        <button
          ref={sortTriggerRef}
          type="button"
          className={`inline-flex ${sizing.outerHeight} max-w-full items-center justify-between gap-1.5 ${size === 'desktop' ? 'rounded-[20px]' : 'rounded-[18px]'} bg-[#151515] ${size === 'desktop' ? 'px-3' : 'px-3'} ${sizing.text} font-medium text-[#d9d9d9] focus:outline-none focus:ring-2 focus:ring-white`}
          onClick={(event) => {
            setSortMenuStyle(buildSortMenuPosition(event.currentTarget));
            setAnimeMenuOpen(false);
            setSortMenuOpen((current) => !current);
          }}
          title={sortLabel(filters)}
        >
          <span className="inline-flex items-center gap-1.5 min-w-0">
            <i className={`fas fa-sort ${sizing.icon} shrink-0 text-[#d4d4d4] text-center`}></i>
            <span className="truncate">{sortLabel(filters)}</span>
          </span>
          <i className={`fas fa-chevron-down ${size === 'desktop' ? 'text-[10px]' : 'text-[9px]'} text-[#7f7f7f] flex-shrink-0 ml-1`}></i>
        </button>
        {sortDropdown}
      </div>

      {/* Hide / Show Watched */}
      <button
        type="button"
        className={`inline-flex ${sizing.outerHeight} ${stacked ? 'max-w-full justify-start' : sizing.watchedWidth} flex-shrink-0 items-center justify-center gap-1.5 ${size === 'desktop' ? 'rounded-[20px]' : 'rounded-[18px]'} ${size === 'desktop' ? 'px-3' : 'px-2.5'} ${sizing.text} font-medium transition-colors ${filters.hideWatched ? 'bg-white text-black' : 'bg-[#151515] text-[#d9d9d9]'} focus:outline-none focus:ring-2 focus:ring-white`}
        onClick={() => setFilters((current) => ({ ...current, hideWatched: !current.hideWatched }))}
        title={filters.hideWatched ? 'Show Watched' : 'Hide Watched'}
      >
        <i className={`fas ${filters.hideWatched ? 'fa-eye-slash' : 'fa-eye'} shrink-0`}></i>
        <span>{filters.hideWatched ? 'Show Watched' : 'Hide Watched'}</span>
      </button>
    </div>
  );
}

