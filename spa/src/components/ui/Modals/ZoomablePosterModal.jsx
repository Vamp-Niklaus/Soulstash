import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { imageUrl } from '../../../utils/formatters.js';
import { FALLBACK_AVATAR } from '../../../utils/constants.js';

/**
 * ZoomablePosterModal
 *
 * Fullscreen image lightbox modal for movie/series posters and cast photos.
 * Features:
 * - Unrestricted pinch-to-zoom on mobile that scales freely beyond its boundary
 * - Smooth transition animation that bounces back to 1.0x scale and centered position on touch release
 * - Single-finger swipe left/right for fast gallery navigation
 * - Left / Right navigation buttons with circular indicators
 * - Escape key & backdrop click to close
 */
export function ZoomablePosterModal({
  open,
  onClose,
  images = [],
  currentIndex = 0,
  onIndexChange,
  alt = 'Poster',
  fallbackImage = FALLBACK_AVATAR
}) {
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });
  const [isAnimatingBack, setIsAnimatingBack] = useState(false);
  const touchStateRef = useRef({
    initialDist: 0,
    initialScale: 1,
    initialMidX: 0,
    initialMidY: 0,
    isPinching: false,
    swipeStartX: 0,
    swipeStartY: 0,
    swipeLastX: 0,
    swipeLastY: 0,
    isSwiping: false
  });

  const swipedHorizontallyRef = useRef(false);
  const lastSwipeTimeRef = useRef(0);
  const isNavigatingRef = useRef(false);

  const effectiveImages = useMemo(() => {
    const list = (Array.isArray(images) ? images : []).map((item) => {
      if (typeof item === 'string') return item;
      return item?.file_path || item?.url || '';
    }).filter(Boolean);
    if (list.length === 0) {
      return [fallbackImage || FALLBACK_AVATAR];
    }
    return list;
  }, [images, fallbackImage]);

  const count = effectiveImages.length;
  const safeIndex = count > 0 ? ((currentIndex % count) + count) % count : 0;
  const activePath = effectiveImages[safeIndex] || fallbackImage || FALLBACK_AVATAR;

  // TMDB paths start with '/' (e.g. /abc.jpg). Direct URLs are http(s), data:, or avatar.png.
  const isDirectUrl =
    Boolean(activePath) &&
    typeof activePath === 'string' &&
    (activePath.startsWith('http://') ||
     activePath.startsWith('https://') ||
     activePath.startsWith('data:') ||
     activePath.includes('avatar.png'));

  const currentUrl = isDirectUrl
    ? activePath
    : imageUrl(activePath, 'original');

  const isPushedRef = useRef(false);

  // Keep latest mutable refs for event handlers so history trap does NOT re-run on index change!
  const onIndexChangeRef = useRef(onIndexChange);
  onIndexChangeRef.current = onIndexChange;
  const safeIndexRef = useRef(safeIndex);
  safeIndexRef.current = safeIndex;
  const countRef = useRef(count);
  countRef.current = count;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Reset transform whenever active image changes
  useEffect(() => {
    setTransform({ scale: 1, x: 0, y: 0 });
    setIsAnimatingBack(false);
  }, [safeIndex]);

  // Back-button history trap: pressing back closes ONLY the poster overlay without navigating away from the page.
  // Crucial: ONLY depend on `open`! Re-running on index change would trigger cleanup which calls history.back()!
  useEffect(() => {
    if (!open) return;

    if (!isPushedRef.current) {
      window.history.pushState({ posterModalOpen: true }, '');
      isPushedRef.current = true;
    }

    const handlePopState = () => {
      isPushedRef.current = false;
      onCloseRef.current?.();
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onCloseRef.current?.();
      } else if (e.key === 'ArrowLeft' && countRef.current > 1 && onIndexChangeRef.current) {
        onIndexChangeRef.current((safeIndexRef.current - 1 + countRef.current) % countRef.current);
      } else if (e.key === 'ArrowRight' && countRef.current > 1 && onIndexChangeRef.current) {
        onIndexChangeRef.current((safeIndexRef.current + 1) % countRef.current);
      }
    };

    window.addEventListener('popstate', handlePopState);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('keydown', handleKeyDown);
      if (isPushedRef.current) {
        isPushedRef.current = false;
        if (window.history.state?.posterModalOpen) {
          window.history.back();
        }
      }
    };
  }, [open]);

  if (!open) return null;

  const handlePrev = (e) => {
    if (e) {
      e.stopPropagation();
    }
    isNavigatingRef.current = true;
    setTimeout(() => {
      isNavigatingRef.current = false;
    }, 250);
    if (countRef.current > 1 && onIndexChangeRef.current) {
      onIndexChangeRef.current((safeIndexRef.current - 1 + countRef.current) % countRef.current);
    }
  };

  const handleNext = (e) => {
    if (e) {
      e.stopPropagation();
    }
    isNavigatingRef.current = true;
    setTimeout(() => {
      isNavigatingRef.current = false;
    }, 250);
    if (countRef.current > 1 && onIndexChangeRef.current) {
      onIndexChangeRef.current((safeIndexRef.current + 1) % countRef.current);
    }
  };

  // Touch gesture handlers for mobile pinch-zoom and swipe
  const handleTouchStart = (e) => {
    swipedHorizontallyRef.current = false;
    if (e.touches.length === 2) {
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
      const midX = (t1.clientX + t2.clientX) / 2;
      const midY = (t1.clientY + t2.clientY) / 2;

      touchStateRef.current = {
        ...touchStateRef.current,
        initialDist: dist,
        initialScale: transform.scale,
        initialMidX: midX,
        initialMidY: midY,
        isPinching: true,
        isSwiping: false
      };
      setIsAnimatingBack(false);
    } else if (e.touches.length === 1) {
      touchStateRef.current = {
        ...touchStateRef.current,
        initialDist: 0,
        initialScale: transform.scale,
        isPinching: false,
        swipeStartX: e.touches[0].clientX,
        swipeStartY: e.touches[0].clientY,
        swipeLastX: e.touches[0].clientX,
        swipeLastY: e.touches[0].clientY,
        isSwiping: true
      };
    }
  };

  const handleTouchMove = (e) => {
    if (e.touches.length === 2 && touchStateRef.current.isPinching) {
      if (e.cancelable) e.preventDefault();
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
      const midX = (t1.clientX + t2.clientX) / 2;
      const midY = (t1.clientY + t2.clientY) / 2;

      const scaleFactor = dist / (touchStateRef.current.initialDist || 1);
      const newScale = Math.max(0.4, touchStateRef.current.initialScale * scaleFactor);
      const dx = midX - touchStateRef.current.initialMidX;
      const dy = midY - touchStateRef.current.initialMidY;

      setTransform({ scale: newScale, x: dx, y: dy });
    } else if (e.touches.length === 1 && touchStateRef.current.isSwiping) {
      touchStateRef.current.swipeLastX = e.touches[0].clientX;
      touchStateRef.current.swipeLastY = e.touches[0].clientY;
      const deltaX = e.touches[0].clientX - touchStateRef.current.swipeStartX;
      const deltaY = e.touches[0].clientY - touchStateRef.current.swipeStartY;
      if (Math.abs(deltaX) > 12 && Math.abs(deltaX) > Math.abs(deltaY)) {
        swipedHorizontallyRef.current = true;
        if (e.cancelable) e.preventDefault();
      }
    }
  };

  const handleTouchEnd = (e) => {
    const s = touchStateRef.current;
    if (s.isPinching) {
      s.isPinching = false;
      s.isSwiping = false;
      setIsAnimatingBack(true);
      setTransform({ scale: 1, x: 0, y: 0 });
      return;
    }

    if (s.isSwiping) {
      s.isSwiping = false;
      const endX = e.changedTouches?.[0]?.clientX ?? s.swipeLastX;
      const endY = e.changedTouches?.[0]?.clientY ?? s.swipeLastY;
      const deltaX = endX - s.swipeStartX;
      const deltaY = endY - s.swipeStartY;

      if (swipedHorizontallyRef.current || Math.abs(deltaX) > 20) {
        lastSwipeTimeRef.current = Date.now();
      }

      if (transform.scale <= 1.15) {
        // Horizontal swipe threshold 28px
        if (Math.abs(deltaX) > 28 && Math.abs(deltaX) > Math.abs(deltaY)) {
          if (deltaX < 0 && countRef.current > 1 && onIndexChangeRef.current) {
            onIndexChangeRef.current((safeIndexRef.current + 1) % countRef.current);
          } else if (deltaX > 0 && countRef.current > 1 && onIndexChangeRef.current) {
            onIndexChangeRef.current((safeIndexRef.current - 1 + countRef.current) % countRef.current);
          }
        }
      }
    }
  };

  const handleTouchCancel = () => {
    touchStateRef.current.isPinching = false;
    touchStateRef.current.isSwiping = false;
    setIsAnimatingBack(true);
    setTransform({ scale: 1, x: 0, y: 0 });
  };

  const modalContent = (
    <div
      className="fixed inset-0 z-[999999] flex items-center justify-center select-none overflow-hidden touch-none"
      style={{
        background: 'radial-gradient(circle at center, rgba(16, 18, 22, 0.96) 0%, rgba(6, 7, 9, 0.99) 75%, black 100%)'
      }}
      onClick={(e) => {
        // Prevent accidental backdrop closing immediately following swipe or button tap
        if (Date.now() - lastSwipeTimeRef.current < 400 || isNavigatingRef.current) return;
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
    >
      {/* Previous Button - Reliable pointer events */}
      {count > 1 && (
        <button
          type="button"
          className="absolute left-3 sm:left-6 z-[60] flex h-12 w-12 items-center justify-center rounded-full bg-black/75 text-white hover:bg-black/95 active:scale-95 transition-all pointer-events-auto cursor-pointer shadow-2xl select-none"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={handlePrev}
          aria-label="Previous image"
        >
          <i className="fas fa-chevron-left text-lg pointer-events-none" />
        </button>
      )}

      {/* Main Image with mobile pinch-zoom and bounce-back animation */}
      <div
        className="relative z-10 flex items-center justify-center max-w-[92vw] max-h-[86vh] pointer-events-none select-none"
      >
        <img
          src={currentUrl}
          alt={alt}
          draggable={false}
          style={{
            transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`,
            transition: isAnimatingBack ? 'transform 360ms cubic-bezier(0.2, 0.9, 0.25, 1)' : 'none',
            transformOrigin: 'center center',
            willChange: 'transform'
          }}
          onError={(e) => {
            const src = e.currentTarget.src;
            if (src.includes('avatar.png')) return;
            if (src.includes('/original/')) {
              e.currentTarget.src = src.replace('/original/', '/w1280/');
            } else if (src.includes('/w1280/')) {
              e.currentTarget.src = src.replace('/w1280/', '/w780/');
            } else {
              e.currentTarget.src = fallbackImage || FALLBACK_AVATAR;
            }
          }}
          className="relative max-h-[85vh] max-w-[90vw] rounded-2xl object-contain shadow-[0_0_90px_rgba(0,0,0,0.85)] pointer-events-auto touch-none select-none"
        />
      </div>

      {/* Next Button - Reliable pointer events */}
      {count > 1 && (
        <button
          type="button"
          className="absolute right-3 sm:right-6 z-[60] flex h-12 w-12 items-center justify-center rounded-full bg-black/75 text-white hover:bg-black/95 active:scale-95 transition-all pointer-events-auto cursor-pointer shadow-2xl select-none"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={handleNext}
          aria-label="Next image"
        >
          <i className="fas fa-chevron-right text-lg pointer-events-none" />
        </button>
      )}

      {/* Bottom Counter Indicator */}
      {count > 1 && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 rounded-full bg-black/60 px-4 py-1 text-xs sm:text-sm font-medium text-white/90 backdrop-blur-md">
          {safeIndex + 1} / {count}
        </div>
      )}

      {/* Preload adjacent images safely */}
      {count > 1 && [-2, -1, 1, 2].map((offset, offsetIdx) => {
        const idx = ((safeIndex + offset) % count + count) % count;
        const preloadPath = effectiveImages[idx];
        if (!preloadPath || typeof preloadPath !== 'string') return null;
        const isPreloadDirect =
          preloadPath.startsWith('http://') ||
          preloadPath.startsWith('https://') ||
          preloadPath.startsWith('data:') ||
          preloadPath.includes('avatar.png');
        const preloadUrl = isPreloadDirect
          ? preloadPath
          : imageUrl(preloadPath, 'original');
        return (
          <img
            key={`preload-${offsetIdx}-${idx}`}
            src={preloadUrl}
            alt=""
            className="hidden"
            aria-hidden="true"
          />
        );
      })}
    </div>
  );

  return typeof document !== 'undefined'
    ? createPortal(modalContent, document.body)
    : null;
}
