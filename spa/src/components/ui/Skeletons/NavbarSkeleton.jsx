import React from 'react';

export function NavbarSkeleton() {
  return (
    <header className="modern-navbar-react">
      <div className="navbar-container animate-pulse">
        <div className="navbar-logo">
          <div className="h-10 w-10 rounded-full bg-white/[0.08]"></div>
        </div>
        <div className="nav-links">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-9 w-24 rounded-full bg-white/[0.06]"></div>
          ))}
        </div>
        <div className="navbar-actions">
          <div className="h-10 w-10 rounded-full bg-white/[0.08]"></div>
          <div className="h-10 w-24 rounded-full bg-white/[0.06]"></div>
        </div>
      </div>
    </header>
  );
}
