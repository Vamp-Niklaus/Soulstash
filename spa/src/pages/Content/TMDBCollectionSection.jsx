import React from 'react';
import { SectionHeader } from '../../components/ui/SectionHeader.jsx';
import { ContentCard } from '../../components/ui/Cards/ContentCard.jsx';
import { getCollectionStatus, imageUrl, yearFrom, getPreferredRating } from '../../utils/formatters.js';
import { useAuthSession } from '../../hooks/index.js';
import { FALLBACK_POSTER } from '../../utils/constants.js';

export function TMDBCollectionSection({ collection, collections = [], type = 'movie', currentId }) {
  const { user } = useAuthSession();

  if (!collection || !collection.parts || collection.parts.length === 0) {
    return null;
  }

  // Include all parts that have a poster — INCLUDING the current one
  const items = collection.parts.filter(item => !!item.poster_path);

  if (items.length === 0) return null;

  // Sort by release_date ascending (preserve series order)
  const sorted = [...items].sort((a, b) => {
    const da = a.release_date || a.first_air_date || '';
    const db = b.release_date || b.first_air_date || '';
    return da.localeCompare(db);
  });

  return (
    <section className="content-section mt-12">
      <SectionHeader title={`Part of ${collection.name}`} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 mt-4">
        {sorted.map((item) => {
          const isCurrent = String(item.id) === String(currentId);
          const contentItem = { ...item, media_type: type };
          const status = user ? getCollectionStatus(collections, contentItem.id) : null;

          if (isCurrent) {
            // Render the currently open movie as a non-clickable card with distinct styling
            const title = item.title || item.name || 'Unknown';
            const rating = getPreferredRating(item);
            const year = yearFrom(item);
            return (
              <div
                key={item.id}
                className="relative group"
                aria-current="true"
                title={`Currently viewing: ${title}`}
              >
                {/* Card shell — same proportions as ContentCard but non-interactive */}
                <div className="card relative cursor-default select-none opacity-60 ring-2 ring-white/30 ring-offset-1 ring-offset-black/40 rounded-[var(--card-radius,10px)] overflow-hidden">
                  <div className="cardImageWrap relative">
                    <img
                      src={imageUrl(item.poster_path, 'w500')}
                      alt={title}
                      className="cardImg"
                      loading="lazy"
                      decoding="async"
                      onError={(e) => { e.currentTarget.src = FALLBACK_POSTER; }}
                    />
                    {/* "Now Viewing" overlay badge */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 backdrop-blur-[1px]">
                      <div className="flex flex-col items-center gap-1 px-2 text-center">
                        <span className="inline-flex items-center gap-1 rounded-full bg-white/20 border border-white/30 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-widest text-white/90 backdrop-blur-sm">
                          <i className="fas fa-play text-[7px]" />
                          Now Viewing
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="cardMeta">
                    <div className="cardTitleWrap">
                      <h3 className={`cardTitle ${title.length > 18 ? 'marquee-on-hover' : ''}`} data-title={title}>{title}</h3>
                    </div>
                    <div className="cardSubMeta">
                      <span className="cardSubMetaItem">
                        <svg className="cardSubMetaStar" viewBox="0 0 24 24" width="11" height="11" aria-hidden="true">
                          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                        </svg>
                        <span className="cardSubMetaNum">{rating?.toFixed(1) || 'N/A'}</span>
                      </span>
                      <span className="cardSubMetaSep" aria-hidden="true">·</span>
                      <span className="cardSubMetaItem cardSubMetaNum">{year}</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          }

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
