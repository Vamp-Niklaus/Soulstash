import React from 'react';
import { isTmdbSource, isLetterboxdSource } from '../../../utils/collectionSource.js';

export function CollectionVisibilityBadge({ collection, iconOnly = false }) {
  const isLetterboxd = isLetterboxdSource(collection);
  const isTmdb = isTmdbSource(collection);
  const isPublic = collection?.isPublic === true || collection?.isPublished === true;

  if (isLetterboxd) {
    return (
      <div className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium bg-[#00e054]/10 border border-[#00e054]/25 text-[#00e054] gap-1.5 w-fit h-fit">
        <span className="inline-flex items-center gap-0.5">
          <span className="w-1.5 h-1.5 rounded-full bg-[#ff8000]"></span>
          <span className="w-1.5 h-1.5 rounded-full bg-[#00e054]"></span>
          <span className="w-1.5 h-1.5 rounded-full bg-[#40bcf4]"></span>
        </span>
        {iconOnly ? null : <span className="text-[#00e054] text-xs font-semibold">Letterboxd</span>}
      </div>
    );
  }

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
