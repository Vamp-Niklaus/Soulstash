import React from 'react';

export function ActionButton({ active, label, onClick, icon = null, activeIcon = null, loading = false, tone = 'neutral' }) {
  return (
    <button
      type="button"
      disabled={loading}
      className={`action-button action-button--${tone} flex h-[40px] w-full items-center justify-center gap-1.5 overflow-hidden whitespace-nowrap px-3.5 text-[12px] lg:text-[13px] leading-none font-semibold transition-all ${
        active ? 'is-active' : ''
      } ${loading ? 'opacity-70 cursor-wait' : ''}`}
      onClick={onClick}
    >
      {loading ? (
        <i className="fas fa-spinner fa-spin shrink-0 text-[12px]"></i>
      ) : active ? (
        activeIcon ? <i className={`${activeIcon} shrink-0 text-[12px]`}></i> : icon ? <i className={`${icon} shrink-0 text-[12px]`}></i> : null
      ) : icon ? (
        <i className={`${icon} shrink-0 text-[12px]`}></i>
      ) : null}
      <span className="truncate">{loading ? 'Updating...' : label}</span>
    </button>
  );
}
