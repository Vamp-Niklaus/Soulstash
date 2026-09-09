import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useLocation, matchPath } from 'react-router-dom';
import { NavbarSkeleton } from '../ui/Skeletons/index.js';
import { FALLBACK_AVATAR, FALLBACK_LOGO } from '../../utils/constants.js';
import { useAuthSession } from '../../hooks/index.js';
import { NavbarSearchOverlay } from './NavbarSearchOverlay.jsx';
import { useSearchAutocomplete } from '../../hooks/useSearchAutocomplete.js';
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
  const navRef = useRef(null);

  const { searchResults, searchLoading } = useSearchAutocomplete(
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
              <img alt="Profile" className="object-cover rounded-full absolute inset-0 h-full w-full" src={FALLBACK_AVATAR} />
            </div>
          </div>
        ) : <ProfileIcon />
      }
    ];
  }, [currentPath, navItems, isLoggedIn, username, navigate]);

  const authCta = useMemo(() => (
    currentPath === '/login'
      ? { label: 'Sign Up', iconLabel: 'Sign Up', onClick: () => navigate('/register') }
      : { label: 'Sign In', iconLabel: 'Sign In', onClick: () => navigate('/login') }
  ), [currentPath, navigate]);

  if (!navReady) {
    return <NavbarSkeleton />;
  }

  return (
    <>
      <header className="modern-navbar-react" ref={navRef}>
        <div className="navbar-container">
          <div className="navbar-logo">
            <button type="button" className="navbar-logo bg-transparent border-0 p-0" onClick={() => navigate('/')}>
              <img src={`${import.meta.env.BASE_URL}images/logo.png`} alt="Soulstash Logo" className="logo-img" height="100%" onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = FALLBACK_LOGO; }} />
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
            <button className="mobile-btn tv-focus-icon" aria-label="Search" type="button" onClick={() => setSearchOpen((current) => !current)}>
              {searchOpen ? <CloseIcon /> : <SearchIcon />}
            </button>
          </div>

          <div className="desktop-actions">
            <button className="mobile-btn tv-focus-icon" aria-label="Search" type="button" onClick={() => setSearchOpen((current) => !current)}>
              {searchOpen ? <CloseIcon /> : <SearchIcon />}
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