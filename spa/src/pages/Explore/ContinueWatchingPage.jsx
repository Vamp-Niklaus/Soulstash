import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { SectionHeader } from '../../components/ui/SectionHeader.jsx';
import { ContinueWatchingCard } from '../../components/ui/Cards/ContinueWatchingCard.jsx';
import {
  getContinueWatchingList,
  removeWatchProgress,
  syncAccountWatchProgress
} from '../../utils/watchProgress.js';
import { HOME_GRID_CLASS } from '../../utils/constants.js';

export function ContinueWatchingPage() {
  const navigate = useNavigate();
  const [list, setList] = useState(() => getContinueWatchingList());
  const [failedCardIds, setFailedCardIds] = useState(() => new Set());

  useEffect(() => {
    document.title = 'Continue Watching | Soulstash';
    syncAccountWatchProgress().catch(() => {});

    const handleUpdate = () => {
      setList(getContinueWatchingList());
    };
    window.addEventListener('soulstash:continue-watching-updated', handleUpdate);
    window.addEventListener('storage', handleUpdate);
    return () => {
      window.removeEventListener('soulstash:continue-watching-updated', handleUpdate);
      window.removeEventListener('storage', handleUpdate);
    };
  }, []);

  const visibleItems = useMemo(() => {
    return list.filter((item) => (item?.poster_path || item?.image) && !failedCardIds.has(item.id || item.key));
  }, [list, failedCardIds]);

  const handleClearAll = () => {
    if (window.confirm('Clear all items from your Continue Watching history?')) {
      for (const item of visibleItems) {
        removeWatchProgress(item);
      }
      setList([]);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <SectionHeader title="Continue Watching" />
        {visibleItems.length > 0 && (
          <button
            type="button"
            onClick={handleClearAll}
            className="text-xs font-semibold text-white/50 hover:text-red-400 transition-colors px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10"
          >
            Clear all
          </button>
        )}
      </div>

      {visibleItems.length === 0 ? (
        <div className="empty-state py-16 text-center space-y-4">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-white/5 text-white/40">
            <i className="fas fa-play text-2xl" />
          </div>
          <div className="space-y-1">
            <h3 className="text-lg font-bold text-white/90">No titles in progress</h3>
            <p className="text-sm text-white/50 max-w-sm mx-auto">
              Start watching movies or series and they will appear here so you can pick up right where you left off.
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="inline-flex items-center gap-2 rounded-full bg-white/10 hover:bg-white/20 px-5 py-2 text-sm font-semibold text-white transition-all"
          >
            <span>Explore Trending</span>
            <span aria-hidden="true">→</span>
          </button>
        </div>
      ) : (
        <div className={HOME_GRID_CLASS}>
          {visibleItems.map((entry) => (
            <ContinueWatchingCard
              key={entry.key || `continue-page-${entry.id}`}
              entry={entry}
              onRemove={(it) => {
                removeWatchProgress(it);
                setList(getContinueWatchingList());
              }}
              onImageError={() => setFailedCardIds((prev) => new Set(prev).add(entry.id || entry.key))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
