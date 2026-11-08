import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../api/client.js';
import { HOME_GRID_CLASS } from '../../utils/constants.js';
import { ContentCard } from '../../components/ui/Cards/ContentCard.jsx';
import { HomeShelfHeader } from './HomeShelfHeader.jsx';
import { preloadImages } from '../../utils/preload.js';

export function LazyCategoryShelf({ genre, limit, preloadedMovies }) {
  const navigate = useNavigate();
  const genreId = genre.id || genre;
  const displayLimit = limit || 14; // Apply limit for 2 rows on desktop

  const { data: fetchedMovies, isLoading } = useQuery({
    queryKey: ['moviesByGenre', genreId],
    queryFn: async () => {
      const gLower = String(genreId).toLowerCase();
      if (gLower === 'anime' || gLower === 'kartoons-anime') {
        const res = await fetch(`https://api.kartoons.me/api/shows?page=1&category=Anime`);
        const json = await res.json().catch(() => ({}));
        const raw = Array.isArray(json?.data) ? json.data : (Array.isArray(json) ? json : []);
        return raw.map((item) => ({
          id: `kartoons-${item.slug}`,
          title: item.title,
          name: item.title,
          poster_path: item.image || item.coverImage || '',
          backdrop_path: item.coverImage || item.image || '',
          media_type: 'Series',
          release_date: item.startYear ? `${item.startYear}-01-01` : '',
          first_air_date: item.startYear ? `${item.startYear}-01-01` : '',
          vote_average: Number(item.rating) || 0,
          source: 'kartoons',
          is_kartoons: true,
          kartoons_slug: item.slug
        }));
      }
      if (gLower === 'cartoon' || gLower === 'kartoons-cartoon') {
        const [showsRes, moviesRes] = await Promise.all([
          fetch(`https://api.kartoons.me/api/shows?page=1&category=Cartoon`).catch(() => null),
          fetch(`https://api.kartoons.me/api/movies?page=1&category=Cartoon`).catch(() => null)
        ]);
        const sJson = showsRes?.ok ? await showsRes.json().catch(() => ({})) : {};
        const mJson = moviesRes?.ok ? await moviesRes.json().catch(() => ({})) : {};
        const sRaw = Array.isArray(sJson?.data) ? sJson.data : (Array.isArray(sJson) ? sJson : []);
        const mRaw = Array.isArray(mJson?.data) ? mJson.data : (Array.isArray(mJson) ? mJson : []);

        const mappedShows = sRaw.map((item) => ({
          id: `kartoons-${item.slug}`,
          title: item.title,
          name: item.title,
          poster_path: item.image || item.coverImage || '',
          backdrop_path: item.coverImage || item.image || '',
          media_type: 'Series',
          release_date: item.startYear ? `${item.startYear}-01-01` : '',
          first_air_date: item.startYear ? `${item.startYear}-01-01` : '',
          vote_average: Number(item.rating) || 0,
          source: 'kartoons',
          is_kartoons: true,
          kartoons_slug: item.slug
        }));

        const mappedMovies = mRaw.map((item) => ({
          id: `kartoons-${item.slug}`,
          title: item.title,
          name: item.title,
          poster_path: item.image || item.coverImage || '',
          backdrop_path: item.coverImage || item.image || '',
          media_type: 'Movie',
          release_date: item.releaseYear ? `${item.releaseYear}-01-01` : '',
          first_air_date: '',
          vote_average: Number(item.rating) || 0,
          source: 'kartoons',
          is_kartoons: true,
          kartoons_slug: item.slug
        }));

        return [...mappedShows, ...mappedMovies];
      }
      return apiFetch(`/api/movies?genre=${genreId}&limit=20`);
    },
    enabled: !preloadedMovies || preloadedMovies.length === 0,
    staleTime: 1000 * 60 * 30, // 30 minutes
  });

  const fetchedList = fetchedMovies?.results || fetchedMovies?.movies || (Array.isArray(fetchedMovies) ? fetchedMovies : []);
  const movies = preloadedMovies?.length ? preloadedMovies : fetchedList;
  
  // Preload images for dynamically fetched shelves
  useEffect(() => {
    if (!preloadedMovies?.length && movies.length > 0) {
      preloadImages(movies.slice(0, displayLimit).map(item => item.poster_path));
    }
  }, [movies, preloadedMovies, displayLimit]);

  const loading = (!preloadedMovies || preloadedMovies.length === 0) && isLoading;

  if (loading || !movies.length) return null;

  const title = genre.name || genre;

  return (
    <section className="content-section">
      <HomeShelfHeader 
        title={title} 
        onViewAll={() => navigate(`/genre/${genreId}/${encodeURIComponent(String(title))}`)}
      />
      <div className={HOME_GRID_CLASS}>
        {movies.slice(0, displayLimit).map((item) => (
          <ContentCard key={item.id} item={item} data-card />
        ))}
      </div>
    </section>
  );
}
