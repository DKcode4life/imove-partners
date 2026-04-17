import { useEffect, useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ClipboardList, CheckCircle, PoundSterling, Clock, Plus, ArrowRight,
  TrendingUp, Search, ArrowUpRight, FileText, Users, Award,
} from 'lucide-react';
import Layout from '../../components/Layout';
import StatusBadge from '../../components/StatusBadge';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../lib/api';
import type { Lead } from '../../types';
import { LEAD_STATUSES } from '../../types';

/* ─── Formatters ────────────────────────────────────────────────────────────── */
function fmt(n: number) {
  return `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function pct(n: number, d: number) { return d === 0 ? 0 : Math.round((n / d) * 100); }
function getTimeOfDay() {
  const h = new Date().getHours();
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}
function estComm(l: Lead): number | null {
  if (l.estimated_commission != null) return l.estimated_commission;
  return l.quote_value != null ? +(l.quote_value * l.commission_rate / 100).toFixed(2) : null;
}

/* ─── Status palette (hex matches StatusBadge colours) ─────────────────────── */
const STATUS_HEX: Record<string, string> = {
  'New Lead':        '#3B82F6',
  'Contacted':       '#8B5CF6',
  'Survey Booked':   '#EC4899',
  'Quoted':          '#F59E0B',
  'Quote Declined':  '#EF4444',
  'Quote Accepted':  '#F97316',
  'Job Completed':   '#10B981',
  'Commission Paid': '#22C55E',
};
const STATUS_BG: Record<string, string> = {
  'New Lead':'bg-blue-500','Contacted':'bg-violet-500','Survey Booked':'bg-pink-500',
  'Quoted':'bg-amber-500','Quote Declined':'bg-red-500','Quote Accepted':'bg-orange-500',
  'Job Completed':'bg-emerald-500','Commission Paid':'bg-green-500',
};

/* ─── Pipeline sets ─────────────────────────────────────────────────────────── */
const CONTACTED_PLUS = new Set(['Contacted','Survey Booked','Quoted','Quote Declined','Quote Accepted','Job Completed','Commission Paid']);
const SURVEY_PLUS    = new Set(['Survey Booked','Quoted','Quote Declined','Quote Accepted','Job Completed','Commission Paid']);
const QUOTED_PLUS    = new Set(['Quoted','Quote Declined','Quote Accepted','Job Completed','Commission Paid']);
const BOOKED_PLUS    = new Set(['Quote Accepted','Job Completed','Commission Paid']);
const COMPLETED_SET  = new Set(['Job Completed','Commission Paid']);

/* ─── Period filter ─────────────────────────────────────────────────────────── */
type Period = '30d' | '90d' | 'year' | 'all';
const PERIODS: { key: Period; label: string }[] = [
  { key: '30d',  label: 'Last 30 days' },
  { key: '90d',  label: 'Last 90 days' },
  { key: 'year', label: 'This year'    },
  { key: 'all',  label: 'All time'     },
];
function cutoffDate(p: Period): Date | null {
  if (p === 'all') return null;
  const d = new Date();
  if (p === '30d')  d.setDate(d.getDate() - 30);
  if (p === '90d')  d.setDate(d.getDate() - 90);
  if (p === 'year') d.setMonth(d.getMonth() - 12);
  return d;
}

/* ─── Monthly helpers ───────────────────────────────────────────────────────── */
function monthKey(s: string) {
  const d = new Date(s);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function getLast6Months(): { key: string; label: string }[] {
  const now = new Date();
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    return {
      key:   `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleDateString('en-GB', { month: 'short' }),
    };
  });
}

/* ─── SVG: Donut chart ──────────────────────────────────────────────────────── */
function DonutChart({ segs }: { segs: { hex: string; p: number }[] }) {
  const r = 38; const C = 2 * Math.PI * r; const GAP = 2.5;
  let cum = 0;
  const valid = segs.filter(s => s.p > 0);
  return (
    <svg viewBox="0 0 100 100" className="w-full h-full" style={{ transform: 'rotate(-90deg)' }}>
      <circle cx="50" cy="50" r={r} fill="none" stroke="#F1F5F9" strokeWidth="10" />
      {valid.map((s, i) => {
        const len = (s.p / 100) * C;
        const off = -cum;
        cum += len + GAP;
        return <circle key={i} cx="50" cy="50" r={r} fill="none"
          stroke={s.hex} strokeWidth="10"
          strokeDasharray={`${len} ${C}`} strokeDashoffset={off} />;
      })}
    </svg>
  );
}

/* ─── SVG: Arc gauge ────────────────────────────────────────────────────────── */
function ArcGauge({ value, total, hex }: { value: number; total: number; hex: string }) {
  const arcLen = Math.PI * 84; // π × r where r=84 (path goes M 16 94 A 84 84 0 0 1 184 94)
  const filled = total > 0 ? Math.min((value / total) * arcLen, arcLen) : 0;
  return (
    <svg viewBox="0 0 200 106" className="w-full">
      <path d="M 16 96 A 84 84 0 0 1 184 96"
        fill="none" stroke="#F1F5F9" strokeWidth="14" strokeLinecap="round" />
      <path d="M 16 96 A 84 84 0 0 1 184 96"
        fill="none" stroke={hex} strokeWidth="14" strokeLinecap="round"
        strokeDasharray={`${filled} ${arcLen}`} />
    </svg>
  );
}

/* ─── CSS: Monthly bar chart ────────────────────────────────────────────────── */
function MonthBars({ months, a, b, colorA, colorB, labelA, labelB }: {
  months: { key: string; label: string }[];
  a: Record<string, number>; b: Record<string, number>;
  colorA: string; colorB: string; labelA: string; labelB: string;
}) {
  const maxVal = Math.max(...months.flatMap(m => [a[m.key] ?? 0, b[m.key] ?? 0]), 1);
  return (
    <>
      <div className="flex items-end gap-2" style={{ height: 96 }}>
        {months.map(m => {
          const va = a[m.key] ?? 0; const vb = b[m.key] ?? 0;
          return (
            <div key={m.key} className="flex-1 flex flex-col items-center gap-0.5">
              <div className="w-full flex items-end gap-0.5">
                <div className="flex-1 rounded-t-sm transition-all" style={{ height: Math.max((va / maxVal) * 88, va > 0 ? 3 : 0), background: colorA }} />
                <div className="flex-1 rounded-t-sm transition-all" style={{ height: Math.max((vb / maxVal) * 88, vb > 0 ? 3 : 0), background: colorB }} />
              </div>
              <span className="text-[9px] text-slate-400">{m.label}</span>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-4 mt-3">
        <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
          <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: colorA }} />{labelA}
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
          <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: colorB }} />{labelB}
        </span>
      </div>
    </>
  );
}

/* ─── Card shell ────────────────────────────────────────────────────────────── */
function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-2xl border border-slate-100 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

/* ─── KPI card ──────────────────────────────────────────────────────────────── */
function KpiCard({ label, value, sub, icon, iconBg, iconColor, highlight }: {
  label: string; value: string | number; sub: string;
  icon: React.ReactNode; iconBg: string; iconColor: string; highlight?: boolean;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between mb-3">
        <span className="text-xs font-medium text-slate-400">{label}</span>
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${iconBg} ${iconColor}`}>
          {icon}
        </div>
      </div>
      <p className={`font-bold leading-none mb-1.5 ${highlight ? 'text-3xl' : 'text-2xl'} text-slate-900`}>{value}</p>
      <p className="text-xs text-slate-400">{sub}</p>
    </Card>
  );
}

/* ─── Page ──────────────────────────────────────────────────────────────────── */
export default function PartnerDashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [leads, setLeads]   = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod]  = useState<Period>('all');
  const [search, setSearch]  = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    api.get('/leads').then(r => setLeads(r.data)).finally(() => setLoading(false));
  }, []);

  /* Period-filtered leads for KPIs */
  const filteredLeads = useMemo(() => {
    const cutoff = cutoffDate(period);
    if (!cutoff) return leads;
    return leads.filter(l => new Date(l.created_at) >= cutoff);
  }, [leads, period]);

  /* KPI computations */
  const kpis = useMemo(() => {
    const total     = filteredLeads.length;
    const contacted = filteredLeads.filter(l => CONTACTED_PLUS.has(l.status)).length;
    const surveyed  = filteredLeads.filter(l => SURVEY_PLUS.has(l.status)).length;
    const quoted    = filteredLeads.filter(l => QUOTED_PLUS.has(l.status)).length;
    const booked    = filteredLeads.filter(l => BOOKED_PLUS.has(l.status)).length;
    const completed = filteredLeads.filter(l => COMPLETED_SET.has(l.status)).length;
    const declined  = filteredLeads.filter(l => l.status === 'Quote Declined').length;

    const commEarned  = filteredLeads.filter(l => l.commission_paid).reduce((s, l) => s + (estComm(l) ?? 0), 0);
    const commPending = filteredLeads.filter(l => !l.commission_paid && COMPLETED_SET.has(l.status)).reduce((s, l) => s + (estComm(l) ?? 0), 0);
    const commPipeline= filteredLeads.filter(l => QUOTED_PLUS.has(l.status) && !COMPLETED_SET.has(l.status) && !l.commission_paid).reduce((s, l) => s + (estComm(l) ?? 0), 0);
    const commTotal   = commEarned + commPending + commPipeline;

    const convRate  = pct(completed, total);
    const quoteRate = pct(quoted, total);
    const bookRate  = pct(booked, total);

    return { total, contacted, surveyed, quoted, booked, completed, declined, commEarned, commPending, commPipeline, commTotal, convRate, quoteRate, bookRate };
  }, [filteredLeads]);

  /* Status breakdown for donut */
  const donutSegs = useMemo(() => {
    const map: Record<string, number> = {};
    for (const l of filteredLeads) map[l.status] = (map[l.status] ?? 0) + 1;
    return LEAD_STATUSES.map(s => ({ status: s, hex: STATUS_HEX[s] ?? '#94A3B8', count: map[s] ?? 0, p: pct(map[s] ?? 0, kpis.total || 1) })).filter(s => s.count > 0);
  }, [filteredLeads, kpis.total]);

  /* Monthly chart data (always last 6 months of ALL leads) */
  const months = useMemo(() => getLast6Months(), []);
  const monthlyData = useMemo(() => {
    const submitted: Record<string, number> = {};
    const completed_m: Record<string, number> = {};
    const commission_m: Record<string, number> = {};
    for (const m of months) { submitted[m.key] = 0; completed_m[m.key] = 0; commission_m[m.key] = 0; }
    for (const l of leads) {
      const mk = monthKey(l.created_at);
      if (mk in submitted) submitted[mk]++;
      if (COMPLETED_SET.has(l.status)) {
        const mk2 = monthKey(l.updated_at);
        if (mk2 in completed_m) completed_m[mk2]++;
      }
      if (l.commission_paid) {
        const mk3 = monthKey(l.commission_paid_at || l.updated_at);
        if (mk3 in commission_m) commission_m[mk3] += estComm(l) ?? 0;
      }
    }
    return { submitted, completed: completed_m, commission: commission_m };
  }, [leads, months]);

  /* Table leads */
  const tableLeads = useMemo(() => {
    const q = search.toLowerCase();
    return leads.filter(l => {
      if (statusFilter && l.status !== statusFilter) return false;
      if (q && !l.client_name.toLowerCase().includes(q) && !l.current_address.toLowerCase().includes(q) && !(l.email ?? '').toLowerCase().includes(q)) return false;
      return true;
    }).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [leads, search, statusFilter]);

  /* Funnel stages */
  const funnel = [
    { label: 'Submitted',  count: kpis.total,     hex: '#6366F1' },
    { label: 'Contacted',  count: kpis.contacted,  hex: '#8B5CF6' },
    { label: 'Surveyed',   count: kpis.surveyed,   hex: '#EC4899' },
    { label: 'Quoted',     count: kpis.quoted,     hex: '#F59E0B' },
    { label: 'Booked',     count: kpis.booked,     hex: '#F97316' },
    { label: 'Completed',  count: kpis.completed,  hex: '#10B981' },
  ];

  /* ── Render ── */
  return (
    <Layout>
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-slate-900">
            Good {getTimeOfDay()}, {user?.name?.split(' ')[0]} 👋
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">{user?.agencyName} · Partner Dashboard</p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {/* Period tabs */}
          <div className="flex items-center bg-white border border-slate-200 rounded-xl p-0.5 shadow-sm">
            {PERIODS.map(p => (
              <button key={p.key} onClick={() => setPeriod(p.key)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                  period === p.key
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}>
                {p.label}
              </button>
            ))}
          </div>
          <Link to="/partner/leads/new" className="btn-primary flex-shrink-0">
            <Plus className="w-4 h-4" /> Submit Lead
          </Link>
        </div>
      </div>

      {/* ── Loading ─────────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : leads.length === 0 ? (
        /* ── Empty state ──────────────────────────────────────────────────── */
        <Card className="px-6 py-16 text-center">
          <ClipboardList className="w-12 h-12 text-slate-200 mx-auto mb-4" />
          <h2 className="text-base font-semibold text-slate-700 mb-1">No leads submitted yet</h2>
          <p className="text-sm text-slate-400 max-w-sm mx-auto mb-6">
            Start referring clients to begin tracking conversions and commission. Every lead you submit is followed up personally by our team.
          </p>
          <Link to="/partner/leads/new" className="btn-primary">
            <Plus className="w-4 h-4" /> Submit your first lead
          </Link>
        </Card>
      ) : (
        <>
          {/* ── KPI Row ─────────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-4">
            <KpiCard label="Total Leads" value={kpis.total} sub="All submitted"
              iconBg="bg-indigo-50" iconColor="text-indigo-600"
              icon={<ClipboardList className="w-4 h-4" />} />
            <KpiCard label="Contacted" value={kpis.contacted} sub={`${pct(kpis.contacted, kpis.total)}% of total`}
              iconBg="bg-violet-50" iconColor="text-violet-600"
              icon={<Users className="w-4 h-4" />} />
            <KpiCard label="Quoted" value={kpis.quoted} sub={`${kpis.quoteRate}% quote rate`}
              iconBg="bg-amber-50" iconColor="text-amber-600"
              icon={<FileText className="w-4 h-4" />} />
            <KpiCard label="Jobs Booked" value={kpis.booked} sub={`${kpis.bookRate}% booking rate`}
              iconBg="bg-orange-50" iconColor="text-orange-600"
              icon={<CheckCircle className="w-4 h-4" />} />
            <KpiCard label="Completed" value={kpis.completed} sub={`${kpis.convRate}% conversion`}
              iconBg="bg-emerald-50" iconColor="text-emerald-600"
              icon={<Award className="w-4 h-4" />} />
          </div>

          {/* ── Commission KPI Row ───────────────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <KpiCard label="Commission Earned" value={fmt(kpis.commEarned)} sub="Paid to you"
              iconBg="bg-green-50" iconColor="text-green-600" highlight
              icon={<PoundSterling className="w-4 h-4" />} />
            <KpiCard label="Pending Payment" value={fmt(kpis.commPending)} sub="Job done, awaiting payment"
              iconBg="bg-amber-50" iconColor="text-amber-600"
              icon={<Clock className="w-4 h-4" />} />
            <KpiCard label="In Pipeline" value={fmt(kpis.commPipeline)} sub="From quoted leads"
              iconBg="bg-blue-50" iconColor="text-blue-600"
              icon={<TrendingUp className="w-4 h-4" />} />
            <KpiCard label="Conversion Rate" value={`${kpis.convRate}%`} sub="Leads → completed jobs"
              iconBg="bg-violet-50" iconColor="text-violet-600"
              icon={<TrendingUp className="w-4 h-4" />} />
          </div>

          {/* ── Charts Grid ─────────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">

            {/* Lead Funnel — col-span-2 */}
            <Card className="lg:col-span-2 p-5">
              <p className="text-xs text-slate-400 mb-0.5">{PERIODS.find(p => p.key === period)?.label}</p>
              <p className="text-sm font-bold text-slate-800 mb-5">Lead Pipeline Funnel</p>
              <div className="space-y-3">
                {funnel.map((stage, i) => {
                  const w = pct(stage.count, kpis.total || 1);
                  const prev = i > 0 ? funnel[i - 1].count : stage.count;
                  const drop = i === 0 ? 100 : pct(stage.count, prev || 1);
                  const dropColor = drop >= 70 ? '#10B981' : drop >= 40 ? '#F59E0B' : '#EF4444';
                  return (
                    <div key={stage.label}>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: stage.hex }} />
                          <span className="text-xs font-medium text-slate-700">{stage.label}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          {i > 0 && (
                            <span className="text-[11px] font-semibold" style={{ color: dropColor }}>
                              {drop}% from prev
                            </span>
                          )}
                          <span className="text-xs font-bold text-slate-900 w-5 text-right">{stage.count}</span>
                        </div>
                      </div>
                      <div className="h-6 bg-slate-100 rounded-lg overflow-hidden">
                        <div className="h-full rounded-lg flex items-center transition-all duration-500"
                          style={{ width: `${Math.max(w, stage.count > 0 ? 4 : 0)}%`, background: stage.hex, opacity: 0.85 }}>
                          {w >= 18 && (
                            <span className="text-white text-[11px] font-bold px-2">{w}%</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {kpis.declined > 0 && (
                <p className="text-xs text-slate-400 mt-4 pt-3 border-t border-slate-100">
                  {kpis.declined} lead{kpis.declined !== 1 ? 's' : ''} declined a quote — these are excluded from the funnel above.
                </p>
              )}
            </Card>

            {/* Status Donut — col-span-1 */}
            <Card className="p-5 flex flex-col">
              <p className="text-xs text-slate-400 mb-0.5">{PERIODS.find(p => p.key === period)?.label}</p>
              <p className="text-sm font-bold text-slate-800 mb-4">Lead Status</p>
              <div className="relative w-36 h-36 mx-auto mb-4">
                <DonutChart segs={donutSegs.map(s => ({ hex: s.hex, p: s.p }))} />
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-2xl font-bold text-slate-900">{kpis.total}</span>
                  <span className="text-[11px] text-slate-400">leads</span>
                </div>
              </div>
              <div className="flex-1 space-y-1.5 overflow-y-auto">
                {donutSegs.map(s => (
                  <div key={s.status} className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.hex }} />
                      <span className="text-xs text-slate-500 truncate">{s.status}</span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                      <span className="text-xs font-bold text-slate-700">{s.count}</span>
                      <span className="text-[10px] text-slate-400">({s.p}%)</span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            {/* Monthly Activity — col-span-2 */}
            <Card className="lg:col-span-2 p-5">
              <p className="text-xs text-slate-400 mb-0.5">Last 6 months</p>
              <p className="text-sm font-bold text-slate-800 mb-5">Lead Activity</p>
              <MonthBars
                months={months}
                a={monthlyData.submitted} b={monthlyData.completed}
                colorA="#818CF8" colorB="#34D399"
                labelA="Leads submitted" labelB="Jobs completed"
              />
            </Card>

            {/* Commission Overview — col-span-1 */}
            <Card className="p-5 flex flex-col">
              <p className="text-xs text-slate-400 mb-0.5">Commission overview</p>
              <p className="text-sm font-bold text-slate-800 mb-2">Earnings Breakdown</p>

              {kpis.commTotal === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center py-6 text-center">
                  <PoundSterling className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                  <p className="text-xs text-slate-400 leading-relaxed">Commission data will appear<br />once your leads are quoted.</p>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <ArcGauge value={kpis.commEarned} total={kpis.commTotal} hex="#22C55E" />
                    <div className="absolute inset-0 flex flex-col items-center justify-end pb-1 pointer-events-none">
                      <p className="text-xl font-bold text-slate-900 leading-none">{fmt(kpis.commEarned)}</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">of {fmt(kpis.commTotal)}</p>
                    </div>
                  </div>
                  <div className="mt-3 divide-y divide-slate-50">
                    {[
                      { label: 'Paid out',     value: kpis.commEarned,   dot: 'bg-green-500',   bold: true },
                      { label: 'Pending',      value: kpis.commPending,  dot: 'bg-amber-400' },
                      { label: 'In pipeline',  value: kpis.commPipeline, dot: 'bg-blue-400'  },
                    ].map(item => (
                      <div key={item.label} className="flex items-center justify-between py-2">
                        <div className="flex items-center gap-2">
                          <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${item.dot}`} />
                          <span className="text-xs text-slate-500">{item.label}</span>
                        </div>
                        <span className={`text-xs font-bold ${item.bold ? 'text-green-700' : 'text-slate-800'}`}>{fmt(item.value)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 pt-2 border-t border-slate-100">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] text-slate-400">Collection rate</span>
                      <span className="text-[11px] font-bold text-green-600">{pct(kpis.commEarned, kpis.commTotal)}%</span>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-green-500 rounded-full transition-all duration-700"
                        style={{ width: `${pct(kpis.commEarned, kpis.commTotal)}%` }} />
                    </div>
                  </div>
                </>
              )}
            </Card>
          </div>

          {/* ── Performance Banner ───────────────────────────────────────────── */}
          {kpis.total > 0 && (
            <div className={`rounded-xl px-5 py-3.5 mb-4 flex flex-wrap items-center gap-3 border ${
              kpis.convRate >= 40 ? 'bg-emerald-50 border-emerald-100'
              : kpis.convRate >= 20 ? 'bg-amber-50 border-amber-100'
              : 'bg-violet-50 border-violet-100'
            }`}>
              <ArrowUpRight className={`w-4 h-4 flex-shrink-0 ${
                kpis.convRate >= 40 ? 'text-emerald-600' : kpis.convRate >= 20 ? 'text-amber-600' : 'text-violet-600'
              }`} />
              <p className={`text-sm flex-1 font-medium ${
                kpis.convRate >= 40 ? 'text-emerald-800' : kpis.convRate >= 20 ? 'text-amber-800' : 'text-violet-800'
              }`}>
                <span className="font-bold">{kpis.convRate}% conversion rate</span>
                {kpis.convRate >= 50 ? ' — outstanding! Over half your leads complete.'
                : kpis.convRate >= 30 ? ' — strong performance. Keep submitting to grow your commission.'
                : kpis.convRate >= 10 ? ' — good pipeline building. Every lead gets personally followed up.'
                : ' — your pipeline is active. We follow up every lead you send us.'}
              </p>
              {kpis.commPipeline > 0 && (
                <span className={`text-xs font-semibold flex-shrink-0 ${
                  kpis.convRate >= 40 ? 'text-emerald-700' : 'text-violet-700'
                }`}>
                  {fmt(kpis.commPipeline)} in pipeline
                </span>
              )}
            </div>
          )}

          {/* ── Leads Table ──────────────────────────────────────────────────── */}
          <Card>
            {/* Table header */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-5 py-4 border-b border-slate-100">
              <div className="flex-1">
                <h2 className="text-sm font-bold text-slate-800">My Leads</h2>
                <p className="text-xs text-slate-400 mt-0.5">{tableLeads.length} lead{tableLeads.length !== 1 ? 's' : ''}{statusFilter ? ` · ${statusFilter}` : ''}</p>
              </div>
              <div className="flex items-center gap-2">
                {/* Search */}
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                  <input
                    type="text" value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="Search…"
                    className="pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-violet-400 focus:border-violet-400 w-44"
                  />
                </div>
                {/* Status filter */}
                <select
                  value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                  className="pl-3 pr-8 py-1.5 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-violet-400 focus:border-violet-400 text-slate-600"
                >
                  <option value="">All statuses</option>
                  {LEAD_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <Link to="/partner/leads"
                  className="text-xs font-medium text-violet-600 hover:text-violet-800 flex items-center gap-1 whitespace-nowrap">
                  View all <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>

            {/* Table */}
            {tableLeads.length === 0 ? (
              <div className="py-12 text-center">
                <ClipboardList className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                <p className="text-sm text-slate-500">No leads match your filters</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/60">
                      {[
                        ['Client',       'px-5 py-3 text-left'],
                        ['Status',       'px-4 py-3 text-left'],
                        ['Move',         'px-4 py-3 text-left hidden md:table-cell'],
                        ['Quote',        'px-4 py-3 text-right hidden sm:table-cell'],
                        ['Commission',   'px-4 py-3 text-right hidden lg:table-cell'],
                        ['Submitted',    'px-4 py-3 text-right hidden xl:table-cell'],
                        ['',             'px-4 py-3'],
                      ].map(([h, cls]) => (
                        <th key={h} className={`${cls} text-xs font-semibold text-slate-400 uppercase tracking-wide`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {tableLeads.map(lead => {
                      const comm = estComm(lead);
                      return (
                        <tr key={lead.id}
                          onClick={() => navigate(`/partner/leads/${lead.id}`)}
                          className="cursor-pointer hover:bg-slate-50/70 transition-colors group">
                          {/* Client */}
                          <td className="px-5 py-3.5">
                            <p className="text-sm font-semibold text-slate-900">{lead.client_name}</p>
                            <p className="text-xs text-slate-400 mt-0.5 truncate max-w-[160px]">{lead.current_address}</p>
                          </td>
                          {/* Status */}
                          <td className="px-4 py-3.5">
                            <StatusBadge status={lead.status} size="sm" />
                          </td>
                          {/* Move from → to */}
                          <td className="px-4 py-3.5 hidden md:table-cell">
                            {lead.destination_postcode ? (
                              <p className="text-xs text-slate-500">→ {lead.destination_postcode}</p>
                            ) : (
                              <span className="text-xs text-slate-300">—</span>
                            )}
                          </td>
                          {/* Quote value */}
                          <td className="px-4 py-3.5 text-right hidden sm:table-cell">
                            {lead.quote_value != null ? (
                              <span className="text-sm font-semibold text-slate-800">{fmt(lead.quote_value)}</span>
                            ) : (
                              <span className="text-xs text-slate-300">Pending</span>
                            )}
                          </td>
                          {/* Commission */}
                          <td className="px-4 py-3.5 text-right hidden lg:table-cell">
                            {comm != null ? (
                              <div>
                                <p className={`text-sm font-bold ${lead.commission_paid ? 'text-green-600' : 'text-slate-700'}`}>{fmt(comm)}</p>
                                {lead.commission_paid && <p className="text-[10px] text-green-500 mt-0.5">Paid ✓</p>}
                              </div>
                            ) : (
                              <span className="text-xs text-slate-300">—</span>
                            )}
                          </td>
                          {/* Submitted */}
                          <td className="px-4 py-3.5 text-right hidden xl:table-cell">
                            <span className="text-xs text-slate-400">{fmtDate(lead.created_at)}</span>
                          </td>
                          {/* Arrow */}
                          <td className="px-4 py-3.5">
                            <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-violet-500 transition-colors" />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </Layout>
  );
}
