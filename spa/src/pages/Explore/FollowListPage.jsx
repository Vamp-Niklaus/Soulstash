import { useNavigate } from 'react-router-dom';
import { FALLBACK_AVATAR } from '../../utils/constants.js';
import { cachedApiFetch, getToken, apiFetch, clearClientDataCaches } from '../../api/client.js';
import { toast } from '../../utils/toast.js';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { SectionHeader } from '../../components/ui/SectionHeader.jsx';
import { ContentCard } from '../../components/ui/Cards/ContentCard.jsx';
import { CastCard } from '../../components/ui/Cards/CastCard.jsx';

import { LoadingCardRow } from '../../components/ui/LoadingCardRow.jsx';
import { SearchResultSkeletonGrid, CastRowSkeleton } from '../../components/ui/Skeletons/index.js';

export function FollowListPage({ listType }) {
  const { username = '' } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [users, setUsers] = useState([]);

  useEffect(() => {
    document.title = `${listType === 'followers' ? 'Followers' : 'Following'} | Soulstash`;
  }, [listType]);

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setError('');
    cachedApiFetch(`/api/user/${encodeURIComponent(username)}/${listType}`)
      .then((payload) => {
        if (!ignore) {
          setUsers(Array.isArray(payload?.users) ? payload.users : []);
        }
      })
      .catch((err) => {
        if (!ignore) setError(err.message || 'Unable to load users.');
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [listType, username]);

  async function toggleFollow(targetUsername, isFollowing) {
    if (!getToken()) {
      navigate('/login');
      return;
    }
    try {
      if (isFollowing) {
        await apiFetch('/api/user/unfollow', {
          method: 'POST',
          body: JSON.stringify({ username: targetUsername })
        });
      } else {
        await apiFetch('/api/user/follow', {
          method: 'POST',
          body: JSON.stringify({ username: targetUsername })
        });
      }
      setUsers((current) =>
        current.map((user) =>
          user.username === targetUsername ? { ...user, isFollowing: !isFollowing } : user
        )
      );
      clearClientDataCaches();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  if (loading) {
    return <div className="app-loading">Loading {listType}...</div>;
  }

  if (error) {
    return <div className="app-error">{error}</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-white">{listType === 'followers' ? 'Followers' : 'Following'}</h1>
        <button
          type="button"
          className="rounded-full bg-white/[0.08] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/[0.14]"
          onClick={() => navigate(`/user/${username}`)}
        >
          Back to profile
        </button>
      </div>
      {users.length ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {users.map((user) => (
            <div key={user.username} className="rounded-[22px] border border-white/10 bg-white/[0.03] p-4 flex gap-4">
              <button type="button" className="h-14 w-14 overflow-hidden rounded-full" onClick={() => navigate(`/user/${user.username}`)}>
                <img
                  src={user.avatar || FALLBACK_AVATAR}
                  alt={user.username}
                  className="h-full w-full object-cover"
                  onError={(event) => {
                    event.currentTarget.src = FALLBACK_AVATAR;
                  }}
                />
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-white font-semibold truncate">{user.fullName || user.username}</h3>
                    <p className="text-xs text-[#9a9a9a]">@{user.username}</p>
                  </div>
                  {user.username !== username ? (
                    <button
                      type="button"
                      className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-black"
                      onClick={() => toggleFollow(user.username, user.isFollowing)}
                    >
                      {user.isFollowing ? 'Unfollow' : 'Follow'}
                    </button>
                  ) : null}
                </div>
                <p className="mt-2 text-sm text-[#b0b0b0] line-clamp-2">{user.bio || 'No bio yet.'}</p>
                {user.isFollowedBy ? (
                  <span className="mt-2 inline-flex rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-[#9a9a9a]">
                    Follows you
                  </span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state">No users here yet.</div>
      )}
    </div>
  );
}
