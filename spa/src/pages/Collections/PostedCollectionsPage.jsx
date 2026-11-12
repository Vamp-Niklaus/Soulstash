import { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../api/client.js';
import { SectionHeader } from '../../components/ui/SectionHeader.jsx';

const TMDB_BASE = 'https://image.tmdb.org/t/p';
const PAGE_SIZE = 10; // cards shown before "View more" (and added per click)

// Resolves a TMDB path ("/abc.jpg") or a full URL to an image URL. Returns '' when missing.
function imageUrl(path, size) {
  const p = typeof path === 'string' ? path.trim() : '';
  if (!p || p === 'null' || p === 'undefined') return '';
  if (p.startsWith('http')) return p;
  if (p.startsWith('/')) return `${TMDB_BASE}/${size}${p}`;
  return '';
}

function posterOf(item) {
  return imageUrl(item?.poster_path || item?.image || item?.coverImage, 'w342');
}

function backdropOf(item) {
  return imageUrl(item?.backdrop_path || item?.backdrop, 'w780');
}

function CollectionTile({ entry, onOpen }) {
  const col = entry.collection || {};
  const movies = Array.isArray(col.movies) ? col.movies : [];
  const name = col.name || 'Collection';
  const publisher = entry.username || '';

  // One title: show that title's backdrop as the collection image.
  // Several titles: show up to four posters in a grid.
  const single = movies.length === 1 ? movies[0] : null;
  const banner = imageUrl(col.banner, 'w780');
  const singleBackdrop = banner || (single ? backdropOf(single) || posterOf(single) : '');
  const posters = movies.map(posterOf).filter(Boolean).slice(0, 4);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-left transition-colors hover:bg-white/[0.08] focus:outline-none focus:ring-2 focus:ring-white"
    >
      <div className="overflow-hidden rounded-xl bg-white/[0.04]" style={{ aspectRatio: '16 / 9' }}>
        {singleBackdrop ? (
          <img src={singleBackdrop} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : posters.length ? (
          <div className="grid h-full w-full grid-cols-2 grid-rows-2 gap-1">
            {posters.map((src, i) => (
              <img key={i} src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
            ))}
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center text-white/30">
            <i className="fas fa-film text-3xl"></i>
          </div>
        )}
      </div>
      <div className="min-w-0">
        <p className="truncate text-base font-semibold text-white">{name}</p>
        <p className="truncate text-xs text-white/50">
          {publisher ? `by ${publisher}` : 'Published collection'} · {movies.length} titles
        </p>
        {col.description ? <p className="mt-1 line-clamp-2 text-xs text-white/40">{col.description}</p> : null}
      </div>
    </button>
  );
}

export function PostedCollectionsPage() {
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Small debounce so typing does not fire a request per keystroke (matters on TV remotes too).
  useEffect(() => {
    const t = setTimeout(() => setQuery(input.trim()), 250);
    return () => clearTimeout(t);
  }, [input]);

  useEffect(() => {
    document.title = 'Posted Collections | Soulstash';
  }, []);

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['postedCollections', query],
    queryFn: () => apiFetch(`/api/collections/published${query ? `?q=${encodeURIComponent(query)}` : ''}`),
    staleTime: 2 * 60 * 1000,
  });

  const entries = useMemo(() => (Array.isArray(data) ? data : []), [data]);

  // Search shows every match (as before); browse mode shows a shelf-style preview with "View more".
  const visibleEntries = useMemo(
    () => (query ? entries : entries.slice(0, visibleCount)),
    [entries, query, visibleCount]
  );

  return (
    <section className="content-section space-y-6">
      <SectionHeader title="Posted Collections" large />

      <input
        type="search"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Search collections, publishers or descriptions..."
        className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white md:max-w-xl"
      />

      {isPending ? (
        <div className="app-loading">Loading collections...</div>
      ) : isError ? (
        <div className="app-error">
          <p>{error?.message || 'Could not load posted collections.'}</p>
          <button type="button" className="mt-4 rounded-full bg-white/10 px-5 py-2 text-white hover:bg-white/20" onClick={() => refetch()}>
            Try again
          </button>
        </div>
      ) : entries.length ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {visibleEntries.map((entry, index) => (
              <CollectionTile
                key={`${entry.username}-${entry.collection?.name}-${index}`}
                entry={entry}
                onOpen={() => navigate(`/user/${encodeURIComponent(entry.username)}/collection/${encodeURIComponent(entry.collection?.name || '')}`)}
              />
            ))}
          </div>
          {/* Browse mode (no search): a few cards like a genre shelf, then a View more button. */}
          {!query && entries.length > visibleCount ? (
            <div className="flex justify-center">
              <button
                type="button"
                className="shelf-action focus:outline-none focus:ring-2 focus:ring-[var(--cinema-accent)]"
                onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
              >
                <span>View more</span>
                <span aria-hidden="true">→</span>
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <div className="app-empty">
          <p>{query ? `No posted collections match "${query}".` : 'No collections have been posted yet.'}</p>
        </div>
      )}
    </section>
  );
}
