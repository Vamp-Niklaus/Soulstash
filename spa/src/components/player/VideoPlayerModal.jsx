import { setNativeScale } from '../../utils/formatters.js';
import { useCallback, useMemo } from 'react';
import { SESSION_SCRAPED } from '../../utils/constants.js';
import { isDirectMediaUrl } from '../../utils/formatters.js';
import { Capacitor } from '@capacitor/core';
import React, { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from '../../utils/toast.js';
import { apiFetch } from '../../api/client.js';
import { ActionButton } from '../ui/ActionButton.jsx';

// Assume PlayerErrorBoundary is imported
import { PlayerErrorBoundary } from './PlayerErrorBoundary.jsx';

// Assume buildPlayerSourceSlots is imported
import { buildPlayerSourceSlots, firstPlayableUrl, sourceKeyText } from '../../utils/playerUtils.js';

export function VideoPlayerModal({ request, onClose }) {
  if (!request?.tmdbId) return null;
  const [hindiSources, setHindiSources] = useState([]);
  const [animeSources, setAnimeSources] = useState([]);
  const [activeUrl, setActiveUrl] = useState('');
  const [sourceSignature, setSourceSignature] = useState('');
  const [failedUrls, setFailedUrls] = useState(() => new Set());
  const [verifiedUrls, setVerifiedUrls] = useState(() => new Set());
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [draggingPlayer, setDraggingPlayer] = useState(false);
  const [iframeReloadKey, setIframeReloadKey] = useState(0);
  const [scale, setScale] = useState(1.0);
  const iframeRef = useRef(null);
  const scrollContainerRef = useRef(null);
  
  const playerBoxRef = useRef(null);
  const dragStateRef = useRef(null);
  const isDesktopViewport = typeof window !== 'undefined' ? window.innerWidth >= 768 : true;
  const isAndroidViewport = !isDesktopViewport;
  const modalPadding = 16;
  const controlsHeight = 52;
  const verticalInset = isDesktopViewport ? 10 : 36;
  const chromeAllowance = isDesktopViewport ? 112 : 112;
  const widthLimit = isDesktopViewport ? '99vw' : '96vw';
  const maxPlayerWidth = isDesktopViewport ? '1760px' : '1400px';
  const fallbackSources = Array.isArray(request?.fallbackSources)
    ? request.fallbackSources.filter((source) => source?.url)
    : [];

  useEffect(() => {
    setHindiSources([]);
    setAnimeSources([]);
    setActiveUrl('');
    setSourceSignature('');
    setFailedUrls(new Set());
    setVerifiedUrls(new Set());
    setIframeReloadKey(0);
    setDragOffset({ x: 0, y: 0 });
    setDraggingPlayer(false);
    dragStateRef.current = null;
    setScale(1.0);
    setNativeScale(1.0);
  }, [request]);

  // Anime / AniList / MultiNime Resolution
  useEffect(() => {
    if (!request?.title) return;
    const ep = request.episodeNumber || 1;
    const cleanTitle = String(request.title).replace(/\s+/g, ' ').trim();
    const slug = cleanTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    const fetchAnime = async () => {
      try {
        const query = `
          query ($search: String) {
            Page(page: 1, perPage: 5) {
              media(search: $search, type: ANIME) {
                id
                idMal
                title { romaji english native }
                format
                episodes
              }
            }
          }
        `;
        const res = await fetch('https://graphql.anilist.co', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ query, variables: { search: cleanTitle } })
        });
        const data = await res.json();
        const mediaList = data?.data?.Page?.media || [];
        if (!mediaList.length) return;

        const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const target = norm(cleanTitle);
        const match = mediaList.find(m => 
          norm(m.title.english) === target || norm(m.title.romaji) === target
        ) || mediaList[0];

        const anilistId = match.id;
        const malId = match.idMal || match.id;

        console.log(`***************${cleanTitle} / tmdb: ${request.tmdbId}, anilist :${anilistId}**************`);

        const directAnime = [
          {
            id: 'megaplay',
            key: 'megaplay',
            label: 'MegaPlay',
            url: `https://megaplay.buzz/stream/ani/${anilistId}/${ep}/sub`,
            embeddable: true
          },
          {
            id: 'vidhawk',
            key: 'vidhawk',
            label: 'VidHawk',
            url: `https://vidhawk.buzz/embed/ani/${anilistId}/${ep}/sub`,
            embeddable: true
          },
          {
            id: 'gogo-server',
            key: 'gogo-server',
            label: 'Gogo Server',
            url: `https://gogoanime.me.uk/newplayer.php?mal_id=${malId}&ep=${ep}&category=sub`,
            embeddable: true
          },
          {
            id: 'tryembed',
            key: 'tryembed',
            label: 'TryEmbed',
            url: `https://tryembed.us.cc/embed/anime/${anilistId}/${ep}/sub`,
            embeddable: true
          },
          {
            id: 'vidstreaming',
            key: 'vidstreaming',
            label: 'Vidstreaming',
            url: `https://vidsrc.me/embed/anime?id=${anilistId}&ep=${ep}`,
            embeddable: true
          }
        ];

        setAnimeSources(directAnime);

        // Fetch MultiNime watch page for FlixCloud mirrors
        try {
          const mnRes = await fetch(`https://multinime.site/watch.php?slug=${slug}&ep=${ep}&lang=sub&aid=${anilistId}`);
          if (mnRes.ok) {
            const html = await mnRes.text();
            const btnMatches = [...html.matchAll(/<button[^>]*class=["'][^"']*server-btn[^"']*["'][^>]*data-src=["']([^"']+)["'][^>]*>([\s\S]*?)<\/button>/gi)];
            const scraped = btnMatches.map((m, idx) => {
              const label = m[2].replace(/<[^>]+>/g, '').trim();
              const url = m[1].replace(/&amp;/g, '&');
              const isFlix = /flixcloud/i.test(label);
              return {
                id: isFlix ? (label.includes('2') ? 'flixcloud-2' : 'flixcloud-1') : `multinime-${idx}`,
                key: isFlix ? (label.includes('2') ? 'flixcloud-2' : 'flixcloud-1') : `multinime-${idx}`,
                label,
                url,
                embeddable: true
              };
            }).filter(s => s.url);

            if (scraped.length) {
              setAnimeSources((prev) => {
                const combined = [...scraped, ...prev];
                const seen = new Set();
                return combined.filter(s => {
                  if (seen.has(s.url)) return false;
                  seen.add(s.url);
                  return true;
                });
              });
            }
          }
        } catch (mnErr) {
          // MultiNime scrape fallback
        }
      } catch (err) {
        console.warn('[Soulstash Player] AniList lookup failed:', err.message);
      }
    };

    fetchAnime();
  }, [request]);

  useEffect(() => {
    return () => {
      setNativeScale(1.0); // Reset scale on unmount
    };
  }, []);

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const previousHtmlOverflow = html.style.overflow;
    const previousBodyOverflow = body.style.overflow;
    const previousBodyOverscroll = body.style.overscrollBehavior;
    const previousHtmlOverscroll = html.style.overscrollBehavior;

    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    html.style.overscrollBehavior = 'none';
    body.style.overscrollBehavior = 'none';

    const preventPageScroll = (event) => {
      const modal = playerBoxRef.current?.closest('[data-player-modal]');
      if (!modal) return;
      if (event.target?.closest?.('[data-player-modal]')) return;
      event.preventDefault();
    };

    window.addEventListener('wheel', preventPageScroll, { passive: false, capture: true });
    window.addEventListener('touchmove', preventPageScroll, { passive: false, capture: true });

    return () => {
      html.style.overflow = previousHtmlOverflow;
      body.style.overflow = previousBodyOverflow;
      html.style.overscrollBehavior = previousHtmlOverscroll;
      body.style.overscrollBehavior = previousBodyOverscroll;
      window.removeEventListener('wheel', preventPageScroll, { capture: true });
      window.removeEventListener('touchmove', preventPageScroll, { capture: true });
    };
  }, []);

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!window.history.state || !window.history.state.playerOpen) {
      window.history.pushState({ playerOpen: true }, '');
    }

    const handlePopState = () => {
      // If we are in fullscreen, the back button should ONLY exit fullscreen
      if (document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement) {
        if (document.exitFullscreen) document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        else if (document.mozCancelFullScreen) document.mozCancelFullScreen();
        else if (document.msExitFullscreen) document.msExitFullscreen();
        
        // Push the state back so the next back press closes the modal
        window.history.pushState({ playerOpen: true }, '');
      } else {
        // Otherwise, close the modal
        if (onCloseRef.current) onCloseRef.current();
      }
    };

    window.addEventListener('popstate', handlePopState);
    
    return () => {
      window.removeEventListener('popstate', handlePopState);
      // We explicitly DO NOT call history.back() here to avoid StrictMode bugs.
      // History cleanup is handled by handleCloseClick instead.
    };
  }, []);

  const handleCloseClick = () => {
    if (window.history.state && window.history.state.playerOpen) {
      window.history.back();
    } else {
      if (onCloseRef.current) onCloseRef.current();
    }
  };

  const handleToggleZoom = () => {
    setScale((prev) => {
      const next = prev === 1.0 ? 1.15 : prev === 1.15 ? 1.3 : 1.0;
      setNativeScale(next); // Sync to Android native fullscreen
      return next;
    });
  };

  const getZoomLabel = () => {
    if (scale === 1.0) return 'Zoom: Fit';
    if (scale === 1.15) return 'Zoom: Fill';
    return 'Zoom: Crop';
  };

  useEffect(() => {
    const handleFullscreenChange = async () => {
      const fsElement = document.fullscreenElement || document.webkitFullscreenElement;
      
      if (Capacitor.isNativePlatform() && typeof ScreenOrientation !== 'undefined') {
        try {
          if (fsElement) {
            await ScreenOrientation.unlock();
          } else {
            await ScreenOrientation.lock({ type: 'portrait' });
          }
        } catch (e) {
          console.error('Screen orientation error', e);
        }
      }

      if (fsElement && fsElement === iframeRef.current) {
        fsElement.style.transform = scale !== 1.0 ? `scale(${scale})` : 'none';
        fsElement.style.transformOrigin = 'center center';
        fsElement.style.width = '100vw';
        fsElement.style.height = '100vh';
        fsElement.style.overflow = 'hidden';
        fsElement.style.backgroundColor = 'black'; 
      } else if (iframeRef.current) {
        iframeRef.current.style.transform = scale !== 1.0 ? `scale(${scale})` : 'none';
        iframeRef.current.style.transformOrigin = 'center center';
        iframeRef.current.style.width = '100%';
        iframeRef.current.style.height = '100%';
        iframeRef.current.style.overflow = '';
        iframeRef.current.style.backgroundColor = '';
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

    handleFullscreenChange();

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      
      if (Capacitor.isNativePlatform() && typeof ScreenOrientation !== 'undefined') {
        ScreenOrientation.lock({ type: 'portrait' }).catch(console.error);
      }
    };
  }, [scale]);

  const queryParams = useMemo(() => {
    const params = new URLSearchParams({
      mediaType: request.mediaType,
      tmdbId: String(request.tmdbId),
      t: Date.now().toString()
    });
    if (request.imdbId) params.set('imdbId', request.imdbId);
    if (request.mediaType === 'series') {
      params.set('seasonNumber', String(request.seasonNumber || 1));
      params.set('episodeNumber', String(request.episodeNumber || 1));
    }
    return params;
  }, [request]);

  const { data: sourcePayload, isLoading: sourceLoading, error: sourceError, isFetching } = useQuery({
    queryKey: ['playerSources', request.mediaType, request.tmdbId, request.seasonNumber, request.episodeNumber, request.imdbId],
    queryFn: () => apiFetch(`/api/player/sources?${queryParams.toString()}`),
    enabled: !!request.tmdbId,
    retry: (failureCount, error) => {
      if (error?.status === 503 && failureCount < 30) return true;
      return false;
    },
    retryDelay: 4000,
    refetchInterval: (query) => {
      // Keep polling if the backend says it's scraping
      if (query.state.data?.scraping) return 4000;
      return false;
    }
  });

  useEffect(() => {
    if (sourcePayload) {
      const nextSources = Array.isArray(sourcePayload.sources)
        ? sourcePayload.sources.filter((source) => source?.url || source?.pending)
        : [];
      const resolvedSources = [...nextSources, ...(fallbackSources || [])];
      const nextSignature = JSON.stringify({
        updatedAt: sourcePayload.updatedAt || '',
        urls: resolvedSources.map((source) => source?.url || '')
      });

      if (sourceSignature !== nextSignature) {
        setHindiSources(nextSources);
        setSourceSignature(nextSignature);
        
        if (!sourcePayload.scraping) {
          const sessionKey = `${request.tmdbId}-${request.seasonNumber || '0'}-${request.episodeNumber || '0'}`;
          SESSION_SCRAPED.add(sessionKey);
        }

      }
    }
  }, [sourcePayload, fallbackSources, request, sourceSignature]);

  const combinedIncoming = useMemo(() => {
    return [...hindiSources, ...animeSources];
  }, [hindiSources, animeSources]);

  const sources = useMemo(
    () => buildPlayerSourceSlots(combinedIncoming, fallbackSources, isFetching, failedUrls, verifiedUrls),
    [combinedIncoming, fallbackSources, isFetching, failedUrls, verifiedUrls]
  );

  const availableSources = useMemo(() => sources.filter((source) => source?.url), [sources]);

  const handleIframeError = useCallback((failedUrl) => {
    if (!failedUrl) return;
    console.warn('[Soulstash Player] Stream failed:', failedUrl);
    setFailedUrls((prev) => {
      const next = new Set(prev);
      next.add(failedUrl);
      return next;
    });
    setVerifiedUrls((prev) => {
      const next = new Set(prev);
      next.delete(failedUrl);
      return next;
    });

    // Auto-switch to next available healthy source
    const candidates = availableSources.filter((s) => s.url !== failedUrl && !failedUrls.has(s.url));
    if (candidates.length > 0) {
      setActiveUrl(candidates[0].url);
      setIframeReloadKey(0);
    }
  }, [availableSources, failedUrls]);

  // Race every available stream once; the first host that answers wins.
  // After a stream is chosen we keep it (no flicker) unless it fails or disappears.
  const raceTokenRef = useRef(0);
  const playableKey = sources.filter((s) => s.url).map((s) => s.url).join('|');

  useEffect(() => {
    const playable = sources.filter((s) => s.url && !s.failed);
    if (!playable.length) return undefined;
    if (activeUrl && playable.some((s) => s.url === activeUrl && !failedUrls.has(s.url))) {
      return undefined;
    }

    const token = ++raceTokenRef.current;
    const controllers = [];
    let settled = false;

    const pick = (url) => {
      if (settled || raceTokenRef.current !== token) return;
      settled = true;
      controllers.forEach((c) => c.abort());
      setVerifiedUrls((prev) => new Set(prev).add(url));
      setActiveUrl(url);
    };

    playable.forEach((s) => {
      const c = new AbortController();
      controllers.push(c);
      fetch(s.url, { mode: 'no-cors', signal: c.signal, cache: 'no-store' })
        .then(() => {
          setVerifiedUrls((prev) => new Set(prev).add(s.url));
          pick(s.url);
        })
        .catch(() => {});
    });

    // Fallback: pick the first non-failed priority source after 2.5s if probe hasn't settled yet
    const timer = window.setTimeout(() => {
      if (!settled && raceTokenRef.current === token && playable[0]) {
        pick(playable[0].url);
      }
    }, 2500);

    return () => {
      window.clearTimeout(timer);
      controllers.forEach((c) => c.abort());
    };
  }, [playableKey, activeUrl, failedUrls, sources]);

  const defaultSource = sources.find((source) => source.url && !source.failed) || sources.find((source) => source.url) || sources[0];
  const activeSource = sources.find((source) => source.url === activeUrl) || defaultSource;

  const canUseVideoJs = isDirectMediaUrl(activeUrl);

  const canEmbedSource = canUseVideoJs || activeSource?.embeddable !== false;
  const availableHeight = `calc(100dvh - ${modalPadding * 2 + verticalInset * 2}px)`;
  const mediaHeight = `calc(${availableHeight} - ${chromeAllowance - 18}px)`;
  const videoBoxStyle = {
    width: `min(${widthLimit}, ${maxPlayerWidth}, calc(${mediaHeight} * 16 / 9))`,
    maxHeight: availableHeight,
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column'
  };
  const mediaAreaStyle = {
    width: '100%',
    aspectRatio: '16 / 9',
    maxHeight: mediaHeight
  };
  const baseVerticalShift = isDesktopViewport ? -10 : -20;
  const sourceButtonClass = isAndroidViewport
    ? 'shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold transition-colors'
    : 'shrink-0 rounded-full px-3 py-1.5 text-[11px] font-semibold transition-colors sm:text-xs';
  const actionButtonClass = isAndroidViewport
    ? 'rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-medium text-white hover:bg-white/20 transition-colors disabled:cursor-not-allowed disabled:opacity-40'
    : 'rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-white/20 transition-colors sm:text-xs disabled:cursor-not-allowed disabled:opacity-40';
  const iconButtonClass = isAndroidViewport
    ? 'flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors disabled:cursor-not-allowed disabled:opacity-40'
    : 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors disabled:cursor-not-allowed disabled:opacity-40';

  const getZoomIcon = () => {
    if (scale === 1.0) return 'fas fa-compress';
    if (scale === 1.15) return 'fas fa-expand';
    return 'fas fa-expand-arrows-alt';
  };

  const handleSwitchSource = () => {
    const candidates = availableSources.filter((s) => !failedUrls.has(s.url));
    if (!candidates.length) return;
    const currentIndex = candidates.findIndex((source) => source.url === activeUrl);
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % candidates.length : 0;
    setActiveUrl(candidates[nextIndex]?.url || '');
    setIframeReloadKey(0);
  };

  const reloadActiveSource = useCallback(() => {
    if (!activeUrl) return;
    setIframeReloadKey((current) => current + 1);
  }, [activeUrl]);

  const settlePlayerPosition = useCallback((currentOffset) => {
    const playerNode = playerBoxRef.current;
    if (!playerNode || typeof window === 'undefined') {
      setDragOffset({ x: 0, y: currentOffset?.y || 0 });
      return;
    }

    const rect = playerNode.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const edgePadding = 12;
    let nextY = currentOffset?.y || 0;

    if (rect.top < edgePadding) {
      nextY += edgePadding - rect.top;
    } else if (rect.bottom > viewportHeight - edgePadding) {
      nextY -= rect.bottom - (viewportHeight - edgePadding);
    }

    setDragOffset({ x: 0, y: nextY });
  }, []);

  const stopPlayerDrag = useCallback(() => {
    const dragState = dragStateRef.current;
    if (!dragState) return;
    dragStateRef.current = null;
    setDraggingPlayer(false);
    settlePlayerPosition(dragState.lastOffset || dragOffset);
  }, [dragOffset, settlePlayerPosition]);

  const handlePlayerPointerDown = useCallback((event) => {
    if (!isAndroidViewport || event.pointerType !== 'touch') return;
    if (!event.target.closest('[data-player-drag-handle]')) return;
    if (event.target.closest('button, a')) return;

    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startOffsetX: dragOffset.x,
      startOffsetY: dragOffset.y,
      lastOffset: dragOffset,
      activated: false
    };
  }, [dragOffset, isAndroidViewport]);

  useEffect(() => {
    if (!isAndroidViewport) return undefined;

    const handlePointerMove = (event) => {
      const dragState = dragStateRef.current;
      if (!dragState || event.pointerId !== dragState.pointerId) return;

      const dx = event.clientX - dragState.startX;
      const dy = event.clientY - dragState.startY;

      if (!dragState.activated) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        dragState.activated = true;
        setDraggingPlayer(true);
      }

      event.preventDefault();
      const nextOffset = {
        x: dragState.startOffsetX + dx,
        y: dragState.startOffsetY + dy
      };
      dragState.lastOffset = nextOffset;
      setDragOffset(nextOffset);
    };

    const handlePointerEnd = (event) => {
      const dragState = dragStateRef.current;
      if (!dragState || event.pointerId !== dragState.pointerId) return;
      if (dragState.activated) {
        stopPlayerDrag();
      } else {
        dragStateRef.current = null;
      }
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerEnd, true);
    window.addEventListener('pointercancel', handlePointerEnd, true);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerEnd, true);
      window.removeEventListener('pointercancel', handlePointerEnd, true);
    };
  }, [isAndroidViewport, stopPlayerDrag]);

  useEffect(() => {
    if (!activeUrl || !scrollContainerRef.current) return;
    const activeBtn = scrollContainerRef.current.querySelector('button[data-active-source="true"]');
    if (activeBtn) {
      activeBtn.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center'
      });
    }
  }, [activeUrl, sources.length]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const modal = playerBoxRef.current?.closest('[data-player-modal]');
      if (!modal) return;
      const isKeyboardNav = document.documentElement.classList.contains('tv-nav-active');
      if (!isKeyboardNav) return;
      if (modal.contains(document.activeElement)) return;
      const sourceButton =
        playerBoxRef.current?.querySelector('button[data-active-source="true"]:not(:disabled)') ||
        playerBoxRef.current?.querySelector('button[data-player-source="true"]:not(:disabled)') ||
        playerBoxRef.current?.querySelector('button[data-player-action="true"]:not(:disabled), a[data-player-action="true"]');
      if (sourceButton) {
        sourceButton.focus({ preventScroll: true });
        sourceButton.classList.add('tv-focused');
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeUrl, sources.length]);

  const errorDisplay = sourceError 
    ? (fallbackSources.length ? '' : sourceError?.message || 'Failed to load sources.')
    : '';

  return (
    <div className="pointer-events-none fixed inset-0 z-[9999] bg-transparent" data-player-modal="true">
      <div
        className="relative h-full w-full"
        style={{
          minHeight: '100dvh'
        }}
      >
        <div
          ref={playerBoxRef}
          className="pointer-events-auto absolute overflow-hidden rounded-[22px] border border-white/10 bg-black"
          style={{
            ...videoBoxStyle,
            left: '50%',
            top: '50%',
            transform: `translate(calc(-50% + ${dragOffset.x}px), calc(-50% + ${baseVerticalShift + dragOffset.y}px))`,
            transition: draggingPlayer ? 'none' : 'transform 220ms ease'
          }}
        >
            <div
              data-player-controls="true"
              data-player-drag-handle="true"
              className="flex items-center justify-between gap-1.5 sm:gap-2 border-b border-white/10 bg-black/80 px-2 sm:px-4"
              style={{ height: controlsHeight, touchAction: 'none' }}
              onPointerDown={handlePlayerPointerDown}
            >
              {/* Left Scroll Button '<' (fixed at start) */}
              <button
                type="button"
                onClick={() => scrollContainerRef.current?.scrollBy({ left: -220, behavior: 'smooth' })}
                className="flex h-7 w-7 sm:h-8 sm:w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/80 hover:bg-white/20 hover:text-white transition-colors"
                aria-label="Scroll sources left"
                title="Scroll Left"
              >
                <i className="fas fa-chevron-left text-[10px] sm:text-xs"></i>
              </button>

              <div
                ref={scrollContainerRef}
                className="filter-scrollbar-hidden min-w-0 flex-1 overflow-x-auto overflow-y-hidden scroll-smooth"
              >
                <div className="flex min-w-max items-center gap-1.5 sm:gap-2 px-1">
                  {sources.length ? (
                    sources.map((source) => {
                      const isActive = activeUrl === source.url;
                      const isFailed = source.failed;
                      const isWorking = source.working || isActive;
                      return (
                        <button
                          key={source.id}
                          type="button"
                          data-player-source="true"
                          data-active-source={isActive}
                          aria-label={`Play stream ${source.label}`}
                          className={`inline-flex items-center gap-1.5 ${sourceButtonClass} ${
                            isFailed
                              ? 'opacity-60 bg-red-950/40 text-red-300 border border-red-800/40 hover:bg-red-900/50'
                              : source.pending
                              ? 'animate-pulse cursor-wait bg-white/15 text-white/50 border-white/20'
                              : source.disabled
                              ? 'cursor-not-allowed bg-white/5 text-white/25'
                              : isActive
                              ? 'bg-white text-black font-semibold shadow-md'
                              : 'bg-white/10 text-white hover:bg-white/20'
                          }`}
                          disabled={source.disabled || source.pending}
                          onClick={() => {
                            if (!source.disabled && !source.pending) {
                              setActiveUrl(source.url);
                              setIframeReloadKey(0);
                            }
                          }}
                        >
                          <span>{source.label}</span>
                          {/* Status dot indicator */}
                          {isFailed ? (
                            <span
                              className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.9)]"
                              title="Stream failed"
                            />
                          ) : isWorking ? (
                            <span
                              className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)]"
                              title="Active stream"
                            />
                          ) : source.pending ? (
                            <span
                              className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400/80 animate-pulse"
                              title="Probing stream"
                            />
                          ) : (
                            <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-white/30" />
                          )}
                        </button>
                      );
                    })
                  ) : (
                    <span className="text-[11px] font-medium text-white/50">
                      {errorDisplay || 'No source links yet.'}
                    </span>
                  )}
                </div>
              </div>

              {/* Right Scroll Button '>' (fixed just before action buttons) */}
              <button
                type="button"
                onClick={() => scrollContainerRef.current?.scrollBy({ left: 220, behavior: 'smooth' })}
                className="flex h-7 w-7 sm:h-8 sm:w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/80 hover:bg-white/20 hover:text-white transition-colors"
                aria-label="Scroll sources right"
                title="Scroll Right"
              >
                <i className="fas fa-chevron-right text-[10px] sm:text-xs"></i>
              </button>
            <div className="flex shrink-0 items-center justify-end gap-2">
              <button
                type="button"
                data-player-action="true"
                onClick={reloadActiveSource}
                disabled={!activeUrl || canUseVideoJs}
                className={iconButtonClass}
                aria-label="Reload stream"
                title="Reload Stream"
              >
                <i className="fas fa-redo"></i>
              </button>
              {!canUseVideoJs && activeUrl && (
                <button
                  type="button"
                  data-player-action="true"
                  onClick={handleToggleZoom}
                  className={iconButtonClass}
                  aria-label={getZoomLabel()}
                  title={getZoomLabel()}
                >
                  <i className={getZoomIcon()}></i>
                </button>
              )}
              <a
                data-player-action="true"
                className={iconButtonClass}
                href={activeUrl || '#'}
                target="_blank"
                rel="noreferrer"
                aria-label="Open stream provider"
                title="Open Provider"
                onClick={(event) => {
                  if (!activeUrl) event.preventDefault();
                }}
              >
                <i className="fas fa-external-link-alt"></i>
              </a>
              <button
                type="button"
                data-player-action="true"
                onClick={handleCloseClick}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
                aria-label="Close player"
              >
                <svg xmlns="http://www.w3.org/2000/svg" height="18" viewBox="0 -960 960 960" fill="currentColor">
                  <path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/>
                </svg>
              </button>
            </div>
          </div>
          <div
            className="relative flex flex-1 items-center justify-center overflow-hidden bg-black"
            style={mediaAreaStyle}
          >
            {isFetching && !activeUrl ? (
              <div className="flex h-full w-full flex-col items-center justify-center gap-6">
                <div className="batman-loader-wrapper">
                  <div className="batman-loader" />
                </div>
                <div className="animate-pulse text-sm font-medium tracking-widest text-white/40 uppercase">
                  Loading Player
                </div>
              </div>
            ) : !activeUrl ? (
              <div className="flex h-full w-full items-center justify-center px-6 text-center text-sm text-white/65">
                {errorDisplay || 'No playable source is available for this title right now.'}
              </div>
            ) : canUseVideoJs ? (
              <div className="flex h-full w-full items-center justify-center bg-black">
                <video
                  key={`${sourceSignature}:${activeUrl}`}
                  src={activeUrl}
                  controls
                  autoPlay
                  playsInline
                  className="w-full h-full bg-black object-contain"
                  onError={() => handleIframeError(activeUrl)}
                  onLoadedData={() => setVerifiedUrls((prev) => new Set(prev).add(activeUrl))}
                />
              </div>
            ) : !canEmbedSource ? (
              <div className="flex h-full w-full flex-col items-center justify-center gap-4 px-6 text-center">
                <p className="max-w-lg text-sm leading-6 text-white/70 sm:text-base">
                  This source opens best in a new tab.
                </p>
                <a
                  className="inline-flex items-center justify-center rounded-full bg-white px-5 py-3 text-sm font-semibold text-black transition-colors hover:bg-[#e8e8e8]"
                  href={activeUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open Provider
                </a>
              </div>
            ) : (
              <div className={`relative h-full w-full ${activeSource?.id?.includes('cinesu') ? 'cine-crop-wrapper' : ''}`}>
                <iframe
                  ref={iframeRef}
                  key={`${activeUrl}:${iframeReloadKey}`}
                  src={activeUrl}
                  tabIndex={0}
                  scrolling={activeSource?.id?.includes('cinesu') ? 'no' : 'auto'}
                  onLoad={() => {
                    console.log('[Soulstash Player Debug] Iframe loaded for URL:', activeUrl);
                    setVerifiedUrls((prev) => new Set(prev).add(activeUrl));
                  }}
                  onError={(e) => {
                    console.log('[Soulstash Player Debug] Iframe error for URL:', activeUrl, e);
                    handleIframeError(activeUrl);
                  }}
                  className={`h-full w-full border-0 bg-black ${activeSource?.id?.includes('cinesu') ? 'cine-crop-iframe' : ''}`}
                  style={{
                    transform: scale !== 1.0 ? `scale(${scale})` : 'none',
                    transformOrigin: 'center center',
                    transition: 'transform 0.2s ease',
                    backgroundColor: 'black'
                  }}
                  allowFullScreen={true}
                  webkitallowfullscreen="true"
                  mozallowfullscreen="true"
                  allow="autoplay *; fullscreen *; encrypted-media *; picture-in-picture *; display-capture *"
                  referrerPolicy={activeUrl.includes('youtube.com') || activeUrl.includes('youtube-nocookie.com') ? 'strict-origin-when-cross-origin' : 'no-referrer'}
                  title="Soulstash Player"
                />
                {Capacitor.isNativePlatform() && (activeUrl.includes('youtube.com') || activeUrl.includes('youtu.be') || activeUrl.includes('youtube-nocookie.com')) && (
                  <div className="absolute top-4 right-4 z-[9999]">
                    <a
                      href={activeUrl.replace('youtube-nocookie.com/embed/', 'youtube.com/watch?v=').replace('youtube.com/embed/', 'youtube.com/watch?v=').split('&')[0]}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2 rounded-full bg-[#FF0000]/90 px-4 py-2 text-xs font-semibold text-white shadow-lg backdrop-blur hover:bg-[#FF0000] sm:text-sm"
                    >
                      <i className="fab fa-youtube text-base" />
                      <span>Open in App</span>
                    </a>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
