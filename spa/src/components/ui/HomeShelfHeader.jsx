import React from 'react';

export function HomeShelfHeader({ title, publisher = '', onViewAll, onPublisherClick = null }) {
  const isTrendingTitle = title === 'Trending Now';
  const titleClassName = isTrendingTitle
    ? 'section-title !mb-0 inline-block !ml-2 sm:!ml-3 !pl-1 !text-[1.45rem] sm:!text-[1.8rem] !font-extrabold tracking-tight overflow-visible'
    : 'section-title !mb-0 inline-block !ml-2 sm:!ml-3 !pl-1 !text-[1.45rem] sm:!text-[1.75rem] !font-bold tracking-tight overflow-visible';
  return (
    <div className="mb-4 flex items-end justify-between gap-4 pr-2 sm:pr-3 lg:pr-6 xl:pr-8">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <h2 className={titleClassName}>
            {title}
          </h2>
          {publisher ? (
            onPublisherClick ? (
              <button
                type="button"
                className="min-w-0 truncate text-base sm:text-[1.05rem] font-semibold text-[#d7d7d7] underline decoration-white/25 underline-offset-4 transition-colors hover:text-white focus:outline-none focus:ring-2 focus:ring-white rounded"
                onClick={onPublisherClick}
              >
                ({publisher})
              </button>
            ) : (
              <span className="min-w-0 truncate text-base sm:text-[1.05rem] font-semibold text-[#d7d7d7]">
                ({publisher})
              </span>
            )
          ) : null}
        </div>
      </div>
      <button
        type="button"
        className="flex-shrink-0 rounded-full border border-white/10 bg-white/[0.06] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/[0.12] focus:outline-none focus:ring-2 focus:ring-white"
        onClick={onViewAll}
      >
        View all
      </button>
    </div>
  );
}
