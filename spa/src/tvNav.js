'use strict';

/**
 * tvNav.js — Spatial D-pad navigation for Soulstash TV/Capacitor
 *
 * FIXES in this version
 * ─────────────────────
 * 1. Focus ring is HIDDEN until first arrow/Enter key press — INVISIBLE on
 *    laptop/web. Mouse/touch hides it immediately AND resets _navActive so the
 *    ring never re-appears after mousing around (was only dimming, not resetting).
 * 2. Auto-dim at 3 s, fully hidden at 6 s — ring also stops auto-showing on
 *    every route change when the user is on mouse/touch.
 * 3. Focus colour: white ring only (rgba 255,255,255). Yellow browser default
 *    outline suppressed everywhere including `focus-visible` and
 *    `focus:ring-white` Tailwind classes that emit yellow on some browsers.
 * 4. "Add Content" drawer: close (×) button is reachable; ArrowDown from
 *    search input reaches results; Escape closes the drawer.
 * 5. Collection page filter pills: navigable (data-tv-filters zone).
 * 6. Movie/series detail: ArrowDown from navbar → play button first, NOT
 *    directors/cast metadata below it.
 * 7. Search page: ArrowDown from search input moves to results; Escape closes
 *    overlay and returns focus to search button.
 * 8. Remove-from-collection button (×) on cards is reachable via ArrowRight.
 * 9. Player modal: source buttons + action buttons (switch, reload, zoom,
 *    open, close) are all tab-reachable; iframe itself is skipped since it
 *    handles its own keyboard; focus stays inside the modal while it is open.
 *10. No layout shift on poster cards — outline-only focus ring, no transform.
 *11. Collections page filter navigation — works the same as the separate
 *    collection detail page (was broken because zone detection needed the
 *    right CSS selector).
 */

import { useEffect } from 'react';

// ─── Constants ────────────────────────────────────────────────────────────────

const FOCUSABLE_SEL = [
  'button:not([disabled]):not([data-tv-skip])',
  'a[href]:not([data-tv-skip])',
  '[role="button"]:not([disabled]):not([data-tv-skip])',
  '[tabindex="0"]:not([data-tv-skip])',
  'iframe[tabindex="0"]:not([data-tv-skip])',
  'input:not([disabled]):not([type="hidden"]):not([data-tv-skip])',
  'select:not([disabled]):not([data-tv-skip])',
  'textarea:not([disabled]):not([data-tv-skip])',
].join(',');

const ACTIVATE  = new Set(['Enter', ' ']);
const NAV       = new Set(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight']);
const BACK      = new Set(['Escape','Backspace']);
const CONTROL   = new Set(['Tab']);
const ALL_KEYS  = new Set([...ACTIVATE, ...NAV, ...BACK, ...CONTROL]);
const FOCUSED   = 'tv-focused';
const DIM_MS    = 3000;
const HIDE_MS   = 6000;

// ─── State ────────────────────────────────────────────────────────────────────

let _navActive   = false;
let _dimTimer    = null;
let _hideTimer   = null;
let _lastFocused = null;
let _installed   = false;

// ─── Focus ring visibility ────────────────────────────────────────────────────

function showRing() {
  if (!_navActive) {
    _navActive = true;
    document.documentElement.classList.add('tv-nav-active');
  }
  document.documentElement.classList.remove('tv-nav-dim', 'tv-nav-hidden');
  clearTimeout(_dimTimer);
  clearTimeout(_hideTimer);
  _dimTimer  = setTimeout(() => document.documentElement.classList.add('tv-nav-dim'),    DIM_MS);
  _hideTimer = setTimeout(() => document.documentElement.classList.add('tv-nav-hidden'), HIDE_MS);
}

function hideRingImmediately() {
  // Full reset — mouse/touch means we are NOT in keyboard-nav mode
  _navActive = false;
  document.documentElement.classList.remove('tv-nav-active', 'tv-nav-dim', 'tv-nav-hidden');
  clearTimeout(_dimTimer);
  clearTimeout(_hideTimer);
  // Remove the tv-focused class from whatever had it so no stale ring shows
  if (_lastFocused) {
    _lastFocused.classList.remove(FOCUSED);
    _lastFocused = null;
  }
}

// Mouse/touch → immediately hide ring and reset nav mode
if (typeof window !== 'undefined') {
  ['mousedown', 'touchstart', 'pointermove'].forEach(ev =>
    window.addEventListener(ev, hideRingImmediately, { passive: true, capture: true })
  );
}

// ─── Zone detection ───────────────────────────────────────────────────────────

function getZone(el) {
  const explicit = el.closest('[data-tv-zone]');
  if (explicit) return explicit.getAttribute('data-tv-zone');

  // Player modal — keep focus inside
  if (el.closest('[data-player-modal]')) return 'modal';

  // Generic modals / drawers (fixed overlays)
  if (el.closest('[role="dialog"], [data-modal]')) return 'modal';
  // Fixed overlays that look like drawers/modals (but exclude the player backdrop)
  const fixed = el.closest('.fixed.inset-0');
  if (fixed && !fixed.classList.contains('bg-transparent')) return 'modal';

  // Navbar
  if (el.closest('header, .modern-navbar-react, nav.mobile-bottom-nav-react')) return 'navbar';

  // Sidebar (collections list)
  if (el.closest('aside, #collectionsList, [data-tv-sidebar]')) return 'sidebar';

  // Filter bar — both dedicated attribute and the class used in the app
  if (el.closest('[data-tv-filters], .filter-scrollbar-hidden:not(.min-h-0)')) return 'filters';

  return 'content';
}

// ─── Visibility ───────────────────────────────────────────────────────────────

function isVisible(el) {
  if (el.disabled) return false;
  if (el.getAttribute('aria-hidden') === 'true') return false;
  const s = getComputedStyle(el);
  if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
  // Only block non-interactive elements — buttons/links/iframes can override a
  // parent's pointer-events:none with their own pointer-events:auto.
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

// ─── Focusable list ───────────────────────────────────────────────────────────

function getFocusable() {
  return Array.from(document.querySelectorAll(FOCUSABLE_SEL)).filter(isVisible);
}

function getFocusableIn(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll(FOCUSABLE_SEL)).filter(isVisible);
}

// ─── Geometry ─────────────────────────────────────────────────────────────────

function center(r) { return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }

function score(fromR, toR, dir) {
  const f = center(fromR), t = center(toR);
  const dx = t.x - f.x, dy = t.y - f.y;

  if (dir === 'ArrowRight' && dx <= 2)  return Infinity;
  if (dir === 'ArrowLeft'  && dx >= -2) return Infinity;
  if (dir === 'ArrowDown'  && dy <= 2)  return Infinity;
  if (dir === 'ArrowUp'    && dy >= -2) return Infinity;

  const horiz = dir === 'ArrowLeft' || dir === 'ArrowRight';
  const pri   = Math.abs(horiz ? dx : dy);
  const lat   = Math.abs(horiz ? dy : dx);
  return pri + lat * 3;
}

// ─── Apply focus ──────────────────────────────────────────────────────────────

function applyFocus(el, scroll = true) {
  if (!el || el === document.activeElement) return;
  if (_lastFocused && _lastFocused !== el) _lastFocused.classList.remove(FOCUSED);
  el.focus({ preventScroll: true });
  el.classList.add(FOCUSED);
  _lastFocused = el;
  if (scroll) el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
}

export function focusNavbar() {
  const el = document.querySelector(
    'header button:not([disabled]), header a[href], .modern-navbar-react button:not([disabled])'
  );
  if (el && isVisible(el)) applyFocus(el, false);
  else { const f = getFocusable()[0]; if (f) applyFocus(f, false); }
}

// ─── Modal / drawer helpers ───────────────────────────────────────────────────

function getFirstFocusableIn(container) {
  if (!container) return null;
  return getFocusableIn(container)[0] || null;
}

function getPreferredModalFocus(modal) {
  if (!modal) return null;
  return (
    getFirstFocusableIn(modal.querySelector('[data-player-controls]')) ||
    getFirstFocusableIn(modal.querySelector('[data-drawer-panel], [role="dialog"], [data-modal]')) ||
    getFirstFocusableIn(modal)
  );
}

function getPlayerModal() {
  const modal = document.querySelector('[data-player-modal]');
  if (!modal || !modal.querySelector(FOCUSABLE_SEL)) return null;
  return modal;
}

function focusFirstPlayerControl(playerModal) {
  return restorePlayerStreamFocus(playerModal);
}

/**
 * Always restores focus to the currently-active stream button (or the first
 * stream button if none is active).  Falls back to the first focusable in
 * the player modal.  Returns true when a target was found.
 */
function restorePlayerStreamFocus(playerModal) {
  const modal = playerModal || getPlayerModal();
  if (!modal) return false;

  // Try each candidate independently so an off-screen button doesn't block
  // focus from landing on a visible fallback.
  const candidates = [
    () => modal.querySelector('button[data-active-source="true"]:not(:disabled)'),
    () => modal.querySelector('button[data-player-source="true"]:not(:disabled)'),
    () => modal.querySelector('[data-player-action="true"]:not(:disabled)'),
    () => getFocusableIn(modal)[0],
  ];

  for (const pick of candidates) {
    const target = pick();
    if (target && isVisible(target)) {
      showRing();
      applyFocus(target, false);
      return true;
    }
  }

  // Last-ditch: focus anything focusable without the isVisible gate
  const fallback = modal.querySelector(FOCUSABLE_SEL);
  if (fallback) { showRing(); applyFocus(fallback, false); return true; }

  return false;
}

/** Returns the top-most open modal/drawer container, or null */
function getOpenModal() {
  // Player modal first (highest z-index)
  const playerModal = document.querySelector('[data-player-modal]');
  if (playerModal && playerModal.querySelector(FOCUSABLE_SEL)) return playerModal;

  // drawers / dialogs
  const candidates = document.querySelectorAll(
    '[role="dialog"], [data-modal], .fixed.inset-0'
  );
  for (const c of [...candidates].reverse()) {
    // skip pure-backdrop elements (bg-transparent, pointer-events-none)
    if (c.classList.contains('bg-transparent')) continue;
    if (c.style.pointerEvents === 'none' && !c.querySelector(FOCUSABLE_SEL)) continue;
    if (c.offsetParent !== null || getComputedStyle(c).position === 'fixed') {
      if (c.querySelector(FOCUSABLE_SEL)) return c;
    }
  }
  return null;
}

/** Try to close the topmost open modal/drawer/dropdown */
function tryClose() {
  // Search overlay — look for an input that looks like a search bar at top level
  const searchOverlay = document.querySelector('[data-search-overlay]');
  if (searchOverlay) {
    const closeBtn = document.querySelector('button[aria-label="Search"], button[aria-label="Close search"]');
    if (closeBtn) { closeBtn.click(); return true; }
  }

  // Add Content drawer / any modal close button (×)
  const closeBtn = document.querySelector(
    '.fixed.inset-0 button[aria-label*="lose"], .fixed.inset-0 button[aria-label*="Cancel"],' +
    '[role="dialog"] button[aria-label*="lose"], [data-modal] button[aria-label*="lose"]'
  );
  if (closeBtn && isVisible(closeBtn)) { closeBtn.click(); return true; }

  // Player close button
  const playerClose = document.querySelector('[data-player-modal] button[aria-label="Close player"]');
  if (playerClose && isVisible(playerClose)) { playerClose.click(); return true; }

  // Click on a visible dark backdrop
  const backdrop = document.querySelector(
    '.fixed.inset-0.bg-black\\/60, .fixed.inset-0.bg-black\\/55, .fixed.inset-0.bg-black\\/50'
  );
  if (backdrop && isVisible(backdrop)) { backdrop.click(); return true; }

  return false;
}

// ─── Spatial move ─────────────────────────────────────────────────────────────

function moveFocus(dir) {
  const all = getFocusable();
  if (!all.length) return false;

  const active = document.activeElement;
  const modal  = getOpenModal();

  // Restrict candidates to inside the open modal/drawer
  const pool = modal ? all.filter(el => modal.contains(el)) : all;

  if (!active || !pool.includes(active)) {
    applyFocus(getPreferredModalFocus(modal) || pool[0]);
    return true;
  }

  const fromR  = active.getBoundingClientRect();
  const fromZ  = getZone(active);
  let cands    = pool.filter(el => el !== active);

  // Player controls are a horizontal strip. Move through them in DOM order so
  // source buttons, switch, reload, zoom, open, and close are all predictable.
  if (modal?.matches('[data-player-modal]') && active.closest('[data-player-controls]') && (dir === 'ArrowLeft' || dir === 'ArrowRight')) {
    const controls = getFocusableIn(active.closest('[data-player-controls]'));
    const index = controls.indexOf(active);
    if (index >= 0 && controls.length > 1) {
      const nextIndex = dir === 'ArrowRight'
        ? (index + 1) % controls.length
        : (index - 1 + controls.length) % controls.length;
      applyFocus(controls[nextIndex]);
      return true;
    }
  }

  if (modal?.matches('[data-player-modal]') && active.closest('[data-player-controls]') && dir === 'ArrowDown') {
    const frame = modal.querySelector('iframe[tabindex="0"]');
    if (frame && isVisible(frame)) {
      applyFocus(frame, false);
      return true;
    }
  }

  if (modal?.matches('[data-player-modal]') && active.tagName === 'IFRAME' && dir === 'ArrowUp') {
    const preferred = getPreferredModalFocus(modal);
    if (preferred) {
      applyFocus(preferred);
      return true;
    }
  }

  // ── Zone transition rules ──────────────────────────────────────────────────

  // Navbar ArrowDown → strongly prefer play button or first card below fold
  if (fromZ === 'navbar' && dir === 'ArrowDown') {
    const navBottom = fromR.bottom;
    const below = cands.filter(el => {
      const r = el.getBoundingClientRect();
      return getZone(el) !== 'navbar' && r.top > navBottom - 10;
    });
    // Prefer explicit play button first
    const play = below.find(el =>
      el.getAttribute('aria-label')?.toLowerCase().includes('play') ||
      el.hasAttribute('data-play-btn')
    );
    if (play) { applyFocus(play); return true; }
    // Then prefer first card (data-card or the card wrapper button)
    const card = below.find(el => el.hasAttribute('data-card') || el.closest('article'));
    if (card) { applyFocus(card); return true; }
    if (below.length) { cands = below; }
  }

  // Poster card ArrowRight -> its remove button when present.
  if (dir === 'ArrowRight') {
    const article = active.closest('article');
    const removeBtn = article?.querySelector('button[aria-label^="Remove"]');
    if (removeBtn && removeBtn !== active && isVisible(removeBtn)) {
      applyFocus(removeBtn);
      return true;
    }
  }

  // Remove button ArrowLeft -> back to the poster card.
  if (dir === 'ArrowLeft' && active.getAttribute('aria-label')?.startsWith('Remove')) {
    const cardBtn = active.closest('article')?.querySelector('button[data-card], button:not([aria-label^="Remove"])');
    if (cardBtn && cardBtn !== active && isVisible(cardBtn)) {
      applyFocus(cardBtn);
      return true;
    }
  }

  // Remove button Up/Down should continue through the poster grid, not get
  // stranded on the small overlay button.
  if ((dir === 'ArrowUp' || dir === 'ArrowDown') && active.getAttribute('aria-label')?.startsWith('Remove')) {
    const ownerCard = active.closest('article')?.querySelector('button[data-card]');
    const cards = Array.from(document.querySelectorAll('button[data-card]')).filter(isVisible);
    const index = ownerCard ? cards.indexOf(ownerCard) : -1;
    if (index >= 0) {
      const firstTop = cards[0]?.getBoundingClientRect().top || 0;
      const cols = Math.max(1, cards.filter(card => Math.abs(card.getBoundingClientRect().top - firstTop) < 6).length);
      const nextIndex = dir === 'ArrowDown' ? index + cols : index - cols;
      if (cards[nextIndex]) {
        applyFocus(cards[nextIndex]);
        return true;
      }
      applyFocus(ownerCard);
      return true;
    }
  }

  // Content/sidebar/filters ArrowUp → jump to filters then navbar when nothing above
  if ((fromZ === 'content' || fromZ === 'sidebar' || fromZ === 'filters') && dir === 'ArrowUp') {
    const aboveHere = cands.filter(el =>
      score(fromR, el.getBoundingClientRect(), 'ArrowUp') < Infinity
    );
    if (!aboveHere.length) {
      const filterCands = cands.filter(el => getZone(el) === 'filters');
      if (filterCands.length) { cands = filterCands; }
      else {
        const navCands = cands.filter(el => getZone(el) === 'navbar');
        if (navCands.length) cands = navCands;
      }
    }
  }

  // Filters ArrowDown → content/sidebar
  if (fromZ === 'filters' && dir === 'ArrowDown') {
    const below = cands.filter(el => {
      const z = getZone(el);
      return (z === 'content' || z === 'sidebar') &&
             score(fromR, el.getBoundingClientRect(), 'ArrowDown') < Infinity;
    });
    if (below.length) cands = below;
  }

  // Sidebar ArrowRight → content or filters
  if (fromZ === 'sidebar' && dir === 'ArrowRight') {
    const right = cands.filter(el => {
      const z = getZone(el);
      return z === 'content' || z === 'filters';
    });
    if (right.length) cands = right;
  }

  // Content ArrowLeft → sidebar
  if (fromZ === 'content' && dir === 'ArrowLeft') {
    const sidebar = cands.filter(el => getZone(el) === 'sidebar');
    if (sidebar.length) { cands = sidebar; }
  }

  // ── Spatial best ──────────────────────────────────────────────────────────
  let best = null, bestScore = Infinity;
  for (const el of cands) {
    const s = score(fromR, el.getBoundingClientRect(), dir);
    if (s < bestScore) { bestScore = s; best = el; }
  }

  if (best) { applyFocus(best); return true; }
  return false;
}

// ─── Global keydown ───────────────────────────────────────────────────────────

function handleKeyDown(e) {
  const key = e.key;
  if (!ALL_KEYS.has(key)) return;

  const active = document.activeElement;
  const tag    = active?.tagName;
  const modal  = getOpenModal();
  const playerModal = getPlayerModal();

  if (playerModal) {
    const playerFocusables = getFocusableIn(playerModal);

    // ── IFRAME focused: let keys pass through to the embedded player ────────
    // The iframe has its own controls (play/pause, seek, volume, fullscreen).
    // We only intercept ArrowUp (return to our controls) and Escape (close).
    // All other keys (Enter, Space, Arrow Left/Right for seek, etc.) must
    // reach the iframe's internal player — do NOT preventDefault/stopPropagation.
    if (active && active.tagName === 'IFRAME') {
      if (key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        showRing();
        focusFirstPlayerControl(playerModal);
        return;
      }
      if (BACK.has(key)) {
        e.preventDefault();
        e.stopPropagation();
        const closeBtn = playerModal.querySelector('button[aria-label="Close player"]');
        closeBtn?.click();
        return;
      }
      // Enter/Space while iframe is focused — try to push focus into the
      // iframe's content so its internal controls respond to keyboard input.
      if (ACTIVATE.has(key)) {
        try { active.contentWindow?.focus(); } catch (_) { /* cross-origin */ }
      }
      // Let ALL other keys pass through to the iframe natively.
      return;
    }

    // ── Non-iframe elements inside player: intercept navigation keys ────────
    if (NAV.has(key) || key === 'Tab' || ACTIVATE.has(key) || BACK.has(key)) {
      e.preventDefault();
      e.stopPropagation();
    }

    if (!active || active === document.body || !playerModal.contains(active)) {
      showRing();
      focusFirstPlayerControl(playerModal);
      return;
    }

    if (BACK.has(key)) {
      const closeBtn = playerModal.querySelector('button[aria-label="Close player"]');
      closeBtn?.click();
      return;
    }

    if (key === 'Tab') {
      if (!playerFocusables.length) return;
      const index = playerFocusables.indexOf(active);
      const direction = e.shiftKey ? -1 : 1;
      const nextIndex = index >= 0
        ? (index + direction + playerFocusables.length) % playerFocusables.length
        : 0;
      showRing();
      applyFocus(playerFocusables[nextIndex]);
      return;
    }

    if (ACTIVATE.has(key)) {
      if (active && active !== document.body) {
        const isStreamBtn = active.hasAttribute('data-player-source');
        active.click();
        if (isStreamBtn) {
          window.requestAnimationFrame(() => {
            restorePlayerStreamFocus(playerModal);
          });
        }
      }
      return;
    }

    if (active.closest('[data-player-controls]') && (key === 'ArrowLeft' || key === 'ArrowRight')) {
      const controls = getFocusableIn(active.closest('[data-player-controls]'));
      const index = controls.indexOf(active);
      if (index >= 0 && controls.length) {
        const nextIndex = key === 'ArrowRight'
          ? (index + 1) % controls.length
          : (index - 1 + controls.length) % controls.length;
        showRing();
        applyFocus(controls[nextIndex]);
      }
      return;
    }

    if (active.closest('[data-player-controls]') && key === 'ArrowDown') {
      const iframe = playerModal.querySelector('iframe[tabindex="0"]');
      if (iframe && isVisible(iframe)) {
        showRing();
        applyFocus(iframe, false);
        // Push focus into iframe content so its internal controls activate
        try { iframe.contentWindow?.focus(); } catch (_) { /* cross-origin */ }
      }
      return;
    }

    if (active.closest('[data-player-controls]') && key === 'ArrowUp') {
      showRing();
      focusFirstPlayerControl(playerModal);
      return;
    }

    if (NAV.has(key)) {
      showRing();
      moveFocus(key);
      return;
    }

    return;
  }

  if (modal && (!active || active === document.body || !modal.contains(active))) {
    e.preventDefault();
    e.stopPropagation();
    showRing();
    applyFocus(getPreferredModalFocus(modal));
    return;
  }

  if (modal && key === 'Tab') {
    const focusables = getFocusableIn(modal);
    if (!focusables.length) return;
    e.preventDefault();
    e.stopPropagation();
    const currentIndex = focusables.indexOf(active);
    const direction = e.shiftKey ? -1 : 1;
    const nextIndex = currentIndex >= 0
      ? (currentIndex + direction + focusables.length) % focusables.length
      : 0;
    showRing();
    applyFocus(focusables[nextIndex]);
    return;
  }

  if (tag === 'IFRAME') {
    if (BACK.has(key)) {
      e.preventDefault();
      if (!tryClose()) active.blur();
    } else if (key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      showRing();
      moveFocus(key);
    }
    return;
  }

  // Inside text inputs: only Escape and ArrowDown handled
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    if (key === 'Escape') {
      active.blur();
      e.preventDefault();
      tryClose();
    }
    if (key === 'ArrowDown') {
      const moved = moveFocus('ArrowDown');
      if (moved) { e.preventDefault(); e.stopPropagation(); }
    }
    return;
  }

  // Escape / Backspace — close modals first, then history back
  if (BACK.has(key)) {
    if (key === 'Backspace' && active?.isContentEditable) return;
    e.preventDefault();
    if (!tryClose()) window.history.back();
    return;
  }

  // Activate
  if (ACTIVATE.has(key)) {
    if (active && active !== document.body) {
      e.preventDefault();
      active.click();
    }
    return;
  }

  // Arrow navigation — only show the ring if we are actually navigating
  showRing();
  const moved = moveFocus(key);
  if (moved) { e.preventDefault(); e.stopPropagation(); }
}

// ─── React hook ───────────────────────────────────────────────────────────────

function handleFocusIn(e) {
  const modal = getOpenModal();
  if (!modal || modal.contains(e.target)) return;
  const preferred = getPreferredModalFocus(modal);
  if (!preferred) return;
  e.stopPropagation();
  window.setTimeout(() => {
    if (document.activeElement && modal.contains(document.activeElement)) return;
    applyFocus(preferred, false);
  }, 0);
}

export function useTvFocus(location) {
  useEffect(() => {
    if (_installed) return;
    injectTvNavCss();
    document.addEventListener('keydown', handleKeyDown, { capture: true });
    document.addEventListener('focusin', handleFocusIn, { capture: true });
    document.addEventListener('focusout', ev => ev.target?.classList?.remove(FOCUSED));
    _installed = true;
    return () => {
      document.removeEventListener('keydown', handleKeyDown, { capture: true });
      document.removeEventListener('focusin', handleFocusIn, { capture: true });
      _installed = false;
    };
  }, []);

  useEffect(() => {
    // Only auto-focus the navbar on route change if the user is in keyboard-nav mode
    if (!_navActive) return;
    const t = setTimeout(focusNavbar, 120);
    return () => clearTimeout(t);
  }, [location?.pathname]);
}

// ─── CSS ──────────────────────────────────────────────────────────────────────

export function injectTvNavCss() {
  if (document.getElementById('tv-nav-css')) return;
  const s = document.createElement('style');
  s.id = 'tv-nav-css';
  s.textContent = `
/* ── Suppress ALL browser default focus outlines globally ───────── */
*, *:focus, *:focus-visible {
  outline: none !important;
  /* Tailwind's focus:ring-white still emits a coloured ring via box-shadow.
     We override it below only when tv-nav is NOT active. */
}

/* ── When NOT in keyboard-nav mode: strip all focus rings ───────── */
button:focus, button:focus-visible,
a:focus, a:focus-visible,
[role="button"]:focus, [role="button"]:focus-visible,
[tabindex]:focus, [tabindex]:focus-visible,
input:focus, input:focus-visible,
select:focus, select:focus-visible,
textarea:focus, textarea:focus-visible,
iframe:focus, iframe:focus-visible,
.tv-focused {
  outline: none !important;
  box-shadow: none !important;
}

/* ── Nav active: show a clean white ring on the focused element ─── */
html.tv-nav-active .tv-focused {
  outline: 1.5px solid rgba(255,255,255,0.78) !important;
  outline-offset: 2px;
  box-shadow: 0 0 0 2px rgba(255,255,255,0.08) !important;
  border-radius: inherit;
  z-index: 5;
  transition: outline 0.1s ease, box-shadow 0.1s ease;
}

/* ── Dim after inactivity ───────────────────────────────────────── */
html.tv-nav-active.tv-nav-dim .tv-focused {
  outline-color: rgba(255,255,255,0.40) !important;
  box-shadow: 0 0 0 2px rgba(255,255,255,0.05) !important;
}
html.tv-nav-active.tv-nav-hidden .tv-focused {
  outline: none !important;
  box-shadow: none !important;
}

/* ── Card: outline-only, NO transform (prevents poster-landscape shift) */
html.tv-nav-active .tv-focused[data-card],
html.tv-nav-active .tv-focused[class*="aspect-[2/3]"],
html.tv-nav-active article .tv-focused {
  outline-width: 2px;
  transform: none !important;
}

/* ── Sidebar item ───────────────────────────────────────────────── */
html.tv-nav-active aside .tv-focused,
html.tv-nav-active #collectionsList .tv-focused {
  background: rgba(255,255,255,0.07) !important;
  border-radius: 24px !important;
}

/* ── Filter pills ───────────────────────────────────────────────── */
html.tv-nav-active .tv-focused[class*="rounded-[20px]"],
html.tv-nav-active .tv-focused[class*="rounded-full"] {
  outline-offset: 1px;
}

/* ── Player source/action buttons inside the modal ─────────────── */
html.tv-nav-active [data-player-modal] .tv-focused {
  outline: 1.5px solid rgba(255,255,255,0.82) !important;
  box-shadow: 0 0 0 2px rgba(255,255,255,0.10) !important;
}

/* ── Suppress any Tailwind focus:ring-* that may emit colour ────── */
html:not(.tv-nav-active) [class*="focus:ring"],
html.tv-nav-active [class*="focus:ring"]:focus:not(.tv-focused),
html.tv-nav-active [class*="focus:ring"]:focus-visible:not(.tv-focused) {
  box-shadow: none !important;
}
`;
  document.head.appendChild(s);
}
