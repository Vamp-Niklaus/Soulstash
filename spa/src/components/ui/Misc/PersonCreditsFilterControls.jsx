import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AnimeFilterIcon } from './AnimeFilter.jsx';
import { useDropdownKeyNav } from '../../../hooks/index.js';
export function PersonCreditsFilterControls({
  contentType,
  setContentType,
  quickFilter,
  setQuickFilter,
  collectionFilter,
  setCollectionFilter,
  sortBy,
  setSortBy,
  collectionOptions,
  resetKey,
  collectionsLoading = false
}) {
  const collectionTriggerRef = useRef(null);
  const collectionDropdownRef = useRef(null);
  const [collectionMenuOpen, setCollectionMenuOpen] = useState(false);
  const [collectionMenuStyle, setCollectionMenuStyle] = useState({});
  const sortTriggerRef = useRef(null);
  const sortDropdownRef = useRef(null);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [sortMenuStyle, setSortMenuStyle] = useState({});

  const sortOptions = [
    { value: 'rating-desc', label: 'Rating high' },
    { value: 'rating-asc', label: 'Rating low' },
    { value: 'year-desc', label: 'Year new' },
    { value: 'year-asc', label: 'Year old' }
  ];

  const activeCollectionLabel =
    collectionOptions.find((option) => option.value === collectionFilter)?.label || 'All';

  const activeSortLabel =
    sortOptions.find((option) => option.value === sortBy)?.label || 'Rating high';

  function buildMenuPosition(trigger, estimatedWidth = 220, estimatedHeight = 220) {
    if (!trigger) return {};
    const rect = trigger.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const width = Math.min(estimatedWidth, viewportWidth - 16);
    const left = Math.min(Math.max(8, rect.left), Math.max(8, viewportWidth - width - 8));
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
      width: `${width}px`,
      maxWidth: 'calc(100vw - 16px)',
      boxSizing: 'border-box'
    };
  }

  useEffect(() => {
    setCollectionMenuOpen(false);
    setSortMenuOpen(false);
  }, [resetKey]);

  useEffect(() => {
    if (!collectionMenuOpen && !sortMenuOpen) return undefined;

    function updatePosition() {
      if (collectionTriggerRef.current) {
        setCollectionMenuStyle(buildMenuPosition(collectionTriggerRef.current, 240, Math.max(180, collectionOptions.length * 42 + 16)));
      }
      if (sortTriggerRef.current) {
        setSortMenuStyle(buildMenuPosition(sortTriggerRef.current, 220, 196));
      }
    }

    function handleOutside(event) {
      if (collectionTriggerRef.current?.contains(event.target)) return;
      if (collectionDropdownRef.current?.contains(event.target)) return;
      if (sortTriggerRef.current?.contains(event.target)) return;
      if (sortDropdownRef.current?.contains(event.target)) return;
      setCollectionMenuOpen(false);
      setSortMenuOpen(false);
    }

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    document.addEventListener('mousedown', handleOutside);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      document.removeEventListener('mousedown', handleOutside);
    };
  }, [collectionMenuOpen, sortMenuOpen, collectionOptions.length]);

  return (
    <>
      <div className="flex min-w-max flex-nowrap items-center gap-2">
        {[
          { value: 'all', label: 'All', kind: 'content' },
          { value: 'movies', label: 'Movies', kind: 'content' },
          { value: 'series', label: 'Series', kind: 'content' },
          { value: 'watched', label: 'Watched', kind: 'quick' },
          { value: 'watchlist', label: 'Watchlist', kind: 'quick' }
        ].map((option) => {
          const isQuick = option.kind === 'quick';
          const requiresCollections = isQuick && option.value !== 'all';
          const disabled = collectionsLoading && requiresCollections;
          const isActive = isQuick ? quickFilter === option.value : contentType === option.value;
          return (
            <button
              key={`${option.kind}-${option.value}`}
              type="button"
              className={`inline-flex h-10 flex-shrink-0 items-center justify-center whitespace-nowrap rounded-[20px] px-4 py-0.5 text-[13px] font-medium transition-colors ${disabled ? 'cursor-not-allowed opacity-55' : ''}`}
              style={{
                color: isActive ? 'rgb(226, 226, 226)' : 'rgb(168, 168, 168)',
                backgroundColor: isActive ? 'rgb(71, 71, 71)' : 'rgb(21, 21, 21)'
              }}
              onClick={() => {
                if (disabled) return;
                if (isQuick) {
                  setCollectionFilter('');
                  setQuickFilter((current) => (current === option.value ? 'all' : option.value));
                } else {
                  setContentType((current) => (current === option.value ? 'all' : option.value));
                }
              }}
              aria-disabled={disabled}
            >
              {option.label}
            </button>
          );
        })}

        <div className="relative flex-shrink-0">
          <button
            ref={collectionTriggerRef}
            type="button"
            className={`inline-flex h-10 max-w-full items-center justify-between gap-1.5 rounded-[20px] bg-[#151515] px-3 text-[13px] font-medium text-[#d9d9d9] ${collectionsLoading ? 'cursor-not-allowed opacity-55' : ''}`}
            onClick={(event) => {
              if (collectionsLoading) return;
              setCollectionMenuStyle(buildMenuPosition(event.currentTarget, 240, Math.max(180, collectionOptions.length * 42 + 16)));
              setSortMenuOpen(false);
              setCollectionMenuOpen((current) => !current);
            }}
            title={collectionsLoading ? 'Syncing collections...' : activeCollectionLabel}
            aria-disabled={collectionsLoading}
          >
            <span className="truncate">{collectionsLoading ? 'Syncing...' : activeCollectionLabel}</span>
            <i className="fas fa-chevron-down ml-1 text-[10px] text-[#7f7f7f]"></i>
          </button>
        </div>

        <div className="relative flex-shrink-0">
          <button
            ref={sortTriggerRef}
            type="button"
            className="inline-flex h-10 max-w-full items-center justify-between gap-1.5 rounded-[20px] bg-[#151515] px-3 text-[13px] font-medium text-[#d9d9d9]"
            onClick={(event) => {
              setSortMenuStyle(buildMenuPosition(event.currentTarget, 220, 196));
              setCollectionMenuOpen(false);
              setSortMenuOpen((current) => !current);
            }}
            title={activeSortLabel}
          >
            <span className="truncate">{activeSortLabel}</span>
            <i className="fas fa-chevron-down ml-1 text-[10px] text-[#7f7f7f]"></i>
          </button>
        </div>
      </div>

      {collectionMenuOpen
        ? createPortal(
            <div
              ref={collectionDropdownRef}
              style={collectionMenuStyle}
              className="inline-flex min-w-max flex-col items-stretch rounded-[16px] border border-white/12 bg-[#111111] p-2 shadow-[0_24px_60px_rgba(0,0,0,0.55)]"
            >
              <div className="filter-scrollbar-hidden max-h-[280px] overflow-y-auto">
                {collectionOptions.map((option) => (
                  <button
                    key={option.value || 'all-collections'}
                    type="button"
                    className={`inline-flex w-full items-center gap-2 whitespace-nowrap rounded-[12px] px-3 py-2.5 text-[13px] text-left ${
                      collectionFilter === option.value ? 'bg-white/[0.08] text-white' : 'text-[#d0d0d0] hover:bg-white/[0.05]'
                    }`}
                    onClick={() => {
                      setQuickFilter('all');
                      setCollectionFilter((current) => (current === option.value ? '' : option.value));
                      setCollectionMenuOpen(false);
                    }}
                  >
                    <span className="truncate">{option.label}</span>
                  </button>
                ))}
              </div>
            </div>,
            document.body
          )
        : null}

      {sortMenuOpen
        ? createPortal(
            <div
              ref={sortDropdownRef}
              style={sortMenuStyle}
              className="inline-flex min-w-max flex-col items-stretch rounded-[16px] border border-white/12 bg-[#111111] p-2 shadow-[0_24px_60px_rgba(0,0,0,0.55)]"
            >
              {sortOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`inline-flex w-full items-center gap-2 whitespace-nowrap rounded-[12px] px-3 py-2.5 text-[13px] text-left ${
                    sortBy === option.value ? 'bg-white/[0.08] text-white' : 'text-[#d0d0d0] hover:bg-white/[0.05]'
                  }`}
                  onClick={() => {
                    setSortBy(option.value);
                    setSortMenuOpen(false);
                  }}
                >
                  <i className="fas fa-sort h-4 w-4 shrink-0 text-center"></i>
                  <span>{option.label}</span>
                </button>
              ))}
            </div>,
            document.body
          )
        : null}
    </>
  );
}
