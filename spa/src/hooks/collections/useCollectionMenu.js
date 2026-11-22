import { useEffect, useRef, useState } from 'react';

export function getCollectionMenuPosition(triggerRect, estimatedWidth = 168, estimatedHeight = 116) {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const left = Math.min(Math.max(16, triggerRect.left), Math.max(16, viewportWidth - estimatedWidth - 16));
  const belowTop = triggerRect.bottom + 8;
  const aboveTop = triggerRect.top - estimatedHeight - 8;
  const top = belowTop + estimatedHeight <= viewportHeight - 16 || aboveTop < 16
    ? Math.min(belowTop, Math.max(16, viewportHeight - estimatedHeight - 16))
    : aboveTop;
  return { top, left };
}

export function useCollectionMenu() {
  const collectionMenuTriggerRefs = useRef(new Map());
  const [openCollectionMenuId, setOpenCollectionMenuId] = useState('');
  const [collectionMenuPosition, setCollectionMenuPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!openCollectionMenuId) return undefined;
    const updatePosition = () => {
      const trigger = collectionMenuTriggerRefs.current.get(openCollectionMenuId);
      if (trigger) setCollectionMenuPosition(getCollectionMenuPosition(trigger.getBoundingClientRect()));
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [openCollectionMenuId]);

  return { collectionMenuTriggerRefs, openCollectionMenuId, setOpenCollectionMenuId, collectionMenuPosition, setCollectionMenuPosition };
}
