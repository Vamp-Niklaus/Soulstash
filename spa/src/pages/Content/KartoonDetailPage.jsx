import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fetchKartoonsEpisodes, fetchKartoonsShowDetail } from '../../api/kartoons.js';
import { apiFetch } from '../../api/client.js';
import { useMediaAction } from '../../hooks/useMediaAction.js';
import { DetailHero } from './DetailHero.jsx';
import { SeasonEpisodeSection } from './SeasonEpisodeSection.jsx';
import { SectionHeader } from '../../components/ui/SectionHeader.jsx';
import { DetailStat } from '../../components/ui/Cards/DetailStat.jsx';
import { DetailPageSkeleton } from '../../components/ui/Skeletons/index.js';
import { VideoPlayerModal } from '../../components/player/VideoPlayerModal.jsx';
import { PlayerErrorBoundary } from '../../components/player/PlayerErrorBoundary.jsx';
import { SaveToCollectionModal } from '../../components/ui/Modals/SaveToCollectionModal.jsx';
import { CollectionFormModal } from '../../components/ui/Modals/CollectionFormModal.jsx';
import { toast } from '../../utils/toast.js';
import { createEmptyCollectionDraft } from '../../utils/formatters.js';

export function KartoonDetailPage() {
  const { slug = '' } = useParams();
  const [show, setShow] = useState(null);
  const [seasonNumber, setSeasonNumber] = useState(1);
  const [episodes, setEpisodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [episodesLoading, setEpisodesLoading] = useState(false);
  const [error, setError] = useState('');
  const [playerRequest, setPlayerRequest] = useState(null);
  const [tmdbMatch, setTmdbMatch] = useState(null);

  const seasonScrollerRef = useRef(null);
  const episodeScrollerRef = useRef(null);

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

  // Background TMDB pairing match
  useEffect(() => {
    if (!show?.title) return undefined;
    const cleanTitle = String(show.title)
      .replace(/\s*S\d+E\d+.*$/i, '')
      .replace(/\s*Season\s*\d+.*$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleanTitle) return undefined;

    const controller = new AbortController();
    const q = encodeURIComponent(cleanTitle);
    apiFetch(`/api/search?q=${q}&type=content&limit=6`, { signal: controller.signal })
      .then((res) => {
        const results = Array.isArray(res?.results) ? res.results : [];
        const match = results.find((r) => {
          const t1 = String(r.title || r.name || '').toLowerCase();
          const t2 = cleanTitle.toLowerCase();
          if (t1 === t2) return true;
          const kYear = Number(show.startYear || show.releaseYear || 0);
          const rYear = Number(String(r.release_date || r.first_air_date || '').slice(0, 4) || 0);
          return (t1.includes(t2) || t2.includes(t1)) && (!kYear || !rYear || Math.abs(kYear - rYear) <= 1);
        });
        if (match) {
          setTmdbMatch(match);
        }
      })
      .catch(() => {});

    return () => controller.abort();
  }, [show?.title, show?.startYear]);

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

  const seasonsList = useMemo(() => {
    const values = (show?.seasons || [])
      .map((season) => Number(season.seasonNumber))
      .filter((number) => Number.isInteger(number) && number > 0);
    const unique = [...new Set(values)].sort((a, b) => a - b);
    return unique.map((num) => ({
      id: num,
      season_number: num,
      name: `Season ${num}`,
      episode_count: Number((show?.seasons || []).find((s) => Number(s.seasonNumber) === num)?.episodeCount || 0)
    }));
  }, [show?.seasons]);

  const content = useMemo(() => {
    if (!show) return null;
    return {
      id: `kartoons-${slug}`,
      title: show.title,
      name: show.title,
      backdrop_path: show.coverImage || show.image,
      poster_path: show.image || show.coverImage,
      images: {
        posters: [{ file_path: show.image || show.coverImage }],
        backdrops: [{ file_path: show.coverImage || show.image }]
      },
      overview: show.description,
      vote_average: show.rating,
      first_air_date: show.startYear ? `${show.startYear}-01-01` : '',
      number_of_seasons: seasonsList.length || 1,
      number_of_episodes: show.episodeCount || seasonsList.reduce((acc, s) => acc + (s.episode_count || 0), 0) || episodes.length,
      seasons: seasonsList.length ? seasonsList : [{ season_number: 1, name: 'Season 1', id: 1 }],
      genres: (show.tags || []).map((t) => ({ id: t, name: t })),
      status: show.status || 'Ended'
    };
  }, [show, slug, seasonsList, episodes.length]);

  const effectiveId = tmdbMatch?.id ? tmdbMatch.id : `kartoons-${slug}`;
  const effectiveContent = useMemo(() => {
    if (!content) return null;
    if (tmdbMatch?.id) {
      return {
        ...content,
        id: tmdbMatch.id,
        tmdbId: tmdbMatch.id,
        media_type: tmdbMatch.media_type || 'Series'
      };
    }
    return content;
  }, [content, tmdbMatch]);

  const {
    status,
    saveModalOpen,
    setSaveModalOpen,
    createModalOpen,
    setCreateModalOpen,
    createDraft,
    setCreateDraft,
    createLoading,
    pendingAction,
    collections,
    toggleWatched,
    toggleWatchlist,
    handleToggleCustomCollection,
    handleCreateCustomCollection
  } = useMediaAction(effectiveId, 'series', effectiveContent);

  const meta = useMemo(() => {
    if (!show) return [];
    return [
      'Series',
      show.startYear ? String(show.startYear) : '',
      show.rating ? `★ ${Number(show.rating).toFixed(1)}` : '',
      'Hindi'
    ].filter(Boolean);
  }, [show]);

  const seasonDetails = useMemo(() => {
    return {
      name: `Season ${seasonNumber}`,
      episodes: (episodes || []).map((ep) => ({
        id: ep._id,
        _id: ep._id,
        name: ep.title || `Episode ${ep.episodeNumber}`,
        episode_number: Number(ep.episodeNumber),
        season_number: Number(seasonNumber),
        overview: ep.description || '',
        still_path: ep.thumbnail || ep.image || show?.coverImage || show?.image || '',
        air_date: ep.airDate || ''
      }))
    };
  }, [episodes, seasonNumber, show]);

  const handlePlayEpisode = useCallback((ep) => {
    if (!show) return;
    const epNum = Number(ep?.episode_number || ep?.episodeNumber || 1);
    const sNum = Number(ep?.season_number || seasonNumber || 1);
    setPlayerRequest({
      mediaType: 'series',
      tmdbId: tmdbMatch?.id ? tmdbMatch.id : `kartoons-${slug}`,
      seasonNumber: sNum,
      episodeNumber: epNum,
      title: `${show.title} S${sNum}E${epNum}`,
      seriesTitle: show.title,
      year: show.startYear,
      kartoonsSlug: slug,
      kartoonsEpisodeId: ep?.id || ep?._id,
      isKartoons: true
    });
  }, [show, slug, seasonNumber, tmdbMatch]);

  const handlePlayClick = useCallback(() => {
    if (!show) return;
    const firstEp = seasonDetails?.episodes?.[0];
    const epNum = Number(firstEp?.episode_number || 1);
    const sNum = Number(seasonNumber || 1);
    setPlayerRequest({
      mediaType: 'series',
      tmdbId: tmdbMatch?.id ? tmdbMatch.id : `kartoons-${slug}`,
      seasonNumber: sNum,
      episodeNumber: epNum,
      title: `${show.title} S${sNum}E${epNum}`,
      seriesTitle: show.title,
      year: show.startYear,
      kartoonsSlug: slug,
      kartoonsEpisodeId: firstEp?.id || firstEp?._id,
      isKartoons: true
    });
  }, [show, slug, seasonNumber, seasonDetails, tmdbMatch]);

  if (loading) {
    return <DetailPageSkeleton type="series" />;
  }

  if (error || !show || !content) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-14 text-center">
        <p className="text-white/65">{error || 'Kartoons title not found.'}</p>
        <button
          type="button"
          className="mt-5 rounded-full bg-white/10 px-5 py-2 text-white hover:bg-white/20"
          onClick={() => window.history.back()}
        >
          Go back
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {/* 1. Hero — backdrop, poster, metadata, action buttons, play button */}
      <DetailHero
        content={effectiveContent}
        type="series"
        title={show.title}
        meta={meta}
        status={status}
        pendingAction={pendingAction}
        directorStat={<DetailStat label="Category" value={show.category || 'Animation'} />}
        countryLabel="India"
        languageName="Hindi"
        ageRatingLabel="U"
        onToggleWatched={toggleWatched}
        onToggleWatchlist={toggleWatchlist}
        onOpenSaveModal={() => setSaveModalOpen(true)}
        onPlay={handlePlayClick}
        isPlayerOpen={!!playerRequest}
      />

      {/* 2. Overview + genres */}
      <section className="content-section relative z-10">
        <div className="rounded-[28px] border border-white/8 bg-[rgba(12,12,12,0.72)] p-5 md:p-6">
          <SectionHeader title="Overview" />
          <p className="mt-4 text-[14px] leading-[22px] text-[#B3B3B3] md:text-[16px] md:leading-[26px]">
            {show.description || 'No overview available yet.'}
          </p>
          {Array.isArray(show.tags) && show.tags.length > 0 && (
            <div className="mt-5 flex flex-wrap gap-2">
              {show.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-sm text-[#d8d8d8]"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* 3. Seasons & Episodes */}
      <SeasonEpisodeSection
        content={content}
        selectedSeason={seasonNumber}
        setSelectedSeason={setSeasonNumber}
        seasonDetails={seasonDetails}
        seasonLoading={episodesLoading}
        seasonScrollerRef={seasonScrollerRef}
        episodeScrollerRef={episodeScrollerRef}
        onPlayEpisode={handlePlayEpisode}
      />

      {/* 4. Video player */}
      {playerRequest && (
        <PlayerErrorBoundary onClose={() => setPlayerRequest(null)}>
          <VideoPlayerModal
            request={playerRequest}
            onClose={() => setPlayerRequest(null)}
          />
        </PlayerErrorBoundary>
      )}

      {/* 5. Modals for Collection Saving */}
      <SaveToCollectionModal
        open={saveModalOpen}
        onClose={() => setSaveModalOpen(false)}
        collections={collections}
        contentId={effectiveId}
        onToggleCollection={handleToggleCustomCollection}
        onCreateNew={() => {
          setSaveModalOpen(false);
          setCreateModalOpen(true);
        }}
      />

      <CollectionFormModal
        open={createModalOpen}
        onClose={() => {
          setCreateModalOpen(false);
          setCreateDraft(createEmptyCollectionDraft());
        }}
        values={createDraft}
        onChange={setCreateDraft}
        onSubmit={handleCreateCustomCollection}
        saving={createLoading}
      />
    </div>
  );
}
