import { useMutation, useQueryClient } from '@tanstack/react-query';
import { broadcastCollections } from '../../utils/collectionsCache.js';
import {
  addCollectionItem,
  createCollection,
  deleteCollection,
  removeCollectionItem,
  saveCollectionOrder,
  updateCollection
} from './collectionApi.js';

const collectionsQueryKey = ['collections'];

export function useCollectionMutations() {
  const queryClient = useQueryClient();
  const handleSuccess = (response) => {
    // The page reads from useLiveCollections (the shared local cache), not a
    // React Query collections query. Apply the authoritative server snapshot
    // so it re-renders immediately after every collection mutation.
    if (Array.isArray(response?.collections)) {
      broadcastCollections(response.collections, response.collectionVersion);
    }
    queryClient.invalidateQueries({ queryKey: collectionsQueryKey });
  };
  const options = { onSuccess: handleSuccess };

  return {
    addItem: useMutation({ mutationFn: ({ collectionId, payload }) => addCollectionItem(collectionId, payload), ...options }),
    removeItem: useMutation({ mutationFn: ({ collectionId, target }) => removeCollectionItem(collectionId, target), ...options }),
    create: useMutation({ mutationFn: createCollection, ...options }),
    update: useMutation({ mutationFn: updateCollection, ...options }),
    reorder: useMutation({ mutationFn: saveCollectionOrder, ...options }),
    remove: useMutation({ mutationFn: deleteCollection, ...options })
  };
}
