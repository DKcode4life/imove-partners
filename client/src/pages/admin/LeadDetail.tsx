import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft, Save, Trash2, Building2, CheckCircle,
} from 'lucide-react';
import Layout from '../../components/Layout';
import StatusBadge from '../../components/StatusBadge';
import PipelineTracker from '../../components/PipelineTracker';
import Modal from '../../components/Modal';
import api from '../../lib/api';
import type { Lead, LeadStatus, MovingDateType } from '../../types';
import { LEAD_STATUSES, PROPERTY_SIZES, MOVE_STAGES, MOVING_DATE_TYPES, MOVE_TYPES, FLOOR_OPTIONS } from '../../types';

function fmt(n: number | null) {
  if (n === null) return '—';
  return `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between py-2.5 border-b border-slate-50 last:border-0">
      <span className="text-xs text-slate-400 flex-shrink-0 w-36">{label}</span>
      <span className="text-sm text-slate-700 font-medium text-right">{value}</span>
    </div>
  );
}

export default function AdminLeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [deleteModal, setDeleteModal] = useState(false);

  // ── Admin controls ────────────────────────────────────────────────────────
  const [status, setStatus] = useState<LeadStatus>('New Lead');
  const [quoteValue, setQuoteValue] = useState('');
  const [commissionRate, setCommissionRate] = useState('');
  const [commissionPaid, setCommissionPaid] = useState(false);
  const [notes, setNotes] = useState('');

  // ── Client info (editable) ────────────────────────────────────────────────
  const [clientName, setClientName] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [email, setEmail] = useState('');
  const [currentAddress, setCurrentAddress] = useState('');
  const [destinationPostcode, setDestinationPostcode] = useState('');
  const [propertySize, setPropertySize] = useState('');
  const [movingDate, setMovingDate] = useState('');
  const [movingDateType, setMovingDateType] = useState<MovingDateType | ''>('');
  const [moveType, setMoveType] = useState('');
  const [propertyType, setPropertyType] = useState('');
  const [floorNumber, setFloorNumber] = useState('');
  const [hasLift, setHasLift] = useState(false);
  const [moveStage, setMoveStage] = useState('');

  useEffect(() => {
    api.get(`/leads/${id}`)
      .then(r => {
        const l: Lead = r.data;
        setLead(l);
        // Admin controls
        setStatus(l.status);
        setQuoteValue(l.quote_value !== null ? String(l.quote_value) : '');
        setCommissionRate(String(l.commission_rate));
        setCommissionPaid(l.commission_paid);
        setNotes(l.notes || '');
        // Client info
        setClientName(l.client_name);
        setContactNumber(l.contact_number);
        setEmail(l.email);
        setCurrentAddress(l.current_address);
        setDestinationPostcode(l.destination_postcode || '');
        setPropertySize(l.property_size);
        setMovingDate(l.estimated_moving_date || '');
        setMovingDateType((l.moving_date_type as MovingDateType | null) || '');
        setMoveType(l.move_type || '');
        setPropertyType(l.property_type || '');
        setFloorNumber(l.floor_number || '');
        setHasLift(!!l.has_lift);
        setMoveStage(l.move_stage);
      })
      .catch(() => setError('Lead not found'))
      .finally(() => setLoading(false));
  }, [id]);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await api.put(`/leads/${id}`, {
        // Admin controls
        status,
        quote_value: quoteValue ? parseFloat(quoteValue) : undefined,
        commission_rate: commissionRate ? parseFloat(commissionRate) : undefined,
        commission_paid: commissionPaid,
        notes,
        // Client info
        client_name: clientName,
        contact_number: contactNumber,
        email,
        current_address: currentAddress,
        destination_postcode: destinationPostcode || null,
        property_size: propertySize,
        estimated_moving_date: movingDate || null,
        moving_date_type: movingDateType || null,
        move_type: moveType || null,
        property_type: propertyType || null,
        floor_number: propertyType === 'Apartment' ? (floorNumber || null) : null,
        has_lift: propertyType === 'Apartment' ? hasLift : null,
        move_stage: moveStage,
      });
      setLead(res.data);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg || 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      await api.delete(`/leads/${id}`);
      navigate('/admin/leads');
    } catch {
      setError('Failed to delete lead');
    }
  };

  const estimatedCommission = quoteValue && commissionRate
    ? parseFloat(((parseFloat(quoteValue) * parseFloat(commissionRate)) / 100).toFixed(2))
    : null;

  if (loading) return (
    <Layout>
      <div className="flex items-center justify-center h-64">
        <div className="w-7 h-7 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
      </div>
    </Layout>
  );

  if (error && !lead) return (
    <Layout>
      <div className="text-center py-16">
        <p className="text-slate-500 mb-4">{error}</p>
        <Link to="/admin/leads" className="btn-primary">Back to leads</Link>
      </div>
    </Layout>
  );

  return (
    <Layout>
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700 mb-5 transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to leads
      </button>

      {/* Page header */}
      <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-slate-900">{lead!.client_name}</h1>
            <StatusBadge status={lead!.status} />
          </div>
          <div className="flex items-center gap-2 mt-1 text-sm text-slate-500 flex-wrap">
            <Building2 className="w-3.5 h-3.5" />
            {lead!.agency_name} · {lead!.partner_name} ·
            Submitted {fmtDate(lead!.created_at)} · Lead #{lead!.id}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setDeleteModal(true)}
            className="btn-secondary text-red-600 hover:bg-red-50 hover:border-red-200"
          >
            <Trash2 className="w-4 h-4" /> Delete
          </button>
          <button onClick={handleSave} disabled={saving} className="btn-primary">
            {saving ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Saving…
              </span>
            ) : saved ? (
              <span className="flex items-center gap-2"><CheckCircle className="w-4 h-4" /> Saved!</span>
            ) : (
              <span className="flex items-center gap-2"><Save className="w-4 h-4" /> Save Changes</span>
            )}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-100 text-red-700 px-4 py-3 rounded-xl text-sm">
          {error}
        </div>
      )}

      <div className="mb-5">
        <PipelineTracker currentStatus={status} onStatusChange={s => setStatus(s)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* ── Left: editable client info ───────────────────────────────── */}
        <div className="lg:col-span-2 space-y-5">

          {/* Client details */}
          <div className="card p-6 space-y-4">
            <h2 className="text-sm font-semibold text-slate-900 pb-2 border-b border-slate-100">
              Client Information
            </h2>

            <div>
              <label className="label">Full name</label>
              <input
                type="text"
                className="input"
                value={clientName}
                onChange={e => setClientName(e.target.value)}
                placeholder="Client full name"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Contact number</label>
                <input
                  type="tel"
                  className="input"
                  value={contactNumber}
                  onChange={e => setContactNumber(e.target.value)}
                  placeholder="07700 900000"
                />
              </div>
              <div>
                <label className="label">Email address</label>
                <input
                  type="email"
                  className="input"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="client@email.com"
                />
              </div>
            </div>

            <div>
              <label className="label">Current address</label>
              <input
                type="text"
                className="input"
                value={currentAddress}
                onChange={e => setCurrentAddress(e.target.value)}
                placeholder="Full address including postcode"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Destination postcode <span className="text-slate-400 font-normal">(optional)</span></label>
                <input
                  type="text"
                  className="input"
                  value={destinationPostcode}
                  onChange={e => setDestinationPostcode(e.target.value)}
                  placeholder="e.g. KT2 6QH"
                />
              </div>
              <div>
                <label className="label">Move type</label>
                <select className="input" value={moveType} onChange={e => setMoveType(e.target.value)}>
                  <option value="">Not set</option>
                  {MOVE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="label">Moving date <span className="text-slate-400 font-normal">(optional)</span></label>
              <div className="flex gap-3">
                <select
                  className="input w-40 flex-shrink-0"
                  value={movingDateType}
                  onChange={e => {
                    setMovingDateType(e.target.value as MovingDateType | '');
                    setMovingDate('');
                  }}
                >
                  <option value="">Date type…</option>
                  {MOVING_DATE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                {movingDateType === 'Estimated' ? (
                  <input
                    type="text"
                    className="input flex-1"
                    placeholder="e.g. beginning of May…"
                    value={movingDate}
                    onChange={e => setMovingDate(e.target.value)}
                  />
                ) : (
                  <input
                    type="date"
                    className="input flex-1"
                    value={movingDate}
                    onChange={e => setMovingDate(e.target.value)}
                    disabled={!movingDateType}
                  />
                )}
              </div>
              {!movingDateType && (
                <p className="text-xs text-slate-400 mt-1">Select a date type to enter a value</p>
              )}
            </div>

            {/* Property type toggle */}
            <div>
              <label className="label">Property type</label>
              <div className="flex rounded-xl border border-slate-200 overflow-hidden">
                {(['House', 'Apartment'] as const).map((type, i) => (
                  <button
                    key={type}
                    type="button"
                    className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                      propertyType === type
                        ? 'bg-brand-600 text-white'
                        : 'text-slate-600 hover:bg-slate-50'
                    }${i > 0 ? ' border-l border-slate-200' : ''}`}
                    onClick={() => { setPropertyType(type); setFloorNumber(''); }}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>

            {/* Bedrooms + floor */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Number of bedrooms</label>
                <select className="input" value={propertySize} onChange={e => setPropertySize(e.target.value)}>
                  <option value="">Select…</option>
                  {PROPERTY_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              {propertyType === 'Apartment' && (
                <div>
                  <label className="label">Floor</label>
                  <select className="input" value={floorNumber} onChange={e => setFloorNumber(e.target.value)}>
                    <option value="">Select floor…</option>
                    {FLOOR_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
              )}
            </div>

            {/* Lift toggle (apartment only) */}
            {propertyType === 'Apartment' && (
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Stage of move</label>
                <select className="input" value={moveStage} onChange={e => setMoveStage(e.target.value)}>
                  <option value="">Select stage…</option>
                  {MOVE_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Partner info (read-only) */}
          <div className="card p-6">
            <h2 className="text-sm font-semibold text-slate-900 mb-3">Submitted By</h2>
            <InfoRow label="Agency" value={lead!.agency_name || '—'} />
            <InfoRow label="Partner name" value={lead!.partner_name || '—'} />
            <InfoRow label="Partner email" value={lead!.partner_email || '—'} />
            <InfoRow label="Partner phone" value={lead!.partner_phone || '—'} />
          </div>
        </div>

        {/* ── Right: admin controls ─────────────────────────────────────── */}
        <div className="space-y-4">

          {/* Status */}
          <div className="card p-6 space-y-4">
            <h2 className="text-sm font-semibold text-slate-900">Update Status</h2>
            <select className="input" value={status} onChange={e => setStatus(e.target.value as LeadStatus)}>
              {LEAD_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {/* Quote & commission */}
          <div className="card p-6 space-y-4">
            <h2 className="text-sm font-semibold text-slate-900">Quote & Commission</h2>
            <div>
              <label className="label">Job value (£)</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">£</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="input pl-7"
                  placeholder="0.00"
                  value={quoteValue}
                  onChange={e => setQuoteValue(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="label">Commission rate (%)</label>
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  className="input pr-7"
                  value={commissionRate}
                  onChange={e => setCommissionRate(e.target.value)}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">%</span>
              </div>
            </div>

            {estimatedCommission !== null && (
              <div className="bg-emerald-50 rounded-xl px-4 py-3">
                <p className="text-xs text-emerald-600 font-medium">Partner commission</p>
                <p className="text-xl font-bold text-emerald-700 mt-0.5">{fmt(estimatedCommission)}</p>
              </div>
            )}
          </div>

          {/* Commission payment toggle */}
          <div className="card p-6">
            <h2 className="text-sm font-semibold text-slate-900 mb-3">Commission Payment</h2>
            <label className="flex items-center gap-3 cursor-pointer">
              <div
                className={`w-10 h-6 rounded-full transition-colors duration-200 relative flex-shrink-0 ${
                  commissionPaid ? 'bg-emerald-500' : 'bg-slate-200'
                }`}
                onClick={() => setCommissionPaid(!commissionPaid)}
              >
                <span
                  className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${
                    commissionPaid ? 'translate-x-5' : 'translate-x-1'
                  }`}
                />
              </div>
              <span className="text-sm font-medium text-slate-700">
                {commissionPaid ? 'Commission marked as paid' : 'Commission not yet paid'}
              </span>
            </label>
          </div>

          {/* Notes */}
          <div className="card p-6">
            <h2 className="text-sm font-semibold text-slate-900 mb-3">Internal Notes</h2>
            <textarea
              className="input resize-none text-xs"
              rows={4}
              placeholder="Add notes visible to the partner…"
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Delete confirm modal */}
      <Modal open={deleteModal} onClose={() => setDeleteModal(false)} title="Delete Lead" size="sm">
        <p className="text-sm text-slate-600 mb-5">
          Are you sure you want to permanently delete the lead for{' '}
          <strong>{lead!.client_name}</strong>? This cannot be undone.
        </p>
        <div className="flex gap-3 justify-end">
          <button className="btn-secondary" onClick={() => setDeleteModal(false)}>Cancel</button>
          <button className="btn-danger" onClick={handleDelete}>
            <Trash2 className="w-4 h-4" /> Delete Lead
          </button>
        </div>
      </Modal>
    </Layout>
  );
}
