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

// Native Android plugin (ApkUpdaterPlugin.java): downloads the APK and opens the installer.
const ApkUpdater = registerPlugin('ApkUpdater');

function compareVersions(left, right) {
  const parse = (value) => (String(value || '').match(/\d+(?:\.\d+)*/)?.[0] || '').split('.').map((part) => Number(part) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0) ? 1 : -1;
  }
  return 0;
}

async function fetchLatestPublishedRelease(repository, assetExtension = '') {
  const response = await fetch(`https://api.github.com/repos/Vamp-Niklaus/${repository}/releases?per_page=20`, {
    headers: { Accept: 'application/vnd.github.v3+json' }
  });
  if (!response.ok) throw new Error(`Release lookup failed (${response.status})`);
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
  const auth = useAuthSession();
  const bundledVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'v4.2.19';
  const [apkDownloadInfo, setApkDownloadInfo] = useState(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [windowsExeInfo, setWindowsExeInfo] = useState(null);
  const [currentVersion, setCurrentVersion] = useState(bundledVersion);
  const [installing, setInstalling] = useState(false);
  const [installProgress, setInstallProgress] = useState(null);
  const tauriUpdateRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    async function resolveAppVersion() {
      let resolved = bundledVersion;
      if (Capacitor.isNativePlatform()) {
        try {
          const info = await CapApp.getInfo();
          if (!cancelled && info?.version) {
            const nativeVer = info.version.startsWith('v') ? info.version : `v${info.version}`;
            if (compareVersions(nativeVer, resolved) >= 0) {
              resolved = nativeVer;
            }
          }
        } catch (err) {
          console.warn('Could not read native app version:', err);
        }
      }
      if (!cancelled) {
        setCurrentVersion(resolved);
      }
    }
    resolveAppVersion();
    return () => { cancelled = true; };
  }, [bundledVersion]);

  const isNative = Capacitor.isNativePlatform();
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

  const isPushedRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

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

  useEffect(() => {
    let cancelled = false;
    if (!open || isNative || isTauri) {
      return () => { cancelled = true; };
    }
    async function checkReleaseAssets() {
      try {
        const release = await fetchLatestPublishedRelease('Soulstash');
        const apk = release?.assets?.find((asset) => asset.name?.toLowerCase().endsWith('.apk'));
        const exe = release?.assets?.find((asset) => asset.name?.toLowerCase().endsWith('.exe'));
        if (cancelled) return;
        setApkDownloadInfo(apk ? { url: apk.browser_download_url, name: apk.name } : { available: false });
        setWindowsExeInfo(exe ? { available: true, url: exe.browser_download_url, name: exe.name, tagName: release?.tag_name || release?.name || '' } : { available: false });
      } catch {
        if (!cancelled) {
          setApkDownloadInfo({ available: false });
          setWindowsExeInfo({ available: false });
        }
      }
    }
    checkReleaseAssets();
    return () => { cancelled = true; };
  }, [open, isNative, isTauri]);

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
              assetExtension: '.exe'
            });
            toast(`Update v${update.version} available`, 'success');
          } else {
            setUpdateInfo({ checked: true, isLatest: true, tagName: currentVersion, downloadUrl: '', assetExtension: '.exe' });
            toast(`Up to date (${currentVersion})`, 'success');
          }
          return;
        } catch (err) {
          console.warn('Tauri updater check failed, falling back to release lookup:', err);
        }
      }

      const assetExtension = isTauri ? '.exe' : '.apk';
      const data = await fetchLatestPublishedRelease('Soulstash', assetExtension);
      if (!data) {
        setUpdateInfo({ checked: true, noRelease: true });
        toast('No release package found', 'info');
        return;
      }

      const latestTag = data.tag_name || data.name || '';
      const versionComparison = latestTag ? compareVersions(latestTag, currentVersion) : 0;
      const isNewer = versionComparison > 0;
      const asset = Array.isArray(data.assets)
        ? data.assets.find((a) => a.name?.toLowerCase().endsWith(assetExtension))
        : null;

      setUpdateInfo({
        checked: true,
        isNewer,
        isLatest: versionComparison === 0,
        tagName: latestTag,
        downloadUrl: asset?.browser_download_url || '',
        assetExtension
      });

      if (isNewer) {
        toast(`Update ${latestTag} available`, 'success');
      } else {
        toast(`Up to date (${currentVersion})`, 'success');
      }
    } catch {
      setUpdateInfo({ checked: true, error: true });
      toast('Could not check updates', 'info');
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleDownloadUrl = async (url) => {
    if (!url) return;
    toast('Starting download', 'info');
    if (isTauri) {
      try { await openUrl(url); return; } catch {}
    }
    if (isNative) {
      try { await AppLauncher.openUrl({ url }); return; } catch {}
    }
    try {
      const a = document.createElement('a');
      a.href = url;
      a.rel = 'noopener noreferrer';
      a.setAttribute('download', '');
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch {
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
        if (!update) throw new Error('No update ready');
        let total = 0;
        let received = 0;
        await update.downloadAndInstall((event) => {
          if (event.event === 'Started') total = event.data?.contentLength || 0;
          else if (event.event === 'Progress') {
            received += event.data?.chunkLength || 0;
            if (total > 0) setInstallProgress(Math.min(100, Math.round((received * 100) / total)));
          } else if (event.event === 'Finished') setInstallProgress(100);
        });
        toast('Update installed. Restarting...', 'success');
        return;
      }

      if (isNative) {
        const url = updateInfo?.downloadUrl;
        if (!url) throw new Error('No APK found');
        listener = await ApkUpdater.addListener('downloadProgress', (p) => {
          if (typeof p?.percent === 'number') setInstallProgress(p.percent);
        });
        const result = await ApkUpdater.downloadAndInstall({ url, fileName: 'soulstash-update.apk' });
        if (result?.needsPermission) {
          toast('Allow "Install unknown apps", then retry.', 'info');
          await ApkUpdater.openInstallPermission();
        } else {
          toast('Confirm install on prompt.', 'success');
        }
      }
    } catch {
      toast('Opening browser download instead', 'info');
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
      try { await openUrl(url); return; } catch {}
    }
    if (isNative) {
      try { await AppLauncher.openUrl({ url }); return; } catch {}
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  if (!open) return null;

  const content = (
    <div
      data-open-modal="true"
      className="fixed inset-0 z-[99999] flex items-center justify-center p-4 select-none bg-black/75 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="relative w-full max-w-[400px] rounded-[22px] border border-white/[0.08] bg-[#101114] p-5 text-white shadow-[0_24px_64px_rgba(0,0,0,0.65)] flex flex-col gap-5 max-h-[88vh] overflow-y-auto filter-scrollbar"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <h2 className="text-[17px] font-semibold tracking-tight text-white">Settings</h2>
            <span className="rounded-md bg-white/[0.06] px-2 py-0.5 font-mono text-[11px] text-white/55">
              {currentVersion}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.06] text-white/70 hover:bg-white/[0.12] hover:text-white transition-colors"
          >
            <i className="fas fa-times text-xs"></i>
          </button>
        </div>

        {/* Layout */}
        <section className="flex flex-col gap-3">
          <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/45">
            Layout
          </span>

          {/* Portrait */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-white/80 font-medium">Portrait</span>
              {isVertical && (
                <span className="text-[10px] text-white/45">Active</span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-1 rounded-xl bg-white/[0.04] p-1 border border-white/[0.05]">
              {[
                { id: 'auto', label: 'Auto' },
                { id: 'mobile', label: 'Mobile' },
                { id: 'desktop', label: 'Desktop' }
              ].map((item) => {
                const active = verticalPreference === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      if (setVerticalPreference) setVerticalPreference(item.id);
                      toast(`Portrait: ${item.label}`);
                    }}
                    className={`rounded-lg py-1.5 text-xs font-medium transition-colors ${
                      active
                        ? 'bg-white text-black'
                        : 'text-white/60 hover:text-white'
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Landscape */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-white/80 font-medium">Landscape</span>
              {isLandscape && (
                <span className="text-[10px] text-white/45">Active</span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-1 rounded-xl bg-white/[0.04] p-1 border border-white/[0.05]">
              {[
                { id: 'auto', label: 'Auto' },
                { id: 'desktop', label: 'Desktop' },
                { id: 'tv', label: 'TV' }
              ].map((item) => {
                const active = landscapePreference === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      if (setLandscapePreference) setLandscapePreference(item.id);
                      toast(`Landscape: ${item.label}`);
                    }}
                    className={`rounded-lg py-1.5 text-xs font-medium transition-colors ${
                      active
                        ? 'bg-white text-black'
                        : 'text-white/60 hover:text-white'
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <div className="h-px bg-white/[0.07]" />

        {/* Updates (Native/Desktop) OR Apps (Web) */}
        {isNative || isTauri ? (
          <section className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/45">
                App
              </span>
              <button
                type="button"
                onClick={openExternalWebsite}
                className="text-xs text-white/55 hover:text-white transition-colors"
              >
                Web app ↗
              </button>
            </div>

            <div className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.03] px-3.5 py-2.5">
              <div className="flex items-center gap-2 text-xs">
                <span className="text-white/60">Installed</span>
                <span className="font-mono font-medium text-white">{currentVersion}</span>
              </div>
              <button
                type="button"
                disabled={checkingUpdate}
                onClick={handleCheckUpdate}
                className="rounded-lg bg-white/[0.08] hover:bg-white/[0.15] px-3 py-1.5 text-xs font-medium text-white transition-colors disabled:opacity-50"
              >
                {checkingUpdate ? 'Checking...' : 'Check updates'}
              </button>
            </div>

            {updateInfo && (
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-3.5 py-2.5 text-xs flex items-center justify-between gap-3">
                {updateInfo.noRelease ? (
                  <span className="text-white/60">No release found.</span>
                ) : updateInfo.error ? (
                  <span className="text-white/60">Could not reach update server.</span>
                ) : updateInfo.isNewer ? (
                  <>
                    <span className="text-white font-medium">{updateInfo.tagName} available</span>
                    {updateInfo.downloadUrl || updateInfo.inApp ? (
                      <button
                        type="button"
                        disabled={installing}
                        onClick={handleInstallUpdate}
                        className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-black hover:bg-white/90 transition-colors disabled:opacity-60"
                      >
                        {installing
                          ? (installProgress != null ? `${installProgress}%` : 'Installing...')
                          : 'Update'}
                      </button>
                    ) : null}
                  </>
                ) : (
                  <>
                    <span className="text-white/70">Up to date ({currentVersion})</span>
                    {updateInfo.downloadUrl && (
                      <button
                        type="button"
                        onClick={() => handleDownloadUrl(updateInfo.downloadUrl)}
                        className="text-white/55 hover:text-white underline underline-offset-2"
                      >
                        Download
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </section>
        ) : (
          <section className="flex flex-col gap-2.5">
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/45">
              Apps
            </span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleDownloadUrl(apkDownloadInfo?.url)}
                disabled={!apkDownloadInfo?.url}
                className="flex items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] hover:bg-white/[0.09] disabled:opacity-40 py-2.5 px-3 text-xs font-medium text-white transition-colors"
              >
                <i className="fab fa-android text-sm text-white/75"></i>
                <span>{apkDownloadInfo === null ? 'Android...' : 'Android APK'}</span>
              </button>

              {windowsExeInfo?.available ? (
                <button
                  type="button"
                  onClick={() => handleDownloadUrl(windowsExeInfo.url)}
                  className="flex items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] hover:bg-white/[0.09] py-2.5 px-3 text-xs font-medium text-white transition-colors"
                >
                  <i className="fab fa-windows text-sm text-white/75"></i>
                  <span>Windows</span>
                </button>
              ) : (
                <div className="flex items-center justify-center gap-2 rounded-xl border border-white/[0.05] bg-white/[0.02] py-2.5 px-3 text-xs text-white/35">
                  <i className="fab fa-windows text-sm"></i>
                  <span>Windows (Soon)</span>
                </div>
              )}
            </div>
          </section>
        )}

        <div className="h-px bg-white/[0.07]" />

        {/* Account */}
        <section className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/45">
              Account
            </span>
            <span className="text-xs text-white/55">
              {auth?.isLoggedIn ? `@${auth.username}` : 'Guest'}
            </span>
          </div>

          {auth?.isLoggedIn ? (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  navigate(`/user/${auth.username}`);
                }}
                className="flex items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] hover:bg-white/[0.09] py-2 text-xs font-medium text-white transition-colors"
              >
                <i className="fas fa-user text-[11px] text-white/70"></i>
                <span>Profile</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  clearAuthSession();
                  onClose();
                  toast('Signed out');
                  navigate('/login');
                }}
                className="flex items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] hover:bg-red-500/15 hover:text-red-300 hover:border-red-500/25 py-2 text-xs font-medium text-white/75 transition-colors"
              >
                <i className="fas fa-sign-out-alt text-[11px]"></i>
                <span>Sign out</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  navigate('/login');
                }}
                className="flex items-center justify-center rounded-xl bg-white py-2 text-xs font-semibold text-black hover:bg-white/90 transition-colors"
              >
                Sign in
              </button>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  navigate('/register');
                }}
                className="flex items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] hover:bg-white/[0.09] py-2 text-xs font-medium text-white transition-colors"
              >
                Create account
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );

  return typeof document !== 'undefined'
    ? createPortal(content, document.body)
    : null;
}
