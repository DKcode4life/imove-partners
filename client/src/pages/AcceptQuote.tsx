import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import publicApi from '../lib/publicApi';

// ── Types (mirror server serializeQuote in routes/public-quote.js) ────────────
type QuoteItem = {
  id: number;
  description: string;
  total: number;
  accepted: boolean;
};

type AcceptQuoteData = {
  quote_number: string;
  status: string;
  is_accepted: boolean;
  accepted_at: string | null;
  declared_value: number | null;
  accepted_total: number | null;
  valid_until: string | null;
  vat_applied: boolean;
  tax_rate: number;
  customer_name: string;
  move_date: string | null;
  from_address: string | null;
  to_address: string | null;
  mandatory_items: QuoteItem[];
  optional_items: QuoteItem[];
  mandatory_subtotal: number;
  company: { name: string; phone: string; email: string };
  terms_url: string;
};

const gbp = (n: number) =>
  `£${(Number.isFinite(n) ? n : 0).toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const formatDate = (d: string | null) => {
  if (!d) return 'To be confirmed';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
};

export default function AcceptQuote() {
  const { token } = useParams<{ token: string }>();

  const [data, setData] = useState<AcceptQuoteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [declaredValue, setDeclaredValue] = useState('');
  const [agreedTerms, setAgreedTerms] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    let active = true;
    publicApi
      .get<AcceptQuoteData>(`/quotes/${token}`)
      .then((res) => {
        if (!active) return;
        setData(res.data);
        if (res.data.is_accepted) setAccepted(true);
      })
      .catch((err) => {
        if (!active) return;
        setLoadError(
          err.response?.data?.error || 'We could not load this quote. The link may be invalid or expired.',
        );
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [token]);

  const toggleOptional = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const { subtotal, vat, total } = useMemo(() => {
    if (!data) return { subtotal: 0, vat: 0, total: 0 };
    const optionalTotal = data.optional_items
      .filter((i) => selected.has(i.id))
      .reduce((s, i) => s + (i.total || 0), 0);
    const sub = data.mandatory_subtotal + optionalTotal;
    const v = data.vat_applied ? Math.round(sub * (data.tax_rate / 100) * 100) / 100 : 0;
    return { subtotal: sub, vat: v, total: Math.round((sub + v) * 100) / 100 };
  }, [data, selected]);

  const declaredNum = parseFloat(declaredValue);
  const canSubmit = agreedTerms && Number.isFinite(declaredNum) && declaredNum > 0 && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit || !data) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await publicApi.post(`/quotes/${token}/accept`, {
        selected_optional_ids: Array.from(selected),
        declared_value: declaredNum,
        accept_terms: true,
      });
      setAccepted(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err: any) {
      setSubmitError(err.response?.data?.error || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── States ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <Shell>
        <div className="flex items-center justify-center py-24 text-slate-400">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-green-600" />
        </div>
      </Shell>
    );
  }

  if (loadError || !data) {
    return (
      <Shell>
        <div className="px-8 py-16 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-50 text-2xl">⚠️</div>
          <h1 className="text-xl font-bold text-slate-800">Quote unavailable</h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">{loadError}</p>
        </div>
      </Shell>
    );
  }

  if (accepted) {
    const finalTotal = data.accepted_total ?? total;
    return (
      <Shell company={data.company}>
        <div className="px-6 py-12 text-center sm:px-10">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-3xl">✓</div>
          <h1 className="text-2xl font-bold text-slate-800">Thank you, {data.customer_name.split(' ')[0]}!</h1>
          <p className="mx-auto mt-3 max-w-md text-slate-500">
            Your quote <strong>{data.quote_number}</strong> has been accepted. A confirmation and your acceptance form
            have been emailed to you. We'll send your deposit invoice shortly to secure your move date.
          </p>
          <div className="mx-auto mt-7 max-w-xs rounded-xl border border-green-200 bg-green-50 px-6 py-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-green-700">Agreed Total</p>
            <p className="mt-1 text-3xl font-bold text-green-700">{gbp(finalTotal)}</p>
          </div>
          <a
            href={`/api/public/quotes/${token}/acceptance-pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-7 inline-block rounded-lg bg-slate-800 px-7 py-3 text-sm font-semibold text-white transition hover:bg-slate-900"
          >
            Download acceptance form (PDF)
          </a>
        </div>
      </Shell>
    );
  }

  // ── Main acceptance form ────────────────────────────────────────────────────
  return (
    <Shell company={data.company}>
      <div className="px-6 py-8 sm:px-10">
        <p className="text-xs font-semibold uppercase tracking-wider text-green-600">Quote {data.quote_number}</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-800">Review &amp; accept your quote</h1>
        <p className="mt-2 text-sm text-slate-500">
          Hi {data.customer_name.split(' ')[0]}, please check the details below, add any optional extras, confirm the
          value of your items for insurance, and accept.
        </p>

        {/* Move summary */}
        <div className="mt-6 grid gap-3 rounded-xl bg-slate-50 p-5 sm:grid-cols-3">
          <SummaryCell label="Move date" value={formatDate(data.move_date)} />
          <SummaryCell label="From" value={data.from_address || '—'} />
          <SummaryCell label="To" value={data.to_address || '—'} />
        </div>

        {/* Services */}
        <h2 className="mt-8 text-sm font-bold uppercase tracking-wide text-slate-500">Your services</h2>
        <div className="mt-3 space-y-2">
          {data.mandatory_items.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-5 w-5 items-center justify-center rounded bg-green-600 text-xs text-white">✓</span>
                <div>
                  <p className="text-sm font-medium text-slate-800">{item.description}</p>
                  <p className="text-xs text-slate-400">Included</p>
                </div>
              </div>
              <span className="text-sm font-semibold text-slate-700">{gbp(item.total)}</span>
            </div>
          ))}
        </div>

        {data.optional_items.length > 0 && (
          <>
            <h2 className="mt-7 text-sm font-bold uppercase tracking-wide text-slate-500">Optional extras</h2>
            <p className="mt-1 text-xs text-slate-400">Tick any you'd like to add — your total updates instantly.</p>
            <div className="mt-3 space-y-2">
              {data.optional_items.map((item) => {
                const isOn = selected.has(item.id);
                return (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => toggleOptional(item.id)}
                    className={`flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left transition ${
                      isOn ? 'border-green-500 bg-green-50' : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={`flex h-5 w-5 items-center justify-center rounded border text-xs ${
                          isOn ? 'border-green-600 bg-green-600 text-white' : 'border-slate-300 text-transparent'
                        }`}
                      >
                        ✓
                      </span>
                      <p className="text-sm font-medium text-slate-800">{item.description}</p>
                    </div>
                    <span className="text-sm font-semibold text-slate-700">
                      {isOn ? '' : '+ '}
                      {gbp(item.total)}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {/* Totals */}
        <div className="mt-7 rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex justify-between text-sm text-slate-500">
            <span>Subtotal</span>
            <span>{gbp(subtotal)}</span>
          </div>
          {data.vat_applied && (
            <div className="mt-2 flex justify-between text-sm text-slate-500">
              <span>VAT ({data.tax_rate}%)</span>
              <span>{gbp(vat)}</span>
            </div>
          )}
          <div className="mt-3 flex items-baseline justify-between border-t border-slate-100 pt-3">
            <span className="text-base font-bold text-slate-800">Total</span>
            <span className="text-2xl font-bold text-green-700">{gbp(total)}</span>
          </div>
        </div>

        {/* Declared value */}
        <h2 className="mt-8 text-sm font-bold uppercase tracking-wide text-slate-500">Insurance valuation</h2>
        <p className="mt-1 text-xs text-slate-400">
          Enter the total value of the items being moved so we can arrange full insurance cover for your move.
        </p>
        <div className="mt-3 flex items-center rounded-lg border border-slate-300 bg-white px-4 focus-within:border-green-500">
          <span className="text-lg font-semibold text-slate-400">£</span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="100"
            value={declaredValue}
            onChange={(e) => setDeclaredValue(e.target.value)}
            placeholder="e.g. 25000"
            className="w-full bg-transparent px-2 py-3 text-lg text-slate-800 outline-none"
          />
        </div>

        {/* Terms */}
        <label className="mt-6 flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={agreedTerms}
            onChange={(e) => setAgreedTerms(e.target.checked)}
            className="mt-0.5 h-5 w-5 rounded border-slate-300 text-green-600 focus:ring-green-500"
          />
          <span className="text-sm text-slate-600">
            I agree to iMove Relocations'{' '}
            <a
              href={data.terms_url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-green-700 underline"
            >
              terms &amp; conditions
            </a>{' '}
            and wish to proceed with this quotation.
          </span>
        </label>

        {submitError && (
          <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{submitError}</p>
        )}

        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="mt-6 w-full rounded-xl bg-green-600 py-4 text-base font-bold text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {submitting ? 'Submitting…' : `Accept quote — ${gbp(total)}`}
        </button>
        <p className="mt-3 text-center text-xs text-slate-400">
          By accepting, you'll receive a confirmation and acceptance form by email.
        </p>
      </div>
    </Shell>
  );
}

// ── Layout shell ──────────────────────────────────────────────────────────────
function Shell({
  children,
  company,
}: {
  children: React.ReactNode;
  company?: { name: string; phone: string; email: string };
}) {
  return (
    <div className="min-h-screen bg-slate-100 py-8 px-4">
      <div className="mx-auto max-w-xl overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <div className="bg-gradient-to-r from-green-600 to-green-700 px-8 py-6 text-center">
          <h1 className="text-xl font-bold tracking-tight text-white">iMove Relocations</h1>
          <p className="mt-0.5 text-xs text-green-100">Stress-free moving, fixed prices</p>
        </div>
        {children}
      </div>
      {company && (
        <p className="mx-auto mt-5 max-w-xl text-center text-xs text-slate-400">
          Questions? Call {company.phone} or email{' '}
          <a href={`mailto:${company.email}`} target="_blank" rel="noopener noreferrer" className="underline">
            {company.email}
          </a>
        </p>
      )}
    </div>
  );
}

function SummaryCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-slate-700">{value}</p>
    </div>
  );
}
