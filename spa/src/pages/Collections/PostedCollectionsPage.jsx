import React, { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../api/client.js';
import { SectionHeader } from '../../components/ui/SectionHeader.jsx';
import { HomeShelfHeader } from '../Explore/HomeShelfHeader.jsx';
import { ContentCard } from '../../components/ui/Cards/ContentCard.jsx';
import { GridSkeleton } from '../../components/ui/Skeletons/index.js';
import { normalizeStoredCollectionItem } from '../../utils/formatters.js';

export function PostedCollectionsPage() {
  const navigate = useNavigate();
  const [visibleCount, setVisibleCount] = useState(8);

  useEffect(() => {
    document.title = 'Lists | Soulstash';
  }, []);

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['postedCollections'],
    queryFn: () => apiFetch('/api/collections/published'),
    staleTime: 2 * 60 * 1000,
  });

  const rawEntries = useMemo(() => {
    const list = Array.isArray(data)
      ? data
      : (Array.isArray(data?.collections) ? data.collections : []);
    return list.map((entry) => {
      const col = entry?.collection || entry || {};
      const username = entry?.username || col.username || '';
      const name = col.name || entry?.name || 'Collection';
      const movies = Array.isArray(col.movies) ? col.movies : (Array.isArray(entry?.movies) ? entry.movies : []);
      return {
        _id: col._id || entry?._id || `${username}-${name}`,
        name,
        username,
        description: col.description || '',
        movies: movies.map(normalizeStoredCollectionItem)
      };
    });
  }, [data]);

  const visibleEntries = useMemo(
    () => rawEntries.slice(0, visibleCount),
    [rawEntries, visibleCount]
  );

  return (
    <section className="content-section space-y-8">
      <SectionHeader title="Lists" large />

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
              const colPublisher = col.username;
              const items = col.movies || [];
              const previewItems = items.slice(0, 7);

              return (
                <div key={col._id} className="space-y-3">
                  <HomeShelfHeader
                    title={colTitle}
                    publisher={colPublisher}
                    onPublisherClick={() => colPublisher && navigate(`/user/${encodeURIComponent(colPublisher)}`)}
                    onViewAll={() => colPublisher && navigate(`/user/${encodeURIComponent(colPublisher)}/collection/${encodeURIComponent(colTitle)}`)}
                  />
                  {previewItems.length ? (
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-2 sm:gap-3 lg:gap-4">
                      {previewItems.map((item, index) => (
                        <ContentCard
                          key={`${col._id}-${item.id || item._id || index}`}
                          item={item}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-white/40 pl-3">No titles in this list yet.</p>
                  )}
                </div>
              );
            })}
          </div>

          {rawEntries.length > visibleCount ? (
            <div className="flex justify-center pt-4">
              <button
                type="button"
                className="shelf-action focus:outline-none focus:ring-2 focus:ring-[var(--cinema-accent)]"
                onClick={() => setVisibleCount((c) => c + 8)}
              >
                <span>View more lists</span>
                <span aria-hidden="true">→</span>
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <div className="app-empty">
          <p>No lists have been published yet.</p>
        </div>
      )}
    </section>
  );
}
