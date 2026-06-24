import { useNavigate } from 'react-router-dom';
import React from 'react';
import { AuthPosterColumns } from './AuthPosterColumns.jsx';

export function AuthPageLayout({ title, subtitle, children, altLabel, altAction, altHref, posterColumn = true }) {
  const navigate = useNavigate();

  return (
    <div className="min-h-[calc(100vh-88px)] lg:h-[calc(100vh-88px)] lg:overflow-hidden">
      <div className="grid min-h-[calc(100vh-88px)] lg:h-[calc(100vh-88px)] lg:overflow-hidden bg-transparent lg:grid-cols-[1.08fr_0.92fr]">
        {posterColumn ? (
          <div className="relative hidden overflow-hidden bg-transparent lg:flex">
            <AuthPosterColumns />
          </div>
        ) : null}

        <div className="flex min-h-[calc(100vh-88px)] lg:h-[calc(100vh-88px)] items-center justify-center bg-transparent px-4 py-8 sm:px-6 lg:px-10 overflow-y-auto">
          <div className="w-full max-w-[424px] my-auto">
            <h2 className="text-3xl font-semibold text-white">{title}</h2>
            {subtitle ? <p className="mt-2 text-sm leading-6 text-[#9f9f9f]">{subtitle}</p> : null}
            <div className="mt-6">{children}</div>
            <p className="mt-6 text-sm text-[#9f9f9f]">
              {altLabel}{' '}
              <button type="button" className="font-medium text-white hover:underline" onClick={() => navigate(altHref)}>
                {altAction}
              </button>
            </p>
            <div className="mt-10 text-center">
              <p className="text-[15px] font-medium text-white/80">&copy; 2026 Soulstash. All rights reserved.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
