// Shared keyboard / remote navigation for the Kartoon internal player overlay.
// Used by the TV spatial-nav hook and by the desktop key handler, so both behave the same.
//
// Rows (top to bottom):
//   0  CC / Audio / Quality / Settings
//   1  -10s / Play-Pause / +10s
//   2  seek line (Left/Right = -120s / +120s)
//   3  Play-Pause / Prev / Next / Mute / volume (Left/Right = -/+ volume) / Fullscreen
// Up/Down move between rows (nearest button by horizontal position).
// Down from the last row returns focus to the video. Inside an open menu, Up/Down move through its items.

import { seekTo } from './hlsSession.js';

// Left/Right on the focused seek line jump this many seconds (the -10s / +10s buttons and the focused video keep 10s).
export const SEEK_LINE_STEP = 120;

export function seekVideo(video, delta) {
  if (!video) return;
  // seekTo clamps to the real duration (video.duration can be Infinity for HLS, which used to block forward seeks).
  seekTo(video, video.currentTime + delta);
}

export function changeVideoVolume(video, delta) {
  if (!video) return;
  const next = Math.max(0, Math.min(1, video.volume + delta));
  video.volume = next;
  video.muted = next === 0;
}

const itemsIn = (container) => Array.from(
  container.querySelectorAll('button:not(:disabled), input[data-direct-slider]')
).filter((el) => el.getClientRects().length > 0);

const centreX = (el) => {
  const r = el.getBoundingClientRect();
  return r.left + r.width / 2;
};

// Returns true when the key was handled.
export function handleDirectOverlayKey(key, active, overlay, video, focusEl) {
  if (!overlay || !active || !overlay.contains(active)) return false;

  const menu = active.closest('[data-direct-menu]');
  if (menu) {
    if (key !== 'ArrowUp' && key !== 'ArrowDown') return false;
    const items = itemsIn(menu);
    const idx = items.indexOf(active);
    if (idx < 0 || !items.length) return true;
    const step = key === 'ArrowDown' ? 1 : -1;
    focusEl(items[(idx + step + items.length) % items.length]);
    return true;
  }

  const rows = Array.from(overlay.querySelectorAll('[data-direct-row]'));
  const r = rows.findIndex((row) => row.contains(active));
  if (r < 0) return false;

  const slider = active.getAttribute('data-direct-slider');
  const rowItems = itemsIn(rows[r]);
  const idx = rowItems.indexOf(active);

  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    const dir = key === 'ArrowRight' ? 1 : -1;
    if (slider === 'seek') { seekVideo(video, dir * SEEK_LINE_STEP); return true; }
    if (slider === 'volume') { changeVideoVolume(video, dir * 0.05); return true; }
    if (idx < 0 || rowItems.length === 0) return true;
    focusEl(rowItems[(idx + dir + rowItems.length) % rowItems.length]);
    return true;
  }

  if (key === 'ArrowUp' || key === 'ArrowDown') {
    const dir = key === 'ArrowDown' ? 1 : -1;
    const targetRow = rows[r + dir];
    if (!targetRow) {
      if (dir === 1 && video) focusEl(video);
      return true;
    }
    const targets = itemsIn(targetRow);
    if (targets.length === 0) return true;
    const from = centreX(active);
    let best = targets[0];
    let bestDist = Infinity;
    for (const t of targets) {
      const d = Math.abs(centreX(t) - from);
      if (d < bestDist) { bestDist = d; best = t; }
    }
    focusEl(best);
    return true;
  }

  return false;
}
