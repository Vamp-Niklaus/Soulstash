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

    // Always sync from cache immediately — zero flicker on navigation
    const cached = getCachedUserCollections();
    if (cached?.length) applyCollections(cached);

    if (getToken()) {
      loadRatingsTable().catch(() => {});

      if (!hasCollectionCache()) {
        // Truly no cache at all (first load / logged-out) — must fetch
        setLoading(true);
        loadUserCollections()
          .then(applyCollections)
          .catch(() => setLoading(false));
      }
      // If cache exists, loadUserCollections already de-duped and session-flagged —
      // no extra call needed. The event listener below handles any mutations.
    }

    const updateEventName = window.CollectionStore?.COLLECTIONS_UPDATED_EVENT || 'soulstash:collections-updated';

    function handleCollectionsUpdated(event) {
      applyCollections(event.detail?.collections || getCachedUserCollections());
    }

    function handleStorage(event) {
      if (!event.key || !event.key.startsWith('ss_collections_')) return;
      applyCollections(getCachedUserCollections());
    }

    window.addEventListener(updateEventName, handleCollectionsUpdated);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(updateEventName, handleCollectionsUpdated);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  return { collections, loading };
}
