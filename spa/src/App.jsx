// 1. The Core Engines (React & Router)
import React, { useEffect } from 'react';
import { Routes, Route, Navigate, Outlet, useParams, useLocation, useNavigate, matchPath } from 'react-router-dom';

// 2. The Layout & Global UI
import { ReactNavbar } from './components/layout/Navbar.jsx';
import { SmartFooter } from './components/layout/SmartFooter.jsx';

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
import { CollectionsLayout } from './pages/Collections/CollectionsLayout.jsx';

import { HomePage } from './pages/Explore/HomePage.jsx';
import { TrendingPage } from './pages/Explore/TrendingPage.jsx';
import { GenrePage } from './pages/Explore/GenrePage.jsx';
import { DetailPage } from './pages/Content/DetailPage.jsx';
import { PersonPage } from './pages/Content/PersonPage.jsx';




export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  
  const isCollectionRoute = 
    matchPath('/user/:username/collections', location.pathname) || 
    matchPath('/user/:username/collection/:collectionName', location.pathname);
    
  const isAuthRoute = ['/login', '/register', '/forgot-password'].includes(location.pathname);

  //  TV / remote D-pad navigation 
  useTvFocus(location);



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
      <Route path="/genre/" element={<Navigate to="/" replace />} />
      <Route path="/genre" element={<Navigate to="/" replace />} />
      <Route path="/genre/:id/:name?" element={<GenrePage />} />

      {/* Content */}
      <Route path="/movie/:id" element={<DetailPage type="movie" />} />
      <Route path="/series/:id" element={<DetailPage type="series" />} />
      <Route path="/person/:id" element={<PersonPage />} />
    </Routes>
  );

  return (
    <div className={`app-shell ${isCollectionRoute ? 'collection-react-shell' : ''}`}>
      <ReactNavbar />
      <main className={`app-main ${isAuthRoute ? 'app-main--auth' : ''}`}>
        <div className={`app-container ${isCollectionRoute ? 'app-container--collections' : ''}`}>
          {routeTree}
        </div>
        <SmartFooter />
      </main>
    </div>
  );
}
