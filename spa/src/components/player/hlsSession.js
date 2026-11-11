// Self-healing HLS playback session for the in-app player.
//
// Goals: first frame within ~3-4s, and recover from stalls, dead segments, expired
// worker URLs and decoder errors without the user touching anything.
//
// Recovery ladder (each rung only fires if the previous one did not restore playback):
//   startup:  4s no first frame -> restart at lowest quality
//             9s no first frame -> escalate (caller re-resolves a fresh stream URL)
//   mid-play: 3s frozen -> nudge over buffer holes / restart loading
//             6s frozen -> hls.recoverMediaError()
//             10s frozen -> rebuild the player at the last good position
//             18s frozen -> escalate
//   fatal hls errors: network -> retry load twice, then rebuild; 401/403/404/410 -> escalate
//                     media   -> recoverMediaError, swapAudioCodec, then rebuild

const CDN_URLS = [
  'https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js',
  'https://unpkg.com/hls.js@1/dist/hls.min.js'
];

let hlsPromise = null;

function loadScript(src, timeoutMs) {
  return new Promise((resolve) => {
    const s = document.createElement('script');
    const timer = window.setTimeout(() => {
      s.remove();
      resolve(null);
    }, timeoutMs);
    s.src = src;
    s.async = true;
    s.onload = () => {
      window.clearTimeout(timer);
      resolve(window.Hls || null);
    };
    s.onerror = () => {
      window.clearTimeout(timer);
      s.remove();
      resolve(null);
    };
    document.head.appendChild(s);
  });
}

/**
 * Load hls.js once. Prefers the bundled copy (no network round trip, works offline in the
 * Android/Tauri shells), then falls back to two CDNs. Safe to call early to warm the cache.
 */
export function loadHlsJs() {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (window.Hls) return Promise.resolve(window.Hls);
  if (!hlsPromise) {
    hlsPromise = (async () => {
      try {
        const mod = await import('hls.js');
        const Hls = mod?.default || mod?.Hls;
        if (Hls) return Hls;
      } catch (_) { /* fall through to CDN */ }
      for (const src of CDN_URLS) {
        const Hls = await loadScript(src, 4000);
        if (Hls) return Hls;
      }
      return null;
    })().then((Hls) => {
      if (!Hls) hlsPromise = null; // allow a later retry
      return Hls;
    });
  }
  return hlsPromise;
}

/**
 * play() that never fails silently. Autoplay with sound is blocked on many browsers/WebViews
 * (NotAllowedError); muted autoplay is allowed almost everywhere, so fall back to that.
 * AbortError just means a newer load interrupted this call, which is normal.
 */
export async function safePlay(video) {
  if (!video) return false;
  try {
    await video.play();
    return true;
  } catch (err) {
    if (err?.name === 'NotAllowedError') {
      console.info('[Soulstash Player] autoplay blocked, retrying muted');
      video.muted = true;
      try {
        await video.play();
        return true;
      } catch (err2) {
        console.warn('[Soulstash Player] play() still blocked:', err2?.name);
      }
    } else if (err?.name !== 'AbortError') {
      console.warn('[Soulstash Player] play() rejected:', err?.name, err?.message);
    }
    return false;
  }
}

/** True when `t` (seconds) lies inside a buffered range, so playback can continue there without a download. */
export function isBuffered(video, t) {
  try {
    const b = video.buffered;
    for (let i = 0; i < b.length; i += 1) {
      if (t >= b.start(i) - 0.05 && t <= b.end(i) - 0.05) return true;
    }
  } catch (_) { /* ignore */ }
  return false;
}

/**
 * Real length of the media in seconds. HLS playlists without #EXT-X-ENDLIST (common for worker-served
 * streams) report video.duration === Infinity, which used to clamp the seek bar to ~1s and block every
 * forward seek. Falls back to the playlist's total duration, then the seekable range.
 */
export function getMediaDuration(video, hls) {
  if (!video) return 0;
  if (Number.isFinite(video.duration) && video.duration > 0) return video.duration;
  const h = hls || video.__hls;
  try {
    const levels = h?.levels || [];
    const idx = h && h.currentLevel >= 0 ? h.currentLevel : h?.loadLevel;
    const details = h?.latestLevelDetails || levels[idx]?.details || levels.find((l) => l?.details)?.details;
    if (details?.totalduration > 0) return details.totalduration;
  } catch (_) { /* ignore */ }
  try {
    if (video.seekable && video.seekable.length) {
      const end = video.seekable.end(video.seekable.length - 1);
      if (Number.isFinite(end) && end > 0) return end;
    }
  } catch (_) { /* ignore */ }
  return 0;
}

/** Seek to `time` seconds. Clamps to the real duration and logs whether the target needs a download. */
export function seekTo(video, time, hls) {
  if (!video) return;
  const duration = getMediaDuration(video, hls);
  let target = Math.max(0, Number(time) || 0);
  if (duration > 0) target = Math.min(target, Math.max(0, duration - 0.25));
  console.info('[Soulstash Player] seek', {
    from: Math.round(video.currentTime),
    to: Math.round(target),
    duration: Math.round(duration),
    buffered: isBuffered(video, target)
  });
  video.currentTime = target;
}

const TICK_MS = 500;
const STARTUP_SOFT_MS = 4000;
const STARTUP_HARD_MS = 15000;
const STALL_NUDGE_MS = 3000;
const STALL_RECOVER_MS = 6000;
const STALL_RESTART_MS = 10000;
const STALL_ESCALATE_MS = 18000;
const MAX_RESTARTS = 3;
const REESCALATE_GAP_MS = 8000;
const HEALTHY_RESET_MS = 20000;
const DEAD_URL_CODES = new Set([401, 403, 404, 410]);

function loadPolicy(ttfbMs, loadMs, timeoutRetries, errorRetries) {
  return {
    default: {
      maxTimeToFirstByteMs: ttfbMs,
      maxLoadTimeMs: loadMs,
      timeoutRetry: { maxNumRetry: timeoutRetries, retryDelayMs: 0, maxRetryDelayMs: 0 },
      errorRetry: { maxNumRetry: errorRetries, retryDelayMs: 500, maxRetryDelayMs: 4000 }
    }
  };
}

function buildConfig({ position, lowQuality, isTv }) {
  return {
    enableWorker: true,
    lowLatencyMode: false,
    startPosition: position > 1 ? position : -1,
    startLevel: -1,
    testBandwidth: false,
    abrEwmaDefaultEstimate: 1000000,
    startFragPrefetch: true,
    backBufferLength: isTv ? 15 : 30,
    maxBufferLength: isTv ? 20 : 30,
    maxMaxBufferLength: isTv ? 30 : 60,
    maxBufferSize: isTv ? 30 * 1000 * 1000 : 60 * 1000 * 1000,
    manifestLoadPolicy: loadPolicy(6000, 12000, 2, 2),
    playlistLoadPolicy: loadPolicy(6000, 12000, 2, 3),
    fragLoadPolicy: loadPolicy(8000, 60000, 3, 4),
    nudgeMaxRetry: 8,
    maxBufferHole: 0.5,
    nudgeOffset: 0.2
  };
}

/**
 * Start playing `url` on `video`. Returns { destroy }.
 *
 * @param {object}   opts
 * @param {Function} opts.Hls           hls.js constructor (may be null -> native HLS)
 * @param {HTMLVideoElement} opts.video
 * @param {string}   opts.url
 * @param {number}   [opts.startAt]     position (seconds) to start from
 * @param {boolean}  [opts.isTv]
 * @param {{current:number}} [opts.resumeRef] updated before every rebuild so the video's
 *                                      loadedmetadata handler seeks to the right place
 * @param {{current:any}}    [opts.hlsRef]  mirrors the live hls instance (for UI controls)
 * @param {Function} [opts.onManifest]
 * @param {Function} [opts.onBuffered]
 * @param {Function} [opts.onEscalate]  (reason) => void; the caller re-resolves or switches source
 */
export function startHlsSession({
  Hls,
  video,
  url,
  startAt = 0,
  isTv = false,
  resumeRef = null,
  hlsRef = null,
  onManifest,
  onBuffered,
  onEscalate
}) {
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const log = (...args) => console.info('[Soulstash Player][hls]', ...args);

  let destroyed = false;
  let engine = null;
  let started = false;
  let softRestartDone = false;
  let restarts = 0;
  let netRetries = 0;
  let mediaRetries = 0;
  let stage = 0;
  let stallSince = 0;
  let lastTime = -1;
  let lastGoodTime = startAt > 10 ? startAt : 0;
  let healthySince = 0;
  let lastEscalateAt = -Infinity;
  let lastMediaFailAt = -Infinity;
  let attemptStart = now();
  const timers = new Set();
  let seekGraceUntil = 0;
  let seekStartedAt = 0;
  let seekKickTimer = 0;
  // Where recovery should load from: the last position we know was good (updated on every seek).
  const resumePoint = () => (lastGoodTime > 1 ? lastGoodTime : -1);

  const later = (fn, ms) => {
    const id = window.setTimeout(() => {
      timers.delete(id);
      if (!destroyed) fn();
    }, ms);
    timers.add(id);
    return id;
  };

  const escalate = (reason) => {
    const t = now();
    if (destroyed || t - lastEscalateAt < REESCALATE_GAP_MS) return;
    lastEscalateAt = t;
    log('escalating:', reason);
    onEscalate?.(reason);
  };

  const teardownEngine = () => {
    if (engine) {
      const old = engine;
      engine = null;
      try { old.destroy(); } catch (_) { /* ignore */ }
      if (hlsRef && hlsRef.current === old) hlsRef.current = null;
      if (video.__hls === old) video.__hls = null;
    } else {
      try { video.removeAttribute('src'); video.load(); } catch (_) { /* ignore */ }
    }
  };

  const attach = (position, lowQuality) => {
    teardownEngine();
    if (destroyed) return;

    if (Hls && Hls.isSupported()) {
      const hls = new Hls(buildConfig({ position, lowQuality, isTv }));
      engine = hls;
      if (hlsRef) hlsRef.current = hls;
      video.__hls = hls; // lets seek helpers read the playlist duration without prop drilling

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (engine !== hls) return;
        onManifest?.();
        safePlay(video);
      });
      hls.on(Hls.Events.FRAG_BUFFERED, () => {
        if (engine !== hls) return;
        onBuffered?.();
      });
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (engine !== hls || !data?.fatal) return;
        const code = data?.response?.code || 0;

        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          // Expired token / removed segment: retrying the same URL is pointless.
          if (DEAD_URL_CODES.has(code)) {
            escalate(`http-${code}`);
            return;
          }
          netRetries += 1;
          if (netRetries <= 2) {
            later(() => {
              if (engine !== hls) return;
              try { hls.startLoad(resumePoint()); } catch (_) { /* ignore */ }
            }, 400 * netRetries);
            return;
          }
          restart('network-error');
          return;
        }

        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          mediaFailure();
          return;
        }

        restart(`fatal-${data.details || 'unknown'}`);
      });

      hls.loadSource(url);
      hls.attachMedia(video);
      // MANIFEST_PARSED can fire before the media is ready; retry once when it can actually play.
      video.addEventListener('canplay', () => {
        if (engine === hls && video.paused && !video.ended) safePlay(video);
      }, { once: true });
    } else {
      // Native HLS (iPhone Safari etc.) or no hls.js available.
      video.src = url;
      video.load();
      safePlay(video);
    }
  };

  function restart(reason, { lowQuality = false, keepAttemptClock = false } = {}) {
    if (destroyed) return;
    if (restarts >= MAX_RESTARTS) {
      escalate(`${reason}-restarts-exhausted`);
      return;
    }
    restarts += 1;
    const position = lastGoodTime > 1 ? lastGoodTime : (startAt > 10 ? startAt : 0);
    log(`restart #${restarts} (${reason}) at ${Math.round(position)}s`);
    if (resumeRef) resumeRef.current = position;
    started = false;
    stage = 0;
    stallSince = 0;
    lastTime = -1;
    if (!keepAttemptClock) attemptStart = now();
    attach(position, lowQuality);
  }

  function mediaFailure() {
    const t = now();
    if (t - lastMediaFailAt < 1000) return; // hls.js + <video> both report the same failure
    lastMediaFailAt = t;
    mediaRetries += 1;
    if (engine && mediaRetries === 1) {
      try { engine.recoverMediaError(); } catch (_) { /* ignore */ }
    } else if (engine && mediaRetries === 2) {
      try { engine.swapAudioCodec(); engine.recoverMediaError(); } catch (_) { /* ignore */ }
    } else {
      restart('media-error');
    }
  }

  const nudge = () => {
    try { engine?.startLoad(resumePoint()); } catch (_) { /* ignore */ }
    try {
      const buf = video.buffered;
      const cur = video.currentTime;
      for (let i = 0; i < buf.length; i += 1) {
        const s = buf.start(i);
        if (s > cur && s - cur < 3) {
          video.currentTime = s + 0.05; // hop over a hole in the buffer
          break;
        }
      }
    } catch (_) { /* ignore */ }
    safePlay(video);
  };

  const onVideoError = () => {
    if (destroyed) return;
    log('video element error', video.error?.code);
    mediaFailure();
  };
  video.addEventListener('error', onVideoError);

  // Seeking: a seek to an unbuffered spot looks exactly like a stall (time frozen while the chunk
  // downloads). Without this, recovery restarted loading from the position *before* the seek, which
  // replayed the old chunks. Now every seek resets the stall clock, moves the recovery point to the
  // target, and kicks the loader if the target chunk has not started downloading.
  const onSeeking = () => {
    if (destroyed) return;
    const target = video.currentTime;
    seekStartedAt = now();
    seekGraceUntil = seekStartedAt + 4000;
    stallSince = 0;
    stage = 0;
    lastTime = target;
    if (target > 0.5) lastGoodTime = target;
    const buffered = isBuffered(video, target);
    log(`seeking to ${target.toFixed(1)}s`, buffered ? '(already buffered)' : '(needs download)');
    window.clearTimeout(seekKickTimer);
    if (!buffered) {
      seekKickTimer = window.setTimeout(() => {
        if (destroyed || !engine || !video.seeking || isBuffered(video, video.currentTime)) return;
        log(`seek target still not loading, restarting load at ${video.currentTime.toFixed(1)}s`);
        try { engine.startLoad(video.currentTime); } catch (_) { /* ignore */ }
      }, 1500);
    }
  };
  const onSeeked = () => {
    if (destroyed) return;
    window.clearTimeout(seekKickTimer);
    stallSince = 0;
    stage = 0;
    lastTime = video.currentTime;
    if (video.currentTime > 0.5) lastGoodTime = video.currentTime;
    log(`seeked to ${video.currentTime.toFixed(1)}s in ${Math.round(now() - seekStartedAt)}ms`);
  };
  video.addEventListener('seeking', onSeeking);
  video.addEventListener('seeked', onSeeked);

  const tick = () => {
    if (destroyed) return;
    const t = now();
    const cur = video.currentTime;

    if (!started) {
      if (video.readyState >= 2) {
        started = true;
        healthySince = t;
        lastTime = cur;
        log(`first frame after ${Math.round(t - attemptStart)}ms`);
        return;
      }
      // Never restart a load that is still progressing; only give up after a long wait.
      if (t - attemptStart >= STARTUP_HARD_MS) escalate('startup-timeout');
      return;
    }
    // Still waiting for a seek target to download: give it time before any recovery step.
    if (video.seeking && t < seekGraceUntil) {
      stallSince = 0;
      lastTime = cur;
      return;
    }
    // User paused or finished: nothing to recover.
    if (video.paused || video.ended) {
      stallSince = 0;
      lastTime = cur;
      return;
    }

    if (Math.abs(cur - lastTime) > 0.01) {
      lastTime = cur;
      if (cur > 5) lastGoodTime = cur;
      if (stallSince) {
        stallSince = 0;
        stage = 0;
        healthySince = t;
      } else if (healthySince && t - healthySince > HEALTHY_RESET_MS) {
        restarts = 0;
        netRetries = 0;
        mediaRetries = 0;
      }
      return;
    }

    if (!stallSince) {
      stallSince = t;
      stage = 0;
      return;
    }

    const stalled = t - stallSince;
    if (stalled >= STALL_ESCALATE_MS) {
      stallSince = t;
      escalate('stall');
    } else if (stalled >= STALL_RESTART_MS && stage < 3) {
      stage = 3;
      restart('stall');
    } else if (stalled >= STALL_RECOVER_MS && stage < 2) {
      stage = 2;
      try { engine?.recoverMediaError(); } catch (_) { /* ignore */ }
    } else if (stalled >= STALL_NUDGE_MS && stage < 1) {
      stage = 1;
      nudge();
    }
  };

  const interval = window.setInterval(tick, TICK_MS);

  attach(lastGoodTime, false);

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      window.clearInterval(interval);
      timers.forEach((id) => window.clearTimeout(id));
      timers.clear();
      video.removeEventListener('error', onVideoError);
      video.removeEventListener('seeking', onSeeking);
      video.removeEventListener('seeked', onSeeked);
      window.clearTimeout(seekKickTimer);
      teardownEngine();
    }
  };
}
