import React from 'react';
import { EpisodeRowSkeleton } from './EpisodeRowSkeleton.jsx';

export function DetailPageSkeleton({ type }) {
  return (
    <div className="space-y-10">
      <section className="relative min-h-[560px] overflow-hidden rounded-[28px] border border-white/10 bg-transparent animate-pulse">
        <div className="absolute inset-0 bg-white/[0.04]"></div>
        <div className="relative z-10 flex min-h-[560px] items-end p-5 md:p-8 lg:p-10">
          <div className="flex w-full flex-col gap-6 lg:flex-row lg:items-end lg:gap-8">
            <div className="w-[170px] sm:w-[220px] aspect-[2/3] rounded-2xl bg-white/[0.08]"></div>
            <div className="flex-1 flex flex-col justify-end gap-5">
              <div className="space-y-4">
                <div className="h-4 w-48 rounded bg-white/[0.08]"></div>
                <div className="h-12 w-[min(520px,80%)] rounded bg-white/[0.1]"></div>
                <div className="space-y-2">
                  <div className="h-4 w-full rounded bg-white/[0.06]"></div>
                  <div className="h-4 w-[92%] rounded bg-white/[0.06]"></div>
                  <div className="h-4 w-[76%] rounded bg-white/[0.06]"></div>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="rounded-2xl border border-white/8 bg-white/[0.03] p-4 space-y-3">
                    <div className="h-3 w-20 rounded bg-white/[0.06]"></div>
                    <div className="h-4 w-24 rounded bg-white/[0.08]"></div>
                  </div>
                ))}
              </div>
              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div key={index} className="h-12 w-full sm:w-48 rounded-full bg-white/[0.08]"></div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {type === 'series' ? (
        <section className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(15,15,15,0.96),rgba(9,9,9,0.98))] p-4 md:p-6 animate-pulse">
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-4">
              <div className="h-4 w-56 rounded bg-white/[0.06]"></div>
              <div className="hidden items-center gap-2 md:flex">
                <div className="h-10 w-10 rounded-full bg-white/[0.08]"></div>
                <div className="h-10 w-10 rounded-full bg-white/[0.08]"></div>
              </div>
            </div>
            <div className="flex min-w-0 items-center gap-3">
              <div className="h-8 w-28 shrink-0 rounded bg-white/[0.08]"></div>
              <div className="flex min-w-0 flex-1 gap-2 overflow-hidden">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div key={index} className="h-10 w-16 shrink-0 rounded-2xl bg-white/[0.08]"></div>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between gap-4">
              <div className="h-4 w-24 rounded bg-white/[0.06]"></div>
              <div className="hidden items-center gap-2 md:flex">
                <div className="h-10 w-10 rounded-full bg-white/[0.08]"></div>
                <div className="h-10 w-10 rounded-full bg-white/[0.08]"></div>
              </div>
            </div>
            <div className="overflow-hidden">
              <EpisodeRowSkeleton count={4} />
            </div>
          </div>
        </section>
      ) : null}

      <section className="content-section">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div className="h-8 w-24 rounded bg-white/[0.08] animate-pulse"></div>
          <div className="flex items-center gap-2">
            <div className="h-10 w-10 rounded-full bg-white/[0.08] animate-pulse"></div>
            <div className="h-10 w-10 rounded-full bg-white/[0.08] animate-pulse"></div>
          </div>
        </div>
        <div className="flex gap-4 overflow-hidden">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="w-[130px] shrink-0 rounded-2xl overflow-hidden border border-white/8 bg-white/[0.03] animate-pulse">
              <div className="aspect-[2/3] bg-white/[0.06]"></div>
              <div className="p-3 space-y-2">
                <div className="h-4 rounded bg-white/[0.08]"></div>
                <div className="h-3 w-2/3 rounded bg-white/[0.06]"></div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
