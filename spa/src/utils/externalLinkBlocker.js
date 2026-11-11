import { Capacitor } from '@capacitor/core';

// Blocks every link that would leave the app inside the Android APK and the Windows EXE shells.
// Links that stay inside the app (same origin, in-page anchors) keep working. In a normal browser
// this does nothing, so the website behaves exactly as before.

function isNativeShell() {
  try {
    if (Capacitor.isNativePlatform()) return true;
  } catch (_) { /* Capacitor not available */ }
  const ua = navigator.userAgent || '';
  return /Electron|Tauri/i.test(ua) || Boolean(window.__TAURI__) || Boolean(window.electron || window.electronAPI);
}

function isInsideAppLink(anchor) {
  const href = anchor.getAttribute('href') || '';
  if (!href) return false;
  if (href.startsWith('#')) return true;
  if (anchor.target && anchor.target.toLowerCase() !== '_self') return false;
  try {
    const url = new URL(anchor.href, window.location.href);
    return url.origin === window.location.origin && (url.protocol === 'http:' || url.protocol === 'https:');
  } catch (_) {
    return false;
  }
}

export function installExternalLinkBlocker() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__soulstashLinkBlocker) return;
  if (!isNativeShell()) return;
  window.__soulstashLinkBlocker = true;

  const blockIfExternal = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const anchor = target ? target.closest('a[href], area[href]') : null;
    if (!anchor || isInsideAppLink(anchor)) return;
    event.preventDefault();
    event.stopPropagation();
  };

  // Capture phase, so this runs before any component handler that would open the link.
  document.addEventListener('click', blockIfExternal, true);
  document.addEventListener('auxclick', blockIfExternal, true);

  // Stop scripts and embedded players from opening popups or new windows.
  window.open = () => null;
}
