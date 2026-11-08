import { setNativeScale } from '../../utils/formatters.js';
import { useCallback, useMemo } from 'react';
import { SESSION_SCRAPED } from '../../utils/constants.js';
import { isDirectMediaUrl } from '../../utils/formatters.js';
import { Capacitor } from '@capacitor/core';
import { ScreenOrientation } from '@capacitor/screen-orientation';
import React, { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from '../../utils/toast.js';
import { apiFetch } from '../../api/client.js';
import { ActionButton } from '../ui/ActionButton.jsx';
import {
  fetchKartoonsStremioStreams,
  resolveKartoonsEpisodeId,
  resolveKartoonsMovieId,
  searchKartoonsShows,
  searchKartoonsMovies
} from '../../api/kartoons.js';
import { findKartoonsMatch } from '../../utils/kartoonsSearch.js';

// Assume PlayerErrorBoundary is imported
import { PlayerErrorBoundary } from './PlayerErrorBoundary.jsx';

// Assume buildPlayerSourceSlots is imported
import { buildPlayerSourceSlots, firstPlayableUrl, sourceKeyText } from '../../utils/playerUtils.js';

function getHls() {
  return window.Hls ?? null;
}

async function ensureHlsJs() {
  if (getHls()) return getHls();
  await new Promise((resolve) => {
    const existing = document.getElementById('__hls_script__');
    if (existing) {
      if (window.Hls) { resolve(window.Hls); return; }
      existing.addEventListener('load', () => resolve(window.Hls));
      setTimeout(() => resolve(window.Hls), 1500);
      return;
    }
    const s = document.createElement('script');
    s.id = '__hls_script__';
    s.src = 'https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js';
    s.onload = () => resolve(window.Hls);
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
  return getHls();
}

export function VideoPlayerModal({ request, onClose }) {
  if (!request?.tmdbId && !request?.kartoonsSlug && !request?.kartoonsEpisodeId) return null;
  const [selectedGroup, setSelectedGroup] = useState('hindi');
  const [hindiSources, setHindiSources] = useState([]);
  const [animeSources, setAnimeSources] = useState([]);
  const [kartoonSources, setKartoonSources] = useState([]);
  const [anilistId, setAnilistId] = useState(null);
  const [activeUrl, setActiveUrl] = useState('');
  const [sourceSignature, setSourceSignature] = useState('');
  const [failedUrls, setFailedUrls] = useState(() => new Set());
  const [verifiedUrls, setVerifiedUrls] = useState(() => new Set());
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [draggingPlayer, setDraggingPlayer] = useState(false);
  const [iframeReloadKey, setIframeReloadKey] = useState(0);
  const [scale, setScale] = useState(1.0);
  const [sourcesExpanded, setSourcesExpanded] = useState(false);
  const iframeRef = useRef(null);
  const directVideoRef = useRef(null);
  const hlsInstanceRef = useRef(null);
  const hlsErrorHandlerRef = useRef(null);
  const scrollContainerRef = useRef(null);
  
  const playerBoxRef = useRef(null);
  const dragStateRef = useRef(null);
  const isDesktopViewport = typeof window !== 'undefined' ? window.innerWidth >= 768 : true;
  const isAndroidViewport = !isDesktopViewport;
  const modalPadding = 16;
  const controlsHeight = isAndroidViewport ? 40 : 44;
  const verticalInset = isDesktopViewport ? 10 : 36;
  const chromeAllowance = isDesktopViewport ? 134 : 126;
  const widthLimit = isDesktopViewport ? '99vw' : '96vw';
  const maxPlayerWidth = isDesktopViewport ? '1760px' : '1400px';
  const fallbackSources = Array.isArray(request?.fallbackSources)
    ? request.fallbackSources.filter((source) => source?.url)
    : [];

  useEffect(() => {
    setSelectedGroup('hindi');
    setHindiSources([]);
    setAnimeSources([]);
    setKartoonSources([]);
    setAnilistId(null);
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

  // Anime / AniList / MultiNime Resolution with multi-step search fallback
  useEffect(() => {
    if (!request?.title && !request?.originalTitle) return;
    const ep = request.episodeNumber || 1;
    const rawTitle = String(request.seriesTitle || request.title || '');
    const rawOrig = String(request.originalTitle || request.originalName || '');

    const cleanTitle = rawTitle
      .replace(/\s*S\d+E\d+.*$/i, '')
      .replace(/\s*Season\s*\d+.*$/i, '')
      .replace(/\s*Episode\s*\d+.*$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    const cleanOrig = rawOrig
      .replace(/\s*S\d+E\d+.*$/i, '')
      .replace(/\s*Season\s*\d+.*$/i, '')
      .replace(/\s*Episode\s*\d+.*$/i, '')
      .replace(/\s+/g, ' ')
      .trim();

    const isMovie = request.mediaType === 'movie';
    const formatIn = isMovie ? ['MOVIE'] : ['TV', 'TV_SHORT', 'ONA', 'OVA', 'SPECIAL'];
    const year = Number(request.year) || null;
    const slug = cleanTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    const searchAniList = async (search, formats = null) => {
      try {
        const query = `
          query ($search: String, $formatIn: [MediaFormat]) {
            Page(page: 1, perPage: 8) {
              media(search: $search, type: ANIME, format_in: $formatIn) {
                id
                idMal
                title { romaji english native }
                format
                seasonYear
                startDate { year }
                episodes
              }
            }
          }
        `;
        const variables = { search };
        if (formats && formats.length) variables.formatIn = formats;
        const res = await fetch('https://graphql.anilist.co', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ query, variables })
        });
        if (!res.ok) return [];
        const data = await res.json();
        return data?.data?.Page?.media || [];
      } catch (e) {
        return [];
      }
    };

    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    const pickBest = (list, searchTerms) => {
      if (!list || !list.length) return null;
      const termNorms = searchTerms.map(norm).filter(Boolean);

      // 1. Exact year + title match
      if (year) {
        const yearMatch = list.find((m) => {
          const mYear = m.seasonYear || m.startDate?.year;
          const matchesYear = mYear && Math.abs(mYear - year) <= 1;
          const matchesName = termNorms.some((t) =>
            norm(m.title?.english) === t || norm(m.title?.romaji) === t || norm(m.title?.native) === t
          );
          return matchesYear && matchesName;
        });
        if (yearMatch) return yearMatch;
      }

      // 2. Exact title match
      const exactMatch = list.find((m) =>
        termNorms.some((t) =>
          norm(m.title?.english) === t || norm(m.title?.romaji) === t || norm(m.title?.native) === t
        )
      );
      if (exactMatch) return exactMatch;

      // 3. Year match
      if (year) {
        const yearMatch = list.find((m) => {
          const mYear = m.seasonYear || m.startDate?.year;
          return mYear && Math.abs(mYear - year) <= 1;
        });
        if (yearMatch) return yearMatch;
      }

      // 4. Return top search hit if non-empty
      return list[0];
    };

    const fetchAnime = async () => {
      try {
        let match = null;

        // Step 1: title with format filter
        if (cleanTitle) {
          const list1 = await searchAniList(cleanTitle, formatIn);
          if (list1.length) match = pickBest(list1, [cleanTitle, cleanOrig]);
        }

        // Step 2: original_name with format filter
        if (!match && cleanOrig && cleanOrig.toLowerCase() !== cleanTitle.toLowerCase()) {
          const list2 = await searchAniList(cleanOrig, formatIn);
          if (list2.length) match = pickBest(list2, [cleanOrig, cleanTitle]);
        }

        // Step 3: title without format filter
        if (!match && cleanTitle) {
          const list3 = await searchAniList(cleanTitle, null);
          if (list3.length) match = pickBest(list3, [cleanTitle, cleanOrig]);
        }

        // Step 4: original_name without format filter
        if (!match && cleanOrig && cleanOrig.toLowerCase() !== cleanTitle.toLowerCase()) {
          const list4 = await searchAniList(cleanOrig, null);
          if (list4.length) match = pickBest(list4, [cleanOrig, cleanTitle]);
        }

        if (!match || !match.id) {
          setAnilistId(null);
          setAnimeSources([]);
          return;
        }

        const resolvedAnilistId = match.id;
        const malId = match.idMal || match.id;
        setAnilistId(resolvedAnilistId);

        console.log(`***************${cleanTitle} / tmdb: ${request.tmdbId}, anilist :${resolvedAnilistId}**************`);

        // Build 6 VidNest Anime Sources + other Anime providers
        const animeList = [
          // VidNest Embed Anime
          {
            id: 'vidnest-ani-sub',
            key: 'vidnest-ani-sub',
            label: 'VidNest Anime (Sub)',
            url: `https://vidnest.fun/anime/${resolvedAnilistId}/${ep}/sub`,
            embeddable: true
          },
          {
            id: 'vidnest-ani-dub',
            key: 'vidnest-ani-dub',
            label: 'VidNest Anime (Dub)',
            url: `https://vidnest.fun/anime/${resolvedAnilistId}/${ep}/dub`,
            embeddable: true
          },
          {
            id: 'vidnest-ani-hindi',
            key: 'vidnest-ani-hindi',
            label: 'VidNest Anime (Hindi)',
            url: `https://vidnest.fun/anime/${resolvedAnilistId}/${ep}/hindi`,
            embeddable: true
          },
          // VidNest Embed AnimePahe
          {
            id: 'vidnest-pahe-sub',
            key: 'vidnest-pahe-sub',
            label: 'VidNest AnimePahe (Sub)',
            url: `https://vidnest.fun/animepahe/${resolvedAnilistId}/${ep}/sub`,
            embeddable: true
          },
          {
            id: 'vidnest-pahe-dub',
            key: 'vidnest-pahe-dub',
            label: 'VidNest AnimePahe (Dub)',
            url: `https://vidnest.fun/animepahe/${resolvedAnilistId}/${ep}/dub`,
            embeddable: true
          },
          {
            id: 'vidnest-pahe-hindi',
            key: 'vidnest-pahe-hindi',
            label: 'VidNest AnimePahe (Hindi)',
            url: `https://vidnest.fun/animepahe/${resolvedAnilistId}/${ep}/hindi`,
            embeddable: true
          },
          // Gogo Server (Sub & Dub)
          {
            id: 'gogo-server-sub',
            key: 'gogo-server-sub',
            label: 'Gogo Server (Sub)',
            url: `https://gogoanime.me.uk/newplayer.php?mal_id=${malId}&ep=${ep}&category=sub`,
            embeddable: true
          },
          {
            id: 'gogo-server-dub',
            key: 'gogo-server-dub',
            label: 'Gogo Server (Dub)',
            url: `https://gogoanime.me.uk/newplayer.php?mal_id=${malId}&ep=${ep}&category=dub`,
            embeddable: true
          },
          // VidHawk (Sub & Dub)
          {
            id: 'vidhawk-sub',
            key: 'vidhawk-sub',
            label: 'VidHawk (Sub)',
            url: `https://vidhawk.buzz/embed/ani/${resolvedAnilistId}/${ep}/sub`,
            embeddable: true
          },
          {
            id: 'vidhawk-dub',
            key: 'vidhawk-dub',
            label: 'VidHawk (Dub)',
            url: `https://vidhawk.buzz/embed/ani/${resolvedAnilistId}/${ep}/dub`,
            embeddable: true
          },
          // TryEmbed (Sub & Dub)
          {
            id: 'tryembed-sub',
            key: 'tryembed-sub',
            label: 'TryEmbed (Sub)',
            url: `https://tryembed.us.cc/embed/anime/${resolvedAnilistId}/${ep}/sub`,
            embeddable: true
          },
          {
            id: 'tryembed-dub',
            key: 'tryembed-dub',
            label: 'TryEmbed (Dub)',
            url: `https://tryembed.us.cc/embed/anime/${resolvedAnilistId}/${ep}/dub`,
            embeddable: true
          },
          // Vidstreaming
          {
            id: 'vidstreaming',
            key: 'vidstreaming',
            label: 'Vidstreaming',
            url: `https://vidsrc.me/embed/anime?id=${resolvedAnilistId}&ep=${ep}`,
            embeddable: true
          }
        ];

        setAnimeSources(animeList);

        // Fetch MultiNime watch page for FlixCloud mirrors
        try {
          const mnRes = await fetch(`https://multinime.site/watch.php?slug=${slug}&ep=${ep}&lang=sub&aid=${resolvedAnilistId}`);
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

  // Kartoons Resolution (Single embed source in Hindi section)
  useEffect(() => {
    let cancelled = false;
    const resolveKartoons = async () => {
      try {
        const isMovie = request?.mediaType === 'movie';
        const season = Number(request?.seasonNumber) || 1;
        const episode = Number(request?.episodeNumber) || 1;
        let kartoonStream = null;

        const firstKartoonStream = async (type, id) => {
          if (!id) return null;
          const streams = await fetchKartoonsStremioStreams(type, id).catch(() => []);
          return streams.find((stream) => /\.m3u8(?:[?#]|$)/i.test(stream.url || '')) || streams[0] || null;
        };

        // 1. If explicit kartoonsEpisodeId is provided
        if (request?.kartoonsEpisodeId) {
          kartoonStream = await firstKartoonStream('series', request.kartoonsEpisodeId);
        }

        // 2. If explicit kartoonsSlug is provided
        if (!kartoonStream && request?.kartoonsSlug) {
          if (isMovie) {
            const movieId = await resolveKartoonsMovieId(request.kartoonsSlug).catch(() => null);
            kartoonStream = await firstKartoonStream('movie', movieId);
          } else {
            const epId = await resolveKartoonsEpisodeId(request.kartoonsSlug, season, episode).catch(() => null);
            kartoonStream = await firstKartoonStream('series', epId);
          }
        }

        // 3. Otherwise, search Kartoons by title (e.g. Dragon Ball, Ben 10, etc.)
        if (!kartoonStream && (request?.title || request?.seriesTitle)) {
          const rawTitle = String(request.seriesTitle || request.title || '');
          const cleanTitle = rawTitle
            .replace(/\s*S\d+E\d+.*$/i, '')
            .replace(/\s*Season\s*\d+.*$/i, '')
            .replace(/\s*Episode\s*\d+.*$/i, '')
            .replace(/\s+/g, ' ')
            .trim();

          if (cleanTitle.length >= 2) {
            if (isMovie) {
              const res = await searchKartoonsMovies(cleanTitle).catch(() => ({ data: [] }));
              const match = findKartoonsMatch(request, res?.data || []);
              if (match?.slug) {
                const movieId = await resolveKartoonsMovieId(match.slug).catch(() => null);
                kartoonStream = await firstKartoonStream('movie', movieId);
              }
            } else {
              const res = await searchKartoonsShows(cleanTitle).catch(() => ({ data: [] }));
              const match = findKartoonsMatch(request, res?.data || []);
              if (match?.slug) {
                const epId = await resolveKartoonsEpisodeId(match.slug, season, episode).catch(() => null);
                kartoonStream = await firstKartoonStream('series', epId);
              }
            }
          }
        }

        if (cancelled || !kartoonStream?.url) return;

        const kSources = [{
          id: 'kartoon',
          key: 'kartoon',
          label: 'Kartoon',
          url: kartoonStream.url,
          embeddable: false,
          isDirect: true,
          group: 'hindi'
        }];

        setKartoonSources(kSources);
      } catch (err) {
        console.warn('[Soulstash Player] Kartoons resolution failed:', err.message);
      }
    };

    resolveKartoons();
    return () => { cancelled = true; };
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

  const isClosingRef = useRef(false);

  const handleCloseClick = useCallback(() => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;

    try {
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      }
    } catch (e) {}

    if (Capacitor.isNativePlatform()) {
      try {
        const rot = localStorage.getItem('ss_rotation_mode') || 'sensor';
        if (rot === 'portrait') {
          ScreenOrientation.lock({ orientation: 'portrait' }).catch(() => {});
        } else if (rot === 'landscape') {
          ScreenOrientation.lock({ orientation: 'landscape' }).catch(() => {});
        }
      } catch (e) {}
    }

    if (window.history.state?.playerOpen) {
      try {
        window.history.back();
      } catch (e) {}
    }
    if (onCloseRef.current) {
      onCloseRef.current();
    }
  }, []);

  useEffect(() => {
    if (!window.history.state || !window.history.state.playerOpen) {
      try {
        window.history.pushState({ playerOpen: true }, '');
      } catch (e) {}
    }

    const handlePopState = () => {
      if (isClosingRef.current) return;
      // If we are in fullscreen, the back button should ONLY exit fullscreen
      if (document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement) {
        try {
          if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
          else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        } catch (e) {}
        try {
          window.history.pushState({ playerOpen: true }, '');
        } catch (e) {}
      } else {
        isClosingRef.current = true;
        if (Capacitor.isNativePlatform()) {
          try {
            const rot = localStorage.getItem('ss_rotation_mode') || 'sensor';
            if (rot === 'portrait') {
              ScreenOrientation.lock({ orientation: 'portrait' }).catch(() => {});
            } else if (rot === 'landscape') {
              ScreenOrientation.lock({ orientation: 'landscape' }).catch(() => {});
            }
          } catch (e) {}
        }
        if (onCloseRef.current) onCloseRef.current();
      }
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        handleCloseClick();
      }
    };

    window.addEventListener('popstate', handlePopState);
    window.addEventListener('keydown', handleKeyDown);
    
    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleCloseClick]);

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
      try {
        const fsElement = document.fullscreenElement || document.webkitFullscreenElement;
        
        if (Capacitor.isNativePlatform()) {
          try {
            if (fsElement) {
              await ScreenOrientation.unlock();
            } else {
              const rot = localStorage.getItem('ss_rotation_mode') || 'sensor';
              if (rot === 'sensor') {
                await ScreenOrientation.unlock();
              } else if (rot === 'portrait') {
                await ScreenOrientation.lock({ orientation: 'portrait' });
              } else if (rot === 'landscape') {
                await ScreenOrientation.lock({ orientation: 'landscape' });
              }
            }
          } catch (e) {
            // Orientation ignore
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
      } catch (err) {
        console.warn('Fullscreen change handler error:', err);
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

    handleFullscreenChange();

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, [scale]);

  const queryParams = useMemo(() => {
    const params = new URLSearchParams({
      mediaType: request.mediaType,
      tmdbId: String(request.tmdbId),
      t: Date.now().toString()
    });
    if (request.imdbId) params.set('imdbId', request.imdbId);
    if (request.title) params.set('title', request.seriesTitle || request.title);
    if (request.originalTitle) params.set('originalTitle', request.originalTitle);
    if (request.year) params.set('year', String(request.year));
    if (request.mediaType === 'series') {
      params.set('seasonNumber', String(request.seasonNumber || 1));
      params.set('episodeNumber', String(request.episodeNumber || 1));
    }
    return params;
  }, [request]);

  const isPureKartoons = String(request?.tmdbId || '').startsWith('kartoons-');

  const { data: sourcePayload, isLoading: sourceLoading, error: sourceError, isFetching } = useQuery({
    queryKey: ['playerSources', request.mediaType, request.tmdbId, request.seasonNumber, request.episodeNumber, request.imdbId],
    queryFn: () => apiFetch(`/api/player/sources?${queryParams.toString()}`),
    enabled: !!request.tmdbId && !isPureKartoons,
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

  const effectiveAnilistId = request?.anilistId || sourcePayload?.anilistId || anilistId;

  const combinedIncoming = useMemo(() => {
    const baseHindi = [...kartoonSources, ...hindiSources];
    // If no AniList ID, do not include anime sources
    if (!effectiveAnilistId) {
      return baseHindi.filter(
        (s) => !/\((Sub|Dub|Hindi)\)/i.test(s.label || '') && !/^(gogo|tryembed|vidhawk|vidnest-ani|vidnest-pahe)/i.test(s.id || s.key || '')
      );
    }
    const animeKeys = new Set(animeSources.map((s) => s.id));
    const cleanHindiSources = baseHindi.filter(
      (s) => !animeKeys.has(s.id) && !/^(gogo|tryembed|vidhawk|vidnest-ani|vidnest-pahe)/i.test(s.id || s.key || '')
    );
    return [...animeSources, ...cleanHindiSources];
  }, [hindiSources, animeSources, kartoonSources, effectiveAnilistId]);

  const sources = useMemo(
    () => buildPlayerSourceSlots(combinedIncoming, fallbackSources, {
      isLoading: isFetching,
      failedUrls,
      verifiedUrls
    }),
    [combinedIncoming, fallbackSources, isFetching, failedUrls, verifiedUrls]
  );

  // Filter sources:
  // 1. Hide disabled / unhealthy sources with no stream url
  // 2. If no AniList ID, hide anime sources with (Sub), (Dub), (Hindi) in label (preserve Kartoon sources!)
  // 3. Hide entire dubbed section if no AniList ID
  const displayedSources = useMemo(() => {
    return sources.filter((s) => {
      if (!s.url && !s.pending) return false;
      const isKartoon = /kartoon/i.test(s.id || s.key || s.label || '');
      if (!effectiveAnilistId && !isKartoon) {
        if (/\((Sub|Dub|Hindi)\)/i.test(s.label || '')) return false;
        if (/^(vidnest|gogo|vidhawk|tryembed|multinime)/i.test(s.id || s.key || '')) return false;
        if (s.group === 'dubbed') return false;
      }
      return true;
    });
  }, [sources, effectiveAnilistId]);

  const availableHindi = useMemo(() => displayedSources.filter((s) => s.group === 'hindi'), [displayedSources]);
  const availableDubbed = useMemo(() => displayedSources.filter((s) => s.group === 'dubbed'), [displayedSources]);
  const availableSubbed = useMemo(() => displayedSources.filter((s) => s.group === 'subbed'), [displayedSources]);

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

    // Auto-switch to next available healthy source across displayed sources
    const candidates = displayedSources.filter((s) => s.url && s.url !== failedUrl && !failedUrls.has(s.url));
    if (candidates.length > 0) {
      setActiveUrl(candidates[0].url);
      setIframeReloadKey(0);
    } else {
      setActiveUrl('');
    }
  }, [displayedSources, failedUrls]);

  useEffect(() => {
    hlsErrorHandlerRef.current = handleIframeError;
  }, [handleIframeError]);

  const isKartoonSource = (s) => {
    if (!s) return false;
    const lowerKey = String(s.key || s.id || '').toLowerCase();
    const lowerLabel = String(s.label || s.name || '').toLowerCase();
    return lowerKey.includes('kartoon') || lowerLabel.includes('kartoon');
  };

  const isVidboltSource = (s) => {
    if (!s) return false;
    const lowerKey = String(s.key || s.id || '').toLowerCase();
    const lowerLabel = String(s.label || s.name || '').toLowerCase();
    const url = String(s.url || '').toLowerCase();
    return lowerKey.includes('vidbolt') || lowerLabel.includes('vidbolt') || url.includes('vidbolt');
  };

  // Race every available stream once across displayed sources; Kartoon is prioritized if present, then VidBolt!
  // Importantly, switching categories or viewing sources does NOT switch or interrupt the playing stream!
  const raceTokenRef = useRef(0);
  const playableKey = displayedSources.filter((s) => s.url && !failedUrls.has(s.url)).map((s) => s.url).join('|');

  useEffect(() => {
    // If we already have an active playing URL and it hasn't failed, KEEP IT!
    if (activeUrl && !failedUrls.has(activeUrl)) {
      return undefined;
    }

    const playable = displayedSources.filter((s) => s.url && !failedUrls.has(s.url));
    if (!playable.length) return undefined;

    // Prioritize Kartoon as default player if available
    const kartoonSource = playable.find(isKartoonSource);
    if (kartoonSource && !failedUrls.has(kartoonSource.url)) {
      setActiveUrl(kartoonSource.url);
      setVerifiedUrls((prev) => new Set(prev).add(kartoonSource.url));
      return undefined;
    }

    // Prioritize VidBolt as default player if available
    const vidboltSource = playable.find(isVidboltSource);
    if (vidboltSource && !failedUrls.has(vidboltSource.url)) {
      setActiveUrl(vidboltSource.url);
      setVerifiedUrls((prev) => new Set(prev).add(vidboltSource.url));
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

    playable.slice(0, 6).forEach((s) => {
      const c = new AbortController();
      controllers.push(c);
      fetch(s.url, { mode: 'no-cors', signal: c.signal, cache: 'no-store' })
        .then(() => {
          setVerifiedUrls((prev) => new Set(prev).add(s.url));
          pick(s.url);
        })
        .catch(() => {});
    });

    const timer = window.setTimeout(() => {
      if (!settled && raceTokenRef.current === token && playable[0]) {
        pick(playable[0].url);
      }
    }, 2500);

    return () => {
      window.clearTimeout(timer);
      controllers.forEach((c) => c.abort());
    };
  }, [playableKey, activeUrl, failedUrls, displayedSources]);

  const defaultSource =
    displayedSources.find((s) => s.url && !s.failed && isKartoonSource(s)) ||
    displayedSources.find((s) => s.url && !s.failed && isVidboltSource(s)) ||
    displayedSources.find((source) => source.url && !source.failed) ||
    displayedSources.find((source) => source.url) ||
    displayedSources[0];
  const activeSource = displayedSources.find((source) => source.url === activeUrl) || defaultSource;

  const canUseVideoJs = isDirectMediaUrl(activeUrl);

  // HLS stream playback handler for .m3u8 direct streams
  useEffect(() => {
    if (!canUseVideoJs || !activeUrl) return;
    let disposed = false;
    let localHls = null;
    const isHls = /\.m3u8(\?|$)/i.test(activeUrl);
    const video = directVideoRef.current;
    if (!video) return;

    if (hlsInstanceRef.current) {
      try { hlsInstanceRef.current.destroy(); } catch {}
      hlsInstanceRef.current = null;
    }
    video.removeAttribute('src');

    if (isHls) {
      ensureHlsJs().then((Hls) => {
        if (disposed || directVideoRef.current !== video) return;
        if (!Hls || !Hls.isSupported()) {
          video.src = activeUrl;
          video.load();
          video.play().catch(() => {});
          return;
        }
        const hls = new Hls({
          enableWorker: true,
          startFragPrefetch: true,
          lowLatencyMode: false,
          backBufferLength: 30,
          maxBufferLength: 60,
          maxMaxBufferLength: 120,
          manifestLoadingTimeOut: 15000,
          levelLoadingTimeOut: 15000,
          fragLoadingTimeOut: 30000,
          manifestLoadingMaxRetry: 3,
          levelLoadingMaxRetry: 4,
          fragLoadingMaxRetry: 4,
          fragLoadingRetryDelay: 400,
          nudgeMaxRetry: 8,
          maxBufferHole: 0.5,
          nudgeOffset: 0.2
        });
        localHls = hls;
        hlsInstanceRef.current = hls;
        hls.loadSource(activeUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          setVerifiedUrls((prev) => prev.has(activeUrl) ? prev : new Set(prev).add(activeUrl));
          video.play().catch(() => {});
        });
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (!data?.fatal) return;
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) { hls.recoverMediaError(); return; }
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) { try { hls.startLoad(); } catch {} return; }
          hlsErrorHandlerRef.current?.(activeUrl);
        });
      });
    } else {
      video.src = activeUrl;
      video.load();
      video.play().catch(() => {});
    }

    return () => {
      disposed = true;
      if (localHls) {
        try { localHls.destroy(); } catch {}
        if (hlsInstanceRef.current === localHls) hlsInstanceRef.current = null;
      }
    };
  }, [activeUrl, canUseVideoJs]);

  useEffect(() => {
    return () => {
      if (hlsInstanceRef.current) {
        try { hlsInstanceRef.current.destroy(); } catch {}
        hlsInstanceRef.current = null;
      }
    };
  }, []);

  const canEmbedSource = canUseVideoJs || activeSource?.embeddable !== false;
  // Modern movie aspect ratio (16:9 widescreen) with increased desktop height and ratio
  const desktopMediaMaxH = 'min(64vh, 660px)';
  const mobileMediaMaxH = 'min(44vh, 56.25vw)';
  const mediaMaxH = isDesktopViewport ? desktopMediaMaxH : mobileMediaMaxH;

  const videoBoxStyle = {
    width: isDesktopViewport
      ? `min(94vw, 1340px, calc(${desktopMediaMaxH} * 16 / 9))`
      : 'min(96vw, calc(96vw))',
    maxWidth: isDesktopViewport ? '1340px' : '96vw',
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column'
  };
  const mediaAreaStyle = {
    width: '100%',
    aspectRatio: '16 / 9',
    maxHeight: mediaMaxH,
    backgroundColor: 'black'
  };
  const baseVerticalShift = isDesktopViewport ? -16 : -10;
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
    const candidates = currentPlayableSources.filter((s) => !failedUrls.has(s.url));
    if (!candidates.length) return;
    const currentIndex = candidates.findIndex((source) => source.url === activeUrl);
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % candidates.length : 0;
    setActiveUrl(candidates[nextIndex]?.url || '');
    setIframeReloadKey(0);
  };

  const reloadActiveSource = useCallback(() => {
    if (!activeUrl) return;
    if (canUseVideoJs && directVideoRef.current) {
      if (hlsInstanceRef.current) {
        try { hlsInstanceRef.current.destroy(); } catch {}
        hlsInstanceRef.current = null;
      }
      directVideoRef.current.removeAttribute('src');
      const u = activeUrl;
      setActiveUrl('');
      setTimeout(() => setActiveUrl(u), 30);
      return;
    }
    setIframeReloadKey((current) => current + 1);
  }, [activeUrl, canUseVideoJs]);

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
  }, [activeUrl, displayedSources.length, selectedGroup]);

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
  }, [activeUrl, displayedSources.length, selectedGroup]);

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
          className="pointer-events-auto absolute overflow-hidden rounded-[22px] border border-white/10 bg-black shadow-2xl flex flex-col"
          style={{
            ...videoBoxStyle,
            left: '50%',
            top: '50%',
            transform: `translate(calc(-50% + ${dragOffset.x}px), calc(-50% + ${baseVerticalShift + dragOffset.y}px))`,
            transition: draggingPlayer ? 'none' : 'transform 220ms ease'
          }}
        >
          {/* Top Bar Header: Media info & Window action controls */}
          <div
            data-player-controls="true"
            data-player-drag-handle="true"
            className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 bg-black/80 px-3 sm:px-4 select-none"
            style={{ height: controlsHeight, touchAction: 'none' }}
            onPointerDown={handlePlayerPointerDown}
          >
            {/* Title & Episode info */}
            <div className="flex items-center gap-2 min-w-0">
              <span className="flex h-2 w-2 rounded-full bg-red-600 animate-pulse shrink-0" />
              <span className="truncate text-xs sm:text-sm font-semibold text-white/90">
                {request?.seriesTitle || request?.title || 'Soulstash Player'}
              </span>
              {(request?.seasonNumber || request?.episodeNumber) && (
                <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-mono text-white/70">
                  S{request.seasonNumber || 1} E{request.episodeNumber || 1}
                </span>
              )}
            </div>

            {/* Window Action Buttons */}
            <div className="flex shrink-0 items-center justify-end gap-1.5 sm:gap-2">
              <button
                type="button"
                data-player-action="true"
                onClick={reloadActiveSource}
                disabled={!activeUrl}
                className={iconButtonClass}
                aria-label="Reload stream"
                title="Reload Stream"
              >
                <i className="fas fa-redo text-xs"></i>
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
                  <i className={`${getZoomIcon()} text-xs`}></i>
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
                <i className="fas fa-external-link-alt text-xs"></i>
              </a>
              <button
                type="button"
                data-player-action="true"
                onClick={handleCloseClick}
                className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
                aria-label="Close player"
                title="Close Player"
              >
                <svg xmlns="http://www.w3.org/2000/svg" height="18" viewBox="0 -960 960 960" fill="currentColor">
                  <path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/>
                </svg>
              </button>
            </div>
          </div>

          {/* Middle: Video / Stream iframe Area */}
          <div
            className="relative flex flex-1 items-center justify-center overflow-hidden bg-black"
            style={mediaAreaStyle}
          >
            {(isFetching || (isPureKartoons && !activeUrl && !failedUrls.size)) ? (
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
                {errorDisplay || `No playable source is available in the ${selectedGroup === 'hindi' ? 'Hindi' : selectedGroup === 'dubbed' ? 'Dubbed' : 'Subbed / Original'} group.`}
              </div>
            ) : canUseVideoJs ? (
              <div className="flex h-full w-full items-center justify-center bg-black">
                <video
                  ref={directVideoRef}
                  controls
                  autoPlay
                  playsInline
                  className="w-full h-full bg-black object-contain"
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
                  referrerPolicy={activeUrl.includes('youtube.com') || activeUrl.includes('youtube-nocookie.com') || activeUrl.includes('kartoons') ? 'strict-origin-when-cross-origin' : 'no-referrer'}
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

          {/* Bottom Sources Section: Toggleable sources panel */}
          {!sourcesExpanded ? (
            <div className="shrink-0 border-t border-white/10 bg-black/95 px-3 py-2 flex items-center justify-center select-none">
              <button
                type="button"
                data-player-action="true"
                onClick={() => setSourcesExpanded(true)}
                className="inline-flex items-center gap-2 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 px-4 py-1.5 text-xs font-semibold text-white/90 transition-all shadow-sm"
                aria-label="Show streams and sources"
                title="Show Streams & Sources"
              >
                <i className="fas fa-layer-group text-[11px] text-white/70" />
                <span>Streams &amp; Sources</span>
                <span className="rounded-full bg-white/20 px-1.5 py-0.5 text-[10px] text-white font-mono">
                  {displayedSources.filter((s) => s.url && !failedUrls.has(s.url)).length}
                </span>
                <i className="fas fa-chevron-down text-[10px] text-white/60 ml-0.5" />
              </button>
            </div>
          ) : (
            <div className="shrink-0 border-t border-white/10 bg-black/95 px-3 sm:px-4 py-2.5 flex flex-col gap-2.5 select-none">
              {/* Header row: sources label + hide button */}
              <div className="flex items-center justify-between pb-1.5 border-b border-white/10">
                <div className="flex items-center gap-2">
                  <i className="fas fa-layer-group text-xs text-white/70" />
                  <span className="text-xs font-bold text-white uppercase tracking-wider">
                    Streams &amp; Sources
                  </span>
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/70 font-mono">
                    {displayedSources.filter((s) => s.url && !failedUrls.has(s.url)).length} available
                  </span>
                </div>

                <button
                  type="button"
                  data-player-action="true"
                  onClick={() => setSourcesExpanded(false)}
                  className="inline-flex items-center gap-1.5 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 px-3 py-1 text-[11px] font-semibold text-white/80 hover:text-white transition-all"
                  aria-label="Hide streams"
                  title="Hide Streams"
                >
                  <span>Hide</span>
                  <i className="fas fa-chevron-up text-[10px]" />
                </button>
              </div>

              {/* Grouped sources list: vertical stacked groups */}
              <div
                ref={scrollContainerRef}
                className="flex flex-col gap-3 max-h-[28vh] sm:max-h-[210px] overflow-y-auto filter-scrollbar pr-1"
              >
                {/* Hindi Group */}
                {availableHindi.length > 0 && (
                  <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-2.5">
                    <span className="shrink-0 text-[11px] font-bold text-white/50 sm:w-28 pt-1 uppercase tracking-wider">
                      Hindi :
                    </span>
                    <div className="flex flex-wrap items-center gap-1.5 flex-1">
                      {availableHindi.map((source) => {
                        const isActive = Boolean(activeUrl && source.url && activeUrl === source.url);
                        const isFailed = source.failed || failedUrls.has(source.url);
                        const isWorking = source.working || verifiedUrls.has(source.url) || isActive;

                        return (
                          <button
                            key={source.id}
                            type="button"
                            data-player-source="true"
                            data-active-source={isActive}
                            onClick={() => {
                              if (!source.url || isFailed) return;
                              setActiveUrl(source.url);
                              setIframeReloadKey((k) => k + 1);
                            }}
                            disabled={!source.url || isFailed}
                            className={`inline-flex items-center gap-1.5 shrink-0 rounded-full px-3 py-1 text-[11px] sm:text-xs font-semibold transition-all ${
                              isActive
                                ? 'bg-white text-black font-bold shadow-md scale-[1.02]'
                                : isFailed
                                ? 'opacity-50 bg-red-950/40 text-red-300 border border-red-800/40 cursor-not-allowed'
                                : 'bg-white/10 text-white/80 hover:bg-white/20 hover:text-white'
                            }`}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-black' : isWorking ? 'bg-emerald-400' : 'bg-white/40'}`} />
                            <span>{source.label}</span>
                            {isActive && (
                              <span className="ml-1 rounded bg-black/15 px-1 py-0.2 text-[9px] font-bold uppercase tracking-wider">
                                Playing
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Dubbed Group (hidden if no AniList ID or no dubbed sources) */}
                {effectiveAnilistId && availableDubbed.length > 0 && (
                  <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-2.5">
                    <span className="shrink-0 text-[11px] font-bold text-white/50 sm:w-28 pt-1 uppercase tracking-wider">
                      Dubbed :
                    </span>
                    <div className="flex flex-wrap items-center gap-1.5 flex-1">
                      {availableDubbed.map((source) => {
                        const isActive = Boolean(activeUrl && source.url && activeUrl === source.url);
                        const isFailed = source.failed || failedUrls.has(source.url);
                        const isWorking = source.working || verifiedUrls.has(source.url) || isActive;

                        return (
                          <button
                            key={source.id}
                            type="button"
                            data-player-source="true"
                            data-active-source={isActive}
                            onClick={() => {
                              if (!source.url || isFailed) return;
                              setActiveUrl(source.url);
                              setIframeReloadKey((k) => k + 1);
                            }}
                            disabled={!source.url || isFailed}
                            className={`inline-flex items-center gap-1.5 shrink-0 rounded-full px-3 py-1 text-[11px] sm:text-xs font-semibold transition-all ${
                              isActive
                                ? 'bg-white text-black font-bold shadow-md scale-[1.02]'
                                : isFailed
                                ? 'opacity-50 bg-red-950/40 text-red-300 border border-red-800/40 cursor-not-allowed'
                                : 'bg-white/10 text-white/80 hover:bg-white/20 hover:text-white'
                            }`}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-black' : isWorking ? 'bg-emerald-400' : 'bg-white/40'}`} />
                            <span>{source.label}</span>
                            {isActive && (
                              <span className="ml-1 rounded bg-black/15 px-1 py-0.2 text-[9px] font-bold uppercase tracking-wider">
                                Playing
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Subbed / Original Group */}
                {availableSubbed.length > 0 && (
                  <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-2.5">
                    <span className="shrink-0 text-[11px] font-bold text-white/50 sm:w-28 pt-1 uppercase tracking-wider">
                      Subbed / Original :
                    </span>
                    <div className="flex flex-wrap items-center gap-1.5 flex-1">
                      {availableSubbed.map((source) => {
                        const isActive = Boolean(activeUrl && source.url && activeUrl === source.url);
                        const isFailed = source.failed || failedUrls.has(source.url);
                        const isWorking = source.working || verifiedUrls.has(source.url) || isActive;

                        return (
                          <button
                            key={source.id}
                            type="button"
                            data-player-source="true"
                            data-active-source={isActive}
                            onClick={() => {
                              if (!source.url || isFailed) return;
                              setActiveUrl(source.url);
                              setIframeReloadKey((k) => k + 1);
                            }}
                            disabled={!source.url || isFailed}
                            className={`inline-flex items-center gap-1.5 shrink-0 rounded-full px-3 py-1 text-[11px] sm:text-xs font-semibold transition-all ${
                              isActive
                                ? 'bg-white text-black font-bold shadow-md scale-[1.02]'
                                : isFailed
                                ? 'opacity-50 bg-red-950/40 text-red-300 border border-red-800/40 cursor-not-allowed'
                                : 'bg-white/10 text-white/80 hover:bg-white/20 hover:text-white'
                            }`}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-black' : isWorking ? 'bg-emerald-400' : 'bg-white/40'}`} />
                            <span>{source.label}</span>
                            {isActive && (
                              <span className="ml-1 rounded bg-black/15 px-1 py-0.2 text-[9px] font-bold uppercase tracking-wider">
                                Playing
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
