import { useEffect } from 'react';
import { moveFocus, getOpenModal, getPreferredModalFocus, getPlayerModal, tryClose, focusFirstPlayerControl, restorePlayerStreamFocus } from '../utils/tvNavMappings.js';
import { getFocusableIn, isVisible, applyFocus, FOCUSED, FOCUSABLE_SEL, getFocusable, lastFocused, setLastFocused } from '../utils/spatialCore.js';

const ACTIVATE  = new Set(['Enter', ' ']);
const NAV       = new Set(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight']);
const BACK      = new Set(['Escape','Backspace']);
const CONTROL   = new Set(['Tab']);
const ALL_KEYS  = new Set([...ACTIVATE, ...NAV, ...BACK, ...CONTROL]);
const DIM_MS    = 3000;
const HIDE_MS   = 6000;

let _navActive   = false;
let _dimTimer    = null;
let _hideTimer   = null;
let _installed   = false;

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
  const el = document.querySelector(
    'header button:not([disabled]), header a[href], .modern-navbar-react button:not([disabled])'
  );
  if (el && isVisible(el)) applyFocus(el, false);
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

    if (active && active.tagName === 'IFRAME') {
      if (key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        showRing();
        focusFirstPlayerControl(playerModal, showRing);
        return;
      }
      if (BACK.has(key)) {
        e.preventDefault();
        e.stopPropagation();
        const closeBtn = playerModal.querySelector('button[aria-label="Close player"]');
        closeBtn?.click();
        return;
      }
      if (ACTIVATE.has(key)) {
        try { active.contentWindow?.focus(); } catch (_) { }
      }
      return;
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
            restorePlayerStreamFocus(playerModal, showRing);
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
        try { iframe.contentWindow?.focus(); } catch (_) { }
      }
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
    if (!_navActive) return;
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
  outline: 2px solid var(--tv-focus-ring, rgba(233, 196, 120, 0.95)) !important;
  outline-offset: 3px;
  box-shadow:
    0 0 0 6px rgba(210, 164, 81, 0.16),
    0 0 26px 4px rgba(210, 164, 81, 0.28),
    0 14px 34px rgba(0, 0, 0, 0.55) !important;
  position: relative;
  z-index: 6;
  transition:
    outline-color 220ms ease, outline-offset 220ms cubic-bezier(.2,.8,.2,1),
    box-shadow 260ms ease, transform 260ms cubic-bezier(.2,.8,.2,1), background-color 220ms ease;
  animation: tvFocusIn 260ms cubic-bezier(.2,.8,.2,1);
}
@keyframes tvFocusIn {
  from { outline-offset: 8px; outline-color: rgba(233,196,120,0); }
  to   { outline-offset: 3px; }
}
html.tv-nav-active.tv-nav-dim .tv-focused,
html.tv-nav-active.tv-nav-hidden .tv-focused {
  outline-color: rgba(233, 196, 120, 0.7) !important;
  box-shadow: 0 0 0 5px rgba(210, 164, 81, 0.10), 0 0 18px 2px rgba(210, 164, 81, 0.16) !important;
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
  background: rgba(210, 164, 81, 0.12) !important;
  outline-offset: 0;
}

/* Text inputs: glow field instead of a floating ring */
html.tv-nav-active input.tv-focused,
html.tv-nav-active textarea.tv-focused,
html.tv-nav-active select.tv-focused {
  outline-offset: 0;
  background-color: rgba(210, 164, 81, 0.06) !important;
}

html.tv-nav-active .tv-focused[class*="rounded-full"] { outline-offset: 2px; }

html.tv-nav-active [data-player-modal] .tv-focused {
  outline: 2px solid rgba(255, 255, 255, 0.9) !important;
  box-shadow: 0 0 0 6px rgba(255, 255, 255, 0.12), 0 0 22px rgba(255, 255, 255, 0.18) !important;
  transform: none !important;
}

@media (prefers-reduced-motion: reduce) {
  html.tv-nav-active .tv-focused { animation: none; transition: none; }
}

html:not(.tv-nav-active) [class*="focus:ring"],
html.tv-nav-active [class*="focus:ring"]:focus:not(.tv-focused),
html.tv-nav-active [class*="focus:ring"]:focus-visible:not(.tv-focused) {
  box-shadow: none !important;
}
`;
  document.head.appendChild(s);
}
