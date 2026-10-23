import React, { useState, useEffect, useRef } from 'react';
import { FALLBACK_AVATAR } from '../../../utils/constants.js';
import { ActionButton } from '../ActionButton.jsx';

export function ConfirmModal({ open, title, message, confirmLabel, onConfirm, onClose, danger = false }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose}></div>
      <div className="relative z-10 w-full max-w-sm rounded-[24px] bg-[#111111] p-5 shadow-[0_28px_80px_rgba(0,0,0,0.45)]">
        <h3 className="text-xl font-semibold text-white">{title}</h3>
        <p className="text-sm text-[#9b9b9b] mt-3 leading-6">{message}</p>
        <div className="flex gap-3 pt-5">
          <button type="button" className="flex-1 h-11 rounded-2xl bg-white/[0.06] text-white" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={`flex-1 h-11 rounded-2xl ${danger ? 'bg-[#ff5d5d] text-white' : 'bg-white text-black'}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
