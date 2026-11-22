import React from 'react';

export function EpisodeRowSkeleton({ count = 4 }) {
  return (
    <div className="flex gap-3 overflow-hidden animate-pulse">
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className="w-[260px] shrink-0 overflow-hidden rounded-[20px] border border-white/8 bg-white/[0.03]"
        >
          <div className="aspect-video bg-white/[0.06]"></div>
          <div className="p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="h-4 w-24 rounded bg-white/[0.08]"></div>
              <div className="h-3 w-12 rounded bg-white/[0.06]"></div>
            </div>
            <div className="space-y-1.5">
              <div className="h-3 w-full rounded bg-white/[0.05]"></div>
              <div className="h-3 w-4/5 rounded bg-white/[0.05]"></div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
