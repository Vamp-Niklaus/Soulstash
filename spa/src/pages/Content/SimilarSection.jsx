import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { SectionHeader } from '../../components/ui/SectionHeader.jsx';
import { ContentCard } from '../../components/ui/Cards/ContentCard.jsx';
import { getCollectionStatus } from '../../utils/formatters.js';
import { useAuthSession, useInfiniteScroll } from '../../hooks/index.js';
import { apiFetch, getToken } from '../../api/client.js';
import { preloadImages } from '../../utils/preload.js';

export function SimilarSection({ similar = [], totalPages = 1, collections = [], type = 'movie' }) {
  const { id } = useParams();
  const { user } = useAuthSession();
  // adminMode: 0=filter adult (default), 1=all, 2=adult only
  const adminMode = user?.admin === true ? Number(user?.adminMode ?? (user?.showAdult ? 1 : 0)) : 0;
  
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  // Initialize with the first page from the props or fetch directly
  useEffect(() => {
    if (similar && similar.length > 0) {
      const currentIdNum = Number(id);
      const seen = new Set();
      const initialItems = similar.filter(item => {
        if (!item || !item.id) return false;
        if (Number(item.id) === currentIdNum) return false;
        if (seen.has(Number(item.id))) return false;
        seen.add(Number(item.id));
        if (!item.poster_path) return false;
        return true;
      });
      setItems(initialItems);
      setPage(1);
      setHasMore(totalPages > 1 || similar.length === 20);
      preloadImages(initialItems.map(item => item.poster_path));

      // Advance load next 2 pages (page 2 & 3)
      if (totalPages > 1 || similar.length >= 10) {
        const ep2 = type === 'series' ? `/api/series/${id}/similar?page=2` : `/api/movies/${id}/similar?page=2`;
        const ep3 = type === 'series' ? `/api/series/${id}/similar?page=3` : `/api/movies/${id}/similar?page=3`;
        Promise.allSettled([apiFetch(ep2), apiFetch(ep3)]).then(([r2, r3]) => {
          const advResults = [];
          if (r2.status === 'fulfilled' && r2.value?.results) advResults.push(...r2.value.results);
          if (r3.status === 'fulfilled' && r3.value?.results) advResults.push(...r3.value.results);
          if (advResults.length) {
            const currentIdNum = Number(id);
            setItems(prev => {
              const existing = new Set(prev.map(i => Number(i.id)));
              const uniqueExtra = [];
              for (const it of advResults) {
                const itId = Number(it?.id);
                if (itId && itId !== currentIdNum && it.poster_path && !existing.has(itId)) {
                  existing.add(itId);
                  uniqueExtra.push(it);
                }
              }
              if (uniqueExtra.length) {
                preloadImages(uniqueExtra.map(i => i.poster_path));
                return [...prev, ...uniqueExtra];
              }
              return prev;
            });
            setPage(3);
          }
          if (
            (r2.status === 'fulfilled' && (r2.value?.has_more === false || r2.value?.hasMore === false || (r2.value?.results?.length ?? 0) === 0)) ||
            (r3.status === 'fulfilled' && (r3.value?.has_more === false || r3.value?.hasMore === false || (r3.value?.results?.length ?? 0) === 0))
          ) {
            setHasMore(false);
          }
        }).catch(() => {});
      }
    } else if (id) {
      let ignore = false;
      setLoading(true);
      const endpoint = type === 'series'
        ? `/api/series/${id}/similar?page=1`
        : `/api/movies/${id}/similar?page=1`;

      apiFetch(endpoint)
        .then(data => {
          if (ignore) return;
          const results = Array.isArray(data?.results) ? data.results : (Array.isArray(data) ? data : []);
          const currentIdNum = Number(id);
          const seen = new Set();
          const initialItems = results.filter(item => {
            if (!item || !item.id) return false;
            if (Number(item.id) === currentIdNum) return false;
            if (seen.has(Number(item.id))) return false;
            seen.add(Number(item.id));
            if (!item.poster_path) return false;
            return true;
          });
          setItems(initialItems);
          setPage(1);
          const backendHasMore = data?.has_more ?? data?.hasMore;
          setHasMore(backendHasMore !== false && (data?.total_pages || 1) > 1 && results.length > 0);
          preloadImages(initialItems.map(item => item.poster_path));

          // Advance load next 2 pages (page 2 & 3)
          if ((data?.total_pages || 1) > 1 && backendHasMore !== false) {
            const ep2 = type === 'series' ? `/api/series/${id}/similar?page=2` : `/api/movies/${id}/similar?page=2`;
            const ep3 = type === 'series' ? `/api/series/${id}/similar?page=3` : `/api/movies/${id}/similar?page=3`;
            Promise.allSettled([apiFetch(ep2), apiFetch(ep3)]).then(([r2, r3]) => {
              if (ignore) return;
              const advResults = [];
              if (r2.status === 'fulfilled' && r2.value?.results) advResults.push(...r2.value.results);
              if (r3.status === 'fulfilled' && r3.value?.results) advResults.push(...r3.value.results);
              if (advResults.length) {
                const currentIdNum = Number(id);
                setItems(prev => {
                  const existing = new Set(prev.map(i => Number(i.id)));
                  const uniqueExtra = [];
                  for (const it of advResults) {
                    const itId = Number(it?.id);
                    if (itId && itId !== currentIdNum && it.poster_path && !existing.has(itId)) {
                      existing.add(itId);
                      uniqueExtra.push(it);
                    }
                  }
                  if (uniqueExtra.length) {
                    preloadImages(uniqueExtra.map(i => i.poster_path));
                    return [...prev, ...uniqueExtra];
                  }
                  return prev;
                });
                setPage(3);
              }
              if (
                (r2.status === 'fulfilled' && (r2.value?.has_more === false || r2.value?.hasMore === false || (r2.value?.results?.length ?? 0) === 0)) ||
                (r3.status === 'fulfilled' && (r3.value?.has_more === false || r3.value?.hasMore === false || (r3.value?.results?.length ?? 0) === 0))
              ) {
                setHasMore(false);
              }
            }).catch(() => {});
          }
        })
        .catch(err => {
          console.warn('Failed to fetch similar content:', err);
        })
        .finally(() => {
          if (!ignore) setLoading(false);
        });

      return () => {
        ignore = true;
      };
    }
  }, [similar, id, adminMode, type]);

  const loadMore = async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    try {
      const nextPage = page + 1;
      const endpoint = type === 'movie' 
        ? `/api/movies/${id}/similar?page=${nextPage}` 
        : `/api/series/${id}/similar?page=${nextPage}`;
      
      // Forward auth token so backend can apply adminMode filter
      const token = getToken();
      const data = await apiFetch(endpoint, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      const results = Array.isArray(data?.results) ? data.results : [];
      const backendHasMore = data?.has_more ?? data?.hasMore;
      if (backendHasMore === false || results.length === 0) {
        setHasMore(false);
      }

      if (results.length > 0) {
        const currentIdNum = Number(id);
        let addedCount = 0;

        setItems(prev => {
          const existing = new Set(prev.map(i => Number(i.id)));
          const uniqueNew = [];
          for (const newItem of results) {
            const newId = Number(newItem?.id);
            if (newId && newId !== currentIdNum && newItem.poster_path && !existing.has(newId)) {
              existing.add(newId);
              uniqueNew.push(newItem);
            }
          }
          addedCount = uniqueNew.length;
          if (uniqueNew.length > 0) {
            preloadImages(uniqueNew.map(item => item.poster_path));
            return [...prev, ...uniqueNew];
          }
          return prev;
        });

        setPage(nextPage);
        if (addedCount === 0 || (Number(data?.total_pages) && nextPage >= Number(data?.total_pages))) {
          setHasMore(false);
        }
      } else {
        setHasMore(false);
      }
    } catch (err) {
      console.error('Failed to fetch similar content:', err);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  };

  const sentinelRef = useInfiniteScroll({
    onLoadMore: loadMore,
    hasMore,
    isLoading: loading,
    rootMargin: '2000px' // aggressive prefetching threshold
  });

  // Defensive deduplication before rendering
  const displayItems = Array.from(new Map(items.map(it => [Number(it.id), it])).values());

  if (!displayItems || displayItems.length === 0) return null;

  const title = type === 'movie' ? 'Similar Movies' : 'Similar Series';

  return (
    <section className="content-section mt-12">
      <SectionHeader title={title} />
      
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 mt-4">
        {displayItems.map((item) => {
          // Add media_type so ContentCard can route correctly
          const contentItem = { ...item, media_type: type };
          const status = user ? getCollectionStatus(collections, contentItem.id) : null;
          return (
            <ContentCard 
              key={`similar-${type}-${contentItem.id}`} 
              item={contentItem} 
              status={status}
            />
          );
        })}
      </div>

      {hasMore && (
        <div ref={sentinelRef} className="load-more-zone">
          {loading && (
            <div className="load-more-indicator" role="status" aria-live="polite">
              <span className="load-more-indicator__spinner" aria-hidden="true" />
              <span>Loading more</span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
