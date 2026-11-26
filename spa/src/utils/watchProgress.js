import { apiFetch, getToken, getCurrentUsername } from '../api/client.js';

const STORAGE_KEY = 'soulstash_continue_watching';
const WATCHED_EPISODES_KEY = 'soulstash_watched_episodes';
const LAST_VIEWED_SERIES_KEY_PREFIX = 'soulstash_last_viewed_series_';
const WATCH_OWNER_KEY = 'soulstash_watch_owner';
const CW_PENDING_KEY = 'soulstash_cw_pending';
const CW_CLEAR_PENDING_KEY = 'soulstash_cw_clear_pending';
const WE_PENDING_ADD_KEY = 'soulstash_we_pending_add';
const WE_PENDING_DEL_KEY = 'soulstash_we_pending_del';

const MIN_TIME_SECONDS = 5;
const COMPLETION_THRESHOLD = 0.90; // 90% watched = completed

let activeSyncPromise = null;
let lastSyncTime = 0;

function readJsonStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_) {
    return fallback;
  }
}

function writeJsonStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (_) {}
}

function normalizeTimestamp(ts) {
  const n = Number(ts) || 0;
  return n > 0 && n < 1e11 ? n * 1000 : n;
}

function isPosterBroken(poster) {
  return (
    !poster ||
    typeof poster !== 'string' ||
    !poster.trim() ||
    poster === 'null' ||
    poster === '/null' ||
    poster === 'undefined' ||
    poster === '/undefined'
  );
}

function cleanPosterUrl(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed || trimmed === 'null' || trimmed === '/null' || trimmed === 'undefined' || trimmed === '/undefined' || trimmed.startsWith('data:image/svg+xml')) {
    return '';
  }
  return trimmed;
}

function cleanSeriesEntryTitle(item) {
  const rawSeriesTitle = (item.seriesTitle || '').trim();
  if (rawSeriesTitle && isSeriesItem(item)) return rawSeriesTitle;
  const raw = (item.title || item.name || 'Unknown').trim();
  if (isSeriesItem(item)) {
    const stripped = raw.replace(/\s+S\d+\s*E\d+(?:\.\d+)?$/i, '').trim();
    return stripped || raw;
  }
  return raw;
}

function buildProgressRecord(item, { key, seasonNumber = null, episodeNumber = null, currentTime = 0, duration = 0, progress = 0, isNextEpisode = false }) {
  const cleanPoster = cleanPosterUrl(item.poster_path || item.image || item.coverImage);
  const cleanBackdrop = cleanPosterUrl(item.backdrop_path || item.backdrop || item.coverImage || item.image) || cleanPoster;
  const finalPoster = cleanPoster || cleanBackdrop;
  const title = cleanSeriesEntryTitle(item);
  const mediaType = isSeriesItem(item) ? 'Series' : (item.media_type || item.type || 'Movie');

  const rawTmdb = item.tmdbId || (typeof item.id === 'number' || /^\d+$/.test(String(item.id)) ? item.id : null);
  const isTmdb = Boolean(rawTmdb && String(rawTmdb) !== '0');
  const resolvedId = isTmdb ? rawTmdb : (item.id || item.kartoons_slug || item.slug);
  const resolvedSlug = item.kartoons_slug || item.kartoonsSlug || item.slug || '';

  return {
    key,
    seriesGroup: getSeriesGroupKey(key),
    id: resolvedId,
    tmdbId: isTmdb ? rawTmdb : null,
    title,
    name: title,
    seriesTitle: item.seriesTitle || (isSeriesItem(item) ? title : ''),
    seasonNumber,
    episodeNumber,
    poster_path: finalPoster,
    image: finalPoster,
    backdrop_path: cleanBackdrop,
    media_type: mediaType,
    is_kartoons: !isTmdb && Boolean(item.is_kartoons || item.isKartoons || String(item.id || '').startsWith('kartoons-')),
    kartoons_slug: resolvedSlug,
    currentTime: Math.floor(currentTime),
    duration: Math.floor(duration),
    progress,
    isNextEpisode: Boolean(isNextEpisode),
    updatedAt: Date.now()
  };
}

function upsertPendingContinueWatching(entry) {
  if (!entry?.key) return;
  const group = entry.seriesGroup || getSeriesGroupKey(entry.key);
  const list = readJsonStorage(CW_PENDING_KEY, []);
  const next = (Array.isArray(list) ? list : []).filter((x) => (x?.seriesGroup || getSeriesGroupKey(x?.key)) !== group);
  next.unshift(entry);
  writeJsonStorage(CW_PENDING_KEY, next.slice(0, 30));
}

function clearPendingContinueWatching(keyOrGroup) {
  const group = getSeriesGroupKey(keyOrGroup);
  const list = readJsonStorage(CW_PENDING_KEY, []);
  if (!Array.isArray(list)) return;
  const next = list.filter((x) => x?.key !== keyOrGroup && (x?.seriesGroup || getSeriesGroupKey(x?.key)) !== group);
  writeJsonStorage(CW_PENDING_KEY, next);
}

export function normalizeSeriesEpisodeKey(seriesId, seasonNumber, episodeNumber) {
  if (!seriesId || seasonNumber == null || episodeNumber == null) return '';
  const sId = String(seriesId).toLowerCase().replace(/^kartoons-/, '');
  return `${sId}_s${seasonNumber}_e${episodeNumber}`;
}

export function markEpisodeWatched(seriesId, seasonNumber, episodeNumber) {
  const epKey = normalizeSeriesEpisodeKey(seriesId, seasonNumber, episodeNumber);
  if (!epKey) return;
  try {
    let list = readJsonStorage(WATCHED_EPISODES_KEY, []);
    if (!Array.isArray(list)) list = [];
    if (!list.includes(epKey)) {
      list.push(epKey);
      if (list.length > 1500) list = list.slice(list.length - 1500);
      writeJsonStorage(WATCHED_EPISODES_KEY, list);
      window.dispatchEvent(new CustomEvent('soulstash:watched-episodes-updated', { detail: { epKey, watched: true } }));
    }

    // Track ownership & sync to cloud if logged in
    const username = getCurrentUsername();
    if (username) {
      localStorage.setItem(WATCH_OWNER_KEY, username);
    }

    let pendingDel = readJsonStorage(WE_PENDING_DEL_KEY, []);
    if (Array.isArray(pendingDel) && pendingDel.includes(epKey)) {
      writeJsonStorage(WE_PENDING_DEL_KEY, pendingDel.filter((k) => k !== epKey));
    }

    if (getToken()) {
      let pendingAdd = readJsonStorage(WE_PENDING_ADD_KEY, []);
      if (!Array.isArray(pendingAdd)) pendingAdd = [];
      if (!pendingAdd.includes(epKey)) {
        pendingAdd.push(epKey);
        writeJsonStorage(WE_PENDING_ADD_KEY, pendingAdd);
      }

      apiFetch('/api/auth/watched-episodes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys: [epKey] })
      })
        .then(() => {
          const cur = readJsonStorage(WE_PENDING_ADD_KEY, []);
          if (Array.isArray(cur)) {
            writeJsonStorage(WE_PENDING_ADD_KEY, cur.filter((k) => k !== epKey));
          }
        })
        .catch(() => {});
    }
  } catch (_) {}
}

export function unmarkEpisodeWatched(seriesId, seasonNumber, episodeNumber) {
  const epKey = normalizeSeriesEpisodeKey(seriesId, seasonNumber, episodeNumber);
  if (!epKey) return;
  try {
    let list = readJsonStorage(WATCHED_EPISODES_KEY, []);
    if (!Array.isArray(list)) list = [];
    const nextList = list.filter((k) => k !== epKey);
    writeJsonStorage(WATCHED_EPISODES_KEY, nextList);
    window.dispatchEvent(new CustomEvent('soulstash:watched-episodes-updated', { detail: { epKey, watched: false } }));

    let pendingAdd = readJsonStorage(WE_PENDING_ADD_KEY, []);
    if (Array.isArray(pendingAdd) && pendingAdd.includes(epKey)) {
      writeJsonStorage(WE_PENDING_ADD_KEY, pendingAdd.filter((k) => k !== epKey));
    }

    if (getToken()) {
      let pendingDel = readJsonStorage(WE_PENDING_DEL_KEY, []);
      if (!Array.isArray(pendingDel)) pendingDel = [];
      if (!pendingDel.includes(epKey)) {
        pendingDel.push(epKey);
        writeJsonStorage(WE_PENDING_DEL_KEY, pendingDel);
      }

      apiFetch(`/api/auth/watched-episodes/${encodeURIComponent(epKey)}`, {
        method: 'DELETE'
      })
        .then(() => {
          const cur = readJsonStorage(WE_PENDING_DEL_KEY, []);
          if (Array.isArray(cur)) {
            writeJsonStorage(WE_PENDING_DEL_KEY, cur.filter((k) => k !== epKey));
          }
        })
        .catch(() => {});
    }
  } catch (_) {}
}

export function getWatchedEpisodes(seriesId) {
  try {
    const list = readJsonStorage(WATCHED_EPISODES_KEY, []);
    if (!Array.isArray(list)) return new Set();
    if (!seriesId) return new Set(list);
    const cleanId = String(seriesId).toLowerCase().replace(/^kartoons-/, '');
    const prefix = `${cleanId}_`;
    return new Set(list.filter((k) => String(k).startsWith(prefix)));
  } catch (_) {
    return new Set();
  }
}

export function isEpisodeWatched(seriesId, seasonNumber, episodeNumber) {
  const epKey = normalizeSeriesEpisodeKey(seriesId, seasonNumber, episodeNumber);
  if (!epKey) return false;
  const watched = getWatchedEpisodes(seriesId);
  return watched.has(epKey);
}

export function saveLastViewedEpisode(seriesId, seasonNumber, episodeNumber) {
  if (!seriesId || seasonNumber == null) return;
  const cleanId = String(seriesId).toLowerCase().replace(/^kartoons-/, '');
  try {
    const data = {
      seriesId: cleanId,
      seasonNumber: Number(seasonNumber),
      episodeNumber: episodeNumber != null ? Number(episodeNumber) : 1,
      updatedAt: Date.now()
    };
    localStorage.setItem(`${LAST_VIEWED_SERIES_KEY_PREFIX}${cleanId}`, JSON.stringify(data));
    window.dispatchEvent(new CustomEvent('soulstash:last-viewed-updated', { detail: data }));
  } catch (_) {}
}

export function getLastViewedEpisode(seriesId) {
  if (!seriesId) return null;
  const cleanId = String(seriesId).toLowerCase().replace(/^kartoons-/, '');
  try {
    const raw = localStorage.getItem(`${LAST_VIEWED_SERIES_KEY_PREFIX}${cleanId}`);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

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
    .map((entry) => ({ ...entry, updatedAt: normalizeTimestamp(entry.updatedAt) }))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .filter((entry) => {
      const group = getSeriesGroupKey(entry.key);
      if (seen.has(group)) return false;
      seen.add(group);
      return true;
    });
}

function isValidContinueEntry(entry) {
  if (!entry || !entry.key) return false;
  const poster = entry.poster_path || entry.image || entry.backdrop_path || entry.backdrop || entry.coverImage;
  if (isPosterBroken(poster)) return false;
  if (entry.isNextEpisode) return true;
  const time = Number(entry.currentTime) || 0;
  const duration = Number(entry.duration) || 0;
  if (time < MIN_TIME_SECONDS) return false;
  if (duration > 0) {
    const ratio = time / duration;
    if (ratio >= COMPLETION_THRESHOLD || time >= duration - 30) return false;
  }
  return true;
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
    const list = readJsonStorage(STORAGE_KEY, []);
    if (!Array.isArray(list)) return [];
    return dedupeBySeries(list)
      .filter(isValidContinueEntry)
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

function resolveNextEpisodeTarget(item, currentSeason, currentEpisode) {
  const s = Number(currentSeason) || 1;
  const e = Number(currentEpisode) || 1;
  const epCount = Number(item?.seasonEpisodeCount || 0);
  const seasons = Array.isArray(item?.seasons) ? item.seasons : null;

  if (epCount > 0 && e >= epCount) {
    if (seasons && seasons.length > 0) {
      const nextSeason = seasons
        .map((sn) => ({ num: Number(sn?.season_number ?? sn?.seasonNumber ?? 0), epCount: Number(sn?.episode_count ?? sn?.episodeCount ?? 0) }))
        .filter((sn) => sn.num > s && (sn.epCount === 0 || sn.epCount > 0))
        .sort((a, b) => a.num - b.num)[0];
      if (nextSeason) {
        return { season: nextSeason.num, episode: 1 };
      }
      // Confirmed final episode of the final season -> series completed
      return null;
    }
  }
  return { season: s, episode: e + 1 };
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
    let list = readJsonStorage(STORAGE_KEY, []);
    if (!Array.isArray(list)) list = [];

    const groupKey = getSeriesGroupKey(key);
    list = list.filter((x) => getSeriesGroupKey(x.key) !== groupKey);

    const savedEntry = buildProgressRecord(item, {
      key,
      seasonNumber: s,
      episodeNumber: e,
      currentTime: 0,
      duration: Math.floor(Number(item.duration) || (Number(item.runtime) ? Number(item.runtime) * 60 : 1800)),
      progress: 0,
      isNextEpisode: true
    });

    list.unshift(savedEntry);
    if (list.length > 30) list = list.slice(0, 30);

    writeJsonStorage(STORAGE_KEY, list);
    localStorage.removeItem(CW_CLEAR_PENDING_KEY);

    const username = getCurrentUsername();
    if (username) localStorage.setItem(WATCH_OWNER_KEY, username);

    const targetId = item.id || item.tmdbId || item.seriesId || item.kartoons_slug || item.slug;
    saveLastViewedEpisode(targetId, s, e);
    window.dispatchEvent(new CustomEvent('soulstash:continue-watching-updated'));

    if (getToken() && savedEntry) {
      upsertPendingContinueWatching(savedEntry);
      apiFetch('/api/auth/watch-progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(savedEntry)
      })
        .then(() => clearPendingContinueWatching(key))
        .catch(() => {});
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
  const targetId = item.id || item.tmdbId || item.seriesId || item.kartoons_slug || item.slug;
  markEpisodeWatched(targetId, s, e);

  const nextTarget = resolveNextEpisodeTarget(item, s, e);
  if (nextTarget) {
    saveNextEpisodeProgress(item, nextTarget.season, nextTarget.episode);
  } else {
    removeWatchProgress(item);
  }
}

export function saveWatchProgress(item, currentTime, duration) {
  if (!item) return;
  const key = getProgressItemKey(item);
  if (!key) return;

  const time = Number(currentTime) || 0;
  const dur = Number(duration) || 0;
  if (time < MIN_TIME_SECONDS) return;

  const isCompleted = dur > 0 && (time / dur >= COMPLETION_THRESHOLD || time >= dur - 30);

  if (isSeriesItem(item)) {
    const s = Number(item.seasonNumber ?? item.season ?? 1) || 1;
    const e = Number(item.episodeNumber ?? item.episode ?? 1) || 1;
    const targetId = item.id || item.tmdbId || item.seriesId || item.kartoons_slug || item.slug;
    if (isCompleted) {
      markEpisodeWatched(targetId, s, e);
      const nextTarget = resolveNextEpisodeTarget(item, s, e);
      if (nextTarget) {
        saveNextEpisodeProgress(item, nextTarget.season, nextTarget.episode);
      } else {
        removeWatchProgress(item);
      }
      return;
    }
    saveLastViewedEpisode(targetId, s, e);
  }

  try {
    let list = readJsonStorage(STORAGE_KEY, []);
    if (!Array.isArray(list)) list = [];

    const groupKey = getSeriesGroupKey(key);
    list = list.filter((x) => getSeriesGroupKey(x.key) !== groupKey);

    let savedEntry = null;
    if (!isCompleted) {
      savedEntry = buildProgressRecord(item, {
        key,
        seasonNumber: item.seasonNumber ?? item.season ?? null,
        episodeNumber: item.episodeNumber ?? item.episode ?? null,
        currentTime: time,
        duration: dur,
        progress: dur > 0 ? Math.min(1, time / dur) : 0,
        isNextEpisode: false
      });
      list.unshift(savedEntry);
      if (list.length > 30) list = list.slice(0, 30);
    }

    writeJsonStorage(STORAGE_KEY, list);
    localStorage.removeItem(CW_CLEAR_PENDING_KEY);

    const username = getCurrentUsername();
    if (username) localStorage.setItem(WATCH_OWNER_KEY, username);

    window.dispatchEvent(new CustomEvent('soulstash:continue-watching-updated'));

    if (getToken()) {
      if (isCompleted) {
        clearPendingContinueWatching(key);
        apiFetch(`/api/auth/watch-progress/${encodeURIComponent(key)}`, {
          method: 'DELETE'
        }).catch(() => {});
      } else if (savedEntry) {
        upsertPendingContinueWatching(savedEntry);
        apiFetch('/api/auth/watch-progress', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(savedEntry)
        })
          .then(() => clearPendingContinueWatching(key))
          .catch(() => {});
      }
    }
  } catch (_) {}
}

export function removeWatchProgress(item) {
  if (!item) return;
  const key = typeof item === 'string' ? item : (item.key || getProgressItemKey(item));
  if (!key) return;
  const groupKey = getSeriesGroupKey(key);

  try {
    let list = readJsonStorage(STORAGE_KEY, []);
    if (Array.isArray(list)) {
      list = list.filter((x) => x?.key !== key && x?.id !== key && getSeriesGroupKey(x?.key) !== groupKey);
      writeJsonStorage(STORAGE_KEY, list);
    }
    clearPendingContinueWatching(key);
    window.dispatchEvent(new CustomEvent('soulstash:continue-watching-updated'));

    if (getToken()) {
      apiFetch(`/api/auth/watch-progress/${encodeURIComponent(key)}`, {
        method: 'DELETE'
      }).catch(() => {});
    }
  } catch (_) {}
}

// Clears ONLY Continue Watching (local + server), preserving Watched Episodes in local and cloud.
export function clearAllWatchProgress() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem('soulstash_watch_progress');
    localStorage.removeItem(CW_PENDING_KEY);

    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(LAST_VIEWED_SERIES_KEY_PREFIX)) {
        keysToRemove.push(k);
      }
    }
    for (const k of keysToRemove) localStorage.removeItem(k);

    window.dispatchEvent(new CustomEvent('soulstash:continue-watching-updated'));
    window.dispatchEvent(new CustomEvent('soulstash:last-viewed-updated'));
    window.dispatchEvent(new Event('watch-progress-updated'));

    if (getToken()) {
      localStorage.setItem(CW_CLEAR_PENDING_KEY, String(Date.now()));
      apiFetch('/api/auth/watch-progress', {
        method: 'DELETE'
      })
        .then(() => {
          localStorage.removeItem(CW_CLEAR_PENDING_KEY);
        })
        .catch(() => {});
    }
  } catch (_) {}
}

// Clears local device caches on logout / account switch without deleting cloud data.
export function clearLocalAccountWatchData() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem('soulstash_watch_progress');
    localStorage.removeItem(WATCHED_EPISODES_KEY);
    localStorage.removeItem(WATCH_OWNER_KEY);
    localStorage.removeItem(CW_PENDING_KEY);
    localStorage.removeItem(CW_CLEAR_PENDING_KEY);
    localStorage.removeItem(WE_PENDING_ADD_KEY);
    localStorage.removeItem(WE_PENDING_DEL_KEY);
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(LAST_VIEWED_SERIES_KEY_PREFIX)) {
        keysToRemove.push(k);
      }
    }
    for (const k of keysToRemove) localStorage.removeItem(k);

    window.dispatchEvent(new CustomEvent('soulstash:continue-watching-updated'));
    window.dispatchEvent(new CustomEvent('soulstash:watched-episodes-updated'));
    window.dispatchEvent(new CustomEvent('soulstash:last-viewed-updated'));
  } catch (_) {}
}

export async function syncAccountWatchProgress(force = false) {
  if (!getToken()) return;
  const now = Date.now();
  if (!force && activeSyncPromise) return activeSyncPromise;
  if (!force && now - lastSyncTime < 4000) return;

  activeSyncPromise = (async () => {
    try {
      const username = getCurrentUsername();
      const prevOwner = localStorage.getItem(WATCH_OWNER_KEY) || '';

      // If logged into a different user than what was cached locally, isolate before syncing.
      if (prevOwner && username && prevOwner.toLowerCase() !== username.toLowerCase()) {
        clearLocalAccountWatchData();
      }
      if (username) {
        localStorage.setItem(WATCH_OWNER_KEY, username);
      }

      // 1. Flush pending clear if Continue Watching was cleared offline
      if (localStorage.getItem(CW_CLEAR_PENDING_KEY)) {
        try {
          await apiFetch('/api/auth/watch-progress', { method: 'DELETE' });
          localStorage.removeItem(CW_CLEAR_PENDING_KEY);
        } catch (_) {}
      }

      // 2. Gather local guest / pending watched episodes and push to cloud
      const localWatched = readJsonStorage(WATCHED_EPISODES_KEY, []);
      const pendingWeAdd = readJsonStorage(WE_PENDING_ADD_KEY, []);
      const pendingWeDel = readJsonStorage(WE_PENDING_DEL_KEY, []);
      const isFreshGuestLogin = !prevOwner && Array.isArray(localWatched) && localWatched.length > 0;

      const toPushWatched = Array.from(new Set([
        ...(Array.isArray(pendingWeAdd) ? pendingWeAdd : []),
        ...(isFreshGuestLogin ? localWatched : [])
      ])).filter((k) => !(Array.isArray(pendingWeDel) && pendingWeDel.includes(k)));

      if (toPushWatched.length > 0) {
        try {
          await apiFetch('/api/auth/watched-episodes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ keys: toPushWatched })
          });
          writeJsonStorage(WE_PENDING_ADD_KEY, []);
        } catch (_) {}
      }

      if (Array.isArray(pendingWeDel) && pendingWeDel.length > 0) {
        for (const epKey of pendingWeDel) {
          try {
            await apiFetch(`/api/auth/watched-episodes/${encodeURIComponent(epKey)}`, { method: 'DELETE' });
          } catch (_) {}
        }
        writeJsonStorage(WE_PENDING_DEL_KEY, []);
      }

      // 3. Push any local guest or pending Continue Watching items
      const localCwList = readJsonStorage(STORAGE_KEY, []);
      const pendingCwList = readJsonStorage(CW_PENDING_KEY, []);
      const cwToPush = [
        ...(Array.isArray(pendingCwList) ? pendingCwList : []),
        ...(!prevOwner && Array.isArray(localCwList) ? localCwList : [])
      ];
      if (cwToPush.length > 0 && !localStorage.getItem(CW_CLEAR_PENDING_KEY)) {
        for (const entry of cwToPush.slice(0, 15)) {
          if (!entry?.key) continue;
          try {
            await apiFetch('/api/auth/watch-progress', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(entry)
            });
            clearPendingContinueWatching(entry.key);
          } catch (_) {}
        }
      }

      // 4. Fetch authoritative server watch progress & watched episodes in parallel
      const [serverList, serverWatchedResp] = await Promise.all([
        apiFetch('/api/auth/watch-progress').catch(() => null),
        apiFetch('/api/auth/watched-episodes').catch(() => null)
      ]);

      if (Array.isArray(serverList)) {
        const currentPendingCw = readJsonStorage(CW_PENDING_KEY, []);
        const map = new Map();

        for (const item of serverList) {
          if (item?.key) {
            const normItem = { ...item, updatedAt: normalizeTimestamp(item.updatedAt) };
            const group = getSeriesGroupKey(normItem.key);
            const existing = map.get(group);
            if (!existing || (normItem.updatedAt || 0) >= (existing.updatedAt || 0)) {
              map.set(group, normItem);
            }
          }
        }

        if (Array.isArray(currentPendingCw)) {
          for (const item of currentPendingCw) {
            if (!item?.key) continue;
            const normItem = { ...item, updatedAt: normalizeTimestamp(item.updatedAt) };
            const group = getSeriesGroupKey(normItem.key);
            const existing = map.get(group);
            if (!existing || (normItem.updatedAt || 0) >= (existing.updatedAt || 0)) {
              map.set(group, normItem);
            }
          }
        }

        const merged = dedupeBySeries(Array.from(map.values()))
          .filter(isValidContinueEntry)
          .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
          .slice(0, 30);

        writeJsonStorage(STORAGE_KEY, merged);

        // Seed lastViewed per series from synced watchProgress so series page auto-scrolls across devices
        for (const entry of merged) {
          if (!isSeriesItem(entry) || entry.seasonNumber == null) continue;
          const sId = entry.id || entry.tmdbId || entry.seriesId || entry.kartoons_slug || getSeriesGroupKey(entry.key);
          if (!sId) continue;
          const existingLv = getLastViewedEpisode(sId);
          const entryTs = normalizeTimestamp(entry.updatedAt);
          if (!existingLv || entryTs >= (existingLv.updatedAt || 0)) {
            saveLastViewedEpisode(sId, entry.seasonNumber, entry.episodeNumber || 1);
          }
        }

        window.dispatchEvent(new CustomEvent('soulstash:continue-watching-updated'));
      }

      if (serverWatchedResp && Array.isArray(serverWatchedResp.episodes)) {
        const stillPendingAdd = readJsonStorage(WE_PENDING_ADD_KEY, []);
        const stillPendingDel = new Set(Array.isArray(readJsonStorage(WE_PENDING_DEL_KEY, [])) ? readJsonStorage(WE_PENDING_DEL_KEY, []) : []);

        const mergedWatchedSet = new Set(
          serverWatchedResp.episodes
            .map((k) => String(k).toLowerCase().trim())
            .filter((k) => k && !stillPendingDel.has(k))
        );
        if (Array.isArray(stillPendingAdd)) {
          for (const k of stillPendingAdd) {
            if (k && !stillPendingDel.has(k)) mergedWatchedSet.add(k);
          }
        }

        const mergedWatched = Array.from(mergedWatchedSet);
        writeJsonStorage(WATCHED_EPISODES_KEY, mergedWatched);
        window.dispatchEvent(new CustomEvent('soulstash:watched-episodes-updated'));
      }

      lastSyncTime = Date.now();
    } catch (_) {
    } finally {
      activeSyncPromise = null;
    }
  })();

  return activeSyncPromise;
}
