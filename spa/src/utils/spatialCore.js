export const FOCUSABLE_SEL = [
  'button:not([disabled]):not([data-tv-skip])',
  'a[href]:not([data-tv-skip])',
  '[role="button"]:not([disabled]):not([data-tv-skip])',
  '[tabindex="0"]:not([data-tv-skip])',
  'iframe[tabindex="0"]:not([data-tv-skip])',
  'input:not([disabled]):not([type="hidden"]):not([data-tv-skip])',
  'select:not([disabled]):not([data-tv-skip])',
  'textarea:not([disabled]):not([data-tv-skip])',
].join(',');

export const FOCUSED = 'tv-focused';
export let lastFocused = null;
export let lastRect = null;

export function setLastFocused(el) {
  lastFocused = el;
}

export function isVisible(el) {
  if (el.disabled) return false;
  if (el.getAttribute('aria-hidden') === 'true') return false;
  const s = getComputedStyle(el);
  if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
  const tag = el.tagName;
  const isInteractive = tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' ||
    tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'IFRAME' ||
    el.getAttribute('role') === 'button' || el.hasAttribute('tabindex');
  if (!isInteractive && s.pointerEvents === 'none') return false;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return false;
  if (r.bottom < -100 || r.top > window.innerHeight + 100) return false;
  return true;
}

export function getFocusable() {
  return Array.from(document.querySelectorAll(FOCUSABLE_SEL)).filter(isVisible);
}

export function getFocusableIn(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll(FOCUSABLE_SEL)).filter(isVisible);
}

export function center(r) {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

export function score(fromR, toR, dir) {
  const f = center(fromR), t = center(toR);
  const dx = t.x - f.x, dy = t.y - f.y;

  if (dir === 'ArrowRight' && dx <= 2)  return Infinity;
  if (dir === 'ArrowLeft'  && dx >= -2) return Infinity;
  if (dir === 'ArrowDown'  && dy <= 2)  return Infinity;
  if (dir === 'ArrowUp'    && dy >= -2) return Infinity;

  const horiz = dir === 'ArrowLeft' || dir === 'ArrowRight';
  const pri   = Math.abs(horiz ? dx : dy);
  const lat   = Math.abs(horiz ? dy : dx);
  // Edge gap along the travel axis (so big neighbours aren't penalised by their size)
  const gap = Math.max(0, dir === 'ArrowRight' ? toR.left - fromR.right
    : dir === 'ArrowLeft' ? fromR.left - toR.right
    : dir === 'ArrowDown' ? toR.top - fromR.bottom
    : fromR.top - toR.bottom);
  // Does the candidate share our row (horizontal moves) or column (vertical moves)?
  const overlap = horiz
    ? Math.min(fromR.bottom, toR.bottom) - Math.max(fromR.top, toR.top)
    : Math.min(fromR.right, toR.right) - Math.max(fromR.left, toR.left);
  const aligned = overlap > 0;
  // Stay inside a 60deg cone unless nothing aligned exists
  if (!aligned && lat > pri * 1.8) return 1e6 + pri + lat;
  return (aligned ? 0 : 5000) + gap * 2 + pri + lat * 2;
}

export function applyFocus(el, scroll = true) {
  if (!el) return;
  if (el === document.activeElement) { el.classList.add(FOCUSED); lastFocused = el; lastRect = el.getBoundingClientRect(); return; }
  if (lastFocused && lastFocused !== el) lastFocused.classList.remove(FOCUSED);
  el.focus({ preventScroll: true });
  el.classList.add(FOCUSED);
  lastFocused = el;
  lastRect = el.getBoundingClientRect();
  if (scroll) el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
}
