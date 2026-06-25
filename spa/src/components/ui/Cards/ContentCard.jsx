import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { FALLBACK_AVATAR, FALLBACK_POSTER } from '../../../utils/constants.js';
import {
  formatRuntime, yearFrom, getLanguageName, getPrimaryCountry,
  getDirectorLabel, getDirectorPeople, getValidImdbRating,
  getValidVoteAverage, getPreferredRating, creditItemKey,
  creditMatchesCollectionItem, filterCreditsByCollectionItems,
  isContentInCollection, imageUrl, normalizeStoredCollectionItem, mediaRoute
} from '../../../utils/formatters.js';

export const ContentCard = React.forwardRef(function ContentCard({ item, status = null, onRemove, itemId, ...props }, ref) {
  const navigate = useNavigate();
  const title = item.title || item.name || 'Unknown';
  const contentType = item.media_type || (item.title ? 'Movie' : 'Series');

  return (
    <button
      ref={ref}
      type="button"
      {...props}
      className="card group relative"
      onClick={() => navigate(mediaRoute(item))}
      aria-label={title}
    >
      <div className="cardImageWrap relative">
        <img
          src={imageUrl(item.poster_path, 'w500')}
          alt={title}
          className="cardImg fadeImg"
          loading="lazy"
          decoding="async"
          onError={(event) => {
            event.currentTarget.src = FALLBACK_POSTER;
          }}
        />
        {status?.watched ? (
          <span className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#10B981] text-white shadow-[0_8px_18px_rgba(0,0,0,0.28)] z-10">
            <i className="fas fa-eye text-[15px] text-black"></i>
          </span>
        ) : null}
        {!status?.watched && status?.watchlist ? (
          <span className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#F59E0B] text-white shadow-[0_8px_18px_rgba(0,0,0,0.28)] z-10">
            <i className="fas fa-clock text-[15px] text-black"></i>
          </span>
        ) : null}
        {onRemove ? (
          <div
            className="absolute top-2 right-2 remove-btn w-8 h-8 rounded-full bg-black/72 text-white hover:bg-black/90 transition-colors flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-white z-20"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onRemove(itemId || item.id, title);
            }}
            aria-label={`Remove ${title}`}
            role="button"
            tabIndex={0}
          >
            <i className="fas fa-times text-[12px]"></i>
          </div>
        ) : null}
      </div>
      <div className="cardMeta">
        <div className="cardTitleWrap">
          <h3 className={`cardTitle ${title.length > 18 ? 'marquee-on-hover' : ''}`} data-title={title}>{title}</h3>
        </div>
        <div className="cardSubMeta">
          <span className="cardSubMetaItem">
            <svg className="cardSubMetaStar" viewBox="0 0 24 24" width="11" height="11" aria-hidden="true">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
            </svg>
            <span className="cardSubMetaNum">{getPreferredRating(item)?.toFixed(1) || 'N/A'}</span>
          </span>
          <span className="cardSubMetaSep" aria-hidden="true">·</span>
          <span className="cardSubMetaItem cardSubMetaNum">{yearFrom(item)}</span>
          <span className="cardSubMetaSep" aria-hidden="true">·</span>
          <span className="cardSubMetaItem">{contentType}</span>
        </div>
      </div>
    </button>
  );
});

function getHomeGridColumns(width = window.innerWidth) {
  if (width >= 1280) return 7;
  if (width >= 1024) return 6;
  if (width >= 768) return 5;
  if (width >= 640) return 4;
  return 3;
}

function useGridKeyNav(containerRef, itemSelector = 'button[data-card]') {
  useEffect(() => {
    // D-pad grid navigation is owned by tvNav.js. Keep this hook as a no-op
    // for older call sites while avoiding a second window key handler.
    return undefined;

    // IMPORTANT: Listen on window, not the container.
    // The container ref may be null at mount time (skeleton shown first).
    // We look up containerRef.current on EVERY key press instead.
    const handleKeyDown = (event) => {
      if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)) return;

      const container = containerRef.current;
      if (!container) {
        console.log('[NAV-DEBUG] useGridKeyNav: key pressed but container still null - skipping');
        return;
      }

      const cards = Array.from(container.querySelectorAll(itemSelector));
      const current = document.activeElement;
      const currentIndex = cards.indexOf(current);
      console.log(`[NAV-DEBUG] useGridKeyNav key=${event.key} | cards found=${cards.length} | currentIndex=${currentIndex} | activeEl=`, current);

      if (currentIndex === -1) {
        console.log('[NAV-DEBUG] useGridKeyNav: focused element not in card list - no-op');
        return;
      }

      // Calculate columns from grid layout
      let cols = 1;
      if (cards.length > 1) {
        const firstRect = cards[0].getBoundingClientRect();
        cols = cards.filter(c => Math.abs(c.getBoundingClientRect().top - firstRect.top) < 5).length;
        if (cols === 0) cols = 1;
      }
      console.log(`[NAV-DEBUG] useGridKeyNav: detected ${cols} columns`);

      let nextIndex = -1;
      if (event.key === 'ArrowRight') nextIndex = currentIndex + 1;
      if (event.key === 'ArrowLeft') nextIndex = currentIndex - 1;
      if (event.key === 'ArrowDown') nextIndex = currentIndex + cols;
      if (event.key === 'ArrowUp') nextIndex = currentIndex - cols;

      if (nextIndex >= 0 && nextIndex < cards.length) {
        event.preventDefault();
        console.log(`[NAV-DEBUG] useGridKeyNav: moving to card index ${nextIndex}`, cards[nextIndex]);
        cards[nextIndex].focus();
        cards[nextIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } else {
        console.log(`[NAV-DEBUG] useGridKeyNav: nextIndex=${nextIndex} out of range [0..${cards.length-1}] - at edge`);
      }
    };

    console.log('[NAV-DEBUG] useGridKeyNav: window keydown listener registered (will resolve container on each key press)');
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  // Empty deps - register once, resolve ref dynamically on every key press
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function useDropdownKeyNav(dropdownRef, onClose) {
  useEffect(() => {
    const dropdown = dropdownRef.current;
    if (!dropdown) return;

    // Auto-focus first item when dropdown opens
    const firstBtn = dropdown.querySelector('button');
    if (firstBtn) firstBtn.focus();

    const handleKeyDown = (event) => {
      const buttons = Array.from(dropdown.querySelectorAll('button'));
      const currentIndex = buttons.indexOf(document.activeElement);

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        buttons[currentIndex + 1]?.focus();
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (currentIndex === 0) onClose();
        else buttons[currentIndex - 1]?.focus();
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    dropdown.addEventListener('keydown', handleKeyDown);
    return () => dropdown.removeEventListener('keydown', handleKeyDown);
  }, [dropdownRef, onClose]);
}

function useHomeTwoRowLimit() {
  const [limit, setLimit] = useState(() => getHomeGridColumns() * 2);

  useEffect(() => {
    function handleResize() {
      setLimit(getHomeGridColumns() * 2);
    }

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return limit;
}

function HomePage() {
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

function TrendingPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [fetchingMore, setFetchingMore] = useState(false);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setError('');
    setPage(1);
    setHasMore(true);

    cachedApiFetch(`/api/trending?limit=36&page=1&retry=${retryTick}`)
      .then((data) => {
        if (!ignore) {
          const fetchedItems = Array.isArray(data?.movies) ? data.movies : (Array.isArray(data) ? data : []);
          setItems(fetchedItems);
          setHasMore(fetchedItems.length > 0 && data?.pagination?.page < data?.pagination?.pages);
          document.title = 'Trending Now | Soulstash';
        }
      })
      .catch((requestError) => {
        if (!ignore) setError(requestError.message || 'Unable to load trending titles.');
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [retryTick]);

  const observerRef = useRef(null);
  const lastElementRef = useCallback((node) => {
    if (loading || fetchingMore || !hasMore) return;
    if (observerRef.current) observerRef.current.disconnect();
    if (node) {
      observerRef.current = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) {
          setPage((p) => p + 1);
        }
      }, { rootMargin: '400px' });
      observerRef.current.observe(node);
    }
  }, [loading, fetchingMore, hasMore]);

  useEffect(() => {
    if (page === 1) return;
    let ignore = false;
    setFetchingMore(true);
    cachedApiFetch(`/api/trending?limit=36&page=${page}`)
      .then((data) => {
        if (!ignore) {
          const fetchedItems = Array.isArray(data?.movies) ? data.movies : (Array.isArray(data) ? data : []);
          setItems((prev) => [...prev, ...fetchedItems]);
          setHasMore(fetchedItems.length > 0 && data?.pagination?.page < data?.pagination?.pages);
        }
      })
      .finally(() => {
        if (!ignore) setFetchingMore(false);
      });
    return () => { ignore = true; };
  }, [page]);

  if (loading && !error) {
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
      <SectionHeader title="Trending Now" />
      {error ? (
        <div className="app-error">
          <p>{error}</p>
          <button
            type="button"
            className="mt-4 rounded-full bg-white/10 px-5 py-2 text-white transition-colors hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white"
            onClick={() => setRetryTick((current) => current + 1)}
          >
            Try again
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-2 sm:gap-3 lg:gap-4">
          {items.map((item, index) => {
            const isLast = index === items.length - 1;
            const contentCard = <ContentCard key={`${item.media_type || 'media'}-${item.id}`} item={item} />;
            return isLast ? (
              <div ref={lastElementRef} key={`${item.media_type || 'media'}-${item.id}-wrapper`}>
                {contentCard}
              </div>
            ) : contentCard;
          })}
        </div>
      )}
    </section>
  );
}

function CastCard({ person }) {
  const navigate = useNavigate();

  return (
    <button
      type="button"
      className="w-[130px] shrink-0 text-left rounded-2xl overflow-hidden border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] transition-colors"
      onClick={() => navigate(`/person/${person.id}`)}
    >
      <div className="aspect-[2/3] overflow-hidden">
        <img
          src={imageUrl(person.profile_path, 'w300_and_h450_face')}
          alt={person.name}
          className="w-full h-full object-cover"
          onError={(event) => {
            event.currentTarget.src = FALLBACK_AVATAR;
          }}
        />
      </div>
      <div className="p-3">
        <h3 className="text-sm font-semibold text-white truncate">{person.name}</h3>
        <p className="text-xs text-[#a6a6a6] truncate mt-1">{person.character || person.job || 'Cast'}</p>
      </div>
    </button>
  );
}

function LoadingCardRow({ count = 6 }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="overflow-hidden rounded-2xl border border-white/8 bg-white/[0.03] animate-pulse">
          <div className="aspect-[2/3] bg-white/[0.06]"></div>
          <div className="p-3 space-y-2">
            <div className="h-4 rounded bg-white/[0.08]"></div>
            <div className="h-3 w-2/3 rounded bg-white/[0.06]"></div>
          </div>
        </div>
      ))}
    </div>
  );
}

function GenrePage() {
  const { id, name } = useParams();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [fetchingMore, setFetchingMore] = useState(false);
  const [retryTick, setRetryTick] = useState(0);

  const genreId = id;
  const genreName = decodeURIComponent(name || '');

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setError('');
    setPage(1);
    setHasMore(true);

    cachedApiFetch(`/api/movies?genre=${genreId}&limit=36&page=1&retry=${retryTick}`)
      .then((data) => {
        if (!ignore) {
          const fetchedItems = Array.isArray(data?.movies) ? data.movies : [];
          setItems(fetchedItems);
          setHasMore(fetchedItems.length > 0 && data?.pagination?.page < data?.pagination?.pages);
          document.title = `${genreName} | Soulstash`;
        }
      })
      .catch((requestError) => {
        if (!ignore) setError(requestError.message || `Unable to load ${genreName} titles.`);
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [genreId, genreName, retryTick]);

  const observerRef = useRef(null);
  const lastElementRef = useCallback((node) => {
    if (loading || fetchingMore || !hasMore) return;
    if (observerRef.current) observerRef.current.disconnect();
    if (node) {
      observerRef.current = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) {
          setPage((p) => p + 1);
        }
      }, { rootMargin: '400px' });
      observerRef.current.observe(node);
    }
  }, [loading, fetchingMore, hasMore]);

  useEffect(() => {
    if (page === 1) return;
    let ignore = false;
    setFetchingMore(true);
    cachedApiFetch(`/api/movies?genre=${genreId}&limit=36&page=${page}`)
      .then((data) => {
        if (!ignore) {
          const fetchedItems = Array.isArray(data?.movies) ? data.movies : [];
          setItems((prev) => [...prev, ...fetchedItems]);
          setHasMore(fetchedItems.length > 0 && data?.pagination?.page < data?.pagination?.pages);
        }
      })
      .finally(() => {
        if (!ignore) setFetchingMore(false);
      });
    return () => { ignore = true; };
  }, [page, genreId]);

  if (loading && !error) {
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
      <SectionHeader title={genreName} large />
      {error ? (
        <div className="app-error">
          <p>{error}</p>
          <button
            type="button"
            className="mt-4 rounded-full bg-white/10 px-5 py-2 text-white transition-colors hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white"
            onClick={() => setRetryTick((current) => current + 1)}
          >
            Try again
          </button>
        </div>
      ) : items.length ? (
        <>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-2 sm:gap-3 lg:gap-4">
            {items.map((item, index) => {
              const isLast = index === items.length - 1;
              return <ContentCard ref={isLast ? lastElementRef : null} key={`${item.id}-${index}`} item={item} />;
            })}
          </div>
          {fetchingMore && (
            <div className="mt-8 flex justify-center">
              <div className="w-6 h-6 border-2 border-white/20 border-t-white/80 rounded-full animate-spin"></div>
            </div>
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

