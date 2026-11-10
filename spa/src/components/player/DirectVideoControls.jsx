import { useEffect, useState } from 'react';

// Control overlay for direct (non-iframe) streams. Replaces the browser's native
// controls so direct streams get the same look and keyboard/remote flow as the rest of the player.

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const EVENTS = ['play', 'pause', 'timeupdate', 'durationchange', 'loadedmetadata', 'volumechange', 'ratechange'];
const BTN = 'flex h-9 w-9 items-center justify-center rounded-full text-white/90 hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500';
const MENU_BUTTONS = [
  { key: 'subtitles', icon: 'fa-closed-captioning', label: 'Subtitles' },
  { key: 'audio', icon: 'fa-music', label: 'Audio' },
  { key: 'quality', icon: 'fa-sliders-h', label: 'Quality' },
  { key: 'settings', icon: 'fa-cog', label: 'Settings' }
];

const pad = (n) => String(n).padStart(2, '0');

function formatTime(seconds) {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

export function DirectVideoControls({ videoRef, hlsRef, onToggleFullscreen }) {
  const [snap, setSnap] = useState({ paused: true, time: 0, duration: 0, volume: 1, muted: false, rate: 1 });
  const [menu, setMenu] = useState(null);
  const [wakeTick, setWakeTick] = useState(0);
  const [visible, setVisible] = useState(true);

  // Mirror the video element's state into React state.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return undefined;
    const sync = () => setSnap({
      paused: el.paused,
      time: el.currentTime || 0,
      duration: Number.isFinite(el.duration) ? el.duration : 0,
      volume: el.volume,
      muted: el.muted,
      rate: el.playbackRate
    });
    EVENTS.forEach((ev) => el.addEventListener(ev, sync));
    sync();
    return () => EVENTS.forEach((ev) => el.removeEventListener(ev, sync));
  }, [videoRef]);

  // Hide the bar after 3s of playing with no pointer/focus activity; keep it open while a menu is up.
  useEffect(() => {
    if (snap.paused || menu) {
      setVisible(true);
      return undefined;
    }
    const t = window.setTimeout(() => setVisible(false), 3000);
    return () => window.clearTimeout(t);
  }, [snap.paused, menu, wakeTick]);

  const wake = () => setWakeTick((t) => t + 1);
  const el = () => videoRef.current;

  const togglePlay = () => {
    const v = el();
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  };
  const skip = (delta) => {
    const v = el();
    if (!v) return;
    const max = Number.isFinite(v.duration) ? v.duration : v.currentTime;
    v.currentTime = Math.max(0, Math.min(max, v.currentTime + delta));
  };
  const seek = (value) => {
    const v = el();
    if (v) v.currentTime = Number(value) || 0;
  };
  const toggleMute = () => {
    const v = el();
    if (v) v.muted = !v.muted;
  };
  const setVolume = (value) => {
    const v = el();
    if (!v) return;
    const next = Number(value);
    v.volume = next;
    v.muted = next === 0;
  };

  // Track lists come from the video element (subtitles) and hls.js (audio, quality).
  const v = el();
  const subtitleTracks = v ? Array.from(v.textTracks || []).filter((t) => t.kind === 'subtitles' || t.kind === 'captions') : [];
  const hls = hlsRef?.current || null;
  const audioTracks = hls?.audioTracks || [];
  const qualityLevels = hls?.levels || [];

  const menus = {
    subtitles: {
      title: 'Subtitles',
      items: subtitleTracks.length === 0 ? [] : [
        {
          label: 'Off',
          active: subtitleTracks.every((t) => t.mode !== 'showing'),
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
      items: !hls || qualityLevels.length === 0 ? [] : [
        {
          label: 'Auto',
          active: hls.currentLevel === -1,
          onSelect: () => { hls.currentLevel = -1; }
        },
        ...qualityLevels.map((level, i) => ({
          label: level.height ? `${level.height}p` : `${Math.round((level.bitrate || 0) / 1000)} kbps`,
          active: hls.currentLevel === i,
          onSelect: () => { hls.currentLevel = i; }
        }))
      ]
    },
    settings: {
      title: 'Playback speed',
      items: SPEEDS.map((s) => ({
        label: `${s}x`,
        active: snap.rate === s,
        onSelect: () => { const e = el(); if (e) e.playbackRate = s; }
      }))
    }
  };
  const openMenu = menus[menu];

  return (
    <div
      className="absolute inset-0 z-10 flex flex-col justify-end"
      onPointerMove={wake}
      onPointerDown={wake}
      onFocusCapture={wake}
    >
      <div className={`flex flex-col transition-opacity duration-300 ${visible ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
        {openMenu && (
          <div className="mx-3 mb-2 max-h-[50%] w-56 self-end overflow-y-auto rounded-xl border border-white/10 bg-black/90 p-2 text-sm text-white">
            <div className="px-2 pb-1 text-xs font-bold uppercase tracking-wider text-white/60">{openMenu.title}</div>
            {openMenu.items.length === 0 ? (
              <div className="px-2 py-2 text-white/60">Not available for this stream</div>
            ) : openMenu.items.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => { item.onSelect(); setMenu(null); }}
                className={`flex w-full items-center justify-between rounded-lg px-2 py-2 text-left hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${item.active ? 'text-red-400' : ''}`}
              >
                <span>{item.label}</span>
                {item.active && <span aria-hidden="true">✓</span>}
              </button>
            ))}
          </div>
        )}

        <div className="bg-gradient-to-t from-black/90 to-transparent px-3 pb-3 pt-10">
          <input
            type="range"
            aria-label="Seek"
            min={0}
            max={snap.duration || 1}
            step={0.1}
            value={Math.min(snap.time, snap.duration || 1)}
            onChange={(e) => seek(e.target.value)}
            className="w-full accent-red-600"
          />
          <div className="mt-1 flex items-center gap-1">
            <button type="button" className={BTN} onClick={togglePlay} aria-label={snap.paused ? 'Play' : 'Pause'}>
              <i className={`fas ${snap.paused ? 'fa-play' : 'fa-pause'} text-sm`} />
            </button>
            <button type="button" className={BTN} onClick={() => skip(-10)} aria-label="Back 10 seconds">
              <i className="fas fa-backward text-xs" />
            </button>
            <button type="button" className={BTN} onClick={() => skip(10)} aria-label="Forward 10 seconds">
              <i className="fas fa-forward text-xs" />
            </button>
            <button type="button" className={BTN} onClick={toggleMute} aria-label={snap.muted ? 'Unmute' : 'Mute'}>
              <i className={`fas ${snap.muted || snap.volume === 0 ? 'fa-volume-mute' : 'fa-volume-up'} text-xs`} />
            </button>
            <input
              type="range"
              aria-label="Volume"
              min={0}
              max={1}
              step={0.05}
              value={snap.muted ? 0 : snap.volume}
              onChange={(e) => setVolume(e.target.value)}
              className="w-20 accent-red-600"
            />
            <span className="ml-2 font-mono text-xs text-white/80">
              {formatTime(snap.time)} / {formatTime(snap.duration)}
            </span>
            <div className="ml-auto flex items-center gap-1">
              {MENU_BUTTONS.map((b) => (
                <button
                  key={b.key}
                  type="button"
                  className={`${BTN} ${menu === b.key ? 'bg-white/20' : ''}`}
                  onClick={() => setMenu(menu === b.key ? null : b.key)}
                  aria-label={b.label}
                  aria-expanded={menu === b.key}
                >
                  <i className={`fas ${b.icon} text-xs`} />
                </button>
              ))}
              {onToggleFullscreen && (
                <button type="button" className={BTN} onClick={onToggleFullscreen} aria-label="Fullscreen">
                  <i className="fas fa-expand text-xs" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
