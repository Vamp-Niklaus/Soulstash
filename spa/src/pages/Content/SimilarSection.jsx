import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { SectionHeader } from '../../components/ui/SectionHeader.jsx';
import { ContentCard } from '../../components/ui/Cards/ContentCard.jsx';
import { getCollectionStatus } from '../../utils/formatters.js';
import { useAuthSession, useInfiniteScroll } from '../../hooks/index.js';
import { apiFetch, getToken } from '../../api/client.js';
import { preloadImages } from '../../utils/preload.js';

export function SimilarSection({ similar = [], collections = [], type = 'movie' }) {
  const { id } = useParams();
  const { user } = useAuthSession();
  // adminMode: 0=filter adult (default), 1=all, 2=adult only
  const adminMode = user?.admin === true ? Number(user?.adminMode ?? (user?.showAdult ? 1 : 0)) : 0;
  
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  // Initialize with the first page from the props
  useEffect(() => {
    if (similar && similar.length > 0) {
      // Apply client-side adult filter based on adminMode
      const initialItems = similar.filter(item => {
        if (!item.poster_path) return false;
        if (adminMode === 2) return item.adult === true;
        if (adminMode === 0) return item.adult !== true;
        return true; // adminMode 1: show all
      });
      setItems(initialItems);
      setPage(1);
      setHasMore(similar.length === 20);
      preloadImages(initialItems.map(item => item.poster_path));
    }
  }, [similar, id, adminMode]);

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
      if (data && data.results) {
        // Also apply client-side safety filter
        const newItems = data.results.filter(newItem => {
          if (!newItem.poster_path) return false;
          if (items.some(existingItem => existingItem.id === newItem.id)) return false;
          if (adminMode === 2) return newItem.adult === true;
          if (adminMode === 0) return newItem.adult !== true;
          return true;
        });
        
        preloadImages(newItems.map(item => item.poster_path));
        setItems(prev => [...prev, ...newItems]);
        setPage(nextPage);
        setHasMore(data.page < data.total_pages && data.results.length > 0);
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

  if (!items || items.length === 0) return null;

  const title = type === 'movie' ? 'Similar Movies' : 'Similar Series';

  return (
    <section className="content-section mt-12">
      <SectionHeader title={title} />
      
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 mt-4">
        {items.map((item) => {
          // Add media_type so ContentCard can route correctly
          const contentItem = { ...item, media_type: type };
          const status = user ? getCollectionStatus(collections, contentItem.id) : null;
          return (
            <ContentCard 
              key={`${contentItem.id}-${contentItem.media_type}`} 
              item={contentItem} 
              status={status}
            />
          );
        })}
      </div>

      {hasMore && (
        <div ref={sentinelRef} className="mt-8 flex justify-center h-10">
          {loading && <div className="app-loading">Loading more...</div>}
        </div>
      )}
    </section>
  );
}
