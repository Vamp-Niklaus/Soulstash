import React from 'react';

export function UserProfileSkeleton() {
  return (
    <div className="space-y-7 animate-pulse">
      <section className="rounded-[30px] bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] p-5 md:p-7">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <div className="h-[96px] w-[96px] rounded-full bg-white/[0.08] ring-1 ring-white/10"></div>
            <div className="min-w-0 space-y-3">
              <div className="h-4 w-32 rounded bg-white/[0.06]"></div>
              <div className="h-7 w-52 rounded bg-white/[0.08]"></div>
              <div className="space-y-2">
                <div className="h-3 w-72 rounded bg-white/[0.05]"></div>
                <div className="h-3 w-60 rounded bg-white/[0.05]"></div>
              </div>
            </div>
          </div>
          <div className="flex w-full flex-col items-stretch gap-3 lg:w-auto lg:min-w-[280px] lg:items-end">
            <div className="h-9 w-32 rounded-full bg-white/[0.08]"></div>
            <div className="h-9 w-40 rounded-full bg-white/[0.06]"></div>
          </div>
        </div>
      </section>
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 space-y-3">
            <div className="h-5 w-28 rounded bg-white/[0.08]"></div>
            <div className="h-4 w-48 rounded bg-white/[0.06]"></div>
          </div>
        ))}
      </section>
    </div>
  );
}
