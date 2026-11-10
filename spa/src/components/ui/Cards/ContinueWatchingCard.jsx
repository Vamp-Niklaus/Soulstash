import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { imageUrl, mediaRoute } from '../../../utils/formatters.js';
import { FALLBACK_POSTER } from '../../../utils/constants.js';

function formatRemaining(currentTime, duration) {
  if (!duration || duration <= 0) return '';
  const remainingSecs = Math.max(0, duration - currentTime);
  const mins = Math.round(remainingSecs / 60);
  if (mins < 1) return '< 1m left';
  if (mins < 60) return `${mins}m left`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hrs}h ${remMins}m left`;
}

export const ContinueWatchingCard = React.forwardRef(function ContinueWatchingCard(
  { entry, onRemove, onImageError, ...props },
  ref
) {
  const navigate = useNavigate();
  const [imgFailed, setImgFailed] = useState(false);

  if (!entry || !entry.key) return null;

  const rawPoster = entry.poster_path || entry.image || entry.backdrop_path || entry.backdrop || entry.coverImage;
  const isBroken = !rawPoster ||
    typeof rawPoster !== 'string' ||
    !rawPoster.trim() ||
    rawPoster === 'null' ||
    rawPoster === '/null' ||
    rawPoster === 'undefined' ||
    rawPoster === '/undefined' ||
    imgFailed;

  const posterSrc = isBroken ? FALLBACK_POSTER : imageUrl(rawPoster, 'w342');
  const title = entry.title || entry.name || 'Unknown';
  const progressPercent = Math.min(100, Math.max(0, Math.round((entry.progress || 0) * 100)));
  const remainingText = formatRemaining(entry.currentTime, entry.duration);

  const handleClick = (e) => {
    // If remove button was clicked, don't navigate
    if (e.target.closest('button[data-remove-button="true"]')) return;
    const targetRoute = mediaRoute(entry);
    navigate(targetRoute, {
      state: {
        resumeTime: entry.currentTime,
        seasonNumber: entry.seasonNumber,
        episodeNumber: entry.episodeNumber,
        kartoonsSlug: entry.kartoons_slug || entry.kartoonsSlug || '',
        autoPlay: true
      }
    });
  };

  return (
    <div
      ref={ref}
      {...props}
      className="card group relative cursor-pointer select-none text-left"
      onClick={handleClick}
      tabIndex={0}
      role="button"
      aria-label={`Continue watching ${title}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick(e);
        }
      }}
    >
      <div className="cardImageWrap relative overflow-hidden rounded-[14px] bg-[#1a1a1a]">
        <img
          src={posterSrc}
          alt={title}
          className="cardImg fadeImg"
          loading="lazy"
          decoding="async"
          onError={() => {
            setImgFailed(true);
            onImageError?.();
          }}
        />

        {/* Remove button */}
        {onRemove && (
          <button
            type="button"
            data-remove-button="true"
            onClick={(e) => {
              e.stopPropagation();
              onRemove(entry);
            }}
            className="absolute top-2 right-2 z-20 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white/70 hover:bg-black hover:text-white transition-opacity opacity-0 group-hover:opacity-100 focus:opacity-100"
            title="Remove from Continue Watching"
            aria-label="Remove from Continue Watching"
          >
            <i className="fas fa-times text-xs" />
          </button>
        )}

        {/* Episode badge */}
        {(entry.seasonNumber || entry.episodeNumber) && (
          <div className="absolute top-2 left-2 z-10 rounded bg-black/80 px-1.5 py-0.5 text-[10px] font-mono font-semibold text-white/90 shadow">
            S{entry.seasonNumber || 1} E{entry.episodeNumber || 1}
          </div>
        )}

        {/* Bottom gradient overlay with time remaining */}
        <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/90 via-black/40 to-transparent px-2.5 pb-2 pt-6">
          <div className="flex items-center justify-between text-[11px] font-medium text-white/90">
            <span className="truncate max-w-[70%]">{remainingText || `${progressPercent}%`}</span>
            <i className="fas fa-play text-[10px] text-red-500 opacity-90" />
          </div>
        </div>

        {/* Progress Bar */}
        <div className="absolute inset-x-0 bottom-0 z-20 h-1 bg-white/20">
          <div
            className="h-full bg-red-600 transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Card title below poster */}
      <div className="cardMeta mt-1.5 px-0.5">
        <h4 className="cardTitle truncate text-xs font-semibold text-white/90" title={title}>
          {title}
        </h4>
      </div>
    </div>
  );
});
