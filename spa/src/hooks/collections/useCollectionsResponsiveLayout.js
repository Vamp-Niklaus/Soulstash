import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

const compactBreakpoint = 1024;
const isCompactViewport = () => (typeof window !== 'undefined' ? window.innerWidth < compactBreakpoint : false);

export function useCollectionsResponsiveLayout(selectedCollectionName) {
  const location = useLocation();
  const [isCompactCollectionsView, setIsCompactCollectionsView] = useState(isCompactViewport);

  useEffect(() => {
    const handleResize = () => {
      setIsCompactCollectionsView(isCompactViewport());
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Derive mobile detail vs sidebar visibility atomically from router location state so clicking
  // a collection transitions URL + visibility in a single render with zero previous-collection flicker.
  const mobileDetailActive = Boolean(location.state?.mobileDetail && selectedCollectionName);
  const mobileSidebarVisible = isCompactCollectionsView ? !mobileDetailActive : false;

  return { isCompactCollectionsView, mobileSidebarVisible };
}
