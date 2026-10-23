import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { NavbarSkeleton, SearchResultSkeletonGrid } from '../ui/Skeletons/index.js';
import { HoverMarqueeTitle } from '../ui/Misc/Typography.jsx';
import { getSearchHistory, saveSearchHistoryItem } from '../../utils/formatters.js';
import { imageUrl, yearFrom, mediaRoute } from '../../utils/formatters.js';
import { FALLBACK_AVATAR } from '../../utils/constants.js';
import { useOverlaySearchKeyboardNav } from '../../hooks/useOverlaySearchKeyboardNav.js';

export function NavbarSearchOverlay({ open, onClose, query, setQuery, results, loading, tab, setTab, navigate }) {
  const overlayInputRef = useRef(null);
  const resultsScrollerRef = useRef(null);
  const clearBtnRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const originalBodyOverflow = document.body.style.overflow;
    const originalHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    const frame = window.requestAnimationFrame(() => { overlayInputRef.current?.focus(); });
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = originalBodyOverflow;
      document.documentElement.style.overflow = originalHtmlOverflow;
    };
  }, [open]);

  const historyItems = useMemo(() => getSearchHistory(), [open]);
  const activeResults = useMemo(() => {
    const source = query.trim().length >= 1 ? results : historyItems;
    return source.filter((item) => {
      if (tab === 'content') return ['Movie', 'Series', 'tv'].includes(item.media_type);
      if (tab === 'cast') return item.media_type === 'Person';
      if (tab === 'users') return item.media_type === 'User';
      return true;
    });
  }, [historyItems, query, results, tab]);

  const openItem = useCallback((item) => {
    saveSearchHistoryItem(item);
    onClose();
    if (item.media_type === 'Person') { navigate(`/person/${item.id}`); return; }
    if (item.media_type === 'User') { navigate(`/user/${encodeURIComponent(item.username || item.title || item.name)}`); return; }
    navigate(mediaRoute(item));
  }, [navigate, onClose]);

  const { focusedIndex, setFocusedIndex, resultButtonsRef, tabButtonsRef, TAB_VALUES } =
    useOverlaySearchKeyboardNav({ open, onClose, query, tab, setTab, activeResults, openItem, overlayInputRef, clearBtnRef });

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-[9998] bg-black/55 backdrop-blur-sm" onClick={onClose}></div>
      <div
        data-search-overlay="true"
        // onWheel={(event) => event.stopPropagation()}
        // onTouchMove={(event) => event.stopPropagation()}
        className="fixed left-[5vw] right-[5vw] top-[calc(64px+env(safe-area-inset-top,0px))] z-[9999] h-[70vh] w-[90vw] overflow-hidden rounded-b-[28px] border border-[#252833] bg-[#0F0F0F] shadow-[0_24px_60px_rgba(0,0,0,0.45)]"
      >
        <div className="flex h-full flex-col overflow-hidden px-4 sm:px-5 md:px-6">
          <div className="sticky top-0 z-10 bg-[rgba(15,15,15,0.98)] pb-3 pt-4">
            <div className="relative">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
                <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#A0A0A0]">
                  <circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path>
                </svg>
              </div>
              <input
                ref={overlayInputRef}
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onFocus={() => setFocusedIndex(-1)}
                placeholder="Search for Movies, Shows, Anime, Cast & Crew or Users..."
                className="h-14 w-full rounded-lg border border-[#353945] bg-[#171717] pl-12 pr-12 text-[#E2E2E2] outline-none transition-all placeholder:text-[#707070] focus:border-white/20"
              />
              <button 
                ref={clearBtnRef}
                type="button" 
                onClick={() => { setQuery(''); overlayInputRef.current?.focus(); }}
                onFocus={() => setFocusedIndex(-5)}
                className={`absolute inset-y-0 right-4 my-auto h-8 w-8 flex items-center justify-center outline-none text-[#a0a0a0] hover:text-white tv-focus-icon ${focusedIndex === -5 ? 'is-focused' : ''}`} 
                aria-label="Clear search">
                <svg xmlns="http://www.w3.org/2000/svg" height="20" viewBox="0 -960 960 960" fill="currentColor">
                  <path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/>
                </svg>
              </button>
            </div>
          </div>
          <div className="mb-6 mt-3 flex items-center space-x-8 border-b border-[#252833] pb-1">
            {[['content','Content',-2],['cast','Cast & Crew',-3],['users','Users',-4]].map(([value, label, tabIdxVal], index) => (
              <button key={value} ref={(el) => { tabButtonsRef.current[index] = el; }} type="button" tabIndex={0}
                className={`relative text-sm font-medium outline-none tv-focus-pill ${tab === value ? 'text-white' : 'text-[#A0A0A0]'} ${focusedIndex === tabIdxVal ? 'is-focused' : ''}`}
                onClick={() => setTab(value)} 
                onFocus={() => {
                  setFocusedIndex(tabIdxVal);
                  setTab(value);
                }}>
                {label}
                {tab === value ? <span className="absolute inset-x-0 -bottom-[5px] h-0.5 rounded-full bg-white"></span> : null}
              </button>
            ))}
          </div>
          <div ref={resultsScrollerRef} className="flex-1 overflow-y-auto overscroll-contain pb-6">
            {loading ? (
              <SearchResultSkeletonGrid columns="grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4" count={8} />
            ) : activeResults.length ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                {activeResults.map((item, index) => {
                  const title = item.title || item.name || item.username || 'Unknown';
                  const image = item.media_type === 'User' ? (item.avatar || item.poster_path) : item.poster_path || item.profile_path;
                  const meta = item.media_type === 'User'
                    ? (item.fullName || item.bio || 'Soulstash user')
                    : item.media_type === 'Person'
                      ? 'Cast & Crew'
                      : `${item.media_type === 'Series' || item.media_type === 'tv' ? 'Series' : 'Movie'}${yearFrom(item) ? ` | ${yearFrom(item)}` : ''}`;
                  return (
                    <button key={`${item.media_type}-${item.id || item.username || index}`}
                      ref={(el) => { resultButtonsRef.current[index] = el; }}
                      type="button" tabIndex={0}
                      onClick={() => openItem(item)}
                      onFocus={() => setFocusedIndex(index)}
                      className={`flex items-center gap-3 rounded-lg p-3 text-left border outline-none bg-[#171717] border-transparent hover:bg-[#1d1d1d] tv-focus-card ${focusedIndex === index ? 'is-focused' : ''}`}>
                      <div className="h-20 w-14 shrink-0 overflow-hidden rounded-md bg-[#252833]">
                        {image ? (
                          <img src={item.media_type === 'User' ? image : imageUrl(image, 'w300_and_h450_face')} alt={title}
                            className="h-full w-full object-cover"
                            onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = FALLBACK_AVATAR; }} />
                        ) : (
                          <img src={FALLBACK_AVATAR} alt={title} className="h-full w-full object-cover" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1 overflow-hidden">
                        <h3 className="text-sm font-semibold text-[#E2E2E2] overflow-hidden">
                          <HoverMarqueeTitle title={title} />
                        </h3>
                        <p className="mt-1 line-clamp-2 text-xs text-[#9da0a9]">{meta}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center p-8 text-center">
                <div className="mb-4 rounded-full bg-[#171717] p-4">
                  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#505050]">
                    <circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path>
                  </svg>
                </div>
                <p className="text-sm text-[#A0A0A0]">{query.trim().length >= 2 ? 'No results found' : 'No recent searches'}</p>
                <p className="mt-1 text-xs text-[#707070]">{query.trim().length >= 2 ? 'Try searching with different keywords' : 'Your search history will appear here'}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
