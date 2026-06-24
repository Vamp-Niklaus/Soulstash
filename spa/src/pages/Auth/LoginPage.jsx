import { saveAuthSession } from '../../api/client.js';
import { AuthPageSkeleton } from '../../components/ui/Skeletons/index.js';
import { useAuthSession } from '../../hooks/index.js';
import React, { useState, useEffect, useRef } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { toast } from '../../utils/toast.js';
import { FALLBACK_AUTH_POSTERS } from '../../utils/constants.js';

import { AuthPageLayout } from '../../components/ui/Auth/AuthPageLayout.jsx';

export function LoginPage() {
  const navigate = useNavigate();
  const { isLoggedIn } = useAuthSession();
  const [pageReady, setPageReady] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setPageReady(true);
  }, []);

  useEffect(() => {
    if (isLoggedIn) {
      navigate('/', { replace: true });
    }
  }, [isLoggedIn, navigate]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');

    if (!username.trim() || !password) {
      setError('Please enter username and password');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || 'Login failed');
      }

      saveAuthSession(payload.token, payload.user);
      if (window.CollectionStore?.invalidate) window.CollectionStore.invalidate();
      if (window.CollectionStore?.syncCollections) window.CollectionStore.syncCollections().catch(() => {});
      toast(payload.message || 'Login successful!', 'success');
      navigate('/', { replace: true });
    } catch (submitError) {
      setError(submitError.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  if (!pageReady) {
    return <AuthPageSkeleton />;
  }

  return (
    <AuthPageLayout
      title="Login"
      subtitle=""
      altLabel="New to Soulstash?"
      altAction="Create an account"
      altHref="/register"
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <label className="mb-2 block text-sm font-medium text-[#d7d7d7]">Username</label>
          <input
            className="h-11 w-full rounded-2xl border border-white/10 bg-[#181818] px-4 text-white outline-none transition-colors placeholder:text-[#6f6f6f] focus:border-white/20"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="Enter your username"
          />
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-[#d7d7d7]">Password</label>
            <button
              type="button"
              onClick={() => navigate('/forgot-password')}
              className="text-xs text-[#a0a0a0] hover:text-white transition-colors"
            >
              Forgot password?
            </button>
          </div>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              className="h-11 w-full rounded-2xl border border-white/10 bg-[#181818] pl-4 pr-11 text-white outline-none transition-colors placeholder:text-[#6f6f6f] focus:border-white/20"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your password"
            />
            <button
              type="button"
              className="absolute inset-y-0 right-3 flex items-center text-[#6f6f6f] hover:text-white transition-colors"
              onClick={() => setShowPassword(!showPassword)}
            >
              <i className={`fa-regular ${showPassword ? 'fa-eye-slash' : 'fa-eye'} text-[15px]`}></i>
            </button>
          </div>
        </div>
        {error ? <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div> : null}
        <button
          type="submit"
          disabled={loading}
          className="inline-flex h-11 w-full items-center justify-center rounded-full bg-white text-[15px] font-semibold text-black transition-colors hover:bg-[#e5e5e5] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? 'Signing in...' : 'Login'}
        </button>
      </form>
    </AuthPageLayout>
  );
}
