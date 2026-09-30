import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { imageUrl, mediaRoute } from '../../utils/formatters.js';

export function NowShowingSlider({ items }) {
  const navigate = useNavigate();
  const slides = items.filter(item => item?.backdrop_path && mediaRoute(item) !== '#').slice(0, 6);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [failed, setFailed] = useState([]);
  const available = slides.filter(item => !failed.includes(`${item.media_type}-${item.id}`));
  const currentIndex = available.length ? index % available.length : 0;
  const current = available[currentIndex];

  useEffect(() => {
    if (available.length < 2 || paused) return;
    const timer = window.setInterval(() => setIndex(previous => previous + 1), 6500);
    return () => window.clearInterval(timer);
  }, [available.length, paused]);

  if (!current) return null;

  const change = (direction) => setIndex(currentIndex + available.length + direction);
  const title = current.title || current.name || current.original_title || current.original_name || 'Untitled';
  const year = (current.release_date || current.first_air_date || '').slice(0, 4);

  return (
    <section className="now-showing" aria-label="Now showing" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocusCapture={() => setPaused(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false); }}>
      <div className="now-showing-media" aria-hidden="true">
        <img
          key={`${current.media_type}-${current.id}`}
          src={imageUrl(current.backdrop_path, 'w1280')}
          alt=""
          onError={() => setFailed(previous => [...previous, `${current.media_type}-${current.id}`])}
        />
      </div>
      <div className="now-showing-content">
        <span className="now-showing-label">Now showing <span aria-hidden="true">/</span> {String(currentIndex + 1).padStart(2, '0')}</span>
        <h1>{title}</h1>
        <p>{[String(current.media_type || '').toLowerCase() === 'series' || String(current.media_type || '').toLowerCase() === 'tv' ? 'Series' : 'Movie', year].filter(Boolean).join(' · ')}</p>
        <button type="button" className="now-showing-open" onClick={() => navigate(mediaRoute(current))} aria-label={`Explore ${title}`}>
          Explore title <span aria-hidden="true">↗</span>
        </button>
      </div>
      {available.length > 1 && (
        <div className="now-showing-controls" aria-label="Featured titles">
          <button type="button" className="now-showing-arrow" onClick={() => change(-1)} aria-label="Previous featured title" title="Previous featured title">‹</button>
          <span className="now-showing-counter">{String(currentIndex + 1).padStart(2, '0')} <span aria-hidden="true">/</span> {String(available.length).padStart(2, '0')}</span>
          <button type="button" className="now-showing-arrow" onClick={() => change(1)} aria-label="Next featured title" title="Next featured title">›</button>
        </div>
      )}
    </section>
  );
}