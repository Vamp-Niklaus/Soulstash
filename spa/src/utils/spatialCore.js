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
  // Prioritize primary axis distance over lateral perfect alignment
  return (pri * 3) + lat;
}

export function applyFocus(el, scroll = true) {
  if (!el || el === document.activeElement) return;
  if (lastFocused && lastFocused !== el) lastFocused.classList.remove(FOCUSED);
  el.focus({ preventScroll: true });
  el.classList.add(FOCUSED);
  lastFocused = el;
  if (scroll) el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
}
