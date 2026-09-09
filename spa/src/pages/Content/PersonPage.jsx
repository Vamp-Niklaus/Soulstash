import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, streamApiFetch, getToken } from '../../api/client.js';
import { creditItemKey, filterCreditsByCollectionItems, yearFrom, contentIdFromItem, mediaTypeFromItem, compareRatingsForSort, hasActivePersonFilters, normalizeCredit } from '../../utils/formatters.js';
import { normalizeCollections, getCachedUserCollections } from '../../utils/collectionsCache.js';
import { loadUserCollections } from '../../utils/collectionsApi.js';
import { mergeImdbRatings } from '../../utils/ratingsCache.js';

import { useLiveCollections, useSessionState } from '../../hooks/index.js';
import { AUTO_RECOVERY_RETRIES } from '../../utils/constants.js';

import { toast } from '../../utils/toast.js';
import { SectionHeader } from '../../components/ui/SectionHeader.jsx';
import { PersonPageSkeleton } from '../../components/ui/Skeletons/index.js';
import { ContentCard } from '../../components/ui/Cards/ContentCard.jsx';
import { PersonProfileHero } from './PersonProfileHero.jsx';

export function PersonCreditsFilterControls({
  contentType,
  setContentType,
  quickFilter,
  setQuickFilter,
  collectionFilter,
  setCollectionFilter,
  sortBy,
  setSortBy,
  collectionOptions,
  resetKey,
  collectionsLoading = false
}) {
  const collectionTriggerRef = useRef(null);
  const collectionDropdownRef = useRef(null);
  const [collectionMenuOpen, setCollectionMenuOpen] = useState(false);
  const [collectionMenuStyle, setCollectionMenuStyle] = useState({});
  const sortTriggerRef = useRef(null);
  const sortDropdownRef = useRef(null);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [sortMenuStyle, setSortMenuStyle] = useState({});

  const sortOptions = [
    { value: 'rating-desc', label: 'Rating high' },
    { value: 'rating-asc', label: 'Rating low' },
    { value: 'year-desc', label: 'Year new' },
    { value: 'year-asc', label: 'Year old' }
  ];

  const activeCollectionLabel =
    collectionOptions.find((option) => option.value === collectionFilter)?.label || 'All';

  const activeSortLabel =
    sortOptions.find((option) => option.value === sortBy)?.label || 'Rating high';

  function buildMenuPosition(trigger, estimatedWidth = 220, estimatedHeight = 220) {
    if (!trigger) return {};
    const rect = trigger.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const width = Math.min(estimatedWidth, viewportWidth - 16);
    const left = Math.min(Math.max(8, rect.left), Math.max(8, viewportWidth - width - 8));
    const belowTop = rect.bottom + 6;
    const aboveTop = rect.top - estimatedHeight - 6;
    const top = belowTop + estimatedHeight <= viewportHeight - 8 || aboveTop < 8
      ? Math.min(belowTop, Math.max(8, viewportHeight - estimatedHeight - 8))
      : aboveTop;
    return {
      position: 'fixed',
      zIndex: 2147483647,
      top: `${top}px`,
      left: `${left}px`,
      width: `${width}px`,
      maxWidth: 'calc(100vw - 16px)',
      boxSizing: 'border-box'
    };
  }

  useEffect(() => {
    setCollectionMenuOpen(false);
    setSortMenuOpen(false);
  }, [resetKey]);

  useEffect(() => {
    if (!collectionMenuOpen && !sortMenuOpen) return undefined;

    function updatePosition() {
      if (collectionTriggerRef.current) {
        setCollectionMenuStyle(buildMenuPosition(collectionTriggerRef.current, 240, Math.max(180, collectionOptions.length * 42 + 16)));
      }
      if (sortTriggerRef.current) {
        setSortMenuStyle(buildMenuPosition(sortTriggerRef.current, 220, 196));
      }
    }

    function handleOutside(event) {
      if (collectionTriggerRef.current?.contains(event.target)) return;
      if (collectionDropdownRef.current?.contains(event.target)) return;
      if (sortTriggerRef.current?.contains(event.target)) return;
      if (sortDropdownRef.current?.contains(event.target)) return;
      setCollectionMenuOpen(false);
      setSortMenuOpen(false);
    }

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    document.addEventListener('mousedown', handleOutside);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      document.removeEventListener('mousedown', handleOutside);
    };
  }, [collectionMenuOpen, sortMenuOpen, collectionOptions.length]);

  return (
    <>
      <div className="flex min-w-max flex-nowrap items-center gap-2">
        {[
          { value: 'all', label: 'All', kind: 'content' },
          { value: 'movies', label: 'Movies', kind: 'content' },
          { value: 'series', label: 'Series', kind: 'content' },
          { value: 'watched', label: 'Watched', kind: 'quick' },
          { value: 'watchlist', label: 'Watchlist', kind: 'quick' }
        ].map((option) => {
          const isQuick = option.kind === 'quick';
          const requiresCollections = isQuick && option.value !== 'all';
          const disabled = collectionsLoading && requiresCollections;
          const isActive = isQuick ? quickFilter === option.value : contentType === option.value;
          return (
            <button
              key={`${option.kind}-${option.value}`}
              type="button"
              className={`inline-flex h-10 flex-shrink-0 items-center justify-center whitespace-nowrap rounded-[20px] px-4 py-0.5 text-[13px] font-medium transition-colors ${disabled ? 'cursor-not-allowed opacity-55' : ''}`}
              style={{
                color: isActive ? 'rgb(226, 226, 226)' : 'rgb(168, 168, 168)',
                backgroundColor: isActive ? 'rgb(71, 71, 71)' : 'rgb(21, 21, 21)'
              }}
              onClick={() => {
                if (disabled) return;
                if (isQuick) {
                  setCollectionFilter('');
                  setQuickFilter((current) => (current === option.value ? 'all' : option.value));
                } else {
                  setContentType((current) => (current === option.value ? 'all' : option.value));
                }
              }}
              aria-disabled={disabled}
            >
              {option.label}
            </button>
          );
        })}

        <div className="relative flex-shrink-0">
          <button
            ref={collectionTriggerRef}
            type="button"
            className={`inline-flex h-10 max-w-full items-center justify-between gap-1.5 rounded-[20px] bg-[#151515] px-3 text-[13px] font-medium text-[#d9d9d9] ${collectionsLoading ? 'cursor-not-allowed opacity-55' : ''}`}
            onClick={(event) => {
              if (collectionsLoading) return;
              setCollectionMenuStyle(buildMenuPosition(event.currentTarget, 240, Math.max(180, collectionOptions.length * 42 + 16)));
              setSortMenuOpen(false);
              setCollectionMenuOpen((current) => !current);
            }}
            title={collectionsLoading ? 'Syncing collections...' : activeCollectionLabel}
            aria-disabled={collectionsLoading}
          >
            <span className="truncate">{collectionsLoading ? 'Syncing...' : activeCollectionLabel}</span>
            <i className="fas fa-chevron-down ml-1 text-[10px] text-[#7f7f7f]"></i>
          </button>
        </div>

        <div className="relative flex-shrink-0">
          <button
            ref={sortTriggerRef}
            type="button"
            className="inline-flex h-10 max-w-full items-center justify-between gap-1.5 rounded-[20px] bg-[#151515] px-3 text-[13px] font-medium text-[#d9d9d9]"
            onClick={(event) => {
              setSortMenuStyle(buildMenuPosition(event.currentTarget, 220, 196));
              setCollectionMenuOpen(false);
              setSortMenuOpen((current) => !current);
            }}
            title={activeSortLabel}
          >
            <span className="truncate">{activeSortLabel}</span>
            <i className="fas fa-chevron-down ml-1 text-[10px] text-[#7f7f7f]"></i>
          </button>
        </div>
      </div>

      {collectionMenuOpen
        ? createPortal(
            <div
              ref={collectionDropdownRef}
              style={collectionMenuStyle}
              className="inline-flex min-w-max flex-col items-stretch rounded-[16px] border border-white/12 bg-[#111111] p-2 shadow-[0_24px_60px_rgba(0,0,0,0.55)]"
            >
              <div className="filter-scrollbar-hidden max-h-[280px] overflow-y-auto">
                {collectionOptions.map((option) => (
                  <button
                    key={option.value || 'all-collections'}
                    type="button"
                    className={`inline-flex w-full items-center gap-2 whitespace-nowrap rounded-[12px] px-3 py-2.5 text-[13px] text-left ${
                      collectionFilter === option.value ? 'bg-white/[0.08] text-white' : 'text-[#d0d0d0] hover:bg-white/[0.05]'
                    }`}
                    onClick={() => {
                      setQuickFilter('all');
                      setCollectionFilter((current) => (current === option.value ? '' : option.value));
                      setCollectionMenuOpen(false);
                    }}
                  >
                    <span className="truncate">{option.label}</span>
                  </button>
                ))}
              </div>
            </div>,
            document.body
          )
        : null}

      {sortMenuOpen
        ? createPortal(
            <div
              ref={sortDropdownRef}
              style={sortMenuStyle}
              className="inline-flex min-w-max flex-col items-stretch rounded-[16px] border border-white/12 bg-[#111111] p-2 shadow-[0_24px_60px_rgba(0,0,0,0.55)]"
            >
              {sortOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`inline-flex w-full items-center gap-2 whitespace-nowrap rounded-[12px] px-3 py-2.5 text-[13px] text-left ${
                    sortBy === option.value ? 'bg-white/[0.08] text-white' : 'text-[#d0d0d0] hover:bg-white/[0.05]'
                  }`}
                  onClick={() => {
                    setSortBy(option.value);
                    setSortMenuOpen(false);
                  }}
                >
                  <i className="fas fa-sort h-4 w-4 shrink-0 text-center"></i>
                  <span>{option.label}</span>
                </button>
              ))}
            </div>,
            document.body
          )
        : null}
    </>
  );
}

export function PersonPage() {
  const { id } = useParams();
  const location = useLocation();
  const queryClient = useQueryClient();

  const [credits, setCredits] = useState([]);
  const [bioExpanded, setBioExpanded] = useState(false);
  const [contentType, setContentType] = useSessionState(`person-page:${location.pathname}:contentType`, 'all');
  const [sortBy, setSortBy] = useSessionState(`person-page:${location.pathname}:sortBy`, 'year-desc');
  const [quickFilter, setQuickFilter] = useSessionState(`person-page:${location.pathname}:quickFilter`, 'all');
  const [collectionFilter, setCollectionFilter] = useSessionState(`person-page:${location.pathname}:collectionFilter`, '');
  const [userCollections, setUserCollections] = useState([]);
  const [creditsLoading, setCreditsLoading] = useState(true);
  const [creditsError, setCreditsError] = useState('');
  const [retryTick, setRetryTick] = useState(0);
  const [failedAttempts, setFailedAttempts] = useState(0);

  const { data: person, isLoading: isPersonLoading, error: personError } = useQuery({
    queryKey: ['person', id],
    queryFn: () => apiFetch(`/api/person/${id}`)
  });

  const { data: favoritePeoplePayload } = useQuery({
    queryKey: ['favorites'],
    queryFn: () => apiFetch('/api/user/favorites'),
    enabled: !!getToken()
  });
  const favoritePeople = Array.isArray(favoritePeoplePayload?.favorites) ? favoritePeoplePayload.favorites : [];

  const addFavoriteMutation = useMutation({
    mutationFn: (data) => apiFetch('/api/user/favorites/add', {
      method: 'POST',
      body: JSON.stringify(data)
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['favorites'] });
      toast('Added to favorites');
    },
    onError: (err) => {
      if (err.status === 409) {
        toast('Already in favorites', 'info');
      } else {
        toast(err.message, 'error');
      }
    }
  });

  const removeFavoriteMutation = useMutation({
    mutationFn: (personId) => apiFetch('/api/user/favorites/remove', {
      method: 'POST',
      body: JSON.stringify({ id: personId })
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['favorites'] });
      toast('Removed from favorites');
    },
    onError: (err) => {
      toast(err.message, 'error');
    }
  });

  const { collections: liveCollections, loading: collectionsLoading } = useLiveCollections();
  const availableCollections = useMemo(
    () => normalizeCollections(liveCollections.length ? liveCollections : userCollections),
    [liveCollections, userCollections]
  );
  const collectionsSyncing = !!getToken() && (collectionsLoading || availableCollections.length < 2);
  const watchedCollection = useMemo(
    () => availableCollections.find((collection) => collection.name === 'Watched') || null,
    [availableCollections]
  );
  const watchlistCollection = useMemo(
    () => availableCollections.find((collection) => collection.name === 'Watchlist') || null,
    [availableCollections]
  );
  const watchedCredits = useMemo(
    () => filterCreditsByCollectionItems(credits, watchedCollection, '[Soulstash][React][PersonPage][Watched]', !collectionsSyncing),
    [collectionsSyncing, credits, watchedCollection]
  );
  const watchlistCredits = useMemo(
    () => filterCreditsByCollectionItems(credits, watchlistCollection),
    [credits, watchlistCollection]
  );
  const customCollectionCreditMap = useMemo(() => {
    const map = new Map();
    availableCollections
      .filter((collection) => !['Watched', 'Watchlist'].includes(collection.name))
      .forEach((collection) => {
        map.set(collection.name, filterCreditsByCollectionItems(credits, collection));
      });
    return map;
  }, [availableCollections, credits]);

  useEffect(() => {
    let ignore = false;
    let retryTimeout = null;
    const controller = new AbortController();

    async function load() {
      setCreditsLoading(true);
      setCreditsError('');
      try {
        let creditsResolved = false;
        await streamApiFetch(`/api/person/${id}/credits`, {
          method: 'GET',
          signal: controller.signal,
          cache: 'no-store',
          onEvent(event) {
            if (ignore) return;
            if (event?.type === 'credits') {
              const rawCredits = [...(event.cast || []), ...(event.crew || [])]
                .filter((item) => item.media_type === 'movie' || item.media_type === 'tv');
              const uniqueCredits = [];
              const seenCredits = new Set();

              for (const item of rawCredits) {
                const key = `${item.media_type}:${item.id}`;
                if (seenCredits.has(key)) continue;
                seenCredits.add(key);
                uniqueCredits.push(item);
              }

              setCredits(uniqueCredits);
              setUserCollections(normalizeCollections(getCachedUserCollections()));
              setCreditsLoading(false);
              creditsResolved = true;
            } else if (event?.type === 'ratings' && Array.isArray(event.items)) {
              setCredits((current) => mergeImdbRatings(current, event.items));
            }
          }
        });

        if (!ignore && !creditsResolved) setCreditsLoading(false);
      } catch (error) {
        if (!ignore) {
          setFailedAttempts((current) => {
            const next = current + 1;
            if (next >= AUTO_RECOVERY_RETRIES) {
              setCreditsError(error.message || 'Unable to load this person right now.');
            } else {
              retryTimeout = window.setTimeout(() => {
                if (!ignore) setRetryTick((currentTick) => currentTick + 1);
              }, 2500);
            }
            return next;
          });
          setCreditsLoading(false);
        }
      }
    }

    if (id) {
      load();
    }
    return () => {
      ignore = true;
      controller.abort();
      if (retryTimeout) window.clearTimeout(retryTimeout);
    };
  }, [id, retryTick]);



  useEffect(() => {
    setBioExpanded(false);
  }, [id]);



  useEffect(() => {
    if (!getToken()) return;
    if (liveCollections.length) {
      setUserCollections(normalizeCollections(liveCollections));
      return;
    }
    let ignore = false;
    loadUserCollections()
      .then((collections) => {
        if (!ignore) {
          setUserCollections(normalizeCollections(collections || []));
        }
      })
      .catch(() => {});

    return () => {
      ignore = true;
    };
  }, [liveCollections]);



  const filteredCredits = useMemo(() => {
    let list = [...credits];
    const seenKeys = new Set();
    list = list.filter((item) => {
      const key = creditItemKey(item);
      if (seenKeys.has(key)) return false;
      seenKeys.add(key);
      return true;
    });

    if (contentType === 'movies') {
      list = list.filter((item) => mediaTypeFromItem(item) === 'Movie');
    } else if (contentType === 'series') {
      list = list.filter((item) => mediaTypeFromItem(item) === 'Series');
    }

    if (quickFilter === 'watched') {
      list = [...watchedCredits];
    } else if (quickFilter === 'watchlist') {
      list = [...watchlistCredits];
    }

    if (contentType === 'movies') {
      list = list.filter((item) => mediaTypeFromItem(item) === 'Movie');
    } else if (contentType === 'series') {
      list = list.filter((item) => mediaTypeFromItem(item) === 'Series');
    }

    if (collectionFilter) {
      const selectedCollectionCredits = customCollectionCreditMap.get(collectionFilter) || [];
      const selectedKeys = new Set(selectedCollectionCredits.map(creditItemKey));
      list = list.filter((item) => selectedKeys.has(creditItemKey(item)));
    }

    list.sort((a, b) => {
      if (sortBy === 'rating-desc') return compareRatingsForSort(a, b, 'desc');
      if (sortBy === 'rating-asc') return compareRatingsForSort(a, b, 'asc');
      if (sortBy === 'year-asc') return (Number(yearFrom(a)) || 0) - (Number(yearFrom(b)) || 0);
      return (Number(yearFrom(b)) || 0) - (Number(yearFrom(a)) || 0);
    });

    return list;
  }, [collectionFilter, contentType, credits, customCollectionCreditMap, quickFilter, sortBy, watchedCredits, watchlistCredits]);

  const visibleCredits = filteredCredits;
  const visibleCreditsRenderKey = useMemo(
    () => `${id}:${quickFilter}:${collectionFilter || 'all-collections'}:${sortBy}:${visibleCredits.map((item) => `${item.media_type || ''}-${item.id}`).join('|')}`,
    [collectionFilter, id, quickFilter, sortBy, visibleCredits]
  );
  const watchedCreditKeySet = useMemo(() => new Set(watchedCredits.map(creditItemKey)), [watchedCredits]);
  const watchlistCreditKeySet = useMemo(() => new Set(watchlistCredits.map(creditItemKey)), [watchlistCredits]);
  const watchedCreditsCount = watchedCredits.length;
  const totalTrackedCredits = credits.length;
  const showPersonResultsCount = hasActivePersonFilters({ contentType, quickFilter, collectionFilter, sortBy });
  const isFavoritePerson = useMemo(
    () => favoritePeople.some((fav) => String(fav.id) === String(person?.id)),
    [favoritePeople, person?.id]
  );
  const otherCollectionOptions = useMemo(
    () =>
      availableCollections
        .filter((collection) => !['Watched', 'Watchlist'].includes(collection.name))
        .map((collection) => ({
          value: collection.name,
          label: collection.name
        })),
    [availableCollections]
  );

  useEffect(() => {
    if (quickFilter !== 'watched') return;
    console.log('[Soulstash][React][PersonPage][RenderedWatched]', {
      personId: id,
      quickFilter,
      collectionFilter,
      visibleCreditsCount: visibleCredits.length,
      visibleCredits: visibleCredits.map((item) => ({
        id: contentIdFromItem(item),
        mediaType: mediaTypeFromItem(item),
        title: item?.title || item?.name || 'Unknown'
      }))
    });
  }, [collectionFilter, id, quickFilter, visibleCredits]);

  if (isPersonLoading) {
    return <PersonPageSkeleton />;
  }

  if (!person) {
    return <PersonPageSkeleton />;
  }

  return (
    <div className="space-y-10">
      <PersonProfileHero
        person={person}
        bioExpanded={bioExpanded}
        onToggleBiography={() => setBioExpanded((current) => !current)}
        isFavorite={isFavoritePerson}
        onAddFavorite={addFavoriteMutation.mutate}
        onRemoveFavorite={removeFavoriteMutation.mutate}
      />

      <section className="content-section">
        <div className="mb-5 flex items-center justify-between gap-4">
          <SectionHeader title="Known For" />
          <div className="flex-shrink-0 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-sm text-[#d8d8d8]">
            Watched {watchedCreditsCount}/{totalTrackedCredits || 0}
          </div>
        </div>
        {credits.length ? (
          <>
            <div className="mb-5 overflow-x-auto filter-scrollbar-hidden">
              <PersonCreditsFilterControls
                contentType={contentType}
                setContentType={setContentType}
                quickFilter={quickFilter}
                setQuickFilter={setQuickFilter}
                collectionFilter={collectionFilter}
                setCollectionFilter={setCollectionFilter}
                sortBy={sortBy}
                setSortBy={setSortBy}
                collectionOptions={[{ value: '', label: 'All' }, ...otherCollectionOptions]}
                resetKey={id}
                collectionsLoading={collectionsSyncing}
              />
            </div>
            {showPersonResultsCount ? (
              <div className="-mt-2 mb-4 text-[11px] font-medium uppercase tracking-[0.14em] text-[#8f8f8f]">
                {visibleCredits.length} results
              </div>
            ) : null}

            {visibleCredits.length ? (
            <div key={visibleCreditsRenderKey} className="credit-grid grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            {visibleCredits.map((item) => (
              <ContentCard
                key={`${quickFilter}-${collectionFilter || 'all'}-${sortBy}-${item.id}-${item.media_type}`}
                item={normalizeCredit(item)}
                status={{
                  watched: watchedCreditKeySet.has(creditItemKey(item)),
                  watchlist: watchlistCreditKeySet.has(creditItemKey(item))
                }}
              />
            ))}
            </div>
            ) : (
              <div className="min-h-[220px]"></div>
            )}
          </>
        ) : (
          <div className="empty-state">No credits available.</div>
        )}
      </section>
    </div>
  );
}
