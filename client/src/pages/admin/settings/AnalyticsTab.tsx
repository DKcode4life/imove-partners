import { useEffect, useMemo, useState } from 'react';
import {
  Users, LogIn, MousePointerClick, TrendingUp, ChevronLeft,
  Mail, Phone, Calendar, Clock, RefreshCw, ExternalLink,
} from 'lucide-react';
import api from '../../../lib/api';

// ── Types ────────────────────────────────────────────────────────────────────

interface Overview {
  totalPartners: number;
  activePartners: number;
  loginsToday: number;
  loginsThisWeek: number;
  pageViewsToday: number;
  pageViewsThisWeek: number;
  uniqueActiveToday: number;
  uniqueActiveThisWeek: number;
  dailyLogins: { date: string; count: number }[];
}

interface PartnerRow {
  id: number;
  agency_name: string;
  active: boolean;
  phone: string | null;
  created_at: string;
  user: { id: number; name: string; email: string; avatar: string | null; created_at: string };
  total_logins: number;
  total_page_views: number;
  last_seen: string | null;
}

interface PartnerDetail {
  partner: PartnerRow;
  range_days: number;
  total_logins: number;
  total_page_views: number;
  last_seen: string | null;
  daily: { date: string; logins: number; pageViews: number }[];
  top_pages: { path: string; count: number }[];
  recent_events: {
    id: number;
    event_type: string;
    path: string | null;
    created_at: string;
    ip_address: string | null;
  }[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtRelative(d: string | null) {
  if (!d) return 'Never';
  const ms = Date.now() - new Date(d).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1)   return 'Just now';
  if (min < 60)  return `${min} min ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24)  return `${hrs} hr ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7)  return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtDateTime(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function prettyPath(p: string | null) {
  if (!p) return '—';
  if (p === '/partner/dashboard')      return 'Dashboard';
  if (p === '/partner/leads')          return 'Leads list';
  if (p === '/partner/leads/new')      return 'Submit new lead';
  if (p.startsWith('/partner/leads/')) return `Lead detail (#${p.split('/').pop()})`;
  if (p === '/partner/commissions')    return 'Commissions';
  if (p === '/partner/settings')       return 'Settings';
  return p;
}

// ── Mini bar chart (no external deps) ────────────────────────────────────────

function BarChart({ data, height = 80 }: { data: { date: string; count: number }[]; height?: number }) {
  const max = Math.max(1, ...data.map(d => d.count));
  return (
    <div className="flex items-end gap-0.5" style={{ height }}>
      {data.map((d, i) => {
        const h = (d.count / max) * height;
        return (
          <div
            key={i}
            className="flex-1 bg-blue-100 hover:bg-blue-300 rounded-t-sm transition-colors relative group"
            style={{ height: Math.max(2, h) }}
            title={`${d.date}: ${d.count}`}
          >
            {d.count > 0 && (
              <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] text-slate-500 opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none">
                {d.count}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, sub }: {
  icon: React.ReactNode; label: string; value: number | string; sub?: string;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex items-center gap-2 text-slate-500 text-xs font-medium mb-1.5">
        {icon}
        <span>{label}</span>
      </div>
      <p className="text-2xl font-bold text-slate-900 leading-none">{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-1.5">{sub}</p>}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function AnalyticsTab({ showToast }: { showToast: (msg: string, type?: 'success' | 'error') => void }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [partners, setPartners] = useState<PartnerRow[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<PartnerDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<'last_seen' | 'logins' | 'page_views' | 'name'>('last_seen');

  const load = async () => {
    try {
      const [ov, ps] = await Promise.all([
        api.get('/analytics/overview'),
        api.get('/analytics/partners'),
      ]);
      setOverview(ov.data);
      setPartners(ps.data);
    } catch {
      showToast('Failed to load analytics', 'error');
    }
  };

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (selectedId == null) { setDetail(null); return; }
    setDetailLoading(true);
    api.get(`/analytics/partners/${selectedId}?days=30`)
      .then(r => setDetail(r.data))
      .catch(() => showToast('Failed to load partner detail', 'error'))
      .finally(() => setDetailLoading(false));
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRefresh = async () => {
    setRefreshing(true);
    await load();
    if (selectedId != null) {
      try {
        const r = await api.get(`/analytics/partners/${selectedId}?days=30`);
        setDetail(r.data);
      } catch {}
    }
    setRefreshing(false);
  };

  const filtered = useMemo(() => {
    let rows = [...partners];
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(r =>
        r.agency_name.toLowerCase().includes(q) ||
        r.user.name.toLowerCase().includes(q) ||
        r.user.email.toLowerCase().includes(q),
      );
    }
    rows.sort((a, b) => {
      if (sortKey === 'name')        return a.agency_name.localeCompare(b.agency_name);
      if (sortKey === 'logins')      return b.total_logins - a.total_logins;
      if (sortKey === 'page_views')  return b.total_page_views - a.total_page_views;
      // last_seen — most recent first; nulls last
      const at = a.last_seen ? new Date(a.last_seen).getTime() : 0;
      const bt = b.last_seen ? new Date(b.last_seen).getTime() : 0;
      return bt - at;
    });
    return rows;
  }, [partners, search, sortKey]);

  if (loading) {
    return (
      <div className="py-20 text-center text-slate-400 text-sm">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        Loading analytics…
      </div>
    );
  }

  // ── Partner detail view ────────────────────────────────────────────────────
  if (selectedId != null) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setSelectedId(null)}
            className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700"
          >
            <ChevronLeft className="w-4 h-4" /> Back to partners
          </button>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>

        {detailLoading || !detail ? (
          <div className="py-20 text-center text-slate-400 text-sm">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            Loading…
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">{detail.partner.agency_name}</h2>
                  <p className="text-sm text-slate-500 mt-0.5">{detail.partner.user.name}</p>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-sm text-slate-600">
                    <span className="flex items-center gap-1.5"><Mail className="w-3.5 h-3.5 text-slate-400" /> {detail.partner.user.email}</span>
                    {detail.partner.phone && (
                      <span className="flex items-center gap-1.5"><Phone className="w-3.5 h-3.5 text-slate-400" /> {detail.partner.phone}</span>
                    )}
                    <span className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5 text-slate-400" /> Joined {new Date(detail.partner.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                  </div>
                </div>
                <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${detail.partner.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                  {detail.partner.active ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard icon={<LogIn className="w-3.5 h-3.5" />} label={`Logins (${detail.range_days}d)`} value={detail.total_logins} />
              <StatCard icon={<MousePointerClick className="w-3.5 h-3.5" />} label={`Page views (${detail.range_days}d)`} value={detail.total_page_views} />
              <StatCard icon={<Clock className="w-3.5 h-3.5" />} label="Last seen" value={fmtRelative(detail.last_seen)} sub={fmtDateTime(detail.last_seen)} />
              <StatCard icon={<TrendingUp className="w-3.5 h-3.5" />} label="Avg / day" value={(detail.total_logins / Math.max(1, detail.range_days)).toFixed(1)} sub="logins per day" />
            </div>

            {/* Daily chart */}
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-slate-900">Activity — last {detail.range_days} days</h3>
                <div className="flex items-center gap-3 text-xs text-slate-500">
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-blue-300" /> Logins</span>
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-300" /> Page views</span>
                </div>
              </div>
              <div className="flex items-end gap-0.5" style={{ height: 100 }}>
                {detail.daily.map((d, i) => {
                  const max = Math.max(1, ...detail.daily.map(x => Math.max(x.logins, x.pageViews / 3)));
                  const lH = (d.logins / max) * 100;
                  const pH = (d.pageViews / 3 / max) * 100;
                  return (
                    <div key={i} className="flex-1 flex items-end gap-px group relative" title={`${d.date} — ${d.logins} login(s), ${d.pageViews} page view(s)`}>
                      <div className="flex-1 bg-blue-300 rounded-t-sm" style={{ height: Math.max(d.logins ? 2 : 0, lH) }} />
                      <div className="flex-1 bg-emerald-300 rounded-t-sm" style={{ height: Math.max(d.pageViews ? 2 : 0, pH) }} />
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between text-[10px] text-slate-400 mt-2">
                <span>{detail.daily[0]?.date}</span>
                <span>{detail.daily[detail.daily.length - 1]?.date}</span>
              </div>
            </div>

            {/* Top pages + recent events */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-white border border-slate-200 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-slate-900 mb-3">Top pages</h3>
                {detail.top_pages.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">No page views in this period.</p>
                ) : (
                  <div className="space-y-2">
                    {detail.top_pages.map(p => {
                      const max = detail.top_pages[0].count;
                      const pct = (p.count / max) * 100;
                      return (
                        <div key={p.path}>
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="text-sm text-slate-700 truncate flex-1 mr-2">{prettyPath(p.path)}</span>
                            <span className="text-xs text-slate-500 font-medium flex-shrink-0">{p.count}</span>
                          </div>
                          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div className="h-full bg-blue-400 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-slate-900 mb-3">Recent activity</h3>
                {detail.recent_events.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">No activity recorded.</p>
                ) : (
                  <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                    {detail.recent_events.map(e => (
                      <div key={e.id} className="flex items-start gap-2 text-sm">
                        <span className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${e.event_type === 'login' ? 'bg-blue-500' : 'bg-emerald-500'}`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-slate-700 truncate">
                            {e.event_type === 'login' ? 'Logged in' : `Viewed ${prettyPath(e.path)}`}
                          </p>
                          <p className="text-xs text-slate-400">{fmtDateTime(e.created_at)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  // ── Overview + partner list ────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Top action bar */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Partner Portal Analytics</h2>
          <p className="text-xs text-slate-500 mt-0.5">Track how partners and estate agents use their portal.</p>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {/* Stat cards */}
      {overview && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            icon={<Users className="w-3.5 h-3.5" />}
            label="Active partners"
            value={overview.activePartners}
            sub={`${overview.totalPartners} total`}
          />
          <StatCard
            icon={<LogIn className="w-3.5 h-3.5" />}
            label="Logins today"
            value={overview.loginsToday}
            sub={`${overview.uniqueActiveToday} unique partner${overview.uniqueActiveToday === 1 ? '' : 's'}`}
          />
          <StatCard
            icon={<MousePointerClick className="w-3.5 h-3.5" />}
            label="Page views today"
            value={overview.pageViewsToday}
            sub={`${overview.pageViewsThisWeek} this week`}
          />
          <StatCard
            icon={<TrendingUp className="w-3.5 h-3.5" />}
            label="Active this week"
            value={overview.uniqueActiveThisWeek}
            sub={`${overview.loginsThisWeek} logins`}
          />
        </div>
      )}

      {/* Daily logins chart */}
      {overview && (
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-900">Logins — last 30 days</h3>
            <span className="text-xs text-slate-500">{overview.dailyLogins.reduce((s, d) => s + d.count, 0)} total</span>
          </div>
          <BarChart data={overview.dailyLogins} />
          <div className="flex justify-between text-[10px] text-slate-400 mt-2">
            <span>{overview.dailyLogins[0]?.date}</span>
            <span>{overview.dailyLogins[overview.dailyLogins.length - 1]?.date}</span>
          </div>
        </div>
      )}

      {/* Partners table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-4 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-900">Partner accounts ({filtered.length})</h3>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search agency or email…"
              className="input text-sm py-1.5 w-56"
            />
            <select
              value={sortKey}
              onChange={e => setSortKey(e.target.value as typeof sortKey)}
              className="input text-sm py-1.5"
            >
              <option value="last_seen">Sort: Last seen</option>
              <option value="logins">Sort: Most logins</option>
              <option value="page_views">Sort: Most views</option>
              <option value="name">Sort: Name</option>
            </select>
          </div>
        </div>
        {filtered.length === 0 ? (
          <p className="text-sm text-slate-400 italic text-center py-12">No partners match your search.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium">Agency</th>
                  <th className="text-left px-4 py-2.5 font-medium">Contact</th>
                  <th className="text-left px-4 py-2.5 font-medium">Status</th>
                  <th className="text-right px-4 py-2.5 font-medium">Logins</th>
                  <th className="text-right px-4 py-2.5 font-medium">Page views</th>
                  <th className="text-left px-4 py-2.5 font-medium">Last seen</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map(p => (
                  <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{p.agency_name}</p>
                      <p className="text-xs text-slate-500">{p.user.name}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-600 text-xs">
                      <p>{p.user.email}</p>
                      {p.phone && <p className="text-slate-400">{p.phone}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${p.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                        {p.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-slate-700">{p.total_logins}</td>
                    <td className="px-4 py-3 text-right font-medium text-slate-700">{p.total_page_views}</td>
                    <td className="px-4 py-3 text-slate-600 text-xs">{fmtRelative(p.last_seen)}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setSelectedId(p.id)}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700"
                      >
                        View <ExternalLink className="w-3 h-3" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
