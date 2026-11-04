import { apiFetch } from '../../api/client.js';
import React, { useRef, useEffect, useMemo } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useAuthSession } from '../../hooks/index.js';
import { SectionHeader } from '../../components/ui/SectionHeader.jsx';
import { ContentCard } from '../../components/ui/Cards/ContentCard.jsx';
import { GridSkeleton } from '../../components/ui/Skeletons/index.js';
import { preloadImages } from '../../utils/preload.js';

const TMDB_GENRE_NAMES = {
  bollywood: 'Latest in India',
  28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime',
  99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History',
  27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance', 878: 'Science Fiction',
  10770: 'TV Movie', 53: 'Thriller', 10752: 'War', 37: 'Western',
  10759: 'Action & Adventure', 10762: 'Kids', 10763: 'News', 10764: 'Reality',
  10765: 'Sci-Fi & Fantasy', 10766: 'Soap', 10767: 'Talk', 10768: 'War & Politics'
};

export function GenrePage() {
  const { id, name } = useParams();
  const { user } = useAuthSession();
  const adminMode = Number(user?.adminMode ?? (user?.showAdult ? 1 : 0));

  const genreId = id;
  const genreName = decodeURIComponent(name || '');
  const canonicalGenreName = genreName || TMDB_GENRE_NAMES[genreId];
  const displayGenreName = genreName || (TMDB_GENRE_NAMES[genreId] || decodeURIComponent(genreId || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase()));

  useEffect(() => {
    document.title = `${displayGenreName} | Soulstash`;
  }, [displayGenreName]);

  const {
    data,
    isLoading,
    isError,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
  } = useInfiniteQuery({
    queryKey: ['genre', genreId, adminMode],
    queryFn: ({ pageParam = 1 }) => apiFetch(`/api/movies?genre=${genreId}&limit=20&page=${pageParam}`),
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages, lastPageParam) => {
      const currentPageNum = Number(lastPageParam) || allPages.length;
      const reportedPages = Number(lastPage?.total_pages || lastPage?.pagination?.pages);
      const totalPages = Math.max(reportedPages > 1 ? reportedPages : 500, 50);
      if (currentPageNum < totalPages) {
        if (allPages.length >= 2) {
          const lastOne = allPages[allPages.length - 1]?.results || allPages[allPages.length - 1]?.movies || [];
          const secondLast = allPages[allPages.length - 2]?.results || allPages[allPages.length - 2]?.movies || [];
          if (lastOne.length === 0 && secondLast.length === 0) {
            return undefined;
          }
        }
        return currentPageNum + 1;
      }
      return undefined;
    },
  });

  const items = useMemo(() => {
    if (!data) return [];
    const seen = new Set();
    const deduped = [];
    for (const page of data.pages) {
      const list = Array.isArray(page?.results) ? page.results : (Array.isArray(page?.movies) ? page.movies : []);
      for (const item of list) {
        if (!item?.poster_path || !String(item.poster_path).trim()) continue;
        const itemId = Number(item?.id || item?.movieId || item?.seriesId);
        const mediaType = ['Series', 'tv', 'series'].includes(String(item?.media_type || '')) || item?.first_air_date ? 'series' : 'movie';
        const itemKey = `${mediaType}:${itemId}`;
        if (itemId && !seen.has(itemKey)) {
          seen.add(itemKey);
          deduped.push(item);
        }
      }
    }
    return deduped;
  }, [data]);

  // Aggressively preload images as soon as new items are added to the list
  useEffect(() => {
    if (items.length > 0) {
      const newImagePaths = items.map(item => item.poster_path).filter(Boolean);
      preloadImages(newImagePaths);
    }
  }, [items.length]);

  // Always prefetch next 2 pages in advance
  useEffect(() => {
    if (!data?.pages?.length || !hasNextPage || isFetchingNextPage) return;
    if (data.pages.length < 3) {
      fetchNextPage();
    }
  }, [data?.pages?.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Sentinel observer — attaches cleanly via useEffect every time page state updates
  const sentinelRef = useRef(null);
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasNextPage || isFetchingNextPage) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { rootMargin: '1600px' }
    );
    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, items.length]);

  if (!canonicalGenreName && genreId) {
    return <Navigate to="/" replace />;
  }
  if (genreId && !genreName && canonicalGenreName) {
    return <Navigate to={`/genre/${genreId}/${encodeURIComponent(canonicalGenreName)}`} replace />;
  }

  if (isLoading && !isError) {
    return (
      <section className="content-section">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div className="h-8 w-40 rounded bg-white/[0.08] animate-pulse"></div>
        </div>
        <GridSkeleton count={14} />
      </section>
    );
  }

  return (
    <section className="content-section">
      <SectionHeader title={displayGenreName} large />
      {isError ? (
        <div className="app-error">
          <p>{error?.message || `Unable to load ${genreName} titles.`}</p>
          <button
            type="button"
            className="mt-4 rounded-full bg-white/10 px-5 py-2 text-white transition-colors hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white"
            onClick={() => refetch()}
          >
            Try again
          </button>
        </div>
      ) : items.length ? (
        <>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-2 sm:gap-3 lg:gap-4">
            {items.map((item, index) => (
              <ContentCard key={`${item.id}-${index}`} item={item} />
            ))}
          </div>

          {/* Sentinel element — observed to trigger next page load */}
          {hasNextPage && (
            <div ref={sentinelRef} className="load-more-zone min-h-[40px] flex items-center justify-center py-4">
              {isFetchingNextPage && (
                <div className="load-more-indicator" role="status" aria-live="polite">
                  <span className="load-more-indicator__spinner" aria-hidden="true" />
                  <span>Loading more</span>
                </div>
              )}
            </div>
          )}

          {!hasNextPage && items.length >= 30 && (
            <p className="mt-8 text-center text-sm text-white/30">All titles loaded</p>
          )}
        </>
      ) : (
        <div className="app-empty">
          <p>No titles found for this genre.</p>
        </div>
      )}
    </section>
  );
}
