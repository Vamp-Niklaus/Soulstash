import { isContentInCollection } from '../../../utils/formatters.js';
import React, { useState, useEffect, useRef } from 'react';
import { FALLBACK_AVATAR } from '../../../utils/constants.js';
import { ActionButton } from '../ActionButton.jsx';
import { CollectionFormModal } from './CollectionFormModal.jsx';
import { toast } from '../../../utils/toast.js';

export function SaveToCollectionModal({ open, onClose, collections, contentId, onToggleCollection, onCreateNew }) {
  if (!open) return null;

  const customCollections = collections.filter((collection) => !['Watched', 'Watchlist'].includes(collection.name));

  return (
    <div className="fixed inset-0 z-[76] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose}></div>
      <div className="relative z-10 w-full max-w-[420px] rounded-[24px] border border-white/10 bg-[#1f1f1f] p-5 shadow-[0_30px_90px_rgba(0,0,0,0.55)]">
        <div className="mb-5 flex items-center justify-between gap-4">
          <h3 className="text-[20px] font-semibold text-white">Save to Collection</h3>
          <button type="button" className="h-9 w-9 rounded-full text-[#b5b5b5] hover:bg-white/[0.05] hover:text-white" onClick={onClose} aria-label="Close">
            <i className="fas fa-times"></i>
          </button>
        </div>

        <div className="space-y-2">
          {customCollections.length ? (
            customCollections.map((collection) => {
              const selected = isContentInCollection(collections, collection.name, contentId);
              return (
                <button
                  key={collection._id || collection.name}
                  type="button"
                  className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-3 text-left hover:bg-white/[0.04]"
                  onClick={() => onToggleCollection(collection)}
                >
                  <span className="flex items-center gap-3 min-w-0">
                    <span className={`flex h-6 w-6 items-center justify-center rounded-md border ${selected ? 'border-[#9a45ff] bg-[#9a45ff]' : 'border-white/30 bg-transparent'}`}>
                      {selected ? <i className="fas fa-check text-[11px] text-white"></i> : null}
                    </span>
                    <span className="truncate text-white">{collection.name}</span>
                  </span>
                  <i className={`fas ${collection.isPublic ? 'fa-globe' : 'fa-lock'} text-sm text-[#9ca3af]`}></i>
                </button>
              );
            })
          ) : (
            <div className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-[#9b9b9b]">
              No custom collections yet.
            </div>
          )}
        </div>

        <button
          type="button"
          className="mt-5 flex w-full items-center gap-3 rounded-xl border border-dashed border-[#5a5a7c] px-4 py-4 text-left text-white hover:bg-white/[0.03]"
          onClick={onCreateNew}
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-black">
            <i className="fas fa-plus text-xs"></i>
          </span>
          <span className="font-medium">Create New Collection</span>
        </button>
      </div>
    </div>
  );
}
