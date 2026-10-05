import React from 'react';
import { SectionHeader } from '../../components/ui/SectionHeader.jsx';
import { ContentCard } from '../../components/ui/Cards/ContentCard.jsx';
import { getCollectionStatus } from '../../utils/formatters.js';
import { useAuthSession } from '../../hooks/index.js';

export function TMDBCollectionSection({ collection, collections = [], type = 'movie', currentId }) {
  const { user } = useAuthSession();

  if (!collection || !collection.parts || collection.parts.length === 0) {
    return null;
  }

  // Filter out the current movie and items without a poster
  const items = collection.parts.filter(item => {
    if (String(item.id) === String(currentId)) return false;
    if (!item.poster_path) return false;
    return true;
  });

  if (items.length === 0) return null;

  return (
    <section className="content-section mt-12">
      <SectionHeader title={`Part of ${collection.name}`} />
      
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 mt-4">
        {items.map((item) => {
          const contentItem = { ...item, media_type: type };
          const status = user ? getCollectionStatus(collections, contentItem.id) : null;
          
          return (
            <ContentCard 
              key={item.id} 
              item={contentItem} 
              status={status}
            />
          );
        })}
      </div>
    </section>
  );
}
