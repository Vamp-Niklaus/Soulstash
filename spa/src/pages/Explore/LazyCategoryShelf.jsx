import React, { useEffect, useMemo, useState, useCallback } from 'react';
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
  const [failedCardIds, setFailedCardIds] = useState(() => new Set());

  const handleCardImageError = useCallback((itemId) => {
    if (!itemId) return;
    setFailedCardIds((prev) => {
      if (prev.has(itemId)) return prev;
      const next = new Set(prev);
      next.add(itemId);
      return next;
    });
  }, []);

  const { data: fetchedMovies, isLoading } = useQuery({
    queryKey: ['moviesByGenre', genreId],
    queryFn: async () => {
      const gLower = String(genreId).toLowerCase();
      const isValidImage = (item) => {
        const p = item?.image || item?.coverImage || item?.poster_path;
        return Boolean(
          p &&
          typeof p === 'string' &&
          p.trim() &&
          p !== 'null' &&
          p !== 'undefined' &&
          !p.startsWith('data:image/svg+xml') &&
          !p.includes('placeholder')
        );
      };

      if (gLower === 'anime' || gLower === 'kartoons-anime') {
        const res = await fetch(`https://api.kartoons.me/api/shows?page=1&category=Anime`);
        const json = await res.json().catch(() => ({}));
        const raw = (Array.isArray(json?.data) ? json.data : (Array.isArray(json) ? json : []))
          .filter(isValidImage);
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
        const sRaw = (Array.isArray(sJson?.data) ? sJson.data : (Array.isArray(sJson) ? sJson : []))
          .filter(isValidImage);
        const mRaw = (Array.isArray(mJson?.data) ? mJson.data : (Array.isArray(mJson) ? mJson : []))
          .filter(isValidImage);

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
      return apiFetch(`/api/movies?genre=${genreId}&limit=28`);
    },
    enabled: !preloadedMovies || preloadedMovies.length === 0,
    staleTime: 1000 * 60 * 30, // 30 minutes
  });

  const fetchedList = fetchedMovies?.results || fetchedMovies?.movies || (Array.isArray(fetchedMovies) ? fetchedMovies : []);
  const rawMovies = preloadedMovies?.length ? preloadedMovies : fetchedList;
  const movies = useMemo(() => {
    return (Array.isArray(rawMovies) ? rawMovies : []).filter((item) => {
      const p = item?.poster_path || item?.image || item?.coverImage;
      return Boolean(
        p &&
        typeof p === 'string' &&
        p.trim() &&
        p !== 'null' &&
        p !== 'undefined' &&
        !p.startsWith('data:image/svg+xml') &&
        !p.includes('placeholder')
      );
    });
  }, [rawMovies]);

  const visibleMovies = useMemo(() => {
    return movies.filter((item) => {
      const idKey = item.id || item.slug || item.kartoons_slug || item.title;
      return !failedCardIds.has(idKey);
    });
  }, [movies, failedCardIds]);
  
  // Preload images for dynamically fetched shelves
  useEffect(() => {
    if (!preloadedMovies?.length && visibleMovies.length > 0) {
      preloadImages(visibleMovies.slice(0, displayLimit).map(item => item.poster_path));
    }
  }, [visibleMovies, preloadedMovies, displayLimit]);

  const loading = (!preloadedMovies || preloadedMovies.length === 0) && isLoading;

  if (loading || !visibleMovies.length) return null;

  const title = genre.name || genre;

  return (
    <section className="content-section">
      <HomeShelfHeader 
        title={title} 
        onViewAll={() => navigate(`/genre/${genreId}/${encodeURIComponent(String(title))}`)}
      />
      <div className={HOME_GRID_CLASS}>
        {visibleMovies.slice(0, displayLimit).map((item, index) => (
          <ContentCard
            key={`genre-${genreId}-${item.id || item.slug || index}-${index}`}
            item={item}
            data-card
            onImageError={() => handleCardImageError(item.id || item.slug || item.kartoons_slug || item.title)}
          />
        ))}
      </div>
    </section>
  );
}
