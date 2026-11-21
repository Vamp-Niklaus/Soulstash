import React from 'react';

export function CollectionVisibilityBadge({ collection, iconOnly = false }) {
  const isTmdb = collection?.source === 'tmdb' || String(collection?.username || '').toLowerCase() === 'tmdb';
  const isPublic = collection?.isPublic === true || collection?.isPublished === true;

  if (isTmdb) {
    return (
      <div className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium bg-amber-500/10 border border-amber-500/20 text-amber-300 gap-1.5 w-fit h-fit">
        <i className="fas fa-layer-group text-amber-400 text-[10px]"></i>
        {iconOnly ? null : <span className="text-amber-300/90 text-xs font-semibold">Franchise</span>}
      </div>
    );
  }

  return (
    <div className="inline-flex items-center rounded-full px-2 py-1 text-[11px] font-medium bg-white/[0.05] text-gray-300 gap-1 w-fit h-fit">
      <i className={`fas ${isPublic ? 'fa-globe' : 'fa-lock'} text-gray-400 text-[10px]`}></i>
      {iconOnly ? null : <span className="text-gray-400 text-xs">{isPublic ? 'Public' : 'Private'}</span>}
    </div>
  );
}
