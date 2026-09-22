import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useLocation, useParams, useOutletContext } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../api/client.js';
import { normalizeCollection, broadcastCollections } from '../../utils/collectionsCache.js';
import { filteredCollectionMovies } from '../../utils/formatters.js';
import { useLiveCollections, useAuthSession, useSessionState } from '../../hooks/index.js';
import { contentIdFromItem } from '../../utils/formatters.js';
import { toast } from '../../utils/toast.js';
import { CollectionDetailPane } from '../../components/ui/Misc/CollectionDetailPane.jsx';
import { GridSkeleton } from '../../components/ui/Skeletons/index.js';
import { CollectionSearchDrawer } from '../../components/ui/Misc/CollectionSearchDrawer.jsx';
import { ConfirmModal } from '../../components/ui/Modals/ConfirmModal.jsx';

export function UserCollectionDetailPage() {
  const { username = '', collectionName = '' } = useParams();
  const outletContext = useOutletContext();
  const inLayout = outletContext?.inLayout || false;
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useAuthSession();
  const decodedCollectionName = decodeURIComponent(collectionName);
  const { collections, loading } = useLiveCollections();
  
  const isOwner = auth.isLoggedIn && auth.username === username;
  
  const queryClient = useQueryClient();

  const { data: publicCollectionData, isLoading: publicLoadingQuery, error: publicQueryError } = useQuery({
    queryKey: ['collection', username, decodedCollectionName],
    queryFn: () => apiFetch(`/api/collection/${encodeURIComponent(username)}/${encodeURIComponent(decodedCollectionName)}`),
    enabled: !isOwner,
  });

  const publicCollection = useMemo(() => {
    if (!publicCollectionData) return null;
    return Array.isArray(publicCollectionData)
      ? publicCollectionData[0]
      : publicCollectionData?.collection || publicCollectionData?.data || publicCollectionData;
  }, [publicCollectionData]);

  const publicLoading = isOwner ? false : publicLoadingQuery;
  const publicError = publicQueryError ? (publicQueryError.message || 'Collection not found.') : '';

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
    console.log('[Soulstash][React] UserCollectionDetailPage mounted', {
      route: window.location.pathname,
      username,
      collectionName: decodedCollectionName,
      resolvedCollection: collection?.name || null,
      loading
    });
  }, [username, decodedCollectionName, collection?.name, loading]);

  const movies = useMemo(() => filteredCollectionMovies(collection, filters, watchedIds), [collection, filters, watchedIds]);

  const addMutation = useMutation({
    mutationFn: async (payload) => {
      if (window.CollectionStore?.addToCollection) {
        return await window.CollectionStore.addToCollection(collection._id, payload);
      }
      return await apiFetch(`/api/user/collections/${encodeURIComponent(collection._id)}/add`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
    },
    onSuccess: (response) => {
      if (Array.isArray(response?.collections)) {
        broadcastCollections(response.collections, response.collectionVersion);
      }
      queryClient.invalidateQueries({ queryKey: ['collections'] });
      queryClient.invalidateQueries({ queryKey: ['collection', username, decodedCollectionName] });
      toast(response?.message || 'Added to collection');
    },
    onError: (error) => {
      if (error.status === 409) {
        toast('Already in this collection', 'info');
      } else {
        const msg = error.message === 'Failed to fetch' ? 'Network error' : error.message;
        toast(`Failed to add: ${msg}`, 'error');
      }
    }
  });

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
    
    setPendingItems(prev => new Set(prev).add(contentId));
    
    await addMutation.mutateAsync(payload, {
      onSettled: () => {
        setPendingItems(prev => {
          const next = new Set(prev);
          next.delete(contentId);
          return next;
        });
      }
    });
  }

  function handleRemoveFromCollection(itemId, title) {
    setRemoveTarget({ itemId, title });
  }

  const removeMutation = useMutation({
    mutationFn: async ({ collectionId, itemId, target }) => {
      if (window.CollectionStore?.removeFromCollection) {
        return await window.CollectionStore.removeFromCollection(collectionId, target.movieId, target.seriesId);
      }
      return await apiFetch(
        `/api/user/collections/${encodeURIComponent(collectionId)}/remove`,
        {
          method: 'POST',
          body: JSON.stringify({ id: itemId })
        }
      );
    },
    onSuccess: (response, variables) => {
      if (Array.isArray(response?.collections)) {
        broadcastCollections(response.collections, response.collectionVersion);
      }
      queryClient.invalidateQueries({ queryKey: ['collections'] });
      queryClient.invalidateQueries({ queryKey: ['collection', username, decodedCollectionName] });
      toast(`Removed ${variables.title}`);
    },
    onError: (error) => {
      const msg = error.message === 'Failed to fetch' ? 'Network error' : error.message;
      toast(`Failed to remove: ${msg}`, 'error');
    }
  });

  async function confirmRemoveFromCollection() {
    if (!removeTarget) return;
    const collectionId = collection?._id || collection?.name || decodedCollectionName;
    if (!collectionId) return;
    
    const pendingRemoval = removeTarget;
    setRemoveTarget(null);

    const itemId = Number(pendingRemoval.itemId);
    const target = (collection?.movies || []).find(
      (item) => Number(item.movieId || item.seriesId || item.id || item._id || 0) === itemId
    );

    if (!target) {
      return;
    }

    await removeMutation.mutateAsync({ collectionId, itemId, target, title: pendingRemoval.title });
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
            useBannerAsBackdrop={!inLayout}
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
