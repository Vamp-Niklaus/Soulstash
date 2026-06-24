import React from 'react';

export function ActionButton({ active, label, onClick, icon = null, activeIcon = null, loading = false }) {
  return (
    <button
      type="button"
      disabled={loading}
      className={`flex h-[40px] w-full items-center justify-center gap-1.5 overflow-hidden whitespace-nowrap rounded-full px-3.5 text-[12px] lg:text-[13px] leading-none font-medium transition-all ${
        active ? 'bg-[#00b83d] text-white' : 'bg-gradient-to-r from-[#B048FF] to-[#8F44F0] text-[#E2E2E2]'
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
