import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Banknote, RefreshCw, CheckCircle2 } from 'lucide-react';
import CRMLayout from '../../components/CRMLayout';
import api from '../../lib/api';

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

  async function load() {
    setLoading(true);
    try {
      const r = await api.get<WagesWeekResponse>('/wages/week', { params: { start: weekStart } });
      setData(r.data);
    } catch (err) {
      console.error('Failed to load wages', err);
      setData(null);
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
                                  onClick={() => navigate(`/admin/crm/planner?view=week&date=${d}`)}
                                  title="Open this day in the weekly planner"
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

        {/* Company spend — full-width strip below the staff table */}
        <CompanyPanel summary={data?.summary} />
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

function CompanyPanel({ summary }: { summary?: WagesWeekResponse['summary'] }) {
  const roles = summary?.by_role ?? [];
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <Banknote className="w-4 h-4 text-slate-500" />
            Company spend
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">By role, this week</p>
        </div>
        <div className="text-right">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">Total</div>
          <div className="text-xl font-bold text-emerald-700 tabular-nums">
            {fmtMoney(summary?.total_earnings ?? 0)}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {roles.length === 0 && (
          <p className="text-xs text-slate-400 italic">No data yet.</p>
        )}
        {roles.map(r => (
          <div key={r.role} className="flex items-center gap-3 rounded-lg border border-slate-100 px-3 py-2 min-w-[180px]">
            <span className="text-xs font-medium text-slate-600 capitalize">{r.role}</span>
            <div className="ml-auto text-right">
              <div className="text-sm font-bold text-slate-800 tabular-nums">{fmtMoney(r.total)}</div>
              <div className="text-[10px] text-slate-400">{r.headcount} {r.headcount === 1 ? 'person' : 'people'}</div>
            </div>
          </div>
        ))}
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
