import React, { useState, useEffect, useRef } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { AppLauncher } from '@capacitor/app-launcher';
import { openUrl } from '@tauri-apps/plugin-opener';
import { toast } from '../../../utils/toast.js';

const STORAGE_KEY = 'soulstash_update_notification';
const REPO = 'Vamp-Niklaus/Soulstash';

const ApkUpdater = registerPlugin('ApkUpdater');

export function compareVersions(left, right) {
  const parse = (v) => (String(v || '').match(/\d+(?:\.\d+)*/)?.[0] || '').split('.').map((n) => Number(n) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const aVal = a[i] || 0;
    const bVal = b[i] || 0;
    if (aVal > bVal) return 1;
    if (aVal < bVal) return -1;
  }
  return 0;
}

export function isNewerVersion(remote, current) {
  return compareVersions(remote, current) > 0;
}

export function UpdateNotificationModal() {
  const [updateData, setUpdateData] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installProgress, setInstallProgress] = useState(0);
  const updateBtnRef = useRef(null);

  // 1. On Mount: check local table/cache immediately (fast, local, no network freeze)
  useEffect(() => {
    let cancelled = false;

    async function checkLocalNotification() {
      let currentVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'v4.2.18';
      if (Capacitor.isNativePlatform()) {
        try {
          const info = await CapApp.getInfo();
          if (info?.version) {
            const nativeVer = info.version.startsWith('v') ? info.version : `v${info.version}`;
            if (compareVersions(nativeVer, currentVersion) > 0) {
              currentVersion = nativeVer;
            }
          }
        } catch (_) {}
      }

      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const entry = JSON.parse(raw);
          // Check if we have a recorded update that user hasn't been notified of yet,
          // and that is still newer than the currently running build
          if (entry && !entry.notified && isNewerVersion(entry.version, currentVersion)) {
            if (!cancelled) {
              setUpdateData(entry);
              setShowModal(true);
            }
          }
        }
      } catch (_) {}

      // 2. Run silent background check after delay (doesn't block frontend/startup)
      const bgTimer = setTimeout(() => {
        if (!cancelled) {
          runSilentUpdateCheck(currentVersion);
        }
      }, 3500);

      return () => clearTimeout(bgTimer);
    }

    checkLocalNotification();

    return () => {
      cancelled = true;
    };
  }, []);

  // Autofocus the update button when modal opens for smooth accessibility / TV remote
  useEffect(() => {
    if (showModal && updateBtnRef.current) {
      updateBtnRef.current.focus();
    }
  }, [showModal]);

  // Handle Escape key
  useEffect(() => {
    if (!showModal) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleDismiss();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showModal, updateData]);

  // Silent background check: updates the local storage table for the next app launch
  const runSilentUpdateCheck = async (currentVer) => {
    try {
      const response = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=5`, {
        headers: { Accept: 'application/vnd.github.v3+json' }
      });
      if (!response.ok) return;
      const releases = await response.json();
      if (!Array.isArray(releases) || !releases.length) return;

      const published = releases.filter((r) => !r.draft && !r.prerelease);
      const latest = published[0];
      if (!latest) return;

      const latestTag = latest.tag_name || latest.name || '';
      if (!isNewerVersion(latestTag, currentVer)) {
        // App is up to date or newer; clear any stale cached notification
        localStorage.removeItem(STORAGE_KEY);
        return;
      }

      // Check current entry in table
      let existing = null;
      try {
        existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      } catch (_) {}

      const apkAsset = latest.assets?.find((a) => a.name?.toLowerCase().endsWith('.apk'));
      const exeAsset = latest.assets?.find((a) => a.name?.toLowerCase().endsWith('.exe'));

      const isNative = Capacitor.isNativePlatform();
      const isTauri = typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__);
      const targetUrl = isNative
        ? (apkAsset?.browser_download_url || latest.html_url)
        : isTauri
          ? (exeAsset?.browser_download_url || latest.html_url)
          : latest.html_url;

      // If this is a brand new release that wasn't recorded, store it with notified: false
      // If the user already dismissed THIS exact release version, preserve their notified: true status
      if (!existing || existing.version !== latestTag) {
        const newRecord = {
          version: latestTag,
          notified: false,
          releaseName: latest.name || latestTag,
          releaseNotes: latest.body || '',
          publishedAt: latest.published_at || '',
          apkUrl: apkAsset?.browser_download_url || '',
          exeUrl: exeAsset?.browser_download_url || '',
          downloadUrl: targetUrl
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(newRecord));
      }
    } catch (err) {
      console.debug('[UpdateNotifier] Background check silent failure:', err?.message);
    }
  };

  const handleDismiss = () => {
    setShowModal(false);
    // Mark as notified in the local table so user is NOT disturbed on every subsequent startup
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const entry = JSON.parse(raw);
        entry.notified = true;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
      }
    } catch (_) {}
  };

  const handleUpdate = async () => {
    if (installing) return;
    const isNative = Capacitor.isNativePlatform();
    const isTauri = typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__);
    const url = updateData?.downloadUrl || updateData?.apkUrl || updateData?.exeUrl;

    if (!url) {
      handleDismiss();
      return;
    }

    // Mark as notified immediately
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const entry = JSON.parse(raw);
        entry.notified = true;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
      }
    } catch (_) {}

    // 1. Android Native Updater
    if (isNative) {
      const apkUrl = updateData?.apkUrl || url;
      setInstalling(true);
      setInstallProgress(0);
      let listener = null;
      try {
        listener = await ApkUpdater.addListener('downloadProgress', (p) => {
          if (typeof p?.percent === 'number') setInstallProgress(p.percent);
        });
        const result = await ApkUpdater.downloadAndInstall({ url: apkUrl, fileName: 'soulstash-update.apk' });
        if (result?.needsPermission) {
          toast('Allow "Install unknown apps" for Soulstash, then tap Update again.', 'info');
          await ApkUpdater.openInstallPermission();
        } else {
          toast('Tap Install in the Android prompt to finish updating.', 'success');
          setShowModal(false);
        }
      } catch (err) {
        console.warn('In-app APK install failed, opening browser download fallback:', err);
        try {
          await AppLauncher.openUrl({ url: apkUrl });
        } catch (_) {
          window.open(apkUrl, '_blank');
        }
        setShowModal(false);
      } finally {
        if (listener && typeof listener.remove === 'function') {
          listener.remove();
        }
        setInstalling(false);
      }
      return;
    }

    // 2. Windows Desktop (Tauri)
    if (isTauri) {
      try {
        await openUrl(url);
      } catch (_) {
        window.open(url, '_blank');
      }
      setShowModal(false);
      return;
    }

    // 3. Web Browser
    window.open(url, '_blank');
    setShowModal(false);
  };

  if (!showModal || !updateData) return null;

  return (
    <div
      data-open-modal="true"
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 transition-all duration-300 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-modal-title"
    >
      <div className="relative w-full max-w-sm rounded-2xl border border-white/10 bg-[#16161a] p-6 shadow-2xl text-white text-center">
        {/* Dismiss Close Icon */}
        {!installing && (
          <button
            type="button"
            onClick={handleDismiss}
            className="absolute top-3.5 right-3.5 p-1 text-white/40 hover:text-white transition-colors rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
            aria-label="Close update notification"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}

        {/* Header Icon */}
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-tr from-amber-500/20 to-amber-400/10 border border-amber-500/30 text-amber-400 shadow-inner">
          <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        </div>

        {/* Title */}
        <h3 id="update-modal-title" className="text-lg font-bold text-white tracking-tight">
          New Version Available!
        </h3>

        {/* Version Badge */}
        <div className="mt-2 flex items-center justify-center gap-1.5">
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-400/15 text-amber-300 border border-amber-400/25">
            <i className="fas fa-sparkles text-[10px]"></i>
            {updateData.version}
          </span>
        </div>

        <p className="mt-3 text-xs leading-relaxed text-white/60">
          A new update for Soulstash is available. Update now to enjoy the latest performance improvements, UI refinements, and fixes.
        </p>

        {/* Download progress if installing */}
        {installing && (
          <div className="mt-4 space-y-2">
            <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full bg-gradient-to-r from-amber-500 to-emerald-400 transition-all duration-300"
                style={{ width: `${installProgress}%` }}
              />
            </div>
            <p className="text-[11px] font-medium text-amber-300">
              Downloading update... {installProgress}%
            </p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="mt-6 flex flex-col gap-2.5">
          <button
            ref={updateBtnRef}
            type="button"
            disabled={installing}
            onClick={handleUpdate}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-400 px-4 py-2.5 text-xs font-bold text-black shadow-lg shadow-amber-500/20 hover:brightness-110 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-amber-400"
          >
            {installing ? (
              <>
                <i className="fas fa-spinner fa-spin text-xs"></i>
                <span>Installing...</span>
              </>
            ) : (
              <>
                <i className="fas fa-cloud-arrow-down text-xs"></i>
                <span>Update Now</span>
              </>
            )}
          </button>

          {!installing && (
            <button
              type="button"
              onClick={handleDismiss}
              className="w-full py-2 text-xs font-semibold text-white/50 hover:text-white/80 transition-colors focus:outline-none"
            >
              Maybe Later
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
