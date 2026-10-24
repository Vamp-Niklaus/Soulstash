import { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch, streamApiFetch } from '../api/client.js';
import { mergeSearchResults } from '../utils/formatters.js';

export function useSearchAutocomplete(searchQuery, searchTab, searchOpen, user) {
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [hasNextPage, setHasNextPage] = useState(true);
  const [isFetchingNextPage, setIsFetchingNextPage] = useState(false);

  const currentPageRef = useRef(1);
  const allResultsRef = useRef([]);
  const nextControllerRef = useRef(null);
  const searchCacheRef = useRef(new Map());

  // adminMode: 0=filter adult, 1=all, 2=adult only
  const adminMode = user?.admin === true ? Number(user?.adminMode ?? (user?.showAdult ? 1 : 0)) : 0;

  // Clear cache if admin/adult settings change
  useEffect(() => {
    searchCacheRef.current.clear();
    setSearchResults([]);
    allResultsRef.current = [];
  }, [user?.admin, adminMode]);

  useEffect(() => {
    if (!searchOpen || searchQuery.trim().length < 1) {
      setSearchLoading(false);
      setIsFetchingNextPage(false);
      setHasNextPage(false);
      currentPageRef.current = 1;
      allResultsRef.current = [];
      if (searchQuery.trim().length < 1) {
        setSearchResults([]);
      }
      return undefined;
    }

    let ignore = false;
    const controller = new AbortController();
    currentPageRef.current = 1;
    allResultsRef.current = [];
    setHasNextPage(true);
    setIsFetchingNextPage(false);

    const cacheKey = `${searchTab}:${searchQuery.trim().toLowerCase()}:${adminMode}:p1`;
    const cached = searchCacheRef.current.get(cacheKey);
    const now = Date.now();
    const cacheTtl = searchTab === 'users' ? 5000 : 30000;

    if (cached && now - cached.timestamp < cacheTtl) {
      allResultsRef.current = cached.results;
      setSearchResults(cached.results);
      setSearchLoading(false);
      setHasNextPage(Boolean(cached.hasMore));
      return undefined;
    }

    setSearchLoading(true);
    setSearchResults([]);

    const timeout = window.setTimeout(async () => {
      try {
        if (searchTab !== 'users') {
          await streamApiFetch(
            `/api/search?q=${encodeURIComponent(searchQuery.trim())}&limit=20&type=${encodeURIComponent(searchTab)}&page=1&stream=1`,
            {
              signal: controller.signal,
              onEvent(event) {
                if (ignore || event?.query !== searchQuery.trim()) return;
                if (event?.type === 'results') {
                  const incoming = Array.isArray(event.results) ? event.results : [];
                  const nextResults = mergeSearchResults(allResultsRef.current, incoming, 400, adminMode);
                  allResultsRef.current = nextResults;
                  setSearchResults(nextResults);
                  setSearchLoading(false);
                } else if (event?.type === 'done') {
                  if (event.hasMore === false) {
                    setHasNextPage(false);
                  }
                  searchCacheRef.current.set(cacheKey, {
                    results: allResultsRef.current,
                    hasMore: event?.hasMore !== false,
                    timestamp: Date.now()
                  });
                }
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
          const safeResults = mergeSearchResults([], results, 40, adminMode);
          allResultsRef.current = safeResults;
          searchCacheRef.current.set(cacheKey, { results: safeResults, hasMore: false, timestamp: Date.now() });
          setSearchResults(safeResults);
          setHasNextPage(false);
        }
      } catch (error) {
        if (error?.name === 'AbortError') return;
        if (!ignore) {
          setSearchResults([]);
          allResultsRef.current = [];
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

  const fetchNextPage = useCallback(async () => {
    if (searchLoading || isFetchingNextPage || !hasNextPage || searchTab === 'users' || searchQuery.trim().length < 1) {
      return;
    }

    const nextPage = currentPageRef.current + 1;
    currentPageRef.current = nextPage;
    setIsFetchingNextPage(true);

    if (nextControllerRef.current) {
      nextControllerRef.current.abort();
    }
    const controller = new AbortController();
    nextControllerRef.current = controller;

    let itemsReceived = 0;
    try {
      await streamApiFetch(
        `/api/search?q=${encodeURIComponent(searchQuery.trim())}&limit=20&type=${encodeURIComponent(searchTab)}&page=${nextPage}&stream=1`,
        {
          signal: controller.signal,
          onEvent(event) {
            if (event?.query !== searchQuery.trim()) return;
            if (event?.type === 'results') {
              const incoming = Array.isArray(event.results) ? event.results : [];
              if (incoming.length > 0) {
                itemsReceived += incoming.length;
                const nextResults = mergeSearchResults(allResultsRef.current, incoming, 400, adminMode);
                allResultsRef.current = nextResults;
                setSearchResults(nextResults);
              }
            } else if (event?.type === 'done') {
              if (event.hasMore === false || itemsReceived === 0) {
                setHasNextPage(false);
              }
            }
          }
        }
      );
    } catch (err) {
      if (err?.name !== 'AbortError') {
        console.warn('[Search] fetchNextPage error:', err.message);
      }
    } finally {
      setIsFetchingNextPage(false);
    }
  }, [searchLoading, isFetchingNextPage, hasNextPage, searchTab, searchQuery, adminMode]);

  return {
    searchResults,
    searchLoading,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage
  };
}
