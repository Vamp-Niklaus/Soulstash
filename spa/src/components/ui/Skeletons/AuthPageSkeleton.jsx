import React from 'react';

export function AuthPageSkeleton({ posterColumn = true }) {
  return (
    <div className="h-[calc(100vh-88px)] overflow-hidden">
      <div className="grid h-[calc(100vh-88px)] overflow-hidden bg-transparent lg:grid-cols-[1.08fr_0.92fr]">
        {posterColumn ? (
          <div className="relative hidden overflow-hidden bg-transparent lg:flex">
            <div className="flex w-full items-center justify-center animate-pulse">
              <div className="h-[70%] w-[70%] rounded-[32px] bg-white/[0.04]"></div>
            </div>
          </div>
        ) : null}
        <div className="flex h-[calc(100vh-88px)] items-center justify-center bg-transparent px-4 sm:px-6 lg:px-10">
          <div className="w-full max-w-[424px] animate-pulse space-y-6">
            <div className="h-8 w-40 rounded bg-white/[0.08]"></div>
            <div className="h-4 w-60 rounded bg-white/[0.06]"></div>
            <div className="space-y-4">
              <div className="h-11 w-full rounded-2xl bg-white/[0.06]"></div>
              <div className="h-11 w-full rounded-2xl bg-white/[0.06]"></div>
            </div>
            <div className="h-11 w-full rounded-full bg-white/[0.08]"></div>
            <div className="h-4 w-52 rounded bg-white/[0.05]"></div>
          </div>
        </div>
      </div>
    </div>
  );
}
