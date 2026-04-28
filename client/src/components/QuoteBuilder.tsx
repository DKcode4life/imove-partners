import { useEffect, useMemo, useState } from 'react';
import { PlusCircle, Trash2, CheckCircle, Check, AlertCircle, Pencil } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

export type LineItem = {
  id: string;
  description: string;
  price: number;
};

type DepositType = 'none' | 'percentage' | 'fixed';

type DepositSection = {
  depositType: DepositType;
  depositValue: string;       // raw input string so users can clear/retype
  depositPaid: boolean;
  depositPaidDate: string;
  balancePaid: boolean;
  balancePaidDate: string;
};

type QuoteBuilderState = {
  estimateItems: LineItem[];
  quotationItems: LineItem[];
} & DepositSection;

const DEFAULT_DEPOSIT: DepositSection = {
  depositType: 'none',
  depositValue: '',
  depositPaid: false,
  depositPaidDate: '',
  balancePaid: false,
  balancePaidDate: '',
};

const DEFAULT_STATE: QuoteBuilderState = {
  estimateItems: [],
  quotationItems: [],
  ...DEFAULT_DEPOSIT,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function fmt(n: number) {
  return `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDateShort(d: string) {
  if (!d) return '';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function listTotal(items: LineItem[]) {
  return items.reduce((a, i) => a + (Number.isFinite(i.price) ? i.price : 0), 0);
}

function loadFromStorage(jobId: string | number | undefined): QuoteBuilderState {
  if (!jobId || typeof window === 'undefined') return DEFAULT_STATE;
  try {
    const raw = localStorage.getItem(`crm-quote-${jobId}`);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw);
    // Strip any legacy `discount` field from items.
    const stripDiscount = (items: unknown): LineItem[] =>
      Array.isArray(items)
        ? items.map(i => ({
            id: typeof (i as LineItem)?.id === 'string' ? (i as LineItem).id : newId(),
            description: typeof (i as LineItem)?.description === 'string' ? (i as LineItem).description : '',
            price: typeof (i as LineItem)?.price === 'number' ? (i as LineItem).price : 0,
          }))
        : [];
    return {
      ...DEFAULT_STATE,
      ...parsed,
      estimateItems: stripDiscount(parsed.estimateItems),
      quotationItems: stripDiscount(parsed.quotationItems),
    };
  } catch {
    return DEFAULT_STATE;
  }
}

function extractDepositSection(state: QuoteBuilderState): DepositSection {
  return {
    depositType: state.depositType,
    depositValue: state.depositValue,
    depositPaid: state.depositPaid,
    depositPaidDate: state.depositPaidDate,
    balancePaid: state.balancePaid,
    balancePaidDate: state.balancePaidDate,
  };
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  jobId: number | string | undefined;
}

export default function QuoteBuilder({ jobId }: Props) {
  const storageKey = jobId ? `crm-quote-${jobId}` : null;

  const [committed, setCommitted] = useState<QuoteBuilderState>(() => loadFromStorage(jobId));

  // Per-block draft state. null = that block is in read mode.
  const [estimateDraft,  setEstimateDraft]  = useState<LineItem[] | null>(null);
  const [quotationDraft, setQuotationDraft] = useState<LineItem[] | null>(null);
  const [depositDraft,   setDepositDraft]   = useState<DepositSection | null>(null);

  // Reload + reset drafts when the job switches
  useEffect(() => {
    setCommitted(loadFromStorage(jobId));
    setEstimateDraft(null);
    setQuotationDraft(null);
    setDepositDraft(null);
  }, [jobId]);

  function persist(next: QuoteBuilderState) {
    if (!storageKey) return;
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* ignore */ }
  }

  // ── Estimate handlers ─────────────────────────────────────────────────────
  const editingEstimate = estimateDraft !== null;
  const estimateItems   = estimateDraft ?? committed.estimateItems;
  function startEditEstimate() { setEstimateDraft([...committed.estimateItems]); }
  function saveEstimate() {
    if (!estimateDraft) return;
    const next = { ...committed, estimateItems: estimateDraft };
    setCommitted(next);
    persist(next);
    setEstimateDraft(null);
  }
  function cancelEstimate() { setEstimateDraft(null); }
  function addEstimateItem() {
    setEstimateDraft(prev => [...(prev ?? []), { id: newId(), description: '', price: 0 }]);
  }
  function updateEstimateItem(id: string, patch: Partial<LineItem>) {
    setEstimateDraft(prev => (prev ?? []).map(i => (i.id === id ? { ...i, ...patch } : i)));
  }
  function removeEstimateItem(id: string) {
    setEstimateDraft(prev => (prev ?? []).filter(i => i.id !== id));
  }

  // ── Quotation handlers ────────────────────────────────────────────────────
  const editingQuotation = quotationDraft !== null;
  const quotationItems   = quotationDraft ?? committed.quotationItems;
  function startEditQuotation() { setQuotationDraft([...committed.quotationItems]); }
  function saveQuotation() {
    if (!quotationDraft) return;
    const next = { ...committed, quotationItems: quotationDraft };
    setCommitted(next);
    persist(next);
    setQuotationDraft(null);
  }
  function cancelQuotation() { setQuotationDraft(null); }
  function addQuotationItem() {
    setQuotationDraft(prev => [...(prev ?? []), { id: newId(), description: '', price: 0 }]);
  }
  function updateQuotationItem(id: string, patch: Partial<LineItem>) {
    setQuotationDraft(prev => (prev ?? []).map(i => (i.id === id ? { ...i, ...patch } : i)));
  }
  function removeQuotationItem(id: string) {
    setQuotationDraft(prev => (prev ?? []).filter(i => i.id !== id));
  }

  // ── Deposit handlers ──────────────────────────────────────────────────────
  const editingDeposit = depositDraft !== null;
  const depositSection = depositDraft ?? extractDepositSection(committed);
  function startEditDeposit() { setDepositDraft(extractDepositSection(committed)); }
  function saveDeposit() {
    if (!depositDraft) return;
    const next = { ...committed, ...depositDraft };
    setCommitted(next);
    persist(next);
    setDepositDraft(null);
  }
  function cancelDeposit() { setDepositDraft(null); }
  function setDepositField<K extends keyof DepositSection>(key: K, value: DepositSection[K]) {
    setDepositDraft(prev => (prev ? { ...prev, [key]: value } : prev));
  }

  // ── Derived totals ────────────────────────────────────────────────────────
  const quotationTotal = useMemo(() => listTotal(quotationItems), [quotationItems]);
  const depositValueNum = parseFloat(depositSection.depositValue) || 0;
  const depositAmount = useMemo(() => {
    if (depositSection.depositType === 'none') return 0;
    if (depositSection.depositType === 'percentage') {
      return Math.max(0, (quotationTotal * depositValueNum) / 100);
    }
    return Math.max(0, depositValueNum);
  }, [depositSection.depositType, depositValueNum, quotationTotal]);
  const remainingBalance = Math.max(0, quotationTotal - depositAmount);
  const fullyPaid =
    depositSection.balancePaid &&
    (depositSection.depositType === 'none' || depositSection.depositPaid) &&
    quotationTotal > 0;

  return (
    <div className="space-y-5">
      {/* Layout-only notice */}
      <div className="flex items-start gap-2 rounded-lg bg-amber-50/70 border border-amber-200/60 px-3 py-2">
        <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-amber-800">
          <span className="font-bold">Layout preview.</span> Items save in this browser only on
          Save. Database persistence + email sending land in the next iteration.
        </p>
      </div>

      <LineItemBlock
        title="Estimate Quote"
        subtitle="Initial estimate — no commitment"
        items={estimateItems}
        editing={editingEstimate}
        onEdit={startEditEstimate}
        onSave={saveEstimate}
        onCancel={cancelEstimate}
        onAdd={addEstimateItem}
        onUpdate={updateEstimateItem}
        onRemove={removeEstimateItem}
        accent="cyan"
      />

      <LineItemBlock
        title="Formal Quotation"
        subtitle="Confirmed pricing for the move"
        items={quotationItems}
        editing={editingQuotation}
        onEdit={startEditQuotation}
        onSave={saveQuotation}
        onCancel={cancelQuotation}
        onAdd={addQuotationItem}
        onUpdate={updateQuotationItem}
        onRemove={removeQuotationItem}
        accent="amber"
        emphasizeTotal
      />

      <DepositBlock
        section={depositSection}
        editing={editingDeposit}
        onEdit={startEditDeposit}
        onSave={saveDeposit}
        onCancel={cancelDeposit}
        onChange={setDepositField}
        quotationTotal={quotationTotal}
        depositAmount={depositAmount}
        remainingBalance={remainingBalance}
        fullyPaid={fullyPaid}
      />
    </div>
  );
}

// ── Block header (Edit / Save / Cancel) ───────────────────────────────────────

function BlockHeader({
  title, subtitle, accent, editing, onEdit, onSave, onCancel, extra,
}: {
  title: string;
  subtitle: string;
  accent: { headerBg: string; headerBorder: string; label: string };
  editing: boolean;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  extra?: React.ReactNode;
}) {
  return (
    <div className={`px-4 py-3 border-b ${accent.headerBg} ${accent.headerBorder} flex items-center justify-between gap-3`}>
      <div className="min-w-0">
        <h3 className={`text-sm font-bold tracking-tight ${accent.label}`}>{title}</h3>
        <p className="text-xs text-slate-500 mt-0.5 truncate">{subtitle}</p>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {extra}
        {editing ? (
          <>
            <button
              type="button"
              onClick={onCancel}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50 active:scale-95 transition-all"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSave}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-600 border border-emerald-600 text-white shadow-sm hover:shadow-md active:scale-95 transition-all inline-flex items-center gap-1.5"
            >
              <Check className="w-3.5 h-3.5" /> Save
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={onEdit}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 shadow-sm hover:border-slate-300 hover:text-slate-800 hover:shadow active:scale-95 transition-all inline-flex items-center gap-1.5"
          >
            <Pencil className="w-3.5 h-3.5" /> Edit
          </button>
        )}
      </div>
    </div>
  );
}

// ── Line-item block ───────────────────────────────────────────────────────────

type AccentName = 'cyan' | 'amber';

const ACCENT: Record<AccentName, {
  headerBg: string; headerBorder: string; label: string; total: string;
}> = {
  cyan: {
    headerBg:     'bg-gradient-to-br from-cyan-50 to-cyan-100/50',
    headerBorder: 'border-cyan-200/70',
    label:        'text-cyan-700',
    total:        'text-cyan-900',
  },
  amber: {
    headerBg:     'bg-gradient-to-br from-amber-50 to-amber-100/50',
    headerBorder: 'border-amber-200/70',
    label:        'text-amber-700',
    total:        'text-amber-900',
  },
};

function LineItemBlock({
  title, subtitle, items,
  editing, onEdit, onSave, onCancel,
  onAdd, onUpdate, onRemove,
  accent, emphasizeTotal = false,
}: {
  title: string;
  subtitle: string;
  items: LineItem[];
  editing: boolean;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onAdd: () => void;
  onUpdate: (id: string, patch: Partial<LineItem>) => void;
  onRemove: (id: string) => void;
  accent: AccentName;
  emphasizeTotal?: boolean;
}) {
  const cfg   = ACCENT[accent];
  const total = listTotal(items);

  return (
    <div className={`rounded-xl border bg-white overflow-hidden shadow-sm ${cfg.headerBorder}`}>
      <BlockHeader
        title={title}
        subtitle={subtitle}
        accent={cfg}
        editing={editing}
        onEdit={onEdit}
        onSave={onSave}
        onCancel={onCancel}
      />

      {/* Items */}
      <div className="divide-y divide-slate-100">
        {items.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-xs text-slate-400 italic">
              {editing ? 'No items yet — add one below' : 'No items yet'}
            </p>
            {!editing && (
              <button
                type="button"
                onClick={onEdit}
                className="mt-2 text-xs font-semibold text-brand-600 hover:text-brand-700 inline-flex items-center gap-1"
              >
                <Pencil className="w-3.5 h-3.5" /> Click Edit to add items
              </button>
            )}
          </div>
        ) : editing ? (
          // ── Editable rows ────────────────────────────────────────────────
          items.map(item => (
            <div key={item.id} className="px-4 py-2.5 flex items-center gap-2">
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
                  className="input w-32 pl-6 tabular-nums text-right"
                  value={item.price === 0 ? '' : item.price}
                  onChange={e => onUpdate(item.id, { price: parseFloat(e.target.value) || 0 })}
                />
              </div>
              <button
                type="button"
                onClick={() => onRemove(item.id)}
                className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all flex-shrink-0"
                title="Remove item"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))
        ) : (
          // ── Read-only rows ───────────────────────────────────────────────
          items.map(item => (
            <div key={item.id} className="px-4 py-2.5 flex items-center gap-3 hover:bg-slate-50/50 transition-colors">
              <p className="text-sm text-slate-700 flex-1 min-w-0 truncate">
                {item.description || <span className="italic text-slate-400">Untitled item</span>}
              </p>
              <p className="text-sm font-semibold text-slate-900 tabular-nums flex-shrink-0">{fmt(item.price)}</p>
            </div>
          ))
        )}
      </div>

      {/* Add item button (edit mode only) */}
      {editing && (
        <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50/40">
          <button
            type="button"
            onClick={onAdd}
            className="text-xs font-semibold text-brand-600 hover:text-brand-700 inline-flex items-center gap-1.5 active:scale-95 transition-transform"
          >
            <PlusCircle className="w-4 h-4" /> Add item
          </button>
        </div>
      )}

      {/* Total */}
      {items.length > 0 && (
        <div className="px-4 py-3 border-t border-slate-100 bg-gradient-to-br from-slate-50 to-slate-100/30 flex items-center justify-between">
          <span className={`text-sm font-bold ${cfg.label}`}>{title} Total</span>
          <span className={`font-bold tabular-nums tracking-tight ${cfg.total} ${emphasizeTotal ? 'text-2xl' : 'text-lg'}`}>
            {fmt(total)}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Deposit + balance block ───────────────────────────────────────────────────

const DEPOSIT_ACCENT = {
  headerBg:     'bg-gradient-to-br from-emerald-50 to-emerald-100/50',
  headerBorder: 'border-emerald-200/70',
  label:        'text-emerald-700',
};

function DepositBlock({
  section,
  editing, onEdit, onSave, onCancel, onChange,
  quotationTotal, depositAmount, remainingBalance, fullyPaid,
}: {
  section: DepositSection;
  editing: boolean;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onChange: <K extends keyof DepositSection>(key: K, value: DepositSection[K]) => void;
  quotationTotal: number;
  depositAmount: number;
  remainingBalance: number;
  fullyPaid: boolean;
}) {
  const noDeposit = section.depositType === 'none';

  return (
    <div className="rounded-xl border border-emerald-200/70 bg-white overflow-hidden shadow-sm">
      <BlockHeader
        title="Deposit & Balance"
        subtitle="Track deposit and remaining balance"
        accent={DEPOSIT_ACCENT}
        editing={editing}
        onEdit={onEdit}
        onSave={onSave}
        onCancel={onCancel}
        extra={fullyPaid && !editing ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-emerald-600 text-white shadow-sm">
            <CheckCircle className="w-3.5 h-3.5" /> Fully paid
          </span>
        ) : null}
      />

      <div className="p-4 space-y-4">
        {editing ? (
          <DepositEditView
            section={section}
            onChange={onChange}
            depositAmount={depositAmount}
          />
        ) : (
          <DepositReadView
            section={section}
            quotationTotal={quotationTotal}
            depositAmount={depositAmount}
            remainingBalance={remainingBalance}
            noDeposit={noDeposit}
          />
        )}
      </div>
    </div>
  );
}

// ── Deposit edit view ─────────────────────────────────────────────────────────

function DepositEditView({
  section, onChange, depositAmount,
}: {
  section: DepositSection;
  onChange: <K extends keyof DepositSection>(key: K, value: DepositSection[K]) => void;
  depositAmount: number;
}) {
  const noDeposit = section.depositType === 'none';

  return (
    <>
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
              onClick={() => onChange('depositType', opt.key)}
              className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-all active:scale-95 ${
                section.depositType === opt.key
                  ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 border-emerald-600 text-white shadow-sm'
                  : 'bg-white border-slate-200 text-slate-600 hover:border-emerald-300 hover:text-emerald-700'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Value input + calculated deposit */}
      {!noDeposit && (
        <div className="grid grid-cols-2 gap-3 items-end mt-4">
          <div>
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
              {section.depositType === 'percentage' ? 'Percentage of total' : 'Fixed amount'}
            </p>
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-medium">
                {section.depositType === 'percentage' ? '%' : '£'}
              </span>
              <input
                type="number" min="0" step="0.01"
                className="input pl-7 tabular-nums"
                placeholder={section.depositType === 'percentage' ? 'e.g. 25' : 'e.g. 250'}
                value={section.depositValue}
                onChange={e => onChange('depositValue', e.target.value)}
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

      {/* Deposit paid */}
      {!noDeposit && (
        <div className="mt-4">
          <PaidEditRow
            label="Deposit paid"
            paid={section.depositPaid}
            date={section.depositPaidDate}
            onPaidChange={v => onChange('depositPaid', v)}
            onDateChange={v => onChange('depositPaidDate', v)}
          />
        </div>
      )}

      {/* Balance paid */}
      <div className="mt-4">
        <PaidEditRow
          label="Balance paid"
          paid={section.balancePaid}
          date={section.balancePaidDate}
          onPaidChange={v => onChange('balancePaid', v)}
          onDateChange={v => onChange('balancePaidDate', v)}
        />
      </div>
    </>
  );
}

function PaidEditRow({
  label, paid, date, onPaidChange, onDateChange,
}: {
  label: string;
  paid: boolean;
  date: string;
  onPaidChange: (v: boolean) => void;
  onDateChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3">
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

// ── Deposit read view ─────────────────────────────────────────────────────────

function DepositReadView({
  section, quotationTotal, depositAmount, remainingBalance, noDeposit,
}: {
  section: DepositSection;
  quotationTotal: number;
  depositAmount: number;
  remainingBalance: number;
  noDeposit: boolean;
}) {
  return (
    <div className="space-y-3">
      {/* Deposit type summary */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg bg-slate-50/60 border border-slate-200/60">
        <div className="min-w-0">
          <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Deposit type</p>
          <p className="text-sm font-semibold text-slate-800 mt-0.5 truncate">
            {noDeposit
              ? 'No deposit required'
              : section.depositType === 'percentage'
                ? `Percentage — ${section.depositValue || '0'}% of total`
                : `Fixed amount — ${fmt(parseFloat(section.depositValue) || 0)}`}
          </p>
        </div>
        {!noDeposit && (
          <div className="text-right flex-shrink-0">
            <p className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider">Deposit</p>
            <p className="text-2xl font-bold text-emerald-900 tabular-nums tracking-tight leading-none">{fmt(depositAmount)}</p>
          </div>
        )}
      </div>

      {/* Deposit paid status */}
      {!noDeposit && <ReadPaidRow label="Deposit" paid={section.depositPaid} date={section.depositPaidDate} />}

      {/* Remaining balance card + paid status */}
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
              <p className="text-[11px] text-slate-400 mt-0.5 italic">Add quotation items to see balance</p>
            )}
          </div>
          <p className={`text-2xl font-bold tabular-nums tracking-tight ${remainingBalance === 0 && quotationTotal > 0 ? 'text-emerald-700' : 'text-slate-900'}`}>
            {fmt(remainingBalance)}
          </p>
        </div>

        <div className="pt-3 border-t border-slate-200/60">
          <ReadPaidRow label="Balance" paid={section.balancePaid} date={section.balancePaidDate} compact />
        </div>
      </div>
    </div>
  );
}

function ReadPaidRow({
  label, paid, date, compact = false,
}: {
  label: string;
  paid: boolean;
  date: string;
  compact?: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 ${compact ? '' : 'px-4 py-3 rounded-lg border'} ${
      compact
        ? ''
        : paid
          ? 'bg-emerald-50/70 border-emerald-200'
          : 'bg-slate-50/60 border-slate-200/60'
    }`}>
      <div className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 ${
        paid
          ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 border-2 border-emerald-600 shadow-sm'
          : 'bg-white border-2 border-slate-300'
      }`}>
        {paid && <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
      </div>
      <span className={`text-sm font-semibold flex-1 ${paid ? 'text-emerald-800' : 'text-slate-500'}`}>
        {paid ? `${label} paid` : `${label} not paid`}
      </span>
      {paid && date && (
        <span className="text-xs font-medium text-emerald-700 tabular-nums">
          {fmtDateShort(date)}
        </span>
      )}
    </div>
  );
}
