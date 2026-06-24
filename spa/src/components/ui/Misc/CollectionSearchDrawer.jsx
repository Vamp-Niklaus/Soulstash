import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { toast } from '../../../utils/toast.js';
import { streamApiFetch } from '../../../api/client.js';
import { HoverMarqueeTitle } from './Typography.jsx';
import { SearchResultSkeletonGrid } from '../Skeletons/index.js';
import { mergeSearchResults } from '../../../utils/helpers.js';
import { yearFrom, imageUrl } from '../../../utils/formatters.js';
import { FALLBACK_AVATAR } from '../../../utils/constants.js';

function getDrawerColumnCount() {
  const width = window.innerWidth;
  if (width >= 1600) return 5;
  if (width >= 1280) return 4;
  if (width >= 900) return 3;
  if (width >= 600) return 2;
  return 1;
}

export function CollectionSearchDrawer({ open, onClose, collection, onAdd, pendingItems = new Set() }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const drawerButtonsRef = useRef([]);
  const drawerInputRef = useRef(null);

  useEffect(() => {
    if (open) {
      const frame = window.requestAnimationFrame(() => {
        drawerInputRef.current?.focus();
      });
      return () => window.cancelAnimationFrame(frame);
    }
    return undefined;
  }, [open]);

  useEffect(() => {
    setFocusedIndex(-1);
    drawerButtonsRef.current = [];
  }, [results]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setResults([]);
      setLoading(false);
      return;
    }

    if (!query || query.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    let ignore = false;
    const controller = new AbortController();
    setLoading(true);
    setResults([]);
    const timeout = window.setTimeout(async () => {
      try {
        const streamedResults = [];
        await streamApiFetch(
          `/api/search?q=${encodeURIComponent(query.trim())}&limit=20&type=content&stream=1`,
          {
            signal: controller.signal,
            onEvent(event) {
              if (ignore || event?.query !== query.trim() || event?.type !== 'results') return;
              const incoming = Array.isArray(event.results) ? event.results : [];
              const nextResults = mergeSearchResults(streamedResults, incoming, 40);
              streamedResults.splice(0, streamedResults.length, ...nextResults);
              setResults(nextResults);
              setLoading(false);
            }
          }
        );
        if (!ignore) {
          setLoading(false);
        }
      } catch (error) {
        if (error?.name === 'AbortError') return;
        if (!ignore) {
          toast(error.message, 'error');
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }, 350);

    return () => {
      ignore = true;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [open, query]);

  if (!open || !collection) return null;

  const existingIds = new Set((collection.movies || []).map((item) => Number(item.movieId || item.seriesId || item.id || item._id || 0)));
  const contentResults = results.filter((item) => item.media_type === 'Movie' || item.media_type === 'Series' || item.media_type === 'tv');

  function handleDrawerInputKey(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (contentResults.length > 0) {
        setFocusedIndex(0);
        drawerButtonsRef.current[0]?.focus();
      }
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50" data-modal="true">
      <div className="fixed inset-0 bg-black/50" onClick={onClose}></div>
      <div
        className="fixed bottom-0 left-[5vw] right-[5vw] z-[52] flex w-[90vw] max-h-[min(66vh,calc(100vh-88px))] min-h-[50vh] flex-col overflow-hidden rounded-t-[28px] border border-gray-800/80 bg-[#0F0F0F]"
        role="dialog"
        aria-modal="true"
        aria-label="Add content"
        data-drawer-panel="true"
      >
        <div className="sticky top-0 bg-[#0F0F0F] z-10 flex justify-center pt-2 pb-1">
          <div className="w-12 h-1 bg-gray-700 rounded-full"></div>
        </div>
        <div className="flex flex-1 min-h-0 flex-col px-4 pb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-medium text-white">Add Content</h3>
            <button className="p-1 rounded-full hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-white" onClick={onClose} aria-label="Close drawer">
              <i className="fas fa-times text-gray-400"></i>
            </button>
          </div>
          <div className="relative mb-4">
            <i className="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-gray-500"></i>
            <input
              ref={drawerInputRef}
              id="contentSearchInput"
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleDrawerInputKey}
              placeholder="Search movies or series"
              className="w-full bg-[#171717] text-white rounded-xl border border-gray-800 pl-12 pr-4 py-3 outline-none"
            />
          </div>
          {!query || query.length < 2 ? (
            <div className="text-center text-gray-500 py-16">Start typing to search content.</div>
          ) : null}
          {loading ? (
            <div className="filter-scrollbar-hidden min-h-0 flex-1 overflow-y-auto pr-1">
              <SearchResultSkeletonGrid count={8} />
            </div>
          ) : null}
          {!loading && contentResults.length ? (
            <div className="filter-scrollbar-hidden min-h-0 flex-1 overflow-y-auto pr-1">
              <div className="grid grid-cols-1 min-[600px]:grid-cols-2 min-[900px]:grid-cols-3 min-[1280px]:grid-cols-4 min-[1600px]:grid-cols-5 gap-3">
              {contentResults.map((item, index) => {
                const itemId = Number(item._id || item.id || 0);
                const mediaType = item.media_type === 'Series' ? 'Series' : item.media_type === 'tv' ? 'Series' : 'Movie';
                const alreadyAdded = existingIds.has(itemId);
                return (
                  <div
                    key={`${itemId}-${mediaType}`}
                    ref={(el) => { drawerButtonsRef.current[index] = el; }}
                    tabIndex={0}
                    onFocus={() => setFocusedIndex(index)}
                    onKeyDown={(event) => {
                      const cols = getDrawerColumnCount();
                      if (event.key === 'ArrowDown') {
                        event.preventDefault();
                        const next = index + cols;
                        if (next < contentResults.length) {
                          setFocusedIndex(next);
                          drawerButtonsRef.current[next]?.focus();
                          drawerButtonsRef.current[next]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                        } else if (index < contentResults.length - 1) {
                          const lastIdx = contentResults.length - 1;
                          setFocusedIndex(lastIdx);
                          drawerButtonsRef.current[lastIdx]?.focus();
                          drawerButtonsRef.current[lastIdx]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                        }
                      } else if (event.key === 'ArrowUp') {
                        event.preventDefault();
                        const prev = index - cols;
                        if (prev < 0) {
                          setFocusedIndex(-1);
                          document.getElementById('contentSearchInput')?.focus();
                        } else {
                          setFocusedIndex(prev);
                          drawerButtonsRef.current[prev]?.focus();
                          drawerButtonsRef.current[prev]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                        }
                      } else if (event.key === 'ArrowRight') {
                        if (index < contentResults.length - 1) {
                          event.preventDefault();
                          const next = index + 1;
                          setFocusedIndex(next);
                          drawerButtonsRef.current[next]?.focus();
                          drawerButtonsRef.current[next]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                        }
                      } else if (event.key === 'ArrowLeft') {
                        if (index > 0) {
                          event.preventDefault();
                          const prev = index - 1;
                          setFocusedIndex(prev);
                          drawerButtonsRef.current[prev]?.focus();
                          drawerButtonsRef.current[prev]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                        }
                      } else if (event.key === 'Enter') {
                        event.preventDefault();
                        if (!alreadyAdded && !pendingItems.has(itemId)) {
                          onAdd(item, mediaType);
                        }
                      }
                    }}
                    className={`search-hover-marquee-trigger flex items-center p-3 border rounded-lg transition-all outline-none ${
                      focusedIndex === index
                        ? 'bg-white/[0.08] border-white/70'
                        : 'bg-[#171717] border-gray-800'
                    }`}
                  >
                    <div className="flex-shrink-0 w-14 h-20 relative rounded-md overflow-hidden">
                      <img
                        src={imageUrl(item.poster_path, 'w300_and_h450_face')}
                        alt={item.title || item.name}
                        className="w-full h-full object-cover"
                        onError={(event) => {
                          event.currentTarget.src = FALLBACK_AVATAR;
                        }}
                      />
                    </div>
                    <div className="flex-grow ml-3 min-w-0 overflow-hidden">
                      <h4 className="text-white font-medium text-base overflow-hidden">
                        <HoverMarqueeTitle title={item.title || item.name || 'Unknown'} />
                      </h4>
                      <div className="flex items-center text-sm text-gray-400 mt-0.5 truncate">
                        <span className="truncate">{yearFrom(item)}</span>
                        <span className="mx-2 flex-shrink-0">|</span>
                        <span className="truncate">{mediaType}</span>
                      </div>
                    </div>
                    <div className="flex-shrink-0 ml-2">
                      {alreadyAdded ? (
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-green-700/30 cursor-not-allowed">
                          <i className="fas fa-check text-[13px] text-green-500"></i>
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={pendingItems.has(itemId)}
                          className={`flex h-9 w-9 items-center justify-center rounded-full bg-[#252833] hover:bg-[#353945] transition-colors text-white ${pendingItems.has(itemId) ? 'opacity-70 cursor-wait' : ''}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            onAdd(item, mediaType);
                          }}
                        >
                          {pendingItems.has(itemId) ? (
                            <i className="fas fa-spinner fa-spin text-[13px]"></i>
                          ) : (
                            <i className="fas fa-plus text-[13px]"></i>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              </div>
            </div>
          ) : null}
          {!loading && query.length >= 2 && !contentResults.length ? (
            <div className="text-center text-gray-500 py-10">No movies or series matched this search.</div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  );
}
