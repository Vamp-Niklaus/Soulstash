import React, { useState, useEffect, useRef } from 'react';
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
      const trending = Array.isArray(trendingRaw) ? trendingRaw : [];

      const popularRaw = homeData?.popular?.results || homeData?.popular || homeData?.popularMovies?.results || [];
      const popular = Array.isArray(popularRaw) ? popularRaw : [];

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

      const rawGenres = Array.isArray(genresData?.genres) && genresData.genres.length
        ? genresData.genres
        : (Array.isArray(homeData?.genres) ? homeData.genres : []);

      return {
        trending,
        popular,
        genres: rawGenres,
        categoryData: homeData?.categories && typeof homeData.categories === 'object' ? homeData.categories : {},
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

  // Aggressively preload images for trending and preloaded categories
  useEffect(() => {
    if (trending.length > 0) {
      preloadImages(trending.slice(0, homeShelfLimit).map(item => item.poster_path));
    }
    if (popular.length > 0) {
      preloadImages(popular.slice(0, homeShelfLimit).map(item => item.poster_path));
    }
    
    // Preload first row for each pre-filled category
    Object.values(categoryData).forEach(movies => {
      if (Array.isArray(movies) && movies.length > 0) {
        preloadImages(movies.slice(0, homeShelfLimit).map(item => item.poster_path));
      }
    });
  }, [trending, popular, categoryData, homeShelfLimit]);

  const firstCardRef = useRef(null);

  if (loading && !error) {
    return <HomePageSkeleton />;
  }


  return (
    <div className="space-y-8">
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
            {trending.slice(0, homeShelfLimit).map((item, index) => (
              <ContentCard key={item.id} item={item} ref={index === 0 ? firstCardRef : null} data-card />
            ))}
          </div>
        ) : null}
      </section>

      {popular.length > 0 && !loading && !error ? (
        <section className="content-section">
          <HomeShelfHeader title="Popular Movies" onViewAll={() => navigate('/popular')} />
          <div className={HOME_GRID_CLASS}>
            {popular.slice(0, homeShelfLimit).map((item) => (
              <ContentCard key={`pop-${item.id}`} item={item} data-card />
            ))}
          </div>
        </section>
      ) : null}

      {genres.map((genre) => (
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
                    {items.slice(0, homeShelfLimit).map((item, index) => (
                      <ContentCard key={`${colPublisher}-${colTitle}-${item.id || index}-${item.media_type}`} item={item} data-card />
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
