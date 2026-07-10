/**
 * Finances — the company money page.
 *
 * Top: the weekly job P&L (moved here from the Wages page) plus manual
 * "other income" entries for the same week (van rental, delivery work, …).
 * Middle: trend charts — weekly profit for the last 13 weeks and monthly
 * profit for the last 12 months, each with a ghost series showing the same
 * period last year once that data exists.
 * Bottom: a monthly breakdown (every week of the selected month with income,
 * wages, expenses, profit and margin) and the fixed admin-costs editor that
 * turns operational profit into net profit.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronLeft, ChevronRight, Loader2, PiggyBank, Plus, RefreshCw, Trash2, TrendingUp,
} from 'lucide-react';
import CRMLayout from '../../components/CRMLayout';
import PnlPanel from '../../components/PnlPanel';
import { MonthlyBarsChart, WeeklyTrendChart, type ChartPoint } from '../../components/finance/TrendCharts';
import api from '../../lib/api';
import type { WeeklyPnlResponse } from '../../types';

// ── Types (mirror server/routes/finance.js) ──────────────────────────────────

interface OverviewWeek {
  week_start: string;
  job_count: number;
  income: number;
  wages: number;
  expenses: number;
  profit: number;
}

interface ExtraIncomeEntry {
  id: number;
  week_start: string;
  label: string;
  income: number;
  profit: number;
}

interface AdminCostRow {
  id: number;
  label: string;
  monthly_cost: number;
}

interface OverviewResponse {
  from: string;
  to: string;
  weeks: OverviewWeek[];
  extra_income: ExtraIncomeEntry[];
  admin_costs: AdminCostRow[];
}

// ── Date helpers (local time, Monday weeks) ──────────────────────────────────

function mondayOf(d: Date): Date {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const m = new Date(d);
  m.setHours(0, 0, 0, 0);
  m.setDate(m.getDate() + diff);
  return m;
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return isoDate(dt);
}

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

function fmtMoney(n: number): string {
  return `£${(Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function fmtWeekRange(start: string): string {
  const s = new Date(start + 'T00:00:00');
  const e = new Date(start + 'T00:00:00');
  e.setDate(e.getDate() + 6);
  const sStr = s.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const eStr = e.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  return `${sStr} – ${eStr}`;
}

function pctLabel(profit: number, income: number): string {
  if (!income) return '—';
  return `${Math.round((profit / income) * 100)}%`;
}

// How far back the overview reaches: 12 navigable months plus the year-earlier
// ghost data for both charts (~2 years of Mondays, under the server's cap).
const OVERVIEW_WEEKS_BACK = 111;

// ── Page ─────────────────────────────────────────────────────────────────────

export default function CRMFinances() {
  const navigate = useNavigate();
  const topRef = useRef<HTMLDivElement>(null);

  const currentMonday = useMemo(() => isoDate(mondayOf(new Date())), []);
  const currentMonth = useMemo(() => isoDate(new Date()).slice(0, 7), []);

  const [weekStart, setWeekStart] = useState(currentMonday);
  const [month, setMonth] = useState(currentMonth);

  // Selected week's P&L (fast, refetched on week change).
  const [pnl, setPnl] = useState<WeeklyPnlResponse | null>(null);
  const [pnlLoading, setPnlLoading] = useState(true);

  // Selected week's manual entries (kept separate from the overview so the
  // editor works even outside the overview window).
  const [weekExtras, setWeekExtras] = useState<ExtraIncomeEntry[]>([]);

  // Long-range totals for charts + the monthly breakdown (slow, fetched once
  // and silently refreshed after edits — the previous render holds meanwhile).
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);

  const loadWeek = useCallback(async () => {
    setPnlLoading(true);
    try {
      const [pnlRes, extraRes] = await Promise.all([
        api.get<WeeklyPnlResponse>('/wages/pnl', { params: { start: weekStart } }),
        api.get<ExtraIncomeEntry[]>('/finance/extra-income', { params: { from: weekStart, to: weekStart } }),
      ]);
      setPnl(pnlRes.data);
      setWeekExtras(extraRes.data);
    } catch (err) {
      console.error('Failed to load weekly P&L', err);
      setPnl(null);
      setWeekExtras([]);
    } finally {
      setPnlLoading(false);
    }
  }, [weekStart]);

  const loadOverview = useCallback(async (silent = false) => {
    if (!silent) setOverviewLoading(true);
    try {
      const from = addDays(currentMonday, -7 * OVERVIEW_WEEKS_BACK);
      const r = await api.get<OverviewResponse>('/finance/overview', { params: { from, to: currentMonday } });
      setOverview(r.data);
    } catch (err) {
      console.error('Failed to load finance overview', err);
    } finally {
      setOverviewLoading(false);
    }
  }, [currentMonday]);

  useEffect(() => { loadWeek(); }, [loadWeek]);
  useEffect(() => { loadOverview(); }, [loadOverview]);

  const refreshAfterEdit = useCallback(() => {
    loadWeek();
    loadOverview(true);
  }, [loadWeek, loadOverview]);

  // ── Derived: lookup maps over the overview window ──────────────────────────

  const weekByStart = useMemo(() => {
    const m = new Map<string, OverviewWeek>();
    for (const w of overview?.weeks ?? []) m.set(w.week_start, w);
    return m;
  }, [overview]);

  const extrasByWeek = useMemo(() => {
    const m = new Map<string, ExtraIncomeEntry[]>();
    for (const e of overview?.extra_income ?? []) {
      const list = m.get(e.week_start);
      if (list) list.push(e); else m.set(e.week_start, [e]);
    }
    return m;
  }, [overview]);

  // Combined weekly profit = job P&L profit + manual extra profit.
  const combinedWeek = useCallback((monday: string): { income: number; profit: number } | null => {
    const w = weekByStart.get(monday);
    if (!w) return null;
    const extras = extrasByWeek.get(monday) ?? [];
    return {
      income: w.income + extras.reduce((s, e) => s + e.income, 0),
      profit: w.profit + extras.reduce((s, e) => s + e.profit, 0),
    };
  }, [weekByStart, extrasByWeek]);

  // ── Charts data ─────────────────────────────────────────────────────────────

  const weeklyPoints = useMemo<ChartPoint[]>(() => {
    const pts: ChartPoint[] = [];
    for (let i = 12; i >= 0; i--) {
      const monday = addDays(currentMonday, -7 * i);
      const cur = combinedWeek(monday);
      const ghost = combinedWeek(addDays(monday, -364));
      const d = new Date(monday + 'T00:00:00');
      pts.push({
        key: monday,
        label: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
        fullLabel: `Week of ${fmtWeekRange(monday)}`,
        value: cur?.profit ?? 0,
        ghostValue: ghost && ghost.profit !== 0 ? ghost.profit : ghost ? 0 : null,
      });
    }
    // Hide the ghost entirely while last year has no data at all, so a flat
    // zero line doesn't imply "we made nothing last year".
    if (pts.every(p => !p.ghostValue)) for (const p of pts) p.ghostValue = null;
    return pts;
  }, [currentMonday, combinedWeek]);

  // Month totals over the overview window, keyed YYYY-MM (weeks belong to the
  // month their Monday falls in).
  const monthTotals = useMemo(() => {
    const m = new Map<string, { income: number; wages: number; expenses: number; opProfit: number; extraIncome: number; extraProfit: number }>();
    for (const w of overview?.weeks ?? []) {
      const key = w.week_start.slice(0, 7);
      const t = m.get(key) ?? { income: 0, wages: 0, expenses: 0, opProfit: 0, extraIncome: 0, extraProfit: 0 };
      t.income += w.income; t.wages += w.wages; t.expenses += w.expenses; t.opProfit += w.profit;
      for (const e of extrasByWeek.get(w.week_start) ?? []) { t.extraIncome += e.income; t.extraProfit += e.profit; }
      m.set(key, t);
    }
    return m;
  }, [overview, extrasByWeek]);

  const monthlyPoints = useMemo<ChartPoint[]>(() => {
    const pts: ChartPoint[] = [];
    for (let i = 11; i >= 0; i--) {
      const ym = shiftMonth(currentMonth, -i);
      const cur = monthTotals.get(ym);
      const ghost = monthTotals.get(shiftMonth(ym, -12));
      const [y, mo] = ym.split('-').map(Number);
      pts.push({
        key: ym,
        label: new Date(y, mo - 1, 1).toLocaleDateString('en-GB', { month: 'short' }),
        fullLabel: monthLabel(ym),
        value: cur ? cur.opProfit + cur.extraProfit : 0,
        ghostValue: ghost ? ghost.opProfit + ghost.extraProfit : null,
      });
    }
    if (pts.every(p => !p.ghostValue)) for (const p of pts) p.ghostValue = null;
    return pts;
  }, [currentMonth, monthTotals]);

  // ── Monthly breakdown for the selected month ────────────────────────────────

  const monthWeeks = useMemo(
    () => (overview?.weeks ?? []).filter(w => w.week_start.slice(0, 7) === month),
    [overview, month],
  );
  const monthSum = monthTotals.get(month) ?? { income: 0, wages: 0, expenses: 0, opProfit: 0, extraIncome: 0, extraProfit: 0 };
  const adminCosts = overview?.admin_costs ?? [];
  const adminTotal = adminCosts.reduce((s, c) => s + c.monthly_cost, 0);
  const monthIncome = monthSum.income + monthSum.extraIncome;
  const profitBeforeAdmin = monthSum.opProfit + monthSum.extraProfit;
  const netProfit = profitBeforeAdmin - adminTotal;

  const weekExtraProfit = weekExtras.reduce((s, e) => s + e.profit, 0);

  function openWeek(monday: string) {
    setWeekStart(monday);
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <CRMLayout>
      <div className="space-y-8">
        {/* Header + week nav (scopes the weekly section) */}
        <div ref={topRef} className="flex items-center justify-between flex-wrap gap-3 scroll-mt-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <TrendingUp className="w-6 h-6 text-blue-600" />
              Finances
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              Weekly job P&amp;L, side-business income, monthly profits, margins and admin costs.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setWeekStart(addDays(weekStart, -7))} className="p-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50" title="Previous week">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-semibold text-slate-700 min-w-[200px] text-center tabular-nums">
              {fmtWeekRange(weekStart)}
            </div>
            <button onClick={() => setWeekStart(addDays(weekStart, 7))} className="p-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50" title="Next week">
              <ChevronRight className="w-4 h-4" />
            </button>
            <button onClick={() => setWeekStart(currentMonday)} className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-600 hover:bg-slate-50">
              This week
            </button>
            <button onClick={refreshAfterEdit} className="p-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50" title="Refresh">
              <RefreshCw className={`w-4 h-4 ${pnlLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Weekly P&L (moved from the Wages page) */}
        {pnlLoading && !pnl ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 text-slate-400 animate-spin" /></div>
        ) : (
          <div className={pnlLoading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
            <PnlPanel pnl={pnl} onOpenJob={row => navigate(`/admin/crm/planner?view=week&date=${row.date}`)} />
          </div>
        )}

        {/* Other income for the selected week */}
        <ExtraIncomeCard
          weekStart={weekStart}
          entries={weekExtras}
          jobProfit={pnl ? pnl.totals.profit : 0}
          extraProfit={weekExtraProfit}
          onChanged={refreshAfterEdit}
        />

        {/* Trends */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-slate-900">Trends</h2>
            <span className="text-xs text-slate-500">Profit including other income, before admin costs</span>
          </div>
          <div className={`grid grid-cols-1 xl:grid-cols-2 gap-4 ${overviewLoading && overview ? 'opacity-60' : ''}`}>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <h3 className="text-sm font-bold text-slate-800 mb-2">Weekly profit · last 13 weeks</h3>
              {overview ? (
                <WeeklyTrendChart points={weeklyPoints} ghostLabel="Same weeks last year" />
              ) : (
                <div className="h-[220px] flex items-center justify-center"><Loader2 className="w-5 h-5 text-slate-300 animate-spin" /></div>
              )}
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <h3 className="text-sm font-bold text-slate-800 mb-2">Monthly profit · last 12 months</h3>
              {overview ? (
                <MonthlyBarsChart points={monthlyPoints} ghostLabel="Same month last year" />
              ) : (
                <div className="h-[220px] flex items-center justify-center"><Loader2 className="w-5 h-5 text-slate-300 animate-spin" /></div>
              )}
            </div>
          </div>
        </div>

        {/* Monthly breakdown */}
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-slate-900">Monthly breakdown</h2>
              <span className="text-xs text-slate-500">Week by week, with admin costs taken off the bottom line</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setMonth(shiftMonth(month, -1))}
                disabled={shiftMonth(currentMonth, -12) === month}
                className="p-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                title="Previous month"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-semibold text-slate-700 min-w-[160px] text-center">
                {monthLabel(month)}
              </div>
              <button
                onClick={() => setMonth(shiftMonth(month, 1))}
                disabled={month === currentMonth}
                className="p-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                title="Next month"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              {month !== currentMonth && (
                <button onClick={() => setMonth(currentMonth)} className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-600 hover:bg-slate-50">
                  This month
                </button>
              )}
            </div>
          </div>

          {/* Month summary cards */}
          <div className={`grid grid-cols-1 md:grid-cols-4 gap-4 ${overviewLoading && overview ? 'opacity-60' : ''}`}>
            <MonthCard label="Income" value={fmtMoney(monthIncome)} sub={monthSum.extraIncome > 0 ? `incl. ${fmtMoney(monthSum.extraIncome)} other income` : 'Jobs + other income'} tone="emerald" />
            <MonthCard label="Profit before admin" value={fmtMoney(profitBeforeAdmin)} sub={`${pctLabel(profitBeforeAdmin, monthIncome)} margin`} tone="blue" />
            <MonthCard label="Admin costs" value={fmtMoney(adminTotal)} sub={`${adminCosts.length} monthly item${adminCosts.length === 1 ? '' : 's'}`} tone="amber" />
            <MonthCard label="Net profit" value={fmtMoney(netProfit)} sub={`${pctLabel(netProfit, monthIncome)} net margin`} tone={netProfit >= 0 ? 'emerald' : 'red'} strong />
          </div>

          {/* Weeks of the month */}
          <div className={`bg-white rounded-xl border border-slate-200 overflow-hidden ${overviewLoading && overview ? 'opacity-60' : ''}`}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="text-left px-4 py-2 font-semibold whitespace-nowrap">Week</th>
                    <th className="text-right px-3 py-2 font-semibold">Jobs</th>
                    <th className="text-right px-3 py-2 font-semibold">Income</th>
                    <th className="text-right px-3 py-2 font-semibold">Wages</th>
                    <th className="text-right px-3 py-2 font-semibold">Expenses</th>
                    <th className="text-right px-3 py-2 font-semibold">Other income</th>
                    <th className="text-right px-3 py-2 font-semibold bg-blue-50/50">Profit</th>
                    <th className="text-right px-3 py-2 font-semibold">Margin</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {!overview && (
                    <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin inline" /></td></tr>
                  )}
                  {overview && monthWeeks.length === 0 && (
                    <tr><td colSpan={9} className="px-4 py-10 text-center text-sm text-slate-400">No weeks recorded in this month.</td></tr>
                  )}
                  {monthWeeks.map((w, i) => {
                    const extras = extrasByWeek.get(w.week_start) ?? [];
                    const extraIncome = extras.reduce((s, e) => s + e.income, 0);
                    const extraProfit = extras.reduce((s, e) => s + e.profit, 0);
                    const income = w.income + extraIncome;
                    const profit = w.profit + extraProfit;
                    return (
                      <tr key={w.week_start} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <span className="inline-flex items-center justify-center w-9 h-5 rounded-full bg-slate-100 text-[11px] font-bold text-slate-600 mr-2">W{i + 1}</span>
                          <span className="text-slate-700 tabular-nums">{fmtWeekRange(w.week_start)}</span>
                        </td>
                        <td className="text-right px-3 py-2.5 tabular-nums text-slate-500">{w.job_count}</td>
                        <td className="text-right px-3 py-2.5 tabular-nums text-slate-700">{fmtMoney(income)}</td>
                        <td className="text-right px-3 py-2.5 tabular-nums text-slate-700">{fmtMoney(w.wages)}</td>
                        <td className="text-right px-3 py-2.5 tabular-nums text-slate-700">{fmtMoney(w.expenses)}</td>
                        <td className="text-right px-3 py-2.5 tabular-nums text-slate-700">{extraIncome > 0 ? fmtMoney(extraIncome) : <span className="text-slate-300">—</span>}</td>
                        <td className={`text-right px-3 py-2.5 font-bold tabular-nums bg-blue-50/40 ${profit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{fmtMoney(profit)}</td>
                        <td className="text-right px-3 py-2.5 tabular-nums text-slate-500">{pctLabel(profit, income)}</td>
                        <td className="text-right px-3 py-2.5">
                          <button onClick={() => openWeek(w.week_start)} className="text-xs font-semibold text-blue-600 hover:text-blue-800 hover:underline whitespace-nowrap">
                            View week
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {overview && monthWeeks.length > 0 && (
                  <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                    <tr>
                      <td className="px-4 py-2 text-xs uppercase tracking-wider font-bold text-slate-500">Month totals</td>
                      <td className="text-right px-3 py-2 font-semibold text-slate-500 tabular-nums">{monthWeeks.reduce((s, w) => s + w.job_count, 0)}</td>
                      <td className="text-right px-3 py-2 font-semibold text-slate-700 tabular-nums">{fmtMoney(monthIncome)}</td>
                      <td className="text-right px-3 py-2 font-semibold text-slate-700 tabular-nums">{fmtMoney(monthSum.wages)}</td>
                      <td className="text-right px-3 py-2 font-semibold text-slate-700 tabular-nums">{fmtMoney(monthSum.expenses)}</td>
                      <td className="text-right px-3 py-2 font-semibold text-slate-700 tabular-nums">{monthSum.extraIncome > 0 ? fmtMoney(monthSum.extraIncome) : '—'}</td>
                      <td className={`text-right px-3 py-2 font-bold tabular-nums bg-blue-100/60 ${profitBeforeAdmin >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{fmtMoney(profitBeforeAdmin)}</td>
                      <td className="text-right px-3 py-2 font-semibold text-slate-500 tabular-nums">{pctLabel(profitBeforeAdmin, monthIncome)}</td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>

        {/* Admin costs */}
        <AdminCostsCard costs={adminCosts} onChanged={() => loadOverview(true)} />
      </div>
    </CRMLayout>
  );
}

// ── Month summary card ───────────────────────────────────────────────────────

function MonthCard({
  label, value, sub, tone, strong = false,
}: { label: string; value: string; sub: string; tone: 'emerald' | 'blue' | 'amber' | 'red'; strong?: boolean }) {
  const TONE: Record<typeof tone, string> = {
    emerald: 'text-emerald-700 bg-emerald-50 ring-emerald-100',
    blue:    'text-blue-700    bg-blue-50    ring-blue-100',
    amber:   'text-amber-700   bg-amber-50   ring-amber-100',
    red:     'text-red-700     bg-red-50     ring-red-100',
  };
  return (
    <div className={`bg-white rounded-xl border p-4 ${strong ? 'border-slate-300 shadow-sm' : 'border-slate-200'}`}>
      <div className="text-xs uppercase tracking-wider font-semibold text-slate-500">{label}</div>
      <div className={`mt-2 inline-flex px-3 py-1 rounded-lg text-2xl font-bold ring-1 ring-inset ${TONE[tone]}`}>{value}</div>
      <div className="mt-1 text-xs text-slate-400">{sub}</div>
    </div>
  );
}

// ── Other income (manual weekly entries) ─────────────────────────────────────

function ExtraIncomeCard({
  weekStart, entries, jobProfit, extraProfit, onChanged,
}: {
  weekStart: string;
  entries: ExtraIncomeEntry[];
  jobProfit: number;
  extraProfit: number;
  onChanged: () => void;
}) {
  const [label, setLabel] = useState('');
  const [income, setIncome] = useState('');
  const [profit, setProfit] = useState('');
  const [busy, setBusy] = useState(false);

  // Reset the add-row when the week changes so half-typed entries don't leak.
  useEffect(() => { setLabel(''); setIncome(''); setProfit(''); }, [weekStart]);

  async function add() {
    if (!label.trim()) return;
    setBusy(true);
    try {
      await api.post('/finance/extra-income', {
        week_start: weekStart,
        label: label.trim(),
        income: parseFloat(income) || 0,
        profit: profit.trim() === '' ? undefined : parseFloat(profit) || 0,
      });
      setLabel(''); setIncome(''); setProfit('');
      onChanged();
    } catch (err) {
      console.error('Failed to add extra income', err);
    } finally {
      setBusy(false);
    }
  }

  async function patch(id: number, body: Partial<ExtraIncomeEntry>) {
    try {
      await api.patch(`/finance/extra-income/${id}`, body);
      onChanged();
    } catch (err) {
      console.error('Failed to update extra income', err);
    }
  }

  async function remove(id: number) {
    setBusy(true);
    try {
      await api.delete(`/finance/extra-income/${id}`);
      onChanged();
    } catch (err) {
      console.error('Failed to delete extra income', err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <PiggyBank className="w-4 h-4 text-emerald-600" />
          <h3 className="text-sm font-bold text-slate-800">Other income this week</h3>
          <span className="text-xs text-slate-400">van rental, deliveries, anything outside the job P&amp;L</span>
        </div>
        <div className="text-sm text-slate-600">
          Week total incl. other income:{' '}
          <span className={`font-bold tabular-nums ${jobProfit + extraProfit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
            {fmtMoney(jobProfit + extraProfit)}
          </span>
        </div>
      </div>
      <div className="divide-y divide-slate-50">
        {entries.map(e => (
          <div key={e.id} className="px-4 py-2 flex items-center gap-3">
            <span className="min-w-0 flex-1 text-sm font-medium text-slate-800 truncate">{e.label}</span>
            <label className="flex items-center gap-1 text-xs text-slate-400">
              Income
              <MiniMoneyInput value={e.income} onCommit={v => { if (v !== e.income) patch(e.id, { income: v }); }} />
            </label>
            <label className="flex items-center gap-1 text-xs text-slate-400">
              Profit
              <MiniMoneyInput value={e.profit} onCommit={v => { if (v !== e.profit) patch(e.id, { profit: v }); }} />
            </label>
            <button
              onClick={() => remove(e.id)}
              disabled={busy}
              className="p-1.5 rounded-md text-slate-300 hover:text-red-600 hover:bg-red-50 transition-colors"
              title={`Delete "${e.label}"`}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        {/* Add row */}
        <div className="px-4 py-2.5 flex items-center gap-3 bg-slate-50/50">
          <input
            value={label}
            onChange={e => setLabel(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') add(); }}
            placeholder="e.g. Van rental"
            className="min-w-0 flex-1 px-2 py-1.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400"
          />
          <label className="flex items-center gap-1 text-xs text-slate-400">
            Income
            <input value={income} onChange={e => setIncome(e.target.value.replace(/[^0-9.]/g, ''))} onKeyDown={e => { if (e.key === 'Enter') add(); }} placeholder="0" inputMode="decimal"
              className="w-24 px-2 py-1.5 rounded-lg border border-slate-200 text-sm text-right tabular-nums focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400" />
          </label>
          <label className="flex items-center gap-1 text-xs text-slate-400" title="Leave empty to count the full income as profit">
            Profit
            <input value={profit} onChange={e => setProfit(e.target.value.replace(/[^0-9.]/g, ''))} onKeyDown={e => { if (e.key === 'Enter') add(); }} placeholder="= income" inputMode="decimal"
              className="w-24 px-2 py-1.5 rounded-lg border border-slate-200 text-sm text-right tabular-nums focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400" />
          </label>
          <button
            onClick={add}
            disabled={busy || !label.trim()}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Admin costs editor ───────────────────────────────────────────────────────

function AdminCostsCard({ costs, onChanged }: { costs: AdminCostRow[]; onChanged: () => void }) {
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const total = costs.reduce((s, c) => s + c.monthly_cost, 0);

  async function add() {
    if (!label.trim()) return;
    setBusy(true);
    try {
      await api.post('/finance/admin-costs', { label: label.trim(), monthly_cost: parseFloat(amount) || 0 });
      setLabel(''); setAmount('');
      onChanged();
    } catch (err) {
      console.error('Failed to add admin cost', err);
    } finally {
      setBusy(false);
    }
  }

  async function patch(id: number, body: Partial<AdminCostRow>) {
    try {
      await api.patch(`/finance/admin-costs/${id}`, body);
      onChanged();
    } catch (err) {
      console.error('Failed to update admin cost', err);
    }
  }

  async function remove(id: number) {
    setBusy(true);
    try {
      await api.delete(`/finance/admin-costs/${id}`);
      onChanged();
    } catch (err) {
      console.error('Failed to delete admin cost', err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden max-w-2xl">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-bold text-slate-800">Monthly admin costs</h3>
          <p className="text-xs text-slate-400 mt-0.5">Fixed overheads taken off every month's profit — rent, software, insurance, accountancy…</p>
        </div>
        <div className="text-sm text-slate-600">
          Total: <span className="font-bold text-amber-700 tabular-nums">{fmtMoney(total)}</span>
          <span className="text-xs text-slate-400"> /month</span>
        </div>
      </div>
      <div className="divide-y divide-slate-50">
        {costs.map(c => (
          <div key={c.id} className="px-4 py-2 flex items-center gap-3">
            <span className="min-w-0 flex-1 text-sm font-medium text-slate-800 truncate">{c.label}</span>
            <MiniMoneyInput value={c.monthly_cost} onCommit={v => { if (v !== c.monthly_cost) patch(c.id, { monthly_cost: v }); }} />
            <button
              onClick={() => remove(c.id)}
              disabled={busy}
              className="p-1.5 rounded-md text-slate-300 hover:text-red-600 hover:bg-red-50 transition-colors"
              title={`Delete "${c.label}"`}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        {costs.length === 0 && (
          <div className="px-4 py-6 text-center text-sm text-slate-400">No admin costs yet — add your monthly overheads below.</div>
        )}
        <div className="px-4 py-2.5 flex items-center gap-3 bg-slate-50/50">
          <input
            value={label}
            onChange={e => setLabel(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') add(); }}
            placeholder="e.g. Office rent"
            className="min-w-0 flex-1 px-2 py-1.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400"
          />
          <input
            value={amount}
            onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
            onKeyDown={e => { if (e.key === 'Enter') add(); }}
            placeholder="£/month"
            inputMode="decimal"
            className="w-28 px-2 py-1.5 rounded-lg border border-slate-200 text-sm text-right tabular-nums focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400"
          />
          <button
            onClick={add}
            disabled={busy || !label.trim()}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 text-white text-sm font-semibold hover:bg-slate-900 disabled:opacity-50 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

// Small right-aligned money input that keeps local text state and commits on
// blur/Enter — mirrors the Wages page pattern.
function MiniMoneyInput({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(value ? String(value) : '');
  useEffect(() => { setText(value ? String(value) : ''); }, [value]);
  return (
    <div className="relative">
      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">£</span>
      <input
        value={text}
        onChange={e => setText(e.target.value.replace(/[^0-9.]/g, ''))}
        onBlur={() => onCommit(parseFloat(text) || 0)}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        inputMode="decimal"
        className="w-24 pl-5 pr-2 py-1 rounded-lg border border-slate-200 text-sm text-right tabular-nums focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400"
      />
    </div>
  );
}
