import { useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useLiveCollections, useSessionState } from '../../hooks/index.js';
import { COLLECTION_NAME_MAX_LENGTH, FALLBACK_AVATAR } from '../../utils/constants.js';
import { broadcastCollections, confirmTrashItem, createEmptyCollectionDraft, lastKnownCollectionVersion, normalizeCollection, normalizeCollections, optimisticRemoveCollectionFromCache, refreshCollectionsView, restoreTrashItem, trashItemFromCollectionCache, updateCollectionsCache, getCachedUserCollections, optimisticUpdateCollectionItems } from '../../utils/helpers.js';
import { hasStoredRating } from '../../utils/formatters.js';
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuthSession } from '../../hooks/index.js';
import { apiFetch } from '../../api/client.js';
import { toast } from '../../utils/toast.js';
import { ContentCardSkeleton, GridSkeleton } from '../../components/ui/Skeletons/index.js';
import { CollectionPosterCard } from '../../components/ui/Cards/CollectionPosterCard.jsx';
import { ContentCard } from '../../components/ui/Cards/ContentCard.jsx';

import { SectionHeader } from '../../components/ui/SectionHeader.jsx';
import { ActionButton } from '../../components/ui/ActionButton.jsx';
import { ConfirmModal } from '../../components/ui/Modals/ConfirmModal.jsx';
import { CollectionFormModal } from '../../components/ui/Modals/CollectionFormModal.jsx';

import { CollectionDetailPane } from '../../components/ui/Misc/CollectionDetailPane.jsx';
import { CollectionVisibilityBadge } from '../../components/ui/Misc/CollectionVisibilityBadge.jsx';
import { CollectionSearchDrawer } from '../../components/ui/Misc/index.js';
import { MarqueeText } from '../../components/ui/Misc/Typography.jsx';
import { EditCollectionModal } from '../../components/ui/Modals/EditCollectionModal.jsx';
import { CreateCollectionModal } from '../../components/ui/Modals/CreateCollectionModal.jsx';



export function UserCollectionsPage() {
  const { username = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { collections, loading } = useLiveCollections();
  const [isCompactCollectionsView, setIsCompactCollectionsView] = useState(() => window.innerWidth < 1024);
  const [mobileSidebarVisible, setMobileSidebarVisible] = useState(() => window.innerWidth < 1024);
  const stateKeyBase = `collections-page:${location.pathname}`;
  const [query, setQuery] = useSessionState(`${stateKeyBase}:query`, '');
  const [visibilityFilter, setVisibilityFilter] = useSessionState(`${stateKeyBase}:visibility`, 'all');
  const [selectedCollectionName, setSelectedCollectionName] = useSessionState(`${stateKeyBase}:selected`, '');
  const [localCollectionOrder, setLocalCollectionOrder] = useState([]);
  const [filters, setFilters] = useSessionState(`${stateKeyBase}:filters`, { contentType: 'all', anime: 'all', sortBy: 'recent', hideWatched: false });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState(createEmptyCollectionDraft);
  const [createLoading, setCreateLoading] = useState(false);
  const [editDraft, setEditDraft] = useState(createEmptyCollectionDraft);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editTargetId, setEditTargetId] = useState('');
  const [removeTarget, setRemoveTarget] = useState(null);
  const [collectionDeleteTarget, setCollectionDeleteTarget] = useState(null);
  const [draggedCollectionId, setDraggedCollectionId] = useState('');
  const [dragOverCollectionId, setDragOverCollectionId] = useState('');
  const collectionMenuTriggerRefs = useRef(new Map());
  const [pendingItems, setPendingItems] = useState(new Set());


  const sidebarListRef = useRef(null);

  useEffect(() => {
    const list = sidebarListRef.current;
    if (!list) return;

    const handleKeyDown = (event) => {
      const items = Array.from(list.querySelectorAll('[tabindex="0"]'));
      const currentIndex = items.indexOf(document.activeElement);
      if (currentIndex === -1) return;

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        const next = items[currentIndex + 1];
        if (next) {
          next.focus();
          next.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (currentIndex === 0) {
          // Jump back up to search input
          document.querySelector('input[placeholder="Search Collections"]')?.focus();
        } else {
          const prev = items[currentIndex - 1];
          if (prev) {
            prev.focus();
            prev.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
        }
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        // Focus the navigate arrow button inside this item
        const row = items[currentIndex];
        row?.querySelector('button[aria-label^="Open"]')?.focus();
      }
    };

    list.addEventListener('keydown', handleKeyDown);
    return () => list.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (!isCompactCollectionsView) return undefined;

    function handlePopState(event) {
      if (!selectedCollectionName || mobileSidebarVisible) return;
      if (event.state?.soulstashCollectionsMobileDetail) {
        return;
      }
      setMobileSidebarVisible(true);
    }

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isCompactCollectionsView, mobileSidebarVisible, selectedCollectionName]);
  const [openCollectionMenuId, setOpenCollectionMenuId] = useState('');
  const [collectionMenuPosition, setCollectionMenuPosition] = useState({ top: 0, left: 0 });

  function getCollectionMenuPosition(triggerRect, estimatedWidth = 168, estimatedHeight = 116) {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const left = Math.min(Math.max(16, triggerRect.left), Math.max(16, viewportWidth - estimatedWidth - 16));
    const belowTop = triggerRect.bottom + 8;
    const aboveTop = triggerRect.top - estimatedHeight - 8;
    const top =
      belowTop + estimatedHeight <= viewportHeight - 16 || aboveTop < 16
        ? Math.min(belowTop, Math.max(16, viewportHeight - estimatedHeight - 16))
        : aboveTop;
    return { top, left };
  }

  useEffect(() => {
    if (!openCollectionMenuId) return undefined;

    function updateMenuPosition() {
      const trigger = collectionMenuTriggerRefs.current.get(openCollectionMenuId);
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      setCollectionMenuPosition(getCollectionMenuPosition(rect));
    }

    updateMenuPosition();
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    return () => {
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [openCollectionMenuId]);

  useEffect(() => {
    document.title = 'My Collections';
  }, []);

  useEffect(() => {
    function handleResize() {
      const compact = window.innerWidth < 1024;
      setIsCompactCollectionsView(compact);
      setMobileSidebarVisible((current) => {
        if (!compact) return true;
        return selectedCollectionName ? current : true;
      });
    }

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [selectedCollectionName]);

  useEffect(() => {
    console.log('[Soulstash][React] UserCollectionsPage mounted', {
      route: window.location.pathname,
      username,
      collectionsCount: collections.length,
      loading
    });
  }, [username, collections.length, loading]);

  useEffect(() => {
    const collectionIds = collections.map((collection) => String(collection._id || collection.name));
    setLocalCollectionOrder((current) => {
      const currentSet = new Set(current);
      const next = current.filter((id) => collectionIds.includes(id));
      collectionIds.forEach((id) => {
        if (!currentSet.has(id)) {
          next.push(id);
        }
      });
      return next.length ? next : collectionIds;
    });
  }, [collections]);





  const orderedCollections = useMemo(() => {
    if (!localCollectionOrder.length) return collections;
    const byId = new Map(collections.map((collection) => [String(collection._id || collection.name), collection]));
    const ordered = [];
    localCollectionOrder.forEach((id) => {
      const collection = byId.get(id);
      if (collection) {
        ordered.push(collection);
        byId.delete(id);
      }
    });
    return [...ordered, ...byId.values()];
  }, [collections, localCollectionOrder]);

  const filteredCollections = useMemo(() => {
    return orderedCollections.filter((collection) => {
      const matchesQuery = !query.trim() || collection.name.toLowerCase().includes(query.trim().toLowerCase());
      const matchesVisibility =
        visibilityFilter === 'all' ||
        (visibilityFilter === 'public' && collection.isPublic) ||
        (visibilityFilter === 'private' && !collection.isPublic);
      return matchesQuery && matchesVisibility;
    });
  }, [orderedCollections, query, visibilityFilter]);
  const showCollectionsResultsCount = !!query.trim() || visibilityFilter !== 'all';

  const watchedCollection = useMemo(() => collections.find((item) => item.name === 'Watched'), [collections]);
  const watchedIds = useMemo(
    () => new Set((watchedCollection?.movies || []).map((movie) => Number(movie.movieId || movie.seriesId || movie.id || movie._id || 0))),
    [watchedCollection]
  );
  const selectedCollection = useMemo(
    () => normalizeCollection(filteredCollections.find((item) => item.name === selectedCollectionName) || collections.find((item) => item.name === selectedCollectionName)),
    [collections, filteredCollections, selectedCollectionName]
  );

  useEffect(() => {
    if (!selectedCollectionName) return;
    const existsInAll = collections.some((item) => item.name === selectedCollectionName);
    if (!existsInAll) {
      return;
    }
  }, [collections, selectedCollectionName]);

  useEffect(() => {
    if (!selectedCollectionName && filteredCollections.length && window.innerWidth >= 1024) {
      setSelectedCollectionName(filteredCollections[0].name);
    }
  }, [filteredCollections, selectedCollectionName]);

  useEffect(() => {
    if (!isCompactCollectionsView) {
      setMobileSidebarVisible(true);
      return;
    }

    if (!selectedCollectionName) {
      setMobileSidebarVisible(true);
    }
  }, [isCompactCollectionsView, selectedCollectionName]);

  async function handleAddToCollection(item, mediaType) {
    if (!selectedCollection?._id) return;

    const payload =
      mediaType === 'Series'
        ? {
            seriesId: Number(item._id || item.id),
            title: item.title || item.name || 'Unknown',
            poster_path: item.poster_path || '',
            release_date: item.release_date || item.first_air_date || '',
            media_type: 'Series'
          }
        : {
            movieId: Number(item._id || item.id),
            title: item.title || item.name || 'Unknown',
            poster_path: item.poster_path || '',
            release_date: item.release_date || '',
            media_type: 'Movie'
          };

    const contentId = Number(payload.movieId || payload.seriesId);
    
    const optimisticSnapshot = optimisticUpdateCollectionItems(selectedCollection._id, (movies) => {
      const exists = movies.some((entry) => (Number(entry.movieId || entry.seriesId || entry.id || entry._id || 0)) === contentId);
      if (exists) return movies;
      return [
        mediaType === 'Series'
          ? { seriesId: contentId, title: payload.title, poster_path: payload.poster_path, release_date: payload.release_date, media_type: 'Series', addedAt: new Date().toISOString() }
          : { movieId: contentId, title: payload.title, poster_path: payload.poster_path, release_date: payload.release_date, media_type: 'Movie', addedAt: new Date().toISOString() },
        ...movies
      ];
    });

    try {
      setPendingItems(prev => new Set(prev).add(contentId));
      const response = window.CollectionStore?.addToCollection
        ? await window.CollectionStore.addToCollection(selectedCollection._id, payload)
        : await apiFetch(`/api/user/collections/${encodeURIComponent(selectedCollection._id)}/add`, {
            method: 'POST',
            body: JSON.stringify(payload)
          });
      if (!window.CollectionStore?.addToCollection) {
        if (Array.isArray(response?.collections)) {
          updateCollectionsCache(normalizeCollections(response.collections), response?.collectionVersion);
        }
      }
      toast(response.message || 'Added to collection');
    } catch (error) {
      if (error.status === 409) {
        toast('Already in this collection', 'info');
        return;
      }
      if (optimisticSnapshot) {
        optimisticUpdateCollectionItems(selectedCollection._id, (movies) => {
          return movies.filter((entry) => Number(entry.movieId || entry.seriesId || entry.id || entry._id || 0) !== contentId);
        });
      }
      const msg = error.message === 'Failed to fetch' ? 'Network error' : error.message;
      toast(`Failed to add: ${msg}`, 'error');
    } finally {
      setPendingItems(prev => {
        const next = new Set(prev);
        next.delete(contentId);
        return next;
      });
    }
  }

  function handleRemoveFromCollection(itemId, title) {
    setRemoveTarget({ itemId, title });
  }

  async function confirmRemoveFromCollection() {
    if (!removeTarget) return;
    if (!selectedCollection?._id) return;
      const pendingRemoval = removeTarget;
      setRemoveTarget(null);

      const collectionId = selectedCollection._id;
      const itemId = Number(pendingRemoval.itemId);

      const liveCollection = getCachedUserCollections()
        .find(c => String(c._id || c.name) === String(collectionId) || String(c.name) === String(collectionId));
      
      const target = (liveCollection?.movies || []).find(
        (item) => Number(item.movieId || item.seriesId || item.id || item._id || 0) === itemId
      );

      if (!target) {
        confirmTrashItem(collectionId, itemId);
        return;
      }

    // Optimistically move item out of collection cache and into trash
    trashItemFromCollectionCache(collectionId, itemId);

    try {
      setPendingItems(prev => new Set(prev).add(itemId));
      if (window.CollectionStore?.removeFromCollection) {
        await window.CollectionStore.removeFromCollection(collectionId, target.movieId, target.seriesId);
      } else {
        const removeResp = await apiFetch(
          `/api/user/collections/${encodeURIComponent(collectionId)}/remove`,
          {
            method: 'POST',
            body: JSON.stringify({
              ...(target.movieId ? { movieId: Number(target.movieId) } : {}),
              ...(target.seriesId ? { seriesId: Number(target.seriesId) } : {})
            })
          }
        );
          if (Array.isArray(removeResp?.collections)) {
            updateCollectionsCache(normalizeCollections(removeResp.collections), removeResp?.collectionVersion);
          }
        }
        // Backend confirmed -  permanently purge from trash
      confirmTrashItem(collectionId, itemId);
      toast(`Removed ${pendingRemoval.title}`);
    } catch (error) {
      // Backend failed -  restore item from trash back into the collection
      restoreTrashItem(collectionId, itemId);
      const msg = error.message === 'Failed to fetch' ? 'Network error' : error.message;
      toast(`Failed to remove: ${msg}`, 'error');
    } finally {
      setPendingItems(prev => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
    }
  }

  async function handleCreateCollection() {
    try {
      if (!createDraft.name.trim()) {
        toast('Please enter a collection name', 'error');
        return;
      }
      if (createDraft.name.trim().length > COLLECTION_NAME_MAX_LENGTH) {
        toast(`Collection name must be ${COLLECTION_NAME_MAX_LENGTH} characters or less`, 'error');
        return;
      }
      const collectionName = createDraft.name.trim();
      // Frontend duplicate guard - check live cache before hitting the API
      const nameLower = collectionName.toLowerCase();
      const isDuplicate = collections.some(
        (c) => String(c.name).trim().toLowerCase() === nameLower
      );
      if (isDuplicate) {
        toast(`A collection named "${collectionName}" already exists`, 'error');
        return;
      }
      setCreateLoading(true);
      if (window.CollectionStore?.createCollection) {
        await window.CollectionStore.createCollection(collectionName, createDraft.isPublic, createDraft.description.trim());
        setSelectedCollectionName(collectionName);
        setCreateDraft(createEmptyCollectionDraft());
        setCreateModalOpen(false);
        toast(`Created ${collectionName}`);
      } else {
        const response = await apiFetch('/api/user/collections', {
          method: 'POST',
          body: JSON.stringify({
            name: collectionName,
            isPublic: createDraft.isPublic,
            description: createDraft.description.trim()
          })
        });
        if (Array.isArray(response?.collections)) {
          broadcastCollections(normalizeCollections(response.collections), response?.collectionVersion);
        } else {
          await refreshCollectionsView();
        }
        setSelectedCollectionName(collectionName);
        setCreateDraft(createEmptyCollectionDraft());
        setCreateModalOpen(false);
        toast(`Created ${collectionName}`);
      }
    } catch (error) {
      const msg = error.status === 409
        ? (error.payload?.error || `A collection with that name already exists`)
        : (error.message || 'Failed to create collection');
      toast(msg, 'error');
    } finally {
      setCreateLoading(false);
    }
  }

  function openEditModal(collection) {
    setEditTargetId(collection._id || collection.name);
    setEditDraft({
      name: collection.name || '',
      description: collection.description || '',
      isPublic: !!collection.isPublic,
      isPublished: collection.isPublished === true
    });
    setEditModalOpen(true);
  }

  async function handleEditCollection() {
    if (!editTargetId) return;
    if (!editDraft.name.trim()) {
      toast('Please enter a collection name', 'error');
      return;
    }
    if (editDraft.name.trim().length > COLLECTION_NAME_MAX_LENGTH) {
      toast(`Collection name must be ${COLLECTION_NAME_MAX_LENGTH} characters or less`, 'error');
      return;
    }
    if (editDraft.isPublished === true && editDraft.isPublic === false) {
      toast('Unpublish this collection before making it private', 'error');
      return;
    }

    try {
      setCreateLoading(true);
      const collectionName = editDraft.name.trim();
      if (window.CollectionStore?.updateCollection) {
        await window.CollectionStore.updateCollection(editTargetId, collectionName, editDraft.isPublic, editDraft.description.trim());
      } else {
        const response = await apiFetch(`/api/user/collections/${encodeURIComponent(editTargetId)}`, {
          method: 'PUT',
          body: JSON.stringify({
            name: collectionName,
            isPublic: editDraft.isPublic,
            description: editDraft.description.trim()
          })
        });
        if (Array.isArray(response?.collections)) {
          broadcastCollections(response.collections, response?.collectionVersion);
        } else {
          await refreshCollectionsView();
        }
      }
      setSelectedCollectionName(collectionName);
      setEditModalOpen(false);
      setEditTargetId('');
      toast(`Updated ${collectionName}`);
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setCreateLoading(false);
    }
  }

  async function reorderCollections(sourceId, targetId) {
    if (!sourceId || !targetId || sourceId === targetId) return;

    const orderedIds = orderedCollections.map((collection) => String(collection._id || collection.name));
    const sourceIndex = orderedIds.indexOf(String(sourceId));
    const targetIndex = orderedIds.indexOf(String(targetId));
    if (sourceIndex === -1 || targetIndex === -1) return;

    const nextOrder = [...orderedIds];
    const [moved] = nextOrder.splice(sourceIndex, 1);
    nextOrder.splice(targetIndex, 0, moved);
    const previousOrder = orderedIds;

    setLocalCollectionOrder(nextOrder);

    try {
      if (window.CollectionStore?.reorderCollections) {
        await window.CollectionStore.reorderCollections(nextOrder);
      } else {
        await apiFetch('/api/user/collections/reorder', {
          method: 'POST',
          body: JSON.stringify({ order: nextOrder })
        });
      }
      toast('Collection order saved');
    } catch (error) {
      setLocalCollectionOrder(previousOrder);
      toast(error.message, 'error');
    }
  }

  function handleCollectionDragStart(event, collectionId) {
    setDraggedCollectionId(collectionId);
    setDragOverCollectionId(collectionId);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', collectionId);
  }

  function handleCollectionDragEnter(collectionId) {
    if (!draggedCollectionId || draggedCollectionId === collectionId) return;
    setDragOverCollectionId(collectionId);
  }

  async function handleCollectionDrop(event, targetId) {
    event.preventDefault();
    const sourceId = event.dataTransfer.getData('text/plain') || draggedCollectionId;
    setDragOverCollectionId('');
    setDraggedCollectionId('');
    await reorderCollections(sourceId, targetId);
  }

  function resetCollectionDragState() {
    setDraggedCollectionId('');
    setDragOverCollectionId('');
  }

  async function handleDeleteCollection(collection) {
    const cacheSnapshot = optimisticRemoveCollectionFromCache(collection._id || collection.name);
    try {
      if (window.CollectionStore?.deleteCollection) {
        await window.CollectionStore.deleteCollection(collection._id || collection.name);
      } else {
        const response = await apiFetch(`/api/user/collections/${encodeURIComponent(collection._id || collection.name)}`, {
          method: 'DELETE'
        });
        if (Array.isArray(response?.collections)) {
          broadcastCollections(response.collections, response?.collectionVersion);
        } else {
          await refreshCollectionsView();
        }
      }
      if (selectedCollectionName === collection.name) {
        setSelectedCollectionName('');
      }
      setOpenCollectionMenuId('');
      toast(`Deleted ${collection.name}`);
    } catch (error) {
      if (cacheSnapshot) {
        broadcastCollections(cacheSnapshot, lastKnownCollectionVersion);
      }
      toast(error.message, 'error');
    }
  }

  return (
    <div className="w-full max-w-none px-2 sm:px-5 md:px-4 lg:px-5 xl:px-5 2xl:px-8">
      <div className="flex flex-col lg:flex-row min-h-[calc(100vh-88px)] gap-4 lg:gap-5 xl:gap-5">
        <div className={`${isCompactCollectionsView && !mobileSidebarVisible ? 'hidden' : 'block'} w-full lg:w-[clamp(280px,28vw,340px)] lg:flex-shrink lg:sticky lg:top-[88px] lg:self-start`}>
          <aside className="w-full overflow-hidden rounded-[28px] bg-[linear-gradient(180deg,rgba(19,19,19,0.88),rgba(12,12,12,0.94))] shadow-[0_22px_58px_rgba(0,0,0,0.28)] backdrop-blur-[10px]">
            <div className="px-4 lg:px-5 pt-4 lg:pt-5 pb-4 flex flex-col gap-4 flex-shrink-0">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold text-white mt-1">My Collections</h2>
                  {showCollectionsResultsCount ? (
                    <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.14em] text-[#8f8f8f]">
                      {filteredCollections.length} results
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/[0.08] text-white hover:bg-white/[0.14] transition-colors focus:outline-none focus:ring-2 focus:ring-white"
                  onClick={() => setCreateModalOpen(true)}
                  aria-label="Create collection"
                >
                  <i className="fas fa-plus"></i>
                </button>
              </div>
              <div className="relative w-full">
                <div className="flex items-center px-4 py-3 bg-[#161616] rounded-2xl transition-all">
                  <i className="fas fa-search w-4 h-4 text-gray-400 mr-3"></i>
                  <input
                    placeholder="Search Collections"
                    className="bg-transparent border-none text-sm font-medium text-[#E2E2E2] focus:outline-none w-full"
                    type="text"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowDown') {
                        event.preventDefault();
                        const firstItem = sidebarListRef.current?.querySelector('[tabindex="0"]');
                        if (firstItem) {
                          firstItem.focus();
                          firstItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                        }
                      }
                    }}
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 w-full">
                {['all', 'public', 'private'].map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    className={`flex items-center justify-center h-10 rounded-2xl transition-all duration-300 ease-in-out focus:outline-none focus:ring-2 focus:ring-white ${
                      visibilityFilter === filter ? 'bg-white text-black' : 'bg-[#141414] text-[#C6C6C6]'
                    }`}
                    onClick={() => setVisibilityFilter(filter)}
                  >
                    <span className="text-xs font-medium truncate capitalize">{filter}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="max-h-[60vh] overflow-y-auto min-h-0 px-2 pb-3">
              <div ref={sidebarListRef} className="space-y-2 py-2" id="collectionsList">
                {filteredCollections.map((collection) => (
                  <div key={collection._id} style={{ opacity: 1 }}>
                    {(() => {
                      const collectionId = String(collection._id || collection.name);
                      const isFixed = ['Watched', 'Watchlist'].includes(collection.name);
                      const isDragged = !isFixed && draggedCollectionId === collectionId;
                      const isDropTarget = !isFixed && dragOverCollectionId === collectionId && draggedCollectionId && draggedCollectionId !== collectionId;
                      return (
                    <div
                      className={`relative flex items-center gap-2 p-3 rounded-[24px] cursor-pointer border transition-all duration-300 outline-none focus:bg-white/[0.08] focus:ring-2 focus:ring-white focus:border-transparent ${
                        isDragged ? 'opacity-60 scale-[0.985]' : ''
                      } ${
                        isDropTarget ? 'ring-1 ring-white/30 bg-white/[0.06]' : ''
                      } ${
                        selectedCollection?.name === collection.name
                          ? 'bg-white/[0.08] border-transparent shadow-[0_14px_32px_rgba(0,0,0,0.18)]'
                          : 'bg-transparent border-transparent hover:bg-white/[0.04]'
                      }`}
                      draggable={!isFixed}
                      tabIndex={0}
                      onDragStart={!isFixed ? (event) => handleCollectionDragStart(event, collectionId) : undefined}
                      onDragEnter={!isFixed ? () => handleCollectionDragEnter(collectionId) : undefined}
                      onDragOver={!isFixed ? (event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } : undefined}
                      onDrop={!isFixed ? (event) => handleCollectionDrop(event, collectionId) : undefined}
                      onDragEnd={!isFixed ? resetCollectionDragState : undefined}
                      onClick={() => {
                        setSelectedCollectionName(collection.name);
                        if (window.innerWidth < 1024) {
                          window.history.pushState({ soulstashCollectionsMobileDetail: true }, '', window.location.href);
                          setMobileSidebarVisible(false);
                        }
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          setSelectedCollectionName(collection.name);
                          if (window.innerWidth < 1024) {
                            window.history.pushState({ soulstashCollectionsMobileDetail: true }, '', window.location.href);
                            setMobileSidebarVisible(false);
                          }
                        }
                      }}
                    >
                      {!isFixed ? (
                      <button
                        type="button"
                        className="flex h-9 w-5 cursor-grab items-center justify-center text-[#8d8d8d] hover:text-white transition-colors focus:bg-white/[0.08] focus:ring-2 focus:ring-white focus:outline-none rounded-full"
                        onClick={(event) => event.stopPropagation()}
                        onMouseDown={(event) => event.stopPropagation()}
                        aria-label={`Reorder ${collection.name}`}
                        title="Drag to reorder"
                      >
                        <span className="grid grid-cols-2 gap-[2px]">
                          <span className="h-[3px] w-[3px] rounded-full bg-current"></span>
                          <span className="h-[3px] w-[3px] rounded-full bg-current"></span>
                          <span className="h-[3px] w-[3px] rounded-full bg-current"></span>
                          <span className="h-[3px] w-[3px] rounded-full bg-current"></span>
                          <span className="h-[3px] w-[3px] rounded-full bg-current"></span>
                          <span className="h-[3px] w-[3px] rounded-full bg-current"></span>
                        </span>
                      </button>
                      ) : (
                        <span className="h-9 w-5 flex-shrink-0" aria-hidden="true" />
                      )}
                      <div className="w-[48px] h-[48px] rounded-[16px] overflow-hidden flex-shrink-0">
                        <img
                          src={collection.banner || FALLBACK_AVATAR}
                          alt={collection.name}
                          className="w-full h-full object-cover"
                          onError={(event) => {
                            event.currentTarget.src = FALLBACK_AVATAR;
                          }}
                        />
                      </div>
                      <div className="flex-1 text-left min-w-0">
                        <div className="flex flex-col gap-1">
                          <h3 className="text-white font-medium"><MarqueeText text={collection.name} maxChars={25} /></h3>
                          <div className="flex items-center gap-2">
                            <CollectionVisibilityBadge collection={collection} />
                            <p className="text-[#919191] text-xs truncate">{collection.movieCount} items</p>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <button
                          type="button"
                          className="flex h-8 w-8 items-center justify-center text-[#a7a7a7] hover:text-white transition-colors focus:bg-white/[0.08] focus:ring-2 focus:ring-white focus:outline-none rounded-full"
                          onClick={(event) => {
                            event.stopPropagation();
                            navigate(`/user/${username}/collection/${encodeURIComponent(collection.name)}`);
                          }}
                          aria-label={`Open ${collection.name}`}
                        >
                          <i className="fas fa-arrow-right text-[12px]"></i>
                        </button>
                        <button
                          ref={(node) => {
                            const collectionId = String(collection._id || collection.name);
                            if (node) {
                              collectionMenuTriggerRefs.current.set(collectionId, node);
                            } else {
                              collectionMenuTriggerRefs.current.delete(collectionId);
                            }
                          }}
                          type="button"
                          className="flex h-8 w-8 items-center justify-center text-[#a7a7a7] hover:text-white transition-colors focus:bg-white/[0.08] focus:ring-2 focus:ring-white focus:outline-none rounded-full"
                          onClick={(event) => {
                            event.stopPropagation();
                            const rect = event.currentTarget.getBoundingClientRect();
                            setCollectionMenuPosition(getCollectionMenuPosition(rect));
                            setOpenCollectionMenuId((current) => (current === String(collection._id || collection.name) ? '' : String(collection._id || collection.name)));
                          }}
                          aria-label={`More actions for ${collection.name}`}
                        >
                          <i className="fas fa-ellipsis-h text-[12px]"></i>
                        </button>
                      </div>
                    </div>
                      );
                    })()}
                  </div>
                ))}
                {!loading && !filteredCollections.length ? (
                  <div className="text-center text-gray-500 px-4 py-12">No collections found.</div>
                ) : null}
              </div>
            </div>
          </aside>
        </div>

        <main className={`${isCompactCollectionsView && mobileSidebarVisible ? 'hidden' : 'block'} min-w-0 flex-1 w-full`}>
          <div className="pb-6">
            <div className="max-w-none">
              <CollectionDetailPane
                username={username}
                collection={selectedCollection}
                filters={filters}
                setFilters={setFilters}
                watchedIds={watchedIds}
                onOpenDrawer={() => setDrawerOpen(true)}
                onRemoveFromCollection={handleRemoveFromCollection}
                onBackToCollections={() => setMobileSidebarVisible(true)}
                onPublishChange={() => {
                  const currentName = selectedCollection?.name || '';
                  setVisibilityFilter('all');
                  if (currentName) {
                    window.setTimeout(() => {
                      setSelectedCollectionName(currentName);
                    }, 0);
                  }
                }}
                showPublishControls
              />
            </div>
          </div>
        </main>
      </div>
      <CollectionSearchDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        collection={selectedCollection}
        onAdd={handleAddToCollection}
        pendingItems={pendingItems}
      />
      <CreateCollectionModal
        open={createModalOpen}
        values={createDraft}
        onChange={setCreateDraft}
        onClose={() => {
          setCreateModalOpen(false);
          setCreateDraft(createEmptyCollectionDraft());
        }}
        onSubmit={handleCreateCollection}
        saving={createLoading}
      />
      <EditCollectionModal
        open={editModalOpen}
        values={editDraft}
        onChange={setEditDraft}
        onClose={() => {
          setEditModalOpen(false);
          setEditTargetId('');
          setEditDraft(createEmptyCollectionDraft());
        }}
        onSubmit={handleEditCollection}
        saving={createLoading}
      />
      {openCollectionMenuId ? (
        <div className="fixed inset-0 z-[80]" onClick={() => setOpenCollectionMenuId('')}>
          <div
            className="fixed z-[9999] min-w-[8rem] overflow-x-hidden rounded-md border border-gray-800 bg-[#1B1B1B] p-1 text-gray-200 shadow-md animate-[menuPop_160ms_ease-out]"
            style={{ top: `${collectionMenuPosition.top}px`, left: `${collectionMenuPosition.left}px` }}
            onClick={(event) => event.stopPropagation()}
            role="menu"
            aria-orientation="vertical"
          >
            {(() => {
              const menuCollection = filteredCollections.find((item) => String(item._id || item.name) === openCollectionMenuId) || collections.find((item) => String(item._id || item.name) === openCollectionMenuId);
              if (!menuCollection) return null;
              return (
                <>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm text-white hover:bg-[#252833] focus:bg-[#252833]"
                    onClick={() => {
                      navigate(`/user/${username}/collection/${encodeURIComponent(menuCollection.name)}`);
                      setOpenCollectionMenuId('');
                    }}
                    role="menuitem"
                  >
                    <i className="fas fa-arrow-right text-[12px]"></i>
                    <span>Open</span>
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm text-white hover:bg-[#252833] focus:bg-[#252833]"
                    onClick={() => {
                      openEditModal(menuCollection);
                      setOpenCollectionMenuId('');
                    }}
                    role="menuitem"
                  >
                    <i className="fas fa-pen text-[12px]"></i>
                    <span>Edit</span>
                  </button>
                  {!['Watched', 'Watchlist'].includes(menuCollection.name) ? (
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm text-red-400 hover:bg-[#252833] focus:bg-[#252833]"
                      onClick={() => {
                        setCollectionDeleteTarget(menuCollection);
                        setOpenCollectionMenuId('');
                      }}
                      role="menuitem"
                    >
                      <i className="fas fa-trash text-[12px]"></i>
                      <span>Delete</span>
                    </button>
                  ) : null}
                </>
              );
            })()}
          </div>
        </div>
      ) : null}
      <ConfirmModal
        open={!!removeTarget}
        title="Remove from collection?"
        message={removeTarget ? `"${removeTarget.title}" will be removed from ${selectedCollection?.name || 'this collection'}.` : ''}
        confirmLabel="Remove"
        danger
        onConfirm={confirmRemoveFromCollection}
        onClose={() => setRemoveTarget(null)}
      />
      <ConfirmModal
        open={!!collectionDeleteTarget}
        title="Delete collection?"
        message={collectionDeleteTarget ? `"${collectionDeleteTarget.name}" will be permanently deleted.` : ''}
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          if (collectionDeleteTarget) {
            handleDeleteCollection(collectionDeleteTarget);
            setCollectionDeleteTarget(null);
          }
        }}
        onClose={() => setCollectionDeleteTarget(null)}
      />
    </div>
  );
}
