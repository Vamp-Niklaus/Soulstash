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
        if (searchTab === 'collections') {
          const encodedQuery = encodeURIComponent(searchQuery.trim());
          const [publishedRes, tmdbRes] = await Promise.allSettled([
            apiFetch(`/api/collections/published?q=${encodedQuery}`, { signal: controller.signal }),
            apiFetch(`/api/search/collections?q=${encodedQuery}`, { signal: controller.signal })
          ]);
          if (!ignore) {
            const payload = publishedRes.status === 'fulfilled' ? publishedRes.value : [];
            const list = Array.isArray(payload) ? payload : [];
            const publishedResults = list.map((entry) => {
              const col = entry.collection || {};
              const name = col.name || 'Collection';
              const username = entry.username || '';
              const firstPoster = (Array.isArray(col.movies) ? col.movies : [])
                .map((m) => m?.poster_path || m?.image || '')
                .find((p) => p && p !== 'null');
              return {
                id: `collection-${username}-${name}`,
                media_type: 'Collection',
                source: 'user',
                title: name,
                name,
                username,
                publisher: username,
                overview: col.description || '',
                poster_path: firstPoster || '',
                collectionPath: `/user/${encodeURIComponent(username)}/collection/${encodeURIComponent(name)}`
              };
            });
            const tmdbList = tmdbRes.status === 'fulfilled' && Array.isArray(tmdbRes.value?.results)
              ? tmdbRes.value.results
              : [];
            // TMDB franchises: publisher is the plain label "TMDB" (no user profile link/avatar).
            const tmdbResults = tmdbList.map((c) => ({
              id: `tmdb-collection-${c.id}`,
              tmdbId: c.id,
              media_type: 'Collection',
              source: 'tmdb',
              title: c.name || 'Collection',
              name: c.name || 'Collection',
              publisher: 'TMDB',
              overview: c.overview || '',
              poster_path: c.poster_path || c.backdrop_path || ''
            }));
            const safeResults = [...publishedResults, ...tmdbResults];
            allResultsRef.current = safeResults;
            searchCacheRef.current.set(cacheKey, { results: safeResults, hasMore: false, timestamp: Date.now() });
            setSearchResults(safeResults);
            setHasNextPage(false);
          }
          return;
        }


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
        // Run Soulstash API + Kartoons search in parallel (content tab only)
        const queryVariants = searchTab === 'content'
          ? getKartoonsSearchQueries(searchQuery.trim())
          : [searchQuery.trim()];
        const [soulSettled, kartoonSettled] = await Promise.all([
          Promise.allSettled(queryVariants.map((q) => apiFetch(
            `/api/search?q=${encodeURIComponent(q)}&limit=20${endpointType}&page=1`,
            { signal: controller.signal }
          ))),
          searchTab === 'content'
            ? Promise.allSettled(queryVariants.map((q) => searchKartoonsShows(q, { signal: controller.signal })))
            : Promise.resolve([])
        ]);

        if (!ignore) {
          const incomingRaw = soulSettled
            .filter((r) => r.status === 'fulfilled')
            .flatMap((r) => Array.isArray(r.value?.results) ? r.value.results : (Array.isArray(r.value) ? r.value : []));
          const kartoonPayload = Array.isArray(kartoonSettled) && kartoonSettled.length
            ? { data: kartoonSettled.filter((r) => r.status === 'fulfilled').flatMap((r) => r.value?.data || []) }
            : null;
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
          const soulMerged = mergeSearchResults([], incoming, 400, adminMode);
          kartoonResultsRef.current = kartoonPayload;
          const nextResults = searchTab === 'content'
            ? mergeKartoonsSearchResults(soulMerged, kartoonPayload)
            : soulMerged;
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
      window.clearTimeout(timeout);
    };
  }, [user?.admin, adminMode, searchOpen, searchQuery, searchTab]);

  const fetchNextPage = useCallback(async () => {
    if (searchLoading || isFetchingNextPage || !hasNextPage || searchTab === 'users' || searchQuery.trim().length < 1) {
      return;
    }

    const nextPage = currentPageRef.current + 1;
    setIsFetchingNextPage(true);

    if (nextControllerRef.current) {
      nextControllerRef.current.abort();
    }
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
      if (incoming.length > 0) {
        currentPageRef.current = nextPage;
        const nextResults = mergeSearchResults(allResultsRef.current, incoming, 400, adminMode);
        allResultsRef.current = nextResults;
        setSearchResults(nextResults);
      }
      setHasNextPage(incoming.length >= 10);
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