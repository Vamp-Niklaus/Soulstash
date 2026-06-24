import { imageUrl } from '../../../utils/formatters.js';
import { useState } from 'react';
import { FALLBACK_AVATAR } from '../../../utils/constants.js';
import { splitTrendingIntoColumns } from '../../../utils/helpers.js';
import React, { useEffect, useRef } from 'react';
import { FALLBACK_AUTH_POSTERS } from '../../../utils/constants.js';

export function AuthPosterColumns() {
  const [columns] = useState(() => splitTrendingIntoColumns(FALLBACK_AUTH_POSTERS));

  const animationClasses = ['auth-poster-column--up', 'auth-poster-column--down', 'auth-poster-column--up'];

  return (
    <div className="hidden lg:flex fixed left-0 top-0 w-1/2 h-screen">
      <div className="w-full h-full flex justify-center items-center relative">
        <div className="w-[90%] h-full flex space-x-8">
          {columns.map((columnItems, columnIndex) => (
            <div key={columnIndex} className="relative h-full overflow-hidden w-1/3">
              <div className={animationClasses[columnIndex]}>
                {columnItems.length
                  ? Array.from({ length: 5 }).map((_, duplicateIndex) => (
                      <div key={duplicateIndex} className="flex flex-col">
                        {columnItems.map((movie, itemIndex) => (
                          <div key={`${duplicateIndex}-${itemIndex}-${movie.id || 'unknown'}`} className="relative w-full aspect-[2/3] my-4 rounded-lg overflow-hidden shadow-lg opacity-90 flex-shrink-0">
                            <img
                              src={imageUrl(movie.poster_path, 'w500')}
                              alt={movie.title || movie.name || 'Poster'}
                              className="object-cover w-full h-full"
                              loading="lazy"
                              onError={(event) => {
                                event.currentTarget.src = FALLBACK_AVATAR;
                              }}
                            />
                          </div>
                        ))}
                      </div>
                    ))
                  : Array.from({ length: 10 }).map((_, itemIndex) => (
                      <div key={itemIndex} className="relative w-full aspect-[2/3] my-4 rounded-lg overflow-hidden shadow-lg bg-white/[0.05]" />
                    ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
