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

export function getContinueWatchingList() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list
      .filter((entry) => {
        if (!entry || !entry.key) return false;
        const poster = entry.poster_path || entry.image;
        if (!poster || !String(poster).trim() || String(poster).startsWith('data:image/svg+xml')) return false;
        const time = Number(entry.currentTime) || 0;
        const duration = Number(entry.duration) || 0;
        if (time < MIN_TIME_SECONDS) return false;
        if (duration > 0) {
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

export function saveWatchProgress(item, currentTime, duration) {
  if (!item) return;
  const key = getProgressItemKey(item);
  if (!key) return;

  const time = Number(currentTime) || 0;
  const dur = Number(duration) || 0;
  if (time < MIN_TIME_SECONDS) return;

  const isCompleted = dur > 0 && (time / dur >= COMPLETION_THRESHOLD || time >= dur - 30);

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    let list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) list = [];

    // Remove any existing entry for this key
    list = list.filter((x) => x.key !== key);

    if (!isCompleted) {
      const poster = item.poster_path || item.image || item.coverImage || '';
      const backdrop = item.backdrop_path || item.backdrop || item.coverImage || item.image || '';
      const title = item.title || item.name || item.seriesTitle || 'Unknown';
      const mediaType = (item.media_type || item.type || (item.seasonNumber || item.episodeNumber ? 'Series' : 'Movie'));

      list.unshift({
        key,
        id: item.id || item.tmdbId || item.movieId || item.seriesId || item.kartoons_slug || item.slug,
        title,
        name: title,
        seriesTitle: item.seriesTitle || item.name || '',
        seasonNumber: item.seasonNumber ?? item.season ?? null,
        episodeNumber: item.episodeNumber ?? item.episode ?? null,
        poster_path: poster,
        image: poster,
        backdrop_path: backdrop,
        media_type: mediaType,
        is_kartoons: Boolean(item.is_kartoons || item.isKartoons || String(item.id || '').startsWith('kartoons-')),
        kartoons_slug: item.kartoons_slug || item.slug || '',
        currentTime: Math.floor(time),
        duration: Math.floor(dur),
        progress: dur > 0 ? Math.min(1, time / dur) : 0,
        updatedAt: Date.now()
      });

      // Keep at most 30 recent items
      if (list.length > 30) list = list.slice(0, 30);
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    window.dispatchEvent(new CustomEvent('soulstash:continue-watching-updated'));
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
  } catch (_) {}
}
