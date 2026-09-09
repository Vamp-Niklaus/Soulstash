import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
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
        const finalArray = validUrls.length > 0 ? validUrls : [FALLBACK_AVATAR];
        setPosters(finalArray);

        // Find current banner index
        const currentBanner = collection.banner;
        let index = finalArray.indexOf(currentBanner);
        if (index < 0) index = 0;
        setCurrentIndex(index);

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

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-[999999] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/85 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal Content - Constrained exactly to 16:9 to fit screen */}
      <div 
        className="relative z-10 w-full flex items-center justify-center" 
        style={{ maxWidth: 'min(96vw, 170vh)' }}
      >
        
        {/* Landscape Image Viewer */}
        <div className="relative w-full aspect-video rounded-[20px] overflow-hidden flex items-center justify-center bg-black/40 shadow-2xl">
          
          {/* Bottom Controls (Inside Image) */}
          {!loading && (
            <>
              {/* Close Button */}
              <button
                onClick={onClose}
                className="absolute left-4 bottom-4 p-3 text-white/80 hover:text-white drop-shadow-lg hover:scale-110 transition-all bg-black/40 hover:bg-black/60 rounded-full focus:outline-none z-20 flex items-center justify-center"
                title="Close"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>

              {/* Save Button */}
              <button
                onClick={handleSave}
                disabled={loading}
                className="absolute right-4 bottom-4 p-3 text-[#64FFDA] hover:text-[#52e0c0] drop-shadow-lg hover:scale-110 transition-all bg-black/40 hover:bg-black/60 rounded-full focus:outline-none z-20 flex items-center justify-center disabled:opacity-50"
                title="Save Banner"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </button>
            </>
          )}

          {loading ? (
            <div className="w-8 h-8 border-2 border-white/50 border-t-transparent rounded-full animate-spin" />
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
                    className="absolute left-4 top-1/2 -translate-y-1/2 p-3 text-white/80 hover:text-white drop-shadow-lg hover:scale-110 transition-all bg-black/40 hover:bg-black/60 rounded-full focus:outline-none z-20"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>

                  {/* Right arrow */}
                  <button
                    onClick={handleNext}
                    className="absolute right-4 top-1/2 -translate-y-1/2 p-3 text-white/80 hover:text-white drop-shadow-lg hover:scale-110 transition-all bg-black/40 hover:bg-black/60 rounded-full focus:outline-none z-20"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
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
          <div className="absolute top-4 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full bg-black/40 text-white/80 text-sm font-medium z-20">
            {currentIndex + 1} / {posters.length}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
