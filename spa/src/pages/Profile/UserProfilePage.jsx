import { imageUrl } from '../../utils/formatters.js';
import { useAuthSession } from '../../hooks/index.js';
import { cachedApiFetch, getToken, clearAuthSession, apiFetch } from '../../api/client.js';
import { collectionItemCount, normalizeCollections } from '../../utils/helpers.js';
import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { toast } from '../../utils/toast.js';
import { FALLBACK_AVATAR } from '../../utils/constants.js';
import { UserProfileSkeleton, EditProfileSkeleton } from '../../components/ui/Skeletons/index.js';
import { CollectionPosterCard } from '../../components/ui/Cards/CollectionPosterCard.jsx';
import { SectionHeader } from '../../components/ui/SectionHeader.jsx';
import { ContentCard } from '../../components/ui/Cards/ContentCard.jsx';
import { CollectionVisibilityBadge } from '../../components/ui/Misc/CollectionVisibilityBadge.jsx';

import { ActionButton } from '../../components/ui/ActionButton.jsx';
import { ConfirmModal } from '../../components/ui/Modals/ConfirmModal.jsx';

export function UserProfilePage() {
  const { username = '' } = useParams();
  const navigate = useNavigate();
  const auth = useAuthSession();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [profilePayload, setProfilePayload] = useState(null);
  const [favoritePeople, setFavoritePeople] = useState([]);
  const [favoriteRemoveTarget, setFavoriteRemoveTarget] = useState(null);
  const [followersCount, setFollowersCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);
  const [isFollowedBy, setIsFollowedBy] = useState(false);

  useEffect(() => {
    document.title = username ? `${username} - Soulstash` : 'Profile - Soulstash';
  }, [username]);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setError('');

    cachedApiFetch(`/api/user/profile/${encodeURIComponent(username)}`)
      .then((payload) => {
        if (!cancelled) {
          setProfilePayload(payload);
          if (payload?.user?.favoritePeople && payload?.isOwner) {
            setFavoritePeople(payload.user.favoritePeople);
          }
          setFollowersCount(payload?.user?.followersCount || 0);
          setFollowingCount(payload?.user?.followingCount || 0);
          setIsFollowing(Boolean(payload?.isFollowing));
          setIsFollowedBy(Boolean(payload?.isFollowedBy));
        }
      })
      .catch((fetchError) => {
        if (!cancelled) {
          setError(fetchError.message || 'Failed to load profile');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [username]);

  if (loading) {
    return <UserProfileSkeleton />;
  }

  if (error || !profilePayload?.user) {
    return <div className="app-error">{error || 'Profile not found.'}</div>;
  }

  const user = profilePayload.user;
  const collections = normalizeCollections(Array.isArray(user.collections) ? user.collections : []);
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.fullName || user.username;
  const watched = collections.find((collection) => collection.name === 'Watched');
  const watchlist = collections.find((collection) => collection.name === 'Watchlist');
  const customCollections = collections.filter((collection) => !['Watched', 'Watchlist'].includes(collection.name));
  const showFavorites = profilePayload?.isOwner && favoritePeople.length;
  const isOwner = profilePayload?.isOwner && auth.username === username;

  return (
    <div className="space-y-7">
      <section className="rounded-[30px] bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] p-5 md:p-7">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <div className="flex flex-col items-start gap-2">
              <div className="h-[96px] w-[96px] overflow-hidden rounded-full bg-white/[0.06] ring-1 ring-white/10">
                <img
                  src={user.avatar || FALLBACK_AVATAR}
                  alt={user.username}
                  className="h-full w-full object-cover"
                  onError={(event) => {
                    event.currentTarget.src = FALLBACK_AVATAR;
                  }}
                />
              </div>
              <div className="flex items-center gap-3 text-xs text-[#9f9f9f]">
                <button
                  type="button"
                  className="hover:text-white transition-colors"
                  onClick={() => navigate(`/user/${username}/followers`)}
                >
                  {followersCount} followers
                </button>
                <button
                  type="button"
                  className="hover:text-white transition-colors"
                  onClick={() => navigate(`/user/${username}/following`)}
                >
                  {followingCount} following
                </button>
              </div>
            </div>
            <div className="min-w-0">
              <p className="text-sm text-[#9f9f9f]">@{user.username}</p>
              <h1 className="mt-1 truncate text-xl sm:text-2xl md:text-3xl font-semibold text-white">{fullName}</h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-[#b7b7b7]">{user.bio || 'No bio added yet.'}</p>
            </div>
          </div>

          <div className="flex w-full flex-col items-stretch gap-4 lg:w-auto lg:min-w-[340px] lg:items-end">
            {isOwner ? (
              <div className="flex w-full flex-wrap justify-start gap-3 lg:justify-end">
                <button
                  type="button"
                  className="rounded-full bg-white/[0.08] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/[0.14]"
                  onClick={() => navigate('/edit')}
                >
                  Edit Profile
                </button>
                <button
                  type="button"
                  className="rounded-full bg-white/[0.08] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/[0.14]"
                  onClick={() => {
                    clearAuthSession();
                    toast('Logged out', 'success');
                    navigate('/login');
                  }}
                >
                  Logout
                </button>
              </div>
            ) : (
              <div className="flex w-full flex-wrap justify-start gap-3 lg:justify-end">
                <button
                  type="button"
                  className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-[#e6e6e6]"
                  onClick={async () => {
                    if (!getToken()) {
                      navigate('/login');
                      return;
                    }
                    try {
                      if (isFollowing) {
                        await apiFetch('/api/user/unfollow', {
                          method: 'POST',
                          body: JSON.stringify({ username })
                        });
                        setIsFollowing(false);
                        setFollowersCount((current) => Math.max(0, current - 1));
                      } else {
                        await apiFetch('/api/user/follow', {
                          method: 'POST',
                          body: JSON.stringify({ username })
                        });
                        setIsFollowing(true);
                        setFollowersCount((current) => current + 1);
                      }
                    } catch (err) {
                      toast(err.message, 'error');
                    }
                  }}
                >
                  {isFollowing ? 'Unfollow' : 'Follow'}
                </button>
                {isFollowedBy ? (
                  <span className="self-center text-xs uppercase tracking-[0.18em] text-[#9a9a9a]">Follows you</span>
                ) : null}
              </div>
            )}

            <div className="grid w-full grid-cols-3 gap-2 md:flex md:flex-wrap md:justify-start md:gap-3 lg:justify-end">
              <div className="rounded-2xl bg-white/[0.04] px-3 py-2.5 md:px-4 md:py-3">
                <p className="text-[10px] uppercase tracking-[0.12em] text-[#8f8f8f] md:text-[11px] md:tracking-[0.14em]">Watched</p>
                <p className="mt-1 text-lg font-semibold text-white md:text-xl">{collectionItemCount(watched)}</p>
              </div>
              <div className="rounded-2xl bg-white/[0.04] px-3 py-2.5 md:px-4 md:py-3">
                <p className="text-[10px] uppercase tracking-[0.12em] text-[#8f8f8f] md:text-[11px] md:tracking-[0.14em]">Watchlist</p>
                <p className="mt-1 text-lg font-semibold text-white md:text-xl">{collectionItemCount(watchlist)}</p>
              </div>
              <div className="rounded-2xl bg-white/[0.04] px-3 py-2.5 md:px-4 md:py-3">
                <p className="text-[10px] uppercase tracking-[0.12em] text-[#8f8f8f] md:text-[11px] md:tracking-[0.14em]">Collections</p>
                <p className="mt-1 text-lg font-semibold text-white md:text-xl">{customCollections.length}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-[28px] bg-[rgba(255,255,255,0.025)] p-5 md:p-6">
        <div className="mb-5 flex items-center justify-between gap-4">
          <SectionHeader
            title="Collections"
            subtitle={profilePayload.isOwner ? '' : 'Public collections from this profile.'}
          />
          {profilePayload.isOwner ? (
            <button
              type="button"
              className="rounded-full bg-white/[0.08] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/[0.14]"
              onClick={() => navigate(`/user/${username}/collections`)}
            >
              Open Collections
            </button>
          ) : null}
        </div>

        {collections.length ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {collections.map((collection) => (
              <button
                key={collection._id || collection.name}
                type="button"
                className="overflow-hidden rounded-[22px] bg-white/[0.035] text-left transition-colors hover:bg-white/[0.06]"
                onClick={() => navigate(`/user/${username}/collection/${encodeURIComponent(collection.name)}`)}
              >
                <div className="aspect-[2.15/1] bg-[#121212]">
                  <img
                    src={collection.banner || FALLBACK_AVATAR}
                    alt={collection.name}
                    className="h-full w-full object-cover"
                    onError={(event) => {
                      event.currentTarget.src = FALLBACK_AVATAR;
                    }}
                  />
                </div>
                <div className="p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-base font-semibold text-white">
                        {collection.name}
                        {collection.isPublished && !['Watched', 'Watchlist'].includes(collection.name) ? (
                          <i className="fas fa-star ml-1.5 text-[#e6c56a] text-[11px] align-middle"></i>
                        ) : null}
                      </h3>
                      <div className="mt-2 flex items-center gap-2">
                        <CollectionVisibilityBadge collection={collection} />
                        <span className="text-[11px] uppercase tracking-[0.12em] text-[#8f8f8f]">{collection.movieCount || 0} saved</span>
                      </div>
                    </div>
                  </div>
                  <p className="mt-2 line-clamp-2 text-[13px] leading-5 text-[#b7b7b7]">{collection.description || 'No description yet.'}</p>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="empty-state">No collections available yet.</div>
        )}
      </section>

      {showFavorites ? (
        <section className="rounded-[28px] bg-[rgba(255,255,255,0.02)] p-5 md:p-6">
          <div className="mb-5 flex items-center justify-between gap-4">
            <SectionHeader title="Favorite People" />
          </div>
          <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
            {favoritePeople.map((person) => (
              <div key={person.id} className="group relative w-full rounded-[18px] border border-white/10 bg-white/[0.03] p-2.5">
                <button
                  type="button"
                  className="w-full text-left"
                  onClick={() => navigate(`/person/${person.id}`)}
                >
                  <div className="aspect-[2/3] overflow-hidden rounded-[16px] bg-[#111111]">
                    <img
                      src={imageUrl(person.profile_path, 'w300_and_h450_face') || FALLBACK_AVATAR}
                      alt={person.name}
                      className="h-full w-full object-cover"
                      onError={(event) => {
                        event.currentTarget.src = FALLBACK_AVATAR;
                      }}
                    />
                  </div>
                  <div className="mt-2">
                    <h3 className="truncate text-[14px] font-semibold text-white">{person.name}</h3>
                    <p className="text-[11px] text-[#9a9a9a]">{person.known_for_department || 'Known for'}</p>
                  </div>
                </button>
                <button
                  type="button"
                  className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={() => setFavoriteRemoveTarget(person)}
                >
                  <i className="fas fa-times text-[9px]"></i>
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <ConfirmModal
        open={!!favoriteRemoveTarget}
        title="Remove from favorites?"
        message={favoriteRemoveTarget ? `"${favoriteRemoveTarget.name}" will be removed from your favorites.` : ''}
        confirmLabel="Remove"
        danger
        onConfirm={async () => {
          if (!favoriteRemoveTarget) return;
          try {
            await apiFetch('/api/user/favorites/remove', {
              method: 'POST',
              body: JSON.stringify({ id: favoriteRemoveTarget.id })
            });
            setFavoritePeople((current) => current.filter((person) => person.id !== favoriteRemoveTarget.id));
            toast('Removed from favorites');
          } catch (err) {
            toast(err.message, 'error');
          } finally {
            setFavoriteRemoveTarget(null);
          }
        }}
        onClose={() => setFavoriteRemoveTarget(null)}
      />
    </div>
  );
}
