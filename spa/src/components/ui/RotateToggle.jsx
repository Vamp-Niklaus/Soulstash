import { useState } from 'react';
import { getRotationMode, applyRotationMode, isAndroidPhone, ROTATION_KEY } from '../../utils/rotation.js';

// Corner button on Android phones: the screen stays locked to portrait by default,
// and this button toggles the orientation lock between portrait and landscape.
export function RotateToggle() {
  const [mode, setMode] = useState(getRotationMode);

  if (!isAndroidPhone()) return null;

  const next = mode === 'landscape' ? 'portrait' : 'landscape';

  const handleClick = () => {
    localStorage.setItem(ROTATION_KEY, next);
    setMode(next);
    applyRotationMode(next);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={`Rotate to ${next}`}
      title={`Rotate to ${next}`}
      className="fixed right-4 z-[200] flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-white shadow-lg backdrop-blur focus:outline-none focus:ring-2 focus:ring-white"
      style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}
    >
      <i className="fas fa-sync-alt" aria-hidden="true"></i>
    </button>
  );
}
