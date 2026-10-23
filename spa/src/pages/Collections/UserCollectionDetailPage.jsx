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

  // Derive background artwork for single collection page
  const singleCollectionBg = useMemo(() => {
    if (!collection) return null;
    if (collection.banner && typeof collection.banner === 'string' && collection.banner.trim() && !collection.banner.includes('b23d0bfcaa8b')) {
      return collection.banner;
    }
    const movieItems = collection.movies;
    if (!movieItems || movieItems.length === 0) return null;
    const firstWithBackdrop = movieItems.find(m => m.backdrop_path);
    const firstWithPoster = movieItems.find(m => m.poster_path);
    const item = firstWithBackdrop || firstWithPoster || movieItems[0];
    return item?.backdrop_path || item?.poster_path || null;
  }, [collection]);

  useEffect(() => {
    // Mirrors exactly what DetailHero does for movie/series pages.
    const hasCollection = !!collection?.name;
    if (!hasCollection) {
      document.body.style.removeProperty('--collection-artwork-image');
      document.body.style.removeProperty('--collection-tint');
      document.body.classList.remove('collection-artwork-theme');
      return () => {
        document.body.style.removeProperty('--collection-artwork-image');
        document.body.style.removeProperty('--collection-tint');
        document.body.classList.remove('collection-artwork-theme');
      };
    }

    let cancelled = false;

    if (singleCollectionBg) {
      const fullUrl = singleCollectionBg.startsWith('http')
        ? singleCollectionBg
        : `https://image.tmdb.org/t/p/w1280${singleCollectionBg.startsWith('/') ? '' : '/'}${singleCollectionBg}`;
      const thumbUrl = singleCollectionBg.startsWith('http')
        ? singleCollectionBg
        : `https://image.tmdb.org/t/p/w92${singleCollectionBg.startsWith('/') ? '' : '/'}${singleCollectionBg}`;

      document.body.style.setProperty('--collection-artwork-image', `url("${fullUrl}")`);

      // Sample dominant colour (same algorithm as DetailHero)
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        if (cancelled) return;
        try {
          const c = document.createElement('canvas');
          c.width = 24; c.height = 36;
          const ctx = c.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, 0, 24, 36);
          const d = ctx.getImageData(0, 0, 24, 36).data;
          let r = 0, g = 0, b = 0, w = 0;
          for (let i = 0; i < d.length; i += 4) {
            const max = Math.max(d[i], d[i + 1], d[i + 2]);
            const min = Math.min(d[i], d[i + 1], d[i + 2]);
            const weight = 1 + (max - min) / 32;
            r += d[i] * weight; g += d[i + 1] * weight; b += d[i + 2] * weight; w += weight;
          }
          r /= w; g /= w; b /= w;
          const peak = Math.max(r, g, b, 1);
          const k = Math.min(110 / peak, 1.6);
          const tint = [r, g, b].map(v => Math.round(Math.min(v * k, 130)));
          document.body.style.setProperty('--collection-tint', `${tint[0]} ${tint[1]} ${tint[2]}`);
        } catch { /* keep dark fallback */ }
      };
      img.src = thumbUrl;
    } else {
      document.body.style.removeProperty('--collection-artwork-image');
      document.body.style.removeProperty('--collection-tint');
    }

    document.body.classList.add('collection-artwork-theme');

    return () => {
      cancelled = true;
      document.body.style.removeProperty('--collection-artwork-image');
      document.body.style.removeProperty('--collection-tint');
      document.body.classList.remove('collection-artwork-theme');
    };
  }, [singleCollectionBg, collection?.name]);

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
