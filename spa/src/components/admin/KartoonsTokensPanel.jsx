import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../api/client.js';
import { toast } from '../../utils/toast.js';

const KEY = ['adminKartoonsTokens'];

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

export function KartoonsTokensPanel() {
  const queryClient = useQueryClient();
  const [access, setAccess] = useState('');
  const [refresh, setRefresh] = useState('');

  const { data, isPending, isError, error } = useQuery({
    queryKey: KEY,
    queryFn: () => apiFetch('/api/admin/kartoons-tokens'),
    refetchInterval: 60_000
  });

  const saveMutation = useMutation({
    mutationFn: () => apiFetch('/api/admin/kartoons-tokens', {
      method: 'PUT',
      body: JSON.stringify({ access_token: access.trim(), refresh_token: refresh.trim() })
    }),
    onSuccess: (view) => {
      queryClient.setQueryData(KEY, view);
      setAccess('');
      setRefresh('');
      toast('Kartoons tokens saved');
    },
    onError: (err) => toast(err.message, 'error')
  });

  const refreshMutation = useMutation({
    mutationFn: () => apiFetch('/api/admin/kartoons-tokens/refresh', { method: 'POST' }),
    onSuccess: (view) => {
      queryClient.setQueryData(KEY, view);
      toast(view.last_error ? `Refresh failed: ${view.last_error}` : 'Kartoons tokens refreshed', view.last_error ? 'error' : 'success');
    },
    onError: (err) => toast(err.message, 'error')
  });

  if (isPending) return <div className="app-loading">Loading Kartoons tokens...</div>;
  if (isError) return <div className="app-error">Could not load Kartoons tokens ({error?.message})</div>;

  const warn = data.needs_action;
  const inputClass = 'rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white';

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 space-y-5">
      <div>
        <p className="text-sm font-medium text-white">Kartoons account tokens</p>
        <p className={`text-sm mt-1 ${warn ? 'text-yellow-400' : 'text-[#9f9f9f]'}`}>{data.message}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="admin-stat-card rounded-2xl p-4">
          <p className="text-xs text-[#9f9f9f]">Access token expires</p>
          <p className="text-white mt-1">{formatDate(data.access_expires_at)}</p>
        </div>
        <div className="admin-stat-card rounded-2xl p-4">
          <p className="text-xs text-[#9f9f9f]">Refresh token expires</p>
          <p className="text-white mt-1">{formatDate(data.refresh_expires_at)}</p>
        </div>
        <div className="admin-stat-card rounded-2xl p-4">
          <p className="text-xs text-[#9f9f9f]">Days left</p>
          <p className="text-white mt-1">{data.access_expires_at ? data.days_left.toFixed(1) : '—'}</p>
        </div>
        <div className="admin-stat-card rounded-2xl p-4">
          <p className="text-xs text-[#9f9f9f]">Last refreshed</p>
          <p className="text-white mt-1">{formatDate(data.last_refreshed_at)}</p>
        </div>
      </div>

      <div className="text-xs text-[#9f9f9f] space-y-1">
        <p>Current access token: <span className="font-mono text-white">{data.access_token_masked || 'not set'}</span></p>
        <p>Current refresh token: <span className="font-mono text-white">{data.refresh_token_masked || 'not set'}</span></p>
        <p>Last checked: {formatDate(data.last_checked_at)}</p>
        {data.last_error && <p className="text-red-400">Last error: {data.last_error}</p>}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-2 text-sm text-[#b7b7b7]">
          <span>New access token (leave empty to keep current)</span>
          <input type="password" autoComplete="off" value={access} onChange={(e) => setAccess(e.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-col gap-2 text-sm text-[#b7b7b7]">
          <span>New refresh token (leave empty to keep current)</span>
          <input type="password" autoComplete="off" value={refresh} onChange={(e) => setRefresh(e.target.value)} className={inputClass} />
        </label>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm font-medium text-white hover:bg-white/[0.12] disabled:opacity-60"
          disabled={saveMutation.isPending || (!access.trim() && !refresh.trim())}
          onClick={() => saveMutation.mutate()}
        >
          {saveMutation.isPending ? 'Saving...' : 'Save tokens'}
        </button>
        <button
          type="button"
          className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm font-medium text-white hover:bg-white/[0.12] disabled:opacity-60"
          disabled={refreshMutation.isPending}
          onClick={() => refreshMutation.mutate()}
        >
          {refreshMutation.isPending ? 'Refreshing...' : 'Refresh now'}
        </button>
      </div>
      <p className="text-xs text-[#7f7f7f]">
        Kartoons may ask for a browser verification on refresh. If that happens, log in on kartoons.me and paste the new tokens here.
      </p>
    </section>
  );
}
