import { cachedApiFetch } from '../../api/client.js';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { SectionHeader } from '../../components/ui/SectionHeader.jsx';
import { ContentCard } from '../../components/ui/Cards/ContentCard.jsx';
import { GridSkeleton } from '../../components/ui/Skeletons/index.js';

export function TrendingPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [fetchingMore, setFetchingMore] = useState(false);
  const [retryTick, setRetryTick] = useState(0);

  // Initial page load
  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setError('');
    setItems([]);
    setPage(1);
    setHasMore(true);

    cachedApiFetch(`/api/trending?limit=36&page=1&retry=${retryTick}`)
      .then((data) => {
        if (!ignore) {
          const fetchedItems = Array.isArray(data?.movies) ? data.movies : (Array.isArray(data) ? data : []);
          setItems(fetchedItems);
          const totalPages = data?.pagination?.pages ?? 1;
          setHasMore(fetchedItems.length > 0 && 1 < totalPages);
          document.title = 'Trending Now | Soulstash';
        }
      })
      .catch((requestError) => {
        if (!ignore) setError(requestError.message || 'Unable to load trending titles.');
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });

    return () => { ignore = true; };
  }, [retryTick]);

  // Fetch next page when `page` changes
  useEffect(() => {
    if (page === 1) return;
    let ignore = false;
    setFetchingMore(true);

    cachedApiFetch(`/api/trending?limit=36&page=${page}`)
      .then((data) => {
        if (!ignore) {
          const fetchedItems = Array.isArray(data?.movies) ? data.movies : (Array.isArray(data) ? data : []);
          setItems((prev) => {
            const existingIds = new Set(prev.map((i) => i.id));
            const unique = fetchedItems.filter((i) => !existingIds.has(i.id));
            return [...prev, ...unique];
          });
          const totalPages = data?.pagination?.pages ?? 1;
          setHasMore(fetchedItems.length > 0 && page < totalPages);
        }
      })
      .catch(() => {
        if (!ignore) setHasMore(false);
      })
      .finally(() => {
        if (!ignore) setFetchingMore(false);
      });

    return () => { ignore = true; };
  }, [page]);

  // Sentinel ref — fires once when sentinel enters viewport
  const observerRef = useRef(null);
  const sentinelRef = useCallback((node) => {
    // Always disconnect old observer first
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (!node || !hasMore || fetchingMore || loading) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          // Disconnect immediately — only fire once per scroll-reach
          observerRef.current?.disconnect();
          observerRef.current = null;
          setPage((p) => p + 1);
        }
      },
      { rootMargin: '300px' }
    );
    observerRef.current.observe(node);
  }, [hasMore, fetchingMore, loading]);

  if (loading && !error) {
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
      {error ? (
        <div className="app-error">
          <p>{error}</p>
          <button
            type="button"
            className="mt-4 rounded-full bg-white/10 px-5 py-2 text-white transition-colors hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white"
            onClick={() => setRetryTick((current) => current + 1)}
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
          {hasMore && (
            <div ref={sentinelRef} className="mt-8 flex justify-center h-12">
              {fetchingMore && (
                <div className="w-6 h-6 border-2 border-white/20 border-t-white/80 rounded-full animate-spin self-center" />
              )}
            </div>
          )}

          {!hasMore && items.length > 0 && (
            <p className="mt-8 text-center text-sm text-white/30">All titles loaded</p>
          )}
        </>
      )}
    </section>
  );
}
