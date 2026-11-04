import { useState, useEffect } from 'react';

/**
 * useAppLayoutMode
 *
 * Manages the layout presentation mode:
 * - 'auto': Landscape (width > height) automatically activates TV mode with left sidebar,
 *           Portrait activates mobile mode with bottom navbar.
 * - 'tv': Left vertical sidebar navbar for TV / wide remote operation.
 * - 'desktop': Top header navbar with profile dropdown.
 * - 'mobile': Top header with search & settings, bottom navigation bar.
 */
export function useAppLayoutMode() {
  const [layoutPreference, setLayoutPreference] = useState(() => {
    return localStorage.getItem('ss_ui_layout_mode') || 'auto';
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
      if (e.detail?.mode) {
        setLayoutPreference(e.detail.mode);
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

  const isLandscape = windowDimensions.width > windowDimensions.height;
  const isWide = windowDimensions.width >= 768;

  let activeMode = layoutPreference;
  if (layoutPreference === 'auto') {
    // When mobile or device is rotated into landscape (width > height)
    // or when on TV / large widescreen:
    if (isLandscape && (windowDimensions.width >= 600 || windowDimensions.height <= 500)) {
      activeMode = 'tv';
    } else if (!isWide) {
      activeMode = 'mobile';
    } else {
      activeMode = 'desktop';
    }
  }

  const isTvLayout = activeMode === 'tv';
  const isMobileLayout = activeMode === 'mobile';
  const isDesktopLayout = activeMode === 'desktop';

  // Apply layout class to document.documentElement for global styling
  useEffect(() => {
    const doc = document.documentElement;
    doc.classList.toggle('layout-tv-mode', isTvLayout);
    doc.classList.toggle('layout-mobile-mode', isMobileLayout);
    doc.classList.toggle('layout-desktop-mode', isDesktopLayout);
    return () => {
      doc.classList.remove('layout-tv-mode', 'layout-mobile-mode', 'layout-desktop-mode');
    };
  }, [isTvLayout, isMobileLayout, isDesktopLayout]);

  return {
    layoutPreference,
    setLayoutPreference,
    activeMode,
    isTvLayout,
    isMobileLayout,
    isDesktopLayout,
    isLandscape,
    windowDimensions
  };
}
