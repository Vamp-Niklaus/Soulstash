import React, { useRef, useEffect, useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { apiFetch } from '../../api/client.js';
import { useAuthSession } from '../../hooks/index.js';
import { SectionHeader } from '../../components/ui/SectionHeader.jsx';
import { ContentCard } from '../../components/ui/Cards/ContentCard.jsx';
import { GridSkeleton } from '../../components/ui/Skeletons/index.js';

export function TrendingPage() {
  const { user } = useAuthSession();
  const adminMode = Number(user?.adminMode ?? (user?.showAdult ? 1 : 0));

  const fetchTrending = async ({ pageParam = 1 }) => {
    return apiFetch(`/api/trending?limit=36&page=${pageParam}`);
  };

  const {
    data,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    status,
    refetch
  } = useInfiniteQuery({
    queryKey: ['trending', adminMode],
    queryFn: fetchTrending,
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages, lastPageParam) => {
      const pageList = Array.isArray(lastPage?.results) ? lastPage.results : (Array.isArray(lastPage?.movies) ? lastPage.movies : (Array.isArray(lastPage) ? lastPage : []));
      const currentPageNum = Number(lastPageParam) || allPages.length;
      if (!pageList.length && currentPageNum >= 50 && adminMode !== 2) {
        return undefined;
      }
      const reportedPages = Number(lastPage?.total_pages || lastPage?.pagination?.pages);
      const totalPages = Math.max(reportedPages > 1 ? reportedPages : 500, 50);
      if (currentPageNum < totalPages) {
        return currentPageNum + 1;
      }
      return undefined;
    },
  });

  useEffect(() => {
    document.title = 'Trending Now | Soulstash';
  }, []);

  const items = useMemo(() => {
    if (!data) return [];
    const seen = new Set();
    const deduped = [];
    for (const page of data.pages) {
      const list = Array.isArray(page?.results) ? page.results : (Array.isArray(page?.movies) ? page.movies : (Array.isArray(page) ? page : []));
      for (const item of list) {
        const itemId = Number(item?.id || item?.movieId || item?.seriesId);
        if (itemId && !seen.has(itemId)) {
          seen.add(itemId);
          deduped.push(item);
        }
      }
    }
    return deduped;
  }, [data]);

  // Always keep at least 2 extra pages ahead in memory initially
  useEffect(() => {
    if (!data?.pages?.length || !hasNextPage || isFetchingNextPage) return;
    if (data.pages.length < 3) {
      fetchNextPage();
    }
  }, [data?.pages?.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Advance trigger: when user scrolls near the card that is 2 pages before the end, trigger fetch for the next page
  const triggerRef = useRef(null);
  const triggerIndex = useMemo(() => {
    if (!items.length || !data?.pages?.length) return -1;
    const avgPerPage = Math.max(14, Math.round(items.length / data.pages.length));
    return Math.max(0, items.length - avgPerPage * 2);
  }, [items.length, data?.pages?.length]);

  useEffect(() => {
    const node = triggerRef.current;
    if (!node || !hasNextPage || isFetchingNextPage) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { rootMargin: '1000px' }
    );
    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, triggerIndex]);

  // Sentinel observer — backup fallback at the very bottom
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
      { rootMargin: '800px' }
    );
    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, items.length]);

  if (status === 'pending') {
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
      <SectionHeader title="Trending Now" />
      {status === 'error' ? (
        <div className="app-error">
          <p>{error?.message || 'Unable to load trending titles.'}</p>
          <button
            type="button"
            className="mt-4 rounded-full bg-white/10 px-5 py-2 text-white transition-colors hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white"
            onClick={() => refetch()}
          >
            Try again
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-2 sm:gap-3 lg:gap-4">
            {items.map((item, index) => (
              <div
                key={`${item.media_type || 'media'}-${item.id}-${index}`}
                ref={index === triggerIndex ? triggerRef : null}
              >
                <ContentCard item={item} />
              </div>
            ))}
          </div>

          {/* Sentinel element — observed to trigger next page */}
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
      )}
    </section>
  );
}
