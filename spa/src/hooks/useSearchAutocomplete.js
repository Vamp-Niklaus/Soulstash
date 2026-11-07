import { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch } from '../api/client.js';
import { mergeSearchResults } from '../utils/formatters.js';
import { getKartoonsSearchQueries, searchKartoonsShows } from '../api/kartoons.js';
import { mergeKartoonsSearchResults } from '../utils/kartoonsSearch.js';

export function useSearchAutocomplete(searchQuery, searchTab, searchOpen, user) {
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [hasNextPage, setHasNextPage] = useState(true);
  const [isFetchingNextPage, setIsFetchingNextPage] = useState(false);

  const currentPageRef = useRef(1);
  const allResultsRef = useRef([]);
  const nextControllerRef = useRef(null);
  const searchCacheRef = useRef(new Map());
  const kartoonResultsRef = useRef(null);

  // adminMode: 0=filter adult, 1=all, 2=adult only
  const adminMode = user?.admin === true ? Number(user?.adminMode ?? (user?.showAdult ? 1 : 0)) : 0;

  // Clear cache if admin/adult settings change
  useEffect(() => {
    searchCacheRef.current.clear();
    setSearchResults([]);
    allResultsRef.current = [];
    kartoonResultsRef.current = null;
  }, [user?.admin, adminMode]);

  useEffect(() => {
    if (!searchOpen || searchQuery.trim().length < 1) {
      nextControllerRef.current?.abort();
      nextControllerRef.current = null;
      setSearchLoading(false);
      setIsFetchingNextPage(false);
      setHasNextPage(false);
      currentPageRef.current = 1;
      allResultsRef.current = [];
      kartoonResultsRef.current = null;
      if (searchQuery.trim().length < 1) {
        setSearchResults([]);
      }
      return undefined;
    }

    let ignore = false;
    const controller = new AbortController();
    nextControllerRef.current?.abort();
    nextControllerRef.current = null;
    currentPageRef.current = 1;
    allResultsRef.current = [];
    kartoonResultsRef.current = null;
    setHasNextPage(true);
    setIsFetchingNextPage(false);

    const cacheKey = `${searchTab}:${searchQuery.trim().toLowerCase()}:${adminMode}:p1`;
    const cached = searchCacheRef.current.get(cacheKey);
    const now = Date.now();
    const cacheTtl = searchTab === 'users' ? 5000 : 30000;

    if (cached && now - cached.timestamp < cacheTtl) {
      allResultsRef.current = cached.results;
      kartoonResultsRef.current = cached.kartoons || null;
      setSearchResults(cached.results);
      setSearchLoading(false);
      setHasNextPage(Boolean(cached.hasMore));
      return undefined;
    }

    setSearchLoading(true);
    setSearchResults([]);

    const timeout = window.setTimeout(async () => {
      try {
        if (searchTab === 'users') {
          const payload = await apiFetch(
            `/api/search/users?q=${encodeURIComponent(searchQuery.trim())}`,
            { signal: controller.signal }
          ).catch(() =>
            apiFetch(`/api/search?q=${encodeURIComponent(searchQuery.trim())}&type=users`, { signal: controller.signal })
          );
          if (!ignore) {
            const rawList = Array.isArray(payload)
              ? payload
              : (Array.isArray(payload?.results) ? payload.results : (Array.isArray(payload?.users) ? payload.users : []));
            const safeResults = rawList.map((u) => ({
              ...u,
              media_type: 'User',
              title: u.username || u.fullName || 'User',
              name: u.fullName || u.username || 'User'
            }));
            allResultsRef.current = safeResults;
            searchCacheRef.current.set(cacheKey, { results: safeResults, hasMore: false, timestamp: Date.now() });
            setSearchResults(safeResults);
            setHasNextPage(false);
          }
          return;
        }

        const endpointType = searchTab === 'cast' ? '&type=cast' : '';
        const queryVariants = searchTab === 'content'
          ? getKartoonsSearchQueries(searchQuery.trim())
          : [searchQuery.trim()];
        const soulResults = await Promise.allSettled(queryVariants.map((query) => apiFetch(
          `/api/search?q=${encodeURIComponent(query)}&limit=20${endpointType}&page=1`,
          { signal: controller.signal }
        )));
        const kartoonResults = searchTab === 'content'
          ? await Promise.allSettled(queryVariants.map((query) => searchKartoonsShows(query, { signal: controller.signal })))
          : [];
        const successfulSoulResults = soulResults.filter((result) => result.status === 'fulfilled');
        const successfulKartoonResults = kartoonResults.filter((result) => result.status === 'fulfilled');
        if (!successfulSoulResults.length && !successfulKartoonResults.length) {
          throw soulResults.find((result) => result.status === 'rejected')?.reason || new Error('Search failed');
        }
        const incomingRaw = successfulSoulResults.flatMap((result) => {
          const payload = result.value;
          return Array.isArray(payload?.results) ? payload.results : (Array.isArray(payload) ? payload : []);
        });
        const kartoonPayload = successfulKartoonResults.length
          ? { data: successfulKartoonResults.flatMap((result) => result.value?.data || []) }
          : null;
        if (!ignore) {
          const incoming = incomingRaw.map((item) => {
            if (searchTab === 'cast') {
              return { ...item, media_type: 'Person' };
            }
            const mType = item.media_type || (item.type === 'tv' || item.first_air_date ? 'Series' : 'Movie');
            return {
              ...item,
              media_type: mType === 'tv' ? 'Series' : mType === 'movie' ? 'Movie' : mType
            };
          });
          const soulResults = mergeSearchResults([], incoming, 400, adminMode);
          kartoonResultsRef.current = kartoonPayload;
          const nextResults = searchTab === 'content'
            ? mergeKartoonsSearchResults(soulResults, kartoonPayload)
            : soulResults;
          allResultsRef.current = nextResults;
          setSearchResults(nextResults);
          const hasMore = incoming.length >= 10;
          setHasNextPage(hasMore);
          searchCacheRef.current.set(cacheKey, {
            results: nextResults,
            kartoons: kartoonPayload,
            hasMore,
            timestamp: Date.now()
          });

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
      nextControllerRef.current?.abort();
      nextControllerRef.current = null;
      window.clearTimeout(timeout);
    };
  }, [user?.admin, adminMode, searchOpen, searchQuery, searchTab]);

  const fetchNextPage = useCallback(async () => {
    if (searchLoading || isFetchingNextPage || !hasNextPage || searchTab === 'users' || searchQuery.trim().length < 1) {
      return;
    }
    if (nextControllerRef.current && !nextControllerRef.current.signal.aborted) return;

    const nextPage = currentPageRef.current + 1;
    setIsFetchingNextPage(true);

    const controller = new AbortController();
    nextControllerRef.current = controller;

    try {
      const endpointType = searchTab === 'cast' ? '&type=cast' : '';
      const payload = await apiFetch(
        `/api/search?q=${encodeURIComponent(searchQuery.trim())}&limit=20${endpointType}&page=${nextPage}`,
        { signal: controller.signal }
      );
      const rawList = Array.isArray(payload?.results) ? payload.results : (Array.isArray(payload) ? payload : []);
      const incoming = rawList.map((item) => {
        if (searchTab === 'cast') {
          return { ...item, media_type: 'Person' };
        }
        const mType = item.media_type || (item.type === 'tv' || item.first_air_date ? 'Series' : 'Movie');
        return {
          ...item,
          media_type: mType === 'tv' ? 'Series' : mType === 'movie' ? 'Movie' : mType
        };
      });
      currentPageRef.current = nextPage;
      if (incoming.length > 0) {
        const mergedPages = mergeSearchResults(allResultsRef.current, incoming, 400, adminMode);
        const nextResults = searchTab === 'content'
          ? mergeKartoonsSearchResults(mergedPages, kartoonResultsRef.current)
          : mergedPages;
        allResultsRef.current = nextResults;
        setSearchResults(nextResults);
      }
      if (incoming.length < 10) {
        setHasNextPage(false);
      }
    } catch (err) {
      if (err?.name !== 'AbortError') {
        console.warn('[Search] fetchNextPage error:', err.message);
      }
    } finally {
      if (nextControllerRef.current === controller) {
        nextControllerRef.current = null;
        setIsFetchingNextPage(false);
      }
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
