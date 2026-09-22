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
      const [homeData, publishedData] = await Promise.all([
        apiFetch('/api/home').catch(() => ({ trending: [], genres: [], categories: {} })),
        apiFetch('/api/collections/published').catch(() => ({ collections: [] }))
      ]);

      // Collections warm-up
      const cachedCollections = getCachedUserCollections();
      if (!cachedCollections.length && getToken()) {
        loadUserCollections().catch(() => {});
      }

      const trending = Array.isArray(homeData?.trending) ? homeData.trending : [];
      if (trending.length) {
        homeTrendingCache.data = trending;
        homeTrendingCache.expiresAt = Date.now() + HOME_TRENDING_TTL;
      }

      return {
        trending,
        genres: Array.isArray(homeData?.genres) ? homeData.genres : [],
        categoryData: homeData?.categories && typeof homeData.categories === 'object' ? homeData.categories : {},
        publishedCollections: Array.isArray(publishedData?.collections) ? publishedData.collections : []
      };
    }
  });

  const trending = data?.trending || [];
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
    
    // Preload first row for each pre-filled category
    Object.values(categoryData).forEach(movies => {
      if (Array.isArray(movies) && movies.length > 0) {
        preloadImages(movies.slice(0, homeShelfLimit).map(item => item.poster_path));
      }
    });
  }, [trending, categoryData, homeShelfLimit]);

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

      {genres.map((genre) => (
        <LazyCategoryShelf key={genre.id || genre} genre={genre} limit={homeShelfLimit} preloadedMovies={categoryData[String(genre.id)]} />
      ))}

      {publishedCollections.length ? (
        <section className="content-section space-y-6">
          {publishedCollections.map((collection) => {
            const items = Array.isArray(collection.movies) ? collection.movies.map(normalizeStoredCollectionItem) : [];
            return (
              <div key={`${collection.username}-${collection.name}`} className="space-y-4">
                <HomeShelfHeader
                  title={collection.name}
                  publisher={collection.username}
                  onPublisherClick={() => navigate(`/user/${collection.username}`)}
                  onViewAll={() => navigate(`/user/${collection.username}/collection/${encodeURIComponent(collection.name)}`)}
                />
                {items.length ? (
                  <div className={HOME_GRID_CLASS}>
                    {items.slice(0, homeShelfLimit).map((item, index) => (
                      <ContentCard key={`${collection.username}-${collection.name}-${item.id || index}-${item.media_type}`} item={item} data-card />
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
