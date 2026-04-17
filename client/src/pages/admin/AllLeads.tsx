import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Search, ArrowRight, ClipboardList, Filter, Plus, CheckCircle, AlertCircle } from 'lucide-react';
import Layout from '../../components/Layout';
import StatusBadge from '../../components/StatusBadge';
import Modal from '../../components/Modal';
import api from '../../lib/api';
import type { Lead, LeadStatus, Partner, MovingDateType } from '../../types';
import { LEAD_STATUSES, PROPERTY_SIZES, MOVE_STAGES, MOVING_DATE_TYPES, MOVE_TYPES, FLOOR_OPTIONS } from '../../types';

function fmt(n: number | null) {
  if (n === null) return '—';
  return `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const ALL = 'All';

interface LeadForm {
  partner_id: string;
  client_name: string;
  current_address: string;
  destination_postcode: string;
  contact_number: string;
  email: string;
  moving_date_type: MovingDateType | '';
  estimated_moving_date: string;
  property_type: string;
  floor_number: string;
  property_size: string;
  move_type: string;
  notes: string;
  move_stage: string;
}

const EMPTY_FORM: LeadForm = {
  partner_id: '', client_name: '', current_address: '', destination_postcode: '',
  contact_number: '', email: '',
  moving_date_type: 'Provisional', estimated_moving_date: '',
  property_type: 'House', floor_number: '',
  property_size: '', move_type: '', notes: '', move_stage: '',
};

export default function AdminAllLeadsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);

  // Add lead modal
  const [addModal, setAddModal] = useState(false);
  const [form, setForm] = useState<LeadForm>(EMPTY_FORM);
  const [hasLift, setHasLift] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [addedId, setAddedId] = useState<number | null>(null);

  const filterStatus = (searchParams.get('status') || ALL) as LeadStatus | typeof ALL;
  const filterPartner = searchParams.get('partner') || ALL;
  const [search, setSearch] = useState('');

  const fetchLeads = () =>
    api.get('/leads').then(r => setLeads(r.data));

  useEffect(() => {
    Promise.all([api.get('/leads'), api.get('/partners')])
      .then(([l, p]) => { setLeads(l.data); setPartners(p.data); })
      .finally(() => setLoading(false));
  }, []);

  const setFilter = (key: string, val: string) => {
    const params = new URLSearchParams(searchParams);
    if (val === ALL) params.delete(key);
    else params.set(key, val);
    setSearchParams(params);
  };

  const filtered = leads.filter(l => {
    const matchStatus  = filterStatus === ALL || l.status === filterStatus;
    const matchPartner = filterPartner === ALL || String(l.partner_id) === filterPartner;
    const q = search.toLowerCase();
    const matchSearch  = !q || l.client_name.toLowerCase().includes(q) || (l.agency_name || '').toLowerCase().includes(q);
    return matchStatus && matchPartner && matchSearch;
  });

  const set = (field: keyof LeadForm) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm(prev => ({ ...prev, [field]: e.target.value }));

  const openModal = () => {
    setForm(EMPTY_FORM);
    setHasLift(false);
    setFormError('');
    setAddedId(null);
    setAddModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setSubmitting(true);
    try {
      const res = await api.post('/leads', {
        ...form,
        partner_id: parseInt(form.partner_id),
        moving_date_type: form.moving_date_type || null,
        estimated_moving_date: form.estimated_moving_date || null,
        floor_number: form.property_type === 'Apartment' ? (form.floor_number || null) : null,
        has_lift: form.property_type === 'Apartment' ? hasLift : null,
      });
      setAddedId(res.data.id);
      await fetchLeads();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setFormError(msg || 'Failed to create lead. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoToLead = () => {
    if (addedId) navigate(`/admin/leads/${addedId}`);
  };

  return (
    <Layout>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="page-title">All Leads</h1>
          <p className="page-subtitle">{filtered.length} of {leads.length} leads</p>
        </div>
        <button className="btn-primary" onClick={openModal}>
          <Plus className="w-4 h-4" /> Add Lead
        </button>
      </div>

      {/* Filters */}
      <div className="card p-4 mb-5">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-4 h-4 text-slate-400" />
          <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Filters</span>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              className="input pl-9 w-full sm:w-56"
              placeholder="Search clients or agencies…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <select
            className="input w-full sm:w-auto"
            value={filterPartner}
            onChange={e => setFilter('partner', e.target.value)}
          >
            <option value={ALL}>All Partners</option>
            {partners.map(p => (
              <option key={p.id} value={String(p.id)}>{p.agency_name}</option>
            ))}
          </select>

          <select
            className="input w-full sm:w-auto"
            value={filterStatus}
            onChange={e => setFilter('status', e.target.value)}
          >
            <option value={ALL}>All Statuses</option>
            {LEAD_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          {(filterStatus !== ALL || filterPartner !== ALL || search) && (
            <button
              className="btn-secondary text-xs"
              onClick={() => { setSearchParams({}); setSearch(''); }}
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-7 h-7 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <ClipboardList className="w-10 h-10 text-slate-200 mx-auto mb-3" />
            <p className="text-sm text-slate-500">No leads match your filters</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50">
                <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-6 py-3">Client</th>
                <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-4 py-3 hidden md:table-cell">Partner</th>
                <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-4 py-3">Status</th>
                <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-4 py-3 hidden sm:table-cell">Quote</th>
                <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-4 py-3 hidden sm:table-cell">Commission</th>
                <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-4 py-3 hidden lg:table-cell">Date</th>
                <th className="w-8 px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map(lead => (
                <tr
                  key={lead.id}
                  className="hover:bg-slate-50/60 transition-colors group cursor-pointer"
                  onClick={() => navigate(`/admin/leads/${lead.id}`)}
                >
                  <td className="px-6 py-4">
                    <p className="text-sm font-medium text-slate-900">{lead.client_name}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{lead.property_size} · {lead.move_stage}</p>
                  </td>
                  <td className="px-4 py-4 hidden md:table-cell">
                    <p className="text-sm text-slate-700">{lead.agency_name}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{lead.partner_name}</p>
                  </td>
                  <td className="px-4 py-4">
                    <StatusBadge status={lead.status} size="sm" />
                    {lead.commission_paid && (
                      <p className="text-xs text-emerald-600 font-medium mt-1">✓ Paid</p>
                    )}
                  </td>
                  <td className="px-4 py-4 hidden sm:table-cell">
                    <span className="text-sm font-medium text-slate-700">{fmt(lead.quote_value)}</span>
                  </td>
                  <td className="px-4 py-4 hidden sm:table-cell">
                    {lead.estimated_commission != null ? (
                      <div>
                        <span className="text-sm font-semibold text-emerald-600">{fmt(lead.estimated_commission)}</span>
                        <p className="text-xs text-slate-400">{lead.commission_rate}%</p>
                      </div>
                    ) : <span className="text-xs text-slate-400">—</span>}
                  </td>
                  <td className="px-4 py-4 hidden lg:table-cell">
                    <span className="text-xs text-slate-400">{fmtDate(lead.created_at)}</span>
                  </td>
                  <td className="px-4 py-4">
                    <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-brand-500 transition-colors" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Add Lead Modal ───────────────────────────────────────────── */}
      <Modal
        open={addModal}
        onClose={() => setAddModal(false)}
        title="Add a Lead"
        size="lg"
      >
        {addedId ? (
          /* Success state */
          <div className="py-6 text-center">
            <div className="w-14 h-14 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-7 h-7 text-emerald-600" />
            </div>
            <h3 className="text-base font-semibold text-slate-900 mb-1">Lead added successfully</h3>
            <p className="text-sm text-slate-500 mb-6">
              The lead has been created and assigned to the selected partner.
            </p>
            <div className="flex gap-3 justify-center">
              <button className="btn-secondary" onClick={() => { setAddModal(false); setAddedId(null); }}>
                Close
              </button>
              <button className="btn-primary" onClick={handleGoToLead}>
                <ArrowRight className="w-4 h-4" /> View &amp; Manage Lead
              </button>
            </div>
          </div>
        ) : (
          /* Form */
          <form onSubmit={handleSubmit} className="space-y-5">
            {formError && (
              <div className="flex items-center gap-2 bg-red-50 border border-red-100 text-red-700 px-4 py-3 rounded-xl text-sm">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {formError}
              </div>
            )}

            {/* Referral */}
            <div className="bg-brand-50 border border-brand-100 rounded-xl p-4">
              <label className="label text-brand-800">Referred by (estate agent / partner) <span className="text-red-500">*</span></label>
              <select
                className="input bg-white"
                value={form.partner_id}
                onChange={set('partner_id')}
                required
              >
                <option value="">Select referring partner…</option>
                {partners.filter(p => p.active).map(p => (
                  <option key={p.id} value={String(p.id)}>
                    {p.agency_name} — {p.user_name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-brand-600 mt-1.5">
                The estate agent whose client has contacted iMove directly.
              </p>
            </div>

            {/* Client details */}
            <div className="space-y-4">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Client Details</h3>

              <div>
                <label className="label">Client full name <span className="text-red-500">*</span></label>
                <input type="text" className="input" placeholder="e.g. John & Sarah Smith"
                  value={form.client_name} onChange={set('client_name')} required />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Contact number <span className="text-red-500">*</span></label>
                  <input type="tel" className="input" placeholder="07700 900000"
                    value={form.contact_number} onChange={set('contact_number')} required />
                </div>
                <div>
                  <label className="label">Email address <span className="text-red-500">*</span></label>
                  <input type="email" className="input" placeholder="client@email.com"
                    value={form.email} onChange={set('email')} required />
                </div>
              </div>
            </div>

            {/* Move details */}
            <div className="space-y-4">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Move Details</h3>

              <div>
                <label className="label">Current address <span className="text-red-500">*</span></label>
                <input type="text" className="input" placeholder="Full address including postcode"
                  value={form.current_address} onChange={set('current_address')} required />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Destination postcode <span className="text-slate-400 font-normal">(optional)</span></label>
                  <input type="text" className="input" placeholder="e.g. KT2 6QH"
                    value={form.destination_postcode} onChange={set('destination_postcode')} />
                </div>
                <div>
                  <label className="label">Move type <span className="text-red-500">*</span></label>
                  <select className="input" value={form.move_type} onChange={set('move_type')} required>
                    <option value="">Select type…</option>
                    {MOVE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="label">Moving date <span className="text-slate-400 font-normal">(optional)</span></label>
                <div className="flex gap-2">
                  <select
                    className="input w-36 flex-shrink-0"
                    value={form.moving_date_type}
                    onChange={e => setForm(prev => ({
                      ...prev,
                      moving_date_type: e.target.value as MovingDateType | '',
                      estimated_moving_date: '',
                    }))}
                  >
                    <option value="">Date type…</option>
                    {MOVING_DATE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  {form.moving_date_type === 'Estimated' ? (
                    <input
                      type="text"
                      className="input flex-1"
                      placeholder="e.g. beginning of May…"
                      value={form.estimated_moving_date}
                      onChange={set('estimated_moving_date')}
                    />
                  ) : (
                    <input
                      type="date"
                      className="input flex-1"
                      value={form.estimated_moving_date}
                      onChange={set('estimated_moving_date')}
                      disabled={!form.moving_date_type}
                    />
                  )}
                </div>
                {!form.moving_date_type && (
                  <p className="text-xs text-slate-400 mt-1">Select a date type to enter a value</p>
                )}
              </div>

              {/* Property type toggle */}
              <div>
                <label className="label">Property type <span className="text-red-500">*</span></label>
                <div className="flex rounded-xl border border-slate-200 overflow-hidden">
                  {(['House', 'Apartment'] as const).map((type, i) => (
                    <button
                      key={type}
                      type="button"
                      className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                        form.property_type === type
                          ? 'bg-brand-600 text-white'
                          : 'text-slate-600 hover:bg-slate-50'
                      }${i > 0 ? ' border-l border-slate-200' : ''}`}
                      onClick={() => setForm(prev => ({ ...prev, property_type: type, floor_number: '' }))}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>

              {/* Bedrooms + floor */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Number of bedrooms <span className="text-red-500">*</span></label>
                  <select className="input" value={form.property_size} onChange={set('property_size')} required>
                    <option value="">Select…</option>
                    {PROPERTY_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                {form.property_type === 'Apartment' && (
                  <div>
                    <label className="label">Floor <span className="text-red-500">*</span></label>
                    <select className="input" value={form.floor_number} onChange={set('floor_number')} required>
                      <option value="">Select floor…</option>
                      {FLOOR_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </div>
                )}
              </div>

              {/* Lift toggle (apartment only) */}
              {form.property_type === 'Apartment' && (
                <label className="flex items-center gap-3 cursor-pointer select-none">
                  <div
                    className={`w-10 h-6 rounded-full transition-colors duration-200 relative flex-shrink-0 ${hasLift ? 'bg-brand-500' : 'bg-slate-200'}`}
                    onClick={() => setHasLift(prev => !prev)}
                  >
                    <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${hasLift ? 'translate-x-5' : 'translate-x-1'}`} />
                  </div>
                  <span className="text-sm text-slate-700">Lift available at moving-out address</span>
                </label>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Stage of move <span className="text-red-500">*</span></label>
                  <select className="input" value={form.move_stage} onChange={set('move_stage')} required>
                    <option value="">Select stage…</option>
                    {MOVE_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="label">Notes <span className="text-slate-400 font-normal">(optional)</span></label>
              <textarea
                className="input resize-none"
                rows={3}
                placeholder="Special requirements, fragile items, access notes…"
                value={form.notes}
                onChange={set('notes')}
              />
            </div>

            <div className="flex gap-3 justify-end pt-1 border-t border-slate-100">
              <button type="button" className="btn-secondary" onClick={() => setAddModal(false)}>
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={submitting}>
                {submitting ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Adding lead…
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <Plus className="w-4 h-4" /> Add Lead
                  </span>
                )}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </Layout>
  );
}
