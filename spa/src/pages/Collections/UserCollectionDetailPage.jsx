import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { cachedApiFetch, apiFetch } from '../../api/client.js';
import { broadcastCollections, normalizeCollections, normalizeCollection, filteredCollectionMovies, optimisticUpdateCollectionItems, refreshCollectionsView, lastKnownCollectionVersion, trashItemFromCollectionCache, confirmTrashItem, restoreTrashItem, updateCollectionsCache } from '../../utils/helpers.js';
import { useLiveCollections, useAuthSession, useSessionState } from '../../hooks/index.js';
import { contentIdFromItem } from '../../utils/formatters.js';
import { toast } from '../../utils/toast.js';
import { CollectionDetailPane } from '../../components/ui/Misc/CollectionDetailPane.jsx';
import { GridSkeleton } from '../../components/ui/Skeletons/index.js';
import { CollectionSearchDrawer } from '../../components/ui/Misc/CollectionSearchDrawer.jsx';
import { ConfirmModal } from '../../components/ui/Modals/ConfirmModal.jsx';
export function UserCollectionDetailPage() {
  const { username = '', collectionName = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useAuthSession();
  const decodedCollectionName = decodeURIComponent(collectionName);
  const { collections, loading } = useLiveCollections();
  const [publicCollection, setPublicCollection] = useState(null);
  const [publicLoading, setPublicLoading] = useState(true);
  const [publicError, setPublicError] = useState('');
  const isOwner = auth.isLoggedIn && auth.username === username;
  const watchedCollection = useMemo(() => collections.find((item) => item.name === 'Watched'), [collections]);
  const watchedIds = useMemo(
    () =>
      isOwner
        ? new Set((watchedCollection?.movies || []).map((movie) => Number(movie.movieId || movie.seriesId || movie.id || movie._id || 0)))
        : new Set(),
    [isOwner, watchedCollection]
  );
  const collection = useMemo(
    () =>
      normalizeCollection(
        (isOwner ? collections.find((item) => item.name === decodedCollectionName || item._id === decodedCollectionName) : publicCollection) || null
      ),
    [collections, decodedCollectionName, isOwner, publicCollection]
  );
  const [filters, setFilters] = useSessionState(`collection-page:${location.pathname}:filters`, { contentType: 'all', anime: 'yes', sortBy: 'recent', hideWatched: false });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState(null);
  const [pendingItems, setPendingItems] = useState(new Set());

  useEffect(() => {
    document.title = `${decodedCollectionName} | Soulstash`;
  }, [decodedCollectionName]);

  useEffect(() => {
    // Owner sees their own collection from the live cache - no public fetch needed.
    if (isOwner) {
      setPublicLoading(false);
      return;
    }
    let ignore = false;
    setPublicLoading(true);
    setPublicError('');
    cachedApiFetch(`/api/collection/${encodeURIComponent(username)}/${encodeURIComponent(decodedCollectionName)}`)
      .then((payload) => {
        if (!ignore) {
          const resolvedCollection = Array.isArray(payload)
            ? payload[0]
            : payload?.collection || payload?.data || payload;
          setPublicCollection(resolvedCollection || null);
        }
      })
      .catch((error) => {
        if (!ignore) {
          setPublicError(error.message || 'Collection not found.');
          setPublicCollection(null);
        }
      })
      .finally(() => {
        if (!ignore) setPublicLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [decodedCollectionName, isOwner, username]);


  useEffect(() => {
    console.log('[Soulstash][React] UserCollectionDetailPage mounted', {
      route: window.location.pathname,
      username,
      collectionName: decodedCollectionName,
      resolvedCollection: collection?.name || null,
      loading
    });
  }, [username, decodedCollectionName, collection?.name, loading]);

  const movies = useMemo(() => filteredCollectionMovies(collection, filters, watchedIds), [collection, filters, watchedIds]);

  async function handleAddToCollection(item, mediaType) {
    if (!collection?._id) return;

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
    const optimisticSnapshot = optimisticUpdateCollectionItems(collection._id, (movies) => {
      const exists = movies.some((entry) => contentIdFromItem(entry) === contentId);
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
        ? await window.CollectionStore.addToCollection(collection._id, payload)
        : await apiFetch(`/api/user/collections/${encodeURIComponent(collection._id)}/add`, {
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
        optimisticUpdateCollectionItems(collection._id, (movies) => {
          return movies.filter((entry) => contentIdFromItem(entry) !== contentId);
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
    const collectionId = collection?._id || collection?.name || decodedCollectionName;
    if (!collectionId) return;
    const pendingRemoval = removeTarget;
    const target = (collection.movies || []).find(
      (item) => Number(item.movieId || item.seriesId || item.id || item._id || 0) === Number(pendingRemoval.itemId)
    );
    if (!target) return;
    setRemoveTarget(null);

    const itemId = Number(target.movieId || target.seriesId || target.id || target._id || 0);

    // Optimistically move item out of collection cache and into trash
    trashItemFromCollectionCache(collectionId, itemId);

    try {
      if (window.CollectionStore?.removeFromCollection) {
        await window.CollectionStore.removeFromCollection(collectionId, target.movieId, target.seriesId);
      } else {
        const removeResp = await apiFetch(
          `/api/user/collections/${encodeURIComponent(collectionId)}/remove`,
          {
            method: 'POST',
            body: JSON.stringify({
              id: itemId
            })
          }
        );
        if (Array.isArray(removeResp?.collections)) {
          updateCollectionsCache(normalizeCollections(removeResp.collections), removeResp?.collectionVersion);
        }
      }
      // Backend confirmed -> permanently purge from trash
      confirmTrashItem(collectionId, itemId);
      toast(`Removed ${pendingRemoval.title}`);
    } catch (error) {
      // Backend failed -> restore item from trash back into the collection
      restoreTrashItem(collectionId, itemId);
      const msg = error.message === 'Failed to fetch' ? 'Network error' : error.message;
      toast(`Failed to remove: ${msg}`, 'error');
    }
  }

  // Show spinner while either the owner's live-cache or the public fetch is still in flight.
  const isStillLoading = !collection?.name && (
    (isOwner && loading) ||
    (!isOwner && publicLoading)
  );
  if (isStillLoading) {
    return (
      <div className="w-full max-w-none px-2 sm:px-5 md:px-4 lg:px-5 xl:px-5 2xl:px-8">
        <div className="pb-6">
          <div className="mb-6 h-[180px] w-full rounded-[24px] bg-white/[0.04] animate-pulse"></div>
          <GridSkeleton count={14} />
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-none px-2 sm:px-5 md:px-4 lg:px-5 xl:px-5 2xl:px-8">
      {collection?.name ? (
        <div className="pb-6">
          <CollectionDetailPane
            username={username}
            collection={collection}
            filters={filters}
            setFilters={setFilters}
            watchedIds={watchedIds}
            onOpenDrawer={() => setDrawerOpen(true)}
            onRemoveFromCollection={handleRemoveFromCollection}
            isOwner={isOwner}
            useBannerAsBackdrop
          />
        </div>
      ) : (
        <div className="app-error">{publicError || 'Collection not found.'}</div>
      )}
      {isOwner ? (
        <CollectionSearchDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} collection={collection} onAdd={handleAddToCollection} pendingItems={pendingItems} />
      ) : null}
      <ConfirmModal
        open={!!removeTarget}
        title="Remove from collection?"
        message={removeTarget ? `"${removeTarget.title}" will be removed from ${collection?.name || 'this collection'}.` : ''}
        confirmLabel="Remove"
        danger
        onConfirm={confirmRemoveFromCollection}
        onClose={() => setRemoveTarget(null)}
      />
    </div>
  );
}

