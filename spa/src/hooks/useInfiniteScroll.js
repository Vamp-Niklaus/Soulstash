import { useEffect, useRef, useCallback } from 'react';

/**
 * A custom hook to implement infinite scrolling using IntersectionObserver.
 * 
 * @param {Object} options
 * @param {Function} options.onLoadMore - Function to call when sentinel comes into view.
 * @param {boolean} options.hasMore - Whether there is more data to load.
 * @param {boolean} options.isLoading - Whether data is currently loading.
 * @param {string} options.rootMargin - The margin around the root (viewport) to trigger early. Default is '2000px' for aggressive prefetching.
 * @returns {Function} A ref callback to attach to the sentinel element.
 */
export function useInfiniteScroll({ onLoadMore, hasMore, isLoading, rootMargin = '2000px' }) {
  const observerRef = useRef(null);

  const sentinelRef = useCallback((node) => {
    // Disconnect previous observer
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }

    if (!node || !hasMore || isLoading) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          // Disconnect immediately so it only fires once per scroll-reach
          observerRef.current?.disconnect();
          observerRef.current = null;
          onLoadMore();
        }
      },
      { rootMargin }
    );

    observerRef.current.observe(node);
  }, [hasMore, isLoading, onLoadMore, rootMargin]);

  return sentinelRef;
}
