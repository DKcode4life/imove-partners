/**
 * Weekly Profit & Loss panel — summary cards + a sortable per-job table for
 * one week. Extracted from the Wages page and now hosted on the Finances
 * page; the parent owns week selection and passes the fetched payload in.
 */
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import api from '../lib/api';
import type { WeeklyPnlResponse, WeeklyPnlRow } from '../types';

// ── Shared formatting ─────────────────────────────────────────────────────────

function fmtMoney(n: number): string {
  return `£${(Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

// Compact "Mon 12 Jun" label for the P&L date column.
function fmtPnlDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  const day = d.toLocaleDateString('en-GB', { weekday: 'short' });
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return `${day} ${date}`;
}

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

export default function PnlPanel({
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
