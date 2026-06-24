import React from 'react';
import { NavLink } from 'react-router-dom';

export function PolicyPage({ title, subtitle, sections }) {
  return (
    <div className="min-h-[calc(100vh-88px)] flex items-center justify-center px-4 py-8">
      <div className="max-w-4xl w-full rounded-[28px] border border-white/8 bg-[rgba(20,20,20,0.95)] p-8 md:p-12 shadow-[0_24px_70px_rgba(0,0,0,0.35)]">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white">{title}</h1>
          <p className="mt-3 text-[#919191]">{subtitle}</p>
        </div>
        <div className="space-y-8">
          {sections.map((section) => (
            <section key={section.heading}>
              <h2 className="text-2xl font-semibold text-white mb-3">{section.heading}</h2>
              {section.paragraphs?.map((paragraph) => (
                <p key={paragraph} className="text-[#e2e2e2] leading-7 mb-3">{paragraph}</p>
              ))}
              {section.items?.length ? (
                <ul className="list-disc ml-6 space-y-2 text-[#e2e2e2]">
                  {section.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
