// 1. The Core Engines (React & Router)
import React, { useEffect, useState } from 'react';
import { Routes, Route, Navigate, Outlet, useParams, useLocation, useNavigate, matchPath } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';

// 2. The Layout & Global UI
import { ReactNavbar } from './components/layout/Navbar.jsx';
import { SmartFooter } from './components/layout/SmartFooter.jsx';
import { UpdateNotificationModal } from './components/ui/Modals/UpdateNotificationModal.jsx';

// 3. Authentication & State
import { getToken, getCurrentUsername } from './api/client.js';

// 4. TV Remote
import { useTvFocus } from './utils/tvNav.js';

// 5. The Pages
import { TermsPage } from './pages/Policy/TermsPage.jsx';
import { PrivacyPage } from './pages/Policy/PrivacyPage.jsx';
import { RegisterPage } from './pages/Auth/RegisterPage.jsx';
import { ForgotPasswordPage } from './pages/Auth/ForgotPasswordPage.jsx';
import { LoginPage } from './pages/Auth/LoginPage.jsx';
import { UserProfilePage } from './pages/Profile/UserProfilePage.jsx';
import { EditProfilePage } from './pages/Profile/EditProfilePage.jsx';
import { FollowListPage } from './pages/Explore/FollowListPage.jsx';
import { AdminPage } from './pages/Admin/AdminPage.jsx';

import { UserCollectionDetailPage } from './pages/Collections/UserCollectionDetailPage.jsx';
import { PostedCollectionsPage } from './pages/Collections/PostedCollectionsPage.jsx';
import { PostedLetterboxdPage } from './pages/Collections/PostedLetterboxdPage.jsx';
import { CollectionsLayout } from './pages/Collections/CollectionsLayout.jsx';

import { HomePage } from './pages/Explore/HomePage.jsx';
import { TrendingPage } from './pages/Explore/TrendingPage.jsx';
import { PopularPage } from './pages/Explore/PopularPage.jsx';
import { UpcomingPage } from './pages/Explore/UpcomingPage.jsx';
import { ContinueWatchingPage } from './pages/Explore/ContinueWatchingPage.jsx';
import { GenrePage } from './pages/Explore/GenrePage.jsx';
import { DetailPage } from './pages/Content/DetailPage.jsx';
import { PersonPage } from './pages/Content/PersonPage.jsx';
import { KartoonDetailPage } from './pages/Content/KartoonDetailPage.jsx';




export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  
  const isCollectionRoute = 
    matchPath('/user/:username/collections/*', location.pathname) || 
    matchPath('/user/:username/collections', location.pathname) ||
    matchPath('/user/:username/collection/:collectionName', location.pathname);
    
  const isAuthRoute = ['/login', '/register', '/forgot-password'].includes(location.pathname);

  //  TV / remote D-pad navigation 
  useTvFocus(location);

  // Automatically reset scroll position on route change (except when returning to pages with preserved scroll)
  useEffect(() => {
    if (location.pathname === '/posted-collections') {
      const saved = sessionStorage.getItem('posted_collections:scrollY');
      if (saved && parseInt(saved, 10) > 0) {
        return;
      }
    }
    if (location.pathname === '/posted-letterbox' || location.pathname === '/posted-letterboxd') {
      const saved = sessionStorage.getItem('posted_letterbox:scrollY');
      if (saved && parseInt(saved, 10) > 0) {
        return;
      }
    }
    window.scrollTo(0, 0);
  }, [location.pathname]);

  // Handle hardware / gesture back button on Android devices
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let subHandle = null;

    const setupBackListener = async () => {
      subHandle = await CapApp.addListener('backButton', ({ canGoBack }) => {
        // 1. If player modal is open, let player modal handle or dispatch player-back
        const playerModal = document.querySelector('[data-player-modal]');
        if (playerModal) {
          const backEvt = new CustomEvent('soulstash:player-back', { cancelable: true });
          window.dispatchEvent(backEvt);
          return;
        }

        // 2. If any other modal, dialog, or search overlay is open, dismiss it
        const openModal = document.querySelector('[data-open-modal], [data-search-overlay], dialog[open]');
        if (openModal) {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          return;
        }

        // 3. If on Home page ('/' or ''), exit the app!
        const path = window.location.pathname;
        if (path === '/' || path === '') {
          CapApp.exitApp();
          return;
        }

        // 4. Otherwise navigate back in history
        if (canGoBack) {
          navigate(-1);
        } else {
          navigate('/', { replace: true });
        }
      });
    };

    setupBackListener();

    return () => {
      if (subHandle && typeof subHandle.remove === 'function') {
        subHandle.remove();
      }
    };
  }, [navigate]);



  const routeTree = (
    <Routes>
      {/* Policy */}
      <Route path="/terms-of-service" element={<TermsPage />} />
      <Route path="/privacy-policy" element={<PrivacyPage />} />

      {/* Auth */}
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/login" element={<LoginPage />} />

      {/* Profile */}
      <Route path="/user/:username" element={<UserProfilePage />} />
      <Route path="/admin/user/:username" element={<UserProfilePage />} />
      <Route path="/edit" element={<EditProfilePage />} />

      {/* Follow List */}
      <Route path="/user/:username/followers" element={<FollowListPage listType="followers" />} />
      <Route path="/user/:username/following" element={<FollowListPage listType="following" />} />

      {/* Admin */}
      <Route path="/admin" element={<AdminPage />} />

      {/* Collections */}
      <Route path="/user/:username/collection/:collectionName" element={<UserCollectionDetailPage />} />
      <Route path="/user/:username/collections" element={<CollectionsLayout />}>
        <Route index element={<Navigate to="Watched" replace />} />
        <Route path=":collectionName" element={<UserCollectionDetailPage />} />
      </Route>
      <Route path="/user/:username/collection" element={<Navigate to="../collections" replace relative="path" />} />


      {/* Explore */}
      <Route path="/" element={<HomePage />} />
      <Route path="/trending" element={<TrendingPage />} />
      <Route path="/popular" element={<PopularPage />} />
      <Route path="/upcoming" element={<UpcomingPage />} />
      <Route path="/continue-watching" element={<ContinueWatchingPage />} />
      <Route path="/posted-collections" element={<PostedCollectionsPage />} />
      <Route path="/posted-letterbox" element={<PostedLetterboxdPage />} />
      <Route path="/posted-letterboxd" element={<PostedLetterboxdPage />} />
      <Route path="/genre/" element={<Navigate to="/" replace />} />
      <Route path="/genre" element={<Navigate to="/" replace />} />
      <Route path="/genre/:id/:name?" element={<GenrePage />} />

      {/* Content */}
      <Route path="/kartoons/:slug" element={<KartoonDetailPage />} />
      <Route path="/movie/:id" element={<DetailPage type="movie" />} />
      <Route path="/series/:id" element={<DetailPage type="series" />} />
      <Route path="/person/:id" element={<PersonPage />} />
    </Routes>
  );

  const [isOnline, setIsOnline] = useState(() => (typeof navigator !== 'undefined' ? navigator.onLine : true));

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return (
    <div className={`app-shell app-shell--textured ${isCollectionRoute ? 'collection-react-shell' : ''}`}>
      {!isOnline && (
        <div className="sticky top-0 z-[10000] flex items-center justify-between bg-amber-600/95 px-4 py-2 text-xs font-medium text-white shadow-md backdrop-blur">
          <div className="flex items-center gap-2">
            <i className="fas fa-wifi-slash text-sm"></i>
            <span>Offline — Showing saved data from local cache</span>
          </div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded bg-black/30 px-2.5 py-1 text-[11px] font-semibold hover:bg-black/50 transition-colors"
          >
            Retry
          </button>
        </div>
      )}
      <ReactNavbar />
      <main className={`app-main ${isAuthRoute ? 'app-main--auth' : ''}`}>
        <div className={`app-container ${isCollectionRoute ? 'app-container--collections' : ''}`}>
          {routeTree}
        </div>
        <SmartFooter />
      </main>
      <UpdateNotificationModal />
    </div>
  );
}
