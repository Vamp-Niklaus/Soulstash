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
    getNextPageParam: (lastPage, pages) => {
      if (!lastPage?.movies || lastPage.movies.length === 0) return undefined;
      const totalPages = lastPage?.pagination?.pages ?? 500;
      if (pages.length < totalPages) {
        return pages.length + 1;
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
      const list = Array.isArray(page?.movies) ? page.movies : (Array.isArray(page) ? page : []);
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
              <ContentCard key={`${item.media_type || 'media'}-${item.id}-${index}`} item={item} />
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

          {!hasNextPage && items.length > 0 && (
            <p className="mt-8 text-center text-sm text-white/30">All titles loaded</p>
          )}
        </>
      )}
    </section>
  );
}
