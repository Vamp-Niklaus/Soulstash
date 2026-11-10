import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams, Link, useLocation } from 'react-router-dom';
import { fetchKartoonsEpisodes, fetchKartoonsMovieDetail, fetchKartoonsShowDetail } from '../../api/kartoons.js';
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
import { ContentCard } from '../../components/ui/Cards/ContentCard.jsx';
import { toast } from '../../utils/toast.js';
import { createEmptyCollectionDraft } from '../../utils/formatters.js';
import { getLastWatchedForSeries, getSavedProgress } from '../../utils/watchProgress.js';
import { HOME_GRID_CLASS } from '../../utils/constants.js';

const GENRE_TAG_MAP = {
  family: 10751,
  comedy: 35,
  animation: 16,
  'science fiction': 878,
  'sci-fi': 878,
  adventure: 12,
  action: 28,
  fantasy: 14,
  kids: 10762
};

function getTagGenreUrl(tag) {
  const norm = String(tag || '').trim().toLowerCase();
  const genreId = GENRE_TAG_MAP[norm];
  if (genreId) return `/genre/${genreId}/${encodeURIComponent(tag)}`;
  return `/genre/${encodeURIComponent(norm)}/${encodeURIComponent(tag)}`;
}

export function KartoonDetailPage() {
  const { slug = '' } = useParams();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const contentKindHint = searchParams.get('type') === 'movie' ? 'movie' : 'series';
  const [show, setShow] = useState(null);
  const [contentKind, setContentKind] = useState('series');
  const [seasonNumber, setSeasonNumber] = useState(1);
  const [episodes, setEpisodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [episodesLoading, setEpisodesLoading] = useState(false);
  const [error, setError] = useState('');
  const [playerRequest, setPlayerRequest] = useState(null);
  const [tmdbMatch, setTmdbMatch] = useState(null);
  const autoPlayTriggeredRef = useRef(false);

  const seasonScrollerRef = useRef(null);
  const episodeScrollerRef = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setShow(null);
    setTmdbMatch(null);
    setEpisodes([]);
    setPlayerRequest(null);
    setContentKind(contentKindHint);

    const loadTitle = async () => {
      const loaders = contentKindHint === 'movie'
        ? [
            ['movie', fetchKartoonsMovieDetail],
            ['series', fetchKartoonsShowDetail]
          ]
        : [
            ['series', fetchKartoonsShowDetail],
            ['movie', fetchKartoonsMovieDetail]
          ];
      let lastError = null;
      try {
        for (const [kind, loader] of loaders) {
          try {
            const item = await loader(slug, { signal: controller.signal });
            if (controller.signal.aborted) return;
            setContentKind(kind);
            setShow(item);
            if (kind === 'series') {
              const seasons = Array.isArray(item.seasons) ? item.seasons : [];
              const firstSeason = Number(seasons[0]?.seasonNumber) || 1;
              setSeasonNumber(firstSeason);
            }
            document.title = `${item.title || 'Kartoons'} | Soulstash`;
            return;
          } catch (requestError) {
            if (controller.signal.aborted || requestError?.name === 'AbortError') return;
            lastError = requestError;
          }
        }
        if (!controller.signal.aborted) {
          setError(lastError?.message || 'Unable to load this Kartoons title.');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    loadTitle();
    return () => controller.abort();
  }, [slug, contentKindHint]);

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
          const resultType = String(r.media_type || r.type || '').toLowerCase();
          const correctType = contentKind === 'movie'
            ? ['movie', 'film'].includes(resultType)
            : ['tv', 'series', 'show'].includes(resultType);
          if (!correctType) return false;
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
  }, [show?.title, show?.startYear, contentKind]);

  useEffect(() => {
    if (!show || contentKind !== 'series' || !seasonNumber) return undefined;
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
  }, [show, slug, seasonNumber, contentKind]);

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
    const isMovie = contentKind === 'movie';
    return {
      id: `kartoons-${slug}`,
      media_type: isMovie ? 'Movie' : 'Series',
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
      first_air_date: !isMovie && show.startYear ? `${show.startYear}-01-01` : '',
      release_date: isMovie && show.startYear ? `${show.startYear}-01-01` : '',
      number_of_seasons: isMovie ? 0 : (seasonsList.length || 1),
      number_of_episodes: isMovie ? 0 : (show.episodeCount || seasonsList.reduce((acc, s) => acc + (s.episode_count || 0), 0) || episodes.length),
      seasons: isMovie ? [] : (seasonsList.length ? seasonsList : [{ season_number: 1, name: 'Season 1', id: 1 }]),
      genres: (show.tags || []).map((t) => ({ id: t, name: t })),
      status: show.status || (isMovie ? 'Released' : 'Ended')
    };
  }, [show, slug, seasonsList, episodes.length, contentKind]);

  const effectiveId = tmdbMatch?.id ? tmdbMatch.id : `kartoons-${slug}`;
  const effectiveContent = useMemo(() => {
    if (!content) return null;
    if (tmdbMatch?.id) {
      return {
        ...content,
        id: tmdbMatch.id,
        tmdbId: tmdbMatch.id,
        media_type: contentKind === 'movie' ? 'Movie' : 'Series'
      };
    }
    return content;
  }, [content, tmdbMatch, contentKind]);

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
  } = useMediaAction(effectiveId, contentKind, effectiveContent);

  const meta = useMemo(() => {
    if (!show) return [];
    return [
      contentKind === 'movie' ? 'Movie' : 'Series',
      show.startYear ? String(show.startYear) : '',
      show.rating ? `★ ${Number(show.rating).toFixed(1)}` : '',
      'Hindi'
    ].filter(Boolean);
  }, [show, contentKind]);

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
    if (!show || contentKind !== 'series') return;
    const epNum = Number(ep?.episode_number || ep?.episodeNumber || 1);
    const sNum = Number(ep?.season_number || seasonNumber || 1);
    const posterVal = show.poster || show.image || show.coverImage || '';
    const backdropVal = show.backdrop || posterVal;
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
      isKartoons: true,
      poster_path: posterVal,
      backdrop_path: backdropVal,
      image: posterVal
    });
  }, [show, slug, seasonNumber, tmdbMatch, contentKind]);

  const handlePlayClick = useCallback((customResumeTime = null, customSeason = null, customEpisode = null) => {
    if (!show) return;
    const posterVal = show.poster || show.image || show.coverImage || '';
    const backdropVal = show.backdrop || posterVal;
    if (contentKind === 'movie') {
      const resume = customResumeTime != null ? customResumeTime : (getSavedProgress({ kartoons_slug: slug })?.currentTime || 0);
      setPlayerRequest({
        mediaType: 'movie',
        tmdbId: tmdbMatch?.id ? tmdbMatch.id : `kartoons-${slug}`,
        title: show.title,
        year: show.startYear,
        kartoonsSlug: slug,
        isKartoons: true,
        poster_path: posterVal,
        backdrop_path: backdropVal,
        image: posterVal,
        resumeTime: resume
      });
      return;
    }
    const lastWatched = getLastWatchedForSeries(slug);
    const targetSeason = customSeason != null
      ? Number(customSeason)
      : (lastWatched?.seasonNumber != null ? Number(lastWatched.seasonNumber) : Number(seasonNumber || 1));
    const targetEp = customEpisode != null
      ? Number(customEpisode)
      : (lastWatched?.episodeNumber != null ? Number(lastWatched.episodeNumber) : Number(seasonDetails?.episodes?.[0]?.episode_number || 1));
    const resume = customResumeTime != null ? customResumeTime : (lastWatched?.currentTime || 0);

    if (targetSeason !== seasonNumber) {
      setSeasonNumber(targetSeason);
    }

    setPlayerRequest({
      mediaType: 'series',
      tmdbId: tmdbMatch?.id ? tmdbMatch.id : `kartoons-${slug}`,
      seasonNumber: targetSeason,
      episodeNumber: targetEp,
      title: `${show.title} S${targetSeason}E${targetEp}`,
      seriesTitle: show.title,
      year: show.startYear,
      kartoonsSlug: slug,
      kartoonsEpisodeId: lastWatched?.kartoons_episode_id || seasonDetails?.episodes?.[0]?.id || '',
      isKartoons: true,
      poster_path: posterVal,
      backdrop_path: backdropVal,
      image: posterVal,
      resumeTime: resume
    });
  }, [show, slug, seasonNumber, seasonDetails, tmdbMatch, contentKind]);

  useEffect(() => {
    if (autoPlayTriggeredRef.current || !show) return;
    if (location.state?.autoPlay || location.state?.resumeTime) {
      autoPlayTriggeredRef.current = true;
      handlePlayClick(
        location.state.resumeTime,
        location.state.seasonNumber,
        location.state.episodeNumber
      );
    }
  }, [show, location.state, handlePlayClick]);

  const relatedItems = useMemo(() => {
    const rawList = Array.isArray(show?.related) ? show.related : [];
    return rawList.map((item, idx) => ({
      id: `kartoons-${item.slug || item._id || idx}`,
      slug: item.slug,
      kartoons_slug: item.slug,
      is_kartoons: true,
      media_type: item.type === 'movie' ? 'Movie' : 'Series',
      title: item.title,
      name: item.title,
      poster_path: item.image,
      image: item.image,
      vote_average: item.rating,
      release_date: item.releaseYear ? `${item.releaseYear}-01-01` : null,
      first_air_date: item.releaseYear ? `${item.releaseYear}-01-01` : null
    })).filter((item) => item.poster_path && item.slug);
  }, [show?.related]);

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
        type={contentKind}
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
                <Link
                  key={tag}
                  to={getTagGenreUrl(tag)}
                  className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-sm text-[#d8d8d8] transition-colors hover:border-white/30 hover:bg-white/[0.1] hover:text-white"
                >
                  {tag}
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* 3. Seasons & Episodes */}
      {contentKind === 'series' && (
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
      )}

      {/* 4. Similar / Related Content */}
      {relatedItems.length > 0 && (
        <section className="content-section relative z-10">
          <SectionHeader title="Similar Content" />
          <div className={HOME_GRID_CLASS}>
            {relatedItems.map((item, index) => (
              <ContentCard
                key={`related-${item.slug || index}`}
                item={item}
                data-card
              />
            ))}
          </div>
        </section>
      )}

      {/* 5. Video player */}
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
