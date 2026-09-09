/**
 * client.js
 * 
 * This file is the "Waiter" for our application.
 * Any time a React component needs data from the backend (the kitchen),
 * it uses the functions in this file instead of standard fetch().
 * 
 * Note: Caching is now handled globally by @tanstack/react-query.
 */

// ---------------------------------------------------------------------------
// 1. Where is the backend?
// ---------------------------------------------------------------------------

export const API_BASE_URL = (() => {
  if (import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL;
  }
  if (
    window.location.hostname === 'localhost' &&
    (window.location.port === '5173' || window.location.port === '3000' || window.location.port === '3001')
  ) {
    return ''; // Local development connects directly to the same host
  }
  return 'https://soulstash-gateway.onrender.com';
})();

/** Helper to attach the base URL to our API requests */
function buildApiUrl(path) {
  if (typeof path === 'string' && path.startsWith('/api/')) {
    return `${API_BASE_URL}${path}`;
  }
  return path;
}

// ---------------------------------------------------------------------------
// 2. Authentication (Managing the VIP Pass)
// ---------------------------------------------------------------------------

export function getToken() {
  return localStorage.getItem('userToken');
}

export function getCurrentUsername() {
  try {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    return user.username || '';
  } catch {
    return '';
  }
}

export function emitAuthChange() {
  window.dispatchEvent(new CustomEvent('soulstash:auth-changed'));
}

export function clearClientDataCaches() {
  window.__soulstash_collections_fetched_this_session = false;
  if (window.queryClient) {
    window.queryClient.clear();
  }
  import('../utils/ratingsCache.js').then(({ ratingsTableCache: rc }) => {
    rc.data = null;
    rc.promise = null;
    rc.expiresAt = 0;
  });
  import('../utils/trendingCache.js').then(({ homeTrendingCache: hc }) => {
    hc.data = null;
    hc.promise = null;
    hc.expiresAt = 0;
  });
}

export function saveAuthSession(token, user) {
  clearClientDataCaches();
  localStorage.setItem('userToken', token);
  localStorage.setItem('user', JSON.stringify(user));
  emitAuthChange();
}

export function clearAuthSession() {
  clearClientDataCaches();
  localStorage.removeItem('userToken');
  localStorage.removeItem('user');
  emitAuthChange();
}

// ---------------------------------------------------------------------------
// 3. Error Handling
// ---------------------------------------------------------------------------

/**
 * Checks if the backend threw an error, and logs the user out if their
 * VIP pass (token) is expired.
 */
async function handleApiError(response) {
  if (response.status === 401 || response.status === 403) {
    // 401 / 403 means Unauthorized (Invalid VIP Pass)
    clearAuthSession();
    if (!['/login', '/register'].includes(window.location.pathname)) {
      window.dispatchEvent(new CustomEvent('soulstash:unauthorized'));
    }
  }
  const payload = await response.json().catch(() => ({}));
  const error = new Error(payload.error || `Request failed with status ${response.status}`);
  error.status = response.status;
  error.payload = payload;
  throw error;
}

// ---------------------------------------------------------------------------
// 4. The Fetchers (Taking the orders to the kitchen)
// ---------------------------------------------------------------------------

/**
 * Standard fetch that automatically adds the base URL and the Auth Token.
 */
export async function apiFetch(path, options = {}) {
  const url = buildApiUrl(path);
  const token = getToken();
  
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, { ...options, headers });
  
  if (!response.ok) {
    await handleApiError(response);
  }

  return response.json();
}

/**
 * Similar to apiFetch, but for streaming continuous data (like server-sent events).
 */
export async function streamApiFetch(path, options = {}) {
  const url = buildApiUrl(path);
  const token = getToken();
  
  const headers = {
    ...(options.headers || {})
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const { signal, onEvent, method, body, cache } = options;
  if (body !== undefined && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  
  const response = await fetch(url, { signal, headers, method, body, cache: cache || 'no-store' });

  if (!response.ok) {
    await handleApiError(response);
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
            onEvent?.(JSON.parse(line));
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
