import { setNativeScale } from '../../utils/formatters.js';
import { useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { SESSION_SCRAPED } from '../../utils/constants.js';
import { isDirectMediaUrl } from '../../utils/formatters.js';
import { DirectVideoControls } from './DirectVideoControls.jsx';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { ScreenOrientation } from '@capacitor/screen-orientation';
import { getRotationMode } from '../../utils/rotation.js';
import React, { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from '../../utils/toast.js';
import { apiFetch } from '../../api/client.js';
import { ActionButton } from '../ui/ActionButton.jsx';
import {
  fetchKartoonsStremioStreams,
  resolveKartoonsEpisodeId,
  resolveKartoonsMovieId,
  searchKartoonsShows,
  searchKartoonsMovies
} from '../../api/kartoons.js';
import { findKartoonsMatch } from '../../utils/kartoonsSearch.js';
import { useAppLayoutMode } from '../../hooks/useAppLayoutMode.js';

// Native tap plugin for Android TV cross-origin iframe focus
const NativeTap = registerPlugin('NativeTap');

async function nativeTapCenter(el) {
  if (!Capacitor.isNativePlatform() || !el) return;
  const r = el.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  try {
    await NativeTap.tap({
      x: (r.left + r.width / 2) * dpr,
      y: (r.top + r.height / 2) * dpr,
    });
    console.info('[NativeTap] tapped center of iframe', {
      x: (r.left + r.width / 2) * dpr,
      y: (r.top + r.height / 2) * dpr,
    });
  } catch (err) {
    console.warn('[NativeTap] tap failed', err);
  }
}

// Assume PlayerErrorBoundary is imported
import { PlayerErrorBoundary } from './PlayerErrorBoundary.jsx';

// Assume buildPlayerSourceSlots is imported
import { buildPlayerSourceSlots, firstPlayableUrl, sourceKeyText } from '../../utils/playerUtils.js';
import { saveWatchProgress, removeWatchProgress, getSavedProgress } from '../../utils/watchProgress.js';

function getHls() {
  return window.Hls ?? null;
}

async function ensureHlsJs() {
  if (getHls()) return getHls();
  await new Promise((resolve) => {
    const existing = document.getElementById('__hls_script__');
    if (existing) {
      if (window.Hls) { resolve(window.Hls); return; }
      existing.addEventListener('load', () => resolve(window.Hls));
      setTimeout(() => resolve(window.Hls), 1500);
      return;
    }
    const s = document.createElement('script');
    s.id = '__hls_script__';
    s.src = 'https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js';
    s.onload = () => resolve(window.Hls);
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
  return getHls();
}

export function VideoPlayerModal({ request, onClose }) {
  const isValidRequest = Boolean(request?.tmdbId || request?.kartoonsSlug || request?.kartoonsEpisodeId);
  const [selectedGroup, setSelectedGroup] = useState('hindi');
  const [hindiSources, setHindiSources] = useState([]);
  const [animeSources, setAnimeSources] = useState([]);
  const [kartoonSources, setKartoonSources] = useState([]);
  const [kartoonResolveDone, setKartoonResolveDone] = useState(false);
  const [kartoonRetryKey, setKartoonRetryKey] = useState(0);
  const [hlsForcedUrl, setHlsForcedUrl] = useState('');
  const kartoonAutoRetriedRef = useRef(false);
  const resumeAfterRetryRef = useRef(0);
  const [anilistId, setAnilistId] = useState(null);
  const [activeUrl, setActiveUrl] = useState('');
  const [hasManualSourceSelection, setHasManualSourceSelection] = useState(false);
  const [sourceSignature, setSourceSignature] = useState('');
  const [failedUrls, setFailedUrls] = useState(() => new Set());
  const [verifiedUrls, setVerifiedUrls] = useState(() => new Set());
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [draggingPlayer, setDraggingPlayer] = useState(false);
  const [iframeReloadKey, setIframeReloadKey] = useState(0);
  const [scale, setScale] = useState(1.0);
  const [sourcesExpanded, setSourcesExpanded] = useState(false);
  const [playerDisplayMode, setPlayerDisplayMode] = useState(1);
  const [isStreamLoading, setIsStreamLoading] = useState(true);
  const [isDirectVideoPlaying, setIsDirectVideoPlaying] = useState(false);
  const [isSizeFocusedVisual, setIsSizeFocusedVisual] = useState(false);
  const iframeRef = useRef(null);
  const directVideoRef = useRef(null);
  const mediaAreaRef = useRef(null);
  const fullscreenButtonRef = useRef(null);
  const sourceToggleRef = useRef(null);
  const sourceHideRef = useRef(null);
  const focusSourceAfterExpandRef = useRef(false);
  const playerDisplayModeRef = useRef(1);
  const openerRef = useRef(typeof document !== 'undefined' ? document.activeElement : null);
  // Tracks active focus zone: 'playback' | 'controls'
  const focusZoneRef = useRef('playback');
  // Tracks where focus was last targeted in the player: 'size' | 'controls' | 'iframe'
  const playerFocusTargetRef = useRef('iframe');
  // Timestamp when Size button was last focused
  const sizeFocusLastAtRef = useRef(0);
  const sizeFocusedRef = useRef(false);
  const hlsInstanceRef = useRef(null);
  const hlsErrorHandlerRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const lastTelemetryTimeRef = useRef(0);
  const autoSwitchedToKartoonRef = useRef(false);
  
  const playerBoxRef = useRef(null);
  const dragStateRef = useRef(null);
  const isDesktopViewport = typeof window !== 'undefined' ? window.innerWidth >= 768 : true;
  const isAndroidViewport = !isDesktopViewport;
  const modalPadding = 16;
  const controlsHeight = isAndroidViewport ? 40 : 44;
  const verticalInset = isDesktopViewport ? 10 : 36;
  const chromeAllowance = isDesktopViewport ? 134 : 126;
  const widthLimit = isDesktopViewport ? '99vw' : '96vw';
  const maxPlayerWidth = isDesktopViewport ? '1760px' : '1400px';
  const fallbackSources = Array.isArray(request?.fallbackSources)
    ? request.fallbackSources.filter((source) => source?.url)
    : [];

  const savedProgress = useMemo(() => getSavedProgress(request), [request]);
  const initialResumeTime = Number(request?.resumeTime || savedProgress?.currentTime) || 0;
  const latestPlaybackTimeRef = useRef(initialResumeTime);
  const requestRef = useRef(request);
  useEffect(() => {
    requestRef.current = request;
  }, [request]);

  useEffect(() => {
    return () => {
      if (latestPlaybackTimeRef.current >= 5 && requestRef.current) {
        const req = requestRef.current;
        const estDuration = Number(req?.duration) || (Number(req?.runtime) ? req.runtime * 60 : (req?.mediaType === 'movie' ? 7200 : 1440));
        saveWatchProgress(req, latestPlaybackTimeRef.current, estDuration);
      }
    };
  }, []);

  const resolvedEmbedUrl = useMemo(() => {
    if (!activeUrl) return '';
    if (initialResumeTime <= 5) return activeUrl;
    try {
      const u = new URL(activeUrl);
      const host = u.hostname.toLowerCase();
      const t = Math.floor(initialResumeTime);
      if (host.includes('vidbolt') || host.includes('vidfast') || host.includes('vidrift')) {
        if (!u.searchParams.has('startAt')) u.searchParams.set('startAt', String(t));
      }
      if (host.includes('framex') || host.includes('framextv')) {
        if (!u.searchParams.has('t') && !u.searchParams.has('start')) u.searchParams.set('t', String(t));
      }
      return u.toString();
    } catch (_) {
      return activeUrl;
    }
  }, [activeUrl, initialResumeTime]);

  const { isTvLayout } = useAppLayoutMode();
  const isTv = isTvLayout || (typeof document !== 'undefined' && document.documentElement.classList.contains('layout-tv-mode'));

  const [tvControlsVisible, setTvControlsVisible] = useState(true);
  const tvHideTimerRef = useRef(null);

  const updatePlayerDisplayMode = useCallback((mode) => {
    playerDisplayModeRef.current = mode;
    if (mode >= 2) {
      setDragOffset({ x: 0, y: 0 });
    }
    setPlayerDisplayMode(mode);
  }, []);

  const focusPlaybackContext = useCallback((reason, preferredTarget = null) => {
    focusZoneRef.current = 'playback';
    playerFocusTargetRef.current = 'iframe';
    sizeFocusedRef.current = false;
    setIsSizeFocusedVisual(false);
    const resolveTarget = () => {
      if (preferredTarget?.isConnected) return preferredTarget;
      const target = isDirectMediaUrl(activeUrl) ? directVideoRef.current : iframeRef.current;
      return target?.isConnected ? target : null;
    };

    const initialTarget = resolveTarget();
    if (!initialTarget) {
      console.warn('[Soulstash Player Focus] playback target unavailable', {
        reason,
        mode: playerDisplayModeRef.current,
        activeUrlPresent: Boolean(activeUrl),
        iframePresent: Boolean(iframeRef.current?.isConnected),
        videoPresent: Boolean(directVideoRef.current?.isConnected)
      });
      return false;
    }

    // Wait for the mode/fullscreen layout to settle, then re-read the ref in
    // case a source change replaced the iframe while the request was pending.
    window.requestAnimationFrame(() => {
      const target = resolveTarget();
      if (!target) {
        console.warn('[Soulstash Player Focus] playback target disappeared before focus', {
          reason,
          mode: playerDisplayModeRef.current
        });
        return;
      }

      let focusError = null;
      try {
        target.focus({ preventScroll: true });
        if (target.tagName === 'IFRAME') target.contentWindow?.focus?.();
      } catch (error) {
        focusError = error;
      }

      const rect = target.getBoundingClientRect();
      console.info('[Soulstash Player Focus] playback focus result', {
        reason,
        mode: playerDisplayModeRef.current,
        target: target.tagName,
        connected: target.isConnected,
        parentDocumentFocusedFrame: document.activeElement === target,
        activeElement: document.activeElement?.tagName || null,
        frameCenter: {
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2)
        },
        fullscreenElement: (document.fullscreenElement || document.webkitFullscreenElement)?.tagName || null,
        focusError: focusError?.message || null,
        crossOriginFrameContents: target.tagName === 'IFRAME'
          ? 'not inspectable or directly focusable from the parent document'
          : 'same-origin video element'
      });
    });
    return true;
  }, [activeUrl]);

  const focusSizeControl = useCallback(() => {
    focusZoneRef.current = 'controls';
    playerFocusTargetRef.current = 'size';
    sizeFocusLastAtRef.current = Date.now();
    sizeFocusedRef.current = true;
    setIsSizeFocusedVisual(true);
    window.requestAnimationFrame(() => {
      const target = fullscreenButtonRef.current || playerBoxRef.current?.querySelector('button[data-player-size="true"]');
      if (!target?.isConnected) {
        console.warn('[Soulstash Player Focus] size control unavailable');
        return;
      }
      document.querySelectorAll('.tv-focused').forEach((el) => el.classList.remove('tv-focused'));
      target.classList.add('tv-focused');
      document.documentElement.classList.add('tv-nav-active');
      document.documentElement.classList.remove('tv-nav-dim', 'tv-nav-hidden');
      target.focus({ preventScroll: true });
      console.info('[Soulstash Player Focus] size control focused', {
        parentDocumentFocusedControl: document.activeElement === target
      });
    });
  }, []);

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const isClosingRef = useRef(false);

  const wakeTvControls = useCallback(() => {
    setTvControlsVisible(true);
    if (tvHideTimerRef.current) clearTimeout(tvHideTimerRef.current);
    if (isTv) {
      tvHideTimerRef.current = setTimeout(() => {
        setTvControlsVisible(false);
      }, 4000);
    }
  }, [isTv]);

  const handleCloseClick = useCallback(() => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;

    if (latestPlaybackTimeRef.current >= 5 && requestRef.current) {
      const req = requestRef.current;
      const estDuration = Number(req?.duration) || (Number(req?.runtime) ? req.runtime * 60 : (req?.mediaType === 'movie' ? 7200 : 1440));
      saveWatchProgress(req, latestPlaybackTimeRef.current, estDuration);
    }

    try {
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      }
    } catch (e) {}

    if (Capacitor.isNativePlatform()) {
      try {
        const rot = localStorage.getItem('ss_rotation_mode') || 'sensor';
        if (rot === 'portrait') {
          ScreenOrientation.lock({ orientation: 'portrait' }).catch(() => {});
        } else if (rot === 'landscape') {
          ScreenOrientation.lock({ orientation: 'landscape' }).catch(() => {});
        }
      } catch (e) {}
    }

    if (window.history.state?.playerOpen) {
      try {
        window.history.back();
      } catch (e) {}
    }
    if (onCloseRef.current) {
      onCloseRef.current();
    }
    window.requestAnimationFrame(() => {
      if (openerRef.current?.isConnected) openerRef.current.focus({ preventScroll: true });
    });
  }, []);

  const prevDisplayModeRef = useRef(playerDisplayMode);
  useEffect(() => {
    if ((playerDisplayMode === 1 || playerDisplayMode === 2) && prevDisplayModeRef.current === 3) {
      console.info(`[Soulstash Player Focus] Entered mode ${playerDisplayMode} from mode 3, focusing Size control`);
      focusSizeControl();
    } else if (playerDisplayMode === 1 && prevDisplayModeRef.current > 1) {
      console.info('[Soulstash Player Focus] Entered mode 1 from higher mode, focusing Size control');
      focusSizeControl();
    }
    prevDisplayModeRef.current = playerDisplayMode;
  }, [playerDisplayMode, focusSizeControl]);

  useEffect(() => {
    const isExpanded = playerDisplayMode >= 2;
    document.body.classList.toggle('player-fullscreen-active', isExpanded);
    return () => {
      document.body.classList.remove('player-fullscreen-active');
    };
  }, [playerDisplayMode]);

  useEffect(() => {
    const handlePlaybackTelemetry = (event) => {
      const data = event?.data;
      if (!data) return;

      let time = null;
      let duration = null;
      let isEnded = false;

      // VidRift
      if (data.type === 'vidrift:progress') {
        time = Number(data.currentTime);
        duration = Number(data.duration);
      } else if (data.type === 'vidrift:ended') {
        isEnded = true;
      }
      // VidBolt
      else if (data.event === 'timeupdate' || data.type === 'timeupdate') {
        time = Number(data.time ?? data.currentTime);
        duration = Number(data.duration);
      } else if (data.event === 'ended' || data.type === 'ended') {
        isEnded = true;
      }
      // VidFast
      else if (data.type === 'PLAYER_EVENT' && data.data) {
        if (data.data.event === 'ended') {
          isEnded = true;
        } else if (data.data.event === 'timeupdate' || data.data.currentTime != null) {
          time = Number(data.data.currentTime);
          duration = Number(data.data.duration);
        }
      } else if (data.type === 'MEDIA_DATA' && data.data) {
        time = Number(data.data.currentTime);
        duration = Number(data.data.duration);
      }
      // FrameXTV
      else if (data.event === 'frameXTV:timeupdate') {
        time = Number(data.currentTime);
        duration = Number(data.duration);
      }
      // Vidly
      else if (data.type === 'VIDLY_PLAYER_EVENT' && data.data) {
        if (data.data.event === 'ended') {
          isEnded = true;
        } else if (data.data.currentTime != null) {
          time = Number(data.data.currentTime);
          duration = Number(data.data.duration);
        }
      } else if (data.type === 'SYNC_HISTORY' && data.data) {
        time = Number(data.data.watched);
        duration = Number(data.data.duration);
      }
      // Generic
      else if (typeof data.currentTime === 'number' && Number.isFinite(data.currentTime)) {
        time = data.currentTime;
        duration = Number(data.duration);
      }

      if (isEnded) {
        removeWatchProgress(request);
        return;
      }

      if (time != null && Number.isFinite(time) && time > 5) {
        lastTelemetryTimeRef.current = Date.now();
        latestPlaybackTimeRef.current = time;
        saveWatchProgress(request, time, duration);
      }
    };

    window.addEventListener('message', handlePlaybackTelemetry);
    return () => window.removeEventListener('message', handlePlaybackTelemetry);
  }, [request]);

  // Reliable watch-progress heartbeat timer for players/iframes that don't emit postMessage telemetry
  useEffect(() => {
    if (!activeUrl || isStreamLoading) return undefined;
    const startTime = Date.now();
    const baseResumeTime = Number(initialResumeTime) || 0;
    const estDuration = Number(request?.duration) || (Number(request?.runtime) ? request.runtime * 60 : (request?.mediaType === 'movie' ? 7200 : 1440));

    const interval = setInterval(() => {
      // If telemetry already gave us fresh updates within 10s, don't overwrite with elapsed
      if (Date.now() - lastTelemetryTimeRef.current < 10000) return;
      const elapsedSeconds = baseResumeTime + Math.floor((Date.now() - startTime) / 1000);
      if (elapsedSeconds >= 5) {
        latestPlaybackTimeRef.current = elapsedSeconds;
        saveWatchProgress(request, elapsedSeconds, estDuration);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [activeUrl, isStreamLoading, initialResumeTime, request]);

  useEffect(() => {
    const handleIframeActivate = (e) => {
      const frame = e.detail?.target || iframeRef.current;
      focusZoneRef.current = 'playback';
      playerFocusTargetRef.current = 'iframe';
      sizeFocusedRef.current = false;
      setIsSizeFocusedVisual(false);
      if (frame && Capacitor.isNativePlatform()) {
        console.info('[Soulstash Player] OK/Enter on iframe boundary -> calling nativeTapCenter');
        nativeTapCenter(frame);
      }
    };
    window.addEventListener('soulstash:player-iframe-activate', handleIframeActivate);
    return () => window.removeEventListener('soulstash:player-iframe-activate', handleIframeActivate);
  }, []);

  const returnToDefaultPlayerMode = useCallback(() => {
    try {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit && (document.fullscreenElement || document.webkitFullscreenElement)) {
        Promise.resolve(exit.call(document)).catch(() => {});
      }
    } catch (_) {}

    setSourcesExpanded(false);
    updatePlayerDisplayMode(1);
    setTvControlsVisible(true);
    if (tvHideTimerRef.current) clearTimeout(tvHideTimerRef.current);
    if (isTv) {
      tvHideTimerRef.current = setTimeout(() => setTvControlsVisible(false), 4000);
    }
  }, [isTv, updatePlayerDisplayMode]);

  const handlePlayerBackEvent = useCallback((event) => {
    event?.preventDefault?.();
    const mode = playerDisplayModeRef.current;
    const isPlaybackFocused = focusZoneRef.current === 'playback';

    if (mode === 3) {
      try {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (exit && (document.fullscreenElement || document.webkitFullscreenElement)) {
          Promise.resolve(exit.call(document)).catch(() => {});
        }
      } catch (_) {}

      updatePlayerDisplayMode(2);
      setSourcesExpanded(true);
      focusSizeControl();
      return;
    }

    if (mode === 2) {
      if (isPlaybackFocused) {
        focusSizeControl();
        return;
      }

      setSourcesExpanded(false);
      updatePlayerDisplayMode(1);
      focusSizeControl();
      return;
    }

    if (sourcesExpanded) {
      setSourcesExpanded(false);
      focusSizeControl();
      return;
    }

    if (isPlaybackFocused) {
      focusSizeControl();
      return;
    }

    handleCloseClick();
  }, [focusSizeControl, handleCloseClick, sourcesExpanded, updatePlayerDisplayMode]);

  useEffect(() => {
    window.addEventListener('soulstash:player-back', handlePlayerBackEvent);
    window.addEventListener('soulstash:native-back', handlePlayerBackEvent);
    return () => {
      window.removeEventListener('soulstash:player-back', handlePlayerBackEvent);
      window.removeEventListener('soulstash:native-back', handlePlayerBackEvent);
    };
  }, [handlePlayerBackEvent]);

  useEffect(() => {
    if (!isTv) return;
    wakeTvControls();
    const handleActivity = () => wakeTvControls();
    window.addEventListener('mousemove', handleActivity);
    // The TV spatial-nav handler runs during document capture and may stop
    // propagation, so wake the chrome before the event reaches the document.
    window.addEventListener('keydown', handleActivity, true);
    return () => {
      if (tvHideTimerRef.current) clearTimeout(tvHideTimerRef.current);
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('keydown', handleActivity, true);
    };
  }, [isTv, wakeTvControls]);

  const handleToggleFullscreen = useCallback(async () => {
    const mode = playerDisplayModeRef.current;
    if (mode === 1) {
      setSourcesExpanded(true);
      updatePlayerDisplayMode(2);
      console.info('[Soulstash Player Focus] player mode transition', { from: 1, to: 2 });
      focusSizeControl();
      return;
    }

    if (mode === 2) {
      setSourcesExpanded(false);
      const target = isDirectMediaUrl(activeUrl) ? directVideoRef.current : iframeRef.current;
      if (!target?.isConnected) {
        console.warn('[Soulstash Player Focus] mode 3 requested without a live playback target', {
          activeUrlPresent: Boolean(activeUrl),
          iframePresent: Boolean(iframeRef.current?.isConnected),
          videoPresent: Boolean(directVideoRef.current?.isConnected)
        });
        return;
      }
      try {
        const request = target.requestFullscreen || target.webkitRequestFullscreen;
        if (request) {
          await Promise.resolve(request.call(target));
          console.info('[Soulstash Player Focus] fullscreen request resolved', {
            target: target.tagName,
            fullscreenElement: (document.fullscreenElement || document.webkitFullscreenElement)?.tagName || null
          });
        } else {
          console.info('[Soulstash Player Focus] fullscreen API unavailable; using mode 3 player layout', {
            target: target.tagName
          });
        }
      } catch (err) {
        console.warn('[Player] Stream fullscreen request failed; using the full player view:', err);
      }
      updatePlayerDisplayMode(3);
      console.info('[Soulstash Player Focus] player mode transition', { from: 2, to: 3, target: target.tagName });
      focusPlaybackContext('mode-3-enter', target);
      return;
    }

    returnToDefaultPlayerMode();
  }, [activeUrl, focusPlaybackContext, focusSizeControl, returnToDefaultPlayerMode, updatePlayerDisplayMode]);

  const handleToggleDirectPlayback = useCallback(() => {
    const video = directVideoRef.current;
    if (!video) return;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  }, []);

  useEffect(() => {
    const handleFs = () => {
      const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement;
      if (fullscreenElement && (fullscreenElement === iframeRef.current || fullscreenElement === directVideoRef.current)) {
        setSourcesExpanded(false);
        updatePlayerDisplayMode(3);
        focusPlaybackContext('fullscreen-change', fullscreenElement);
      } else if (fullscreenElement && fullscreenElement === playerBoxRef.current) {
        updatePlayerDisplayMode(2);
      } else if (!fullscreenElement && playerDisplayModeRef.current === 3) {
        setSourcesExpanded(false);
        updatePlayerDisplayMode(2);
        console.info('[Soulstash Player Focus] fullscreen exited; returning to mode 2 and focusing Size');
        focusSizeControl();
      }
    };
    document.addEventListener('fullscreenchange', handleFs);
    document.addEventListener('webkitfullscreenchange', handleFs);
    handleFs();
    return () => {
      document.removeEventListener('fullscreenchange', handleFs);
      document.removeEventListener('webkitfullscreenchange', handleFs);
    };
  }, [focusPlaybackContext, focusSizeControl, isTv, updatePlayerDisplayMode]);

  useEffect(() => {
    setSelectedGroup('hindi');
    setHindiSources([]);
    setAnimeSources([]);
    setKartoonSources([]);
    setKartoonResolveDone(false);
    setAnilistId(null);
    setActiveUrl('');
    setSourcesExpanded(false);
    updatePlayerDisplayMode(1);
    setHasManualSourceSelection(false);
    setSourceSignature('');
    setFailedUrls(new Set());
    setVerifiedUrls(new Set());
    setIframeReloadKey(0);
    setDragOffset({ x: 0, y: 0 });
    setDraggingPlayer(false);
    dragStateRef.current = null;
    setScale(1.0);
    setNativeScale(1.0);
    autoSwitchedToKartoonRef.current = false;
    kartoonAutoRetriedRef.current = false;
    resumeAfterRetryRef.current = 0;
    setHlsForcedUrl('');
  }, [request, updatePlayerDisplayMode]);

  // Anime / AniList / MultiNime Resolution with multi-step search fallback
  useEffect(() => {
    if (!request?.title && !request?.originalTitle) return;
    const ep = request.episodeNumber || 1;
    const rawTitle = String(request.seriesTitle || request.title || '');
    const rawOrig = String(request.originalTitle || request.originalName || '');

    const cleanTitle = rawTitle
      .replace(/\s*S\d+E\d+.*$/i, '')
      .replace(/\s*Season\s*\d+.*$/i, '')
      .replace(/\s*Episode\s*\d+.*$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    const cleanOrig = rawOrig
      .replace(/\s*S\d+E\d+.*$/i, '')
      .replace(/\s*Season\s*\d+.*$/i, '')
      .replace(/\s*Episode\s*\d+.*$/i, '')
      .replace(/\s+/g, ' ')
      .trim();

    const isMovie = request.mediaType === 'movie';
    const formatIn = isMovie ? ['MOVIE'] : ['TV', 'TV_SHORT', 'ONA', 'OVA', 'SPECIAL'];
    const year = Number(request.year) || null;
    const slug = cleanTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    const searchAniList = async (search, formats = null) => {
      try {
        const query = `
          query ($search: String, $formatIn: [MediaFormat]) {
            Page(page: 1, perPage: 8) {
              media(search: $search, type: ANIME, format_in: $formatIn) {
                id
                idMal
                title { romaji english native }
                format
                seasonYear
                startDate { year }
                episodes
              }
            }
          }
        `;
        const variables = { search };
        if (formats && formats.length) variables.formatIn = formats;
        const res = await fetch('https://graphql.anilist.co', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ query, variables })
        });
        if (!res.ok) return [];
        const data = await res.json();
        return data?.data?.Page?.media || [];
      } catch (e) {
        return [];
      }
    };

    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    const pickBest = (list, searchTerms) => {
      if (!list || !list.length) return null;
      const termNorms = searchTerms.map(norm).filter(Boolean);

      // 1. Exact year + title match
      if (year) {
        const yearMatch = list.find((m) => {
          const mYear = m.seasonYear || m.startDate?.year;
          const matchesYear = mYear && Math.abs(mYear - year) <= 1;
          const matchesName = termNorms.some((t) =>
            norm(m.title?.english) === t || norm(m.title?.romaji) === t || norm(m.title?.native) === t
          );
          return matchesYear && matchesName;
        });
        if (yearMatch) return yearMatch;
      }

      // 2. Exact title match
      const exactMatch = list.find((m) =>
        termNorms.some((t) =>
          norm(m.title?.english) === t || norm(m.title?.romaji) === t || norm(m.title?.native) === t
        )
      );
      if (exactMatch) return exactMatch;

      // 3. Year match
      if (year) {
        const yearMatch = list.find((m) => {
          const mYear = m.seasonYear || m.startDate?.year;
          return mYear && Math.abs(mYear - year) <= 1;
        });
        if (yearMatch) return yearMatch;
      }

      // 4. Return top search hit if non-empty
      return list[0];
    };

    const fetchAnime = async () => {
      try {
        let match = null;

        // Step 1: title with format filter
        if (cleanTitle) {
          const list1 = await searchAniList(cleanTitle, formatIn);
          if (list1.length) match = pickBest(list1, [cleanTitle, cleanOrig]);
        }

        // Step 2: original_name with format filter
        if (!match && cleanOrig && cleanOrig.toLowerCase() !== cleanTitle.toLowerCase()) {
          const list2 = await searchAniList(cleanOrig, formatIn);
          if (list2.length) match = pickBest(list2, [cleanOrig, cleanTitle]);
        }

        // Step 3: title without format filter
        if (!match && cleanTitle) {
          const list3 = await searchAniList(cleanTitle, null);
          if (list3.length) match = pickBest(list3, [cleanTitle, cleanOrig]);
        }

        // Step 4: original_name without format filter
        if (!match && cleanOrig && cleanOrig.toLowerCase() !== cleanTitle.toLowerCase()) {
          const list4 = await searchAniList(cleanOrig, null);
          if (list4.length) match = pickBest(list4, [cleanOrig, cleanTitle]);
        }

        if (!match || !match.id) {
          setAnilistId(null);
          setAnimeSources([]);
          return;
        }

        const resolvedAnilistId = match.id;
        const malId = match.idMal || match.id;
        setAnilistId(resolvedAnilistId);

        console.log(`***************${cleanTitle} / tmdb: ${request.tmdbId}, anilist :${resolvedAnilistId}**************`);

        // Build 6 VidNest Anime Sources + other Anime providers
        const animeList = [
          // VidNest Embed Anime
          {
            id: 'vidnest-ani-sub',
            key: 'vidnest-ani-sub',
            label: 'VidNest Anime (Sub)',
            url: `https://vidnest.fun/anime/${resolvedAnilistId}/${ep}/sub`,
            embeddable: true
          },
          {
            id: 'vidnest-ani-dub',
            key: 'vidnest-ani-dub',
            label: 'VidNest Anime (Dub)',
            url: `https://vidnest.fun/anime/${resolvedAnilistId}/${ep}/dub`,
            embeddable: true
          },
          {
            id: 'vidnest-ani-hindi',
            key: 'vidnest-ani-hindi',
            label: 'VidNest Anime (Hindi)',
            url: `https://vidnest.fun/anime/${resolvedAnilistId}/${ep}/hindi`,
            embeddable: true
          },
          // VidNest Embed AnimePahe
          {
            id: 'vidnest-pahe-sub',
            key: 'vidnest-pahe-sub',
            label: 'VidNest AnimePahe (Sub)',
            url: `https://vidnest.fun/animepahe/${resolvedAnilistId}/${ep}/sub`,
            embeddable: true
          },
          {
            id: 'vidnest-pahe-dub',
            key: 'vidnest-pahe-dub',
            label: 'VidNest AnimePahe (Dub)',
            url: `https://vidnest.fun/animepahe/${resolvedAnilistId}/${ep}/dub`,
            embeddable: true
          },
          {
            id: 'vidnest-pahe-hindi',
            key: 'vidnest-pahe-hindi',
            label: 'VidNest AnimePahe (Hindi)',
            url: `https://vidnest.fun/animepahe/${resolvedAnilistId}/${ep}/hindi`,
            embeddable: true
          },
          // Gogo Server (Sub & Dub)
          {
            id: 'gogo-server-sub',
            key: 'gogo-server-sub',
            label: 'Gogo Server (Sub)',
            url: `https://gogoanime.me.uk/newplayer.php?mal_id=${malId}&ep=${ep}&category=sub`,
            embeddable: true
          },
          {
            id: 'gogo-server-dub',
            key: 'gogo-server-dub',
            label: 'Gogo Server (Dub)',
            url: `https://gogoanime.me.uk/newplayer.php?mal_id=${malId}&ep=${ep}&category=dub`,
            embeddable: true
          },
          // VidHawk (Sub & Dub)
          {
            id: 'vidhawk-sub',
            key: 'vidhawk-sub',
            label: 'VidHawk (Sub)',
            url: `https://vidhawk.buzz/embed/ani/${resolvedAnilistId}/${ep}/sub`,
            embeddable: true
          },
          {
            id: 'vidhawk-dub',
            key: 'vidhawk-dub',
            label: 'VidHawk (Dub)',
            url: `https://vidhawk.buzz/embed/ani/${resolvedAnilistId}/${ep}/dub`,
            embeddable: true
          },
          // TryEmbed (Sub & Dub)
          {
            id: 'tryembed-sub',
            key: 'tryembed-sub',
            label: 'TryEmbed (Sub)',
            url: `https://tryembed.us.cc/embed/anime/${resolvedAnilistId}/${ep}/sub`,
            embeddable: true
          },
          {
            id: 'tryembed-dub',
            key: 'tryembed-dub',
            label: 'TryEmbed (Dub)',
            url: `https://tryembed.us.cc/embed/anime/${resolvedAnilistId}/${ep}/dub`,
            embeddable: true
          },
          // Vidstreaming
          {
            id: 'vidstreaming',
            key: 'vidstreaming',
            label: 'Vidstreaming',
            url: `https://vidsrc.me/embed/anime?id=${resolvedAnilistId}&ep=${ep}`,
            embeddable: true
          }
        ];

        setAnimeSources(animeList);

        // Fetch MultiNime watch page for FlixCloud mirrors via backend proxy (eliminates CORS errors)
        try {
          const mnData = await apiFetch(`/api/anime/multinime-sources?slug=${encodeURIComponent(slug)}&ep=${encodeURIComponent(ep)}&aid=${encodeURIComponent(resolvedAnilistId)}`);
          if (mnData?.success && Array.isArray(mnData.sources) && mnData.sources.length) {
            setAnimeSources((prev) => {
              const combined = [...mnData.sources, ...prev];
              const seen = new Set();
              return combined.filter(s => {
                if (seen.has(s.url)) return false;
                seen.add(s.url);
                return true;
              });
            });
          }
        } catch (_) {}
      } catch (err) {
        console.warn('[Soulstash Player] AniList lookup failed:', err.message);
      }
    };

    fetchAnime();
  }, [request]);

  // Resolve direct Kartoon streams so the shared player keeps the app controls without embedding the provider site.
  useEffect(() => {
    let cancelled = false;
    const resolveKartoons = async () => {
      try {
        const isMovie = request?.mediaType === 'movie';
        const season = Number(request?.seasonNumber) || 1;
        const episode = Number(request?.episodeNumber) || 1;
        const streamType = isMovie ? 'movie' : 'series';
        let streamId = null;

        // 1. If the request already identifies a Kartoon episode, use that stable episode ID.
        if (request?.kartoonsEpisodeId) {
          streamId = request.kartoonsEpisodeId;
        }

        // 2. Resolve a stream ID from an explicit Kartoon slug.
        if (!streamId && request?.kartoonsSlug) {
          if (isMovie) {
            streamId = await resolveKartoonsMovieId(request.kartoonsSlug).catch(() => null);
          } else {
            streamId = await resolveKartoonsEpisodeId(request.kartoonsSlug, season, episode).catch(() => null);
          }
        }

        // 3. Otherwise, search Kartoons by title (e.g. Dragon Ball, Ben 10, etc.).
        if (!streamId && (request?.title || request?.seriesTitle)) {
          const rawTitle = String(request.seriesTitle || request.title || '');
          const cleanTitle = rawTitle
            .replace(/\s*S\d+E\d+.*$/i, '')
            .replace(/\s*Season\s*\d+.*$/i, '')
            .replace(/\s*Episode\s*\d+.*$/i, '')
            .replace(/\s+/g, ' ')
            .trim();

          if (cleanTitle.length >= 2) {
            if (isMovie) {
              const res = await searchKartoonsMovies(cleanTitle).catch(() => ({ data: [] }));
              const match = findKartoonsMatch(request, res?.data || []);
              if (match?.slug) {
                streamId = await resolveKartoonsMovieId(match.slug).catch(() => null);
              }
            } else {
              const res = await searchKartoonsShows(cleanTitle).catch(() => ({ data: [] }));
              const match = findKartoonsMatch(request, res?.data || []);
              if (match?.slug) {
                streamId = await resolveKartoonsEpisodeId(match.slug, season, episode).catch(() => null);
              }
            }
          }
        }

        if (cancelled || !streamId) return;

        const streams = (await fetchKartoonsStremioStreams(streamType, streamId, kartoonRetryKey > 0).catch(() => []))
          .filter((stream) => stream?.url && isDirectMediaUrl(stream.url));
        if (cancelled || !streams.length) return;

        const seenURLs = new Set();
        const kSources = streams
          .filter((stream) => {
            if (seenURLs.has(stream.url)) return false;
            seenURLs.add(stream.url);
            return true;
          })
          .map((stream, index) => ({
            id: index === 0 ? 'kartoon' : `kartoon-${index + 1}`,
            key: 'kartoon',
            label: index === 0 ? 'Kartoon' : `Kartoon · ${stream.label || `Server ${index + 1}`}`,
            url: stream.url,
            embeddable: false,
            isDirect: true,
            group: 'hindi'
          }));

        setKartoonSources(kSources);
      } catch (err) {
        console.warn('[Soulstash Player] Kartoons resolution failed:', err.message);
      } finally {
        if (!cancelled) setKartoonResolveDone(true);
      }
    };

    resolveKartoons();
    return () => { cancelled = true; };
  }, [request, kartoonRetryKey]);

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
    body.classList.add('player-modal-open');

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
      body.classList.remove('player-modal-open');
      window.removeEventListener('wheel', preventPageScroll, { capture: true });
      window.removeEventListener('touchmove', preventPageScroll, { capture: true });
    };
  }, []);

  useEffect(() => {
    if (!window.history.state || !window.history.state.playerOpen) {
      try {
        window.history.pushState({ playerOpen: true }, '');
      } catch (e) {}
    }

    const handlePopState = () => {
      if (isClosingRef.current) return;
      const mode = playerDisplayModeRef.current;
      const isPlaybackFocused = focusZoneRef.current === 'playback';

      if (mode === 3) {
        try { window.history.pushState({ playerOpen: true }, ''); } catch (e) {}
        try {
          const exit = document.exitFullscreen || document.webkitExitFullscreen;
          if (exit && (document.fullscreenElement || document.webkitFullscreenElement)) {
            Promise.resolve(exit.call(document)).catch(() => {});
          }
        } catch (_) {}
        updatePlayerDisplayMode(2);
        setSourcesExpanded(true);
        focusSizeControl();
        return;
      }

      if (mode === 2) {
        if (isPlaybackFocused) {
          try { window.history.pushState({ playerOpen: true }, ''); } catch (e) {}
          focusSizeControl();
          return;
        }

        try { window.history.pushState({ playerOpen: true }, ''); } catch (e) {}
        setSourcesExpanded(false);
        updatePlayerDisplayMode(1);
        focusSizeControl();
        return;
      }

      if (sourcesExpanded) {
        try { window.history.pushState({ playerOpen: true }, ''); } catch (e) {}
        setSourcesExpanded(false);
        focusSizeControl();
        return;
      }

      // In Mode 1:
      if (isPlaybackFocused) {
        try { window.history.pushState({ playerOpen: true }, ''); } catch (e) {}
        focusSizeControl();
        return;
      }

      // Focus was already on Size button or player controls outside playback -> close player cleanly
      handleCloseClick();
    };

    // Track focus zone from document focus events. Unlike window blur, focusin fires
    // for keyboard, remote and mouse focus moves into the cross-origin iframe.
    const handleFocusIn = (e) => {
      const target = e.target;
      if (target === iframeRef.current || target?.tagName === 'IFRAME' || target === directVideoRef.current || target?.tagName === 'VIDEO' || target?.closest?.('[data-direct-player]')) {
        focusZoneRef.current = 'playback';
        playerFocusTargetRef.current = 'iframe';
        sizeFocusedRef.current = false;
        setIsSizeFocusedVisual(false);
      } else {
        focusZoneRef.current = 'controls';
      }
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        const backEvent = new CustomEvent('soulstash:player-back', { cancelable: true });
        window.dispatchEvent(backEvent);
        if (!backEvent.defaultPrevented) handleCloseClick();
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        handleToggleFullscreen();
      }
    };

    window.addEventListener('popstate', handlePopState);
    document.addEventListener('focusin', handleFocusIn, true);
    window.addEventListener('keydown', handleKeyDown);
    
    return () => {
      window.removeEventListener('popstate', handlePopState);
      document.removeEventListener('focusin', handleFocusIn, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleCloseClick, handleToggleFullscreen, returnToDefaultPlayerMode]);

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
      try {
        const fsElement = document.fullscreenElement || document.webkitFullscreenElement;
        
        if (Capacitor.isNativePlatform()) {
          try {
            if (fsElement) {
              await ScreenOrientation.unlock();
            } else {
              const rot = getRotationMode();
              if (rot === 'sensor') {
                await ScreenOrientation.unlock();
              } else if (rot === 'portrait') {
                await ScreenOrientation.lock({ orientation: 'portrait' });
              } else if (rot === 'landscape') {
                await ScreenOrientation.lock({ orientation: 'landscape' });
              }
            }
          } catch (e) {
            // Orientation ignore
          }
        }

        if (fsElement && fsElement === iframeRef.current) {
          fsElement.style.transform = scale !== 1.0 ? `scale(${scale})` : 'none';
          fsElement.style.transformOrigin = 'center center';
          fsElement.style.width = '100vw';
          fsElement.style.height = '100vh';
          fsElement.style.overflow = 'hidden';
          fsElement.style.backgroundColor = 'black'; 
        } else if (iframeRef.current) {
          iframeRef.current.style.transform = scale !== 1.0 ? `scale(${scale})` : 'none';
          iframeRef.current.style.transformOrigin = 'center center';
          iframeRef.current.style.width = '100%';
          iframeRef.current.style.height = '100%';
          iframeRef.current.style.overflow = '';
          iframeRef.current.style.backgroundColor = '';
        }
      } catch (err) {
        console.warn('Fullscreen change handler error:', err);
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

    handleFullscreenChange();

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, [scale]);

  const queryParams = useMemo(() => {
    const params = new URLSearchParams({
      mediaType: request.mediaType,
      tmdbId: String(request.tmdbId),
      t: Date.now().toString()
    });
    if (request.imdbId) params.set('imdbId', request.imdbId);
    if (request.title) params.set('title', request.seriesTitle || request.title);
    if (request.originalTitle) params.set('originalTitle', request.originalTitle);
    if (request.year) params.set('year', String(request.year));
    if (request.mediaType === 'series') {
      params.set('seasonNumber', String(request.seasonNumber || 1));
      params.set('episodeNumber', String(request.episodeNumber || 1));
    }
    return params;
  }, [request]);

  const isPureKartoons = String(request?.tmdbId || '').startsWith('kartoons-');

  const { data: sourcePayload, isLoading: sourceLoading, error: sourceError, isFetching } = useQuery({
    queryKey: ['playerSources', request.mediaType, request.tmdbId, request.seasonNumber, request.episodeNumber, request.imdbId],
    queryFn: () => apiFetch(`/api/player/sources?${queryParams.toString()}`),
    enabled: !!request.tmdbId && !isPureKartoons,
    retry: (failureCount, error) => {
      if (error?.status === 503 && failureCount < 30) return true;
      return false;
    },
    retryDelay: 4000,
    refetchInterval: (query) => {
      // Keep polling if the backend says it's scraping
      if (query.state.data?.scraping) return 4000;
      return false;
    }
  });

  useEffect(() => {
    if (sourcePayload) {
      const nextSources = Array.isArray(sourcePayload.sources)
        ? sourcePayload.sources.filter((source) => source?.url || source?.pending)
        : [];
      const resolvedSources = [...nextSources, ...(fallbackSources || [])];
      const nextSignature = JSON.stringify({
        updatedAt: sourcePayload.updatedAt || '',
        urls: resolvedSources.map((source) => source?.url || '')
      });

      if (sourceSignature !== nextSignature) {
        setHindiSources(nextSources);
        setSourceSignature(nextSignature);
        
        if (!sourcePayload.scraping) {
          const sessionKey = `${request.tmdbId}-${request.seasonNumber || '0'}-${request.episodeNumber || '0'}`;
          SESSION_SCRAPED.add(sessionKey);
        }

      }
    }
  }, [sourcePayload, fallbackSources, request, sourceSignature]);

  const effectiveAnilistId = request?.anilistId || sourcePayload?.anilistId || anilistId;

  const combinedIncoming = useMemo(() => {
    const baseHindi = [...kartoonSources, ...hindiSources];
    // If no AniList ID, do not include anime sources
    if (!effectiveAnilistId) {
      return baseHindi.filter(
        (s) => !/\((Sub|Dub|Hindi)\)/i.test(s.label || '') && !/^(gogo|tryembed|vidhawk|vidnest-ani|vidnest-pahe)/i.test(s.id || s.key || '')
      );
    }
    const animeKeys = new Set(animeSources.map((s) => s.id));
    const cleanHindiSources = baseHindi.filter(
      (s) => !animeKeys.has(s.id) && !/^(gogo|tryembed|vidhawk|vidnest-ani|vidnest-pahe)/i.test(s.id || s.key || '')
    );
    return [...animeSources, ...cleanHindiSources];
  }, [hindiSources, animeSources, kartoonSources, effectiveAnilistId]);

  const sources = useMemo(
    () => buildPlayerSourceSlots(combinedIncoming, fallbackSources, {
      isLoading: isFetching,
      failedUrls,
      verifiedUrls
    }),
    [combinedIncoming, fallbackSources, isFetching, failedUrls, verifiedUrls]
  );

  // Filter sources:
  // 1. Hide disabled / unhealthy sources with no stream url
  // 2. If no AniList ID, hide anime sources with (Sub), (Dub), (Hindi) in label (preserve Kartoon sources!)
  // 3. Hide entire dubbed section if no AniList ID
  const displayedSources = useMemo(() => {
    return sources.filter((s) => {
      if (!s.url && !s.pending) return false;
      const isKartoon = /kartoon/i.test(s.id || s.key || s.label || '');
      if (!effectiveAnilistId && !isKartoon) {
        if (/\((Sub|Dub|Hindi)\)/i.test(s.label || '')) return false;
        if (/^(vidnest|gogo|vidhawk|tryembed|multinime)/i.test(s.id || s.key || '')) return false;
        if (s.group === 'dubbed') return false;
      }
      return true;
    });
  }, [sources, effectiveAnilistId]);

  const availableHindi = useMemo(() => displayedSources.filter((s) => s.group === 'hindi'), [displayedSources]);
  const availableDubbed = useMemo(() => displayedSources.filter((s) => s.group === 'dubbed'), [displayedSources]);
  const availableSubbed = useMemo(() => displayedSources.filter((s) => s.group === 'subbed'), [displayedSources]);

  const handleIframeError = useCallback((failedUrl) => {
    if (!failedUrl) return;
    console.warn('[Soulstash Player] Stream failed:', failedUrl);
    setFailedUrls((prev) => {
      const next = new Set(prev);
      next.add(failedUrl);
      return next;
    });
    setVerifiedUrls((prev) => {
      const next = new Set(prev);
      next.delete(failedUrl);
      return next;
    });

    // Auto-switch to next available healthy source across displayed sources
    const candidates = displayedSources.filter((s) => s.url && s.url !== failedUrl && !failedUrls.has(s.url));
    if (candidates.length > 0) {
      setActiveUrl(candidates[0].url);
      setIframeReloadKey(0);
    } else {
      setActiveUrl('');
    }
  }, [displayedSources, failedUrls]);

  useEffect(() => {
    hlsErrorHandlerRef.current = handleIframeError;
  }, [handleIframeError]);

  const isKartoonSource = (s) => {
    if (!s) return false;
    const lowerKey = String(s.key || s.id || '').toLowerCase();
    const lowerLabel = String(s.label || s.name || '').toLowerCase();
    return lowerKey.includes('kartoon') || lowerLabel.includes('kartoon');
  };

  const isVidboltSource = (s) => {
    if (!s) return false;
    const lowerKey = String(s.key || s.id || '').toLowerCase();
    const lowerLabel = String(s.label || s.name || '').toLowerCase();
    const url = String(s.url || '').toLowerCase();
    return lowerKey.includes('vidbolt') || lowerLabel.includes('vidbolt') || url.includes('vidbolt');
  };

  // Prefer Kartoon streams whenever available, then VidBolt. Manual source selection takes precedence.
  // Importantly, switching categories or viewing sources does NOT switch or interrupt the playing stream!
  const raceTokenRef = useRef(0);
  const playableKey = displayedSources.filter((s) => s.url && !failedUrls.has(s.url)).map((s) => s.url).join('|');

  useEffect(() => {
    const playable = displayedSources.filter((s) => s.url && !failedUrls.has(s.url));
    if (!playable.length) return undefined;

    // Kartoon streams (direct Cloudflare Worker HLS) take 1-2s to resolve after initial TMDB sources;
    // auto-switch to Kartoon stream as soon as it resolves unless user manually chose another source
    const kartoonSource = playable.find(isKartoonSource);
    if (kartoonSource && !failedUrls.has(kartoonSource.url) && !hasManualSourceSelection) {
      if (activeUrl !== kartoonSource.url && !autoSwitchedToKartoonRef.current) {
        autoSwitchedToKartoonRef.current = true;
        console.info('[Soulstash Player] Auto-selecting resolved Kartoon stream:', kartoonSource.label || kartoonSource.id);
        setActiveUrl(kartoonSource.url);
        setVerifiedUrls((prev) => new Set(prev).add(kartoonSource.url));
      }
      return undefined;
    }

    // If we already have an active playing URL and it hasn't failed, KEEP IT!
    if (activeUrl && !failedUrls.has(activeUrl)) {
      return undefined;
    }

    // Prioritize VidBolt as default player if available
    const vidboltSource = playable.find(isVidboltSource);
    if (vidboltSource && !failedUrls.has(vidboltSource.url)) {
      setActiveUrl(vidboltSource.url);
      setVerifiedUrls((prev) => new Set(prev).add(vidboltSource.url));
      return undefined;
    }

    const token = ++raceTokenRef.current;
    const controllers = [];
    let settled = false;

    const pick = (url) => {
      if (settled || raceTokenRef.current !== token) return;
      settled = true;
      controllers.forEach((c) => c.abort());
      setVerifiedUrls((prev) => new Set(prev).add(url));
      setActiveUrl(url);
    };

    playable.slice(0, 6).forEach((s) => {
      const c = new AbortController();
      controllers.push(c);
      fetch(s.url, { mode: 'no-cors', signal: c.signal, cache: 'no-store' })
        .then(() => {
          setVerifiedUrls((prev) => new Set(prev).add(s.url));
          pick(s.url);
        })
        .catch(() => {});
    });

    const timer = window.setTimeout(() => {
      if (!settled && raceTokenRef.current === token && playable[0]) {
        pick(playable[0].url);
      }
    }, 2500);

    return () => {
      window.clearTimeout(timer);
      controllers.forEach((c) => c.abort());
    };
  }, [playableKey, activeUrl, failedUrls, displayedSources, hasManualSourceSelection]);

  const defaultSource =
    displayedSources.find((s) => s.url && !s.failed && isKartoonSource(s)) ||
    displayedSources.find((s) => s.url && !s.failed && isVidboltSource(s)) ||
    displayedSources.find((source) => source.url && !source.failed) ||
    displayedSources.find((source) => source.url) ||
    displayedSources[0];
  const activeSource = displayedSources.find((source) => source.url === activeUrl) || defaultSource;

  const canUseVideoJs = isDirectMediaUrl(activeUrl);

  // Recover a Kartoon stream that never starts (or errors): re-resolve once with a fresh URL,
  // then fall back to the normal failed-source handling.
  const handleDirectStuck = () => {
    const stuckUrl = activeUrl;
    if (!stuckUrl || !isKartoonSource(activeSource)) return;
    // Step 1: the worker URL may be an HLS playlist without ".m3u8" in the path,
    // which native <video> can't play in most browsers. Retry the same URL via hls.js.
    if (hlsForcedUrl !== stuckUrl && !/\.m3u8(\?|$)/i.test(stuckUrl)) {
      setHlsForcedUrl(stuckUrl);
      return;
    }
    // Step 2: re-resolve a fresh URL once.
    if (!kartoonAutoRetriedRef.current) {
      kartoonAutoRetriedRef.current = true;
      resumeAfterRetryRef.current = latestPlaybackTimeRef.current || 0;
      autoSwitchedToKartoonRef.current = false;
      setActiveUrl('');
      setKartoonSources([]);
      setKartoonResolveDone(false);
      setKartoonRetryKey((k) => k + 1);
      return;
    }
    hlsErrorHandlerRef.current?.(stuckUrl);
  };
  const handleDirectStuckRef = useRef(handleDirectStuck);
  handleDirectStuckRef.current = handleDirectStuck;

  // Direct streams have no iframe, so move keyboard/remote focus onto the video itself
  // whenever a new direct stream becomes active. This keeps focus in the internal player.
  useEffect(() => {
    if (!canUseVideoJs || !activeUrl) return undefined;
    focusZoneRef.current = 'playback';
    playerFocusTargetRef.current = 'iframe';
    sizeFocusedRef.current = false;
    setIsSizeFocusedVisual(false);
    const t = window.setTimeout(() => {
      directVideoRef.current?.focus({ preventScroll: true });
    }, 60);
    return () => window.clearTimeout(t);
  }, [activeUrl, canUseVideoJs]);

  useEffect(() => {
    if (activeUrl) {
      setIsStreamLoading(true);
    }
  }, [activeUrl, iframeReloadKey]);

  // HLS stream playback handler for .m3u8 direct streams
  useEffect(() => {
    if (!canUseVideoJs || !activeUrl) return;
    let disposed = false;
    let localHls = null;
    const isHls = /\.m3u8(\?|$)/i.test(activeUrl) || activeUrl.includes('/playlist/') || activeUrl.includes('workers.dev') || hlsForcedUrl === activeUrl;
    const video = directVideoRef.current;
    if (!video) return;

    setIsStreamLoading(true);

    if (hlsInstanceRef.current) {
      try { hlsInstanceRef.current.destroy(); } catch {}
      hlsInstanceRef.current = null;
    }
    video.removeAttribute('src');

    if (isHls) {
      ensureHlsJs().then((Hls) => {
        if (disposed || directVideoRef.current !== video) return;
        if (!Hls || !Hls.isSupported()) {
          video.src = activeUrl;
          video.load();
          video.play().catch(() => {});
          return;
        }
        const hls = new Hls({
          enableWorker: true,
          startFragPrefetch: true,
          lowLatencyMode: false,
          startLevel: -1,
          backBufferLength: isTv ? 15 : 30,
          maxBufferLength: isTv ? 20 : 30,
          maxMaxBufferLength: isTv ? 30 : 60,
          maxBufferSize: isTv ? 30 * 1000 * 1000 : 60 * 1000 * 1000,
          manifestLoadingTimeOut: 15000,
          levelLoadingTimeOut: 15000,
          fragLoadingTimeOut: 30000,
          manifestLoadingMaxRetry: 3,
          levelLoadingMaxRetry: 4,
          fragLoadingMaxRetry: 4,
          fragLoadingRetryDelay: 400,
          nudgeMaxRetry: 8,
          maxBufferHole: 0.5,
          nudgeOffset: 0.2
        });
        localHls = hls;
        hlsInstanceRef.current = hls;
        hls.loadSource(activeUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          setVerifiedUrls((prev) => prev.has(activeUrl) ? prev : new Set(prev).add(activeUrl));
          video.play().catch(() => {});
        });
        hls.on(Hls.Events.FRAG_BUFFERED, () => {
          setIsStreamLoading(false);
        });
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (!data?.fatal) return;
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) { hls.recoverMediaError(); return; }
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) { try { hls.startLoad(); } catch {} return; }
          if (hlsForcedUrl === activeUrl) handleDirectStuckRef.current?.();
          else hlsErrorHandlerRef.current?.(activeUrl);
        });
      });
    } else {
      video.src = activeUrl;
      video.load();
      video.play().catch(() => {});
    }

    // Watchdog: if nothing has loaded after 10s, re-resolve the stream once.
    const stuckWatchdog = window.setTimeout(() => {
      if (!disposed && video.readyState < 2 && video.currentTime === 0) {
        handleDirectStuckRef.current?.();
      }
    }, 10000);

    return () => {
      disposed = true;
      window.clearTimeout(stuckWatchdog);
      if (localHls) {
        try { localHls.destroy(); } catch {}
        if (hlsInstanceRef.current === localHls) hlsInstanceRef.current = null;
      }
    };
  }, [activeUrl, canUseVideoJs, hlsForcedUrl]);

  useEffect(() => {
    return () => {
      if (hlsInstanceRef.current) {
        try { hlsInstanceRef.current.destroy(); } catch {}
        hlsInstanceRef.current = null;
      }
    };
  }, []);

  const canEmbedSource = canUseVideoJs || activeSource?.embeddable !== false;
  // Modern movie aspect ratio (16:9 widescreen) with increased desktop height and ratio.
  // Dynamically contracts when the bottom sources panel is expanded so sources never clip offscreen.
  const desktopMediaMaxH = sourcesExpanded ? 'min(44vh, 460px)' : 'min(64vh, 660px)';
  const mobileMediaMaxH = sourcesExpanded ? 'min(28vh, 200px)' : 'min(44vh, 56.25vw)';
  const mediaMaxH = isDesktopViewport ? desktopMediaMaxH : mobileMediaMaxH;
  const isExpandedPlayerShell = playerDisplayMode >= 2;

  const videoBoxStyle = isTv ? {
    width: isExpandedPlayerShell ? '100vw' : 'min(94vw, 1760px)',
    maxWidth: isExpandedPlayerShell ? '100vw' : '94vw',
    height: isExpandedPlayerShell ? '100dvh' : '80dvh',
    maxHeight: isExpandedPlayerShell ? '100dvh' : '80dvh',
    margin: '0',
    borderRadius: '0',
    border: 'none',
    display: 'flex',
    flexDirection: 'column'
  } : {
    width: isExpandedPlayerShell ? '100vw' : isDesktopViewport
      ? `min(94vw, 1340px, calc(${desktopMediaMaxH} * 16 / 9))`
      : 'min(96vw, calc(96vw))',
    maxWidth: isExpandedPlayerShell ? '100vw' : isDesktopViewport ? '1340px' : '96vw',
    height: isExpandedPlayerShell ? '100dvh' : sourcesExpanded ? (isDesktopViewport ? 'min(92dvh, 880px)' : '94dvh') : undefined,
    maxHeight: isExpandedPlayerShell ? '100dvh' : isDesktopViewport ? 'min(92dvh, 880px)' : '94dvh',
    margin: isExpandedPlayerShell ? '0' : '0 auto',
    display: 'flex',
    flexDirection: 'column'
  };
  const mediaAreaStyle = (isExpandedPlayerShell || isTv) ? {
    width: '100%',
    flex: '1 1 0%',
    minHeight: 0,
    backgroundColor: 'black'
  } : {
    width: '100%',
    aspectRatio: '16 / 9',
    maxHeight: mediaMaxH,
    backgroundColor: 'black'
  };
  const baseVerticalShift = isTv ? 0 : (sourcesExpanded ? 0 : (isDesktopViewport ? -16 : -10));
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
    const candidates = displayedSources.filter((s) => s.url && !failedUrls.has(s.url));
    if (!candidates.length) return;
    const currentIndex = candidates.findIndex((source) => source.url === activeUrl);
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % candidates.length : 0;
    setHasManualSourceSelection(true);
    setActiveUrl(candidates[nextIndex]?.url || '');
    setIframeReloadKey(0);
  };

  const handleSelectSource = useCallback((source) => {
    if (!source?.url || source.failed || failedUrls.has(source.url)) return;
    setHasManualSourceSelection(true);
    setActiveUrl(source.url);
    setIframeReloadKey((current) => current + 1);
  }, [failedUrls]);

  const handleOpenSources = useCallback(() => {
    focusSourceAfterExpandRef.current = true;
    setSourcesExpanded(true);
  }, []);

  const handleCloseSources = useCallback(() => {
    focusSourceAfterExpandRef.current = false;
    setSourcesExpanded(false);
    window.requestAnimationFrame(() => sourceToggleRef.current?.focus({ preventScroll: true }));
  }, []);

  useEffect(() => {
    if (!sourcesExpanded || !focusSourceAfterExpandRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      const panel = playerBoxRef.current?.querySelector('[data-player-sources-panel]');
      const target = panel?.querySelector('button[data-active-source="true"]:not(:disabled)') ||
        panel?.querySelector('button[data-player-source="true"]:not(:disabled)') ||
        sourceHideRef.current;
      if (!target) return;
      focusSourceAfterExpandRef.current = false;
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeUrl, displayedSources.length, selectedGroup, sourcesExpanded]);

  const reloadActiveSource = useCallback(() => {
    if (!activeUrl) return;
    if (canUseVideoJs && directVideoRef.current) {
      if (hlsInstanceRef.current) {
        try { hlsInstanceRef.current.destroy(); } catch {}
        hlsInstanceRef.current = null;
      }
      directVideoRef.current.removeAttribute('src');
      const u = activeUrl;
      setActiveUrl('');
      setTimeout(() => setActiveUrl(u), 30);
      return;
    }
    setIframeReloadKey((current) => current + 1);
  }, [activeUrl, canUseVideoJs]);

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
    if (!activeUrl || !scrollContainerRef.current) return;
    const activeBtn = scrollContainerRef.current.querySelector('button[data-active-source="true"]');
    if (activeBtn) {
      activeBtn.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center'
      });
    }
  }, [activeUrl, displayedSources.length, selectedGroup]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const modal = playerBoxRef.current?.closest('[data-player-modal]');
      if (!modal) return;
      const isKeyboardNav = document.documentElement.classList.contains('tv-nav-active');
      if (!isKeyboardNav) return;
      if (modal.contains(document.activeElement)) return;
      const sourceButton =
        playerBoxRef.current?.querySelector('button[data-player-size="true"]') ||
        playerBoxRef.current?.querySelector('button[data-active-source="true"]:not(:disabled)') ||
        playerBoxRef.current?.querySelector('button[data-player-source="true"]:not(:disabled)') ||
        playerBoxRef.current?.querySelector('button[data-player-action="true"]:not(:disabled), a[data-player-action="true"]');
      if (sourceButton) {
        sourceButton.focus({ preventScroll: true });
        sourceButton.classList.add('tv-focused');
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeUrl, displayedSources.length, playerDisplayMode, selectedGroup]);

  const errorDisplay = sourceError 
    ? (fallbackSources.length ? '' : sourceError?.message || 'Failed to load sources.')
    : '';

  const modalContent = (
    <div className="pointer-events-none fixed inset-0 z-[1000000] bg-transparent" data-player-modal="true" data-player-mode={playerDisplayMode}>
      <div
        className="relative h-full w-full"
        style={{
          minHeight: '100dvh'
        }}
      >
        <div
          ref={playerBoxRef}
          className={`pointer-events-auto absolute overflow-hidden ${
            isExpandedPlayerShell || isTv ? 'rounded-none border-0' : 'rounded-[22px] border border-white/10'
          } bg-black shadow-2xl flex flex-col`}
          style={{
            ...videoBoxStyle,
            left: isExpandedPlayerShell ? '0' : '50%',
            top: isExpandedPlayerShell ? '0' : isTv ? '10dvh' : '50%',
            transform: isExpandedPlayerShell ? 'none' : isTv
              ? 'translateX(-50%)'
              : `translate(calc(-50% + ${dragOffset.x}px), calc(-50% + ${baseVerticalShift + dragOffset.y}px))`,
            transition: draggingPlayer ? 'none' : 'transform 220ms ease'
          }}
        >
          {/* Top Bar Header: Media info & Window action controls */}
          <div
            data-player-controls="true"
            data-player-drag-handle="true"
            className={`flex shrink-0 items-center justify-between gap-2 border-b border-white/10 bg-black/80 px-3 sm:px-4 select-none transition-opacity duration-300 ${
              isTv && !tvControlsVisible ? 'opacity-0 pointer-events-none' : 'opacity-100'
            }`}
            style={{ height: controlsHeight, touchAction: 'none', display: playerDisplayMode === 3 ? 'none' : undefined }}
            onPointerDown={(e) => {
              focusZoneRef.current = 'controls';
              handlePlayerPointerDown(e);
            }}
            onFocusCapture={(e) => {
              focusZoneRef.current = 'controls';
              if (e.target !== fullscreenButtonRef.current) {
                playerFocusTargetRef.current = 'controls';
                sizeFocusedRef.current = false;
                setIsSizeFocusedVisual(false);
              }
            }}
          >
            {/* Title & Episode info */}
            <div className="flex items-center gap-2 min-w-0">
              <span className="flex h-2 w-2 rounded-full bg-red-600 animate-pulse shrink-0" />
              <span className="truncate text-xs sm:text-sm font-semibold text-white/90">
                {request?.seriesTitle || request?.title || 'Soulstash Player'}
              </span>
              {(request?.seasonNumber || request?.episodeNumber) && (
                <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-mono text-white/70">
                  S{request.seasonNumber || 1} E{request.episodeNumber || 1}
                </span>
              )}
            </div>

            {/* Window Action Buttons */}
            <div className="flex shrink-0 items-center justify-end gap-1.5 sm:gap-2">
              <button
                type="button"
                data-player-action="true"
                data-player-size="true"
                ref={fullscreenButtonRef}
                onClick={handleToggleFullscreen}
                onFocus={() => {
                  focusZoneRef.current = 'controls';
                  playerFocusTargetRef.current = 'size';
                  sizeFocusLastAtRef.current = Date.now();
                  sizeFocusedRef.current = true;
                  setIsSizeFocusedVisual(true);
                }}
                onBlur={() => {
                  sizeFocusedRef.current = false;
                  setIsSizeFocusedVisual(false);
                }}
                className={`${iconButtonClass} transition-all duration-200 ${
                  isSizeFocusedVisual
                    ? '!ring-2 !ring-red-500 shadow-[0_0_15px_rgba(239,68,68,0.9)] bg-white/30 scale-105 !outline-none'
                    : ''
                }`}
                aria-label={`Player size ${playerDisplayMode} of 3`}
                title={`Player size ${playerDisplayMode} of 3`}
              >
                <i className={`fas ${playerDisplayMode === 1 ? 'fa-expand' : 'fa-compress-arrows-alt'} text-xs`} />
              </button>
              <button
                type="button"
                data-player-action="true"
                data-player-source-toggle="true"
                ref={sourceToggleRef}
                onClick={sourcesExpanded ? handleCloseSources : handleOpenSources}
                onFocus={() => {
                  focusZoneRef.current = 'controls';
                  playerFocusTargetRef.current = 'controls';
                }}
                className={`${actionButtonClass} inline-flex items-center gap-1.5`}
                aria-label={sourcesExpanded ? 'Hide streams and sources' : 'Show streams and sources'}
                aria-expanded={sourcesExpanded}
                title={sourcesExpanded ? 'Hide Streams & Sources' : 'Show Streams & Sources'}
              >
                <i className="fas fa-layer-group text-[11px]" />
                <span>Sources</span>
                <span className="font-mono text-[10px] opacity-70">
                  {displayedSources.filter((source) => source.url && !failedUrls.has(source.url)).length}
                </span>
              </button>
              {isTv && canUseVideoJs && activeUrl && (
                <button
                  type="button"
                  data-player-action="true"
                  onClick={handleToggleDirectPlayback}
                  className={iconButtonClass}
                  aria-label={isDirectVideoPlaying ? 'Pause playback' : 'Play playback'}
                  title={isDirectVideoPlaying ? 'Pause playback' : 'Play playback'}
                >
                  <i className={`fas ${isDirectVideoPlaying ? 'fa-pause' : 'fa-play'} text-xs`} />
                </button>
              )}
              <button
                type="button"
                data-player-action="true"
                onClick={reloadActiveSource}
                disabled={!activeUrl}
                className={iconButtonClass}
                aria-label="Reload stream"
                title="Reload Stream"
              >
                <i className="fas fa-redo text-xs"></i>
              </button>
              {activeUrl && (
                <button
                  type="button"
                  data-player-action="true"
                  onClick={handleToggleZoom}
                  className={iconButtonClass}
                  aria-label={getZoomLabel()}
                  title={getZoomLabel()}
                >
                  <i className={`${getZoomIcon()} text-xs`}></i>
                </button>
              )}
              <a
                data-player-action="true"
                data-tv-allow-link
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
                <i className="fas fa-external-link-alt text-xs"></i>
              </a>
              <button
                type="button"
                data-player-action="true"
                onClick={handleCloseClick}
                className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
                aria-label="Close player"
                title="Close Player"
              >
                <svg xmlns="http://www.w3.org/2000/svg" height="18" viewBox="0 -960 960 960" fill="currentColor">
                  <path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/>
                </svg>
              </button>
            </div>
          </div>

          {/* Middle: Video / Stream iframe Area */}
          <div
            ref={mediaAreaRef}
            className="relative flex flex-1 min-h-0 items-center justify-center overflow-hidden bg-black"
            style={mediaAreaStyle}
            onPointerDown={() => {
              focusZoneRef.current = 'playback';
              playerFocusTargetRef.current = 'iframe';
              sizeFocusedRef.current = false;
              setIsSizeFocusedVisual(false);
            }}
          >
            {(isFetching || (isPureKartoons && !activeUrl && !kartoonResolveDone)) ? (
              <div className="flex h-full w-full flex-col items-center justify-center gap-6">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                <div className="animate-pulse text-sm font-medium tracking-widest text-white/40 uppercase">
                  Loading Player
                </div>
              </div>
            ) : !activeUrl ? (
              <div className="flex h-full w-full items-center justify-center px-6 text-center text-sm text-white/65">
                {errorDisplay || `No playable source is available in the ${selectedGroup === 'hindi' ? 'Hindi' : selectedGroup === 'dubbed' ? 'Dubbed' : 'Subbed / Original'} group.`}
              </div>
            ) : canUseVideoJs ? (
              <div className="relative flex h-full w-full items-center justify-center bg-black">
                <video
                  ref={directVideoRef}
                  controls={false}
                  tabIndex={0}
                  autoPlay
                  playsInline
                  onFocus={() => {
                    focusZoneRef.current = 'playback';
                    playerFocusTargetRef.current = 'iframe';
                    sizeFocusedRef.current = false;
                    setIsSizeFocusedVisual(false);
                  }}
                  onPlay={() => {
                    focusZoneRef.current = 'playback';
                  }}
                  onError={() => handleDirectStuckRef.current?.()}
                  onLoadedMetadata={(e) => {
                    const resumeAt = resumeAfterRetryRef.current > 10 ? resumeAfterRetryRef.current : initialResumeTime;
                    if (resumeAt > 10) {
                      try { e.currentTarget.currentTime = resumeAt; } catch (_) {}
                    }
                  }}
                  onTimeUpdate={(e) => {
                    const v = e.currentTarget;
                    if (v.currentTime > 5) {
                      latestPlaybackTimeRef.current = v.currentTime;
                      saveWatchProgress(request, v.currentTime, v.duration);
                    }
                  }}
                  onEnded={() => removeWatchProgress(request)}
                  onWaiting={() => {
                    setIsStreamLoading(true);
                    setIsDirectVideoPlaying(false);
                  }}
                  onPlaying={() => {
                    setIsStreamLoading(false);
                    setIsDirectVideoPlaying(true);
                  }}
                  onPause={() => setIsDirectVideoPlaying(false)}
                  onLoadedData={() => setIsStreamLoading(false)}
                  onCanPlay={() => setIsStreamLoading(false)}
                  className="w-full h-full bg-black object-contain"
                  style={{
                    transform: scale !== 1.0 ? `scale(${scale})` : 'none',
                    transformOrigin: 'center center',
                    transition: 'transform 0.2s ease'
                  }}
                />
                <DirectVideoControls
                  videoRef={directVideoRef}
                  hlsRef={hlsInstanceRef}
                  isTv={isTv}
                  title={request?.seriesTitle || request?.title || ''}
                  onToggleFullscreen={handleToggleFullscreen}
                />
              </div>
            ) : !canEmbedSource ? (
              <div className="flex h-full w-full flex-col items-center justify-center gap-4 px-6 text-center">
                <p className="max-w-lg text-sm leading-6 text-white/70 sm:text-base">
                  This source opens best in a new tab.
                </p>
                {isTv ? (
                  <p className="text-xs text-white/60">Use Open Provider in the top bar to open this stream.</p>
                ) : (
                  <a
                    className="inline-flex items-center justify-center rounded-full bg-white px-5 py-3 text-sm font-semibold text-black transition-colors hover:bg-[#e8e8e8]"
                    href={activeUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open Provider
                  </a>
                )}
              </div>
            ) : (
              <div className={`relative h-full w-full ${activeSource?.id?.includes('cinesu') ? 'cine-crop-wrapper' : ''}`}>
                <iframe
                  ref={iframeRef}
                  key={`${resolvedEmbedUrl}:${iframeReloadKey}`}
                  data-player-frame="true"
                  tabIndex={0}
                  src={resolvedEmbedUrl}
                  scrolling={activeSource?.id?.includes('cinesu') ? 'no' : 'auto'}
                  onFocus={() => {
                    focusZoneRef.current = 'playback';
                    playerFocusTargetRef.current = 'iframe';
                    sizeFocusedRef.current = false;
                    setIsSizeFocusedVisual(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      if (Capacitor.isNativePlatform() && iframeRef.current) {
                        nativeTapCenter(iframeRef.current);
                      }
                    }
                  }}
                  onLoad={() => {
                    focusZoneRef.current = 'playback';
                    console.log('[Soulstash Player Debug] Iframe loaded for URL:', activeUrl);
                    setIsStreamLoading(false);
                    setVerifiedUrls((prev) => new Set(prev).add(activeUrl));

                    // Kick-start telemetry across all supported embed providers:
                    // - VidRift emits vidrift:progress after receiving vidrift:get-state
                    // - VidFast emits player events on getstatus / playerstatus
                    // - VidBolt & FrameXTV & Vidly emit timeupdate / status
                    if (iframeRef.current?.contentWindow) {
                      const win = iframeRef.current.contentWindow;
                      try {
                        win.postMessage({ type: 'vidrift:get-state' }, '*');
                        win.postMessage({ type: 'getstatus' }, '*');
                        win.postMessage({ type: 'PLAYER_EVENT', data: { event: 'playerstatus' } }, '*');
                        win.postMessage({ action: 'getState' }, '*');
                        win.postMessage({ type: 'ping' }, '*');
                      } catch (_) {}
                    }

                    if (initialResumeTime > 5 && iframeRef.current?.contentWindow) {
                      const win = iframeRef.current.contentWindow;
                      const t = Math.floor(initialResumeTime);
                      try {
                        win.postMessage({ type: 'vidrift:resume', currentTime: t }, '*');
                        win.postMessage({ type: 'seek', time: t }, '*');
                        win.postMessage({ command: 'seek', time: t }, '*');
                        win.postMessage({ action: 'seek', time: t }, '*');
                        win.postMessage({ type: 'PLAYER_EVENT', data: { event: 'seek', time: t } }, '*');
                      } catch (_) {}
                    }

                    if (isTv) {
                      focusPlaybackContext('iframe-onload', iframeRef.current);
                      if (Capacitor.isNativePlatform() && iframeRef.current) {
                        nativeTapCenter(iframeRef.current);
                      }
                    }
                  }}
                  onError={(e) => {
                    console.log('[Soulstash Player Debug] Iframe error for URL:', activeUrl, e);
                    setIsStreamLoading(false);
                    handleIframeError(activeUrl);
                  }}
                  className={`h-full w-full border-0 bg-black ${activeSource?.id?.includes('cinesu') ? 'cine-crop-iframe' : ''}`}
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
                  referrerPolicy={activeUrl.includes('youtube.com') || activeUrl.includes('youtube-nocookie.com') || activeUrl.includes('kartoons') ? 'strict-origin-when-cross-origin' : 'no-referrer'}
                  title="Soulstash Player"
                />
                {Capacitor.isNativePlatform() && (activeUrl.includes('youtube.com') || activeUrl.includes('youtu.be') || activeUrl.includes('youtube-nocookie.com')) && (
                  <div className="absolute top-4 right-4 z-[1000001]">
                    <a
                      href={activeUrl.replace('youtube-nocookie.com/embed/', 'youtube.com/watch?v=').replace('youtube.com/embed/', 'youtube.com/watch?v=').split('&')[0]}
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

            {/* Buffering overlay disabled per user request */}
          </div>

          {/* Bottom Sources Section: Toggleable sources panel */}
          {sourcesExpanded && playerDisplayMode !== 3 && (
            <div
              data-player-sources-panel="true"
              onPointerDown={() => {
                focusZoneRef.current = 'controls';
              }}
              onFocusCapture={() => {
                focusZoneRef.current = 'controls';
                playerFocusTargetRef.current = 'controls';
                sizeFocusedRef.current = false;
                setIsSizeFocusedVisual(false);
              }}
              className="shrink-0 flex flex-col min-h-0 max-h-[38vh] overflow-hidden border-t border-white/10 bg-black/95 px-3 sm:px-4 py-2.5 gap-2.5 select-none"
            >
              {/* Sources heading */}
              <div className="flex items-center justify-between pb-1.5 border-b border-white/10">
                <div className="flex items-center gap-2">
                  <i className="fas fa-layer-group text-xs text-white/70" />
                  <span className="text-xs font-bold text-white uppercase tracking-wider">
                    Streams &amp; Sources
                  </span>
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/70 font-mono">
                    {displayedSources.filter((s) => s.url && !failedUrls.has(s.url)).length} available
                  </span>
                </div>

              </div>

              {/* Grouped sources list: vertical stacked groups */}
              <div
                ref={scrollContainerRef}
                className="flex flex-col gap-3 min-h-0 max-h-[26vh] sm:max-h-[200px] overflow-y-auto filter-scrollbar pr-1"
              >
                {/* Hindi Group */}
                {availableHindi.length > 0 && (
                  <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-2.5">
                    <span className="shrink-0 text-[11px] font-bold text-white/50 sm:w-28 pt-1 uppercase tracking-wider">
                      Hindi :
                    </span>
                    <div className="flex flex-wrap items-center gap-1.5 flex-1">
                      {availableHindi.map((source) => {
                        const isActive = Boolean(activeUrl && source.url && activeUrl === source.url);
                        const isFailed = source.failed || failedUrls.has(source.url);
                        const isWorking = source.working || verifiedUrls.has(source.url) || isActive;

                        return (
                          <button
                            key={source.id}
                            type="button"
                            data-player-source="true"
                            data-active-source={isActive}
                            onClick={() => {
                              if (!source.url || isFailed) return;
                              handleSelectSource(source);
                            }}
                            disabled={!source.url || isFailed}
                            className={`inline-flex items-center gap-1.5 shrink-0 rounded-full px-3 py-1 text-[11px] sm:text-xs font-semibold transition-all ${
                              isActive
                                ? 'bg-white text-black font-bold shadow-md scale-[1.02]'
                                : isFailed
                                ? 'opacity-50 bg-red-950/40 text-red-300 border border-red-800/40 cursor-not-allowed'
                                : 'bg-white/10 text-white/80 hover:bg-white/20 hover:text-white'
                            }`}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-black' : isWorking ? 'bg-emerald-400' : 'bg-white/40'}`} />
                            <span>{source.label}</span>
                            {isActive && (
                              <span className="ml-1 rounded bg-black/15 px-1 py-0.2 text-[9px] font-bold uppercase tracking-wider">
                                Playing
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Dubbed Group (hidden if no AniList ID or no dubbed sources) */}
                {effectiveAnilistId && availableDubbed.length > 0 && (
                  <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-2.5">
                    <span className="shrink-0 text-[11px] font-bold text-white/50 sm:w-28 pt-1 uppercase tracking-wider">
                      Dubbed :
                    </span>
                    <div className="flex flex-wrap items-center gap-1.5 flex-1">
                      {availableDubbed.map((source) => {
                        const isActive = Boolean(activeUrl && source.url && activeUrl === source.url);
                        const isFailed = source.failed || failedUrls.has(source.url);
                        const isWorking = source.working || verifiedUrls.has(source.url) || isActive;

                        return (
                          <button
                            key={source.id}
                            type="button"
                            data-player-source="true"
                            data-active-source={isActive}
                            onClick={() => {
                              if (!source.url || isFailed) return;
                              handleSelectSource(source);
                            }}
                            disabled={!source.url || isFailed}
                            className={`inline-flex items-center gap-1.5 shrink-0 rounded-full px-3 py-1 text-[11px] sm:text-xs font-semibold transition-all ${
                              isActive
                                ? 'bg-white text-black font-bold shadow-md scale-[1.02]'
                                : isFailed
                                ? 'opacity-50 bg-red-950/40 text-red-300 border border-red-800/40 cursor-not-allowed'
                                : 'bg-white/10 text-white/80 hover:bg-white/20 hover:text-white'
                            }`}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-black' : isWorking ? 'bg-emerald-400' : 'bg-white/40'}`} />
                            <span>{source.label}</span>
                            {isActive && (
                              <span className="ml-1 rounded bg-black/15 px-1 py-0.2 text-[9px] font-bold uppercase tracking-wider">
                                Playing
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Subbed / Original Group */}
                {availableSubbed.length > 0 && (
                  <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-2.5">
                    <span className="shrink-0 text-[11px] font-bold text-white/50 sm:w-28 pt-1 uppercase tracking-wider">
                      Subbed / Original :
                    </span>
                    <div className="flex flex-wrap items-center gap-1.5 flex-1">
                      {availableSubbed.map((source) => {
                        const isActive = Boolean(activeUrl && source.url && activeUrl === source.url);
                        const isFailed = source.failed || failedUrls.has(source.url);
                        const isWorking = source.working || verifiedUrls.has(source.url) || isActive;

                        return (
                          <button
                            key={source.id}
                            type="button"
                            data-player-source="true"
                            data-active-source={isActive}
                            onClick={() => {
                              if (!source.url || isFailed) return;
                              handleSelectSource(source);
                            }}
                            disabled={!source.url || isFailed}
                            className={`inline-flex items-center gap-1.5 shrink-0 rounded-full px-3 py-1 text-[11px] sm:text-xs font-semibold transition-all ${
                              isActive
                                ? 'bg-white text-black font-bold shadow-md scale-[1.02]'
                                : isFailed
                                ? 'opacity-50 bg-red-950/40 text-red-300 border border-red-800/40 cursor-not-allowed'
                                : 'bg-white/10 text-white/80 hover:bg-white/20 hover:text-white'
                            }`}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-black' : isWorking ? 'bg-emerald-400' : 'bg-white/40'}`} />
                            <span>{source.label}</span>
                            {isActive && (
                              <span className="ml-1 rounded bg-black/15 px-1 py-0.2 text-[9px] font-bold uppercase tracking-wider">
                                Playing
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
              <div className="shrink-0 flex justify-end border-t border-white/10 pt-2">
                <button
                  ref={sourceHideRef}
                  type="button"
                  data-player-action="true"
                  data-player-hide-sources="true"
                  onClick={handleCloseSources}
                  className="inline-flex items-center gap-1.5 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 px-3 py-1.5 text-[11px] font-semibold text-white/80 hover:text-white transition-all"
                  aria-label="Hide sources"
                  title="Hide Streams"
                >
                  <i className="fas fa-times text-[10px]" />
                  <span>Hide sources</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (!isValidRequest) return null;
  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
}
