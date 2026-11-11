import { Capacitor } from '@capacitor/core';
import { ScreenOrientation } from '@capacitor/screen-orientation';

export const ROTATION_KEY = 'ss_rotation_mode';

// Android TV and Fire TV devices run the Android app but should default to landscape.
export function isTvDevice() {
  return /Android TV|AFT[A-Z]|BRAVIA|CrKey/i.test(navigator.userAgent || '');
}

// Phones and tablets running the native Android app: portrait by default.
export function isAndroidPhone() {
  return Capacitor.getPlatform() === 'android' && !isTvDevice();
}

export function defaultRotationMode() {
  return isAndroidPhone() ? 'portrait' : 'landscape';
}

export function getRotationMode() {
  return localStorage.getItem(ROTATION_KEY) || defaultRotationMode();
}

// Uses Capacitor's built-in ScreenOrientation API (Android's native orientation lock).
// 'sensor' releases the lock so the device follows its own rotation.
export async function applyRotationMode(mode) {
  if (!Capacitor.isNativePlatform()) return;
  try {
    if (mode === 'portrait' || mode === 'landscape') {
      await ScreenOrientation.lock({ orientation: mode });
    } else {
      await ScreenOrientation.unlock();
    }
  } catch (_) {
    // Orientation control can be unavailable on some devices; ignore.
  }
}
