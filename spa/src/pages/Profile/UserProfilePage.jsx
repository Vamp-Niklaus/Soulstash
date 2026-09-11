import { imageUrl } from '../../utils/formatters.js';
import { useAuthSession } from '../../hooks/index.js';
import { getToken, clearAuthSession, apiFetch, emitAuthChange } from '../../api/client.js';
import { collectionItemCount, normalizeCollections } from '../../utils/collectionsCache.js';
import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '../../utils/toast.js';
import { FALLBACK_AVATAR } from '../../utils/constants.js';
import { UserProfileSkeleton, EditProfileSkeleton } from '../../components/ui/Skeletons/index.js';
import { CollectionPosterCard } from '../../components/ui/Cards/CollectionPosterCard.jsx';
import { SectionHeader } from '../../components/ui/SectionHeader.jsx';
import { ContentCard } from '../../components/ui/Cards/ContentCard.jsx';
import { CollectionVisibilityBadge } from '../../components/ui/Misc/CollectionVisibilityBadge.jsx';

import { ActionButton } from '../../components/ui/ActionButton.jsx';
import { ConfirmModal } from '../../components/ui/Modals/ConfirmModal.jsx';
import { AvatarSearchModal } from '../../components/ui/Modals/AvatarSearchModal.jsx';

export function UserProfilePage() {
  const { username = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const isAdminView = location.pathname.startsWith('/admin/user');
  const auth = useAuthSession();
  const queryClient = useQueryClient();
  const [favoriteRemoveTarget, setFavoriteRemoveTarget] = useState(null);
  const [avatarViewerOpen, setAvatarViewerOpen] = useState(false);
  const [avatarSearchOpen, setAvatarSearchOpen] = useState(false);

  useEffect(() => {
    document.title = username ? `${username} - Soulstash` : 'Profile - Soulstash';
  }, [username]);

  const { data: profilePayload, isLoading: loading, isError, error } = useQuery({
    queryKey: ['profile', username, isAdminView],
    queryFn: () => apiFetch(isAdminView ? `/api/admin/users/${encodeURIComponent(username)}/profile` : `/api/user/profile/${encodeURIComponent(username)}`)
  });

  const followMutation = useMutation({
    mutationFn: () => apiFetch('/api/user/follow', {
      method: 'POST',
      body: JSON.stringify({ username })
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile', username] });
    },
    onError: (err) => {
      toast(err.message, 'error');
    }
  });

  const unfollowMutation = useMutation({
    mutationFn: () => apiFetch('/api/user/unfollow', {
      method: 'POST',
      body: JSON.stringify({ username })
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile', username] });
    },
    onError: (err) => {
      toast(err.message, 'error');
    }
  });

  const removeFavoriteMutation = useMutation({
    mutationFn: (id) => apiFetch('/api/user/favorites/remove', {
      method: 'POST',
      body: JSON.stringify({ id })
    }),
    onSuccess: () => {
      toast('Removed from favorites');
      setFavoriteRemoveTarget(null);
      queryClient.invalidateQueries({ queryKey: ['profile', username] });
    },
    onError: (err) => {
      toast(err.message, 'error');
      setFavoriteRemoveTarget(null);
    }
  });

  const favoritePrivacyMutation = useMutation({
    mutationFn: (isPublic) => apiFetch('/api/user/favorites/privacy', {
      method: 'POST',
      body: JSON.stringify({ isPublic })
    }),
    onSuccess: (response) => {
      queryClient.setQueryData(['profile', username], (current) => current ? {
        ...current,
        user: { ...current.user, favoritePeoplePublic: response.favoritePeoplePublic === true }
      } : current);
      toast(response.favoritePeoplePublic ? 'Favorite People are now public' : 'Favorite People are now private', 'success');
    },
    onError: (err) => toast(err.message, 'error')
  });

  const adminAvatarMutation = useMutation({
    mutationFn: (avatarUrl) => apiFetch(`/api/admin/users/${encodeURIComponent(username)}/avatar`, {
      method: 'POST',
      body: JSON.stringify({ avatarUrl })
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile', username] });
      toast('User avatar updated');
    },
    onError: (err) => toast(err.message, 'error')
  });

  // When viewing your own profile, sync avatar into localStorage so the navbar updates
  const profileUser = profilePayload?.user;
  const isOwner = profilePayload?.isOwner && auth.username === username;
  useEffect(() => {
    if (!isOwner || !profileUser) return;
    try {
      const stored = JSON.parse(localStorage.getItem('user') || '{}');
      const profileAvatar = profileUser.avatar || null;
      if (stored.avatar !== profileAvatar) {
        localStorage.setItem('user', JSON.stringify({ ...stored, avatar: profileAvatar }));
        emitAuthChange();
      }
    } catch {}
  }, [isOwner, profileUser?.avatar]);

  if (loading) {
    return <UserProfileSkeleton />;
  }

  if (isError || !profilePayload?.user) {
    return <div className="app-error">{error?.message || 'Profile not found.'}</div>;
  }

  const user = profilePayload.user;
  const followersCount = user.followersCount || 0;
  const followingCount = user.followingCount || 0;
  const isFollowing = Boolean(profilePayload.isFollowing);
  const isFollowedBy = Boolean(profilePayload.isFollowedBy);
  const favoritePeople = Array.isArray(user.favoritePeople) ? user.favoritePeople : [];

  const collections = normalizeCollections(Array.isArray(user.collections) ? user.collections : []);
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.fullName || user.username;
  const watched = collections.find((collection) => collection.name === 'Watched');
  const watchlist = collections.find((collection) => collection.name === 'Watchlist');
  const customCollections = collections.filter((collection) => !['Watched', 'Watchlist'].includes(collection.name));
  const showFavorites = profilePayload?.isOwner || favoritePeople.length;

  return (
    <div className="space-y-7">
      <section className="rounded-[30px] bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] p-5 md:p-7">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <div className="flex flex-col items-start gap-2">
              <button 
                type="button"
                onClick={() => {
                  if (isAdminView) {
                    setAvatarSearchOpen(true);
                  } else {
                    setAvatarViewerOpen(true);
                  }
                }}
                className="group relative h-[96px] w-[96px] shrink-0 overflow-hidden rounded-full bg-white/[0.06] ring-1 ring-white/10 hover:ring-white/30 transition-all cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[#64FFDA]"
              >
                <img
                  src={user.avatar || FALLBACK_AVATAR}
                  alt={user.username}
                  className="h-full w-full object-cover object-[center_top]"
                  onError={(event) => {
                    event.currentTarget.src = FALLBACK_AVATAR;
                  }}
                />
                {(isOwner || isAdminView) && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                    <i className="fas fa-pencil-alt text-white/80"></i>
                  </div>
                )}
              </button>
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
            <div className="flex w-full items-center justify-end gap-3 lg:w-auto">
              {isAdminView ? (
                <span className="inline-flex items-center gap-2 rounded-2xl bg-[#8f44f0]/20 px-4 py-2 text-sm font-medium text-[#8f44f0]">
                  <i className="fas fa-shield-alt"></i> Admin View
                </span>
              ) : isOwner ? (
                <>
                  <button
                    type="button"
                    onClick={() => navigate('/edit')}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-white/[0.06] px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-white/[0.12] lg:flex-none"
                  >
                    <i className="fas fa-edit opacity-70"></i>
                    <span>Edit Profile</span>
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
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    if (!auth.isLoggedIn) {
                      toast('Please login to follow users');
                      navigate('/login');
                      return;
                    }
                    if (isFollowing) unfollowMutation.mutate();
                    else followMutation.mutate();
                  }}
                  disabled={followMutation.isPending || unfollowMutation.isPending}
                  className={`inline-flex flex-1 items-center justify-center gap-2 rounded-2xl px-6 py-3 text-sm font-medium transition-colors lg:flex-none ${
                    isFollowing
                      ? 'bg-white/[0.06] text-white hover:bg-white/[0.12]'
                      : 'bg-[#8f44f0] text-white hover:bg-[#7a39d1]'
                  } disabled:opacity-50`}
                >
                  <i className={`fas ${isFollowing ? 'fa-user-check' : 'fa-user-plus'} ${!isFollowing && 'opacity-90'}`}></i>
                  <span>{isFollowing ? 'Following' : 'Follow'}</span>
                </button>
              )}
            </div>

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
            {isOwner ? (
              <button
                type="button"
                role="switch"
                aria-checked={user.favoritePeoplePublic === true}
                disabled={favoritePrivacyMutation.isPending}
                onClick={() => favoritePrivacyMutation.mutate(user.favoritePeoplePublic !== true)}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-medium transition-colors disabled:opacity-60 ${user.favoritePeoplePublic === true ? 'border-[#64FFDA]/40 bg-[#64FFDA]/10 text-[#b9fff1]' : 'border-white/10 bg-white/[0.06] text-[#b7b7b7]'}`}
              >
                <span className={`h-2.5 w-2.5 rounded-full ${user.favoritePeoplePublic === true ? 'bg-[#64FFDA]' : 'bg-[#777]'}`}></span>
                {user.favoritePeoplePublic === true ? 'Public' : 'Private'}
              </button>
            ) : null}
          </div>
          {favoritePeople.length ? (
            <div className="grid gap-2 grid-cols-4 sm:grid-cols-6 lg:grid-cols-8">
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
          ) : (
            <p className="text-sm text-[#9f9f9f]">No favorite people added yet.</p>
          )}
        </section>
      ) : null}

      <ConfirmModal
        open={!!favoriteRemoveTarget}
        title="Remove from favorites?"
        message={favoriteRemoveTarget ? `"${favoriteRemoveTarget.name}" will be removed from your favorites.` : ''}
        confirmLabel="Remove"
        danger
        onConfirm={() => {
          if (!favoriteRemoveTarget) return;
          removeFavoriteMutation.mutate(favoriteRemoveTarget.id);
        }}
        onClose={() => setFavoriteRemoveTarget(null)}
      />

      {avatarViewerOpen && (
        <div 
          className="fixed inset-0 z-[9999] flex items-center justify-center animate-in fade-in duration-200"
          style={{ background: 'radial-gradient(circle at center, rgba(30, 30, 30, 0.8) 0%, rgba(0, 0, 0, 0.2) 60%, transparent 100%)' }}
          onClick={() => setAvatarViewerOpen(false)}
        >
          <img 
            src={user.avatar || FALLBACK_AVATAR}
            alt={user.username}
            className="relative z-10 max-h-[85vh] max-w-[90vw] rounded-2xl object-contain shadow-[0_0_80px_rgba(0,0,0,0.8)] animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
            onError={(event) => {
              event.currentTarget.src = FALLBACK_AVATAR;
            }}
          />
        </div>
      )}

      <AvatarSearchModal 
        open={avatarSearchOpen} 
        onClose={() => setAvatarSearchOpen(false)} 
        onSelect={(url) => {
          adminAvatarMutation.mutate(url);
          setAvatarSearchOpen(false);
        }}
      />
    </div>
  );
}
