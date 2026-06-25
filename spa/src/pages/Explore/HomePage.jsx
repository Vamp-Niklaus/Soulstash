import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { cachedApiFetch, getToken } from '../../api/client.js';
import { normalizeStoredCollectionItem } from '../../utils/formatters.js';
import { broadcastCollections, loadUserCollections, normalizeCollections, homeTrendingCache, enrichCollectionRatingsInBackground } from '../../utils/helpers.js';
import { useHomeTwoRowLimit, useGridKeyNav } from '../../hooks/index.js';
import { HOME_GRID_CLASS, HOME_TRENDING_TTL } from '../../utils/constants.js';
import { HomePageSkeleton } from '../../components/ui/Skeletons/index.js';
import { ContentCard } from '../../components/ui/Cards/ContentCard.jsx';
import { HomeShelfHeader } from './HomeShelfHeader.jsx';
import { LazyCategoryShelf } from './LazyCategoryShelf.jsx';
export function HomePage() {
  const navigate = useNavigate();
  const [trending, setTrending] = useState([]);
  const [collections, setCollections] = useState([]);
  const [publishedCollections, setPublishedCollections] = useState([]);
  const [genres, setGenres] = useState([]);
  const [categoryData, setCategoryData] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryTick, setRetryTick] = useState(0);
  const homeShelfLimit = useHomeTwoRowLimit();
  // Track which collection IDs have already been submitted for enrichment
  // so we never re-run just because setCollections() updated state.
  const enrichedCollectionIdsRef = useRef(new Set());

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
        const [homeData, userCollections, publishedData] = await Promise.all([
          cachedApiFetch('/api/home').catch(() => ({ trending: [], genres: [], categories: {} })),
          getToken() ? loadUserCollections().catch(() => []) : Promise.resolve([]),
          cachedApiFetch('/api/collections/published').catch(() => ({ collections: [] }))
        ]);

        if (!ignore) {
          const homeTrending = Array.isArray(homeData?.trending) ? homeData.trending : [];
          setTrending(homeTrending);
          // Warm the loadTrendingHome cache so TrendingPage reuses it
          if (homeTrending.length) { homeTrendingCache.data = homeTrending; homeTrendingCache.expiresAt = Date.now() + HOME_TRENDING_TTL; }
          setCollections(userCollections);
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

  // Enrich ratings for any collection not yet attempted this session.
  // We deliberately do NOT include `collections` in the dep array - we only
  // want to kick off enrichment once per load, not every time setCollections
  // updates state (which would create an infinite loop).
  useEffect(() => {
    if (!collections.length) return undefined;

    // Find collections that haven't been enriched yet this session
    const pending = collections.filter((c) => {
      const key = String(c._id || c.name);
      return !enrichedCollectionIdsRef.current.has(key);
    });
    if (!pending.length) {
      console.log('[Soulstash][React][HomePage] enrichment effect - all collections already attempted, skipping');
      return undefined;
    }

    console.log(`[Soulstash][React][HomePage] enrichment effect - queuing ${pending.length} collection(s):`, pending.map(c => c.name));

    // Mark them as attempted immediately so re-renders don't re-queue them
    pending.forEach((c) => enrichedCollectionIdsRef.current.add(String(c._id || c.name)));

    let cancelled = false;

    (async () => {
      for (const collection of pending) {
        if (cancelled) return;
        try {
          const response = await enrichCollectionRatingsInBackground(collection, '[Soulstash][React][HomePage]');
          if (!cancelled && Array.isArray(response?.collections)) {
            setCollections(normalizeCollections(response.collections));
            broadcastCollections(response.collections, response?.collectionVersion);
          }
        } catch (enrichError) {
          if (!cancelled) {
            console.warn('[Soulstash][React][HomePage] Failed to enrich collection metadata', {
              collectionId: collection?._id,
              collectionName: collection?.name,
              message: enrichError.message
            });
          }
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collections.length]);

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

