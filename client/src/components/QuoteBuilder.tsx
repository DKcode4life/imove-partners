import { useEffect, useMemo, useState } from 'react';
import { PlusCircle, Trash2, CheckCircle, Check, AlertCircle, Pencil, Mail, FileText, Receipt, Send, Calculator } from 'lucide-react';
import api from '../lib/api';
import { loadCatalog } from '../lib/catalogStorage';
import SendDocumentModal, { type DocumentType, type SendDocumentData } from './SendDocumentModal';

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
  /** Mileage pre-calculated by the parent from full address fields (not just postcodes). Used as fallback when postcodes are absent or as the primary source. */
  distanceMiles?: number;
  /**
   * Fired after a server action that may have changed the parent job's
   * status / quote_amount (sending a quote/invoice, marking paid, etc.).
   * The parent should refetch the job so the pipeline chart and status
   * badge reflect the auto-advanced stage.
   */
  onJobUpdated?: () => void;
}

type QuotationDraft = { items: LineItem[]; addons: AddonItem[] };

type JobInfo = {
  id: number;
  full_name: string;
  email: string | null;
  phone: string | null;
  from_postcode: string | null;
  to_postcode: string | null;
};

type GuideQuoteState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'incomplete'; reason: string }
  | { status: 'done'; price: number; cuFt: number; miles: number; rate: number; flatRate: boolean };

const DEFAULT_PRICE_BANDS = [
  { upToMiles: 10,  ratePerCuFt: 0.85 },
  { upToMiles: 30,  ratePerCuFt: 0.95 },
  { upToMiles: 60,  ratePerCuFt: 1.05 },
  { upToMiles: 100, ratePerCuFt: 1.25 },
  { upToMiles: 200, ratePerCuFt: 1.50 },
];
const OVER_200_RATE = 2.50;

type ExistingDocs = {
  estimateQuoteId?: number;
  estimateQuoteNumber?: string;
  fixedQuoteId?: number;
  fixedQuoteNumber?: string;
  depositInvoiceId?: number;
  depositInvoiceNumber?: string;
  depositInvoicePaid?: boolean;
  mainInvoiceId?: number;
  mainInvoiceNumber?: string;
  mainInvoicePaid?: boolean;
};

/**
 * Pretty placeholder shown in the Send modal *before* a document has been
 * created on the server. The moment the user presses Send, the server
 * generates the real reference number (EST-#####, iMQ-#####, DEP-#####,
 * INV-#####) and we swap this placeholder out for it permanently.
 */
const REF_PLACEHOLDER: Record<DocumentType, string> = {
  'estimate-quote':   'EST-?????',
  'fixed-quote':      'iMQ-?????',
  'deposit-invoice':  'DEP-?????',
  'deposit-receipt':  'DEP-?????',
  'main-invoice':     'INV-?????',
  'move-receipt':     'INV-?????',
};

export default function QuoteBuilder({ jobId, onJobUpdated, distanceMiles }: Props) {
  const storageKey = jobId ? `crm-quote-${jobId}` : null;

  const [committed, setCommitted] = useState<QuoteBuilderState>(() => loadFromStorage(jobId));

  // Per-block draft state. null = that block is in read mode.
  const [estimateDraft,  setEstimateDraft]  = useState<LineItem[] | null>(null);
  const [quotationDraft, setQuotationDraft] = useState<QuotationDraft | null>(null);
  const [depositDraft,   setDepositDraft]   = useState<DepositSection | null>(null);

  // Send-to-client state
  const [jobInfo, setJobInfo] = useState<JobInfo | null>(null);
  const [existingDocs, setExistingDocs] = useState<ExistingDocs>({});
  const [activeModal, setActiveModal] = useState<DocumentType | null>(null);
  const [sendingToast, setSendingToast] = useState<{ kind: 'success' | 'error'; msg: string } | null>(null);
  const [busyAction, setBusyAction] = useState<DocumentType | null>(null);

  // Guide quote state
  const [guideQuote, setGuideQuote] = useState<GuideQuoteState>({ status: 'idle' });
  const [priceBands, setPriceBands] = useState<Array<{ upToMiles: number; ratePerCuFt: number }>>(DEFAULT_PRICE_BANDS);
  const [isEditingGuideQuote, setIsEditingGuideQuote] = useState(false);
  const [manualMiles, setManualMiles] = useState('');
  const [manualCuFt, setManualCuFt] = useState('');

  // Reload + reset drafts when the job switches
  useEffect(() => {
    setCommitted(loadFromStorage(jobId));
    setEstimateDraft(null);
    setQuotationDraft(null);
    setDepositDraft(null);
    setExistingDocs({});
    setJobInfo(null);
    setGuideQuote({ status: 'idle' });
    setIsEditingGuideQuote(false);
    setManualMiles('');
    setManualCuFt('');

    if (jobId) {
      // Load job + existing quotes + invoices for the send panel
      (async () => {
        try {
          const [jobRes, quotesRes, invRes] = await Promise.all([
            api.get(`/crm/jobs/${jobId}`),
            api.get(`/crm/jobs/${jobId}/quotes`).catch(() => ({ data: [] })),
            api.get(`/crm/jobs/${jobId}/invoices`).catch(() => ({ data: [] })),
          ]);
          const j = jobRes.data;
          const fromPostcode: string | null = j.from_postcode ?? null;
          const toPostcode: string | null   = j.to_postcode   ?? null;
          setJobInfo({ id: j.id, full_name: j.full_name, email: j.email, phone: j.phone, from_postcode: fromPostcode, to_postcode: toPostcode });

          const quotes: any[] = quotesRes.data || [];
          const invoices: any[] = invRes.data || [];
          const estQ = quotes.find(q => q.quote_type === 'estimate');
          const fixQ = quotes.find(q => q.quote_type === 'fixed');
          const depInv = invoices.find(i => i.invoice_type === 'deposit');
          const mainInv = invoices.find(i => i.invoice_type === 'main');
          setExistingDocs({
            estimateQuoteId: estQ?.id,
            estimateQuoteNumber: estQ?.quote_number,
            fixedQuoteId: fixQ?.id,
            fixedQuoteNumber: fixQ?.quote_number,
            depositInvoiceId: depInv?.id,
            depositInvoiceNumber: depInv?.invoice_number,
            depositInvoicePaid: depInv?.status === 'paid',
            mainInvoiceId: mainInv?.id,
            mainInvoiceNumber: mainInv?.invoice_number,
            mainInvoicePaid: mainInv?.status === 'paid',
          });

          // ── Guide Quote calculation ───────────────────────────────────────
          // Use parent's pre-calculated mileage if available (supports rough areas without postcodes).
          // Fall back to a fresh route-info call when postcodes are present but no mileage was passed.
          if (!distanceMiles && (!fromPostcode || !toPostcode)) {
            setGuideQuote({ status: 'incomplete', reason: 'Add property addresses to calculate' });
          } else {
            setGuideQuote({ status: 'loading' });
            try {
              const routePromise = distanceMiles
                ? Promise.resolve({ data: { direct: { miles: distanceMiles } } })
                : api.post('/crm/route-info', { from: fromPostcode, to: toPostcode }).catch(() => ({ data: null }));

              const [surveyRes, catalogData, bandsRes, routeRes] = await Promise.all([
                api.get(`/crm/jobs/${jobId}/survey`).catch(() => ({ data: null })),
                loadCatalog(),
                api.get('/settings/distance-price-bands').catch(() => ({ data: DEFAULT_PRICE_BANDS })),
                routePromise,
              ]);

              const miles: number | null = routeRes.data?.direct?.miles ?? null;
              if (!miles) {
                setGuideQuote({ status: 'incomplete', reason: 'Could not calculate distance' });
              } else {
                // Calculate total cubic feet from survey data
                const allItems = (catalogData ?? []).flatMap((c: any) => c.items as Array<{ name: string; volumeCuFt: number }>);
                const volumeMap = new Map(allItems.map(i => [i.name, i.volumeCuFt]));

                let totalCuFt = 0;
                const surveyPayload = surveyRes.data;
                if (surveyPayload) {
                  const roomData: Record<string, Record<string, { count: number }>> = surveyPayload.data ?? {};
                  for (const room of Object.values(roomData)) {
                    for (const [itemName, entry] of Object.entries(room)) {
                      totalCuFt += (volumeMap.get(itemName) ?? 0) * entry.count;
                    }
                  }
                  const searchData: Record<string, { count: number }> = surveyPayload.searchData ?? {};
                  for (const [itemName, entry] of Object.entries(searchData)) {
                    totalCuFt += (volumeMap.get(itemName) ?? 0) * entry.count;
                  }
                }

                if (totalCuFt === 0) {
                  setGuideQuote({ status: 'incomplete', reason: 'Complete survey to calculate' });
                } else {
                  const bands: Array<{ upToMiles: number; ratePerCuFt: number }> =
                    Array.isArray(bandsRes.data) ? bandsRes.data : DEFAULT_PRICE_BANDS;
                  setPriceBands(bands);
                  const sorted = [...bands].sort((a, b) => a.upToMiles - b.upToMiles);
                  const band = sorted.find(b => miles <= b.upToMiles);
                  const flatRate = !band;
                  const rate = band ? band.ratePerCuFt : OVER_200_RATE;
                  const rawPrice = totalCuFt * rate;
                  const price = Math.round(rawPrice / 5) * 5;
                  setGuideQuote({ status: 'done', price, cuFt: totalCuFt, miles, rate, flatRate });
                }
              }
            } catch {
              setGuideQuote({ status: 'incomplete', reason: 'Could not calculate guide price' });
            }
          }
        } catch (err) {
          console.error('[QuoteBuilder] Failed to load job/docs:', err);
        }
      })();
    }
  }, [jobId, distanceMiles]);

  // Auto-clear toast after 4 seconds
  useEffect(() => {
    if (!sendingToast) return;
    const t = setTimeout(() => setSendingToast(null), 4000);
    return () => clearTimeout(t);
  }, [sendingToast]);

  function persist(next: QuoteBuilderState) {
    if (!storageKey) return;
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* ignore */ }
  }

  // ── Guide Quote manual edit handlers ─────────────────────────────────────
  function handleEditGuideQuote() {
    if (guideQuote.status === 'done') {
      setManualMiles(guideQuote.miles.toFixed(1));
      setManualCuFt(guideQuote.cuFt.toFixed(1));
    } else {
      setManualMiles('');
      setManualCuFt('');
    }
    setIsEditingGuideQuote(true);
  }

  function handleSaveGuideQuote() {
    const miles = parseFloat(manualMiles);
    const cuFt = parseFloat(manualCuFt);
    if (!isNaN(miles) && miles > 0 && !isNaN(cuFt) && cuFt > 0) {
      const sorted = [...priceBands].sort((a, b) => a.upToMiles - b.upToMiles);
      const band = sorted.find(b => miles <= b.upToMiles);
      const flatRate = !band;
      const rate = band ? band.ratePerCuFt : OVER_200_RATE;
      const price = Math.round(cuFt * rate / 5) * 5;
      setGuideQuote({ status: 'done', price, cuFt, miles, rate, flatRate });
    }
    setIsEditingGuideQuote(false);
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

  // ── Send-to-client helpers ─────────────────────────────────────────────────

  const estimateTotal = listTotal(committed.estimateItems);
  const hasEstimateItems = committed.estimateItems.length > 0;
  const hasFixedItems = committed.quotationItems.length > 0 || quotationAddons.some(a => a.selected);
  const fixedReadyToSend = hasFixedItems && fixQuotationTotal > 0;

  /**
   * Lazily create a Quote on the server (if one doesn't exist) and return its id.
   *
   * IMPORTANT: We deliberately do NOT send a `quote_number` — the server
   * generates and persists the canonical reference number (EST-##### for
   * estimates, iMQ-##### for fixed quotes). We then capture both the row id
   * AND the saved `quote_number` into local state so every subsequent
   * resend / modal preview shows the exact same number.
   */
  async function ensureQuote(quote_type: 'estimate' | 'fixed'): Promise<number | null> {
    if (!jobId) return null;
    if (quote_type === 'estimate' && existingDocs.estimateQuoteId) return existingDocs.estimateQuoteId;
    if (quote_type === 'fixed' && existingDocs.fixedQuoteId) return existingDocs.fixedQuoteId;

    const items = quote_type === 'estimate'
      ? committed.estimateItems.map(i => ({ description: i.description, quantity: 1, unit_price: i.price, total: i.price }))
      : [
          ...committed.quotationItems.map(i => ({ description: i.description, quantity: 1, unit_price: i.price, total: i.price })),
          ...committed.quotationAddons.filter(a => a.selected).map(a => ({ description: `${a.description} (add-on)`, quantity: 1, unit_price: a.price, total: a.price })),
        ];

    const total = quote_type === 'estimate' ? estimateTotal : fixQuotationTotal;

    const res = await api.post(`/crm/jobs/${jobId}/quotes`, {
      quote_type,
      // No quote_number — server generates it.
      subtotal: total,
      tax_amount: 0, // VAT already included in line prices for now
      total,
      deposit: quote_type === 'fixed' ? depositAmount : 0,
      items,
    });

    const newId: number = res.data.id;
    const newNumber: string | undefined = res.data.quote_number;
    setExistingDocs(prev => quote_type === 'estimate'
      ? { ...prev, estimateQuoteId: newId, estimateQuoteNumber: newNumber }
      : { ...prev, fixedQuoteId: newId, fixedQuoteNumber: newNumber });
    return newId;
  }

  /**
   * Lazily create an Invoice (deposit or main) on the server and return its id.
   *
   * Same contract as `ensureQuote`: server is the sole source of truth for
   * the `invoice_number` (DEP-##### or INV-#####).
   */
  async function ensureInvoice(invoice_type: 'deposit' | 'main'): Promise<number | null> {
    if (!jobId) return null;
    if (invoice_type === 'deposit' && existingDocs.depositInvoiceId) return existingDocs.depositInvoiceId;
    if (invoice_type === 'main' && existingDocs.mainInvoiceId) return existingDocs.mainInvoiceId;

    const fixedQuoteId = await ensureQuote('fixed');

    const items = invoice_type === 'deposit'
      ? [{ description: `Deposit for moving services`, quantity: 1, unit_price: depositAmount, total: depositAmount }]
      : [
          ...committed.quotationItems.map(i => ({ description: i.description, quantity: 1, unit_price: i.price, total: i.price })),
          ...committed.quotationAddons.filter(a => a.selected).map(a => ({ description: `${a.description} (add-on)`, quantity: 1, unit_price: a.price, total: a.price })),
        ];

    const total = invoice_type === 'deposit' ? depositAmount : fixQuotationTotal;

    const res = await api.post(`/crm/jobs/${jobId}/invoices`, {
      invoice_type,
      quote_id: fixedQuoteId,
      subtotal: total,
      tax_amount: 0,
      total,
      items,
    });

    const newId: number = res.data.id;
    const newNumber: string | undefined = res.data.invoice_number;
    setExistingDocs(prev => invoice_type === 'deposit'
      ? { ...prev, depositInvoiceId: newId, depositInvoiceNumber: newNumber }
      : { ...prev, mainInvoiceId: newId, mainInvoiceNumber: newNumber });
    return newId;
  }

  /**
   * Open the modal for a given document type.
   *
   * IMPORTANT: To avoid the placeholder "?????" leaking into the email
   * subject/body that the user composes, we eagerly create the underlying
   * Quote/Invoice on the server BEFORE rendering the modal. That way the
   * modal opens with the real reference number (EST-00100, iMQ-00101 …)
   * already in `existingDocs`, the subject template substitutes the real
   * value, and Send fires off an email containing the canonical number.
   *
   * Receipts (`deposit-receipt` / `move-receipt`) are different — they
   * require an existing paid invoice, so we don't create anything here;
   * the modal just shows the existing invoice number.
   */
  async function openSendModal(t: DocumentType) {
    if (!jobInfo?.email) {
      setSendingToast({ kind: 'error', msg: 'Customer has no email address on file. Add one in the Job Details panel.' });
      return;
    }

    setBusyAction(t);
    try {
      if (t === 'estimate-quote' && !existingDocs.estimateQuoteId) {
        await ensureQuote('estimate');
      } else if (t === 'fixed-quote' && !existingDocs.fixedQuoteId) {
        await ensureQuote('fixed');
      } else if (t === 'deposit-invoice' && !existingDocs.depositInvoiceId) {
        await ensureInvoice('deposit');
      } else if (t === 'main-invoice' && !existingDocs.mainInvoiceId) {
        await ensureInvoice('main');
      }
      setActiveModal(t);
    } catch (err: any) {
      console.error('[QuoteBuilder] failed to reserve reference number:', err);
      setSendingToast({
        kind: 'error',
        msg: err?.response?.data?.error || err?.message || 'Failed to prepare document. Please try again.',
      });
    } finally {
      setBusyAction(null);
    }
  }

  /** Modal onSend dispatcher — knows which endpoint to hit per document type */
  async function handleSend(documentType: DocumentType, data: SendDocumentData) {
    if (!jobId) throw new Error('No job ID');
    setBusyAction(documentType);
    try {
      if (documentType === 'estimate-quote' || documentType === 'fixed-quote') {
        const quoteId = await ensureQuote(documentType === 'estimate-quote' ? 'estimate' : 'fixed');
        if (!quoteId) throw new Error('Failed to create quote');
        await api.post(`/crm/jobs/${jobId}/quotes/${quoteId}/send-email`, {
          to: data.to, cc: data.cc, bcc: data.bcc,
          subject: data.subject, body_html: data.body_html, attach_pdf: data.attach_pdf,
        });
      } else if (documentType === 'deposit-invoice') {
        const invId = await ensureInvoice('deposit');
        if (!invId) throw new Error('Failed to create deposit invoice');
        await api.post(`/crm/jobs/${jobId}/invoices/${invId}/send-email`, {
          to: data.to, subject: data.subject, body_html: data.body_html, attach_pdf: data.attach_pdf,
        });
      } else if (documentType === 'main-invoice') {
        const invId = await ensureInvoice('main');
        if (!invId) throw new Error('Failed to create main invoice');
        await api.post(`/crm/jobs/${jobId}/invoices/${invId}/send-email`, {
          to: data.to, subject: data.subject, body_html: data.body_html, attach_pdf: data.attach_pdf,
        });
      } else if (documentType === 'deposit-receipt') {
        const invId = existingDocs.depositInvoiceId;
        if (!invId) throw new Error('No deposit invoice exists yet');
        await api.post(`/crm/jobs/${jobId}/invoices/${invId}/send-receipt`, {
          to: data.to, subject: data.subject, body_html: data.body_html,
        });
      } else if (documentType === 'move-receipt') {
        const invId = existingDocs.mainInvoiceId;
        if (!invId) throw new Error('No main invoice exists yet');
        await api.post(`/crm/jobs/${jobId}/invoices/${invId}/send-receipt`, {
          to: data.to, subject: data.subject, body_html: data.body_html,
        });
      }
      setSendingToast({ kind: 'success', msg: 'Email sent successfully ✉️' });
      // Server may have auto-advanced the job's pipeline status — let the
      // parent page refetch so the chart + badge reflect the new stage.
      onJobUpdated?.();
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Failed to send email';
      setSendingToast({ kind: 'error', msg });
      throw err;
    } finally {
      setBusyAction(null);
    }
  }

  // Modal config for the currently-open modal.
  //
  // The displayed `docNumber` is the *real* saved reference number from the
  // server (EST-#####, iMQ-#####, DEP-#####, INV-#####). Until a document
  // has been created on first send, we show the prefix-only placeholder
  // (e.g. "EST-?????") — never a randomly-generated stand-in. Once Send is
  // pressed, the server-generated number replaces the placeholder and is
  // pinned for the lifetime of that document, including all resends.
  const modalConfig: { docNumber: string; amount: number; jobTotal?: number; previewUrl?: string } | null = activeModal
    ? (() => {
        const placeholder = REF_PLACEHOLDER[activeModal];
        switch (activeModal) {
          case 'estimate-quote': return {
            docNumber: existingDocs.estimateQuoteNumber ?? placeholder,
            amount: estimateTotal,
            previewUrl: existingDocs.estimateQuoteId ? `/api/crm/jobs/${jobId}/quotes/${existingDocs.estimateQuoteId}/pdf` : undefined,
          };
          case 'fixed-quote': return {
            docNumber: existingDocs.fixedQuoteNumber ?? placeholder,
            amount: fixQuotationTotal,
            previewUrl: existingDocs.fixedQuoteId ? `/api/crm/jobs/${jobId}/quotes/${existingDocs.fixedQuoteId}/pdf` : undefined,
          };
          case 'deposit-invoice': return {
            docNumber: existingDocs.depositInvoiceNumber ?? placeholder,
            amount: depositAmount,
            jobTotal: fixQuotationTotal,
            previewUrl: existingDocs.depositInvoiceId ? `/api/crm/jobs/${jobId}/invoices/${existingDocs.depositInvoiceId}/pdf` : undefined,
          };
          case 'deposit-receipt': return {
            docNumber: existingDocs.depositInvoiceNumber ?? placeholder,
            amount: depositAmount,
            jobTotal: fixQuotationTotal,
          };
          case 'main-invoice': return {
            docNumber: existingDocs.mainInvoiceNumber ?? placeholder,
            amount: fixQuotationTotal,
            previewUrl: existingDocs.mainInvoiceId ? `/api/crm/jobs/${jobId}/invoices/${existingDocs.mainInvoiceId}/pdf` : undefined,
          };
          case 'move-receipt': return {
            docNumber: existingDocs.mainInvoiceNumber ?? placeholder,
            amount: fixQuotationTotal,
          };
        }
      })()
    : null;

  return (
    <div className="space-y-5">
      {/* ── Guide Quote banner ────────────────────────────────────────────── */}
      <div className="rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-purple-50/50 overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-violet-200/70 bg-white/40 flex items-center gap-1.5">
          <Calculator className="w-4 h-4 text-violet-600" />
          <h3 className="text-sm font-bold tracking-tight text-violet-700">Guide Quote</h3>
          <div className="ml-auto">
            {isEditingGuideQuote ? (
              <button
                onClick={() => setIsEditingGuideQuote(false)}
                className="text-xs text-slate-500 hover:text-slate-700 transition-colors"
              >
                Cancel
              </button>
            ) : (
              <button
                onClick={handleEditGuideQuote}
                className="flex items-center gap-1 text-xs text-violet-600 hover:text-violet-800 transition-colors"
              >
                <Pencil className="w-3 h-3" />
                Edit
              </button>
            )}
          </div>
        </div>
        <div className="px-4 py-3">
          {isEditingGuideQuote ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Miles</label>
                  <input
                    type="number"
                    min="0"
                    value={manualMiles}
                    onChange={e => setManualMiles(e.target.value)}
                    placeholder="e.g. 45"
                    className="w-full text-sm border border-violet-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-400 bg-white"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Cubic Feet</label>
                  <input
                    type="number"
                    min="0"
                    value={manualCuFt}
                    onChange={e => setManualCuFt(e.target.value)}
                    placeholder="e.g. 350"
                    className="w-full text-sm border border-violet-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-400 bg-white"
                  />
                </div>
              </div>
              <button
                onClick={handleSaveGuideQuote}
                disabled={!manualMiles || !manualCuFt}
                className="w-full flex items-center justify-center gap-1.5 bg-violet-600 hover:bg-violet-700 disabled:bg-violet-300 text-white text-xs font-semibold rounded-lg px-3 py-1.5 transition-colors"
              >
                <Check className="w-3.5 h-3.5" />
                Save &amp; Recalculate
              </button>
            </div>
          ) : guideQuote.status === 'idle' || guideQuote.status === 'loading' ? (
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
              <p className="text-xs text-slate-400">Calculating…</p>
            </div>
          ) : guideQuote.status === 'incomplete' ? (
            <p className="text-xs text-slate-400 italic">{guideQuote.reason}</p>
          ) : (
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-3xl font-bold text-violet-900 tabular-nums tracking-tight">
                  {fmt(guideQuote.price)}
                </p>
                <p className="text-xs text-slate-500 mt-1 tabular-nums">
                  {guideQuote.cuFt.toFixed(1)} cu ft
                  {' · '}
                  {guideQuote.miles.toFixed(1)} miles
                  {' · '}
                  £{guideQuote.rate.toFixed(2)}/cu ft
                  {guideQuote.flatRate && <span className="ml-1 text-amber-600 font-semibold">(flat rate &gt;200 miles)</span>}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Toast */}
      {sendingToast && (
        <div className={`flex items-start gap-2 rounded-lg px-3 py-2.5 border ${
          sendingToast.kind === 'success'
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
            : 'bg-red-50 border-red-200 text-red-800'
        }`}>
          {sendingToast.kind === 'success'
            ? <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            : <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />}
          <p className="text-xs font-medium flex-1">{sendingToast.msg}</p>
          <button onClick={() => setSendingToast(null)} className="text-xs hover:underline">Dismiss</button>
        </div>
      )}

      {/* ── Send to Client panel ──────────────────────────────────────────── */}
      <div className="rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 via-white to-indigo-50/50 overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-blue-200/70 bg-white/40 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-bold tracking-tight text-blue-700 flex items-center gap-1.5">
              <Mail className="w-4 h-4" /> Send to Client
            </h3>
            <p className="text-xs text-slate-500 mt-0.5 truncate">
              {jobInfo?.email
                ? <>Will email to <span className="font-semibold text-slate-700">{jobInfo.email}</span></>
                : <span className="text-amber-700">⚠ Customer has no email — add one in Job Details</span>}
            </p>
          </div>
        </div>

        <div className="p-3 grid grid-cols-2 md:grid-cols-3 gap-2">
          <SendButton
            label="Estimate Quote"
            sub={hasEstimateItems ? fmt(estimateTotal) : 'Add items first'}
            icon={<FileText className="w-4 h-4" />}
            disabled={!hasEstimateItems || !jobInfo?.email}
            busy={busyAction === 'estimate-quote'}
            sent={!!existingDocs.estimateQuoteId}
            onClick={() => openSendModal('estimate-quote')}
            color="cyan"
          />
          <SendButton
            label="Fixed Quote"
            sub={fixedReadyToSend ? fmt(fixQuotationTotal) : 'Add items first'}
            icon={<FileText className="w-4 h-4" />}
            disabled={!fixedReadyToSend || !jobInfo?.email}
            busy={busyAction === 'fixed-quote'}
            sent={!!existingDocs.fixedQuoteId}
            onClick={() => openSendModal('fixed-quote')}
            color="emerald"
          />
          <SendButton
            label="Deposit Invoice"
            sub={depositAmount > 0 ? fmt(depositAmount) : 'Set deposit first'}
            icon={<Receipt className="w-4 h-4" />}
            disabled={depositAmount <= 0 || !fixedReadyToSend || !jobInfo?.email}
            busy={busyAction === 'deposit-invoice'}
            sent={!!existingDocs.depositInvoiceId}
            onClick={() => openSendModal('deposit-invoice')}
            color="amber"
          />
          <SendButton
            label="Deposit Receipt"
            sub={committed.depositPaid ? 'Send confirmation' : 'Mark deposit paid first'}
            icon={<Send className="w-4 h-4" />}
            disabled={!committed.depositPaid || !jobInfo?.email}
            busy={busyAction === 'deposit-receipt'}
            onClick={() => openSendModal('deposit-receipt')}
            color="emerald"
          />
          <SendButton
            label="Final Invoice"
            sub={fixedReadyToSend ? fmt(fixQuotationTotal - (existingDocs.depositInvoicePaid ? depositAmount : 0)) : 'Add items first'}
            icon={<Receipt className="w-4 h-4" />}
            disabled={!fixedReadyToSend || !jobInfo?.email}
            busy={busyAction === 'main-invoice'}
            sent={!!existingDocs.mainInvoiceId}
            onClick={() => openSendModal('main-invoice')}
            color="indigo"
          />
          <SendButton
            label="Move Receipt"
            sub={committed.balancePaid ? 'Thank you & paid in full' : 'Mark balance paid first'}
            icon={<Send className="w-4 h-4" />}
            disabled={!committed.balancePaid || !jobInfo?.email}
            busy={busyAction === 'move-receipt'}
            onClick={() => openSendModal('move-receipt')}
            color="emerald"
          />
        </div>
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

      {/* ── Send Document modal ───────────────────────────────────────────── */}
      {activeModal && modalConfig && jobInfo && (
        <SendDocumentModal
          open={!!activeModal}
          onClose={() => setActiveModal(null)}
          documentType={activeModal}
          customerName={jobInfo.full_name}
          customerEmail={jobInfo.email || ''}
          documentNumber={modalConfig.docNumber}
          amount={modalConfig.amount}
          jobTotal={modalConfig.jobTotal}
          previewPdfUrl={modalConfig.previewUrl}
          onSend={(data) => handleSend(activeModal, data)}
        />
      )}
    </div>
  );
}

// ── Send-to-client button ─────────────────────────────────────────────────────

const SEND_BTN_COLORS: Record<string, { ring: string; bg: string; iconBg: string; iconText: string; sentRing: string }> = {
  cyan:    { ring: 'border-cyan-200 hover:border-cyan-400',      bg: 'hover:bg-cyan-50',    iconBg: 'bg-cyan-100',    iconText: 'text-cyan-600',    sentRing: 'border-cyan-500 ring-2 ring-cyan-200' },
  emerald: { ring: 'border-emerald-200 hover:border-emerald-400', bg: 'hover:bg-emerald-50', iconBg: 'bg-emerald-100', iconText: 'text-emerald-600', sentRing: 'border-emerald-500 ring-2 ring-emerald-200' },
  amber:   { ring: 'border-amber-200 hover:border-amber-400',     bg: 'hover:bg-amber-50',   iconBg: 'bg-amber-100',   iconText: 'text-amber-600',   sentRing: 'border-amber-500 ring-2 ring-amber-200' },
  indigo:  { ring: 'border-indigo-200 hover:border-indigo-400',   bg: 'hover:bg-indigo-50',  iconBg: 'bg-indigo-100',  iconText: 'text-indigo-600',  sentRing: 'border-indigo-500 ring-2 ring-indigo-200' },
};

function SendButton({
  label, sub, icon, disabled, busy, sent, onClick, color, secondaryAction,
}: {
  label: string;
  sub: string;
  icon: React.ReactNode;
  disabled?: boolean;
  busy?: boolean;
  sent?: boolean;
  onClick: () => void;
  color: 'cyan' | 'emerald' | 'amber' | 'indigo';
  secondaryAction?: { label: string; onClick: () => void };
}) {
  const c = SEND_BTN_COLORS[color];
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || busy}
        className={`w-full text-left px-3 py-2.5 rounded-lg border bg-white transition-all active:scale-[0.98] ${
          sent ? c.sentRing : c.ring
        } ${disabled ? 'opacity-50 cursor-not-allowed' : c.bg}`}
      >
        <div className="flex items-start gap-2.5">
          <div className={`w-8 h-8 rounded-lg ${c.iconBg} ${c.iconText} flex items-center justify-center flex-shrink-0`}>
            {busy
              ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
              : sent
                ? <Check className="w-4 h-4" strokeWidth={3} />
                : icon}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold text-slate-800 leading-tight">{label}</p>
            <p className="text-[11px] text-slate-500 mt-0.5 truncate">
              {sent ? `Sent · ${sub}` : sub}
            </p>
          </div>
        </div>
      </button>
      {secondaryAction && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); secondaryAction.onClick(); }}
          className="mt-1 w-full px-2 py-1 text-[10px] font-semibold rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
        >
          {secondaryAction.label}
        </button>
      )}
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
