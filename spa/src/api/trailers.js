import { apiFetch } from './client.js';
import { pickBestTrailer } from '../utils/formatters.js';

// TMDB trailers through our backend:
//   movie   /api/movie/:id/videos
//   series  /api/series/:id/videos
//   season  /api/series/:id/season/:season/videos
//   episode /api/series/:id/season/:season/episode/:episode/videos
// For a season or episode with no usable video this falls back to the next level up
// (episode -> season -> series), so something relevant still plays.

async function fetchVideos(path) {
  try {
    const data = await apiFetch(path);
    return pickBestTrailer(data?.results);
  } catch (_) {
    return null;
  }
}

export async function fetchTrailer({ type, id, season, episode }) {
  if (!id) return null;
  if (type === 'movie') return fetchVideos(`/api/movie/${id}/videos`);

  const hasSeason = season != null && season !== '';
  const hasEpisode = episode != null && episode !== '';
  if (hasSeason && hasEpisode) {
    const ep = await fetchVideos(`/api/series/${id}/season/${season}/episode/${episode}/videos`);
    if (ep) return ep;
  }
  if (hasSeason) {
    const se = await fetchVideos(`/api/series/${id}/season/${season}/videos`);
    if (se) return se;
  }
  return fetchVideos(`/api/series/${id}/videos`);
}
