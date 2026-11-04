import React, { useState, useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { ScreenOrientation } from '@capacitor/screen-orientation';

/**
 * ScreenRotationPrompt
 *
 * Displays an on-screen floating prompt whenever a phone or mobile device is rotated,
 * allowing the user to easily rotate the screen or switch between portrait and landscape.
 * Appears dynamically every time the phone is turned.
 */
export function ScreenRotationPrompt() {
  const [visible, setVisible] = useState(false);
  const [targetOrientation, setTargetOrientation] = useState('landscape');
  const timerRef = useRef(null);
  const lastStateRef = useRef({
    isVertical: typeof window !== 'undefined' ? window.innerHeight > window.innerWidth : true,
    lastTrigger: 0
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const triggerPrompt = () => {
      const isVertical = window.innerHeight > window.innerWidth;
      const target = isVertical ? 'landscape' : 'portrait';
      setTargetOrientation(target);
      setVisible(true);

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setVisible(false);
      }, 7000);
    };

    const handleResizeOrOrientation = () => {
      const isVertical = window.innerHeight > window.innerWidth;
      const now = Date.now();

      // Trigger every time orientation changes, or on significant dimension flip
      if (isVertical !== lastStateRef.current.isVertical || now - lastStateRef.current.lastTrigger > 1500) {
        lastStateRef.current = { isVertical, lastTrigger: now };
        triggerPrompt();
      }
    };

    window.addEventListener('resize', handleResizeOrOrientation);
    window.addEventListener('orientationchange', handleResizeOrOrientation);

    // Also listen to window.screen.orientation if available
    if (window.screen?.orientation) {
      window.screen.orientation.addEventListener('change', handleResizeOrOrientation);
    }

    return () => {
      window.removeEventListener('resize', handleResizeOrOrientation);
      window.removeEventListener('orientationchange', handleResizeOrOrientation);
      if (window.screen?.orientation) {
        window.screen.orientation.removeEventListener('change', handleResizeOrOrientation);
      }
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleRotate = async () => {
    setVisible(false);
    if (timerRef.current) clearTimeout(timerRef.current);

    if (Capacitor.isNativePlatform()) {
      try {
        if (targetOrientation === 'landscape') {
          await ScreenOrientation.lock({ orientation: 'landscape' });
        } else {
          await ScreenOrientation.lock({ orientation: 'portrait' });
        }
      } catch (err) {
        try {
          await ScreenOrientation.unlock();
        } catch (e) {}
      }
    } else {
      try {
        if (window.screen?.orientation?.lock) {
          await window.screen.orientation.lock(targetOrientation);
        }
      } catch (err) {}
    }
  };

  if (!visible) return null;

  return (
    <aside
      aria-label="Screen Rotation"
      className="fixed bottom-20 sm:bottom-24 right-4 z-[99998] flex items-center gap-2 rounded-full border border-white/20 bg-[#121418]/95 px-3.5 py-2 text-xs font-semibold text-white shadow-[0_12px_36px_rgba(0,0,0,0.85)] backdrop-blur-md animate-in slide-in-from-bottom-4 duration-200 select-none"
    >
      <button
        type="button"
        onClick={handleRotate}
        className="flex items-center gap-2 text-white hover:text-amber-400 active:scale-95 transition-all"
        aria-label={`Rotate screen to ${targetOrientation}`}
      >
        <i className="fas fa-sync-alt text-amber-400 animate-spin-reverse text-sm"></i>
        <span>Rotate to {targetOrientation === 'landscape' ? 'Landscape' : 'Portrait'}</span>
      </button>

      <button
        type="button"
        onClick={() => setVisible(false)}
        className="ml-1 flex h-5 w-5 items-center justify-center rounded-full text-white/50 hover:bg-white/10 hover:text-white"
        aria-label="Dismiss rotation prompt"
      >
        <i className="fas fa-times text-[10px]"></i>
      </button>
    </aside>
  );
}
