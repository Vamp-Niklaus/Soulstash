import React from 'react';

const HOME_GRID_CLASS = 'grid grid-flow-col auto-cols-[32%] sm:auto-cols-[22%] gap-3 overflow-x-auto snap-x snap-mandatory hide-scrollbar pb-2 md:grid-flow-row md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 md:auto-cols-auto md:pb-0 md:snap-none md:overflow-visible';

export function ContentCardSkeleton() {
  return (
    <div className="card animate-pulse">
      <div className="cardImageWrap bg-white/[0.06]"></div>
      <div className="cardMeta space-y-2 pt-2">
        <div className="h-3.5 w-4/5 rounded bg-white/[0.08]"></div>
        <div className="h-2.5 w-3/5 rounded bg-white/[0.06]"></div>
      </div>
    </div>
  );
}
