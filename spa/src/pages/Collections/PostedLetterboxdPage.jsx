import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../api/client.js';
import { HomeShelfHeader } from '../Explore/HomeShelfHeader.jsx';
import { ContentCard } from '../../components/ui/Cards/ContentCard.jsx';
import { GridSkeleton } from '../../components/ui/Skeletons/index.js';
import { normalizeStoredCollectionItem } from '../../utils/formatters.js';
import { HOME_GRID_CLASS } from '../../utils/constants.js';
import { useHomeTwoRowLimit, useSessionState } from '../../hooks/index.js';
import {
  isLetterboxdSource,
  collectionDetailPath,
  LETTERBOXD_PUBLISHER_LABEL
} from '../../utils/collectionSource.js';

export function PostedLetterboxdPage() {
  const navigate = useNavigate();
  const [visibleCount, setVisibleCount] = useSessionState('posted_letterbox:visibleCount', 8);
  const [letterboxdPage, setLetterboxdPage] = useSessionState('posted_letterbox:letterboxdPage', 1);
  const [accumulatedLetterboxd, setAccumulatedLetterboxd] = useSessionState('posted_letterbox:accumulatedLetterboxd', []);
  const [isFetchingMoreLetterboxd, setIsFetchingMoreLetterboxd] = useState(false);
  const homeShelfLimit = useHomeTwoRowLimit();
  const sentinelRef = useRef(null);
  const restoredRef = useRef(false);

  useEffect(() => {
    document.title = 'Letterboxd Collections | Soulstash';
  }, []);

  // Initial Letterboxd curated lists
  const { data: letterboxdInitialData, isPending: letterboxdPending, isError, error } = useQuery({
    queryKey: ['letterboxdCollections', 1],
    queryFn: () => apiFetch('/api/collections/letterboxd?page=1&limit=10'),
    staleTime: 6 * 60 * 60 * 1000,
    retry: false,
  });

  useEffect(() => {
    if (Array.isArray(letterboxdInitialData) && letterboxdInitialData.length > 0) {
      setAccumulatedLetterboxd((prev) => {
        const existing = Array.isArray(prev) ? prev : [];
        const existingSlugs = new Set(existing.map((c) => c?.slug || c?.name || c?.collection?.name));
        const newItems = letterboxdInitialData.filter((c) => !existingSlugs.has(c?.slug || c?.name || c?.collection?.name));
        return existing.length === 0 ? letterboxdInitialData : [...existing, ...newItems];
      });
    }
  }, [letterboxdInitialData, setAccumulatedLetterboxd]);

  // Infinite loader for Letterboxd curated collections
  const loadNextLetterboxdBatch = useCallback(async () => {
    if (isFetchingMoreLetterboxd) return;
    setIsFetchingMoreLetterboxd(true);
    const nextPage = (letterboxdPage || 1) + 1;
    try {
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000));
      const fetchPromise = apiFetch(`/api/collections/letterboxd?page=${nextPage}&limit=10`);
      const data = await Promise.race([fetchPromise, timeoutPromise]);
      setLetterboxdPage(nextPage);
      if (Array.isArray(data) && data.length > 0) {
        setAccumulatedLetterboxd((prev) => {
          const existing = Array.isArray(prev) ? prev : [];
          const existingSlugs = new Set(existing.map((c) => c?.slug || c?.name || c?.collection?.name));
          const fresh = data.filter((c) => !existingSlugs.has(c?.slug || c?.name || c?.collection?.name));
          return [...existing, ...fresh];
        });
      }
    } catch (err) {
      console.warn('Failed to fetch more Letterboxd collections:', err);
    } finally {
      setIsFetchingMoreLetterboxd(false);
    }
  }, [letterboxdPage, isFetchingMoreLetterboxd, setLetterboxdPage, setAccumulatedLetterboxd]);

  const toEntry = useCallback((entry) => {
    const col = entry?.collection || entry || {};
    const name = col.name || entry?.name || 'Collection';
    const movies = Array.isArray(col.movies) ? col.movies : (Array.isArray(entry?.movies) ? entry.movies : []);
    const banner = col.banner || entry?.banner || (col.backdrop_path ? (col.backdrop_path.startsWith('http') ? col.backdrop_path : `https://image.tmdb.org/t/p/w1280${col.backdrop_path}`) : '');
    const backdrop_path = col.backdrop_path || entry?.backdrop_path || (banner ? banner.replace('https://image.tmdb.org/t/p/w1280', '') : '');
    const poster_path = col.poster_path || entry?.poster_path || '';
    return {
      _id: `letterboxd-${entry?.slug || name}`,
      name,
      username: 'letterboxd',
      source: 'letterboxd',
      slug: entry?.slug,
      description: col.description || '',
      banner,
      backdrop_path,
      poster_path,
      movies: movies.map(normalizeStoredCollectionItem)
    };
  }, []);

  const parsedLetterboxdLists = useMemo(() => {
    const list = Array.isArray(accumulatedLetterboxd) && accumulatedLetterboxd.length > 0
      ? accumulatedLetterboxd
      : (Array.isArray(letterboxdInitialData) ? letterboxdInitialData : []);
    return list.map(toEntry).filter((c) => c.movies.length > 0);
  }, [accumulatedLetterboxd, letterboxdInitialData, toEntry]);

  const visibleEntries = useMemo(
    () => parsedLetterboxdLists.slice(0, visibleCount),
    [parsedLetterboxdLists, visibleCount]
  );

  // Restore scroll position once visible entries are rendered
  useEffect(() => {
    if (restoredRef.current) return;
    const savedY = sessionStorage.getItem('posted_letterbox:scrollY');
    if (savedY != null && visibleEntries.length > 0) {
      const y = parseInt(savedY, 10);
      if (!isNaN(y) && y > 0) {
        restoredRef.current = true;
        requestAnimationFrame(() => {
          window.scrollTo({ top: y, behavior: 'instant' });
        });
      }
    }
  }, [visibleEntries.length]);

  // Save scroll position on user movement
  useEffect(() => {
    const handleScroll = () => {
      if (restoredRef.current || sessionStorage.getItem('posted_letterbox:scrollY') === null) {
        sessionStorage.setItem('posted_letterbox:scrollY', String(window.scrollY));
      }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  // Infinite scroll observer: advances visibleCount and loads more lists dynamically
  useEffect(() => {
    if (!sentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((prev) => {
            const current = typeof prev === 'number' ? prev : 8;
            const next = current + 6;
            if (next >= parsedLetterboxdLists.length - 4) {
              loadNextLetterboxdBatch();
            }
            return next;
          });
        }
      },
      { rootMargin: '800px 0px' }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [parsedLetterboxdLists.length, loadNextLetterboxdBatch, setVisibleCount]);

  const isInitialLoading = letterboxdPending && parsedLetterboxdLists.length === 0;

  return (
    <section className="content-section space-y-6">
      {/* Hidden view badge */}
      <div className="flex items-center justify-between pb-1 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#ff8000]"></span>
            <span className="w-2 h-2 rounded-full bg-[#00e054]"></span>
            <span className="w-2 h-2 rounded-full bg-[#40bcf4]"></span>
          </span>
          <h1 className="text-base font-bold text-white tracking-wide">Letterboxd Lists</h1>
        </div>
        <span className="text-[11px] font-medium text-white/40 bg-white/5 px-2.5 py-1 rounded-full border border-white/5">
          Curated Archive
        </span>
      </div>

      {isInitialLoading ? (
        <div className="space-y-8 pt-4">
          <GridSkeleton count={7} />
          <GridSkeleton count={7} />
        </div>
      ) : isError && parsedLetterboxdLists.length === 0 ? (
        <div className="app-error">
          <p>{error?.message || 'Could not load Letterboxd lists.'}</p>
        </div>
      ) : parsedLetterboxdLists.length ? (
        <>
          <div className="space-y-8">
            {visibleEntries.map((col) => {
              const colTitle = col.name;
              const items = col.movies || [];
              const previewItems = items.slice(0, homeShelfLimit);

              return (
                <section key={col._id} className="content-section">
                  <HomeShelfHeader
                    title={colTitle}
                    publisher={LETTERBOXD_PUBLISHER_LABEL}
                    onPublisherClick={null}
                    onViewAll={() => {
                      sessionStorage.setItem('posted_letterbox:scrollY', String(window.scrollY));
                      navigate(collectionDetailPath(col), { state: { collection: col } });
                    }}
                  />
                  {previewItems.length ? (
                    <div className={HOME_GRID_CLASS}>
                      {previewItems.map((item, index) => (
                        <ContentCard
                          key={`${col._id}-${item.id || item._id || index}`}
                          item={item}
                          data-card
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-white/40 pl-3">No titles in this list yet.</p>
                  )}
                </section>
              );
            })}
          </div>

          {/* Sentinel & Load More for infinite scroll */}
          <div ref={sentinelRef} className="flex flex-col items-center justify-center py-8 gap-3">
            {isFetchingMoreLetterboxd ? (
              <div className="flex items-center gap-2 text-sm text-white/50">
                <i className="fas fa-spinner fa-spin text-amber-400"></i>
                <span>Loading more lists...</span>
              </div>
            ) : visibleCount < parsedLetterboxdLists.length ? (
              <button
                type="button"
                onClick={() => {
                  setVisibleCount((prev) => (typeof prev === 'number' ? prev : 8) + 8);
                  loadNextLetterboxdBatch();
                }}
                className="px-6 py-2.5 rounded-full border border-white/10 bg-white/5 text-sm font-medium text-white/80 hover:bg-white/10 hover:text-white transition-all flex items-center gap-2 active:scale-95 cursor-pointer"
              >
                <i className="fas fa-plus text-xs text-amber-400"></i>
                <span>Load More Lists</span>
              </button>
            ) : null}
          </div>
        </>
      ) : (
        <div className="app-empty py-16 text-center">
          <i className="fas fa-film text-3xl text-white/20 mb-3 block"></i>
          <p className="text-white/60 text-sm">No Letterboxd lists found.</p>
        </div>
      )}
    </section>
  );
}
