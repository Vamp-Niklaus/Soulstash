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

const TICK_MS = 500;
const STARTUP_SOFT_MS = 4000;
const STARTUP_HARD_MS = 9000;
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
    startPosition: position > 10 ? position : -1,
    startLevel: lowQuality ? 0 : -1,
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

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (engine !== hls) return;
        onManifest?.();
        video.play().catch(() => {});
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
              try { hls.startLoad(lastGoodTime > 10 ? lastGoodTime : -1); } catch (_) { /* ignore */ }
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
    } else {
      // Native HLS (iPhone Safari etc.) or no hls.js available.
      video.src = url;
      video.load();
      video.play().catch(() => {});
    }
  };

  function restart(reason, { lowQuality = false, keepAttemptClock = false } = {}) {
    if (destroyed) return;
    if (restarts >= MAX_RESTARTS) {
      escalate(`${reason}-restarts-exhausted`);
      return;
    }
    restarts += 1;
    const position = lastGoodTime > 10 ? lastGoodTime : (startAt > 10 ? startAt : 0);
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
    try { engine?.startLoad(lastGoodTime > 10 ? lastGoodTime : -1); } catch (_) { /* ignore */ }
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
    video.play().catch(() => {});
  };

  const onVideoError = () => {
    if (destroyed) return;
    log('video element error', video.error?.code);
    mediaFailure();
  };
  video.addEventListener('error', onVideoError);

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
      const waited = t - attemptStart;
      if (waited >= STARTUP_HARD_MS) {
        escalate('startup-timeout');
      } else if (!softRestartDone && waited >= STARTUP_SOFT_MS) {
        softRestartDone = true;
        restart('startup-slow', { lowQuality: true, keepAttemptClock: true });
      }
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
      teardownEngine();
    }
  };
}
