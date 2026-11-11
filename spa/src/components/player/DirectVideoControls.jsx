import { useEffect, useRef, useState } from 'react';
import { handleDirectOverlayKey, seekVideo, changeVideoVolume } from './directOverlayNav.js';
import { getMediaDuration, seekTo } from './hlsSession.js';

// Control overlay for direct (non-iframe) streams. Layout follows the kartoons.to player.
// Keys on the focused video: Left/Right seek 10s, Up/Down volume, Enter/Space play/pause (desktop; TV handled by useSpatialNav).
// Keys on the buttons and sliders: handled by directOverlayNav.js (rows, seek line, volume).

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const ASPECTS = [
  { key: 'contain', label: 'Original' },
  { key: 'cover', label: 'Zoom' },
  { key: 'fill', label: 'Stretch' }
];
const AUTONEXT_KEY = 'soulstash_autonext';
const EVENTS = ['play', 'pause', 'timeupdate', 'durationchange', 'loadedmetadata', 'volumechange', 'ratechange', 'waiting', 'playing', 'progress', 'seeking', 'seeked'];
const ICON_BTN = 'flex h-9 w-9 items-center justify-center rounded-full text-white/95 hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500';
const TEXT_BTN = 'flex h-9 items-center justify-center rounded-full px-3 text-xs font-bold text-white/95 hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500';

const pad = (n) => String(n).padStart(2, '0');

function formatTime(seconds) {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

function levelLabel(level) {
  if (!level) return '';
  if (level.height >= 2160) return '4K';
  if (level.height) return `${level.height}p`;
  return `${Math.round((level.bitrate || 0) / 1000)}k`;
}

function readAutoNext() {
  try { return localStorage.getItem(AUTONEXT_KEY) === '1'; } catch (_) { return false; }
}

function togglePlayEl(el) {
  if (el.paused) el.play().catch(() => {});
  else el.pause();
}

function bufferedEndAt(el) {
  try {
    const b = el.buffered;
    const t = el.currentTime || 0;
    for (let i = 0; i < b.length; i += 1) {
      if (t >= b.start(i) - 0.05 && t <= b.end(i) + 0.05) return b.end(i);
    }
  } catch (_) { /* ignore */ }
  return 0;
}

export function DirectVideoControls({ videoRef, hlsRef, isTv, title, onToggleFullscreen, onPrevEpisode, onNextEpisode }) {
  const [snap, setSnap] = useState({ paused: true, time: 0, duration: 0, buffered: 0, seeking: false, volume: 1, muted: false, rate: 1, loop: false });
  const [scrub, setScrub] = useState(null); // seconds while the user is dragging / has just clicked the seek line
  const scrubRef = useRef(null);
  const scrubTimer = useRef(0);
  const [menu, setMenu] = useState(null);
  const [wakeTick, setWakeTick] = useState(0);
  const [visible, setVisible] = useState(true);
  const [aspectIndex, setAspectIndex] = useState(0);
  const [autoNext, setAutoNext] = useState(readAutoNext);
  const overlayRef = useRef(null);
  const autoNextRef = useRef(autoNext);
  const onNextRef = useRef(onNextEpisode);
  autoNextRef.current = autoNext;
  onNextRef.current = onNextEpisode;

  const wake = () => setWakeTick((t) => t + 1);

  // Mirror the video element's state into React state.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return undefined;
    const sync = () => setSnap({
      paused: el.paused,
      time: el.currentTime || 0,
      duration: getMediaDuration(el, hlsRef?.current),
      buffered: bufferedEndAt(el),
      seeking: el.seeking,
      volume: el.volume,
      muted: el.muted,
      rate: el.playbackRate,
      loop: el.loop
    });
    EVENTS.forEach((ev) => el.addEventListener(ev, sync));
    sync();
    return () => EVENTS.forEach((ev) => el.removeEventListener(ev, sync));
  }, [videoRef, hlsRef]);

  // Auto next: when the episode ends, move on if the option is on and a next episode exists.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return undefined;
    const onEnded = () => {
      if (autoNextRef.current && onNextRef.current) onNextRef.current();
    };
    el.addEventListener('ended', onEnded);
    return () => el.removeEventListener('ended', onEnded);
  }, [videoRef]);

  // Keyboard on the focused video (desktop). TV mode is handled earlier by useSpatialNav.
  useEffect(() => {
    if (isTv) return undefined;
    const el = videoRef.current;
    if (!el) return undefined;
    const onKey = (e) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      switch (e.key) {
        case 'ArrowLeft': seekVideo(el, -10); break;
        case 'ArrowRight': seekVideo(el, 10); break;
        case 'ArrowUp': changeVideoVolume(el, 0.1); break;
        case 'ArrowDown': changeVideoVolume(el, -0.1); break;
        case 'Enter':
        case ' ': togglePlayEl(el); break;
        default: return;
      }
      e.preventDefault();
      e.stopPropagation();
      wake();
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, [videoRef, isTv]);

  // TV: any remote key shows the controls, so focus never lands on a hidden button.
  useEffect(() => {
    if (!isTv) return undefined;
    const onKey = () => setWakeTick((t) => t + 1);
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [isTv]);

  // Apply aspect ratio to the video element.
  useEffect(() => {
    const el = videoRef.current;
    if (el) el.style.objectFit = ASPECTS[aspectIndex].key;
  }, [videoRef, aspectIndex]);

  // Hide the chrome after 3s of playback with no activity. Stay open while a menu is up
  // or while focus is on one of the controls.
  useEffect(() => {
    if (snap.paused || menu) {
      setVisible(true);
      return undefined;
    }
    const t = window.setTimeout(() => {
      if (!overlayRef.current?.contains(document.activeElement)) setVisible(false);
    }, 3000);
    return () => window.clearTimeout(t);
  }, [snap.paused, menu, wakeTick]);

  const el = () => videoRef.current;

  const togglePlay = () => { const v = el(); if (v) togglePlayEl(v); };
  const skip = (delta) => { const v = el(); if (v) seekVideo(v, delta); };
  // Seek line: while the user drags we only move the thumb; the real seek happens once they pause or
  // release. Seeking on every pixel made hls.js abort each chunk it had just started downloading,
  // so nothing ever finished loading and playback fell back to the old chunks.
  const commitSeek = () => {
    window.clearTimeout(scrubTimer.current);
    const target = scrubRef.current;
    if (target === null) return;
    scrubRef.current = null;
    setScrub(null);
    const v = el();
    if (v) seekTo(v, target, hlsRef?.current);
  };
  const previewSeek = (value) => {
    const n = Number(value) || 0;
    scrubRef.current = n;
    setScrub(n);
    window.clearTimeout(scrubTimer.current);
    scrubTimer.current = window.setTimeout(commitSeek, 250);
  };
  useEffect(() => () => window.clearTimeout(scrubTimer.current), []);
  const toggleMute = () => { const v = el(); if (v) v.muted = !v.muted; };
  const setVolume = (value) => {
    const v = el();
    if (!v) return;
    const next = Number(value);
    v.volume = next;
    v.muted = next === 0;
  };

  // Desktop: arrow keys move between rows and buttons, and the seek and volume lines adjust playback.
  const onOverlayKey = (e) => {
    if (isTv) return;
    wake();
    const handled = handleDirectOverlayKey(
      e.key,
      document.activeElement,
      overlayRef.current,
      videoRef.current,
      (target) => target.focus({ preventScroll: true })
    );
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  // Track lists: text tracks from the video element, audio and quality from hls.js.
  const v = el();
  const subtitleTracks = v ? Array.from(v.textTracks || []).filter((t) => t.kind === 'subtitles' || t.kind === 'captions') : [];
  const activeSubtitle = subtitleTracks.find((t) => t.mode === 'showing');
  const hls = hlsRef?.current || null;
  const audioTracks = hls?.audioTracks || [];
  const qualityLevels = hls?.levels || [];
  const currentLevel = hls && hls.currentLevel >= 0 ? qualityLevels[hls.currentLevel] : null;

  const cycleSpeed = () => {
    const idx = SPEEDS.indexOf(snap.rate);
    const next = SPEEDS[(idx + 1) % SPEEDS.length];
    const e = el();
    if (e) e.playbackRate = next;
  };
  const cycleAspect = () => setAspectIndex((i) => (i + 1) % ASPECTS.length);
  const toggleLoop = () => { const e = el(); if (e) e.loop = !e.loop; };
  const toggleAutoNext = () => {
    const next = !autoNext;
    setAutoNext(next);
    try { localStorage.setItem(AUTONEXT_KEY, next ? '1' : '0'); } catch (_) {}
  };

  const menus = {
    subtitles: {
      title: 'Subtitles',
      items: subtitleTracks.length === 0 ? [] : [
        {
          label: 'Off',
          active: !activeSubtitle,
          onSelect: () => subtitleTracks.forEach((t) => { t.mode = 'disabled'; })
        },
        ...subtitleTracks.map((t, i) => ({
          label: t.label || t.language || `Track ${i + 1}`,
          active: t.mode === 'showing',
          onSelect: () => subtitleTracks.forEach((x) => { x.mode = x === t ? 'showing' : 'disabled'; })
        }))
      ]
    },
    audio: {
      title: 'Audio',
      items: audioTracks.map((t, i) => ({
        label: t.name || t.lang || `Audio ${i + 1}`,
        active: hls?.audioTrack === i,
        onSelect: () => { if (hls) hls.audioTrack = i; }
      }))
    },
    quality: {
      title: 'Quality',
      items: qualityLevels.length === 0 ? [] : [
        { label: 'Auto', active: !hls || hls.currentLevel === -1, onSelect: () => { if (hls) hls.currentLevel = -1; } },
        ...qualityLevels.map((level, i) => ({
          label: levelLabel(level),
          active: hls?.currentLevel === i,
          onSelect: () => { if (hls) hls.currentLevel = i; }
        }))
      ]
    },
    settings: {
      title: 'Settings',
      items: [
        {
          label: 'Subtitles',
          value: activeSubtitle ? (activeSubtitle.label || activeSubtitle.language || 'On') : 'Off',
          keepOpen: true,
          onSelect: () => setMenu('subtitles')
        },
        { label: 'Playback speed', value: `${snap.rate}x`, keepOpen: true, onSelect: cycleSpeed },
        { label: 'Aspect ratio', value: ASPECTS[aspectIndex].label, keepOpen: true, onSelect: cycleAspect },
        { label: 'Loop', value: snap.loop ? 'On' : 'Off', keepOpen: true, onSelect: toggleLoop },
        { label: 'Auto next', value: autoNext ? 'On' : 'Off', keepOpen: true, onSelect: toggleAutoNext }
      ]
    }
  };
  const openMenu = menus[menu];

  return (
    <div
      ref={overlayRef}
      data-direct-player="true"
      className="absolute inset-0 z-10 flex flex-col justify-between select-none"
      onPointerMove={wake}
      onPointerDown={wake}
      onFocusCapture={wake}
      onKeyDown={onOverlayKey}
      onClick={(e) => { if (e.target === e.currentTarget && !menu) togglePlay(); }}
    >
      {/* Row 0: title and CC / audio / quality / settings. Opacity only, so the bar still takes mouse input while faded. */}
      <div
        data-direct-row="0"
        className={`flex items-start justify-between gap-2 bg-gradient-to-b from-black/70 to-transparent px-4 pb-8 pt-3 transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`}
      >
        <div className="min-w-0 truncate text-sm font-semibold text-white/95">{title}</div>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" className={ICON_BTN} aria-label="Subtitles" aria-expanded={menu === 'subtitles'} onClick={() => setMenu(menu === 'subtitles' ? null : 'subtitles')}>
            <i className="fas fa-closed-captioning text-sm" />
          </button>
          <button type="button" className={ICON_BTN} aria-label="Audio" aria-expanded={menu === 'audio'} onClick={() => setMenu(menu === 'audio' ? null : 'audio')}>
            <i className="fas fa-headphones text-sm" />
          </button>
          <button type="button" className={TEXT_BTN} aria-label="Quality" aria-expanded={menu === 'quality'} onClick={() => setMenu(menu === 'quality' ? null : 'quality')}>
            {currentLevel ? levelLabel(currentLevel) : 'Auto'}
          </button>
          <button type="button" className={ICON_BTN} aria-label="Settings" aria-expanded={menu === 'settings'} onClick={() => setMenu(menu === 'settings' ? null : 'settings')}>
            <i className="fas fa-cog text-sm" />
          </button>
        </div>
      </div>

      {/* Popup menu for the open option */}
      {openMenu && (
        <div data-direct-menu="true" className="absolute right-3 top-14 max-h-[60%] w-60 overflow-y-auto rounded-xl border border-white/10 bg-black/90 p-2 text-sm text-white shadow-xl">
          <div className="px-2 pb-1 text-xs font-bold uppercase tracking-wider text-white/60">{openMenu.title}</div>
          {openMenu.items.length === 0 ? (
            <div className="px-2 py-2 text-white/60">Not available for this stream</div>
          ) : openMenu.items.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => {
                item.onSelect();
                if (!item.keepOpen) setMenu(null);
              }}
              className={`flex w-full items-center justify-between rounded-lg px-2 py-2 text-left hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${item.active ? 'text-red-400' : ''}`}
            >
              <span>{item.label}</span>
              {item.value !== undefined ? (
                <span className="text-xs text-white/70">{item.value}</span>
              ) : (
                item.active && <span aria-hidden="true">✓</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Row 1: -10s / play-pause / +10s */}
      <div
        data-direct-row="1"
        className={`flex items-center justify-center gap-10 transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`}
      >
        <button type="button" className={ICON_BTN} onClick={() => skip(-10)} aria-label="Back 10 seconds">
          <i className="fas fa-undo text-xl" />
        </button>
        <button type="button" className={`${ICON_BTN} h-16 w-16 bg-black/30`} onClick={togglePlay} aria-label={snap.paused ? 'Play' : 'Pause'}>
          <i className={`fas ${snap.paused ? 'fa-play' : 'fa-pause'} text-2xl`} />
        </button>
        <button type="button" className={ICON_BTN} onClick={() => skip(10)} aria-label="Forward 10 seconds">
          <i className="fas fa-redo text-xl" />
        </button>
      </div>

      {/* Bottom: seek line and transport row */}
      <div className={`bg-gradient-to-t from-black/80 to-transparent px-3 pb-2 pt-8 transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`}>
        <div data-direct-row="2" className="group relative mb-1 flex h-5 items-center">
          {(() => {
            const dur = snap.duration || 0;
            const shown = scrub !== null ? scrub : snap.time;
            const pct = (x) => (dur > 0 ? Math.max(0, Math.min(100, (x / dur) * 100)) : 0);
            return (
              <>
                <div className="pointer-events-none absolute inset-x-0 h-1 overflow-hidden rounded-full bg-white/25 transition-all group-hover:h-1.5 group-focus-within:h-1.5">
                  <div className="absolute inset-y-0 left-0 bg-white/40" style={{ width: `${pct(snap.buffered)}%` }} />
                  <div className="absolute inset-y-0 left-0 bg-red-600" style={{ width: `${pct(shown)}%` }} />
                </div>
                <div
                  className={`pointer-events-none absolute h-3 w-3 -translate-x-1/2 rounded-full bg-red-600 transition-transform group-hover:scale-125 group-focus-within:scale-125 ${snap.seeking ? 'animate-pulse' : ''}`}
                  style={{ left: `${pct(shown)}%` }}
                />
                <input
                  type="range"
                  aria-label="Seek"
                  data-direct-slider="seek"
                  min={0}
                  max={dur || 1}
                  step={0.1}
                  value={Math.min(shown, dur || 1)}
                  onChange={(e) => previewSeek(e.target.value)}
                  onPointerUp={commitSeek}
                  onBlur={commitSeek}
                  disabled={!dur}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                />
              </>
            );
          })()}
        </div>
        <div data-direct-row="3" className="flex items-center gap-1">
          <button type="button" className={ICON_BTN} onClick={togglePlay} aria-label={snap.paused ? 'Play' : 'Pause'}>
            <i className={`fas ${snap.paused ? 'fa-play' : 'fa-pause'} text-sm`} />
          </button>
          {onPrevEpisode && (
            <button type="button" className={ICON_BTN} onClick={onPrevEpisode} aria-label="Previous episode">
              <i className="fas fa-step-backward text-sm" />
            </button>
          )}
          {onNextEpisode && (
            <button type="button" className={ICON_BTN} onClick={onNextEpisode} aria-label="Next episode">
              <i className="fas fa-step-forward text-sm" />
            </button>
          )}
          <button type="button" className={ICON_BTN} onClick={toggleMute} aria-label={snap.muted ? 'Unmute' : 'Mute'}>
            <i className={`fas ${snap.muted || snap.volume === 0 ? 'fa-volume-mute' : 'fa-volume-up'} text-xs`} />
          </button>
          <input
            type="range"
            aria-label="Volume"
            data-direct-slider="volume"
            min={0}
            max={1}
            step={0.05}
            value={snap.muted ? 0 : snap.volume}
            onChange={(e) => setVolume(e.target.value)}
            className="w-20 accent-red-600"
          />
          <span className="ml-2 font-mono text-xs text-white/85">
            {formatTime(snap.time)} / {formatTime(snap.duration)}
          </span>
          <div className="ml-auto flex items-center gap-1">
            {onToggleFullscreen && (
              <button type="button" className={ICON_BTN} onClick={onToggleFullscreen} aria-label="Fullscreen">
                <i className="fas fa-expand text-sm" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
