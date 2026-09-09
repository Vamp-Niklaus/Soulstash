import { useState, useEffect } from 'react';
import { getToken, getCurrentUsername, apiFetch, emitAuthChange } from '../api/client.js';

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

  // On mount, if user is logged in but avatar is missing from localStorage,
  // fetch their profile to hydrate the avatar into the stored user object.
  useEffect(() => {
    const token = getToken();
    const username = getCurrentUsername();
    if (!token || !username) return;

    let user = {};
    try {
      user = JSON.parse(localStorage.getItem('user') || '{}');
    } catch {}

    // If avatar is already set, no need to fetch
    if (user.avatar) return;

    apiFetch(`/api/user/profile/${encodeURIComponent(username)}`)
      .then((profile) => {
        if (profile && profile.avatar) {
          const updatedUser = { ...user, avatar: profile.avatar };
          localStorage.setItem('user', JSON.stringify(updatedUser));
          emitAuthChange();
        }
      })
      .catch(() => {
        // Silently ignore — profile fetch failed, avatar will stay default
      });
  }, []);

  return session;
}
