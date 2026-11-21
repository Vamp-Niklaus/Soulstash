import React, { useMemo, useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../api/client.js';
import { SectionHeader } from '../../components/ui/SectionHeader.jsx';
import { HomeShelfHeader } from '../Explore/HomeShelfHeader.jsx';
import { ContentCard } from '../../components/ui/Cards/ContentCard.jsx';
import { GridSkeleton } from '../../components/ui/Skeletons/index.js';
import { normalizeStoredCollectionItem } from '../../utils/formatters.js';
import { HOME_GRID_CLASS } from '../../utils/constants.js';
import { useHomeTwoRowLimit } from '../../hooks/index.js';
import { isTmdbSource, collectionDetailPath, publisherProfilePath, TMDB_PUBLISHER_LABEL } from '../../utils/collectionSource.js';

export function PostedCollectionsPage() {
  const navigate = useNavigate();
  const [visibleCount, setVisibleCount] = useState(8);
  const homeShelfLimit = useHomeTwoRowLimit();
  const sentinelRef = useRef(null);

  useEffect(() => {
    document.title = 'Lists | Soulstash';
  }, []);

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['postedCollections'],
    queryFn: () => apiFetch('/api/collections/published'),
    staleTime: 2 * 60 * 1000,
  });

  // TMDB franchises (curated on the backend). A failure here must never break the user lists.
  const { data: tmdbData } = useQuery({
    queryKey: ['tmdbFeaturedCollections'],
    queryFn: () => apiFetch('/api/tmdb-collections/featured'),
    staleTime: 6 * 60 * 60 * 1000,
    retry: false,
  });

  const rawEntries = useMemo(() => {
    const toEntry = (entry) => {
      const col = entry?.collection || entry || {};
      const username = entry?.username || col.username || '';
      const name = col.name || entry?.name || 'Collection';
      const movies = Array.isArray(col.movies) ? col.movies : (Array.isArray(entry?.movies) ? entry.movies : []);
      const source = entry?.source === 'tmdb' ? 'tmdb' : '';
      return {
        _id: source ? `tmdb-${entry?.tmdbId}` : (col._id || entry?._id || `${username}-${name}`),
        name,
        username,
        source,
        tmdbId: entry?.tmdbId,
        description: col.description || '',
        movies: movies.map(normalizeStoredCollectionItem)
      };
    };

    const userList = (Array.isArray(data)
      ? data
      : (Array.isArray(data?.collections) ? data.collections : [])).map(toEntry);
    const tmdbList = (Array.isArray(tmdbData) ? tmdbData : []).map(toEntry).filter((c) => c.movies.length > 0);

    // Interleave so both kinds show up from the first page instead of one kind pushing the other away.
    const merged = [];
    const max = Math.max(userList.length, tmdbList.length);
    for (let i = 0; i < max; i++) {
      if (i < userList.length) merged.push(userList[i]);
      if (i < tmdbList.length) merged.push(tmdbList[i]);
    }
    return merged;
  }, [data, tmdbData]);

  const visibleEntries = useMemo(
    () => rawEntries.slice(0, visibleCount),
    [rawEntries, visibleCount]
  );

  useEffect(() => {
    if (!sentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((prev) => (prev < rawEntries.length ? Math.min(prev + 6, rawEntries.length) : prev));
        }
      },
      { rootMargin: '800px 0px' }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [rawEntries.length]);

  return (
    <section className="content-section space-y-8">
      {isPending ? (
        <div className="space-y-8">
          <GridSkeleton count={7} />
          <GridSkeleton count={7} />
        </div>
      ) : isError ? (
        <div className="app-error">
          <p>{error?.message || 'Could not load posted lists.'}</p>
          <button
            type="button"
            className="mt-4 rounded-full bg-white/10 px-5 py-2 text-white hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white"
            onClick={() => refetch()}
          >
            Try again
          </button>
        </div>
      ) : rawEntries.length ? (
        <>
          <div className="space-y-8">
            {visibleEntries.map((col) => {
              const colTitle = col.name;
              const colPublisher = isTmdbSource(col) ? TMDB_PUBLISHER_LABEL : col.username;
              const profilePath = publisherProfilePath(col);
              const items = col.movies || [];
              const previewItems = items.slice(0, homeShelfLimit);

              return (
                <section key={col._id} className="content-section">
                  <HomeShelfHeader
                    title={colTitle}
                    publisher={colPublisher}
                    onPublisherClick={profilePath ? () => navigate(profilePath) : null}
                    onViewAll={() => colPublisher && navigate(collectionDetailPath(col), { state: { collection: col } })}
                  />
                  {previewItems.length ? (
                    <div className={HOME_GRID_CLASS}>
                      {previewItems.map((item, index) => (
                        <ContentCard
                          key={`${col._id}-${item.id || item._id || index}`}
                          item={item}
                          data-card
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-white/40 pl-3">No titles in this list yet.</p>
                  )}
                </section>
              );
            })}
          </div>

          {rawEntries.length > visibleCount && (
            <div ref={sentinelRef} className="flex justify-center py-6">
              <div className="flex items-center gap-2 text-sm text-white/50">
                <i className="fas fa-spinner fa-spin text-amber-400"></i>
                <span>Loading more lists...</span>
              </div>
            </div>
          )}

          {rawEntries.length > 0 && visibleCount >= rawEntries.length && (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 text-xs gap-1.5 border-t border-white/[0.04] mt-8">
              <i className="fas fa-check-circle text-base text-white/20"></i>
              <span>All {rawEntries.length} curated lists loaded</span>
            </div>
          )}
        </>
      ) : (
        <div className="app-empty">
          <p>No lists have been published yet.</p>
        </div>
      )}
    </section>
  );
}
