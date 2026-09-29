import React from 'react';
export function HomeShelfHeader({ title, publisher = '', onViewAll, onPublisherClick = null }) {
  const isTrendingTitle = title === 'Trending Now';
  const titleClassName = isTrendingTitle
    ? 'section-title !mb-0 inline-block !ml-2 sm:!ml-3 !pl-1 !text-[1.45rem] sm:!text-[1.8rem] !font-extrabold overflow-visible'
    : 'section-title !mb-0 inline-block !ml-2 sm:!ml-3 !pl-1 !text-[1.45rem] sm:!text-[1.75rem] !font-bold overflow-visible';
  return (
    <div className="mb-4 flex items-end justify-between gap-4 pr-2 sm:pr-3 lg:pr-6 xl:pr-8">
      <div className="min-w-0">
        {isTrendingTitle ? <span className="shelf-kicker">Now showing</span> : null}
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <h2 className={titleClassName}>
            {title}
          </h2>
          {publisher ? (
            onPublisherClick ? (
              <button
                type="button"
                className="min-w-0 truncate text-base sm:text-[1.05rem] font-semibold text-[var(--cinema-muted)] underline decoration-white/25 underline-offset-4 transition-colors hover:text-[var(--cinema-text)] focus:outline-none focus:ring-2 focus:ring-[var(--cinema-accent)] rounded"
                onClick={onPublisherClick}
              >
                ({publisher})
              </button>
            ) : (
              <span className="min-w-0 truncate text-base sm:text-[1.05rem] font-semibold text-[var(--cinema-muted)]">
                ({publisher})
              </span>
            )
          ) : null}
        </div>
      </div>
      <button
        type="button"
        className="shelf-action focus:outline-none focus:ring-2 focus:ring-[var(--cinema-accent)]"
        onClick={onViewAll}
      >
        <span>View all</span>
        <span aria-hidden="true">→</span>
      </button>
    </div>
  );
}
