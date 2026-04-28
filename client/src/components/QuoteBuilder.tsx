import { useEffect, useMemo, useState } from 'react';
import { PlusCircle, Trash2, CheckCircle, Check, AlertCircle, Pencil } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

export type LineItem = {
  id: string;
  description: string;
  price: number;
};

export type AddonItem = LineItem & {
  selected: boolean;       // ticked → counts in Fix Quotation total; unticked → Add-ons Total
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
  quotationItems: LineItem[];   // Fix Quotation mandatory items
  quotationAddons: AddonItem[]; // Fix Quotation optional add-ons
} & DepositSection;

const DEFAULT_DEPOSIT: DepositSection = {
  depositType: 'percentage',
  depositValue: '10',
  depositPaid: false,
  depositPaidDate: '',
  balancePaid: false,
  balancePaidDate: '',
};

const DEFAULT_STATE: QuoteBuilderState = {
  estimateItems: [],
  quotationItems: [],
  quotationAddons: [],
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

function listTotal(items: { price: number }[]) {
  return items.reduce((a, i) => a + (Number.isFinite(i.price) ? i.price : 0), 0);
}

function loadFromStorage(jobId: string | number | undefined): QuoteBuilderState {
  if (!jobId || typeof window === 'undefined') return DEFAULT_STATE;
  try {
    const raw = localStorage.getItem(`crm-quote-${jobId}`);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw);
    const stripItems = (items: unknown): LineItem[] =>
      Array.isArray(items)
        ? items.map(i => ({
            id: typeof (i as LineItem)?.id === 'string' ? (i as LineItem).id : newId(),
            description: typeof (i as LineItem)?.description === 'string' ? (i as LineItem).description : '',
            price: typeof (i as LineItem)?.price === 'number' ? (i as LineItem).price : 0,
          }))
        : [];
    const stripAddons = (items: unknown): AddonItem[] =>
      Array.isArray(items)
        ? items.map(i => ({
            id: typeof (i as AddonItem)?.id === 'string' ? (i as AddonItem).id : newId(),
            description: typeof (i as AddonItem)?.description === 'string' ? (i as AddonItem).description : '',
            price: typeof (i as AddonItem)?.price === 'number' ? (i as AddonItem).price : 0,
            selected: typeof (i as AddonItem)?.selected === 'boolean' ? (i as AddonItem).selected : false,
          }))
        : [];
    return {
      ...DEFAULT_STATE,
      ...parsed,
      estimateItems:   stripItems(parsed.estimateItems),
      quotationItems:  stripItems(parsed.quotationItems),
      quotationAddons: stripAddons(parsed.quotationAddons),
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

type QuotationDraft = { items: LineItem[]; addons: AddonItem[] };

export default function QuoteBuilder({ jobId }: Props) {
  const storageKey = jobId ? `crm-quote-${jobId}` : null;

  const [committed, setCommitted] = useState<QuoteBuilderState>(() => loadFromStorage(jobId));

  // Per-block draft state. null = that block is in read mode.
  const [estimateDraft,  setEstimateDraft]  = useState<LineItem[] | null>(null);
  const [quotationDraft, setQuotationDraft] = useState<QuotationDraft | null>(null);
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

  // ── Fix Quotation handlers (mandatory items + optional add-ons) ─────────
  const editingQuotation  = quotationDraft !== null;
  const quotationItems    = quotationDraft?.items  ?? committed.quotationItems;
  const quotationAddons   = quotationDraft?.addons ?? committed.quotationAddons;

  function startEditQuotation() {
    setQuotationDraft({
      items:  [...committed.quotationItems],
      addons: [...committed.quotationAddons],
    });
  }
  function saveQuotation() {
    if (!quotationDraft) return;
    const next = {
      ...committed,
      quotationItems:  quotationDraft.items,
      quotationAddons: quotationDraft.addons,
    };
    setCommitted(next);
    persist(next);
    setQuotationDraft(null);
  }
  function cancelQuotation() { setQuotationDraft(null); }

  function addMandatoryItem() {
    setQuotationDraft(prev =>
      prev ? { ...prev, items: [...prev.items, { id: newId(), description: '', price: 0 }] } : prev,
    );
  }
  function updateMandatoryItem(id: string, patch: Partial<LineItem>) {
    setQuotationDraft(prev =>
      prev ? { ...prev, items: prev.items.map(i => (i.id === id ? { ...i, ...patch } : i)) } : prev,
    );
  }
  function removeMandatoryItem(id: string) {
    setQuotationDraft(prev => (prev ? { ...prev, items: prev.items.filter(i => i.id !== id) } : prev));
  }

  function addAddonItem() {
    setQuotationDraft(prev =>
      prev
        ? { ...prev, addons: [...prev.addons, { id: newId(), description: '', price: 0, selected: false }] }
        : prev,
    );
  }
  function updateAddonItem(id: string, patch: Partial<AddonItem>) {
    setQuotationDraft(prev =>
      prev ? { ...prev, addons: prev.addons.map(a => (a.id === id ? { ...a, ...patch } : a)) } : prev,
    );
  }
  function removeAddonItem(id: string) {
    setQuotationDraft(prev => (prev ? { ...prev, addons: prev.addons.filter(a => a.id !== id) } : prev));
  }
  function toggleAddonSelected(id: string) {
    setQuotationDraft(prev =>
      prev
        ? { ...prev, addons: prev.addons.map(a => (a.id === id ? { ...a, selected: !a.selected } : a)) }
        : prev,
    );
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
  const mandatoryTotal       = useMemo(() => listTotal(quotationItems), [quotationItems]);
  const selectedAddons       = useMemo(() => quotationAddons.filter(a => a.selected),   [quotationAddons]);
  const unselectedAddons     = useMemo(() => quotationAddons.filter(a => !a.selected),  [quotationAddons]);
  const selectedAddonsTotal  = useMemo(() => listTotal(selectedAddons),   [selectedAddons]);
  const unselectedAddonsTotal = useMemo(() => listTotal(unselectedAddons), [unselectedAddons]);
  const fixQuotationTotal    = mandatoryTotal + selectedAddonsTotal;

  const depositValueNum = parseFloat(depositSection.depositValue) || 0;
  const depositAmount = useMemo(() => {
    if (depositSection.depositType === 'none') return 0;
    if (depositSection.depositType === 'percentage') {
      return Math.max(0, (fixQuotationTotal * depositValueNum) / 100);
    }
    return Math.max(0, depositValueNum);
  }, [depositSection.depositType, depositValueNum, fixQuotationTotal]);
  const remainingBalance = Math.max(0, fixQuotationTotal - depositAmount);
  const fullyPaid =
    depositSection.balancePaid &&
    (depositSection.depositType === 'none' || depositSection.depositPaid) &&
    fixQuotationTotal > 0;

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

      <FixQuotationBlock
        mandatoryItems={quotationItems}
        addonItems={quotationAddons}
        editing={editingQuotation}
        onEdit={startEditQuotation}
        onSave={saveQuotation}
        onCancel={cancelQuotation}
        onAddMandatory={addMandatoryItem}
        onUpdateMandatory={updateMandatoryItem}
        onRemoveMandatory={removeMandatoryItem}
        onAddAddon={addAddonItem}
        onUpdateAddon={updateAddonItem}
        onRemoveAddon={removeAddonItem}
        onToggleAddonSelected={toggleAddonSelected}
        mandatoryTotal={mandatoryTotal}
        selectedAddonsTotal={selectedAddonsTotal}
        unselectedAddonsTotal={unselectedAddonsTotal}
        fixQuotationTotal={fixQuotationTotal}
      />

      <DepositBlock
        section={depositSection}
        editing={editingDeposit}
        onEdit={startEditDeposit}
        onSave={saveDeposit}
        onCancel={cancelDeposit}
        onChange={setDepositField}
        quotationTotal={fixQuotationTotal}
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

// ── Line-item block (Estimate Quote) ──────────────────────────────────────────

type AccentName = 'cyan' | 'emerald';

const ACCENT: Record<AccentName, {
  headerBg: string; headerBorder: string; label: string; total: string;
}> = {
  cyan: {
    headerBg:     'bg-gradient-to-br from-cyan-50 to-cyan-100/50',
    headerBorder: 'border-cyan-200/70',
    label:        'text-cyan-700',
    total:        'text-cyan-900',
  },
  emerald: {
    headerBg:     'bg-gradient-to-br from-emerald-50 to-emerald-100/50',
    headerBorder: 'border-emerald-200/70',
    label:        'text-emerald-700',
    total:        'text-emerald-900',
  },
};

function LineItemBlock({
  title, subtitle, items,
  editing, onEdit, onSave, onCancel,
  onAdd, onUpdate, onRemove,
  accent,
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
          items.map(item => (
            <ItemEditRow
              key={item.id}
              item={item}
              onUpdate={patch => onUpdate(item.id, patch)}
              onRemove={() => onRemove(item.id)}
              placeholder="Description (e.g. Removal of 2-bed flat)"
            />
          ))
        ) : (
          items.map(item => <ItemReadRow key={item.id} item={item} />)
        )}
      </div>

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

      {items.length > 0 && (
        <div className="px-4 py-3 border-t border-slate-100 bg-gradient-to-br from-slate-50 to-slate-100/30 flex items-center justify-between">
          <span className={`text-sm font-bold ${cfg.label}`}>{title} Total</span>
          <span className={`font-bold tabular-nums tracking-tight text-lg ${cfg.total}`}>{fmt(total)}</span>
        </div>
      )}
    </div>
  );
}

// ── Reusable row renderers ────────────────────────────────────────────────────

function ItemEditRow({
  item, onUpdate, onRemove, placeholder, leading,
}: {
  item: LineItem;
  onUpdate: (patch: Partial<LineItem>) => void;
  onRemove: () => void;
  placeholder: string;
  leading?: React.ReactNode;
}) {
  return (
    <div className={`px-4 py-2.5 flex items-center gap-2 ${leading ? '' : ''}`}>
      {leading}
      <input
        type="text"
        placeholder={placeholder}
        className="input flex-1 min-w-0"
        value={item.description}
        onChange={e => onUpdate({ description: e.target.value })}
      />
      <div className="relative flex-shrink-0">
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-medium">£</span>
        <input
          type="number" min="0" step="0.01" placeholder="0.00"
          className="input w-32 pl-6 tabular-nums text-right"
          value={item.price === 0 ? '' : item.price}
          onChange={e => onUpdate({ price: parseFloat(e.target.value) || 0 })}
        />
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all flex-shrink-0"
        title="Remove item"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

function ItemReadRow({ item, leading, trailing }: { item: LineItem; leading?: React.ReactNode; trailing?: React.ReactNode }) {
  return (
    <div className="px-4 py-2.5 flex items-center gap-3 hover:bg-slate-50/50 transition-colors">
      {leading}
      <p className="text-sm text-slate-700 flex-1 min-w-0 truncate">
        {item.description || <span className="italic text-slate-400">Untitled item</span>}
      </p>
      {trailing}
      <p className="text-sm font-semibold text-slate-900 tabular-nums flex-shrink-0">{fmt(item.price)}</p>
    </div>
  );
}

// ── Fix Quotation block (mandatory + optional add-ons) ────────────────────────

function FixQuotationBlock({
  mandatoryItems, addonItems,
  editing, onEdit, onSave, onCancel,
  onAddMandatory, onUpdateMandatory, onRemoveMandatory,
  onAddAddon, onUpdateAddon, onRemoveAddon, onToggleAddonSelected,
  mandatoryTotal, selectedAddonsTotal, unselectedAddonsTotal, fixQuotationTotal,
}: {
  mandatoryItems: LineItem[];
  addonItems: AddonItem[];
  editing: boolean;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onAddMandatory: () => void;
  onUpdateMandatory: (id: string, patch: Partial<LineItem>) => void;
  onRemoveMandatory: (id: string) => void;
  onAddAddon: () => void;
  onUpdateAddon: (id: string, patch: Partial<AddonItem>) => void;
  onRemoveAddon: (id: string) => void;
  onToggleAddonSelected: (id: string) => void;
  mandatoryTotal: number;
  selectedAddonsTotal: number;
  unselectedAddonsTotal: number;
  fixQuotationTotal: number;
}) {
  const cfg = ACCENT.emerald;
  const selectedAddons   = addonItems.filter(a => a.selected);
  const unselectedAddons = addonItems.filter(a => !a.selected);
  const isEmpty = mandatoryItems.length === 0 && addonItems.length === 0;

  return (
    <div className={`rounded-xl border bg-white overflow-hidden shadow-sm ${cfg.headerBorder}`}>
      <BlockHeader
        title="Fix Quotation"
        subtitle="Confirmed pricing — mandatory items + optional add-ons"
        accent={cfg}
        editing={editing}
        onEdit={onEdit}
        onSave={onSave}
        onCancel={onCancel}
      />

      {editing ? (
        <FixEditView
          mandatoryItems={mandatoryItems}
          addonItems={addonItems}
          onAddMandatory={onAddMandatory}
          onUpdateMandatory={onUpdateMandatory}
          onRemoveMandatory={onRemoveMandatory}
          onAddAddon={onAddAddon}
          onUpdateAddon={onUpdateAddon}
          onRemoveAddon={onRemoveAddon}
          onToggleAddonSelected={onToggleAddonSelected}
        />
      ) : (
        <FixReadView
          mandatoryItems={mandatoryItems}
          selectedAddons={selectedAddons}
          unselectedAddons={unselectedAddons}
          isEmpty={isEmpty}
          onEdit={onEdit}
        />
      )}

      {/* Totals */}
      {!isEmpty && (
        <div className="px-4 py-3 border-t border-slate-100 bg-gradient-to-br from-slate-50 to-slate-100/30 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <span className={`text-sm font-bold ${cfg.label}`}>Fix Quotation Total</span>
              {selectedAddons.length > 0 && (
                <span className="text-[11px] text-slate-400 ml-2 tabular-nums">
                  {fmt(mandatoryTotal)} + {fmt(selectedAddonsTotal)} add-on{selectedAddons.length > 1 ? 's' : ''}
                </span>
              )}
            </div>
            <span className={`font-bold tabular-nums tracking-tight text-2xl ${cfg.total}`}>
              {fmt(fixQuotationTotal)}
            </span>
          </div>
          {(unselectedAddons.length > 0 || (editing && addonItems.length > 0)) && (
            <div className="flex items-center justify-between pt-2 border-t border-slate-200/60">
              <div>
                <span className="text-xs font-semibold text-slate-500">Add-ons Total</span>
                <span className="text-[11px] text-slate-400 ml-2">not yet selected</span>
              </div>
              <span className="text-base font-bold text-slate-700 tabular-nums tracking-tight">
                {fmt(unselectedAddonsTotal)}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FixEditView({
  mandatoryItems, addonItems,
  onAddMandatory, onUpdateMandatory, onRemoveMandatory,
  onAddAddon, onUpdateAddon, onRemoveAddon, onToggleAddonSelected,
}: {
  mandatoryItems: LineItem[];
  addonItems: AddonItem[];
  onAddMandatory: () => void;
  onUpdateMandatory: (id: string, patch: Partial<LineItem>) => void;
  onRemoveMandatory: (id: string) => void;
  onAddAddon: () => void;
  onUpdateAddon: (id: string, patch: Partial<AddonItem>) => void;
  onRemoveAddon: (id: string) => void;
  onToggleAddonSelected: (id: string) => void;
}) {
  return (
    <div className="divide-y divide-slate-100">
      {/* Mandatory items */}
      <div className="px-4 py-3">
        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">
          Mandatory items
        </p>
        {mandatoryItems.length === 0 ? (
          <p className="text-xs text-slate-400 italic py-1">No mandatory items yet</p>
        ) : (
          <div className="-mx-4">
            {mandatoryItems.map(item => (
              <ItemEditRow
                key={item.id}
                item={item}
                onUpdate={patch => onUpdateMandatory(item.id, patch)}
                onRemove={() => onRemoveMandatory(item.id)}
                placeholder="e.g. House move, 1 day"
              />
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={onAddMandatory}
          className="mt-2 text-xs font-semibold text-brand-600 hover:text-brand-700 inline-flex items-center gap-1.5 active:scale-95 transition-transform"
        >
          <PlusCircle className="w-4 h-4" /> Add mandatory item
        </button>
      </div>

      {/* Optional add-ons */}
      <div className="px-4 py-3 bg-slate-50/30">
        <div className="flex items-center justify-between mb-1">
          <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            Optional add-ons
          </p>
        </div>
        <p className="text-[11px] text-slate-400 mb-2">
          Tick the box to include in Fix Quotation Total. Unticked add-ons stay in Add-ons Total.
        </p>
        {addonItems.length === 0 ? (
          <p className="text-xs text-slate-400 italic py-1">No optional add-ons yet</p>
        ) : (
          <div className="-mx-4">
            {addonItems.map(item => (
              <div
                key={item.id}
                className={`px-4 py-2.5 flex items-center gap-2 transition-colors ${item.selected ? 'bg-emerald-50/50' : ''}`}
              >
                <button
                  type="button"
                  onClick={() => onToggleAddonSelected(item.id)}
                  className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 transition-all active:scale-90 ${
                    item.selected
                      ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 border-2 border-emerald-600 shadow-sm'
                      : 'bg-white border-2 border-slate-300 hover:border-emerald-400'
                  }`}
                  aria-pressed={item.selected}
                  title={item.selected ? 'Selected — counts in Fix Quotation Total' : 'Click to add to Fix Quotation Total'}
                >
                  {item.selected && <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
                </button>
                <input
                  type="text"
                  placeholder="e.g. Packing service"
                  className="input flex-1 min-w-0"
                  value={item.description}
                  onChange={e => onUpdateAddon(item.id, { description: e.target.value })}
                />
                <div className="relative flex-shrink-0">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-medium">£</span>
                  <input
                    type="number" min="0" step="0.01" placeholder="0.00"
                    className="input w-32 pl-6 tabular-nums text-right"
                    value={item.price === 0 ? '' : item.price}
                    onChange={e => onUpdateAddon(item.id, { price: parseFloat(e.target.value) || 0 })}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => onRemoveAddon(item.id)}
                  className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all flex-shrink-0"
                  title="Remove add-on"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={onAddAddon}
          className="mt-2 text-xs font-semibold text-brand-600 hover:text-brand-700 inline-flex items-center gap-1.5 active:scale-95 transition-transform"
        >
          <PlusCircle className="w-4 h-4" /> Add optional add-on
        </button>
      </div>
    </div>
  );
}

function FixReadView({
  mandatoryItems, selectedAddons, unselectedAddons, isEmpty, onEdit,
}: {
  mandatoryItems: LineItem[];
  selectedAddons: AddonItem[];
  unselectedAddons: AddonItem[];
  isEmpty: boolean;
  onEdit: () => void;
}) {
  if (isEmpty) {
    return (
      <div className="px-4 py-8 text-center">
        <p className="text-xs text-slate-400 italic">No items yet</p>
        <button
          type="button"
          onClick={onEdit}
          className="mt-2 text-xs font-semibold text-brand-600 hover:text-brand-700 inline-flex items-center gap-1"
        >
          <Pencil className="w-3.5 h-3.5" /> Click Edit to add items
        </button>
      </div>
    );
  }
  return (
    <div className="divide-y divide-slate-100">
      {mandatoryItems.length > 0 && (
        <div>
          {mandatoryItems.map(item => <ItemReadRow key={item.id} item={item} />)}
        </div>
      )}

      {selectedAddons.length > 0 && (
        <div>
          {selectedAddons.map(item => (
            <ItemReadRow
              key={item.id}
              item={item}
              leading={
                <span
                  className="w-5 h-5 rounded-md bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center flex-shrink-0 shadow-sm"
                  title="Selected add-on"
                >
                  <Check className="w-3 h-3 text-white" strokeWidth={3} />
                </span>
              }
              trailing={
                <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider flex-shrink-0">
                  Selected
                </span>
              }
            />
          ))}
        </div>
      )}

      {unselectedAddons.length > 0 && (
        <div className="bg-slate-50/40">
          <div className="px-4 py-2 border-b border-slate-100">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              Optional — not selected
            </p>
          </div>
          {unselectedAddons.map(item => (
            <div key={item.id} className="px-4 py-2.5 flex items-center gap-3 hover:bg-slate-50 transition-colors">
              <span className="w-5 h-5 rounded-md border-2 border-slate-300 flex-shrink-0" />
              <p className="text-sm text-slate-500 flex-1 min-w-0 truncate">
                {item.description || <span className="italic text-slate-400">Untitled add-on</span>}
              </p>
              <p className="text-sm font-medium text-slate-500 tabular-nums flex-shrink-0">{fmt(item.price)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Deposit + balance block ───────────────────────────────────────────────────

const DEPOSIT_ACCENT = {
  headerBg:     'bg-gradient-to-br from-amber-50 to-amber-100/50',
  headerBorder: 'border-amber-200/70',
  label:        'text-amber-700',
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
    <div className="rounded-xl border border-amber-200/70 bg-white overflow-hidden shadow-sm">
      <BlockHeader
        title="Deposit & Balance"
        subtitle="Track deposit and remaining balance"
        accent={DEPOSIT_ACCENT}
        editing={editing}
        onEdit={onEdit}
        onSave={onSave}
        onCancel={onCancel}
        extra={fullyPaid && !editing ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-amber-500 text-white shadow-sm">
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
                  ? 'bg-gradient-to-br from-amber-400 to-amber-500 border-amber-500 text-white shadow-sm'
                  : 'bg-white border-slate-200 text-slate-600 hover:border-amber-300 hover:text-amber-700'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

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
                placeholder={section.depositType === 'percentage' ? 'e.g. 10' : 'e.g. 250'}
                value={section.depositValue}
                onChange={e => onChange('depositValue', e.target.value)}
              />
            </div>
          </div>
          <div className="rounded-xl bg-gradient-to-br from-amber-50 to-amber-100/50 border border-amber-200/60 px-4 py-3">
            <p className="text-[11px] font-bold text-amber-700 uppercase tracking-wider">Deposit amount</p>
            <p className="text-2xl font-bold text-amber-900 tabular-nums tracking-tight leading-none mt-1">
              {fmt(depositAmount)}
            </p>
          </div>
        </div>
      )}

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

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
  // Pre-fill today's date when toggling on, but only if the date is empty —
  // never overwrite a value the user already entered.
  function togglePaid() {
    const next = !paid;
    onPaidChange(next);
    if (next && !date) onDateChange(todayISO());
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3">
      <button
        type="button"
        onClick={togglePaid}
        className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 transition-all active:scale-90 ${
          paid
            ? 'bg-gradient-to-br from-amber-400 to-amber-500 border-2 border-amber-500 shadow-sm'
            : 'bg-white border-2 border-slate-300 hover:border-amber-400'
        }`}
        aria-pressed={paid}
      >
        {paid && <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
      </button>
      <span className={`text-sm font-semibold flex-1 ${paid ? 'text-amber-800' : 'text-slate-700'}`}>{label}</span>
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
            <p className="text-[11px] font-bold text-amber-700 uppercase tracking-wider">Deposit</p>
            <p className="text-2xl font-bold text-amber-900 tabular-nums tracking-tight leading-none">{fmt(depositAmount)}</p>
          </div>
        )}
      </div>

      {!noDeposit && <ReadPaidRow label="Deposit" paid={section.depositPaid} date={section.depositPaidDate} />}

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
              <p className="text-[11px] text-slate-400 mt-0.5 italic">Add Fix Quotation items to see balance</p>
            )}
          </div>
          <p className={`text-2xl font-bold tabular-nums tracking-tight ${remainingBalance === 0 && quotationTotal > 0 ? 'text-amber-700' : 'text-slate-900'}`}>
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
          ? 'bg-amber-50/70 border-amber-200'
          : 'bg-slate-50/60 border-slate-200/60'
    }`}>
      <div className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 ${
        paid
          ? 'bg-gradient-to-br from-amber-400 to-amber-500 border-2 border-amber-500 shadow-sm'
          : 'bg-white border-2 border-slate-300'
      }`}>
        {paid && <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
      </div>
      <span className={`text-sm font-semibold flex-1 ${paid ? 'text-amber-800' : 'text-slate-500'}`}>
        {paid ? `${label} paid` : `${label} not paid`}
      </span>
      {paid && date && (
        <span className="text-xs font-medium text-amber-700 tabular-nums">
          {fmtDateShort(date)}
        </span>
      )}
    </div>
  );
}
