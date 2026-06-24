import { useState, useEffect } from 'react';

export function useSessionState(key, initialValue) {
  const [state, setState] = useState(() => {
    try {
      const raw = sessionStorage.getItem(key);
      if (raw != null) {
        return JSON.parse(raw);
      }
    } catch {}
    return typeof initialValue === 'function' ? initialValue() : initialValue;
  });

  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(state));
    } catch {}
  }, [key, state]);

  return [state, setState];
}
