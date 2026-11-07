import { useEffect, useState } from 'react';

export function KartoonWatchModal({ title = '', subtitle = '', embedUrl, onClose }) {
  const [reloadKey, setReloadKey] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
    setReloadKey(0);
  }, [embedUrl]);

  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, []);

  if (!embedUrl) return null;

  return (
    <div className="fixed inset-0 z-[100010] flex items-center justify-center bg-black/95 p-2 sm:p-5" data-player-modal="true">
      <div className="flex w-full max-w-[1500px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#090909] shadow-2xl" style={{ height: 'min(92dvh, 900px)' }}>
        <div data-player-controls="true" className="flex h-12 shrink-0 items-center gap-3 border-b border-white/10 px-3 sm:px-4">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-white">{title || 'Kartoons Player'}</div>
            {subtitle ? <div className="truncate text-[11px] text-white/50">{subtitle}</div> : null}
          </div>
          <button
            type="button"
            data-player-action="true"
            onClick={() => { setLoaded(false); setReloadKey((key) => key + 1); }}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
            aria-label="Reload Kartoons player"
            title="Reload player"
          >
            <i className="fas fa-redo" />
          </button>
          <a
            data-player-action="true"
            href={embedUrl}
            target="_blank"
            rel="noreferrer"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
            aria-label="Open Kartoons player in browser"
            title="Open player in browser"
          >
            <i className="fas fa-external-link-alt" />
          </a>
          <button
            type="button"
            data-player-action="true"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
            aria-label="Close player"
            title="Close player"
          >
            <i className="fas fa-times" />
          </button>
        </div>
        <div className="relative min-h-0 flex-1 bg-black">
          {!loaded ? (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-black text-sm text-white/55" role="status">
              Loading Kartoons player…
            </div>
          ) : null}
          <iframe
            key={reloadKey}
            src={embedUrl}
            onLoad={() => setLoaded(true)}
            className="h-full w-full border-0 bg-black"
            allow="autoplay *; fullscreen *; encrypted-media *; picture-in-picture *"
            allowFullScreen
            title={title ? `${title} player` : 'Kartoons player'}
          />
        </div>
      </div>
    </div>
  );
}
