import { apiFetch } from '../../api/client.js';
import React, { useRef, useCallback, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import { SectionHeader } from '../../components/ui/SectionHeader.jsx';
import { ContentCard } from '../../components/ui/Cards/ContentCard.jsx';
import { GridSkeleton } from '../../components/ui/Skeletons/index.js';

export function GenrePage() {
  const { id, name } = useParams();

  const genreId = id;
  const genreName = decodeURIComponent(name || '');

  useEffect(() => {
    document.title = `${genreName} | Soulstash`;
  }, [genreName]);

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
    queryKey: ['genre', genreId],
    queryFn: ({ pageParam = 1 }) => apiFetch(`/api/movies?genre=${genreId}&limit=20&page=${pageParam}`),
    getNextPageParam: (lastPage, allPages) => {
      const totalPages = lastPage?.pagination?.pages ?? 1;
      return allPages.length < totalPages ? allPages.length + 1 : undefined;
    },
  });

  const items = data ? data.pages.flatMap((page) => Array.isArray(page.movies) ? page.movies : []) : [];

  // Sentinel ref — fires once when the sentinel div enters the viewport
  const observerRef = useRef(null);
  const sentinelRef = useCallback((node) => {
    // Always disconnect the old observer first
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (!node || !hasNextPage || isFetchingNextPage || isLoading) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          // Disconnect immediately so it only fires once per scroll-reach
          observerRef.current?.disconnect();
          observerRef.current = null;
          fetchNextPage();
        }
      },
      { rootMargin: '300px' }
    );
    observerRef.current.observe(node);
  }, [hasNextPage, isFetchingNextPage, isLoading, fetchNextPage]);

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
      <SectionHeader title={genreName} large />
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
      ) : (
        <div className="app-empty">
          <p>No titles found for this genre.</p>
        </div>
      )}
    </section>
  );
}
