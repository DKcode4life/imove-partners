import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle, AlertCircle } from 'lucide-react';
import Layout from '../../components/Layout';
import api from '../../lib/api';
import { PROPERTY_SIZES, MOVE_STAGES, MOVING_DATE_TYPES, MOVE_TYPES, FLOOR_OPTIONS } from '../../types';
import type { MovingDateType } from '../../types';

interface FormData {
  client_name: string;
  current_address: string;
  destination_address: string;
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

const EMPTY: FormData = {
  client_name: '', current_address: '', destination_address: '',
  contact_number: '', email: '',
  moving_date_type: '', estimated_moving_date: '',
  property_type: 'House', floor_number: '',
  property_size: '', move_type: '', notes: '', move_stage: '',
};

function Opt() {
  return <span className="text-slate-400 font-normal text-xs ml-1">(optional)</span>;
}

export default function SubmitLeadPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState<FormData>(EMPTY);
  const [hasLift, setHasLift] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const set = (field: keyof FormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(prev => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const res = await api.post('/leads', {
        ...form,
        moving_date_type: form.moving_date_type || null,
        estimated_moving_date: form.estimated_moving_date || null,
        floor_number: form.property_type === 'Apartment' ? (form.floor_number || null) : null,
        has_lift: form.property_type === 'Apartment' ? hasLift : null,
      });
      setSuccess(true);
      setTimeout(() => navigate(`/partner/leads/${res.data.id}`), 1500);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg || 'Failed to submit lead. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <Layout>
        <div className="max-w-md mx-auto mt-16 text-center">
          <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-emerald-600" />
          </div>
          <h2 className="text-xl font-bold text-slate-900">Lead submitted!</h2>
          <p className="text-sm text-slate-500 mt-2">The iMove team will be in touch shortly. Redirecting…</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-2xl">
        <div className="page-header">
          <h1 className="page-title">Submit a New Lead</h1>
          <p className="page-subtitle">Only contact details are required — everything else is optional</p>
        </div>

        {error && (
          <div className="mb-5 flex items-center gap-2 bg-red-50 border border-red-100 text-red-700 px-4 py-3 rounded-xl text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Client Details */}
          <div className="card p-6 space-y-4">
            <h2 className="text-sm font-semibold text-slate-900 pb-1 border-b border-slate-100">
              Client Details
            </h2>

            <div>
              <label className="label">Client full name <span className="text-red-500">*</span></label>
              <input type="text" className="input" placeholder="e.g. John & Sarah Smith" value={form.client_name} onChange={set('client_name')} required />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Contact number <span className="text-red-500">*</span></label>
                <input type="tel" className="input" placeholder="07700 900000" value={form.contact_number} onChange={set('contact_number')} required />
              </div>
              <div>
                <label className="label">Email address <span className="text-red-500">*</span></label>
                <input type="email" className="input" placeholder="client@email.com" value={form.email} onChange={set('email')} required />
              </div>
            </div>
          </div>

          {/* Move Details */}
          <div className="card p-6 space-y-4">
            <h2 className="text-sm font-semibold text-slate-900 pb-1 border-b border-slate-100">
              Move Details <Opt />
            </h2>

            <div>
              <label className="label">Current address <Opt /></label>
              <input type="text" className="input" placeholder="Full address including postcode" value={form.current_address} onChange={set('current_address')} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Destination address <Opt /></label>
                <input type="text" className="input" placeholder="Full address including postcode" value={form.destination_address} onChange={set('destination_address')} />
              </div>
              <div>
                <label className="label">Move type <Opt /></label>
                <select className="input" value={form.move_type} onChange={set('move_type')}>
                  <option value="">Select type…</option>
                  {MOVE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="label">Moving date <Opt /></label>
              <div className="flex gap-3">
                <select
                  className="input w-40 flex-shrink-0"
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
                    placeholder="e.g. beginning of May, end of June…"
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
              <label className="label">Property type <Opt /></label>
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

            {/* Bedrooms + floor (apartment only) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Number of bedrooms <Opt /></label>
                <select className="input" value={form.property_size} onChange={set('property_size')}>
                  <option value="">Select…</option>
                  {PROPERTY_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              {form.property_type === 'Apartment' && (
                <div>
                  <label className="label">Floor <Opt /></label>
                  <select className="input" value={form.floor_number} onChange={set('floor_number')}>
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

            <div>
              <label className="label">Stage of move <Opt /></label>
              <select className="input" value={form.move_stage} onChange={set('move_stage')}>
                <option value="">Select stage…</option>
                {MOVE_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          {/* Notes */}
          <div className="card p-6">
            <h2 className="text-sm font-semibold text-slate-900 pb-1 border-b border-slate-100 mb-4">Additional Notes</h2>
            <label className="label">Notes <Opt /></label>
            <textarea
              className="input resize-none"
              rows={4}
              placeholder="Any special requirements, fragile items, access notes…"
              value={form.notes}
              onChange={set('notes')}
            />
          </div>

          {/* Submit */}
          <div className="flex items-center gap-3 justify-end">
            <button type="button" className="btn-secondary" onClick={() => navigate('/partner/leads')}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Submitting…
                </span>
              ) : 'Submit Lead'}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
}
