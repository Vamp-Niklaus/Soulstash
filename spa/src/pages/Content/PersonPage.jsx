import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useParams, useLocation, NavLink, Link } from 'react-router-dom';
import { cachedApiFetch, apiFetch, streamApiFetch, getToken, getCurrentUsername } from '../../api/client.js';
import { formatRuntime, getLanguageName, imageUrl, normalizeStoredCollectionItem, yearFrom, getPreferredRating, creditItemKey, creditMatchesCollectionItem, filterCreditsByCollectionItems, isContentInCollection, mediaRoute, getDirectorLabel, getDirectorPeople, contentIdFromItem, mediaTypeFromItem, compareRatingsForSort, hasActivePersonFilters } from '../../utils/formatters.js';
import { broadcastCollections, loadUserCollections, normalizeCollections, getCollectionStatus, getCachedUserCollections, refreshCollectionsView, normalizeCredit, mergeImdbRatings } from '../../utils/helpers.js';

import { useAuthSession, useLiveCollections, useSessionState, useDropdownKeyNav } from '../../hooks/index.js';
import { FALLBACK_AVATAR, FALLBACK_POSTER, CREDIT_PAGE_SIZE, AUTO_RECOVERY_RETRIES } from '../../utils/constants.js';

import { toast } from '../../utils/toast.js';
import { SectionHeader } from '../../components/ui/SectionHeader.jsx';
import { PersonPageSkeleton, CastRowSkeleton, DetailPageSkeleton } from '../../components/ui/Skeletons/index.js';
import { ContentCard } from '../../components/ui/Cards/ContentCard.jsx';
import { AnimeFilterIcon } from '../../components/ui/Misc/AnimeFilter.jsx';
import { CollectionFilterControls } from '../../components/ui/Misc/CollectionFilterControls.jsx';
import { SaveToCollectionModal } from '../../components/ui/Modals/SaveToCollectionModal.jsx';
import { CreateCollectionModal } from '../../components/ui/Modals/CreateCollectionModal.jsx';

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
  const auth = useAuthSession();
  const [person, setPerson] = useState(null);
  const [credits, setCredits] = useState([]);
  const [bioExpanded, setBioExpanded] = useState(false);
  const [contentType, setContentType] = useSessionState(`person-page:${location.pathname}:contentType`, 'all');
  const [sortBy, setSortBy] = useSessionState(`person-page:${location.pathname}:sortBy`, 'year-desc');
  const [quickFilter, setQuickFilter] = useSessionState(`person-page:${location.pathname}:quickFilter`, 'all');
  const [collectionFilter, setCollectionFilter] = useSessionState(`person-page:${location.pathname}:collectionFilter`, '');
  const [userCollections, setUserCollections] = useState([]);
  const [favoritePeople, setFavoritePeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [retryTick, setRetryTick] = useState(0);
  const [failedAttempts, setFailedAttempts] = useState(0);
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
      setLoading(true);
      setLoadError('');
      try {
        // Fetch person info and stream credits in parallel.
        // The credits stream sends 3 event types:
        //   { type: 'credits', cast, crew }  — raw credits, render the grid immediately
        //   { type: 'ratings', items }        — one batch of 6 resolved ratings, merge in
        //   { type: 'done' }                  — stream finished
        const personPromise = cachedApiFetch(`/api/person/${id}`);

        let creditsResolved = false;
        const creditsPromise = streamApiFetch(`/api/person/${id}/credits`, {
          method: 'GET',
          signal: controller.signal,
          cache: 'no-store',
          onEvent(event) {
            if (ignore) return;
            if (event?.type === 'credits') {
              // First event: raw cast + crew — stop showing skeleton immediately.
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
              setLoading(false);
              creditsResolved = true;
            } else if (event?.type === 'ratings' && Array.isArray(event.items)) {
              // Each batch of 6: paint ratings onto cards as they arrive.
              setCredits((current) => mergeImdbRatings(current, event.items));
            }
          }
        });

        const [personData] = await Promise.all([personPromise, creditsPromise]);

        if (!ignore) {
          setPerson(personData);
          document.title = `${personData.name} | Soulstash`;
          setFailedAttempts(0);
          setLoadError('');
          if (!creditsResolved) setLoading(false);
        }
      } catch (error) {
        if (!ignore) {
          setFailedAttempts((current) => {
            const next = current + 1;
            if (next >= AUTO_RECOVERY_RETRIES) {
              setLoadError(error.message || 'Unable to load this person right now.');
            } else {
              retryTimeout = window.setTimeout(() => {
                if (!ignore) setRetryTick((currentTick) => currentTick + 1);
              }, 2500);
            }
            return next;
          });
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      ignore = true;
      controller.abort();
      if (retryTimeout) window.clearTimeout(retryTimeout);
    };
  }, [auth.user?.admin, auth.user?.showAdult, id, retryTick]);


  useEffect(() => {
    setBioExpanded(false);
  }, [id]);

  useEffect(() => {
    if (!getToken()) {
      setFavoritePeople([]);
      return;
    }
    let ignore = false;
    cachedApiFetch('/api/user/favorites')
      .then((payload) => {
        if (!ignore) {
          setFavoritePeople(Array.isArray(payload?.favorites) ? payload.favorites : []);
        }
      })
      .catch(() => {
        if (!ignore) setFavoritePeople([]);
      });
    return () => {
      ignore = true;
    };
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

  if (loading) {
    return <PersonPageSkeleton />;
  }

  if (!person) {
    return <PersonPageSkeleton />;
  }

  return (
    <div className="space-y-10">
      <section className="rounded-[28px] border border-white/10 bg-[linear-gradient(135deg,rgba(15,15,15,0.98),rgba(10,10,10,0.95))] p-6 md:p-8 lg:p-10 overflow-hidden relative">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,113,86,0.18),transparent_24%),radial-gradient(circle_at_left_center,rgba(143,68,240,0.18),transparent_30%)]"></div>
        <div className="relative z-10 space-y-6">
          <div className="flex items-start gap-4 sm:gap-6 md:gap-8">
            <div className="flex-shrink-0 w-[120px] sm:w-[170px] md:w-[220px] max-w-[42vw]">
              <div className="person-avatar self-start aspect-[2/3] overflow-hidden rounded-[24px] border border-white/10">
                <img
                  src={imageUrl(person.profile_path, 'w500')}
                  alt={person.name}
                  className="w-full h-full object-cover"
                  onError={(event) => {
                    event.currentTarget.src = FALLBACK_AVATAR;
                  }}
                />
              </div>
            </div>

            <div className="min-w-0 flex-1 self-start">
              <div className="flex items-start gap-3">
                <h1 className="text-2xl sm:text-3xl md:text-5xl font-semibold text-white leading-tight text-left">{person.name}</h1>
                <button
                  type="button"
                  className="mt-1 inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-[#cfcfcf] transition-colors hover:text-[#f7c948]"
                  onClick={async () => {
                    if (!getToken()) {
                      toast('Please login first', 'success');
                      return;
                    }
                    try {
                      if (isFavoritePerson) {
                        await apiFetch('/api/user/favorites/remove', {
                          method: 'POST',
                          body: JSON.stringify({ id: person.id })
                        });
                        setFavoritePeople((current) => current.filter((fav) => String(fav.id) !== String(person.id)));
                        toast('Removed from favorites');
                      } else {
                        const response = await apiFetch('/api/user/favorites/add', {
                          method: 'POST',
                          body: JSON.stringify({
                            id: person.id,
                            name: person.name,
                            profile_path: person.profile_path || '',
                            known_for_department: person.known_for_department || ''
                          })
                        });
                        setFavoritePeople((current) => [
                          ...current,
                          response.favorite || {
                            id: person.id,
                            name: person.name,
                            profile_path: person.profile_path || '',
                            known_for_department: person.known_for_department || ''
                          }
                        ]);
                        toast('Added to favorites');
                      }
                    } catch (err) {
                      if (err.status === 409) {
                        toast('Already in favorites', 'info');
                        return;
                      }
                      toast(err.message, 'error');
                    }
                  }}
                  aria-label={isFavoritePerson ? 'Remove from favorites' : 'Add to favorites'}
                >
                  <i className={`${isFavoritePerson ? 'fas' : 'far'} fa-star text-[15px] ${isFavoritePerson ? 'text-[#f7c948]' : ''}`}></i>
                </button>
              </div>
              <div className="mt-4 space-y-2 text-sm md:text-base">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-[#9a9a9a]">Known For</span>
                  <span className="text-[#E2E2E2] font-medium break-words">{person.known_for_department || 'Acting'}</span>
                </div>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-[#9a9a9a]">Birthday</span>
                  <span className="text-[#E2E2E2] font-medium">{person.birthday || 'Unknown'}</span>
                </div>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-[#9a9a9a]">Popularity</span>
                  <span className="text-[#E2E2E2] font-medium">{person.popularity ? person.popularity.toFixed(1) : 'N/A'}</span>
                </div>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-[#9a9a9a]">Place of Birth</span>
                  <span className="text-[#E2E2E2] font-medium break-words">{person.place_of_birth || 'Unknown'}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="max-w-4xl">
            <p className={`text-[#d0d0d0] text-sm md:text-base leading-7 ${bioExpanded ? '' : 'line-clamp-3'}`}>
              {person.biography || 'Biography not available yet.'}
            </p>
            {person.biography ? (
              <button
                type="button"
                className="mt-3 text-sm font-medium text-white/80 transition-colors hover:text-white"
                onClick={() => setBioExpanded((current) => !current)}
              >
                {bioExpanded ? 'Show less' : 'Read more'}
              </button>
            ) : null}
          </div>
        </div>
      </section>

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
