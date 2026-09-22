import { useState, useEffect, useRef } from 'react';
import { apiFetch, streamApiFetch } from '../api/client.js';
import { mergeSearchResults } from '../utils/formatters.js';

export function useSearchAutocomplete(searchQuery, searchTab, searchOpen, user) {
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchCacheRef = useRef(new Map());

  // adminMode: 0=filter adult, 1=all, 2=adult only
  const adminMode = user?.admin === true ? Number(user?.adminMode ?? (user?.showAdult ? 1 : 0)) : 0;

  // Clear cache if admin/adult settings change
  useEffect(() => {
    searchCacheRef.current.clear();
    setSearchResults([]);
  }, [user?.admin, adminMode]);

  useEffect(() => {
    if (!searchOpen || searchQuery.trim().length < 1) {
      setSearchLoading(false);
      if (searchQuery.trim().length < 1) {
        setSearchResults([]);
      }
      return undefined;
    }

    let ignore = false;
    const controller = new AbortController();
    const cacheKey = `${searchTab}:${searchQuery.trim().toLowerCase()}:${adminMode}`;
    const cached = searchCacheRef.current.get(cacheKey);
    const now = Date.now();
    const cacheTtl = searchTab === 'users' ? 5000 : 30000;
    
    if (cached && now - cached.timestamp < cacheTtl) {
      setSearchResults(cached.results);
      setSearchLoading(false);
      return undefined;
    }
    
    setSearchLoading(true);
    setSearchResults([]);
    
    const timeout = window.setTimeout(async () => {
      try {
        if (searchTab !== 'users') {
          const streamedResults = [];
          await streamApiFetch(
            `/api/search?q=${encodeURIComponent(searchQuery.trim())}&limit=20&type=${encodeURIComponent(searchTab)}&stream=1`,
            {
              signal: controller.signal,
              onEvent(event) {
                if (ignore || event?.query !== searchQuery.trim() || event?.type !== 'results'){
                    return;
                }
                const incoming = Array.isArray(event.results) ? event.results : [];
                const nextResults = mergeSearchResults(streamedResults, incoming, 40, adminMode);
                streamedResults.splice(0, streamedResults.length, ...nextResults);
                searchCacheRef.current.set(cacheKey, { results: nextResults, timestamp: Date.now() });
                setSearchResults(nextResults);
                setSearchLoading(false);
              }
            }
          );
          if (!ignore) {
            setSearchLoading(false);
          }
          return;
        }

        const payload = await apiFetch(
          `/api/search?q=${encodeURIComponent(searchQuery.trim())}&limit=20&type=${encodeURIComponent(searchTab)}`
        );
        if (!ignore) {
          const results = Array.isArray(payload?.results) ? payload.results : [];
          const safeResults = mergeSearchResults([], results, 20, adminMode);
          searchCacheRef.current.set(cacheKey, { results: safeResults, timestamp: Date.now() });
          setSearchResults(safeResults);
        }
      } catch (error) {
        if (error?.name === 'AbortError') return;
        if (!ignore) {
          setSearchResults([]);
        }
      } finally {
        if (!ignore) {
          setSearchLoading(false);
        }
      }
    }, 220);
    return () => {
      ignore = true;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [user?.admin, adminMode, searchOpen, searchQuery, searchTab]);

  return { searchResults, searchLoading };
}
