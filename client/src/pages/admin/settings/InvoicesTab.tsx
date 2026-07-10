/**
 * Settings → Invoices — every raised invoice across the business in one list:
 * job invoices (deposit / final / ad-hoc) and weekly contract invoices, with
 * paid status, category filters (removals / contract / Lux), quick period
 * switching (this month, last month, this year, all time, any month), income
 * summaries and a performer ranking so "who earns us the most" is one glance.
 *
 * Data comes from GET /finance/invoices (already sorted newest-first); all
 * filtering and maths happen client-side so switching filters is instant.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Receipt, TrendingDown, TrendingUp, Trophy } from 'lucide-react';
import api from '../../../lib/api';

// ── Types (mirror server/routes/finance.js) ──────────────────────────────────

type Category = 'removal' | 'contract' | 'lux';

interface FinanceInvoice {
  key: string;
  family: 'job' | 'contract';
  category: Category;
  invoice_id: number;
  invoice_number: string;
  invoice_type: 'deposit' | 'main' | 'additional' | 'contract';
  label: string;
  detail: string | null;
  performer: string;
  total: number;
  paid: boolean;
  status: string;
  raised_at: string; // ISO datetime
  paid_at: string | null;
  job_id: number | null;
  contract_id: number | null;
  is_lux: boolean;
}

type PeriodKey = 'this-month' | 'last-month' | 'this-year' | 'all' | 'custom';
type CategoryFilter = 'all' | Category;

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtMoney(n: number): string {
  return `£${(Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

// Local-time YYYY-MM of a Date — month bucketing must follow the wall clock,
// not UTC, or late-evening invoices drift into the wrong month.
function ymOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return ymOf(d);
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const TYPE_LABEL: Record<FinanceInvoice['invoice_type'], string> = {
  deposit: 'Deposit',
  main: 'Final',
  additional: 'Ad-hoc',
  contract: 'Contract',
};

const CATEGORY_META: Record<Category, { label: string; dot: string }> = {
  removal:  { label: 'Removal',  dot: 'bg-sky-500' },
  contract: { label: 'Contract', dot: 'bg-violet-500' },
  lux:      { label: 'Lux',      dot: 'bg-blue-600' },
};

// ── Component ────────────────────────────────────────────────────────────────

export default function InvoicesTab() {
  const navigate = useNavigate();
  const [invoices, setInvoices] = useState<FinanceInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [period, setPeriod] = useState<PeriodKey>('this-month');
  const [customMonth, setCustomMonth] = useState<string>(() => ymOf(new Date()));
  const [category, setCategory] = useState<CategoryFilter>('all');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api.get<{ invoices: FinanceInvoice[] }>('/finance/invoices');
        if (!cancelled) setInvoices(r.data.invoices);
      } catch (e: any) {
        if (!cancelled) setError(e?.response?.data?.error || 'Failed to load invoices');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // The month this period maps to, or null for year/all-time views. Drives
  // both the filter and the "vs previous month" delta on the Invoiced card.
  const activeMonth: string | null = useMemo(() => {
    if (period === 'this-month') return ymOf(new Date());
    if (period === 'last-month') return shiftMonth(ymOf(new Date()), -1);
    if (period === 'custom') return customMonth || null;
    return null;
  }, [period, customMonth]);

  const inPeriod = useMemo(() => {
    const thisYear = String(new Date().getFullYear());
    return (row: FinanceInvoice): boolean => {
      if (period === 'all') return true;
      const d = new Date(row.raised_at);
      if (period === 'this-year') return String(d.getFullYear()) === thisYear;
      return activeMonth != null && ymOf(d) === activeMonth;
    };
  }, [period, activeMonth]);

  const inCategory = (row: FinanceInvoice) => category === 'all' || row.category === category;

  const filtered = useMemo(
    () => invoices.filter(r => inCategory(r) && inPeriod(r)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [invoices, category, inPeriod],
  );

  const sums = useMemo(() => {
    const t = { invoiced: 0, paid: 0, outstanding: 0 };
    for (const r of filtered) {
      t.invoiced += r.total;
      if (r.paid) t.paid += r.total; else t.outstanding += r.total;
    }
    return t;
  }, [filtered]);

  // All-time unpaid balance for the category scope, regardless of period.
  const allTimeOutstanding = useMemo(
    () => invoices.filter(inCategory).reduce((s, r) => (r.paid ? s : s + r.total), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [invoices, category],
  );

  // Invoiced total for the month before the active one → delta on the card.
  const prevMonthInvoiced = useMemo(() => {
    if (!activeMonth) return null;
    const prev = shiftMonth(activeMonth, -1);
    return invoices
      .filter(r => inCategory(r) && ymOf(new Date(r.raised_at)) === prev)
      .reduce((s, r) => s + r.total, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoices, category, activeMonth]);

  // Income per category for the period (shown when no category filter is on).
  const byCategory = useMemo(() => {
    const t: Record<Category, number> = { removal: 0, contract: 0, lux: 0 };
    for (const r of invoices) if (inPeriod(r)) t[r.category] += r.total;
    return t;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoices, inPeriod]);

  // Performer ranking for the period: each contractor is its own performer,
  // all private removal jobs pool into one bucket. Ranked by invoiced income.
  const performers = useMemo(() => {
    const map = new Map<string, { name: string; category: Category; invoiced: number; paid: number; count: number }>();
    for (const r of filtered) {
      const k = `${r.category}|${r.performer}`;
      const p = map.get(k) ?? { name: r.performer, category: r.category, invoiced: 0, paid: 0, count: 0 };
      p.invoiced += r.total;
      if (r.paid) p.paid += r.total;
      p.count += 1;
      map.set(k, p);
    }
    return [...map.values()].sort((a, b) => b.invoiced - a.invoiced);
  }, [filtered]);

  function openInvoice(row: FinanceInvoice) {
    if (row.family === 'job' && row.job_id != null) {
      navigate(`/admin/crm/${row.job_id}`);
    } else if (row.family === 'contract' && row.contract_id != null) {
      navigate(`/admin/crm/contract-jobs/${row.contract_id}/invoices/${row.invoice_id}`);
    }
  }

  const periodLabel =
    period === 'all' ? 'All time'
    : period === 'this-year' ? `${new Date().getFullYear()}`
    : activeMonth ? monthLabel(activeMonth)
    : '';

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
      </div>
    );
  }
  if (error) {
    return <div className="py-24 text-center text-sm text-red-600">{error}</div>;
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          {([
            ['this-month', 'This month'],
            ['last-month', 'Last month'],
            ['this-year', 'This year'],
            ['all', 'All time'],
          ] as [PeriodKey, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setPeriod(key)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                period === key
                  ? 'bg-slate-800 text-white'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              {label}
            </button>
          ))}
          <input
            type="month"
            value={period === 'custom' ? customMonth : ''}
            onChange={e => { if (e.target.value) { setCustomMonth(e.target.value); setPeriod('custom'); } }}
            title="Jump to any month"
            className={`px-2 py-1.5 rounded-lg text-sm border transition-colors cursor-pointer ${
              period === 'custom'
                ? 'bg-slate-800 text-white border-slate-800'
                : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
            }`}
          />
        </div>
        <div className="flex items-center gap-1.5">
          {([
            ['all', 'All'],
            ['removal', 'Removal jobs'],
            ['contract', 'Contract jobs'],
            ['lux', 'Lux moves'],
          ] as [CategoryFilter, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setCategory(key)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                category === key
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs uppercase tracking-wider font-semibold text-slate-500">Invoiced · {periodLabel}</div>
          <div className="mt-2 text-2xl font-bold text-emerald-700 tabular-nums">{fmtMoney(sums.invoiced)}</div>
          {prevMonthInvoiced != null && activeMonth && (
            <div className={`mt-1 inline-flex items-center gap-1 text-xs font-medium ${
              sums.invoiced >= prevMonthInvoiced ? 'text-emerald-600' : 'text-red-500'
            }`}>
              {sums.invoiced >= prevMonthInvoiced ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
              {fmtMoney(prevMonthInvoiced)} in {monthLabel(shiftMonth(activeMonth, -1))}
            </div>
          )}
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs uppercase tracking-wider font-semibold text-slate-500">Paid · {periodLabel}</div>
          <div className="mt-2 text-2xl font-bold text-blue-700 tabular-nums">{fmtMoney(sums.paid)}</div>
          <div className="mt-1 text-xs text-slate-400">
            {sums.invoiced > 0 ? `${Math.round((sums.paid / sums.invoiced) * 100)}% of invoiced` : 'Nothing invoiced'}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs uppercase tracking-wider font-semibold text-slate-500">Outstanding · {periodLabel}</div>
          <div className={`mt-2 text-2xl font-bold tabular-nums ${sums.outstanding > 0 ? 'text-amber-600' : 'text-slate-400'}`}>
            {fmtMoney(sums.outstanding)}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs uppercase tracking-wider font-semibold text-slate-500">Outstanding · all time</div>
          <div className={`mt-2 text-2xl font-bold tabular-nums ${allTimeOutstanding > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
            {fmtMoney(allTimeOutstanding)}
          </div>
          <div className="mt-1 text-xs text-slate-400">{category === 'all' ? 'Across every category' : 'For this filter'}</div>
        </div>
      </div>

      {/* Category income breakdown (only useful with no category filter) */}
      {category === 'all' && (
        <div className="flex items-center gap-2 flex-wrap">
          {(Object.keys(CATEGORY_META) as Category[]).map(c => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              title={`Show only ${CATEGORY_META[c].label} invoices`}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-slate-200 hover:border-slate-300 text-sm transition-colors"
            >
              <span className={`w-2 h-2 rounded-full ${CATEGORY_META[c].dot}`} />
              <span className="text-slate-600">{CATEGORY_META[c].label}</span>
              <span className="font-bold text-slate-800 tabular-nums">{fmtMoney(byCategory[c])}</span>
            </button>
          ))}
        </div>
      )}

      {/* Top performers */}
      {performers.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
            <Trophy className="w-4 h-4 text-amber-500" />
            <h3 className="text-sm font-bold text-slate-800">Top performers · {periodLabel}</h3>
            <span className="text-xs text-slate-400">by invoiced income</span>
          </div>
          <div className="divide-y divide-slate-50">
            {performers.map((p, i) => {
              const paidPct = p.invoiced > 0 ? (p.paid / p.invoiced) * 100 : 0;
              return (
                <div key={`${p.category}-${p.name}`} className="px-4 py-2.5 flex items-center gap-3">
                  <span className={`w-6 text-center text-sm font-bold tabular-nums ${i === 0 ? 'text-amber-500' : 'text-slate-400'}`}>
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-800 truncate">{p.name}</span>
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                        <span className={`w-1.5 h-1.5 rounded-full ${CATEGORY_META[p.category].dot}`} />
                        {CATEGORY_META[p.category].label}
                      </span>
                      <span className="text-xs text-slate-400 tabular-nums">{p.count} invoice{p.count === 1 ? '' : 's'}</span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-slate-100 overflow-hidden" title={`${Math.round(paidPct)}% paid`}>
                      <div className="h-full rounded-full bg-emerald-400" style={{ width: `${paidPct}%` }} />
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-sm font-bold text-slate-800 tabular-nums">{fmtMoney(p.invoiced)}</div>
                    <div className="text-[11px] text-slate-400 tabular-nums">{fmtMoney(p.paid)} paid</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Invoice list */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
          <Receipt className="w-4 h-4 text-slate-400" />
          <h3 className="text-sm font-bold text-slate-800">Invoices · {periodLabel}</h3>
          <span className="text-xs text-slate-400 tabular-nums">{filtered.length}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="text-left px-4 py-2 font-semibold whitespace-nowrap">Date</th>
                <th className="text-left px-3 py-2 font-semibold whitespace-nowrap">Invoice</th>
                <th className="text-left px-3 py-2 font-semibold">Type</th>
                <th className="text-left px-3 py-2 font-semibold">For</th>
                <th className="text-right px-3 py-2 font-semibold">Amount</th>
                <th className="text-center px-4 py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-sm text-slate-400">
                    No invoices raised in this period.
                  </td>
                </tr>
              )}
              {filtered.map(row => (
                <tr
                  key={row.key}
                  onClick={() => openInvoice(row)}
                  title={row.family === 'job' ? 'Open the job profile' : 'Open this contract invoice'}
                  className="hover:bg-slate-50 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-2.5 whitespace-nowrap text-slate-600 tabular-nums">{fmtDate(row.raised_at)}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap font-semibold text-slate-800 tabular-nums">{row.invoice_number}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600">
                      <span className={`w-1.5 h-1.5 rounded-full ${CATEGORY_META[row.category].dot}`} />
                      {TYPE_LABEL[row.invoice_type]}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-slate-800 truncate max-w-[280px]">{row.label}</div>
                    {row.detail && <div className="text-xs text-slate-400 truncate max-w-[280px]">{row.detail}</div>}
                  </td>
                  <td className="text-right px-3 py-2.5 font-bold text-slate-800 tabular-nums whitespace-nowrap">{fmtMoney(row.total)}</td>
                  <td className="text-center px-4 py-2.5 whitespace-nowrap">
                    {row.paid ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/70">
                        Paid
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-amber-50 text-amber-700 ring-1 ring-amber-200/70">
                        {row.status === 'overdue' ? 'Overdue' : 'Unpaid'}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
