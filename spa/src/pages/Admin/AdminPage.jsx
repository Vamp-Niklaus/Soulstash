import { getToken, saveAuthSession, apiFetch } from '../../api/client.js';
import { useMemo } from 'react';
import React, { useState, useEffect } from 'react';
import { useAuthSession } from '../../hooks/index.js';
import { toast } from '../../utils/toast.js';
import { FALLBACK_AVATAR } from '../../utils/constants.js';

export function AdminPage() {
  const auth = useAuthSession();
  const [data, setData] = useState({ totalUsers: 0, users: [] });
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [adminInfo, setAdminInfo] = useState({
    loading: true,
    isAdmin: false,
    showAdult: false,
    multimovies: { available: true, rootUrls: [''], baseUrls: [''] }
  });
  const [multimoviesForm, setMultimoviesForm] = useState({ rootUrl: '', baseUrl: '' });
  const [savingMultimovies, setSavingMultimovies] = useState(false);

  useEffect(() => {
    let ignore = false;

    if (!auth.isLoggedIn) {
      setAdminInfo({
        loading: false,
        isAdmin: false,
        showAdult: false,
        multimovies: { available: true, rootUrls: [''], baseUrls: [''] }
      });
      setLoading(false);
      return () => {
        ignore = true;
      };
    }

    apiFetch('/api/admin/me')
      .then((payload) => {
        if (!ignore) {
          const multimovies = payload?.multimovies || { available: true, rootUrls: [''], baseUrls: [''] };
          setAdminInfo({
            loading: false,
            isAdmin: true,
            showAdult: Boolean(payload?.showAdult),
            multimovies
          });
          setMultimoviesForm({
            rootUrl: multimovies?.rootUrls?.[0] || '',
            baseUrl: multimovies?.baseUrls?.[0] || ''
          });
        }
      })
      .catch((error) => {
        if (!ignore) {
          if (error?.status === 403) {
            setAdminInfo({
              loading: false,
              isAdmin: false,
              showAdult: false,
              multimovies: { available: true, rootUrls: [''], baseUrls: [''] }
            });
          } else {
            toast(error.message, 'error');
            setAdminInfo({
              loading: false,
              isAdmin: false,
              showAdult: false,
              multimovies: { available: true, rootUrls: [''], baseUrls: [''] }
            });
          }
        }
      });

    return () => {
      ignore = true;
    };
  }, [auth.isLoggedIn]);

  useEffect(() => {
    let ignore = false;

    if (!adminInfo.isAdmin) {
      setLoading(false);
      return () => {
        ignore = true;
      };
    }

    setLoading(true);

    apiFetch('/api/admin/users')
      .then((payload) => {
        if (!ignore) {
          setData(payload);
          document.title = 'Admin | Soulstash';
        }
      })
      .catch((error) => {
        if (!ignore) {
          toast(error.message, 'error');
        }
      })
      .finally(() => {
        if (!ignore) {
          setLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [adminInfo.isAdmin]);

  const filteredUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return data.users;
    }

    return data.users.filter((user) =>
      [user.username, user.email, user.firstName, user.lastName, user.bio]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(normalizedQuery))
    );
  }, [data.users, query]);

  if (adminInfo.loading) {
    return <div className="app-loading">Checking admin access...</div>;
  }

  if (!adminInfo.isAdmin) {
    return <div className="app-error">Admin access only.</div>;
  }

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
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-white/[0.12]"
              onClick={async () => {
                const nextValue = !adminInfo.showAdult;
                try {
                  const response = await apiFetch('/api/admin/preferences', {
                    method: 'POST',
                    body: JSON.stringify({ showAdult: nextValue })
                  });
                  setAdminInfo((current) => ({ ...current, showAdult: Boolean(response?.showAdult) }));
                  saveAuthSession(getToken(), { ...auth.user, admin: true, showAdult: Boolean(response?.showAdult) });
                  toast(response?.showAdult ? 'Admin mode enabled' : 'Admin mode disabled');
                } catch (error) {
                  toast(error.message, 'error');
                }
              }}
            >
              <i className={`fas ${adminInfo.showAdult ? 'fa-eye' : 'fa-eye-slash'}`}></i>
              <span>{adminInfo.showAdult ? 'Admin mode on' : 'Admin mode off'}</span>
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
            <p className="text-3xl font-semibold text-white mt-2">{data.totalUsers}</p>
          </div>
          <div className="admin-stat-card rounded-2xl p-5">
            <p className="text-sm text-[#9f9f9f]">Visible results</p>
            <p className="text-3xl font-semibold text-white mt-2">{filteredUsers.length}</p>
          </div>
          <div className="admin-stat-card rounded-2xl p-5">
            <p className="text-sm text-[#9f9f9f]">Total saved items</p>
            <p className="text-3xl font-semibold text-white mt-2">
              {data.users.reduce((sum, user) => sum + (user.totalSavedItems || 0), 0)}
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
              disabled={savingMultimovies}
              onClick={async () => {
                try {
                  setSavingMultimovies(true);
                  const response = await apiFetch('/api/admin/multimovies', {
                    method: 'POST',
                    body: JSON.stringify(multimoviesForm)
                  });
                  const multimovies = response?.multimovies || adminInfo.multimovies;
                  setAdminInfo((current) => ({ ...current, multimovies }));
                  setMultimoviesForm({
                    rootUrl: multimovies?.rootUrls?.[0] || '',
                    baseUrl: multimovies?.baseUrls?.[0] || ''
                  });
                  toast('Multimovies config updated');
                } catch (error) {
                  toast(error.message, 'error');
                } finally {
                  setSavingMultimovies(false);
                }
              }}
            >
              {savingMultimovies ? 'Saving...' : 'Save Multimovies URLs'}
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

      {loading ? (
        <div className="app-loading">Loading users...</div>
      ) : (
        <section className="admin-grid grid grid-cols-1 xl:grid-cols-2 gap-5">
          {filteredUsers.map((user) => (
            <article key={user._id} className="admin-user-card rounded-[24px] p-6">
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
                  <p className="text-sm text-[#a6a6a6] mt-2">{user.email || 'No email saved'}</p>
                  <p className="text-sm text-[#d0d0d0] mt-3">{user.bio || 'No bio available.'}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
                <DetailStat label="Watched" value={String(user.watchedCount || 0)} />
                <DetailStat label="Watchlist" value={String(user.watchlistCount || 0)} />
                <DetailStat label="Total Saved" value={String(user.totalSavedItems || 0)} />
                <DetailStat label="Joined" value={user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'Unknown'} />
              </div>

              <div className="mt-6">
                <p className="text-xs uppercase tracking-[0.2em] text-[#8f44f0] mb-3">Collections</p>
                <div className="flex flex-wrap gap-2">
                  {(user.collections || []).length ? (
                    user.collections.map((collection) => (
                      <span
                        key={`${user._id}-${collection.name}`}
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

