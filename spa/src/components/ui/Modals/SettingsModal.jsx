import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { ScreenOrientation } from '@capacitor/screen-orientation';
import { toast } from '../../../utils/toast.js';
import { useAuthSession } from '../../../hooks/useAuthSession.js';
import { clearAuthSession } from '../../../api/client.js';

export function SettingsModal({ open, onClose, layoutMode, setLayoutMode }) {
  const navigate = useNavigate();
  const auth = useAuthSession();
  const [rotationMode, setRotationMode] = useState(() => {
    return localStorage.getItem('ss_rotation_mode') || 'sensor';
  });
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null);
  const currentVersion = 'v1.1.0';

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  const handleLayoutChange = (mode) => {
    setLayoutMode(mode);
    localStorage.setItem('ss_ui_layout_mode', mode);
    window.dispatchEvent(new CustomEvent('soulstash:layout-mode-changed', { detail: { mode } }));
    toast(`Navigation layout set to ${mode.toUpperCase()}`);
  };

  const handleRotationChange = async (mode) => {
    setRotationMode(mode);
    localStorage.setItem('ss_rotation_mode', mode);

    if (Capacitor.isNativePlatform()) {
      try {
        if (mode === 'sensor') {
          await ScreenOrientation.unlock();
          toast('Auto-rotation enabled (Full Sensor)');
        } else if (mode === 'portrait') {
          await ScreenOrientation.lock({ orientation: 'portrait' });
          toast('Locked to Portrait');
        } else if (mode === 'landscape') {
          await ScreenOrientation.lock({ orientation: 'landscape' });
          toast('Locked to Landscape');
        }
      } catch (err) {
        console.warn('Orientation change error:', err);
      }
    } else {
      try {
        if (mode === 'sensor' && window.screen?.orientation?.unlock) {
          window.screen.orientation.unlock();
        } else if (window.screen?.orientation?.lock) {
          await window.screen.orientation.lock(mode);
        }
      } catch (err) {}
      toast(`Rotation set: ${mode}`);
    }
  };

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    setUpdateInfo(null);
    try {
      const res = await fetch('https://api.github.com/repos/Vamp-Niklaus/Soulstash/releases/latest', {
        headers: { Accept: 'application/vnd.github.v3+json' }
      });
      if (!res.ok) {
        throw new Error(`Status ${res.status}`);
      }
      const data = await res.json();
      const latestTag = data.tag_name || data.name || '';
      const isNewer = latestTag && latestTag.replace(/^v/, '') > currentVersion.replace(/^v/, '');
      setUpdateInfo({
        checked: true,
        isNewer,
        tagName: latestTag,
        htmlUrl: data.html_url || 'https://github.com/Vamp-Niklaus/Soulstash/releases/latest',
        publishedAt: data.published_at ? new Date(data.published_at).toLocaleDateString() : '',
        body: data.body || ''
      });
      if (isNewer) {
        toast(`New update available: ${latestTag}`, 'success');
      } else {
        toast('You are running the latest version!', 'success');
      }
    } catch (err) {
      setUpdateInfo({
        checked: true,
        error: true,
        htmlUrl: 'https://github.com/Vamp-Niklaus/Soulstash/releases/latest'
      });
      toast('Could not fetch release info, click to view releases', 'info');
    } finally {
      setCheckingUpdate(false);
    }
  };

  if (!open) return null;

  const content = (
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center p-4 select-none animate-in fade-in duration-200"
      style={{
        background: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(8px)'
      }}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md rounded-[24px] border border-white/10 bg-[#121418] p-5 sm:p-6 shadow-2xl text-white flex flex-col gap-5 max-h-[90vh] overflow-y-auto filter-scrollbar"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white">
              <i className="fas fa-sliders-h text-sm"></i>
            </div>
            <div>
              <h2 className="text-base font-bold text-white">App Settings</h2>
              <p className="text-[11px] text-white/50">Preferences &amp; Updates</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white/80 hover:bg-white/20 hover:text-white transition-colors"
          >
            <i className="fas fa-times text-xs"></i>
          </button>
        </div>

        {/* Section 1: Navigation Layout / UI Mode */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-white/80 uppercase tracking-wider">
              Navigation &amp; UI Mode
            </span>
            <span className="text-[10px] text-white/40">Auto shifts when rotated</span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            {[
              {
                id: 'auto',
                label: 'Auto Detect',
                desc: 'TV mode in landscape, Mobile in portrait',
                icon: 'fa-magic'
              },
              {
                id: 'tv',
                label: 'TV Mode',
                desc: 'Left vertical sidebar navbar',
                icon: 'fa-tv'
              },
              {
                id: 'desktop',
                label: 'Desktop Mode',
                desc: 'Top header navbar with dropdown',
                icon: 'fa-desktop'
              },
              {
                id: 'mobile',
                label: 'Mobile Mode',
                desc: 'Top search & bottom nav bar',
                icon: 'fa-mobile-alt'
              }
            ].map((item) => {
              const active = layoutMode === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleLayoutChange(item.id)}
                  className={`flex flex-col items-start gap-1 p-3 rounded-2xl border text-left transition-all ${
                    active
                      ? 'border-white bg-white/15 text-white font-bold shadow-md'
                      : 'border-white/5 bg-white/[0.04] text-white/70 hover:bg-white/[0.08] hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-1.5 w-full">
                    <i className={`fas ${item.icon} text-xs ${active ? 'text-amber-400' : 'text-white/50'}`}></i>
                    <span className="text-xs font-semibold">{item.label}</span>
                  </div>
                  <span className="text-[10px] font-normal text-white/50 leading-tight">
                    {item.desc}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Section 2: Mobile Screen Rotation Option */}
        <div className="flex flex-col gap-2 pt-2 border-t border-white/10">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-white/80 uppercase tracking-wider">
              Screen Rotation
            </span>
            <span className="text-[10px] text-white/40">Sensor &amp; Orientation</span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {[
              { id: 'sensor', label: 'Auto (Sensor)', icon: 'fa-sync-alt' },
              { id: 'portrait', label: 'Portrait', icon: 'fa-mobile-alt' },
              { id: 'landscape', label: 'Landscape', icon: 'fa-image' }
            ].map((rot) => {
              const active = rotationMode === rot.id;
              return (
                <button
                  key={rot.id}
                  type="button"
                  onClick={() => handleRotationChange(rot.id)}
                  className={`flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl border text-[11px] font-medium transition-all ${
                    active
                      ? 'border-white bg-white/20 text-white font-bold'
                      : 'border-white/5 bg-white/[0.04] text-white/70 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <i className={`fas ${rot.icon} text-[10px]`}></i>
                  <span>{rot.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Section 3: Check for Updates */}
        <div className="flex flex-col gap-2.5 pt-2 border-t border-white/10">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs font-semibold text-white/80 uppercase tracking-wider">
                Soulstash App Update
              </span>
              <p className="text-[11px] text-white/50">Current version: <span className="font-mono text-white/80">{currentVersion}</span></p>
            </div>
            <button
              type="button"
              disabled={checkingUpdate}
              onClick={handleCheckUpdate}
              className="inline-flex items-center gap-1.5 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 px-3 py-1.5 text-xs font-semibold text-white transition-all disabled:opacity-50"
            >
              <i className={`fas fa-cloud-download-alt text-xs ${checkingUpdate ? 'animate-bounce' : ''}`}></i>
              <span>{checkingUpdate ? 'Checking...' : 'Check Update'}</span>
            </button>
          </div>

          {updateInfo && (
            <div className="rounded-xl border border-white/10 bg-black/40 p-3 text-xs flex flex-col gap-2">
              {updateInfo.error ? (
                <div className="flex items-center justify-between">
                  <span className="text-white/70">Visit official GitHub release page:</span>
                  <a
                    href="https://github.com/Vamp-Niklaus/Soulstash/releases/latest"
                    target="_blank"
                    rel="noreferrer"
                    className="text-amber-400 font-semibold hover:underline"
                  >
                    View Releases &rarr;
                  </a>
                </div>
              ) : updateInfo.isNewer ? (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-emerald-400 font-semibold">
                    <span>New Version Available: {updateInfo.tagName}</span>
                    <span className="text-[10px] text-white/40">{updateInfo.publishedAt}</span>
                  </div>
                  <a
                    href={updateInfo.htmlUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-black font-bold py-1.5 text-xs transition-colors"
                  >
                    <i className="fas fa-download"></i>
                    <span>Download {updateInfo.tagName}</span>
                  </a>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-white/80">
                  <i className="fas fa-check-circle text-emerald-400"></i>
                  <span>You are running the latest version (<span className="font-mono text-white">{currentVersion}</span>)</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Section 4: Account Actions */}
        <div className="flex flex-col gap-2 pt-2 border-t border-white/10">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-white/80 uppercase tracking-wider">
              Account
            </span>
            <span className="text-[10px] text-white/40">
              {auth?.isLoggedIn ? `@${auth.username}` : 'Not Signed In'}
            </span>
          </div>

          {auth?.isLoggedIn ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  navigate(`/user/${auth.username}`);
                }}
                className="flex-1 inline-flex items-center justify-center gap-2 py-2 px-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-xs font-medium text-white transition-colors"
              >
                <i className="fas fa-user text-amber-400"></i>
                <span>My Profile</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  clearAuthSession();
                  onClose();
                  toast('Logged out successfully');
                  navigate('/login');
                }}
                className="inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border border-red-500/20 bg-red-500/10 hover:bg-red-500/20 text-xs font-medium text-red-400 transition-colors"
              >
                <i className="fas fa-sign-out-alt"></i>
                <span>Log Out</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  navigate('/login');
                }}
                className="flex-1 inline-flex items-center justify-center gap-2 py-2 px-3 rounded-xl border border-white/10 bg-white/10 hover:bg-white/20 text-xs font-semibold text-white transition-colors"
              >
                <i className="fas fa-sign-in-alt"></i>
                <span>Sign In</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  navigate('/register');
                }}
                className="flex-1 inline-flex items-center justify-center gap-2 py-2 px-3 rounded-xl border border-amber-400/40 bg-amber-400/15 hover:bg-amber-400/25 text-xs font-semibold text-amber-300 transition-colors"
              >
                <i className="fas fa-user-plus"></i>
                <span>Sign Up</span>
              </button>
            </div>
          )}
        </div>

        {/* Footer info link */}
        <div className="pt-2 border-t border-white/10 text-center text-[10px] text-white/40">
          Official Repository:{' '}
          <a
            href="https://github.com/Vamp-Niklaus/Soulstash/releases/latest"
            target="_blank"
            rel="noreferrer"
            className="text-white/60 hover:text-white underline ml-1"
          >
            github.com/Vamp-Niklaus/Soulstash
          </a>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined'
    ? createPortal(content, document.body)
    : null;
}
