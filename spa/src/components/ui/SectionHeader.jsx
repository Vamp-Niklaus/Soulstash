import React from 'react';

export function SectionHeader({ title, subtitle, large = false }) {
  const isLargeTitle = title === 'Trending Now' || large;
  const titleClassName = isLargeTitle
    ? 'section-title !mb-0 inline-block !ml-2 sm:!ml-3 !pl-1 !text-2xl sm:!text-3xl !font-black tracking-tight overflow-visible'
    : 'section-title !mb-0';
  return (
    <div className="flex items-end justify-between mb-4 gap-4">
      <div>
        <h2 className={titleClassName}>
          {title}
        </h2>
        {subtitle ? <p className="text-sm text-[#9f9f9f] mt-1">{subtitle}</p> : null}
      </div>
    </div>
  );
}
