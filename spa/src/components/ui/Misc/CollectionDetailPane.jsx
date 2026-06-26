import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { toast } from '../../../utils/toast.js';
import { FALLBACK_AVATAR, PUBLISH_MIN_COLLECTION_TITLES } from '../../../utils/constants.js';
import {
  collectionItemCount, filteredCollectionMovies, refreshCollectionsView,
  broadcastCollections, getCachedUserCollections, normalizeCollections,
  lastKnownCollectionVersion
} from '../../../utils/helpers.js';
import { contentIdFromItem, mediaTypeFromItem, hasStoredRating, hasActiveCollectionContentFilters, normalizeMediaType } from '../../../utils/formatters.js';
import { useGridKeyNav } from '../../../hooks/index.js';
import { apiFetch } from '../../../api/client.js';
import { CollectionVisibilityBadge } from './CollectionVisibilityBadge.jsx';
import { CollectionFilterControls } from './CollectionFilterControls.jsx';
import { ContentCard } from '../Cards/ContentCard.jsx';
import { ConfirmModal } from '../Modals/ConfirmModal.jsx';

// Re-export normalizeCollection locally since it's used internally
function normalizeCollectionItem(collection) {
  const movies = Array.isArray(collection?.movies) ? collection.movies : [];
  const isPublic = collection?.isPublic === true || collection?.isPublished === true;
  return {
    ...collection,
    _id: collection?._id || collection?.name,
    name: collection?.name || '',
    movies,
    movieCount: movies.length,
    isPublic,
    isPublished: collection?.isPublished === true
  };
}

export function CollectionDetailPane({
  username,
  collection,
  filters,
  setFilters,
  watchedIds,
  onOpenDrawer,
  onRemoveFromCollection,
  onBackToCollections,
  onPublishChange,
  isOwner = true,
  useBannerAsBackdrop = false,
  showPublishControls = false
}) {
  const navigate = useNavigate();
  const movies = useMemo(() => filteredCollectionMovies(collection, filters, watchedIds), [collection, filters, watchedIds]);
  const showFilteredResultsCount = hasActiveCollectionContentFilters(filters);
  const [publishLoading, setPublishLoading] = useState(false);
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [isDesktopFilters, setIsDesktopFilters] = useState(() => window.innerWidth >= 768);
  const [mobileFilterMenuStyle, setMobileFilterMenuStyle] = useState({ top: 0, left: 0 });
  const mobileFilterMenuRef = useRef(null);
  const mobileFilterTriggerRef = useRef(null);
  const attemptedRatingBackfillRef = useRef('');
  const isDefaultCollection = ['Watched', 'Watchlist'].includes(collection?.name);
  const canPublish = isOwner && !isDefaultCollection && (collectionItemCount(collection) >= PUBLISH_MIN_COLLECTION_TITLES);
  const isPublished = collection?.isPublished === true;
  const canShowPublishControls = showPublishControls && !isDefaultCollection && canPublish;
  const isLongCollectionName = (collection?.name || '').length > 20;

  const detailGridRef = useRef(null);
  useGridKeyNav(detailGridRef, 'button[data-card]');

  function buildMobileFilterMenuPosition(trigger) {
    const rect = trigger.getBoundingClientRect();
    const viewportPadding = 16;
    const estimatedWidth = 248;
    return {
      top: Math.round(rect.bottom + 10),
      left: Math.round(Math.min(Math.max(rect.left, viewportPadding), window.innerWidth - estimatedWidth - viewportPadding))
    };
  }

  useEffect(() => {
    function handleResize() {
      setIsDesktopFilters(window.innerWidth >= 768);
      if (mobileFiltersOpen && mobileFilterTriggerRef.current) {
        setMobileFilterMenuStyle(buildMobileFilterMenuPosition(mobileFilterTriggerRef.current));
      }
    }
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [mobileFiltersOpen]);

  useEffect(() => {
    if (!mobileFiltersOpen) return undefined;
    function handlePointerDown(event) {
      const clickedInsideMenu = mobileFilterMenuRef.current?.contains(event.target);
      const clickedTrigger = mobileFilterTriggerRef.current?.contains(event.target);
      if (!clickedInsideMenu && !clickedTrigger) setMobileFiltersOpen(false);
    }
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [mobileFiltersOpen]);


  async function applyPublishChange(nextPublished) {
    try {
      setPublishLoading(true);
      const currentCollections = normalizeCollections(getCachedUserCollections());
      if (currentCollections.length) {
        const optimistic = currentCollections.map((c) =>
          String(c._id || c.name) === String(collection._id || collection.name)
            ? { ...c, isPublished: nextPublished, isPublic: nextPublished ? true : false }
            : c
        );
        broadcastCollections(optimistic);
      }
      const response = await apiFetch(`/api/user/collections/${encodeURIComponent(collection._id)}/publish`, {
        method: 'POST',
        body: JSON.stringify({ publish: nextPublished })
      });
      if (response?.snapshot?.collections) {
        broadcastCollections(normalizeCollections(response.snapshot.collections), response?.snapshot?.collectionVersion);
      } else {
        if (window.CollectionStore?.invalidate) window.CollectionStore.invalidate();
        if (window.CollectionStore?.getCollections) {
          const latest = await window.CollectionStore.getCollections();
          broadcastCollections(normalizeCollections(latest), lastKnownCollectionVersion);
        } else {
          const latest = await refreshCollectionsView();
          broadcastCollections(latest, lastKnownCollectionVersion);
        }
      }
      if (onPublishChange) onPublishChange();
      toast(nextPublished ? 'Collection published' : 'Collection unpublished');
    } catch (error) {
      await refreshCollectionsView();
      toast(error.message, 'error');
    } finally {
      setPublishLoading(false);
    }
  }

  async function togglePublish() {
    if (!isOwner || publishLoading || !collection?._id || isDefaultCollection) return;
    if (!canPublish) {
      toast(`Add at least ${PUBLISH_MIN_COLLECTION_TITLES} titles to publish this collection`, 'info');
      return;
    }
    const nextPublished = !isPublished;
    if (nextPublished && collection.isPublic !== true) {
      setPublishConfirmOpen(true);
      return;
    }
    await applyPublishChange(nextPublished);
  }

  if (!collection?.name) {
    return (
      <div className="w-full text-center text-gray-400 py-8">
        <div className="p-2 lg:pl-4">
          <div className="h-[calc(100vh-300px-120px)] lg:h-[calc(100vh-200px)] flex items-center justify-center">
            <div className="text-center p-4">
              <i className="fas fa-eye-slash w-12 h-12 lg:w-16 lg:h-16 text-gray-700 mx-auto mb-4 text-5xl"></i>
              <p className="text-gray-400 mb-2">Select a collection from the sidebar</p>
              <p className="text-gray-600 text-sm">or open Watched or Watchlist to browse saved titles</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative isolate">
      {useBannerAsBackdrop ? (
        <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none" style={{ height: '100svh' }}>
          <img
            alt="collection backdrop"
            className="h-full w-full object-cover object-center opacity-30 scale-[1.03]"
            src={collection.banner || FALLBACK_AVATAR}
            onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = FALLBACK_AVATAR; }}
          />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(7,7,7,0.18)_0%,rgba(7,7,7,0.36)_18%,rgba(7,7,7,0.62)_42%,rgba(7,7,7,0.84)_72%,rgba(7,7,7,0.97)_100%)]"></div>
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_center,rgba(255,255,255,0.08),transparent_22%)]"></div>
        </div>
      ) : null}

      {useBannerAsBackdrop ? (
        <>
          <div className="fixed left-1/2 collection-detail-header-fixed z-[220] w-[min(100vw-20px,1480px)] -translate-x-1/2 sm:w-[min(100vw-32px,1480px)]">
            <div className="rounded-[24px] border border-white/[0.05] bg-[rgba(16,16,16,0.74)] px-4 py-3 sm:px-5 sm:py-4 shadow-[0_16px_42px_rgba(0,0,0,0.24)] backdrop-blur-[14px]">
              <div className="hidden lg:flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0 shrink">
                  <h1 className="text-[clamp(1.1rem,1.4vw,1.6rem)] font-semibold text-white truncate leading-tight">{collection.name}</h1>
                  <CollectionVisibilityBadge collection={collection} />
                  <span className="flex-shrink-0 rounded-full bg-black/25 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-[#ffd2a8]">
                    {collection.movieCount || 0} saved
                  </span>
                </div>
                <div className="flex items-center gap-2 justify-end min-w-0">
                  {showFilteredResultsCount ? (
                    <span className="flex-shrink-0 text-[11px] font-medium uppercase tracking-[0.14em] text-[#8f8f8f]">
                      {movies.length} results
                    </span>
                  ) : null}
                  <CollectionFilterControls filters={filters} setFilters={setFilters} noWrap size="desktop" />
                  {isOwner ? (
                    <button type="button"
                      className="flex-shrink-0 flex h-9 items-center justify-center gap-2 rounded-[16px] bg-[#2a2a2a] px-4 text-[13px] font-medium text-white transition-colors hover:bg-[#343434] focus:outline-none focus:ring-2 focus:ring-white"
                      onClick={onOpenDrawer} aria-label="Add content to collection">
                      <i className="fas fa-plus"></i><span>Add Content</span>
                    </button>
                  ) : (
                    <button type="button"
                      className="flex-shrink-0 flex h-9 items-center justify-center gap-2 rounded-[16px] bg-white/[0.1] px-4 text-[13px] font-medium text-white transition-colors hover:bg-white/[0.16] focus:outline-none focus:ring-2 focus:ring-white"
                      onClick={() => navigate(`/user/${username}`)}>
                      <i className="fas fa-user"></i><span>View Profile</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="relative z-[400] flex items-center justify-between gap-3 lg:hidden">
                <div ref={mobileFilterMenuRef} className="relative z-[410] min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <button ref={mobileFilterTriggerRef} type="button"
                      className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[14px] bg-white/[0.1] text-white transition-colors hover:bg-white/[0.16] focus:outline-none focus:ring-2 focus:ring-white"
                      onClick={(event) => {
                        setMobileFilterMenuStyle(buildMobileFilterMenuPosition(event.currentTarget));
                        setMobileFiltersOpen((current) => !current);
                      }} aria-label="Open filters">
                      <i className="fas fa-bars text-sm"></i>
                    </button>
                    <div className="flex min-w-0 items-center gap-2">
                      <h1 className="text-xl font-semibold text-white truncate">{collection.name}</h1>
                      <CollectionVisibilityBadge collection={collection} iconOnly={isLongCollectionName} />
                    </div>
                  </div>
                  {showFilteredResultsCount ? (
                    <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.14em] text-[#8f8f8f]">{movies.length} results</p>
                  ) : null}
                  {mobileFiltersOpen ? createPortal(
                    <div ref={mobileFilterMenuRef}
                      className="filter-scrollbar-hidden overflow-visible rounded-[24px] border border-white/10 bg-[rgba(20,20,20,0.96)] p-3 shadow-[0_24px_60px_rgba(0,0,0,0.5)] backdrop-blur-[18px]"
                      style={{ position: 'fixed', zIndex: 2147483646, top: mobileFilterMenuStyle.top, left: mobileFilterMenuStyle.left, width: 'max-content', maxWidth: 'calc(100vw - 32px)' }}>
                      <CollectionFilterControls filters={filters} setFilters={setFilters} stacked size="desktop" />
                    </div>, document.body
                  ) : null}
                </div>
                {isOwner ? (
                  <div className="flex items-center gap-2">
                    {canShowPublishControls ? (
                      <button type="button"
                        className="flex h-10 items-center justify-center gap-2 rounded-[14px] px-3 text-sm font-medium transition-colors bg-[#2a2a2a] text-white hover:bg-[#343434] focus:outline-none focus:ring-2 focus:ring-white"
                        onClick={togglePublish}>
                        <i className={`fas ${isPublished ? 'fa-star' : 'fa-bullhorn'}`}></i>
                        <span>{isPublished ? 'Unpublish' : 'Publish'}</span>
                      </button>
                    ) : null}
                    <button type="button"
                      className={`flex h-10 flex-shrink-0 items-center justify-center gap-2 rounded-[14px] bg-white/[0.1] text-sm font-medium text-white transition-colors hover:bg-white/[0.16] focus:outline-none focus:ring-2 focus:ring-white ${isLongCollectionName ? 'w-10' : 'px-3'}`}
                      onClick={onOpenDrawer} aria-label="Add content to collection">
                      <i className="fas fa-plus"></i>
                      {isLongCollectionName ? null : <span>Add</span>}
                    </button>
                  </div>
                ) : (
                  <button type="button"
                    className="flex h-10 flex-shrink-0 items-center justify-center gap-2 rounded-[14px] bg-white/[0.1] px-3 text-sm font-medium text-white transition-colors hover:bg-white/[0.16] focus:outline-none focus:ring-2 focus:ring-white"
                    onClick={() => navigate(`/user/${username}`)}>
                    <i className="fas fa-user"></i><span>Profile</span>
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="collection-detail-header-spacer"></div>
        </>
      ) : (
        <div className="w-full aspect-[21/9] min-h-[200px] md:min-h-[156px] rounded-[26px] mb-0 relative overflow-hidden shadow-[0_18px_40px_rgba(0,0,0,0.24)]">
          <img alt="collection banner" className="absolute inset-0 h-full w-full object-cover"
            src={collection.banner || FALLBACK_AVATAR}
            onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = FALLBACK_AVATAR; }} />
          <div className="absolute inset-0" aria-hidden="true" style={{ background: 'linear-gradient(180deg, rgba(8,8,8,0.02) 0%, rgba(8,8,8,0.12) 30%, rgba(8,8,8,0.42) 62%, rgba(8,8,8,0.78) 84%, rgba(8,8,8,0.96) 100%)' }}></div>
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.08),transparent_28%),radial-gradient(circle_at_left_center,rgba(150,123,255,0.08),transparent_30%)]"></div>

          <button type="button"
            className={`absolute top-4 left-4 bg-black/70 p-2.5 rounded-full hover:bg-black/90 transition-colors z-10 focus:outline-none focus:ring-2 focus:ring-white ${!onBackToCollections && !useBannerAsBackdrop ? 'lg:hidden flex' : 'flex'}`}
            onClick={() => { if (onBackToCollections) { onBackToCollections(); return; } navigate(`/user/${username}/collections`); }}
            aria-label="Back to collections">
            <i className="fas fa-arrow-left text-white"></i>
          </button>

          <div className="absolute bottom-4 left-4 z-10 md:hidden pr-[140px]">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-semibold text-white break-words leading-tight">{collection.name}</h1>
              <CollectionVisibilityBadge collection={collection} iconOnly={isLongCollectionName} />
              <span className="rounded-full bg-black/25 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-[#ffd2a8]">{collection.movieCount || 0} saved</span>
            </div>
          </div>
          <div className="absolute top-4 right-4 z-20 md:hidden">
            {isOwner ? (
              <div className="flex items-center gap-2">
                {canShowPublishControls ? (
                  <button type="button"
                    className="flex items-center gap-1.5 text-xs h-9 px-3 rounded-2xl transition-colors bg-[#2a2a2a] text-white hover:bg-[#343434] focus:outline-none focus:ring-2 focus:ring-white"
                    onClick={togglePublish}>
                    <i className={`fas ${isPublished ? 'fa-star' : 'fa-bullhorn'}`}></i>
                    <span>{isPublished ? 'Unpublish' : 'Publish'}</span>
                  </button>
                ) : null}
                <button type="button"
                  className={`flex items-center justify-center gap-1.5 bg-[#2a2a2a] hover:bg-[#343434] text-white transition-colors text-xs h-9 focus:outline-none focus:ring-2 focus:ring-white ${isLongCollectionName ? 'w-9 rounded-full' : 'px-3 rounded-2xl'}`}
                  onClick={onOpenDrawer} aria-label="Add content to collection">
                  <i className="fas fa-plus"></i>
                  {isLongCollectionName ? null : <span>Add</span>}
                </button>
              </div>
            ) : (
              <button type="button"
                className="flex items-center gap-1.5 bg-white/[0.12] hover:bg-white/[0.18] text-white transition-colors text-xs h-9 px-3 rounded-2xl focus:outline-none focus:ring-2 focus:ring-white"
                onClick={() => navigate(`/user/${username}`)}>
                <i className="fas fa-user"></i><span>Profile</span>
              </button>
            )}
          </div>

          <div className="absolute bottom-0 left-0 right-0 z-10 hidden md:flex items-center justify-between gap-3 px-5 py-3.5"
            style={{ background: 'linear-gradient(to top, rgba(8,8,8,0.95) 0%, rgba(8,8,8,0.78) 34%, rgba(8,8,8,0.44) 70%, transparent 100%)' }}>
            <div className="flex items-center gap-2 min-w-0 shrink">
              <h1 className="text-[clamp(1.1rem,1.4vw,1.6rem)] font-semibold text-white truncate leading-tight">{collection.name}</h1>
              <CollectionVisibilityBadge collection={collection} />
              <span className="flex-shrink-0 rounded-full bg-black/30 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-[#ffd2a8]">{collection.movieCount || 0} saved</span>
            </div>
            {isOwner ? (
              <div className="flex items-center gap-2">
                {canShowPublishControls ? (
                  <button type="button"
                    className="flex h-9 items-center justify-center gap-2 rounded-[16px] px-4 text-[13px] font-medium transition-colors bg-[#2a2a2a] text-white hover:bg-[#343434] focus:outline-none focus:ring-2 focus:ring-white"
                    onClick={togglePublish}>
                    <i className={`fas ${isPublished ? 'fa-star' : 'fa-bullhorn'}`}></i>
                    <span>{isPublished ? 'Unpublish' : 'Publish'}</span>
                  </button>
                ) : null}
                <button type="button"
                  className="flex-shrink-0 flex h-9 items-center justify-center gap-2 rounded-[16px] bg-[#2a2a2a] hover:bg-[#343434] px-4 text-[13px] font-medium text-white transition-colors focus:outline-none focus:ring-2 focus:ring-white"
                  onClick={onOpenDrawer} aria-label="Add content to collection">
                  <i className="fas fa-plus"></i><span>Add Content</span>
                </button>
              </div>
            ) : (
              <button type="button"
                className="flex-shrink-0 flex h-9 items-center justify-center gap-2 rounded-[16px] bg-white/[0.14] hover:bg-white/[0.22] px-4 text-[13px] font-medium text-white transition-colors focus:outline-none focus:ring-2 focus:ring-white"
                onClick={() => navigate(`/user/${username}`)}>
                <i className="fas fa-user"></i><span>View Profile</span>
              </button>
            )}
          </div>
        </div>
      )}

      <div className={`flex flex-col gap-4 w-full ${useBannerAsBackdrop ? 'mt-2 lg:mt-3' : 'mt-5 lg:mt-6'}`}>
        {!useBannerAsBackdrop ? (
          isDesktopFilters ? (
            <div className="rounded-[22px] border border-white/[0.05] bg-[rgba(16,16,16,0.74)] p-3 shadow-[0_16px_42px_rgba(0,0,0,0.24)] backdrop-blur-[14px] relative z-[120] overflow-x-auto overflow-y-visible filter-scrollbar-hidden">
              <CollectionFilterControls filters={filters} setFilters={setFilters} noWrap size="desktop" />
            </div>
          ) : (
            <div className="rounded-[22px] border border-white/[0.05] bg-[rgba(16,16,16,0.74)] p-3 shadow-[0_16px_42px_rgba(0,0,0,0.24)] backdrop-blur-[14px]">
              <CollectionFilterControls filters={filters} setFilters={setFilters} />
            </div>
          )
        ) : null}

        {movies.length ? (
          <div ref={detailGridRef} className="relative z-0 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-2 sm:gap-3 lg:gap-4">
            {movies.map((movie) => (
              <ContentCard
                key={Number(movie.movieId || movie.seriesId || movie.id || movie._id || 0)}
                item={movie}
                onRemove={isOwner ? onRemoveFromCollection : null}
                itemId={Number(movie.movieId || movie.seriesId || movie.id || movie._id || 0)}
                data-card
              />
            ))}
          </div>
        ) : (
          <div className="flex w-full items-center justify-center py-8 text-center text-gray-400">
            <div className="flex w-full items-center justify-center p-2 lg:pl-4">
              <div className="flex h-[calc((100vh-300px-120px)*0.8)] w-full items-center justify-center lg:h-[calc((100vh-200px)*0.8)]">
                <div className="text-center p-4">
                  <i className="fas fa-eye-slash w-12 h-12 lg:w-16 lg:h-16 text-gray-500 mx-auto mb-4 text-5xl"></i>
                  <p className="text-gray-200 mb-2">
                    {collection.movieCount ? 'No titles match the current filters.' : 'This collection is empty.'}
                  </p>
                  {isOwner ? (
                    <p className="text-gray-400 text-sm">Add content or change filters to see titles here.</p>
                  ) : (
                    <button type="button"
                      className="mt-2 inline-flex h-9 items-center justify-center gap-2 rounded-full bg-white/10 px-4 text-sm font-medium text-white transition-colors hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white"
                      onClick={() => navigate(`/user/${username}`)}>
                      <i className="fas fa-user"></i><span>View {username}'s profile</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <ConfirmModal
        open={publishConfirmOpen}
        title="Publish this collection?"
        message={`"${collection.name}" is private. Publishing will make it public first, then publish it for discovery.`}
        confirmLabel="Make Public & Publish"
        onConfirm={async () => {
          setPublishConfirmOpen(false);
          await applyPublishChange(true);
        }}
        onClose={() => setPublishConfirmOpen(false)}
      />
    </div>
  );
}
