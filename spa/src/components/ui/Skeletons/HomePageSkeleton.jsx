import React from 'react';
import { ContentCardSkeleton } from './ContentCardSkeleton.jsx';
import { GridSkeleton } from './GridSkeleton.jsx';

export function HomePageSkeleton() {
  return (
    <div className="space-y-8">
      <section className="content-section">
        <div className="mb-4 space-y-2 animate-pulse">
          <div className="h-6 w-40 rounded bg-white/[0.08]"></div>
          <div className="h-4 w-64 rounded bg-white/[0.06]"></div>
        </div>
        <GridSkeleton count={14} />
      </section>

      <section className="content-section">
        <div className="mb-4 space-y-2 animate-pulse">
          <div className="h-6 w-40 rounded bg-white/[0.08]"></div>
          <div className="h-4 w-72 rounded bg-white/[0.06]"></div>
        </div>
        <GridSkeleton count={14} />
      </section>
    </div>
  );
}
