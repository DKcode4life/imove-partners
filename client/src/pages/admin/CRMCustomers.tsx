import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, Plus, UserCircle2, Phone, Mail, MapPin,
  Briefcase, Archive, Users, CheckCircle, AlertCircle, Trash2,
} from 'lucide-react';
import CRMLayout from '../../components/CRMLayout';
import Modal from '../../components/Modal';
import api from '../../lib/api';
import type { CrmCustomer } from '../../types';

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

// ── Stat badge ────────────────────────────────────────────────────────────────

function StatBadge({ count, icon, color, title }: { count: number; icon: React.ReactNode; color: string; title: string }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold tabular-nums ring-1 ring-inset ring-white/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] ${color}`}
    >
      {icon}
      {count}
    </span>
  );
}

// ── New customer form ─────────────────────────────────────────────────────────

interface NewForm {
  full_name: string; email: string; phone: string; alt_phone: string;
  address_line1: string; address_line2: string; city: string; postcode: string;
  notes: string;
}
const EMPTY: NewForm = {
  full_name: '', email: '', phone: '', alt_phone: '',
  address_line1: '', address_line2: '', city: '', postcode: '', notes: '',
};

// ── Main ──────────────────────────────────────────────────────────────────────

export default function CRMCustomers() {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<CrmCustomer[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [search,    setSearch]    = useState('');

  const [newOpen,    setNewOpen]    = useState(false);
  const [form,       setForm]       = useState<NewForm>(EMPTY);
  const [formError,  setFormError]  = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<CrmCustomer | null>(null);
  const [deleting,     setDeleting]     = useState(false);

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const showToast = (msg: string, type: 'success' | 'error' = 'success') => setToast({ message: msg, type });

  const fetchCustomers = useCallback(async () => {
    const res = await api.get('/customers', { params: search ? { search } : {} });
    setCustomers(res.data);
  }, [search]);

  useEffect(() => {
    fetchCustomers().finally(() => setLoading(false));
  }, [fetchCustomers]);

  // Debounce search
  useEffect(() => {
    if (loading) return;
    const t = setTimeout(() => fetchCustomers(), 300);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const set = (k: keyof NewForm) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm(p => ({ ...p, [k]: e.target.value }));

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setSubmitting(true);
    try {
      const res = await api.post('/customers', form);
      setCustomers(p => [res.data, ...p].sort((a, b) => a.full_name.localeCompare(b.full_name)));
      setNewOpen(false);
      setForm(EMPTY);
      showToast('Customer record created');
      navigate(`/admin/crm/customers/${res.data.id}`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setFormError(msg || 'Failed to create customer');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/customers/${deleteTarget.id}`);
      setCustomers(p => p.filter(c => c.id !== deleteTarget.id));
      setDeleteTarget(null);
      showToast('Customer deleted');
    } catch {
      showToast('Failed to delete customer', 'error');
    } finally {
      setDeleting(false);
    }
  };

  function fmtAddress(c: CrmCustomer) {
    return [c.address_line1, c.city, c.postcode].filter(Boolean).join(', ') || '—';
  }

  return (
    <CRMLayout>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Customer Database</h1>
          <p className="text-sm text-slate-500 mt-0.5 tabular-nums">{customers.length} customer{customers.length !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={() => setNewOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Customer
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-5">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          placeholder="Search by name, email, phone or address…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
        />
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mb-4 text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-700"><Briefcase className="w-3 h-3" />0</span>
          Jobs
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-orange-100 text-orange-700"><Archive className="w-3 h-3" />0</span>
          Storage jobs
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-green-100 text-green-700"><Users className="w-3 h-3" />0</span>
          Referrals
        </span>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-7 h-7 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : customers.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-slate-100 to-slate-200/60 flex items-center justify-center mx-auto mb-4 ring-1 ring-inset ring-white/50 shadow-sm">
            <UserCircle2 className="w-8 h-8 text-slate-400" />
          </div>
          <p className="text-sm font-semibold text-slate-700 mb-1">
            {search ? 'No customers match your search' : 'No customers yet'}
          </p>
          <p className="text-xs text-slate-400 mb-4">
            {search ? 'Try adjusting your search' : 'Add your first customer to start tracking moves and referrals'}
          </p>
          {!search && (
            <button
              onClick={() => setNewOpen(true)}
              className="btn-primary"
            >
              <Plus className="w-4 h-4" /> Add your first customer
            </button>
          )}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200/70 bg-gradient-to-b from-slate-50 to-slate-50/40">
                <th className="text-left px-4 py-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider">Customer</th>
                <th className="text-left px-4 py-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider hidden md:table-cell">Contact</th>
                <th className="text-left px-4 py-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider hidden lg:table-cell">Address</th>
                <th className="text-center px-4 py-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider">Stats</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100/70">
              {customers.map(c => (
                <tr
                  key={c.id}
                  onClick={() => navigate(`/admin/crm/customers/${c.id}`)}
                  className="hover:bg-gradient-to-r hover:from-brand-50/40 hover:to-transparent cursor-pointer transition-colors group"
                >
                  {/* Name */}
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-brand-100 to-brand-200 flex items-center justify-center flex-shrink-0 ring-1 ring-inset ring-white/50 shadow-sm">
                        <span className="text-sm font-bold text-brand-700">
                          {c.full_name.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <span className="font-semibold text-slate-900 group-hover:text-brand-700 transition-colors tracking-tight">{c.full_name}</span>
                    </div>
                  </td>

                  {/* Contact */}
                  <td className="px-4 py-3.5 hidden md:table-cell">
                    <div className="space-y-0.5">
                      {c.phone && (
                        <div className="flex items-center gap-1.5 text-slate-600 tabular-nums">
                          <Phone className="w-3.5 h-3.5 text-slate-400" />
                          {c.phone}
                        </div>
                      )}
                      {c.email && (
                        <div className="flex items-center gap-1.5 text-slate-500 text-xs">
                          <Mail className="w-3.5 h-3.5 text-slate-400" />
                          {c.email}
                        </div>
                      )}
                      {!c.phone && !c.email && <span className="text-slate-300">—</span>}
                    </div>
                  </td>

                  {/* Address */}
                  <td className="px-4 py-3.5 hidden lg:table-cell">
                    <div className="flex items-start gap-1.5 text-slate-500 text-xs">
                      <MapPin className="w-3.5 h-3.5 text-slate-400 mt-0.5 flex-shrink-0" />
                      <span>{fmtAddress(c)}</span>
                    </div>
                  </td>

                  {/* Stats */}
                  <td className="px-4 py-3.5">
                    <div className="flex items-center justify-center gap-1.5">
                      <StatBadge
                        count={c.jobs_count}
                        icon={<Briefcase className="w-3 h-3" />}
                        color="bg-gradient-to-br from-blue-50 to-blue-100 text-blue-700"
                        title={`${c.jobs_count} job${c.jobs_count !== 1 ? 's' : ''}`}
                      />
                      <StatBadge
                        count={c.storage_count}
                        icon={<Archive className="w-3 h-3" />}
                        color="bg-gradient-to-br from-orange-50 to-orange-100 text-orange-700"
                        title={`${c.storage_count} storage job${c.storage_count !== 1 ? 's' : ''}`}
                      />
                      <StatBadge
                        count={c.referrals_count}
                        icon={<Users className="w-3 h-3" />}
                        color="bg-gradient-to-br from-green-50 to-green-100 text-green-700"
                        title={`${c.referrals_count} referral${c.referrals_count !== 1 ? 's' : ''}`}
                      />
                    </div>
                  </td>

                  {/* Delete */}
                  <td className="px-4 py-3.5 text-right">
                    <button
                      onClick={e => { e.stopPropagation(); setDeleteTarget(c); }}
                      className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all hover:shadow-sm hover:scale-105 active:scale-95"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Add Customer Modal ─────────────────────────────────────────────── */}
      <Modal open={newOpen} onClose={() => { setNewOpen(false); setForm(EMPTY); setFormError(''); }} title="Add Customer">
        <form onSubmit={handleCreate} className="space-y-4">
          {formError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{formError}</div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Full Name <span className="text-red-500">*</span></label>
            <input required value={form.full_name} onChange={set('full_name')} className="input" placeholder="e.g. John & Jane Smith" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Phone</label>
              <input type="tel" value={form.phone} onChange={set('phone')} className="input" placeholder="07700 000000" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Alt Phone</label>
              <input type="tel" value={form.alt_phone} onChange={set('alt_phone')} className="input" placeholder="Optional" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Email</label>
            <input type="email" value={form.email} onChange={set('email')} className="input" placeholder="email@example.com" />
          </div>

          <div className="border-t border-slate-100 pt-3">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Address</p>
            <div className="space-y-2">
              <input value={form.address_line1} onChange={set('address_line1')} className="input" placeholder="Address line 1" />
              <input value={form.address_line2} onChange={set('address_line2')} className="input" placeholder="Address line 2 (optional)" />
              <div className="grid grid-cols-2 gap-2">
                <input value={form.city} onChange={set('city')} className="input" placeholder="City" />
                <input value={form.postcode} onChange={set('postcode')} className="input" placeholder="Postcode" />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Notes</label>
            <textarea value={form.notes} onChange={set('notes')} rows={2} className="input resize-none" placeholder="Any notes about this customer…" />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => { setNewOpen(false); setForm(EMPTY); }} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={submitting} className="btn-primary">
              {submitting ? 'Creating…' : 'Create Customer'}
            </button>
          </div>
        </form>
      </Modal>

      {/* ── Delete Confirm Modal ───────────────────────────────────────────── */}
      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete Customer">
        <p className="text-sm text-slate-600 mb-5">
          Are you sure you want to delete <strong>{deleteTarget?.full_name}</strong>? Their linked jobs will not be deleted, but the customer record will be permanently removed.
        </p>
        <div className="flex justify-end gap-2">
          <button onClick={() => setDeleteTarget(null)} className="btn-secondary">Cancel</button>
          <button onClick={handleDelete} disabled={deleting} className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors">
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </Modal>

      {toast && <Toast message={toast.message} type={toast.type} onDone={() => setToast(null)} />}
    </CRMLayout>
  );
}
