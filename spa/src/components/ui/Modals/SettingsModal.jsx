import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { check as checkTauriUpdate } from '@tauri-apps/plugin-updater';
import { AppLauncher } from '@capacitor/app-launcher';
import { openUrl } from '@tauri-apps/plugin-opener';
import { toast } from '../../../utils/toast.js';
import { useAuthSession } from '../../../hooks/useAuthSession.js';
import { clearAuthSession } from '../../../api/client.js';
import { clearAllWatchProgress } from '../../../utils/watchProgress.js';
import { clearSearchHistory } from '../../../utils/formatters.js';
import { useQueryClient } from '@tanstack/react-query';

// Native Android plugin (ApkUpdaterPlugin.java): downloads the APK and opens the installer.
const ApkUpdater = registerPlugin('ApkUpdater');

async function fetchLatestPublishedRelease(repository, assetExtension = '') {
  const response = await fetch(`https://api.github.com/repos/Vamp-Niklaus/${repository}/releases?per_page=20`, {
    headers: { Accept: 'application/vnd.github.v3+json' }
  });
  if (!response.ok) throw new Error(`GitHub release lookup failed (${response.status})`);
  const releases = await response.json();
  if (!Array.isArray(releases)) return null;
  const published = releases.filter((release) => !release.draft && !release.prerelease);
  if (!assetExtension) return published[0] || null;
  return published.find((release) =>
    Array.isArray(release.assets) && release.assets.some((asset) => asset.name?.toLowerCase().endsWith(assetExtension))
  ) || null;
}

export function SettingsModal({
  open,
  onClose,
  verticalPreference = 'auto',
  landscapePreference = 'auto',
  setVerticalPreference,
  setLandscapePreference,
  isVertical = false,
  isLandscape = true
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const auth = useAuthSession();
  const [apkDownloadInfo, setApkDownloadInfo] = useState(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [windowsExeInfo, setWindowsExeInfo] = useState(null);
  const [currentVersion, setCurrentVersion] = useState(
    typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'v4.2.11'
  );

  useEffect(() => {
    let cancelled = false;
    async function resolveAppVersion() {
      if (Capacitor.isNativePlatform()) {
        try {
          const info = await CapApp.getInfo();
          if (!cancelled && info?.version) {
            const formatted = info.version.startsWith('v') ? info.version : `v${info.version}`;
            setCurrentVersion(formatted);
            return;
          }
        } catch (err) {
          console.warn('Could not read native app version:', err);
        }
      }
      if (typeof __APP_VERSION__ !== 'undefined' && !cancelled) {
        setCurrentVersion(__APP_VERSION__);
      }
    }
    resolveAppVersion();
    return () => { cancelled = true; };
  }, []);
  const [installing, setInstalling] = useState(false);
  const [installProgress, setInstallProgress] = useState(null);
  const [cacheCleared, setCacheCleared] = useState(false);
  const tauriUpdateRef = useRef(null);

  const handleClearCache = () => {
    clearAllWatchProgress();
    clearSearchHistory();
    try {
      localStorage.removeItem('soulstash_search_history');
      localStorage.removeItem('ss_search_history');
      sessionStorage.clear();
      queryClient.clear();
    } catch (_) {}
    window.dispatchEvent(new CustomEvent('soulstash:search-cleared'));
    setCacheCleared(true);
    toast('Continue Watching, search history, and cache cleared successfully', 'success');
    setTimeout(() => setCacheCleared(false), 3000);
  };

  const isNative = Capacitor.isNativePlatform();
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

  const isPushedRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Back-button history trap: pressing back on Android or browser closes ONLY the Settings modal
  useEffect(() => {
    if (!open) return;

    if (!isPushedRef.current) {
      window.history.pushState({ settingsModalOpen: true }, '');
      isPushedRef.current = true;
    }

    const handlePopState = () => {
      isPushedRef.current = false;
      onCloseRef.current?.();
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onCloseRef.current?.();
      }
    };

    window.addEventListener('popstate', handlePopState);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('keydown', handleKeyDown);
      if (isPushedRef.current) {
        isPushedRef.current = false;
        if (window.history.state?.settingsModalOpen) {
          window.history.back();
        }
      }
    };
  }, [open]);

  // Resolve the latest Android APK and Windows EXE release assets.
  useEffect(() => {
    let cancelled = false;
    if (!open || isNative || isTauri) {
      return () => { cancelled = true; };
    }
    async function checkReleaseAssets() {
      try {
        const data = await Promise.all([
          fetchLatestPublishedRelease('Soulstash', '.apk'),
          fetchLatestPublishedRelease('soulstash-backend', '.exe')
        ]);
        const apk = data[0]?.assets?.find((asset) => asset.name?.toLowerCase().endsWith('.apk'));
        const exe = data[1]?.assets?.find((asset) => asset.name?.toLowerCase().endsWith('.exe'));
        if (cancelled) return;
        setApkDownloadInfo(apk ? { url: apk.browser_download_url, name: apk.name } : { available: false });
        setWindowsExeInfo(exe ? { available: true, url: exe.browser_download_url, name: exe.name, tagName: data[1].tag_name || data[1].name || '' } : { available: false });
      } catch (err) {
        if (!cancelled) { setApkDownloadInfo({ available: false }); setWindowsExeInfo({ available: false }); }
      }
    }
    checkReleaseAssets();
    return () => { cancelled = true; };
  }, [open, isNative, isTauri]);

  const compareVersions = (left, right) => {
    const parse = (value) => (value.match(/\d+(?:\.\d+)*/)?.[0] || '').split('.').map((part) => Number(part) || 0);
    const a = parse(left); const b = parse(right);
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
      if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0) ? 1 : -1;
    }
    return 0;
  };

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    setUpdateInfo(null);
    try {
      if (isTauri) {
        try {
          const update = await checkTauriUpdate();
          tauriUpdateRef.current = update || null;
          if (update) {
            setUpdateInfo({
              checked: true,
              isNewer: true,
              tagName: `v${update.version}`,
              downloadUrl: '',
              inApp: true,
              publishedAt: update.date ? new Date(update.date).toLocaleDateString() : '',
              body: update.body || '',
              assetExtension: '.exe'
            });
            toast(`New update available: v${update.version}`, 'success');
          } else {
            setUpdateInfo({ checked: true, isLatest: true, tagName: currentVersion, downloadUrl: '', assetExtension: '.exe' });
            toast(`You are running the latest version (${currentVersion})`, 'success');
          }
          return;
        } catch (err) {
          // latest.json missing or unreachable: fall back to the GitHub release lookup below.
          console.warn('Tauri updater check failed, falling back to release lookup:', err);
        }
      }
      const releaseRepo = isTauri ? 'soulstash-backend' : 'Soulstash';
      const assetExtension = isTauri ? '.exe' : '.apk';
      const data = await fetchLatestPublishedRelease(releaseRepo, assetExtension);
      if (!data) {
        setUpdateInfo({ checked: true, noRelease: true });
        toast(isTauri ? 'No Windows installer has been published yet.' : 'No Android package has been published yet.', 'info');
        return;
      }
      const latestTag = data.tag_name || data.name || '';
      const versionComparison = latestTag ? compareVersions(latestTag, currentVersion) : 0;
      const isNewer = versionComparison > 0;

      const apkAsset = Array.isArray(data.assets)
        ? data.assets.find((a) => a.name?.toLowerCase().endsWith(assetExtension))
        : null;
      const downloadUrl = apkAsset?.browser_download_url || '';

      setUpdateInfo({
        checked: true,
        isNewer,
        isLatest: versionComparison === 0,
        tagName: latestTag,
        downloadUrl,
        publishedAt: data.published_at ? new Date(data.published_at).toLocaleDateString() : '',
        body: data.body || '',
        assetExtension
      });
      if (isNewer) {
        toast(`New update available: ${latestTag}`, 'success');
      } else if (versionComparison === 0) {
        toast(`You are running the latest version (${currentVersion})`, 'success');
      } else {
        toast(`You are running ${currentVersion}, newer than the latest published release (${latestTag})`, 'success');
      }
    } catch (err) {
      setUpdateInfo({
        checked: true,
        error: true
      });
      toast('Could not fetch release info. Please try again.', 'info');
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleDownloadUrl = async (url) => {
    if (!url) return;
    toast('Starting download... Check your browser or downloads notification.', 'info');
    if (isTauri) {
      try { await openUrl(url); return; }
      catch (err) { console.warn('Could not open download in the system browser:', err); }
    }
    if (isNative) {
      try { await AppLauncher.openUrl({ url }); return; }
      catch (err) { console.warn('Could not open download in the system browser:', err); }
    }
    try {
      const a = document.createElement('a');
      a.href = url;
      a.rel = 'noopener noreferrer';
      a.setAttribute('download', '');
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (e) {
      window.location.href = url;
    }
  };

  const handleInstallUpdate = async () => {
    if (installing) return;
    setInstalling(true);
    setInstallProgress(0);
    let listener = null;
    try {
      if (isTauri) {
        const update = tauriUpdateRef.current;
        if (!update) throw new Error('No update is ready to install');
        let total = 0;
        let received = 0;
        await update.downloadAndInstall((event) => {
          if (event.event === 'Started') total = event.data?.contentLength || 0;
          else if (event.event === 'Progress') {
            received += event.data?.chunkLength || 0;
            if (total > 0) setInstallProgress(Math.min(100, Math.round((received * 100) / total)));
          } else if (event.event === 'Finished') setInstallProgress(100);
        });
        toast('Update installed. The app will restart.', 'success');
        return;
      }

      if (isNative) {
        const url = updateInfo?.downloadUrl;
        if (!url) throw new Error('No APK is attached to this release');
        listener = await ApkUpdater.addListener('downloadProgress', (p) => {
          if (typeof p?.percent === 'number') setInstallProgress(p.percent);
        });
        const result = await ApkUpdater.downloadAndInstall({ url, fileName: 'soulstash-update.apk' });
        if (result?.needsPermission) {
          toast('Allow "Install unknown apps" for Soulstash, then tap Update again.', 'info');
          await ApkUpdater.openInstallPermission();
        } else {
          toast('Tap Install in the Android prompt to finish updating.', 'success');
        }
      }
    } catch (err) {
      console.warn('In-app update failed:', err);
      toast('In-app update failed. Opening the download instead.', 'info');
      if (updateInfo?.downloadUrl) await handleDownloadUrl(updateInfo.downloadUrl);
    } finally {
      if (listener?.remove) listener.remove();
      setInstalling(false);
      setInstallProgress(null);
    }
  };

  const openExternalWebsite = async () => {
    const url = 'https://soulstash.onrender.com/';
    if (isTauri) {
      try { await openUrl(url); return; }
      catch (err) { console.warn('Could not open the system browser:', err); }
    }
    if (isNative) {
      try { await AppLauncher.openUrl({ url }); return; }
      catch (err) { console.warn('Could not open the system browser:', err); }
    }
    window.open(url, '_blank', 'noopener,noreferrer');
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
              <p className="text-[11px] text-white/50">Preferences &amp; Downloads</p>
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

        {/* Section 1: Navigation & UI Mode (6 Options based on device orientation) */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-white/80 uppercase tracking-wider">
              Navigation &amp; UI Mode
            </span>
            <span className="text-[10px] text-amber-400 font-medium px-2 py-0.5 rounded-full bg-amber-400/10 border border-amber-400/20">
              Current: {isVertical ? '📱 Vertical' : '🖥️ Landscape'}
            </span>
          </div>

          {/* 1A: Vertical Orientation Layout (3 options) */}
          <div className="flex flex-col gap-1.5 p-2.5 rounded-2xl bg-white/[0.02] border border-white/5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-white/70">
                Vertical / Portrait (Height &gt; Width)
              </span>
              {isVertical && <span className="text-[9px] text-emerald-400 font-bold uppercase tracking-wider">Active Now</span>}
            </div>
            <div className="grid grid-cols-3 gap-1.5 text-xs">
              {[
                { id: 'auto', label: 'Auto Detect', desc: 'Mobile or Tablet', icon: 'fa-magic' },
                { id: 'mobile', label: 'Mobile Mode', desc: 'Search & bottom nav', icon: 'fa-mobile-alt' },
                { id: 'desktop', label: 'Desktop Mode', desc: 'Top header navbar', icon: 'fa-desktop' }
              ].map((item) => {
                const active = verticalPreference === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      if (setVerticalPreference) setVerticalPreference(item.id);
                      toast(`Vertical layout set to ${item.label}`);
                    }}
                    className={`flex flex-col items-start gap-1 p-2 rounded-xl border text-left transition-all ${
                      active
                        ? 'border-amber-400 bg-amber-400/15 text-white font-bold shadow-md'
                        : 'border-white/5 bg-white/[0.03] text-white/70 hover:bg-white/[0.08] hover:text-white'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 w-full">
                      <i className={`fas ${item.icon} text-xs ${active ? 'text-amber-400' : 'text-white/40'}`}></i>
                      <span className="text-[11px] font-semibold leading-tight">{item.label}</span>
                    </div>
                    <span className="text-[9px] font-normal text-white/40 leading-tight">
                      {item.desc}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 1B: Landscape Orientation Layout (3 options) */}
          <div className="flex flex-col gap-1.5 p-2.5 rounded-2xl bg-white/[0.02] border border-white/5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-white/70">
                Landscape / Rotated / TV (Width &ge; Height)
              </span>
              {isLandscape && <span className="text-[9px] text-emerald-400 font-bold uppercase tracking-wider">Active Now</span>}
            </div>
            <div className="grid grid-cols-3 gap-1.5 text-xs">
              {[
                { id: 'auto', label: 'Auto Detect', desc: 'Desktop or Smart TV', icon: 'fa-magic' },
                { id: 'desktop', label: 'Desktop Mode', desc: 'Top header navbar', icon: 'fa-desktop' },
                { id: 'tv', label: 'TV Mode', desc: 'Left vertical sidebar', icon: 'fa-tv' }
              ].map((item) => {
                const active = landscapePreference === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      if (setLandscapePreference) setLandscapePreference(item.id);
                      toast(`Landscape layout set to ${item.label}`);
                    }}
                    className={`flex flex-col items-start gap-1 p-2 rounded-xl border text-left transition-all ${
                      active
                        ? 'border-amber-400 bg-amber-400/15 text-white font-bold shadow-md'
                        : 'border-white/5 bg-white/[0.03] text-white/70 hover:bg-white/[0.08] hover:text-white'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 w-full">
                      <i className={`fas ${item.icon} text-xs ${active ? 'text-amber-400' : 'text-white/40'}`}></i>
                      <span className="text-[11px] font-semibold leading-tight">{item.label}</span>
                    </div>
                    <span className="text-[9px] font-normal text-white/40 leading-tight">
                      {item.desc}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Section 3: App Updates (Native App) OR Download App (Website) */}
        {isNative || isTauri ? (
          <div className="flex flex-col gap-2.5 pt-2 border-t border-white/10">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-semibold text-white/80 uppercase tracking-wider">
                  Soulstash App Update
                </span>
                <p className="text-[11px] text-white/50">Current version: <span className="font-mono text-white/80">{currentVersion}</span></p>
              </div>
              <div className="flex items-center gap-2">
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
            </div>

            {updateInfo && (
              <div className="rounded-xl border border-white/10 bg-black/40 p-3 text-xs flex flex-col gap-2">
                {updateInfo.noRelease ? (
                  <div className="flex items-center justify-between text-amber-300">
                    <span>{isTauri ? 'Windows installer coming soon.' : 'No Android release is available yet.'}</span>
                  </div>
                ) : updateInfo.error ? (
                  <div className="flex items-center justify-between">
                    <span className="text-white/70">Could not check for updates. Please try again.</span>
                  </div>
                ) : updateInfo.isNewer ? (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between text-emerald-400 font-semibold">
                      <span>New Version Available: {updateInfo.tagName}</span>
                      <span className="text-[10px] text-white/40">{updateInfo.publishedAt}</span>
                    </div>
                    {updateInfo.downloadUrl || updateInfo.inApp ? (
                      <button type="button" disabled={installing} onClick={handleInstallUpdate} className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-60 text-black font-bold py-2.5 text-xs transition-colors shadow-lg active:scale-98 cursor-pointer">
                        <i className={`fas ${installing ? 'fa-spinner fa-spin' : 'fa-download'}`}></i><span>{installing ? (installProgress != null ? `Downloading... ${installProgress}%` : 'Preparing...') : 'Update Now'}</span>
                      </button>
                    ) : <p className="text-amber-300 text-center">No {isTauri ? 'EXE installer' : 'APK'} is attached to this release.</p>}
                    <p className="text-[10px] text-white/40 text-center leading-tight">{isTauri ? 'The update downloads and installs inside the app, then it restarts.' : 'The update downloads inside the app. Tap Install in the Android prompt to finish.'}</p>
                  </div>
                ) : updateInfo.isLatest ? (
                  <div className="flex items-center justify-between text-white/80 py-1">
                    <div className="flex items-center gap-2">
                      <i className="fas fa-check-circle text-emerald-400"></i>
                      <span>You are running the latest version (<span className="font-mono text-white">{currentVersion}</span>)</span>
                    </div>
                    {updateInfo.downloadUrl && <button type="button" onClick={() => handleDownloadUrl(updateInfo.downloadUrl)} className="text-[11px] text-amber-400 hover:underline font-medium">Re-download {isTauri ? 'installer' : 'APK'}</button>}
                  </div>
                ) : (
                  <div className="flex items-center justify-between text-white/80 py-1">
                    <span>The installed build ({currentVersion}) is newer than the latest release ({updateInfo.tagName}).</span>
                    {updateInfo.downloadUrl && <button type="button" onClick={() => handleDownloadUrl(updateInfo.downloadUrl)} className="text-[11px] text-amber-400 hover:underline font-medium">Download {isTauri ? 'installer' : 'APK'}</button>}
                  </div>
                )}
              </div>
            )}

            {/* Visit Website Link parallel to App info */}
            <div className="flex items-center justify-between pt-1 text-xs">
              <span className="text-[11px] text-white/50">Online web streaming:</span>
              <button type="button" data-tv-allow-popup onClick={openExternalWebsite} className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-3 py-1.5 text-xs font-semibold text-amber-400 transition-colors">
                <i className="fas fa-globe text-xs"></i>
                <span>Visit Website</span>
              </button>
            </div>
          </div>
        ) : (
          /* Web Browser View: Display Download App options for Android and Windows + Live Web status */
          <div className="flex flex-col gap-2.5 pt-2 border-t border-white/10 text-xs">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-semibold text-white/80 uppercase tracking-wider text-[11px]">
                  Download Soulstash App
                </span>
                <p className="text-[10px] text-white/40">Download the available app for your device</p>
              </div>

            </div>

            {/* Download Buttons: Android APK & Windows EXE */}
            <div className="grid grid-cols-2 gap-2 mt-1">
              {/* Android APK Download */}
              <button
                type="button"
                onClick={() => handleDownloadUrl(apkDownloadInfo?.url)}
                disabled={!apkDownloadInfo?.url}
                className="flex flex-col items-center justify-center gap-1 p-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-white transition-all text-center"
              >
                <div className="flex items-center gap-1.5 text-emerald-400 font-bold text-xs">
                  <i className="fab fa-android text-sm"></i>
                  <span>Android (APK)</span>
                </div>
                <span className="text-[10px] text-white/50">
                  {apkDownloadInfo === null ? 'Checking availability...' : apkDownloadInfo?.url ? 'Direct APK Download' : 'Unavailable'}
                </span>
              </button>

              {/* Windows EXE Download / Coming Soon */}
              {windowsExeInfo?.available ? (
                <button
                  type="button"
                  onClick={() => handleDownloadUrl(windowsExeInfo.url)}
                  className="flex flex-col items-center justify-center gap-1 p-2.5 rounded-xl border border-sky-500/30 bg-sky-500/10 hover:bg-sky-500/20 text-white transition-all text-center"
                >
                  <div className="flex items-center gap-1.5 text-sky-400 font-bold text-xs">
                    <i className="fab fa-windows text-sm"></i>
                    <span>Windows (.exe)</span>
                  </div>
                  <span className="text-[10px] text-white/50">Download App</span>
                </button>
              ) : (
                <div className="flex flex-col items-center justify-center gap-1 p-2.5 rounded-xl border border-white/5 bg-white/[0.03] text-white/40 text-center">
                  <div className="flex items-center gap-1.5 text-white/60 font-medium text-xs">
                    <i className="fab fa-windows text-sm text-white/40"></i>
                    <span>Windows (.exe)</span>
                  </div>
                  <span className="text-[9px] text-amber-400/70 font-semibold uppercase tracking-wider">Coming Soon</span>
                </div>
              )}
            </div>

            {/* Links info row */}
            <div className="flex items-center justify-between text-[10px] text-white/40 pt-1">
              <span>{apkDownloadInfo?.url ? 'Android APK available now' : 'Android APK unavailable'}</span>
              <span>{windowsExeInfo?.available ? `Windows ${windowsExeInfo.tagName || 'download available'}` : 'Windows download coming soon'}</span>
            </div>
          </div>
        )}

        {/* Section: Storage & Cache */}
        <div className="flex flex-col gap-2 pt-2 border-t border-white/10">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-white/80 uppercase tracking-wider">
              Storage & Cache
            </span>
            <span className="text-[10px] text-white/40">Continue Watching & Temp Data</span>
          </div>
          <div className="flex items-center justify-between p-2.5 rounded-xl bg-white/[0.02] border border-white/5">
            <div className="flex flex-col pr-2">
              <span className="text-xs font-medium text-white/80">Clear Continue Watching</span>
              <span className="text-[10px] text-white/40 leading-tight">Remove all saved continue movies and reset memory cache</span>
            </div>
            <button
              type="button"
              onClick={handleClearCache}
              className="inline-flex items-center gap-1.5 rounded-xl border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 active:scale-95 px-3 py-1.5 text-xs font-semibold text-red-300 transition-all cursor-pointer whitespace-nowrap"
            >
              <i className={`fas ${cacheCleared ? 'fa-check text-emerald-400' : 'fa-trash-alt'} text-xs`}></i>
              <span>{cacheCleared ? 'Cleared!' : 'Clear Cache'}</span>
            </button>
          </div>
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


      </div>
    </div>
  );

  return typeof document !== 'undefined'
    ? createPortal(content, document.body)
    : null;
}
