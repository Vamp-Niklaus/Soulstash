import { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch, streamApiFetch } from '../api/client.js';
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

          // Always prefetch next 2 pages in advance (page 2 & 3)
          if (hasMore) {
            Promise.allSettled([
              apiFetch(`/api/search?q=${encodeURIComponent(searchQuery.trim())}&limit=20${endpointType}&page=2`, { signal: controller.signal }),
              apiFetch(`/api/search?q=${encodeURIComponent(searchQuery.trim())}&limit=20${endpointType}&page=3`, { signal: controller.signal })
            ]).then(([p2Res, p3Res]) => {
              if (ignore) return;
              const extra = [];
              if (p2Res.status === 'fulfilled') {
                const list2 = Array.isArray(p2Res.value?.results) ? p2Res.value.results : (Array.isArray(p2Res.value) ? p2Res.value : []);
                extra.push(...list2);
              }
              if (p3Res.status === 'fulfilled') {
                const list3 = Array.isArray(p3Res.value?.results) ? p3Res.value.results : (Array.isArray(p3Res.value) ? p3Res.value : []);
                extra.push(...list3);
              }
              if (extra.length) {
                const normalized = extra.map((item) => {
                  if (searchTab === 'cast') return { ...item, media_type: 'Person' };
                  const mType = item.media_type || (item.type === 'tv' || item.first_air_date ? 'Series' : 'Movie');
                  return { ...item, media_type: mType === 'tv' ? 'Series' : mType === 'movie' ? 'Movie' : mType };
                });
                currentPageRef.current = 3;
                const mergedPages = mergeSearchResults(allResultsRef.current, normalized, 400, adminMode);
                allResultsRef.current = searchTab === 'content'
                  ? mergeKartoonsSearchResults(mergedPages, kartoonResultsRef.current)
                  : mergedPages;
                setSearchResults([...allResultsRef.current]);
              }
            }).catch(() => {});
          }
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
      if (incoming.length > 0) {
        itemsReceived = incoming.length;
        const mergedPages = mergeSearchResults(allResultsRef.current, incoming, 400, adminMode);
        const nextResults = searchTab === 'content'
          ? mergeKartoonsSearchResults(mergedPages, kartoonResultsRef.current)
          : mergedPages;
        allResultsRef.current = nextResults;
        setSearchResults(nextResults);

        // Advance prefetch next page as well
        if (incoming.length >= 10) {
          apiFetch(
            `/api/search?q=${encodeURIComponent(searchQuery.trim())}&limit=20${endpointType}&page=${nextPage + 1}`,
            { signal: controller.signal }
          ).then((advPayload) => {
            const advList = Array.isArray(advPayload?.results) ? advPayload.results : [];
            if (advList.length > 0) {
              const advIncoming = advList.map((item) => {
                if (searchTab === 'cast') return { ...item, media_type: 'Person' };
                const mType = item.media_type || (item.type === 'tv' || item.first_air_date ? 'Series' : 'Movie');
                return { ...item, media_type: mType === 'tv' ? 'Series' : mType === 'movie' ? 'Movie' : mType };
              });
              currentPageRef.current = nextPage + 1;
              const mergedAdvance = mergeSearchResults(allResultsRef.current, advIncoming, 400, adminMode);
              allResultsRef.current = searchTab === 'content'
                ? mergeKartoonsSearchResults(mergedAdvance, kartoonResultsRef.current)
                : mergedAdvance;
              setSearchResults([...allResultsRef.current]);
            }
          }).catch(() => {});
        }
      }
      if (incoming.length < 10) {
        setHasNextPage(false);
      }
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
