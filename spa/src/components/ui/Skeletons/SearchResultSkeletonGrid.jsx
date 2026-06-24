import React from 'react';

export function SearchResultSkeletonGrid({ columns = 'grid-cols-1 min-[600px]:grid-cols-2 min-[900px]:grid-cols-3 min-[1280px]:grid-cols-4 min-[1600px]:grid-cols-5', count = 6 }) {
  return (
    <div className={`grid ${columns} gap-3 animate-pulse`}>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="flex items-center rounded-lg border border-gray-800 bg-[#171717] p-3">
          <div className="h-20 w-14 flex-shrink-0 rounded-md bg-white/[0.06]"></div>
          <div className="ml-3 min-w-0 flex-1 space-y-2">
            <div className="h-4 w-4/5 rounded bg-white/[0.08]"></div>
            <div className="h-3 w-2/5 rounded bg-white/[0.06]"></div>
          </div>
          <div className="ml-2 h-9 w-9 flex-shrink-0 rounded-full bg-white/[0.08]"></div>
        </div>
      ))}
    </div>
  );
}
