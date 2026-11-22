import { useEffect, useState } from 'react';

const compactBreakpoint = 1024;
const isCompactViewport = () => window.innerWidth < compactBreakpoint;

export function useCollectionsResponsiveLayout(selectedCollectionName) {
  const [isCompactCollectionsView, setIsCompactCollectionsView] = useState(isCompactViewport);
  const [mobileSidebarVisible, setMobileSidebarVisible] = useState(isCompactViewport);

  useEffect(() => {
    const handleResize = () => {
      const compact = isCompactViewport();
      setIsCompactCollectionsView(compact);
      setMobileSidebarVisible((current) => (!compact || !selectedCollectionName ? true : current));
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [selectedCollectionName]);

  useEffect(() => {
    if (!isCompactCollectionsView || !selectedCollectionName) setMobileSidebarVisible(true);
  }, [isCompactCollectionsView, selectedCollectionName]);

  useEffect(() => {
    if (!isCompactCollectionsView) return undefined;
    const handlePopState = (event) => {
      if (selectedCollectionName && !mobileSidebarVisible && !event.state?.soulstashCollectionsMobileDetail) {
        setMobileSidebarVisible(true);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isCompactCollectionsView, mobileSidebarVisible, selectedCollectionName]);

  return { isCompactCollectionsView, mobileSidebarVisible, setMobileSidebarVisible };
}
