import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useLocation, matchPath } from 'react-router-dom';
import { NavbarSkeleton } from '../ui/Skeletons/index.js';
import { FALLBACK_AVATAR, FALLBACK_LOGO } from '../../utils/constants.js';
import { useAuthSession } from '../../hooks/index.js';
import { clearAuthSession } from '../../api/client.js';
import { toast } from '../../utils/toast.js';
import { NavbarSearchOverlay } from './NavbarSearchOverlay.jsx';
import { useSearchAutocomplete } from '../../hooks/useSearchAutocomplete.js';
import { useAppLayoutMode } from '../../hooks/useAppLayoutMode.js';
import { SettingsModal } from '../ui/Modals/SettingsModal.jsx';
import { WatchedIcon, WatchlistIcon, CollectionIcon, HomeIcon, ProfileIcon, SearchIcon, CloseIcon } from './NavIcons.jsx';

export function ReactNavbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useAuthSession();
  const { isLoggedIn, username } = auth;
  const [navReady, setNavReady] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchTab, setSearchTab] = useState('content');
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const profileMenuRef = useRef(null);
  const navRef = useRef(null);

  const {
    layoutPreference,
    setLayoutPreference,
    isTvLayout,
    isMobileLayout,
    isDesktopLayout
  } = useAppLayoutMode();

  const {
    searchResults,
    searchLoading,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage
  } = useSearchAutocomplete(
    searchQuery,
    searchTab,
    searchOpen,
    auth.user
  );

  useEffect(() => {
    setNavReady(true);
  }, []);

  useEffect(() => {
    setSearchOpen(false);
    setProfileDropdownOpen(false);
  }, [location.pathname]);

  // Close profile dropdown when clicking outside
  useEffect(() => {
    if (!profileDropdownOpen) return;
    const handleClickOutside = (e) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target)) {
        setProfileDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [profileDropdownOpen]);

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

  const currentPath = location.pathname;

  const navItems = useMemo(() => {
    const isWatched = !!matchPath("/user/:user/collection/Watched", currentPath);
    const isWatchlist = !!matchPath("/user/:user/collection/Watchlist", currentPath);
    const isCollections = !!matchPath("/user/:user/collections", currentPath) || currentPath === '/collections';
    const isCustomCollection = !!matchPath("/user/:user/collection/:id", currentPath) && !isWatched && !isWatchlist;

    return [
      {
        label: 'Watched',
        active: isWatched,
        onClick: () => {
          if (!isLoggedIn || !username) return navigate('/login');
          navigate(`/user/${username}/collection/Watched`);
        },
        icon: <WatchedIcon />
      },
      {
        label: 'Watchlist',
        active: isWatchlist,
        onClick: () => {
          if (!isLoggedIn || !username) return navigate('/login');
          navigate(`/user/${username}/collection/Watchlist`);
        },
        icon: <WatchlistIcon />
      },
      {
        label: 'Collection',
        active: isCollections || isCustomCollection,
        onClick: () => {
          if (!isLoggedIn || !username) return navigate('/login');
          navigate(`/user/${username}/collections`);
        },
        icon: <CollectionIcon />
      }
    ];
  }, [currentPath, isLoggedIn, username, navigate]);

  const mobileItems = useMemo(() => {
    const isProfile = !!matchPath("/user/:user", currentPath);
    
    return [
      {
        label: 'Home',
        active: currentPath === '/',
        onClick: () => navigate('/'),
        icon: <HomeIcon />
      },
      ...navItems,
      {
        label: isLoggedIn && username ? 'Profile' : 'Login',
        active: isLoggedIn ? isProfile : currentPath === '/login',
        onClick: () => {
          if (!isLoggedIn || !username) return navigate('/login');
          navigate(`/user/${username}`);
        },
        icon: isLoggedIn ? (
          <div className="relative w-6 h-6 flex items-center justify-center flex-shrink-0">
            <div className="relative w-6 h-6 rounded-full overflow-hidden border border-[#474747] flex items-center justify-center">
              <img alt="Profile" className="object-cover object-top rounded-full absolute inset-0 h-full w-full" src={auth?.user?.avatar || FALLBACK_AVATAR} />
            </div>
          </div>
        ) : <ProfileIcon />
      }
    ];
  }, [currentPath, navItems, isLoggedIn, username, navigate, auth?.user?.avatar]);

  const authCta = useMemo(() => (
    currentPath === '/login'
      ? { label: 'Sign Up', iconLabel: 'Sign Up', onClick: () => navigate('/register') }
      : { label: 'Sign In', iconLabel: 'Sign In', onClick: () => navigate('/login') }
  ), [currentPath, navigate]);

  const handleLogout = () => {
    clearAuthSession();
    setProfileDropdownOpen(false);
    toast('Logged out successfully');
    navigate('/login');
  };

  if (!navReady) {
    return <NavbarSkeleton />;
  }

  return (
    <>
      {/* ── TV Left Sidebar Navbar (Active in TV mode or when width > height) ── */}
      {isTvLayout && (
        <aside
          className="fixed inset-y-0 left-0 z-[1000] flex w-16 sm:w-20 flex-col items-center justify-between border-r border-white/10 bg-black/90 py-4 shadow-2xl backdrop-blur-xl select-none"
          aria-label="TV Sidebar Navigation"
        >
          {/* Top Logo */}
          <div className="flex flex-col items-center gap-4">
            <button
              type="button"
              className="group flex h-11 w-11 items-center justify-center rounded-2xl bg-white/[0.04] p-1.5 hover:bg-white/15 transition-all active:scale-95"
              onClick={() => navigate('/')}
              title="Home"
            >
              <img
                src={`${import.meta.env.BASE_URL}images/logo.png`}
                alt="Soulstash"
                className="h-full w-full object-contain"
                onError={(e) => { e.currentTarget.src = FALLBACK_LOGO; }}
              />
            </button>
          </div>

          {/* Middle Navigation Icons */}
          <nav className="flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={() => navigate('/')}
              className={`flex h-11 w-11 items-center justify-center rounded-2xl transition-all ${
                currentPath === '/' ? 'bg-white text-black font-bold shadow-lg scale-105' : 'text-white/70 hover:bg-white/15 hover:text-white'
              }`}
              title="Home"
              aria-label="Home"
            >
              <HomeIcon />
            </button>

            {navItems.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={item.onClick}
                className={`flex h-11 w-11 items-center justify-center rounded-2xl transition-all ${
                  item.active ? 'bg-white text-black font-bold shadow-lg scale-105' : 'text-white/70 hover:bg-white/15 hover:text-white'
                }`}
                title={item.label}
                aria-label={item.label}
              >
                {item.icon}
              </button>
            ))}

            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="flex h-11 w-11 items-center justify-center rounded-2xl text-white/70 hover:bg-white/15 hover:text-white transition-all"
              title="Search"
              aria-label="Search"
            >
              <SearchIcon />
            </button>
          </nav>

          {/* Bottom Settings & Profile / Login */}
          <div className="flex flex-col items-center gap-3 relative" ref={profileMenuRef}>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/80 hover:bg-white/20 hover:text-white transition-all"
              title="Settings &amp; Layout"
              aria-label="Settings"
            >
              <i className="fas fa-cog text-sm" />
            </button>

            {isLoggedIn && username ? (
              <>
                <button
                  type="button"
                  onClick={() => setProfileDropdownOpen((prev) => !prev)}
                  className="relative flex h-10 w-10 items-center justify-center rounded-full overflow-hidden border border-white/20 hover:border-white transition-all active:scale-95"
                  title={`${username} profile`}
                >
                  <img
                    src={auth?.user?.avatar || FALLBACK_AVATAR}
                    alt="Profile"
                    className="h-full w-full object-cover object-top"
                  />
                </button>

                {profileDropdownOpen && (
                  <div className="absolute bottom-2 left-16 sm:left-20 w-48 rounded-2xl border border-white/10 bg-[#16181d] p-1.5 shadow-2xl text-xs z-[1001] animate-in fade-in zoom-in-95 duration-150">
                    <div className="px-3 py-2 border-b border-white/10 text-white/60 truncate font-semibold">
                      @{username}
                    </div>
                    <button
                      type="button"
                      onClick={() => { setProfileDropdownOpen(false); navigate(`/user/${username}`); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-white/80 hover:bg-white/10 hover:text-white transition-colors text-left"
                    >
                      <i className="fas fa-user text-xs w-4"></i>
                      <span>Profile</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => { setProfileDropdownOpen(false); setSettingsOpen(true); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-white/80 hover:bg-white/10 hover:text-white transition-colors text-left"
                    >
                      <i className="fas fa-cog text-xs w-4"></i>
                      <span>Settings</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-rose-400 hover:bg-rose-500/10 transition-colors text-left font-medium"
                    >
                      <i className="fas fa-sign-out-alt text-xs w-4"></i>
                      <span>Log Out</span>
                    </button>
                  </div>
                )}
              </>
            ) : (
              <button
                type="button"
                onClick={authCta.onClick}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/80 hover:bg-white/20 hover:text-white transition-all"
                title="Sign In"
                aria-label="Sign In"
              >
                <i className="fas fa-right-to-bracket text-xs" />
              </button>
            )}
          </div>
        </aside>
      )}

      {/* ── Standard Top Header Navbar (Hidden in TV layout mode) ── */}
      {!isTvLayout && (
        <header className="modern-navbar-react" ref={navRef}>
          <div className="navbar-container">
            <div className="navbar-logo">
              <button type="button" className="navbar-logo bg-transparent border-0 p-0" onClick={() => navigate('/')}>
                <img
                  src={`${import.meta.env.BASE_URL}images/logo.png`}
                  alt="Soulstash Logo"
                  className="logo-img"
                  height="100%"
                  onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = FALLBACK_LOGO; }}
                />
              </button>
            </div>

            {/* Desktop Center Links */}
            <div className="nav-links">
              {navItems.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  data-nav={item.label}
                  className={`nav-link ${item.active ? 'active' : ''}`}
                  onClick={item.onClick}
                >
                  <div className="nav-link-content">
                    {item.icon}
                    <span className="nav-link-text">{item.label}</span>
                    <div className="nav-link-underline"></div>
                  </div>
                </button>
              ))}
            </div>

            {/* Mobile Actions: Search button, followed by Setting button. NO profile in top navbar! */}
            <div className="mobile-actions flex items-center gap-2">
              <button
                className="mobile-btn tv-focus-icon"
                aria-label="Search"
                type="button"
                onClick={() => setSearchOpen((current) => !current)}
              >
                {searchOpen ? <CloseIcon /> : <SearchIcon />}
              </button>
              <button
                className="mobile-btn tv-focus-icon"
                aria-label="Settings"
                type="button"
                onClick={() => setSettingsOpen(true)}
              >
                <i className="fas fa-cog text-sm" />
              </button>
            </div>

            {/* Desktop Actions: Search button, followed by Profile avatar dropdown */}
            <div className="desktop-actions flex items-center gap-3 relative" ref={profileMenuRef}>
              <button
                className="mobile-btn tv-focus-icon"
                aria-label="Search"
                type="button"
                onClick={() => setSearchOpen((current) => !current)}
              >
                {searchOpen ? <CloseIcon /> : <SearchIcon />}
              </button>

              {isLoggedIn && username ? (
                <>
                  <button
                    type="button"
                    className="profile-btn"
                    onClick={() => setProfileDropdownOpen((prev) => !prev)}
                    aria-label="User profile menu"
                  >
                    <img
                      src={auth?.user?.avatar || FALLBACK_AVATAR}
                      alt="Profile"
                      className="profile-avatar object-cover object-top"
                    />
                  </button>

                  {/* Desktop Profile Dropdown (Profile, Settings, Logout) */}
                  {profileDropdownOpen && (
                    <div className="absolute right-0 top-12 w-48 rounded-2xl border border-white/10 bg-[#16181d] p-1.5 shadow-2xl text-xs z-[1001] animate-in fade-in zoom-in-95 duration-150">
                      <div className="px-3 py-2 border-b border-white/10 text-white/60 truncate font-semibold">
                        @{username}
                      </div>
                      <button
                        type="button"
                        onClick={() => { setProfileDropdownOpen(false); navigate(`/user/${username}`); }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-white/80 hover:bg-white/10 hover:text-white transition-colors text-left"
                      >
                        <i className="fas fa-user text-xs w-4"></i>
                        <span>Profile</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => { setProfileDropdownOpen(false); setSettingsOpen(true); }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-white/80 hover:bg-white/10 hover:text-white transition-colors text-left"
                      >
                        <i className="fas fa-cog text-xs w-4"></i>
                        <span>Settings</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleLogout}
                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-rose-400 hover:bg-rose-500/10 transition-colors text-left font-medium"
                      >
                        <i className="fas fa-sign-out-alt text-xs w-4"></i>
                        <span>Log Out</span>
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <button type="button" className="signin-btn inline-flex items-center gap-1.5" onClick={authCta.onClick}>
                  <i className={`fas ${authCta.iconLabel === 'Sign Up' ? 'fa-user-plus' : 'fa-right-to-bracket'} text-[11px]`}></i>
                  <span>{authCta.label}</span>
                </button>
              )}
            </div>
          </div>
        </header>
      )}

      {/* ── Mobile Bottom Navigation Bar (Hidden in TV layout) ── */}
      {!isTvLayout && (
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
      )}

      {/* Search Overlay */}
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
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        fetchNextPage={fetchNextPage}
      />

      {/* Settings Modal */}
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        layoutMode={layoutPreference}
        setLayoutMode={setLayoutPreference}
      />
    </>
  );
}
