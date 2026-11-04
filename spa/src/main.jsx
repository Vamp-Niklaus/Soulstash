import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { persistQueryClient } from '@tanstack/react-query-persist-client';
import { get, set, del } from 'idb-keyval';
import { Capacitor } from '@capacitor/core';
import { SplashScreen } from '@capacitor/splash-screen';
import { ScreenOrientation } from '@capacitor/screen-orientation';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { AppShell } from './App.jsx';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes fresh data
      gcTime: 1000 * 60 * 60 * 24 * 7, // 7 days cache retention in memory/IndexedDB
      refetchOnWindowFocus: false, // Avoid excessive network hits
      retry: 2,
    },
  },
});

// Configure IndexedDB offline persistence for instant loads on slow networks
const idbPersister = {
  persistClient: async (client) => {
    try {
      await set('SOULSTASH_REACT_QUERY_CACHE_V2', client);
    } catch (e) {
      console.warn('Failed to persist cache to IndexedDB:', e);
    }
  },
  restoreClient: async () => {
    try {
      return await get('SOULSTASH_REACT_QUERY_CACHE_V2');
    } catch (e) {
      console.warn('Failed to restore cache from IndexedDB:', e);
      return undefined;
    }
  },
  removeClient: async () => {
    try {
      await del('SOULSTASH_REACT_QUERY_CACHE_V2');
    } catch (e) {
      console.warn('Failed to remove cache from IndexedDB:', e);
    }
  },
};

persistQueryClient({
  queryClient,
  persister: idbPersister,
  maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days max cache age
});

function RootApp() {
  useEffect(() => {
    // Hide splash screen only after the initial React tree has mounted
    if (Capacitor.isNativePlatform()) {
      SplashScreen.hide().catch(() => {});
      const rot = localStorage.getItem('ss_rotation_mode') || 'sensor';
      if (rot === 'portrait') {
        ScreenOrientation.lock({ orientation: 'portrait' }).catch(() => {});
      } else if (rot === 'landscape') {
        ScreenOrientation.lock({ orientation: 'landscape' }).catch(() => {});
      } else {
        ScreenOrientation.unlock().catch(() => {});
      }
    }
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <AppShell />
      </BrowserRouter>
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
