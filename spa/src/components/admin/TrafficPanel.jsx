import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../api/client.js';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell
} from 'recharts';

const COLORS = ['#8f44f0', '#00C49F', '#FFBB28', '#FF8042', '#a6a6a6'];

export function TrafficPanel() {
  const [ipFilter, setIpFilter] = useState('');

  const { data: trafficData, isPending, isError, error } = useQuery({
    queryKey: ['adminTraffic', ipFilter],
    queryFn: () => {
      const url = ipFilter ? `/api/admin/trafficLogs/stats?ip=${encodeURIComponent(ipFilter)}` : '/api/admin/trafficLogs/stats';
      return apiFetch(url);
    },
    refetchInterval: 30000 // Refresh every 30s
  });

  if (isPending) {
    return <div className="app-loading py-12">Loading traffic data...</div>;
  }

  if (isError) {
    return <div className="app-error py-12">Error loading traffic data: {error.message}</div>;
  }

  const { timeSeries = [], requestTypes = [], locations = [], totalRequests = 0 } = trafficData || {};

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="admin-stat-card rounded-2xl p-5 col-span-1 md:col-span-1">
          <p className="text-sm text-[#9f9f9f]">Total Requests (30d)</p>
          <p className="text-3xl font-semibold text-white mt-2">{totalRequests}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="rounded-[24px] border border-white/10 bg-white/[0.02] p-6">
          <h3 className="text-lg font-medium text-white mb-6">Traffic Over Time</h3>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={timeSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                <XAxis dataKey="time" stroke="#a6a6a6" fontSize={12} tickMargin={10} />
                <YAxis stroke="#a6a6a6" fontSize={12} />
                <RechartsTooltip 
                  contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}
                  itemStyle={{ color: '#fff' }}
                />
                <Line type="monotone" dataKey="count" stroke="#8f44f0" strokeWidth={3} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-[24px] border border-white/10 bg-white/[0.02] p-6">
          <h3 className="text-lg font-medium text-white mb-6">Request Types</h3>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={requestTypes}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={5}
                  dataKey="count"
                  nameKey="type"
                >
                  {requestTypes.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <RechartsTooltip 
                  contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}
                  itemStyle={{ color: '#fff' }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap justify-center gap-4 mt-4">
              {requestTypes.map((entry, index) => (
                <div key={entry.type} className="flex items-center gap-2 text-sm text-[#a6a6a6]">
                  <span className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }}></span>
                  {entry.type} ({entry.count})
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-[24px] border border-white/10 bg-white/[0.02] p-6 xl:col-span-2">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <h3 className="text-lg font-medium text-white">Top Locations & IPs</h3>
            <input
              type="text"
              placeholder="Filter by IP address..."
              value={ipFilter}
              onChange={(e) => setIpFilter(e.target.value)}
              className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-white w-full sm:w-64"
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-[#e2e2e2]">
              <thead className="text-xs uppercase tracking-[0.1em] text-[#8f44f0] border-b border-white/10">
                <tr>
                  <th className="pb-3 font-medium">Location</th>
                  <th className="pb-3 font-medium">IP Address</th>
                  <th className="pb-3 font-medium">User(s)</th>
                  <th className="pb-3 font-medium">Requests</th>
                  <th className="pb-3 font-medium">Last Active</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {locations.length > 0 ? (
                  locations.map((loc, idx) => (
                    <tr key={idx}>
                      <td className="py-4">{loc.country ? `${loc.city || 'Unknown'}, ${loc.country}` : 'Unknown'}</td>
                      <td className="py-4">{loc.ip}</td>
                      <td className="py-4">
                        {loc.users && loc.users.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {loc.users.map(u => (
                              <span key={u} className="px-2 py-0.5 bg-[#8f44f0]/20 text-[#8f44f0] rounded-md text-xs">{u}</span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-white/30 text-xs italic">Guest</span>
                        )}
                      </td>
                      <td className="py-4 font-medium text-white">{loc.count}</td>
                      <td className="py-4 text-[#a6a6a6]">{new Date(loc.lastActive).toLocaleString()}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="5" className="py-8 text-center text-[#a6a6a6]">No location data available yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
