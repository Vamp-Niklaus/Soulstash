import { getFocusable, getFocusableIn, isVisible, score, applyFocus, FOCUSABLE_SEL } from './spatialCore.js';

export function getZone(el) {
  const explicit = el.closest('[data-tv-zone]');
  if (explicit) return explicit.getAttribute('data-tv-zone');

  if (el.closest('[data-player-modal]')) return 'modal';
  if (el.closest('[role="dialog"], [data-modal]')) return 'modal';
  const fixed = el.closest('.fixed.inset-0');
  if (fixed && !fixed.classList.contains('bg-transparent')) return 'modal';

  if (el.closest('header, .modern-navbar-react, nav.mobile-bottom-nav-react')) return 'navbar';
  if (el.closest('aside, #collectionsList, [data-tv-sidebar]')) return 'sidebar';
  if (el.closest('[data-tv-filters], .filter-scrollbar-hidden:not(.min-h-0)')) return 'filters';

  return 'content';
}

export function getFirstFocusableIn(container) {
  if (!container) return null;
  return getFocusableIn(container)[0] || null;
}

export function getPreferredModalFocus(modal) {
  if (!modal) return null;
  return (
    getFirstFocusableIn(modal.querySelector('[data-player-controls]')) ||
    getFirstFocusableIn(modal.querySelector('[data-drawer-panel], [role="dialog"], [data-modal]')) ||
    getFirstFocusableIn(modal)
  );
}

export function getPlayerModal() {
  const modal = document.querySelector('[data-player-modal]');
  if (!modal || !modal.querySelector(FOCUSABLE_SEL)) return null;
  return modal;
}

export function focusFirstPlayerControl(playerModal, showRingFn) {
  return restorePlayerStreamFocus(playerModal, showRingFn);
}

export function restorePlayerStreamFocus(playerModal, showRingFn) {
  const modal = playerModal || getPlayerModal();
  if (!modal) return false;

  const candidates = [
    () => modal.querySelector('button[data-active-source="true"]:not(:disabled)'),
    () => modal.querySelector('button[data-player-source="true"]:not(:disabled)'),
    () => modal.querySelector('[data-player-action="true"]:not(:disabled)'),
    () => getFocusableIn(modal)[0],
  ];

  for (const pick of candidates) {
    const target = pick();
    if (target && isVisible(target)) {
      if (showRingFn) showRingFn();
      applyFocus(target, false);
      return true;
    }
  }

  const fallback = modal.querySelector(FOCUSABLE_SEL);
  if (fallback) { 
    if (showRingFn) showRingFn(); 
    applyFocus(fallback, false); 
    return true; 
  }

  return false;
}

export function getOpenModal() {
  const playerModal = document.querySelector('[data-player-modal]');
  if (playerModal && playerModal.querySelector(FOCUSABLE_SEL)) return playerModal;

  const candidates = document.querySelectorAll(
    '[role="dialog"], [data-modal], .fixed.inset-0'
  );
  for (const c of [...candidates].reverse()) {
    if (c.classList.contains('bg-transparent')) continue;
    if (c.style.pointerEvents === 'none' && !c.querySelector(FOCUSABLE_SEL)) continue;
    if (c.offsetParent !== null || getComputedStyle(c).position === 'fixed') {
      if (c.querySelector(FOCUSABLE_SEL)) return c;
    }
  }
  return null;
}

export function tryClose() {
  const searchOverlay = document.querySelector('[data-search-overlay]');
  if (searchOverlay) {
    const closeBtn = document.querySelector('button[aria-label="Search"], button[aria-label="Close search"]');
    if (closeBtn) { closeBtn.click(); return true; }
  }

  const closeBtn = document.querySelector(
    '.fixed.inset-0 button[aria-label*="lose"], .fixed.inset-0 button[aria-label*="Cancel"],' +
    '[role="dialog"] button[aria-label*="lose"], [data-modal] button[aria-label*="lose"]'
  );
  if (closeBtn && isVisible(closeBtn)) { closeBtn.click(); return true; }

  const playerClose = document.querySelector('[data-player-modal] button[aria-label="Close player"]');
  if (playerClose && isVisible(playerClose)) { playerClose.click(); return true; }

  const backdrop = document.querySelector(
    '.fixed.inset-0.bg-black\\/60, .fixed.inset-0.bg-black\\/55, .fixed.inset-0.bg-black\\/50'
  );
  if (backdrop && isVisible(backdrop)) { backdrop.click(); return true; }

  return false;
}

export function moveFocus(dir) {
  const all = getFocusable();
  if (!all.length) return false;

  const active = document.activeElement;
  const modal  = getOpenModal();

  const pool = modal ? all.filter(el => modal.contains(el)) : all;

  if (!active || !pool.includes(active)) {
    applyFocus(getPreferredModalFocus(modal) || pool[0]);
    return true;
  }

  const fromR  = active.getBoundingClientRect();
  const fromZ  = getZone(active);
  let cands    = pool.filter(el => el !== active);

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

  if (fromZ === 'navbar' && dir === 'ArrowDown') {
    const navBottom = fromR.bottom;
    const below = cands.filter(el => {
      const r = el.getBoundingClientRect();
      return getZone(el) !== 'navbar' && r.top > navBottom - 10;
    });
    const play = below.find(el =>
      el.getAttribute('aria-label')?.toLowerCase().includes('play') ||
      el.hasAttribute('data-play-btn')
    );
    if (play) { applyFocus(play); return true; }
    const card = below.find(el => el.hasAttribute('data-card') || el.closest('article'));
    if (card) { applyFocus(card); return true; }
    if (below.length) { cands = below; }
  }

  if (dir === 'ArrowRight') {
    const article = active.closest('article');
    const removeBtn = article?.querySelector('button[aria-label^="Remove"]');
    if (removeBtn && removeBtn !== active && isVisible(removeBtn)) {
      applyFocus(removeBtn);
      return true;
    }
  }

  if (dir === 'ArrowLeft' && active.getAttribute('aria-label')?.startsWith('Remove')) {
    const cardBtn = active.closest('article')?.querySelector('button[data-card], button:not([aria-label^="Remove"])');
    if (cardBtn && cardBtn !== active && isVisible(cardBtn)) {
      applyFocus(cardBtn);
      return true;
    }
  }

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

  if (fromZ === 'filters' && dir === 'ArrowDown') {
    const below = cands.filter(el => {
      const z = getZone(el);
      return (z === 'content' || z === 'sidebar') &&
             score(fromR, el.getBoundingClientRect(), 'ArrowDown') < Infinity;
    });
    if (below.length) cands = below;
  }

  if (fromZ === 'sidebar' && dir === 'ArrowRight') {
    const right = cands.filter(el => {
      const z = getZone(el);
      return z === 'content' || z === 'filters';
    });
    if (right.length) cands = right;
  }

  if (fromZ === 'content' && dir === 'ArrowLeft') {
    const sidebar = cands.filter(el => getZone(el) === 'sidebar');
    if (sidebar.length) { cands = sidebar; }
  }

  let best = null, bestScore = Infinity;
  for (const el of cands) {
    const s = score(fromR, el.getBoundingClientRect(), dir);
    if (s < bestScore) { bestScore = s; best = el; }
  }

  if (best) { applyFocus(best); return true; }
  return false;
}
