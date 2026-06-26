import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { NavbarSkeleton, SearchResultSkeletonGrid } from '../ui/Skeletons/index.js';
import { HoverMarqueeTitle } from '../ui/Misc/Typography.jsx';
import { getOverlayColumnCount, mergeSearchResults, getSearchHistory, saveSearchHistoryItem } from '../../utils/helpers.js';
import { imageUrl, yearFrom, mediaRoute } from '../../utils/formatters.js';
import { FALLBACK_AVATAR } from '../../utils/constants.js';
import { getToken, getCurrentUsername, cachedApiFetch, streamApiFetch } from '../../api/client.js';
import { useAuthSession } from '../../hooks/index.js';

function NavbarSearchOverlay({ open, onClose, query, setQuery, results, loading, tab, setTab, navigate }) {
  const overlayInputRef = useRef(null);
  const resultsScrollerRef = useRef(null);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const resultButtonsRef = useRef([]);
  const tabButtonsRef = useRef([]);

  useEffect(() => {
    if (!open) return undefined;
    const originalBodyOverflow = document.body.style.overflow;
    const originalHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    const frame = window.requestAnimationFrame(() => { overlayInputRef.current?.focus(); });
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = originalBodyOverflow;
      document.documentElement.style.overflow = originalHtmlOverflow;
    };
  }, [open]);

  const historyItems = useMemo(() => getSearchHistory(), [open]);
  const activeResults = useMemo(() => {
    const source = query.trim().length >= 2 ? results : historyItems;
    return source.filter((item) => {
      if (tab === 'content') return ['Movie', 'Series', 'tv'].includes(item.media_type);
      if (tab === 'cast') return item.media_type === 'Person';
      if (tab === 'users') return item.media_type === 'User';
      return true;
    });
  }, [historyItems, query, results, tab]);

  useEffect(() => { resultButtonsRef.current = []; }, [activeResults]);
  useEffect(() => { setFocusedIndex(-1); }, [query]);

  const focusedIndexRef = useRef(-1);
  focusedIndexRef.current = focusedIndex;
  const activeResultsRef = useRef([]);
  activeResultsRef.current = activeResults;

  useEffect(() => {
    if (!open) return undefined;
    function handleOverlayKeys(event) {
      if (event.key === 'Escape') { onClose(); return; }
      const resultsList = activeResultsRef.current;
      const index = focusedIndexRef.current;
      const cols = getOverlayColumnCount();
      const tabValues = ['content', 'cast', 'users'];
      const activeTabIdx = tab === 'content' ? 0 : tab === 'cast' ? 1 : 2;
      if (index === -1) {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          const targetFocus = -2 - activeTabIdx;
          setFocusedIndex(targetFocus);
          tabButtonsRef.current[activeTabIdx]?.focus();
        }
      } else if (index < -1) {
        const currentTabIdx = -index - 2;
        if (event.key === 'ArrowRight') {
          event.preventDefault();
          if (currentTabIdx < 2) { const nextIdx = currentTabIdx + 1; setFocusedIndex(-2 - nextIdx); setTab(tabValues[nextIdx]); tabButtonsRef.current[nextIdx]?.focus(); }
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault();
          if (currentTabIdx > 0) { const prevIdx = currentTabIdx - 1; setFocusedIndex(-2 - prevIdx); setTab(tabValues[prevIdx]); tabButtonsRef.current[prevIdx]?.focus(); }
        } else if (event.key === 'ArrowUp') {
          event.preventDefault(); setFocusedIndex(-1); overlayInputRef.current?.focus();
        } else if (event.key === 'ArrowDown') {
          event.preventDefault();
          if (resultsList.length > 0) { setFocusedIndex(0); resultButtonsRef.current[0]?.focus(); resultButtonsRef.current[0]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
        }
      } else {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          const nextIndex = index + cols;
          if (nextIndex < resultsList.length) { setFocusedIndex(nextIndex); resultButtonsRef.current[nextIndex]?.focus(); resultButtonsRef.current[nextIndex]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
          else if (index < resultsList.length - 1) { const lastIdx = resultsList.length - 1; setFocusedIndex(lastIdx); resultButtonsRef.current[lastIdx]?.focus(); }
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          const prevIndex = index - cols;
          if (prevIndex < 0) { setFocusedIndex(-2 - activeTabIdx); tabButtonsRef.current[activeTabIdx]?.focus(); }
          else { setFocusedIndex(prevIndex); resultButtonsRef.current[prevIndex]?.focus(); resultButtonsRef.current[prevIndex]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
        } else if (event.key === 'ArrowRight' && index < resultsList.length - 1) {
          event.preventDefault(); const nextIndex = index + 1; setFocusedIndex(nextIndex); resultButtonsRef.current[nextIndex]?.focus();
        } else if (event.key === 'ArrowLeft' && index > 0) {
          event.preventDefault(); const prevIndex = index - 1; setFocusedIndex(prevIndex); resultButtonsRef.current[prevIndex]?.focus();
        } else if (event.key === 'Enter') {
          event.preventDefault(); openItem(resultsList[index]);
        }
      }
    }
    window.addEventListener('keydown', handleOverlayKeys, true);
    return () => window.removeEventListener('keydown', handleOverlayKeys, true);
  }, [open, onClose, tab]);

  function openItem(item) {
    saveSearchHistoryItem(item);
    onClose();
    if (item.media_type === 'Person') { navigate(`/person/${item.id}`); return; }
    if (item.media_type === 'User') { navigate(`/user/${encodeURIComponent(item.username || item.title || item.name)}`); return; }
    navigate(mediaRoute(item));
  }

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-[9998] bg-black/55 backdrop-blur-sm" onClick={onClose}></div>
      <div
        data-search-overlay="true"
        onWheel={(event) => event.stopPropagation()}
        onTouchMove={(event) => event.stopPropagation()}
        className="fixed left-[5vw] right-[5vw] top-[calc(64px+env(safe-area-inset-top,0px))] z-[9999] h-[70vh] w-[90vw] overflow-hidden rounded-b-[28px] border border-[#252833] bg-[#0F0F0F] shadow-[0_24px_60px_rgba(0,0,0,0.45)]"
      >
        <div className="flex h-full flex-col overflow-hidden px-4 sm:px-5 md:px-6">
          <div className="sticky top-0 z-10 bg-[rgba(15,15,15,0.98)] pb-3 pt-4">
            <div className="relative">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
                <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#A0A0A0]">
                  <circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path>
                </svg>
              </div>
              <input
                ref={overlayInputRef}
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search for Movies, Shows, Anime, Cast & Crew or Users..."
                className="h-14 w-full rounded-lg border border-[#353945] bg-[#171717] pl-12 pr-12 text-[#E2E2E2] outline-none transition-all placeholder:text-[#707070] focus:border-white/20"
              />
              <button type="button" onClick={() => { setQuery(''); overlayInputRef.current?.focus(); }}
                className="absolute inset-y-0 right-0 flex items-center pr-4 text-[#a0a0a0] hover:text-white" aria-label="Clear search">
                <svg xmlns="http://www.w3.org/2000/svg" height="22" viewBox="0 -960 960 960" fill="currentColor">
                  <path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/>
                </svg>
              </button>
            </div>
          </div>
          <div className="mb-6 mt-3 flex items-center space-x-8 border-b border-[#252833] pb-1">
            {[['content','Content',-2],['cast','Cast & Crew',-3],['users','Users',-4]].map(([value, label, tabIdxVal], index) => (
              <button key={value} ref={(el) => { tabButtonsRef.current[index] = el; }} type="button" tabIndex={0}
                className={`relative pb-1 text-sm font-medium transition-all duration-200 outline-none ${tab === value ? 'text-white' : 'text-[#A0A0A0] hover:text-[#E2E2E2]'} ${focusedIndex === tabIdxVal ? 'ring-2 ring-white/60 px-2 rounded bg-white/[0.08]' : ''}`}
                onClick={() => setTab(value)} onFocus={() => setFocusedIndex(tabIdxVal)}>
                {label}
                {tab === value ? <span className="absolute inset-x-0 -bottom-[5px] h-0.5 rounded-full bg-white"></span> : null}
              </button>
            ))}
          </div>
          <div ref={resultsScrollerRef} className="flex-1 overflow-y-auto overscroll-contain pb-6">
            {loading ? (
              <SearchResultSkeletonGrid columns="grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4" count={8} />
            ) : activeResults.length ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                {activeResults.map((item, index) => {
                  const title = item.title || item.name || item.username || 'Unknown';
                  const image = item.media_type === 'User' ? (item.avatar || item.poster_path) : item.poster_path || item.profile_path;
                  const meta = item.media_type === 'User'
                    ? (item.fullName || item.bio || 'Soulstash user')
                    : item.media_type === 'Person'
                      ? 'Cast & Crew'
                      : `${item.media_type === 'Series' || item.media_type === 'tv' ? 'Series' : 'Movie'}${yearFrom(item) ? ` | ${yearFrom(item)}` : ''}`;
                  return (
                    <button key={`${item.media_type}-${item.id || item.username || index}`}
                      ref={(el) => { resultButtonsRef.current[index] = el; }}
                      type="button" tabIndex={0}
                      onClick={() => openItem(item)}
                      onFocus={() => setFocusedIndex(index)}
                      className={`flex items-center gap-3 rounded-lg p-3 text-left transition-all border outline-none ${focusedIndex === index ? 'bg-white/[0.08] border-white ring-2 ring-white/20' : 'bg-[#171717] border-transparent hover:bg-[#1d1d1d]'}`}>
                      <div className="h-20 w-14 shrink-0 overflow-hidden rounded-md bg-[#252833]">
                        {image ? (
                          <img src={item.media_type === 'User' ? image : imageUrl(image, 'w300_and_h450_face')} alt={title}
                            className="h-full w-full object-cover"
                            onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = FALLBACK_AVATAR; }} />
                        ) : (
                          <img src={FALLBACK_AVATAR} alt={title} className="h-full w-full object-cover" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1 overflow-hidden">
                        <h3 className="text-sm font-semibold text-[#E2E2E2] overflow-hidden">
                          <HoverMarqueeTitle title={title} />
                        </h3>
                        <p className="mt-1 line-clamp-2 text-xs text-[#9da0a9]">{meta}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center p-8 text-center">
                <div className="mb-4 rounded-full bg-[#171717] p-4">
                  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#505050]">
                    <circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path>
                  </svg>
                </div>
                <p className="text-sm text-[#A0A0A0]">{query.trim().length >= 2 ? 'No results found' : 'No recent searches'}</p>
                <p className="mt-1 text-xs text-[#707070]">{query.trim().length >= 2 ? 'Try searching with different keywords' : 'Your search history will appear here'}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}


export function ReactNavbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useAuthSession();
  const { isLoggedIn, username } = auth;
  const [navReady, setNavReady] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchTab, setSearchTab] = useState('content');
  const searchCacheRef = useRef(new Map());
  const navRef = useRef(null);

  useEffect(() => {
    setNavReady(true);
  }, []);


  // D-pad navigation is handled globally by tvNav.js (useTvFocus in AppShell).
  // The old per-navbar handler has been removed.



  useEffect(() => {
    setSearchOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const handleOpenSearch = (e) => {
      if (e.detail?.query) {
        setSearchQuery(e.detail.query);
        setSearchTab('content');
      }
      setSearchOpen(true);
    };
    window.addEventListener('soulstash:open-search', handleOpenSearch);
    return () => window.removeEventListener('soulstash:open-search', handleOpenSearch);
  }, []);

  useEffect(() => {
    searchCacheRef.current.clear();
    setSearchResults([]);
  }, [auth.user?.admin, auth.user?.showAdult]);

  useEffect(() => {
    if (!searchOpen || searchQuery.trim().length < 2) {
      setSearchLoading(false);
      if (searchQuery.trim().length < 2) {
        setSearchResults([]);
      }
      return undefined;
    }

    let ignore = false;
    const controller = new AbortController();
    const cacheKey = `${searchTab}:${searchQuery.trim().toLowerCase()}`;
    const cached = searchCacheRef.current.get(cacheKey);
    const now = Date.now();
    const cacheTtl = searchTab === 'users' ? 5000 : 30000;
    if (cached && now - cached.timestamp < cacheTtl) {
      setSearchResults(cached.results);
      setSearchLoading(false);
      return undefined;
    }
    setSearchLoading(true);
    setSearchResults([]);
    const timeout = window.setTimeout(async () => {
      try {
        if (searchTab !== 'users') {
          const streamedResults = [];
          await streamApiFetch(
            `/api/search?q=${encodeURIComponent(searchQuery.trim())}&limit=20&type=${encodeURIComponent(searchTab)}&stream=1`,
            {
              signal: controller.signal,
              onEvent(event) {
                if (ignore || event?.query !== searchQuery.trim() || event?.type !== 'results') return;
                const incoming = Array.isArray(event.results) ? event.results : [];
                const nextResults = mergeSearchResults(streamedResults, incoming, 40);
                streamedResults.splice(0, streamedResults.length, ...nextResults);
                searchCacheRef.current.set(cacheKey, { results: nextResults, timestamp: Date.now() });
                setSearchResults(nextResults);
                setSearchLoading(false);
              }
            }
          );
          if (!ignore) {
            setSearchLoading(false);
          }
          return;
        }

        const payload = await cachedApiFetch(
          `/api/search?q=${encodeURIComponent(searchQuery.trim())}&limit=20&type=${encodeURIComponent(searchTab)}`,
          {},
          5000
        );
        if (!ignore) {
          const results = Array.isArray(payload?.results) ? payload.results : [];
          const safeResults = mergeSearchResults([], results, 20);
          searchCacheRef.current.set(cacheKey, { results: safeResults, timestamp: Date.now() });
          setSearchResults(safeResults);
        }
      } catch (error) {
        if (error?.name === 'AbortError') return;
        if (!ignore) {
          setSearchResults([]);
        }
      } finally {
        if (!ignore) {
          setSearchLoading(false);
        }
      }
    }, 220);

    return () => {
      ignore = true;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [auth.user?.admin, auth.user?.showAdult, searchOpen, searchQuery, searchTab]);

  const currentPath = location.pathname;
  const navItems = [
    {
      label: 'Watched',
      active: /\/user\/[^/]+\/collection\/Watched$/i.test(currentPath),
      onClick: () => {
        if (!isLoggedIn || !username) return navigate('/login');
        navigate(`/user/${username}/collection/Watched`);
      },
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="nav-link-icon">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
          <circle cx="12" cy="12" r="3"></circle>
        </svg>
      )
    },
    {
      label: 'Watchlist',
      active: /\/user\/[^/]+\/collection\/Watchlist$/i.test(currentPath),
      onClick: () => {
        if (!isLoggedIn || !username) return navigate('/login');
        navigate(`/user/${username}/collection/Watchlist`);
      },
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="nav-link-icon">
          <circle cx="12" cy="12" r="10"></circle>
          <polyline points="12 6 12 12 16 14"></polyline>
        </svg>
      )
    },
    {
      label: 'Collection',
      active:
        /\/user\/[^/]+\/collections$/i.test(currentPath) ||
        (/\/user\/[^/]+\/collection\/.+$/i.test(currentPath) && !/\/user\/[^/]+\/collection\/(Watched|Watchlist)$/i.test(currentPath)) ||
        currentPath === '/collections',
      onClick: () => {
        if (!isLoggedIn || !username) return navigate('/login');
        navigate(`/user/${username}/collections`);
      },
      icon: (
        <svg fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24" className="nav-link-icon" style={{ width: 24, height: 24 }}>
          <circle cx="6" cy="6" r="3"></circle>
          <rect x="12" y="3" width="6" height="6" rx="1"></rect>
          <rect x="3" y="12" width="6" height="6" rx="1"></rect>
          <circle cx="15" cy="15" r="3"></circle>
        </svg>
      )
    }
  ];

  const mobileItems = [
    {
      label: 'Home',
      active: currentPath === '/',
      onClick: () => navigate('/'),
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="nav-link-icon">
          <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
          <polyline points="9 22 9 12 15 12 15 22"></polyline>
        </svg>
      )
    },
    ...navItems,
    {
      label: isLoggedIn && username ? 'Profile' : 'Login',
      active: isLoggedIn ? /^\/user\/[^/]+$/i.test(currentPath) : currentPath === '/login',
      onClick: () => {
        if (!isLoggedIn || !username) return navigate('/login');
        navigate(`/user/${username}`);
      },
      icon: isLoggedIn ? (
        <div className="relative w-6 h-6 flex items-center justify-center flex-shrink-0">
          <div className="relative w-6 h-6 rounded-full overflow-hidden border border-[#474747] flex items-center justify-center">
            <img alt="Profile" className="object-cover rounded-full absolute inset-0 h-full w-full" src={FALLBACK_AVATAR} />
          </div>
        </div>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="nav-link-icon">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
          <circle cx="12" cy="7" r="4"></circle>
        </svg>
      )
    }
  ];
  const authCta =
    currentPath === '/login'
      ? { label: 'Sign Up', iconLabel: 'Sign Up', onClick: () => navigate('/register') }
      : currentPath === '/register'
        ? { label: 'Sign In', iconLabel: 'Sign In', onClick: () => navigate('/login') }
        : { label: 'Sign In', iconLabel: 'Sign In', onClick: () => navigate('/login') };

  if (!navReady) {
    return <NavbarSkeleton />;
  }

  return (
    <>
      <header className="modern-navbar-react" ref={navRef}>
        <div className="navbar-container">
          <div className="navbar-logo">
            <button type="button" className="navbar-logo bg-transparent border-0 p-0" onClick={() => navigate('/')}>
              <img src={`${import.meta.env.BASE_URL}images/logo.png`} alt="Soulstash Logo" className="logo-img" height="100%" onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = FALLBACK_AVATAR; }} />
            </button>
          </div>

          <div className="nav-links">
            {navItems.map((item) => (
              <button key={item.label} type="button" data-nav={item.label} className={`nav-link ${item.active ? 'active' : ''}`} onClick={item.onClick}>
                <div className="nav-link-content">
                  {item.icon}
                  <span className="nav-link-text">{item.label}</span>
                  <div className="nav-link-underline"></div>
                </div>
              </button>
            ))}
          </div>

          <div className="mobile-actions">
            <button className="mobile-btn" aria-label="Search" type="button" onClick={() => setSearchOpen((current) => !current)}>
              {searchOpen ? (
                <svg xmlns="http://www.w3.org/2000/svg" height="22" viewBox="0 -960 960 960" fill="currentColor" className="w-5 h-5 text-[#E2E2E2]">
                  <path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/>
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 text-[#E2E2E2]">
                  <circle cx="11" cy="11" r="8"></circle>
                  <path d="m21 21-4.3-4.3"></path>
                </svg>
              )}
            </button>
          </div>

          <div className="desktop-actions">
            <button className="mobile-btn" aria-label="Search" type="button" onClick={() => setSearchOpen((current) => !current)}>
              {searchOpen ? (
                <svg xmlns="http://www.w3.org/2000/svg" height="22" viewBox="0 -960 960 960" fill="currentColor" className="w-5 h-5 text-[#E2E2E2]">
                  <path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/>
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 text-[#E2E2E2]">
                  <circle cx="11" cy="11" r="8"></circle>
                  <path d="m21 21-4.3-4.3"></path>
                </svg>
              )}
            </button>
            {isLoggedIn && username ? (
              <button type="button" className="profile-btn" onClick={() => navigate(`/user/${username}`)}>
                <img src={FALLBACK_AVATAR} alt="Profile" className="profile-avatar" />
              </button>
            ) : (
              <button type="button" className="signin-btn inline-flex items-center gap-1.5" onClick={authCta.onClick}>
                <i className={`fas ${authCta.iconLabel === 'Sign Up' ? 'fa-user-plus' : 'fa-right-to-bracket'} text-[11px]`}></i>
                <span>{authCta.label}</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <nav className="mobile-bottom-nav-react md:hidden">
        <div className="mobile-bottom-nav-react__inner">
          {mobileItems.map((item) => (
            <button
              key={item.label}
              type="button"
              className={`mobile-bottom-nav-react__item ${item.active ? 'is-active' : ''}`}
              aria-label={item.label}
              onClick={item.onClick}
            >
              {item.icon}
              <span className="mobile-bottom-nav-react__label">{item.label}</span>
            </button>
          ))}
        </div>
      </nav>
      <NavbarSearchOverlay
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        query={searchQuery}
        setQuery={setSearchQuery}
        results={searchResults}
        loading={searchLoading}
        tab={searchTab}
        setTab={setSearchTab}
        navigate={navigate}
      />
    </>
  );
}