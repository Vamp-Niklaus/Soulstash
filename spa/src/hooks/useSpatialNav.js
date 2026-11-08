import { useEffect } from 'react';
import { moveFocus, getOpenModal, getPreferredModalFocus, getPlayerModal, tryClose, focusFirstPlayerControl, restorePlayerStreamFocus } from '../utils/tvNavMappings.js';
import { getFocusableIn, isVisible, applyFocus, FOCUSED, FOCUSABLE_SEL, getFocusable, lastFocused, setLastFocused } from '../utils/spatialCore.js';

const ACTIVATE  = new Set(['Enter', ' ']);
const NAV       = new Set(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight']);
const BACK      = new Set(['Escape','Backspace','BrowserBack','GoBack','Back']);
const CONTROL   = new Set(['Tab']);
const ALL_KEYS  = new Set([...ACTIVATE, ...NAV, ...BACK, ...CONTROL]);
const DIM_MS    = 3000;
const HIDE_MS   = 6000;

let _navActive   = false;
let _dimTimer    = null;
let _hideTimer   = null;
let _installed   = false;

function handleTvLinkClick(event) {
  if (!document.documentElement.classList.contains('layout-tv-mode')) return;
  const target = event.target instanceof Element ? event.target.closest('a[href]') : null;
  if (!target || target.hasAttribute('data-tv-allow-link') || target.closest('[data-tv-allow-link]')) return;

  let destination;
  try { destination = new URL(target.href, window.location.href); }
  catch { destination = null; }
  const opensNewContext = Boolean(target.getAttribute('target') && target.getAttribute('target').toLowerCase() !== '_self');
  const leavesApp = !destination || !['http:', 'https:'].includes(destination.protocol) || destination.origin !== window.location.origin;
  if (!leavesApp && !opensNewContext) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();
}

function focusPlaybackSurface(playerModal, reason = 'dpad-navigation') {
  const playback = playerModal.querySelector('iframe[tabindex="0"], video[tabindex="0"]');
  if (!playback?.isConnected || !isVisible(playback)) {
    console.warn('[Soulstash Player Focus] playback focus target is missing or hidden', {
      reason,
      mode: playerModal.getAttribute('data-player-mode'),
      iframePresent: Boolean(playerModal.querySelector('iframe')),
      videoPresent: Boolean(playerModal.querySelector('video'))
    });
    return false;
  }

  try {
    applyFocus(playback, false);
    if (playback.tagName === 'IFRAME') playback.contentWindow?.focus?.();
  } catch (error) {
    console.warn('[Soulstash Player Focus] browser rejected playback focus', {
      reason,
      target: playback.tagName,
      message: error?.message
    });
  }

  const rect = playback.getBoundingClientRect();
  console.info('[Soulstash Player Focus] playback focus attempt', {
    reason,
    mode: playerModal.getAttribute('data-player-mode'),
    target: playback.tagName,
    connected: playback.isConnected,
    parentDocumentFocusedFrame: document.activeElement === playback,
    activeElement: document.activeElement?.tagName || null,
    frameCenter: { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) },
    fullscreenElement: document.fullscreenElement?.tagName || null,
    crossOriginFrameContents: 'not inspectable from the parent document'
  });
  return document.activeElement === playback;
}

function focusSourceInDirection(playerModal, activeSource, direction) {
  const currentRect = activeSource.getBoundingClientRect();
  const sources = Array.from(playerModal.querySelectorAll('button[data-player-source="true"]'))
    .filter((button) => button !== activeSource && isVisible(button))
    .map((button) => ({ button, rect: button.getBoundingClientRect() }))
    .filter(({ rect }) => direction === 'up'
      ? rect.bottom <= currentRect.top + 4
      : rect.top >= currentRect.bottom - 4)
    .sort((a, b) => {
      const aGap = direction === 'up' ? currentRect.top - a.rect.bottom : a.rect.top - currentRect.bottom;
      const bGap = direction === 'up' ? currentRect.top - b.rect.bottom : b.rect.top - currentRect.bottom;
      if (Math.abs(aGap - bGap) > 4) return aGap - bGap;
      const aCenter = a.rect.left + a.rect.width / 2;
      const bCenter = b.rect.left + b.rect.width / 2;
      const currentCenter = currentRect.left + currentRect.width / 2;
      return Math.abs(aCenter - currentCenter) - Math.abs(bCenter - currentCenter);
    });

  if (sources[0]) {
    applyFocus(sources[0].button);
    return true;
  }
  return focusPlaybackSurface(playerModal, `source-${direction}-edge`);
}

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
  _navActive = false;
  document.documentElement.classList.remove('tv-nav-active', 'tv-nav-dim', 'tv-nav-hidden');
  clearTimeout(_dimTimer);
  clearTimeout(_hideTimer);
  if (lastFocused) {
    lastFocused.classList.remove(FOCUSED);
    setLastFocused(null);
  }
}

if (typeof window !== 'undefined') {
  ['mousedown', 'touchstart', 'pointermove'].forEach(ev =>
    window.addEventListener(ev, hideRingImmediately, { passive: true, capture: true })
  );
}

export function focusNavbar() {
  const tvMode = document.documentElement.classList.contains('layout-tv-mode');
  const activeSidebarItem = tvMode
    ? document.querySelector('aside[aria-label="TV Sidebar Navigation"] [aria-current="page"]')
    : null;
  const navbarItems = document.querySelectorAll(
    'header button:not([disabled]), header a[href], .modern-navbar-react button:not([disabled]), aside[aria-label="TV Sidebar Navigation"] button:not([disabled])'
  );
  const el = (activeSidebarItem && isVisible(activeSidebarItem))
    ? activeSidebarItem
    : Array.from(navbarItems).find(isVisible);
  if (el) applyFocus(el, false);
  else { const f = getFocusable()[0]; if (f) applyFocus(f, false); }
}

function handleKeyDown(e) {
  const key = e.key;
  if (!ALL_KEYS.has(key)) return;

  const active = document.activeElement;
  if (active && active.closest('[data-tv-ignore]')) return;
  
  const tag    = active?.tagName;
  const modal  = getOpenModal();
  const playerModal = getPlayerModal();

  if (playerModal) {
    const playerFocusables = getFocusableIn(playerModal);

    if (BACK.has(key)) {
      e.preventDefault();
      e.stopPropagation();
      showRing();
      const backEvent = new CustomEvent('soulstash:player-back', { cancelable: true });
      window.dispatchEvent(backEvent);
      if (!backEvent.defaultPrevented) {
        if (active?.tagName === 'IFRAME' || active?.tagName === 'VIDEO') {
          applyFocus(playerModal.querySelector('[data-player-size="true"]') || getPreferredModalFocus(playerModal));
        } else {
          playerModal.querySelector('button[aria-label="Close player"]')?.click();
        }
      }
      return;
    }

    if (active && active.tagName === 'IFRAME') {
      // Let the provider's cross-origin player own its D-pad/keyboard input.
      return;
    }

    if (playerModal.getAttribute('data-player-mode') === '3' && key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      showRing();
      focusPlaybackSurface(playerModal, 'mode-3-recover-focus');
      return;
    }

    if (active?.tagName === 'VIDEO' && document.documentElement.classList.contains('layout-tv-mode')) {
      if (key === 'ArrowLeft' || key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        const step = key === 'ArrowRight' ? 10 : -10;
        const duration = Number.isFinite(active.duration) ? active.duration : Infinity;
        active.currentTime = Math.max(0, Math.min(duration, active.currentTime + step));
        showRing();
        return;
      }
      if (key === 'ArrowUp' || key === 'ArrowDown') {
        if (playerModal.getAttribute('data-player-mode') === '3') return;
        e.preventDefault();
        e.stopPropagation();
        showRing();
        if (key === 'ArrowUp') {
          focusFirstPlayerControl(playerModal, showRing);
        } else {
          const source = playerModal.querySelector(
            'button[data-active-source="true"], button[data-player-source-toggle="true"]'
          );
          if (source && isVisible(source)) applyFocus(source);
        }
        return;
      }
      if (ACTIVATE.has(key)) {
        e.preventDefault();
        e.stopPropagation();
        if (active.paused) active.play().catch(() => {});
        else active.pause();
        return;
      }
    }

    if (NAV.has(key) || key === 'Tab' || ACTIVATE.has(key) || BACK.has(key)) {
      e.preventDefault();
      e.stopPropagation();
    }

    if (!active || active === document.body || !playerModal.contains(active)) {
      showRing();
      focusFirstPlayerControl(playerModal, showRing);
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
            restorePlayerStreamFocus(playerModal, showRing);
          });
        }
      }
      return;
    }

    if (key === 'ArrowDown' && active.closest('[data-player-controls]')) {
      if (active.matches('[data-player-size="true"]')) {
        const sourceToggle = playerModal.querySelector('[data-player-source-toggle="true"]');
        if (sourceToggle && isVisible(sourceToggle)) {
          showRing();
          applyFocus(sourceToggle);
        }
      } else if (active.matches('[data-player-source-toggle="true"]') && active.getAttribute('aria-expanded') === 'true') {
        const selected = playerModal.querySelector('button[data-active-source="true"]:not(:disabled)') ||
          playerModal.querySelector('button[data-player-source="true"]:not(:disabled)');
        if (selected && isVisible(selected)) {
          showRing();
          applyFocus(selected);
        } else {
          focusPlaybackSurface(playerModal, 'source-toggle-down-empty');
        }
      } else {
        focusPlaybackSurface(playerModal, 'toolbar-down');
      }
      return;
    }

    if (key === 'ArrowDown' && active.closest('[data-player-sources-panel]')) {
      if (active.closest('[data-player-source]')) {
        showRing();
        focusSourceInDirection(playerModal, active, 'down');
      } else {
        showRing();
        focusPlaybackSurface(playerModal, 'sources-panel-down');
      }
      return;
    }

    if (key === 'ArrowDown' && active.closest('[data-player-modal]')) {
      showRing();
      focusPlaybackSurface(playerModal, 'player-content-down');
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

    if (active.closest('[data-player-source]') && key === 'ArrowUp') {
      showRing();
      focusSourceInDirection(playerModal, active, 'up');
      return;
    }

    if (active.closest('[data-player-controls]') && key === 'ArrowUp') {
      showRing();
      focusFirstPlayerControl(playerModal, showRing);
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

  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    if (key === 'Escape') {
      active.blur();
      e.preventDefault();
      tryClose();
    }
    if (tag === 'SELECT' && ACTIVATE.has(key)) return;
    let leave = key === 'ArrowDown' || key === 'ArrowUp' || key === 'Tab';
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      let start = null, end = null, len = 0;
      try { start = active.selectionStart; end = active.selectionEnd; len = (active.value || '').length; } catch (_) {}
      if (start == null) leave = true;
      else if (start === end) leave = key === 'ArrowLeft' ? start === 0 : end === len;
    }
    if (leave && key !== 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      showRing();
      const moved = moveFocus(key);
      if (!moved && key === 'ArrowUp') focusNavbar();
    }
    return;
  }

  if (BACK.has(key)) {
    if (key === 'Backspace' && active?.isContentEditable) return;
    e.preventDefault();
    if (!tryClose()) window.history.back();
    return;
  }

  if (ACTIVATE.has(key)) {
    if (active && active !== document.body) {
      e.preventDefault();
      active.click();
    }
    return;
  }

  showRing();
  const moved = moveFocus(key);
  if (moved) { e.preventDefault(); e.stopPropagation(); }
}

function handleFocusIn(e) {
  const modal = getOpenModal();
  if (_navActive && e.target instanceof Element && isVisible(e.target)) {
    if (lastFocused && lastFocused !== e.target) lastFocused.classList.remove(FOCUSED);
    applyFocus(e.target, false);
  }
  if (!modal || modal.contains(e.target)) return;
  const preferred = getPreferredModalFocus(modal);
  if (!preferred) return;
  e.stopPropagation();
  window.setTimeout(() => {
    if (document.activeElement && modal.contains(document.activeElement)) return;
    applyFocus(preferred, false);
  }, 0);
}

export function useSpatialNav(location) {
  useEffect(() => {
    if (_installed) return;
    injectTvNavCss();
    document.addEventListener('keydown', handleKeyDown, { capture: true });
    document.addEventListener('click', handleTvLinkClick, { capture: true });
    document.addEventListener('focusin', handleFocusIn, { capture: true });
    document.addEventListener('focusout', ev => ev.target?.classList?.remove(FOCUSED));

    const nativeWindowOpen = window.open;
    const guardedWindowOpen = function (...args) {
      if (document.documentElement.classList.contains('layout-tv-mode')) {
        const active = document.activeElement;
        if (!active?.closest?.('[data-tv-allow-popup]')) return null;
      }
      return nativeWindowOpen.apply(window, args);
    };
    window.open = guardedWindowOpen;
    _installed = true;
    return () => {
      document.removeEventListener('keydown', handleKeyDown, { capture: true });
      document.removeEventListener('click', handleTvLinkClick, { capture: true });
      document.removeEventListener('focusin', handleFocusIn, { capture: true });
      if (window.open === guardedWindowOpen) window.open = nativeWindowOpen;
      _installed = false;
    };
  }, []);

  useEffect(() => {
    if (!_navActive && !document.documentElement.classList.contains('layout-tv-mode')) return;
    const t = setTimeout(focusNavbar, 120);
    return () => clearTimeout(t);
  }, [location?.pathname]);
}

export function injectTvNavCss() {
  if (document.getElementById('tv-nav-css')) return;
  const s = document.createElement('style');
  s.id = 'tv-nav-css';
  s.textContent = `
*, *:focus, *:focus-visible { outline: none !important; }
button:focus, button:focus-visible, a:focus, a:focus-visible,
[role="button"]:focus, [role="button"]:focus-visible,
[tabindex]:focus, [tabindex]:focus-visible,
input:focus, input:focus-visible, select:focus, select:focus-visible,
textarea:focus, textarea:focus-visible, iframe:focus, iframe:focus-visible,
.tv-focused { outline: none !important; box-shadow: none !important; }

html.tv-nav-active .tv-focused {
  outline: 2px solid var(--tv-focus-ring) !important;
  outline-offset: 3px;
  box-shadow: var(--tv-focus-shadow) !important;
  position: relative;
  z-index: 6;
  transition:
    outline-color 220ms ease, outline-offset 220ms cubic-bezier(.2,.8,.2,1),
    box-shadow 260ms ease, transform 260ms cubic-bezier(.2,.8,.2,1), background-color 220ms ease;
  animation: tvFocusIn 260ms cubic-bezier(.2,.8,.2,1);
}
@keyframes tvFocusIn {
  from { outline-offset: 7px; outline-color: transparent; }
  to   { outline-offset: 3px; }
}
html.tv-nav-active.tv-nav-dim .tv-focused,
html.tv-nav-active.tv-nav-hidden .tv-focused {
  outline-color: var(--tv-focus-ring) !important;
  box-shadow: var(--tv-focus-shadow) !important;
}

/* Poster cards: lift + glow, image brightens */
html.tv-nav-active .tv-focused[data-card],
html.tv-nav-active .tv-focused.card,
html.tv-nav-active .tv-focused[class*="aspect-[2/3]"],
html.tv-nav-active article .tv-focused {
  outline-offset: 4px;
  transform: translateY(-4px) scale(1.04) !important;
  border-radius: 12px;
  background-color: var(--cinema-surface, #121016) !important;
}
html.tv-nav-active .tv-focused.card .cardImageWrap,
html.tv-nav-active .tv-focused[data-card] .cardImageWrap {
  border-color: rgba(233, 196, 120, 0.7) !important;
}
html.tv-nav-active .tv-focused.card .cardImg,
html.tv-nav-active .tv-focused[data-card] img { transform: scale(1.05); filter: brightness(1.08); }

/* Sidebars / lists: filled highlight */
html.tv-nav-active aside .tv-focused,
html.tv-nav-active #collectionsList .tv-focused {
  background: var(--tv-focus-fill) !important;
  outline-offset: 2px;
  border-radius: 8px !important;
  transform: translateY(-2px);
}

/* Collection rows and filter controls need a filled, rounded state instead of a square ring. */
html.tv-nav-active #collectionsList > div > .tv-focused,
html.tv-nav-active aside button.tv-focused {
  outline: 2px solid var(--tv-focus-ring) !important;
  outline-offset: 2px;
  box-shadow: var(--tv-focus-shadow) !important;
  background: var(--tv-focus-fill) !important;
  border-radius: 8px !important;
  transform: translateY(-2px);
}

html.tv-nav-active #collectionsList > div > .tv-focused {
  border-radius: 12px !important;
  overflow: visible;
}

/* Text inputs: glow field instead of a floating ring */
html.tv-nav-active input.tv-focused,
html.tv-nav-active textarea.tv-focused,
html.tv-nav-active select.tv-focused {
  outline-offset: 2px;
  background-color: var(--tv-focus-fill) !important;
}

html.tv-nav-active aside:has(input.tv-focused) input.tv-focused { border-radius: 6px; }

/* Navigation lives on fixed bars: draw the focus surface inside the button, never as a full-height square. */
html.tv-nav-active .modern-navbar-react .nav-link.tv-focused,
html.tv-nav-active .mobile-bottom-nav-react__item.tv-focused {
  outline: none !important;
  box-shadow: none !important;
  transform: none !important;
  background: transparent !important;
  opacity: 1;
  isolation: isolate;
  animation: none;
}
html.tv-nav-active .modern-navbar-react .nav-link.tv-focused::before,
html.tv-nav-active .mobile-bottom-nav-react__item.tv-focused::before {
  content: '';
  position: absolute;
  inset: 8px 2px;
  z-index: -1;
  border: 2px solid var(--tv-focus-ring);
  border-radius: 12px;
  background: var(--tv-focus-fill);
  box-shadow: var(--tv-focus-shadow);
  pointer-events: none;
  animation: tvNavFocusIn 240ms cubic-bezier(.2,.8,.2,1) both;
}
html.tv-nav-active .mobile-bottom-nav-react__item.tv-focused::before { inset: 5px 4px; border-radius: 10px; }
html.tv-nav-active .modern-navbar-react .nav-link.tv-focused .nav-link-icon,
html.tv-nav-active .mobile-bottom-nav-react__item.tv-focused svg {
  color: var(--tv-focus-ring);
  transform: translateY(-2px);
  transition: transform 240ms ease, color 240ms ease;
}
@keyframes tvNavFocusIn {
  from { opacity: .4; transform: scale(.92); }
  to { opacity: 1; transform: scale(1); }
}

html.tv-nav-active .tv-focused[class*="rounded-full"] { outline-offset: 2px; }

html.tv-nav-active [data-player-modal] .tv-focused {
  outline: 2px solid rgba(255, 255, 255, 0.9) !important;
  box-shadow: 0 0 0 6px rgba(255, 255, 255, 0.12), 0 0 22px rgba(255, 255, 255, 0.18) !important;
  transform: none !important;
}

@media (prefers-reduced-motion: reduce) {
  html.tv-nav-active .tv-focused { animation: none; transition: none; }
  html.tv-nav-active .nav-link.tv-focused::before,
  html.tv-nav-active .mobile-bottom-nav-react__item.tv-focused::before { animation: none; }
}

html:not(.tv-nav-active) [class*="focus:ring"],
html.tv-nav-active [class*="focus:ring"]:focus:not(.tv-focused),
html.tv-nav-active [class*="focus:ring"]:focus-visible:not(.tv-focused) {
  box-shadow: none !important;
}
`;
  document.head.appendChild(s);
}
