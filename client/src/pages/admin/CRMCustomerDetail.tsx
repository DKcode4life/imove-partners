import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft, Save, Trash2, CheckCircle, AlertCircle,
  Briefcase, Archive, Users, ExternalLink, Plus,
} from 'lucide-react';
import CRMLayout from '../../components/CRMLayout';
import Modal from '../../components/Modal';
import api from '../../lib/api';
import type { CrmCustomer, CrmCustomerJob } from '../../types';

// ── Toast ─────────────────────────────────────────────────────────────────────

function Toast({ message, type, onDone }: { message: string; type: 'success' | 'error'; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 3500); return () => clearTimeout(t); }, [onDone]);
  return (
    <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-xl text-sm font-medium text-white ${type === 'success' ? 'bg-emerald-600' : 'bg-red-600'}`}>
      {type === 'success' ? <CheckCircle className="w-4 h-4 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 flex-shrink-0" />}
      {message}
    </div>
  );
}

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { dot: string; bg: string; text: string }> = {
  'New Lead':          { dot: 'bg-blue-500',    bg: 'bg-blue-50',    text: 'text-blue-700' },
  'Contacted':         { dot: 'bg-violet-500',  bg: 'bg-violet-50',  text: 'text-violet-700' },
  'Survey Booked':     { dot: 'bg-cyan-500',    bg: 'bg-cyan-50',    text: 'text-cyan-700' },
  'Survey Completed':  { dot: 'bg-teal-500',    bg: 'bg-teal-50',    text: 'text-teal-700' },
  'Awaiting Quote':    { dot: 'bg-yellow-500',  bg: 'bg-yellow-50',  text: 'text-yellow-800' },
  'Quote Sent':        { dot: 'bg-amber-500',   bg: 'bg-amber-50',   text: 'text-amber-700' },
  'Quote Accepted':    { dot: 'bg-orange-500',  bg: 'bg-orange-50',  text: 'text-orange-700' },
  'Booked Move':       { dot: 'bg-green-500',   bg: 'bg-green-50',   text: 'text-green-700' },
  'In Progress':       { dot: 'bg-emerald-500', bg: 'bg-emerald-50', text: 'text-emerald-700' },
  'Completed':         { dot: 'bg-slate-400',   bg: 'bg-slate-100',  text: 'text-slate-600' },
  'Lost / Cancelled':  { dot: 'bg-red-500',     bg: 'bg-red-50',     text: 'text-red-700' },
};

function fmtDate(d: string | null) {
  if (!d) return null;
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Job row ───────────────────────────────────────────────────────────────────

function JobRow({ job }: { job: CrmCustomerJob }) {
  const cfg  = STATUS_CFG[job.status] ?? { dot: 'bg-slate-400', bg: 'bg-slate-100', text: 'text-slate-600' };
  const from = [job.from_line1, job.from_postcode].filter(Boolean).join(', ') || '—';
  const to   = [job.to_line1,   job.to_postcode  ].filter(Boolean).join(', ') || '—';
  const date = fmtDate(job.confirmed_move_date || job.preferred_move_date);

  return (
    <Link
      to={`/admin/crm/${job.id}`}
      className="flex items-center gap-4 px-5 py-4 hover:bg-slate-50 transition-colors group"
    >
      <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <p className="text-sm font-semibold text-slate-900 truncate">
            {from} <span className="text-slate-400 font-normal">→</span> {to}
          </p>
          {job.storage_required === 1 && (
            <span className="text-xs bg-orange-100 text-orange-700 font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0">Storage</span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-400">
          {job.bedrooms && <span>{job.bedrooms}</span>}
          {date && <span>· {date}</span>}
        </div>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        {job.quote_amount != null && (
          <p className="text-sm font-semibold text-slate-700">£{job.quote_amount.toLocaleString()}</p>
        )}
        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${cfg.bg} ${cfg.text}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
          {job.status}
        </span>
        <ExternalLink className="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-500 transition-colors" />
      </div>
    </Link>
  );
}

// ── Label + input helper ──────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function CRMCustomerDetail() {
  const { id }   = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [customer, setCustomer] = useState<CrmCustomer | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [tab,      setTab]      = useState<'jobs' | 'storage' | 'referrals'>('jobs');

  // New storage job modal
  const [storageOpen,      setStorageOpen]      = useState(false);
  const [storageDate,      setStorageDate]      = useState('');
  const [storageNotes,     setStorageNotes]     = useState('');
  const [storageSubmitting, setStorageSubmitting] = useState(false);

  // Form fields
  const [fullName,  setFullName]  = useState('');
  const [phone,     setPhone]     = useState('');
  const [altPhone,  setAltPhone]  = useState('');
  const [email,     setEmail]     = useState('');
  const [altEmail,  setAltEmail]  = useState('');
  const [address,   setAddress]   = useState('');
  const [notes,     setNotes]     = useState('');

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting,   setDeleting]   = useState(false);

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const showToast = (msg: string, type: 'success' | 'error' = 'success') => setToast({ message: msg, type });

  const populate = useCallback((c: CrmCustomer) => {
    setFullName(c.full_name);
    setPhone(c.phone ?? '');
    setAltPhone(c.alt_phone ?? '');
    setEmail(c.email ?? '');
    setAltEmail(c.alt_email ?? '');
    setAddress([c.address_line1, c.address_line2, c.city, c.postcode].filter(Boolean).join(', '));
    setNotes(c.notes ?? '');
  }, []);

  const fetchCustomer = useCallback(async () => {
    const res = await api.get(`/customers/${id}`);
    setCustomer(res.data);
    populate(res.data);
  }, [id, populate]);

  useEffect(() => { fetchCustomer().finally(() => setLoading(false)); }, [fetchCustomer]);

  const handleSave = async () => {
    if (!fullName.trim()) { showToast('Name is required', 'error'); return; }
    setSaving(true);
    try {
      const res = await api.put(`/customers/${id}`, {
        full_name:    fullName.trim(),
        phone:        phone     || null,
        alt_phone:    altPhone  || null,
        email:        email     || null,
        alt_email:    altEmail  || null,
        address_line1: address  || null,
        address_line2: null,
        city:         null,
        postcode:     null,
        notes:        notes     || null,
      });
      setCustomer(prev => prev ? { ...res.data, jobs: prev.jobs, referrals: prev.referrals } : res.data);
      showToast('Changes saved');
    } catch {
      showToast('Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateStorage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customer) return;
    setStorageSubmitting(true);
    try {
      const res = await api.post('/crm/jobs', {
        customer_id:      customer.id,
        full_name:        customer.full_name,
        email:            customer.email    || null,
        phone:            customer.phone    || null,
        lead_source:      'Direct Enquiry',
        from_line1:       address           || null,
        preferred_move_date: storageDate    || null,
        internal_notes:   storageNotes      || null,
        status:           'New Lead',
        storage_required: true,
      });
      // Append the new job to the local jobs list
      setCustomer(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          storage_count: prev.storage_count + 1,
          jobs_count:    prev.jobs_count + 1,
          jobs: [
            {
              id: res.data.id,
              full_name: res.data.full_name,
              status: res.data.status,
              confirmed_move_date: res.data.confirmed_move_date,
              preferred_move_date: res.data.preferred_move_date,
              from_line1: res.data.from_line1,
              from_postcode: res.data.from_postcode,
              to_line1: res.data.to_line1,
              to_postcode: res.data.to_postcode,
              bedrooms: res.data.bedrooms,
              quote_amount: res.data.quote_amount,
              storage_required: 1,
              created_at: res.data.created_at,
            },
            ...(prev.jobs ?? []),
          ],
        };
      });
      setStorageOpen(false);
      setStorageDate('');
      setStorageNotes('');
      setTab('storage');
      showToast('Storage job created');
    } catch {
      showToast('Failed to create storage job', 'error');
    } finally {
      setStorageSubmitting(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.delete(`/customers/${id}`);
      navigate('/admin/crm/customers');
    } catch {
      showToast('Failed to delete', 'error');
      setDeleting(false);
    }
  };

  if (loading) return (
    <CRMLayout>
      <div className="flex items-center justify-center h-64">
        <div className="w-7 h-7 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
      </div>
    </CRMLayout>
  );
  if (!customer) return null;

  const memberSince = new Date(customer.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  const storageJobs = (customer.jobs ?? []).filter(j => j.storage_required === 1);
  const jobList =
    tab === 'referrals' ? (customer.referrals ?? []) :
    tab === 'storage'   ? storageJobs :
    (customer.jobs ?? []);

  return (
    <CRMLayout>
      {/* ── Page header ────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/admin/crm/customers')}
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-white rounded-lg transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-full bg-brand-100 flex items-center justify-center flex-shrink-0">
              <span className="text-base font-bold text-brand-700">{customer.full_name.charAt(0).toUpperCase()}</span>
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 leading-tight">{customer.full_name}</h1>
              <p className="text-xs text-slate-400">Customer since {memberSince}</p>
            </div>
          </div>
        </div>
        <button
          onClick={() => setDeleteOpen(true)}
          className="flex items-center gap-1.5 px-3 py-2 text-sm text-red-600 hover:bg-red-50 border border-red-200 rounded-lg transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Delete
        </button>
      </div>

      {/* ── Customer details form ───────────────────────────────────────── */}
      <div className="card p-6 mb-6">
        <div className="space-y-4">

          {/* Name */}
          <Field label="Full Name">
            <input
              type="text"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              className="input"
              placeholder="e.g. John & Jane Smith"
            />
          </Field>

          {/* Row: Phone / Alt Phone / Email / Alt Email */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Field label="Phone">
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                className="input"
                placeholder="07700 000000"
              />
            </Field>
            <Field label="Alt Phone">
              <input
                type="tel"
                value={altPhone}
                onChange={e => setAltPhone(e.target.value)}
                className="input"
                placeholder="Optional"
              />
            </Field>
            <Field label="Email">
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="input"
                placeholder="email@example.com"
              />
            </Field>
            <Field label="Alt Email">
              <input
                type="email"
                value={altEmail}
                onChange={e => setAltEmail(e.target.value)}
                className="input"
                placeholder="Optional"
              />
            </Field>
          </div>

          {/* Address — single field */}
          <Field label="Address">
            <input
              type="text"
              value={address}
              onChange={e => setAddress(e.target.value)}
              className="input"
              placeholder="e.g. 45 Oak Avenue, London, SW12 8TH"
            />
          </Field>

          {/* Notes */}
          <Field label="Notes">
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              className="input resize-none"
              placeholder="Any notes about this customer…"
            />
          </Field>

          {/* Save */}
          <div className="flex justify-end pt-1">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2 bg-brand-600 text-white text-sm font-semibold rounded-lg hover:bg-brand-700 disabled:opacity-50 transition-colors"
            >
              {saving
                ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Saving…</>
                : <><Save className="w-4 h-4" /> Save Changes</>
              }
            </button>
          </div>
        </div>
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <button
          onClick={() => setTab('jobs')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
            tab === 'jobs'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'bg-white text-slate-600 border border-slate-200 hover:border-blue-300'
          }`}
        >
          <Briefcase className="w-4 h-4" />
          {customer.jobs_count} Job{customer.jobs_count !== 1 ? 's' : ''}
        </button>

        <button
          onClick={() => setTab('storage')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
            tab === 'storage'
              ? 'bg-orange-500 text-white shadow-sm'
              : 'bg-white text-slate-600 border border-slate-200 hover:border-orange-300'
          }`}
        >
          <Archive className="w-4 h-4" />
          {customer.storage_count} Storage
        </button>

        <button
          onClick={() => setTab('referrals')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
            tab === 'referrals'
              ? 'bg-green-600 text-white shadow-sm'
              : 'bg-white text-slate-600 border border-slate-200 hover:border-green-300'
          }`}
        >
          <Users className="w-4 h-4" />
          {customer.referrals_count} Referral{customer.referrals_count !== 1 ? 's' : ''}
        </button>
      </div>

      {/* ── Job list panel ──────────────────────────────────────────────── */}
      <div className="card overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">
            {tab === 'referrals' ? 'Jobs referred by this customer'
              : tab === 'storage' ? 'Storage jobs'
              : 'Jobs'}
          </h2>
          <div className="flex items-center gap-3">
            {tab === 'storage' && (
              <button
                onClick={() => setStorageOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-500 text-white text-xs font-semibold rounded-lg hover:bg-orange-600 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                New Storage Job
              </button>
            )}
            <span className="text-xs text-slate-400">{jobList.length} record{jobList.length !== 1 ? 's' : ''}</span>
          </div>
        </div>

        {jobList.length === 0 ? (
          <div className="p-12 text-center">
            {tab === 'storage'
              ? <Archive className="w-8 h-8 text-slate-200 mx-auto mb-3" />
              : tab === 'referrals'
              ? <Users className="w-8 h-8 text-slate-200 mx-auto mb-3" />
              : <Briefcase className="w-8 h-8 text-slate-200 mx-auto mb-3" />
            }
            <p className="text-sm text-slate-400">
              {tab === 'storage'
                ? 'No storage jobs yet.'
                : tab === 'referrals'
                ? 'No referrals recorded for this customer.'
                : 'No jobs linked to this customer yet.'}
            </p>
            {tab === 'storage' && (
              <button
                onClick={() => setStorageOpen(true)}
                className="mt-3 text-sm text-orange-600 hover:text-orange-700 font-medium"
              >
                Create first storage job →
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {jobList.map(job => <JobRow key={job.id} job={job} />)}
          </div>
        )}
      </div>

      {/* ── New Storage Job Modal ───────────────────────────────────────── */}
      <Modal open={storageOpen} onClose={() => setStorageOpen(false)} title="New Storage Job">
        <form onSubmit={handleCreateStorage} className="space-y-4">
          <div className="p-3 rounded-lg bg-orange-50 border border-orange-100 text-sm text-orange-800">
            Creates a storage job in the CRM pipeline linked to <strong>{customer.full_name}</strong>.
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Customer Address</label>
            <input
              type="text"
              value={address}
              readOnly
              className="input bg-slate-50 text-slate-500"
              placeholder="No address on file"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Storage Start Date</label>
            <input
              type="date"
              value={storageDate}
              onChange={e => setStorageDate(e.target.value)}
              className="input"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Notes</label>
            <textarea
              value={storageNotes}
              onChange={e => setStorageNotes(e.target.value)}
              rows={3}
              className="input resize-none"
              placeholder="What's going into storage, access requirements, billing notes…"
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setStorageOpen(false)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={storageSubmitting} className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white text-sm font-semibold rounded-lg hover:bg-orange-600 disabled:opacity-50 transition-colors">
              {storageSubmitting
                ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Creating…</>
                : <><Archive className="w-4 h-4" /> Create Storage Job</>
              }
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Modal */}
      <Modal open={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete Customer">
        <p className="text-sm text-slate-600 mb-5">
          Are you sure you want to permanently delete <strong>{customer.full_name}</strong>? Their linked jobs will not be deleted.
        </p>
        <div className="flex justify-end gap-2">
          <button onClick={() => setDeleteOpen(false)} className="btn-secondary">Cancel</button>
          <button onClick={handleDelete} disabled={deleting} className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors">
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </Modal>

      {toast && <Toast message={toast.message} type={toast.type} onDone={() => setToast(null)} />}
    </CRMLayout>
  );
}
