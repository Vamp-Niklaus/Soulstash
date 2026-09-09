import { getToken, saveAuthSession, apiFetch } from '../../api/client.js';
import { useMemo, useState, useEffect } from 'react';
import React from 'react';
import { useAuthSession } from '../../hooks/index.js';
import { toast } from '../../utils/toast.js';
import { FALLBACK_AVATAR } from '../../utils/constants.js';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// Quick inline component if it was missing before, or just keep it as is if it was working
function DetailStat({ label, value }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-[#a6a6a6]">{label}</span>
      <span className="text-sm text-white font-medium">{value}</span>
    </div>
  );
}

export function AdminPage() {
  const auth = useAuthSession();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  
  const [multimoviesForm, setMultimoviesForm] = useState({ rootUrl: '', baseUrl: '' });

  const { data: adminInfo, isPending: adminLoading, isError: adminError, error: adminErrorObj } = useQuery({
    queryKey: ['adminMe'],
    queryFn: () => apiFetch('/api/admin/me'),
    enabled: auth.isLoggedIn,
    retry: false
  });

  useEffect(() => {
    if (adminInfo?.multimovies) {
      setMultimoviesForm({
        rootUrl: adminInfo.multimovies?.rootUrl || '',
        baseUrl: adminInfo.multimovies?.baseUrl || ''
      });
    }
  }, [adminInfo]);

  const { data: usersData, isPending: usersLoading } = useQuery({
    queryKey: ['adminUsers'],
    queryFn: () => apiFetch('/api/admin/users'),
    enabled: !!adminInfo,
  });

  const preferencesMutation = useMutation({
    mutationFn: (showAdult) => apiFetch('/api/admin/preferences', {
      method: 'POST',
      body: JSON.stringify({ showAdult })
    }),
    onSuccess: (response) => {
      queryClient.setQueryData(['adminMe'], (old) => ({
        ...old,
        showAdult: Boolean(response?.showAdult)
      }));
      saveAuthSession(getToken(), { ...auth.user, admin: true, showAdult: Boolean(response?.showAdult) });
      toast(response?.showAdult ? 'Admin mode enabled' : 'Admin mode disabled');
    },
    onError: (error) => {
      toast(error.message, 'error');
    }
  });

  const multimoviesMutation = useMutation({
    mutationFn: (form) => apiFetch('/api/admin/multimovies', {
      method: 'POST',
      body: JSON.stringify(form)
    }),
    onSuccess: (response) => {
      const multimovies = response?.multimovies;
      queryClient.setQueryData(['adminMe'], (old) => ({ ...old, multimovies }));
      setMultimoviesForm({
        rootUrl: multimovies?.rootUrl || '',
        baseUrl: multimovies?.baseUrl || ''
      });
      toast('Multimovies config updated');
    },
    onError: (error) => toast(error.message, 'error')
  });

  const filteredUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const usersList = usersData?.users || [];
    if (!normalizedQuery) return usersList;

    return usersList.filter((user) =>
      [user.username, user.email, user.firstName, user.lastName, user.bio]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(normalizedQuery))
    );
  }, [usersData, query]);

  if (!auth.isLoggedIn || adminLoading) {
    return <div className="app-loading">Checking admin access...</div>;
  }

  if (adminError || !adminInfo) {
    return <div className="app-error">Admin access only. {adminErrorObj ? `(${adminErrorObj.message})` : '(No admin info)'}</div>;
  }

  const showAdult = Boolean(adminInfo.showAdult);

  return (
    <div className="space-y-8">
      <section className="rounded-[28px] border border-white/10 bg-transparent p-6 md:p-8">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
          <div>
            <p className="text-sm uppercase tracking-[0.25em] text-[#8f44f0]">Admin Access</p>
            <h1 className="text-3xl md:text-5xl font-semibold text-white mt-3">Users Overview</h1>
            <p className="text-[#b7b7b7] mt-4 max-w-2xl">
              Admin-only dashboard. Password hashes are still hidden.
            </p>
          </div>
          <div className="flex w-full flex-col gap-3 lg:w-auto lg:items-end">
            <button
              type="button"
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-white/[0.12] disabled:opacity-60"
              disabled={preferencesMutation.isPending}
              onClick={() => preferencesMutation.mutate(!showAdult)}
            >
              <i className={`fas ${showAdult ? 'fa-eye' : 'fa-eye-slash'}`}></i>
              <span>{showAdult ? 'Admin mode on' : 'Admin mode off'}</span>
            </button>
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search username, email, bio..."
              className="w-full lg:w-[360px] rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white"
            />
          </div>
        </div>

        <div className="admin-grid grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
          <div className="admin-stat-card rounded-2xl p-5">
            <p className="text-sm text-[#9f9f9f]">Total users</p>
            <p className="text-3xl font-semibold text-white mt-2">{usersData?.totalUsers || 0}</p>
          </div>
          <div className="admin-stat-card rounded-2xl p-5">
            <p className="text-sm text-[#9f9f9f]">Visible results</p>
            <p className="text-3xl font-semibold text-white mt-2">{filteredUsers.length}</p>
          </div>
          <div className="admin-stat-card rounded-2xl p-5">
            <p className="text-sm text-[#9f9f9f]">Total saved items</p>
            <p className="text-3xl font-semibold text-white mt-2">
              {(usersData?.users || []).reduce((sum, user) => sum + (user.totalSavedItems || 0), 0)}
            </p>
          </div>
        </div>

        <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-medium text-white">Multimovies Config</p>
              <p className="text-sm text-[#9f9f9f]">
                Status: {adminInfo.multimovies?.available === false ? 'Unavailable' : 'Available'}
              </p>
            </div>
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-white/[0.12] disabled:opacity-60"
              disabled={multimoviesMutation.isPending}
              onClick={() => multimoviesMutation.mutate(multimoviesForm)}
            >
              {multimoviesMutation.isPending ? 'Saving...' : 'Save Multimovies URLs'}
            </button>
          </div>
          <div className="grid grid-cols-1 gap-4 mt-4 md:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm text-[#b7b7b7]">
              <span>Root URL</span>
              <input
                type="text"
                value={multimoviesForm.rootUrl}
                onChange={(event) => setMultimoviesForm((current) => ({ ...current, rootUrl: event.target.value }))}
                placeholder="https://multimovies.wtf/"
                className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white"
              />
            </label>
            <label className="flex flex-col gap-2 text-sm text-[#b7b7b7]">
              <span>Base URL</span>
              <input
                type="text"
                value={multimoviesForm.baseUrl}
                onChange={(event) => setMultimoviesForm((current) => ({ ...current, baseUrl: event.target.value }))}
                placeholder="https://multimovies.fyi/"
                className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white"
              />
            </label>
          </div>
        </div>
      </section>

      {usersLoading ? (
        <div className="app-loading">Loading users...</div>
      ) : (
        <section className="admin-grid grid grid-cols-1 xl:grid-cols-2 gap-5">
          {filteredUsers.map((user, userIndex) => (
            <article key={user.id || user._id || user.username || `user-${userIndex}`} className="admin-user-card rounded-[24px] p-6">
              <div className="flex items-start gap-4">
                <img
                  src={user.avatar || FALLBACK_AVATAR}
                  alt={user.username}
                  className="w-16 h-16 rounded-2xl object-cover border border-white/10"
                  onError={(event) => {
                    event.currentTarget.src = FALLBACK_AVATAR;
                  }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="text-2xl font-semibold text-white truncate">{user.username}</h2>
                    <span className="text-xs uppercase tracking-[0.2em] text-[#8f44f0]">
                      {user.collectionCount || 0} collections
                    </span>
                  </div>
                  <p className="text-sm text-[#d0d0d0] mt-2">{user.fullName || 'No name saved'}</p>
                  <p className="text-sm text-[#a6a6a6] mt-1">{user.email || 'No email saved'}</p>
                  <p className="text-sm text-[#d0d0d0] mt-3">{user.bio || 'No bio available.'}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
                <DetailStat label="Watched" value={String(user.watchedCount || 0)} />
                <DetailStat label="Watchlist" value={String(user.watchlistCount || 0)} />
                <DetailStat label="Total Saved" value={String(user.totalSavedItems || 0)} />
                <DetailStat label="Joined" value={user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'Unknown'} />
                <DetailStat label="Followers" value={String(user.followersCount || 0)} />
                <DetailStat label="Following" value={String(user.followingCount || 0)} />
              </div>

              <div className="mt-6">
                <p className="text-xs uppercase tracking-[0.2em] text-[#8f44f0] mb-3">Collections</p>
                <div className="flex flex-wrap gap-2">
                  {(user.collections || []).length ? (
                    user.collections.map((collection, collectionIndex) => (
                      <span
                        key={`${user.id || user._id || user.username || userIndex}-${collection.name || 'collection'}-${collectionIndex}`}
                        className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-[#e2e2e2]"
                      >
                        {collection.name} ({Array.isArray(collection.movies) ? collection.movies.length : 0})
                      </span>
                    ))
                  ) : (
                    <span className="text-sm text-[#9f9f9f]">No collections</span>
                  )}
                </div>
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
