import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuthSession, useLiveCollections } from '../../hooks/index.js';
import { AUTO_RECOVERY_RETRIES, FALLBACK_AVATAR } from '../../utils/constants.js';
import { cachedApiFetch, getToken, apiFetch, getCurrentUsername } from '../../api/client.js';
import { toast } from '../../utils/toast.js';
import { broadcastCollections, createEmptyCollectionDraft, getCollectionStatus, loadUserCollections, normalizeCollections, refreshCollectionsView } from '../../utils/helpers.js';
import { createPlayerRequest } from '../../utils/helpers.js';
import { DetailPageSkeleton, PersonPageSkeleton, CastRowSkeleton, EpisodeRowSkeleton } from '../../components/ui/Skeletons/index.js';
import { ContentCard } from '../../components/ui/Cards/ContentCard.jsx';
import { CastCard } from '../../components/ui/Cards/CastCard.jsx';
import { DetailStat } from '../../components/ui/Cards/DetailStat.jsx';
import { DetailPeopleStat } from '../../components/ui/Cards/DetailPeopleStat.jsx';
import { EpisodeCard } from '../../components/ui/Cards/EpisodeCard.jsx';

import { SectionHeader } from '../../components/ui/SectionHeader.jsx';
import { VideoPlayerModal } from '../../components/player/VideoPlayerModal.jsx';
import { SaveToCollectionModal } from '../../components/ui/Modals/SaveToCollectionModal.jsx';
import { CreateCollectionModal } from '../../components/ui/Modals/CreateCollectionModal.jsx';
import { PlayerErrorBoundary } from '../../components/player/PlayerErrorBoundary.jsx';
import { ActionButton } from '../../components/ui/ActionButton.jsx';
import {
  formatRuntime, yearFrom, getLanguageName, getPrimaryCountry,
  getDirectorLabel, getDirectorPeople, getValidImdbRating,
  getValidVoteAverage, getPreferredRating, creditItemKey,
  creditMatchesCollectionItem, filterCreditsByCollectionItems,
  isContentInCollection, imageUrl
} from '../../utils/formatters.js';

export function DetailPage({ type }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const auth = useAuthSession();
  const [content, setContent] = useState(null);
  const [credits, setCredits] = useState([]);
  const [creditsCrew, setCreditsCrew] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [creditsLoading, setCreditsLoading] = useState(true);
  const [creditsError, setCreditsError] = useState('');
  const { collections } = useLiveCollections();
  const optimisticStatusRef = useRef(null);
  const [, forceStatusRender] = useState(0);
  const serverStatus = useMemo(() => getCollectionStatus(collections, id), [collections, id]);
  const status = optimisticStatusRef.current ?? serverStatus;
  const [selectedSeason, setSelectedSeason] = useState(null);
  const [seasonDetails, setSeasonDetails] = useState(null);
  const [seasonLoading, setSeasonLoading] = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState(createEmptyCollectionDraft);
  const [createLoading, setCreateLoading] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const [creditsRetryTick, setCreditsRetryTick] = useState(0);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [failedCreditAttempts, setFailedCreditAttempts] = useState(0);
  const [seasonRetryTick, setSeasonRetryTick] = useState(0);
  const [failedSeasonAttempts, setFailedSeasonAttempts] = useState(0);
  const castScrollerRef = useRef(null);
  const [playerRequest, setPlayerRequest] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);
  const seasonScrollerRef = useRef(null);
  const episodeScrollerRef = useRef(null);

  useEffect(() => {
    setLoading(true);
    setLoadError('');
    setContent(null);
    setCredits([]);
    setCreditsCrew([]);
    setCreditsLoading(true);
    setCreditsError('');
    setSelectedSeason(null);
    setSeasonDetails(null);
    setSeasonLoading(type === 'series');
    setPlayerRequest(null);
    setRetryTick(0);
    setCreditsRetryTick(0);
    setSeasonRetryTick(0);
    setFailedAttempts(0);
    setFailedCreditAttempts(0);
    setFailedSeasonAttempts(0);
    }, [auth.user?.admin, auth.user?.showAdult, id, type]);

  useEffect(() => {
    let ignore = false;
    let retryTimeout = null;
    setCredits([]);
    setLoading(true);
    setLoadError('');

    async function load() {
      setLoading(true);
      setLoadError('');
      try {
        const detailPath = type === 'movie' ? `/api/movies/${id}` : `/api/series/${id}`;
        const [detailResult, userCollections] = await Promise.allSettled([
          cachedApiFetch(detailPath),
          getToken() ? loadUserCollections().catch(() => []) : Promise.resolve([])
        ]);

        const detailData = detailResult.status === 'fulfilled' ? detailResult.value : null;
        const collectionData = userCollections.status === 'fulfilled' ? userCollections.value : [];

        if (!ignore) {
          if (detailResult.status === 'rejected' || !detailData) {
            throw new Error(detailResult.reason?.message || 'Unable to load this page.');
          }
          setContent(detailData);
          setFailedAttempts(0);
          setLoadError('');
          if (type === 'series' && detailData && Array.isArray(detailData.seasons) && detailData.seasons.length) {
            const initialSeason =
              detailData.seasons.find((season) => Number(season.season_number) > 0)?.season_number ??
              detailData.seasons[0]?.season_number ??
              null;
            setSelectedSeason(initialSeason);
          } else {
            setSelectedSeason(null);
            setSeasonDetails(null);
          }
          if (detailData) {
            document.title = `${detailData.title || detailData.name} | Soulstash`;
          }
        }
      } catch (error) {
        if (!ignore) {
          setFailedAttempts((current) => {
            const next = current + 1;
            if (next >= AUTO_RECOVERY_RETRIES) {
              setLoadError(error.message || 'Unable to load this page.');
            } else {
              retryTimeout = window.setTimeout(() => {
                if (!ignore) {
                  setRetryTick((currentTick) => currentTick + 1);
                }
              }, 2500);
            }
            return next;
          });
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      ignore = true;
      if (retryTimeout) {
        window.clearTimeout(retryTimeout);
      }
    };
    }, [auth.user?.admin, auth.user?.showAdult, id, type, retryTick]);

    useEffect(() => {
      let ignore = false;
      let retryTimeout = null;
      let retryPlanned = false;

      async function loadCredits() {
        setCreditsLoading(true);
        setCreditsError('');
        try {
          const creditPath = type === 'movie' ? `/api/movie/${id}/credits` : `/api/series/${id}/credits`;
          const creditData = await cachedApiFetch(creditPath);
          const nextCast = (creditData.cast || []).slice(0, 16);
          const nextCrew = Array.isArray(creditData.crew) ? creditData.crew : [];

          if (!ignore) {
            setCredits(nextCast);
            setCreditsCrew(nextCrew);

            if (!nextCast.length && !nextCrew.length) {
              setFailedCreditAttempts((current) => {
                const next = current + 1;
                if (next < AUTO_RECOVERY_RETRIES) {
                  retryPlanned = true;
                  retryTimeout = window.setTimeout(() => {
                    if (!ignore) {
                      setCreditsRetryTick((currentTick) => currentTick + 1);
                    }
                  }, 2500);
                } else {
                  setCreditsError('');
                }
                return next;
              });
            } else {
              setFailedCreditAttempts(0);
              setCreditsError('');
            }
          }
        } catch (error) {
          if (!ignore) {
            setFailedCreditAttempts((current) => {
              const next = current + 1;
            if (next >= AUTO_RECOVERY_RETRIES) {
              setCreditsError(error.message || 'Unable to load cast right now.');
            } else {
              retryTimeout = window.setTimeout(() => {
                if (!ignore) {
                  setCreditsRetryTick((currentTick) => currentTick + 1);
                }
              }, 2500);
            }
            return next;
          });
        }
        } finally {
          if (!ignore) {
            if (!retryPlanned) {
              setCreditsLoading(false);
            }
          }
        }
      }

    setCredits([]);
    setCreditsCrew([]);
    setCreditsError('');
    setFailedCreditAttempts(0);
    loadCredits();

    return () => {
      ignore = true;
        if (retryTimeout) {
          window.clearTimeout(retryTimeout);
        }
      };
    }, [auth.user?.admin, auth.user?.showAdult, creditsRetryTick, id, retryTick, type]);

  useEffect(() => {
    setFailedSeasonAttempts(0);
    setSeasonRetryTick(0);
  }, [id, selectedSeason, type]);

  useEffect(() => {
    if (type !== 'series' || !selectedSeason) {
      setSeasonDetails(null);
      return;
    }

    let ignore = false;
    let retryTimeout = null;
    let retryPlanned = false;
    setSeasonLoading(true);
    setSeasonDetails(null);

    cachedApiFetch(`/api/series/${id}/season/${selectedSeason}`)
      .then((payload) => {
        if (!ignore) {
          setSeasonDetails(payload);
          setFailedSeasonAttempts(0);
        }
      })
      .catch((error) => {
        if (!ignore) {
          setFailedSeasonAttempts((current) => {
            const next = current + 1;
            if (next < AUTO_RECOVERY_RETRIES) {
              retryPlanned = true;
              retryTimeout = window.setTimeout(() => {
                if (!ignore) {
                  setSeasonRetryTick((currentTick) => currentTick + 1);
                }
              }, 2500);
            }
            return next;
          });
        }
      })
      .finally(() => {
        if (!ignore) {
          if (!retryPlanned) {
            setSeasonLoading(false);
          }
        }
      });

    return () => {
      ignore = true;
      if (retryTimeout) {
        window.clearTimeout(retryTimeout);
      }
    };
  }, [id, selectedSeason, type, seasonRetryTick]);

  async function toggleCollection(targetCollection) {
    if (!getToken()) {
      toast('Please login first', 'success');
      return;
    }

    const isSeries = type === 'series';
    const idKey = isSeries ? 'seriesId' : 'movieId';
    const alreadySaved = targetCollection === 'Watched' ? status.watched : status.watchlist;

    try {
      setPendingAction(targetCollection);
      const payload = {
        [idKey]: Number(id),
        title: content.title || content.name,
        poster_path: content.poster_path || '',
        release_date: content.release_date || content.first_air_date || '',
        media_type: isSeries ? 'Series' : 'Movie'
      };

      if (alreadySaved) {
        if (window.CollectionStore?.removeFromCollection) {
          await window.CollectionStore.removeFromCollection(targetCollection, payload.movieId, payload.seriesId);
        } else {
          const removeResp = await apiFetch(`/api/user/collections/${encodeURIComponent(targetCollection)}/remove`, {
            method: 'POST',
            body: JSON.stringify({
              ...(payload.movieId ? { movieId: payload.movieId } : {}),
              ...(payload.seriesId ? { seriesId: payload.seriesId } : {})
            })
          });
          if (Array.isArray(removeResp?.collections)) {
            broadcastCollections(normalizeCollections(removeResp.collections), removeResp?.collectionVersion);
          } else {
            await refreshCollectionsView();
          }
        }
      } else {
        if (targetCollection === 'Watched' && status.watchlist) {
          if (window.CollectionStore?.removeFromCollection) {
            await window.CollectionStore.removeFromCollection('Watchlist', payload.movieId, payload.seriesId);
          } else {
            await apiFetch(`/api/user/collections/Watchlist/remove`, {
              method: 'POST',
              body: JSON.stringify({ id: Number(id) })
            });
          }
        } else if (targetCollection === 'Watchlist' && status.watched) {
          if (window.CollectionStore?.removeFromCollection) {
            await window.CollectionStore.removeFromCollection('Watched', payload.movieId, payload.seriesId);
          } else {
            await apiFetch(`/api/user/collections/Watched/remove`, {
              method: 'POST',
              body: JSON.stringify({ id: Number(id) })
            });
          }
        }

        if (window.CollectionStore?.addToCollection) {
          await window.CollectionStore.addToCollection(targetCollection, payload);
        } else {
          const addResp = await apiFetch(`/api/user/collections/${encodeURIComponent(targetCollection)}/add`, {
            method: 'POST',
            body: JSON.stringify(payload)
          });
          if (Array.isArray(addResp?.collections)) {
            broadcastCollections(normalizeCollections(addResp.collections), addResp?.collectionVersion);
          } else {
            await refreshCollectionsView();
          }
        }
      }
      toast(alreadySaved ? `Removed from ${targetCollection}` : `Added to ${targetCollection}`, 'success');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setPendingAction(null);
    }
  }

  if (loading) {
    return <DetailPageSkeleton type={type} />;
  }

  if (!content) {
    return <DetailPageSkeleton type={type} />;
  }

  const title = content.title || content.name || 'Unknown title';
  const currentUsername = getCurrentUsername();
  const languageName = getLanguageName(content.language || content.original_language, content.language || content.original_language || 'Unknown');
  const directorLabel = getDirectorLabel(content, creditsCrew, type);
  const directorPeople = getDirectorPeople(content, creditsCrew, type);
  const directorStat = directorPeople.length ? (
    <DetailPeopleStat label={type === 'series' ? 'Creator' : 'Directed By'} people={directorPeople} navigate={navigate} />
  ) : (
    <DetailStat label={type === 'series' ? 'Creator' : 'Directed By'} value={directorLabel} />
  );
  const countryLabel = getPrimaryCountry(content);
  const ageRatingLabel = content.age_rating || content.certification || content.release_rating || content.content_rating || 'N/A';
  const seasonList = Array.isArray(content.seasons) ? content.seasons : [];
  const visibleSeasonList = seasonList.filter((season) => Number(season?.season_number) > 0);
  const runtimeLabel =
    type === 'movie'
      ? formatRuntime(content.runtime)
      : Array.isArray(content.episode_run_time) && content.episode_run_time.length
        ? formatRuntime(content.episode_run_time[0])
        : formatRuntime(content.runtime);
  const meta = [
    type === 'movie' ? 'Movie' : 'Series',
    yearFrom(content),
    runtimeLabel !== 'N/A' ? runtimeLabel : '',
    getPreferredRating(content) ? `Rating ${getPreferredRating(content).toFixed(1)}` : 'No rating'
  ].filter(Boolean);

  async function handleToggleCustomCollection(targetCollection) {
    if (!content) return;

    const alreadySaved = isContentInCollection(collections, targetCollection.name, id);

    const payload =
      type === 'series'
        ? {
            seriesId: Number(id),
            title,
            poster_path: content.poster_path || '',
            release_date: content.first_air_date || '',
            media_type: 'Series'
          }
        : {
            movieId: Number(id),
            title,
            poster_path: content.poster_path || '',
            release_date: content.release_date || '',
            media_type: 'Movie'
          };

    // Apply optimistic override instantly
    try {
      setPendingAction(targetCollection.name);
      if (alreadySaved) {
        if (window.CollectionStore?.removeFromCollection) {
          await window.CollectionStore.removeFromCollection(targetCollection._id || targetCollection.name, payload.movieId, payload.seriesId);
        } else {
          const removeR = await apiFetch(`/api/user/collections/${encodeURIComponent(targetCollection._id || targetCollection.name)}/remove`, {
            method: 'POST',
            body: JSON.stringify({
              ...(payload.movieId ? { movieId: payload.movieId } : {}),
              ...(payload.seriesId ? { seriesId: payload.seriesId } : {})
            })
          });
          if (Array.isArray(removeR?.collections)) {
            broadcastCollections(normalizeCollections(removeR.collections), removeR?.collectionVersion);
          } else {
            await refreshCollectionsView();
          }
        }
        toast(`Removed from ${targetCollection.name}`);
      } else {
        if (window.CollectionStore?.addToCollection) {
          await window.CollectionStore.addToCollection(targetCollection._id || targetCollection.name, payload);
        } else {
          const addR = await apiFetch(`/api/user/collections/${encodeURIComponent(targetCollection._id || targetCollection.name)}/add`, {
            method: 'POST',
            body: JSON.stringify(payload)
          });
          if (Array.isArray(addR?.collections)) {
            broadcastCollections(normalizeCollections(addR.collections), addR?.collectionVersion);
          } else {
            await refreshCollectionsView();
          }
        }
        toast(`Saved to ${targetCollection.name}`);
      }
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setPendingAction(null);
    }
  }

  async function handleCreateCustomCollection() {
    if (!createDraft.name.trim()) {
      toast('Please enter a collection name', 'error');
      return;
    }

    try {
      setCreateLoading(true);
      if (window.CollectionStore?.createCollection) {
        await window.CollectionStore.createCollection(createDraft.name.trim(), createDraft.isPublic, createDraft.description.trim());
      } else {
        await apiFetch('/api/user/collections', {
          method: 'POST',
          body: JSON.stringify({
            name: createDraft.name.trim(),
            isPublic: createDraft.isPublic,
            description: createDraft.description.trim()
          })
        });
        await refreshCollectionsView();
      }
      toast(`Created ${createDraft.name.trim()}`);
      setCreateModalOpen(false);
      setSaveModalOpen(true);
      setCreateDraft(createEmptyCollectionDraft());
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setCreateLoading(false);
    }
  }

  return (
    <div className="space-y-10">
      <section className="relative -mx-4 overflow-hidden bg-transparent sm:mx-0 sm:rounded-[28px] sm:border sm:border-white/10">
        <div className="relative aspect-[1.6/1] sm:aspect-[2.1/1] lg:aspect-[2.68/1] w-full overflow-hidden bg-black">
          <img
            src={imageUrl(content.backdrop_path, 'original')}
            alt={title}
            className="h-full w-full object-cover object-[center_22%]"
            onError={(event) => {
              event.currentTarget.src = FALLBACK_AVATAR;
            }}
          />
          <button
              type="button"
              data-play-btn="true"
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/65 active:scale-95 active:bg-black/70 lg:h-16 lg:w-16 touch-manipulation"
              aria-label={`Play ${title}`}
              onClick={() => {
                const tmdbId = content?.id || id;
                if (type === 'movie') {
                  setPlayerRequest(
                    createPlayerRequest({
                      mediaType: 'movie',
                      tmdbId,
                      imdbId: content?.imdb_id,
                      title
                    })
                  );
                } else {
                  const season = selectedSeason || 1;
                  const ep = seasonDetails?.episodes?.[0]?.episode_number || 1;
                  setPlayerRequest(
                    createPlayerRequest({
                      mediaType: 'series',
                      tmdbId,
                      seasonNumber: season,
                      episodeNumber: ep,
                      imdbId: content?.imdb_id,
                      title
                    })
                  );
                }
              }}
            >
              <i className="fas fa-play translate-x-[1px] text-sm lg:text-base"></i>
            </button>
          <div className="absolute inset-x-0 bottom-0 h-[48%] bg-gradient-to-t from-[#080808] via-[#080808]/78 to-transparent z-10"></div>
        </div>

        <div className="relative z-10 px-4 pb-6 sm:px-6 sm:pb-8 lg:px-8 lg:pb-10 xl:px-12">
          <div className="-mt-10 sm:-mt-14 lg:-mt-20 xl:hidden">
            <div className="mt-4 flex items-start gap-4">
              <div className="w-[110px] sm:w-[140px] flex-shrink-0 space-y-2">
                <div className="aspect-[2/3] overflow-hidden rounded-xl shadow-2xl">
                  <img
                    src={imageUrl(content.poster_path, 'w500')}
                    alt={title}
                    className="w-full h-full object-cover"
                    onError={(event) => {
                      event.currentTarget.src = FALLBACK_AVATAR;
                    }}
                  />
                </div>
                <DetailStat label="Language" value={languageName} />
              </div>

              <div className="min-w-0 flex-1 self-end">
                <div className="text-[13px] text-[#ABABAB] overflow-x-auto whitespace-nowrap no-scrollbar">{meta.join(' | ')}</div>
                <h1 className="mt-1 text-[20px] leading-[28px] sm:text-[24px] sm:leading-[30px] font-semibold text-white">{title}</h1>
                <div className="mt-3 grid grid-rows-[auto_1fr] gap-2">
                <div className="grid grid-cols-2 gap-2">
                  <DetailStat label="Country" value={countryLabel} />
                  <DetailStat
                    label={type === 'series' ? 'Seasons' : 'Age Rating'}
                    value={type === 'series' ? String(content.number_of_seasons || 'N/A') : ageRatingLabel}
                  />
                </div>
                <div className="self-end">
                  {directorStat}
                </div>
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-2">
              <div className="flex gap-2">
                <div className="w-1/2">
                  <ActionButton
                    active={status.watched}
                    label={status.watched ? 'Watched' : 'Mark as Watched'}
                    onClick={() => toggleCollection('Watched')}
                    icon="fas fa-eye"
                    activeIcon="fas fa-check"
                    loading={pendingAction === 'Watched'}
                  />
                </div>
                <div className="w-1/2">
                  <ActionButton
                    active={status.watchlist}
                    label={status.watchlist ? 'In Watchlist' : 'Add to Watchlist'}
                    onClick={() => toggleCollection('Watchlist')}
                    icon="fas fa-clock"
                    activeIcon="fas fa-check"
                    loading={pendingAction === 'Watchlist'}
                  />
                </div>
              </div>
              <button
                type="button"
                className="flex h-[40px] w-full items-center justify-center whitespace-nowrap rounded-full bg-white/10 px-6 text-white font-medium hover:bg-white/20 transition-colors"
                onClick={() => {
                  if (!currentUsername) {
                    toast('Please login first', 'error');
                    return;
                  }
                  setSaveModalOpen(true);
                }}
              >
                <i className={`${status.customSaved ? 'fas' : 'far'} fa-bookmark mr-2 text-[13px]`}></i>
                {status.customSaved ? 'Added to Collection' : 'Add to Collection'}
              </button>
            </div>
          </div>

          <div className="hidden xl:block">
            <div className="-mt-[13rem] flex w-full flex-row items-end gap-8">
              <div className="w-[200px] aspect-[2/3] overflow-hidden rounded-2xl shadow-2xl flex-shrink-0">
                <img
                  src={imageUrl(content.poster_path, 'w500')}
                  alt={title}
                  className="w-full h-full object-cover"
                  onError={(event) => {
                    event.currentTarget.src = FALLBACK_AVATAR;
                  }}
                />
              </div>

              <div className="min-w-0 flex-1">
                <div className="text-sm text-[#ABABAB] overflow-x-auto whitespace-nowrap no-scrollbar">{meta.join(' | ')}</div>
                <h1 className="mt-1 text-[28px] leading-[36px] font-semibold text-white">{title}</h1>

                <div className="mt-6 grid grid-cols-4 gap-5">
                  {directorStat}
                  <DetailStat label="Country" value={countryLabel} />
                  <DetailStat label="Language" value={languageName} />
                  <DetailStat label={type === 'series' ? 'Seasons' : 'Age Rating'} value={type === 'series' ? String(content.number_of_seasons || 'N/A') : (content.age_rating || content.status || 'N/A')} />
                </div>
              </div>

              <div className="xl:w-[376px] xl:flex xl:flex-col xl:gap-2.5 xl:self-end">
                <div className="flex h-[40px] gap-2.5">
                  <div className="w-1/2">
                    <ActionButton
                      active={status.watched}
                      label={status.watched ? 'Watched' : 'Mark as Watched'}
                      onClick={() => toggleCollection('Watched')}
                      icon="fas fa-eye"
                      activeIcon="fas fa-check"
                      loading={pendingAction === 'Watched'}
                    />
                  </div>
                  <div className="w-1/2">
                    <ActionButton
                      active={status.watchlist}
                      label={status.watchlist ? 'In Watchlist' : 'Add to Watchlist'}
                      onClick={() => toggleCollection('Watchlist')}
                      icon="fas fa-clock"
                      activeIcon="fas fa-check"
                      loading={pendingAction === 'Watchlist'}
                    />
                  </div>
                </div>
                <button
                  type="button"
                  disabled={!!pendingAction}
                  className={`flex h-[40px] w-full items-center justify-center whitespace-nowrap rounded-full bg-white/10 px-6 text-white font-medium hover:bg-white/20 transition-colors ${pendingAction ? 'opacity-70 cursor-wait' : ''}`}
                  onClick={() => {
                    if (!currentUsername) {
                      toast('Please login first', 'error');
                      return;
                    }
                    setSaveModalOpen(true);
                  }}
                >
                  {pendingAction && !['Watched', 'Watchlist'].includes(pendingAction) ? (
                    <i className="fas fa-spinner fa-spin mr-2 text-[13px]"></i>
                  ) : (
                    <i className={`${status.customSaved ? 'fas' : 'far'} fa-bookmark mr-2 text-[13px]`}></i>
                  )}
                  {pendingAction && !['Watched', 'Watchlist'].includes(pendingAction) ? 'Updating...' : (status.customSaved ? 'Added to Collection' : 'Add to Collection')}
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="content-section">
        <div className="rounded-[28px] border border-white/8 bg-[rgba(12,12,12,0.72)] p-5 md:p-6">
          <SectionHeader title="Overview" />
          <p className="mt-4 text-[14px] leading-[22px] text-[#B3B3B3] md:text-[16px] md:leading-[26px]">
            {content.overview || 'No overview available yet.'}
          </p>
          {Array.isArray(content.genres) && content.genres.length ? (
            <div className="mt-5 flex flex-wrap gap-2">
              {content.genres.map((genre) => {
                const label = typeof genre === 'string' ? genre : genre?.name;
                const genreId = genre?.id;
                if (!label) return null;
                if (genreId) {
                  return (
                    <Link key={label} to={`/genre/${genreId}`} className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm text-[#d8d8d8] hover:bg-white/[0.1] transition-colors">
                      {label}
                    </Link>
                  );
                }
                return (
                  <span key={label} className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm text-[#d8d8d8]">
                    {label}
                  </span>
                );
              })}
            </div>
          ) : null}
        </div>
      </section>

      {type === 'series' ? (
        <section className="content-section">
          <SectionHeader title="Seasons & Episodes" />
          <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(15,15,15,0.96),rgba(9,9,9,0.98))] p-4 md:p-6">
            <div className="mb-5 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-[#b7b7b7]">
                  {content.number_of_seasons || 0} seasons &bull; {content.number_of_episodes || 0} episodes &bull; Avg runtime {formatRuntime(content.runtime)}
                </p>
                {visibleSeasonList.length > 1 ? (
                  <div className="hidden shrink-0 items-center gap-2 md:flex">
                    <button
                      type="button"
                      className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/18"
                      onClick={() => seasonScrollerRef.current?.scrollBy({ left: -220, behavior: 'smooth' })}
                      aria-label="Scroll seasons left"
                    >
                      <i className="fas fa-chevron-left"></i>
                    </button>
                    <button
                      type="button"
                      className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/18"
                      onClick={() => seasonScrollerRef.current?.scrollBy({ left: 220, behavior: 'smooth' })}
                      aria-label="Scroll seasons right"
                    >
                      <i className="fas fa-chevron-right"></i>
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <h3 className="text-2xl font-semibold text-white">
                  {seasonDetails?.name || (selectedSeason ? `Season ${selectedSeason}` : 'Season guide')}
                </h3>
                {visibleSeasonList.length ? (
                  <div
                    ref={seasonScrollerRef}
                    className="filter-scrollbar-hidden min-w-0 overflow-x-auto overflow-y-hidden"
                  >
                    <div className="flex min-w-max flex-nowrap items-center gap-2 pr-1">
                      {visibleSeasonList.map((season) => (
                          <button
                            key={season.id || season.season_number}
                            type="button"
                            className={`px-4 py-2 rounded-2xl text-sm font-medium transition-colors ${
                              Number(selectedSeason) === Number(season.season_number)
                                ? 'bg-white text-black'
                                : 'bg-white/6 text-white hover:bg-white/12'
                            }`}
                            onClick={() => setSelectedSeason(season.season_number)}
                          >
                            S{season.season_number}
                          </button>
                        ))}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-[#b7b7b7]">
                  {seasonDetails?.episodes?.length || 0} episodes
                </p>
                {seasonDetails?.episodes?.length ? (
                  <div className="hidden shrink-0 items-center gap-2 md:flex">
                    <button
                      type="button"
                      className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/18"
                      onClick={() => episodeScrollerRef.current?.scrollBy({ left: -320, behavior: 'smooth' })}
                      aria-label="Scroll episodes left"
                    >
                      <i className="fas fa-chevron-left"></i>
                    </button>
                    <button
                      type="button"
                      className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/18"
                      onClick={() => episodeScrollerRef.current?.scrollBy({ left: 320, behavior: 'smooth' })}
                      aria-label="Scroll episodes right"
                    >
                      <i className="fas fa-chevron-right"></i>
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            {seasonLoading ? <EpisodeRowSkeleton /> : null}

            {!seasonLoading && seasonDetails?.episodes?.length ? (
              <div ref={episodeScrollerRef} className="cast-scroll flex gap-3 overflow-x-auto pb-2">
                {seasonDetails.episodes.map((episode) => (
                  <EpisodeCard
                    key={episode.id || `${episode.season_number}-${episode.episode_number}`}
                    episode={episode}
                    onPlay={(ep) =>
                      setPlayerRequest(
                        createPlayerRequest({
                          mediaType: 'series',
                          tmdbId: content?.id || id,
                          seasonNumber: ep.season_number,
                          episodeNumber: ep.episode_number,
                          imdbId: content?.imdb_id,
                          title: `${title} S${ep.season_number}E${ep.episode_number}`
                        })
                      )
                    }
                  />
                ))}
              </div>
            ) : null}

            {!seasonLoading && !seasonDetails?.episodes?.length ? (
              <div className="empty-state">No episode details available for this season yet.</div>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="content-section">
        <div className="mb-5 flex items-center justify-between gap-4">
          <SectionHeader title="Cast" />
          {credits.length ? (
            <div className="hidden items-center gap-2 md:flex">
              <button
                type="button"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/18"
                onClick={() => castScrollerRef.current?.scrollBy({ left: -320, behavior: 'smooth' })}
                aria-label="Scroll cast left"
              >
                <i className="fas fa-chevron-left"></i>
              </button>
              <button
                type="button"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/18"
                onClick={() => castScrollerRef.current?.scrollBy({ left: 320, behavior: 'smooth' })}
                aria-label="Scroll cast right"
              >
                <i className="fas fa-chevron-right"></i>
              </button>
            </div>
          ) : null}
        </div>
        {creditsLoading ? (
          <CastRowSkeleton />
        ) : credits.length ? (
          <div ref={castScrollerRef} className="cast-scroll flex gap-4 overflow-x-auto pb-2">
            {credits.map((person) => (
              <CastCard key={person.id} person={person} />
            ))}
          </div>
        ) : creditsError ? (
          <div className="empty-state">Unable to load cast right now.</div>
        ) : (
          <div className="empty-state">No cast information available.</div>
        )}
      </section>
      <SaveToCollectionModal
        open={saveModalOpen}
        onClose={() => setSaveModalOpen(false)}
        collections={collections}
        contentId={Number(id)}
        onToggleCollection={handleToggleCustomCollection}
        onCreateNew={() => {
          setSaveModalOpen(false);
          setCreateModalOpen(true);
        }}
      />
      <CreateCollectionModal
        open={createModalOpen}
        values={createDraft}
        onChange={setCreateDraft}
        onClose={() => {
          setCreateModalOpen(false);
          setCreateDraft(createEmptyCollectionDraft());
        }}
        onSubmit={handleCreateCustomCollection}
        saving={createLoading}
      />
      {playerRequest?.tmdbId ? (
        <PlayerErrorBoundary onClose={() => setPlayerRequest(null)}>
          <VideoPlayerModal request={playerRequest} onClose={() => setPlayerRequest(null)} />
        </PlayerErrorBoundary>
      ) : null}
    </div>
  );
}
