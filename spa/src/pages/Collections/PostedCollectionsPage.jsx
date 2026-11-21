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
  isTmdbSource,
  isLetterboxdSource,
  collectionDetailPath,
  publisherProfilePath,
  TMDB_PUBLISHER_LABEL,
  LETTERBOXD_PUBLISHER_LABEL
} from '../../utils/collectionSource.js';

export function PostedCollectionsPage() {
  const navigate = useNavigate();
  // Persistent states across page navigation / back button
  const [activeTab, setActiveTab] = useSessionState('posted_collections:tab', 'all'); // 'all', 'letterboxd', 'tmdb', 'community'
  const [visibleCount, setVisibleCount] = useSessionState('posted_collections:visibleCount', 8);
  const [tmdbPage, setTmdbPage] = useSessionState('posted_collections:tmdbPage', 1);
  const [accumulatedTmdb, setAccumulatedTmdb] = useSessionState('posted_collections:accumulatedTmdb', []);
  const [letterboxdPage, setLetterboxdPage] = useSessionState('posted_collections:letterboxdPage', 1);
  const [accumulatedLetterboxd, setAccumulatedLetterboxd] = useSessionState('posted_collections:accumulatedLetterboxd', []);

  const [isFetchingMoreTmdb, setIsFetchingMoreTmdb] = useState(false);
  const [isFetchingMoreLetterboxd, setIsFetchingMoreLetterboxd] = useState(false);
  const homeShelfLimit = useHomeTwoRowLimit();
  const sentinelRef = useRef(null);

  useEffect(() => {
    document.title = 'Lists | Soulstash';
  }, []);

  // Scroll restoration on mount & scroll save on user movement
  useEffect(() => {
    const savedY = sessionStorage.getItem('posted_collections:scrollY');
    if (savedY != null) {
      const y = parseInt(savedY, 10);
      if (!isNaN(y) && y > 0) {
        requestAnimationFrame(() => {
          setTimeout(() => {
            window.scrollTo({ top: y, behavior: 'instant' });
          }, 40);
        });
      }
    }
    const handleScroll = () => {
      if (window.scrollY > 0) {
        sessionStorage.setItem('posted_collections:scrollY', String(window.scrollY));
      }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  // 1. User published collections
  const { data: userRawData, isPending: userPending, isError: userError, error: userErrorObj, refetch: refetchUser } = useQuery({
    queryKey: ['postedCollections'],
    queryFn: () => apiFetch('/api/collections/published'),
    staleTime: 2 * 60 * 1000,
  });

  // 2. Initial Letterboxd curated lists
  const { data: letterboxdInitialData, isPending: letterboxdPending } = useQuery({
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

  // 3. Initial page of TMDB franchises
  const { data: tmdbInitialData, isPending: tmdbPending } = useQuery({
    queryKey: ['tmdbFeaturedCollections', 1],
    queryFn: () => apiFetch('/api/tmdb-collections/featured?page=1&limit=12'),
    staleTime: 6 * 60 * 60 * 1000,
    retry: false,
  });

  useEffect(() => {
    if (Array.isArray(tmdbInitialData) && tmdbInitialData.length > 0) {
      setAccumulatedTmdb((prev) => {
        const existing = Array.isArray(prev) ? prev : [];
        const existingIds = new Set(existing.map((c) => c?.tmdbId));
        const newItems = tmdbInitialData.filter((c) => !existingIds.has(c?.tmdbId));
        return existing.length === 0 ? tmdbInitialData : [...existing, ...newItems];
      });
    }
  }, [tmdbInitialData, setAccumulatedTmdb]);

  // Infinite loader for TMDB franchises
  const loadNextTmdbBatch = useCallback(async () => {
    if (isFetchingMoreTmdb) return;
    setIsFetchingMoreTmdb(true);
    const nextPage = (tmdbPage || 1) + 1;
    try {
      const data = await apiFetch(`/api/tmdb-collections/featured?page=${nextPage}&limit=12`);
      setTmdbPage(nextPage);
      if (Array.isArray(data) && data.length > 0) {
        setAccumulatedTmdb((prev) => {
          const existing = Array.isArray(prev) ? prev : [];
          const existingIds = new Set(existing.map((c) => c?.tmdbId));
          const fresh = data.filter((c) => !existingIds.has(c?.tmdbId));
          return [...existing, ...fresh];
        });
      }
    } catch (err) {
      console.warn('Failed to fetch more TMDB collections:', err);
    } finally {
      setIsFetchingMoreTmdb(false);
    }
  }, [tmdbPage, isFetchingMoreTmdb, setTmdbPage, setAccumulatedTmdb]);

  // Infinite loader for Letterboxd curated collections
  const loadNextLetterboxdBatch = useCallback(async () => {
    if (isFetchingMoreLetterboxd) return;
    setIsFetchingMoreLetterboxd(true);
    const nextPage = (letterboxdPage || 1) + 1;
    try {
      const data = await apiFetch(`/api/collections/letterboxd?page=${nextPage}&limit=10`);
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
    const username = entry?.username || col.username || '';
    const name = col.name || entry?.name || 'Collection';
    const movies = Array.isArray(col.movies) ? col.movies : (Array.isArray(entry?.movies) ? entry.movies : []);
    const source = entry?.source === 'tmdb' ? 'tmdb' : (entry?.source === 'letterboxd' ? 'letterboxd' : '');
    return {
      _id: source === 'tmdb'
        ? `tmdb-${entry?.tmdbId || name}`
        : source === 'letterboxd'
          ? `letterboxd-${entry?.slug || name}`
          : (col._id || entry?._id || `${username}-${name}`),
      name,
      username: source === 'letterboxd' ? 'letterboxd' : (source === 'tmdb' ? 'tmdb' : username),
      source,
      tmdbId: entry?.tmdbId,
      slug: entry?.slug,
      description: col.description || '',
      movies: movies.map(normalizeStoredCollectionItem)
    };
  }, []);

  const parsedUserLists = useMemo(() => {
    const list = Array.isArray(userRawData)
      ? userRawData
      : (Array.isArray(userRawData?.collections) ? userRawData.collections : []);
    return list.map(toEntry).filter((c) => c.movies.length > 0);
  }, [userRawData, toEntry]);

  const parsedLetterboxdLists = useMemo(() => {
    const list = Array.isArray(accumulatedLetterboxd) && accumulatedLetterboxd.length > 0
      ? accumulatedLetterboxd
      : (Array.isArray(letterboxdInitialData) ? letterboxdInitialData : []);
    return list.map(toEntry).filter((c) => c.movies.length > 0);
  }, [accumulatedLetterboxd, letterboxdInitialData, toEntry]);

  const parsedTmdbLists = useMemo(() => {
    const list = Array.isArray(accumulatedTmdb) && accumulatedTmdb.length > 0
      ? accumulatedTmdb
      : (Array.isArray(tmdbInitialData) ? tmdbInitialData : []);
    return list.map(toEntry).filter((c) => c.movies.length > 0);
  }, [accumulatedTmdb, tmdbInitialData, toEntry]);

  // Combined and filtered lists
  const filteredEntries = useMemo(() => {
    if (activeTab === 'letterboxd') return parsedLetterboxdLists;
    if (activeTab === 'tmdb') return parsedTmdbLists;
    if (activeTab === 'community') return parsedUserLists;

    // 'all': Interleave Letterboxd, TMDB, and Community so variety is high from page 1
    const merged = [];
    const max = Math.max(parsedLetterboxdLists.length, parsedTmdbLists.length, parsedUserLists.length);
    for (let i = 0; i < max; i++) {
      if (i < parsedLetterboxdLists.length) merged.push(parsedLetterboxdLists[i]);
      if (i < parsedTmdbLists.length) merged.push(parsedTmdbLists[i]);
      if (i < parsedUserLists.length) merged.push(parsedUserLists[i]);
    }
    return merged;
  }, [activeTab, parsedLetterboxdLists, parsedTmdbLists, parsedUserLists]);

  const visibleEntries = useMemo(
    () => filteredEntries.slice(0, visibleCount),
    [filteredEntries, visibleCount]
  );

  // Infinite scroll observer: advances visibleCount and loads more lists dynamically
  useEffect(() => {
    if (!sentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((prev) => {
            const current = typeof prev === 'number' ? prev : 8;
            const next = current + 6;
            if (next >= filteredEntries.length - 4) {
              if (activeTab === 'all' || activeTab === 'letterboxd') {
                loadNextLetterboxdBatch();
              }
              if (activeTab === 'all' || activeTab === 'tmdb') {
                loadNextTmdbBatch();
              }
            }
            return next;
          });
        }
      },
      { rootMargin: '800px 0px' }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [filteredEntries.length, activeTab, loadNextTmdbBatch, loadNextLetterboxdBatch, setVisibleCount]);

  const isInitialLoading = userPending && letterboxdPending && tmdbPending && filteredEntries.length === 0;

  return (
    <section className="content-section space-y-6">
      {/* Top Filter Tabs: All, Letterboxd, Franchises, Community */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 pt-1 scrollbar-none border-b border-white/[0.06]">
        {[
          { id: 'all', label: 'All Lists', icon: 'fas fa-compass' },
          { id: 'letterboxd', label: 'Letterboxd Lists', isLetterboxd: true },
          { id: 'tmdb', label: 'Franchises (TMDB)', icon: 'fas fa-layer-group', iconClass: 'text-amber-400' },
          { id: 'community', label: 'Community', icon: 'fas fa-users' }
        ].map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveTab(tab.id);
                setVisibleCount(8);
              }}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs sm:text-sm font-semibold transition-all whitespace-nowrap outline-none cursor-pointer ${
                isActive
                  ? 'bg-white text-black shadow-lg font-bold'
                  : 'bg-white/[0.06] text-white/70 hover:bg-white/[0.12] hover:text-white'
              }`}
            >
              {tab.isLetterboxd ? (
                <span className="inline-flex items-center gap-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#ff8000]"></span>
                  <span className="w-1.5 h-1.5 rounded-full bg-[#00e054]"></span>
                  <span className="w-1.5 h-1.5 rounded-full bg-[#40bcf4]"></span>
                </span>
              ) : tab.icon ? (
                <i className={`${tab.icon} ${tab.iconClass || ''} text-xs`}></i>
              ) : null}
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {isInitialLoading ? (
        <div className="space-y-8 pt-4">
          <GridSkeleton count={7} />
          <GridSkeleton count={7} />
        </div>
      ) : userError && filteredEntries.length === 0 ? (
        <div className="app-error">
          <p>{userErrorObj?.message || 'Could not load lists.'}</p>
          <button
            type="button"
            className="mt-4 rounded-full bg-white/10 px-5 py-2 text-white hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white"
            onClick={() => refetchUser()}
          >
            Try again
          </button>
        </div>
      ) : filteredEntries.length ? (
        <>
          <div className="space-y-8">
            {visibleEntries.map((col) => {
              const colTitle = col.name;
              const isLb = isLetterboxdSource(col);
              const isTm = isTmdbSource(col);
              const colPublisher = isLb
                ? LETTERBOXD_PUBLISHER_LABEL
                : isTm
                  ? TMDB_PUBLISHER_LABEL
                  : col.username;
              const profilePath = publisherProfilePath(col);
              const items = col.movies || [];
              const previewItems = items.slice(0, homeShelfLimit);

              return (
                <section key={col._id} className="content-section">
                  <HomeShelfHeader
                    title={colTitle}
                    publisher={colPublisher}
                    onPublisherClick={profilePath ? () => navigate(profilePath) : null}
                    onViewAll={() => colPublisher && navigate(collectionDetailPath(col), { state: { collection: col } })}
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
            {(isFetchingMoreTmdb || isFetchingMoreLetterboxd) ? (
              <div className="flex items-center gap-2 text-sm text-white/50">
                <i className="fas fa-spinner fa-spin text-amber-400"></i>
                <span>Loading more lists...</span>
              </div>
            ) : (activeTab === 'all' || activeTab === 'tmdb' || activeTab === 'letterboxd') ? (
              <button
                type="button"
                onClick={() => {
                  setVisibleCount((prev) => (typeof prev === 'number' ? prev : 8) + 8);
                  if (activeTab === 'letterboxd' || activeTab === 'all') loadNextLetterboxdBatch();
                  if (activeTab === 'tmdb' || activeTab === 'all') loadNextTmdbBatch();
                }}
                className="px-6 py-2.5 rounded-full border border-white/10 bg-white/5 text-sm font-medium text-white/80 hover:bg-white/10 hover:text-white transition-all flex items-center gap-2 active:scale-95 cursor-pointer"
              >
                <i className="fas fa-plus text-xs text-amber-400"></i>
                <span>Load More Lists</span>
              </button>
            ) : visibleCount < filteredEntries.length ? (
              <button
                type="button"
                onClick={() => setVisibleCount((prev) => (typeof prev === 'number' ? prev : 8) + 8)}
                className="px-6 py-2.5 rounded-full border border-white/10 bg-white/5 text-sm font-medium text-white/80 hover:bg-white/10 hover:text-white transition-all flex items-center gap-2 active:scale-95 cursor-pointer"
              >
                <span>Load More Lists</span>
              </button>
            ) : null}
          </div>
        </>
      ) : (
        <div className="app-empty py-16 text-center">
          <i className="fas fa-film text-3xl text-white/20 mb-3 block"></i>
          <p className="text-white/60 text-sm">No lists found in this category.</p>
        </div>
      )}
    </section>
  );
}
