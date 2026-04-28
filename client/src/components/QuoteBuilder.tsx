import { useEffect, useMemo, useState } from 'react';
import { PlusCircle, Trash2, CheckCircle, Check, AlertCircle } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

export type LineItem = {
  id: string;
  description: string;
  price: number;
  discount: number;
};

type DepositType = 'none' | 'percentage' | 'fixed';

type QuoteBuilderState = {
  estimateItems: LineItem[];
  quotationItems: LineItem[];
  depositType: DepositType;
  depositValue: string;       // raw input string so users can clear/retype
  depositPaid: boolean;
  depositPaidDate: string;
  balancePaid: boolean;
  balancePaidDate: string;
};

const DEFAULT_STATE: QuoteBuilderState = {
  estimateItems: [],
  quotationItems: [],
  depositType: 'none',
  depositValue: '',
  depositPaid: false,
  depositPaidDate: '',
  balancePaid: false,
  balancePaidDate: '',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function fmt(n: number) {
  return `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function listSubtotal(items: LineItem[]) {
  return items.reduce((a, i) => a + (Number.isFinite(i.price) ? i.price : 0), 0);
}
function listDiscount(items: LineItem[]) {
  return items.reduce((a, i) => a + (Number.isFinite(i.discount) ? i.discount : 0), 0);
}
function listNet(items: LineItem[]) {
  return Math.max(0, listSubtotal(items) - listDiscount(items));
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  jobId: number | string | undefined;
}

export default function QuoteBuilder({ jobId }: Props) {
  const storageKey = jobId ? `crm-quote-${jobId}` : null;

  // Load once when jobId becomes available
  const [state, setState] = useState<QuoteBuilderState>(() => {
    if (typeof window === 'undefined' || !jobId) return DEFAULT_STATE;
    try {
      const raw = localStorage.getItem(`crm-quote-${jobId}`);
      if (!raw) return DEFAULT_STATE;
      return { ...DEFAULT_STATE, ...JSON.parse(raw) };
    } catch {
      return DEFAULT_STATE;
    }
  });

  // Persist on every change
  useEffect(() => {
    if (!storageKey) return;
    try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch { /* ignore */ }
  }, [state, storageKey]);

  // Reset state if jobId changes (e.g. navigating to a different job)
  useEffect(() => {
    if (!jobId) return;
    try {
      const raw = localStorage.getItem(`crm-quote-${jobId}`);
      setState(raw ? { ...DEFAULT_STATE, ...JSON.parse(raw) } : DEFAULT_STATE);
    } catch {
      setState(DEFAULT_STATE);
    }
  }, [jobId]);

  function setField<K extends keyof QuoteBuilderState>(key: K, value: QuoteBuilderState[K]) {
    setState(prev => ({ ...prev, [key]: value }));
  }

  function addItem(field: 'estimateItems' | 'quotationItems') {
    setState(prev => ({
      ...prev,
      [field]: [...prev[field], { id: newId(), description: '', price: 0, discount: 0 }],
    }));
  }
  function updateItem(field: 'estimateItems' | 'quotationItems', id: string, patch: Partial<LineItem>) {
    setState(prev => ({
      ...prev,
      [field]: prev[field].map(i => (i.id === id ? { ...i, ...patch } : i)),
    }));
  }
  function removeItem(field: 'estimateItems' | 'quotationItems', id: string) {
    setState(prev => ({ ...prev, [field]: prev[field].filter(i => i.id !== id) }));
  }

  // ── Derived totals ────────────────────────────────────────────────────────
  const quotationTotal = useMemo(() => listNet(state.quotationItems), [state.quotationItems]);
  const depositValueNum = parseFloat(state.depositValue) || 0;
  const depositAmount = useMemo(() => {
    if (state.depositType === 'none') return 0;
    if (state.depositType === 'percentage') {
      return Math.max(0, (quotationTotal * depositValueNum) / 100);
    }
    return Math.max(0, depositValueNum);
  }, [state.depositType, depositValueNum, quotationTotal]);
  const remainingBalance = Math.max(0, quotationTotal - depositAmount);
  const fullyPaid =
    state.balancePaid && (state.depositType === 'none' || state.depositPaid) && quotationTotal > 0;

  return (
    <div className="space-y-5">
      {/* Layout-only notice */}
      <div className="flex items-start gap-2 rounded-lg bg-amber-50/70 border border-amber-200/60 px-3 py-2">
        <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-amber-800">
          <span className="font-bold">Layout preview.</span> Items save in this browser only.
          Database persistence + email sending land in the next iteration.
        </p>
      </div>

      {/* Estimate */}
      <LineItemBlock
        title="Estimate Quote"
        subtitle="Initial estimate — no commitment"
        items={state.estimateItems}
        onAdd={() => addItem('estimateItems')}
        onUpdate={(id, patch) => updateItem('estimateItems', id, patch)}
        onRemove={id => removeItem('estimateItems', id)}
        accent="cyan"
      />

      {/* Formal Quotation */}
      <LineItemBlock
        title="Formal Quotation"
        subtitle="Confirmed pricing for the move"
        items={state.quotationItems}
        onAdd={() => addItem('quotationItems')}
        onUpdate={(id, patch) => updateItem('quotationItems', id, patch)}
        onRemove={id => removeItem('quotationItems', id)}
        accent="amber"
        emphasizeTotal
      />

      {/* Deposit + balance */}
      <DepositBlock
        quotationTotal={quotationTotal}
        depositType={state.depositType}
        depositValue={state.depositValue}
        depositAmount={depositAmount}
        depositPaid={state.depositPaid}
        depositPaidDate={state.depositPaidDate}
        balancePaid={state.balancePaid}
        balancePaidDate={state.balancePaidDate}
        remainingBalance={remainingBalance}
        fullyPaid={fullyPaid}
        onTypeChange={t => setField('depositType', t)}
        onValueChange={v => setField('depositValue', v)}
        onDepositPaidChange={v => setField('depositPaid', v)}
        onDepositPaidDateChange={v => setField('depositPaidDate', v)}
        onBalancePaidChange={v => setField('balancePaid', v)}
        onBalancePaidDateChange={v => setField('balancePaidDate', v)}
      />
    </div>
  );
}

// ── Line-item block ───────────────────────────────────────────────────────────

type AccentName = 'cyan' | 'amber';

const ACCENT: Record<AccentName, {
  headerBg: string; headerBorder: string; label: string; total: string; addBtn: string;
}> = {
  cyan: {
    headerBg:     'bg-gradient-to-br from-cyan-50 to-cyan-100/50',
    headerBorder: 'border-cyan-200/70',
    label:        'text-cyan-700',
    total:        'text-cyan-900',
    addBtn:       'text-cyan-700 hover:bg-cyan-100/70 border-cyan-200',
  },
  amber: {
    headerBg:     'bg-gradient-to-br from-amber-50 to-amber-100/50',
    headerBorder: 'border-amber-200/70',
    label:        'text-amber-700',
    total:        'text-amber-900',
    addBtn:       'text-amber-700 hover:bg-amber-100/70 border-amber-200',
  },
};

function LineItemBlock({
  title, subtitle, items, onAdd, onUpdate, onRemove, accent, emphasizeTotal = false,
}: {
  title: string;
  subtitle: string;
  items: LineItem[];
  onAdd: () => void;
  onUpdate: (id: string, patch: Partial<LineItem>) => void;
  onRemove: (id: string) => void;
  accent: AccentName;
  emphasizeTotal?: boolean;
}) {
  const cfg = ACCENT[accent];
  const subtotal = listSubtotal(items);
  const discount = listDiscount(items);
  const net = Math.max(0, subtotal - discount);

  return (
    <div className={`rounded-xl border bg-white overflow-hidden shadow-sm ${cfg.headerBorder}`}>
      {/* Header */}
      <div className={`px-4 py-3 border-b ${cfg.headerBg} ${cfg.headerBorder} flex items-center justify-between gap-3`}>
        <div className="min-w-0">
          <h3 className={`text-sm font-bold tracking-tight ${cfg.label}`}>{title}</h3>
          <p className="text-xs text-slate-500 mt-0.5 truncate">{subtitle}</p>
        </div>
        <button
          type="button"
          onClick={onAdd}
          className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-white border shadow-sm hover:shadow active:scale-95 transition-all ${cfg.addBtn}`}
        >
          <PlusCircle className="w-3.5 h-3.5" /> Add item
        </button>
      </div>

      {/* Items */}
      <div className="divide-y divide-slate-100">
        {items.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-xs text-slate-400 italic">No items yet</p>
            <button
              type="button"
              onClick={onAdd}
              className="mt-2 text-xs font-semibold text-brand-600 hover:text-brand-700 inline-flex items-center gap-1"
            >
              <PlusCircle className="w-3.5 h-3.5" /> Add the first item
            </button>
          </div>
        ) : (
          items.map(item => (
            <div key={item.id} className="px-4 py-2.5 flex items-center gap-2 hover:bg-slate-50/60 transition-colors">
              <input
                type="text"
                placeholder="Description (e.g. Removal of 2-bed flat, Hampstead → Camden)"
                className="input flex-1 min-w-0"
                value={item.description}
                onChange={e => onUpdate(item.id, { description: e.target.value })}
              />
              <div className="relative flex-shrink-0">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-medium">£</span>
                <input
                  type="number" min="0" step="0.01" placeholder="0.00"
                  className="input w-28 pl-6 tabular-nums text-right"
                  value={item.price === 0 ? '' : item.price}
                  onChange={e => onUpdate(item.id, { price: parseFloat(e.target.value) || 0 })}
                  title="Price"
                />
              </div>
              <div className="relative flex-shrink-0">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-medium">−£</span>
                <input
                  type="number" min="0" step="0.01" placeholder="0"
                  className="input w-24 pl-7 tabular-nums text-right"
                  value={item.discount === 0 ? '' : item.discount}
                  onChange={e => onUpdate(item.id, { discount: parseFloat(e.target.value) || 0 })}
                  title="Discount"
                />
              </div>
              <button
                type="button"
                onClick={() => onRemove(item.id)}
                className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all hover:shadow-sm flex-shrink-0"
                title="Remove item"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))
        )}
      </div>

      {/* Totals */}
      {items.length > 0 && (
        <div className="px-4 py-3 bg-slate-50/60 border-t border-slate-100 space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500 font-medium">Subtotal</span>
            <span className="font-semibold text-slate-700 tabular-nums">{fmt(subtotal)}</span>
          </div>
          {discount > 0 && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500 font-medium">Total discount</span>
              <span className="font-semibold text-red-600 tabular-nums">−{fmt(discount)}</span>
            </div>
          )}
          <div className={`flex items-center justify-between pt-2 mt-1 border-t border-slate-200/70 ${emphasizeTotal ? '' : ''}`}>
            <span className={`text-sm font-bold ${cfg.label}`}>{title} Total</span>
            <span
              className={`font-bold tabular-nums tracking-tight ${cfg.total} ${emphasizeTotal ? 'text-2xl' : 'text-lg'}`}
            >
              {fmt(net)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Deposit + balance block ───────────────────────────────────────────────────

function DepositBlock({
  quotationTotal,
  depositType, depositValue, depositAmount,
  depositPaid, depositPaidDate,
  balancePaid, balancePaidDate,
  remainingBalance, fullyPaid,
  onTypeChange, onValueChange,
  onDepositPaidChange, onDepositPaidDateChange,
  onBalancePaidChange, onBalancePaidDateChange,
}: {
  quotationTotal: number;
  depositType: DepositType;
  depositValue: string;
  depositAmount: number;
  depositPaid: boolean;
  depositPaidDate: string;
  balancePaid: boolean;
  balancePaidDate: string;
  remainingBalance: number;
  fullyPaid: boolean;
  onTypeChange: (t: DepositType) => void;
  onValueChange: (v: string) => void;
  onDepositPaidChange: (v: boolean) => void;
  onDepositPaidDateChange: (v: string) => void;
  onBalancePaidChange: (v: boolean) => void;
  onBalancePaidDateChange: (v: string) => void;
}) {
  const noDeposit = depositType === 'none';

  return (
    <div className="rounded-xl border border-emerald-200/70 bg-white overflow-hidden shadow-sm">
      {/* Header */}
      <div className="px-4 py-3 border-b border-emerald-200/70 bg-gradient-to-br from-emerald-50 to-emerald-100/50">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-emerald-700 tracking-tight">Deposit & Balance</h3>
            <p className="text-xs text-slate-500 mt-0.5">Track deposit and remaining balance</p>
          </div>
          {fullyPaid && (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-emerald-600 text-white shadow-sm">
              <CheckCircle className="w-3.5 h-3.5" /> Fully paid
            </span>
          )}
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Type selector */}
        <div>
          <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">Deposit type</p>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { key: 'none',       label: 'No deposit' },
                { key: 'percentage', label: 'Percentage' },
                { key: 'fixed',      label: 'Fixed amount' },
              ] as const
            ).map(opt => (
              <button
                key={opt.key}
                type="button"
                onClick={() => onTypeChange(opt.key)}
                className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-all active:scale-95 ${
                  depositType === opt.key
                    ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 border-emerald-600 text-white shadow-sm'
                    : 'bg-white border-slate-200 text-slate-600 hover:border-emerald-300 hover:text-emerald-700'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Value input + calculated deposit (hidden when 'none') */}
        {!noDeposit && (
          <div className="grid grid-cols-2 gap-3 items-end">
            <div>
              <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                {depositType === 'percentage' ? 'Percentage of total' : 'Fixed amount'}
              </p>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-medium">
                  {depositType === 'percentage' ? '%' : '£'}
                </span>
                <input
                  type="number" min="0" step="0.01"
                  className="input pl-7 tabular-nums"
                  placeholder={depositType === 'percentage' ? 'e.g. 25' : 'e.g. 250'}
                  value={depositValue}
                  onChange={e => onValueChange(e.target.value)}
                />
              </div>
            </div>
            <div className="rounded-xl bg-gradient-to-br from-emerald-50 to-emerald-100/50 border border-emerald-200/60 px-4 py-3">
              <p className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider">Deposit amount</p>
              <p className="text-2xl font-bold text-emerald-900 tabular-nums tracking-tight leading-none mt-1">
                {fmt(depositAmount)}
              </p>
            </div>
          </div>
        )}

        {/* Deposit paid checkbox + date (hidden when 'none') */}
        {!noDeposit && (
          <PaidRow
            label="Deposit paid"
            paid={depositPaid}
            date={depositPaidDate}
            onPaidChange={onDepositPaidChange}
            onDateChange={onDepositPaidDateChange}
          />
        )}

        {/* Remaining balance card */}
        <div className="rounded-xl bg-gradient-to-br from-slate-50 to-slate-100/50 border border-slate-200/70 p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Remaining balance</p>
              {!noDeposit && depositAmount > 0 && (
                <p className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
                  {fmt(quotationTotal)} total − {fmt(depositAmount)} deposit
                </p>
              )}
              {quotationTotal === 0 && (
                <p className="text-[11px] text-slate-400 mt-0.5 italic">Add quotation items above to see balance</p>
              )}
            </div>
            <p className={`text-2xl font-bold tabular-nums tracking-tight ${remainingBalance === 0 && quotationTotal > 0 ? 'text-emerald-700' : 'text-slate-900'}`}>
              {fmt(remainingBalance)}
            </p>
          </div>

          <PaidRow
            label="Balance paid"
            paid={balancePaid}
            date={balancePaidDate}
            onPaidChange={onBalancePaidChange}
            onDateChange={onBalancePaidDateChange}
            compact
          />
        </div>
      </div>
    </div>
  );
}

// ── Reusable "X paid + date" row ───────────────────────────────────────────────

function PaidRow({
  label, paid, date, onPaidChange, onDateChange, compact = false,
}: {
  label: string;
  paid: boolean;
  date: string;
  onPaidChange: (v: boolean) => void;
  onDateChange: (v: string) => void;
  compact?: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 ${compact ? 'pt-3 border-t border-slate-200/60' : 'rounded-lg border border-slate-200 bg-white p-3'}`}>
      <button
        type="button"
        onClick={() => onPaidChange(!paid)}
        className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 transition-all active:scale-90 ${
          paid
            ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 border-2 border-emerald-600 shadow-sm'
            : 'bg-white border-2 border-slate-300 hover:border-emerald-400'
        }`}
        aria-pressed={paid}
      >
        {paid && <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
      </button>
      <span className={`text-sm font-semibold flex-1 ${paid ? 'text-emerald-800' : 'text-slate-700'}`}>{label}</span>
      <input
        type="date"
        className="input w-40 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
        value={date}
        onChange={e => onDateChange(e.target.value)}
        disabled={!paid}
        title={paid ? 'Date paid' : 'Mark as paid first'}
      />
    </div>
  );
}
