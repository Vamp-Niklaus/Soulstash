import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fetchKartoonsEpisodes, fetchKartoonsShowDetail } from '../../api/kartoons.js';
import { KartoonWatchModal } from '../../components/player/KartoonWatchModal.jsx';
import { FALLBACK_POSTER } from '../../utils/constants.js';

export function KartoonDetailPage() {
  const { slug = '' } = useParams();
  const [show, setShow] = useState(null);
  const [seasonNumber, setSeasonNumber] = useState(1);
  const [episodes, setEpisodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [episodesLoading, setEpisodesLoading] = useState(false);
  const [error, setError] = useState('');
  const [player, setPlayer] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    fetchKartoonsShowDetail(slug, { signal: controller.signal })
      .then((item) => {
        setShow(item);
        const seasons = Array.isArray(item.seasons) ? item.seasons : [];
        const firstSeason = Number(seasons[0]?.seasonNumber) || 1;
        setSeasonNumber(firstSeason);
        document.title = `${item.title || 'Kartoons'} | Soulstash`;
      })
      .catch((requestError) => {
        if (requestError?.name !== 'AbortError') setError(requestError.message || 'Unable to load this Kartoons title.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [slug]);

  useEffect(() => {
    if (!show || !seasonNumber) return undefined;
    const controller = new AbortController();
    setEpisodesLoading(true);
    setEpisodes([]);
    fetchKartoonsEpisodes(slug, seasonNumber, { signal: controller.signal })
      .then((list) => setEpisodes(list))
      .catch((requestError) => {
        if (requestError?.name !== 'AbortError') setEpisodes([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setEpisodesLoading(false);
      });
    return () => controller.abort();
  }, [show, slug, seasonNumber]);

  const seasons = useMemo(() => {
    const values = (show?.seasons || [])
      .map((season) => Number(season.seasonNumber))
      .filter((number) => Number.isInteger(number) && number > 0);
    return [...new Set(values)].sort((a, b) => a - b);
  }, [show?.seasons]);

  const playEpisode = useCallback((episode) => {
    if (!episode?._id) return;
    const episodeTitle = episode.title || `Episode ${episode.episodeNumber || ''}`;
    setPlayer({
      streamType: 'series',
      streamId: episode._id,
      subtitle: `Season ${seasonNumber} • ${episodeTitle}`
    });
  }, [seasonNumber]);

  if (loading) {
    return <div className="mx-auto max-w-6xl px-4 py-14 text-sm text-white/55">Loading Kartoons title…</div>;
  }
  if (error || !show) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-14 text-center">
        <p className="text-white/65">{error || 'Kartoons title not found.'}</p>
        <button type="button" className="mt-5 rounded-full bg-white/10 px-5 py-2 text-white hover:bg-white/20" onClick={() => window.history.back()}>
          Go back
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-6 sm:py-10">
      <section className="grid gap-6 rounded-3xl border border-white/10 bg-white/[0.03] p-4 sm:grid-cols-[220px_1fr] sm:gap-8 sm:p-7">
        <img
          src={show.coverImage || show.image || FALLBACK_POSTER}
          alt={show.title}
          className="mx-auto aspect-[2/3] w-full max-w-[220px] rounded-2xl bg-black object-cover"
          onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = FALLBACK_POSTER; }}
        />
        <div className="self-center">
          <div className="flex flex-wrap items-center gap-2 text-xs text-white/55">
            <span className="rounded-full bg-violet-400/15 px-3 py-1 font-semibold uppercase tracking-wide text-violet-200">Kartoons</span>
            <span>{show.category || 'Series'}</span>
            {show.startYear ? <span>• {show.startYear}</span> : null}
            {show.rating ? <span>• ★ {show.rating.toFixed(1)}</span> : null}
          </div>
          <h1 className="mt-4 text-3xl font-bold text-white sm:text-5xl">{show.title}</h1>
          {show.description ? <p className="mt-4 max-w-3xl whitespace-pre-line text-sm leading-6 text-white/65 sm:text-base">{show.description}</p> : null}
          {show.tags.length ? (
            <div className="mt-5 flex flex-wrap gap-2">
              {show.tags.map((tag) => <span key={tag} className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/60">{tag}</span>)}
            </div>
          ) : null}
        </div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-xl font-semibold text-white">Episodes</h2>
          {seasons.length > 1 ? (
            <label className="flex items-center gap-3 text-sm text-white/60">
              Season
              <select value={seasonNumber} onChange={(event) => setSeasonNumber(Number(event.target.value))} className="rounded-lg border border-white/15 bg-[#151515] px-3 py-2 text-white">
                {seasons.map((season) => <option key={season} value={season}>Season {season}</option>)}
              </select>
            </label>
          ) : null}
        </div>
        {episodesLoading ? <p className="mt-5 text-sm text-white/50">Loading episodes…</p> : null}
        {!episodesLoading && !episodes.length ? <p className="mt-5 text-sm text-white/50">No episodes are available for this season.</p> : null}
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {episodes.map((episode) => (
            <button
              key={episode._id || `${seasonNumber}-${episode.episodeNumber}`}
              type="button"
              onClick={() => playEpisode(episode)}
              className="flex min-h-16 items-center gap-3 rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-left text-white transition-colors hover:border-white/25 hover:bg-white/[0.06]"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold">{episode.episodeNumber || '▶'}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{episode.title || `Episode ${episode.episodeNumber || ''}`}</span>
              <i className="fas fa-play text-xs text-white/55" />
            </button>
          ))}
        </div>
      </section>

      {player ? (
        <KartoonWatchModal
          title={show.title}
          subtitle={player.subtitle}
          streamType={player.streamType}
          streamId={player.streamId}
          onClose={() => setPlayer(null)}
        />
      ) : null}
    </div>
  );
}
