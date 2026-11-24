import { apiFetch, getToken } from '../api/client.js';

const STORAGE_KEY = 'soulstash_continue_watching';
const MIN_TIME_SECONDS = 5;
const COMPLETION_THRESHOLD = 0.90; // 90% watched = completed

export function getProgressItemKey(item) {
  if (!item) return '';
  const id = item.id || item.tmdbId || item.movieId || item.seriesId || item.kartoons_slug || item.slug || item.title;
  const s = item.seasonNumber ?? item.season ?? '';
  const e = item.episodeNumber ?? item.episode ?? '';
  if (s !== '' || e !== '') {
    return `${id}_s${s}_e${e}`;
  }
  return String(id);
}

// Episodes of the same series share a group; movies are their own group.
export function getSeriesGroupKey(key) {
  return String(key || '').replace(/_s[^_]*_e[^_]*$/, '');
}

// Keep only the most recently updated entry per series/movie.
function dedupeBySeries(list) {
  const seen = new Set();
  return list
    .filter((entry) => entry && entry.key)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .filter((entry) => {
      const group = getSeriesGroupKey(entry.key);
      if (seen.has(group)) return false;
      seen.add(group);
      return true;
    });
}

export function getLastWatchedForSeries(seriesId) {
  if (!seriesId) return null;
  const list = getContinueWatchingList();
  const idStr = String(seriesId).toLowerCase();
  return list.find((entry) => {
    const entryId = String(entry.id || entry.tmdbId || entry.seriesId || entry.kartoons_slug || '').toLowerCase();
    const entryKey = String(entry.key || '').toLowerCase();
    return (
      entryId === idStr ||
      entryId.replace(/^kartoons-/, '') === idStr.replace(/^kartoons-/, '') ||
      entryKey.startsWith(`${idStr}_`) ||
      entryKey.startsWith(`kartoons-${idStr}_`)
    );
  }) || null;
}

export function getContinueWatchingList() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return dedupeBySeries(list)
      .filter((entry) => {
        if (!entry || !entry.key) return false;
        const poster = entry.poster_path || entry.image || entry.backdrop_path || entry.backdrop || entry.coverImage;
        const isBroken = !poster ||
          typeof poster !== 'string' ||
          !poster.trim() ||
          poster === 'null' ||
          poster === '/null' ||
          poster === 'undefined' ||
          poster === '/undefined';
        if (isBroken) return false;
        const time = Number(entry.currentTime) || 0;
        const duration = Number(entry.duration) || 0;
        if (time < MIN_TIME_SECONDS && !entry.isNextEpisode) return false;
        if (duration > 0 && !entry.isNextEpisode) {
          const ratio = time / duration;
          if (ratio >= COMPLETION_THRESHOLD || time >= duration - 30) return false;
        }
        return true;
      })
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  } catch (_) {
    return [];
  }
}

export function getSavedProgress(item) {
  const key = getProgressItemKey(item);
  if (!key) return null;
  const list = getContinueWatchingList();
  const found = list.find((x) => x.key === key);
  return found || null;
}

export function isSeriesItem(item) {
  if (!item) return false;
  const mt = String(item.media_type || item.type || item.mediaType || '').toLowerCase();
  if (mt === 'series' || mt === 'tv') return true;
  return Boolean(item.seasonNumber != null || item.episodeNumber != null || item.season != null || item.episode != null);
}

export function saveNextEpisodeProgress(item, nextSeason, nextEpisode) {
  if (!item) return;
  const s = Number(nextSeason ?? item.seasonNumber ?? item.season ?? 1) || 1;
  const e = Number(nextEpisode ?? item.episodeNumber ?? item.episode ?? 1) || 1;
  const nextItem = {
    ...item,
    seasonNumber: s,
    episodeNumber: e,
  };
  const key = getProgressItemKey(nextItem);
  if (!key) return;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    let list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) list = [];

    const groupKey = getSeriesGroupKey(key);
    list = list.filter((x) => getSeriesGroupKey(x.key) !== groupKey);

    const rawPoster = item.poster_path || item.image || item.coverImage || '';
    const cleanPoster = (rawPoster && typeof rawPoster === 'string' && rawPoster !== 'null' && rawPoster !== '/null' && rawPoster !== 'undefined' && !rawPoster.startsWith('data:image/svg+xml')) ? rawPoster : '';
    const rawBackdrop = item.backdrop_path || item.backdrop || item.coverImage || item.image || '';
    const cleanBackdrop = (rawBackdrop && typeof rawBackdrop === 'string' && rawBackdrop !== 'null' && rawBackdrop !== '/null' && rawBackdrop !== 'undefined' && !rawBackdrop.startsWith('data:image/svg+xml')) ? rawBackdrop : cleanPoster;
    const finalPoster = cleanPoster || cleanBackdrop;
    const title = item.title || item.name || item.seriesTitle || 'Unknown';
    const rawTmdb = item.tmdbId || (typeof item.id === 'number' || /^\d+$/.test(String(item.id)) ? item.id : null);
    const isTmdb = Boolean(rawTmdb && String(rawTmdb) !== '0');
    const resolvedId = isTmdb ? rawTmdb : (item.id || item.kartoons_slug || item.slug);
    const resolvedSlug = item.kartoons_slug || item.kartoonsSlug || item.slug || '';

    list.unshift({
      key,
      id: resolvedId,
      tmdbId: isTmdb ? rawTmdb : null,
      title,
      name: title,
      seriesTitle: item.seriesTitle || item.name || '',
      seasonNumber: s,
      episodeNumber: e,
      poster_path: finalPoster,
      image: finalPoster,
      backdrop_path: cleanBackdrop,
      media_type: 'Series',
      is_kartoons: !isTmdb && Boolean(item.is_kartoons || item.isKartoons || String(item.id || '').startsWith('kartoons-')),
      kartoons_slug: resolvedSlug,
      currentTime: 0,
      duration: Math.floor(Number(item.duration) || 1800),
      progress: 0,
      isNextEpisode: true,
      updatedAt: Date.now()
    });

    if (list.length > 30) list = list.slice(0, 30);
    const savedEntry = list[0];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    window.dispatchEvent(new CustomEvent('soulstash:continue-watching-updated'));

    if (getToken() && savedEntry) {
      apiFetch('/api/auth/watch-progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(savedEntry)
      }).catch(() => {});
    }
  } catch (_) {}
}

export function advanceToNextEpisodeOrRemove(item) {
  if (!item) return;
  if (!isSeriesItem(item)) {
    removeWatchProgress(item);
    return;
  }
  const s = Number(item.seasonNumber ?? item.season ?? 1) || 1;
  const e = Number(item.episodeNumber ?? item.episode ?? 1) || 1;
  saveNextEpisodeProgress(item, s, e + 1);
}

export function saveWatchProgress(item, currentTime, duration) {
  if (!item) return;
  const key = getProgressItemKey(item);
  if (!key) return;

  const time = Number(currentTime) || 0;
  const dur = Number(duration) || 0;
  if (time < MIN_TIME_SECONDS) return;

  const isCompleted = dur > 0 && (time / dur >= COMPLETION_THRESHOLD || time >= dur - 30);

  if (isCompleted && isSeriesItem(item)) {
    const s = Number(item.seasonNumber ?? item.season ?? 1) || 1;
    const e = Number(item.episodeNumber ?? item.episode ?? 1) || 1;
    saveNextEpisodeProgress(item, s, e + 1);
    return;
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    let list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) list = [];

    // Remove any existing entry for this series/movie (one card per title)
    const groupKey = getSeriesGroupKey(key);
    list = list.filter((x) => getSeriesGroupKey(x.key) !== groupKey);

    if (!isCompleted) {
      const rawPoster = item.poster_path || item.image || item.coverImage || '';
      const cleanPoster = (rawPoster && typeof rawPoster === 'string' && rawPoster !== 'null' && rawPoster !== '/null' && rawPoster !== 'undefined' && !rawPoster.startsWith('data:image/svg+xml')) ? rawPoster : '';
      const rawBackdrop = item.backdrop_path || item.backdrop || item.coverImage || item.image || '';
      const cleanBackdrop = (rawBackdrop && typeof rawBackdrop === 'string' && rawBackdrop !== 'null' && rawBackdrop !== '/null' && rawBackdrop !== 'undefined' && !rawBackdrop.startsWith('data:image/svg+xml')) ? rawBackdrop : cleanPoster;
      const finalPoster = cleanPoster || cleanBackdrop;
      const title = item.title || item.name || item.seriesTitle || 'Unknown';
      const mediaType = (item.media_type || item.type || (item.seasonNumber || item.episodeNumber ? 'Series' : 'Movie'));

      const rawTmdb = item.tmdbId || (typeof item.id === 'number' || /^\d+$/.test(String(item.id)) ? item.id : null);
      const isTmdb = Boolean(rawTmdb && String(rawTmdb) !== '0');
      const resolvedId = isTmdb ? rawTmdb : (item.id || item.kartoons_slug || item.slug);
      const resolvedSlug = item.kartoons_slug || item.kartoonsSlug || item.slug || '';

      list.unshift({
        key,
        id: resolvedId,
        tmdbId: isTmdb ? rawTmdb : null,
        title,
        name: title,
        seriesTitle: item.seriesTitle || item.name || '',
        seasonNumber: item.seasonNumber ?? item.season ?? null,
        episodeNumber: item.episodeNumber ?? item.episode ?? null,
        poster_path: finalPoster,
        image: finalPoster,
        backdrop_path: cleanBackdrop,
        media_type: mediaType,
        is_kartoons: !isTmdb && Boolean(item.is_kartoons || item.isKartoons || String(item.id || '').startsWith('kartoons-')),
        kartoons_slug: resolvedSlug,
        currentTime: Math.floor(time),
        duration: Math.floor(dur),
        progress: dur > 0 ? Math.min(1, time / dur) : 0,
        updatedAt: Date.now()
      });

      // Keep at most 30 recent items
      if (list.length > 30) list = list.slice(0, 30);
    }

    const savedEntry = list[0];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    window.dispatchEvent(new CustomEvent('soulstash:continue-watching-updated'));

    // Sync to backend user account if logged in
    if (getToken() && savedEntry) {
      apiFetch('/api/auth/watch-progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(savedEntry)
      }).catch(() => {});
    }
  } catch (_) {}
}

export function removeWatchProgress(item) {
  if (!item) return;
  const key = typeof item === 'string' ? item : (item.key || getProgressItemKey(item));
  if (!key) return;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    let list = JSON.parse(raw);
    if (!Array.isArray(list)) return;
    list = list.filter((x) => x.key !== key && x.id !== key);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    window.dispatchEvent(new CustomEvent('soulstash:continue-watching-updated'));

    if (getToken()) {
      apiFetch(`/api/auth/watch-progress/${encodeURIComponent(key)}`, {
        method: 'DELETE'
      }).catch(() => {});
    }
  } catch (_) {}
}

export function clearAllWatchProgress() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem('soulstash_watch_progress');
    window.dispatchEvent(new CustomEvent('soulstash:continue-watching-updated'));
    window.dispatchEvent(new Event('soulstash:continue-watching-updated'));
    window.dispatchEvent(new Event('watch-progress-updated'));
  } catch (_) {}
}

export async function syncAccountWatchProgress() {
  if (!getToken()) return;
  try {
    const serverList = await apiFetch('/api/auth/watch-progress');
    if (!Array.isArray(serverList)) return;
    const raw = localStorage.getItem(STORAGE_KEY);
    const localList = raw ? JSON.parse(raw) : [];
    const map = new Map();

    for (const item of serverList) {
      if (item?.key) map.set(item.key, item);
    }
    for (const item of localList) {
      if (!item?.key) continue;
      const existing = map.get(item.key);
      if (!existing || (item.updatedAt || 0) >= (existing.updatedAt || 0)) {
        map.set(item.key, item);
      }
    }
    const merged = dedupeBySeries(Array.from(map.values()))
      .filter((entry) => {
        if (!entry || !entry.key) return false;
        const poster = entry.poster_path || entry.image || entry.backdrop_path || entry.backdrop || entry.coverImage;
        const isBroken = !poster ||
          typeof poster !== 'string' ||
          !poster.trim() ||
          poster === 'null' ||
          poster === '/null' ||
          poster === 'undefined' ||
          poster === '/undefined';
        return !isBroken && Number(entry.currentTime) >= MIN_TIME_SECONDS;
      })
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, 30);

    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    window.dispatchEvent(new CustomEvent('soulstash:continue-watching-updated'));
  } catch (_) {}
}
