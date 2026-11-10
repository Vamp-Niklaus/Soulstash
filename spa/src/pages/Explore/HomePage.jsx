import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiFetch, getToken } from '../../api/client.js';
import { normalizeStoredCollectionItem } from '../../utils/formatters.js';
import { broadcastCollections, getCachedUserCollections, normalizeCollections } from '../../utils/collectionsCache.js';
import { loadUserCollections } from '../../utils/collectionsApi.js';
import { homeTrendingCache } from '../../utils/trendingCache.js';
import { useHomeTwoRowLimit } from '../../hooks/index.js';
import { HOME_GRID_CLASS, HOME_TRENDING_TTL } from '../../utils/constants.js';
import { HomePageSkeleton } from '../../components/ui/Skeletons/index.js';
import { ContentCard } from '../../components/ui/Cards/ContentCard.jsx';
import { ContinueWatchingCard } from '../../components/ui/Cards/ContinueWatchingCard.jsx';
import { getContinueWatchingList, removeWatchProgress, syncAccountWatchProgress } from '../../utils/watchProgress.js';
import { HomeShelfHeader } from './HomeShelfHeader.jsx';
import { LazyCategoryShelf } from './LazyCategoryShelf.jsx';
import { preloadImages } from '../../utils/preload.js';

export function HomePage() {
  const navigate = useNavigate();
  const { data, isLoading: loading, error: queryError, refetch } = useQuery({
    queryKey: ['homePageData'],
    queryFn: async () => {
      const [homeData, publishedData, genresData] = await Promise.all([
        apiFetch('/api/home').catch(() => ({ trending: [], genres: [], categories: {} })),
        apiFetch('/api/collections/published').catch(() => []),
        apiFetch('/api/genres').catch(() => ({ genres: [] }))
      ]);

      // Collections warm-up
      const cachedCollections = getCachedUserCollections();
      if (!cachedCollections.length && getToken()) {
        loadUserCollections().catch(() => {});
      }

      const trendingRaw = homeData?.trending?.results || homeData?.trending || [];
      const trending = Array.isArray(trendingRaw) ? trendingRaw.filter(item => item?.poster_path && String(item.poster_path).trim()) : [];

      const popularMovies = Array.isArray(homeData?.popularMovies?.results) ? homeData.popularMovies.results : [];
      const popularSeries = Array.isArray(homeData?.popularSeries?.results) ? homeData.popularSeries.results : [];
      const combinedPopular = [
        ...popularMovies.map(item => ({ ...item, media_type: item.media_type || 'Movie' })),
        ...popularSeries.map(item => ({ ...item, media_type: item.media_type || 'Series' }))
      ].sort((a, b) => (Number(b.popularity) || 0) - (Number(a.popularity) || 0));
      const popularRaw = combinedPopular.length
        ? combinedPopular
        : (homeData?.popular?.results || homeData?.popular || []);
      const popular = Array.isArray(popularRaw) ? popularRaw.filter(item => item?.poster_path && String(item.poster_path).trim()) : [];

      if (trending.length) {
        homeTrendingCache.data = trending;
        homeTrendingCache.expiresAt = Date.now() + HOME_TRENDING_TTL;
      }

      const publishedList = Array.isArray(publishedData)
        ? publishedData
        : (Array.isArray(publishedData?.collections) ? publishedData.collections : []);
      const rawPublished = publishedList.map((entry) => {
        const col = entry?.collection || entry || {};
        return {
          ...col,
          _id: col._id || entry?._id,
          id: col._id || entry?._id || col.id,
          name: col.name || entry?.name || '',
          username: entry?.username || col.username || '',
          avatar: entry?.avatar || col.avatar || '',
          movies: Array.isArray(col.movies) ? col.movies : (Array.isArray(entry?.movies) ? entry.movies : [])
        };
      });

      const baseGenres = Array.isArray(genresData?.genres) && genresData.genres.length
        ? genresData.genres
        : (Array.isArray(homeData?.genres) ? homeData.genres : []);

      const isKidsOrDocOrTvMovie = (g) => {
        const id = String(g?.id || g).toLowerCase();
        const name = String(g?.name || '').toLowerCase();
        return (
          id === '10762' ||
          id === '10770' ||
          id === '99' ||
          name === 'kids' ||
          name === 'tv movie' ||
          name === 'documentary' ||
          name.includes('documentary')
        );
      };

      const cleanBaseGenres = baseGenres.filter((g) => !isKidsOrDocOrTvMovie(g));

      const bollywoodGenre = { id: 'bollywood', name: 'Latest in India' };

      const cartoonGenre = { id: 'kartoons-cartoon', name: 'Cartoon' };
      const animeGenre = { id: 'kartoons-anime', name: 'Anime' };

      const otherGenres = cleanBaseGenres.filter((g) => {
        const id = String(g?.id || g).toLowerCase();
        return (
          id !== 'bollywood' &&
          id !== 'kartoons-cartoon' &&
          id !== 'kartoons-anime' &&
          id !== 'anime' &&
          id !== 'cartoon'
        );
      });

      // Strict user-specified order:
      // 1. (Continue Watching rendered directly above Trending Now)
      // 2. (Trending Now rendered in Home JSX)
      // 3. Bollywood
      // 4. Cartoon
      // 5. Anime
      // 6. Other genres
      const rawGenres = [
        bollywoodGenre,
        cartoonGenre,
        animeGenre,
        ...otherGenres
      ];

      const rawCategoryData = homeData?.categories && typeof homeData.categories === 'object' ? homeData.categories : {};
      const cleanCategoryData = {};
      for (const [key, list] of Object.entries(rawCategoryData)) {
        if (Array.isArray(list)) {
          cleanCategoryData[key] = list.filter((item) => {
            const p = item?.poster_path || item?.image || item?.coverImage;
            return Boolean(
              p &&
              typeof p === 'string' &&
              p.trim() &&
              p !== 'null' &&
              p !== 'undefined' &&
              !p.startsWith('data:image/svg+xml') &&
              !p.includes('placeholder')
            );
          });
        }
      }

      return {
        trending,
        popular,
        genres: rawGenres,
        categoryData: cleanCategoryData,
        publishedCollections: rawPublished
      };
    }
  });

  const trending = data?.trending || [];
  const popular = data?.popular || [];
  const genres = data?.genres || [];
  const categoryData = data?.categoryData || {};
  const publishedCollections = data?.publishedCollections || [];
  const error = queryError?.message || '';

  const homeShelfLimit = useHomeTwoRowLimit();

  const [failedCardIds, setFailedCardIds] = useState(() => new Set());
  const [continueWatchingList, setContinueWatchingList] = useState(() => getContinueWatchingList());

  useEffect(() => {
    syncAccountWatchProgress().catch(() => {});
    const handleUpdate = () => {
      setContinueWatchingList(getContinueWatchingList());
    };
    window.addEventListener('soulstash:continue-watching-updated', handleUpdate);
    window.addEventListener('storage', handleUpdate);
    return () => {
      window.removeEventListener('soulstash:continue-watching-updated', handleUpdate);
      window.removeEventListener('storage', handleUpdate);
    };
  }, []);

  const handleCardImageError = useCallback((itemId) => {
    if (!itemId) return;
    setFailedCardIds((prev) => {
      if (prev.has(itemId)) return prev;
      const next = new Set(prev);
      next.add(itemId);
      return next;
    });
  }, []);

  const visibleTrending = useMemo(() => {
    return trending.filter((item) => !failedCardIds.has(item.id || item.title));
  }, [trending, failedCardIds]);

  const visiblePopular = useMemo(() => {
    return popular.filter((item) => !failedCardIds.has(item.id || item.title));
  }, [popular, failedCardIds]);

  const visibleContinueWatching = useMemo(() => {
    return continueWatchingList.filter(
      (entry) => (entry.poster_path || entry.image) && !failedCardIds.has(entry.id || entry.key)
    );
  }, [continueWatchingList, failedCardIds]);

  // Aggressively preload images for trending and preloaded categories
  useEffect(() => {
    if (visibleTrending.length > 0) {
      preloadImages(visibleTrending.slice(0, homeShelfLimit).map(item => item.poster_path));
    }
    if (visiblePopular.length > 0) {
      preloadImages(visiblePopular.slice(0, homeShelfLimit).map(item => item.poster_path));
    }
    
    // Preload first row for each pre-filled category
    Object.values(categoryData).forEach(movies => {
      if (Array.isArray(movies) && movies.length > 0) {
        preloadImages(movies.slice(0, homeShelfLimit).map(item => item.poster_path));
      }
    });
  }, [visibleTrending, visiblePopular, categoryData, homeShelfLimit]);

  const firstCardRef = useRef(null);

  if (loading && !error) {
    return <HomePageSkeleton />;
  }


  return (
    <div className="space-y-8">
      {/* 1. Continue Watching (shown ONLY if at least 1 in-progress content with poster exists) */}
      {visibleContinueWatching.length > 0 && (
        <section className="content-section">
          <HomeShelfHeader title="Continue Watching" onViewAll={() => navigate('/continue-watching')} />
          <div className={HOME_GRID_CLASS}>
            {visibleContinueWatching.slice(0, homeShelfLimit).map((entry) => (
              <ContinueWatchingCard
                key={entry.key || `continue-${entry.id}`}
                entry={entry}
                onRemove={(it) => {
                  removeWatchProgress(it);
                  setContinueWatchingList(getContinueWatchingList());
                }}
                onImageError={() => handleCardImageError(entry.id || entry.key)}
              />
            ))}
          </div>
        </section>
      )}

      {/* 2. Trending Now */}
      <section className="content-section">
        <HomeShelfHeader title="Trending Now" onViewAll={() => navigate('/trending')} />
        {error ? (
          <div className="app-error">
            <p>{error}</p>
            <button
              type="button"
              className="mt-4 px-5 py-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors focus:outline-none focus:ring-2 focus:ring-white"
              onClick={() => {
                refetch();
              }}
            >
              Try again
            </button>
          </div>
        ) : null}
        {!loading && !error ? (
          <div className={HOME_GRID_CLASS}>
            {visibleTrending.slice(0, homeShelfLimit).map((item, index) => (
              <ContentCard
                key={`trending-${item.id}-${index}`}
                item={item}
                ref={index === 0 ? firstCardRef : null}
                data-card
                onImageError={() => handleCardImageError(item.id || item.title)}
              />
            ))}
          </div>
        ) : null}
      </section>

      {/* 3. Bollywood (Latest in India) */}
      {genres.slice(0, 1).map((genre) => (
        <LazyCategoryShelf key={genre.id || genre} genre={genre} limit={homeShelfLimit} preloadedMovies={categoryData[String(genre.id)]} />
      ))}

      {/* 4. Popular — after Bollywood, before Cartoon/Anime */}
      {visiblePopular.length > 0 && !loading && !error ? (
        <section className="content-section">
          <HomeShelfHeader title="Popular" onViewAll={() => navigate('/popular')} />
          <div className={HOME_GRID_CLASS}>
            {visiblePopular.slice(0, homeShelfLimit).map((item, index) => (
              <ContentCard
                key={`pop-${item.media_type || 'Movie'}-${item.id}-${index}`}
                item={item}
                data-card
                onImageError={() => handleCardImageError(item.id || item.title)}
              />
            ))}
          </div>
        </section>
      ) : null}

      {/* 5. Cartoon, 6. Anime, 7. Other genres */}
      {genres.slice(1).map((genre) => (
        <LazyCategoryShelf key={genre.id || genre} genre={genre} limit={homeShelfLimit} preloadedMovies={categoryData[String(genre.id)]} />
      ))}

      {publishedCollections.length ? (
        <section className="content-section space-y-6">
          {publishedCollections.map((collection, colIdx) => {
            const items = Array.isArray(collection.movies) ? collection.movies.map(normalizeStoredCollectionItem) : [];
            const colTitle = collection.name || 'Collection';
            const colPublisher = collection.username || '';
            return (
              <div key={`${colPublisher}-${colTitle}-${collection._id || colIdx}`} className="space-y-4">
                <HomeShelfHeader
                  title={colTitle}
                  publisher={colPublisher}
                  onPublisherClick={() => colPublisher && navigate(`/user/${colPublisher}`)}
                  onViewAll={() => colPublisher && navigate(`/user/${colPublisher}/collection/${encodeURIComponent(colTitle)}`)}
                />
                {items.length ? (
                  <div className={HOME_GRID_CLASS}>
                    {items.filter(it => !failedCardIds.has(it.id || it.title)).slice(0, homeShelfLimit).map((item, index) => (
                      <ContentCard
                        key={`${colPublisher}-${colTitle}-${item.id || index}-${item.media_type}`}
                        item={item}
                        data-card
                        onImageError={() => handleCardImageError(item.id || item.title)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-[#9a9a9a]">No titles available.</div>
                )}
              </div>
            );
          })}
        </section>
      ) : null}
    </div>
  );
}
