import { useState, useCallback, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLiveCollections } from './index.js';
import { apiFetch, getToken } from '../api/client.js';
import { toast } from '../utils/toast.js';
import { broadcastCollections } from '../utils/collectionsCache.js';
import { getCollectionStatus, createEmptyCollectionDraft } from '../utils/formatters.js';

export function useMediaAction(id, type, content) {
  const queryClient = useQueryClient();
  const syncCollections = useCallback((response) => {
    if (Array.isArray(response?.collections)) {
      broadcastCollections(response.collections, response.collectionVersion);
    }
    queryClient.invalidateQueries({ queryKey: ['collections'] });
  }, [queryClient]);

  const { collections } = useLiveCollections();
  const serverStatus = useMemo(() => getCollectionStatus(collections, id), [collections, id]);
  const status = serverStatus;

  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState(createEmptyCollectionDraft());
  const [pendingAction, setPendingAction] = useState(null);

  const toggleCollectionMutation = useMutation({
    mutationFn: async ({ targetCollection, payload, opposite, oppositeActive }) => {
      if (oppositeActive) {
        await apiFetch(`/api/user/collections/${opposite}/remove`, {
          method: 'POST',
          body: JSON.stringify({ id: Number(id) })
        });
      }
      return apiFetch(`/api/user/collections/${encodeURIComponent(targetCollection)}/add`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
    },
    onSuccess: (response) => {
      syncCollections(response);
    },
    onError: (error) => {
      toast(error.message, 'error');
    }
  });

  const removeCollectionMutation = useMutation({
    mutationFn: async ({ targetCollection, payload }) => {
      return apiFetch(`/api/user/collections/${encodeURIComponent(targetCollection)}/remove`, {
        method: 'POST',
        body: JSON.stringify({
          ...(payload.movieId ? { movieId: payload.movieId } : {}),
          ...(payload.seriesId ? { seriesId: payload.seriesId } : {})
        })
      });
    },
    onSuccess: (response) => {
      syncCollections(response);
    },
    onError: (error) => {
      toast(error.message, 'error');
    }
  });

  const toggleCollection = useCallback(
    async (targetCollection) => {
      if (!getToken()) {
        toast('Please login first', 'success');
        return;
      }

      const isSeries = type === 'series';
      const idKey = isSeries ? 'seriesId' : 'movieId';
      const alreadySaved = targetCollection === 'Watched' ? status.watched : status.watchlist;

      const payload = {
        [idKey]: Number(id),
        title: content?.title || content?.name,
        poster_path: content?.poster_path || '',
        release_date: content?.release_date || content?.first_air_date || '',
        media_type: isSeries ? 'Series' : 'Movie'
      };

      setPendingAction(targetCollection);
      
      try {
        if (alreadySaved) {
          if (window.CollectionStore?.removeFromCollection) {
            await window.CollectionStore.removeFromCollection(
              targetCollection,
              payload.movieId,
              payload.seriesId
            );
            queryClient.invalidateQueries({ queryKey: ['collections'] });
          } else {
            await removeCollectionMutation.mutateAsync({ targetCollection, payload });
          }
        } else {
          const opposite = targetCollection === 'Watched' ? 'Watchlist' : 'Watched';
          const oppositeActive = targetCollection === 'Watched' ? status.watchlist : status.watched;

          if (window.CollectionStore?.addToCollection) {
            if (oppositeActive && window.CollectionStore?.removeFromCollection) {
              await window.CollectionStore.removeFromCollection(opposite, payload.movieId, payload.seriesId);
            }
            await window.CollectionStore.addToCollection(targetCollection, payload);
            queryClient.invalidateQueries({ queryKey: ['collections'] });
          } else {
            await toggleCollectionMutation.mutateAsync({ targetCollection, payload, opposite, oppositeActive });
          }
        }
        toast(alreadySaved ? `Removed from ${targetCollection}` : `Added to ${targetCollection}`, 'success');
      } finally {
        setPendingAction(null);
      }
    },
    [id, type, content, status, removeCollectionMutation, toggleCollectionMutation, queryClient]
  );

  const toggleCustomCollectionMutation = useMutation({
    mutationFn: async ({ targetCollection, payload, alreadySaved }) => {
      const collId = targetCollection._id || targetCollection.name;
      if (alreadySaved) {
        return apiFetch(`/api/user/collections/${encodeURIComponent(collId)}/remove`, {
          method: 'POST',
          body: JSON.stringify({
            ...(payload.movieId ? { movieId: payload.movieId } : {}),
            ...(payload.seriesId ? { seriesId: payload.seriesId } : {})
          })
        });
      } else {
        return apiFetch(`/api/user/collections/${encodeURIComponent(collId)}/add`, {
          method: 'POST',
          body: JSON.stringify(payload)
        });
      }
    },
    onSuccess: (response) => {
      syncCollections(response);
    },
    onError: (error) => {
      toast(error.message, 'error');
    }
  });

  const handleToggleCustomCollection = useCallback(
    async (targetCollection) => {
      if (!content) return;

      const title = content.title || content.name || 'Unknown title';
      const alreadySaved =
        Array.isArray(collections) &&
        collections.some((c) => {
          if (c.name !== targetCollection.name) return false;
          const numId = Number(id);
          return Array.isArray(c.movies) &&
            c.movies.some((m) => m.movieId === numId || m.seriesId === numId);
        });

      const payload = type === 'series'
        ? {
            seriesId: Number(id),
            title,
            poster_path: content.poster_path || '',
            release_date: content.first_air_date || '',
            media_type: 'Series'
          }
        : {
            movieId: Number(id),
            title,
            poster_path: content.poster_path || '',
            release_date: content.release_date || '',
            media_type: 'Movie'
          };

      setPendingAction(targetCollection.name);
      const collId = targetCollection._id || targetCollection.name;

      try {
        if (alreadySaved) {
          if (window.CollectionStore?.removeFromCollection) {
            await window.CollectionStore.removeFromCollection(collId, payload.movieId, payload.seriesId);
            queryClient.invalidateQueries({ queryKey: ['collections'] });
          } else {
            await toggleCustomCollectionMutation.mutateAsync({ targetCollection, payload, alreadySaved: true });
          }
          toast(`Removed from ${targetCollection.name}`);
        } else {
          if (window.CollectionStore?.addToCollection) {
            await window.CollectionStore.addToCollection(collId, payload);
            queryClient.invalidateQueries({ queryKey: ['collections'] });
          } else {
            await toggleCustomCollectionMutation.mutateAsync({ targetCollection, payload, alreadySaved: false });
          }
          toast(`Saved to ${targetCollection.name}`);
        }
      } catch (error) {
        // toast is handled in mutation onError or caught here
      } finally {
        setPendingAction(null);
      }
    },
    [id, type, content, collections, toggleCustomCollectionMutation, queryClient]
  );

  const createCollectionMutation = useMutation({
    mutationFn: async () => {
      return apiFetch('/api/user/collections', {
        method: 'POST',
        body: JSON.stringify({
          name: createDraft.name.trim(),
          isPublic: createDraft.isPublic,
          description: createDraft.description.trim()
        })
      });
    },
    onSuccess: (response) => {
      syncCollections(response);
      toast(`Created ${createDraft.name.trim()}`);
      setCreateModalOpen(false);
      setSaveModalOpen(true);
      setCreateDraft(createEmptyCollectionDraft());
    },
    onError: (error) => {
      toast(error.message, 'error');
    }
  });

  const handleCreateCustomCollection = useCallback(async () => {
    if (!createDraft.name.trim()) {
      toast('Please enter a collection name', 'error');
      return;
    }
    
    if (window.CollectionStore?.createCollection) {
      try {
        await window.CollectionStore.createCollection(
          createDraft.name.trim(),
          createDraft.isPublic,
          createDraft.description.trim()
        );
        queryClient.invalidateQueries({ queryKey: ['collections'] });
        toast(`Created ${createDraft.name.trim()}`);
        setCreateModalOpen(false);
        setSaveModalOpen(true);
        setCreateDraft(createEmptyCollectionDraft());
      } catch (error) {
        toast(error.message, 'error');
      }
    } else {
      createCollectionMutation.mutate();
    }
  }, [createDraft, createCollectionMutation, queryClient]);

  return {
    collections,
    status,
    saveModalOpen,
    setSaveModalOpen,
    createModalOpen,
    setCreateModalOpen,
    createDraft,
    setCreateDraft,
    createLoading: createCollectionMutation.isPending,
    pendingAction,
    toggleCollection,
    handleToggleCustomCollection,
    handleCreateCustomCollection,
  };
}
