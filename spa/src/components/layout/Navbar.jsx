import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useLocation, matchPath } from 'react-router-dom';
import { NavbarSkeleton } from '../ui/Skeletons/index.js';
import { FALLBACK_AVATAR, FALLBACK_LOGO } from '../../utils/constants.js';
import { useAuthSession } from '../../hooks/index.js';
import { clearAuthSession } from '../../api/client.js';
import { toast } from '../../utils/toast.js';
import { applyFocus } from '../../utils/spatialCore.js';
import { NavbarSearchOverlay } from './NavbarSearchOverlay.jsx';
import { useSearchAutocomplete } from '../../hooks/useSearchAutocomplete.js';
import { useAppLayoutMode } from '../../hooks/useAppLayoutMode.js';
import { SettingsModal } from '../ui/Modals/SettingsModal.jsx';
import { ListsIcon, UpcomingIcon, CollectionIcon, HomeIcon, ProfileIcon, SearchIcon, CloseIcon } from './NavIcons.jsx';

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
  const [tvProfileOpen, setTvProfileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const profileMenuRef = useRef(null);
  const profileTriggerRef = useRef(null);
  const tvProfileRef = useRef(null);
  const navRef = useRef(null);

  const {
    verticalPreference,
    landscapePreference,
    setVerticalPreference,
    setLandscapePreference,
    isTvLayout,
    isMobileLayout,
    isDesktopLayout,
    isVertical,
    isLandscape
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
    setTvProfileOpen(false);
  }, [location.pathname]);

  // Close profile dropdowns when clicking outside
  useEffect(() => {
    if (!profileDropdownOpen && !tvProfileOpen) return;
    const handleClickOutside = (e) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target)) {
        setProfileDropdownOpen(false);
      }
      if (tvProfileRef.current && !tvProfileRef.current.contains(e.target)) {
        setTvProfileOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [profileDropdownOpen, tvProfileOpen]);

  useEffect(() => {
    const handleOpenSearch = (e) => {
      if (e.detail?.query) {
        setSearchQuery(e.detail.query);
        setSearchTab('content');
      }
      setSearchOpen(true);
    };
    const handleClearSearch = () => {
      setSearchQuery('');
    };
    window.addEventListener('soulstash:open-search', handleOpenSearch);
    window.addEventListener('soulstash:search-cleared', handleClearSearch);
    return () => {
      window.removeEventListener('soulstash:open-search', handleOpenSearch);
      window.removeEventListener('soulstash:search-cleared', handleClearSearch);
    };
  }, []);

  const currentPath = location.pathname;

  const navItems = useMemo(() => {
    const isWatched = !!matchPath("/user/:user/collection/Watched", currentPath);
    const isWatchlist = !!matchPath("/user/:user/collection/Watchlist", currentPath);
    const collectionMatch = matchPath("/user/:user/collection/:id", currentPath);
    const isOwnCollection = collectionMatch && username && collectionMatch.params.user?.toLowerCase() === username.toLowerCase();
    const isOtherUserCollection = collectionMatch && (!username || collectionMatch.params.user?.toLowerCase() !== username.toLowerCase()) && !isWatched && !isWatchlist;
    const isCollections = !!matchPath("/user/:user/collections", currentPath) || currentPath === '/collections' || isOwnCollection;
    const isLists = currentPath === '/posted-collections' || isOtherUserCollection;
    const isUpcoming = currentPath === '/upcoming';

    return [
      {
        label: 'Lists',
        active: isLists,
        onClick: () => navigate('/posted-collections'),
        icon: <ListsIcon />
      },
      {
        label: 'Upcoming',
        active: isUpcoming,
        onClick: () => navigate('/upcoming'),
        icon: <UpcomingIcon />
      },
      {
        label: 'Collection',
        active: isCollections,
        onClick: () => {
          if (!isLoggedIn || !username) { toast('Please login first', 'info'); return; }
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

  const handleProfileTriggerKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      setProfileDropdownOpen(true);
      window.requestAnimationFrame(() => {
        profileMenuRef.current?.querySelector('[data-profile-menu-item]')?.focus();
      });
    } else if (event.key === 'ArrowLeft') {
      // Profile/settings button is data-tv-ignore (spatial nav skips it), so hand focus
      // back to the Search button; from there spatial nav reaches Collection/Upcoming/Lists.
      event.preventDefault();
      event.stopPropagation();
      const searchBtn = profileMenuRef.current?.querySelector('button[aria-label="Search"], button[aria-label="Close search"]');
      if (searchBtn) applyFocus(searchBtn, false);
    } else if (event.key === 'Escape' && profileDropdownOpen) {
      event.preventDefault();
      event.stopPropagation();
      setProfileDropdownOpen(false);
    }
  };

  const handleProfileMenuKeyDown = (event) => {
    const items = [...(profileMenuRef.current?.querySelectorAll('[data-profile-menu-item]') || [])];
    const currentIndex = items.indexOf(event.target.closest('[data-profile-menu-item]'));

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      if (!items.length) return;
      if (event.key === 'ArrowUp' && currentIndex <= 0) {
        profileTriggerRef.current?.focus();
        return;
      }
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      const nextIndex = (currentIndex + direction + items.length) % items.length;
      items[nextIndex]?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setProfileDropdownOpen(false);
      profileTriggerRef.current?.focus();
    }
  };

  if (!navReady) {
    return <NavbarSkeleton />;
  }

  return (
    <>
      {/* ── TV Left Sidebar Navbar (Active in TV mode or when width > height) ── */}
      {isTvLayout && (
        <aside
          className="fixed inset-y-0 left-0 top-0 bottom-0 z-[99990] flex w-16 sm:w-20 flex-col items-center justify-between border-r border-white/10 bg-[#0c0d10]/95 py-3 sm:py-4 shadow-2xl backdrop-blur-xl select-none h-screen h-[100dvh] overflow-visible"
          aria-label="TV Sidebar Navigation"
        >
          {/* Top Profile / Login: Tapping toggles TV profile menu */}
          <div className="relative flex flex-col items-center" ref={tvProfileRef}>
            {isLoggedIn && username ? (
              <>
                <button
                  type="button"
                  onClick={() => setTvProfileOpen((prev) => !prev)}
                  className={`relative flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-full overflow-hidden border-2 transition-all active:scale-95 shadow-md ${
                    currentPath.startsWith(`/user/${username}`) ? 'border-amber-400 ring-2 ring-amber-400/30' : 'border-white/20 hover:border-amber-400'
                  }`}
                  title={`${username} Profile`}
                  aria-label="User profile menu"
                >
                  <img
                    src={auth?.user?.avatar || FALLBACK_AVATAR}
                    alt="Profile"
                    className="h-full w-full object-cover object-top"
                  />
                </button>

                {tvProfileOpen && (
                  <div
                    className="absolute left-14 sm:left-16 top-0 w-48 rounded-2xl border border-white/20 profile-dropdown-solid p-1.5 text-xs z-[100000] shadow-2xl animate-in fade-in slide-in-from-left-2 duration-150"
                    style={{ backgroundColor: '#121418', background: '#121418', opacity: 1, backdropFilter: 'none', WebkitBackdropFilter: 'none' }}
                  >
                    <div className="px-3 py-2 border-b border-white/10 text-white/60 truncate font-semibold">
                      @{username}
                    </div>
                    <button
                      type="button"
                      onClick={() => { setTvProfileOpen(false); navigate(`/user/${username}`); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-white/80 hover:bg-white/10 hover:text-white transition-colors text-left font-medium"
                    >
                      <i className="fas fa-user text-xs w-4"></i>
                      <span>View Profile</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => { setTvProfileOpen(false); setSettingsOpen(true); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-white/80 hover:bg-white/10 hover:text-white transition-colors text-left"
                    >
                      <i className="fas fa-cog text-xs w-4"></i>
                      <span>Settings &amp; Layout</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => { setTvProfileOpen(false); handleLogout(); }}
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
                className="flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-full bg-white/10 text-white/80 hover:bg-white/20 hover:text-white transition-all"
                title="Sign In"
                aria-label="Sign In"
              >
                <i className="fas fa-right-to-bracket text-sm" />
              </button>
            )}
          </div>

          {/* Middle Navigation Icons (Contained so sidebar never scrolls) */}
          <nav className="flex flex-col items-center gap-2 sm:gap-2.5 my-auto max-h-[calc(100dvh-130px)] overflow-y-auto overscroll-contain filter-scrollbar-hidden py-1">
            <button
              type="button"
              onClick={() => navigate('/')}
              className={`flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-2xl transition-all ${
                currentPath === '/' ? 'bg-white text-black font-bold shadow-lg scale-105' : 'text-white/70 hover:bg-white/15 hover:text-white'
              }`}
              title="Home"
              aria-label="Home"
              aria-current={currentPath === '/' ? 'page' : undefined}
            >
              <HomeIcon />
            </button>

            {navItems.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={item.onClick}
                className={`flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-2xl transition-all ${
                  item.active ? 'bg-white text-black font-bold shadow-lg scale-105' : 'text-white/70 hover:bg-white/15 hover:text-white'
                }`}
                title={item.label}
                aria-label={item.label}
                aria-current={item.active ? 'page' : undefined}
              >
                {item.icon}
              </button>
            ))}

            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-2xl text-white/70 hover:bg-white/15 hover:text-white transition-all"
              title="Search"
              aria-label="Search"
            >
              <SearchIcon />
            </button>
          </nav>

          {/* Bottom Settings */}
          <div className="flex flex-col items-center">
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-full bg-white/10 text-white/80 hover:bg-white/20 hover:text-white transition-all"
              title="Settings & Layout"
              aria-label="Settings"
            >
              <i className="fas fa-cog text-sm" />
            </button>
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
            <div className="desktop-actions flex items-center gap-3 relative" ref={profileMenuRef} style={{ overflow: 'visible', zIndex: 99999 }}>
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
                    ref={profileTriggerRef}
                    data-tv-ignore
                    onClick={() => setProfileDropdownOpen((prev) => !prev)}
                    onKeyDown={handleProfileTriggerKeyDown}
                    aria-label="User profile menu"
                    aria-haspopup="menu"
                    aria-expanded={profileDropdownOpen}
                  >
                    <img
                      src={auth?.user?.avatar || FALLBACK_AVATAR}
                      alt="Profile"
                      className="profile-avatar object-cover object-top"
                    />
                  </button>

                  {/* Desktop Profile Dropdown (Profile, Settings, Logout) */}
                  {profileDropdownOpen && (
                    <div
                      data-tv-ignore
                      role="menu"
                      onKeyDown={handleProfileMenuKeyDown}
                      className="absolute right-0 top-14 w-48 rounded-2xl border border-white/20 profile-dropdown-solid p-1.5 text-xs z-[99999] shadow-2xl animate-in fade-in zoom-in-95 duration-150"
                      style={{ backgroundColor: '#121418', background: '#121418', opacity: 1, backdropFilter: 'none', WebkitBackdropFilter: 'none' }}
                    >
                      <div className="px-3 py-2 border-b border-white/10 text-white/60 truncate font-semibold">
                        @{username}
                      </div>
                      <button
                        type="button"
                        role="menuitem"
                        data-profile-menu-item
                        onClick={() => { setProfileDropdownOpen(false); navigate(`/user/${username}`); }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-white/80 hover:bg-white/10 hover:text-white transition-colors text-left"
                      >
                        <i className="fas fa-user text-xs w-4"></i>
                        <span>Profile</span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        data-profile-menu-item
                        onClick={() => { setProfileDropdownOpen(false); setSettingsOpen(true); }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-white/80 hover:bg-white/10 hover:text-white transition-colors text-left"
                      >
                        <i className="fas fa-cog text-xs w-4"></i>
                        <span>Settings</span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        data-profile-menu-item
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
                /* Logged out Desktop: Settings button which opens a similar solid dropdown */
                <>
                  <button
                    type="button"
                    className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/80 hover:bg-white/20 hover:text-white transition-all border border-white/15"
                    ref={profileTriggerRef}
                    data-tv-ignore
                    onClick={() => setProfileDropdownOpen((prev) => !prev)}
                    onKeyDown={handleProfileTriggerKeyDown}
                    title="Settings & Menu"
                    aria-label="Settings menu"
                    aria-haspopup="menu"
                    aria-expanded={profileDropdownOpen}
                  >
                    <i className="fas fa-cog text-sm" />
                  </button>

                  {profileDropdownOpen && (
                    <div
                      data-tv-ignore
                      role="menu"
                      onKeyDown={handleProfileMenuKeyDown}
                      className="absolute right-0 top-14 w-48 rounded-2xl border border-white/20 profile-dropdown-solid p-1.5 text-xs z-[99999] shadow-2xl animate-in fade-in zoom-in-95 duration-150"
                      style={{ backgroundColor: '#121418', background: '#121418', opacity: 1, backdropFilter: 'none', WebkitBackdropFilter: 'none' }}
                    >
                      <div className="px-3 py-2 border-b border-white/10 text-white/60 font-semibold">
                        Soulstash Menu
                      </div>
                      <button
                        type="button"
                        role="menuitem"
                        data-profile-menu-item
                        onClick={() => { setProfileDropdownOpen(false); setSettingsOpen(true); }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-white/80 hover:bg-white/10 hover:text-white transition-colors text-left"
                      >
                        <i className="fas fa-cog text-xs w-4"></i>
                        <span>Settings &amp; Layout</span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        data-profile-menu-item
                        onClick={() => { setProfileDropdownOpen(false); navigate('/login'); }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-amber-400 hover:bg-white/10 transition-colors text-left font-medium"
                      >
                        <i className="fas fa-right-to-bracket text-xs w-4"></i>
                        <span>Sign In</span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        data-profile-menu-item
                        onClick={() => { setProfileDropdownOpen(false); navigate('/register'); }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-white/80 hover:bg-white/10 hover:text-white transition-colors text-left"
                      >
                        <i className="fas fa-user-plus text-xs w-4"></i>
                        <span>Sign Up</span>
                      </button>
                    </div>
                  )}
                </>
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
        isTvLayout={isTvLayout}
      />

      {/* Settings Modal */}
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        verticalPreference={verticalPreference}
        landscapePreference={landscapePreference}
        setVerticalPreference={setVerticalPreference}
        setLandscapePreference={setLandscapePreference}
        isVertical={isVertical}
        isLandscape={isLandscape}
      />
    </>
  );
}
