import { COLLECTION_NAME_MAX_LENGTH } from '../../../utils/constants.js';
import React, { useState, useEffect, useRef } from 'react';
import { FALLBACK_AVATAR } from '../../../utils/constants.js';
import { ActionButton } from '../ActionButton.jsx';

export function CollectionFormModal({
  open,
  values,
  onChange,
  onClose,
  onSubmit,
  saving,
  title = 'Create New Collection',
  submitLabel = 'Create Collection',
  lockName = false,
  lockPrivate = false
}) {
  if (!open) return null;

  const nameLength = values.name.length;
  const descriptionLength = values.description.length;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose}></div>
      <div className="relative z-10 w-full max-w-[440px] rounded-[18px] border border-white/10 bg-[#111111] p-5 sm:p-5 shadow-[0_24px_64px_rgba(0,0,0,0.5)]">
        <div className="mb-5 flex items-start justify-between gap-4">
          <h3 className="text-[18px] sm:text-[20px] font-semibold text-white leading-tight">{title}</h3>
          <button type="button" className="h-8 w-8 rounded-full text-[#b5b5b5] hover:bg-white/[0.06] hover:text-white transition-colors" onClick={onClose} aria-label="Close">
            <i className="fas fa-times"></i>
          </button>
        </div>
        <div className="space-y-4">
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <label className="block text-sm text-[#cfcfcf]">Collection Name</label>
              <span className="text-xs text-[#7d7d7d]">{nameLength}/{COLLECTION_NAME_MAX_LENGTH}</span>
            </div>
            <input
              type="text"
              value={values.name}
              maxLength={COLLECTION_NAME_MAX_LENGTH}
              disabled={lockName}
              onChange={(event) => onChange((current) => ({ ...current, name: event.target.value }))}
              placeholder="Enter a name for your collection"
              className={`w-full h-11 rounded-xl border border-white/10 px-4 text-white outline-none ${lockName ? 'bg-[#181818] text-[#8f8f8f] cursor-not-allowed' : 'bg-[#1f1f1f] focus:border-[#8f44f0]'}`}
            />
            {lockName ? <p className="mt-2 text-xs text-[#7d7d7d]">The name of this collection cannot be changed.</p> : null}
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <label className="block text-sm text-[#cfcfcf]">Description</label>
              <span className="text-xs text-[#7d7d7d]">{descriptionLength}/150</span>
            </div>
            <textarea
              value={values.description}
              maxLength={150}
              onChange={(event) => onChange((current) => ({ ...current, description: event.target.value }))}
              placeholder="Add a description (optional)"
              className="min-h-[112px] w-full rounded-xl border border-white/10 bg-[#1f1f1f] px-4 py-3 text-white outline-none resize-none focus:border-[#8f44f0]"
            />
          </div>
          <div>
            <label className="block text-sm text-[#cfcfcf] mb-3">Visibility</label>
            <div className="rounded-xl bg-[#1f1f1f] p-1">
              <div className="grid grid-cols-2 gap-1">
                {[
                  { value: false, label: 'Private', icon: 'fa-lock' },
                  { value: true, label: 'Public', icon: 'fa-globe' }
                ].map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    disabled={lockPrivate && option.value === false}
                    className={`flex h-11 items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors ${
                      values.isPublic === option.value ? 'bg-[#bcbcbc] text-[#111111]' : 'text-[#a8a8a8] hover:bg-white/[0.04]'
                    } ${lockPrivate && option.value === false ? 'cursor-not-allowed opacity-45 hover:bg-transparent' : ''
                    }`}
                    onClick={() => {
                      if (lockPrivate && option.value === false) return;
                      onChange((current) => ({ ...current, isPublic: option.value }));
                    }}
                  >
                    <i className={`fas ${option.icon} text-xs`}></i>
                    <span>{option.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <p className="mt-3 text-sm text-[#8d8d8d]">
              {lockPrivate ? 'Unpublish this collection before making it private' : values.isPublic ? 'Anyone with the link can view this collection' : 'Only you can view this collection'}
            </p>
          </div>
          <div className="pt-1">
            <button
              type="button"
              className="h-11 w-full rounded-xl bg-[#c4c4c4] text-[#111111] font-medium transition-colors hover:bg-[#b8b8b8] disabled:opacity-60"
              onClick={onSubmit}
              disabled={saving}
            >
              {saving ? 'Saving...' : submitLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
