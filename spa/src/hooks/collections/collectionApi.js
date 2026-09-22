import { apiFetch } from '../../api/client.js';

function collectionStore() {
  return window.CollectionStore;
}

export function addCollectionItem(collectionId, payload) {
  if (collectionStore()?.addToCollection) {
    return collectionStore().addToCollection(collectionId, payload);
  }

  return apiFetch(`/api/user/collections/${encodeURIComponent(collectionId)}/add`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function removeCollectionItem(collectionId, target) {
  if (collectionStore()?.removeFromCollection) {
    return collectionStore().removeFromCollection(collectionId, target.movieId, target.seriesId);
  }

  return apiFetch(`/api/user/collections/${encodeURIComponent(collectionId)}/remove`, {
    method: 'POST',
    body: JSON.stringify({
      ...(target.movieId ? { movieId: Number(target.movieId) } : {}),
      ...(target.seriesId ? { seriesId: Number(target.seriesId) } : {})
    })
  });
}

export function createCollection({ collectionName, isPublic, description }) {
  if (collectionStore()?.createCollection) {
    return collectionStore().createCollection(collectionName, isPublic, description);
  }

  return apiFetch('/api/user/collections', {
    method: 'POST',
    body: JSON.stringify({ name: collectionName, isPublic, description })
  });
}

export function updateCollection({ editTargetId, collectionName, isPublic, description }) {
  if (collectionStore()?.updateCollection) {
    return collectionStore().updateCollection(editTargetId, collectionName, isPublic, description);
  }

  return apiFetch(`/api/user/collections/${encodeURIComponent(editTargetId)}`, {
    method: 'PUT',
    body: JSON.stringify({ name: collectionName, isPublic, description })
  });
}

export function saveCollectionOrder(order) {
  if (collectionStore()?.reorderCollections) {
    return collectionStore().reorderCollections(order);
  }

  return apiFetch('/api/user/collections/reorder', {
    method: 'POST',
    body: JSON.stringify({ order })
  });
}

export function deleteCollection(collectionId) {
  if (collectionStore()?.deleteCollection) {
    return collectionStore().deleteCollection(collectionId);
  }

  return apiFetch(`/api/user/collections/${encodeURIComponent(collectionId)}`, { method: 'DELETE' });
}
