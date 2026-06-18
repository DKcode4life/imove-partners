import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Search, Plus, ArrowUpDown, Eye, Trash2, CheckCircle, AlertCircle,
  ClipboardList, Download, ChevronUp, ChevronDown,
  TrendingUp, ClipboardCheck, CalendarCheck, Banknote, BarChart3, CalendarDays,
} from 'lucide-react';
import CRMLayout from '../../components/CRMLayout';
import Modal from '../../components/Modal';
import api from '../../lib/api';
import type { CrmJob, CrmStatus, PendingLead } from '../../types';
import { CRM_STATUSES, CRM_BEDROOM_OPTIONS } from '../../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function jobRef(id: number) {
  return `iM${String(id).padStart(4, '0')}`;
}

function fmtDate(d: string | null | undefined) {
  if (!d) return null;
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d; // free-text estimated date (e.g. "End of June")
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function shortAddr(line1: string | null, postcode: string | null) {
  return [line1, postcode].filter(Boolean).join(', ') || null;
}

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, {
  dot: string; bg: string; text: string; border: string; cardBg: string; cardText: string;
}> = {
  'New Lead':          { dot: 'bg-blue-500',    bg: 'bg-blue-50',     text: 'text-blue-700',    border: 'border-blue-200',    cardBg: 'bg-blue-50',    cardText: 'text-blue-700' },
  'Contacted':         { dot: 'bg-violet-500',  bg: 'bg-violet-50',   text: 'text-violet-700',  border: 'border-violet-200',  cardBg: 'bg-violet-50',  cardText: 'text-violet-700' },
  'Survey Booked':     { dot: 'bg-cyan-500',    bg: 'bg-cyan-50',     text: 'text-cyan-700',    border: 'border-cyan-200',    cardBg: 'bg-cyan-50',    cardText: 'text-cyan-700' },
  'Survey Completed':  { dot: 'bg-teal-500',    bg: 'bg-teal-50',     text: 'text-teal-700',    border: 'border-teal-200',    cardBg: 'bg-teal-50',    cardText: 'text-teal-700' },
  'Awaiting Quote':    { dot: 'bg-yellow-500',  bg: 'bg-yellow-50',   text: 'text-yellow-800',  border: 'border-yellow-200',  cardBg: 'bg-yellow-50',  cardText: 'text-yellow-800' },
  'Quote Sent':        { dot: 'bg-amber-500',   bg: 'bg-amber-50',    text: 'text-amber-700',   border: 'border-amber-200',   cardBg: 'bg-amber-50',   cardText: 'text-amber-700' },
  'Quote Accepted':    { dot: 'bg-orange-500',  bg: 'bg-orange-50',   text: 'text-orange-700',  border: 'border-orange-200',  cardBg: 'bg-orange-50',  cardText: 'text-orange-700' },
  'Booked Move':       { dot: 'bg-green-500',   bg: 'bg-green-50',    text: 'text-green-700',   border: 'border-green-200',   cardBg: 'bg-green-50',   cardText: 'text-green-700' },
  'In Progress':       { dot: 'bg-emerald-500', bg: 'bg-emerald-50',  text: 'text-emerald-700', border: 'border-emerald-200', cardBg: 'bg-emerald-50', cardText: 'text-emerald-700' },
  'Completed':         { dot: 'bg-slate-400',   bg: 'bg-slate-100',   text: 'text-slate-600',   border: 'border-slate-200',   cardBg: 'bg-slate-100',  cardText: 'text-slate-600' },
  'Lost / Cancelled':  { dot: 'bg-red-500',     bg: 'bg-red-50',      text: 'text-red-700',     border: 'border-red-200',     cardBg: 'bg-red-50',     cardText: 'text-red-700' },
};

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_CFG[status] ?? STATUS_CFG['Completed'];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold ring-1 ring-inset ring-white/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] ${c.bg} ${c.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ring-2 ring-white/70 ${c.dot}`} />
      {status}
    </span>
  );
}

// ── Performance stats ─────────────────────────────────────────────────────────

const SURVEY_REACHED  = new Set(['Survey Booked','Survey Completed','Awaiting Quote','Quote Sent','Quote Accepted','Booked Move','In Progress','Completed']);
const BOOKED_REACHED  = new Set(['Booked Move','In Progress','Completed']);
const ACTIVE_STATUSES = new Set(['New Lead','Contacted','Survey Booked','Survey Completed','Awaiting Quote','Quote Sent','Quote Accepted','Booked Move','In Progress']);

function calcStats(jobs: CrmJob[]) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);

  const monthJobs = jobs.filter(j => (j.created_at || '').slice(0, 10) >= monthStart);

  // Conversion rates (from this month's jobs)
  const total       = monthJobs.length;
  const surveyed    = monthJobs.filter(j => SURVEY_REACHED.has(j.status)).length;
  const booked      = monthJobs.filter(j => BOOKED_REACHED.has(j.status)).length;
  const surveyRate  = total > 0 ? Math.round((surveyed / total) * 100) : null;
  const bookingRate = total > 0 ? Math.round((booked  / total) * 100) : null;

  // Average job value (all jobs with a quote)
  const quotedJobs = jobs.filter(j => j.quote_amount != null);
  const avgValue   = quotedJobs.length > 0
    ? quotedJobs.reduce((s, j) => s + (j.quote_amount ?? 0), 0) / quotedJobs.length
    : null;

  // Active pipeline value (all active jobs with quotes)
  const pipelineValue = jobs
    .filter(j => ACTIVE_STATUSES.has(j.status) && j.quote_amount != null)
    .reduce((s, j) => s + (j.quote_amount ?? 0), 0);

  // Confirmed moves this month
  const confirmedThisMonth = jobs.filter(
    j => j.confirmed_move_date && j.confirmed_move_date >= monthStart && j.confirmed_move_date <= monthEnd,
  ).length;

  return { total, surveyRate, bookingRate, avgValue, pipelineValue, confirmedThisMonth, monthStart };
}

function fmtMoney(n: number) {
  if (n >= 1000) return `£${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return `£${Math.round(n).toLocaleString('en-GB')}`;
}

interface PerfCardProps {
  label: string; value: string; sub: string;
  icon: React.ReactNode; iconBg: string; iconColor: string;
  accent: string;          // hex colour for the top accent stripe
  highlight?: boolean;
}

function PerfCard({ label, value, sub, icon, iconBg, iconColor, accent, highlight }: PerfCardProps) {
  return (
    <div className={`group relative bg-gradient-to-br from-white via-white to-slate-50/50 rounded-xl border border-slate-200/70 shadow-[0_1px_2px_0_rgba(15,23,42,0.04)] hover:shadow-[0_8px_20px_-6px_rgba(15,23,42,0.14),0_2px_4px_-2px_rgba(15,23,42,0.06)] hover:-translate-y-px transition-all duration-200 p-4 overflow-hidden ${highlight ? 'ring-2 ring-brand-200' : ''}`}>
      {/* Top accent stripe */}
      <div
        className="absolute top-0 left-0 right-0 h-[3px]"
        style={{ background: `linear-gradient(90deg, ${accent}, ${accent}cc 60%, ${accent}55)` }}
      />
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-3 ring-1 ring-inset ring-white/50 shadow-sm bg-gradient-to-br ${iconBg}`}>
        <span className={iconColor}>{icon}</span>
      </div>
      <p className="text-2xl font-bold text-slate-900 leading-none mb-1 tabular-nums tracking-tight">{value}</p>
      <p className="text-xs font-semibold text-slate-700 mb-0.5">{label}</p>
      <p className="text-xs text-slate-400">{sub}</p>
    </div>
  );
}

// ── Sort control ──────────────────────────────────────────────────────────────

type SortKey = 'updated_at' | 'confirmed_move_date' | 'full_name' | 'status' | 'id';

function SortBtn({
  col, label, sortKey, sortDir, onSort,
}: {
  col: SortKey; label: string; sortKey: SortKey; sortDir: 'asc' | 'desc';
  onSort: (k: SortKey) => void;
}) {
  const active = sortKey === col;
  return (
    <button
      type="button"
      onClick={() => onSort(col)}
      className={`flex items-center gap-1 text-xs font-semibold uppercase tracking-wide transition-colors
        ${active ? 'text-brand-600' : 'text-slate-500 hover:text-slate-700'}`}
    >
      {label}
      {active
        ? (sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)
        : <ArrowUpDown className="w-3 h-3 opacity-40" />}
    </button>
  );
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function Toast({ message, type, onDone }: { message: string; type: 'success' | 'error'; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 3500); return () => clearTimeout(t); }, [onDone]);
  return (
    <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-xl text-sm font-medium text-white
      ${type === 'success' ? 'bg-emerald-600' : 'bg-red-600'}`}>
      {type === 'success' ? <CheckCircle className="w-4 h-4 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 flex-shrink-0" />}
      {message}
    </div>
  );
}

// ── New job form ──────────────────────────────────────────────────────────────

interface NewJobForm {
  full_name: string; email: string; phone: string;
  lead_source: string; estate_agent_name: string;
  from_line1: string; from_postcode: string;
  to_line1: string; to_postcode: string;
  bedrooms: string; preferred_move_date: string;
  internal_notes: string; status: string;
}
const EMPTY_FORM: NewJobForm = {
  full_name: '', email: '', phone: '',
  lead_source: 'Direct Enquiry', estate_agent_name: '',
  from_line1: '', from_postcode: '', to_line1: '', to_postcode: '',
  bedrooms: '', preferred_move_date: '', internal_notes: '', status: 'New Lead',
};

// ── Main component ────────────────────────────────────────────────────────────

export default function CRMJobsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [jobs,      setJobs]      = useState<CrmJob[]>([]);
  const [pending,   setPending]   = useState<PendingLead[]>([]);
  const [loading,   setLoading]   = useState(true);

  // Filters — status driven by URL ?status= so sidebar pipeline links still work
  const statusParam = searchParams.get('status') as CrmStatus | null;
  const statusFilter: CrmStatus | 'All' = statusParam ?? 'All';
  const setStatusFilter = (s: CrmStatus | 'All') => {
    setSearchParams(s === 'All' ? {} : { status: s }, { replace: true });
  };
  const [search,    setSearch]    = useState('');
  const [dateFrom,  setDateFrom]  = useState('');
  const [dateTo,    setDateTo]    = useState('');
  const [sortKey,   setSortKey]   = useState<SortKey>('id');
  const [sortDir,   setSortDir]   = useState<'asc' | 'desc'>('desc');

  // Modals
  const [newOpen,      setNewOpen]      = useState(false);
  const [form,         setForm]         = useState<NewJobForm>(EMPTY_FORM);
  const [submitting,   setSubmitting]   = useState(false);
  const [formError,    setFormError]    = useState('');
  const [leadSources,  setLeadSources]  = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<CrmJob | null>(null);
  const [deleting,     setDeleting]     = useState(false);
  const [pendingOpen,  setPendingOpen]  = useState(false);
  const [importing,    setImporting]    = useState<number | null>(null);

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const showToast = (msg: string, type: 'success' | 'error' = 'success') => setToast({ message: msg, type });

  const fetchAll = useCallback(async () => {
    const [jobsRes, pendRes] = await Promise.all([
      api.get('/crm/jobs'),
      api.get('/crm/pending-leads'),
    ]);
    setJobs(jobsRes.data);
    setPending(pendRes.data);
  }, []);

  useEffect(() => { fetchAll().finally(() => setLoading(false)); }, [fetchAll]);

  useEffect(() => {
    api.get('/settings/lead-sources')
      .then(r => setLeadSources(r.data.map((s: { name: string }) => s.name)))
      .catch(() => {});
  }, []);

  // ── Derived ──────────────────────────────────────────────────────────────────

  const filtered = jobs.filter(j => {
    if (statusFilter !== 'All' && j.status !== statusFilter) return false;
    if (dateFrom && j.confirmed_move_date && j.confirmed_move_date < dateFrom) return false;
    if (dateTo   && j.confirmed_move_date && j.confirmed_move_date > dateTo)   return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      j.full_name.toLowerCase().includes(q) ||
      jobRef(j.id).toLowerCase().includes(q) ||
      (j.email || '').toLowerCase().includes(q) ||
      (j.phone || '').includes(q) ||
      (j.from_line1 || '').toLowerCase().includes(q) ||
      (j.from_postcode || '').toLowerCase().includes(q) ||
      (j.to_line1 || '').toLowerCase().includes(q) ||
      (j.to_postcode || '').toLowerCase().includes(q) ||
      (j.estate_agent_name || '').toLowerCase().includes(q)
    );
  });

  const sorted = [...filtered].sort((a, b) => {
    let va: string | number = a[sortKey] ?? '';
    let vb: string | number = b[sortKey] ?? '';
    // Null dates sort to end regardless of direction
    if (!va && sortKey !== 'id' && sortKey !== 'full_name') return 1;
    if (!vb && sortKey !== 'id' && sortKey !== 'full_name') return -1;
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ?  1 : -1;
    return 0;
  });

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const totalJobs = jobs.length;
  const hasFilters = statusFilter !== 'All' || search || dateFrom || dateTo;
  const stats = calcStats(jobs);

  // ── Actions ───────────────────────────────────────────────────────────────────

  const set = (k: keyof NewJobForm) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm(p => ({ ...p, [k]: e.target.value }));

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setSubmitting(true);
    try {
      const res = await api.post('/crm/jobs', form);
      await fetchAll();
      setNewOpen(false);
      showToast('Job created');
      navigate(`/admin/crm/${res.data.id}`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setFormError(msg || 'Failed to create job');
    } finally { setSubmitting(false); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/crm/jobs/${deleteTarget.id}`);
      await fetchAll();
      setDeleteTarget(null);
      showToast('Job deleted');
    } catch { showToast('Failed to delete', 'error'); }
    finally { setDeleting(false); }
  };

  const handleImport = async (leadId: number) => {
    setImporting(leadId);
    try {
      const res = await api.post(`/crm/import/${leadId}`);
      await fetchAll();
      setPendingOpen(false);
      showToast('Lead imported');
      navigate(`/admin/crm/${res.data.id}`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      showToast(msg || 'Import failed', 'error');
    } finally { setImporting(null); }
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <CRMLayout>
      {/* Header */}
      <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="page-title tracking-tight">Jobs</h1>
          <p className="page-subtitle">Manage and track all removals jobs from lead to completion</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {pending.length > 0 && (
            <button className="btn-secondary text-sm relative" onClick={() => setPendingOpen(true)}>
              <Download className="w-4 h-4" /> Import Leads
              <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-brand-600 text-white text-xs rounded-full flex items-center justify-center font-bold">
                {pending.length}
              </span>
            </button>
          )}
          <button className="btn-primary" onClick={() => { setForm({ ...EMPTY_FORM, lead_source: leadSources[0] || '' }); setFormError(''); setNewOpen(true); }}>
            <Plus className="w-4 h-4" /> New Job
          </button>
        </div>
      </div>

      {/* ── Performance stats ────────────────────────────────────────────────── */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Performance</span>
          <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
            {new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <PerfCard
            label="New Jobs"
            value={String(stats.total)}
            sub="created this month"
            icon={<TrendingUp className="w-4.5 h-4.5" />}
            iconBg="from-brand-50 to-brand-100" iconColor="text-brand-600"
            accent="#7c3aed"
            highlight={stats.total > 0}
          />
          <PerfCard
            label="Survey Rate"
            value={stats.surveyRate != null ? `${stats.surveyRate}%` : '—'}
            sub={stats.surveyRate != null ? 'of this month\'s jobs' : 'no jobs yet'}
            icon={<ClipboardCheck className="w-4.5 h-4.5" />}
            iconBg="from-cyan-50 to-cyan-100" iconColor="text-cyan-600"
            accent="#06b6d4"
          />
          <PerfCard
            label="Booking Rate"
            value={stats.bookingRate != null ? `${stats.bookingRate}%` : '—'}
            sub={stats.bookingRate != null ? 'reached booked / in progress' : 'no jobs yet'}
            icon={<CalendarCheck className="w-4.5 h-4.5" />}
            iconBg="from-green-50 to-green-100" iconColor="text-green-600"
            accent="#22c55e"
          />
          <PerfCard
            label="Avg Job Value"
            value={stats.avgValue != null ? fmtMoney(stats.avgValue) : '—'}
            sub="across all quoted jobs"
            icon={<Banknote className="w-4.5 h-4.5" />}
            iconBg="from-amber-50 to-amber-100" iconColor="text-amber-600"
            accent="#f59e0b"
          />
          <PerfCard
            label="Pipeline Value"
            value={stats.pipelineValue > 0 ? fmtMoney(stats.pipelineValue) : '—'}
            sub="active jobs with quotes"
            icon={<BarChart3 className="w-4.5 h-4.5" />}
            iconBg="from-violet-50 to-violet-100" iconColor="text-violet-600"
            accent="#8b5cf6"
          />
          <PerfCard
            label="Confirmed Moves"
            value={String(stats.confirmedThisMonth)}
            sub="move dates set this month"
            icon={<CalendarDays className="w-4.5 h-4.5" />}
            iconBg="from-orange-50 to-orange-100" iconColor="text-orange-600"
            accent="#f97316"
          />
        </div>
      </div>

      {/* ── Filter / search bar ──────────────────────────────────────────────── */}
      <div className="card p-4 mb-5">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input type="text" className="input pl-9" placeholder="Search name, ref, postcode…"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-slate-400 whitespace-nowrap">Move date</label>
            <input type="date" className="input w-36 text-xs" value={dateFrom}
              onChange={e => setDateFrom(e.target.value)} />
            <span className="text-xs text-slate-400">–</span>
            <input type="date" className="input w-36 text-xs" value={dateTo}
              onChange={e => setDateTo(e.target.value)} />
          </div>
          {hasFilters && (
            <button className="btn-secondary text-xs"
              onClick={() => { setSearch(''); setStatusFilter('All'); setDateFrom(''); setDateTo(''); }}>
              Clear filters
            </button>
          )}
          <p className="ml-auto text-xs text-slate-400">
            {sorted.length} job{sorted.length !== 1 ? 's' : ''}{hasFilters ? ` of ${totalJobs}` : ''}
          </p>
        </div>
      </div>

      {/* ── Jobs table ──────────────────────────────────────────────────────── */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-7 h-7 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : sorted.length === 0 ? (
          <div className="py-20 text-center">
            <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <ClipboardList className="w-7 h-7 text-slate-300" />
            </div>
            <p className="text-sm font-medium text-slate-500 mb-1">
              {jobs.length === 0 ? 'No jobs yet' : 'No jobs match your filters'}
            </p>
            <p className="text-xs text-slate-400 mb-4">
              {jobs.length === 0 ? 'Create your first job or import an estate agent lead' : 'Try adjusting your search or clearing filters'}
            </p>
            {jobs.length === 0 && (
              <button className="btn-primary" onClick={() => setNewOpen(true)}>
                <Plus className="w-4 h-4" /> New Job
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px]">
              <thead>
                <tr className="border-b border-slate-200/70 bg-gradient-to-b from-slate-50 to-slate-50/40">
                  <th className="text-left px-5 py-3 w-[100px]">
                    <SortBtn col="id" label="Ref" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  </th>
                  <th className="text-left px-4 py-3">
                    <SortBtn col="full_name" label="Client" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  </th>
                  <th className="text-left px-4 py-3 hidden lg:table-cell">
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Route</span>
                  </th>
                  <th className="text-left px-4 py-3 hidden md:table-cell">
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Bedrooms</span>
                  </th>
                  <th className="text-left px-4 py-3 hidden sm:table-cell">
                    <SortBtn col="confirmed_move_date" label="Move Date" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  </th>
                  <th className="text-left px-4 py-3 hidden xl:table-cell">
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Quote</span>
                  </th>
                  <th className="text-left px-4 py-3">
                    <SortBtn col="status" label="Status" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  </th>
                  <th className="text-left px-4 py-3 hidden xl:table-cell">
                    <SortBtn col="updated_at" label="Updated" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  </th>
                  <th className="w-16 px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100/70">
                {sorted.map(j => {
                  const moveDate = j.confirmed_move_date || j.preferred_move_date;
                  const isConfirmed = !!j.confirmed_move_date;
                  const fromAddr = shortAddr(j.from_line1, j.from_postcode);
                  const toAddr   = shortAddr(j.to_line1, j.to_postcode);
                  return (
                    <tr key={j.id}
                      className="hover:bg-gradient-to-r hover:from-brand-50/40 hover:to-transparent transition-colors group cursor-pointer"
                      onClick={() => navigate(`/admin/crm/${j.id}`)}>

                      {/* Ref */}
                      <td className="px-5 py-3.5">
                        <span className="text-xs font-mono font-semibold text-slate-400 group-hover:text-brand-500 transition-colors tabular-nums">
                          {jobRef(j.id)}
                        </span>
                      </td>

                      {/* Client */}
                      <td className="px-4 py-3.5">
                        <p className="text-sm font-semibold text-slate-900 group-hover:text-brand-700 transition-colors tracking-tight">
                          {j.full_name}
                        </p>
                        <p className="text-xs text-slate-400 mt-0.5 tabular-nums">{j.phone || j.email || '—'}</p>
                      </td>

                      {/* Route */}
                      <td className="px-4 py-3.5 hidden lg:table-cell max-w-[220px]">
                        {fromAddr || toAddr ? (
                          <div className="flex items-center gap-1.5 text-xs text-slate-500">
                            <span className="truncate">{fromAddr || '—'}</span>
                            <span className="text-slate-300 flex-shrink-0">→</span>
                            <span className="truncate">{toAddr || '—'}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-300">—</span>
                        )}
                      </td>

                      {/* Bedrooms */}
                      <td className="px-4 py-3.5 hidden md:table-cell">
                        <span className="text-xs text-slate-500">{j.bedrooms || '—'}</span>
                      </td>

                      {/* Move date */}
                      <td className="px-4 py-3.5 hidden sm:table-cell">
                        {moveDate ? (
                          <>
                            <p className={`text-sm font-semibold tabular-nums ${isConfirmed ? 'text-slate-900' : 'text-slate-500'}`}>
                              {fmtDate(moveDate)}
                            </p>
                            <p className={`text-[10px] font-bold uppercase tracking-wider mt-0.5 ${isConfirmed ? 'text-emerald-600' : 'text-slate-400'}`}>
                              {isConfirmed ? 'Confirmed' : 'Estimated'}
                            </p>
                          </>
                        ) : (
                          <span className="text-xs text-slate-300 italic">Not set</span>
                        )}
                      </td>

                      {/* Quote */}
                      <td className="px-4 py-3.5 hidden xl:table-cell">
                        {j.quote_amount != null ? (
                          <span className="text-sm font-bold text-slate-700 tabular-nums">
                            £{j.quote_amount.toLocaleString('en-GB', { minimumFractionDigits: 0 })}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-300">—</span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3.5">
                        <StatusBadge status={j.status} />
                      </td>

                      {/* Updated */}
                      <td className="px-4 py-3.5 hidden xl:table-cell">
                        <span className="text-xs text-slate-400 tabular-nums">{fmtDate(j.updated_at)}</span>
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3.5" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => navigate(`/admin/crm/${j.id}`)}
                            className="p-1.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-all hover:shadow-sm hover:scale-105 active:scale-95" title="Open">
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => setDeleteTarget(j)}
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all hover:shadow-sm hover:scale-105 active:scale-95" title="Delete">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── New Job Modal ──────────────────────────────────────────────────── */}
      <Modal open={newOpen} onClose={() => setNewOpen(false)} title="New Job" size="lg">
        <form onSubmit={handleCreate} className="space-y-5">
          {formError && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-100 text-red-700 px-4 py-3 rounded-xl text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />{formError}
            </div>
          )}
          <section>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Contact</p>
            <div className="space-y-3">
              <div>
                <label className="label">Full Name <span className="text-red-500">*</span></label>
                <input type="text" className="input" placeholder="e.g. John & Sarah Smith"
                  value={form.full_name} onChange={set('full_name')} required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Phone</label>
                  <input type="tel" className="input" placeholder="07700 900000"
                    value={form.phone} onChange={set('phone')} />
                </div>
                <div>
                  <label className="label">Email</label>
                  <input type="email" className="input" placeholder="client@email.com"
                    value={form.email} onChange={set('email')} />
                </div>
              </div>
            </div>
          </section>
          <section>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Move Details</p>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Moving From</label>
                  <input type="text" className="input" placeholder="Address or area"
                    value={form.from_line1} onChange={set('from_line1')} />
                  <input type="text" className="input mt-1.5" placeholder="Postcode"
                    value={form.from_postcode} onChange={set('from_postcode')} />
                </div>
                <div>
                  <label className="label">Moving To</label>
                  <input type="text" className="input" placeholder="Address or area"
                    value={form.to_line1} onChange={set('to_line1')} />
                  <input type="text" className="input mt-1.5" placeholder="Postcode"
                    value={form.to_postcode} onChange={set('to_postcode')} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Estimated Move Date</label>
                  <input type="text" className="input" placeholder="e.g. End of June, mid-July, or a date" value={form.preferred_move_date} onChange={set('preferred_move_date')} />
                </div>
                <div>
                  <label className="label">Bedrooms / Size</label>
                  <select className="input" value={form.bedrooms} onChange={set('bedrooms')}>
                    <option value="">Select…</option>
                    {CRM_BEDROOM_OPTIONS.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
              </div>
            </div>
          </section>
          <section>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Lead Info</p>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Lead Source</label>
                  <select className="input" value={form.lead_source} onChange={set('lead_source')}>
                    <option value="">Select…</option>
                    {leadSources.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Initial Status</label>
                  <select className="input" value={form.status} onChange={set('status')}>
                    {CRM_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="label">Referring Estate Agent <span className="text-slate-400 font-normal">(optional)</span></label>
                <input type="text" className="input" placeholder="Agency name"
                  value={form.estate_agent_name} onChange={set('estate_agent_name')} />
              </div>
              <div>
                <label className="label">Notes <span className="text-slate-400 font-normal">(optional)</span></label>
                <textarea className="input resize-none" rows={2}
                  placeholder="Anything useful at this stage…"
                  value={form.internal_notes} onChange={set('internal_notes')} />
              </div>
            </div>
          </section>
          <div className="flex gap-3 justify-end pt-1 border-t border-slate-100">
            <button type="button" className="btn-secondary" onClick={() => setNewOpen(false)}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting
                ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Creating…</>
                : <><Plus className="w-4 h-4" /> Create Job &amp; Open</>}
            </button>
          </div>
        </form>
      </Modal>

      {/* ── Import Leads Modal ─────────────────────────────────────────────── */}
      <Modal open={pendingOpen} onClose={() => setPendingOpen(false)} title={`Import Estate Agent Leads (${pending.length})`} size="lg">
        <div className="space-y-3">
          <p className="text-sm text-slate-500">
            These leads haven't been imported yet. Importing creates a full job record pre-filled with the lead's details.
          </p>
          {pending.length === 0 ? (
            <div className="py-8 text-center">
              <CheckCircle className="w-10 h-10 text-emerald-400 mx-auto mb-2" />
              <p className="text-sm text-slate-500">All estate agent leads have been imported.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 -mx-6 px-6">
              {pending.map(l => (
                <div key={l.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900 truncate">{l.client_name}</p>
                    <p className="text-xs text-slate-400 truncate">{l.agency_name} · {l.current_address}</p>
                  </div>
                  <button className="btn-secondary text-xs flex-shrink-0 py-1.5"
                    onClick={() => handleImport(l.id)} disabled={importing === l.id}>
                    {importing === l.id
                      ? <span className="w-3.5 h-3.5 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
                      : <Download className="w-3.5 h-3.5" />}
                    Import
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>

      {/* ── Delete Confirm ────────────────────────────────────────────────── */}
      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete Job" size="sm">
        <div className="py-2">
          <p className="text-sm text-slate-600 mb-1">
            Delete <span className="font-semibold text-slate-900">{deleteTarget?.full_name}</span>{' '}
            <span className="text-slate-400">({deleteTarget ? jobRef(deleteTarget.id) : ''})</span>?
          </p>
          <p className="text-sm text-slate-400 mb-6">All activity history will also be removed. This cannot be undone.</p>
          <div className="flex gap-3 justify-end">
            <button className="btn-secondary" onClick={() => setDeleteTarget(null)}>Cancel</button>
            <button className="btn-danger" onClick={handleDelete} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
      </Modal>

      {toast && <Toast message={toast.message} type={toast.type} onDone={() => setToast(null)} />}
    </CRMLayout>
  );
}
