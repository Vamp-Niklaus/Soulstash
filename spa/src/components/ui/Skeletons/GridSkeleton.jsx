import React from 'react';
import { ContentCardSkeleton } from './ContentCardSkeleton.jsx';

const HOME_GRID_CLASS = 'grid grid-flow-col auto-cols-[32%] sm:auto-cols-[22%] gap-3 overflow-x-auto snap-x snap-mandatory hide-scrollbar pb-2 md:grid-flow-row md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 md:auto-cols-auto md:pb-0 md:snap-none md:overflow-visible';

export function GridSkeleton({ count = 14 }) {
  return (
    <div className={HOME_GRID_CLASS}>
      {Array.from({ length: count }).map((_, index) => (
        <ContentCardSkeleton key={index} />
      ))}
    </div>
  );
}
