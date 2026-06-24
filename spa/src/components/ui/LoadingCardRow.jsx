import React from 'react';

export function LoadingCardRow({ count = 6 }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="overflow-hidden rounded-2xl border border-white/8 bg-white/[0.03] animate-pulse">
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
