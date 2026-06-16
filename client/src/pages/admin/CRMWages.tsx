import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Banknote, RefreshCw, CheckCircle2 } from 'lucide-react';
import CRMLayout from '../../components/CRMLayout';
import api from '../../lib/api';
import type { WeeklyPnlResponse, WeeklyPnlRow } from '../../types';

// ── Types ────────────────────────────────────────────────────────────────────

interface DayCell {
  rate: number;
  role: string | null;
  count: number;
}

interface StaffRow {
  asset_id: number;
  name: string;
  role: string | null;
  days: Record<string, DayCell>;
  total: number;
  expenses: number;
  advances: number;
  balance: number;
  notes: string;
  paid: boolean;
  paid_at: string | null;
}

interface RoleSummary {
  role: string;
  headcount: number;
  total: number;
}

interface WagesWeekResponse {
  week_start: string;
  dates: string[];
  staff: StaffRow[];
  summary: {
    total_earnings: number;
    by_role: RoleSummary[];
    headcount: number;
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// Resolve the Monday of the week containing `d`. JS getDay() returns 0=Sun..6=Sat,
// so we shift back to Monday and zero the time.
function mondayOf(d: Date): Date {
  const day = d.getDay();           // 0=Sun, 1=Mon, ...
  const diff = day === 0 ? -6 : 1 - day;
  const m = new Date(d);
  m.setHours(0, 0, 0, 0);
  m.setDate(m.getDate() + diff);
  return m;
}

// Format a Date as YYYY-MM-DD in *local* time. Using toISOString() here
// would shift the day under UTC offsets (e.g. BST: local midnight Mon → Sun 23:00 UTC).
function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fmtMoney(n: number): string {
  return `£${(Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function fmtDayLabel(iso: string): { day: string; date: string } {
  const d = new Date(iso + 'T00:00:00');
  return {
    day: d.toLocaleDateString('en-GB', { weekday: 'short' }),
    date: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
  };
}

// Compact "Mon 12 Jun" label for the P&L date column.
function fmtPnlDate(iso: string): string {
  if (!iso) return '—';
  const { day, date } = fmtDayLabel(iso);
  return `${day} ${date}`;
}

function fmtWeekRange(start: string, end: string): string {
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  const sStr = s.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const eStr = e.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  return `${sStr} – ${eStr}`;
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function CRMWages() {
  const navigate = useNavigate();
  const [weekStart, setWeekStart] = useState<string>(() => isoDate(mondayOf(new Date())));
  const [data, setData] = useState<WagesWeekResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [pnl, setPnl] = useState<WeeklyPnlResponse | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [wagesRes, pnlRes] = await Promise.all([
        api.get<WagesWeekResponse>('/wages/week', { params: { start: weekStart } }),
        api.get<WeeklyPnlResponse>('/wages/pnl', { params: { start: weekStart } }),
      ]);
      setData(wagesRes.data);
      setPnl(pnlRes.data);
    } catch (err) {
      console.error('Failed to load wages', err);
      setData(null);
      setPnl(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [weekStart]);

  function shiftWeek(deltaDays: number) {
    const d = new Date(weekStart + 'T00:00:00');
    d.setDate(d.getDate() + deltaDays);
    setWeekStart(isoDate(mondayOf(d)));
  }

  function goThisWeek() {
    setWeekStart(isoDate(mondayOf(new Date())));
  }

  // Local edit state for the per-staff numeric fields and notes. We commit on blur
  // so the user can type without round-tripping on every keystroke.
  const [edits, setEdits] = useState<Record<number, Partial<StaffRow>>>({});
  useEffect(() => { setEdits({}); }, [weekStart]);

  function getField<K extends keyof StaffRow>(row: StaffRow, key: K): StaffRow[K] {
    const e = edits[row.asset_id];
    if (e && key in e) return (e[key] as StaffRow[K]);
    return row[key];
  }

  function setEdit(assetId: number, patch: Partial<StaffRow>) {
    setEdits(prev => ({ ...prev, [assetId]: { ...prev[assetId], ...patch } }));
  }

  async function persist(row: StaffRow, patch: Partial<StaffRow>) {
    setSavingId(row.asset_id);
    try {
      await api.put('/wages/period', {
        asset_id: row.asset_id,
        week_start: weekStart,
        expenses: patch.expenses ?? row.expenses,
        advances: patch.advances ?? row.advances,
        notes:    patch.notes    ?? row.notes,
        paid:     patch.paid     ?? row.paid,
      });
      await load();
    } catch (err) {
      console.error('Failed to save wage period', err);
    } finally {
      setSavingId(null);
    }
  }

  const dates = data?.dates ?? [];
  const staff = data?.staff ?? [];

  const totals = useMemo(() => {
    const t = { total: 0, expenses: 0, advances: 0, balance: 0, paidCount: 0 };
    for (const s of staff) {
      const expenses = Number(getField(s, 'expenses')) || 0;
      const advances = Number(getField(s, 'advances')) || 0;
      const paid = !!getField(s, 'paid');
      t.total    += s.total;
      t.expenses += expenses;
      t.advances += advances;
      t.balance  += s.total + expenses - advances;
      if (paid) t.paidCount += 1;
    }
    return t;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staff, edits]);

  // Per-day wages spend (sum of every staff member's rate × count for that day)
  const dailyTotals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const d of dates) {
      let sum = 0;
      for (const s of staff) {
        const cell = s.days[d];
        if (cell) sum += (Number(cell.rate) || 0) * (Number(cell.count) || 1);
      }
      t[d] = sum;
    }
    return t;
  }, [dates, staff]);

  return (
    <CRMLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <Banknote className="w-6 h-6 text-emerald-600" />
              Wages
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              Weekly earnings pulled from the planner, with expenses, advances and pay status.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => shiftWeek(-7)}
              className="p-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              title="Previous week"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-semibold text-slate-700 min-w-[200px] text-center tabular-nums">
              {dates.length > 0 ? fmtWeekRange(dates[0], dates[6]) : '…'}
            </div>
            <button
              onClick={() => shiftWeek(7)}
              className="p-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              title="Next week"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              onClick={goThisWeek}
              className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              This week
            </button>
            <button
              onClick={load}
              className="p-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Top summary strip */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <SummaryCard label="Total earnings" value={fmtMoney(totals.total)} accent="emerald" />
          <SummaryCard label="Expenses" value={fmtMoney(totals.expenses)} accent="amber" />
          <SummaryCard label="Advances" value={fmtMoney(totals.advances)} accent="violet" />
          <SummaryCard label="Balance to pay" value={fmtMoney(totals.balance)} accent="blue" />
        </div>

        {/* Main table */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left px-4 py-2 font-semibold text-slate-600 whitespace-nowrap">Staff</th>
                    {dates.map(d => {
                      const lbl = fmtDayLabel(d);
                      const dayTotal = dailyTotals[d] || 0;
                      return (
                        <th key={d} className="text-center px-2 py-2 font-semibold text-slate-600 whitespace-nowrap">
                          <div className="text-[11px] uppercase tracking-wider text-slate-500">{lbl.day}</div>
                          <div className="text-xs font-normal text-slate-400">{lbl.date}</div>
                          <div
                            className={`text-[10px] font-semibold tabular-nums mt-0.5 ${dayTotal > 0 ? 'text-emerald-700' : 'text-slate-300'}`}
                            title="Wages spend for this day"
                          >
                            {fmtMoney(dayTotal)}
                          </div>
                        </th>
                      );
                    })}
                    <th className="text-right px-3 py-2 font-semibold text-slate-700 bg-emerald-50/50">Total</th>
                    <th className="text-right px-2 py-2 font-semibold text-slate-600">Expenses</th>
                    <th className="text-right px-2 py-2 font-semibold text-slate-600">Advances</th>
                    <th className="text-right px-3 py-2 font-semibold text-slate-700 bg-blue-50/50">Balance</th>
                    <th className="text-left px-2 py-2 font-semibold text-slate-600 min-w-[160px]">Notes</th>
                    <th className="text-center px-2 py-2 font-semibold text-slate-600">Paid</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading && staff.length === 0 && (
                    <tr>
                      <td colSpan={13} className="px-4 py-12 text-center text-sm text-slate-400">Loading…</td>
                    </tr>
                  )}
                  {!loading && staff.length === 0 && (
                    <tr>
                      <td colSpan={13} className="px-4 py-12 text-center text-sm text-slate-400">
                        No staff worked this week. Assign people to jobs in the planner to see them here.
                      </td>
                    </tr>
                  )}
                  {staff.map(row => {
                    const expenses = Number(getField(row, 'expenses')) || 0;
                    const advances = Number(getField(row, 'advances')) || 0;
                    const notes    = (getField(row, 'notes') as string) ?? '';
                    const paid     = !!getField(row, 'paid');
                    const balance  = row.total + expenses - advances;
                    return (
                      <tr key={row.asset_id} className={paid ? 'bg-emerald-50/30' : ''}>
                        <td className="px-4 py-2 font-semibold text-slate-800 whitespace-nowrap">
                          {row.name}
                        </td>
                        {dates.map(d => {
                          const cell = row.days[d];
                          return (
                            <td key={d} className="text-center px-2 py-2 align-middle">
                              {cell ? (
                                <button
                                  type="button"
                                  onClick={() => navigate(`/admin/crm/planner?view=staff&date=${d}&highlight=${row.asset_id}`)}
                                  title="Open this day in the staff planner"
                                  className="inline-flex flex-col items-center px-2 py-1 rounded hover:bg-emerald-50 hover:ring-1 hover:ring-emerald-200 transition-colors cursor-pointer"
                                >
                                  <span className="text-sm font-semibold text-slate-800 tabular-nums group-hover:text-emerald-700">
                                    {fmtMoney(cell.rate)}
                                  </span>
                                  {cell.count > 1 && (
                                    <span className="text-[10px] text-slate-400">×{cell.count}</span>
                                  )}
                                </button>
                              ) : (
                                <span className="text-slate-300">—</span>
                              )}
                            </td>
                          );
                        })}
                        <td className="text-right px-3 py-2 font-bold text-emerald-700 tabular-nums bg-emerald-50/40">
                          {fmtMoney(row.total)}
                        </td>
                        <td className="px-1 py-1.5">
                          <MoneyInput
                            value={expenses}
                            onChange={v => setEdit(row.asset_id, { expenses: v })}
                            onCommit={v => persist(row, { expenses: v })}
                          />
                        </td>
                        <td className="px-1 py-1.5">
                          <MoneyInput
                            value={advances}
                            onChange={v => setEdit(row.asset_id, { advances: v })}
                            onCommit={v => persist(row, { advances: v })}
                          />
                        </td>
                        <td className="text-right px-3 py-2 font-bold text-blue-700 tabular-nums bg-blue-50/40">
                          {fmtMoney(balance)}
                        </td>
                        <td className="px-1 py-1.5">
                          <input
                            type="text"
                            value={notes}
                            onChange={e => setEdit(row.asset_id, { notes: e.target.value })}
                            onBlur={e => {
                              if (e.target.value !== row.notes) persist(row, { notes: e.target.value });
                            }}
                            placeholder="Add note…"
                            className="w-full px-2 py-1 rounded border border-slate-200 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400"
                          />
                        </td>
                        <td className="text-center px-2 py-2">
                          <button
                            onClick={() => persist(row, { paid: !paid })}
                            disabled={savingId === row.asset_id}
                            className={`inline-flex items-center justify-center w-8 h-8 rounded-lg border transition-colors ${
                              paid
                                ? 'bg-emerald-500 border-emerald-500 text-white hover:bg-emerald-600'
                                : 'bg-white border-slate-300 text-slate-300 hover:border-emerald-400 hover:text-emerald-500'
                            }`}
                            title={paid ? 'Marked paid — click to undo' : 'Mark as paid'}
                          >
                            <CheckCircle2 className="w-5 h-5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {staff.length > 0 && (
                  <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                    <tr>
                      <td className="px-4 py-2 text-xs uppercase tracking-wider font-bold text-slate-500 whitespace-nowrap">
                        Week totals
                      </td>
                      <td colSpan={7} />
                      <td className="text-right px-3 py-2 font-bold text-emerald-700 tabular-nums bg-emerald-100/60">
                        {fmtMoney(totals.total)}
                      </td>
                      <td className="text-right px-2 py-2 font-semibold text-slate-700 tabular-nums">{fmtMoney(totals.expenses)}</td>
                      <td className="text-right px-2 py-2 font-semibold text-slate-700 tabular-nums">{fmtMoney(totals.advances)}</td>
                      <td className="text-right px-3 py-2 font-bold text-blue-700 tabular-nums bg-blue-100/60">
                        {fmtMoney(totals.balance)}
                      </td>
                      <td />
                      <td className="text-center px-2 py-2 text-xs font-medium text-slate-500">
                        {totals.paidCount} / {staff.length}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
          </div>
        </div>

        {/* Weekly Profit & Loss */}
        <PnlPanel pnl={pnl} onOpenJob={(row) => navigate(`/admin/crm/planner?view=week&date=${row.date}`)} />
      </div>
    </CRMLayout>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function SummaryCard({
  label, value, accent,
}: { label: string; value: string; accent: 'emerald' | 'amber' | 'violet' | 'blue' }) {
  const ACC: Record<typeof accent, string> = {
    emerald: 'text-emerald-700 bg-emerald-50 ring-emerald-100',
    amber:   'text-amber-700   bg-amber-50   ring-amber-100',
    violet:  'text-violet-700  bg-violet-50  ring-violet-100',
    blue:    'text-blue-700    bg-blue-50    ring-blue-100',
  };
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="text-xs uppercase tracking-wider font-semibold text-slate-500">{label}</div>
      <div className={`mt-2 inline-flex px-3 py-1 rounded-lg text-2xl font-bold ring-1 ring-inset ${ACC[accent]} tabular-nums`}>
        {value}
      </div>
    </div>
  );
}

function MoneyInput({
  value, onChange, onCommit,
}: { value: number; onChange: (v: number) => void; onCommit: (v: number) => void }) {
  const [text, setText] = useState(String(value || ''));
  // Sync external value when it changes (e.g. after refetch).
  useEffect(() => { setText(value ? String(value) : ''); }, [value]);

  return (
    <div className="relative">
      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">£</span>
      <input
        type="text"
        inputMode="decimal"
        value={text}
        onChange={e => {
          const v = e.target.value.replace(/[^0-9.]/g, '');
          setText(v);
          onChange(parseFloat(v) || 0);
        }}
        onBlur={() => {
          // Always commit on blur. We can't compare against `value` here because the
          // parent updates `value` live via onChange, so n === value would always be true.
          onCommit(parseFloat(text) || 0);
        }}
        placeholder="0"
        className="w-24 pl-5 pr-1 py-1 rounded border border-slate-200 text-xs text-right tabular-nums focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400"
      />
    </div>
  );
}

type PnlSortKey = 'date' | 'label' | 'income' | 'wages' | 'expenses' | 'profit';
type SortDir = 'asc' | 'desc';

// Flat Rate VAT scheme: ticking a job uplifts its income by this fraction,
// which flows straight into its profit (and the week totals).
const FLAT_RATE_UPLIFT = 0.08;
const pnlRowKey = (r: { source: string; id: number }) => `${r.source}-${r.id}`;

// Numeric columns lead with their largest value (e.g. most profitable job on
// top) on first click; date/job lead ascending. Re-clicking a column flips it.
const NUMERIC_KEYS: PnlSortKey[] = ['income', 'wages', 'expenses', 'profit'];
function defaultDirFor(key: PnlSortKey): SortDir {
  return NUMERIC_KEYS.includes(key) ? 'desc' : 'asc';
}

// Clickable column header with an asc/desc chevron. A faint placeholder chevron
// keeps spacing stable and hints sortability on hover.
function SortHeader({ label, columnKey, active, dir, onSort, align }: {
  label: string;
  columnKey: PnlSortKey;
  active: boolean;
  dir: SortDir;
  onSort: (key: PnlSortKey) => void;
  align: 'left' | 'right';
}) {
  return (
    <button
      type="button"
      onClick={() => onSort(columnKey)}
      title={`Sort by ${label}`}
      className={`group inline-flex items-center gap-1 font-semibold hover:text-slate-900 ${align === 'right' ? 'flex-row-reverse' : ''}`}
    >
      <span>{label}</span>
      {active
        ? (dir === 'asc' ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />)
        : <ChevronUp className="w-3.5 h-3.5 opacity-0 group-hover:opacity-30" />}
    </button>
  );
}

function PnlPanel({
  pnl, onOpenJob,
}: { pnl: WeeklyPnlResponse | null; onOpenJob: (row: WeeklyPnlResponse['jobs'][number]) => void }) {
  const jobs = pnl?.jobs ?? [];

  const [sortKey, setSortKey] = useState<PnlSortKey>('date');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // Local flat-rate flags layered over the server values so a tick updates
  // instantly while it persists in the background. Reseeded whenever the
  // underlying week data changes.
  const [flatRate, setFlatRate] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const seed: Record<string, boolean> = {};
    for (const j of pnl?.jobs ?? []) seed[pnlRowKey(j)] = j.vat_flat_rate;
    setFlatRate(seed);
  }, [pnl]);

  const onSort = (key: PnlSortKey) => {
    if (key === sortKey) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(defaultDirFor(key));
    }
  };

  const toggleFlatRate = async (row: WeeklyPnlRow) => {
    const key = pnlRowKey(row);
    const next = !row.vat_flat_rate;
    setFlatRate(f => ({ ...f, [key]: next })); // optimistic
    try {
      await api.patch('/wages/pnl/flat-rate', { source: row.source, id: row.id, vat_flat_rate: next });
    } catch {
      setFlatRate(f => ({ ...f, [key]: !next })); // rollback on failure
    }
  };

  // Apply the 8% uplift to ticked rows; income and profit both rise by the same
  // amount, untouched rows pass through unchanged.
  const rows = useMemo<WeeklyPnlRow[]>(() => jobs.map(j => {
    const on = flatRate[pnlRowKey(j)] ?? j.vat_flat_rate;
    const uplift = on ? j.income * FLAT_RATE_UPLIFT : 0;
    return { ...j, vat_flat_rate: on, income: j.income + uplift, profit: j.profit + uplift };
  }), [jobs, flatRate]);

  const sortedJobs = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const primary = sortKey === 'label'
        ? a.label.localeCompare(b.label)
        : sortKey === 'date'
          ? a.date.localeCompare(b.date) // ISO YYYY-MM-DD sorts lexicographically
          : a[sortKey] - b[sortKey];
      if (primary !== 0) return primary * dir;
      // Stable tiebreak so equal values keep a sensible order.
      return a.date.localeCompare(b.date) || a.label.localeCompare(b.label);
    });
  }, [rows, sortKey, sortDir]);

  // Totals reflect the uplift so the summary cards and footer stay consistent.
  const totals = useMemo(() => {
    const t = rows.reduce((acc, r) => {
      acc.income += r.income; acc.wages += r.wages; acc.expenses += r.expenses; acc.profit += r.profit;
      return acc;
    }, { income: 0, wages: 0, expenses: 0, profit: 0 });
    return {
      income: +t.income.toFixed(2), wages: +t.wages.toFixed(2),
      expenses: +t.expenses.toFixed(2), profit: +t.profit.toFixed(2),
    };
  }, [rows]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-bold text-slate-900">Profit &amp; Loss</h2>
        <span className="text-xs text-slate-500">Operational, this week (ex-VAT)</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <SummaryCard label="Income" value={fmtMoney(totals.income)} accent="emerald" />
        <SummaryCard label="Wages" value={fmtMoney(totals.wages)} accent="violet" />
        <SummaryCard label="Expenses" value={fmtMoney(totals.expenses)} accent="amber" />
        <SummaryCard label="Operational profit" value={fmtMoney(totals.profit)} accent="blue" />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="text-left px-4 py-2 whitespace-nowrap">
                  <SortHeader label="Date" columnKey="date" active={sortKey === 'date'} dir={sortDir} onSort={onSort} align="left" />
                </th>
                <th className="text-left px-4 py-2">
                  <SortHeader label="Job" columnKey="label" active={sortKey === 'label'} dir={sortDir} onSort={onSort} align="left" />
                </th>
                <th className="text-right px-3 py-2">
                  <SortHeader label="Income" columnKey="income" active={sortKey === 'income'} dir={sortDir} onSort={onSort} align="right" />
                </th>
                <th className="text-right px-3 py-2">
                  <SortHeader label="Wages" columnKey="wages" active={sortKey === 'wages'} dir={sortDir} onSort={onSort} align="right" />
                </th>
                <th className="text-right px-3 py-2">
                  <SortHeader label="Expenses" columnKey="expenses" active={sortKey === 'expenses'} dir={sortDir} onSort={onSort} align="right" />
                </th>
                <th className="text-right px-3 py-2 text-slate-700 bg-blue-50/50">
                  <SortHeader label="Profit" columnKey="profit" active={sortKey === 'profit'} dir={sortDir} onSort={onSort} align="right" />
                </th>
                <th
                  className="text-center px-3 py-2 font-semibold whitespace-nowrap"
                  title="Flat Rate VAT — tick to add 8% to this job's income"
                >
                  8%
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {jobs.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-slate-400">
                  No jobs this week. Schedule jobs on the planner to see P&amp;L here.
                </td></tr>
              )}
              {sortedJobs.map(row => (
                <tr key={`${row.source}-${row.id}`}>
                  <td className="px-4 py-2 whitespace-nowrap text-slate-600 tabular-nums">
                    {fmtPnlDate(row.date)}
                  </td>
                  <td className="px-4 py-2">
                    <button
                      type="button"
                      onClick={() => onOpenJob(row)}
                      className="font-medium text-slate-800 hover:text-indigo-700 hover:underline text-left"
                      title="Open in planner"
                    >
                      {row.label}
                    </button>
                  </td>
                  <td className="text-right px-3 py-2 tabular-nums text-slate-700">{fmtMoney(row.income)}</td>
                  <td className="text-right px-3 py-2 tabular-nums text-slate-700">{fmtMoney(row.wages)}</td>
                  <td className="text-right px-3 py-2 tabular-nums text-slate-700">{fmtMoney(row.expenses)}</td>
                  <td className={`text-right px-3 py-2 font-bold tabular-nums bg-blue-50/40 ${row.profit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                    {fmtMoney(row.profit)}
                  </td>
                  <td className="text-center px-3 py-2">
                    <input
                      type="checkbox"
                      checked={row.vat_flat_rate}
                      onChange={() => toggleFlatRate(row)}
                      title="Flat Rate VAT — add 8% to this job's income"
                      className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-400 cursor-pointer"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
            {jobs.length > 0 && (
              <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                <tr>
                  <td className="px-4 py-2" />
                  <td className="px-4 py-2 text-xs uppercase tracking-wider font-bold text-slate-500">Week totals</td>
                  <td className="text-right px-3 py-2 font-semibold text-slate-700 tabular-nums">{fmtMoney(totals.income)}</td>
                  <td className="text-right px-3 py-2 font-semibold text-slate-700 tabular-nums">{fmtMoney(totals.wages)}</td>
                  <td className="text-right px-3 py-2 font-semibold text-slate-700 tabular-nums">{fmtMoney(totals.expenses)}</td>
                  <td className={`text-right px-3 py-2 font-bold tabular-nums bg-blue-100/60 ${totals.profit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                    {fmtMoney(totals.profit)}
                  </td>
                  <td className="px-3 py-2" />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
