import React, { useState, useEffect } from 'react';
import { FALLBACK_AVATAR } from '../../../utils/constants.js';
import { imageUrl } from '../../../utils/formatters.js';
import { apiFetch } from '../../../api/client.js';

/**
 * EditCollectionPosterModal
 *
 * Fullscreen overlay that lets the user pick a landscape backdrop image
 * from the movies/series in their collection as the collection banner.
 *
 * Index 0 = FALLBACK_AVATAR (the default).
 * Index 1+ = validated backdrop_path images from collection movies.
 */
export function EditCollectionPosterModal({ open, onClose, collection, onSave }) {
  const [posters, setPosters] = useState([]);
  const [updatedMovies, setUpdatedMovies] = useState(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open || !collection) return;

    let isMounted = true;
    setLoading(true);

    const loadPosters = async () => {
      if (!collection.movies || collection.movies.length === 0) {
        if (isMounted) {
          setPosters([FALLBACK_AVATAR]);
          setLoading(false);
        }
        return;
      }

      // Fetch missing backdrops
      const moviePromises = collection.movies.map(async (m) => {
        if (m.backdrop_path) return m;

        try {
          const typeStr = m.media_type === 'Series' || m.seriesId ? 'series' : 'movies';
          const id = m.id || m.movieId || m.seriesId;
          const detail = await apiFetch(`/api/${typeStr}/${id}`);
          return { ...m, backdrop_path: detail.backdrop_path || null };
        } catch (e) {
          return m;
        }
      });

      const moviesWithBackdrops = await Promise.all(moviePromises);
      
      const rawUrls = moviesWithBackdrops
        .map(m => m.backdrop_path ? imageUrl(m.backdrop_path, 'w780') : null)
        .filter(Boolean);
      
      const uniqueUrls = [...new Set(rawUrls)];

      const preloadImage = (src) => {
        return new Promise((resolve) => {
          const img = new Image();
          img.onload = () => resolve(src);
          img.onerror = () => resolve(null);
          img.src = src;
        });
      };

      const validUrls = (await Promise.all(uniqueUrls.map(preloadImage))).filter(Boolean);

      if (isMounted) {
        setUpdatedMovies(moviesWithBackdrops);
        const finalArray = [FALLBACK_AVATAR, ...validUrls];
        setPosters(finalArray);

        // Find current banner index
        const currentBanner = collection.banner || FALLBACK_AVATAR;
        const index = finalArray.indexOf(currentBanner);
        setCurrentIndex(index >= 0 ? index : 0);

        setLoading(false);
      }
    };

    loadPosters();

    return () => {
      isMounted = false;
    };
  }, [open, collection]);

  if (!open) return null;

  const handlePrev = () => {
    setCurrentIndex((prev) => (prev === 0 ? posters.length - 1 : prev - 1));
  };

  const handleNext = () => {
    setCurrentIndex((prev) => (prev === posters.length - 1 ? 0 : prev + 1));
  };

  const handleSave = () => {
    onSave(posters[currentIndex], updatedMovies);
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/85 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal Content */}
      <div className="relative z-10 w-full max-w-[640px] flex flex-col items-center gap-5">
        {/* Top Controls */}
        <div className="flex w-full items-center justify-between px-1">
          <button
            onClick={onClose}
            className="text-white/70 hover:text-white transition-colors p-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          <button
            onClick={handleSave}
            disabled={loading}
            className="text-[#64FFDA] hover:text-[#52e0c0] font-semibold transition-colors px-5 py-2 text-sm"
          >
            Save
          </button>
        </div>

        {/* Landscape Image Viewer */}
        <div className="relative w-full aspect-[16/9] rounded-[20px] overflow-hidden bg-[#111] shadow-2xl flex items-center justify-center">
          {loading ? (
            <div className="w-8 h-8 border-2 border-[#64FFDA] border-t-transparent rounded-full animate-spin" />
          ) : (
            <>
              <img
                src={posters[currentIndex]}
                alt="Selected Banner"
                className="w-full h-full object-cover transition-opacity duration-300"
              />

              {posters.length > 1 && (
                <>
                  {/* Left arrow */}
                  <button
                    onClick={handlePrev}
                    className="absolute left-3 top-1/2 -translate-y-1/2 p-2 text-white/80 hover:text-white drop-shadow-lg hover:scale-110 transition-all"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>

                  {/* Right arrow */}
                  <button
                    onClick={handleNext}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-white/80 hover:text-white drop-shadow-lg hover:scale-110 transition-all"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </>
              )}
            </>
          )}
        </div>

        {/* Indicator */}
        {!loading && posters.length > 1 && (
          <div className="text-white/50 text-sm font-medium">
            {currentIndex + 1} / {posters.length}
          </div>
        )}
      </div>
    </div>
  );
}
