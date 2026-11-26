import { useState, useEffect, useCallback } from 'react';
import { getHomeGridColumns, getTvHomeGridColumns } from '../utils/formatters.js';
import { useAppLayoutMode } from './useAppLayoutMode.js';

export function useHomeTwoRowLimit() {
  const { isTvLayout } = useAppLayoutMode();

  const calculateLimit = useCallback(() => {
    const width = typeof window !== 'undefined' ? window.innerWidth : 1920;
    const isTv = isTvLayout || (typeof document !== 'undefined' && document.documentElement.classList.contains('layout-tv-mode'));
    if (isTv) {
      // In TV mode: exactly 1 row per genre
      return getTvHomeGridColumns(width) * 1;
    }
    if (width < 768) {
      // Mobile: 1 horizontal scrollable row (~3 visible + 7 off-screen = 10 total)
      return 10;
    }
    // Desktop: 2 rows
    return getHomeGridColumns(width) * 2;
  }, [isTvLayout]);

  const [limit, setLimit] = useState(calculateLimit);

  useEffect(() => {
    function handleResize() {
      setLimit(calculateLimit());
    }

    setLimit(calculateLimit());
    window.addEventListener('resize', handleResize);
    window.addEventListener('soulstash:layout-mode-changed', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('soulstash:layout-mode-changed', handleResize);
    };
  }, [calculateLimit]);

  return limit;
}
