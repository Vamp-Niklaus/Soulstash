/**
 * KartoonWatchModal
 *
 * Direct HLS stream player for Kartoons.me content.
 * Uses the Kartoons Stremio addon to get .m3u8 URLs — no iframe, no external page.
 * Each stream variant (Odelu 1, Odelu 2, etc.) is shown as a server/dub selector tab.
 *
 * Layout and chrome mirrors the existing VideoPlayerModal so the UX is identical.
 */
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { saveWatchProgress, advanceToNextEpisodeOrRemove, getSavedProgress } from '../../utils/watchProgress.js';
import { fetchKartoonsStremioStreams } from '../../api/kartoons.js';

// Hls.js is loaded globally by the existing player infrastructure.
// If it's not on window, we load it on demand.
function getHls() {
  return window.Hls ?? null;
}

async function ensureHlsJs() {
  if (getHls()) return getHls();
  await new Promise((resolve, reject) => {
    const existing = document.getElementById('__hls_script__');
    if (existing) { existing.addEventListener('load', resolve); existing.addEventListener('error', reject); return; }
    const s = document.createElement('script');
    s.id = '__hls_script__';
    s.src = 'https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js';
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return getHls();
}

export function KartoonWatchModal({ title = '', streamType, streamId, subtitle = '', poster = '', onClose }) {
  const [streams, setStreams] = useState([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [status, setStatus] = useState('loading'); // loading | playing | error | nostream
  const [errorMsg, setErrorMsg] = useState('');
  const [showServers, setShowServers] = useState(false);
  const videoRef = useRef(null);
  const hlsRef = useRef(null);

  const kartoonItem = useMemo(() => ({
    id: streamId,
    kartoons_slug: streamId,
    title: title || 'Kartoon Video',
    name: title || 'Kartoon Video',
    seriesTitle: title,
    media_type: streamType === 'series' ? 'Series' : 'Movie',
    is_kartoons: true,
    poster_path: poster || '',
    image: poster || ''
  }), [streamId, title, streamType, poster]);

  const saved = useMemo(() => getSavedProgress(kartoonItem), [kartoonItem]);
  const initialResumeTime = Number(saved?.currentTime) || 0;

  // Lock body scroll while open
  useEffect(() => {
    const prevBody = document.body.style.overflow;
    const prevHtml = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevBody;
      document.documentElement.style.overflow = prevHtml;
    };
  }, []);

  // Fetch streams from Stremio API on mount
  useEffect(() => {
    if (!streamType || !streamId) {
      setStatus('nostream');
      setErrorMsg('No stream ID available for this title.');
      return;
    }
    let cancelled = false;
    setStatus('loading');
    setStreams([]);
    setActiveIdx(0);

    fetchKartoonsStremioStreams(streamType, streamId, false)
      .then((list) => {
        if (cancelled) return;
        setStreams(list);
        setStatus('playing');
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus('nostream');
        setErrorMsg(err.message || 'No stream available for this title right now.');
      });

    return () => { cancelled = true; };
  }, [streamType, streamId]);

  // Load the active stream into the <video> element
  const loadStream = useCallback((idx, streamList) => {
    const list = streamList || streams;
    const stream = list[idx];
    if (!stream?.url) return;
    const video = videoRef.current;
    if (!video) return;

    setShowServers(false);

    // Destroy previous hls instance
    if (hlsRef.current) {
      try { hlsRef.current.destroy(); } catch { /* ignore */ }
      hlsRef.current = null;
    }
    video.removeAttribute('src');

    const isHls = /\.m3u8(\?|$)/i.test(stream.url);

    if (isHls) {
      ensureHlsJs().then((Hls) => {
        if (!Hls) {
          // Safari — native HLS
          video.src = stream.url;
          video.load();
          video.play().catch(() => {});
          return;
        }
        if (!Hls.isSupported()) {
          video.src = stream.url;
          video.load();
          video.play().catch(() => {});
          return;
        }
        const hls = new Hls({
          enableWorker: true,
          startFragPrefetch: true,
          lowLatencyMode: false,
          backBufferLength: 30,
          maxBufferLength: 60,
          maxMaxBufferLength: 120,
          manifestLoadingTimeOut: 15000,
          levelLoadingTimeOut: 15000,
          fragLoadingTimeOut: 30000,
          manifestLoadingMaxRetry: 3,
          levelLoadingMaxRetry: 4,
          fragLoadingMaxRetry: 4,
        });
        hlsRef.current = hls;
        hls.loadSource(stream.url);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          video.play().catch(() => {});
        });
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (!data?.fatal) return;
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) { hls.recoverMediaError(); return; }
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) { try { hls.startLoad(); } catch {} return; }
          // Fatal — try next stream if available
          if (idx + 1 < list.length) {
            setActiveIdx(idx + 1);
          } else {
            setStatus('error');
            setErrorMsg('Stream stopped unexpectedly. Try another server.');
          }
        });
      });
    } else {
      video.src = stream.url;
      video.load();
      video.play().catch(() => {});
    }
  }, [streams]);

  // Load stream whenever activeIdx or streams change
  useEffect(() => {
    if (streams.length && status === 'playing') {
      loadStream(activeIdx, streams);
    }
  }, [activeIdx, streams, status, loadStream]);

  // Cleanup HLS on unmount
  useEffect(() => {
    return () => {
      if (hlsRef.current) {
        try { hlsRef.current.destroy(); } catch { /* ignore */ }
        hlsRef.current = null;
      }
    };
  }, []);

  const handleRetry = () => {
    setStatus('loading');
    setErrorMsg('');
    fetchKartoonsStremioStreams(streamType, streamId, true)
      .then((list) => {
        setStreams(list);
        setActiveIdx(0);
        setStatus('playing');
      })
      .catch((err) => {
        setStatus('nostream');
        setErrorMsg(err.message || 'No stream available. Try again later.');
      });
  };

  const modalMarkup = (
    <div className="fixed inset-0 z-[100010] flex items-center justify-center bg-black/95 p-2 sm:p-5" data-player-modal="true">
      <div className="flex w-full max-w-[1500px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#090909] shadow-2xl" style={{ height: 'min(92dvh, 900px)' }}>

        {/* ── Top chrome bar ── */}
        <div data-player-controls="true" className="flex h-12 shrink-0 items-center gap-2 border-b border-white/10 px-3 sm:px-4">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-white">{title || 'Kartoons Player'}</div>
            {subtitle ? <div className="truncate text-[11px] text-white/50">{subtitle}</div> : null}
          </div>

          {/* Server selector toggle — only show if >1 stream */}
          {streams.length > 1 && (
            <button
              type="button"
              data-player-action="true"
              onClick={() => setShowServers((v) => !v)}
              className="flex h-9 items-center gap-1.5 rounded-full bg-white/10 px-3 text-xs font-medium text-white hover:bg-white/20"
              title="Switch server / dub"
            >
              <i className="fas fa-layer-group text-[11px]" />
              <span className="hidden sm:inline">Servers</span>
            </button>
          )}

          {/* Retry */}
          {(status === 'error' || status === 'nostream') && (
            <button
              type="button"
              data-player-action="true"
              onClick={handleRetry}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
              aria-label="Retry stream"
              title="Retry"
            >
              <i className="fas fa-redo text-xs" />
            </button>
          )}

          {/* Close */}
          <button
            type="button"
            data-player-action="true"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
            aria-label="Close player"
            title="Close"
          >
            <i className="fas fa-times" />
          </button>
        </div>

        {/* ── Player body ── */}
        <div className="relative min-h-0 flex-1 bg-black">

          {/* Loading spinner */}
          {status === 'loading' && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black text-white/60">
              <i className="fas fa-circle-notch fa-spin text-2xl" />
              <span className="text-sm">Resolving stream…</span>
            </div>
          )}

          {/* No-stream / error panel */}
          {(status === 'nostream' || status === 'error') && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 px-8 text-center bg-black">
              <i className="fas fa-exclamation-triangle text-3xl text-white/30" />
              <p className="text-base font-semibold text-white/80">
                {status === 'error' ? 'Playback error' : 'Not available'}
              </p>
              <p className="max-w-xs text-sm text-white/50">
                {errorMsg || 'No stream found for this title right now.'}
              </p>
              <button
                type="button"
                onClick={handleRetry}
                className="mt-2 flex items-center gap-2 rounded-full bg-white/10 px-5 py-2 text-sm text-white hover:bg-white/20"
              >
                <i className="fas fa-redo text-xs" /> Retry
              </button>
            </div>
          )}

          {/* Server selector dropdown */}
          {showServers && streams.length > 1 && (
            <div className="absolute right-3 top-3 z-30 w-56 rounded-xl border border-white/15 bg-[#141414] py-1 shadow-2xl">
              {streams.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => { setActiveIdx(i); setShowServers(false); }}
                  className={`flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm transition-colors ${
                    i === activeIdx
                      ? 'bg-white/10 font-semibold text-white'
                      : 'text-white/70 hover:bg-white/[0.06] hover:text-white'
                  }`}
                >
                  <i className={`fas ${i === activeIdx ? 'fa-dot-circle text-violet-400' : 'fa-circle'} text-[9px]`} />
                  {s.label}
                </button>
              ))}
            </div>
          )}

          {/* Video element — always rendered, hidden while loading/error */}
          <video
            ref={videoRef}
            controls
            autoPlay
            playsInline
            className="h-full w-full object-contain bg-black"
            style={{ display: status === 'playing' ? 'block' : 'none' }}
            onLoadedMetadata={(e) => {
              if (initialResumeTime > 10) {
                try { e.currentTarget.currentTime = initialResumeTime; } catch (_) {}
              }
            }}
            onTimeUpdate={(e) => {
              const v = e.currentTarget;
              if (v.currentTime > 5) {
                saveWatchProgress(kartoonItem, v.currentTime, v.duration);
              }
            }}
            onEnded={() => advanceToNextEpisodeOrRemove(kartoonItem)}
          />
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalMarkup, document.body) : modalMarkup;
}
