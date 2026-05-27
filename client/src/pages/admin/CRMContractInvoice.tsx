import { useEffect, useState, useCallback, useMemo, Fragment } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft, Plus, Trash2, FileDown, Mail, Save, Check, X as XIcon,
  AlertCircle, CheckCircle, Lock,
} from 'lucide-react';
import CRMLayout from '../../components/CRMLayout';
import Modal from '../../components/Modal';
import api from '../../lib/api';
import type { Contract } from '../../types';

interface InvoiceItem {
  id?: number;
  source_contract_job_id: number | null;
  source_contract_job_item_id: number | null;
  job_date: string;
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
  sort_order?: number;
}

interface ContractInvoice {
  id: number;
  contract_id: number;
  invoice_number: string;
  week_start: string;
  week_end: string;
  header_description: string | null;
  notes: string | null;
  status: 'draft' | 'sent' | 'paid';
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  sent_at: string | null;
  sent_to: string | null;
  paid_at: string | null;
  items: InvoiceItem[];
  contract: Contract;
}

function Toast({ message, type, onDone }: { message: string; type: 'success' | 'error'; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 3500); return () => clearTimeout(t); }, [onDone]);
  return (
    <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-xl text-sm font-medium text-white ${type === 'success' ? 'bg-emerald-600' : 'bg-red-600'}`}>
      {type === 'success' ? <CheckCircle className="w-4 h-4 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 flex-shrink-0" />}
      {message}
    </div>
  );
}

function fmtDateShort(s: string) {
  return new Date(s + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}
function fmtDateLong(s: string) {
  return new Date(s + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
function fmtMoney(n: number) { return `£${(Number(n) || 0).toFixed(2)}`; }

export default function CRMContractInvoice() {
  const { id: cidParam, invoiceId: invIdParam } = useParams<{ id: string; invoiceId: string }>();
  const cid = parseInt(cidParam || '', 10);
  const invoiceId = parseInt(invIdParam || '', 10);
  const navigate = useNavigate();

  const [invoice, setInvoice] = useState<ContractInvoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [headerDescription, setHeaderDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [taxRate, setTaxRate] = useState(20);
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [sendingEmail, setSendingEmail] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const showToast = (message: string, type: 'success' | 'error' = 'success') => setToast({ message, type });

  const fetchInvoice = useCallback(async () => {
    const r = await api.get<ContractInvoice>(`/contract-jobs/invoices/${invoiceId}`);
    setInvoice(r.data);
    setHeaderDescription(r.data.header_description || '');
    setNotes(r.data.notes || '');
    setTaxRate(r.data.tax_rate);
    setItems(r.data.items.map(i => ({ ...i })));
    setEmailTo(r.data.contract.email || '');
    setLoading(false);
    setDirty(false);
  }, [invoiceId]);

  useEffect(() => { fetchInvoice(); }, [fetchInvoice]);

  const isLocked = invoice?.status === 'paid';

  const totals = useMemo(() => {
    const subtotal = items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unit_price) || 0), 0);
    const tax = +(subtotal * (Number(taxRate) || 0) / 100).toFixed(2);
    return { subtotal: +subtotal.toFixed(2), tax, total: +(subtotal + tax).toFixed(2) };
  }, [items, taxRate]);

  const updateLine = (idx: number, patch: Partial<InvoiceItem>) => {
    setItems(prev => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
    setDirty(true);
  };

  const removeLine = (idx: number) => {
    setItems(prev => prev.filter((_, i) => i !== idx));
    setDirty(true);
  };

  const addLineAfter = (idx: number, jobDate: string) => {
    setItems(prev => {
      const next = [...prev];
      next.splice(idx + 1, 0, {
        source_contract_job_id: null,
        source_contract_job_item_id: null,
        job_date: jobDate,
        description: '',
        quantity: 1,
        unit_price: 0,
        total: 0,
      });
      return next;
    });
    setDirty(true);
  };

  const handleSave = async () => {
    if (!invoice) return;
    setSaving(true);
    try {
      await api.put(`/contract-jobs/invoices/${invoice.id}`, {
        header_description: headerDescription,
        notes,
        tax_rate: Number(taxRate),
        items: items.map(i => ({
          id: i.id,
          source_contract_job_id: i.source_contract_job_id,
          source_contract_job_item_id: i.source_contract_job_item_id,
          job_date: i.job_date,
          description: i.description,
          quantity: i.quantity,
          unit_price: i.unit_price,
        })),
      });
      await fetchInvoice();
      showToast('Invoice saved');
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleStatus = async (status: 'draft' | 'sent' | 'paid') => {
    if (!invoice) return;
    try {
      await api.patch(`/contract-jobs/invoices/${invoice.id}/status`, { status });
      await fetchInvoice();
      showToast(`Marked ${status}`);
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to update status', 'error');
    }
  };

  const handlePdf = () => {
    if (!invoice) return;
    window.open(`/api/contract-jobs/invoices/${invoice.id}/pdf`, '_blank');
  };

  const openEmailModal = () => {
    if (!invoice) return;
    if (dirty) { showToast('Save your changes first', 'error'); return; }
    const weekLabel = fmtDateLong(invoice.week_start);
    setEmailSubject(`Invoice ${invoice.invoice_number} — week commencing ${weekLabel}`);
    setEmailOpen(true);
  };

  const handleSendEmail = async () => {
    if (!invoice || !emailTo.trim()) return;
    setSendingEmail(true);
    try {
      await api.post(`/contract-jobs/invoices/${invoice.id}/send-email`, {
        to: emailTo.trim(),
        subject: emailSubject,
      });
      setEmailOpen(false);
      await fetchInvoice();
      showToast('Invoice emailed');
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to send email', 'error');
    } finally {
      setSendingEmail(false);
    }
  };

  const handleDelete = async () => {
    if (!invoice) return;
    try {
      await api.delete(`/contract-jobs/invoices/${invoice.id}`);
      navigate(`/admin/crm/contract-jobs/${cid}?tab=invoices`);
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to delete', 'error');
    }
  };

  if (loading) {
    return <CRMLayout><div className="py-10 text-sm text-slate-400 text-center">Loading…</div></CRMLayout>;
  }
  if (!invoice) {
    return <CRMLayout><div className="py-10 text-sm text-slate-400 text-center">Invoice not found.</div></CRMLayout>;
  }

  // Group items by job_date for visual grouping
  const grouped: { date: string; rows: Array<{ item: InvoiceItem; idx: number }> }[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const last = grouped[grouped.length - 1];
    if (!last || last.date !== item.job_date) {
      grouped.push({ date: item.job_date, rows: [{ item, idx: i }] });
    } else {
      last.rows.push({ item, idx: i });
    }
  }

  return (
    <CRMLayout>
      <Link to={`/admin/crm/contract-jobs/${cid}?tab=invoices`} className="text-sm text-slate-500 hover:text-slate-700 inline-flex items-center gap-1.5 mb-3">
        <ArrowLeft className="w-3.5 h-3.5" />
        {invoice.contract.company_name}
      </Link>

      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-900">{invoice.invoice_number}</h1>
            {invoice.status === 'paid' ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700">
                <Check className="w-3 h-3" /> Paid
              </span>
            ) : invoice.status === 'sent' ? (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">Sent</span>
            ) : (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">Draft</span>
            )}
            {isLocked && (
              <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                <Lock className="w-3 h-3" /> Locked
              </span>
            )}
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Week commencing <strong>{fmtDateLong(invoice.week_start)}</strong>
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={handlePdf} className="btn-secondary flex items-center gap-2">
            <FileDown className="w-4 h-4" />
            PDF
          </button>
          <button onClick={openEmailModal} disabled={isLocked} className="btn-secondary flex items-center gap-2 disabled:opacity-50">
            <Mail className="w-4 h-4" />
            Email
          </button>
          <button onClick={handleSave} disabled={saving || isLocked || !dirty} className="btn-primary flex items-center gap-2 disabled:opacity-50">
            <Save className="w-4 h-4" />
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* Header description */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-5">
        <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Opening Description</label>
        <textarea
          value={headerDescription}
          onChange={e => { setHeaderDescription(e.target.value); setDirty(true); }}
          disabled={isLocked}
          rows={2}
          placeholder="e.g. We commenced work on Monday 18th May 2026."
          className="input-field w-full resize-none"
        />
      </div>

      {/* Items, grouped by day */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-5">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-3 font-semibold w-40">Date</th>
              <th className="text-left px-4 py-3 font-semibold">Description</th>
              <th className="text-center px-4 py-3 font-semibold w-20">Qty</th>
              <th className="text-right px-4 py-3 font-semibold w-28">Unit £</th>
              <th className="text-right px-4 py-3 font-semibold w-28">Total</th>
              <th className="w-10"></th>
            </tr>
          </thead>
          <tbody>
            {grouped.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-400">
                No line items. Add one below or generate from jobs.
              </td></tr>
            ) : grouped.map(group => (
              <Fragment key={`group-${group.date}-${group.rows[0]?.idx ?? 0}`}>
                <tr className="bg-slate-50/40 border-t border-slate-100">
                  <td colSpan={6} className="px-4 py-2 text-xs font-semibold text-slate-600 uppercase tracking-wider">
                    {fmtDateLong(group.date)}
                  </td>
                </tr>
                {group.rows.map(({ item, idx }) => (
                  <tr key={idx} className="border-t border-slate-50">
                    <td className="px-4 py-2">
                      <input
                        type="date"
                        value={item.job_date}
                        onChange={e => updateLine(idx, { job_date: e.target.value })}
                        disabled={isLocked}
                        className="input-field text-sm py-1 w-full"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        value={item.description}
                        onChange={e => updateLine(idx, { description: e.target.value })}
                        disabled={isLocked}
                        placeholder="e.g. 3 × Porter"
                        className="input-field text-sm py-1 w-full"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="number" step="any" min="0"
                        value={item.quantity}
                        onChange={e => updateLine(idx, { quantity: parseFloat(e.target.value) || 0 })}
                        disabled={isLocked}
                        className="input-field text-sm py-1 w-full text-center"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="number" step="0.01" min="0"
                        value={item.unit_price}
                        onChange={e => updateLine(idx, { unit_price: parseFloat(e.target.value) || 0 })}
                        disabled={isLocked}
                        className="input-field text-sm py-1 w-full text-right tabular-nums"
                      />
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-800 font-medium">
                      {fmtMoney((Number(item.quantity) || 0) * (Number(item.unit_price) || 0))}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <button
                        onClick={() => removeLine(idx)}
                        disabled={isLocked}
                        className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-40"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-slate-50">
                  <td colSpan={6} className="px-4 py-1.5">
                    <button
                      onClick={() => addLineAfter(group.rows[group.rows.length - 1].idx, group.date)}
                      disabled={isLocked}
                      className="text-xs font-medium text-blue-600 hover:text-blue-700 flex items-center gap-1 disabled:opacity-40"
                    >
                      <Plus className="w-3 h-3" />
                      Add line on {fmtDateShort(group.date)}
                    </button>
                  </td>
                </tr>
              </Fragment>
            ))}
            {/* Add a line for a brand-new date */}
            <tr className="border-t border-slate-200 bg-slate-50/30">
              <td colSpan={6} className="px-4 py-2">
                <button
                  onClick={() => setItems(prev => {
                    const dt = prev.length ? prev[prev.length - 1].job_date : invoice.week_start;
                    return [...prev, { source_contract_job_id: null, source_contract_job_item_id: null, job_date: dt, description: '', quantity: 1, unit_price: 0, total: 0 }];
                  })}
                  disabled={isLocked}
                  className="text-sm font-medium text-blue-600 hover:text-blue-700 flex items-center gap-1.5 disabled:opacity-40"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add line item
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Totals */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-5">
        <div className="flex justify-end">
          <div className="w-80 space-y-2">
            <div className="flex justify-between text-sm text-slate-600">
              <span>Subtotal</span>
              <span className="tabular-nums font-medium">{fmtMoney(totals.subtotal)}</span>
            </div>
            <div className="flex justify-between items-center text-sm text-slate-600">
              <div className="flex items-center gap-2">
                <span>VAT</span>
                <input
                  type="number" step="0.5" min="0"
                  value={taxRate}
                  onChange={e => { setTaxRate(parseFloat(e.target.value) || 0); setDirty(true); }}
                  disabled={isLocked}
                  className="input-field text-xs py-0.5 px-1.5 w-14 text-right"
                />
                <span>%</span>
              </div>
              <span className="tabular-nums font-medium">{fmtMoney(totals.tax)}</span>
            </div>
            <div className="flex justify-between text-base font-bold text-slate-900 pt-2 border-t border-slate-200">
              <span>Total Due</span>
              <span className="tabular-nums">{fmtMoney(totals.total)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Notes */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-5">
        <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Notes</label>
        <textarea
          value={notes}
          onChange={e => { setNotes(e.target.value); setDirty(true); }}
          disabled={isLocked}
          rows={2}
          placeholder="Internal or invoice footer notes…"
          className="input-field w-full resize-none"
        />
      </div>

      {/* Status actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {invoice.status === 'draft' && (
            <button onClick={() => handleStatus('sent')} className="btn-secondary text-sm">
              Mark Sent
            </button>
          )}
          {invoice.status !== 'paid' && (
            <button onClick={() => handleStatus('paid')} className="btn-secondary text-sm flex items-center gap-1.5">
              <Check className="w-3.5 h-3.5" />
              Mark Paid
            </button>
          )}
          {invoice.status === 'paid' && (
            <button onClick={() => handleStatus('sent')} className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1.5">
              <XIcon className="w-3.5 h-3.5" />
              Unmark Paid
            </button>
          )}
        </div>
        {invoice.status !== 'paid' && (
          <button onClick={() => setConfirmDelete(true)} className="text-sm text-red-600 hover:text-red-700">
            Delete invoice
          </button>
        )}
      </div>

      {/* Email modal */}
      <Modal open={emailOpen} onClose={() => setEmailOpen(false)} title="Email Invoice" size="md">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">To</label>
            <input value={emailTo} onChange={e => setEmailTo(e.target.value)} type="email" className="input-field w-full" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Subject</label>
            <input value={emailSubject} onChange={e => setEmailSubject(e.target.value)} className="input-field w-full" />
          </div>
          <p className="text-xs text-slate-500">
            The PDF will be attached. The contractor's source jobs will be locked once the invoice is sent.
          </p>
          <div className="flex gap-3 justify-end pt-1">
            <button onClick={() => setEmailOpen(false)} className="btn-secondary">Cancel</button>
            <button onClick={handleSendEmail} disabled={sendingEmail || !emailTo.trim()} className="btn-primary">
              {sendingEmail ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete confirm */}
      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete Invoice" size="sm">
        <p className="text-sm text-slate-600 mb-5">
          Delete invoice <span className="font-semibold">{invoice.invoice_number}</span>? Source jobs will be unlocked. This cannot be undone.
        </p>
        <div className="flex gap-3 justify-end">
          <button onClick={() => setConfirmDelete(false)} className="btn-secondary">Cancel</button>
          <button onClick={handleDelete} className="btn-danger">Delete</button>
        </div>
      </Modal>

      {toast && <Toast message={toast.message} type={toast.type} onDone={() => setToast(null)} />}
    </CRMLayout>
  );
}
