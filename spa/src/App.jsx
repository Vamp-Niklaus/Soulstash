import { getToken, getCurrentUsername } from './api/client.js';
import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTvFocus } from './utils/tvNav.js';
import { lastKnownCollectionVersion, setLastKnownCollectionVersion } from "./utils/helpers.js";
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import React from 'react';
import { Routes, Route, Navigate, Outlet, useParams } from 'react-router-dom';
import { useAuthSession } from './hooks/index.js';
import { ReactNavbar } from './components/layout/Navbar.jsx';
import { SmartFooter } from './components/layout/SmartFooter.jsx';

import { HomePage } from './pages/Explore/HomePage.jsx';
import { LoginPage } from './pages/Auth/LoginPage.jsx';
import { RegisterPage } from './pages/Auth/RegisterPage.jsx';
import { UserProfilePage } from './pages/Profile/UserProfilePage.jsx';
import { EditProfilePage } from './pages/Profile/EditProfilePage.jsx';
import { DetailPage } from './pages/Content/DetailPage.jsx';
import { PersonPage } from './pages/Content/PersonPage.jsx';
import { AdminPage } from './pages/Admin/AdminPage.jsx';
import { UserCollectionsPage } from './pages/Collections/UserCollectionsPage.jsx';
import { UserCollectionDetailPage } from './pages/Collections/UserCollectionDetailPage.jsx';
import { UserCollectionIndexGate } from './pages/Collections/UserCollectionIndexGate.jsx';
import { TrendingPage } from './pages/Explore/TrendingPage.jsx';
import { GenrePage } from './pages/Explore/GenrePage.jsx';
import { FollowListPage } from './pages/Explore/FollowListPage.jsx';
import { LazyCategoryShelf } from './pages/Explore/LazyCategoryShelf.jsx';
import { PolicyPage } from './pages/Policy/PolicyPage.jsx';
import { TermsPage } from './pages/Policy/TermsPage.jsx';
import { PrivacyPage } from './pages/Policy/PrivacyPage.jsx';
import { ForgotPasswordPage } from './pages/Auth/ForgotPasswordPage.jsx';

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const isCollectionRoute = /^\/user\/[^/]+\/(collections|collection\/.+)$/.test(location.pathname);
  const isAuthRoute = location.pathname === '/login' || location.pathname === '/register' || location.pathname === '/forgot-password';

  // Ã¢â€â‚¬Ã¢â€â‚¬ TV / remote D-pad navigation Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  useTvFocus(location);
  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬


  useEffect(() => {
    document.title = 'Soulstash';
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement);
      if (isFullscreen) {
        if (!window.history.state || !window.history.state.fullscreen) {
          window.history.pushState({ fullscreen: true }, '');
        }
      } else {
        if (window.history.state && window.history.state.fullscreen) {
          window.history.back();

        }
      }
    };

    const handlePopState = (event) => {
      const isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement);
      if (isFullscreen) {
        if (document.exitFullscreen) {
          document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
          document.webkitExitFullscreen();
        } else if (document.mozCancelFullScreen) {
          document.mozCancelFullScreen();
        } else if (document.msExitFullscreen) {
          document.msExitFullscreen();
        }
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);
    window.addEventListener('popstate', handlePopState);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);


  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [location.pathname]);

  useEffect(() => {
    window.soulstashNavigate = (to, options = {}) => {
      navigate(to, options);
    };

    let backButtonListener = null;
    if (Capacitor.isNativePlatform()) {
      CapacitorApp.addListener('backButton', ({ canGoBack }) => {
        // 1. Close player if it's open
        const playerModal = document.querySelector('[data-player-modal]');
        if (playerModal) {
          const closeBtn = playerModal.querySelector('button[aria-label="Close player"]');
          if (closeBtn) {
            closeBtn.click();
            return;
          }
        }
        
        // 2. Go back in history if possible, else exit app
        if (canGoBack || window.history.length > 1) {
          navigate(-1);
        } else {
          CapacitorApp.exitApp();
        }
      }).then(listener => {
        backButtonListener = listener;
      });
    }

    return () => {
      delete window.soulstashNavigate;
      if (backButtonListener) {
        backButtonListener.remove();
      }
    };
  }, [navigate]);

  const routeTree = (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/trending" element={<TrendingPage />} />
      <Route path="/genre/:id/:name?" element={<GenrePage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/explore" element={<LegacyRedirectPage />} />
      <Route path="/collections" element={<CollectionsRouteGate />} />
      <Route path="/edit" element={<EditProfilePage />} />
      <Route path="/terms-of-service" element={<TermsPage />} />
      <Route path="/privacy-policy" element={<PrivacyPage />} />
      <Route path="/collection/:collectionName" element={<LegacyCollectionRouteGate />} />
      <Route path="/user/:username/collections" element={<UserCollectionsPage />} />
      <Route path="/user/:username/collection" element={<UserCollectionIndexGate />} />
      <Route path="/user/:username/collection/:collectionName" element={<UserCollectionDetailPage />} />
      <Route path="/user/:username/followers" element={<FollowListPage listType="followers" />} />
      <Route path="/user/:username/following" element={<FollowListPage listType="following" />} />
      <Route path="/user/:username" element={<UserProfilePage />} />
      <Route path="/user/:username/*" element={<LegacyRedirectPage />} />
      <Route path="/movie/:id" element={<DetailPage type="movie" />} />
      <Route path="/series/:id" element={<DetailPage type="series" />} />
      <Route path="/person/:id" element={<PersonPage />} />
      <Route path="/admin" element={<AdminPage />} />
    </Routes>
  );

  if (isCollectionRoute) {
    return (
      <div className="app-shell collection-react-shell">
        <ReactNavbar />
        <main className="app-main">
          <div className="app-container app-container--collections">{routeTree}</div>
          <SmartFooter />
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <ReactNavbar />
      <main className={`app-main ${isAuthRoute ? 'app-main--auth' : ''}`}>
        <div className="app-container">{routeTree}</div>
        {!isAuthRoute ? <SmartFooter /> : null}
      </main>
    </div>
  );
}

export function CollectionsRouteGate() {
  const navigate = useNavigate();

  useEffect(() => {
    const username = getCurrentUsername();
    if (!getToken() || !username) {
      navigate('/login', { replace: true });
      return;
    }
    navigate(`/user/${username}/collections`, { replace: true });
  }, [navigate]);

  return <div className="app-loading">Opening your collections...</div>;
}

export function LegacyCollectionRouteGate() {
  const { collectionName = '' } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    const username = getCurrentUsername();
    if (!getToken() || !username) {
      navigate('/login', { replace: true });
      return;
    }
    navigate(`/user/${username}/collection/${encodeURIComponent(decodeURIComponent(collectionName))}`, { replace: true });
  }, [collectionName, navigate]);

  return <div className="app-loading">Opening collection...</div>;
}

export function LegacyRedirectPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { username } = useParams();

  useEffect(() => {
    if (location.pathname === '/explore') {
      navigate('/trending', { replace: true });
      return;
    }

    if (username) {
      navigate(`/user/${encodeURIComponent(username)}`, { replace: true });
      return;
    }

    navigate('/', { replace: true });
  }, [location.pathname, navigate, username]);

  return <div className="app-loading">Opening page...</div>;
}

