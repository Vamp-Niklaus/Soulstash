import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { imageUrl } from '../../../utils/formatters.js';
import { FALLBACK_AVATAR, FALLBACK_POSTER } from '../../../utils/constants.js';

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
  fallbackImage = FALLBACK_POSTER
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

  const effectiveImages = useMemo(() => {
    const list = (Array.isArray(images) ? images : []).map((item) => {
      if (typeof item === 'string') return item;
      return item?.file_path || item?.url || '';
    }).filter(Boolean);
    if (list.length === 0) {
      return [fallbackImage || FALLBACK_POSTER];
    }
    return list;
  }, [images, fallbackImage]);

  const count = effectiveImages.length;
  const safeIndex = count > 0 ? ((currentIndex % count) + count) % count : 0;
  const activePath = effectiveImages[safeIndex] || fallbackImage || FALLBACK_POSTER;
  const currentUrl = activePath.startsWith('http') || activePath.startsWith('data:')
    ? activePath
    : imageUrl(activePath, 'original');

  const isPushedRef = useRef(false);

  // Reset transform whenever active image changes
  useEffect(() => {
    setTransform({ scale: 1, x: 0, y: 0 });
    setIsAnimatingBack(false);
  }, [currentIndex]);

  // Back-button history trap: pressing back closes ONLY the poster overlay without navigating away from the page
  useEffect(() => {
    if (!open) return;

    if (!isPushedRef.current) {
      window.history.pushState({ posterModalOpen: true }, '');
      isPushedRef.current = true;
    }

    const handlePopState = () => {
      isPushedRef.current = false;
      onClose();
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft' && count > 1 && onIndexChange) {
        onIndexChange((currentIndex - 1 + count) % count);
      } else if (e.key === 'ArrowRight' && count > 1 && onIndexChange) {
        onIndexChange((currentIndex + 1) % count);
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
  }, [open, count, currentIndex, onClose, onIndexChange]);

  if (!open) return null;

  const handlePrev = (e) => {
    if (e) {
      e.stopPropagation();
      if (e.cancelable && e.type === 'touchend') e.preventDefault();
    }
    if (count > 1 && onIndexChange) {
      onIndexChange((currentIndex - 1 + count) % count);
    }
  };

  const handleNext = (e) => {
    if (e) {
      e.stopPropagation();
      if (e.cancelable && e.type === 'touchend') e.preventDefault();
    }
    if (count > 1 && onIndexChange) {
      onIndexChange((currentIndex + 1) % count);
    }
  };

  // Touch gesture handlers for mobile pinch-zoom and swipe
  const handleTouchStart = (e) => {
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
      // Unrestricted zoom: can zoom far beyond boundaries
      const newScale = Math.max(0.4, touchStateRef.current.initialScale * scaleFactor);
      const dx = midX - touchStateRef.current.initialMidX;
      const dy = midY - touchStateRef.current.initialMidY;

      setTransform({ scale: newScale, x: dx, y: dy });
    } else if (e.touches.length === 1 && touchStateRef.current.isSwiping) {
      touchStateRef.current.swipeLastX = e.touches[0].clientX;
      touchStateRef.current.swipeLastY = e.touches[0].clientY;
      const deltaX = e.touches[0].clientX - touchStateRef.current.swipeStartX;
      const deltaY = e.touches[0].clientY - touchStateRef.current.swipeStartY;
      // Prevent browser default scroll/bounce when swiping horizontally
      if (Math.abs(deltaX) > 15 && Math.abs(deltaX) > Math.abs(deltaY) && e.cancelable) {
        e.preventDefault();
      }
    }
  };

  const handleTouchEnd = (e) => {
    const s = touchStateRef.current;
    if (s.isPinching) {
      s.isPinching = false;
      s.isSwiping = false;
      // Smoothly animate back to normal 1.0x scale and centered coordinates on release
      setIsAnimatingBack(true);
      setTransform({ scale: 1, x: 0, y: 0 });
      return;
    }

    if (s.isSwiping) {
      s.isSwiping = false;
      if (transform.scale <= 1.15) {
        const endX = e.changedTouches?.[0]?.clientX ?? s.swipeLastX;
        const endY = e.changedTouches?.[0]?.clientY ?? s.swipeLastY;
        const deltaX = endX - s.swipeStartX;
        const deltaY = endY - s.swipeStartY;

        // Horizontal swipe threshold 30px
        if (Math.abs(deltaX) > 30 && Math.abs(deltaX) > Math.abs(deltaY)) {
          if (deltaX < 0 && count > 1 && onIndexChange) {
            onIndexChange((currentIndex + 1) % count);
          } else if (deltaX > 0 && count > 1 && onIndexChange) {
            onIndexChange((currentIndex - 1 + count) % count);
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
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
    >
      {/* Previous Button */}
      {count > 1 && (
        <button
          type="button"
          className="absolute left-3 sm:left-6 z-[50] flex h-12 w-12 items-center justify-center rounded-full bg-black/70 text-white hover:bg-black/90 active:scale-95 transition-all pointer-events-auto cursor-pointer shadow-lg select-none"
          onClick={handlePrev}
          onTouchStart={(e) => e.stopPropagation()}
          onTouchEnd={handlePrev}
          aria-label="Previous image"
        >
          <i className="fas fa-chevron-left text-base" />
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

      {/* Next Button */}
      {count > 1 && (
        <button
          type="button"
          className="absolute right-3 sm:right-6 z-[50] flex h-12 w-12 items-center justify-center rounded-full bg-black/70 text-white hover:bg-black/90 active:scale-95 transition-all pointer-events-auto cursor-pointer shadow-lg select-none"
          onClick={handleNext}
          onTouchStart={(e) => e.stopPropagation()}
          onTouchEnd={handleNext}
          aria-label="Next image"
        >
          <i className="fas fa-chevron-right text-base" />
        </button>
      )}

      {/* Bottom Counter Indicator */}
      {count > 1 && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 rounded-full bg-black/60 px-4 py-1 text-xs sm:text-sm font-medium text-white/90 backdrop-blur-md">
          {safeIndex + 1} / {count}
        </div>
      )}

      {/* Preload adjacent images */}
      {count > 1 && [-2, -1, 1, 2].map((offset) => {
        const idx = ((safeIndex + offset) % count + count) % count;
        const preloadPath = effectiveImages[idx];
        const preloadUrl = preloadPath.startsWith('http') || preloadPath.startsWith('data:')
          ? preloadPath
          : imageUrl(preloadPath, 'original');
        return (
          <img
            key={`preload-${idx}`}
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
