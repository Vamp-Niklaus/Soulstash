import React from 'react';

export function CollectionVisibilityBadge({ collection, iconOnly = false }) {
  const isPublic = collection?.isPublic === true || collection?.isPublished === true;
  return (
    <div className="inline-flex items-center rounded-full px-2 py-1 text-[11px] font-medium bg-white/[0.05] text-gray-300 gap-1 w-fit h-fit">
      <i className={`fas ${isPublic ? 'fa-globe' : 'fa-lock'} text-gray-400 text-[10px]`}></i>
      {iconOnly ? null : <span className="text-gray-400 text-xs">{isPublic ? 'Public' : 'Private'}</span>}
    </div>
  );
}
