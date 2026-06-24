import { useState, useEffect } from 'react';
import { getCachedUserCollections, loadRatingsTable, loadUserCollections, normalizeCollections, hasCollectionCache } from '../utils/helpers.js';
import { getToken } from '../api/client.js';

export function useLiveCollections() {
  const [collections, setCollections] = useState(() => normalizeCollections(getCachedUserCollections()));
  const [loading, setLoading] = useState(() => !hasCollectionCache() && !!getToken());

  useEffect(() => {
    function applyCollections(nextCollections) {
      setCollections(normalizeCollections(nextCollections));
      setLoading(false);
    }

    applyCollections(getCachedUserCollections());

    if (getToken()) {
      if (!hasCollectionCache()) {
        setLoading(true);
      }
      loadRatingsTable().catch(() => {});
      loadUserCollections()
        .then(applyCollections)
        .catch(() => setLoading(false));
    }

    function handleCollectionsUpdated(event) {
      applyCollections(event.detail?.collections || getCachedUserCollections());
    }

    function handleStorage(event) {
      if (!event.key || !event.key.startsWith('ss_collections_')) return;
      applyCollections(getCachedUserCollections());
    }

    const updateEventName = window.CollectionStore?.COLLECTIONS_UPDATED_EVENT || 'soulstash:collections-updated';
    window.addEventListener(updateEventName, handleCollectionsUpdated);
    window.addEventListener('storage', handleStorage);

    return () => {
      window.removeEventListener(updateEventName, handleCollectionsUpdated);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  return { collections, loading };
}
