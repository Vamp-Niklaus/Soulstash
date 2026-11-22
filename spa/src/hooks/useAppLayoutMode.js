import { useState, useEffect, useLayoutEffect } from 'react';

/**
 * useAppLayoutMode
 *
 * Manages orientation-aware layout presentation with 6 configurable modes:
 *
 * 1. Vertical State (height > width):
 *    - 'auto': Auto-detect between Mobile (phone < 768px) and Desktop (tablet >= 768px)
 *    - 'mobile': Mobile mode (top search & bottom navbar)
 *    - 'desktop': Desktop mode (top header navbar)
 *
 * 2. Landscape State (width >= height):
 *    - 'auto': Auto-detect between Desktop (default for PC/laptop/browser) and TV (smart TV / TV platforms)
 *    - 'desktop': Desktop mode (top header navbar)
 *    - 'tv': TV mode (left vertical sidebar navbar)
 */
export function useAppLayoutMode() {
  const [verticalPreference, setVerticalPreference] = useState(() => {
    return localStorage.getItem('ss_vertical_layout') || 'auto';
  });

  const [landscapePreference, setLandscapePreference] = useState(() => {
    // If user previously had ss_ui_layout_mode === 'tv', honor that as 'tv'
    const legacy = localStorage.getItem('ss_ui_layout_mode');
    if (legacy === 'tv') return 'tv';
    return localStorage.getItem('ss_landscape_layout') || 'auto';
  });

  const [windowDimensions, setWindowDimensions] = useState(() => {
    if (typeof window === 'undefined') return { width: 1024, height: 768 };
    return { width: window.innerWidth, height: window.innerHeight };
  });

  useEffect(() => {
    const handleResize = () => {
      setWindowDimensions({ width: window.innerWidth, height: window.innerHeight });
    };

    const handleCustomChange = (e) => {
      if (e.detail?.vertical) {
        setVerticalPreference(e.detail.vertical);
        localStorage.setItem('ss_vertical_layout', e.detail.vertical);
      }
      if (e.detail?.landscape) {
        setLandscapePreference(e.detail.landscape);
        localStorage.setItem('ss_landscape_layout', e.detail.landscape);
      }
      if (e.detail?.mode) {
        // Direct legacy mode setter
        if (e.detail.mode === 'tv') {
          setLandscapePreference('tv');
          localStorage.setItem('ss_landscape_layout', 'tv');
        } else if (e.detail.mode === 'desktop') {
          setLandscapePreference('desktop');
          setVerticalPreference('desktop');
          localStorage.setItem('ss_landscape_layout', 'desktop');
          localStorage.setItem('ss_vertical_layout', 'desktop');
        } else if (e.detail.mode === 'mobile') {
          setVerticalPreference('mobile');
          localStorage.setItem('ss_vertical_layout', 'mobile');
        }
      }
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    window.addEventListener('soulstash:layout-mode-changed', handleCustomChange);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
      window.removeEventListener('soulstash:layout-mode-changed', handleCustomChange);
    };
  }, []);

  const isVertical = windowDimensions.height > windowDimensions.width;
  const isLandscape = !isVertical;

  let activeMode = 'desktop';

  if (isVertical) {
    if (verticalPreference === 'mobile') {
      activeMode = 'mobile';
    } else if (verticalPreference === 'desktop') {
      activeMode = 'desktop';
    } else {
      // Auto vertical: phone (< 768px) -> mobile, tablet (>= 768px) -> desktop
      activeMode = windowDimensions.width < 768 ? 'mobile' : 'desktop';
    }
  } else {
    // Landscape state
    if (landscapePreference === 'tv') {
      activeMode = 'tv';
    } else if (landscapePreference === 'desktop') {
      activeMode = 'desktop';
    } else {
      // Auto landscape: smart TV or TV browser -> tv, regular desktop/laptop/web -> desktop
      const isTvPlatform = typeof navigator !== 'undefined' &&
        /(tv|smarttv|googletv|appletv|android tv|tizen|webos|roku)/i.test(navigator.userAgent || '');
      activeMode = isTvPlatform ? 'tv' : 'desktop';
    }
  }

  const isTvLayout = activeMode === 'tv';
  const isMobileLayout = activeMode === 'mobile';
  const isDesktopLayout = activeMode === 'desktop';

  // Keep the shared document layout in sync before paint. Multiple pages use
  // this hook; one page unmounting must not clear classes owned by the app shell.
  useLayoutEffect(() => {
    const doc = document.documentElement;
    doc.classList.toggle('layout-tv-mode', isTvLayout);
    doc.classList.toggle('layout-mobile-mode', isMobileLayout);
    doc.classList.toggle('layout-desktop-mode', isDesktopLayout);
  }, [isTvLayout, isMobileLayout, isDesktopLayout]);

  const updateVerticalPreference = (pref) => {
    setVerticalPreference(pref);
    localStorage.setItem('ss_vertical_layout', pref);
    window.dispatchEvent(new CustomEvent('soulstash:layout-mode-changed', { detail: { vertical: pref } }));
  };

  const updateLandscapePreference = (pref) => {
    setLandscapePreference(pref);
    localStorage.setItem('ss_landscape_layout', pref);
    window.dispatchEvent(new CustomEvent('soulstash:layout-mode-changed', { detail: { landscape: pref } }));
  };

  return {
    verticalPreference,
    landscapePreference,
    setVerticalPreference: updateVerticalPreference,
    setLandscapePreference: updateLandscapePreference,
    activeMode,
    isTvLayout,
    isMobileLayout,
    isDesktopLayout,
    isVertical,
    isLandscape,
    windowDimensions
  };
}
