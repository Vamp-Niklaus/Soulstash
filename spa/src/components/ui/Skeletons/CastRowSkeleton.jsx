import React from 'react';

export function CastRowSkeleton({ count = 6 }) {
  return (
    <div className="flex gap-4 overflow-hidden animate-pulse">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="w-[130px] shrink-0 rounded-2xl overflow-hidden border border-white/8 bg-white/[0.03]">
          <div className="aspect-[2/3] bg-white/[0.06]"></div>
          <div className="p-3 space-y-2">
            <div className="h-4 rounded bg-white/[0.08]"></div>
            <div className="h-3 w-2/3 rounded bg-white/[0.06]"></div>
          </div>
        </div>
      ))}
    </div>
  );
}
