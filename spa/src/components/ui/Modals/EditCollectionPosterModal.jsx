import React, { useState, useEffect, useRef } from 'react';
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
 * Opens instantly with the current banner, buffering next/prev movie backdrops
 * in the background (+/- 5 images) as the user navigates.
 */
export function EditCollectionPosterModal({ open, onClose, collection, onSave }) {
  const [posters, setPosters] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const fetchedIdsRef = useRef(new Set());
  const moviesRef = useRef([]);

  // Initialize immediately on open with current banner and any already-known backdrops
  useEffect(() => {
    if (!open || !collection) return;

    const currentBanner = collection.banner
      ? (collection.banner.includes('image.tmdb.org/t/p/')
          ? collection.banner.replace(/\/t\/p\/(w780|w1280|w500)/, '/t/p/original')
          : collection.banner)
      : FALLBACK_AVATAR;
    const movies = Array.isArray(collection.movies) ? collection.movies : [];
    moviesRef.current = movies;
    fetchedIdsRef.current = new Set();

    const initial = [currentBanner];
    for (const m of movies) {
      if (m?.backdrop_path) {
        const url = imageUrl(m.backdrop_path, 'original');
        if (url && !initial.includes(url)) {
          initial.push(url);
          const id = m.id || m.movieId || m.seriesId;
          if (id) fetchedIdsRef.current.add(id);
        }
      }
    }

    setPosters(initial);
    setCurrentIndex(0);
  }, [open, collection]);

  // Buffer loader: fetches backdrops for movies near currentIndex (buffer of 5)
  useEffect(() => {
    if (!open || !collection) return;

    let isMounted = true;
    const movies = moviesRef.current;
    if (!movies || !movies.length) return;

    // Find unfetched movies prioritized by distance from currentIndex
    const unfetched = [];
    for (let i = 0; i < movies.length; i++) {
      const m = movies[i];
      const id = m?.id || m?.movieId || m?.seriesId;
      if (id && !fetchedIdsRef.current.has(id) && !m.backdrop_path) {
        unfetched.push({ movie: m, id, dist: Math.abs(i - currentIndex) });
      }
    }

    if (unfetched.length === 0) return;

    // Sort by proximity and take up to 5 movies to buffer
    unfetched.sort((a, b) => a.dist - b.dist);
    const batch = unfetched.slice(0, 5);

    batch.forEach(item => fetchedIdsRef.current.add(item.id));

    Promise.all(batch.map(async ({ movie, id }) => {
      try {
        const typeStr = movie.media_type === 'Series' || movie.seriesId ? 'series' : 'movies';
        const detail = await apiFetch(`/api/${typeStr}/${id}`);
        if (detail?.backdrop_path) {
          return imageUrl(detail.backdrop_path, 'original');
        }
      } catch {
        // Ignore single movie fetch errors
      }
      return null;
    })).then(results => {
      if (!isMounted) return;
      const newUrls = results.filter(Boolean);
      if (newUrls.length > 0) {
        setPosters(prev => {
          const combined = [...prev];
          for (const u of newUrls) {
            if (!combined.includes(u)) {
              combined.push(u);
            }
          }
          return combined;
        });
      }
    });

    return () => {
      isMounted = false;
    };
  }, [open, collection, currentIndex]);

  if (!open) return null;

  const handlePrev = () => {
    setCurrentIndex((prev) => (prev === 0 ? posters.length - 1 : prev - 1));
  };

  const handleNext = () => {
    setCurrentIndex((prev) => (prev === posters.length - 1 ? 0 : prev + 1));
  };

  const handleSave = () => {
    const selectedUrl = posters[currentIndex] || collection?.banner || FALLBACK_AVATAR;
    onSave(selectedUrl);
  };

  const currentPoster = posters[currentIndex] || collection?.banner || FALLBACK_AVATAR;

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-[999999] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/85 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal Content - Constrained to 16:9 */}
      <div 
        className="relative z-10 w-full flex items-center justify-center" 
        style={{ maxWidth: 'min(96vw, 170vh)' }}
      >
        {/* Landscape Image Viewer */}
        <div className="relative w-full aspect-video rounded-[20px] overflow-hidden flex items-center justify-center bg-black/40 shadow-2xl">
          
          {/* Main Image (shows current banner immediately, updates on click) */}
          <img
            src={currentPoster}
            alt="Selected Banner"
            className="w-full h-full object-cover transition-opacity duration-200"
            onError={(e) => {
              const src = e.currentTarget.src;
              if (src.includes('/original/')) {
                e.currentTarget.src = src.replace('/original/', '/w1280/');
              } else if (src.includes('/w1280/')) {
                e.currentTarget.src = src.replace('/w1280/', '/w780/');
              } else {
                e.currentTarget.src = FALLBACK_AVATAR;
              }
            }}
          />

          {/* Left Arrow */}
          {posters.length > 1 && (
            <button
              onClick={handlePrev}
              className="absolute left-4 top-1/2 -translate-y-1/2 p-3 text-white/80 hover:text-white drop-shadow-lg hover:scale-110 transition-all bg-black/40 hover:bg-black/60 rounded-full focus:outline-none z-20 cursor-pointer"
              title="Previous banner"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}

          {/* Right Arrow */}
          {posters.length > 1 && (
            <button
              onClick={handleNext}
              className="absolute right-4 top-1/2 -translate-y-1/2 p-3 text-white/80 hover:text-white drop-shadow-lg hover:scale-110 transition-all bg-black/40 hover:bg-black/60 rounded-full focus:outline-none z-20 cursor-pointer"
              title="Next banner"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}

          {/* Bottom Left: Close Button */}
          <button
            onClick={onClose}
            className="absolute left-4 bottom-4 p-3 text-white/80 hover:text-white drop-shadow-lg hover:scale-110 transition-all bg-black/40 hover:bg-black/60 rounded-full focus:outline-none z-20 flex items-center justify-center cursor-pointer"
            title="Cancel"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {/* Bottom Right: Save Button */}
          <button
            onClick={handleSave}
            className="absolute right-4 bottom-4 p-3 text-[#64FFDA] hover:text-[#52e0c0] drop-shadow-lg hover:scale-110 transition-all bg-black/40 hover:bg-black/60 rounded-full focus:outline-none z-20 flex items-center justify-center cursor-pointer"
            title="Save Banner"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
