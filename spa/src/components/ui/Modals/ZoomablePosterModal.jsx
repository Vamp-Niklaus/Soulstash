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
    isSwiping: false
  });

  const normalizedImages = useMemo(() => {
    if (!Array.isArray(images) || images.length === 0) return [];
    return images.map((item) => {
      if (typeof item === 'string') return item;
      return item?.file_path || item?.url || '';
    }).filter(Boolean);
  }, [images]);

  const count = normalizedImages.length;
  const activePath = count > 0 ? normalizedImages[currentIndex % count] : '';
  const currentUrl = activePath.startsWith('http') ? activePath : imageUrl(activePath, 'original');

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

  if (!open || !activePath) return null;

  const handlePrev = (e) => {
    e.stopPropagation();
    if (count > 1 && onIndexChange) {
      onIndexChange((currentIndex - 1 + count) % count);
    }
  };

  const handleNext = (e) => {
    e.stopPropagation();
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
      touchStateRef.current.swipeStartX = e.touches[0].clientX;
      touchStateRef.current.swipeStartY = e.touches[0].clientY;
      touchStateRef.current.isSwiping = true;
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
    }
  };

  const handleTouchEnd = (e) => {
    if (touchStateRef.current.isPinching) {
      touchStateRef.current.isPinching = false;
      // Smoothly animate back to normal 1.0x scale and centered coordinates on release
      setIsAnimatingBack(true);
      setTransform({ scale: 1, x: 0, y: 0 });
      return;
    }

    if (touchStateRef.current.isSwiping && e.changedTouches.length === 1 && transform.scale <= 1.05) {
      const deltaX = e.changedTouches[0].clientX - touchStateRef.current.swipeStartX;
      const deltaY = e.changedTouches[0].clientY - touchStateRef.current.swipeStartY;
      touchStateRef.current.isSwiping = false;

      // Horizontal swipe threshold 45px
      if (Math.abs(deltaX) > 45 && Math.abs(deltaX) > Math.abs(deltaY) * 1.3) {
        if (deltaX < 0 && count > 1 && onIndexChange) {
          onIndexChange((currentIndex + 1) % count);
        } else if (deltaX > 0 && count > 1 && onIndexChange) {
          onIndexChange((currentIndex - 1 + count) % count);
        }
      }
    }
  };

  const modalContent = (
    <div
      className="fixed inset-0 z-[999999] flex items-center justify-center animate-in fade-in duration-200 select-none overflow-hidden touch-none"
      style={{
        background: 'radial-gradient(circle at center, rgba(16, 18, 22, 0.96) 0%, rgba(6, 7, 9, 0.99) 75%, black 100%)'
      }}
      onClick={onClose}
    >
      {/* Previous Button */}
      {count > 1 && (
        <button
          type="button"
          className="absolute left-3 sm:left-6 z-20 flex h-11 w-11 sm:h-12 sm:w-12 items-center justify-center rounded-full bg-black/60 text-white/90 hover:bg-black/80 hover:text-white transition-all active:scale-95"
          onClick={handlePrev}
          aria-label="Previous image"
        >
          <i className="fas fa-chevron-left text-sm" />
        </button>
      )}

      {/* Main Image with mobile pinch-zoom and bounce-back animation */}
      <div
        className="relative z-10 flex items-center justify-center max-w-[92vw] max-h-[86vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          key={currentUrl}
          src={currentUrl}
          alt={alt}
          draggable={false}
          style={{
            transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`,
            transition: isAnimatingBack ? 'transform 360ms cubic-bezier(0.2, 0.9, 0.25, 1)' : 'none',
            transformOrigin: 'center center',
            willChange: 'transform'
          }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
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
          className="relative max-h-[85vh] max-w-[90vw] rounded-2xl object-contain shadow-[0_0_90px_rgba(0,0,0,0.85)] animate-in fade-in zoom-in-95 duration-200 pointer-events-auto"
        />
      </div>

      {/* Next Button */}
      {count > 1 && (
        <button
          type="button"
          className="absolute right-3 sm:right-6 z-20 flex h-11 w-11 sm:h-12 sm:w-12 items-center justify-center rounded-full bg-black/60 text-white/90 hover:bg-black/80 hover:text-white transition-all active:scale-95"
          onClick={handleNext}
          aria-label="Next image"
        >
          <i className="fas fa-chevron-right text-sm" />
        </button>
      )}

      {/* Bottom Counter Indicator */}
      {count > 1 && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 rounded-full bg-black/60 px-4 py-1 text-xs sm:text-sm font-medium text-white/90 backdrop-blur-md">
          {currentIndex + 1} / {count}
        </div>
      )}

      {/* Preload adjacent images */}
      {count > 1 && [-2, -1, 1, 2].map((offset) => {
        const idx = (currentIndex + offset + count) % count;
        const preloadPath = normalizedImages[idx];
        const preloadUrl = preloadPath.startsWith('http') ? preloadPath : imageUrl(preloadPath, 'original');
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
