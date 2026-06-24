import { useState, useEffect } from 'react';
import { getToken, getCurrentUsername } from '../api/client.js';

export function useAuthSession() {
  const [session, setSession] = useState(() => {
    const token = getToken();
    const username = getCurrentUsername();
    return {
      token,
      username,
      isLoggedIn: Boolean(token && username),
      user: (() => {
        try {
          return JSON.parse(localStorage.getItem('user') || '{}');
        } catch {
          return {};
        }
      })()
    };
  });

  useEffect(() => {
    function syncSession() {
      const token = getToken();
      const username = getCurrentUsername();
      let user = {};
      try {
        user = JSON.parse(localStorage.getItem('user') || '{}');
      } catch {}
      setSession({
        token,
        username,
        isLoggedIn: Boolean(token && username),
        user
      });
    }

    window.addEventListener('storage', syncSession);
    window.addEventListener('soulstash:auth-changed', syncSession);
    return () => {
      window.removeEventListener('storage', syncSession);
      window.removeEventListener('soulstash:auth-changed', syncSession);
    };
  }, []);

  return session;
}
