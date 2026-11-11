import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { persistQueryClient } from '@tanstack/react-query-persist-client';
import { get, set, del } from 'idb-keyval';
import { Capacitor } from '@capacitor/core';
import { SplashScreen } from '@capacitor/splash-screen';
import { installExternalLinkBlocker } from './utils/externalLinkBlocker.js';

installExternalLinkBlocker();
import { applyRotationMode, getRotationMode } from './utils/rotation.js';
import { RotateToggle } from './components/ui/RotateToggle.jsx';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { AppShell } from './App.jsx';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes fresh data
      gcTime: 1000 * 60 * 60 * 24, // Keep inactive query data for at most one day
      refetchOnWindowFocus: false, // Avoid excessive network hits
      retry: 2,
    },
  },
});

// Configure IndexedDB offline persistence for instant loads on slow networks
const QUERY_CACHE_KEY = 'SOULSTASH_REACT_QUERY_CACHE_V3';
const LEGACY_QUERY_CACHE_KEYS = ['SOULSTASH_REACT_QUERY_CACHE_V2', 'SOULSTASH_REACT_QUERY_CACHE_V1'];
const MAX_PERSISTED_QUERY_CACHE_BYTES = 24 * 1024 * 1024;
const MAX_PERSISTED_QUERY_COUNT = 100;
const legacyCacheCleanup = Promise.all(LEGACY_QUERY_CACHE_KEYS.map((key) => del(key).catch(() => {})));

function boundPersistedQueryClient(client) {
  const originalState = client?.clientState;
  if (!originalState || !Array.isArray(originalState.queries)) return client;

  const recentQueries = [...originalState.queries]
    .filter((query) => !Array.isArray(query?.state?.data?.pages))
    .sort((a, b) => (Number(b?.state?.dataUpdatedAt) || 0) - (Number(a?.state?.dataUpdatedAt) || 0))
    .slice(0, MAX_PERSISTED_QUERY_COUNT);

  while (recentQueries.length >= 0) {
    const bounded = {
      ...client,
      clientState: { ...originalState, queries: recentQueries }
    };
    if (new Blob([JSON.stringify(bounded)]).size <= MAX_PERSISTED_QUERY_CACHE_BYTES) return bounded;
    if (!recentQueries.length) return null;
    recentQueries.pop();
  }
  return null;
}

const idbPersister = {
  persistClient: async (client) => {
    try {
      await legacyCacheCleanup;
      const bounded = boundPersistedQueryClient(client);
      if (!bounded) {
        await del(QUERY_CACHE_KEY);
        return;
      }
      await set(QUERY_CACHE_KEY, bounded);
    } catch (e) {
      console.warn('Failed to persist cache to IndexedDB:', e);
    }
  },
  restoreClient: async () => {
    try {
      await legacyCacheCleanup;
      return await get(QUERY_CACHE_KEY);
    } catch (e) {
      console.warn('Failed to restore cache from IndexedDB:', e);
      return undefined;
    }
  },
  removeClient: async () => {
    try {
      await del(QUERY_CACHE_KEY);
    } catch (e) {
      console.warn('Failed to remove cache from IndexedDB:', e);
    }
  },
};

persistQueryClient({
  queryClient,
  persister: idbPersister,
  maxAge: 1000 * 60 * 60 * 24, // 1 day max cache age
  dehydrateOptions: {
    shouldDehydrateQuery: (query) =>
      query.state.status === 'success' && !Array.isArray(query.state.data?.pages)
  },
});

function RootApp() {
  useEffect(() => {
    // Hide splash screen only after the initial React tree has mounted
    if (Capacitor.isNativePlatform()) {
      SplashScreen.hide().catch(() => {});
      applyRotationMode(getRotationMode());
    }
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <AppShell />
      </BrowserRouter>
      <RotateToggle />
      <ReactQueryDevtools initialIsOpen={false} position="bottom" />
    </QueryClientProvider>
  );
}

let _appRoot = window.__soulstashRoot;
if (!_appRoot) {
  _appRoot = createRoot(document.getElementById('app'));
  window.__soulstashRoot = _appRoot;
}
_appRoot.render(
  <React.StrictMode>
    <RootApp />
  </React.StrictMode>
);
