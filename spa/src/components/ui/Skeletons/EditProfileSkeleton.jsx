import React from 'react';

export function EditProfileSkeleton() {
  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-pulse">
      <section className="rounded-[28px] bg-[rgba(255,255,255,0.03)] p-5 md:p-7">
        <div className="h-7 w-40 rounded bg-white/[0.08]"></div>
        <div className="mt-3 h-4 w-72 rounded bg-white/[0.06]"></div>
        <div className="mt-8 space-y-7">
          <div className="flex flex-col sm:flex-row items-center gap-6">
            <div className="h-24 w-24 rounded-full bg-white/[0.08] ring-1 ring-white/10"></div>
            <div className="space-y-2">
              <div className="h-4 w-28 rounded bg-white/[0.06]"></div>
              <div className="h-3 w-44 rounded bg-white/[0.05]"></div>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="space-y-2">
                <div className="h-4 w-24 rounded bg-white/[0.06]"></div>
                <div className="h-11 w-full rounded-2xl bg-white/[0.05]"></div>
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <div className="h-4 w-24 rounded bg-white/[0.06]"></div>
            <div className="h-28 w-full rounded-2xl bg-white/[0.05]"></div>
          </div>
          <div className="h-11 w-40 rounded-full bg-white/[0.08]"></div>
        </div>
      </section>
    </div>
  );
}
