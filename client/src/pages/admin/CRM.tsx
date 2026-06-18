import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Plus, Search, List, CalendarDays, ChevronLeft, ChevronRight,
  Download, Eye, Trash2, Users, CheckCircle, AlertCircle,
  ClipboardCheck, TrendingUp, Briefcase,
} from 'lucide-react';
import CRMLayout from '../../components/CRMLayout';
import Modal from '../../components/Modal';
import api from '../../lib/api';
import type { CrmJob, CrmStatus, PendingLead } from '../../types';
import { CRM_STATUSES, CRM_BEDROOM_OPTIONS } from '../../types';

// ── Status config ─────────────────────────────────────────────────────────────

const S: Record<string, { bg: string; text: string; dot: string; cal: string }> = {
  'New Lead':          { bg: 'bg-blue-50',    text: 'text-blue-700',    dot: 'bg-blue-500',    cal: 'bg-blue-500' },
  'Contacted':         { bg: 'bg-violet-50',  text: 'text-violet-700',  dot: 'bg-violet-500',  cal: 'bg-violet-500' },
  'Survey Booked':     { bg: 'bg-cyan-50',    text: 'text-cyan-700',    dot: 'bg-cyan-500',    cal: 'bg-cyan-500' },
  'Survey Completed':  { bg: 'bg-teal-50',    text: 'text-teal-700',    dot: 'bg-teal-500',    cal: 'bg-teal-500' },
  'Awaiting Quote':    { bg: 'bg-yellow-50',  text: 'text-yellow-800',  dot: 'bg-yellow-500',  cal: 'bg-yellow-500' },
  'Quote Sent':        { bg: 'bg-amber-50',   text: 'text-amber-700',   dot: 'bg-amber-500',   cal: 'bg-amber-500' },
  'Quote Accepted':    { bg: 'bg-orange-50',  text: 'text-orange-700',  dot: 'bg-orange-500',  cal: 'bg-orange-500' },
  'Booked Move':       { bg: 'bg-green-50',   text: 'text-green-700',   dot: 'bg-green-500',   cal: 'bg-green-500' },
  'In Progress':       { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500', cal: 'bg-emerald-500' },
  'Completed':         { bg: 'bg-slate-100',  text: 'text-slate-600',   dot: 'bg-slate-400',   cal: 'bg-slate-400' },
  'Lost / Cancelled':  { bg: 'bg-red-50',     text: 'text-red-700',     dot: 'bg-red-500',     cal: 'bg-red-500' },
};

function CrmBadge({ status, size = 'md' }: { status: string; size?: 'sm' | 'md' }) {
  const c = S[status] ?? { bg: 'bg-slate-100', text: 'text-slate-600', dot: 'bg-slate-400', cal: 'bg-slate-400' };
  return (
    <span className={`inline-flex items-center gap-1.5 font-semibold rounded-full ring-1 ring-inset ring-white/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] ${c.bg} ${c.text} ${size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs'}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ring-2 ring-white/70 ${c.dot}`} />
      {status}
    </span>
  );
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function Toast({ message, type, onDone }: { message: string; type: 'success' | 'error'; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 3500); return () => clearTimeout(t); }, [onDone]);
  return (
    <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-xl text-sm font-medium text-white ${type === 'success' ? 'bg-emerald-600' : 'bg-red-600'}`}>
      {type === 'success' ? <CheckCircle className="w-4 h-4 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 flex-shrink-0" />}
      {message}
    </div>
  );
}

// ── Calendar helpers ──────────────────────────────────────────────────────────

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS   = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

interface CalEvent { date: string; label: string; type: 'survey' | 'quote' | 'move'; job: CrmJob }

function buildCalEvents(jobs: CrmJob[]): CalEvent[] {
  const events: CalEvent[] = [];
  for (const j of jobs) {
    if (j.survey_date)        events.push({ date: j.survey_date.slice(0,10),        label: j.full_name, type: 'survey', job: j });
    if (j.quote_sent_date)    events.push({ date: j.quote_sent_date.slice(0,10),    label: j.full_name, type: 'quote',  job: j });
    if (j.confirmed_move_date)events.push({ date: j.confirmed_move_date.slice(0,10),label: j.full_name, type: 'move',   job: j });
    else if (j.preferred_move_date && !isNaN(new Date(j.preferred_move_date).getTime())) events.push({ date: j.preferred_move_date.slice(0,10), label: j.full_name, type: 'move', job: j });
  }
  return events;
}

const CAL_TYPE_CFG = {
  survey: { bg: 'bg-cyan-500',   label: 'Survey' },
  quote:  { bg: 'bg-amber-500',  label: 'Quote'  },
  move:   { bg: 'bg-brand-600',  label: 'Move'   },
};

function toDateStr(y: number, m: number, d: number) {
  return `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

function buildCells(y: number, m: number): (number | null)[] {
  const dim    = new Date(y, m + 1, 0).getDate();
  const offset = (new Date(y, m, 1).getDay() + 6) % 7; // Mon=0
  const cells: (number | null)[] = Array(offset).fill(null);
  for (let d = 1; d <= dim; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

// ── KPI card ──────────────────────────────────────────────────────────────────

function KpiCard({
  label, value, icon, color, accent,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
  accent: string;
}) {
  return (
    <div className="group relative bg-gradient-to-br from-white via-white to-slate-50/50 rounded-xl border border-slate-200/70 shadow-[0_1px_2px_0_rgba(15,23,42,0.04)] hover:shadow-[0_8px_20px_-6px_rgba(15,23,42,0.14),0_2px_4px_-2px_rgba(15,23,42,0.06)] hover:-translate-y-px transition-all duration-200 p-4 flex items-center gap-3 overflow-hidden">
      {/* Top accent stripe */}
      <div
        className="absolute top-0 left-0 right-0 h-[3px]"
        style={{ background: `linear-gradient(90deg, ${accent}, ${accent}cc 60%, ${accent}55)` }}
      />
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${color} ring-1 ring-inset ring-white/50 shadow-sm`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-bold text-slate-900 leading-none tabular-nums tracking-tight">{value}</p>
        <p className="text-xs font-medium text-slate-500 mt-1 truncate">{label}</p>
      </div>
    </div>
  );
}

// ── New client form ───────────────────────────────────────────────────────────

interface NewJobForm {
  full_name: string; email: string; phone: string;
  lead_source: string; estate_agent_name: string;
  from_line1: string; from_postcode: string;
  to_line1: string; to_postcode: string;
  bedrooms: string; preferred_move_date: string;
  internal_notes: string; status: string;
}
const EMPTY: NewJobForm = {
  full_name: '', email: '', phone: '',
  lead_source: 'Direct Enquiry', estate_agent_name: '',
  from_line1: '', from_postcode: '', to_line1: '', to_postcode: '',
  bedrooms: '', preferred_move_date: '', internal_notes: '', status: 'New Lead',
};

// ── Main component ────────────────────────────────────────────────────────────

export default function CRMPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [jobs,         setJobs]         = useState<CrmJob[]>([]);
  const [pending,      setPending]      = useState<PendingLead[]>([]);
  const [summary,      setSummary]      = useState<Record<string, number>>({});
  const [loading,      setLoading]      = useState(true);
  const [view,         setView]         = useState<'list' | 'calendar'>('list');

  // Filters — statusFilter is driven by URL ?status= so sidebar links control it
  const statusParam = searchParams.get('status') as CrmStatus | null;
  const statusFilter: CrmStatus | 'All' = statusParam ?? 'All';
  const setStatusFilter = (s: CrmStatus | 'All') => {
    setSearchParams(s === 'All' ? {} : { status: s }, { replace: true });
  };
  const [search,       setSearch]       = useState('');
  const [agentFilter,  setAgentFilter]  = useState('All');
  const [dateFrom,     setDateFrom]     = useState('');
  const [dateTo,       setDateTo]       = useState('');

  // Calendar
  const today = new Date();
  const [calYear,  setCalYear]  = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth());

  // Modals
  const [newOpen,       setNewOpen]       = useState(false);
  const [form,          setForm]          = useState<NewJobForm>(EMPTY);
  const [submitting,    setSubmitting]    = useState(false);
  const [formError,     setFormError]     = useState('');
  const [leadSources,   setLeadSources]   = useState<string[]>([]);
  const [deleteTarget,  setDeleteTarget]  = useState<CrmJob | null>(null);
  const [deleting,      setDeleting]      = useState(false);
  const [pendingOpen,   setPendingOpen]   = useState(false);
  const [importing,     setImporting]     = useState<number | null>(null);

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const showToast = (message: string, type: 'success' | 'error' = 'success') => setToast({ message, type });

  const fetchAll = useCallback(async () => {
    const [jobsRes, pendRes, sumRes] = await Promise.all([
      api.get('/crm/jobs'),
      api.get('/crm/pending-leads'),
      api.get('/crm/jobs/summary'),
    ]);
    setJobs(jobsRes.data);
    setPending(pendRes.data);
    const map: Record<string, number> = { Total: sumRes.data.total };
    for (const row of sumRes.data.by_status) map[row.status] = row.count;
    setSummary(map);
  }, []);

  useEffect(() => { fetchAll().finally(() => setLoading(false)); }, [fetchAll]);

  useEffect(() => {
    api.get('/settings/lead-sources')
      .then(r => setLeadSources(r.data.map((s: { name: string }) => s.name)))
      .catch(() => {});
  }, []);

  // ── Derived ─────────────────────────────────────────────────────────────────

  const agentOptions = Array.from(new Set(jobs.map(j => j.estate_agent_name).filter(Boolean) as string[]));

  const filtered = jobs.filter(j => {
    if (statusFilter !== 'All' && j.status !== statusFilter) return false;
    if (agentFilter !== 'All' && j.estate_agent_name !== agentFilter) return false;
    if (dateFrom && j.confirmed_move_date && j.confirmed_move_date < dateFrom) return false;
    if (dateTo   && j.confirmed_move_date && j.confirmed_move_date > dateTo)   return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      j.full_name.toLowerCase().includes(q) ||
      (j.email || '').toLowerCase().includes(q) ||
      (j.phone || '').includes(q) ||
      (j.from_line1 || '').toLowerCase().includes(q) ||
      (j.from_postcode || '').toLowerCase().includes(q) ||
      (j.to_postcode || '').toLowerCase().includes(q) ||
      (j.estate_agent_name || '').toLowerCase().includes(q)
    );
  });

  const hasFilters = statusFilter !== 'All' || agentFilter !== 'All' || search || dateFrom || dateTo;

  // ── Format ──────────────────────────────────────────────────────────────────

  function fmtDate(d: string | null) {
    if (!d) return '—';
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return d; // free-text estimated date (e.g. "End of June")
    return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function shortAddr(line1: string | null, postcode: string | null) {
    return [line1, postcode].filter(Boolean).join(', ') || '—';
  }

  // ── Create ──────────────────────────────────────────────────────────────────

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
      showToast('Client record created');
      navigate(`/admin/crm/${res.data.id}`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setFormError(msg || 'Failed to create record');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Delete ──────────────────────────────────────────────────────────────────

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/crm/jobs/${deleteTarget.id}`);
      await fetchAll();
      setDeleteTarget(null);
      showToast('Record deleted');
    } catch { showToast('Failed to delete', 'error'); }
    finally { setDeleting(false); }
  };

  // ── Import lead ──────────────────────────────────────────────────────────────

  const handleImport = async (leadId: number) => {
    setImporting(leadId);
    try {
      const res = await api.post(`/crm/import/${leadId}`);
      await fetchAll();
      setPendingOpen(false);
      showToast('Lead imported to CRM');
      navigate(`/admin/crm/${res.data.id}`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      showToast(msg || 'Import failed', 'error');
    } finally { setImporting(null); }
  };

  // ── Calendar ─────────────────────────────────────────────────────────────────

  const calEvents = buildCalEvents(jobs);
  const calMap: Record<string, CalEvent[]> = {};
  for (const ev of calEvents) {
    if (!calMap[ev.date]) calMap[ev.date] = [];
    calMap[ev.date].push(ev);
  }
  const calCells  = buildCells(calYear, calMonth);
  const todayStr  = toDateStr(today.getFullYear(), today.getMonth(), today.getDate());
  const goBack    = () => { if (calMonth === 0) { setCalYear(y => y-1); setCalMonth(11); } else setCalMonth(m => m-1); };
  const goFwd     = () => { if (calMonth === 11) { setCalYear(y => y+1); setCalMonth(0); } else setCalMonth(m => m+1); };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <CRMLayout>
      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <div>
          <h1 className="page-title tracking-tight">iMove CRM new</h1>
          <p className="page-subtitle">Manage leads, quotations, move jobs, dates, notes, and client records</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {pending.length > 0 && (
            <button
              className="btn-secondary text-sm relative"
              onClick={() => setPendingOpen(true)}
            >
              <Download className="w-4 h-4" />
              Import Leads
              <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-brand-600 text-white text-xs rounded-full flex items-center justify-center font-bold">
                {pending.length}
              </span>
            </button>
          )}
          <button className="btn-primary" onClick={() => { setForm({ ...EMPTY, lead_source: leadSources[0] || '' }); setFormError(''); setNewOpen(true); }}>
            <Plus className="w-4 h-4" /> New Client
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6 mt-5">
        <KpiCard label="Total Clients"  value={summary['Total']           ?? 0} icon={<Users className="w-5 h-5 text-brand-600" />}            color="bg-gradient-to-br from-brand-50 to-brand-100"    accent="#7c3aed" />
        <KpiCard label="New Leads"      value={summary['New Lead']         ?? 0} icon={<TrendingUp className="w-5 h-5 text-blue-600" />}        color="bg-gradient-to-br from-blue-50 to-blue-100"      accent="#3b82f6" />
        <KpiCard label="Awaiting Quote" value={summary['Awaiting Quote']   ?? 0} icon={<ClipboardCheck className="w-5 h-5 text-yellow-600" />}  color="bg-gradient-to-br from-yellow-50 to-yellow-100"  accent="#eab308" />
        <KpiCard label="Quoted"         value={(summary['Quote Sent'] ?? 0) + (summary['Quote Accepted'] ?? 0)} icon={<Briefcase className="w-5 h-5 text-amber-600" />} color="bg-gradient-to-br from-amber-50 to-amber-100" accent="#f59e0b" />
        <KpiCard label="Booked Moves"   value={summary['Booked Move']      ?? 0} icon={<CheckCircle className="w-5 h-5 text-green-600" />}      color="bg-gradient-to-br from-green-50 to-green-100"    accent="#22c55e" />
        <KpiCard label="Completed"      value={summary['Completed']        ?? 0} icon={<CheckCircle className="w-5 h-5 text-slate-500" />}      color="bg-gradient-to-br from-slate-100 to-slate-200"   accent="#94a3b8" />
      </div>

      {/* Filter bar */}
      <div className="card p-4 mb-5">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input type="text" className="input pl-9" placeholder="Search name, email, postcode…"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="input w-auto" value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as CrmStatus | 'All')}>
            <option value="All">All Statuses</option>
            {CRM_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {agentOptions.length > 0 && (
            <select className="input w-auto" value={agentFilter}
              onChange={e => setAgentFilter(e.target.value)}>
              <option value="All">All Estate Agents</option>
              {agentOptions.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          )}
          <div className="flex items-center gap-1.5">
            <input type="date" className="input w-36 text-xs" value={dateFrom} onChange={e => setDateFrom(e.target.value)} title="Move date from" />
            <span className="text-xs text-slate-400">to</span>
            <input type="date" className="input w-36 text-xs" value={dateTo} onChange={e => setDateTo(e.target.value)} title="Move date to" />
          </div>
          {hasFilters && (
            <button className="btn-secondary text-xs"
              onClick={() => { setSearch(''); setStatusFilter('All'); setAgentFilter('All'); setDateFrom(''); setDateTo(''); }}>
              Clear
            </button>
          )}
          {/* View toggle (right-aligned) */}
          <div className="ml-auto flex rounded-lg border border-slate-200 overflow-hidden bg-white">
            {(['list','calendar'] as const).map((v, i) => (
              <button key={v} onClick={() => setView(v)}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors ${i > 0 ? 'border-l border-slate-200' : ''} ${view === v ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
                {v === 'list' ? <List className="w-3.5 h-3.5" /> : <CalendarDays className="w-3.5 h-3.5" />}
                {v === 'list' ? 'List' : 'Calendar'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── LIST VIEW ──────────────────────────────────────────────────────── */}
      {view === 'list' && (
        <div className="card overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-48">
              <div className="w-7 h-7 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-20 text-center">
              <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Users className="w-7 h-7 text-slate-300" />
              </div>
              <p className="text-sm font-medium text-slate-500 mb-1">
                {jobs.length === 0 ? 'No CRM records yet' : 'No results match your filters'}
              </p>
              <p className="text-xs text-slate-400 mb-4">
                {jobs.length === 0 ? 'Create a new client or import an estate agent lead' : 'Try adjusting your search or filters'}
              </p>
              {jobs.length === 0 && (
                <div className="flex items-center gap-2 justify-center">
                  <button className="btn-primary" onClick={() => setNewOpen(true)}>
                    <Plus className="w-4 h-4" /> New Client
                  </button>
                  {pending.length > 0 && (
                    <button className="btn-secondary" onClick={() => setPendingOpen(true)}>
                      <Download className="w-4 h-4" /> Import Lead
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px]">
                <thead>
                  <tr className="border-b border-slate-200/70 bg-gradient-to-b from-slate-50 to-slate-50/40">
                    <th className="text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider px-5 py-3">Client</th>
                    <th className="text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider px-4 py-3 hidden lg:table-cell">Lead Source</th>
                    <th className="text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider px-4 py-3 hidden md:table-cell">Estate Agent</th>
                    <th className="text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider px-4 py-3 hidden lg:table-cell">Moving From</th>
                    <th className="text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider px-4 py-3 hidden lg:table-cell">Moving To</th>
                    <th className="text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider px-4 py-3 hidden xl:table-cell">Survey Date</th>
                    <th className="text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider px-4 py-3 hidden sm:table-cell">Move Date</th>
                    <th className="text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider px-4 py-3">Status</th>
                    <th className="text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider px-4 py-3 hidden xl:table-cell">Updated</th>
                    <th className="w-20 px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100/70">
                  {filtered.map(j => (
                    <tr key={j.id} className="hover:bg-gradient-to-r hover:from-brand-50/40 hover:to-transparent transition-colors group cursor-pointer"
                      onClick={() => navigate(`/admin/crm/${j.id}`)}>
                      <td className="px-5 py-3.5">
                        <p className="text-sm font-semibold text-slate-900 group-hover:text-brand-700 transition-colors tracking-tight">{j.full_name}</p>
                        <p className="text-xs text-slate-400 mt-0.5 hidden sm:block tabular-nums">{j.phone || j.email || '—'}</p>
                      </td>
                      <td className="px-4 py-3.5 hidden lg:table-cell">
                        <p className="text-xs text-slate-500">{j.lead_source || '—'}</p>
                      </td>
                      <td className="px-4 py-3.5 hidden md:table-cell">
                        <p className="text-sm text-slate-600">{j.estate_agent_name || <span className="text-slate-300">—</span>}</p>
                      </td>
                      <td className="px-4 py-3.5 hidden lg:table-cell">
                        <p className="text-xs text-slate-500 truncate max-w-[130px]">{shortAddr(j.from_line1, j.from_postcode)}</p>
                      </td>
                      <td className="px-4 py-3.5 hidden lg:table-cell">
                        <p className="text-xs text-slate-500 truncate max-w-[130px]">{shortAddr(j.to_line1, j.to_postcode)}</p>
                      </td>
                      <td className="px-4 py-3.5 hidden xl:table-cell">
                        <p className="text-xs text-slate-500 tabular-nums">{fmtDate(j.survey_date)}</p>
                      </td>
                      <td className="px-4 py-3.5 hidden sm:table-cell">
                        <p className="text-xs text-slate-700 font-semibold tabular-nums">{fmtDate(j.confirmed_move_date || j.preferred_move_date)}</p>
                        {j.preferred_move_date && !j.confirmed_move_date && (
                          <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">Estimated</p>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        <CrmBadge status={j.status} size="sm" />
                      </td>
                      <td className="px-4 py-3.5 hidden xl:table-cell">
                        <p className="text-xs text-slate-400 tabular-nums">{fmtDate(j.updated_at)}</p>
                      </td>
                      <td className="px-4 py-3.5" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => navigate(`/admin/crm/${j.id}`)}
                            className="p-1.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-all hover:shadow-sm hover:scale-105 active:scale-95" title="View">
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => setDeleteTarget(j)}
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all hover:shadow-sm hover:scale-105 active:scale-95" title="Delete">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-5 py-3 border-t border-slate-100/70 bg-gradient-to-b from-transparent to-slate-50/40">
                <p className="text-xs font-medium text-slate-500 tabular-nums">
                  {filtered.length} record{filtered.length !== 1 ? 's' : ''}{hasFilters ? ` of ${jobs.length} total` : ''}
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── CALENDAR VIEW ──────────────────────────────────────────────────── */}
      {view === 'calendar' && (
        <div className="card overflow-hidden">
          {/* Month nav */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <button onClick={goBack} className="btn-secondary p-2"><ChevronLeft className="w-4 h-4" /></button>
            <h2 className="text-base font-semibold text-slate-900">{MONTHS[calMonth]} {calYear}</h2>
            <button onClick={goFwd}  className="btn-secondary p-2"><ChevronRight className="w-4 h-4" /></button>
          </div>
          {/* Day headers */}
          <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50/50">
            {DAYS.map(d => (
              <div key={d} className="px-2 py-2 text-center text-xs font-semibold text-slate-400 uppercase tracking-wide">{d}</div>
            ))}
          </div>
          {/* Grid */}
          <div className="grid grid-cols-7">
            {calCells.map((day, i) => {
              const ds      = day ? toDateStr(calYear, calMonth, day) : null;
              const evs     = ds ? (calMap[ds] || []) : [];
              const isToday = ds === todayStr;
              const weekend = i % 7 >= 5;
              return (
                <div key={i} className={`min-h-[96px] p-1.5 border-r border-b border-slate-100 ${i % 7 === 6 ? 'border-r-0' : ''} ${!day || weekend ? 'bg-slate-50/40' : ''}`}>
                  {day && (
                    <>
                      <div className={`text-xs font-bold mb-1 w-6 h-6 flex items-center justify-center rounded-full mx-auto tabular-nums ${
                        isToday
                          ? 'bg-gradient-to-br from-brand-500 to-brand-600 text-white shadow-[0_4px_10px_-2px_rgba(124,58,237,0.4)] ring-2 ring-white'
                          : 'text-slate-500'
                      }`}>
                        {day}
                      </div>
                      <div className="space-y-0.5">
                        {evs.slice(0, 3).map((ev, ei) => {
                          const cfg = CAL_TYPE_CFG[ev.type];
                          return (
                            <button key={ei} onClick={() => navigate(`/admin/crm/${ev.job.id}`)}
                              className={`w-full text-left flex items-center gap-1 text-xs px-1.5 py-0.5 rounded text-white font-medium truncate ${cfg.bg} hover:opacity-90 transition-opacity`}
                              title={`${ev.label} — ${cfg.label}`}>
                              <span className="text-white/70 flex-shrink-0 text-[10px]">{cfg.label[0]}</span>
                              <span className="truncate">{ev.label}</span>
                            </button>
                          );
                        })}
                        {evs.length > 3 && <p className="text-xs text-slate-400 pl-1">+{evs.length - 3} more</p>}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          {/* Legend */}
          <div className="px-5 py-3 border-t border-slate-100 flex items-center gap-5 flex-wrap">
            {Object.entries(CAL_TYPE_CFG).map(([k, v]) => (
              <span key={k} className="flex items-center gap-1.5 text-xs text-slate-500">
                <span className={`w-2.5 h-2.5 rounded-sm ${v.bg}`} /> {v.label} date
              </span>
            ))}
            {jobs.length === 0 && (
              <span className="text-xs text-slate-400">No jobs scheduled this month</span>
            )}
          </div>
        </div>
      )}

      {/* ── NEW CLIENT MODAL ──────────────────────────────────────────────── */}
      <Modal open={newOpen} onClose={() => setNewOpen(false)} title="New Client / Move Record" size="lg">
        <form onSubmit={handleCreate} className="space-y-5">
          {formError && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-100 text-red-700 px-4 py-3 rounded-xl text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />{formError}
            </div>
          )}

          <section>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Contact Details</p>
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
                  <input type="text" className="input" placeholder="e.g. End of June, mid-July, or a date"
                    value={form.preferred_move_date} onChange={set('preferred_move_date')} />
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
                  <label className="label">Status</label>
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
                <label className="label">Initial Notes <span className="text-slate-400 font-normal">(optional)</span></label>
                <textarea className="input resize-none" rows={2}
                  placeholder="Anything useful to note at this stage…"
                  value={form.internal_notes} onChange={set('internal_notes')} />
              </div>
            </div>
          </section>

          <div className="flex gap-3 justify-end pt-1 border-t border-slate-100">
            <button type="button" className="btn-secondary" onClick={() => setNewOpen(false)}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting
                ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Creating…</>
                : <><Plus className="w-4 h-4" /> Create Record &amp; Open Profile</>}
            </button>
          </div>
        </form>
      </Modal>

      {/* ── IMPORT LEADS MODAL ───────────────────────────────────────────── */}
      <Modal open={pendingOpen} onClose={() => setPendingOpen(false)} title={`Import Estate Agent Leads (${pending.length})`} size="lg">
        <div className="space-y-3">
          <p className="text-sm text-slate-500">
            These estate agent leads have not yet been imported into the CRM. Importing creates a full CRM record pre-filled with the lead's details.
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
                  <button
                    className="btn-secondary text-xs flex-shrink-0 py-1.5"
                    onClick={() => handleImport(l.id)}
                    disabled={importing === l.id}
                  >
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

      {/* ── DELETE CONFIRM ───────────────────────────────────────────────── */}
      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete CRM Record" size="sm">
        <div className="py-2">
          <p className="text-sm text-slate-600 mb-1">
            Delete <span className="font-semibold text-slate-900">{deleteTarget?.full_name}</span>?
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
