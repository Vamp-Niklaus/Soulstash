import { useState } from 'react';
import { SectionHeader } from '../../components/ui/SectionHeader.jsx';
import { ContentCard } from '../../components/ui/Cards/ContentCard.jsx';
import { getCollectionStatus } from '../../utils/formatters.js';
import { useAuthSession } from '../../hooks/index.js';

export function SimilarSection({ similar = [], collections = [], type = 'movie' }) {
  const [showAll, setShowAll] = useState(false);
  const { user } = useAuthSession();

  if (!similar || similar.length === 0) return null;

  const displayItems = showAll ? similar : similar.slice(0, 10);
  const title = type === 'movie' ? 'Similar Movies' : 'Similar Series';

  return (
    <section className="content-section mt-12">
      <SectionHeader title={title} />
      
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 mt-4">
        {displayItems.map((item) => {
          // Add media_type so ContentCard can route correctly
          const contentItem = { ...item, media_type: type };
          const status = user ? getCollectionStatus(collections, contentItem.id) : null;
          return (
            <ContentCard 
              key={contentItem.id} 
              item={contentItem} 
              status={status}
            />
          );
        })}
      </div>

      {!showAll && similar.length > 10 && (
        <div className="mt-8 flex justify-center">
          <button
            onClick={() => setShowAll(true)}
            className="rounded-full bg-white/10 px-8 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/20 active:scale-95"
          >
            Show More
          </button>
        </div>
      )}
    </section>
  );
}
