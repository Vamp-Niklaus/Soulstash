import { apiFetch } from '../../api/client.js';
import { KARTOONS_PROXY } from '../../api/kartoons.js';
import React, { useRef, useEffect, useMemo } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useAuthSession } from '../../hooks/index.js';
import { SectionHeader } from '../../components/ui/SectionHeader.jsx';
import { ContentCard } from '../../components/ui/Cards/ContentCard.jsx';
import { GridSkeleton } from '../../components/ui/Skeletons/index.js';
import { preloadImages } from '../../utils/preload.js';

const TMDB_GENRE_NAMES = {
  bollywood: 'Latest in India',
  28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime',
  99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History',
  27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance', 878: 'Science Fiction',
  10770: 'TV Movie', 53: 'Thriller', 10752: 'War', 37: 'Western',
  10759: 'Action & Adventure', 10762: 'Kids',
  'anime': 'Anime',
  'kartoons-anime': 'Anime',
  'cartoon': 'Cartoon',
  'kartoons-cartoon': 'Cartoon',
  // Hidden genres: News (10763), Reality (10764), Soap (10766), Talk (10767)
  // 10763: 'News', 10764: 'Reality', 10766: 'Soap', 10767: 'Talk',
  10765: 'Sci-Fi & Fantasy', 10768: 'War & Politics'
};

// Quick-jump genres shown as chips at the top, so TV users can switch genre without scrolling back.
const GENRE_CHIP_IDS = ['anime', 'cartoon', 28, 12, 16, 35, 80, 18, 10751, 14, 27, 10749, 878, 53, 10752, 10759, 10762];

export function GenrePage() {
  const { id, name } = useParams();
  const { user } = useAuthSession();
  const adminMode = Number(user?.adminMode ?? (user?.showAdult ? 1 : 0));

  const genreId = id;
  const genreName = decodeURIComponent(name || '');
  const canonicalGenreName = genreName || TMDB_GENRE_NAMES[genreId];
  const displayGenreName = genreName || (TMDB_GENRE_NAMES[genreId] || decodeURIComponent(genreId || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase()));

  useEffect(() => {
    document.title = `${displayGenreName} | Soulstash`;
  }, [displayGenreName]);

  const isPureKartoonsGenre = ['anime', 'kartoons-anime', 'cartoon', 'kartoons-cartoon'].includes(String(genreId).toLowerCase());

  const {
    data,
    isLoading,
    isError,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
  } = useInfiniteQuery({
    queryKey: ['genre', genreId, adminMode],
    queryFn: async ({ pageParam = 1 }) => {
      const gLower = String(genreId).toLowerCase();
      const isValidImage = (item) => {
        const p = item?.image || item?.coverImage || item?.poster_path;
        return Boolean(
          p &&
          typeof p === 'string' &&
          p.trim() &&
          p !== 'null' &&
          p !== 'undefined' &&
          !p.startsWith('data:image/svg+xml') &&
          !p.includes('placeholder')
        );
      };

      if (gLower === 'anime' || gLower === 'kartoons-anime') {
        const res = await fetch(`${KARTOONS_PROXY}/shows?page=${pageParam}&category=Anime`);
        const json = await res.json().catch(() => ({}));
        const raw = (Array.isArray(json?.data) ? json.data : (Array.isArray(json) ? json : []))
          .filter(isValidImage);
        const movies = raw.map((item) => ({
          id: `kartoons-${item.slug}`,
          title: item.title,
          name: item.title,
          poster_path: item.image || item.coverImage || '',
          backdrop_path: item.coverImage || item.image || '',
          media_type: 'Series',
          release_date: item.startYear ? `${item.startYear}-01-01` : '',
          first_air_date: item.startYear ? `${item.startYear}-01-01` : '',
          vote_average: Number(item.rating) || 0,
          source: 'kartoons',
          is_kartoons: true,
          kartoons_slug: item.slug
        }));
        return {
          movies,
          pagination: { page: pageParam, pages: json?.pagination?.totalPages || 50 }
        };
      }
      if (gLower === 'cartoon' || gLower === 'kartoons-cartoon') {
        const [showsRes, moviesRes] = await Promise.all([
          fetch(`${KARTOONS_PROXY}/shows?page=${pageParam}&category=Cartoon`).catch(() => null),
          fetch(`${KARTOONS_PROXY}/movies?page=${pageParam}&category=Cartoon`).catch(() => null)
        ]);
        const sJson = showsRes?.ok ? await showsRes.json().catch(() => ({})) : {};
        const mJson = moviesRes?.ok ? await moviesRes.json().catch(() => ({})) : {};
        const sRaw = (Array.isArray(sJson?.data) ? sJson.data : (Array.isArray(sJson) ? sJson : []))
          .filter(isValidImage);
        const mRaw = (Array.isArray(mJson?.data) ? mJson.data : (Array.isArray(mJson) ? mJson : []))
          .filter(isValidImage);

        const mappedShows = sRaw.map((item) => ({
          id: `kartoons-${item.slug}`,
          title: item.title,
          name: item.title,
          poster_path: item.image || item.coverImage || '',
          backdrop_path: item.coverImage || item.image || '',
          media_type: 'Series',
          release_date: item.startYear ? `${item.startYear}-01-01` : '',
          first_air_date: item.startYear ? `${item.startYear}-01-01` : '',
          vote_average: Number(item.rating) || 0,
          source: 'kartoons',
          is_kartoons: true,
          kartoons_slug: item.slug
        }));

        const mappedMovies = mRaw.map((item) => ({
          id: `kartoons-${item.slug}`,
          title: item.title,
          name: item.title,
          poster_path: item.image || item.coverImage || '',
          backdrop_path: item.coverImage || item.image || '',
          media_type: 'Movie',
          release_date: item.releaseYear ? `${item.releaseYear}-01-01` : '',
          first_air_date: '',
          vote_average: Number(item.rating) || 0,
          source: 'kartoons',
          is_kartoons: true,
          kartoons_slug: item.slug
        }));

        return {
          movies: [...mappedShows, ...mappedMovies],
          pagination: { page: pageParam, pages: Math.max(sJson?.pagination?.totalPages || 1, mJson?.pagination?.totalPages || 1, 50) }
        };
      }
      return apiFetch(`/api/movies?genre=${genreId}&limit=20&page=${pageParam}`);
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages, lastPageParam) => {
      const currentPageNum = Number(lastPageParam) || allPages.length;
      const reportedPages = Number(lastPage?.total_pages || lastPage?.pagination?.pages);
      const totalPages = Math.max(reportedPages > 1 ? reportedPages : 500, 50);
      if (currentPageNum < totalPages) {
        if (allPages.length >= 2) {
          const lastOne = allPages[allPages.length - 1]?.results || allPages[allPages.length - 1]?.movies || [];
          const secondLast = allPages[allPages.length - 2]?.results || allPages[allPages.length - 2]?.movies || [];
          if (lastOne.length === 0 && secondLast.length === 0) {
            return undefined;
          }
        }
        return currentPageNum + 1;
      }
      return undefined;
    },
  });

  const items = useMemo(() => {
    if (!data) return [];
    const seen = new Set();
    const deduped = [];
    for (const page of data.pages) {
      const list = Array.isArray(page?.results) ? page.results : (Array.isArray(page?.movies) ? page.movies : []);
      for (const item of list) {
        const posterStr = String(item?.poster_path || '').trim();
        if (!posterStr || posterStr === 'null' || posterStr === 'undefined' || posterStr.startsWith('data:image/svg+xml') || posterStr.includes('placeholder')) continue;
        const itemId = item.id || item.slug || item.movieId || item.seriesId;
        const mediaType = ['Series', 'tv', 'series'].includes(String(item?.media_type || '')) || item?.first_air_date ? 'series' : 'movie';
        const itemKey = `${mediaType}:${itemId}`;
        if (itemId && !seen.has(itemKey)) {
          seen.add(itemKey);
          deduped.push(item);
        }
      }
    }
    return deduped;
  }, [data]);

  // Aggressively preload images as soon as new items are added to the list
  useEffect(() => {
    if (items.length > 0) {
      const newImagePaths = items.map(item => item.poster_path).filter(Boolean);
      preloadImages(newImagePaths);
    }
  }, [items.length]);

  // Always prefetch next 2 pages in advance
  useEffect(() => {
    if (!data?.pages?.length || !hasNextPage || isFetchingNextPage) return;
    if (data.pages.length < 3) {
      fetchNextPage();
    }
  }, [data?.pages?.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Sentinel observer — attaches cleanly via useEffect every time page state updates
  const sentinelRef = useRef(null);
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasNextPage || isFetchingNextPage) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { rootMargin: '1600px' }
    );
    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, items.length]);

  if (!canonicalGenreName && genreId) {
    return <Navigate to="/" replace />;
  }
  if (genreId && !genreName && canonicalGenreName) {
    return <Navigate to={`/genre/${genreId}/${encodeURIComponent(canonicalGenreName)}`} replace />;
  }

  if (isLoading && !isError) {
    return (
      <section className="content-section">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div className="h-8 w-40 rounded bg-white/[0.08] animate-pulse"></div>
        </div>
        <GridSkeleton count={14} />
      </section>
    );
  }

  return (
    <section className="content-section">
      <div className="mb-4 flex gap-2 overflow-x-auto pb-2 filter-scrollbar-hidden" aria-label="Genres">
        {GENRE_CHIP_IDS.map((gid) => {
          const label = TMDB_GENRE_NAMES[gid];
          if (!label) return null;
          const active = String(gid) === String(genreId);
          return (
            <Link
              key={gid}
              to={`/genre/${gid}/${encodeURIComponent(label)}`}
              replace
              className={`shrink-0 rounded-full border px-4 py-2 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-white ${
                active ? 'border-white bg-white text-black' : 'border-white/15 bg-white/[0.06] text-white hover:bg-white/[0.14]'
              }`}
            >
              {label}
            </Link>
          );
        })}
      </div>
      <SectionHeader title={displayGenreName} large />

      {isError ? (
        <div className="app-error">
          <p>{error?.message || `Unable to load ${genreName} titles.`}</p>
          <button
            type="button"
            className="mt-4 rounded-full bg-white/10 px-5 py-2 text-white transition-colors hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white"
            onClick={() => refetch()}
          >
            Try again
          </button>
        </div>
      ) : items.length ? (
        <>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-2 sm:gap-3 lg:gap-4">
            {items.map((item, index) => (
              <ContentCard key={`${item.id}-${index}`} item={item} />
            ))}
          </div>

          {/* Sentinel element — observed to trigger next page load */}
          {hasNextPage && (
            <div ref={sentinelRef} className="load-more-zone min-h-[40px] flex items-center justify-center py-4">
              {isFetchingNextPage && (
                <div className="load-more-indicator" role="status" aria-live="polite">
                  <span className="load-more-indicator__spinner" aria-hidden="true" />
                  <span>Loading more</span>
                </div>
              )}
            </div>
          )}

          {!hasNextPage && items.length >= 30 && (
            <p className="mt-8 text-center text-sm text-white/30">All titles loaded</p>
          )}
        </>
      ) : (
        <div className="app-empty">
          <p>No titles found for this genre.</p>
        </div>
      )}
    </section>
  );
}
