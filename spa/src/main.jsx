import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  BrowserRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams
} from 'react-router-dom';
import '@videojs/react/video/skin.css';
import { createPlayer, videoFeatures } from '@videojs/react';
import { VideoSkin, Video } from '@videojs/react/video';
import './styles.css';
import { useTvFocus } from './tvNav.js';
import { Capacitor } from '@capacitor/core';
import { ScreenOrientation } from '@capacitor/screen-orientation';
import { App as CapacitorApp } from '@capacitor/app';


// Dynamic API URL resolution for Capacitor/App environment
const API_BASE_URL = (() => {
  // If we are running on the actual production web site, we use relative paths
  if (window.location.hostname === 'soulstash.onrender.com') {
    return '';
  }
  // If we are running on local dev ports (3000, 3001, 5173), we use relative paths
  if (
    window.location.hostname === 'localhost' &&
    (window.location.port === '5173' || window.location.port === '3000' || window.location.port === '3001')
  ) {
    return '';
  }
  // In all other cases (Capacitor app, local file, custom android scheme, etc.), call the production backend URL
  return 'https://soulstash.onrender.com';
})();

// Intercept window.fetch globally to rewrite relative API URLs to absolute URLs in the app
const originalFetch = window.fetch;
window.fetch = function (input, init) {
  let url = typeof input === 'string' ? input : input.url;

  if (typeof url === 'string' && url.startsWith('/api/')) {
    url = `${API_BASE_URL}${url}`;
  }

  if (typeof input === 'string') {
    return originalFetch(url, init);
  } else {
    const newRequest = new Request(url, input);
    return originalFetch(newRequest, init);
  }
};

const IMAGE_BASE = 'https://image.tmdb.org/t/p';
const FALLBACK_AVATAR = '/images/avatar.png';
const CREDIT_PAGE_SIZE = 24;
const HOME_TRENDING_TTL = 60 * 60 * 1000;
const AUTO_RECOVERY_RETRIES = 3;
const HOME_GRID_CLASS = 'grid grid-flow-col auto-cols-[32%] sm:auto-cols-[22%] gap-3 overflow-x-auto snap-x snap-mandatory hide-scrollbar pb-2 md:grid-flow-row md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 md:auto-cols-auto md:pb-0 md:snap-none md:overflow-visible';
const PUBLISH_MIN_COLLECTION_TITLES = 6;

const homeTrendingCache = {
  data: null,
  promise: null,
  expiresAt: 0
};

const apiResponseCache = new Map();
const API_CACHE_TTL = 5 * 60 * 1000;
const COLLECTION_NAME_MAX_LENGTH = 25;
const ratingsTableCache = {
  data: null,
  promise: null,
  expiresAt: 0
};
const RATINGS_TABLE_TTL = 30 * 60 * 1000;
const MAX_TRUSTED_RATING = 9.39;
const COLLECTIONS_CACHE_KEY = 'ss_collections_cache_v1';
const COLLECTIONS_TRASH_CACHE_KEY = 'ss_collections_trash_v1';
let lastKnownCollectionVersion = null;

// Synchronously clear collection caches on hard reload (Ctrl+R / F5).
// This MUST run at module-load time Ã¢â‚¬â€ before any component reads localStorage Ã¢â‚¬â€
// so that useLiveCollections never serves stale cache on a reload.
try {
  const navEntry = performance.getEntriesByType('navigation')[0];
  const isHardReload = navEntry?.type === 'reload' || performance?.navigation?.type === 1;
  if (isHardReload) {
    localStorage.removeItem(COLLECTIONS_CACHE_KEY);
    localStorage.removeItem(COLLECTIONS_TRASH_CACHE_KEY);
  }
} catch {}

const VideoJsPlayer = createPlayer({ features: videoFeatures });

function createEmptyCollectionDraft() {
  return {
    name: '',
    description: '',
    isPublic: false
  };
}

function toast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (container) {
    const topOffset = window.innerWidth < 1024 ? 56 : 62;
    container.style.top = `${topOffset}px`;
    container.style.left = '16px';
    container.style.right = '16px';
    container.style.bottom = '16px';
    container.style.zIndex = '9999';
    container.style.pointerEvents = 'none';
  }
  if (typeof window.showToast === 'function') {
    window.showToast(message, type);
    return;
  }
  if (typeof window.showBackendToast === 'function') {
    window.showBackendToast(message, type);
    return;
  }

  let fallbackContainer = document.getElementById('react-toast-fallback');
  if (!fallbackContainer) {
    fallbackContainer = document.createElement('div');
    fallbackContainer.id = 'react-toast-fallback';
    fallbackContainer.style.cssText =
      `position:fixed;top:${window.innerWidth < 1024 ? 56 : 62}px;left:16px;right:16px;z-index:9999;pointer-events:none;display:flex;flex-direction:column;align-items:flex-end;gap:10px;`;
    document.body.appendChild(fallbackContainer);
  } else {
    fallbackContainer.style.top = `${window.innerWidth < 1024 ? 56 : 62}px`;
  }

  const toastNode = document.createElement('div');
  const accent = type === 'error' ? '#EF4444' : type === 'info' ? '#3B82F6' : '#10B981';
  toastNode.style.cssText =
    `pointer-events:auto;max-width:min(500px,100%);background:#1F1F1F;color:#E2E2E2;border:1px solid #252833;border-radius:12px;padding:17px 20px;box-shadow:0 16px 40px rgba(0,0,0,0.35);font-size:17px;line-height:1.55;display:flex;align-items:center;gap:14px;`;

  const iconWrap = document.createElement('span');
  iconWrap.style.cssText =
    `flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:999px;background:${accent};color:#ffffff;font-size:13px;font-weight:700;`;
  if (type === 'error') {
    iconWrap.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
  } else if (type === 'info') {
    iconWrap.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 8v4"></path><path d="M12 16h.01"></path></svg>';
  } else {
    iconWrap.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
  }


  const messageNode = document.createElement('span');
  messageNode.style.cssText = 'display:block;min-width:0;font-size:17px;line-height:1.55;font-weight:500;';
  messageNode.textContent = String(message || '');

  toastNode.appendChild(iconWrap);
  toastNode.appendChild(messageNode);
  fallbackContainer.appendChild(toastNode);
  window.setTimeout(() => {
    toastNode.remove();
    if (fallbackContainer && !fallbackContainer.childElementCount) {
      fallbackContainer.remove();
    }
  }, 3200);
}

function getToken() {
  return localStorage.getItem('userToken');
}

function getCurrentUsername() {
  try {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    return user.username || '';
  } catch {
    return '';
  }
}

function emitAuthChange() {
  window.dispatchEvent(new CustomEvent('soulstash:auth-changed'));
}

function clearClientDataCaches() {
  apiResponseCache.clear();
  homeTrendingCache.data = null;
  homeTrendingCache.promise = null;
  homeTrendingCache.expiresAt = 0;
}

function clearAuthSession() {
  clearClientDataCaches();
  localStorage.removeItem('userToken');
  localStorage.removeItem('user');
  emitAuthChange();
}

function saveAuthSession(token, user) {
  clearClientDataCaches();
  localStorage.setItem('userToken', token);
  localStorage.setItem('user', JSON.stringify(user));
  emitAuthChange();
}

function navigateWithoutReload(to, options = {}) {
  if (typeof window.soulstashNavigate === 'function') {
    window.soulstashNavigate(to, options);
    return;
  }

  if (options.replace) {
    window.history.replaceState(null, '', to);
  } else {
    window.history.pushState(null, '', to);
  }

  try {
    window.dispatchEvent(new PopStateEvent('popstate'));
  } catch {
    window.dispatchEvent(new Event('popstate'));
  }
}

function useAuthSession() {
  const [session, setSession] = useState(() => {
    const token = getToken();
    const username = getCurrentUsername();
    return {
      token,
      username,
      isLoggedIn: Boolean(token && username),
      user: (() => {
        try {
          return JSON.parse(localStorage.getItem('user') || '{}');
        } catch {
          return {};
        }
      })()
    };
  });

  useEffect(() => {
    function syncSession() {
      const token = getToken();
      const username = getCurrentUsername();
      let user = {};
      try {
        user = JSON.parse(localStorage.getItem('user') || '{}');
      } catch {}
      setSession({
        token,
        username,
        isLoggedIn: Boolean(token && username),
        user
      });
    }

    window.addEventListener('storage', syncSession);
    window.addEventListener('soulstash:auth-changed', syncSession);
    return () => {
      window.removeEventListener('storage', syncSession);
      window.removeEventListener('soulstash:auth-changed', syncSession);
    };
  }, []);

  return session;
}

function useSessionState(key, initialValue) {
  const [state, setState] = useState(() => {
    try {
      const raw = sessionStorage.getItem(key);
      if (raw != null) {
        return JSON.parse(raw);
      }
    } catch {}
    return typeof initialValue === 'function' ? initialValue() : initialValue;
  });

  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(state));
    } catch {}
  }, [key, state]);

  return [state, setState];
}

function readCollectionsCache() {
  try {
    const raw = localStorage.getItem(COLLECTIONS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.collections)) return null;
    return {
      collections: parsed.collections,
      version: Number.isFinite(Number(parsed.version)) ? Number(parsed.version) : 0,
      fetchedAt: Number(parsed.fetchedAt) || 0
    };
  } catch {
    return null;
  }
}

function writeCollectionsCache(collections, version) {
  try {
    const resolvedVersion = Number.isFinite(Number(version)) ? Number(version) : 0;
    localStorage.setItem(
      COLLECTIONS_CACHE_KEY,
      JSON.stringify({
        collections,
        version: resolvedVersion,
        fetchedAt: Date.now()
      })
    );
    lastKnownCollectionVersion = resolvedVersion;
  } catch {}
}

function updateCollectionsCache(collections, version) {
  if (!Array.isArray(collections)) return;
  const existing = readCollectionsCache();
  const resolvedVersion = Number.isFinite(Number(version))
    ? Number(version)
    : (Number.isFinite(Number(existing?.version)) ? Number(existing.version) : 0);
  writeCollectionsCache(collections, resolvedVersion);
}

function getCachedCollectionVersion() {
  const cached = readCollectionsCache();
  return Number.isFinite(Number(cached?.version)) ? Number(cached.version) : 0;
}

function optimisticRemoveCollectionFromCache(collectionId) {
  const current = normalizeCollections(getCachedUserCollections());
  const id = String(collectionId);
  const next = current.filter(
    (collection) => String(collection._id || collection.name) !== id && String(collection.name) !== id
  );
  broadcastCollections(next, lastKnownCollectionVersion);
  return current;
}

function optimisticUpdateCollectionItems(collectionId, updateFn) {
  const current = normalizeCollections(getCachedUserCollections());
  const id = String(collectionId);
  const next = current.map((collection) => {
    if (String(collection._id || collection.name) !== id && String(collection.name) !== id) return collection;
    const movies = Array.isArray(collection.movies) ? collection.movies : [];
    const updated = updateFn(movies);
    return { ...collection, movies: updated, movieCount: updated.length };
  });
  broadcastCollections(next, lastKnownCollectionVersion);
  return current;
}


// Ã¢â€â‚¬Ã¢â€â‚¬ Item-level trash cache Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Trash entries: { collectionId, collectionName, item, removedAt }
function readTrashCache() {
  try {
    const raw = localStorage.getItem(COLLECTIONS_TRASH_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeTrashCache(entries) {
  try {
    localStorage.setItem(COLLECTIONS_TRASH_CACHE_KEY, JSON.stringify(entries));
  } catch {}
}

/**
 * Optimistically remove an item from the collections cache and place it in
 * the trash cache tagged with the collection it came from.
 * Returns the original collections snapshot so callers can rollback.
 */
function trashItemFromCollectionCache(collectionId, itemId) {
  const current = normalizeCollections(getCachedUserCollections());
  const id = String(collectionId);
  let trashedItem = null;
  let collectionName = '';

  const next = current.map((collection) => {
    const isTarget =
      String(collection._id || collection.name) === id ||
      String(collection.name) === id;
    if (!isTarget) return collection;
    collectionName = collection.name || '';
    const movies = Array.isArray(collection.movies) ? collection.movies : [];
    const remaining = movies.filter((m) => {
      const mid = Number(m.movieId || m.seriesId || m.id || m._id || 0);
      if (mid === Number(itemId)) {
        trashedItem = m;
        return false;
      }
      return true;
    });
    return { ...collection, movies: remaining, movieCount: remaining.length };
  });

  if (trashedItem) {
    const trash = readTrashCache();
    trash.push({
      collectionId: id,
      collectionName,
      item: trashedItem,
      removedAt: Date.now()
    });
    writeTrashCache(trash);
  }

  broadcastCollections(next, lastKnownCollectionVersion);
  return current; // snapshot for rollback
}

/**
 * Permanently remove a trash entry (backend confirmed deletion).
 */
function confirmTrashItem(collectionId, itemId) {
  const trash = readTrashCache();
  const filtered = trash.filter(
    (t) =>
      !(
        String(t.collectionId) === String(collectionId) &&
        Number(t.item?.movieId || t.item?.seriesId || t.item?.id || t.item?._id || 0) === Number(itemId)
      )
  );
  writeTrashCache(filtered);
}

/**
 * Restore a trashed item back to the collections cache (backend failure rollback).
 */
function restoreTrashItem(collectionId, itemId) {
  const trash = readTrashCache();
  const entryIdx = trash.findIndex(
    (t) =>
      String(t.collectionId) === String(collectionId) &&
      Number(t.item?.movieId || t.item?.seriesId || t.item?.id || t.item?._id || 0) === Number(itemId)
  );
  if (entryIdx === -1) return;

  const [entry] = trash.splice(entryIdx, 1);
  writeTrashCache(trash);

  // Re-insert item back into the live cache
  const current = normalizeCollections(getCachedUserCollections());
  const id = String(collectionId);
  const next = current.map((collection) => {
    const isTarget =
      String(collection._id || collection.name) === id ||
      String(collection.name) === id;
    if (!isTarget) return collection;
    const movies = Array.isArray(collection.movies) ? collection.movies : [];
    // Avoid duplicates in case it was already restored by a broadcast
    const alreadyPresent = movies.some(
      (m) =>
        Number(m.movieId || m.seriesId || m.id || m._id || 0) ===
        Number(entry.item?.movieId || entry.item?.seriesId || entry.item?.id || entry.item?._id || 0)
    );
    const restored = alreadyPresent ? movies : [...movies, entry.item];
    return { ...collection, movies: restored, movieCount: restored.length };
  });
  broadcastCollections(next, lastKnownCollectionVersion);
}
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(path, { ...options, headers });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      clearAuthSession();
      if (!['/login', '/register'].includes(window.location.pathname)) {
        navigateWithoutReload('/login', { replace: true });
      }
    }
    const payload = await response.json().catch(() => ({}));
    const error = new Error(payload.error || `Request failed with status ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return response.json();
}

async function streamApiFetch(path, options = {}) {
  const token = getToken();
  const headers = {
    ...(options.headers || {})
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const { signal, onEvent } = options;
  const response = await fetch(path, { signal, headers });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      clearAuthSession();
      if (!['/login', '/register'].includes(window.location.pathname)) {
        navigateWithoutReload('/login', { replace: true });
      }
    }
    const payload = await response.json().catch(() => ({}));
    const error = new Error(payload.error || `Request failed with status ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.trim()) {
          try {
            const parsed = JSON.parse(line);
            onEvent?.(parsed);
          } catch (e) {
            console.warn('Failed to parse streaming line:', line, e);
          }
        }
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      try {
        onEvent?.(JSON.parse(buffer.trim()));
      } catch (e) {
        console.warn('Failed to parse streaming line:', buffer, e);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function cachedApiFetch(path, options = {}, ttl = API_CACHE_TTL) {
  const method = String(options.method || 'GET').toUpperCase();
  if (method !== 'GET') {
    return apiFetch(path, options);
  }

  const cacheKey = `${method}:${path}`;
  const now = Date.now();
  const cached = apiResponseCache.get(cacheKey);

  if (cached?.data && cached.expiresAt > now) {
    return cached.data;
  }

  if (cached?.promise) {
    return cached.promise;
  }

  const request = apiFetch(path, options)
    .then((data) => {
      apiResponseCache.set(cacheKey, {
        data,
        expiresAt: Date.now() + ttl
      });
      return data;
    })
    .finally(() => {
      const latest = apiResponseCache.get(cacheKey);
      if (latest?.promise) {
        apiResponseCache.set(cacheKey, {
          data: latest.data,
          expiresAt: latest.expiresAt || 0
        });
      }
    });

  apiResponseCache.set(cacheKey, {
    promise: request,
    data: cached?.data || null,
    expiresAt: cached?.expiresAt || 0
  });

  return request;
}

function optimisticSetCollectionMembership(collectionName, item, shouldInclude, options = {}) {
  const current = normalizeCollections(getCachedUserCollections());
  const targetId = String(collectionName);
  const itemContentId = contentIdFromItem(item);
  const exclusiveCollections = shouldInclude ? new Set(options.exclusiveCollections || []) : new Set();
  const next = current.map((collection) => {
    const collectionId = String(collection._id || collection.name);
    const movies = Array.isArray(collection.movies) ? collection.movies : [];
    const hasItem = movies.some((entry) => contentIdFromItem(entry) === itemContentId);

    if (collectionId === targetId || String(collection.name) === targetId) {
      if (shouldInclude) {
        if (hasItem) return collection;
        const updated = [...movies, item];
        return { ...collection, movies: updated, movieCount: updated.length };
      }
      if (!hasItem) return collection;
      const updated = movies.filter((entry) => contentIdFromItem(entry) !== itemContentId);
      return { ...collection, movies: updated, movieCount: updated.length };
    }

    if (!exclusiveCollections.has(collection.name) || !hasItem) return collection;
    const updated = movies.filter((entry) => contentIdFromItem(entry) !== itemContentId);
    return { ...collection, movies: updated, movieCount: updated.length };
  });
  broadcastCollections(next, lastKnownCollectionVersion);
  return current;
}

async function refreshCollectionsView() {
  const latestCollections = normalizeCollections(await loadUserCollections());
  window.dispatchEvent(
    new CustomEvent(window.CollectionStore?.COLLECTIONS_UPDATED_EVENT || 'soulstash:collections-updated', {
      detail: { collections: latestCollections }
    })
  );
  return latestCollections;
}

async function fetchUserCollectionsWithVersion(cached) {
  const token = getToken();
  if (!token) {
    return { collections: [], version: 0 };
  }

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`
  };
  if (cached?.version != null) {
    headers['X-Collection-Version'] = String(cached.version);
  }

  const response = await fetch('/api/user/collections', { headers });
  if (response.status === 304 && cached) {
    return { collections: cached.collections, version: cached.version, fromCache: true };
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const error = new Error(payload.error || `Request failed with status ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  const data = await response.json();
  const versionHeader = response.headers.get('x-collection-version');
  const version = Number.isFinite(Number(versionHeader)) ? Number(versionHeader) : (cached?.version || 0);
  updateCollectionsCache(data, version);
  return { collections: data, version };
}


async function loadTrendingHome(force = false) {
  const now = Date.now();

  if (!force && homeTrendingCache.data && homeTrendingCache.expiresAt > now) {
    return homeTrendingCache.data;
  }

  if (!force && homeTrendingCache.promise) {
    return homeTrendingCache.promise;
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 7000);
  const request = apiFetch('/api/trending?limit=18', { signal: controller.signal })
    .then((data) => {
      const arr = Array.isArray(data?.movies) ? data.movies : (Array.isArray(data) ? data : []);
      homeTrendingCache.data = arr;
      homeTrendingCache.expiresAt = Date.now() + HOME_TRENDING_TTL;
      return arr;
    })
    .catch((error) => {
      if (homeTrendingCache.data) return homeTrendingCache.data;
      console.warn('[Soulstash][React] Home trending unavailable', {
        message: error?.message,
        status: error?.status
      });
      return [];
    })
    .finally(() => {
      window.clearTimeout(timeout);
      homeTrendingCache.promise = null;
    });

  homeTrendingCache.promise = request;
  return request;
}

async function loadUserCollections() {
  if (window.CollectionStore?.getCollections) {
    return window.CollectionStore.getCollections();
  }
  if (!getToken()) return [];

  const cached = readCollectionsCache();
  if (cached?.collections?.length) {
    if (!navigator.onLine) {
      return cached.collections;
    }
    try {
      const response = await fetchUserCollectionsWithVersion(cached);
      return response.collections;
    } catch {
      return cached.collections;
    }
  }

  try {
    const response = await fetchUserCollectionsWithVersion(null);
    return response.collections;
  } catch {
    return [];
  }
}

async function loadRatingsTable(force = false) {
  if (!getToken()) return [];

  const now = Date.now();
  if (!force && ratingsTableCache.data && ratingsTableCache.expiresAt > now) {
    return ratingsTableCache.data;
  }
  if (!force && ratingsTableCache.promise) {
    return ratingsTableCache.promise;
  }

  const request = apiFetch('/api/ratings?limit=5000')
    .then((payload) => {
      const items = Array.isArray(payload?.items) ? payload.items : [];
      ratingsTableCache.data = items;
      ratingsTableCache.expiresAt = Date.now() + RATINGS_TABLE_TTL;
      return items;
    })
    .finally(() => {
      ratingsTableCache.promise = null;
    });

  ratingsTableCache.promise = request;
  return request;
}

function ratingsCacheKey(tmdbID, mediaType) {
  return `${normalizeMediaType(mediaType)}:${Number(tmdbID)}`;
}

function getRatingsCacheMap() {
  return new Map((ratingsTableCache.data || []).map((item) => [ratingsCacheKey(item.tmdbID, item.mediaType), item]));
}

function mergeRatingsTableCache(items) {
  if (!Array.isArray(items) || !items.length) return ratingsTableCache.data || [];
  const merged = new Map(getRatingsCacheMap());
  items.forEach((item) => {
    merged.set(ratingsCacheKey(item.tmdbID, item.mediaType), item);
  });
  ratingsTableCache.data = Array.from(merged.values());
  ratingsTableCache.expiresAt = Date.now() + RATINGS_TABLE_TTL;
  return ratingsTableCache.data;
}

function getCachedUserCollections() {
  if (window.CollectionStore?.getCachedCollections) {
    return window.CollectionStore.getCachedCollections() || [];
  }
  const cached = readCollectionsCache();
  return Array.isArray(cached?.collections) ? cached.collections : [];
}

function normalizeCollection(collection) {
  const movies = Array.isArray(collection?.movies) ? collection.movies : [];
  return {
    ...collection,
    _id: collection?._id || collection?.name,
    name: collection?.name || '',
    movies,
    movieCount: movies.length,
    isPublished: collection?.isPublished === true
  };
}

function collectionItemCount(collection) {
  if (!collection) return 0;
  if (Number.isFinite(Number(collection.movieCount))) return Number(collection.movieCount) || 0;
  if (Array.isArray(collection.movies)) return collection.movies.length;
  return 0;
}

function normalizeCollections(collections) {
  return Array.isArray(collections) ? collections.map(normalizeCollection) : [];
}

function hasCollectionCache() {
  if (window.CollectionStore?.hasCollectionsCache?.()) return true;
  return !!readCollectionsCache();
}

function contentIdFromItem(item) {
  return Number(item?.contentId || item?.movieId || item?.seriesId || item?.tmdbId || item?.id || 0);
}

function normalizeMediaType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['tv', 'series', 'show'].includes(normalized)) return 'Series';
  if (['movie', 'movies', 'film'].includes(normalized)) return 'Movie';
  return value || '';
}

function mediaTypeFromItem(item) {
  return normalizeMediaType(
    item?.media_type ||
      item?.mediaType ||
      item?.type ||
      (item?.seriesId ? 'Series' : '') ||
      (item?.movieId ? 'Movie' : '') ||
      (!item?.release_date && item?.first_air_date ? 'Series' : '') ||
      (item?.title || item?.release_date ? 'Movie' : '')
  );
}

function collectionItemKey(item) {
  return `${mediaTypeFromItem(item)}:${contentIdFromItem(item)}`;
}

function creditItemKey(item) {
  return `${mediaTypeFromItem(item)}:${Number(item?.id || item?.movieId || item?.seriesId || item?.contentId || 0)}`;
}

function creditMatchesCollectionItem(credit, collectionItem) {
  const creditId = contentIdFromItem(credit);
  const collectionId = contentIdFromItem(collectionItem);
  if (!creditId || !collectionId || creditId !== collectionId) return false;

  const creditType = mediaTypeFromItem(credit);
  const collectionType = mediaTypeFromItem(collectionItem);
  if (!creditType || !collectionType) return true;
  return creditType === collectionType;
}

function filterCreditsByCollectionItems(credits, collection, debugLabel = '', debugEnabled = true) {
  const collectionItems = Array.isArray(collection?.movies) ? collection.movies : [];
  if (!collectionItems.length) return [];
  return credits.filter((credit) => {
    const matchedItem = collectionItems.find((item) => creditMatchesCollectionItem(credit, item));
    if (debugEnabled && debugLabel && matchedItem) {
      console.log(
        `${debugLabel} cast "${credit?.title || credit?.name || 'Unknown'}" (${mediaTypeFromItem(credit)} ${contentIdFromItem(credit)}) matches collection "${matchedItem?.title || matchedItem?.name || 'Unknown'}" (${mediaTypeFromItem(matchedItem)} ${contentIdFromItem(matchedItem)})`
      );
    }
    return !!matchedItem;
  });
}

function getValidImdbRating(value) {
  const rating = Number(value);
  if (!Number.isFinite(rating) || rating <= 0 || rating === 10 || rating >= 9.4) return null;
  return rating;
}

function getValidVoteAverage(value) {
  const rating = Number(value);
  if (!Number.isFinite(rating) || rating <= 0 || rating === 10 || rating >= 9.4) return null;
  return rating;
}

function getPreferredRating(item) {
  return getValidImdbRating(item?.imdb_rating) ?? getValidVoteAverage(item?.vote_average);
}

function isDirectMediaUrl(url = '') {
  const normalized = String(url).toLowerCase();
  return (
    normalized.endsWith('.mp4') ||
    normalized.endsWith('.m3u8') ||
    normalized.endsWith('.webm') ||
    normalized.endsWith('.ogg')
  );
}

function buildVideasyUrl({ mediaType, tmdbId, seasonNumber, episodeNumber }) {
  const type = String(mediaType || '').toLowerCase();
  const baseUrl =
    type === 'movie'
      ? `https://player.videasy.to/movie/${tmdbId}`
      : `https://player.videasy.to/tv/${tmdbId}/${seasonNumber || 1}/${episodeNumber || 1}`;

  const params = new URLSearchParams({
    color: 'F97316',
    overlay: 'true'
  });

  if (type !== 'movie') {
    params.set('nextEpisode', 'true');
    params.set('autoplayNextEpisode', 'true');
    params.set('episodeSelector', 'true');
  }

  return `${baseUrl}?${params.toString()}`;
}

function buildVideasyHindiAttemptUrl({ mediaType, tmdbId, seasonNumber, episodeNumber }) {
  const url = new URL(buildVideasyUrl({ mediaType, tmdbId, seasonNumber, episodeNumber }));
  // Best-effort only: VIDEASY does not document a supported movie/TV Hindi-default parameter.
  url.searchParams.set('lang', 'hi');
  url.searchParams.set('audio', 'hindi');
  url.searchParams.set('language', 'hindi');
  return url.toString();
}

function buildVidfastUrl({ mediaType, tmdbId, seasonNumber, episodeNumber }) {
  const type = String(mediaType || '').toLowerCase();
  const baseUrl = type === 'movie'
    ? `https://vidfast.pro/movie/${tmdbId}`
    : `https://vidfast.pro/tv/${tmdbId}/${seasonNumber || 1}/${episodeNumber || 1}`;

  const params = new URLSearchParams({
    theme: 'F97316',
    autoPlay: 'true',
    title: 'true',
    poster: 'true'
  });

  if (type !== 'movie') {
    params.set('nextButton', 'true');
    params.set('autoNext', 'true');
  }

  return `${baseUrl}?${params.toString()}`;
}

function buildLegacyPlayerSources({ mediaType, tmdbId, seasonNumber, episodeNumber }) {
  const input = { mediaType, tmdbId, seasonNumber, episodeNumber };
  return [
    {
      id: 'legacy-videasy-hi',
      key: 'legacy-videasy-hi',
      label: 'VIDEASY',
      url: buildVideasyHindiAttemptUrl(input),
      urls: [buildVideasyHindiAttemptUrl(input)],
      embeddable: true,
      fallback: true
    },
    {
      id: 'legacy-vidfast',
      key: 'legacy-vidfast',
      label: 'vidfast',
      url: buildVidfastUrl(input),
      urls: [buildVidfastUrl(input)],
      embeddable: true,
      fallback: true
    }
    // YouTube: no fallback URL â€” button stays disabled until backend scraper finds a real video.
  ].filter((source) => source.url);
}

function createPlayerRequest({ mediaType, tmdbId, seasonNumber, episodeNumber, imdbId, title }) {
  const normalizedType = String(mediaType || '').toLowerCase() === 'movie' ? 'movie' : 'series';
  const resolvedTmdbId = Number(tmdbId);
  const resolvedSeasonNumber = normalizedType === 'series' ? Number(seasonNumber || 1) : null;
  const resolvedEpisodeNumber = normalizedType === 'series' ? Number(episodeNumber || 1) : null;

  return {
    mediaType: normalizedType,
    tmdbId: resolvedTmdbId,
    seasonNumber: resolvedSeasonNumber,
    episodeNumber: resolvedEpisodeNumber,
    imdbId: imdbId || '',
    title: title || '',
    fallbackSources: buildLegacyPlayerSources({
      mediaType: normalizedType,
      tmdbId: resolvedTmdbId,
      seasonNumber: resolvedSeasonNumber,
      episodeNumber: resolvedEpisodeNumber,
    })
  };
}

function compareRatingsForSort(a, b, direction = 'desc') {
  const ratingA = getPreferredRating(a);
  const ratingB = getPreferredRating(b);
  const aMissing = ratingA == null;
  const bMissing = ratingB == null;
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  return direction === 'asc' ? ratingA - ratingB : ratingB - ratingA;
}

function hasStoredRating(item) {
  return getPreferredRating(item) != null || item?.rating_lookup_attempted === true;
}

function hasActiveCollectionContentFilters(filters) {
  return !!filters && (
    filters.contentType !== 'all' ||
    filters.anime !== 'yes' ||
    filters.sortBy !== 'recent' ||
    filters.hideWatched === true
  );
}

function hasActivePersonFilters({ contentType, quickFilter, collectionFilter, sortBy }) {
  return (
    contentType !== 'all' ||
    quickFilter !== 'all' ||
    !!collectionFilter ||
    sortBy !== 'year-desc'
  );
}

async function enrichCollectionRatingsInBackground(collection, logPrefix = '[Soulstash][React]') {
  if (!collection?._id) return null;

  // Enrich items missing imdb_rating OR vote_average
  const needsEnrich = (collection.movies || []).filter(
    (item) =>
      item?.rating_lookup_attempted !== true &&
      (getValidImdbRating(item?.imdb_rating) == null || getValidVoteAverage(item?.vote_average) == null)
  );
  if (!needsEnrich.length) {
    console.log(`${logPrefix} enrichCollectionRatingsInBackground SKIP Ã¢â‚¬â€ all ratings present collection="${collection.name}"`);
    return null;
  }

  console.log(`${logPrefix} enrichCollectionRatingsInBackground START collection="${collection.name}" needsEnrich=${needsEnrich.length}/${collection.movies?.length || 0}`, needsEnrich.map(i => ({ title: i.title, imdb_rating: i.imdb_rating, vote_average: i.vote_average })));

  const cachedRatings = await loadRatingsTable();
  const ratingsByKey = new Map(
    (cachedRatings || []).map((item) => [ratingsCacheKey(item.tmdbID, item.mediaType), item])
  );
  const needsBackendEnrich = needsEnrich.filter(
    (item) => !ratingsByKey.has(ratingsCacheKey(contentIdFromItem(item), mediaTypeFromItem(item)))
  );

  if (needsBackendEnrich.length) {
    const ratingsResponse = await apiFetch('/api/ratings/imdb/enrich', {
      method: 'POST',
      body: JSON.stringify({
        items: needsBackendEnrich.map((item) => ({
          contentId: contentIdFromItem(item),
          mediaType: mediaTypeFromItem(item)
        }))
      })
    });

    console.log(`${logPrefix} enrichCollectionRatingsInBackground /enrich response`, ratingsResponse?.items);
    mergeRatingsTableCache(ratingsResponse?.items || []);
    (ratingsResponse?.items || []).forEach((item) => {
      ratingsByKey.set(ratingsCacheKey(item.tmdbID, item.mediaType), item);
    });
  }

  const items = needsEnrich
    .map((item) => {
      const contentId = contentIdFromItem(item);
      if (!contentId) return null;
      const mediaType = mediaTypeFromItem(item);
      const ratingMatch = ratingsByKey.get(ratingsCacheKey(contentId, mediaType));
      const imdb_rating = getValidImdbRating(ratingMatch?.imdb_rating);
      // Prefer vote_average from backend response (Ratings table), fall back to existing item value
      const vote_average = getValidVoteAverage(ratingMatch?.vote_average) ?? getValidVoteAverage(item?.vote_average);

      console.log(`${logPrefix}   "${item.title || item.name}" (${mediaType}:${contentId}) imdb_rating: ${item.imdb_rating} Ã¢â€ â€™ ${imdb_rating} | vote_average: ${item.vote_average} Ã¢â€ â€™ ${vote_average} | source=${ratingMatch?.source}`);

      return {
        contentId,
        mediaType,
        vote_average: vote_average ?? null,
        imdb_rating: imdb_rating ?? null,
        imdb_id: ratingMatch?.imdbID || item?.imdb_id || '',
        rating_lookup_attempted: ratingMatch?.lookup_attempted === true,
        poster_path: item?.poster_path || '',
        release_date: item?.release_date || '',
        first_air_date: item?.first_air_date || '',
        title: item?.title || item?.name || 'Unknown'
      };
    })
    .filter(Boolean);

  if (!items.length) {
    console.log(`${logPrefix} enrichCollectionRatingsInBackground nothing to write back collection="${collection.name}"`);
    return null;
  }

  console.log(`${logPrefix} enrichCollectionRatingsInBackground Ã¢â€ â€™ /enrich-metadata collection="${collection.name}" itemCount=${items.length}`);

  const response = await apiFetch(`/api/user/collections/${encodeURIComponent(collection._id)}/enrich-metadata`, {
    method: 'POST',
    body: JSON.stringify({ items })
  });

  console.log(`${logPrefix} enrichCollectionRatingsInBackground DONE collection="${collection.name}" updatedCount=${items.length}`);

  return response;
}


function mergeImdbRatings(items, ratingItems) {
  const ratingsByKey = new Map(
    (ratingItems || []).map((item) => [`${item.mediaType}:${item.tmdbID}`, item])
  );

  return (items || []).map((item) => {
    const contentId = contentIdFromItem(item);
    const mediaType = mediaTypeFromItem(item);
    const ratingMatch = ratingsByKey.get(`${mediaType}:${contentId}`);
    if (!ratingMatch) return item;

    const nextRating = getValidImdbRating(ratingMatch.imdb_rating);
    const nextVoteAverage = getValidVoteAverage(ratingMatch.vote_average);
    return {
      ...item,
      imdb_rating: nextRating ?? item?.imdb_rating,
      vote_average: nextVoteAverage ?? item?.vote_average,
      imdb_id: ratingMatch.imdbID || item?.imdb_id || '',
      rating_lookup_attempted: ratingMatch?.lookup_attempted === true || item?.rating_lookup_attempted === true
    };
  });
}

function broadcastCollections(nextCollections, version) {
  const collections = normalizeCollections(nextCollections);
  updateCollectionsCache(collections, version ?? lastKnownCollectionVersion ?? getCachedCollectionVersion());
  window.dispatchEvent(
    new CustomEvent(window.CollectionStore?.COLLECTIONS_UPDATED_EVENT || 'soulstash:collections-updated', {
      detail: { collections }
    })
  );
  return collections;
}

function isContentInCollection(collections, collectionName, contentId, mediaType = '') {
  const collection = collections.find((item) => item.name === collectionName || item._id === collectionName);
  if (!collection || !Array.isArray(collection.movies)) return false;
  const normalizedMediaType = normalizeMediaType(mediaType);
  return collection.movies.some((movie) => {
    const sameId = contentIdFromItem(movie) === Number(contentId);
    if (!sameId) return false;
    if (!normalizedMediaType) return true;
    return normalizeMediaType(movie?.media_type || (movie?.seriesId ? 'Series' : 'Movie')) === normalizedMediaType;
  });
}

function imageUrl(path, size = 'w500') {
  return path ? `${IMAGE_BASE}/${size}${path}` : FALLBACK_AVATAR;
}

function getLanguageName(languageCode, fallback = 'Unknown') {
  if (!languageCode) return fallback;

  try {
    const displayNames = new Intl.DisplayNames(['en'], { type: 'language' });
    const resolved = displayNames.of(String(languageCode).toLowerCase());
    return resolved || fallback;
  } catch {
    return fallback;
  }
}

function yearFrom(item) {
  const dateValue = item?.release_date || item?.first_air_date;
  return dateValue ? new Date(dateValue).getFullYear() : 'N/A';
}

function getPrimaryCountry(content) {
  if (content?.country) return content.country;
  if (Array.isArray(content?.production_countries) && content.production_countries.length) {
    return content.production_countries
      .map((country) => (typeof country === 'string' ? country : country?.name))
      .filter(Boolean)
      .join(', ');
  }
  return 'Unknown';
}

function getDirectorLabel(content, crew = [], type = 'movie') {
  if (type === 'series') {
    if (Array.isArray(content?.created_by) && content.created_by.length) {
      return content.created_by.map((person) => person?.name).filter(Boolean).join(', ');
    }
    if (content?.director) return Array.isArray(content.director) ? content.director.filter(Boolean).join(', ') : content.director;
    return 'Unknown';
  }

  if (Array.isArray(content?.director)) {
    const directors = content.director.filter(Boolean);
    if (directors.length) return directors.join(', ');
  }

  if (typeof content?.director === 'string' && content.director.trim()) {
    return content.director;
  }

  const crewList = Array.isArray(crew) && crew.length ? crew : Array.isArray(content?.crew) ? content.crew : [];
  if (crewList.length) {
    const jobDirectors = crewList.filter((person) => person?.job === 'Director');
    const jobDirectorNames = [...new Set(jobDirectors.map((person) => person?.name).filter(Boolean))];

    let directors = [];

    if (jobDirectorNames.length >= 3) {
      directors = jobDirectorNames;
    } else if (jobDirectorNames.length > 0) {
      directors = [...jobDirectorNames];
      const deptDirectors = crewList
        .filter(
          (person) =>
            person?.known_for_department === 'Directing' &&
            person?.name &&
            !jobDirectorNames.includes(person.name)
        )
        .map((person) => person.name);
      directors.push(...deptDirectors);
    } else {
      directors = crewList
        .filter((person) => person?.known_for_department === 'Directing')
        .map((person) => person?.name)
        .filter(Boolean);
    }

    const finalDirectors = [...new Set(directors)].slice(0, 4);
    if (finalDirectors.length) return finalDirectors.join(', ');
  }

  return 'Unknown';
}

function getDirectorPeople(content, crew = [], type = 'movie') {
  const uniquePeople = (people = []) => {
    const seen = new Set();
    return people
      .filter((person) => person?.id && person?.name)
      .filter((person) => {
        const key = String(person.id);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 4)
      .map((person) => ({ id: person.id, name: person.name }));
  };

  if (type === 'series') {
    return uniquePeople(Array.isArray(content?.created_by) ? content.created_by : []);
  }

  const crewList = Array.isArray(crew) && crew.length ? crew : Array.isArray(content?.crew) ? content.crew : [];
  if (!crewList.length) return [];

  const jobDirectors = crewList.filter((person) => person?.job === 'Director');
  if (jobDirectors.length >= 3) return uniquePeople(jobDirectors);

  if (jobDirectors.length > 0) {
    const jobDirectorNames = new Set(jobDirectors.map((person) => person?.name).filter(Boolean));
    const deptDirectors = crewList.filter(
      (person) =>
        person?.known_for_department === 'Directing' &&
        person?.name &&
        !jobDirectorNames.has(person.name)
    );
    return uniquePeople([...jobDirectors, ...deptDirectors]);
  }

  return uniquePeople(crewList.filter((person) => person?.known_for_department === 'Directing'));
}

function formatRuntime(minutes) {
  if (!minutes || Number(minutes) <= 0) return 'N/A';
  const total = Number(minutes);
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (!hours) return `${mins}m`;
  if (!mins) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

function mediaRoute(item) {
  const type = item?.media_type || (item?.title ? 'Movie' : 'Series');
  return type === 'Series' || type === 'tv' ? `/series/${item.id}` : `/movie/${item.id}`;
}

function useLiveCollections() {
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

function filteredCollectionMovies(collection, filters, watchedIds) {
  const base = Array.isArray(collection?.movies) ? [...collection.movies] : [];
  const filtered = base.filter((movie) => {
    const isSeries = movie?.media_type === 'Series' || movie?.media_type === 'tv' || !!movie?.seriesId;
    const isAnime = !!movie?.isAnime;
    const id = Number(movie?.movieId || movie?.seriesId || movie?.id || movie?._id || 0);
    const isWatched = watchedIds.has(id);

    if (filters.contentType === 'movies' && isSeries) return false;
    if (filters.contentType === 'series' && !isSeries) return false;
    if (filters.anime === 'no' && isAnime) return false;
    if (filters.anime === 'only' && !isAnime) return false;
    if (filters.hideWatched && isWatched) return false;

    return true;
  });

  filtered.sort((a, b) => {
    const voteA = getPreferredRating(a) ?? 0;
    const voteB = getPreferredRating(b) ?? 0;
    const titleA = String(a?.title || a?.name || '').toLowerCase();
    const titleB = String(b?.title || b?.name || '').toLowerCase();
    const yearA = Number(yearFrom(a)) || 0;
    const yearB = Number(yearFrom(b)) || 0;
    const addedA = new Date(a?.addedAt || a?.updatedAt || a?.release_date || 0).getTime() || 0;
    const addedB = new Date(b?.addedAt || b?.updatedAt || b?.release_date || 0).getTime() || 0;
    if (filters.sortBy === 'oldest') return addedA - addedB;
    if (filters.sortBy === 'rating-desc') return compareRatingsForSort(a, b, 'desc');
    if (filters.sortBy === 'rating-asc') return compareRatingsForSort(a, b, 'asc');
    if (filters.sortBy === 'title-asc') return titleA.localeCompare(titleB);
    if (filters.sortBy === 'title-desc') return titleB.localeCompare(titleA);
    if (filters.sortBy === 'year-desc') return yearB - yearA;
    if (filters.sortBy === 'year-asc') return yearA - yearB;
    return addedB - addedA;
  });

  return filtered;
}

const CollectionPosterCard = React.forwardRef(function CollectionPosterCard({ item, onRemove, ...props }, ref) {
  const navigate = useNavigate();
  const normalized = normalizeStoredCollectionItem(item);
  const itemId = Number(item?.movieId || item?.seriesId || item?.id || item?._id || 0);

  return (
    <article className="border text-card-foreground group p-2 flex flex-col items-start gap-2 sm:gap-[6px] w-full h-full relative rounded-lg overflow-visible transition-all duration-300 border-none bg-transparent shadow-none text-left">
      <button
        ref={ref}
        type="button"
        {...props}
        className="p-0 w-full h-full flex flex-col items-start gap-2 sm:gap-[6px] cursor-pointer rounded-lg focus:bg-white/[0.08] focus:ring-2 focus:ring-white focus:outline-none transition-all duration-300 text-left outline-none"
        onClick={() => navigate(mediaRoute(normalized))}
      >
        <div className="relative w-full aspect-[2/3] overflow-hidden rounded-md max-w-full mx-auto">
          <img
            src={imageUrl(normalized.poster_path, 'w300_and_h450_face')}
            alt={normalized.title}
            className="w-full h-full object-cover rounded-md"
            onError={(event) => {
              event.currentTarget.src = FALLBACK_AVATAR;
            }}
          />
        </div>
        <div className="flex flex-col items-start w-full px-[2px]">
          <div className="w-full overflow-hidden h-[16px] sm:h-[20px] flex items-center relative">
            <h3 className="w-full text-sm opacity-80 font-medium leading-4 sm:leading-5 tracking-[0.5px] text-[#E2E2E2] text-left truncate">
              {normalized.title}
            </h3>
          </div>
          <p className="w-full text-[10px] opacity-100 font-normal leading-[18px] tracking-[0.4px] text-left text-[#C6C6C6]">
            {normalized.media_type} | {yearFrom(normalized)} | Rating {getPreferredRating(normalized)?.toFixed(1) || 'N/A'}
          </p>
        </div>
      </button>
      {onRemove ? (
        <button
          type="button"
          className="absolute top-2 right-2 remove-btn w-8 h-8 rounded-full bg-black/72 text-white hover:bg-black/90 transition-colors flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-white"
          onClick={(event) => {
            event.stopPropagation();
            onRemove(itemId, normalized.title);
          }}
          aria-label={`Remove ${normalized.title}`}
        >
          <i className="fas fa-times text-[12px]"></i>
        </button>
      ) : null}
    </article>
  );
});

function getDrawerColumnCount() {
  const width = window.innerWidth;
  if (width >= 1600) return 5;
  if (width >= 1280) return 4;
  if (width >= 900) return 3;
  if (width >= 600) return 2;
  return 1;
}

function CollectionSearchDrawer({ open, onClose, collection, onAdd, pendingItems = new Set() }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const drawerButtonsRef = useRef([]);
  const drawerInputRef = useRef(null);

  useEffect(() => {
    if (open) {
      const frame = window.requestAnimationFrame(() => {
        drawerInputRef.current?.focus();
      });
      return () => window.cancelAnimationFrame(frame);
    }
    return undefined;
  }, [open]);

  useEffect(() => {
    setFocusedIndex(-1);
    drawerButtonsRef.current = [];
  }, [results]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setResults([]);
      setLoading(false);
      return;
    }

    if (!query || query.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    let ignore = false;
    const controller = new AbortController();
    setLoading(true);
    setResults([]);
    const timeout = window.setTimeout(async () => {
      try {
        const streamedResults = [];
        await streamApiFetch(
          `/api/search?q=${encodeURIComponent(query.trim())}&limit=20&type=content&stream=1`,
          {
            signal: controller.signal,
            onEvent(event) {
              if (ignore || event?.query !== query.trim() || event?.type !== 'results') return;
              const incoming = Array.isArray(event.results) ? event.results : [];
              const nextResults = mergeSearchResults(streamedResults, incoming, 40);
              streamedResults.splice(0, streamedResults.length, ...nextResults);
              setResults(nextResults);
              setLoading(false);
            }
          }
        );
        if (!ignore) {
          setLoading(false);
        }
      } catch (error) {
        if (error?.name === 'AbortError') return;
        if (!ignore) {
          toast(error.message, 'error');
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }, 350);

    return () => {
      ignore = true;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [open, query]);

  if (!open || !collection) return null;

  const existingIds = new Set((collection.movies || []).map((item) => Number(item.movieId || item.seriesId || item.id || item._id || 0)));
  const contentResults = results.filter((item) => item.media_type === 'Movie' || item.media_type === 'Series' || item.media_type === 'tv');



  function handleDrawerInputKey(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (contentResults.length > 0) {
        setFocusedIndex(0);
        drawerButtonsRef.current[0]?.focus();
      }
    }
  }

  return (
    <div className="fixed inset-0 z-50" data-modal="true">
      <div className="fixed inset-0 bg-black/50" onClick={onClose}></div>
      <div
        className="fixed bottom-0 left-[5vw] right-[5vw] z-[52] flex w-[90vw] max-h-[min(66vh,calc(100vh-88px))] min-h-[50vh] flex-col overflow-hidden rounded-t-[28px] border border-gray-800/80 bg-[#0F0F0F]"
        role="dialog"
        aria-modal="true"
        aria-label="Add content"
        data-drawer-panel="true"
      >
        <div className="sticky top-0 bg-[#0F0F0F] z-10 flex justify-center pt-2 pb-1">
          <div className="w-12 h-1 bg-gray-700 rounded-full"></div>
        </div>
        <div className="flex flex-1 min-h-0 flex-col px-4 pb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-medium text-white">Add Content</h3>
            <button className="p-1 rounded-full hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-white" onClick={onClose} aria-label="Close drawer">
              <i className="fas fa-times text-gray-400"></i>
            </button>
          </div>
          <div className="relative mb-4">
            <i className="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-gray-500"></i>
            <input
              ref={drawerInputRef}
              id="contentSearchInput"
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleDrawerInputKey}
              placeholder="Search movies or series"
              className="w-full bg-[#171717] text-white rounded-xl border border-gray-800 pl-12 pr-4 py-3 outline-none"
            />
          </div>
          {!query || query.length < 2 ? (
            <div className="text-center text-gray-500 py-16">Start typing to search content.</div>
          ) : null}
          {loading ? (
            <div className="filter-scrollbar-hidden min-h-0 flex-1 overflow-y-auto pr-1">
              <SearchResultSkeletonGrid count={8} />
            </div>
          ) : null}
          {!loading && contentResults.length ? (
            <div className="filter-scrollbar-hidden min-h-0 flex-1 overflow-y-auto pr-1">
              <div className="grid grid-cols-1 min-[600px]:grid-cols-2 min-[900px]:grid-cols-3 min-[1280px]:grid-cols-4 min-[1600px]:grid-cols-5 gap-3">
              {contentResults.map((item, index) => {
                const itemId = Number(item._id || item.id || 0);
                const mediaType = item.media_type === 'Series' ? 'Series' : item.media_type === 'tv' ? 'Series' : 'Movie';
                const alreadyAdded = existingIds.has(itemId);
                return (
                  <div
                    key={`${itemId}-${mediaType}`}
                    ref={(el) => { drawerButtonsRef.current[index] = el; }}
                    tabIndex={0}
                    onFocus={() => setFocusedIndex(index)}
                    onKeyDown={(event) => {
                      const cols = getDrawerColumnCount();
                      if (event.key === 'ArrowDown') {
                        event.preventDefault();
                        const next = index + cols;
                        if (next < contentResults.length) {
                          setFocusedIndex(next);
                          drawerButtonsRef.current[next]?.focus();
                          drawerButtonsRef.current[next]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                        } else if (index < contentResults.length - 1) {
                          const lastIdx = contentResults.length - 1;
                          setFocusedIndex(lastIdx);
                          drawerButtonsRef.current[lastIdx]?.focus();
                          drawerButtonsRef.current[lastIdx]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                        }
                      } else if (event.key === 'ArrowUp') {
                        event.preventDefault();
                        const prev = index - cols;
                        if (prev < 0) {
                          setFocusedIndex(-1);
                          document.getElementById('contentSearchInput')?.focus();
                        } else {
                          setFocusedIndex(prev);
                          drawerButtonsRef.current[prev]?.focus();
                          drawerButtonsRef.current[prev]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                        }
                      } else if (event.key === 'ArrowRight') {
                        if (index < contentResults.length - 1) {
                          event.preventDefault();
                          const next = index + 1;
                          setFocusedIndex(next);
                          drawerButtonsRef.current[next]?.focus();
                          drawerButtonsRef.current[next]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                        }
                      } else if (event.key === 'ArrowLeft') {
                        if (index > 0) {
                          event.preventDefault();
                          const prev = index - 1;
                          setFocusedIndex(prev);
                          drawerButtonsRef.current[prev]?.focus();
                          drawerButtonsRef.current[prev]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                        }
                      } else if (event.key === 'Enter') {
                        event.preventDefault();
                        if (!alreadyAdded && !pendingItems.has(itemId)) {
                          onAdd(item, mediaType);
                        }
                      }
                    }}
                    className={`search-hover-marquee-trigger flex items-center p-3 border rounded-lg transition-all outline-none ${
                      focusedIndex === index
                        ? 'bg-white/[0.08] border-white/70'
                        : 'bg-[#171717] border-gray-800'
                    }`}
                  >
                    <div className="flex-shrink-0 w-14 h-20 relative rounded-md overflow-hidden">
                      <img
                        src={imageUrl(item.poster_path, 'w300_and_h450_face')}
                        alt={item.title || item.name}
                        className="w-full h-full object-cover"
                        onError={(event) => {
                          event.currentTarget.src = FALLBACK_AVATAR;
                        }}
                      />
                    </div>
                    <div className="flex-grow ml-3 min-w-0 overflow-hidden">
                      <h4 className="text-white font-medium text-base overflow-hidden">
                        <HoverMarqueeTitle title={item.title || item.name || 'Unknown'} />
                      </h4>
                      <div className="flex items-center text-sm text-gray-400 mt-0.5">
                        <span>{yearFrom(item)}</span>
                        <span className="mx-2">|</span>
                        <span>{mediaType}</span>
                      </div>
                    </div>
                    <div className="flex-shrink-0 ml-2">
                      {alreadyAdded ? (
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-green-700/30 cursor-not-allowed">
                          <i className="fas fa-check text-[13px] text-green-500"></i>
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={pendingItems.has(itemId)}
                          className={`flex h-9 w-9 items-center justify-center rounded-full bg-[#252833] hover:bg-[#353945] transition-colors text-white ${pendingItems.has(itemId) ? 'opacity-70 cursor-wait' : ''}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            onAdd(item, mediaType);
                          }}
                        >
                          {pendingItems.has(itemId) ? (
                            <i className="fas fa-spinner fa-spin text-[13px]"></i>
                          ) : (
                            <i className="fas fa-plus text-[13px]"></i>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              </div>
            </div>
          ) : null}
          {!loading && query.length >= 2 && !contentResults.length ? (
            <div className="text-center text-gray-500 py-10">No movies or series matched this search.</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ConfirmModal({ open, title, message, confirmLabel, onConfirm, onClose, danger = false }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose}></div>
      <div className="relative z-10 w-full max-w-sm rounded-[24px] bg-[#111111] p-5 shadow-[0_28px_80px_rgba(0,0,0,0.45)]">
        <h3 className="text-xl font-semibold text-white">{title}</h3>
        <p className="text-sm text-[#9b9b9b] mt-3 leading-6">{message}</p>
        <div className="flex gap-3 pt-5">
          <button type="button" className="flex-1 h-11 rounded-2xl bg-white/[0.06] text-white" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={`flex-1 h-11 rounded-2xl ${danger ? 'bg-[#ff5d5d] text-white' : 'bg-white text-black'}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function CollectionFormModal({
  open,
  values,
  onChange,
  onClose,
  onSubmit,
  saving,
  title = 'Create New Collection',
  submitLabel = 'Create Collection',
  lockName = false,
  lockPrivate = false
}) {
  if (!open) return null;

  const nameLength = values.name.length;
  const descriptionLength = values.description.length;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose}></div>
      <div className="relative z-10 w-full max-w-[440px] rounded-[18px] border border-white/10 bg-[#111111] p-5 sm:p-5 shadow-[0_24px_64px_rgba(0,0,0,0.5)]">
        <div className="mb-5 flex items-start justify-between gap-4">
          <h3 className="text-[18px] sm:text-[20px] font-semibold text-white leading-tight">{title}</h3>
          <button type="button" className="h-8 w-8 rounded-full text-[#b5b5b5] hover:bg-white/[0.06] hover:text-white transition-colors" onClick={onClose} aria-label="Close">
            <i className="fas fa-times"></i>
          </button>
        </div>
        <div className="space-y-4">
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <label className="block text-sm text-[#cfcfcf]">Collection Name</label>
              <span className="text-xs text-[#7d7d7d]">{nameLength}/{COLLECTION_NAME_MAX_LENGTH}</span>
            </div>
            <input
              type="text"
              value={values.name}
              maxLength={COLLECTION_NAME_MAX_LENGTH}
              disabled={lockName}
              onChange={(event) => onChange((current) => ({ ...current, name: event.target.value }))}
              placeholder="Enter a name for your collection"
              className={`w-full h-11 rounded-xl border border-white/10 px-4 text-white outline-none ${lockName ? 'bg-[#181818] text-[#8f8f8f] cursor-not-allowed' : 'bg-[#1f1f1f] focus:border-[#8f44f0]'}`}
            />
            {lockName ? <p className="mt-2 text-xs text-[#7d7d7d]">The name of this collection cannot be changed.</p> : null}
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <label className="block text-sm text-[#cfcfcf]">Description</label>
              <span className="text-xs text-[#7d7d7d]">{descriptionLength}/150</span>
            </div>
            <textarea
              value={values.description}
              maxLength={150}
              onChange={(event) => onChange((current) => ({ ...current, description: event.target.value }))}
              placeholder="Add a description (optional)"
              className="min-h-[112px] w-full rounded-xl border border-white/10 bg-[#1f1f1f] px-4 py-3 text-white outline-none resize-none focus:border-[#8f44f0]"
            />
          </div>
          <div>
            <label className="block text-sm text-[#cfcfcf] mb-3">Visibility</label>
            <div className="rounded-xl bg-[#1f1f1f] p-1">
              <div className="grid grid-cols-2 gap-1">
                {[
                  { value: false, label: 'Private', icon: 'fa-lock' },
                  { value: true, label: 'Public', icon: 'fa-globe' }
                ].map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    disabled={lockPrivate && option.value === false}
                    className={`flex h-11 items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors ${
                      values.isPublic === option.value ? 'bg-[#bcbcbc] text-[#111111]' : 'text-[#a8a8a8] hover:bg-white/[0.04]'
                    } ${lockPrivate && option.value === false ? 'cursor-not-allowed opacity-45 hover:bg-transparent' : ''
                    }`}
                    onClick={() => {
                      if (lockPrivate && option.value === false) return;
                      onChange((current) => ({ ...current, isPublic: option.value }));
                    }}
                  >
                    <i className={`fas ${option.icon} text-xs`}></i>
                    <span>{option.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <p className="mt-3 text-sm text-[#8d8d8d]">
              {lockPrivate ? 'Unpublish this collection before making it private' : values.isPublic ? 'Anyone with the link can view this collection' : 'Only you can view this collection'}
            </p>
          </div>
          <div className="pt-1">
            <button
              type="button"
              className="h-11 w-full rounded-xl bg-[#c4c4c4] text-[#111111] font-medium transition-colors hover:bg-[#b8b8b8] disabled:opacity-60"
              onClick={onSubmit}
              disabled={saving}
            >
              {saving ? 'Saving...' : submitLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CreateCollectionModal(props) {
  return <CollectionFormModal {...props} title="Create Collection" submitLabel="Create Collection" />;
}

function EditCollectionModal(props) {
  return <CollectionFormModal {...props} title="Edit Collection" submitLabel="Save Changes" lockName={['Watched', 'Watchlist'].includes(props.values?.name)} lockPrivate={props.values?.isPublished === true} />;
}

function SaveToCollectionModal({ open, onClose, collections, contentId, onToggleCollection, onCreateNew }) {
  if (!open) return null;

  const customCollections = collections.filter((collection) => !['Watched', 'Watchlist'].includes(collection.name));

  return (
    <div className="fixed inset-0 z-[76] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose}></div>
      <div className="relative z-10 w-full max-w-[420px] rounded-[24px] border border-white/10 bg-[#1f1f1f] p-5 shadow-[0_30px_90px_rgba(0,0,0,0.55)]">
        <div className="mb-5 flex items-center justify-between gap-4">
          <h3 className="text-[20px] font-semibold text-white">Save to Collection</h3>
          <button type="button" className="h-9 w-9 rounded-full text-[#b5b5b5] hover:bg-white/[0.05] hover:text-white" onClick={onClose} aria-label="Close">
            <i className="fas fa-times"></i>
          </button>
        </div>

        <div className="space-y-2">
          {customCollections.length ? (
            customCollections.map((collection) => {
              const selected = isContentInCollection(collections, collection.name, contentId);
              return (
                <button
                  key={collection._id || collection.name}
                  type="button"
                  className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-3 text-left hover:bg-white/[0.04]"
                  onClick={() => onToggleCollection(collection)}
                >
                  <span className="flex items-center gap-3 min-w-0">
                    <span className={`flex h-6 w-6 items-center justify-center rounded-md border ${selected ? 'border-[#9a45ff] bg-[#9a45ff]' : 'border-white/30 bg-transparent'}`}>
                      {selected ? <i className="fas fa-check text-[11px] text-white"></i> : null}
                    </span>
                    <span className="truncate text-white">{collection.name}</span>
                  </span>
                  <i className={`fas ${collection.isPublic ? 'fa-globe' : 'fa-lock'} text-sm text-[#9ca3af]`}></i>
                </button>
              );
            })
          ) : (
            <div className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-[#9b9b9b]">
              No custom collections yet.
            </div>
          )}
        </div>

        <button
          type="button"
          className="mt-5 flex w-full items-center gap-3 rounded-xl border border-dashed border-[#5a5a7c] px-4 py-4 text-left text-white hover:bg-white/[0.03]"
          onClick={onCreateNew}
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-black">
            <i className="fas fa-plus text-xs"></i>
          </span>
          <span className="font-medium">Create New Collection</span>
        </button>
      </div>
    </div>
  );
}


// MarqueeText Ã¢â‚¬â€ shows text as-is if it fits within maxChars,
// otherwise scrolls it right-to-left on a loop inside a clipped container.
function MarqueeText({ text = '', maxChars = 25 }) {
  const isLong = text.length > maxChars;
  if (!isLong) {
    return <span className="truncate">{text}</span>;
  }
  // Duplicate content so translateX(-50%) produces a seamless infinite loop
  const content = text + '\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0'; // gap between repetitions
  return (
    <span className="marquee-wrapper">
      <span className="marquee-content">{content}{content}</span>
    </span>
  );
}


function CollectionVisibilityBadge({ collection, iconOnly = false }) {
  return (
    <div className="inline-flex items-center rounded-full px-2 py-1 text-[11px] font-medium bg-white/[0.05] text-gray-300 gap-1 w-fit h-fit">
      <i className={`fas ${collection?.isPublic ? 'fa-globe' : 'fa-lock'} text-gray-400 text-[10px]`}></i>
      {iconOnly ? null : <span className="text-gray-400 text-xs">{collection?.isPublic ? 'Public' : 'Private'}</span>}
    </div>
  );
}

function AnimeFilterIcon({ mode, className = '' }) {
  if (mode === 'no') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden="true">
        <circle cx="12" cy="12" r="8"></circle>
      </svg>
    );
  }

  if (mode === 'only') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden="true">
        <rect x="5" y="5" width="14" height="14" rx="2.5"></rect>
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden="true">
      <circle cx="10" cy="10" r="5.5"></circle>
      <rect x="11.5" y="11.5" width="7.5" height="7.5" rx="1.7"></rect>
    </svg>
  );
}

function filterLabel(filters) {
  switch (filters.anime) {
    case 'no':
      return 'Hide anime';
    case 'only':
      return 'Only anime';
    default:
      return 'Show anime';
  }
}

function sortLabel(filters) {
  switch (filters.sortBy) {
    case 'oldest':
      return 'Oldest';
    case 'rating-desc':
      return 'Rating high';
    case 'rating-asc':
      return 'Rating low';
    case 'title-asc':
      return 'Title A-Z';
    case 'title-desc':
      return 'Title Z-A';
    case 'year-desc':
      return 'Year new';
    case 'year-asc':
      return 'Year old';
    default:
      return 'Recent';
  }
}

function AnimeDropdownMenu({ filters, setFilters, onClose, className = '', style, floating = false, optionTextClass = 'text-sm' }) {
  return (
    <div
      className={`${floating ? 'fixed' : 'absolute left-0 top-full mt-2'} inline-flex min-w-max flex-col items-start rounded-[16px] border border-white/12 bg-[#111111] p-2 shadow-[0_24px_60px_rgba(0,0,0,0.55)] ${className}`}
      onClick={(event) => event.stopPropagation()}
      style={style}
    >
      {[
        { value: 'yes', label: 'Show Anime' },
        { value: 'no', label: 'Hide Anime' },
        { value: 'only', label: 'Only Anime' }
      ].map((option) => (
        <button
          key={option.value}
          type="button"
          className={`inline-flex items-center gap-2 whitespace-nowrap rounded-[12px] px-3 py-2.5 ${optionTextClass} text-left ${
            filters.anime === option.value ? 'bg-white/[0.08] text-white' : 'text-[#d0d0d0] hover:bg-white/[0.05]'
          }`}
          onClick={() => {
            setFilters((current) => ({ ...current, anime: option.value }));
            onClose();
          }}
        >
          <AnimeFilterIcon mode={option.value} className="h-4 w-4 shrink-0" />
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}

function CollectionFilterControls({
  filters,
  setFilters,
  noWrap = false,
  stacked = false,
  size = 'default'
}) {
  const triggerRef = useRef(null);
  const dropdownRef = useRef(null);
  const [animeMenuOpen, setAnimeMenuOpen] = useState(false);
  const [animeMenuStyle, setAnimeMenuStyle] = useState({});
  const sortTriggerRef = useRef(null);
  const sortDropdownRef = useRef(null);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [sortMenuStyle, setSortMenuStyle] = useState({});

  const sortOptions = [
    { value: 'recent', label: 'Recent' },
    { value: 'oldest', label: 'Oldest' },
    { value: 'rating-desc', label: 'Rating high' },
    { value: 'rating-asc', label: 'Rating low' },
    { value: 'title-asc', label: 'Title A-Z' },
    { value: 'title-desc', label: 'Title Z-A' },
    { value: 'year-desc', label: 'Year new' },
    { value: 'year-asc', label: 'Year old' }
  ];

  function buildAnimeMenuPosition(trigger) {
    if (!trigger) return {};
    const rect = trigger.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const estimatedWidth = 176;
    const estimatedHeight = 148;
    const left = Math.min(Math.max(8, rect.left), Math.max(8, viewportWidth - estimatedWidth - 8));
    const belowTop = rect.bottom + 6;
    const aboveTop = rect.top - estimatedHeight - 6;
    const top = belowTop + estimatedHeight <= viewportHeight - 8 || aboveTop < 8
      ? Math.min(belowTop, Math.max(8, viewportHeight - estimatedHeight - 8))
      : aboveTop;
    return {
      position: 'fixed',
      zIndex: 2147483647,
      top: `${top}px`,
      left: `${left}px`,
      boxSizing: 'border-box'
    };
  }

  function buildSortMenuPosition(trigger) {
    if (!trigger) return {};
    const rect = trigger.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const estimatedWidth = Math.min(332, viewportWidth - 16);
    const estimatedHeight = 214;
    const left = Math.min(
      Math.max(8, rect.left),
      Math.max(8, viewportWidth - estimatedWidth - 8)
    );
    const belowTop = rect.bottom + 6;
    const aboveTop = rect.top - estimatedHeight - 6;
    const top = belowTop + estimatedHeight <= viewportHeight - 8 || aboveTop < 8
      ? Math.min(belowTop, Math.max(8, viewportHeight - estimatedHeight - 8))
      : aboveTop;
    return {
      position: 'fixed',
      zIndex: 2147483647,
      top: `${top}px`,
      left: `${left}px`,
      width: `${estimatedWidth}px`,
      maxWidth: 'calc(100vw - 16px)',
      boxSizing: 'border-box'
    };
  }

  // Always track scroll + resize to keep dropdown pinned to the trigger
  useEffect(() => {
    if (!animeMenuOpen && !sortMenuOpen) return undefined;

    function updatePosition() {
      if (triggerRef.current) {
        setAnimeMenuStyle(buildAnimeMenuPosition(triggerRef.current));
      }
      if (sortTriggerRef.current) {
        setSortMenuStyle(buildSortMenuPosition(sortTriggerRef.current));
      }
    }

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [animeMenuOpen, sortMenuOpen]);

  // Close on outside click Ã¢â‚¬â€ but ignore clicks on the trigger itself (handled by toggle)
  useEffect(() => {
    if (!animeMenuOpen && !sortMenuOpen) return undefined;

    function handleOutsideClick(event) {
      if (triggerRef.current && triggerRef.current.contains(event.target)) return;
      if (dropdownRef.current && dropdownRef.current.contains(event.target)) return;
      if (sortTriggerRef.current && sortTriggerRef.current.contains(event.target)) return;
      if (sortDropdownRef.current && sortDropdownRef.current.contains(event.target)) return;
      setAnimeMenuOpen(false);
      setSortMenuOpen(false);
    }

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [animeMenuOpen, sortMenuOpen]);

  const sizing = size === 'desktop'
    ? {
        rowGap: 'gap-2',
        outerHeight: 'h-10',
        pillInnerHeight: 'h-10',
        pillPadding: 'px-3',
        text: 'text-[13px]',
        icon: 'h-4 w-4',
        pillWidth: 'w-auto',
        watchedWidth: 'w-auto'
      }
    : {
        rowGap: 'gap-2',
        outerHeight: 'h-9',
        pillInnerHeight: 'h-8',
        pillPadding: 'px-3',
        text: 'text-[13px]',
        icon: 'h-3.5 w-3.5',
        pillWidth: 'w-auto',
        watchedWidth: 'w-auto'
      };

  const AnimeDropdownContent = () => {
    const ref = useRef(null);
    useDropdownKeyNav(ref, () => setAnimeMenuOpen(false));

    return (
      <div
        ref={(el) => { dropdownRef.current = el; ref.current = el; }}
        style={animeMenuStyle}
        className="inline-flex min-w-max flex-col items-stretch rounded-[16px] border border-white/12 bg-[#111111] p-2 shadow-[0_24px_60px_rgba(0,0,0,0.55)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {[
          { value: 'yes', label: 'Show Anime' },
          { value: 'no', label: 'Hide Anime' },
          { value: 'only', label: 'Only Anime' }
        ].map((option) => (
          <button
            key={option.value}
            type="button"
            className={`inline-flex w-full items-center gap-2 whitespace-nowrap rounded-[12px] px-3 py-2.5 ${sizing.text} text-left focus:outline-none focus:ring-2 focus:ring-white ${
              filters.anime === option.value ? 'bg-white/[0.08] text-white' : 'text-[#d0d0d0] hover:bg-white/[0.05]'
            }`}
            onClick={() => {
              setFilters((current) => ({ ...current, anime: option.value }));
              setAnimeMenuOpen(false);
            }}
          >
            <AnimeFilterIcon mode={option.value} className="h-4 w-4 shrink-0" />
            <span>{option.label}</span>
          </button>
        ))}
      </div>
    );
  };

  const SortDropdownContent = () => {
    const ref = useRef(null);
    useDropdownKeyNav(ref, () => setSortMenuOpen(false));

    return (
      <div
        ref={(el) => { sortDropdownRef.current = el; ref.current = el; }}
        style={sortMenuStyle}
        className="inline-flex min-w-max flex-col items-stretch rounded-[16px] border border-white/12 bg-[#111111] p-2 shadow-[0_24px_60px_rgba(0,0,0,0.55)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="grid grid-cols-2 gap-1.5">
          {sortOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`inline-flex w-full items-center gap-2 whitespace-nowrap rounded-[12px] px-3 py-2.5 ${sizing.text} text-left focus:outline-none focus:ring-2 focus:ring-white ${
                filters.sortBy === option.value ? 'bg-white/[0.08] text-white' : 'text-[#d0d0d0] hover:bg-white/[0.05]'
              }`}
              onClick={() => {
                setFilters((current) => ({ ...current, sortBy: option.value }));
                setSortMenuOpen(false);
              }}
            >
              <i className="fas fa-sort h-4 w-4 shrink-0 text-center"></i>
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      </div>
    );
  };

  const dropdown = animeMenuOpen
    ? createPortal(<AnimeDropdownContent />, document.body)
    : null;

  const sortDropdown = sortMenuOpen
    ? createPortal(<SortDropdownContent />, document.body)
    : null;

  return (
    <div
      data-tv-filters="true"
      className={`${noWrap ? 'w-max min-w-max' : stacked ? 'w-max max-w-full' : 'max-w-full'} ${stacked ? `flex flex-col items-start ${sizing.rowGap}` : `filter-scrollbar-hidden flex items-center ${sizing.rowGap} ${noWrap ? 'flex-nowrap overflow-visible' : 'flex-nowrap overflow-x-auto overflow-y-visible'}`}`}
    >
      {/* All / Movies / Series pill group */}
      <div className={`inline-flex items-center self-start ${sizing.rowGap} flex-shrink-0`}>
        {['all', 'movies', 'series'].map((type) => (
          <button
            key={type}
            type="button"
            className={`inline-flex items-center justify-center whitespace-nowrap ${sizing.pillWidth} ${sizing.pillInnerHeight} ${sizing.pillPadding} py-0.5 ${sizing.text} font-medium ${size === 'desktop' ? 'rounded-[20px]' : 'rounded-[18px]'} transition-colors focus:outline-none focus:ring-2 focus:ring-white`}
            style={{
              color: filters.contentType === type ? 'rgb(226, 226, 226)' : 'rgb(168, 168, 168)',
              backgroundColor: filters.contentType === type ? 'rgb(71, 71, 71)' : 'rgb(21, 21, 21)'
            }}
            onClick={() => setFilters((current) => ({ ...current, contentType: type }))}
          >
            {type === 'all' ? 'All' : type === 'movies' ? 'Movies' : 'Series'}
          </button>
        ))}
      </div>

      {/* Anime filter trigger Ã¢â‚¬â€ dropdown rendered via portal into document.body */}
      <div className={`relative flex-shrink-0 ${stacked ? 'max-w-full' : ''}`}>
        <button
          ref={triggerRef}
          type="button"
          className={`inline-flex ${sizing.outerHeight} max-w-full items-center justify-between gap-1.5 ${size === 'desktop' ? 'rounded-[20px]' : 'rounded-[18px]'} bg-[#151515] ${size === 'desktop' ? 'px-3' : 'px-2.5'} ${sizing.text} font-medium text-[#d9d9d9] focus:outline-none focus:ring-2 focus:ring-white`}
          onClick={(event) => {
            // Recompute position from live trigger rect on every toggle
            setAnimeMenuStyle(buildAnimeMenuPosition(event.currentTarget));
            setSortMenuOpen(false);
            setAnimeMenuOpen((current) => !current);
          }}
          title={filterLabel(filters)}
        >
          <span className="inline-flex items-center gap-1.5 min-w-0">
            <AnimeFilterIcon mode={filters.anime} className={`${sizing.icon} shrink-0 text-[#d4d4d4]`} />
            <span className="truncate">{filterLabel(filters)}</span>
          </span>
          <i className={`fas fa-chevron-down ${size === 'desktop' ? 'text-[10px]' : 'text-[9px]'} text-[#7f7f7f] flex-shrink-0 ml-1`}></i>
        </button>
        {dropdown}
      </div>

      <div className={`relative flex-shrink-0 ${stacked ? 'max-w-full' : ''}`}>
        <button
          ref={sortTriggerRef}
          type="button"
          className={`inline-flex ${sizing.outerHeight} max-w-full items-center justify-between gap-1.5 ${size === 'desktop' ? 'rounded-[20px]' : 'rounded-[18px]'} bg-[#151515] ${size === 'desktop' ? 'px-3' : 'px-3'} ${sizing.text} font-medium text-[#d9d9d9] focus:outline-none focus:ring-2 focus:ring-white`}
          onClick={(event) => {
            setSortMenuStyle(buildSortMenuPosition(event.currentTarget));
            setAnimeMenuOpen(false);
            setSortMenuOpen((current) => !current);
          }}
          title={sortLabel(filters)}
        >
          <span className="inline-flex items-center gap-1.5 min-w-0">
            <i className={`fas fa-sort ${sizing.icon} shrink-0 text-[#d4d4d4] text-center`}></i>
            <span className="truncate">{sortLabel(filters)}</span>
          </span>
          <i className={`fas fa-chevron-down ${size === 'desktop' ? 'text-[10px]' : 'text-[9px]'} text-[#7f7f7f] flex-shrink-0 ml-1`}></i>
        </button>
        {sortDropdown}
      </div>

      {/* Hide / Show Watched */}
      <button
        type="button"
        className={`inline-flex ${sizing.outerHeight} ${stacked ? 'max-w-full justify-start' : sizing.watchedWidth} flex-shrink-0 items-center justify-center gap-1.5 ${size === 'desktop' ? 'rounded-[20px]' : 'rounded-[18px]'} ${size === 'desktop' ? 'px-3' : 'px-2.5'} ${sizing.text} font-medium transition-colors ${filters.hideWatched ? 'bg-white text-black' : 'bg-[#151515] text-[#d9d9d9]'} focus:outline-none focus:ring-2 focus:ring-white`}
        onClick={() => setFilters((current) => ({ ...current, hideWatched: !current.hideWatched }))}
        title={filters.hideWatched ? 'Show Watched' : 'Hide Watched'}
      >
        <i className={`fas ${filters.hideWatched ? 'fa-eye-slash' : 'fa-eye'} shrink-0`}></i>
        <span>{filters.hideWatched ? 'Show Watched' : 'Hide Watched'}</span>
      </button>
    </div>
  );
}

function CollectionDetailPane({
  username,
  collection,
  filters,
  setFilters,
  watchedIds,
  onOpenDrawer,
  onRemoveFromCollection,
  onBackToCollections,
  onPublishChange,
  isOwner = true,
  useBannerAsBackdrop = false,
  showPublishControls = false
}) {
  const navigate = useNavigate();
  const movies = useMemo(() => filteredCollectionMovies(collection, filters, watchedIds), [collection, filters, watchedIds]);
  const showFilteredResultsCount = hasActiveCollectionContentFilters(filters);
  const [publishLoading, setPublishLoading] = useState(false);
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [isDesktopFilters, setIsDesktopFilters] = useState(() => window.innerWidth >= 768);
  const [mobileFilterMenuStyle, setMobileFilterMenuStyle] = useState({ top: 0, left: 0 });
  const mobileFilterMenuRef = useRef(null);
  const mobileFilterTriggerRef = useRef(null);
  const attemptedRatingBackfillRef = useRef('');
  const isDefaultCollection = ['Watched', 'Watchlist'].includes(collection?.name);
  const canPublish = isOwner && !isDefaultCollection && (collectionItemCount(collection) >= PUBLISH_MIN_COLLECTION_TITLES);
  const isPublished = collection?.isPublished === true;
  const canShowPublishControls = showPublishControls && !isDefaultCollection && canPublish;
  const isLongCollectionName = (collection?.name || '').length > 20;

  const detailGridRef = useRef(null);
  useGridKeyNav(detailGridRef, 'button[data-card]');

  useEffect(() => {
    console.log('[Soulstash][React][CollectionDetailPane] publish state', {
      collectionId: collection?._id || collection?.name,
      collectionName: collection?.name,
      isPublished,
      isPublic: collection?.isPublic,
      movieCount: collectionItemCount(collection)
    });
  }, [collection?._id, collection?.isPublished, collection?.isPublic, collection?.name, isPublished]);

  function buildMobileFilterMenuPosition(trigger) {
    const rect = trigger.getBoundingClientRect();
    const viewportPadding = 16;
    const estimatedWidth = 248;
    return {
      top: Math.round(rect.bottom + 10),
      left: Math.round(Math.min(Math.max(rect.left, viewportPadding), window.innerWidth - estimatedWidth - viewportPadding))
    };
  }

  useEffect(() => {
    function handleResize() {
      setIsDesktopFilters(window.innerWidth >= 768);
      if (mobileFiltersOpen && mobileFilterTriggerRef.current) {
        setMobileFilterMenuStyle(buildMobileFilterMenuPosition(mobileFilterTriggerRef.current));
      }
    }

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [mobileFiltersOpen]);

  useEffect(() => {
    if (!mobileFiltersOpen) return undefined;

    function handlePointerDown(event) {
      const clickedInsideMenu = mobileFilterMenuRef.current?.contains(event.target);
      const clickedTrigger = mobileFilterTriggerRef.current?.contains(event.target);
      if (!clickedInsideMenu && !clickedTrigger) {
        setMobileFiltersOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [mobileFiltersOpen]);

  useEffect(() => {
    if (!collection?._id) return undefined;
    const missingRatings = (collection.movies || []).filter((item) => !hasStoredRating(item));
    if (!missingRatings.length) return undefined;
    const requestKey = `${collection._id}:${missingRatings
      .map((item) => `${item.media_type === 'Series' || item.media_type === 'tv' || item.seriesId ? 'series' : 'movie'}:${contentIdFromItem(item)}`)
      .join('|')}`;

    if (attemptedRatingBackfillRef.current === requestKey) return undefined;
    attemptedRatingBackfillRef.current = requestKey;

    let cancelled = false;

    async function enrichMissingRatings() {
      try {
        const response = await enrichCollectionRatingsInBackground(collection);
        if (!cancelled && Array.isArray(response?.collections)) {
          broadcastCollections(response.collections, response?.collectionVersion);
        }
      } catch (error) {
        console.warn('[Soulstash][React] Failed to enrich collection metadata', {
          collectionId: collection._id,
          collectionName: collection.name,
          message: error?.message,
          status: error?.status
        });
      }
    }

    enrichMissingRatings();

    return () => {
      cancelled = true;
    };
  }, [collection?._id, collection?.movies]);

  async function applyPublishChange(nextPublished) {
    try {
      setPublishLoading(true);
      console.log('[Soulstash][React][CollectionDetailPane] togglePublish start', {
        collectionId: collection._id,
        collectionName: collection.name,
        nextPublished
      });
      const currentCollections = normalizeCollections(getCachedUserCollections());
      if (currentCollections.length) {
        const optimistic = currentCollections.map((c) =>
          String(c._id || c.name) === String(collection._id || collection.name)
            ? { ...c, isPublished: nextPublished, isPublic: nextPublished ? true : false }
            : c
        );
        console.log('[Soulstash][React][CollectionDetailPane] optimistic publish state', {
          collectionId: collection._id,
          nextPublished,
          optimisticMatch: optimistic.find((c) => String(c._id || c.name) === String(collection._id || collection.name))?.isPublished
        });
        broadcastCollections(optimistic);
      } else {
        console.log('[Soulstash][React][CollectionDetailPane] skip optimistic update (no cached collections)');
      }
      const response = await apiFetch(`/api/user/collections/${encodeURIComponent(collection._id)}/publish`, {
        method: 'POST',
        body: JSON.stringify({ publish: nextPublished })
      });
      console.log('[Soulstash][React][CollectionDetailPane] publish API response', response);
      if (response?.snapshot?.collections) {
        broadcastCollections(normalizeCollections(response.snapshot.collections), response?.snapshot?.collectionVersion);
      } else {
        if (window.CollectionStore?.invalidate) {
          window.CollectionStore.invalidate();
        }
        if (window.CollectionStore?.getCollections) {
          const latest = await window.CollectionStore.getCollections();
          broadcastCollections(normalizeCollections(latest), lastKnownCollectionVersion);
        } else {
          const latest = await refreshCollectionsView();
          broadcastCollections(latest, lastKnownCollectionVersion);
        }
      }
      if (onPublishChange) onPublishChange();
      toast(nextPublished ? 'Collection published' : 'Collection unpublished');
    } catch (error) {
      await refreshCollectionsView();
      toast(error.message, 'error');
    } finally {
      setPublishLoading(false);
    }
  }

  async function togglePublish() {
    if (!isOwner || publishLoading || !collection?._id || isDefaultCollection) return;
    if (!canPublish) {
      toast(`Add at least ${PUBLISH_MIN_COLLECTION_TITLES} titles to publish this collection`, 'info');
      return;
    }
    const nextPublished = !isPublished;
    if (nextPublished && collection.isPublic !== true) {
      setPublishConfirmOpen(true);
      return;
    }
    await applyPublishChange(nextPublished);
  }

  if (!collection?.name) {
    return (
      <div className="w-full text-center text-gray-400 py-8">
        <div className="p-2 lg:pl-4">
          <div className="h-[calc(100vh-300px-120px)] lg:h-[calc(100vh-200px)] flex items-center justify-center">
            <div className="text-center p-4">
              <i className="fas fa-eye-slash w-12 h-12 lg:w-16 lg:h-16 text-gray-700 mx-auto mb-4 text-5xl"></i>
              <p className="text-gray-400 mb-2">Select a collection from the sidebar</p>
              <p className="text-gray-600 text-sm">or open Watched or Watchlist to browse saved titles</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative isolate">
      {useBannerAsBackdrop ? (
        <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none" style={{ height: '100svh' }}>
          <img
            alt="collection backdrop"
            className="h-full w-full object-cover object-center opacity-30 scale-[1.03]"
            src={collection.banner || FALLBACK_AVATAR}
            onError={(event) => {
              event.currentTarget.src = FALLBACK_AVATAR;
            }}
          />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(7,7,7,0.18)_0%,rgba(7,7,7,0.36)_18%,rgba(7,7,7,0.62)_42%,rgba(7,7,7,0.84)_72%,rgba(7,7,7,0.97)_100%)]"></div>
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_center,rgba(255,255,255,0.08),transparent_22%)]"></div>
        </div>
      ) : null}

      {useBannerAsBackdrop ? (
        <>
          <div className="fixed left-1/2 collection-detail-header-fixed z-[220] w-[min(100vw-20px,1480px)] -translate-x-1/2 sm:w-[min(100vw-32px,1480px)]">
            <div className="rounded-[24px] border border-white/[0.05] bg-[rgba(16,16,16,0.74)] px-4 py-3 sm:px-5 sm:py-4 shadow-[0_16px_42px_rgba(0,0,0,0.24)] backdrop-blur-[14px]">
              <div className="hidden lg:flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0 shrink">
                  <h1 className="text-[clamp(1.1rem,1.4vw,1.6rem)] font-semibold text-white truncate leading-tight">{collection.name}</h1>
                  <CollectionVisibilityBadge collection={collection} />
                  <span className="flex-shrink-0 rounded-full bg-black/25 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-[#ffd2a8]">
                    {collection.movieCount || 0} saved
                  </span>
                </div>
                <div className="flex items-center gap-2 justify-end min-w-0">
                  {showFilteredResultsCount ? (
                    <span className="flex-shrink-0 text-[11px] font-medium uppercase tracking-[0.14em] text-[#8f8f8f]">
                      {movies.length} results
                    </span>
                  ) : null}
                  <CollectionFilterControls
                    filters={filters}
                    setFilters={setFilters}
                    noWrap
                    size="desktop"
                  />
                  {isOwner ? (
                    <button
                      type="button"
                      className="flex-shrink-0 flex h-9 items-center justify-center gap-2 rounded-[16px] bg-[#2a2a2a] px-4 text-[13px] font-medium text-white transition-colors hover:bg-[#343434] focus:outline-none focus:ring-2 focus:ring-white"
                      onClick={onOpenDrawer}
                      aria-label="Add content to collection"
                    >
                      <i className="fas fa-plus"></i>
                      <span>Add Content</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="flex-shrink-0 flex h-9 items-center justify-center gap-2 rounded-[16px] bg-white/[0.1] px-4 text-[13px] font-medium text-white transition-colors hover:bg-white/[0.16] focus:outline-none focus:ring-2 focus:ring-white"
                      onClick={() => navigate(`/user/${username}`)}
                    >
                      <i className="fas fa-user"></i>
                      <span>View Profile</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="relative z-[400] flex items-center justify-between gap-3 lg:hidden">
                <div ref={mobileFilterMenuRef} className="relative z-[410] min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <button
                      ref={mobileFilterTriggerRef}
                      type="button"
                      className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[14px] bg-white/[0.1] text-white transition-colors hover:bg-white/[0.16] focus:outline-none focus:ring-2 focus:ring-white"
                      onClick={(event) => {
                        setMobileFilterMenuStyle(buildMobileFilterMenuPosition(event.currentTarget));
                        setMobileFiltersOpen((current) => !current);
                      }}
                      aria-label="Open filters"
                    >
                      <i className="fas fa-bars text-sm"></i>
                    </button>
                    <div className="flex min-w-0 items-center gap-2">
                      <h1 className="text-xl font-semibold text-white truncate">{collection.name}</h1>
                      <CollectionVisibilityBadge collection={collection} iconOnly={isLongCollectionName} />
                    </div>
                  </div>
                  {showFilteredResultsCount ? (
                    <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.14em] text-[#8f8f8f]">
                      {movies.length} results
                    </p>
                  ) : null}
                  {mobileFiltersOpen
                    ? createPortal(
                        <div
                          ref={mobileFilterMenuRef}
                          className="filter-scrollbar-hidden overflow-visible rounded-[24px] border border-white/10 bg-[rgba(20,20,20,0.96)] p-3 shadow-[0_24px_60px_rgba(0,0,0,0.5)] backdrop-blur-[18px]"
                          style={{
                            position: 'fixed',
                            zIndex: 2147483646,
                            top: mobileFilterMenuStyle.top,
                            left: mobileFilterMenuStyle.left,
                            width: 'max-content',
                            maxWidth: 'calc(100vw - 32px)'
                          }}
                        >
                          <CollectionFilterControls
                            filters={filters}
                            setFilters={setFilters}
                            stacked
                            size="desktop"
                          />
                        </div>,
                        document.body
                      )
                    : null}
                </div>
                {isOwner ? (
                  <div className="flex items-center gap-2">
                    {canShowPublishControls ? (
                      <button
                        type="button"
                        className="flex h-10 items-center justify-center gap-2 rounded-[14px] px-3 text-sm font-medium transition-colors bg-[#2a2a2a] text-white hover:bg-[#343434] focus:outline-none focus:ring-2 focus:ring-white"
                        onClick={togglePublish}
                      >
                        <i className={`fas ${isPublished ? 'fa-star' : 'fa-bullhorn'}`}></i>
                        <span>{isPublished ? 'Unpublish' : 'Publish'}</span>
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={`flex h-10 flex-shrink-0 items-center justify-center gap-2 rounded-[14px] bg-white/[0.1] text-sm font-medium text-white transition-colors hover:bg-white/[0.16] focus:outline-none focus:ring-2 focus:ring-white ${isLongCollectionName ? 'w-10' : 'px-3'}`}
                      onClick={onOpenDrawer}
                      aria-label="Add content to collection"
                    >
                      <i className="fas fa-plus"></i>
                      {isLongCollectionName ? null : <span>Add</span>}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="flex h-10 flex-shrink-0 items-center justify-center gap-2 rounded-[14px] bg-white/[0.1] px-3 text-sm font-medium text-white transition-colors hover:bg-white/[0.16] focus:outline-none focus:ring-2 focus:ring-white"
                    onClick={() => navigate(`/user/${username}`)}
                  >
                    <i className="fas fa-user"></i>
                    <span>Profile</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="collection-detail-header-spacer"></div>
        </>
      ) : (
        <div className="w-full aspect-[21/9] min-h-[200px] md:min-h-[156px] rounded-[26px] mb-0 relative overflow-hidden shadow-[0_18px_40px_rgba(0,0,0,0.24)]">
          <img
            alt="collection banner"
            className="absolute inset-0 h-full w-full object-cover"
            src={collection.banner || FALLBACK_AVATAR}
            onError={(event) => {
              event.currentTarget.src = FALLBACK_AVATAR;
            }}
          />
          <div className="absolute inset-0" aria-hidden="true" style={{ background: 'linear-gradient(180deg, rgba(8, 8, 8, 0.02) 0%, rgba(8, 8, 8, 0.12) 30%, rgba(8, 8, 8, 0.42) 62%, rgba(8, 8, 8, 0.78) 84%, rgba(8, 8, 8, 0.96) 100%)' }}></div>
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.08),transparent_28%),radial-gradient(circle_at_left_center,rgba(150,123,255,0.08),transparent_30%)]"></div>

          {/* Back arrow Ã¢â‚¬â€ always visible on standalone; hidden on desktop in dashboard layout */}
          <button
            type="button"
            className={`absolute top-4 left-4 bg-black/70 p-2.5 rounded-full hover:bg-black/90 transition-colors z-10 focus:outline-none focus:ring-2 focus:ring-white
              ${!onBackToCollections && !useBannerAsBackdrop ? 'lg:hidden flex' : 'flex'}
            `}
            onClick={() => {
              if (onBackToCollections) {
                onBackToCollections();
                return;
              }
              navigate(`/user/${username}/collections`);
            }}
            aria-label="Back to collections"
          >
            <i className="fas fa-arrow-left text-white"></i>
          </button>

          {/* Mobile bottom overlay: title left */}
          <div className="absolute bottom-4 left-4 z-10 md:hidden pr-[140px]">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-semibold text-white break-words leading-tight">{collection.name}</h1>
              <CollectionVisibilityBadge collection={collection} iconOnly={isLongCollectionName} />
              <span className="rounded-full bg-black/25 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-[#ffd2a8]">
                {collection.movieCount || 0} saved
              </span>
            </div>
          </div>
          <div className="absolute top-4 right-4 z-20 md:hidden">
            {isOwner ? (
              <div className="flex items-center gap-2">
                {canShowPublishControls ? (
                  <button
                    type="button"
                    className="flex items-center gap-1.5 text-xs h-9 px-3 rounded-2xl transition-colors bg-[#2a2a2a] text-white hover:bg-[#343434] focus:outline-none focus:ring-2 focus:ring-white"
                    onClick={togglePublish}
                  >
                    <i className={`fas ${isPublished ? 'fa-star' : 'fa-bullhorn'}`}></i>
                    <span>{isPublished ? 'Unpublish' : 'Publish'}</span>
                  </button>
                ) : null}
                <button
                  type="button"
                  className={`flex items-center justify-center gap-1.5 bg-[#2a2a2a] hover:bg-[#343434] text-white transition-colors text-xs h-9 focus:outline-none focus:ring-2 focus:ring-white ${isLongCollectionName ? 'w-9 rounded-full' : 'px-3 rounded-2xl'}`}
                  onClick={onOpenDrawer}
                  aria-label="Add content to collection"
                >
                  <i className="fas fa-plus"></i>
                  {isLongCollectionName ? null : <span>Add</span>}
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="flex items-center gap-1.5 bg-white/[0.12] hover:bg-white/[0.18] text-white transition-colors text-xs h-9 px-3 rounded-2xl focus:outline-none focus:ring-2 focus:ring-white"
                onClick={() => navigate(`/user/${username}`)}
              >
                <i className="fas fa-user"></i>
                <span>Profile</span>
              </button>
            )}
          </div>

          <div className="absolute bottom-0 left-0 right-0 z-10 hidden md:flex items-center justify-between gap-3 px-5 py-3.5" style={{ background: 'linear-gradient(to top, rgba(8,8,8,0.95) 0%, rgba(8,8,8,0.78) 34%, rgba(8,8,8,0.44) 70%, transparent 100%)' }}>
            <div className="flex items-center gap-2 min-w-0 shrink">
              <h1 className="text-[clamp(1.1rem,1.4vw,1.6rem)] font-semibold text-white truncate leading-tight">{collection.name}</h1>
              <CollectionVisibilityBadge collection={collection} />
              <span className="flex-shrink-0 rounded-full bg-black/30 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-[#ffd2a8]">
                {collection.movieCount || 0} saved
              </span>
            </div>
            {isOwner ? (
              <div className="flex items-center gap-2">
                {canShowPublishControls ? (
                  <button
                    type="button"
                    className="flex h-9 items-center justify-center gap-2 rounded-[16px] px-4 text-[13px] font-medium transition-colors bg-[#2a2a2a] text-white hover:bg-[#343434] focus:outline-none focus:ring-2 focus:ring-white"
                    onClick={togglePublish}
                  >
                    <i className={`fas ${isPublished ? 'fa-star' : 'fa-bullhorn'}`}></i>
                    <span>{isPublished ? 'Unpublish' : 'Publish'}</span>
                  </button>
                ) : null}
                <button
                  type="button"
                  className="flex-shrink-0 flex h-9 items-center justify-center gap-2 rounded-[16px] bg-[#2a2a2a] hover:bg-[#343434] px-4 text-[13px] font-medium text-white transition-colors focus:outline-none focus:ring-2 focus:ring-white"
                  onClick={onOpenDrawer}
                  aria-label="Add content to collection"
                >
                  <i className="fas fa-plus"></i>
                  <span>Add Content</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="flex-shrink-0 flex h-9 items-center justify-center gap-2 rounded-[16px] bg-white/[0.14] hover:bg-white/[0.22] px-4 text-[13px] font-medium text-white transition-colors focus:outline-none focus:ring-2 focus:ring-white"
                onClick={() => navigate(`/user/${username}`)}
              >
                <i className="fas fa-user"></i>
                <span>View Profile</span>
              </button>
            )}
          </div>
        </div>
      )}

      <div className={`flex flex-col gap-4 w-full ${useBannerAsBackdrop ? 'mt-2 lg:mt-3' : 'mt-5 lg:mt-6'}`}>
        {!useBannerAsBackdrop ? (
          isDesktopFilters ? (
            <div className="rounded-[22px] border border-white/[0.05] bg-[rgba(16,16,16,0.74)] p-3 shadow-[0_16px_42px_rgba(0,0,0,0.24)] backdrop-blur-[14px] relative z-[120] overflow-x-auto overflow-y-visible filter-scrollbar-hidden">
              <CollectionFilterControls
                filters={filters}
                setFilters={setFilters}
                noWrap
                size="desktop"
              />
            </div>
          ) : null
        ) : null}
        {!useBannerAsBackdrop ? (
          !isDesktopFilters ? (
            <div className="rounded-[22px] border border-white/[0.05] bg-[rgba(16,16,16,0.74)] p-3 shadow-[0_16px_42px_rgba(0,0,0,0.24)] backdrop-blur-[14px]">
              <CollectionFilterControls
                filters={filters}
                setFilters={setFilters}
              />
            </div>
          ) : null
        ) : null}
        {movies.length ? (
          <div ref={detailGridRef} className="relative z-0 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-2 sm:gap-3 lg:gap-4">
            {movies.map((movie) => (
              <CollectionPosterCard
                key={Number(movie.movieId || movie.seriesId || movie.id || movie._id || 0)}
                item={movie}
                onRemove={isOwner ? onRemoveFromCollection : null}
                data-card
              />
            ))}
          </div>
        ) : (
          <div className="flex w-full items-center justify-center py-8 text-center text-gray-400" style={{ padding: 0 }}>
            <div className="flex w-full items-center justify-center p-2 lg:pl-4">
              <div className="flex h-[calc((100vh-300px-120px)*0.8)] w-full items-center justify-center lg:h-[calc((100vh-200px)*0.8)]">
                <div className="text-center p-4">
                  <i className="fas fa-eye-slash w-12 h-12 lg:w-16 lg:h-16 text-gray-500 mx-auto mb-4 text-5xl"></i>
                  <p className="text-gray-200 mb-2">
                    {collection.movieCount ? 'No titles match the current filters.' : 'This collection is empty.'}
                  </p>
                  {isOwner ? (
                    <p className="text-gray-400 text-sm">Add content or change filters to see titles here.</p>
                  ) : (
                    <button
                      type="button"
                      className="mt-2 inline-flex h-9 items-center justify-center gap-2 rounded-full bg-white/10 px-4 text-sm font-medium text-white transition-colors hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white"
                      onClick={() => navigate(`/user/${username}`)}
                    >
                      <i className="fas fa-user"></i>
                      <span>View {username}'s profile</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      <ConfirmModal
        open={publishConfirmOpen}
        title="Publish this collection?"
        message={`"${collection.name}" is private. Publishing will make it public first, then publish it for discovery.`}
        confirmLabel="Make Public & Publish"
        onConfirm={async () => {
          setPublishConfirmOpen(false);
          await applyPublishChange(true);
        }}
        onClose={() => setPublishConfirmOpen(false)}
      />
    </div>
  );
}

function UserCollectionsPage() {
  const { username = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { collections, loading } = useLiveCollections();
  const [isCompactCollectionsView, setIsCompactCollectionsView] = useState(() => window.innerWidth < 1024);
  const [mobileSidebarVisible, setMobileSidebarVisible] = useState(() => window.innerWidth < 1024);
  const stateKeyBase = `collections-page:${location.pathname}`;
  const [query, setQuery] = useSessionState(`${stateKeyBase}:query`, '');
  const [visibilityFilter, setVisibilityFilter] = useSessionState(`${stateKeyBase}:visibility`, 'all');
  const [selectedCollectionName, setSelectedCollectionName] = useSessionState(`${stateKeyBase}:selected`, '');
  const [localCollectionOrder, setLocalCollectionOrder] = useState([]);
  const [filters, setFilters] = useSessionState(`${stateKeyBase}:filters`, { contentType: 'all', anime: 'yes', sortBy: 'recent', hideWatched: false });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState(createEmptyCollectionDraft);
  const [createLoading, setCreateLoading] = useState(false);
  const [editDraft, setEditDraft] = useState(createEmptyCollectionDraft);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editTargetId, setEditTargetId] = useState('');
  const [removeTarget, setRemoveTarget] = useState(null);
  const [collectionDeleteTarget, setCollectionDeleteTarget] = useState(null);
  const [draggedCollectionId, setDraggedCollectionId] = useState('');
  const [dragOverCollectionId, setDragOverCollectionId] = useState('');
  const collectionMenuTriggerRefs = useRef(new Map());
  const [pendingItems, setPendingItems] = useState(new Set());
  // Track enriched collection IDs to prevent re-triggering on state updates
  const enrichedCollectionIdsRef = useRef(new Set());

  const sidebarListRef = useRef(null);

  useEffect(() => {
    const list = sidebarListRef.current;
    if (!list) return;

    const handleKeyDown = (event) => {
      const items = Array.from(list.querySelectorAll('[tabindex="0"]'));
      const currentIndex = items.indexOf(document.activeElement);
      if (currentIndex === -1) return;

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        const next = items[currentIndex + 1];
        if (next) {
          next.focus();
          next.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (currentIndex === 0) {
          // Jump back up to search input
          document.querySelector('input[placeholder="Search Collections"]')?.focus();
        } else {
          const prev = items[currentIndex - 1];
          if (prev) {
            prev.focus();
            prev.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
        }
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        // Focus the navigate arrow button inside this item
        const row = items[currentIndex];
        row?.querySelector('button[aria-label^="Open"]')?.focus();
      }
    };

    list.addEventListener('keydown', handleKeyDown);
    return () => list.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (!isCompactCollectionsView) return undefined;

    function handlePopState(event) {
      if (!selectedCollectionName || mobileSidebarVisible) return;
      if (event.state?.soulstashCollectionsMobileDetail) {
        return;
      }
      setMobileSidebarVisible(true);
    }

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isCompactCollectionsView, mobileSidebarVisible, selectedCollectionName]);
  const [openCollectionMenuId, setOpenCollectionMenuId] = useState('');
  const [collectionMenuPosition, setCollectionMenuPosition] = useState({ top: 0, left: 0 });

  function getCollectionMenuPosition(triggerRect, estimatedWidth = 168, estimatedHeight = 116) {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const left = Math.min(Math.max(16, triggerRect.left), Math.max(16, viewportWidth - estimatedWidth - 16));
    const belowTop = triggerRect.bottom + 8;
    const aboveTop = triggerRect.top - estimatedHeight - 8;
    const top =
      belowTop + estimatedHeight <= viewportHeight - 16 || aboveTop < 16
        ? Math.min(belowTop, Math.max(16, viewportHeight - estimatedHeight - 16))
        : aboveTop;
    return { top, left };
  }

  useEffect(() => {
    if (!openCollectionMenuId) return undefined;

    function updateMenuPosition() {
      const trigger = collectionMenuTriggerRefs.current.get(openCollectionMenuId);
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      setCollectionMenuPosition(getCollectionMenuPosition(rect));
    }

    updateMenuPosition();
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    return () => {
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [openCollectionMenuId]);

  useEffect(() => {
    document.title = 'My Collections';
  }, []);

  useEffect(() => {
    function handleResize() {
      const compact = window.innerWidth < 1024;
      setIsCompactCollectionsView(compact);
      setMobileSidebarVisible((current) => {
        if (!compact) return true;
        return selectedCollectionName ? current : true;
      });
    }

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [selectedCollectionName]);

  useEffect(() => {
    console.log('[Soulstash][React] UserCollectionsPage mounted', {
      route: window.location.pathname,
      username,
      collectionsCount: collections.length,
      loading
    });
  }, [username, collections.length, loading]);

  useEffect(() => {
    const collectionIds = collections.map((collection) => String(collection._id || collection.name));
    setLocalCollectionOrder((current) => {
      const currentSet = new Set(current);
      const next = current.filter((id) => collectionIds.includes(id));
      collectionIds.forEach((id) => {
        if (!currentSet.has(id)) {
          next.push(id);
        }
      });
      return next.length ? next : collectionIds;
    });
  }, [collections]);


  useEffect(() => {
    const collectionsNeedingRatings = collections.filter(
      (collection) => (collection.movies || []).some((item) => !hasStoredRating(item))
    );
    if (!collectionsNeedingRatings.length) return undefined;

    // Only enrich collections not yet attempted this session
    const pending = collectionsNeedingRatings.filter((c) => {
      const key = String(c._id || c.name);
      return !enrichedCollectionIdsRef.current.has(key);
    });
    if (!pending.length) {
      console.log('[Soulstash][React][CollectionsPage] enrichment effect Ã¢â‚¬â€ all needy collections already attempted, skipping');
      return undefined;
    }

    console.log(`[Soulstash][React][CollectionsPage] enrichment effect Ã¢â‚¬â€ queuing ${pending.length} collection(s):`, pending.map(c => c.name));

    // Mark as attempted immediately to prevent re-queuing on re-renders
    pending.forEach((c) => enrichedCollectionIdsRef.current.add(String(c._id || c.name)));

    let cancelled = false;

    async function backfillLoadedCollections() {
      for (const collection of pending) {
        if (cancelled) return;
        try {
          const response = await enrichCollectionRatingsInBackground(collection, '[Soulstash][React][CollectionsPage]');
        if (!cancelled && Array.isArray(response?.collections)) {
          broadcastCollections(response.collections, response?.collectionVersion);
        }
        } catch (enrichError) {
          console.warn('[Soulstash][React][CollectionsPage] Failed to enrich collection metadata', {
            collectionId: collection?._id,
            collectionName: collection?.name,
            message: enrichError?.message,
            status: enrichError?.status
          });
        }
      }
    }

    backfillLoadedCollections();

    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collections.length]);



  const orderedCollections = useMemo(() => {
    if (!localCollectionOrder.length) return collections;
    const byId = new Map(collections.map((collection) => [String(collection._id || collection.name), collection]));
    const ordered = [];
    localCollectionOrder.forEach((id) => {
      const collection = byId.get(id);
      if (collection) {
        ordered.push(collection);
        byId.delete(id);
      }
    });
    return [...ordered, ...byId.values()];
  }, [collections, localCollectionOrder]);

  const filteredCollections = useMemo(() => {
    return orderedCollections.filter((collection) => {
      const matchesQuery = !query.trim() || collection.name.toLowerCase().includes(query.trim().toLowerCase());
      const matchesVisibility =
        visibilityFilter === 'all' ||
        (visibilityFilter === 'public' && collection.isPublic) ||
        (visibilityFilter === 'private' && !collection.isPublic);
      return matchesQuery && matchesVisibility;
    });
  }, [orderedCollections, query, visibilityFilter]);
  const showCollectionsResultsCount = !!query.trim() || visibilityFilter !== 'all';

  const watchedCollection = useMemo(() => collections.find((item) => item.name === 'Watched'), [collections]);
  const watchedIds = useMemo(
    () => new Set((watchedCollection?.movies || []).map((movie) => Number(movie.movieId || movie.seriesId || movie.id || movie._id || 0))),
    [watchedCollection]
  );
  const selectedCollection = useMemo(
    () => normalizeCollection(filteredCollections.find((item) => item.name === selectedCollectionName) || collections.find((item) => item.name === selectedCollectionName)),
    [collections, filteredCollections, selectedCollectionName]
  );

  useEffect(() => {
    if (!selectedCollectionName) return;
    const existsInAll = collections.some((item) => item.name === selectedCollectionName);
    if (!existsInAll) {
      return;
    }
  }, [collections, selectedCollectionName]);

  useEffect(() => {
    if (!selectedCollectionName && filteredCollections.length && window.innerWidth >= 1024) {
      setSelectedCollectionName(filteredCollections[0].name);
    }
  }, [filteredCollections, selectedCollectionName]);

  useEffect(() => {
    if (!isCompactCollectionsView) {
      setMobileSidebarVisible(true);
      return;
    }

    if (!selectedCollectionName) {
      setMobileSidebarVisible(true);
    }
  }, [isCompactCollectionsView, selectedCollectionName]);

  async function handleAddToCollection(item, mediaType) {
    if (!selectedCollection?._id) return;

    const payload =
      mediaType === 'Series'
        ? {
            seriesId: Number(item._id || item.id),
            title: item.title || item.name || 'Unknown',
            poster_path: item.poster_path || '',
            release_date: item.release_date || item.first_air_date || '',
            media_type: 'Series'
          }
        : {
            movieId: Number(item._id || item.id),
            title: item.title || item.name || 'Unknown',
            poster_path: item.poster_path || '',
            release_date: item.release_date || '',
            media_type: 'Movie'
          };

    const contentId = Number(payload.movieId || payload.seriesId);
    
    try {
      setPendingItems(prev => new Set(prev).add(contentId));
      const response = window.CollectionStore?.addToCollection
        ? await window.CollectionStore.addToCollection(selectedCollection._id, payload)
        : await apiFetch(`/api/user/collections/${encodeURIComponent(selectedCollection._id)}/add`, {
            method: 'POST',
            body: JSON.stringify(payload)
          });
      if (!window.CollectionStore?.addToCollection) {
        if (Array.isArray(response?.collections)) {
          broadcastCollections(normalizeCollections(response.collections), response?.collectionVersion);
        } else {
          await refreshCollectionsView();
        }
      }
      toast(response.message || 'Added to collection');
    } catch (error) {
      if (error.status === 409) {
        toast('Already in this collection', 'info');
        return;
      }
      toast(error.message, 'error');
    } finally {
      setPendingItems(prev => {
        const next = new Set(prev);
        next.delete(contentId);
        return next;
      });
    }
  }

  function handleRemoveFromCollection(itemId, title) {
    setRemoveTarget({ itemId, title });
  }

  async function confirmRemoveFromCollection() {
    if (!removeTarget) return;
    if (!selectedCollection?._id) return;
    const pendingRemoval = removeTarget;
    const target = (selectedCollection.movies || []).find(
      (item) => Number(item.movieId || item.seriesId || item.id || item._id || 0) === Number(pendingRemoval.itemId)
    );
    if (!target) return;
    setRemoveTarget(null);

    const collectionId = selectedCollection._id;
    const itemId = Number(target.movieId || target.seriesId || target.id || target._id || 0);

    // Optimistically move item out of collection cache and into trash
    trashItemFromCollectionCache(collectionId, itemId);

    try {
      setPendingItems(prev => new Set(prev).add(itemId));
      if (window.CollectionStore?.removeFromCollection) {
        await window.CollectionStore.removeFromCollection(collectionId, target.movieId, target.seriesId);
      } else {
        const removeResp = await apiFetch(
          `/api/user/collections/${encodeURIComponent(collectionId)}/remove`,
          {
            method: 'POST',
            body: JSON.stringify({
              ...(target.movieId ? { movieId: Number(target.movieId) } : {}),
              ...(target.seriesId ? { seriesId: Number(target.seriesId) } : {})
            })
          }
        );
        if (Array.isArray(removeResp?.collections)) {
          broadcastCollections(normalizeCollections(removeResp.collections), removeResp?.collectionVersion);
        } else {
          await refreshCollectionsView();
        }
      }
      // Backend confirmed Ã¢â‚¬â€ permanently purge from trash
      confirmTrashItem(collectionId, itemId);
      toast(`Removed ${pendingRemoval.title}`);
    } catch (error) {
      // Backend failed Ã¢â‚¬â€ restore item from trash back into the collection
      restoreTrashItem(collectionId, itemId);
      setRemoveTarget(pendingRemoval);
      toast(error.message, 'error');
    } finally {
      setPendingItems(prev => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
    }
  }

  async function handleCreateCollection() {
    try {
      if (!createDraft.name.trim()) {
        toast('Please enter a collection name', 'error');
        return;
      }
      if (createDraft.name.trim().length > COLLECTION_NAME_MAX_LENGTH) {
        toast(`Collection name must be ${COLLECTION_NAME_MAX_LENGTH} characters or less`, 'error');
        return;
      }
      setCreateLoading(true);
      const collectionName = createDraft.name.trim();
      if (window.CollectionStore?.createCollection) {
        await window.CollectionStore.createCollection(collectionName, createDraft.isPublic, createDraft.description.trim());
      } else {
        const response = await apiFetch('/api/user/collections', {
          method: 'POST',
          body: JSON.stringify({
            name: collectionName,
            isPublic: createDraft.isPublic,
            description: createDraft.description.trim()
          })
        });
        if (Array.isArray(response?.collections)) {
          broadcastCollections(response.collections, response?.collectionVersion);
        } else {
          await refreshCollectionsView();
        }
      }
      setSelectedCollectionName(collectionName);
      setCreateDraft(createEmptyCollectionDraft());
      setCreateModalOpen(false);
      toast(`Created ${collectionName}`);
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setCreateLoading(false);
    }
  }

  function openEditModal(collection) {
    setEditTargetId(collection._id || collection.name);
    setEditDraft({
      name: collection.name || '',
      description: collection.description || '',
      isPublic: !!collection.isPublic,
      isPublished: collection.isPublished === true
    });
    setEditModalOpen(true);
  }

  async function handleEditCollection() {
    if (!editTargetId) return;
    if (!editDraft.name.trim()) {
      toast('Please enter a collection name', 'error');
      return;
    }
    if (editDraft.name.trim().length > COLLECTION_NAME_MAX_LENGTH) {
      toast(`Collection name must be ${COLLECTION_NAME_MAX_LENGTH} characters or less`, 'error');
      return;
    }
    if (editDraft.isPublished === true && editDraft.isPublic === false) {
      toast('Unpublish this collection before making it private', 'error');
      return;
    }

    try {
      setCreateLoading(true);
      const collectionName = editDraft.name.trim();
      if (window.CollectionStore?.updateCollection) {
        await window.CollectionStore.updateCollection(editTargetId, collectionName, editDraft.isPublic, editDraft.description.trim());
      } else {
        const response = await apiFetch(`/api/user/collections/${encodeURIComponent(editTargetId)}`, {
          method: 'PUT',
          body: JSON.stringify({
            name: collectionName,
            isPublic: editDraft.isPublic,
            description: editDraft.description.trim()
          })
        });
        if (Array.isArray(response?.collections)) {
          broadcastCollections(response.collections, response?.collectionVersion);
        } else {
          await refreshCollectionsView();
        }
      }
      setSelectedCollectionName(collectionName);
      setEditModalOpen(false);
      setEditTargetId('');
      toast(`Updated ${collectionName}`);
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setCreateLoading(false);
    }
  }

  async function reorderCollections(sourceId, targetId) {
    if (!sourceId || !targetId || sourceId === targetId) return;

    const orderedIds = orderedCollections.map((collection) => String(collection._id || collection.name));
    const sourceIndex = orderedIds.indexOf(String(sourceId));
    const targetIndex = orderedIds.indexOf(String(targetId));
    if (sourceIndex === -1 || targetIndex === -1) return;

    const nextOrder = [...orderedIds];
    const [moved] = nextOrder.splice(sourceIndex, 1);
    nextOrder.splice(targetIndex, 0, moved);
    const previousOrder = orderedIds;

    setLocalCollectionOrder(nextOrder);

    try {
      if (window.CollectionStore?.reorderCollections) {
        await window.CollectionStore.reorderCollections(nextOrder);
      } else {
        await apiFetch('/api/user/collections/reorder', {
          method: 'POST',
          body: JSON.stringify({ order: nextOrder })
        });
      }
      toast('Collection order saved');
    } catch (error) {
      setLocalCollectionOrder(previousOrder);
      toast(error.message, 'error');
    }
  }

  function handleCollectionDragStart(event, collectionId) {
    setDraggedCollectionId(collectionId);
    setDragOverCollectionId(collectionId);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', collectionId);
  }

  function handleCollectionDragEnter(collectionId) {
    if (!draggedCollectionId || draggedCollectionId === collectionId) return;
    setDragOverCollectionId(collectionId);
  }

  async function handleCollectionDrop(event, targetId) {
    event.preventDefault();
    const sourceId = event.dataTransfer.getData('text/plain') || draggedCollectionId;
    setDragOverCollectionId('');
    setDraggedCollectionId('');
    await reorderCollections(sourceId, targetId);
  }

  function resetCollectionDragState() {
    setDraggedCollectionId('');
    setDragOverCollectionId('');
  }

  async function handleDeleteCollection(collection) {
    const cacheSnapshot = optimisticRemoveCollectionFromCache(collection._id || collection.name);
    try {
      if (window.CollectionStore?.deleteCollection) {
        await window.CollectionStore.deleteCollection(collection._id || collection.name);
      } else {
        const response = await apiFetch(`/api/user/collections/${encodeURIComponent(collection._id || collection.name)}`, {
          method: 'DELETE'
        });
        if (Array.isArray(response?.collections)) {
          broadcastCollections(response.collections, response?.collectionVersion);
        } else {
          await refreshCollectionsView();
        }
      }
      if (selectedCollectionName === collection.name) {
        setSelectedCollectionName('');
      }
      setOpenCollectionMenuId('');
      toast(`Deleted ${collection.name}`);
    } catch (error) {
      if (cacheSnapshot) {
        broadcastCollections(cacheSnapshot, lastKnownCollectionVersion);
      }
      toast(error.message, 'error');
    }
  }

  return (
    <div className="w-full max-w-none px-2 sm:px-5 md:px-4 lg:px-5 xl:px-5 2xl:px-8">
      <div className="flex flex-col lg:flex-row min-h-[calc(100vh-88px)] gap-4 lg:gap-5 xl:gap-5">
        <div className={`${isCompactCollectionsView && !mobileSidebarVisible ? 'hidden' : 'block'} w-full lg:w-[clamp(280px,28vw,340px)] lg:flex-shrink lg:sticky lg:top-[88px] lg:self-start`}>
          <aside className="w-full overflow-hidden rounded-[28px] bg-[linear-gradient(180deg,rgba(19,19,19,0.88),rgba(12,12,12,0.94))] shadow-[0_22px_58px_rgba(0,0,0,0.28)] backdrop-blur-[10px]">
            <div className="px-4 lg:px-5 pt-4 lg:pt-5 pb-4 flex flex-col gap-4 flex-shrink-0">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold text-white mt-1">My Collections</h2>
                  {showCollectionsResultsCount ? (
                    <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.14em] text-[#8f8f8f]">
                      {filteredCollections.length} results
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/[0.08] text-white hover:bg-white/[0.14] transition-colors focus:outline-none focus:ring-2 focus:ring-white"
                  onClick={() => setCreateModalOpen(true)}
                  aria-label="Create collection"
                >
                  <i className="fas fa-plus"></i>
                </button>
              </div>
              <div className="relative w-full">
                <div className="flex items-center px-4 py-3 bg-[#161616] rounded-2xl transition-all">
                  <i className="fas fa-search w-4 h-4 text-gray-400 mr-3"></i>
                  <input
                    placeholder="Search Collections"
                    className="bg-transparent border-none text-sm font-medium text-[#E2E2E2] focus:outline-none w-full"
                    type="text"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowDown') {
                        event.preventDefault();
                        const firstItem = sidebarListRef.current?.querySelector('[tabindex="0"]');
                        if (firstItem) {
                          firstItem.focus();
                          firstItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                        }
                      }
                    }}
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 w-full">
                {['all', 'public', 'private'].map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    className={`flex items-center justify-center h-10 rounded-2xl transition-all duration-300 ease-in-out focus:outline-none focus:ring-2 focus:ring-white ${
                      visibilityFilter === filter ? 'bg-white text-black' : 'bg-[#141414] text-[#C6C6C6]'
                    }`}
                    onClick={() => setVisibilityFilter(filter)}
                  >
                    <span className="text-xs font-medium truncate capitalize">{filter}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="max-h-[60vh] overflow-y-auto min-h-0 px-2 pb-3">
              <div ref={sidebarListRef} className="space-y-2 py-2" id="collectionsList">
                {filteredCollections.map((collection) => (
                  <div key={collection._id} style={{ opacity: 1 }}>
                    {(() => {
                      const collectionId = String(collection._id || collection.name);
                      const isDragged = draggedCollectionId === collectionId;
                      const isDropTarget = dragOverCollectionId === collectionId && draggedCollectionId && draggedCollectionId !== collectionId;
                      return (
                    <div
                      className={`relative flex items-center gap-2 p-3 rounded-[24px] cursor-pointer border transition-all duration-300 outline-none focus:bg-white/[0.08] focus:ring-2 focus:ring-white focus:border-transparent ${
                        isDragged ? 'opacity-60 scale-[0.985]' : ''
                      } ${
                        isDropTarget ? 'ring-1 ring-white/30 bg-white/[0.06]' : ''
                      } ${
                        selectedCollection?.name === collection.name
                          ? 'bg-white/[0.08] border-transparent shadow-[0_14px_32px_rgba(0,0,0,0.18)]'
                          : 'bg-transparent border-transparent hover:bg-white/[0.04]'
                      }`}
                      draggable
                      tabIndex={0}
                      onDragStart={(event) => handleCollectionDragStart(event, collectionId)}
                      onDragEnter={() => handleCollectionDragEnter(collectionId)}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = 'move';
                      }}
                      onDrop={(event) => handleCollectionDrop(event, collectionId)}
                      onDragEnd={resetCollectionDragState}
                      onClick={() => {
                        setSelectedCollectionName(collection.name);
                        if (window.innerWidth < 1024) {
                          window.history.pushState({ soulstashCollectionsMobileDetail: true }, '', window.location.href);
                          setMobileSidebarVisible(false);
                        }
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          setSelectedCollectionName(collection.name);
                          if (window.innerWidth < 1024) {
                            window.history.pushState({ soulstashCollectionsMobileDetail: true }, '', window.location.href);
                            setMobileSidebarVisible(false);
                          }
                        }
                      }}
                    >
                      <button
                        type="button"
                        className="flex h-9 w-5 cursor-grab items-center justify-center text-[#8d8d8d] hover:text-white transition-colors focus:bg-white/[0.08] focus:ring-2 focus:ring-white focus:outline-none rounded-full"
                        onClick={(event) => event.stopPropagation()}
                        onMouseDown={(event) => event.stopPropagation()}
                        aria-label={`Reorder ${collection.name}`}
                        title="Drag to reorder"
                      >
                        <span className="grid grid-cols-2 gap-[2px]">
                          <span className="h-[3px] w-[3px] rounded-full bg-current"></span>
                          <span className="h-[3px] w-[3px] rounded-full bg-current"></span>
                          <span className="h-[3px] w-[3px] rounded-full bg-current"></span>
                          <span className="h-[3px] w-[3px] rounded-full bg-current"></span>
                          <span className="h-[3px] w-[3px] rounded-full bg-current"></span>
                          <span className="h-[3px] w-[3px] rounded-full bg-current"></span>
                        </span>
                      </button>
                      <div className="w-[48px] h-[48px] rounded-[16px] overflow-hidden flex-shrink-0">
                        <img
                          src={collection.banner || FALLBACK_AVATAR}
                          alt={collection.name}
                          className="w-full h-full object-cover"
                          onError={(event) => {
                            event.currentTarget.src = FALLBACK_AVATAR;
                          }}
                        />
                      </div>
                      <div className="flex-1 text-left min-w-0">
                        <div className="flex flex-col gap-1">
                          <h3 className="text-white font-medium"><MarqueeText text={collection.name} maxChars={25} /></h3>
                          <div className="flex items-center gap-2">
                            <CollectionVisibilityBadge collection={collection} />
                            <p className="text-[#919191] text-xs truncate">{collection.movieCount} items</p>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <button
                          type="button"
                          className="flex h-8 w-8 items-center justify-center text-[#a7a7a7] hover:text-white transition-colors focus:bg-white/[0.08] focus:ring-2 focus:ring-white focus:outline-none rounded-full"
                          onClick={(event) => {
                            event.stopPropagation();
                            navigate(`/user/${username}/collection/${encodeURIComponent(collection.name)}`);
                          }}
                          aria-label={`Open ${collection.name}`}
                        >
                          <i className="fas fa-arrow-right text-[12px]"></i>
                        </button>
                        <button
                          ref={(node) => {
                            const collectionId = String(collection._id || collection.name);
                            if (node) {
                              collectionMenuTriggerRefs.current.set(collectionId, node);
                            } else {
                              collectionMenuTriggerRefs.current.delete(collectionId);
                            }
                          }}
                          type="button"
                          className="flex h-8 w-8 items-center justify-center text-[#a7a7a7] hover:text-white transition-colors focus:bg-white/[0.08] focus:ring-2 focus:ring-white focus:outline-none rounded-full"
                          onClick={(event) => {
                            event.stopPropagation();
                            const rect = event.currentTarget.getBoundingClientRect();
                            setCollectionMenuPosition(getCollectionMenuPosition(rect));
                            setOpenCollectionMenuId((current) => (current === String(collection._id || collection.name) ? '' : String(collection._id || collection.name)));
                          }}
                          aria-label={`More actions for ${collection.name}`}
                        >
                          <i className="fas fa-ellipsis-h text-[12px]"></i>
                        </button>
                      </div>
                    </div>
                      );
                    })()}
                  </div>
                ))}
                {!loading && !filteredCollections.length ? (
                  <div className="text-center text-gray-500 px-4 py-12">No collections found.</div>
                ) : null}
              </div>
            </div>
          </aside>
        </div>

        <main className={`${isCompactCollectionsView && mobileSidebarVisible ? 'hidden' : 'block'} min-w-0 flex-1 w-full`}>
          <div className="pb-6">
            <div className="max-w-none">
              <CollectionDetailPane
                username={username}
                collection={selectedCollection}
                filters={filters}
                setFilters={setFilters}
                watchedIds={watchedIds}
                onOpenDrawer={() => setDrawerOpen(true)}
                onRemoveFromCollection={handleRemoveFromCollection}
                onBackToCollections={() => setMobileSidebarVisible(true)}
                onPublishChange={() => {
                  const currentName = selectedCollection?.name || '';
                  setVisibilityFilter('all');
                  if (currentName) {
                    window.setTimeout(() => {
                      setSelectedCollectionName(currentName);
                    }, 0);
                  }
                }}
                showPublishControls
              />
            </div>
          </div>
        </main>
      </div>
      <CollectionSearchDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        collection={selectedCollection}
        onAdd={handleAddToCollection}
        pendingItems={pendingItems}
      />
      <CreateCollectionModal
        open={createModalOpen}
        values={createDraft}
        onChange={setCreateDraft}
        onClose={() => {
          setCreateModalOpen(false);
          setCreateDraft(createEmptyCollectionDraft());
        }}
        onSubmit={handleCreateCollection}
        saving={createLoading}
      />
      <EditCollectionModal
        open={editModalOpen}
        values={editDraft}
        onChange={setEditDraft}
        onClose={() => {
          setEditModalOpen(false);
          setEditTargetId('');
          setEditDraft(createEmptyCollectionDraft());
        }}
        onSubmit={handleEditCollection}
        saving={createLoading}
      />
      {openCollectionMenuId ? (
        <div className="fixed inset-0 z-[80]" onClick={() => setOpenCollectionMenuId('')}>
          <div
            className="fixed z-[9999] min-w-[8rem] overflow-x-hidden rounded-md border border-gray-800 bg-[#1B1B1B] p-1 text-gray-200 shadow-md animate-[menuPop_160ms_ease-out]"
            style={{ top: `${collectionMenuPosition.top}px`, left: `${collectionMenuPosition.left}px` }}
            onClick={(event) => event.stopPropagation()}
            role="menu"
            aria-orientation="vertical"
          >
            {(() => {
              const menuCollection = filteredCollections.find((item) => String(item._id || item.name) === openCollectionMenuId) || collections.find((item) => String(item._id || item.name) === openCollectionMenuId);
              if (!menuCollection) return null;
              return (
                <>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm text-white hover:bg-[#252833] focus:bg-[#252833]"
                    onClick={() => {
                      navigate(`/user/${username}/collection/${encodeURIComponent(menuCollection.name)}`);
                      setOpenCollectionMenuId('');
                    }}
                    role="menuitem"
                  >
                    <i className="fas fa-arrow-right text-[12px]"></i>
                    <span>Open</span>
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm text-white hover:bg-[#252833] focus:bg-[#252833]"
                    onClick={() => {
                      openEditModal(menuCollection);
                      setOpenCollectionMenuId('');
                    }}
                    role="menuitem"
                  >
                    <i className="fas fa-pen text-[12px]"></i>
                    <span>Edit</span>
                  </button>
                  {!['Watched', 'Watchlist'].includes(menuCollection.name) ? (
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm text-red-400 hover:bg-[#252833] focus:bg-[#252833]"
                      onClick={() => {
                        setCollectionDeleteTarget(menuCollection);
                        setOpenCollectionMenuId('');
                      }}
                      role="menuitem"
                    >
                      <i className="fas fa-trash text-[12px]"></i>
                      <span>Delete</span>
                    </button>
                  ) : null}
                </>
              );
            })()}
          </div>
        </div>
      ) : null}
      <ConfirmModal
        open={!!removeTarget}
        title="Remove from collection?"
        message={removeTarget ? `"${removeTarget.title}" will be removed from ${selectedCollection?.name || 'this collection'}.` : ''}
        confirmLabel="Remove"
        danger
        onConfirm={confirmRemoveFromCollection}
        onClose={() => setRemoveTarget(null)}
      />
      <ConfirmModal
        open={!!collectionDeleteTarget}
        title="Delete collection?"
        message={collectionDeleteTarget ? `"${collectionDeleteTarget.name}" will be permanently deleted.` : ''}
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          if (collectionDeleteTarget) {
            handleDeleteCollection(collectionDeleteTarget);
            setCollectionDeleteTarget(null);
          }
        }}
        onClose={() => setCollectionDeleteTarget(null)}
      />
    </div>
  );
}

function UserCollectionDetailPage() {
  const { username = '', collectionName = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useAuthSession();
  const decodedCollectionName = decodeURIComponent(collectionName);
  const { collections, loading } = useLiveCollections();
  const [publicCollection, setPublicCollection] = useState(null);
  const [publicLoading, setPublicLoading] = useState(true);
  const [publicError, setPublicError] = useState('');
  const isOwner = auth.isLoggedIn && auth.username === username;
  const watchedCollection = useMemo(() => collections.find((item) => item.name === 'Watched'), [collections]);
  const watchedIds = useMemo(
    () =>
      isOwner
        ? new Set((watchedCollection?.movies || []).map((movie) => Number(movie.movieId || movie.seriesId || movie.id || movie._id || 0)))
        : new Set(),
    [isOwner, watchedCollection]
  );
  const collection = useMemo(
    () =>
      normalizeCollection(
        (isOwner ? collections.find((item) => item.name === decodedCollectionName || item._id === decodedCollectionName) : publicCollection) || null
      ),
    [collections, decodedCollectionName, isOwner, publicCollection]
  );
  const [filters, setFilters] = useSessionState(`collection-page:${location.pathname}:filters`, { contentType: 'all', anime: 'yes', sortBy: 'recent', hideWatched: false });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState(null);
  const [pendingItems, setPendingItems] = useState(new Set());

  useEffect(() => {
    document.title = `${decodedCollectionName} | Soulstash`;
  }, [decodedCollectionName]);

  useEffect(() => {
    // Owner sees their own collection from the live cache Ã¢â‚¬â€ no public fetch needed.
    if (isOwner) {
      setPublicLoading(false);
      return;
    }
    let ignore = false;
    setPublicLoading(true);
    setPublicError('');
    cachedApiFetch(`/api/collection/${encodeURIComponent(username)}/${encodeURIComponent(decodedCollectionName)}`)
      .then((payload) => {
        if (!ignore) {
          const [first] = Array.isArray(payload) ? payload : [];
          setPublicCollection(first || null);
        }
      })
      .catch((error) => {
        if (!ignore) {
          setPublicError(error.message || 'Collection not found.');
          setPublicCollection(null);
        }
      })
      .finally(() => {
        if (!ignore) setPublicLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [decodedCollectionName, isOwner, username]);


  useEffect(() => {
    console.log('[Soulstash][React] UserCollectionDetailPage mounted', {
      route: window.location.pathname,
      username,
      collectionName: decodedCollectionName,
      resolvedCollection: collection?.name || null,
      loading
    });
  }, [username, decodedCollectionName, collection?.name, loading]);

  const movies = useMemo(() => filteredCollectionMovies(collection, filters, watchedIds), [collection, filters, watchedIds]);

  async function handleAddToCollection(item, mediaType) {
    if (!collection?._id) return;

    const payload =
      mediaType === 'Series'
        ? {
            seriesId: Number(item._id || item.id),
            title: item.title || item.name || 'Unknown',
            poster_path: item.poster_path || '',
            release_date: item.release_date || item.first_air_date || '',
            media_type: 'Series'
          }
        : {
            movieId: Number(item._id || item.id),
            title: item.title || item.name || 'Unknown',
            poster_path: item.poster_path || '',
            release_date: item.release_date || '',
            media_type: 'Movie'
          };

    const contentId = Number(payload.movieId || payload.seriesId);
    const optimisticSnapshot = optimisticUpdateCollectionItems(collection._id, (movies) => {
      const exists = movies.some((entry) => contentIdFromItem(entry) === contentId);
      if (exists) return movies;
      return [
        ...movies,
        mediaType === 'Series'
          ? { seriesId: contentId, title: payload.title, poster_path: payload.poster_path, release_date: payload.release_date, media_type: 'Series', addedAt: new Date().toISOString() }
          : { movieId: contentId, title: payload.title, poster_path: payload.poster_path, release_date: payload.release_date, media_type: 'Movie', addedAt: new Date().toISOString() }
      ];
    });

    try {
      setPendingItems(prev => new Set(prev).add(contentId));
      const response = window.CollectionStore?.addToCollection
        ? await window.CollectionStore.addToCollection(collection._id, payload)
        : await apiFetch(`/api/user/collections/${encodeURIComponent(collection._id)}/add`, {
            method: 'POST',
            body: JSON.stringify(payload)
          });
      if (!window.CollectionStore?.addToCollection) {
        if (Array.isArray(response?.collections)) {
          broadcastCollections(normalizeCollections(response.collections), response?.collectionVersion);
        } else {
          await refreshCollectionsView();
        }
      }
      toast(response.message || 'Added to collection');
    } catch (error) {
      if (optimisticSnapshot) {
        broadcastCollections(optimisticSnapshot, lastKnownCollectionVersion);
      }
      if (error.status === 409) {
        toast('Already in this collection', 'info');
        return;
      }
      toast(error.message, 'error');
    } finally {
      setPendingItems(prev => {
        const next = new Set(prev);
        next.delete(contentId);
        return next;
      });
    }
  }


  function handleRemoveFromCollection(itemId, title) {
    setRemoveTarget({ itemId, title });
  }

  async function confirmRemoveFromCollection() {
    if (!removeTarget) return;
    if (!collection?._id) return;
    const pendingRemoval = removeTarget;
    const target = (collection.movies || []).find(
      (item) => Number(item.movieId || item.seriesId || item.id || item._id || 0) === Number(pendingRemoval.itemId)
    );
    if (!target) return;
    setRemoveTarget(null);

    const collectionId = collection._id;
    const itemId = Number(target.movieId || target.seriesId || target.id || target._id || 0);

    // Optimistically move item out of collection cache and into trash
    trashItemFromCollectionCache(collectionId, itemId);

    try {
      if (window.CollectionStore?.removeFromCollection) {
        await window.CollectionStore.removeFromCollection(collectionId, target.movieId, target.seriesId);
      } else {
        const removeResp = await apiFetch(
          `/api/user/collections/${encodeURIComponent(collectionId)}/remove`,
          {
            method: 'POST',
            body: JSON.stringify({
              ...(target.movieId ? { movieId: Number(target.movieId) } : {}),
              ...(target.seriesId ? { seriesId: Number(target.seriesId) } : {})
            })
          }
        );
        if (Array.isArray(removeResp?.collections)) {
          broadcastCollections(normalizeCollections(removeResp.collections), removeResp?.collectionVersion);
        } else {
          await refreshCollectionsView();
        }
      }
      // Backend confirmed Ã¢â‚¬â€ permanently purge from trash
      confirmTrashItem(collectionId, itemId);
      toast(`Removed ${pendingRemoval.title}`);
    } catch (error) {
      // Backend failed Ã¢â‚¬â€ restore item from trash back into the collection
      restoreTrashItem(collectionId, itemId);
      setRemoveTarget(pendingRemoval);
      toast(error.message, 'error');
    }
  }

  // Show spinner while either the owner's live-cache or the public fetch is still in flight.
  const isStillLoading = !collection?.name && (
    (isOwner && loading) ||
    (!isOwner && publicLoading)
  );
  if (isStillLoading) {
    return <div className="app-loading">Loading collection...</div>;
  }

  if (!collection?.name) {
    return <div className="app-error">{publicError || 'Collection not found.'}</div>;
  }


  return (
    <div className="w-full max-w-none px-2 sm:px-5 md:px-4 lg:px-5 xl:px-5 2xl:px-8">
      <div className="pb-6">
        <CollectionDetailPane
          username={username}
          collection={collection}
          filters={filters}
          setFilters={setFilters}
          watchedIds={watchedIds}
          onOpenDrawer={() => setDrawerOpen(true)}
          onRemoveFromCollection={handleRemoveFromCollection}
          isOwner={isOwner}
          useBannerAsBackdrop
        />
      </div>
      {isOwner ? (
        <CollectionSearchDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} collection={collection} onAdd={handleAddToCollection} pendingItems={pendingItems} />
      ) : null}
      <ConfirmModal
        open={!!removeTarget}
        title="Remove from collection?"
        message={removeTarget ? `"${removeTarget.title}" will be removed from ${collection?.name || 'this collection'}.` : ''}
        confirmLabel="Remove"
        danger
        onConfirm={confirmRemoveFromCollection}
        onClose={() => setRemoveTarget(null)}
      />
    </div>
  );
}

function UserProfilePage() {
  const { username = '' } = useParams();
  const navigate = useNavigate();
  const auth = useAuthSession();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [profilePayload, setProfilePayload] = useState(null);
  const [favoritePeople, setFavoritePeople] = useState([]);
  const [favoriteRemoveTarget, setFavoriteRemoveTarget] = useState(null);
  const [followersCount, setFollowersCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);
  const [isFollowedBy, setIsFollowedBy] = useState(false);

  useEffect(() => {
    document.title = username ? `${username} - Soulstash` : 'Profile - Soulstash';
  }, [username]);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setError('');

    cachedApiFetch(`/api/user/profile/${encodeURIComponent(username)}`)
      .then((payload) => {
        if (!cancelled) {
          setProfilePayload(payload);
          if (payload?.user?.favoritePeople && payload?.isOwner) {
            setFavoritePeople(payload.user.favoritePeople);
          }
          setFollowersCount(payload?.user?.followersCount || 0);
          setFollowingCount(payload?.user?.followingCount || 0);
          setIsFollowing(Boolean(payload?.isFollowing));
          setIsFollowedBy(Boolean(payload?.isFollowedBy));
        }
      })
      .catch((fetchError) => {
        if (!cancelled) {
          setError(fetchError.message || 'Failed to load profile');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [username]);

  if (loading) {
    return <UserProfileSkeleton />;
  }

  if (error || !profilePayload?.user) {
    return <div className="app-error">{error || 'Profile not found.'}</div>;
  }

  const user = profilePayload.user;
  const collections = normalizeCollections(Array.isArray(user.collections) ? user.collections : []);
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.fullName || user.username;
  const watched = collections.find((collection) => collection.name === 'Watched');
  const watchlist = collections.find((collection) => collection.name === 'Watchlist');
  const customCollections = collections.filter((collection) => !['Watched', 'Watchlist'].includes(collection.name));
  const showFavorites = profilePayload?.isOwner && favoritePeople.length;
  const isOwner = profilePayload?.isOwner && auth.username === username;

  return (
    <div className="space-y-7">
      <section className="rounded-[30px] bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] p-5 md:p-7">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <div className="flex flex-col items-start gap-2">
              <div className="h-[96px] w-[96px] overflow-hidden rounded-full bg-white/[0.06] ring-1 ring-white/10">
                <img
                  src={user.avatar || FALLBACK_AVATAR}
                  alt={user.username}
                  className="h-full w-full object-cover"
                  onError={(event) => {
                    event.currentTarget.src = FALLBACK_AVATAR;
                  }}
                />
              </div>
              <div className="flex items-center gap-3 text-xs text-[#9f9f9f]">
                <button
                  type="button"
                  className="hover:text-white transition-colors"
                  onClick={() => navigate(`/user/${username}/followers`)}
                >
                  {followersCount} followers
                </button>
                <button
                  type="button"
                  className="hover:text-white transition-colors"
                  onClick={() => navigate(`/user/${username}/following`)}
                >
                  {followingCount} following
                </button>
              </div>
            </div>
            <div className="min-w-0">
              <p className="text-sm text-[#9f9f9f]">@{user.username}</p>
              <h1 className="mt-1 truncate text-xl sm:text-2xl md:text-3xl font-semibold text-white">{fullName}</h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-[#b7b7b7]">{user.bio || 'No bio added yet.'}</p>
            </div>
          </div>

          <div className="flex w-full flex-col items-stretch gap-4 lg:w-auto lg:min-w-[340px] lg:items-end">
            {isOwner ? (
              <div className="flex w-full flex-wrap justify-start gap-3 lg:justify-end">
                <button
                  type="button"
                  className="rounded-full bg-white/[0.08] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/[0.14]"
                  onClick={() => navigate('/edit')}
                >
                  Edit Profile
                </button>
                <button
                  type="button"
                  className="rounded-full bg-white/[0.08] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/[0.14]"
                  onClick={() => {
                    clearAuthSession();
                    toast('Logged out', 'success');
                    navigate('/login');
                  }}
                >
                  Logout
                </button>
              </div>
            ) : (
              <div className="flex w-full flex-wrap justify-start gap-3 lg:justify-end">
                <button
                  type="button"
                  className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-[#e6e6e6]"
                  onClick={async () => {
                    if (!getToken()) {
                      navigate('/login');
                      return;
                    }
                    try {
                      if (isFollowing) {
                        await apiFetch('/api/user/unfollow', {
                          method: 'POST',
                          body: JSON.stringify({ username })
                        });
                        setIsFollowing(false);
                        setFollowersCount((current) => Math.max(0, current - 1));
                      } else {
                        await apiFetch('/api/user/follow', {
                          method: 'POST',
                          body: JSON.stringify({ username })
                        });
                        setIsFollowing(true);
                        setFollowersCount((current) => current + 1);
                      }
                    } catch (err) {
                      toast(err.message, 'error');
                    }
                  }}
                >
                  {isFollowing ? 'Unfollow' : 'Follow'}
                </button>
                {isFollowedBy ? (
                  <span className="self-center text-xs uppercase tracking-[0.18em] text-[#9a9a9a]">Follows you</span>
                ) : null}
              </div>
            )}

            <div className="grid w-full grid-cols-3 gap-2 md:flex md:flex-wrap md:justify-start md:gap-3 lg:justify-end">
              <div className="rounded-2xl bg-white/[0.04] px-3 py-2.5 md:px-4 md:py-3">
                <p className="text-[10px] uppercase tracking-[0.12em] text-[#8f8f8f] md:text-[11px] md:tracking-[0.14em]">Watched</p>
                <p className="mt-1 text-lg font-semibold text-white md:text-xl">{collectionItemCount(watched)}</p>
              </div>
              <div className="rounded-2xl bg-white/[0.04] px-3 py-2.5 md:px-4 md:py-3">
                <p className="text-[10px] uppercase tracking-[0.12em] text-[#8f8f8f] md:text-[11px] md:tracking-[0.14em]">Watchlist</p>
                <p className="mt-1 text-lg font-semibold text-white md:text-xl">{collectionItemCount(watchlist)}</p>
              </div>
              <div className="rounded-2xl bg-white/[0.04] px-3 py-2.5 md:px-4 md:py-3">
                <p className="text-[10px] uppercase tracking-[0.12em] text-[#8f8f8f] md:text-[11px] md:tracking-[0.14em]">Collections</p>
                <p className="mt-1 text-lg font-semibold text-white md:text-xl">{customCollections.length}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-[28px] bg-[rgba(255,255,255,0.025)] p-5 md:p-6">
        <div className="mb-5 flex items-center justify-between gap-4">
          <SectionHeader
            title="Collections"
            subtitle={profilePayload.isOwner ? '' : 'Public collections from this profile.'}
          />
          {profilePayload.isOwner ? (
            <button
              type="button"
              className="rounded-full bg-white/[0.08] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/[0.14]"
              onClick={() => navigate(`/user/${username}/collections`)}
            >
              Open Collections
            </button>
          ) : null}
        </div>

        {collections.length ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {collections.map((collection) => (
              <button
                key={collection._id || collection.name}
                type="button"
                className="overflow-hidden rounded-[22px] bg-white/[0.035] text-left transition-colors hover:bg-white/[0.06]"
                onClick={() => navigate(`/user/${username}/collection/${encodeURIComponent(collection.name)}`)}
              >
                <div className="aspect-[2.15/1] bg-[#121212]">
                  <img
                    src={collection.banner || FALLBACK_AVATAR}
                    alt={collection.name}
                    className="h-full w-full object-cover"
                    onError={(event) => {
                      event.currentTarget.src = FALLBACK_AVATAR;
                    }}
                  />
                </div>
                <div className="p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-base font-semibold text-white">
                        {collection.name}
                        {collection.isPublished && !['Watched', 'Watchlist'].includes(collection.name) ? (
                          <i className="fas fa-star ml-1.5 text-[#e6c56a] text-[11px] align-middle"></i>
                        ) : null}
                      </h3>
                      <div className="mt-2 flex items-center gap-2">
                        <CollectionVisibilityBadge collection={collection} />
                        <span className="text-[11px] uppercase tracking-[0.12em] text-[#8f8f8f]">{collection.movieCount || 0} saved</span>
                      </div>
                    </div>
                  </div>
                  <p className="mt-2 line-clamp-2 text-[13px] leading-5 text-[#b7b7b7]">{collection.description || 'No description yet.'}</p>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="empty-state">No collections available yet.</div>
        )}
      </section>

      {showFavorites ? (
        <section className="rounded-[28px] bg-[rgba(255,255,255,0.02)] p-5 md:p-6">
          <div className="mb-5 flex items-center justify-between gap-4">
            <SectionHeader title="Favorite People" />
          </div>
          <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
            {favoritePeople.map((person) => (
              <div key={person.id} className="group relative w-full rounded-[18px] border border-white/10 bg-white/[0.03] p-2.5">
                <button
                  type="button"
                  className="w-full text-left"
                  onClick={() => navigate(`/person/${person.id}`)}
                >
                  <div className="aspect-[2/3] overflow-hidden rounded-[16px] bg-[#111111]">
                    <img
                      src={imageUrl(person.profile_path, 'w300_and_h450_face') || FALLBACK_AVATAR}
                      alt={person.name}
                      className="h-full w-full object-cover"
                      onError={(event) => {
                        event.currentTarget.src = FALLBACK_AVATAR;
                      }}
                    />
                  </div>
                  <div className="mt-2">
                    <h3 className="truncate text-[14px] font-semibold text-white">{person.name}</h3>
                    <p className="text-[11px] text-[#9a9a9a]">{person.known_for_department || 'Known for'}</p>
                  </div>
                </button>
                <button
                  type="button"
                  className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={() => setFavoriteRemoveTarget(person)}
                >
                  <i className="fas fa-times text-[9px]"></i>
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <ConfirmModal
        open={!!favoriteRemoveTarget}
        title="Remove from favorites?"
        message={favoriteRemoveTarget ? `"${favoriteRemoveTarget.name}" will be removed from your favorites.` : ''}
        confirmLabel="Remove"
        danger
        onConfirm={async () => {
          if (!favoriteRemoveTarget) return;
          try {
            await apiFetch('/api/user/favorites/remove', {
              method: 'POST',
              body: JSON.stringify({ id: favoriteRemoveTarget.id })
            });
            setFavoritePeople((current) => current.filter((person) => person.id !== favoriteRemoveTarget.id));
            toast('Removed from favorites');
          } catch (err) {
            toast(err.message, 'error');
          } finally {
            setFavoriteRemoveTarget(null);
          }
        }}
        onClose={() => setFavoriteRemoveTarget(null)}
      />
    </div>
  );
}

function splitTrendingIntoColumns(items) {
  const columns = [[], [], []];
  items.forEach((item, index) => {
    const columnIndex = index % 3;
    if (columns[columnIndex].length < 12) {
      columns[columnIndex].push(item);
    }
  });
  return columns;
}

const AUTH_POSTER_CACHE_KEY = 'soulstash:auth-posters:v1';

function AuthPosterColumns() {
  const [columns, setColumns] = useState(() => {
    try {
      const cached = sessionStorage.getItem(AUTH_POSTER_CACHE_KEY);
      if (!cached) return [[], [], []];
      const parsed = JSON.parse(cached);
      return Array.isArray(parsed) ? parsed : [[], [], []];
    } catch {
      return [[], [], []];
    }
  });

  useEffect(() => {
    let cancelled = false;

    cachedApiFetch('/api/trending?limit=36', {}, 10 * 60 * 1000)
      .then((items) => {
        if (!cancelled && Array.isArray(items)) {
          const nextColumns = splitTrendingIntoColumns(items);
          setColumns(nextColumns);
          try {
            sessionStorage.setItem(AUTH_POSTER_CACHE_KEY, JSON.stringify(nextColumns));
          } catch {}
        }
      })
      .catch(() => {
        if (!cancelled) {
          setColumns([[], [], []]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const animationClasses = ['auth-poster-column--up', 'auth-poster-column--down', 'auth-poster-column--up'];

  return (
    <div className="hidden lg:flex fixed left-0 top-0 w-1/2 h-screen">
      <div className="w-full h-full flex justify-center items-center relative">
        <div className="w-[90%] h-full flex space-x-8">
          {columns.map((columnItems, columnIndex) => (
            <div key={columnIndex} className="relative h-full overflow-hidden w-1/3">
              <div className={animationClasses[columnIndex]}>
                {columnItems.length
                  ? Array.from({ length: 5 }).map((_, duplicateIndex) => (
                      <div key={duplicateIndex} className="flex flex-col">
                        {columnItems.map((movie, itemIndex) => (
                          <div key={`${duplicateIndex}-${movie.id || itemIndex}`} className="relative w-full aspect-[2/3] my-4 rounded-lg overflow-hidden shadow-lg opacity-90 flex-shrink-0">
                            <img
                              src={imageUrl(movie.poster_path, 'w300_and_h450_face')}
                              alt={movie.title || movie.name || 'Poster'}
                              className="object-cover w-full h-full"
                              loading="lazy"
                              onError={(event) => {
                                event.currentTarget.src = FALLBACK_AVATAR;
                              }}
                            />
                          </div>
                        ))}
                      </div>
                    ))
                  : Array.from({ length: 10 }).map((_, itemIndex) => (
                      <div key={itemIndex} className="relative w-full aspect-[2/3] my-4 rounded-lg overflow-hidden shadow-lg bg-white/[0.05]" />
                    ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PolicyPage({ title, subtitle, sections }) {
  return (
    <div className="min-h-[calc(100vh-88px)] flex items-center justify-center px-4 py-8">
      <div className="max-w-4xl w-full rounded-[28px] border border-white/8 bg-[rgba(20,20,20,0.95)] p-8 md:p-12 shadow-[0_24px_70px_rgba(0,0,0,0.35)]">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white">{title}</h1>
          <p className="mt-3 text-[#919191]">{subtitle}</p>
        </div>
        <div className="space-y-8">
          {sections.map((section) => (
            <section key={section.heading}>
              <h2 className="text-2xl font-semibold text-white mb-3">{section.heading}</h2>
              {section.paragraphs?.map((paragraph) => (
                <p key={paragraph} className="text-[#e2e2e2] leading-7 mb-3">{paragraph}</p>
              ))}
              {section.items?.length ? (
                <ul className="list-disc ml-6 space-y-2 text-[#e2e2e2]">
                  {section.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

function TermsPage() {
  return (
    <PolicyPage
      title="Terms of Service"
      subtitle="Last updated: January 31, 2026"
      sections={[
        { heading: '1. Acceptance of Terms', paragraphs: ['By accessing and using Soulstash, you accept and agree to be bound by this agreement. If you do not agree, please do not use the service.'] },
        { heading: '2. Description of Service', paragraphs: ['Soulstash is a movie discovery and tracking platform that lets users browse, search, and keep track of movies and TV shows with recommendations, watchlists, and collection features.'] },
        { heading: '3. User Registration', paragraphs: ['To access certain features, you must register for an account and provide accurate, current, and complete information.'] },
        {
          heading: '4. User Conduct',
          paragraphs: ['You agree not to use the service to:'],
          items: [
            'Upload or transmit unlawful, harmful, threatening, abusive, harassing, or vulgar content',
            'Impersonate any person or entity',
            'Upload files containing viruses, worms, or similar software',
            'Interfere with or disrupt the service or connected networks'
          ]
        },
        { heading: '5. Privacy', paragraphs: ['Your privacy matters to us. Please review our Privacy Policy to understand how we handle your information.'] },
        { heading: '6. Intellectual Property', paragraphs: ['The service and its original content, features, and functionality remain the exclusive property of Soulstash and its licensors.'] },
        { heading: '7. Termination', paragraphs: ['We may terminate or suspend your account and bar access to the service immediately and without prior notice under our sole discretion.'] },
        { heading: '8. Limitation of Liability', paragraphs: ['Soulstash and its affiliates are not liable for indirect, incidental, special, consequential, or punitive damages, including loss of profits, data, use, or goodwill.'] },
        { heading: '9. Changes to Terms', paragraphs: ['We may modify or replace these terms at any time. If a revision is material, we will try to provide advance notice before it takes effect.'] },
        { heading: '10. Contact Information', paragraphs: ['If you have questions about these Terms of Service, contact us at soulstash.onrender@gmail.com.'] }
      ]}
    />
  );
}

function PrivacyPage() {
  return (
    <PolicyPage
      title="Privacy Policy"
      subtitle="Last updated: January 31, 2026"
      sections={[
        { heading: '1. Introduction', paragraphs: ['Soulstash is committed to protecting your privacy. This policy explains how we collect, use, disclose, and safeguard your information when you use the service.'] },
        { heading: '2. Information We Collect', paragraphs: ['We may collect personal data you provide during registration, usage data such as browser and access information, and tracking or cookie data used to improve the service.'] },
        {
          heading: '3. How We Use Your Information',
          paragraphs: ['Soulstash uses collected data to:'],
          items: [
            'Provide and maintain the service',
            'Notify you about changes',
            'Provide customer support',
            'Analyze and improve the product',
            'Monitor usage and detect issues'
          ]
        },
        {
          heading: '4. Sharing Your Information',
          paragraphs: ['We do not sell your personal information without your consent, except in limited cases such as trusted providers, legal obligations, or mergers/acquisitions.']
        },
        { heading: '5. Data Security', paragraphs: ['We use appropriate technical and organizational measures to protect your personal information against unauthorized access, alteration, disclosure, or destruction.'] },
        { heading: '6. Data Retention', paragraphs: ['We retain your personal information only as long as necessary for the purposes described in this policy, or longer where required for complaints or legal reasons.'] },
        {
          heading: '7. Your Rights',
          paragraphs: ['You may have rights to access, correct, erase, restrict, object to processing, or request portability of your personal information.']
        },
        { heading: "8. Children's Privacy", paragraphs: ['Our service is not directed to children under 13, and we do not knowingly collect personal information from them.'] },
        { heading: '9. Changes to This Privacy Policy', paragraphs: ['We may update this policy from time to time and will update the date shown on this page when we do.'] },
        { heading: '10. Contact Us', paragraphs: ['If you have any questions about this Privacy Policy, contact us at soulstash.onrender@gmail.com.'] }
      ]}
    />
  );
}

function EditProfilePage() {
  const navigate = useNavigate();
  const auth = useAuthSession();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState({
    username: '',
    firstName: '',
    lastName: '',
    dateOfBirth: '',
    bio: '',
    instagramHandle: '',
    xHandle: '',
    youtubeHandle: ''
  });
  const [avatarPreview, setAvatarPreview] = useState(FALLBACK_AVATAR);
  const [avatarFile, setAvatarFile] = useState(null);

  useEffect(() => {
    document.title = 'Edit Profile - Soulstash';
  }, []);

  useEffect(() => {
    if (!auth.isLoggedIn) {
      navigate('/login', { replace: true });
      return;
    }

    let cancelled = false;
    fetch('/api/auth/profile', {
      headers: {
        Authorization: `Bearer ${getToken()}`
      }
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || 'Failed to load profile');
        }
        if (!cancelled) {
          setDraft({
            username: payload.username || '',
            firstName: payload.firstName || '',
            lastName: payload.lastName || '',
            dateOfBirth: payload.dateOfBirth || '',
            bio: payload.bio || '',
            instagramHandle: payload.instagramHandle || '',
            xHandle: payload.xHandle || '',
            youtubeHandle: payload.youtubeHandle || ''
          });
          setAvatarPreview(payload.avatar || FALLBACK_AVATAR);
        }
      })
      .catch((fetchError) => {
        if (!cancelled) setError(fetchError.message || 'Failed to load profile');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [auth.isLoggedIn, navigate]);

  async function handleSave(event) {
    event.preventDefault();
    setSaving(true);
    setError('');

    try {
      const formData = new FormData();
      Object.entries(draft).forEach(([key, value]) => {
        if (key !== 'username') formData.append(key, value || '');
      });
      if (avatarFile) {
        formData.append('avatar', avatarFile);
      }

      const response = await fetch('/api/auth/update-profile', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${getToken()}`
        },
        body: formData
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to update profile');
      }

      const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
      localStorage.setItem('user', JSON.stringify({ ...currentUser, ...payload }));
      emitAuthChange();
      toast('Profile updated');
      navigate(`/user/${payload.username || auth.username}`);
    } catch (saveError) {
      setError(saveError.message || 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <EditProfileSkeleton />;
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <section className="rounded-[28px] bg-[rgba(255,255,255,0.03)] p-5 md:p-7">
        <h1 className="text-2xl font-semibold text-white">Edit Profile</h1>
        <p className="mt-2 text-sm text-[#9f9f9f]">Update your public details and social links without leaving the app.</p>
        <form className="mt-8 space-y-7" onSubmit={handleSave}>
          <div className="flex flex-col sm:flex-row items-center gap-6">
            <label className="group relative h-24 w-24 cursor-pointer overflow-hidden rounded-full bg-white/[0.06] ring-1 ring-white/10">
              <img
                src={avatarPreview}
                alt="Profile avatar"
                className="h-full w-full object-cover"
                onError={(event) => {
                  event.currentTarget.src = FALLBACK_AVATAR;
                }}
              />
              <input
                type="file"
                accept=".jpg,.jpeg,.png,.webp,.avif,.heic,.heif"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  setAvatarFile(file);
                  setAvatarPreview(URL.createObjectURL(file));
                }}
              />
            </label>
            <div>
              <h3 className="text-white font-medium">Profile photo</h3>
              <p className="mt-1 text-sm text-[#8f8f8f]">Upload a new photo for your profile.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            {[
              ['Username', 'username', true],
              ['First name', 'firstName', false],
              ['Last name', 'lastName', false],
              ['Date of birth', 'dateOfBirth', false]
            ].map(([label, key, disabled]) => (
              <div key={key}>
                <label className="mb-2 block text-sm font-medium text-[#d7d7d7]">{label}</label>
                <input
                  value={draft[key]}
                  disabled={disabled}
                  onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))}
                  className={`h-11 w-full rounded-2xl px-4 text-white outline-none ${disabled ? 'bg-[#252525] text-white/60' : 'bg-[#1F1F1F]'} border border-[#252833]`}
                />
              </div>
            ))}
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-[#d7d7d7]">Bio</label>
            <textarea
              rows={4}
              value={draft.bio}
              onChange={(event) => setDraft((current) => ({ ...current, bio: event.target.value }))}
              className="w-full rounded-2xl border border-[#252833] bg-[#1F1F1F] px-4 py-3 text-white outline-none"
              placeholder="Tell us about yourself"
            />
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            {[
              ['Instagram', 'instagramHandle'],
              ['X / Twitter', 'xHandle'],
              ['YouTube', 'youtubeHandle']
            ].map(([label, key]) => (
              <div key={key}>
                <label className="mb-2 block text-sm font-medium text-[#d7d7d7]">{label}</label>
                <input
                  value={draft[key]}
                  onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))}
                  className="h-11 w-full rounded-2xl border border-[#252833] bg-[#1F1F1F] px-4 text-white outline-none"
                />
              </div>
            ))}
          </div>

          {error ? <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div> : null}

          <div className="flex justify-end">
            <button type="submit" disabled={saving} className="rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-[#e5e5e5] disabled:opacity-60">
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const isCollectionRoute = /^\/user\/[^/]+\/(collections|collection\/.+)$/.test(location.pathname);
  const isAuthRoute = location.pathname === '/login' || location.pathname === '/register' || location.pathname === '/forgot-password';

  // Ã¢â€â‚¬Ã¢â€â‚¬ TV / remote D-pad navigation Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  useTvFocus(location);
  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬


  useEffect(() => {
    document.title = 'Soulstash';
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement);
      if (isFullscreen) {
        if (!window.history.state || !window.history.state.fullscreen) {
          window.history.pushState({ fullscreen: true }, '');
        }
      } else {
        if (window.history.state && window.history.state.fullscreen) {
          window.history.back();

        }
      }
    };

    const handlePopState = (event) => {
      const isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement);
      if (isFullscreen) {
        if (document.exitFullscreen) {
          document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
          document.webkitExitFullscreen();
        } else if (document.mozCancelFullScreen) {
          document.mozCancelFullScreen();
        } else if (document.msExitFullscreen) {
          document.msExitFullscreen();
        }
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);
    window.addEventListener('popstate', handlePopState);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  useEffect(() => {
    try {
      const navEntry = performance.getEntriesByType('navigation')[0];
      const isReload = navEntry?.type === 'reload' || performance?.navigation?.type === 1;
      if (isReload) {
        lastKnownCollectionVersion = null;
        if (window.CollectionStore?.invalidate) {
          window.CollectionStore.invalidate();
        }
      }
    } catch {}
  }, []);


  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [location.pathname]);

  useEffect(() => {
    window.soulstashNavigate = (to, options = {}) => {
      navigate(to, options);
    };

    let backButtonListener = null;
    if (Capacitor.isNativePlatform()) {
      CapacitorApp.addListener('backButton', ({ canGoBack }) => {
        // 1. Close player if it's open
        const playerModal = document.querySelector('[data-player-modal]');
        if (playerModal) {
          const closeBtn = playerModal.querySelector('button[aria-label="Close player"]');
          if (closeBtn) {
            closeBtn.click();
            return;
          }
        }
        
        // 2. Go back in history if possible, else exit app
        if (canGoBack || window.history.length > 1) {
          navigate(-1);
        } else {
          CapacitorApp.exitApp();
        }
      }).then(listener => {
        backButtonListener = listener;
      });
    }

    return () => {
      delete window.soulstashNavigate;
      if (backButtonListener) {
        backButtonListener.remove();
      }
    };
  }, [navigate]);

  const routeTree = (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/trending" element={<TrendingPage />} />
      <Route path="/genre/:id/:name" element={<GenrePage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/explore" element={<LegacyRedirectPage />} />
      <Route path="/collections" element={<CollectionsRouteGate />} />
      <Route path="/edit" element={<EditProfilePage />} />
      <Route path="/terms-of-service" element={<TermsPage />} />
      <Route path="/privacy-policy" element={<PrivacyPage />} />
      <Route path="/collection/:collectionName" element={<LegacyCollectionRouteGate />} />
      <Route path="/user/:username/collections" element={<UserCollectionsPage />} />
      <Route path="/user/:username/collection" element={<UserCollectionIndexGate />} />
      <Route path="/user/:username/collection/:collectionName" element={<UserCollectionDetailPage />} />
      <Route path="/user/:username/followers" element={<FollowListPage listType="followers" />} />
      <Route path="/user/:username/following" element={<FollowListPage listType="following" />} />
      <Route path="/user/:username" element={<UserProfilePage />} />
      <Route path="/user/:username/*" element={<LegacyRedirectPage />} />
      <Route path="/movie/:id" element={<DetailPage type="movie" />} />
      <Route path="/series/:id" element={<DetailPage type="series" />} />
      <Route path="/person/:id" element={<PersonPage />} />
      <Route path="/admin" element={<AdminPage />} />
    </Routes>
  );

  if (isCollectionRoute) {
    return (
      <div className="app-shell collection-react-shell">
        <ReactNavbar />
        <main className="app-main">
          <div className="app-container app-container--collections">{routeTree}</div>
          <SmartFooter />
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <ReactNavbar />
      <main className={`app-main ${isAuthRoute ? 'app-main--auth' : ''}`}>
        <div className="app-container">{routeTree}</div>
        {!isAuthRoute ? <SmartFooter /> : null}
      </main>
    </div>
  );
}

function CollectionsRouteGate() {
  const navigate = useNavigate();

  useEffect(() => {
    const username = getCurrentUsername();
    if (!getToken() || !username) {
      navigate('/login', { replace: true });
      return;
    }
    navigate(`/user/${username}/collections`, { replace: true });
  }, [navigate]);

  return <div className="app-loading">Opening your collections...</div>;
}

function UserCollectionIndexGate() {
  const { username = '' } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    if (!username) {
      navigate('/collections', { replace: true });
      return;
    }
    navigate(`/user/${username}/collections`, { replace: true });
  }, [navigate, username]);

  return <div className="app-loading">Opening collection...</div>;
}

function LegacyCollectionRouteGate() {
  const { collectionName = '' } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    const username = getCurrentUsername();
    if (!getToken() || !username) {
      navigate('/login', { replace: true });
      return;
    }
    navigate(`/user/${username}/collection/${encodeURIComponent(decodeURIComponent(collectionName))}`, { replace: true });
  }, [collectionName, navigate]);

  return <div className="app-loading">Opening collection...</div>;
}

function LegacyRedirectPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { username } = useParams();

  useEffect(() => {
    if (location.pathname === '/explore') {
      navigate('/trending', { replace: true });
      return;
    }

    if (username) {
      navigate(`/user/${encodeURIComponent(username)}`, { replace: true });
      return;
    }

    navigate('/', { replace: true });
  }, [location.pathname, navigate, username]);

  return <div className="app-loading">Opening page...</div>;
}

function SectionHeader({ title, subtitle, large = false }) {
  const isLargeTitle = title === 'Trending Now' || large;
  const titleClassName = isLargeTitle
    ? 'section-title !mb-0 inline-block !ml-2 sm:!ml-3 !pl-1 !text-2xl sm:!text-3xl !font-black tracking-tight overflow-visible'
    : 'section-title !mb-0';
  return (
    <div className="flex items-end justify-between mb-4 gap-4">
      <div>
        <h2 className={titleClassName}>
          {title}
        </h2>
        {subtitle ? <p className="text-sm text-[#9f9f9f] mt-1">{subtitle}</p> : null}
      </div>
    </div>
  );
}

function HomeShelfHeader({ title, publisher = '', onViewAll, onPublisherClick = null }) {
  const isTrendingTitle = title === 'Trending Now';
  const titleClassName = isTrendingTitle
    ? 'section-title !mb-0 inline-block !ml-2 sm:!ml-3 !pl-1 !text-[1.45rem] sm:!text-[1.8rem] !font-extrabold tracking-tight overflow-visible'
    : 'section-title !mb-0 inline-block !ml-2 sm:!ml-3 !pl-1 !text-[1.45rem] sm:!text-[1.75rem] !font-bold tracking-tight overflow-visible';
  return (
    <div className="mb-4 flex items-end justify-between gap-4 pr-2 sm:pr-3 lg:pr-6 xl:pr-8">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <h2 className={titleClassName}>
            {title}
          </h2>
          {publisher ? (
            onPublisherClick ? (
              <button
                type="button"
                className="min-w-0 truncate text-base sm:text-[1.05rem] font-semibold text-[#d7d7d7] underline decoration-white/25 underline-offset-4 transition-colors hover:text-white focus:outline-none focus:ring-2 focus:ring-white rounded"
                onClick={onPublisherClick}
              >
                ({publisher})
              </button>
            ) : (
              <span className="min-w-0 truncate text-base sm:text-[1.05rem] font-semibold text-[#d7d7d7]">
                ({publisher})
              </span>
            )
          ) : null}
        </div>
      </div>
      <button
        type="button"
        className="flex-shrink-0 rounded-full border border-white/10 bg-white/[0.06] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/[0.12] focus:outline-none focus:ring-2 focus:ring-white"
        onClick={onViewAll}
      >
        View all
      </button>
    </div>
  );
}

const ContentCard = React.forwardRef(function ContentCard({ item, status = null, ...props }, ref) {
  const navigate = useNavigate();
  const title = item.title || item.name || 'Unknown';
  const contentType = item.media_type || (item.title ? 'Movie' : 'Series');

  return (
    <button
      ref={ref}
      type="button"
      {...props}
      className="border text-card-foreground group p-2 flex flex-col items-start gap-2 sm:gap-[6px] w-full h-full cursor-pointer relative rounded-lg overflow-visible hover:bg-[#171717] hover:backdrop-blur-sm transition-all duration-300 border-none bg-transparent shadow-none text-left focus:bg-white/[0.08] focus:ring-2 focus:ring-white focus:outline-none"
      onClick={() => navigate(mediaRoute(item))}
    >
      <div className="p-0 w-full h-full flex flex-col items-start gap-2 sm:gap-[6px]">
        <div className="relative w-full aspect-[2/3] overflow-hidden rounded-md max-w-full mx-auto">
          <img
            src={imageUrl(item.poster_path, 'w300_and_h450_face')}
            alt={title}
            className="w-full h-full object-cover rounded-md"
            onError={(event) => {
              event.currentTarget.src = FALLBACK_AVATAR;
            }}
          />
          {status?.watched ? (
            <span className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#10B981] text-white shadow-[0_8px_18px_rgba(0,0,0,0.28)]">
              <i className="fas fa-eye text-[15px] text-black"></i>
            </span>
          ) : null}
          {!status?.watched && status?.watchlist ? (
            <span className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#F59E0B] text-white shadow-[0_8px_18px_rgba(0,0,0,0.28)]">
              <i className="fas fa-clock text-[15px] text-black"></i>
            </span>
          ) : null}
        </div>
        <div className="flex flex-col items-start w-full px-[2px]">
          <div className="w-full overflow-hidden h-[16px] sm:h-[20px] flex items-center relative">
            <h3 className="w-full text-sm opacity-80 font-medium leading-4 sm:leading-5 tracking-[0.5px] text-[#E2E2E2] text-left truncate">
              {title}
            </h3>
          </div>
          <p className="w-full text-[10px] opacity-100 font-normal leading-[18px] tracking-[0.4px] text-left text-[#C6C6C6]">
            {contentType} | {yearFrom(item)} | Rating {getPreferredRating(item)?.toFixed(1) || 'N/A'}
          </p>
        </div>
      </div>
    </button>
  );
});

function getHomeGridColumns(width = window.innerWidth) {
  if (width >= 1280) return 7;
  if (width >= 1024) return 6;
  if (width >= 768) return 5;
  if (width >= 640) return 4;
  return 3;
}

function useGridKeyNav(containerRef, itemSelector = 'button[data-card]') {
  useEffect(() => {
    // D-pad grid navigation is owned by tvNav.js. Keep this hook as a no-op
    // for older call sites while avoiding a second window key handler.
    return undefined;

    // IMPORTANT: Listen on window, not the container.
    // The container ref may be null at mount time (skeleton shown first).
    // We look up containerRef.current on EVERY key press instead.
    const handleKeyDown = (event) => {
      if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)) return;

      const container = containerRef.current;
      if (!container) {
        console.log('[NAV-DEBUG] useGridKeyNav: key pressed but container still null Ã¢â‚¬â€ skipping');
        return;
      }

      const cards = Array.from(container.querySelectorAll(itemSelector));
      const current = document.activeElement;
      const currentIndex = cards.indexOf(current);
      console.log(`[NAV-DEBUG] useGridKeyNav key=${event.key} | cards found=${cards.length} | currentIndex=${currentIndex} | activeEl=`, current);

      if (currentIndex === -1) {
        console.log('[NAV-DEBUG] useGridKeyNav: focused element not in card list Ã¢â‚¬â€ no-op');
        return;
      }

      // Calculate columns from grid layout
      let cols = 1;
      if (cards.length > 1) {
        const firstRect = cards[0].getBoundingClientRect();
        cols = cards.filter(c => Math.abs(c.getBoundingClientRect().top - firstRect.top) < 5).length;
        if (cols === 0) cols = 1;
      }
      console.log(`[NAV-DEBUG] useGridKeyNav: detected ${cols} columns`);

      let nextIndex = -1;
      if (event.key === 'ArrowRight') nextIndex = currentIndex + 1;
      if (event.key === 'ArrowLeft') nextIndex = currentIndex - 1;
      if (event.key === 'ArrowDown') nextIndex = currentIndex + cols;
      if (event.key === 'ArrowUp') nextIndex = currentIndex - cols;

      if (nextIndex >= 0 && nextIndex < cards.length) {
        event.preventDefault();
        console.log(`[NAV-DEBUG] useGridKeyNav: moving to card index ${nextIndex}`, cards[nextIndex]);
        cards[nextIndex].focus();
        cards[nextIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } else {
        console.log(`[NAV-DEBUG] useGridKeyNav: nextIndex=${nextIndex} out of range [0..${cards.length-1}] Ã¢â‚¬â€ at edge`);
      }
    };

    console.log('[NAV-DEBUG] useGridKeyNav: window keydown listener registered (will resolve container on each key press)');
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  // Empty deps Ã¢â‚¬â€ register once, resolve ref dynamically on every key press
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function useDropdownKeyNav(dropdownRef, onClose) {
  useEffect(() => {
    const dropdown = dropdownRef.current;
    if (!dropdown) return;

    // Auto-focus first item when dropdown opens
    const firstBtn = dropdown.querySelector('button');
    if (firstBtn) firstBtn.focus();

    const handleKeyDown = (event) => {
      const buttons = Array.from(dropdown.querySelectorAll('button'));
      const currentIndex = buttons.indexOf(document.activeElement);

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        buttons[currentIndex + 1]?.focus();
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (currentIndex === 0) onClose();
        else buttons[currentIndex - 1]?.focus();
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    dropdown.addEventListener('keydown', handleKeyDown);
    return () => dropdown.removeEventListener('keydown', handleKeyDown);
  }, [dropdownRef, onClose]);
}

function useHomeTwoRowLimit() {
  const [limit, setLimit] = useState(() => getHomeGridColumns() * 2);

  useEffect(() => {
    function handleResize() {
      setLimit(getHomeGridColumns() * 2);
    }

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return limit;
}

function HomePage() {
  const navigate = useNavigate();
  const [trending, setTrending] = useState([]);
  const [collections, setCollections] = useState([]);
  const [publishedCollections, setPublishedCollections] = useState([]);
  const [genres, setGenres] = useState([]);
  const [categoryData, setCategoryData] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryTick, setRetryTick] = useState(0);
  const homeShelfLimit = useHomeTwoRowLimit();
  // Track which collection IDs have already been submitted for enrichment
  // so we never re-run just because setCollections() updated state.
  const enrichedCollectionIdsRef = useRef(new Set());

  const pageRef = useRef(null);
  const firstCardRef = useRef(null);
  useGridKeyNav(pageRef, 'button[data-card]');



  // When page loads, set up arrow key listener to focus first card
  useEffect(() => {
    // Global TV navigation handles initial focus and card movement.
    return undefined;

    console.log('[NAV-DEBUG] HomePage: first-card window keydown listener registered | firstCardRef=', firstCardRef.current);
    const handleKeyDown = (event) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowRight') return;
      const ae = document.activeElement;
      const onCard = ae?.closest('[data-card]');
      const onSection = ae?.closest('.content-section');
      console.log(`[NAV-DEBUG] HomePage window key=${event.key} | activeEl=`, ae, `| onCard=${!!onCard} | onSection=${!!onSection} | firstCardRef=`, firstCardRef.current);
      // If nothing is focused or body is focused, jump to first card
      if (
        ae === document.body ||
        ae?.tagName === 'NAV' ||
        (!onCard && !onSection)
      ) {
        event.preventDefault();
        console.log('[NAV-DEBUG] HomePage: jumping focus to firstCardRef');
        firstCardRef.current?.focus();
      } else {
        console.log('[NAV-DEBUG] HomePage: focus already on content Ã¢â‚¬â€ letting useGridKeyNav handle it');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    let ignore = false;
    let retryTimeout = null;

    async function load() {
      try {
        setError('');
        const [homeData, userCollections, publishedData] = await Promise.all([
          cachedApiFetch('/api/home').catch(() => ({ trending: [], genres: [], categories: {} })),
          getToken() ? loadUserCollections().catch(() => []) : Promise.resolve([]),
          cachedApiFetch('/api/collections/published').catch(() => ({ collections: [] }))
        ]);

        if (!ignore) {
          const homeTrending = Array.isArray(homeData?.trending) ? homeData.trending : [];
          setTrending(homeTrending);
          // Warm the loadTrendingHome cache so TrendingPage reuses it
          if (homeTrending.length) { homeTrendingCache.data = homeTrending; homeTrendingCache.expiresAt = Date.now() + HOME_TRENDING_TTL; }
          setCollections(userCollections);
          setPublishedCollections(Array.isArray(publishedData?.collections) ? publishedData.collections : []);
          setGenres(Array.isArray(homeData?.genres) ? homeData.genres : []);
          setCategoryData(homeData?.categories && typeof homeData.categories === 'object' ? homeData.categories : {});
        }
      } catch (requestError) {
        if (!ignore) {
          setError(requestError.message);
          retryTimeout = window.setTimeout(() => {
            if (!ignore) {
              setRetryTick((current) => current + 1);
            }
          }, 4000);
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      ignore = true;
      if (retryTimeout) {
        window.clearTimeout(retryTimeout);
      }
    };
  }, [retryTick]);

  // Enrich ratings for any collection not yet attempted this session.
  // We deliberately do NOT include `collections` in the dep array Ã¢â‚¬â€ we only
  // want to kick off enrichment once per load, not every time setCollections
  // updates state (which would create an infinite loop).
  useEffect(() => {
    if (!collections.length) return undefined;

    // Find collections that haven't been enriched yet this session
    const pending = collections.filter((c) => {
      const key = String(c._id || c.name);
      return !enrichedCollectionIdsRef.current.has(key);
    });
    if (!pending.length) {
      console.log('[Soulstash][React][HomePage] enrichment effect Ã¢â‚¬â€ all collections already attempted, skipping');
      return undefined;
    }

    console.log(`[Soulstash][React][HomePage] enrichment effect Ã¢â‚¬â€ queuing ${pending.length} collection(s):`, pending.map(c => c.name));

    // Mark them as attempted immediately so re-renders don't re-queue them
    pending.forEach((c) => enrichedCollectionIdsRef.current.add(String(c._id || c.name)));

    let cancelled = false;

    (async () => {
      for (const collection of pending) {
        if (cancelled) return;
        try {
          const response = await enrichCollectionRatingsInBackground(collection, '[Soulstash][React][HomePage]');
          if (!cancelled && Array.isArray(response?.collections)) {
            setCollections(normalizeCollections(response.collections));
            broadcastCollections(response.collections, response?.collectionVersion);
          }
        } catch (enrichError) {
          if (!cancelled) {
            console.warn('[Soulstash][React][HomePage] Failed to enrich collection metadata', {
              collectionId: collection?._id,
              collectionName: collection?.name,
              message: enrichError.message
            });
          }
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collections.length]);

  if (loading && !error) {
    return <HomePageSkeleton />;
  }


  return (
    <div ref={pageRef} className="space-y-12">
      <section className="content-section">
        <HomeShelfHeader title="Trending Now" onViewAll={() => navigate('/trending')} />
        {error ? (
          <div className="app-error">
            <p>{error}</p>
            <button
              type="button"
              className="mt-4 px-5 py-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors focus:outline-none focus:ring-2 focus:ring-white"
              onClick={() => {
                setLoading(true);
                setRetryTick((current) => current + 1);
              }}
            >
              Try again
            </button>
          </div>
        ) : null}
        {!loading && !error ? (
          <div className={HOME_GRID_CLASS}>
            {trending.slice(0, homeShelfLimit).map((item, index) => (
              <ContentCard key={item.id} item={item} ref={index === 0 ? firstCardRef : null} data-card />
            ))}
          </div>
        ) : null}
      </section>

      {genres.map((genre) => (
        <LazyCategoryShelf key={genre.id || genre} genre={genre} limit={homeShelfLimit} preloadedMovies={categoryData[String(genre.id)]} />
      ))}

      {publishedCollections.length ? (
        <section className="content-section space-y-8">
          {publishedCollections.map((collection) => {
            const items = Array.isArray(collection.movies) ? collection.movies.map(normalizeStoredCollectionItem) : [];
            return (
              <div key={`${collection.username}-${collection.name}`} className="space-y-4">
                <HomeShelfHeader
                  title={collection.name}
                  publisher={collection.username}
                  onPublisherClick={() => navigate(`/user/${collection.username}`)}
                  onViewAll={() => navigate(`/user/${collection.username}/collection/${encodeURIComponent(collection.name)}`)}
                />
                {items.length ? (
                  <div className={HOME_GRID_CLASS}>
                    {items.slice(0, homeShelfLimit).map((item, index) => (
                      <ContentCard key={`${collection.username}-${collection.name}-${item.id || index}-${item.media_type}`} item={item} data-card />
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-[#9a9a9a]">No titles available.</div>
                )}
              </div>
            );
          })}
        </section>
      ) : null}
    </div>
  );
}

function TrendingPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [fetchingMore, setFetchingMore] = useState(false);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setError('');
    setPage(1);
    setHasMore(true);

    cachedApiFetch(`/api/trending?limit=36&page=1&retry=${retryTick}`)
      .then((data) => {
        if (!ignore) {
          const fetchedItems = Array.isArray(data?.movies) ? data.movies : (Array.isArray(data) ? data : []);
          setItems(fetchedItems);
          setHasMore(fetchedItems.length > 0 && data?.pagination?.page < data?.pagination?.pages);
          document.title = 'Trending Now | Soulstash';
        }
      })
      .catch((requestError) => {
        if (!ignore) setError(requestError.message || 'Unable to load trending titles.');
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [retryTick]);

  const observerRef = useRef(null);
  const lastElementRef = useCallback((node) => {
    if (loading || fetchingMore || !hasMore) return;
    if (observerRef.current) observerRef.current.disconnect();
    if (node) {
      observerRef.current = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) {
          setPage((p) => p + 1);
        }
      }, { rootMargin: '400px' });
      observerRef.current.observe(node);
    }
  }, [loading, fetchingMore, hasMore]);

  useEffect(() => {
    if (page === 1) return;
    let ignore = false;
    setFetchingMore(true);
    cachedApiFetch(`/api/trending?limit=36&page=${page}`)
      .then((data) => {
        if (!ignore) {
          const fetchedItems = Array.isArray(data?.movies) ? data.movies : (Array.isArray(data) ? data : []);
          setItems((prev) => [...prev, ...fetchedItems]);
          setHasMore(fetchedItems.length > 0 && data?.pagination?.page < data?.pagination?.pages);
        }
      })
      .finally(() => {
        if (!ignore) setFetchingMore(false);
      });
    return () => { ignore = true; };
  }, [page]);

  if (loading && !error) {
    return (
      <section className="content-section">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div className="h-8 w-40 rounded bg-white/[0.08] animate-pulse"></div>
        </div>
        <SearchResultSkeletonGrid columns="grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7" count={14} />
      </section>
    );
  }

  return (
    <section className="content-section">
      <SectionHeader title="Trending Now" />
      {error ? (
        <div className="app-error">
          <p>{error}</p>
          <button
            type="button"
            className="mt-4 rounded-full bg-white/10 px-5 py-2 text-white transition-colors hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white"
            onClick={() => setRetryTick((current) => current + 1)}
          >
            Try again
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-2 sm:gap-3 lg:gap-4">
          {items.map((item, index) => {
            const isLast = index === items.length - 1;
            const contentCard = <ContentCard key={`${item.media_type || 'media'}-${item.id}`} item={item} />;
            return isLast ? (
              <div ref={lastElementRef} key={`${item.media_type || 'media'}-${item.id}-wrapper`}>
                {contentCard}
              </div>
            ) : contentCard;
          })}
        </div>
      )}
    </section>
  );
}

function CastCard({ person }) {
  const navigate = useNavigate();

  return (
    <button
      type="button"
      className="w-[130px] shrink-0 text-left rounded-2xl overflow-hidden border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] transition-colors"
      onClick={() => navigate(`/person/${person.id}`)}
    >
      <div className="aspect-[2/3] overflow-hidden">
        <img
          src={imageUrl(person.profile_path, 'w300_and_h450_face')}
          alt={person.name}
          className="w-full h-full object-cover"
          onError={(event) => {
            event.currentTarget.src = FALLBACK_AVATAR;
          }}
        />
      </div>
      <div className="p-3">
        <h3 className="text-sm font-semibold text-white truncate">{person.name}</h3>
        <p className="text-xs text-[#a6a6a6] truncate mt-1">{person.character || person.job || 'Cast'}</p>
      </div>
    </button>
  );
}

function LoadingCardRow({ count = 6 }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="overflow-hidden rounded-2xl border border-white/8 bg-white/[0.03] animate-pulse">
          <div className="aspect-[2/3] bg-white/[0.06]"></div>
          <div className="p-3 space-y-2">
            <div className="h-4 rounded bg-white/[0.08]"></div>
            <div className="h-3 w-2/3 rounded bg-white/[0.06]"></div>
          </div>
        </div>
      ))}
    </div>
  );
}

function GenrePage() {
  const { id, name } = useParams();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [fetchingMore, setFetchingMore] = useState(false);
  const [retryTick, setRetryTick] = useState(0);

  const genreId = id;
  const genreName = decodeURIComponent(name || '');

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setError('');
    setPage(1);
    setHasMore(true);

    cachedApiFetch(`/api/movies?genre=${genreId}&limit=36&page=1&retry=${retryTick}`)
      .then((data) => {
        if (!ignore) {
          const fetchedItems = Array.isArray(data?.movies) ? data.movies : [];
          setItems(fetchedItems);
          setHasMore(fetchedItems.length > 0 && data?.pagination?.page < data?.pagination?.pages);
          document.title = `${genreName} | Soulstash`;
        }
      })
      .catch((requestError) => {
        if (!ignore) setError(requestError.message || `Unable to load ${genreName} titles.`);
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [genreId, genreName, retryTick]);

  const observerRef = useRef(null);
  const lastElementRef = useCallback((node) => {
    if (loading || fetchingMore || !hasMore) return;
    if (observerRef.current) observerRef.current.disconnect();
    if (node) {
      observerRef.current = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) {
          setPage((p) => p + 1);
        }
      }, { rootMargin: '400px' });
      observerRef.current.observe(node);
    }
  }, [loading, fetchingMore, hasMore]);

  useEffect(() => {
    if (page === 1) return;
    let ignore = false;
    setFetchingMore(true);
    cachedApiFetch(`/api/movies?genre=${genreId}&limit=36&page=${page}`)
      .then((data) => {
        if (!ignore) {
          const fetchedItems = Array.isArray(data?.movies) ? data.movies : [];
          setItems((prev) => [...prev, ...fetchedItems]);
          setHasMore(fetchedItems.length > 0 && data?.pagination?.page < data?.pagination?.pages);
        }
      })
      .finally(() => {
        if (!ignore) setFetchingMore(false);
      });
    return () => { ignore = true; };
  }, [page, genreId]);

  if (loading && !error) {
    return (
      <section className="content-section">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div className="h-8 w-40 rounded bg-white/[0.08] animate-pulse"></div>
        </div>
        <SearchResultSkeletonGrid columns="grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7" count={14} />
      </section>
    );
  }

  return (
    <section className="content-section">
      <SectionHeader title={genreName} large />
      {error ? (
        <div className="app-error">
          <p>{error}</p>
          <button
            type="button"
            className="mt-4 rounded-full bg-white/10 px-5 py-2 text-white transition-colors hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white"
            onClick={() => setRetryTick((current) => current + 1)}
          >
            Try again
          </button>
        </div>
      ) : items.length ? (
        <>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-2 sm:gap-3 lg:gap-4">
            {items.map((item, index) => {
              const isLast = index === items.length - 1;
              return <ContentCard ref={isLast ? lastElementRef : null} key={`${item.id}-${index}`} item={item} />;
            })}
          </div>
          {fetchingMore && (
            <div className="mt-8 flex justify-center">
              <div className="w-6 h-6 border-2 border-white/20 border-t-white/80 rounded-full animate-spin"></div>
            </div>
          )}
        </>
      ) : (
        <div className="app-empty">
          <p>No titles found for this genre.</p>
        </div>
      )}
    </section>
  );
}

function SearchResultSkeletonGrid({ columns = 'grid-cols-1 min-[600px]:grid-cols-2 min-[900px]:grid-cols-3 min-[1280px]:grid-cols-4 min-[1600px]:grid-cols-5', count = 6 }) {
  return (
    <div className={`grid ${columns} gap-3 animate-pulse`}>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="flex items-center rounded-lg border border-gray-800 bg-[#171717] p-3">
          <div className="h-20 w-14 flex-shrink-0 rounded-md bg-white/[0.06]"></div>
          <div className="ml-3 min-w-0 flex-1 space-y-2">
            <div className="h-4 w-4/5 rounded bg-white/[0.08]"></div>
            <div className="h-3 w-2/5 rounded bg-white/[0.06]"></div>
          </div>
          <div className="ml-2 h-9 w-9 flex-shrink-0 rounded-full bg-white/[0.08]"></div>
        </div>
      ))}
    </div>
  );
}

function CastRowSkeleton({ count = 6 }) {
  return (
    <div className="flex gap-4 overflow-hidden animate-pulse">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="w-[130px] shrink-0 rounded-2xl overflow-hidden border border-white/8 bg-white/[0.03]">
          <div className="aspect-[2/3] bg-white/[0.06]"></div>
          <div className="p-3 space-y-2">
            <div className="h-4 rounded bg-white/[0.08]"></div>
            <div className="h-3 w-2/3 rounded bg-white/[0.06]"></div>
          </div>
        </div>
      ))}
    </div>
  );
}

function FollowListPage({ listType }) {
  const { username = '' } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [users, setUsers] = useState([]);

  useEffect(() => {
    document.title = `${listType === 'followers' ? 'Followers' : 'Following'} | Soulstash`;
  }, [listType]);

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setError('');
    cachedApiFetch(`/api/user/${encodeURIComponent(username)}/${listType}`)
      .then((payload) => {
        if (!ignore) {
          setUsers(Array.isArray(payload?.users) ? payload.users : []);
        }
      })
      .catch((err) => {
        if (!ignore) setError(err.message || 'Unable to load users.');
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [listType, username]);

  async function toggleFollow(targetUsername, isFollowing) {
    if (!getToken()) {
      navigate('/login');
      return;
    }
    try {
      if (isFollowing) {
        await apiFetch('/api/user/unfollow', {
          method: 'POST',
          body: JSON.stringify({ username: targetUsername })
        });
      } else {
        await apiFetch('/api/user/follow', {
          method: 'POST',
          body: JSON.stringify({ username: targetUsername })
        });
      }
      setUsers((current) =>
        current.map((user) =>
          user.username === targetUsername ? { ...user, isFollowing: !isFollowing } : user
        )
      );
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  if (loading) {
    return <div className="app-loading">Loading {listType}...</div>;
  }

  if (error) {
    return <div className="app-error">{error}</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-white">{listType === 'followers' ? 'Followers' : 'Following'}</h1>
        <button
          type="button"
          className="rounded-full bg-white/[0.08] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/[0.14]"
          onClick={() => navigate(`/user/${username}`)}
        >
          Back to profile
        </button>
      </div>
      {users.length ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {users.map((user) => (
            <div key={user.username} className="rounded-[22px] border border-white/10 bg-white/[0.03] p-4 flex gap-4">
              <button type="button" className="h-14 w-14 overflow-hidden rounded-full" onClick={() => navigate(`/user/${user.username}`)}>
                <img
                  src={user.avatar || FALLBACK_AVATAR}
                  alt={user.username}
                  className="h-full w-full object-cover"
                  onError={(event) => {
                    event.currentTarget.src = FALLBACK_AVATAR;
                  }}
                />
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-white font-semibold truncate">{user.fullName || user.username}</h3>
                    <p className="text-xs text-[#9a9a9a]">@{user.username}</p>
                  </div>
                  {user.username !== username ? (
                    <button
                      type="button"
                      className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-black"
                      onClick={() => toggleFollow(user.username, user.isFollowing)}
                    >
                      {user.isFollowing ? 'Unfollow' : 'Follow'}
                    </button>
                  ) : null}
                </div>
                <p className="mt-2 text-sm text-[#b0b0b0] line-clamp-2">{user.bio || 'No bio yet.'}</p>
                {user.isFollowedBy ? (
                  <span className="mt-2 inline-flex rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-[#9a9a9a]">
                    Follows you
                  </span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state">No users here yet.</div>
      )}
    </div>
  );
}

function NavbarSkeleton() {
  return (
    <header className="modern-navbar-react">
      <div className="navbar-container animate-pulse">
        <div className="navbar-logo">
          <div className="h-10 w-10 rounded-full bg-white/[0.08]"></div>
        </div>
        <div className="nav-links">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-9 w-24 rounded-full bg-white/[0.06]"></div>
          ))}
        </div>
        <div className="navbar-actions">
          <div className="h-10 w-10 rounded-full bg-white/[0.08]"></div>
          <div className="h-10 w-24 rounded-full bg-white/[0.06]"></div>
        </div>
      </div>
    </header>
  );
}

function DetailPageSkeleton({ type }) {
  return (
    <div className="space-y-10">
      <section className="relative min-h-[560px] overflow-hidden rounded-[28px] border border-white/10 bg-[#0d0d0d] animate-pulse">
        <div className="absolute inset-0 bg-white/[0.04]"></div>
        <div className="relative z-10 flex min-h-[560px] items-end p-5 md:p-8 lg:p-10">
          <div className="flex w-full flex-col gap-6 lg:flex-row lg:items-end lg:gap-8">
            <div className="w-[170px] sm:w-[220px] aspect-[2/3] rounded-2xl bg-white/[0.08]"></div>
            <div className="flex-1 flex flex-col justify-end gap-5">
              <div className="space-y-4">
                <div className="h-4 w-48 rounded bg-white/[0.08]"></div>
                <div className="h-12 w-[min(520px,80%)] rounded bg-white/[0.1]"></div>
                <div className="space-y-2">
                  <div className="h-4 w-full rounded bg-white/[0.06]"></div>
                  <div className="h-4 w-[92%] rounded bg-white/[0.06]"></div>
                  <div className="h-4 w-[76%] rounded bg-white/[0.06]"></div>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="rounded-2xl border border-white/8 bg-white/[0.03] p-4 space-y-3">
                    <div className="h-3 w-20 rounded bg-white/[0.06]"></div>
                    <div className="h-4 w-24 rounded bg-white/[0.08]"></div>
                  </div>
                ))}
              </div>
              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div key={index} className="h-12 w-full sm:w-48 rounded-full bg-white/[0.08]"></div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {type === 'series' ? (
        <section className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(15,15,15,0.96),rgba(9,9,9,0.98))] p-4 md:p-6 animate-pulse">
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-4">
              <div className="h-4 w-56 rounded bg-white/[0.06]"></div>
              <div className="hidden items-center gap-2 md:flex">
                <div className="h-10 w-10 rounded-full bg-white/[0.08]"></div>
                <div className="h-10 w-10 rounded-full bg-white/[0.08]"></div>
              </div>
            </div>
            <div className="flex min-w-0 items-center gap-3">
              <div className="h-8 w-28 shrink-0 rounded bg-white/[0.08]"></div>
              <div className="flex min-w-0 flex-1 gap-2 overflow-hidden">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div key={index} className="h-10 w-16 shrink-0 rounded-2xl bg-white/[0.08]"></div>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between gap-4">
              <div className="h-4 w-24 rounded bg-white/[0.06]"></div>
              <div className="hidden items-center gap-2 md:flex">
                <div className="h-10 w-10 rounded-full bg-white/[0.08]"></div>
                <div className="h-10 w-10 rounded-full bg-white/[0.08]"></div>
              </div>
            </div>
            <div className="overflow-hidden">
              <EpisodeRowSkeleton count={4} />
            </div>
          </div>
        </section>
      ) : null}

      <section className="content-section">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div className="h-8 w-24 rounded bg-white/[0.08] animate-pulse"></div>
          <div className="flex items-center gap-2">
            <div className="h-10 w-10 rounded-full bg-white/[0.08] animate-pulse"></div>
            <div className="h-10 w-10 rounded-full bg-white/[0.08] animate-pulse"></div>
          </div>
        </div>
        <div className="flex gap-4 overflow-hidden">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="w-[130px] shrink-0 rounded-2xl overflow-hidden border border-white/8 bg-white/[0.03] animate-pulse">
              <div className="aspect-[2/3] bg-white/[0.06]"></div>
              <div className="p-3 space-y-2">
                <div className="h-4 rounded bg-white/[0.08]"></div>
                <div className="h-3 w-2/3 rounded bg-white/[0.06]"></div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function LazyCategoryShelf({ genre, limit, preloadedMovies }) {
  const [movies, setMovies] = useState(() => preloadedMovies || []);
  const [loading, setLoading] = useState(!preloadedMovies || !preloadedMovies.length);

  const navigate = useNavigate();

  useEffect(() => {
    // If we already have preloaded data, skip the network call
    if (preloadedMovies && preloadedMovies.length) return;
    let ignore = false;
    const genreId = genre.id || genre;
    cachedApiFetch(`/api/movies?genre=${genreId}&limit=20`)
      .then((data) => {
        if (!ignore && data.movies) {
          setMovies(data.movies);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!ignore) setLoading(false);
      });
    return () => { ignore = true; };
  }, [genre, preloadedMovies]);

  if (loading || !movies.length) return null;

  const title = genre.name || genre;
  const genreId = genre.id || genre;
  // Apply limit for 2 rows on desktop
  const displayLimit = limit || 14;

  return (
    <section className="content-section">
      <HomeShelfHeader 
        title={title} 
        onViewAll={() => navigate(`/genre/${genreId}/${encodeURIComponent(title)}`)} 
      />
      <div className={HOME_GRID_CLASS}>
        {movies.slice(0, displayLimit).map((item) => (
          <ContentCard key={item.id} item={item} data-card />
        ))}
      </div>
    </section>
  );
}

function HomePageSkeleton() {
  return (
    <div className="space-y-12">
      <section className="content-section">
        <div className="mb-4 space-y-2 animate-pulse">
          <div className="h-6 w-40 rounded bg-white/[0.08]"></div>
          <div className="h-4 w-64 rounded bg-white/[0.06]"></div>
        </div>
        <SearchResultSkeletonGrid columns="grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7" count={12} />
      </section>

      <section className="content-section">
        <div className="mb-4 space-y-2 animate-pulse">
          <div className="h-6 w-40 rounded bg-white/[0.08]"></div>
          <div className="h-4 w-72 rounded bg-white/[0.06]"></div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 animate-pulse">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 space-y-3">
              <div className="h-4 w-24 rounded bg-white/[0.08]"></div>
              <div className="h-3 w-40 rounded bg-white/[0.06]"></div>
              <div className="h-3 w-20 rounded bg-white/[0.06]"></div>
              <div className="h-2 w-28 rounded bg-white/[0.05]"></div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function UserProfileSkeleton() {
  return (
    <div className="space-y-7 animate-pulse">
      <section className="rounded-[30px] bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] p-5 md:p-7">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <div className="h-[96px] w-[96px] rounded-full bg-white/[0.08] ring-1 ring-white/10"></div>
            <div className="min-w-0 space-y-3">
              <div className="h-4 w-32 rounded bg-white/[0.06]"></div>
              <div className="h-7 w-52 rounded bg-white/[0.08]"></div>
              <div className="space-y-2">
                <div className="h-3 w-72 rounded bg-white/[0.05]"></div>
                <div className="h-3 w-60 rounded bg-white/[0.05]"></div>
              </div>
            </div>
          </div>
          <div className="flex w-full flex-col items-stretch gap-3 lg:w-auto lg:min-w-[280px] lg:items-end">
            <div className="h-9 w-32 rounded-full bg-white/[0.08]"></div>
            <div className="h-9 w-40 rounded-full bg-white/[0.06]"></div>
          </div>
        </div>
      </section>
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 space-y-3">
            <div className="h-5 w-28 rounded bg-white/[0.08]"></div>
            <div className="h-4 w-48 rounded bg-white/[0.06]"></div>
          </div>
        ))}
      </section>
    </div>
  );
}

function EditProfileSkeleton() {
  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-pulse">
      <section className="rounded-[28px] bg-[rgba(255,255,255,0.03)] p-5 md:p-7">
        <div className="h-7 w-40 rounded bg-white/[0.08]"></div>
        <div className="mt-3 h-4 w-72 rounded bg-white/[0.06]"></div>
        <div className="mt-8 space-y-7">
          <div className="flex flex-col sm:flex-row items-center gap-6">
            <div className="h-24 w-24 rounded-full bg-white/[0.08] ring-1 ring-white/10"></div>
            <div className="space-y-2">
              <div className="h-4 w-28 rounded bg-white/[0.06]"></div>
              <div className="h-3 w-44 rounded bg-white/[0.05]"></div>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="space-y-2">
                <div className="h-4 w-24 rounded bg-white/[0.06]"></div>
                <div className="h-11 w-full rounded-2xl bg-white/[0.05]"></div>
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <div className="h-4 w-24 rounded bg-white/[0.06]"></div>
            <div className="h-28 w-full rounded-2xl bg-white/[0.05]"></div>
          </div>
          <div className="h-11 w-40 rounded-full bg-white/[0.08]"></div>
        </div>
      </section>
    </div>
  );
}

function AuthPageSkeleton({ posterColumn = true }) {
  return (
    <div className="h-[calc(100vh-88px)] overflow-hidden">
      <div className="grid h-[calc(100vh-88px)] overflow-hidden bg-[#080808] lg:grid-cols-[1.08fr_0.92fr]">
        {posterColumn ? (
          <div className="relative hidden overflow-hidden bg-[#080808] lg:flex">
            <div className="flex w-full items-center justify-center animate-pulse">
              <div className="h-[70%] w-[70%] rounded-[32px] bg-white/[0.04]"></div>
            </div>
          </div>
        ) : null}
        <div className="flex h-[calc(100vh-88px)] items-center justify-center bg-[#080808] px-4 sm:px-6 lg:px-10">
          <div className="w-full max-w-[424px] animate-pulse space-y-6">
            <div className="h-8 w-40 rounded bg-white/[0.08]"></div>
            <div className="h-4 w-60 rounded bg-white/[0.06]"></div>
            <div className="space-y-4">
              <div className="h-11 w-full rounded-2xl bg-white/[0.06]"></div>
              <div className="h-11 w-full rounded-2xl bg-white/[0.06]"></div>
            </div>
            <div className="h-11 w-full rounded-full bg-white/[0.08]"></div>
            <div className="h-4 w-52 rounded bg-white/[0.05]"></div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PersonPageSkeleton() {
  return (
    <div className="space-y-10">
      <section className="rounded-[28px] border border-white/10 bg-[linear-gradient(135deg,rgba(15,15,15,0.98),rgba(10,10,10,0.95))] p-6 md:p-8 lg:p-10 overflow-hidden relative animate-pulse">
        <div className="space-y-6">
          <div className="flex flex-col gap-6 md:flex-row md:items-start md:gap-8">
            <div className="w-[220px] max-w-full aspect-[2/3] rounded-[24px] bg-white/[0.08]"></div>
            <div className="min-w-0 flex-1">
              <div className="h-12 w-[min(420px,80%)] rounded bg-white/[0.1] md:mt-1"></div>
              <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mt-6">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="rounded-2xl border border-white/8 bg-white/[0.03] p-4 space-y-3">
                    <div className="h-3 w-20 rounded bg-white/[0.06]"></div>
                    <div className="h-4 w-24 rounded bg-white/[0.08]"></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <div className="h-4 w-full rounded bg-white/[0.06]"></div>
            <div className="h-4 w-[95%] rounded bg-white/[0.06]"></div>
            <div className="h-4 w-[82%] rounded bg-white/[0.06]"></div>
          </div>
        </div>
      </section>

      <section className="content-section">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div className="h-8 w-32 rounded bg-white/[0.08] animate-pulse"></div>
          <div className="h-9 w-36 rounded-full bg-white/[0.08] animate-pulse"></div>
        </div>
        <div className="mb-5 overflow-hidden">
          <div className="flex min-w-max flex-nowrap items-center gap-2">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="h-10 w-32 rounded-full bg-white/[0.08] animate-pulse"></div>
            ))}
          </div>
        </div>
        <LoadingCardRow />
      </section>
    </div>
  );
}

function DetailPage({ type }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const auth = useAuthSession();
  const [content, setContent] = useState(null);
  const [credits, setCredits] = useState([]);
  const [creditsCrew, setCreditsCrew] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [creditsLoading, setCreditsLoading] = useState(true);
  const [creditsError, setCreditsError] = useState('');
  const { collections } = useLiveCollections();
  const optimisticStatusRef = useRef(null);
  const [, forceStatusRender] = useState(0);
  const serverStatus = useMemo(() => getCollectionStatus(collections, id), [collections, id]);
  const status = optimisticStatusRef.current ?? serverStatus;
  const [selectedSeason, setSelectedSeason] = useState(null);
  const [seasonDetails, setSeasonDetails] = useState(null);
  const [seasonLoading, setSeasonLoading] = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState(createEmptyCollectionDraft);
  const [createLoading, setCreateLoading] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const [creditsRetryTick, setCreditsRetryTick] = useState(0);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [failedCreditAttempts, setFailedCreditAttempts] = useState(0);
  const [seasonRetryTick, setSeasonRetryTick] = useState(0);
  const [failedSeasonAttempts, setFailedSeasonAttempts] = useState(0);
  const castScrollerRef = useRef(null);
  const [playerRequest, setPlayerRequest] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);
  const seasonScrollerRef = useRef(null);
  const episodeScrollerRef = useRef(null);

  useEffect(() => {
    setLoading(true);
    setLoadError('');
    setContent(null);
    setCredits([]);
    setCreditsCrew([]);
    setCreditsLoading(true);
    setCreditsError('');
    setSelectedSeason(null);
    setSeasonDetails(null);
    setSeasonLoading(type === 'series');
    setPlayerRequest(null);
    setRetryTick(0);
    setCreditsRetryTick(0);
    setSeasonRetryTick(0);
    setFailedAttempts(0);
    setFailedCreditAttempts(0);
    setFailedSeasonAttempts(0);
    }, [auth.user?.admin, auth.user?.showAdult, id, type]);

  useEffect(() => {
    let ignore = false;
    let retryTimeout = null;
    setCredits([]);
    setLoading(true);
    setLoadError('');

    async function load() {
      setLoading(true);
      setLoadError('');
      try {
        const detailPath = type === 'movie' ? `/api/movies/${id}` : `/api/series/${id}`;
        const [detailResult, userCollections] = await Promise.allSettled([
          cachedApiFetch(detailPath),
          getToken() ? loadUserCollections().catch(() => []) : Promise.resolve([])
        ]);

        const detailData = detailResult.status === 'fulfilled' ? detailResult.value : null;
        const collectionData = userCollections.status === 'fulfilled' ? userCollections.value : [];

        if (!ignore) {
          if (detailResult.status === 'rejected' || !detailData) {
            throw new Error(detailResult.reason?.message || 'Unable to load this page.');
          }
          setContent(detailData);
          setFailedAttempts(0);
          setLoadError('');
          if (type === 'series' && detailData && Array.isArray(detailData.seasons) && detailData.seasons.length) {
            const initialSeason =
              detailData.seasons.find((season) => Number(season.season_number) > 0)?.season_number ??
              detailData.seasons[0]?.season_number ??
              null;
            setSelectedSeason(initialSeason);
          } else {
            setSelectedSeason(null);
            setSeasonDetails(null);
          }
          if (detailData) {
            document.title = `${detailData.title || detailData.name} | Soulstash`;
          }
        }
      } catch (error) {
        if (!ignore) {
          setFailedAttempts((current) => {
            const next = current + 1;
            if (next >= AUTO_RECOVERY_RETRIES) {
              setLoadError(error.message || 'Unable to load this page.');
            } else {
              retryTimeout = window.setTimeout(() => {
                if (!ignore) {
                  setRetryTick((currentTick) => currentTick + 1);
                }
              }, 2500);
            }
            return next;
          });
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      ignore = true;
      if (retryTimeout) {
        window.clearTimeout(retryTimeout);
      }
    };
    }, [auth.user?.admin, auth.user?.showAdult, id, type, retryTick]);

    useEffect(() => {
      let ignore = false;
      let retryTimeout = null;
      let retryPlanned = false;

      async function loadCredits() {
        setCreditsLoading(true);
        setCreditsError('');
        try {
          const creditPath = type === 'movie' ? `/api/movie/${id}/credits` : `/api/series/${id}/credits`;
          const creditData = await cachedApiFetch(creditPath);
          const nextCast = (creditData.cast || []).slice(0, 16);
          const nextCrew = Array.isArray(creditData.crew) ? creditData.crew : [];

          if (!ignore) {
            setCredits(nextCast);
            setCreditsCrew(nextCrew);

            if (!nextCast.length && !nextCrew.length) {
              setFailedCreditAttempts((current) => {
                const next = current + 1;
                if (next < AUTO_RECOVERY_RETRIES) {
                  retryPlanned = true;
                  retryTimeout = window.setTimeout(() => {
                    if (!ignore) {
                      setCreditsRetryTick((currentTick) => currentTick + 1);
                    }
                  }, 2500);
                } else {
                  setCreditsError('');
                }
                return next;
              });
            } else {
              setFailedCreditAttempts(0);
              setCreditsError('');
            }
          }
        } catch (error) {
          if (!ignore) {
            setFailedCreditAttempts((current) => {
              const next = current + 1;
            if (next >= AUTO_RECOVERY_RETRIES) {
              setCreditsError(error.message || 'Unable to load cast right now.');
            } else {
              retryTimeout = window.setTimeout(() => {
                if (!ignore) {
                  setCreditsRetryTick((currentTick) => currentTick + 1);
                }
              }, 2500);
            }
            return next;
          });
        }
        } finally {
          if (!ignore) {
            if (!retryPlanned) {
              setCreditsLoading(false);
            }
          }
        }
      }

    setCredits([]);
    setCreditsCrew([]);
    setCreditsError('');
    setFailedCreditAttempts(0);
    loadCredits();

    return () => {
      ignore = true;
        if (retryTimeout) {
          window.clearTimeout(retryTimeout);
        }
      };
    }, [auth.user?.admin, auth.user?.showAdult, creditsRetryTick, id, retryTick, type]);

  useEffect(() => {
    setFailedSeasonAttempts(0);
    setSeasonRetryTick(0);
  }, [id, selectedSeason, type]);

  useEffect(() => {
    if (type !== 'series' || !selectedSeason) {
      setSeasonDetails(null);
      return;
    }

    let ignore = false;
    let retryTimeout = null;
    let retryPlanned = false;
    setSeasonLoading(true);
    setSeasonDetails(null);

    cachedApiFetch(`/api/series/${id}/season/${selectedSeason}`)
      .then((payload) => {
        if (!ignore) {
          setSeasonDetails(payload);
          setFailedSeasonAttempts(0);
        }
      })
      .catch((error) => {
        if (!ignore) {
          setFailedSeasonAttempts((current) => {
            const next = current + 1;
            if (next < AUTO_RECOVERY_RETRIES) {
              retryPlanned = true;
              retryTimeout = window.setTimeout(() => {
                if (!ignore) {
                  setSeasonRetryTick((currentTick) => currentTick + 1);
                }
              }, 2500);
            }
            return next;
          });
        }
      })
      .finally(() => {
        if (!ignore) {
          if (!retryPlanned) {
            setSeasonLoading(false);
          }
        }
      });

    return () => {
      ignore = true;
      if (retryTimeout) {
        window.clearTimeout(retryTimeout);
      }
    };
  }, [id, selectedSeason, type, seasonRetryTick]);

  async function toggleCollection(targetCollection) {
    if (!getToken()) {
      toast('Please login first', 'success');
      return;
    }

    const isSeries = type === 'series';
    const idKey = isSeries ? 'seriesId' : 'movieId';
    const alreadySaved = targetCollection === 'Watched' ? status.watched : status.watchlist;

    try {
      setPendingAction(targetCollection);
      const payload = {
        [idKey]: Number(id),
        title: content.title || content.name,
        poster_path: content.poster_path || '',
        release_date: content.release_date || content.first_air_date || '',
        media_type: isSeries ? 'Series' : 'Movie'
      };

      if (alreadySaved) {
        if (window.CollectionStore?.removeFromCollection) {
          await window.CollectionStore.removeFromCollection(targetCollection, payload.movieId, payload.seriesId);
        } else {
          const removeResp = await apiFetch(`/api/user/collections/${encodeURIComponent(targetCollection)}/remove`, {
            method: 'POST',
            body: JSON.stringify({
              ...(payload.movieId ? { movieId: payload.movieId } : {}),
              ...(payload.seriesId ? { seriesId: payload.seriesId } : {})
            })
          });
          if (Array.isArray(removeResp?.collections)) {
            broadcastCollections(normalizeCollections(removeResp.collections), removeResp?.collectionVersion);
          } else {
            await refreshCollectionsView();
          }
        }
      } else {
        if (window.CollectionStore?.addToCollection) {
          await window.CollectionStore.addToCollection(targetCollection, payload);
        } else {
          const addResp = await apiFetch(`/api/user/collections/${encodeURIComponent(targetCollection)}/add`, {
            method: 'POST',
            body: JSON.stringify(payload)
          });
          if (Array.isArray(addResp?.collections)) {
            broadcastCollections(normalizeCollections(addResp.collections), addResp?.collectionVersion);
          } else {
            await refreshCollectionsView();
          }
        }
      }
      toast(alreadySaved ? `Removed from ${targetCollection}` : `Added to ${targetCollection}`, 'success');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setPendingAction(null);
    }
  }

  if (loading) {
    return <DetailPageSkeleton type={type} />;
  }

  if (!content) {
    return <DetailPageSkeleton type={type} />;
  }

  const title = content.title || content.name || 'Unknown title';
  const currentUsername = getCurrentUsername();
  const languageName = getLanguageName(content.language || content.original_language, content.language || content.original_language || 'Unknown');
  const directorLabel = getDirectorLabel(content, creditsCrew, type);
  const directorPeople = getDirectorPeople(content, creditsCrew, type);
  const directorStat = directorPeople.length ? (
    <DetailPeopleStat label={type === 'series' ? 'Creator' : 'Directed By'} people={directorPeople} navigate={navigate} />
  ) : (
    <DetailStat label={type === 'series' ? 'Creator' : 'Directed By'} value={directorLabel} />
  );
  const countryLabel = getPrimaryCountry(content);
  const ageRatingLabel = content.age_rating || content.certification || content.release_rating || content.content_rating || 'N/A';
  const seasonList = Array.isArray(content.seasons) ? content.seasons : [];
  const visibleSeasonList = seasonList.filter((season) => Number(season?.season_number) > 0);
  const runtimeLabel =
    type === 'movie'
      ? formatRuntime(content.runtime)
      : Array.isArray(content.episode_run_time) && content.episode_run_time.length
        ? formatRuntime(content.episode_run_time[0])
        : formatRuntime(content.runtime);
  const meta = [
    type === 'movie' ? 'Movie' : 'Series',
    yearFrom(content),
    runtimeLabel !== 'N/A' ? runtimeLabel : '',
    getPreferredRating(content) ? `Rating ${getPreferredRating(content).toFixed(1)}` : 'No rating'
  ].filter(Boolean);

  async function handleToggleCustomCollection(targetCollection) {
    if (!content) return;

    const alreadySaved = isContentInCollection(collections, targetCollection.name, id);

    const payload =
      type === 'series'
        ? {
            seriesId: Number(id),
            title,
            poster_path: content.poster_path || '',
            release_date: content.first_air_date || '',
            media_type: 'Series'
          }
        : {
            movieId: Number(id),
            title,
            poster_path: content.poster_path || '',
            release_date: content.release_date || '',
            media_type: 'Movie'
          };

    // Apply optimistic override instantly
    try {
      setPendingAction(targetCollection.name);
      if (alreadySaved) {
        if (window.CollectionStore?.removeFromCollection) {
          await window.CollectionStore.removeFromCollection(targetCollection._id || targetCollection.name, payload.movieId, payload.seriesId);
        } else {
          const removeR = await apiFetch(`/api/user/collections/${encodeURIComponent(targetCollection._id || targetCollection.name)}/remove`, {
            method: 'POST',
            body: JSON.stringify({
              ...(payload.movieId ? { movieId: payload.movieId } : {}),
              ...(payload.seriesId ? { seriesId: payload.seriesId } : {})
            })
          });
          if (Array.isArray(removeR?.collections)) {
            broadcastCollections(normalizeCollections(removeR.collections), removeR?.collectionVersion);
          } else {
            await refreshCollectionsView();
          }
        }
        toast(`Removed from ${targetCollection.name}`);
      } else {
        if (window.CollectionStore?.addToCollection) {
          await window.CollectionStore.addToCollection(targetCollection._id || targetCollection.name, payload);
        } else {
          const addR = await apiFetch(`/api/user/collections/${encodeURIComponent(targetCollection._id || targetCollection.name)}/add`, {
            method: 'POST',
            body: JSON.stringify(payload)
          });
          if (Array.isArray(addR?.collections)) {
            broadcastCollections(normalizeCollections(addR.collections), addR?.collectionVersion);
          } else {
            await refreshCollectionsView();
          }
        }
        toast(`Saved to ${targetCollection.name}`);
      }
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setPendingAction(null);
    }
  }

  async function handleCreateCustomCollection() {
    if (!createDraft.name.trim()) {
      toast('Please enter a collection name', 'error');
      return;
    }

    try {
      setCreateLoading(true);
      if (window.CollectionStore?.createCollection) {
        await window.CollectionStore.createCollection(createDraft.name.trim(), createDraft.isPublic, createDraft.description.trim());
      } else {
        await apiFetch('/api/user/collections', {
          method: 'POST',
          body: JSON.stringify({
            name: createDraft.name.trim(),
            isPublic: createDraft.isPublic,
            description: createDraft.description.trim()
          })
        });
        await refreshCollectionsView();
      }
      toast(`Created ${createDraft.name.trim()}`);
      setCreateModalOpen(false);
      setSaveModalOpen(true);
      setCreateDraft(createEmptyCollectionDraft());
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setCreateLoading(false);
    }
  }

  return (
    <div className="space-y-10">
      <section className="relative -mx-4 overflow-hidden bg-[#080808] sm:mx-0 sm:rounded-[28px] sm:border sm:border-white/10">
        <div className="relative aspect-[1.6/1] sm:aspect-[2.1/1] lg:aspect-[2.68/1] w-full overflow-hidden bg-black">
          <img
            src={imageUrl(content.backdrop_path, 'original')}
            alt={title}
            className="h-full w-full object-cover object-[center_22%]"
            onError={(event) => {
              event.currentTarget.src = FALLBACK_AVATAR;
            }}
          />
          <button
              type="button"
              data-play-btn="true"
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/65 active:scale-95 active:bg-black/70 lg:h-16 lg:w-16 touch-manipulation"
              aria-label={`Play ${title}`}
              onClick={() => {
                const tmdbId = content?.id || id;
                if (type === 'movie') {
                  setPlayerRequest(
                    createPlayerRequest({
                      mediaType: 'movie',
                      tmdbId,
                      imdbId: content?.imdb_id,
                      title
                    })
                  );
                } else {
                  const season = selectedSeason || 1;
                  const ep = seasonDetails?.episodes?.[0]?.episode_number || 1;
                  setPlayerRequest(
                    createPlayerRequest({
                      mediaType: 'series',
                      tmdbId,
                      seasonNumber: season,
                      episodeNumber: ep,
                      imdbId: content?.imdb_id,
                      title
                    })
                  );
                }
              }}
            >
              <i className="fas fa-play translate-x-[1px] text-sm lg:text-base"></i>
            </button>
          <div className="absolute inset-x-0 bottom-0 h-[48%] bg-gradient-to-t from-[#080808] via-[#080808]/78 to-transparent z-10"></div>
        </div>

        <div className="relative z-10 px-4 pb-6 sm:px-6 sm:pb-8 lg:px-8 lg:pb-10 xl:px-12">
          <div className="-mt-10 sm:-mt-14 lg:-mt-20 xl:hidden">
            <div className="mt-4 flex items-start gap-4">
              <div className="w-[110px] sm:w-[140px] flex-shrink-0 space-y-2">
                <div className="aspect-[2/3] overflow-hidden rounded-xl shadow-2xl">
                  <img
                    src={imageUrl(content.poster_path, 'w500')}
                    alt={title}
                    className="w-full h-full object-cover"
                    onError={(event) => {
                      event.currentTarget.src = FALLBACK_AVATAR;
                    }}
                  />
                </div>
                <DetailStat label="Language" value={languageName} />
              </div>

              <div className="min-w-0 flex-1 self-end">
                <div className="text-[13px] text-[#ABABAB] overflow-x-auto whitespace-nowrap no-scrollbar">{meta.join(' | ')}</div>
                <h1 className="mt-1 text-[20px] leading-[28px] sm:text-[24px] sm:leading-[30px] font-semibold text-white">{title}</h1>
                <div className="mt-3 grid grid-rows-[auto_1fr] gap-2">
                <div className="grid grid-cols-2 gap-2">
                  <DetailStat label="Country" value={countryLabel} />
                  <DetailStat
                    label={type === 'series' ? 'Seasons' : 'Age Rating'}
                    value={type === 'series' ? String(content.number_of_seasons || 'N/A') : ageRatingLabel}
                  />
                </div>
                <div className="self-end">
                  {directorStat}
                </div>
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-2">
              <div className="flex gap-2">
                <div className="w-1/2">
                  <ActionButton
                    active={status.watched}
                    label={status.watched ? 'Watched' : 'Mark as Watched'}
                    onClick={() => toggleCollection('Watched')}
                    icon="fas fa-eye"
                    activeIcon="fas fa-check"
                    loading={pendingAction === 'Watched'}
                  />
                </div>
                <div className="w-1/2">
                  <ActionButton
                    active={status.watchlist}
                    label={status.watchlist ? 'In Watchlist' : 'Add to Watchlist'}
                    onClick={() => toggleCollection('Watchlist')}
                    icon="fas fa-clock"
                    activeIcon="fas fa-check"
                    loading={pendingAction === 'Watchlist'}
                  />
                </div>
              </div>
              <button
                type="button"
                className="flex h-[40px] w-full items-center justify-center whitespace-nowrap rounded-full bg-white/10 px-6 text-white font-medium hover:bg-white/20 transition-colors"
                onClick={() => {
                  if (!currentUsername) {
                    toast('Please login first', 'error');
                    return;
                  }
                  setSaveModalOpen(true);
                }}
              >
                <i className={`${status.customSaved ? 'fas' : 'far'} fa-bookmark mr-2 text-[13px]`}></i>
                {status.customSaved ? 'Added to Collection' : 'Add to Collection'}
              </button>
            </div>
          </div>

          <div className="hidden xl:block">
            <div className="-mt-[13rem] flex w-full flex-row items-end gap-8">
              <div className="w-[200px] aspect-[2/3] overflow-hidden rounded-2xl shadow-2xl flex-shrink-0">
                <img
                  src={imageUrl(content.poster_path, 'w500')}
                  alt={title}
                  className="w-full h-full object-cover"
                  onError={(event) => {
                    event.currentTarget.src = FALLBACK_AVATAR;
                  }}
                />
              </div>

              <div className="min-w-0 flex-1">
                <div className="text-sm text-[#ABABAB] overflow-x-auto whitespace-nowrap no-scrollbar">{meta.join(' | ')}</div>
                <h1 className="mt-1 text-[28px] leading-[36px] font-semibold text-white">{title}</h1>

                <div className="mt-6 grid grid-cols-4 gap-5">
                  {directorStat}
                  <DetailStat label="Country" value={countryLabel} />
                  <DetailStat label="Language" value={languageName} />
                  <DetailStat label={type === 'series' ? 'Seasons' : 'Age Rating'} value={type === 'series' ? String(content.number_of_seasons || 'N/A') : (content.age_rating || content.status || 'N/A')} />
                </div>
              </div>

              <div className="xl:w-[376px] xl:flex xl:flex-col xl:gap-2.5 xl:self-end">
                <div className="flex h-[40px] gap-2.5">
                  <div className="w-1/2">
                    <ActionButton
                      active={status.watched}
                      label={status.watched ? 'Watched' : 'Mark as Watched'}
                      onClick={() => toggleCollection('Watched')}
                      icon="fas fa-eye"
                      activeIcon="fas fa-check"
                      loading={pendingAction === 'Watched'}
                    />
                  </div>
                  <div className="w-1/2">
                    <ActionButton
                      active={status.watchlist}
                      label={status.watchlist ? 'In Watchlist' : 'Add to Watchlist'}
                      onClick={() => toggleCollection('Watchlist')}
                      icon="fas fa-clock"
                      activeIcon="fas fa-check"
                      loading={pendingAction === 'Watchlist'}
                    />
                  </div>
                </div>
                <button
                  type="button"
                  disabled={!!pendingAction}
                  className={`flex h-[40px] w-full items-center justify-center whitespace-nowrap rounded-full bg-white/10 px-6 text-white font-medium hover:bg-white/20 transition-colors ${pendingAction ? 'opacity-70 cursor-wait' : ''}`}
                  onClick={() => {
                    if (!currentUsername) {
                      toast('Please login first', 'error');
                      return;
                    }
                    setSaveModalOpen(true);
                  }}
                >
                  {pendingAction && !['Watched', 'Watchlist'].includes(pendingAction) ? (
                    <i className="fas fa-spinner fa-spin mr-2 text-[13px]"></i>
                  ) : (
                    <i className={`${status.customSaved ? 'fas' : 'far'} fa-bookmark mr-2 text-[13px]`}></i>
                  )}
                  {pendingAction && !['Watched', 'Watchlist'].includes(pendingAction) ? 'Updating...' : (status.customSaved ? 'Added to Collection' : 'Add to Collection')}
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="content-section">
        <div className="rounded-[28px] border border-white/8 bg-[rgba(12,12,12,0.72)] p-5 md:p-6">
          <SectionHeader title="Overview" />
          <p className="mt-4 text-[14px] leading-[22px] text-[#B3B3B3] md:text-[16px] md:leading-[26px]">
            {content.overview || 'No overview available yet.'}
          </p>
          {Array.isArray(content.genres) && content.genres.length ? (
            <div className="mt-5 flex flex-wrap gap-2">
              {content.genres.map((genre) => {
                const label = typeof genre === 'string' ? genre : genre?.name;
                return label ? (
                  <span key={label} className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm text-[#d8d8d8]">
                    {label}
                  </span>
                ) : null;
              })}
            </div>
          ) : null}
        </div>
      </section>

      {type === 'series' ? (
        <section className="content-section">
          <SectionHeader title="Seasons & Episodes" />
          <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(15,15,15,0.96),rgba(9,9,9,0.98))] p-4 md:p-6">
            <div className="mb-5 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-[#b7b7b7]">
                  {content.number_of_seasons || 0} seasons Ã¢â‚¬Â¢ {content.number_of_episodes || 0} episodes Ã¢â‚¬Â¢ Avg runtime {formatRuntime(content.runtime)}
                </p>
                {visibleSeasonList.length > 1 ? (
                  <div className="hidden shrink-0 items-center gap-2 md:flex">
                    <button
                      type="button"
                      className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/18"
                      onClick={() => seasonScrollerRef.current?.scrollBy({ left: -220, behavior: 'smooth' })}
                      aria-label="Scroll seasons left"
                    >
                      <i className="fas fa-chevron-left"></i>
                    </button>
                    <button
                      type="button"
                      className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/18"
                      onClick={() => seasonScrollerRef.current?.scrollBy({ left: 220, behavior: 'smooth' })}
                      aria-label="Scroll seasons right"
                    >
                      <i className="fas fa-chevron-right"></i>
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <h3 className="text-2xl font-semibold text-white">
                  {seasonDetails?.name || (selectedSeason ? `Season ${selectedSeason}` : 'Season guide')}
                </h3>
                {visibleSeasonList.length ? (
                  <div
                    ref={seasonScrollerRef}
                    className="filter-scrollbar-hidden min-w-0 overflow-x-auto overflow-y-hidden"
                  >
                    <div className="flex min-w-max flex-nowrap items-center gap-2 pr-1">
                      {visibleSeasonList.map((season) => (
                          <button
                            key={season.id || season.season_number}
                            type="button"
                            className={`px-4 py-2 rounded-2xl text-sm font-medium transition-colors ${
                              Number(selectedSeason) === Number(season.season_number)
                                ? 'bg-white text-black'
                                : 'bg-white/6 text-white hover:bg-white/12'
                            }`}
                            onClick={() => setSelectedSeason(season.season_number)}
                          >
                            S{season.season_number}
                          </button>
                        ))}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-[#b7b7b7]">
                  {seasonDetails?.episodes?.length || 0} episodes
                </p>
                {seasonDetails?.episodes?.length ? (
                  <div className="hidden shrink-0 items-center gap-2 md:flex">
                    <button
                      type="button"
                      className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/18"
                      onClick={() => episodeScrollerRef.current?.scrollBy({ left: -320, behavior: 'smooth' })}
                      aria-label="Scroll episodes left"
                    >
                      <i className="fas fa-chevron-left"></i>
                    </button>
                    <button
                      type="button"
                      className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/18"
                      onClick={() => episodeScrollerRef.current?.scrollBy({ left: 320, behavior: 'smooth' })}
                      aria-label="Scroll episodes right"
                    >
                      <i className="fas fa-chevron-right"></i>
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            {seasonLoading ? <EpisodeRowSkeleton /> : null}

            {!seasonLoading && seasonDetails?.episodes?.length ? (
              <div ref={episodeScrollerRef} className="cast-scroll flex gap-3 overflow-x-auto pb-2">
                {seasonDetails.episodes.map((episode) => (
                  <EpisodeCard
                    key={episode.id || `${episode.season_number}-${episode.episode_number}`}
                    episode={episode}
                    onPlay={(ep) =>
                      setPlayerRequest(
                        createPlayerRequest({
                          mediaType: 'series',
                          tmdbId: content?.id || id,
                          seasonNumber: ep.season_number,
                          episodeNumber: ep.episode_number,
                          imdbId: content?.imdb_id,
                          title: `${title} S${ep.season_number}E${ep.episode_number}`
                        })
                      )
                    }
                  />
                ))}
              </div>
            ) : null}

            {!seasonLoading && !seasonDetails?.episodes?.length ? (
              <div className="empty-state">No episode details available for this season yet.</div>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="content-section">
        <div className="mb-5 flex items-center justify-between gap-4">
          <SectionHeader title="Cast" />
          {credits.length ? (
            <div className="hidden items-center gap-2 md:flex">
              <button
                type="button"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/18"
                onClick={() => castScrollerRef.current?.scrollBy({ left: -320, behavior: 'smooth' })}
                aria-label="Scroll cast left"
              >
                <i className="fas fa-chevron-left"></i>
              </button>
              <button
                type="button"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/18"
                onClick={() => castScrollerRef.current?.scrollBy({ left: 320, behavior: 'smooth' })}
                aria-label="Scroll cast right"
              >
                <i className="fas fa-chevron-right"></i>
              </button>
            </div>
          ) : null}
        </div>
        {creditsLoading ? (
          <CastRowSkeleton />
        ) : credits.length ? (
          <div ref={castScrollerRef} className="cast-scroll flex gap-4 overflow-x-auto pb-2">
            {credits.map((person) => (
              <CastCard key={person.id} person={person} />
            ))}
          </div>
        ) : creditsError ? (
          <div className="empty-state">Unable to load cast right now.</div>
        ) : (
          <div className="empty-state">No cast information available.</div>
        )}
      </section>
      <SaveToCollectionModal
        open={saveModalOpen}
        onClose={() => setSaveModalOpen(false)}
        collections={collections}
        contentId={Number(id)}
        onToggleCollection={handleToggleCustomCollection}
        onCreateNew={() => {
          setSaveModalOpen(false);
          setCreateModalOpen(true);
        }}
      />
      <CreateCollectionModal
        open={createModalOpen}
        values={createDraft}
        onChange={setCreateDraft}
        onClose={() => {
          setCreateModalOpen(false);
          setCreateDraft(createEmptyCollectionDraft());
        }}
        onSubmit={handleCreateCustomCollection}
        saving={createLoading}
      />
      {playerRequest?.tmdbId ? (
        <PlayerErrorBoundary onClose={() => setPlayerRequest(null)}>
          <VideoPlayerModal request={playerRequest} onClose={() => setPlayerRequest(null)} />
        </PlayerErrorBoundary>
      ) : null}
    </div>
  );
}

function DetailStat({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <p className="text-[13px] leading-4 text-[#ABABAB] font-medium">{label}</p>
      <p className="mt-2 whitespace-normal break-words text-[14px] leading-[20px] text-[#E2E2E2] font-semibold">{value}</p>
    </div>
  );
}

function DetailPeopleStat({ label, people, navigate }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <p className="text-[13px] leading-4 text-[#ABABAB] font-medium">{label}</p>
      <p className="mt-2 whitespace-normal break-words text-[14px] leading-[20px] text-[#E2E2E2] font-semibold">
        {people.map((person, index) => (
          <React.Fragment key={person.id}>
            {index > 0 ? <span className="text-[#8f8f8f]">, </span> : null}
            <button
              type="button"
              className="font-semibold text-[#E2E2E2] underline-offset-4 transition-colors hover:text-white hover:underline"
              onClick={() => navigate(`/person/${person.id}`)}
            >
              {person.name}
            </button>
          </React.Fragment>
        ))}
      </p>
    </div>
  );
}

function ActionButton({ active, label, onClick, icon = null, activeIcon = null, loading = false }) {
  return (
    <button
      type="button"
      disabled={loading}
      className={`flex h-[40px] w-full items-center justify-center gap-1.5 overflow-hidden whitespace-nowrap rounded-full px-3.5 text-[12px] lg:text-[13px] leading-none font-medium transition-all ${
        active ? 'bg-[#00b83d] text-white' : 'bg-gradient-to-r from-[#B048FF] to-[#8F44F0] text-[#E2E2E2]'
      } ${loading ? 'opacity-70 cursor-wait' : ''}`}
      onClick={onClick}
    >
      {loading ? (
        <i className="fas fa-spinner fa-spin shrink-0 text-[12px]"></i>
      ) : active ? (
        activeIcon ? <i className={`${activeIcon} shrink-0 text-[12px]`}></i> : icon ? <i className={`${icon} shrink-0 text-[12px]`}></i> : null
      ) : icon ? (
        <i className={`${icon} shrink-0 text-[12px]`}></i>
      ) : null}
      <span className="truncate">{loading ? 'Updating...' : label}</span>
    </button>
  );
}

const SEARCH_HISTORY_KEY = 'searchHistory';

function getSearchHistory() {
  try {
    const raw = localStorage.getItem(SEARCH_HISTORY_KEY);
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveSearchHistoryItem(item) {
  try {
    const next = [
      {
        id: item.id,
        title: item.title || item.name || item.username || 'Unknown',
        name: item.name || item.title || '',
        username: item.username || '',
        poster_path: item.poster_path || item.profile_path || item.avatar || '',
        media_type: item.media_type,
        release_date: item.release_date || item.first_air_date || '',
        fullName: item.fullName || ''
      },
      ...getSearchHistory().filter((entry) => `${entry.media_type}:${entry.id || entry.username}` !== `${item.media_type}:${item.id || item.username}`)
    ].slice(0, 20);
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(next));
  } catch {}
}

function getOverlayColumnCount() {
  const width = window.innerWidth;
  if (width >= 1024) return 4;
  if (width >= 768) return 3;
  if (width >= 640) return 2;
  return 1;
}

function NavbarSearchOverlay({ open, onClose, query, setQuery, results, loading, tab, setTab, navigate }) {
  const overlayInputRef = useRef(null);
  const resultsScrollerRef = useRef(null);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const resultButtonsRef = useRef([]);
  const tabButtonsRef = useRef([]);

  useEffect(() => {
    if (!open) return undefined;
    const originalBodyOverflow = document.body.style.overflow;
    const originalHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    const frame = window.requestAnimationFrame(() => {
      overlayInputRef.current?.focus();
    });

    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = originalBodyOverflow;
      document.documentElement.style.overflow = originalHtmlOverflow;
    };
  }, [open]);

  const historyItems = useMemo(() => getSearchHistory(), [open]);
  const activeResults = useMemo(() => {
    const source = query.trim().length >= 2 ? results : historyItems;
    return source.filter((item) => {
      if (tab === 'content') return ['Movie', 'Series', 'tv'].includes(item.media_type);
      if (tab === 'cast') return item.media_type === 'Person';
      if (tab === 'users') return item.media_type === 'User';
      return true;
    });
  }, [historyItems, query, results, tab]);

  useEffect(() => {
    resultButtonsRef.current = [];
  }, [activeResults]);

  useEffect(() => {
    setFocusedIndex(-1);
  }, [query]);

  const focusedIndexRef = useRef(-1);
  focusedIndexRef.current = focusedIndex;
  const activeResultsRef = useRef([]);
  activeResultsRef.current = activeResults;

  useEffect(() => {
    if (!open) return undefined;

    function handleOverlayKeys(event) {
      if (event.key === 'Escape') {
        onClose();
        return;
      }

      const resultsList = activeResultsRef.current;
      const index = focusedIndexRef.current;
      const cols = getOverlayColumnCount();
      const tabValues = ['content', 'cast', 'users'];
      const activeTabIdx = tab === 'content' ? 0 : tab === 'cast' ? 1 : 2;

      if (index === -1) {
        // Input has focus
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          event.stopPropagation();
          const targetFocus = -2 - activeTabIdx;
          setFocusedIndex(targetFocus);
          tabButtonsRef.current[activeTabIdx]?.focus();
        }
      } else if (index < -1) {
        // Tab headers have focus
        const currentTabIdx = -index - 2;

        if (event.key === 'ArrowRight') {
          event.preventDefault();
          event.stopPropagation();
          if (currentTabIdx < 2) {
            const nextIdx = currentTabIdx + 1;
            const targetFocus = -2 - nextIdx;
            setFocusedIndex(targetFocus);
            setTab(tabValues[nextIdx]);
            tabButtonsRef.current[nextIdx]?.focus();
          }
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault();
          event.stopPropagation();
          if (currentTabIdx > 0) {
            const prevIdx = currentTabIdx - 1;
            const targetFocus = -2 - prevIdx;
            setFocusedIndex(targetFocus);
            setTab(tabValues[prevIdx]);
            tabButtonsRef.current[prevIdx]?.focus();
          }
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          event.stopPropagation();
          setFocusedIndex(-1);
          overlayInputRef.current?.focus();
        } else if (event.key === 'ArrowDown') {
          event.preventDefault();
          event.stopPropagation();
          if (resultsList.length > 0) {
            setFocusedIndex(0);
            resultButtonsRef.current[0]?.focus();
            resultButtonsRef.current[0]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
        }
      } else {
        // Grid item has focus
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          event.stopPropagation();
          const nextIndex = index + cols;
          if (nextIndex < resultsList.length) {
            setFocusedIndex(nextIndex);
            resultButtonsRef.current[nextIndex]?.focus();
            resultButtonsRef.current[nextIndex]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          } else if (index < resultsList.length - 1) {
            const lastIdx = resultsList.length - 1;
            setFocusedIndex(lastIdx);
            resultButtonsRef.current[lastIdx]?.focus();
            resultButtonsRef.current[lastIdx]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          event.stopPropagation();
          const prevIndex = index - cols;
          if (prevIndex < 0) {
            // Return to active tab button
            const targetFocus = -2 - activeTabIdx;
            setFocusedIndex(targetFocus);
            tabButtonsRef.current[activeTabIdx]?.focus();
          } else {
            setFocusedIndex(prevIndex);
            resultButtonsRef.current[prevIndex]?.focus();
            resultButtonsRef.current[prevIndex]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
        } else if (event.key === 'ArrowRight') {
          if (index < resultsList.length - 1) {
            event.preventDefault();
            event.stopPropagation();
            const nextIndex = index + 1;
            setFocusedIndex(nextIndex);
            resultButtonsRef.current[nextIndex]?.focus();
            resultButtonsRef.current[nextIndex]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
        } else if (event.key === 'ArrowLeft') {
          if (index > 0) {
            event.preventDefault();
            event.stopPropagation();
            const prevIndex = index - 1;
            setFocusedIndex(prevIndex);
            resultButtonsRef.current[prevIndex]?.focus();
            resultButtonsRef.current[prevIndex]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          } else if (index === 0) {
            event.preventDefault();
            event.stopPropagation();
          }
        } else if (event.key === 'Enter') {
          event.preventDefault();
          event.stopPropagation();
          openItem(resultsList[index]);
        }
      }
    }

    window.addEventListener('keydown', handleOverlayKeys, true);
    return () => {
      window.removeEventListener('keydown', handleOverlayKeys, true);
    };
  }, [open, onClose, tab]);

  function openItem(item) {
    saveSearchHistoryItem(item);
    onClose();
    if (item.media_type === 'Person') {
      navigate(`/person/${item.id}`);
      return;
    }
    if (item.media_type === 'User') {
      const targetUsername = item.username || item.title || item.name;
      navigate(`/user/${encodeURIComponent(targetUsername)}`);
      return;
    }
    navigate(mediaRoute(item));
  }

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-[9998] bg-black/55 backdrop-blur-sm" onClick={onClose}></div>
      <div
        data-search-overlay="true"
        onWheel={(event) => event.stopPropagation()}
        onTouchMove={(event) => event.stopPropagation()}
        className="fixed left-[5vw] right-[5vw] top-[calc(64px+env(safe-area-inset-top,0px))] z-[9999] h-[70vh] w-[90vw] overflow-hidden rounded-b-[28px] border border-[#252833] bg-[#0F0F0F] shadow-[0_24px_60px_rgba(0,0,0,0.45)]"
      >
        <div className="flex h-full flex-col overflow-hidden px-4 sm:px-5 md:px-6">
          <div className="sticky top-0 z-10 bg-[rgba(15,15,15,0.98)] pb-3 pt-4">
            <div className="relative">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
                <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#A0A0A0]">
                  <circle cx="11" cy="11" r="8"></circle>
                  <path d="m21 21-4.3-4.3"></path>
                </svg>
              </div>
              <input
                ref={overlayInputRef}
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search for Movies, Shows, Anime, Cast & Crew or Users..."
                className="h-14 w-full rounded-lg border border-[#353945] bg-[#171717] pl-12 pr-12 text-[#E2E2E2] outline-none transition-all placeholder:text-[#707070] focus:border-white/20"
              />
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  overlayInputRef.current?.focus();
                }}
                className="absolute inset-y-0 right-0 flex items-center pr-4 text-[#a0a0a0] hover:text-white"
                aria-label="Clear search"
              >
                <svg xmlns="http://www.w3.org/2000/svg" height="22" viewBox="0 -960 960 960" fill="currentColor">
                  <path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/>
                </svg>
              </button>
            </div>
          </div>

          <div className="mb-6 mt-3 flex items-center space-x-8 border-b border-[#252833] pb-1">
            {[
              ['content', 'Content', -2],
              ['cast', 'Cast & Crew', -3],
              ['users', 'Users', -4]
            ].map(([value, label, tabIdxVal], index) => (
              <button
                key={value}
                ref={(el) => { tabButtonsRef.current[index] = el; }}
                type="button"
                tabIndex={0}
                className={`relative pb-1 text-sm font-medium transition-all duration-200 outline-none ${
                  tab === value ? 'text-white' : 'text-[#A0A0A0] hover:text-[#E2E2E2]'
                } ${focusedIndex === tabIdxVal ? 'ring-2 ring-white/60 px-2 rounded bg-white/[0.08]' : ''}`}
                onClick={() => setTab(value)}
                onFocus={() => setFocusedIndex(tabIdxVal)}
              >
                {label}
                {tab === value ? <span className="absolute inset-x-0 -bottom-[5px] h-0.5 rounded-full bg-white"></span> : null}
              </button>
            ))}
          </div>

          <div ref={resultsScrollerRef} className="flex-1 overflow-y-auto overscroll-contain pb-6">
            {loading ? (
              <SearchResultSkeletonGrid columns="grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4" count={8} />
            ) : activeResults.length ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                {activeResults.map((item, index) => {
                  const title = item.title || item.name || item.username || 'Unknown';
                  const image = item.media_type === 'User' ? (item.avatar || item.poster_path) : item.poster_path || item.profile_path;
                  const meta =
                    item.media_type === 'User'
                      ? item.fullName || item.bio || 'Soulstash user'
                      : item.media_type === 'Person'
                        ? 'Cast & Crew'
                        : `${item.media_type === 'Series' || item.media_type === 'tv' ? 'Series' : 'Movie'}${yearFrom(item) ? ` | ${yearFrom(item)}` : ''}`;
                  return (
                    <button
                      key={`${item.media_type}-${item.id || item.username || index}`}
                      ref={(el) => { resultButtonsRef.current[index] = el; }}
                      type="button"
                      tabIndex={0}
                      onClick={() => openItem(item)}
                      onFocus={() => setFocusedIndex(index)}
                      className={`flex items-center gap-3 rounded-lg p-3 text-left transition-all border outline-none ${
                        focusedIndex === index
                          ? 'bg-white/[0.08] border-white ring-2 ring-white/20'
                          : 'bg-[#171717] border-transparent hover:bg-[#1d1d1d]'
                      }`}
                    >
                      <div className="h-20 w-14 shrink-0 overflow-hidden rounded-md bg-[#252833]">
                        {image ? (
                          <img
                            src={item.media_type === 'User' ? image : imageUrl(image, 'w300_and_h450_face')}
                            alt={title}
                            className="h-full w-full object-cover"
                            onError={(event) => {
                              event.currentTarget.src = FALLBACK_AVATAR;
                            }}
                          />
                        ) : (
                          <img src={FALLBACK_AVATAR} alt={title} className="h-full w-full object-cover" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1 overflow-hidden">
                        <h3 className="text-sm font-semibold text-[#E2E2E2] overflow-hidden">
                          <HoverMarqueeTitle title={title} />
                        </h3>
                        <p className="mt-1 line-clamp-2 text-xs text-[#9da0a9]">{meta}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center p-8 text-center">
                <div className="mb-4 rounded-full bg-[#171717] p-4">
                  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#505050]">
                    <circle cx="11" cy="11" r="8"></circle>
                    <path d="m21 21-4.3-4.3"></path>
                  </svg>
                </div>
                <p className="text-sm text-[#A0A0A0]">{query.trim().length >= 2 ? 'No results found' : 'No recent searches'}</p>
                <p className="mt-1 text-xs text-[#707070]">
                  {query.trim().length >= 2 ? 'Try searching with different keywords' : 'Your search history will appear here'}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function HoverMarqueeTitle({ title }) {
  const containerRef = useRef(null);
  const textRef = useRef(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  useEffect(() => {
    function measureOverflow() {
      const container = containerRef.current;
      const text = textRef.current;
      if (!container || !text) return;
      setIsOverflowing(text.scrollWidth - container.clientWidth > 2);
    }

    measureOverflow();
    window.addEventListener('resize', measureOverflow);

    let observer = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => measureOverflow());
      if (containerRef.current) observer.observe(containerRef.current);
      if (textRef.current) observer.observe(textRef.current);
    }

    return () => {
      window.removeEventListener('resize', measureOverflow);
      observer?.disconnect();
    };
  }, [title]);

  return (
    <div
      ref={containerRef}
      className={`search-hover-marquee ${isOverflowing ? 'is-overflowing' : ''}`}
      title={title}
    >
      <span className="search-hover-marquee__track">
        <span ref={textRef} className="search-hover-marquee__text">{title}</span>
        {isOverflowing ? (
          <span className="search-hover-marquee__text search-hover-marquee__text--clone" aria-hidden="true">
            {title}
          </span>
        ) : null}
      </span>
    </div>
  );
}

function mergeSearchResults(currentResults, incomingResults, limit = 40) {
  const merged = [];
  const seen = new Set();
  for (const item of [...currentResults, ...incomingResults]) {
    if (!item || item.adult === true) continue;
    if (['Movie', 'Series', 'tv'].includes(item.media_type) && Number(item.score || 0) <= 25) continue;
    const key = `${item.media_type}:${item.id || item.username || item.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged
    .sort((a, b) => {
      const aType = String(a.media_type || '');
      const bType = String(b.media_type || '');
      const aIsContent = ['Movie', 'Series', 'tv'].includes(aType);
      const bIsContent = ['Movie', 'Series', 'tv'].includes(bType);

      if (aIsContent && bIsContent) {
        return Number(b.score || 0) - Number(a.score || 0);
      }
      if (aIsContent !== bIsContent) {
        return aIsContent ? -1 : 1;
      }

      return Number(b.score || b.popularity || 0) - Number(a.score || a.popularity || 0);
    })
    .slice(0, limit);
}

function ReactNavbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useAuthSession();
  const { isLoggedIn, username } = auth;
  const [navReady, setNavReady] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchTab, setSearchTab] = useState('content');
  const searchCacheRef = useRef(new Map());
  const navRef = useRef(null);

  useEffect(() => {
    setNavReady(true);
  }, []);


  // D-pad navigation is handled globally by tvNav.js (useTvFocus in AppShell).
  // The old per-navbar handler has been removed.



  useEffect(() => {
    setSearchOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const handleOpenSearch = (e) => {
      if (e.detail?.query) {
        setSearchQuery(e.detail.query);
        setSearchTab('content');
      }
      setSearchOpen(true);
    };
    window.addEventListener('soulstash:open-search', handleOpenSearch);
    return () => window.removeEventListener('soulstash:open-search', handleOpenSearch);
  }, []);

  useEffect(() => {
    searchCacheRef.current.clear();
    setSearchResults([]);
  }, [auth.user?.admin, auth.user?.showAdult]);

  useEffect(() => {
    if (!searchOpen || searchQuery.trim().length < 2) {
      setSearchLoading(false);
      if (searchQuery.trim().length < 2) {
        setSearchResults([]);
      }
      return undefined;
    }

    let ignore = false;
    const controller = new AbortController();
    const cacheKey = `${searchTab}:${searchQuery.trim().toLowerCase()}`;
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
                if (ignore || event?.query !== searchQuery.trim() || event?.type !== 'results') return;
                const incoming = Array.isArray(event.results) ? event.results : [];
                const nextResults = mergeSearchResults(streamedResults, incoming, 40);
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

        const payload = await cachedApiFetch(
          `/api/search?q=${encodeURIComponent(searchQuery.trim())}&limit=20&type=${encodeURIComponent(searchTab)}`,
          {},
          5000
        );
        if (!ignore) {
          const results = Array.isArray(payload?.results) ? payload.results : [];
          const safeResults = mergeSearchResults([], results, 20);
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
  }, [auth.user?.admin, auth.user?.showAdult, searchOpen, searchQuery, searchTab]);

  const currentPath = location.pathname;
  const navItems = [
    {
      label: 'Watched',
      active: /\/user\/[^/]+\/collection\/Watched$/i.test(currentPath),
      onClick: () => {
        if (!isLoggedIn || !username) return navigate('/login');
        navigate(`/user/${username}/collection/Watched`);
      },
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="nav-link-icon">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
          <circle cx="12" cy="12" r="3"></circle>
        </svg>
      )
    },
    {
      label: 'Watchlist',
      active: /\/user\/[^/]+\/collection\/Watchlist$/i.test(currentPath),
      onClick: () => {
        if (!isLoggedIn || !username) return navigate('/login');
        navigate(`/user/${username}/collection/Watchlist`);
      },
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="nav-link-icon">
          <circle cx="12" cy="12" r="10"></circle>
          <polyline points="12 6 12 12 16 14"></polyline>
        </svg>
      )
    },
    {
      label: 'Collection',
      active:
        /\/user\/[^/]+\/collections$/i.test(currentPath) ||
        (/\/user\/[^/]+\/collection\/.+$/i.test(currentPath) && !/\/user\/[^/]+\/collection\/(Watched|Watchlist)$/i.test(currentPath)) ||
        currentPath === '/collections',
      onClick: () => {
        if (!isLoggedIn || !username) return navigate('/login');
        navigate(`/user/${username}/collections`);
      },
      icon: (
        <svg fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24" className="nav-link-icon" style={{ width: 24, height: 24 }}>
          <circle cx="6" cy="6" r="3"></circle>
          <rect x="12" y="3" width="6" height="6" rx="1"></rect>
          <rect x="3" y="12" width="6" height="6" rx="1"></rect>
          <circle cx="15" cy="15" r="3"></circle>
        </svg>
      )
    }
  ];

  const mobileItems = [
    {
      label: 'Home',
      active: currentPath === '/',
      onClick: () => navigate('/'),
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="nav-link-icon">
          <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
          <polyline points="9 22 9 12 15 12 15 22"></polyline>
        </svg>
      )
    },
    ...navItems,
    {
      label: isLoggedIn && username ? 'Profile' : 'Login',
      active: isLoggedIn ? /^\/user\/[^/]+$/i.test(currentPath) : currentPath === '/login',
      onClick: () => {
        if (!isLoggedIn || !username) return navigate('/login');
        navigate(`/user/${username}`);
      },
      icon: isLoggedIn ? (
        <div className="relative w-6 h-6 flex items-center justify-center flex-shrink-0">
          <div className="relative w-6 h-6 rounded-full overflow-hidden border border-[#474747] flex items-center justify-center">
            <img alt="Profile" className="object-cover rounded-full absolute inset-0 h-full w-full" src="/images/avatar.png" />
          </div>
        </div>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="nav-link-icon">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
          <circle cx="12" cy="7" r="4"></circle>
        </svg>
      )
    }
  ];
  const authCta =
    currentPath === '/login'
      ? { label: 'Sign Up', iconLabel: 'Sign Up', onClick: () => navigate('/register') }
      : currentPath === '/register'
        ? { label: 'Sign In', iconLabel: 'Sign In', onClick: () => navigate('/login') }
        : { label: 'Sign In', iconLabel: 'Sign In', onClick: () => navigate('/login') };

  if (!navReady) {
    return <NavbarSkeleton />;
  }

  return (
    <>
      <header className="modern-navbar-react" ref={navRef}>
        <div className="navbar-container">
          <div className="navbar-logo">
            <button type="button" className="navbar-logo bg-transparent border-0 p-0" onClick={() => navigate('/')}>
              <img src="/images/logo.png" alt="Soulstash Logo" className="logo-img" height="100%" onError={(event) => { event.currentTarget.src = FALLBACK_AVATAR; }} />
            </button>
          </div>

          <div className="nav-links">
            {navItems.map((item) => (
              <button key={item.label} type="button" data-nav={item.label} className={`nav-link ${item.active ? 'active' : ''}`} onClick={item.onClick}>
                <div className="nav-link-content">
                  {item.icon}
                  <span className="nav-link-text">{item.label}</span>
                  <div className="nav-link-underline"></div>
                </div>
              </button>
            ))}
          </div>

          <div className="mobile-actions">
            <button className="mobile-btn" aria-label="Search" type="button" onClick={() => setSearchOpen((current) => !current)}>
              {searchOpen ? (
                <svg xmlns="http://www.w3.org/2000/svg" height="22" viewBox="0 -960 960 960" fill="currentColor" className="w-5 h-5 text-[#E2E2E2]">
                  <path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/>
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 text-[#E2E2E2]">
                  <circle cx="11" cy="11" r="8"></circle>
                  <path d="m21 21-4.3-4.3"></path>
                </svg>
              )}
            </button>
          </div>

          <div className="desktop-actions">
            <button className="mobile-btn" aria-label="Search" type="button" onClick={() => setSearchOpen((current) => !current)}>
              {searchOpen ? (
                <svg xmlns="http://www.w3.org/2000/svg" height="22" viewBox="0 -960 960 960" fill="currentColor" className="w-5 h-5 text-[#E2E2E2]">
                  <path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/>
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 text-[#E2E2E2]">
                  <circle cx="11" cy="11" r="8"></circle>
                  <path d="m21 21-4.3-4.3"></path>
                </svg>
              )}
            </button>
            {isLoggedIn && username ? (
              <button type="button" className="profile-btn" onClick={() => navigate(`/user/${username}`)}>
                <img src="/images/avatar.png" alt="Profile" className="profile-avatar" />
              </button>
            ) : (
              <button type="button" className="signin-btn inline-flex items-center gap-1.5" onClick={authCta.onClick}>
                <i className={`fas ${authCta.iconLabel === 'Sign Up' ? 'fa-user-plus' : 'fa-right-to-bracket'} text-[11px]`}></i>
                <span>{authCta.label}</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <nav className="mobile-bottom-nav-react md:hidden">
        <div className="mobile-bottom-nav-react__inner">
          {mobileItems.map((item) => (
            <button
              key={item.label}
              type="button"
              className={`mobile-bottom-nav-react__item ${item.active ? 'is-active' : ''}`}
              aria-label={item.label}
              onClick={item.onClick}
            >
              {item.icon}
              <span className="mobile-bottom-nav-react__label">{item.label}</span>
            </button>
          ))}
        </div>
      </nav>
      <NavbarSearchOverlay
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        query={searchQuery}
        setQuery={setSearchQuery}
        results={searchResults}
        loading={searchLoading}
        tab={searchTab}
        setTab={setSearchTab}
        navigate={navigate}
      />
    </>
  );
}

function AuthPageLayout({ title, subtitle, children, altLabel, altAction, altHref, posterColumn = true }) {
  const navigate = useNavigate();

  return (
    <div className="min-h-[calc(100vh-88px)] lg:h-[calc(100vh-88px)] lg:overflow-hidden">
      <div className="grid min-h-[calc(100vh-88px)] lg:h-[calc(100vh-88px)] lg:overflow-hidden bg-[#080808] lg:grid-cols-[1.08fr_0.92fr]">
        {posterColumn ? (
          <div className="relative hidden overflow-hidden bg-[#080808] lg:flex">
            <AuthPosterColumns />
          </div>
        ) : null}

        <div className="flex min-h-[calc(100vh-88px)] lg:h-[calc(100vh-88px)] items-center justify-center bg-[#080808] px-4 py-8 sm:px-6 lg:px-10 overflow-y-auto">
          <div className="w-full max-w-[424px] my-auto">
            <h2 className="text-3xl font-semibold text-white">{title}</h2>
            {subtitle ? <p className="mt-2 text-sm leading-6 text-[#9f9f9f]">{subtitle}</p> : null}
            <div className="mt-6">{children}</div>
            <p className="mt-6 text-sm text-[#9f9f9f]">
              {altLabel}{' '}
              <button type="button" className="font-medium text-white hover:underline" onClick={() => navigate(altHref)}>
                {altAction}
              </button>
            </p>
            <div className="mt-10 text-center">
              <p className="text-[15px] font-medium text-white/80">&copy; 2026 Soulstash. All rights reserved.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function LoginPage() {
  const navigate = useNavigate();
  const { isLoggedIn } = useAuthSession();
  const [pageReady, setPageReady] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setPageReady(true);
  }, []);

  useEffect(() => {
    if (isLoggedIn) {
      navigate('/', { replace: true });
    }
  }, [isLoggedIn, navigate]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');

    if (!username.trim() || !password) {
      setError('Please enter username and password');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || 'Login failed');
      }

      saveAuthSession(payload.token, payload.user);
      if (window.CollectionStore?.invalidate) window.CollectionStore.invalidate();
      if (window.CollectionStore?.syncCollections) window.CollectionStore.syncCollections().catch(() => {});
      toast(payload.message || 'Login successful!', 'success');
      navigate('/', { replace: true });
    } catch (submitError) {
      setError(submitError.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  if (!pageReady) {
    return <AuthPageSkeleton />;
  }

  return (
    <AuthPageLayout
      title="Login"
      subtitle=""
      altLabel="New to Soulstash?"
      altAction="Create an account"
      altHref="/register"
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <label className="mb-2 block text-sm font-medium text-[#d7d7d7]">Username</label>
          <input
            className="h-11 w-full rounded-2xl border border-white/10 bg-[#181818] px-4 text-white outline-none transition-colors placeholder:text-[#6f6f6f] focus:border-white/20"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="Enter your username"
          />
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-[#d7d7d7]">Password</label>
            <button
              type="button"
              onClick={() => navigate('/forgot-password')}
              className="text-xs text-[#a0a0a0] hover:text-white transition-colors"
            >
              Forgot password?
            </button>
          </div>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              className="h-11 w-full rounded-2xl border border-white/10 bg-[#181818] pl-4 pr-11 text-white outline-none transition-colors placeholder:text-[#6f6f6f] focus:border-white/20"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your password"
            />
            <button
              type="button"
              className="absolute inset-y-0 right-3 flex items-center text-[#6f6f6f] hover:text-white transition-colors"
              onClick={() => setShowPassword(!showPassword)}
            >
              <i className={`fa-regular ${showPassword ? 'fa-eye-slash' : 'fa-eye'} text-[15px]`}></i>
            </button>
          </div>
        </div>
        {error ? <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div> : null}
        <button
          type="submit"
          disabled={loading}
          className="inline-flex h-11 w-full items-center justify-center rounded-full bg-white text-[15px] font-semibold text-black transition-colors hover:bg-[#e5e5e5] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? 'Signing in...' : 'Login'}
        </button>
      </form>
    </AuthPageLayout>
  );
}

function ForgotPasswordPage() {
  const navigate = useNavigate();
  const { isLoggedIn } = useAuthSession();
  const [pageReady, setPageReady] = useState(false);
  const [email, setEmail] = useState('');
  const [otpDigits, setOtpDigits] = useState(['', '', '', '', '', '']);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState('request'); // 'request' or 'verify'
  const [error, setError] = useState('');
  const otpInputsRef = useRef([]);

  useEffect(() => {
    setPageReady(true);
  }, []);

  useEffect(() => {
    if (isLoggedIn) {
      navigate('/', { replace: true });
    }
  }, [isLoggedIn, navigate]);

  async function handleSendOtp(event) {
    event.preventDefault();
    setError('');

    if (!email.trim()) {
      setError('Please enter your email');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Please enter a valid email address');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to send OTP');
      }
      toast(payload.message || 'OTP sent to your email!');
      setStage('verify');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleResetPassword(event) {
    event.preventDefault();
    setError('');
    const fullOtp = otpDigits.join('');
    if (fullOtp.length !== 6) {
      setError('Please enter the full OTP');
      return;
    }
    if (!newPassword) {
      setError('Please enter a new password');
      return;
    }
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          otp: fullOtp,
          newPassword
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to reset password');
      }
      toast(payload.message || 'Password reset successfully!', 'success');
      navigate('/login');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (!pageReady) {
    return <AuthPageSkeleton />;
  }

  return (
    <AuthPageLayout
      title="Reset Password"
      subtitle=""
      altLabel="Remember your password?"
      altAction="Login"
      altHref="/login"
    >
      {stage === 'request' ? (
        <form className="space-y-4" onSubmit={handleSendOtp}>
          <div>
            <label className="mb-2 block text-sm font-medium text-[#d7d7d7]">Email Address</label>
            <input
              autoComplete="email"
              className="h-11 w-full rounded-2xl border border-white/10 bg-[#181818] px-4 text-white outline-none transition-colors placeholder:text-[#6f6f6f] focus:border-white/20"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Enter your registered email"
              type="email"
            />
          </div>
          {error ? <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div> : null}
          <button
            type="submit"
            disabled={loading}
            className="inline-flex h-11 w-full items-center justify-center rounded-full bg-white text-[15px] font-semibold text-black transition-colors hover:bg-[#e5e5e5] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Sending OTP...' : 'Send Reset Code'}
          </button>
        </form>
      ) : (
        <form className="space-y-4" onSubmit={handleResetPassword}>
          <div>
            <p className="mb-4 text-sm text-[#9f9f9f]">Enter the 6-digit OTP sent to <strong>{email}</strong> and choose your new password.</p>
          </div>
          <div className="grid grid-cols-6 gap-2">
            {otpDigits.map((digit, index) => (
              <input
                key={index}
                ref={(element) => { otpInputsRef.current[index] = element; }}
                maxLength={1}
                value={digit}
                onChange={(event) => {
                  const value = event.target.value.replace(/\D/g, '').slice(-1);
                  setOtpDigits((current) => {
                    const next = [...current];
                    next[index] = value;
                    return next;
                  });
                  if (value && otpInputsRef.current[index + 1]) {
                    otpInputsRef.current[index + 1].focus();
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Backspace' && !otpDigits[index] && otpInputsRef.current[index - 1]) {
                    otpInputsRef.current[index - 1].focus();
                  }
                }}
                className="aspect-square w-full rounded-md border border-white/20 bg-[#ffffff] text-center text-lg font-medium text-black focus:outline-none focus:ring-1 focus:ring-white/40"
                inputMode="numeric"
              />
            ))}
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-[#d7d7d7]">New Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                className="h-11 w-full rounded-2xl border border-white/10 bg-[#181818] pl-4 pr-11 text-white outline-none transition-colors placeholder:text-[#6f6f6f] focus:border-white/20"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                placeholder="Enter new password"
              />
              <button
                type="button"
                className="absolute inset-y-0 right-3 flex items-center text-[#6f6f6f] hover:text-white transition-colors"
                onClick={() => setShowPassword(!showPassword)}
              >
                <i className={`fa-regular ${showPassword ? 'fa-eye-slash' : 'fa-eye'} text-[15px]`}></i>
              </button>
            </div>
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-[#d7d7d7]">Confirm New Password</label>
            <div className="relative">
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                className="h-11 w-full rounded-2xl border border-white/10 bg-[#181818] pl-4 pr-11 text-white outline-none transition-colors placeholder:text-[#6f6f6f] focus:border-white/20"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Confirm new password"
              />
              <button
                type="button"
                className="absolute inset-y-0 right-3 flex items-center text-[#6f6f6f] hover:text-white transition-colors"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              >
                <i className={`fa-regular ${showConfirmPassword ? 'fa-eye-slash' : 'fa-eye'} text-[15px]`}></i>
              </button>
            </div>
          </div>
          {error ? <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div> : null}
          <button
            type="submit"
            disabled={loading}
            className="inline-flex h-11 w-full items-center justify-center rounded-full bg-white text-[15px] font-semibold text-black transition-colors hover:bg-[#e5e5e5] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Resetting Password...' : 'Reset Password'}
          </button>
          <button
            type="button"
            className="inline-flex h-11 w-full items-center justify-center rounded-full bg-white/10 text-[15px] font-semibold text-white transition-colors hover:bg-white/15"
            onClick={() => setStage('request')}
          >
            Back
          </button>
        </form>
      )}
    </AuthPageLayout>
  );
}

function RegisterPage() {
  const navigate = useNavigate();
  const { isLoggedIn } = useAuthSession();
  const [pageReady, setPageReady] = useState(false);
  const [fullName, setFullName] = useSessionState('auth:register:fullName', '');
  const [username, setUsername] = useSessionState('auth:register:username', '');
  const [email, setEmail] = useSessionState('auth:register:email', '');
  const [password, setPassword] = useSessionState('auth:register:password', '');
  const [confirmPassword, setConfirmPassword] = useSessionState('auth:register:confirmPassword', '');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [usernameState, setUsernameState] = useState({ checking: false, available: null, message: '' });
  const [otpStage, setOtpStage] = useSessionState('auth:register:otpStage', false);
  const [otpDigits, setOtpDigits] = useSessionState('auth:register:otpDigits', ['', '', '', '', '', '']);
  const [otpError, setOtpError] = useState('');
  const [otpSending, setOtpSending] = useState(false);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [emailOwnership, setEmailOwnership] = useSessionState('auth:register:emailOwnership', false);
  const [termsAgreement, setTermsAgreement] = useSessionState('auth:register:termsAgreement', false);
  const [resendCountdown, setResendCountdown] = useSessionState('auth:register:resendCountdown', 0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const usernameCheckTimerRef = useRef(null);
  const otpInputsRef = useRef([]);

  useEffect(() => {
    setPageReady(true);
  }, []);

  function openRegisterPolicy(path) {
    navigate(path, {
      state: {
        from: '/register',
        preserveRegisterState: true
      }
    });
  }

  useEffect(() => {
    if (isLoggedIn) {
      navigate('/', { replace: true });
    }
  }, [isLoggedIn, navigate]);

  useEffect(() => {
    const trimmed = username.trim();
    if (usernameCheckTimerRef.current) {
      window.clearTimeout(usernameCheckTimerRef.current);
    }

    if (trimmed.length < 3) {
      setUsernameState({ checking: false, available: null, message: '' });
      return undefined;
    }

    setUsernameState((current) => ({ ...current, checking: true, message: '' }));
    usernameCheckTimerRef.current = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/auth/check-username?username=${encodeURIComponent(trimmed)}`);
        const payload = await response.json().catch(() => ({}));
        setUsernameState({
          checking: false,
          available: Boolean(payload.available),
          message: payload.message || ''
        });
      } catch {
        setUsernameState({ checking: false, available: null, message: '' });
      }
    }, 500);

    return () => {
      if (usernameCheckTimerRef.current) {
        window.clearTimeout(usernameCheckTimerRef.current);
      }
    };
  }, [username]);

  useEffect(() => {
    if (!resendCountdown) return undefined;
    const timer = window.setInterval(() => {
      setResendCountdown((current) => (current > 0 ? current - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendCountdown]);

  function passwordStrength(passwordValue) {
    let strength = 0;
    if (passwordValue.length >= 8) strength++;
    if (/[a-z]/.test(passwordValue) && /[A-Z]/.test(passwordValue)) strength++;
    if (/[0-9]/.test(passwordValue)) strength++;
    if (/[^a-zA-Z0-9]/.test(passwordValue)) strength++;
    return strength;
  }

  async function requestOtp() {
    setOtpSending(true);
    setError('');
    try {
      const response = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          username: username.trim(),
          fullName: fullName.trim()
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to send OTP');
      }
      setOtpStage(true);
      setOtpError('');
      setResendCountdown(30);
      if (payload.otp) {
        toast(`Dev OTP: ${payload.otp}`, 'info');
      } else {
        toast(payload.message || 'OTP sent successfully');
      }
    } catch (submitError) {
      setError(submitError.message || 'Failed to send OTP');
    } finally {
      setOtpSending(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');

    if (!fullName.trim() || !username.trim() || !email.trim() || !password || !confirmPassword) {
      setError('Please fill in all fields');
      return;
    }
    if (usernameState.available === false) {
      setError('Username is already taken');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Please enter a valid email address');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    if (!termsAgreement) {
      setError('Please agree to the Terms of Service and Privacy Policy');
      return;
    }

    setLoading(true);
    try {
      await requestOtp();
    } catch (submitError) {
      setError(submitError.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp(event) {
    event.preventDefault();
    setOtpError('');
    const otp = otpDigits.join('');
    if (otp.length !== 6) {
      setOtpError('Please enter the full OTP');
      return;
    }
    if (!emailOwnership || !termsAgreement) {
      setOtpError('Please complete both confirmations');
      return;
    }

    setVerifyLoading(true);
    try {
      const response = await fetch('/api/auth/verify-otp-and-register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          username: username.trim(),
          password,
          otp,
          fullName: fullName.trim()
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || 'OTP verification failed');
      }

      saveAuthSession(payload.token, payload.user);
      sessionStorage.removeItem('auth:register:fullName');
      sessionStorage.removeItem('auth:register:username');
      sessionStorage.removeItem('auth:register:email');
      sessionStorage.removeItem('auth:register:password');
      sessionStorage.removeItem('auth:register:confirmPassword');
      sessionStorage.removeItem('auth:register:otpStage');
      sessionStorage.removeItem('auth:register:otpDigits');
      sessionStorage.removeItem('auth:register:emailOwnership');
      sessionStorage.removeItem('auth:register:termsAgreement');
      sessionStorage.removeItem('auth:register:resendCountdown');
      if (window.CollectionStore?.invalidate) window.CollectionStore.invalidate();
      if (window.CollectionStore?.syncCollections) window.CollectionStore.syncCollections().catch(() => {});
      toast(payload.message || 'Account created successfully!');
      navigate('/', { replace: true });
    } catch (verifyError) {
      setOtpError(verifyError.message || 'OTP verification failed');
    } finally {
      setVerifyLoading(false);
    }
  }

  if (!pageReady) {
    return <AuthPageSkeleton />;
  }

  return (
    <AuthPageLayout
      title="Create Account"
      subtitle=""
      altLabel="Already have an account?"
      altAction="Login"
      altHref="/login"
    >
      {!otpStage ? (
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <label className="mb-2 block text-sm font-medium text-[#d7d7d7]">Full Name</label>
          <input
            autoComplete="name"
            className="h-11 w-full rounded-2xl border border-white/10 bg-[#181818] px-4 text-white outline-none transition-colors placeholder:text-[#6f6f6f] focus:border-white/20"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            placeholder="Enter your full name"
          />
        </div>
        <div>
          <label className="mb-2 block text-sm font-medium text-[#d7d7d7]">Username</label>
          <div className="relative">
            <input
              autoComplete="username"
              className="h-11 w-full rounded-2xl border border-white/10 bg-[#181818] px-4 pr-11 text-white outline-none transition-colors placeholder:text-[#6f6f6f] focus:border-white/20"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="Choose a username"
            />
            <div className="absolute inset-y-0 right-3 flex items-center">
              {usernameState.checking ? <span className="inline-block h-4 w-4 rounded-full border-2 border-white/20 border-t-white animate-spin"></span> : null}
              {!usernameState.checking && usernameState.available === true ? <span className="text-[#22c55e] text-lg">{"\u2713"}</span> : null}
              {!usernameState.checking && usernameState.available === false ? <span className="text-[#ef4444] text-lg">{"\u2717"}</span> : null}
            </div>
          </div>
        </div>
        <div>
          <label className="mb-2 block text-sm font-medium text-[#d7d7d7]">Email</label>
          <input
            autoComplete="email"
            className="h-11 w-full rounded-2xl border border-white/10 bg-[#181818] px-4 text-white outline-none transition-colors placeholder:text-[#6f6f6f] focus:border-white/20"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Enter your email"
            type="email"
          />
        </div>
        <div>
          <label className="mb-2 block text-sm font-medium text-[#d7d7d7]">Password</label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              className="h-11 w-full rounded-2xl border border-white/10 bg-[#181818] pl-4 pr-11 text-white outline-none transition-colors placeholder:text-[#6f6f6f] focus:border-white/20"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Create a password"
            />
            <button
              type="button"
              className="absolute inset-y-0 right-3 flex items-center text-[#6f6f6f] hover:text-white transition-colors"
              onClick={() => setShowPassword(!showPassword)}
            >
              <i className={`fa-regular ${showPassword ? 'fa-eye-slash' : 'fa-eye'} text-[15px]`}></i>
            </button>
          </div>
          {password ? (
            <div className="mt-2">
              <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    passwordStrength(password) <= 1 ? 'bg-[#ef4444] w-1/3' : passwordStrength(password) === 2 ? 'bg-[#f59e0b] w-2/3' : 'bg-[#22c55e] w-full'
                  }`}
                ></div>
              </div>
            </div>
          ) : null}
        </div>
        <div>
          <label className="mb-2 block text-sm font-medium text-[#d7d7d7]">Confirm Password</label>
          <div className="relative">
            <input
              type={showConfirmPassword ? 'text' : 'password'}
              autoComplete="new-password"
              className="h-11 w-full rounded-2xl border border-white/10 bg-[#181818] pl-4 pr-11 text-white outline-none transition-colors placeholder:text-[#6f6f6f] focus:border-white/20"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="Confirm password"
            />
            <button
              type="button"
              className="absolute inset-y-0 right-3 flex items-center text-[#6f6f6f] hover:text-white transition-colors"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
            >
              <i className={`fa-regular ${showConfirmPassword ? 'fa-eye-slash' : 'fa-eye'} text-[15px]`}></i>
            </button>
          </div>
        </div>
        <label className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm leading-6 text-[#d3d3d3]">
          <input
            type="checkbox"
            checked={termsAgreement}
            onChange={(event) => setTermsAgreement(event.target.checked)}
            className="mt-1"
          />
          <span>
            I agree to the{' '}
            <button
              type="button"
              className="font-medium text-white hover:underline"
              onClick={() => openRegisterPolicy('/terms-of-service')}
            >
              Terms of Service
            </button>{' '}
            and{' '}
            <button
              type="button"
              className="font-medium text-white hover:underline"
              onClick={() => openRegisterPolicy('/privacy-policy')}
            >
              Privacy Policy
            </button>
            .
          </span>
        </label>
        {error ? <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div> : null}
        <button
          type="submit"
          disabled={loading || usernameState.available === false || usernameState.checking || !termsAgreement}
          className="inline-flex h-11 w-full items-center justify-center rounded-full bg-white text-[15px] font-semibold text-black transition-colors hover:bg-[#e5e5e5] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading || otpSending ? 'Sending OTP...' : 'Create Account'}
        </button>
      </form>
      ) : (
      <form className="space-y-4" onSubmit={handleVerifyOtp}>
        <div>
          <h3 className="text-xl font-semibold text-white text-center">Verify OTP</h3>
          <p className="mt-2 text-center text-sm text-[#9f9f9f]">Enter the OTP sent to {email}</p>
        </div>
        <div className="grid grid-cols-6 gap-2">
          {otpDigits.map((digit, index) => (
            <input
              key={index}
              ref={(element) => { otpInputsRef.current[index] = element; }}
              maxLength={1}
              value={digit}
              onChange={(event) => {
                const value = event.target.value.replace(/\D/g, '').slice(-1);
                setOtpDigits((current) => {
                  const next = [...current];
                  next[index] = value;
                  return next;
                });
                if (value && otpInputsRef.current[index + 1]) {
                  otpInputsRef.current[index + 1].focus();
                }
              }}
              onKeyDown={(event) => {
                if (event.key === 'Backspace' && !otpDigits[index] && otpInputsRef.current[index - 1]) {
                  otpInputsRef.current[index - 1].focus();
                }
              }}
              className="aspect-square w-full rounded-md border border-white/20 bg-[#ffffff] text-center text-lg font-medium text-black focus:outline-none focus:ring-1 focus:ring-white/40"
              inputMode="numeric"
            />
          ))}
        </div>
        <label className="flex items-start gap-2 text-sm text-white">
          <input type="checkbox" checked={emailOwnership} onChange={(event) => setEmailOwnership(event.target.checked)} className="mt-1" />
          <span>I confirm this email belongs to me and I have permission to use it for registration.</span>
        </label>
        {otpError ? <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{otpError}</div> : null}
        <button
          type="button"
          disabled={resendCountdown > 0}
          className="w-full text-sm text-white/80 hover:underline disabled:no-underline disabled:text-white/35"
          onClick={async () => {
            await requestOtp();
          }}
        >
          {resendCountdown > 0 ? `Resend OTP in ${resendCountdown}s` : 'Resend OTP'}
        </button>
        <button
          type="submit"
          disabled={verifyLoading}
          className="inline-flex h-11 w-full items-center justify-center rounded-full bg-gradient-to-r from-[#B048FF] to-[#8F44F0] text-[15px] font-semibold text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {verifyLoading ? 'Verifying OTP...' : 'Verify OTP'}
        </button>
        <button
          type="button"
          className="inline-flex h-11 w-full items-center justify-center rounded-full bg-white/10 text-[15px] font-semibold text-white transition-colors hover:bg-white/15"
          onClick={() => {
            setOtpStage(false);
            setOtpDigits(['', '', '', '', '', '']);
            setOtpError('');
          }}
        >
          Back
        </button>
      </form>
      )}
    </AuthPageLayout>
  );
}


const SESSION_SCRAPED = new Set();

const PLAYER_SOURCE_SLOTS = [
  { id: 'h1', key: 'smwh', label: 'H1' },
  { id: 'h2', key: 'rpmshre', label: 'H2' },
  { id: 'h3', key: 'upnshr', label: 'H3' },
  { id: 'h4', key: 'strmp2', label: 'H4' },
  { id: 'h5', key: 'flls', label: 'H5' },
  { id: 'videasy', match: (source) => sourceKeyText(source).includes('videasy') || sourceKeyText(source).includes('vid-easy'), label: 'VIDEASY' },
  { id: 'vidfast', match: (source) => sourceKeyText(source).includes('vidfast'), label: 'vidfast' },
  { id: 'youtube', match: (source) => sourceKeyText(source).includes('youtube'), label: 'YouTube' }
];

function sourceKeyText(source = {}) {
  return `${source.id || ''} ${source.key || ''} ${source.label || ''}`.toLowerCase();
}

function firstPlayableUrl(source) {
  if (!source) return '';
  if (source.url) return source.url;
  if (Array.isArray(source.urls)) return source.urls.find(Boolean) || '';
  return '';
}

function buildPlayerSourceSlots(incomingSources = [], fallbackSources = []) {
  const pool = [...incomingSources, ...fallbackSources].filter(Boolean);
  const used = new Set();

  return PLAYER_SOURCE_SLOTS.map((slot) => {
    const foundIndex = pool.findIndex((source, index) => {
      if (used.has(index)) return false;
      if (slot.key && (source.key === slot.key || source.id === slot.key)) return true;
      return slot.match ? slot.match(source) : false;
    });
    const found = foundIndex >= 0 ? pool[foundIndex] : null;
    if (foundIndex >= 0) used.add(foundIndex);

    const url = firstPlayableUrl(found);
    return {
      ...(found || {}),
      id: found?.id || slot.id,
      key: found?.key || slot.key || slot.id,
      label: slot.label,
      url,
      urls: found?.urls || (url ? [url] : []),
      embeddable: found?.embeddable !== false,
      pending: Boolean(found?.pending),
      disabled: Boolean(found?.pending) || !url
    };
  });
}

const isAndroidApp = () => {
  return typeof window !== 'undefined' && 
         window.Capacitor !== undefined && 
         window.Capacitor.getPlatform() === 'android';
};

const setNativeScale = async (scale) => {
  if (isAndroidApp()) {
    try {
      const { Capacitor } = window;
      if (Capacitor && Capacitor.registerPlugin) {
        const ZoomPlugin = Capacitor.registerPlugin('ZoomPlugin');
        if (ZoomPlugin) {
          await ZoomPlugin.setScale({ scale });
        }
      }
    } catch (e) {
      console.log('ZoomPlugin error:', e);
    }
  }
};

class PlayerErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error("Player Error:", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 z-[9999] bg-black text-red-500 p-8 flex flex-col items-center justify-center">
          <h2 className="text-2xl font-bold mb-4">Player Error</h2>
          <p className="text-white font-mono bg-red-900/20 p-4 rounded">{String(this.state.error?.message || this.state.error)}</p>
          <pre className="mt-4 text-xs text-gray-400">{String(this.state.error?.stack)}</pre>
          <button className="mt-8 px-4 py-2 bg-white text-black rounded" onClick={() => this.props.onClose()}>Close Player</button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function VideoPlayerModal({ request, onClose }) {
  if (!request?.tmdbId) return null;
  const [hindiSources, setHindiSources] = useState([]);
  const [activeUrl, setActiveUrl] = useState('');
  const [sourceSignature, setSourceSignature] = useState('');
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [draggingPlayer, setDraggingPlayer] = useState(false);
  const [iframeReloadKey, setIframeReloadKey] = useState(0);
  const [scale, setScale] = useState(1.0);
  const [sourceState, setSourceState] = useState({
    loading: false,
    cacheHit: false,
    error: ''
  });
  const iframeRef = useRef(null);

  useEffect(() => {
    // No-op timer removed
  }, [request]);
  const playerBoxRef = useRef(null);
  const dragStateRef = useRef(null);
  const isDesktopViewport = typeof window !== 'undefined' ? window.innerWidth >= 768 : true;
  const isAndroidViewport = !isDesktopViewport;
  const modalPadding = 16;
  const controlsHeight = 52;
  const verticalInset = isDesktopViewport ? 10 : 36;
  const chromeAllowance = isDesktopViewport ? 112 : 112;
  const widthLimit = isDesktopViewport ? '99vw' : '96vw';
  const maxPlayerWidth = isDesktopViewport ? '1760px' : '1400px';
  const fallbackSources = Array.isArray(request?.fallbackSources)
    ? request.fallbackSources.filter((source) => source?.url)
    : [];

  useEffect(() => {
    setHindiSources([]);
    setActiveUrl('');
    setSourceSignature('');
    setIframeReloadKey(0);
    setDragOffset({ x: 0, y: 0 });
    setDraggingPlayer(false);
    dragStateRef.current = null;
    setScale(1.0);
    setNativeScale(1.0);
  }, [request]);

  useEffect(() => {
    return () => {
      setNativeScale(1.0); // Reset scale on unmount
    };
  }, []);

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const previousHtmlOverflow = html.style.overflow;
    const previousBodyOverflow = body.style.overflow;
    const previousBodyOverscroll = body.style.overscrollBehavior;
    const previousHtmlOverscroll = html.style.overscrollBehavior;

    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    html.style.overscrollBehavior = 'none';
    body.style.overscrollBehavior = 'none';

    const preventPageScroll = (event) => {
      const modal = playerBoxRef.current?.closest('[data-player-modal]');
      if (!modal) return;
      if (event.target?.closest?.('[data-player-modal]')) return;
      event.preventDefault();
    };

    window.addEventListener('wheel', preventPageScroll, { passive: false, capture: true });
    window.addEventListener('touchmove', preventPageScroll, { passive: false, capture: true });

    return () => {
      html.style.overflow = previousHtmlOverflow;
      body.style.overflow = previousBodyOverflow;
      html.style.overscrollBehavior = previousHtmlOverscroll;
      body.style.overscrollBehavior = previousBodyOverscroll;
      window.removeEventListener('wheel', preventPageScroll, { capture: true });
      window.removeEventListener('touchmove', preventPageScroll, { capture: true });
    };
  }, []);

  const handleToggleZoom = () => {
    setScale((prev) => {
      const next = prev === 1.0 ? 1.15 : prev === 1.15 ? 1.3 : 1.0;
      setNativeScale(next); // Sync to Android native fullscreen
      return next;
    });
  };

  const getZoomLabel = () => {
    if (scale === 1.0) return 'Zoom: Fit';
    if (scale === 1.15) return 'Zoom: Fill';
    return 'Zoom: Crop';
  };

  useEffect(() => {
    const handleFullscreenChange = async () => {
      const fsElement = document.fullscreenElement || document.webkitFullscreenElement;
      
      // Handle screen orientation for Capacitor Android app
      if (Capacitor.isNativePlatform()) {
        try {
          if (fsElement) {
            await ScreenOrientation.unlock();
          } else {
            await ScreenOrientation.lock({ type: 'portrait' });
          }
        } catch (e) {
          console.error('Screen orientation error', e);
        }
      }

      if (fsElement && fsElement === iframeRef.current) {
        fsElement.style.transform = scale !== 1.0 ? `scale(${scale})` : 'none';
        fsElement.style.transformOrigin = 'center center';
        fsElement.style.width = '100vw';
        fsElement.style.height = '100vh';
        fsElement.style.overflow = 'hidden';
        fsElement.style.backgroundColor = 'black'; // Ensure black background in fullscreen
      } else if (iframeRef.current) {
        iframeRef.current.style.transform = scale !== 1.0 ? `scale(${scale})` : 'none';
        iframeRef.current.style.transformOrigin = 'center center';
        iframeRef.current.style.width = '100%';
        iframeRef.current.style.height = '100%';
        iframeRef.current.style.overflow = '';
        iframeRef.current.style.backgroundColor = '';
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

    // Call it immediately in case fullscreen was already active
    handleFullscreenChange();

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      
      // Always lock to portrait when player unmounts
      if (Capacitor.isNativePlatform()) {
        ScreenOrientation.lock({ type: 'portrait' }).catch(console.error);
      }
    };
  }, [scale]);

  useEffect(() => {
    let ignore = false;
    const params = new URLSearchParams({
      mediaType: request.mediaType,
      tmdbId: String(request.tmdbId)
    });

    if (request.imdbId) params.set('imdbId', request.imdbId);
    if (request.mediaType === 'series') {
      params.set('seasonNumber', String(request.seasonNumber || 1));
      params.set('episodeNumber', String(request.episodeNumber || 1));
    }

    setSourceState({
      loading: true,
      cacheHit: false,
      error: ''
    });

    const applyPayload = (payload, { resetActive = false } = {}) => {
      const nextSources = Array.isArray(payload?.sources)
        ? payload.sources.filter((source) => source?.url || source?.pending)
        : [];
      const resolvedSources = [...nextSources, ...fallbackSources];
      const nextSignature = JSON.stringify({
        updatedAt: payload?.updatedAt || '',
        urls: resolvedSources.map((source) => source?.url || '')
      });

      setHindiSources(nextSources);
      setSourceSignature(nextSignature);
      setActiveUrl((current) => {
        // If we already have a working source playing, DO NOT switch it
        if (current && resolvedSources.some((s) => s.url === current)) {
          return current;
        }

        // Otherwise, find the best default source
        const playable = resolvedSources.filter(s => s.url);
        if (!playable.length) return '';

        // Priority 1: Videasy
        const videasy = playable.find(s => {
          const l = s.label?.toLowerCase() || '';
          return l.includes('videasy') || l.includes('vid-easy') || s.id?.includes('videasy');
        });
        if (videasy) return videasy.url;

        // Priority 2: YouTube
        const youtube = playable.find(s => {
          const l = s.label?.toLowerCase() || '';
          return l.includes('youtube') || s.id?.includes('youtube');
        });
        if (youtube) return youtube.url;

        // Fallback: First available
        return playable[0].url;
      });


      setSourceState({
        loading: false,
        cacheHit: Boolean(payload?.cacheHit),
        scraping: Boolean(payload?.scraping),
        notAvailable: Boolean(payload?.notAvailable),
        error: nextSources.some(s => s.url) || fallbackSources.length ? '' : 'No player sources found.'
      });

    };


    let pollAttempt = 0;
    const MAX_POLL_ATTEMPTS = 30; // 30 Ãƒâ€” 4s = 120s max wait for a scrape

    const fetchSources = async (isManualRefresh = false) => {
      if (ignore) return;
      const sessionKey = `${params.get('tmdbId')}-${params.get('seasonNumber') || '0'}-${params.get('episodeNumber') || '0'}`;
      try {
        const queryParams = new URLSearchParams(params);
        if (isManualRefresh) {
          queryParams.set('refresh', '1');
        }

        let payload;
        try {
          payload = await apiFetch(`/api/player/sources?${queryParams.toString()}`);
        } catch (fetchError) {
          if (ignore) return;
          // 503 = TMDB down but backend may still scrape via fallback Ã¢â‚¬â€ keep polling
          if (fetchError?.status === 503 && pollAttempt < MAX_POLL_ATTEMPTS) {
            pollAttempt++;
            setSourceState((prev) => ({
              ...prev,
              loading: false,
              scraping: true,
              error: ''
            }));
            setTimeout(() => !ignore && fetchSources(false), 4000);
            return;
          }
          // Hard failure Ã¢â‚¬â€ show error but don't hide fallback sources
          setSourceState({
            loading: false,
            cacheHit: false,
            scraping: false,
            error: fallbackSources.length ? '' : fetchError?.message || 'Failed to load sources.'
          });
          return;
        }

        if (ignore) return;

        applyPayload(payload);

        if (payload?.scraping && pollAttempt < MAX_POLL_ATTEMPTS) {
          // Backend is still scraping Ã¢â‚¬â€ keep polling until it finishes or we hit the limit
          pollAttempt++;
          setTimeout(() => !ignore && fetchSources(false), 4000);
        } else {
          SESSION_SCRAPED.add(sessionKey);
        }
      } catch (error) {
        if (ignore) return;
        setSourceState({
          loading: false,
          cacheHit: false,
          scraping: false,
          error: fallbackSources.length ? '' : error?.message || 'Failed to load sources.'
        });
      }
    };


    fetchSources();

    return () => {
      ignore = true;
    };
  }, [request]);

  // legacySources removed Ã¢â‚¬â€ buildPlayerSourceSlots covers all 8 fixed slots.

  const sources = useMemo(() => buildPlayerSourceSlots(hindiSources, fallbackSources), [hindiSources, fallbackSources]);

  // Auto-select a default source whenever sources load and nothing is playing yet.
  // Priority: VIDEASY Ã¢â€ â€™ YouTube Ã¢â€ â€™ first available.
  useEffect(() => {
    setActiveUrl((current) => {
      if (current && sources.some((s) => s.url === current)) return current;
      const playable = sources.filter((s) => s.url);
      if (!playable.length) return current;
      const videasy = playable.find((s) =>
        s.id?.toLowerCase().includes('videasy') || s.label?.toLowerCase().includes('videasy')
      );
      if (videasy) return videasy.url;
      const youtube = playable.find((s) =>
        s.id?.toLowerCase().includes('youtube') || s.label?.toLowerCase().includes('youtube')
      );
      if (youtube) return youtube.url;
      return playable[0].url;
    });
  }, [sources]);

  const activeSource = sources.find((source) => source.url === activeUrl) || sources.find((source) => source.url) || sources[0];
  const availableSources = useMemo(() => sources.filter((source) => source?.url), [sources]);


  const canUseVideoJs = isDirectMediaUrl(activeUrl);

  useEffect(() => {
    if (activeUrl) {
      console.log('[Soulstash Player Debug] Rendering player for URL:', activeUrl, '| VideoJS:', canUseVideoJs);
    }
  }, [activeUrl, canUseVideoJs]);
  const canEmbedSource = canUseVideoJs || activeSource?.embeddable !== false;
  const availableHeight = `calc(100dvh - ${modalPadding * 2 + verticalInset * 2}px)`;
  const mediaHeight = `calc(${availableHeight} - ${chromeAllowance - 18}px)`;
  const videoBoxStyle = {
    width: `min(${widthLimit}, ${maxPlayerWidth}, calc(${mediaHeight} * 16 / 9))`,
    maxHeight: availableHeight,
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column'
  };
  const mediaAreaStyle = {
    width: '100%',
    aspectRatio: '16 / 9',
    maxHeight: mediaHeight
  };
  const baseVerticalShift = isDesktopViewport ? -10 : -20;
  const sourceButtonClass = isAndroidViewport
    ? 'shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold transition-colors'
    : 'shrink-0 rounded-full px-3 py-1.5 text-[11px] font-semibold transition-colors sm:text-xs';
  const actionButtonClass = isAndroidViewport
    ? 'rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-medium text-white hover:bg-white/20 transition-colors disabled:cursor-not-allowed disabled:opacity-40'
    : 'rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-white/20 transition-colors sm:text-xs disabled:cursor-not-allowed disabled:opacity-40';
  const iconButtonClass = isAndroidViewport
    ? 'flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors disabled:cursor-not-allowed disabled:opacity-40'
    : 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors disabled:cursor-not-allowed disabled:opacity-40';

  const getZoomIcon = () => {
    if (scale === 1.0) return 'fas fa-compress';
    if (scale === 1.15) return 'fas fa-expand';
    return 'fas fa-expand-arrows-alt';
  };

  const handleSwitchSource = () => {
    if (!availableSources.length) return;
    const currentIndex = availableSources.findIndex((source) => source.url === activeUrl);
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % availableSources.length : 0;
    setActiveUrl(availableSources[nextIndex]?.url || '');
    setIframeReloadKey(0);
  };

  const reloadActiveSource = useCallback(() => {
    if (!activeUrl) return;
    setIframeReloadKey((current) => current + 1);
  }, [activeUrl]);

  // No automatic exit-fullscreen reload, preventing stream restart

  const settlePlayerPosition = useCallback((currentOffset) => {
    const playerNode = playerBoxRef.current;
    if (!playerNode || typeof window === 'undefined') {
      setDragOffset({ x: 0, y: currentOffset?.y || 0 });
      return;
    }

    const rect = playerNode.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const edgePadding = 12;
    let nextY = currentOffset?.y || 0;

    if (rect.top < edgePadding) {
      nextY += edgePadding - rect.top;
    } else if (rect.bottom > viewportHeight - edgePadding) {
      nextY -= rect.bottom - (viewportHeight - edgePadding);
    }

    setDragOffset({ x: 0, y: nextY });
  }, []);

  const stopPlayerDrag = useCallback(() => {
    const dragState = dragStateRef.current;
    if (!dragState) return;
    dragStateRef.current = null;
    setDraggingPlayer(false);
    settlePlayerPosition(dragState.lastOffset || dragOffset);
  }, [dragOffset, settlePlayerPosition]);

  const handlePlayerPointerDown = useCallback((event) => {
    if (!isAndroidViewport || event.pointerType !== 'touch') return;
    if (!event.target.closest('[data-player-drag-handle]')) return;
    if (event.target.closest('button, a')) return;
    // Don't preventDefault here Ã¢â‚¬â€ wait for movement threshold so taps
    // pass through to the iframe for play/pause controls.

    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startOffsetX: dragOffset.x,
      startOffsetY: dragOffset.y,
      lastOffset: dragOffset,
      activated: false
    };
  }, [dragOffset, isAndroidViewport]);

  useEffect(() => {
    if (!isAndroidViewport) return undefined;

    const handlePointerMove = (event) => {
      const dragState = dragStateRef.current;
      if (!dragState || event.pointerId !== dragState.pointerId) return;

      const dx = event.clientX - dragState.startX;
      const dy = event.clientY - dragState.startY;

      // Activate drag only after movement exceeds threshold.
      // This lets quick taps pass through to the iframe.
      if (!dragState.activated) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        dragState.activated = true;
        setDraggingPlayer(true);
      }

      event.preventDefault();
      const nextOffset = {
        x: dragState.startOffsetX + dx,
        y: dragState.startOffsetY + dy
      };
      dragState.lastOffset = nextOffset;
      setDragOffset(nextOffset);
    };

    const handlePointerEnd = (event) => {
      const dragState = dragStateRef.current;
      if (!dragState || event.pointerId !== dragState.pointerId) return;
      if (dragState.activated) {
        stopPlayerDrag();
      } else {
        // Was a tap, not a drag. Clean up without settling.
        dragStateRef.current = null;
      }
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerEnd, true);
    window.addEventListener('pointercancel', handlePointerEnd, true);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerEnd, true);
      window.removeEventListener('pointercancel', handlePointerEnd, true);
    };
  }, [isAndroidViewport, stopPlayerDrag]);

  useEffect(() => {
    if (!activeUrl) return;
    const activeBtn = playerBoxRef.current?.querySelector('button[data-active-source="true"]');
    if (activeBtn) {
      activeBtn.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center'
      });
    }
  }, [activeUrl]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const modal = playerBoxRef.current?.closest('[data-player-modal]');
      // Only auto-focus the stream button if we are already in keyboard-nav mode
      // (i.e. the user has pressed a key before). If they opened the player with
      // a mouse click, we leave focus alone so the ring stays hidden.
      if (!modal) return;
      // Import-free check: tvNav sets html.tv-nav-active when keyboard mode is on.
      const isKeyboardNav = document.documentElement.classList.contains('tv-nav-active');
      if (!isKeyboardNav) return;
      if (modal.contains(document.activeElement)) return;
      const sourceButton =
        playerBoxRef.current?.querySelector('button[data-active-source="true"]:not(:disabled)') ||
        playerBoxRef.current?.querySelector('button[data-player-source="true"]:not(:disabled)') ||
        playerBoxRef.current?.querySelector('button[data-player-action="true"]:not(:disabled), a[data-player-action="true"]');
      if (sourceButton) {
        // Use applyFocusViaNav to properly register with the tvNav system
        sourceButton.focus({ preventScroll: true });
        sourceButton.classList.add('tv-focused');
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeUrl, sources.length]);

  return (
    <div className="pointer-events-none fixed inset-0 z-[9999] bg-transparent" data-player-modal="true">
      <div
        className="relative h-full w-full"
        style={{
          minHeight: '100dvh'
        }}
      >
        <div
          ref={playerBoxRef}
          className="pointer-events-auto absolute overflow-hidden rounded-[22px] border border-white/10 bg-black"
          style={{
            ...videoBoxStyle,
            left: '50%',
            top: '50%',
            transform: `translate(calc(-50% + ${dragOffset.x}px), calc(-50% + ${baseVerticalShift + dragOffset.y}px))`,
            transition: draggingPlayer ? 'none' : 'transform 220ms ease'
          }}
        >
            <div
              data-player-controls="true"
              data-player-drag-handle="true"
              className="flex items-center justify-between gap-3 border-b border-white/10 bg-black/80 px-3 sm:px-4"
              style={{ height: controlsHeight, touchAction: 'none' }}
              onPointerDown={handlePlayerPointerDown}
            >
            <div className="filter-scrollbar-hidden min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
              <div className="flex min-w-max items-center gap-2 pr-2">
                {sourceState.loading ? (
                  PLAYER_SOURCE_SLOTS.map((dummy) => (
                    <button
                      key={`loading-${dummy.id}`}
                      type="button"
                      disabled
                      className={`${sourceButtonClass} animate-pulse cursor-wait bg-white/5 text-white/30`}
                    >
                      {dummy.label}
                    </button>
                  ))
                ) : sources.length ? (
                  sources.map((source) => (
                    <button
                      key={source.id}
                      type="button"
                      data-player-source="true"
                      data-active-source={activeUrl === source.url}
                      aria-label={`Play stream ${source.label}`}
                      className={`${sourceButtonClass} ${
                        source.pending
                          ? 'animate-pulse cursor-wait bg-white/15 text-white/50 border-white/20'
                          : source.disabled
                          ? 'cursor-not-allowed bg-white/5 text-white/25'
                          : activeUrl === source.url
                          ? 'bg-white text-black'
                          : 'bg-white/10 text-white hover:bg-white/20'
                      }`}
                      disabled={source.disabled || source.pending}
                      onClick={() => {
                        if (!source.disabled && !source.pending) {
                          setActiveUrl(source.url);
                        }
                      }}
                    >
                      {source.label}
                    </button>
                  ))
                ) : (
                  <span className="text-[11px] font-medium text-white/50">
                    {sourceState.error || 'No source links yet.'}
                  </span>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center justify-end gap-2">
              <button
                type="button"
                data-player-action="true"
                onClick={reloadActiveSource}
                disabled={!activeUrl || canUseVideoJs}
                className={iconButtonClass}
                aria-label="Reload stream"
                title="Reload Stream"
              >
                <i className="fas fa-redo"></i>
              </button>
              {!canUseVideoJs && activeUrl && (
                <button
                  type="button"
                  data-player-action="true"
                  onClick={handleToggleZoom}
                  className={iconButtonClass}
                  aria-label={getZoomLabel()}
                  title={getZoomLabel()}
                >
                  <i className={getZoomIcon()}></i>
                </button>
              )}
              <a
                data-player-action="true"
                className={iconButtonClass}
                href={activeUrl || '#'}
                target="_blank"
                rel="noreferrer"
                aria-label="Open stream provider"
                title="Open Provider"
                onClick={(event) => {
                  if (!activeUrl) event.preventDefault();
                }}
              >
                <i className="fas fa-external-link-alt"></i>
              </a>
              <button
                type="button"
                data-player-action="true"
                onClick={onClose}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
                aria-label="Close player"
              >
                <svg xmlns="http://www.w3.org/2000/svg" height="18" viewBox="0 -960 960 960" fill="currentColor">
                  <path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/>
                </svg>
              </button>
            </div>
          </div>
          <div
            className="relative flex flex-1 items-center justify-center overflow-hidden bg-black"
            style={mediaAreaStyle}
          >
            {sourceState.loading && !activeUrl ? (
              <div className="flex h-full w-full flex-col items-center justify-center gap-6">
                <div className="batman-loader-wrapper">
                  <div className="batman-loader" />
                </div>
                <div className="animate-pulse text-sm font-medium tracking-widest text-white/40 uppercase">
                  Loading Player
                </div>
              </div>
            ) : !activeUrl ? (
              <div className="flex h-full w-full items-center justify-center px-6 text-center text-sm text-white/65">
                {sourceState.error || 'No playable source is available for this title right now.'}
              </div>
            ) : canUseVideoJs ? (
              <div className="flex h-full w-full items-center justify-center bg-black">
                <VideoJsPlayer.Provider>
                  <VideoSkin className="vjs-default-skin w-full h-full bg-black">
                    <Video 
                      key={`${sourceSignature}:${activeUrl}`} 
                      src={activeUrl} 
                      playsInline 
                      className="w-full h-full bg-black" 
                      style={{ backgroundColor: 'black' }}
                      poster="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
                    />
                  </VideoSkin>
                </VideoJsPlayer.Provider>
              </div>
            ) : !canEmbedSource ? (
              <div className="flex h-full w-full flex-col items-center justify-center gap-4 px-6 text-center">
                <p className="max-w-lg text-sm leading-6 text-white/70 sm:text-base">
                  This source opens best in a new tab.
                </p>
                <a
                  className="inline-flex items-center justify-center rounded-full bg-white px-5 py-3 text-sm font-semibold text-black transition-colors hover:bg-[#e8e8e8]"
                  href={activeUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open Provider
                </a>
              </div>
            ) : (
              <div className="relative h-full w-full">
                <iframe
                  ref={iframeRef}
                  key={`${sourceSignature}:${activeUrl}:${iframeReloadKey}`}
                  src={activeUrl}
                  tabIndex={0}
                  onLoad={() => console.log('[Soulstash Player Debug] Iframe loaded for URL:', activeUrl)}
                  onError={(e) => console.log('[Soulstash Player Debug] Iframe error for URL:', activeUrl, e)}
                  className="h-full w-full border-0 bg-black"
                  style={{
                    transform: scale !== 1.0 ? `scale(${scale})` : 'none',
                    transformOrigin: 'center center',
                    transition: 'transform 0.2s ease',
                    backgroundColor: 'black'
                  }}
                  allowFullScreen={true}
                  webkitallowfullscreen="true"
                  mozallowfullscreen="true"
                  allow="autoplay *; fullscreen *; encrypted-media *; picture-in-picture *; display-capture *"
                  referrerPolicy={activeUrl.includes('youtube.com') ? 'strict-origin-when-cross-origin' : 'no-referrer'}
                  title="Soulstash Player"
                />
                {(activeUrl.includes('youtube.com') || activeUrl.includes('youtu.be')) && (
                  <div className="absolute top-4 right-4 z-[9999]">
                    <a
                      href={activeUrl.replace('/embed/', '/watch?v=').split('&')[0]}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2 rounded-full bg-[#FF0000]/90 px-4 py-2 text-xs font-semibold text-white shadow-lg backdrop-blur hover:bg-[#FF0000] sm:text-sm"
                    >
                      <i className="fab fa-youtube text-base" />
                      <span>Open in App</span>
                    </a>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function EpisodeCard({ episode, onPlay }) {
  return (
    <article className="w-[260px] shrink-0 overflow-hidden rounded-[20px] border border-white/8 bg-white/[0.03]">
      <div className="relative aspect-video bg-[#121212] overflow-hidden group">
        <img
          src={imageUrl(episode.still_path, 'w500')}
          alt={episode.name}
          className="w-full h-full object-cover"
          onError={(event) => {
            event.currentTarget.src = FALLBACK_AVATAR;
          }}
        />
        {onPlay ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              type="button"
              onClick={() => onPlay(episode)}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm hover:bg-black/80 transition-colors"
              aria-label={`Play episode ${episode.episode_number}`}
            >
              <i className="fas fa-play translate-x-[1px] text-sm"></i>
            </button>
          </div>
        ) : null}
      </div>
      <div className="p-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-xs uppercase tracking-[0.2em] text-[#d0a4ff]">
            Episode {episode.episode_number}
          </span>
          <span className="text-xs text-[#9f9f9f]">
            {episode.runtime ? formatRuntime(episode.runtime) : (episode.air_date || 'TBA')}
          </span>
        </div>
        <h4 className="text-[15px] font-semibold leading-5 text-white">{episode.name}</h4>
        <p className="mt-2 text-[13px] leading-5 text-[#b7b7b7] line-clamp-3">
          {episode.overview || 'Episode overview is not available yet.'}
        </p>
        {onPlay ? (
          <button
            type="button"
            onClick={() => onPlay(episode)}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-white/[0.08] py-2 text-[13px] font-medium text-white hover:bg-white/[0.14] transition-colors"
          >
            <i className="fas fa-play text-[11px] translate-x-[1px]"></i>
            Watch Episode
          </button>
        ) : null}
      </div>
    </article>
  );
}

function EpisodeRowSkeleton({ count = 4 }) {
  return (
    <div className="flex gap-3 overflow-hidden animate-pulse">
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className="w-[260px] shrink-0 overflow-hidden rounded-[20px] border border-white/8 bg-white/[0.03]"
        >
          <div className="aspect-video bg-white/[0.06]"></div>
          <div className="p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="h-3 w-20 rounded bg-white/[0.08]"></div>
              <div className="h-3 w-12 rounded bg-white/[0.06]"></div>
            </div>
            <div className="h-4 w-4/5 rounded bg-white/[0.08]"></div>
            <div className="mt-2 space-y-2">
              <div className="h-3 rounded bg-white/[0.06]"></div>
              <div className="h-3 w-11/12 rounded bg-white/[0.06]"></div>
              <div className="h-3 w-2/3 rounded bg-white/[0.06]"></div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function DragScrollStrip({ className = '', children, innerClassName = '' , scrollRef = null }) {
  const localRef = useRef(null);
  const dragStateRef = useRef({
    isPointerDown: false,
    startX: 0,
    startScrollLeft: 0,
    hasDragged: false
  });

  const resolvedRef = scrollRef || localRef;

  function handlePointerDown(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const node = resolvedRef.current;
    if (!node) return;
    dragStateRef.current = {
      isPointerDown: true,
      startX: event.clientX,
      startScrollLeft: node.scrollLeft,
      hasDragged: false
    };
    node.setPointerCapture?.(event.pointerId);
  }

  function handlePointerMove(event) {
    const node = resolvedRef.current;
    const dragState = dragStateRef.current;
    if (!node || !dragState.isPointerDown) return;

    const deltaX = event.clientX - dragState.startX;
    if (Math.abs(deltaX) > 4) {
      dragState.hasDragged = true;
    }
    node.scrollLeft = dragState.startScrollLeft - deltaX;
  }

  function handlePointerUp(event) {
    const node = resolvedRef.current;
    dragStateRef.current.isPointerDown = false;
    node?.releasePointerCapture?.(event.pointerId);
  }

  function handleClickCapture(event) {
    if (!dragStateRef.current.hasDragged) return;
    event.preventDefault();
    event.stopPropagation();
    dragStateRef.current.hasDragged = false;
  }

  return (
    <div
      ref={resolvedRef}
      className={`filter-scrollbar-hidden overflow-x-auto overflow-y-hidden cursor-grab active:cursor-grabbing select-none touch-pan-x ${className}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onClickCapture={handleClickCapture}
    >
      <div className={`flex min-w-max flex-nowrap items-center gap-2 ${innerClassName}`}>
        {children}
      </div>
    </div>
  );
}

function PersonCreditsFilterControls({
  contentType,
  setContentType,
  quickFilter,
  setQuickFilter,
  collectionFilter,
  setCollectionFilter,
  sortBy,
  setSortBy,
  collectionOptions,
  resetKey,
  collectionsLoading = false
}) {
  const collectionTriggerRef = useRef(null);
  const collectionDropdownRef = useRef(null);
  const [collectionMenuOpen, setCollectionMenuOpen] = useState(false);
  const [collectionMenuStyle, setCollectionMenuStyle] = useState({});
  const sortTriggerRef = useRef(null);
  const sortDropdownRef = useRef(null);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [sortMenuStyle, setSortMenuStyle] = useState({});

  const sortOptions = [
    { value: 'rating-desc', label: 'Rating high' },
    { value: 'rating-asc', label: 'Rating low' },
    { value: 'year-desc', label: 'Year new' },
    { value: 'year-asc', label: 'Year old' }
  ];

  const activeCollectionLabel =
    collectionOptions.find((option) => option.value === collectionFilter)?.label || 'All';

  const activeSortLabel =
    sortOptions.find((option) => option.value === sortBy)?.label || 'Rating high';

  function buildMenuPosition(trigger, estimatedWidth = 220, estimatedHeight = 220) {
    if (!trigger) return {};
    const rect = trigger.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const width = Math.min(estimatedWidth, viewportWidth - 16);
    const left = Math.min(Math.max(8, rect.left), Math.max(8, viewportWidth - width - 8));
    const belowTop = rect.bottom + 6;
    const aboveTop = rect.top - estimatedHeight - 6;
    const top = belowTop + estimatedHeight <= viewportHeight - 8 || aboveTop < 8
      ? Math.min(belowTop, Math.max(8, viewportHeight - estimatedHeight - 8))
      : aboveTop;
    return {
      position: 'fixed',
      zIndex: 2147483647,
      top: `${top}px`,
      left: `${left}px`,
      width: `${width}px`,
      maxWidth: 'calc(100vw - 16px)',
      boxSizing: 'border-box'
    };
  }

  useEffect(() => {
    setCollectionMenuOpen(false);
    setSortMenuOpen(false);
  }, [resetKey]);

  useEffect(() => {
    if (!collectionMenuOpen && !sortMenuOpen) return undefined;

    function updatePosition() {
      if (collectionTriggerRef.current) {
        setCollectionMenuStyle(buildMenuPosition(collectionTriggerRef.current, 240, Math.max(180, collectionOptions.length * 42 + 16)));
      }
      if (sortTriggerRef.current) {
        setSortMenuStyle(buildMenuPosition(sortTriggerRef.current, 220, 196));
      }
    }

    function handleOutside(event) {
      if (collectionTriggerRef.current?.contains(event.target)) return;
      if (collectionDropdownRef.current?.contains(event.target)) return;
      if (sortTriggerRef.current?.contains(event.target)) return;
      if (sortDropdownRef.current?.contains(event.target)) return;
      setCollectionMenuOpen(false);
      setSortMenuOpen(false);
    }

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    document.addEventListener('mousedown', handleOutside);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      document.removeEventListener('mousedown', handleOutside);
    };
  }, [collectionMenuOpen, sortMenuOpen, collectionOptions.length]);

  return (
    <>
      <div className="flex min-w-max flex-nowrap items-center gap-2">
        {[
          { value: 'all', label: 'All', kind: 'content' },
          { value: 'movies', label: 'Movies', kind: 'content' },
          { value: 'series', label: 'Series', kind: 'content' },
          { value: 'watched', label: 'Watched', kind: 'quick' },
          { value: 'watchlist', label: 'Watchlist', kind: 'quick' }
        ].map((option) => {
          const isQuick = option.kind === 'quick';
          const requiresCollections = isQuick && option.value !== 'all';
          const disabled = collectionsLoading && requiresCollections;
          const isActive = isQuick ? quickFilter === option.value : contentType === option.value;
          return (
            <button
              key={`${option.kind}-${option.value}`}
              type="button"
              className={`inline-flex h-10 flex-shrink-0 items-center justify-center whitespace-nowrap rounded-[20px] px-4 py-0.5 text-[13px] font-medium transition-colors ${disabled ? 'cursor-not-allowed opacity-55' : ''}`}
              style={{
                color: isActive ? 'rgb(226, 226, 226)' : 'rgb(168, 168, 168)',
                backgroundColor: isActive ? 'rgb(71, 71, 71)' : 'rgb(21, 21, 21)'
              }}
              onClick={() => {
                if (disabled) return;
                if (isQuick) {
                  setCollectionFilter('');
                  setQuickFilter((current) => (current === option.value ? 'all' : option.value));
                } else {
                  setContentType((current) => (current === option.value ? 'all' : option.value));
                }
              }}
              aria-disabled={disabled}
            >
              {option.label}
            </button>
          );
        })}

        <div className="relative flex-shrink-0">
          <button
            ref={collectionTriggerRef}
            type="button"
            className={`inline-flex h-10 max-w-full items-center justify-between gap-1.5 rounded-[20px] bg-[#151515] px-3 text-[13px] font-medium text-[#d9d9d9] ${collectionsLoading ? 'cursor-not-allowed opacity-55' : ''}`}
            onClick={(event) => {
              if (collectionsLoading) return;
              setCollectionMenuStyle(buildMenuPosition(event.currentTarget, 240, Math.max(180, collectionOptions.length * 42 + 16)));
              setSortMenuOpen(false);
              setCollectionMenuOpen((current) => !current);
            }}
            title={collectionsLoading ? 'Syncing collections...' : activeCollectionLabel}
            aria-disabled={collectionsLoading}
          >
            <span className="truncate">{collectionsLoading ? 'Syncing...' : activeCollectionLabel}</span>
            <i className="fas fa-chevron-down ml-1 text-[10px] text-[#7f7f7f]"></i>
          </button>
        </div>

        <div className="relative flex-shrink-0">
          <button
            ref={sortTriggerRef}
            type="button"
            className="inline-flex h-10 max-w-full items-center justify-between gap-1.5 rounded-[20px] bg-[#151515] px-3 text-[13px] font-medium text-[#d9d9d9]"
            onClick={(event) => {
              setSortMenuStyle(buildMenuPosition(event.currentTarget, 220, 196));
              setCollectionMenuOpen(false);
              setSortMenuOpen((current) => !current);
            }}
            title={activeSortLabel}
          >
            <span className="truncate">{activeSortLabel}</span>
            <i className="fas fa-chevron-down ml-1 text-[10px] text-[#7f7f7f]"></i>
          </button>
        </div>
      </div>

      {collectionMenuOpen
        ? createPortal(
            <div
              ref={collectionDropdownRef}
              style={collectionMenuStyle}
              className="inline-flex min-w-max flex-col items-stretch rounded-[16px] border border-white/12 bg-[#111111] p-2 shadow-[0_24px_60px_rgba(0,0,0,0.55)]"
            >
              <div className="filter-scrollbar-hidden max-h-[280px] overflow-y-auto">
                {collectionOptions.map((option) => (
                  <button
                    key={option.value || 'all-collections'}
                    type="button"
                    className={`inline-flex w-full items-center gap-2 whitespace-nowrap rounded-[12px] px-3 py-2.5 text-[13px] text-left ${
                      collectionFilter === option.value ? 'bg-white/[0.08] text-white' : 'text-[#d0d0d0] hover:bg-white/[0.05]'
                    }`}
                    onClick={() => {
                      setQuickFilter('all');
                      setCollectionFilter((current) => (current === option.value ? '' : option.value));
                      setCollectionMenuOpen(false);
                    }}
                  >
                    <span className="truncate">{option.label}</span>
                  </button>
                ))}
              </div>
            </div>,
            document.body
          )
        : null}

      {sortMenuOpen
        ? createPortal(
            <div
              ref={sortDropdownRef}
              style={sortMenuStyle}
              className="inline-flex min-w-max flex-col items-stretch rounded-[16px] border border-white/12 bg-[#111111] p-2 shadow-[0_24px_60px_rgba(0,0,0,0.55)]"
            >
              {sortOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`inline-flex w-full items-center gap-2 whitespace-nowrap rounded-[12px] px-3 py-2.5 text-[13px] text-left ${
                    sortBy === option.value ? 'bg-white/[0.08] text-white' : 'text-[#d0d0d0] hover:bg-white/[0.05]'
                  }`}
                  onClick={() => {
                    setSortBy(option.value);
                    setSortMenuOpen(false);
                  }}
                >
                  <i className="fas fa-sort h-4 w-4 shrink-0 text-center"></i>
                  <span>{option.label}</span>
                </button>
              ))}
            </div>,
            document.body
          )
        : null}
    </>
  );
}

function PersonPage() {
  const { id } = useParams();
  const location = useLocation();
  const auth = useAuthSession();
  const [person, setPerson] = useState(null);
  const [credits, setCredits] = useState([]);
  const [bioExpanded, setBioExpanded] = useState(false);
  const [contentType, setContentType] = useSessionState(`person-page:${location.pathname}:contentType`, 'all');
  const [sortBy, setSortBy] = useSessionState(`person-page:${location.pathname}:sortBy`, 'year-desc');
  const [quickFilter, setQuickFilter] = useSessionState(`person-page:${location.pathname}:quickFilter`, 'all');
  const [collectionFilter, setCollectionFilter] = useSessionState(`person-page:${location.pathname}:collectionFilter`, '');
  const [userCollections, setUserCollections] = useState([]);
  const [favoritePeople, setFavoritePeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [retryTick, setRetryTick] = useState(0);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const { collections: liveCollections, loading: collectionsLoading } = useLiveCollections();
  const attemptedCreditRatingBackfillRef = useRef('');
  const availableCollections = useMemo(
    () => normalizeCollections(liveCollections.length ? liveCollections : userCollections),
    [liveCollections, userCollections]
  );
  const collectionsSyncing = !!getToken() && (collectionsLoading || availableCollections.length < 2);
  const watchedCollection = useMemo(
    () => availableCollections.find((collection) => collection.name === 'Watched') || null,
    [availableCollections]
  );
  const watchlistCollection = useMemo(
    () => availableCollections.find((collection) => collection.name === 'Watchlist') || null,
    [availableCollections]
  );
  const watchedCredits = useMemo(
    () => filterCreditsByCollectionItems(credits, watchedCollection, '[Soulstash][React][PersonPage][Watched]', !collectionsSyncing),
    [collectionsSyncing, credits, watchedCollection]
  );
  const watchlistCredits = useMemo(
    () => filterCreditsByCollectionItems(credits, watchlistCollection),
    [credits, watchlistCollection]
  );
  const customCollectionCreditMap = useMemo(() => {
    const map = new Map();
    availableCollections
      .filter((collection) => !['Watched', 'Watchlist'].includes(collection.name))
      .forEach((collection) => {
        map.set(collection.name, filterCreditsByCollectionItems(credits, collection));
      });
    return map;
  }, [availableCollections, credits]);

  useEffect(() => {
    let ignore = false;
    let retryTimeout = null;

    async function load() {
      setLoading(true);
      setLoadError('');
      try {
        const [personData, creditData] = await Promise.all([
          cachedApiFetch(`/api/person/${id}`),
          cachedApiFetch(`/api/person/${id}/credits`)
        ]);

        if (!ignore) {
          setPerson(personData);
          setCredits(
            (creditData.cast || []).filter((item) => {
              if (item.media_type !== 'movie' && item.media_type !== 'tv') return false;
              return true;
            })
          );
          setUserCollections(normalizeCollections(getCachedUserCollections()));
          setFailedAttempts(0);
          setLoadError('');
          document.title = `${personData.name} | Soulstash`;
        }
      } catch (error) {
        if (!ignore) {
          setFailedAttempts((current) => {
            const next = current + 1;
            if (next >= AUTO_RECOVERY_RETRIES) {
              setLoadError(error.message || 'Unable to load this person right now.');
            } else {
              retryTimeout = window.setTimeout(() => {
                if (!ignore) {
                  setRetryTick((currentTick) => currentTick + 1);
                }
              }, 2500);
            }
            return next;
          });
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      ignore = true;
      if (retryTimeout) {
        window.clearTimeout(retryTimeout);
      }
    };
  }, [auth.user?.admin, auth.user?.showAdult, id, retryTick]);

  useEffect(() => {
    setBioExpanded(false);
  }, [id]);

  useEffect(() => {
    if (!getToken()) {
      setFavoritePeople([]);
      return;
    }
    let ignore = false;
    cachedApiFetch('/api/user/favorites')
      .then((payload) => {
        if (!ignore) {
          setFavoritePeople(Array.isArray(payload?.favorites) ? payload.favorites : []);
        }
      })
      .catch(() => {
        if (!ignore) setFavoritePeople([]);
      });
    return () => {
      ignore = true;
    };
  }, [id]);

  useEffect(() => {
    if (!getToken()) return;
    if (liveCollections.length) {
      setUserCollections(normalizeCollections(liveCollections));
      return;
    }
    let ignore = false;
    loadUserCollections()
      .then((collections) => {
        if (!ignore) {
          setUserCollections(normalizeCollections(collections || []));
        }
      })
      .catch(() => {});

    return () => {
      ignore = true;
    };
  }, [liveCollections]);


  useEffect(() => {
    // Backfill items missing imdb_rating OR vote_average
    const needsEnrich = credits.filter(
      (item) => getValidImdbRating(item?.imdb_rating) == null || getValidVoteAverage(item?.vote_average) == null
    );
    const backfillKey = needsEnrich
      .map((item) => `${mediaTypeFromItem(item)}:${contentIdFromItem(item)}`)
      .sort()
      .join('|');

    if (!backfillKey || attemptedCreditRatingBackfillRef.current === backfillKey) {
      if (needsEnrich.length) console.log(`[Soulstash][React][PersonPage] rating backfill already attempted for this credit set, skipping`);
      return;
    }
    attemptedCreditRatingBackfillRef.current = backfillKey;

    console.log(`[Soulstash][React][PersonPage] rating backfill START personId=${id} needsEnrich=${needsEnrich.length}`, needsEnrich.map(i => ({ title: i.title || i.name, imdb_rating: i.imdb_rating, vote_average: i.vote_average })));

    let cancelled = false;

    (async () => {
      try {
        const cachedRatings = await loadRatingsTable();
        const ratingsByKey = new Map(
          (cachedRatings || []).map((item) => [ratingsCacheKey(item.tmdbID, item.mediaType), item])
        );
        const missingFromCache = needsEnrich.filter(
          (item) => !ratingsByKey.has(ratingsCacheKey(contentIdFromItem(item), mediaTypeFromItem(item)))
        );

        let resolvedItems = needsEnrich
          .map((item) => ratingsByKey.get(ratingsCacheKey(contentIdFromItem(item), mediaTypeFromItem(item))))
          .filter(Boolean);

        if (missingFromCache.length) {
          const response = await apiFetch('/api/ratings/imdb/enrich', {
            method: 'POST',
            body: JSON.stringify({
              items: missingFromCache.map((item) => ({
                contentId: contentIdFromItem(item),
                mediaType: mediaTypeFromItem(item)
              }))
            })
          });
          const fetchedItems = Array.isArray(response?.items) ? response.items : [];
          mergeRatingsTableCache(fetchedItems);
          resolvedItems = [...resolvedItems, ...fetchedItems];
        }

        if (!cancelled && resolvedItems.length) {
          console.log(`[Soulstash][React][PersonPage] rating backfill DONE personId=${id} updatedCount=${resolvedItems.length}`, resolvedItems.map(i => ({ tmdbID: i.tmdbID, imdb_rating: i.imdb_rating, vote_average: i.vote_average, source: i.source })));
          setCredits((current) => mergeImdbRatings(current, resolvedItems));
        }
      } catch (enrichError) {
        if (!cancelled) {
          console.warn('[Soulstash][React][PersonPage] Failed to enrich ratings', {
            personId: id,
            message: enrichError.message
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [credits, id]);



  const filteredCredits = useMemo(() => {
    let list = [...credits];
    const seenKeys = new Set();
    list = list.filter((item) => {
      const key = creditItemKey(item);
      if (seenKeys.has(key)) return false;
      seenKeys.add(key);
      return true;
    });

    if (contentType === 'movies') {
      list = list.filter((item) => mediaTypeFromItem(item) === 'Movie');
    } else if (contentType === 'series') {
      list = list.filter((item) => mediaTypeFromItem(item) === 'Series');
    }

    if (quickFilter === 'watched') {
      list = [...watchedCredits];
    } else if (quickFilter === 'watchlist') {
      list = [...watchlistCredits];
    }

    if (contentType === 'movies') {
      list = list.filter((item) => mediaTypeFromItem(item) === 'Movie');
    } else if (contentType === 'series') {
      list = list.filter((item) => mediaTypeFromItem(item) === 'Series');
    }

    if (collectionFilter) {
      const selectedCollectionCredits = customCollectionCreditMap.get(collectionFilter) || [];
      const selectedKeys = new Set(selectedCollectionCredits.map(creditItemKey));
      list = list.filter((item) => selectedKeys.has(creditItemKey(item)));
    }

    list.sort((a, b) => {
      if (sortBy === 'rating-desc') return compareRatingsForSort(a, b, 'desc');
      if (sortBy === 'rating-asc') return compareRatingsForSort(a, b, 'asc');
      if (sortBy === 'year-asc') return (Number(yearFrom(a)) || 0) - (Number(yearFrom(b)) || 0);
      return (Number(yearFrom(b)) || 0) - (Number(yearFrom(a)) || 0);
    });

    return list;
  }, [collectionFilter, contentType, credits, customCollectionCreditMap, quickFilter, sortBy, watchedCredits, watchlistCredits]);

  const visibleCredits = filteredCredits;
  const visibleCreditsRenderKey = useMemo(
    () => `${id}:${quickFilter}:${collectionFilter || 'all-collections'}:${sortBy}:${visibleCredits.map((item) => `${item.media_type || ''}-${item.id}`).join('|')}`,
    [collectionFilter, id, quickFilter, sortBy, visibleCredits]
  );
  const watchedCreditKeySet = useMemo(() => new Set(watchedCredits.map(creditItemKey)), [watchedCredits]);
  const watchlistCreditKeySet = useMemo(() => new Set(watchlistCredits.map(creditItemKey)), [watchlistCredits]);
  const watchedCreditsCount = watchedCredits.length;
  const totalTrackedCredits = credits.length;
  const showPersonResultsCount = hasActivePersonFilters({ contentType, quickFilter, collectionFilter, sortBy });
  const isFavoritePerson = useMemo(
    () => favoritePeople.some((fav) => String(fav.id) === String(person?.id)),
    [favoritePeople, person?.id]
  );
  const otherCollectionOptions = useMemo(
    () =>
      availableCollections
        .filter((collection) => !['Watched', 'Watchlist'].includes(collection.name))
        .map((collection) => ({
          value: collection.name,
          label: collection.name
        })),
    [availableCollections]
  );

  useEffect(() => {
    if (quickFilter !== 'watched') return;
    console.log('[Soulstash][React][PersonPage][RenderedWatched]', {
      personId: id,
      quickFilter,
      collectionFilter,
      visibleCreditsCount: visibleCredits.length,
      visibleCredits: visibleCredits.map((item) => ({
        id: contentIdFromItem(item),
        mediaType: mediaTypeFromItem(item),
        title: item?.title || item?.name || 'Unknown'
      }))
    });
  }, [collectionFilter, id, quickFilter, visibleCredits]);

  if (loading) {
    return <PersonPageSkeleton />;
  }

  if (!person) {
    return <PersonPageSkeleton />;
  }

  return (
    <div className="space-y-10">
      <section className="rounded-[28px] border border-white/10 bg-[linear-gradient(135deg,rgba(15,15,15,0.98),rgba(10,10,10,0.95))] p-6 md:p-8 lg:p-10 overflow-hidden relative">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,113,86,0.18),transparent_24%),radial-gradient(circle_at_left_center,rgba(143,68,240,0.18),transparent_30%)]"></div>
        <div className="relative z-10 space-y-6">
          <div className="flex items-start gap-4 sm:gap-6 md:gap-8">
            <div className="flex-shrink-0 w-[120px] sm:w-[170px] md:w-[220px] max-w-[42vw]">
              <div className="person-avatar self-start aspect-[2/3] overflow-hidden rounded-[24px] border border-white/10">
                <img
                  src={imageUrl(person.profile_path, 'w500')}
                  alt={person.name}
                  className="w-full h-full object-cover"
                  onError={(event) => {
                    event.currentTarget.src = FALLBACK_AVATAR;
                  }}
                />
              </div>
            </div>

            <div className="min-w-0 flex-1 self-start">
              <div className="flex items-start gap-3">
                <h1 className="text-2xl sm:text-3xl md:text-5xl font-semibold text-white leading-tight text-left">{person.name}</h1>
                <button
                  type="button"
                  className="mt-1 inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-[#cfcfcf] transition-colors hover:text-[#f7c948]"
                  onClick={async () => {
                    if (!getToken()) {
                      toast('Please login first', 'success');
                      return;
                    }
                    try {
                      if (isFavoritePerson) {
                        await apiFetch('/api/user/favorites/remove', {
                          method: 'POST',
                          body: JSON.stringify({ id: person.id })
                        });
                        setFavoritePeople((current) => current.filter((fav) => String(fav.id) !== String(person.id)));
                        toast('Removed from favorites');
                      } else {
                        const response = await apiFetch('/api/user/favorites/add', {
                          method: 'POST',
                          body: JSON.stringify({
                            id: person.id,
                            name: person.name,
                            profile_path: person.profile_path || '',
                            known_for_department: person.known_for_department || ''
                          })
                        });
                        setFavoritePeople((current) => [
                          ...current,
                          response.favorite || {
                            id: person.id,
                            name: person.name,
                            profile_path: person.profile_path || '',
                            known_for_department: person.known_for_department || ''
                          }
                        ]);
                        toast('Added to favorites');
                      }
                    } catch (err) {
                      if (err.status === 409) {
                        toast('Already in favorites', 'info');
                        return;
                      }
                      toast(err.message, 'error');
                    }
                  }}
                  aria-label={isFavoritePerson ? 'Remove from favorites' : 'Add to favorites'}
                >
                  <i className={`${isFavoritePerson ? 'fas' : 'far'} fa-star text-[15px] ${isFavoritePerson ? 'text-[#f7c948]' : ''}`}></i>
                </button>
              </div>
              <div className="mt-4 space-y-2 text-sm md:text-base">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-[#9a9a9a]">Known For</span>
                  <span className="text-[#E2E2E2] font-medium break-words">{person.known_for_department || 'Acting'}</span>
                </div>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-[#9a9a9a]">Birthday</span>
                  <span className="text-[#E2E2E2] font-medium">{person.birthday || 'Unknown'}</span>
                </div>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-[#9a9a9a]">Popularity</span>
                  <span className="text-[#E2E2E2] font-medium">{person.popularity ? person.popularity.toFixed(1) : 'N/A'}</span>
                </div>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-[#9a9a9a]">Place of Birth</span>
                  <span className="text-[#E2E2E2] font-medium break-words">{person.place_of_birth || 'Unknown'}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="max-w-4xl">
            <p className={`text-[#d0d0d0] text-sm md:text-base leading-7 ${bioExpanded ? '' : 'line-clamp-3'}`}>
              {person.biography || 'Biography not available yet.'}
            </p>
            {person.biography ? (
              <button
                type="button"
                className="mt-3 text-sm font-medium text-white/80 transition-colors hover:text-white"
                onClick={() => setBioExpanded((current) => !current)}
              >
                {bioExpanded ? 'Show less' : 'Read more'}
              </button>
            ) : null}
          </div>
        </div>
      </section>

      <section className="content-section">
        <div className="mb-5 flex items-center justify-between gap-4">
          <SectionHeader title="Known For" />
          <div className="flex-shrink-0 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-sm text-[#d8d8d8]">
            Watched {watchedCreditsCount}/{totalTrackedCredits || 0}
          </div>
        </div>
        {credits.length ? (
          <>
            <div className="mb-5 overflow-x-auto filter-scrollbar-hidden">
              <PersonCreditsFilterControls
                contentType={contentType}
                setContentType={setContentType}
                quickFilter={quickFilter}
                setQuickFilter={setQuickFilter}
                collectionFilter={collectionFilter}
                setCollectionFilter={setCollectionFilter}
                sortBy={sortBy}
                setSortBy={setSortBy}
                collectionOptions={[{ value: '', label: 'All' }, ...otherCollectionOptions]}
                resetKey={id}
                collectionsLoading={collectionsSyncing}
              />
            </div>
            {showPersonResultsCount ? (
              <div className="-mt-2 mb-4 text-[11px] font-medium uppercase tracking-[0.14em] text-[#8f8f8f]">
                {visibleCredits.length} results
              </div>
            ) : null}

            {visibleCredits.length ? (
            <div key={visibleCreditsRenderKey} className="credit-grid grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            {visibleCredits.map((item) => (
              <ContentCard
                key={`${quickFilter}-${collectionFilter || 'all'}-${sortBy}-${item.id}-${item.media_type}`}
                item={normalizeCredit(item)}
                status={{
                  watched: watchedCreditKeySet.has(creditItemKey(item)),
                  watchlist: watchlistCreditKeySet.has(creditItemKey(item))
                }}
              />
            ))}
            </div>
            ) : (
              <div className="min-h-[220px]"></div>
            )}
          </>
        ) : (
          <div className="empty-state">No credits available.</div>
        )}
      </section>
    </div>
  );
}

function AdminPage() {
  const auth = useAuthSession();
  const [data, setData] = useState({ totalUsers: 0, users: [] });
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [adminInfo, setAdminInfo] = useState({
    loading: true,
    isAdmin: false,
    showAdult: false,
    multimovies: { available: true, rootUrls: [''], baseUrls: [''] }
  });
  const [multimoviesForm, setMultimoviesForm] = useState({ rootUrl: '', baseUrl: '' });
  const [savingMultimovies, setSavingMultimovies] = useState(false);

  useEffect(() => {
    let ignore = false;

    if (!auth.isLoggedIn) {
      setAdminInfo({
        loading: false,
        isAdmin: false,
        showAdult: false,
        multimovies: { available: true, rootUrls: [''], baseUrls: [''] }
      });
      setLoading(false);
      return () => {
        ignore = true;
      };
    }

    apiFetch('/api/admin/me')
      .then((payload) => {
        if (!ignore) {
          const multimovies = payload?.multimovies || { available: true, rootUrls: [''], baseUrls: [''] };
          setAdminInfo({
            loading: false,
            isAdmin: true,
            showAdult: Boolean(payload?.showAdult),
            multimovies
          });
          setMultimoviesForm({
            rootUrl: multimovies?.rootUrls?.[0] || '',
            baseUrl: multimovies?.baseUrls?.[0] || ''
          });
        }
      })
      .catch((error) => {
        if (!ignore) {
          if (error?.status === 403) {
            setAdminInfo({
              loading: false,
              isAdmin: false,
              showAdult: false,
              multimovies: { available: true, rootUrls: [''], baseUrls: [''] }
            });
          } else {
            toast(error.message, 'error');
            setAdminInfo({
              loading: false,
              isAdmin: false,
              showAdult: false,
              multimovies: { available: true, rootUrls: [''], baseUrls: [''] }
            });
          }
        }
      });

    return () => {
      ignore = true;
    };
  }, [auth.isLoggedIn]);

  useEffect(() => {
    let ignore = false;

    if (!adminInfo.isAdmin) {
      setLoading(false);
      return () => {
        ignore = true;
      };
    }

    setLoading(true);

    apiFetch('/api/admin/users')
      .then((payload) => {
        if (!ignore) {
          setData(payload);
          document.title = 'Admin | Soulstash';
        }
      })
      .catch((error) => {
        if (!ignore) {
          toast(error.message, 'error');
        }
      })
      .finally(() => {
        if (!ignore) {
          setLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [adminInfo.isAdmin]);

  const filteredUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return data.users;
    }

    return data.users.filter((user) =>
      [user.username, user.email, user.firstName, user.lastName, user.bio]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(normalizedQuery))
    );
  }, [data.users, query]);

  if (adminInfo.loading) {
    return <div className="app-loading">Checking admin access...</div>;
  }

  if (!adminInfo.isAdmin) {
    return <div className="app-error">Admin access only.</div>;
  }

  return (
    <div className="space-y-8">
      <section className="rounded-[28px] border border-white/10 bg-[#0d0d0d] p-6 md:p-8">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
          <div>
            <p className="text-sm uppercase tracking-[0.25em] text-[#8f44f0]">Admin Access</p>
            <h1 className="text-3xl md:text-5xl font-semibold text-white mt-3">Users Overview</h1>
            <p className="text-[#b7b7b7] mt-4 max-w-2xl">
              Admin-only dashboard. Password hashes are still hidden.
            </p>
          </div>
          <div className="flex w-full flex-col gap-3 lg:w-auto lg:items-end">
            <button
              type="button"
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-white/[0.12]"
              onClick={async () => {
                const nextValue = !adminInfo.showAdult;
                try {
                  const response = await apiFetch('/api/admin/preferences', {
                    method: 'POST',
                    body: JSON.stringify({ showAdult: nextValue })
                  });
                  setAdminInfo((current) => ({ ...current, showAdult: Boolean(response?.showAdult) }));
                  saveAuthSession(getToken(), { ...auth.user, admin: true, showAdult: Boolean(response?.showAdult) });
                  toast(response?.showAdult ? 'Admin mode enabled' : 'Admin mode disabled');
                } catch (error) {
                  toast(error.message, 'error');
                }
              }}
            >
              <i className={`fas ${adminInfo.showAdult ? 'fa-eye' : 'fa-eye-slash'}`}></i>
              <span>{adminInfo.showAdult ? 'Admin mode on' : 'Admin mode off'}</span>
            </button>
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search username, email, bio..."
              className="w-full lg:w-[360px] rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white"
            />
          </div>
        </div>

        <div className="admin-grid grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
          <div className="admin-stat-card rounded-2xl p-5">
            <p className="text-sm text-[#9f9f9f]">Total users</p>
            <p className="text-3xl font-semibold text-white mt-2">{data.totalUsers}</p>
          </div>
          <div className="admin-stat-card rounded-2xl p-5">
            <p className="text-sm text-[#9f9f9f]">Visible results</p>
            <p className="text-3xl font-semibold text-white mt-2">{filteredUsers.length}</p>
          </div>
          <div className="admin-stat-card rounded-2xl p-5">
            <p className="text-sm text-[#9f9f9f]">Total saved items</p>
            <p className="text-3xl font-semibold text-white mt-2">
              {data.users.reduce((sum, user) => sum + (user.totalSavedItems || 0), 0)}
            </p>
          </div>
        </div>

        <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-medium text-white">Multimovies Config</p>
              <p className="text-sm text-[#9f9f9f]">
                Status: {adminInfo.multimovies?.available === false ? 'Unavailable' : 'Available'}
              </p>
            </div>
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-white/[0.12] disabled:opacity-60"
              disabled={savingMultimovies}
              onClick={async () => {
                try {
                  setSavingMultimovies(true);
                  const response = await apiFetch('/api/admin/multimovies', {
                    method: 'POST',
                    body: JSON.stringify(multimoviesForm)
                  });
                  const multimovies = response?.multimovies || adminInfo.multimovies;
                  setAdminInfo((current) => ({ ...current, multimovies }));
                  setMultimoviesForm({
                    rootUrl: multimovies?.rootUrls?.[0] || '',
                    baseUrl: multimovies?.baseUrls?.[0] || ''
                  });
                  toast('Multimovies config updated');
                } catch (error) {
                  toast(error.message, 'error');
                } finally {
                  setSavingMultimovies(false);
                }
              }}
            >
              {savingMultimovies ? 'Saving...' : 'Save Multimovies URLs'}
            </button>
          </div>
          <div className="grid grid-cols-1 gap-4 mt-4 md:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm text-[#b7b7b7]">
              <span>Root URL</span>
              <input
                type="text"
                value={multimoviesForm.rootUrl}
                onChange={(event) => setMultimoviesForm((current) => ({ ...current, rootUrl: event.target.value }))}
                placeholder="https://multimovies.wtf/"
                className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white"
              />
            </label>
            <label className="flex flex-col gap-2 text-sm text-[#b7b7b7]">
              <span>Base URL</span>
              <input
                type="text"
                value={multimoviesForm.baseUrl}
                onChange={(event) => setMultimoviesForm((current) => ({ ...current, baseUrl: event.target.value }))}
                placeholder="https://multimovies.fyi/"
                className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white"
              />
            </label>
          </div>
        </div>
      </section>

      {loading ? (
        <div className="app-loading">Loading users...</div>
      ) : (
        <section className="admin-grid grid grid-cols-1 xl:grid-cols-2 gap-5">
          {filteredUsers.map((user) => (
            <article key={user._id} className="admin-user-card rounded-[24px] p-6">
              <div className="flex items-start gap-4">
                <img
                  src={user.avatar || FALLBACK_AVATAR}
                  alt={user.username}
                  className="w-16 h-16 rounded-2xl object-cover border border-white/10"
                  onError={(event) => {
                    event.currentTarget.src = FALLBACK_AVATAR;
                  }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="text-2xl font-semibold text-white truncate">{user.username}</h2>
                    <span className="text-xs uppercase tracking-[0.2em] text-[#8f44f0]">
                      {user.collectionCount || 0} collections
                    </span>
                  </div>
                  <p className="text-sm text-[#a6a6a6] mt-2">{user.email || 'No email saved'}</p>
                  <p className="text-sm text-[#d0d0d0] mt-3">{user.bio || 'No bio available.'}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
                <DetailStat label="Watched" value={String(user.watchedCount || 0)} />
                <DetailStat label="Watchlist" value={String(user.watchlistCount || 0)} />
                <DetailStat label="Total Saved" value={String(user.totalSavedItems || 0)} />
                <DetailStat label="Joined" value={user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'Unknown'} />
              </div>

              <div className="mt-6">
                <p className="text-xs uppercase tracking-[0.2em] text-[#8f44f0] mb-3">Collections</p>
                <div className="flex flex-wrap gap-2">
                  {(user.collections || []).length ? (
                    user.collections.map((collection) => (
                      <span
                        key={`${user._id}-${collection.name}`}
                        className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-[#e2e2e2]"
                      >
                        {collection.name} ({Array.isArray(collection.movies) ? collection.movies.length : 0})
                      </span>
                    ))
                  ) : (
                    <span className="text-sm text-[#9f9f9f]">No collections</span>
                  )}
                </div>
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}

function getCollectionStatus(collections, contentId) {
  const numericId = Number(contentId);
  const watchedCollection = collections.find((collection) => collection.name === 'Watched');
  const watchlistCollection = collections.find((collection) => collection.name === 'Watchlist');
  const customCollections = collections.filter((collection) => !['Watched', 'Watchlist'].includes(collection.name));

  const hasContent = (collection) =>
    Array.isArray(collection?.movies) &&
    collection.movies.some((item) => item.movieId === numericId || item.seriesId === numericId);

  return {
    watched: hasContent(watchedCollection),
    watchlist: hasContent(watchlistCollection),
    customSaved: customCollections.some(hasContent)
  };
}

function SmartFooter() {
  return (
    <footer className="app-smart-footer" aria-label="Page footer">
      <div className="app-smart-footer__content">
        <p className="app-smart-footer__text">&copy; 2026 Soulstash. All rights reserved.</p>
      </div>
    </footer>
  );
}

function normalizeStoredCollectionItem(item) {
  const isSeries = item?.media_type === 'Series' || item?.media_type === 'tv' || !!item?.seriesId;
  const id = Number(item?.movieId || item?.seriesId || item?.id || item?._id || 0);

  return {
    id,
    title: item?.title || item?.name || 'Unknown',
    name: item?.name || item?.title || 'Unknown',
    poster_path: item?.poster_path || '',
    release_date: item?.release_date || '',
    first_air_date: item?.first_air_date || '',
    vote_average: item?.vote_average || 0,
    imdb_rating: item?.imdb_rating,
    imdb_id: item?.imdb_id || '',
    rating_lookup_attempted: item?.rating_lookup_attempted === true,
    media_type: isSeries ? 'Series' : 'Movie'
  };
}

function normalizeCredit(item) {
  return {
    id: item.id,
    title: item.title || item.name,
    name: item.name,
    poster_path: item.poster_path,
    release_date: item.release_date,
    first_air_date: item.first_air_date,
    vote_average: item.vote_average,
    imdb_rating: item.imdb_rating,
    imdb_id: item.imdb_id || '',
    rating_lookup_attempted: item?.rating_lookup_attempted === true,
    media_type: item.media_type === 'tv' ? 'Series' : 'Movie'
  };
}


// Guard against HMR calling createRoot() on an already-mounted container,
// which triggers a full page refresh / " createRoot on existing container\ warning.
let _appRoot = window.__soulstashRoot;
if (!_appRoot) {
 _appRoot = createRoot(document.getElementById('app'));
 window.__soulstashRoot = _appRoot;
}
_appRoot.render(
 <React.StrictMode>
 <BrowserRouter>
 <AppShell />
 </BrowserRouter>
 </React.StrictMode>
);
