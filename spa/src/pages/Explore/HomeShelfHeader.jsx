import React from 'react';

export function HomeShelfHeader({ title, publisher = '', onViewAll, onPublisherClick = null }) {
  // Strip trailing " Collection" (case-insensitive)
  const cleanTitle = (title || '').replace(/\s+collection$/i, '').trim();

  // For collections/lists that have a publisher (e.g. TMDB, community usernames)
  if (publisher) {
    return (
      <div className="mb-3 sm:mb-4 px-1 sm:px-2">
        {/* Row 1: Title only, single row, small clean font, truncated with ... if too long */}
        <div className="min-w-0 w-full mb-1">
          <h2
            className="truncate text-[1.12rem] sm:text-[1.35rem] font-bold text-white tracking-tight leading-snug block w-full pl-0.5"
            title={cleanTitle}
          >
            {cleanTitle}
          </h2>
        </div>

        {/* Row 2: (publisher) on the left, View all button on the right */}
        <div className="flex items-center justify-between gap-3 pl-0.5">
          <div className="min-w-0">
            {onPublisherClick ? (
              <button
                type="button"
                className="truncate text-xs sm:text-[0.85rem] font-semibold text-[var(--cinema-muted)] underline decoration-white/25 underline-offset-4 hover:text-[var(--cinema-text)] transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--cinema-accent)] rounded"
                onClick={onPublisherClick}
              >
                ({publisher})
              </button>
            ) : (
              <span className="truncate text-xs sm:text-[0.85rem] font-semibold text-[var(--cinema-muted)]">
                ({publisher})
              </span>
            )}
          </div>

          {onViewAll && (
            <button
              type="button"
              className="shelf-action !text-xs sm:!text-[0.85rem] focus:outline-none focus:ring-2 focus:ring-[var(--cinema-accent)]"
              onClick={onViewAll}
            >
              <span>View all</span>
              <span aria-hidden="true">→</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  // Standard shelf header (Trending Now, Continue Watching, Popular, etc.)
  const isTrendingTitle = cleanTitle === 'Trending Now';
  const titleClassName = isTrendingTitle
    ? 'section-title !mb-0 inline-block !ml-2 sm:!ml-3 !pl-1 !text-[1.45rem] sm:!text-[1.8rem] !font-extrabold overflow-visible'
    : 'section-title !mb-0 inline-block !ml-2 sm:!ml-3 !pl-1 !text-[1.45rem] sm:!text-[1.75rem] !font-bold overflow-visible';

  return (
    <div className="mb-4 flex items-end justify-between gap-4 pr-2 sm:pr-3 lg:pr-6 xl:pr-8">
      <div className="min-w-0">
        <h2 className={titleClassName}>
          {cleanTitle}
        </h2>
      </div>
      {onViewAll ? (
        <button
          type="button"
          className="shelf-action focus:outline-none focus:ring-2 focus:ring-[var(--cinema-accent)]"
          onClick={onViewAll}
        >
          <span>View all</span>
          <span aria-hidden="true">→</span>
        </button>
      ) : null}
    </div>
  );
}
