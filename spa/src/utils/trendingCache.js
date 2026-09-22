import { apiFetch } from '../api/client.js';
import { HOME_TRENDING_TTL } from './constants.js';

export let homeTrendingCache = { data: null, promise: null, expiresAt: 0 };

export async function loadTrendingHome(force = false) {
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
      const arr = Array.isArray(data?.movies) ? data.movies : Array.isArray(data) ? data : [];
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
