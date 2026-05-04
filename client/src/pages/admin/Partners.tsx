import { useEffect, useState, useCallback } from 'react';
import {
  Plus, Users, Pencil, Trash2, ToggleLeft, ToggleRight,
  CheckCircle, PoundSterling, Clock, TrendingUp, ChevronRight,
  Eye, EyeOff,
} from 'lucide-react';
import Layout from '../../components/Layout';
import Modal from '../../components/Modal';
import api from '../../lib/api';
import type { Partner, Lead } from '../../types';

function fmt(n: number | null | undefined) {
  if (!n) return '£0.00';
  return `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtDateTime(d: string) {
  return new Date(d).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

const PAYMENT_METHODS = ['Bank Transfer', 'Amazon Gift Card', 'Cash'] as const;
type PaymentMethod = typeof PAYMENT_METHODS[number];

interface PartnerForm {
  name: string; email: string; password: string;
  agency_name: string; phone: string; commission_rate: string;
  payment_method: PaymentMethod | '';
  bank_account: string;
  bank_sort_code: string;
  gift_card_email: string;
}
const EMPTY_FORM: PartnerForm = {
  name: '', email: '', password: '', agency_name: '', phone: '', commission_rate: '10',
  payment_method: '', bank_account: '', bank_sort_code: '', gift_card_email: '',
};

interface CommissionData {
  ready: Lead[];
  pipeline: Lead[];
  paid: Lead[];
}

interface PartnerFormFieldsProps {
  form: PartnerForm;
  setForm: React.Dispatch<React.SetStateAction<PartnerForm>>;
  isEdit: boolean;
  error: string;
}

function PartnerFormFields({ form, setForm, isEdit, error }: PartnerFormFieldsProps) {
  const setF = (k: keyof PartnerForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }));

  return (
    <div className="space-y-4">
      {error && <div className="bg-red-50 border border-red-100 text-red-700 px-3 py-2 rounded-lg text-sm">{error}</div>}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Full name</label>
          <input className="input" value={form.name} onChange={setF('name')} required placeholder="Jane Smith" />
        </div>
        <div>
          <label className="label">Agency name</label>
          <input className="input" value={form.agency_name} onChange={setF('agency_name')} required placeholder="Premier Properties" />
        </div>
      </div>
      <div>
        <label className="label">Email address</label>
        <input type="email" className="input" value={form.email} onChange={setF('email')} required placeholder="jane@agency.co.uk" />
      </div>
      {!isEdit && (
        <div>
          <label className="label">Password</label>
          <input type="password" className="input" value={form.password} onChange={setF('password')} required placeholder="••••••••" minLength={6} />
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Phone</label>
          <input className="input" value={form.phone} onChange={setF('phone')} placeholder="020 7000 0000" />
        </div>
        <div>
          <label className="label">Commission rate (%)</label>
          <input type="number" min="0" max="100" step="0.5" className="input" value={form.commission_rate} onChange={setF('commission_rate')} required />
        </div>
      </div>

      {/* Payment method */}
      <div>
        <label className="label">Payment method</label>
        <div className="flex rounded-xl border border-slate-200 overflow-hidden">
          {PAYMENT_METHODS.map((method, i) => (
            <button
              key={method}
              type="button"
              className={`flex-1 py-2 text-sm font-medium transition-colors ${
                form.payment_method === method
                  ? 'bg-brand-600 text-white'
                  : 'text-slate-600 hover:bg-slate-50'
              }${i > 0 ? ' border-l border-slate-200' : ''}`}
              onClick={() => setForm(prev => ({ ...prev, payment_method: method }))}
            >
              {method}
            </button>
          ))}
        </div>
      </div>

      {/* Amazon Gift Card email */}
      {form.payment_method === 'Amazon Gift Card' && (
        <div className="bg-amber-50 rounded-xl p-4 space-y-3 border border-amber-100">
          <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">Gift Card Details</p>
          <div>
            <label className="label">Email address for gift cards</label>
            <input
              type="email"
              className="input"
              value={form.gift_card_email}
              onChange={setF('gift_card_email')}
              placeholder="partner@email.com"
            />
            <p className="text-xs text-slate-400 mt-1">Amazon gift cards will be sent to this address</p>
          </div>
        </div>
      )}

      {/* Bank details */}
      {form.payment_method === 'Bank Transfer' && (
        <div className="bg-slate-50 rounded-xl p-4 space-y-3 border border-slate-100">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Bank Details</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Account number</label>
              <input
                className="input"
                value={form.bank_account}
                onChange={setF('bank_account')}
                placeholder="12345678"
                maxLength={8}
              />
            </div>
            <div>
              <label className="label">Sort code</label>
              <input
                className="input"
                value={form.bank_sort_code}
                onChange={setF('bank_sort_code')}
                placeholder="00-00-00"
                maxLength={8}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminPartnersPage() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [addModal, setAddModal] = useState(false);
  const [editPartner, setEditPartner] = useState<Partner | null>(null);
  const [deletePartner, setDeletePartner] = useState<Partner | null>(null);
  const [form, setForm] = useState<PartnerForm>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  // Commission modal state
  const [commPartner, setCommPartner] = useState<Partner | null>(null);
  const [commData, setCommData] = useState<CommissionData | null>(null);
  const [commLoading, setCommLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [paying, setPaying] = useState(false);

  const fetchPartners = () => {
    api.get('/partners').then(r => setPartners(r.data)).finally(() => setLoading(false));
  };

  useEffect(() => { fetchPartners(); }, []);

  const openCommissions = useCallback(async (p: Partner) => {
    setCommPartner(p);
    setCommData(null);
    setSelectedIds(new Set());
    setCommLoading(true);
    try {
      const r = await api.get(`/partners/${p.id}/commissions`);
      setCommData(r.data);
    } finally {
      setCommLoading(false);
    }
  }, []);

  const closeCommissions = () => {
    setCommPartner(null);
    setCommData(null);
    setSelectedIds(new Set());
  };

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (!commData) return;
    setSelectedIds(new Set(commData.ready.map(l => l.id)));
  };

  const clearAll = () => setSelectedIds(new Set());

  const selectedTotal = commData
    ? commData.ready
        .filter(l => selectedIds.has(l.id))
        .reduce((sum, l) => sum + (l.estimated_commission ?? 0), 0)
    : 0;

  const handlePay = async () => {
    if (selectedIds.size === 0 || !commPartner) return;
    setPaying(true);
    try {
      await api.post('/leads/pay', { lead_ids: Array.from(selectedIds) });
      // Re-fetch commissions and partners to reflect changes
      const [commR] = await Promise.all([
        api.get(`/partners/${commPartner.id}/commissions`),
        api.get('/partners').then(r => setPartners(r.data)),
      ]);
      setCommData(commR.data);
      setSelectedIds(new Set());
    } finally {
      setPaying(false);
    }
  };

  const openEdit = (p: Partner) => {
    setEditPartner(p);
    setForm({
      name: p.user_name, email: p.user_email, password: '',
      agency_name: p.agency_name, phone: p.phone || '',
      commission_rate: String(p.commission_rate),
      payment_method: (p.payment_method as PaymentMethod) || '',
      bank_account: p.bank_account || '',
      bank_sort_code: p.bank_sort_code || '',
      gift_card_email: p.gift_card_email || '',
    });
    setError('');
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true); setError('');
    try {
      await api.post('/partners', {
        ...form,
        commission_rate: parseFloat(form.commission_rate),
        payment_method: form.payment_method || null,
        bank_account: form.bank_account || null,
        bank_sort_code: form.bank_sort_code || null,
        gift_card_email: form.gift_card_email || null,
      });
      setAddModal(false);
      setForm(EMPTY_FORM);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      fetchPartners();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg || 'Failed to create partner');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editPartner) return;
    setSubmitting(true); setError('');
    try {
      await api.put(`/partners/${editPartner.id}`, {
        name: form.name, email: form.email, agency_name: form.agency_name,
        phone: form.phone, commission_rate: parseFloat(form.commission_rate),
        payment_method: form.payment_method || null,
        bank_account: form.bank_account || null,
        bank_sort_code: form.bank_sort_code || null,
        gift_card_email: form.gift_card_email || null,
      });
      setEditPartner(null);
      fetchPartners();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg || 'Failed to update partner');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleActive = async (p: Partner) => {
    await api.put(`/partners/${p.id}`, { active: !p.active });
    fetchPartners();
  };

  const handleToggleLeadsVisible = async (p: Partner) => {
    await api.put(`/partners/${p.id}`, { leads_visible: !p.leads_visible });
    fetchPartners();
  };

  const handleDelete = async () => {
    if (!deletePartner) return;
    try {
      await api.delete(`/partners/${deletePartner.id}`);
      setDeletePartner(null);
      fetchPartners();
    } catch {
      setError('Failed to delete partner');
    }
  };

  return (
    <Layout>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="page-title">Partners</h1>
          <p className="page-subtitle">{partners.length} estate agenc{partners.length !== 1 ? 'ies' : 'y'}</p>
        </div>
        <div className="flex items-center gap-2">
          {saved && <span className="flex items-center gap-1.5 text-sm text-emerald-600 font-medium"><CheckCircle className="w-4 h-4" />Partner added!</span>}
          <button className="btn-primary" onClick={() => { setForm(EMPTY_FORM); setError(''); setAddModal(true); }}>
            <Plus className="w-4 h-4" /> Add Partner
          </button>
        </div>
      </div>

      {/* Partner cards */}
      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-7 h-7 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : partners.length === 0 ? (
        <div className="card py-16 text-center">
          <Users className="w-10 h-10 text-slate-200 mx-auto mb-3" />
          <p className="text-sm text-slate-500">No partners yet</p>
          <button className="btn-primary mt-4" onClick={() => setAddModal(true)}>
            <Plus className="w-4 h-4" /> Add your first partner
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {partners.map(p => (
            <div key={p.id} className={`card p-5 flex flex-col gap-4 ${!p.active ? 'opacity-60' : ''}`}>
              {/* Header */}
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 bg-brand-100 rounded-xl flex items-center justify-center overflow-hidden">
                    {p.user_avatar
                      ? <img src={p.user_avatar} alt={p.user_name} className="w-full h-full object-cover" />
                      : <span className="text-sm font-bold text-brand-700">{p.agency_name.charAt(0)}</span>
                    }
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{p.agency_name}</p>
                    <p className="text-xs text-slate-400">{p.user_name}</p>
                  </div>
                </div>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  p.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                }`}>
                  {p.active ? 'Active' : 'Inactive'}
                </span>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-2 bg-slate-50 rounded-xl p-3">
                <div className="text-center">
                  <p className="text-lg font-bold text-slate-900">{p.total_leads || 0}</p>
                  <p className="text-xs text-slate-400">Leads</p>
                </div>
                <div className="text-center border-x border-slate-200">
                  <p className="text-lg font-bold text-slate-900">{p.confirmed_jobs || 0}</p>
                  <p className="text-xs text-slate-400">Jobs</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-amber-600">{fmt(p.commission_owed)}</p>
                  <p className="text-xs text-slate-400">Owed</p>
                </div>
              </div>

              {/* Meta */}
              <div className="text-xs text-slate-400 space-y-0.5">
                <p>{p.user_email}</p>
                {p.phone && <p>{p.phone}</p>}
                <p>Commission: {p.commission_rate}% · Joined {fmtDate(p.created_at)}</p>
                {p.payment_method && (
                  <p className="flex items-center gap-1 mt-0.5">
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${
                      p.payment_method === 'Bank Transfer'
                        ? 'bg-brand-50 text-brand-700'
                        : p.payment_method === 'Cash'
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-amber-50 text-amber-700'
                    }`}>
                      {p.payment_method}
                    </span>
                    {p.payment_method === 'Bank Transfer' && p.bank_account && (
                      <span className="text-slate-400">··· {p.bank_account.slice(-4)}</span>
                    )}
                  </p>
                )}
              </div>

              {/* Actions */}
              <div className="flex flex-col gap-2 pt-1 border-t border-slate-100">
                <div className="flex items-center gap-2">
                  <button onClick={() => openEdit(p)} className="btn-secondary text-xs flex-1 justify-center">
                    <Pencil className="w-3.5 h-3.5" /> Edit
                  </button>
                  <button
                    onClick={() => handleToggleActive(p)}
                    className="btn-secondary text-xs flex-1 justify-center"
                    title={p.active ? 'Deactivate partner login' : 'Activate partner login'}
                  >
                    {p.active ? <ToggleRight className="w-3.5 h-3.5 text-emerald-600" /> : <ToggleLeft className="w-3.5 h-3.5" />}
                    {p.active ? 'Active' : 'Inactive'}
                  </button>
                  <button
                    onClick={() => setDeletePartner(p)}
                    className="btn-secondary text-xs text-red-500 hover:bg-red-50 hover:border-red-200 px-2"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <button
                  onClick={() => handleToggleLeadsVisible(p)}
                  className={`btn-secondary text-xs w-full justify-center gap-1.5 ${
                    p.leads_visible
                      ? 'text-brand-700 border-brand-200 bg-brand-50 hover:bg-brand-100'
                      : 'text-slate-400 hover:bg-slate-50'
                  }`}
                  title={p.leads_visible ? 'Hide this partner\'s leads from CRM' : 'Show this partner\'s leads in CRM'}
                >
                  {p.leads_visible
                    ? <Eye className="w-3.5 h-3.5" />
                    : <EyeOff className="w-3.5 h-3.5" />
                  }
                  {p.leads_visible ? 'Leads visible in CRM' : 'Leads hidden from CRM'}
                </button>
                <button
                  onClick={() => openCommissions(p)}
                  className="btn-secondary text-xs w-full justify-between"
                >
                  <span className="flex items-center gap-1.5">
                    <PoundSterling className="w-3.5 h-3.5 text-brand-500" />
                    Manage Commissions
                  </span>
                  <span className="flex items-center gap-1.5">
                    {(p.commission_owed ?? 0) > 0 && (
                      <span className="bg-amber-100 text-amber-700 text-xs font-semibold px-1.5 py-0.5 rounded-full">
                        {fmt(p.commission_owed)} owed
                      </span>
                    )}
                    <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                  </span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Commission modal ─────────────────────────────────────────────────── */}
      <Modal
        open={!!commPartner}
        onClose={closeCommissions}
        title={`${commPartner?.agency_name ?? ''} — Commissions`}
        size="lg"
      >
        {commLoading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-6 h-6 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : commData ? (
          <div className="space-y-6">

            {/* ── Summary row ── */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-emerald-50 rounded-xl p-3 text-center">
                <p className="text-xs text-emerald-600 font-medium mb-0.5">Total Paid</p>
                <p className="text-base font-bold text-emerald-700">
                  {fmt(commData.paid.reduce((s, l) => s + (l.estimated_commission ?? 0), 0))}
                </p>
              </div>
              <div className="bg-amber-50 rounded-xl p-3 text-center">
                <p className="text-xs text-amber-600 font-medium mb-0.5">Ready to Pay</p>
                <p className="text-base font-bold text-amber-700">
                  {fmt(commData.ready.reduce((s, l) => s + (l.estimated_commission ?? 0), 0))}
                </p>
              </div>
              <div className="bg-slate-50 rounded-xl p-3 text-center">
                <p className="text-xs text-slate-500 font-medium mb-0.5">In Pipeline</p>
                <p className="text-base font-bold text-slate-700">
                  {fmt(commData.pipeline.reduce((s, l) => s + (l.estimated_commission ?? 0), 0))}
                </p>
              </div>
            </div>

            {/* ── Payment method info ── */}
            {commPartner?.payment_method && (
              <div className={`flex items-center gap-3 rounded-xl px-4 py-3 border ${
                commPartner.payment_method === 'Bank Transfer'
                  ? 'bg-brand-50 border-brand-100'
                  : commPartner.payment_method === 'Cash'
                    ? 'bg-emerald-50 border-emerald-100'
                    : 'bg-amber-50 border-amber-100'
              }`}>
                <PoundSterling className={`w-4 h-4 flex-shrink-0 ${
                  commPartner.payment_method === 'Bank Transfer' ? 'text-brand-500'
                  : commPartner.payment_method === 'Cash' ? 'text-emerald-500'
                  : 'text-amber-500'
                }`} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-slate-700">Payment via {commPartner.payment_method}</p>
                  {commPartner.payment_method === 'Bank Transfer' && (commPartner.bank_account || commPartner.bank_sort_code) && (
                    <p className="text-xs text-slate-500 mt-0.5">
                      {commPartner.bank_account && <>Account: <span className="font-mono">{commPartner.bank_account}</span></>}
                      {commPartner.bank_account && commPartner.bank_sort_code && ' · '}
                      {commPartner.bank_sort_code && <>Sort code: <span className="font-mono">{commPartner.bank_sort_code}</span></>}
                    </p>
                  )}
                  {commPartner.payment_method === 'Amazon Gift Card' && commPartner.gift_card_email && (
                    <p className="text-xs text-slate-500 mt-0.5">
                      Send to: <span className="font-medium">{commPartner.gift_card_email}</span>
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* ── Ready to Pay ── */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 bg-amber-400 rounded-full" />
                  <h3 className="text-sm font-semibold text-slate-800">Ready to Pay</h3>
                  <span className="text-xs text-slate-400">Job completed · awaiting payment</span>
                </div>
                {commData.ready.length > 0 && (
                  <button
                    className="text-xs text-brand-600 hover:text-brand-700 font-medium"
                    onClick={selectedIds.size === commData.ready.length ? clearAll : selectAll}
                  >
                    {selectedIds.size === commData.ready.length ? 'Clear all' : 'Select all'}
                  </button>
                )}
              </div>

              {commData.ready.length === 0 ? (
                <p className="text-xs text-slate-400 py-3 text-center bg-slate-50 rounded-xl">
                  No completed jobs awaiting payment
                </p>
              ) : (
                <div className="border border-slate-100 rounded-xl overflow-hidden">
                  {commData.ready.map((lead, i) => (
                    <label
                      key={lead.id}
                      className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors ${
                        i > 0 ? 'border-t border-slate-100' : ''
                      } ${selectedIds.has(lead.id) ? 'bg-brand-50/60' : ''}`}
                    >
                      <input
                        type="checkbox"
                        className="w-4 h-4 accent-brand-600 flex-shrink-0"
                        checked={selectedIds.has(lead.id)}
                        onChange={() => toggleSelect(lead.id)}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">{lead.client_name}</p>
                        <p className="text-xs text-slate-400">{lead.current_address}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-semibold text-slate-800">
                          {lead.estimated_commission !== null ? fmt(lead.estimated_commission) : '—'}
                        </p>
                        <p className="text-xs text-slate-400">{lead.commission_rate}% of {fmt(lead.quote_value)}</p>
                      </div>
                    </label>
                  ))}
                </div>
              )}

              {/* Pay action bar */}
              {commData.ready.length > 0 && (
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
                  <div>
                    <p className="text-xs text-slate-500">
                      {selectedIds.size} selected
                    </p>
                    {selectedIds.size > 0 && (
                      <p className="text-sm font-semibold text-slate-800">Total: {fmt(selectedTotal)}</p>
                    )}
                  </div>
                  <button
                    className="btn-primary"
                    disabled={selectedIds.size === 0 || paying}
                    onClick={handlePay}
                  >
                    <CheckCircle className="w-4 h-4" />
                    {paying ? 'Processing…' : `Mark as Paid${selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}`}
                  </button>
                </div>
              )}
            </div>

            {/* ── In Pipeline ── */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-3.5 h-3.5 text-slate-400" />
                <h3 className="text-sm font-semibold text-slate-800">In Pipeline</h3>
                <span className="text-xs text-slate-400">estimated commissions</span>
              </div>

              {commData.pipeline.length === 0 ? (
                <p className="text-xs text-slate-400 py-3 text-center bg-slate-50 rounded-xl">
                  No leads currently in pipeline
                </p>
              ) : (
                <div className="border border-slate-100 rounded-xl overflow-hidden">
                  {commData.pipeline.map((lead, i) => (
                    <div
                      key={lead.id}
                      className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? 'border-t border-slate-100' : ''}`}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-700 truncate">{lead.client_name}</p>
                        <p className="text-xs text-slate-400">{lead.status}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        {lead.estimated_commission !== null ? (
                          <>
                            <p className="text-sm font-medium text-slate-600">~{fmt(lead.estimated_commission)}</p>
                            <p className="text-xs text-slate-400">{lead.commission_rate}% of {fmt(lead.quote_value)}</p>
                          </>
                        ) : (
                          <p className="text-xs text-slate-400">Quote pending</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── Payment History ── */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                <h3 className="text-sm font-semibold text-slate-800">Payment History</h3>
              </div>

              {commData.paid.length === 0 ? (
                <p className="text-xs text-slate-400 py-3 text-center bg-slate-50 rounded-xl">
                  No payments made yet
                </p>
              ) : (
                <div className="border border-slate-100 rounded-xl overflow-hidden">
                  {commData.paid.map((lead, i) => (
                    <div
                      key={lead.id}
                      className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? 'border-t border-slate-100' : ''}`}
                    >
                      <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-700 truncate">{lead.client_name}</p>
                        <p className="text-xs text-slate-400">
                          Paid {lead.commission_paid_at ? fmtDateTime(lead.commission_paid_at) : '—'}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-semibold text-emerald-600">
                          {lead.estimated_commission !== null ? fmt(lead.estimated_commission) : '—'}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        ) : null}
      </Modal>

      {/* Add partner modal */}
      <Modal open={addModal} onClose={() => setAddModal(false)} title="Add New Partner" size="md">
        <form onSubmit={handleAdd} className="space-y-5">
          <PartnerFormFields form={form} setForm={setForm} isEdit={false} error={error} />
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" className="btn-secondary" onClick={() => setAddModal(false)}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? 'Creating…' : 'Create Partner'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit partner modal */}
      <Modal open={!!editPartner} onClose={() => setEditPartner(null)} title="Edit Partner" size="md">
        <form onSubmit={handleEdit} className="space-y-5">
          <PartnerFormFields form={form} setForm={setForm} isEdit={true} error={error} />
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" className="btn-secondary" onClick={() => setEditPartner(null)}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete confirm modal */}
      <Modal open={!!deletePartner} onClose={() => setDeletePartner(null)} title="Remove Partner" size="sm">
        <p className="text-sm text-slate-600 mb-5">
          Remove <strong>{deletePartner?.agency_name}</strong>? This will permanently delete their account and all their leads. This cannot be undone.
        </p>
        <div className="flex gap-3 justify-end">
          <button className="btn-secondary" onClick={() => setDeletePartner(null)}>Cancel</button>
          <button className="btn-danger" onClick={handleDelete}>
            <Trash2 className="w-4 h-4" /> Remove Partner
          </button>
        </div>
      </Modal>
    </Layout>
  );
}
