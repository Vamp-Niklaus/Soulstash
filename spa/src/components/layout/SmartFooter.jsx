import React from 'react';
import { useLocation } from 'react-router-dom';

export function SmartFooter({ variant = 'global' }) {
  const location = useLocation();
  const isAuthRoute = ['/login', '/register', '/forgot-password'].includes(location.pathname);

  // If this is the global footer sitting in App.jsx, hide it on auth routes
  if (variant === 'global' && isAuthRoute) {
    return null;
  }

  if (variant === 'auth') {
    return (
      <div className="mt-10 text-center">
        <p className="text-[15px] font-medium text-white/80">&copy; 2026 Soulstash. All rights reserved.</p>
      </div>
    );
  }

  return (
    <footer className="app-smart-footer" aria-label="Page footer">
      <div className="app-smart-footer__content">
        <p className="app-smart-footer__text">&copy; 2026 Soulstash. All rights reserved.</p>
      </div>
    </footer>
  );
}
