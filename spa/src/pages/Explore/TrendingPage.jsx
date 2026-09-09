import React, { useRef, useCallback, useEffect } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { apiFetch } from '../../api/client.js';
import { SectionHeader } from '../../components/ui/SectionHeader.jsx';
import { ContentCard } from '../../components/ui/Cards/ContentCard.jsx';
import { GridSkeleton } from '../../components/ui/Skeletons/index.js';

export function TrendingPage() {
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
    queryKey: ['trending'],
    queryFn: fetchTrending,
    getNextPageParam: (lastPage, pages) => {
      const totalPages = lastPage?.pagination?.pages ?? 1;
      if (pages.length < totalPages) {
        return pages.length + 1;
      }
      return undefined;
    },
  });

  useEffect(() => {
    document.title = 'Trending Now | Soulstash';
  }, []);

  const items = data ? data.pages.flatMap((page) => Array.isArray(page?.movies) ? page.movies : (Array.isArray(page) ? page : [])) : [];

  // Sentinel ref — fires once when sentinel enters viewport
  const observerRef = useRef(null);
  const sentinelRef = useCallback((node) => {
    // Always disconnect old observer first
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (!node || !hasNextPage || isFetchingNextPage || status === 'pending') return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          // Disconnect immediately — only fire once per scroll-reach
          observerRef.current?.disconnect();
          observerRef.current = null;
          fetchNextPage();
        }
      },
      { rootMargin: '300px' }
    );
    observerRef.current.observe(node);
  }, [hasNextPage, isFetchingNextPage, status, fetchNextPage]);

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
            <div ref={sentinelRef} className="mt-8 flex justify-center h-12">
              {isFetchingNextPage && (
                <div className="w-6 h-6 border-2 border-white/20 border-t-white/80 rounded-full animate-spin self-center" />
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
