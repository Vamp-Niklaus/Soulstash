import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { cachedApiFetch, getToken } from '../../api/client.js';
import { normalizeStoredCollectionItem } from '../../utils/formatters.js';
import { broadcastCollections, getCachedUserCollections, loadUserCollections, normalizeCollections, homeTrendingCache } from '../../utils/helpers.js';
import { useHomeTwoRowLimit, useGridKeyNav } from '../../hooks/index.js';
import { HOME_GRID_CLASS, HOME_TRENDING_TTL } from '../../utils/constants.js';
import { HomePageSkeleton } from '../../components/ui/Skeletons/index.js';
import { ContentCard } from '../../components/ui/Cards/ContentCard.jsx';
import { HomeShelfHeader } from './HomeShelfHeader.jsx';
import { LazyCategoryShelf } from './LazyCategoryShelf.jsx';


export function HomePage() {
  const navigate = useNavigate();
  const [trending, setTrending] = useState([]);
  const [collections, setCollections] = useState(() => normalizeCollections(getCachedUserCollections()));
  const [publishedCollections, setPublishedCollections] = useState([]);
  const [genres, setGenres] = useState([]);
  const [categoryData, setCategoryData] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryTick, setRetryTick] = useState(0);
  const homeShelfLimit = useHomeTwoRowLimit();


  const pageRef = useRef(null);
  const firstCardRef = useRef(null);
  useGridKeyNav(pageRef, 'button[data-card]');



  // When page loads, set up arrow key listener to focus first card
  useEffect(() => {
    // Global TV navigation handles initial focus and card movement.
    return undefined;

    console.log('[NAV-DEBUG] HomePage: first-card window keydown listener registered | firstCardRef=', firstCardRef.current);
    const handleKeyDown = (event) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowRight') return;
      const ae = document.activeElement;
      const onCard = ae?.closest('[data-card]');
      const onSection = ae?.closest('.content-section');
      console.log(`[NAV-DEBUG] HomePage window key=${event.key} | activeEl=`, ae, `| onCard=${!!onCard} | onSection=${!!onSection} | firstCardRef=`, firstCardRef.current);
      // If nothing is focused or body is focused, jump to first card
      if (
        ae === document.body ||
        ae?.tagName === 'NAV' ||
        (!onCard && !onSection)
      ) {
        event.preventDefault();
        console.log('[NAV-DEBUG] HomePage: jumping focus to firstCardRef');
        firstCardRef.current?.focus();
      } else {
        console.log('[NAV-DEBUG] HomePage: focus already on content - letting useGridKeyNav handle it');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    let ignore = false;
    let retryTimeout = null;

    async function load() {
      try {
        setError('');
        // Collections: use cache immediately — only hit network if cache is empty
        const cachedCollections = getCachedUserCollections();
        if (!cachedCollections.length && getToken()) {
          loadUserCollections().then((fetched) => {
            if (!ignore) setCollections(normalizeCollections(fetched));
          }).catch(() => {});
        }
        const [homeData, publishedData] = await Promise.all([
          cachedApiFetch('/api/home').catch(() => ({ trending: [], genres: [], categories: {} })),
          cachedApiFetch('/api/collections/published').catch(() => ({ collections: [] }))
        ]);

        if (!ignore) {
          const homeTrending = Array.isArray(homeData?.trending) ? homeData.trending : [];
          setTrending(homeTrending);
          // Warm the loadTrendingHome cache so TrendingPage reuses it
          if (homeTrending.length) { homeTrendingCache.data = homeTrending; homeTrendingCache.expiresAt = Date.now() + HOME_TRENDING_TTL; }
          if (cachedCollections.length) setCollections(normalizeCollections(cachedCollections));
          setPublishedCollections(Array.isArray(publishedData?.collections) ? publishedData.collections : []);
          setGenres(Array.isArray(homeData?.genres) ? homeData.genres : []);
          setCategoryData(homeData?.categories && typeof homeData.categories === 'object' ? homeData.categories : {});
        }
      } catch (requestError) {
        if (!ignore) {
          setError(requestError.message);
          retryTimeout = window.setTimeout(() => {
            if (!ignore) {
              setRetryTick((current) => current + 1);
            }
          }, 4000);
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      ignore = true;
      if (retryTimeout) {
        window.clearTimeout(retryTimeout);
      }
    };
  }, [retryTick]);


  if (loading && !error) {
    return <HomePageSkeleton />;
  }


  return (
    <div ref={pageRef} className="space-y-8">
      <section className="content-section">
        <HomeShelfHeader title="Trending Now" onViewAll={() => navigate('/trending')} />
        {error ? (
          <div className="app-error">
            <p>{error}</p>
            <button
              type="button"
              className="mt-4 px-5 py-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors focus:outline-none focus:ring-2 focus:ring-white"
              onClick={() => {
                setLoading(true);
                setRetryTick((current) => current + 1);
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

