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
    queryFn: () => apiFetch(`/api/movies?genre=${genreId}&limit=20`),
    enabled: !preloadedMovies || preloadedMovies.length === 0,
    staleTime: 1000 * 60 * 30, // 30 minutes
  });

  const movies = preloadedMovies?.length ? preloadedMovies : (fetchedMovies?.movies || []);
  
  // Preload images for dynamically fetched shelves
  useEffect(() => {
    if (!preloadedMovies?.length && fetchedMovies?.movies?.length > 0) {
      preloadImages(fetchedMovies.movies.slice(0, displayLimit).map(item => item.poster_path));
    }
  }, [fetchedMovies, preloadedMovies, displayLimit]);

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
