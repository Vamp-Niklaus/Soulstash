import { useState, useEffect } from 'react';
import { apiFetch, getToken, getCurrentUsername } from '../api/client.js';

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
    let disposed = false;

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

      // Login/register responses intentionally stay small. Hydrate the complete
      // profile here so every layout (including the navbar and admin page) has
      // the same user data without requiring a visit to the profile route.
      if (token && username) {
        apiFetch(`/api/user/profile/${encodeURIComponent(username)}`)
          .then((profileResponse) => {
            const profile = profileResponse?.user || profileResponse;
            if (disposed || !profile) return;
            const current = (() => {
              try { return JSON.parse(localStorage.getItem('user') || '{}'); } catch { return {}; }
            })();
            const hydrated = { ...current, ...profile, username: profile.username || username };
            if (JSON.stringify(current) !== JSON.stringify(hydrated)) {
              localStorage.setItem('user', JSON.stringify(hydrated));
              setSession((previous) => ({ ...previous, user: hydrated, username: hydrated.username || username }));
            }
          })
          .catch(() => {
            // A profile request should not prevent the existing session from rendering.
          });
      }
    }

    window.addEventListener('storage', syncSession);
    window.addEventListener('soulstash:auth-changed', syncSession);
    // The navbar is not mounted on the login route, so it can miss the auth
    // event emitted during login. Always synchronize once when a consumer mounts.
    syncSession();
    return () => {
      window.removeEventListener('storage', syncSession);
      window.removeEventListener('soulstash:auth-changed', syncSession);
      disposed = true;
    };
  }, []);

  return session;
}
