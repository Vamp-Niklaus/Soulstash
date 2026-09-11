import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { SectionHeader } from '../../components/ui/SectionHeader.jsx';
import { ContentCard } from '../../components/ui/Cards/ContentCard.jsx';
import { getCollectionStatus } from '../../utils/formatters.js';
import { useAuthSession, useInfiniteScroll } from '../../hooks/index.js';
import { apiFetch } from '../../api/client.js';
import { preloadImages } from '../../utils/preload.js';

export function SimilarSection({ similar = [], collections = [], type = 'movie' }) {
  const { id } = useParams();
  const { user } = useAuthSession();
  
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  // Initialize with the first page from the props
  useEffect(() => {
    if (similar && similar.length > 0) {
      const initialItems = similar.filter(item => item.poster_path);
      setItems(initialItems);
      setPage(1);
      // TMDB returns up to 20 results per page, if it's less, there's no more
      setHasMore(similar.length === 20);
      
      // Preload the initial images just in case
      preloadImages(initialItems.map(item => item.poster_path));
    }
  }, [similar, id]);

  const loadMore = async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    try {
      const nextPage = page + 1;
      const endpoint = type === 'movie' 
        ? `/api/movies/${id}/similar?page=${nextPage}` 
        : `/api/series/${id}/similar?page=${nextPage}`;
      
      const data = await apiFetch(endpoint);
      if (data && data.results) {
        const newItems = data.results.filter(
          newItem => newItem.poster_path && !items.some(existingItem => existingItem.id === newItem.id)
        );
        
        // Aggressively preload images for the newly fetched page
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
