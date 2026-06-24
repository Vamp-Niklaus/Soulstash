import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { cachedApiFetch } from '../../api/client.js';
import { HOME_GRID_CLASS } from '../../utils/constants.js';
import { ContentCard } from '../../components/ui/Cards/ContentCard.jsx';
import { HomeShelfHeader } from './HomeShelfHeader.jsx';
export function LazyCategoryShelf({ genre, limit, preloadedMovies }) {
  const [movies, setMovies] = useState(() => preloadedMovies || []);
  const [loading, setLoading] = useState(!preloadedMovies || !preloadedMovies.length);

  const navigate = useNavigate();

  useEffect(() => {
    // If we already have preloaded data, skip the network call
    if (preloadedMovies && preloadedMovies.length) return;
    let ignore = false;
    const genreId = genre.id || genre;
    cachedApiFetch(`/api/movies?genre=${genreId}&limit=20`)
      .then((data) => {
        if (!ignore && data.movies) {
          setMovies(data.movies);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!ignore) setLoading(false);
      });
    return () => { ignore = true; };
  }, [genre, preloadedMovies]);

  if (loading || !movies.length) return null;

  const title = genre.name || genre;
  const genreId = genre.id || genre;
  // Apply limit for 2 rows on desktop
  const displayLimit = limit || 14;

  return (
    <section className="content-section">
      <HomeShelfHeader 
        title={title} 
        onViewAll={() => navigate(`/genre/${genreId}`)} 
      />
      <div className={HOME_GRID_CLASS}>
        {movies.slice(0, displayLimit).map((item) => (
          <ContentCard key={item.id} item={item} data-card />
        ))}
      </div>
    </section>
  );
}

