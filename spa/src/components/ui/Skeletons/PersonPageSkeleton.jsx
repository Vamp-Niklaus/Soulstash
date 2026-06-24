import React from 'react';
import { LoadingCardRow } from '../LoadingCardRow.jsx';

export function PersonPageSkeleton() {
  return (
    <div className="space-y-10">
      <section className="rounded-[28px] border border-white/10 bg-[linear-gradient(135deg,rgba(15,15,15,0.98),rgba(10,10,10,0.95))] p-6 md:p-8 lg:p-10 overflow-hidden relative animate-pulse">
        <div className="space-y-6">
          <div className="flex flex-col gap-6 md:flex-row md:items-start md:gap-8">
            <div className="w-[220px] max-w-full aspect-[2/3] rounded-[24px] bg-white/[0.08]"></div>
            <div className="min-w-0 flex-1">
              <div className="h-12 w-[min(420px,80%)] rounded bg-white/[0.1] md:mt-1"></div>
              <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mt-6">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="rounded-2xl border border-white/8 bg-white/[0.03] p-4 space-y-3">
                    <div className="h-3 w-20 rounded bg-white/[0.06]"></div>
                    <div className="h-4 w-24 rounded bg-white/[0.08]"></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <div className="h-4 w-full rounded bg-white/[0.06]"></div>
            <div className="h-4 w-[95%] rounded bg-white/[0.06]"></div>
            <div className="h-4 w-[82%] rounded bg-white/[0.06]"></div>
          </div>
        </div>
      </section>

      <section className="content-section">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div className="h-8 w-32 rounded bg-white/[0.08] animate-pulse"></div>
          <div className="h-9 w-36 rounded-full bg-white/[0.08] animate-pulse"></div>
        </div>
        <div className="mb-5 overflow-hidden">
          <div className="flex min-w-max flex-nowrap items-center gap-2">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="h-10 w-32 rounded-full bg-white/[0.08] animate-pulse"></div>
            ))}
          </div>
        </div>
        <LoadingCardRow />
      </section>
    </div>
  );
}
