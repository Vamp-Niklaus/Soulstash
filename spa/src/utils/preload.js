import { imageUrl } from './formatters.js';

/**
 * Preloads an array of image URLs by creating new Image objects.
 * This forces the browser to fetch and cache the images in the background.
 * 
 * @param {string[]} paths - Array of image paths (e.g. TMDB poster paths)
 * @param {string} size - The TMDB image size to load (default 'w500')
 */
export function preloadImages(paths, size = 'w500') {
  if (!paths || !Array.isArray(paths)) return;

  paths.forEach(path => {
    if (!path) return;
    const url = path.startsWith('http') ? path : imageUrl(path, size);
    if (!url) return;

    // Create a new image object to trigger the browser fetch
    const img = new Image();
    img.src = url;
  });
}
