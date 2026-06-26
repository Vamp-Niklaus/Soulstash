export const API_BASE_URL = (() => {
  // 1. If we provided a specific URL (like via Render Environment Variables), use it!
  if (import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL;
  }
  
  // 2. Your original local development check
  if (
    window.location.hostname === 'localhost' &&
    (window.location.port === '5173' || window.location.port === '3000' || window.location.port === '3001')
  ) {
    return '';
  }
  
  // 3. The fallback for production / mobile apps
  // (Updated to the new gateway URL so production works!)
  return 'https://soulstash-gateway.onrender.com';
})();

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

export const apiResponseCache = new Map();
export const API_CACHE_TTL = 5 * 60 * 1000;

export const homeTrendingCache = {
  data: null,
  promise: null,
  expiresAt: 0
};

export function clearClientDataCaches() {
  apiResponseCache.clear();
  homeTrendingCache.data = null;
  homeTrendingCache.promise = null;
  homeTrendingCache.expiresAt = 0;
}

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

export function saveAuthSession(token, user) {
  clearClientDataCaches();
  localStorage.setItem('userToken', token);
  localStorage.setItem('user', JSON.stringify(user));
  emitAuthChange();
}

export function emitAuthChange() {
  window.dispatchEvent(new CustomEvent('soulstash:auth-changed'));
}

export function clearAuthSession() {
  clearClientDataCaches();
  localStorage.removeItem('userToken');
  localStorage.removeItem('user');
  emitAuthChange();
}

export async function apiFetch(path, options = {}) {
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
        // Fire an event that the App router can listen to instead of calling navigate directly
        window.dispatchEvent(new CustomEvent('soulstash:unauthorized'));
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

export async function streamApiFetch(path, options = {}) {
  const token = getToken();
  const headers = {
    ...(options.headers || {})
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const { signal, onEvent, method, body } = options;
  if (body !== undefined && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(path, { signal, headers, method, body });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
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

export async function cachedApiFetch(path, options = {}, ttl = API_CACHE_TTL) {
  const method = String(options.method || 'GET').toUpperCase();
  if (method !== 'GET') {
    return apiFetch(path, options);
  }

  // Public collection pages need to reflect the latest visibility state
  // immediately after publish/unpublish changes, so skip the in-memory cache.
  if (typeof path === 'string' && path.startsWith('/api/collection/')) {
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
    .catch((err) => {
      // On error: remove the pending promise so the next call retries fresh
      apiResponseCache.delete(cacheKey);
      throw err;
    });

  apiResponseCache.set(cacheKey, { promise: request });
  return request;
}
