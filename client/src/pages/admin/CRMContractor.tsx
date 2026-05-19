import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, Plus, Pencil, Trash2, FileText, ChevronRight,
  AlertCircle, CheckCircle, Briefcase, Calendar,
} from 'lucide-react';
import CRMLayout from '../../components/CRMLayout';
import Modal from '../../components/Modal';
import CreateContractJobModal from '../../components/CreateContractJobModal';
import api from '../../lib/api';
import type { Contract } from '../../types';

interface ContractJob {
  id: number;
  contract_id: number;
  job_date: string;
  description: string | null;
  notes: string | null;
  men_needed: number;
  vans_needed: number;
  hgv_needed: number;
  invoiced: boolean;
  items: Array<{
    id: number;
    contract_item_id: number | null;
    description: string;
    quantity: number;
    unit_price: number;
    total: number;
  }>;
}

interface ContractInvoice {
  id: number;
  invoice_number: string;
  week_start: string;
  week_end: string;
  status: 'draft' | 'sent' | 'paid';
  subtotal: number;
  tax_amount: number;
  total: number;
  sent_at: string | null;
  paid_at: string | null;
  created_at: string;
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

function fmtDateLong(s: string) {
  return new Date(s + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtMoney(n: number) { return `£${(n || 0).toFixed(2)}`; }

function lastMondayISO(): string {
  const d = new Date();
  const dow = d.getDay(); // 0=Sun
  const offset = dow === 0 ? 6 : dow - 1;
  d.setDate(d.getDate() - offset);
  return d.toISOString().slice(0, 10);
}

export default function CRMContractor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const cid = parseInt(id || '', 10);
  const [searchParams, setSearchParams] = useSearchParams();

  const [contractor, setContractor] = useState<Contract | null>(null);
  const [jobs, setJobs] = useState<ContractJob[]>([]);
  const [invoices, setInvoices] = useState<ContractInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const tab: 'jobs' | 'invoices' = searchParams.get('tab') === 'invoices' ? 'invoices' : 'jobs';
  const setTab = (next: 'jobs' | 'invoices') => {
    const params = new URLSearchParams(searchParams);
    if (next === 'jobs') params.delete('tab');
    else params.set('tab', next);
    setSearchParams(params, { replace: true });
  };
  const [editJob, setEditJob] = useState<ContractJob | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmDeleteJob, setConfirmDeleteJob] = useState<ContractJob | null>(null);
  const [newInvoiceOpen, setNewInvoiceOpen] = useState(false);
  const [newInvoiceWeek, setNewInvoiceWeek] = useState(lastMondayISO());
  const [draftingInvoice, setDraftingInvoice] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const showToast = (message: string, type: 'success' | 'error' = 'success') => setToast({ message, type });

  const fetchAll = useCallback(async () => {
    if (!Number.isFinite(cid)) return;
    try {
      const [cRes, jRes, iRes] = await Promise.all([
        api.get(`/contracts`),
        api.get(`/contract-jobs/contractors/${cid}/jobs`),
        api.get(`/contract-jobs/contractors/${cid}/invoices`),
      ]);
      const c = (cRes.data as Contract[]).find(x => x.id === cid) || null;
      setContractor(c);
      setJobs(jRes.data);
      setInvoices(iRes.data);
    } finally {
      setLoading(false);
    }
  }, [cid]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleDeleteJob = async () => {
    if (!confirmDeleteJob) return;
    try {
      await api.delete(`/contract-jobs/jobs/${confirmDeleteJob.id}`);
      setConfirmDeleteJob(null);
      await fetchAll();
      showToast('Job deleted');
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to delete', 'error');
    }
  };

  const handleAutoDraft = async () => {
    setDraftingInvoice(true);
    try {
      const r = await api.post(`/contract-jobs/contractors/${cid}/invoices/auto`, {
        week_start: newInvoiceWeek,
        tax_rate: 20,
      });
      setNewInvoiceOpen(false);
      await fetchAll();
      navigate(`/admin/crm/contract-jobs/${cid}/invoices/${r.data.id}`);
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to create invoice', 'error');
    } finally {
      setDraftingInvoice(false);
    }
  };

  if (loading) {
    return <CRMLayout><div className="py-10 text-sm text-slate-400 text-center">Loading…</div></CRMLayout>;
  }
  if (!contractor) {
    return <CRMLayout><div className="py-10 text-sm text-slate-400 text-center">Contractor not found.</div></CRMLayout>;
  }

  return (
    <CRMLayout>
      {/* Breadcrumb / header */}
      <div className="mb-6">
        <Link to="/admin/crm/contract-jobs" className="text-sm text-slate-500 hover:text-slate-700 inline-flex items-center gap-1.5 mb-3">
          <ArrowLeft className="w-3.5 h-3.5" />
          Contract Jobs
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-slate-900">{contractor.company_name}</h1>
            <div className="flex flex-wrap gap-x-5 gap-y-1 mt-1.5 text-sm text-slate-500">
              {contractor.contact_name && <span>{contractor.contact_name}</span>}
              {contractor.email && <span>{contractor.email}</span>}
              {(contractor.office_number || contractor.direct_line) && (
                <span>{contractor.office_number || contractor.direct_line}</span>
              )}
            </div>
          </div>
          <button onClick={() => setCreateOpen(true)} className="btn-primary flex items-center gap-2 whitespace-nowrap">
            <Plus className="w-4 h-4" />
            Create Job
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-6 border-b border-slate-200 mb-6">
        <button
          onClick={() => setTab('jobs')}
          className={`pb-3 -mb-px text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
            tab === 'jobs' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Briefcase className="w-4 h-4" />
          Jobs <span className="text-xs text-slate-400">({jobs.length})</span>
        </button>
        <button
          onClick={() => setTab('invoices')}
          className={`pb-3 -mb-px text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
            tab === 'invoices' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <FileText className="w-4 h-4" />
          Invoices <span className="text-xs text-slate-400">({invoices.length})</span>
        </button>
      </div>

      {/* Jobs tab */}
      {tab === 'jobs' && (
        <>
          {jobs.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 border-dashed py-16 text-center">
              <Briefcase className="w-8 h-8 text-slate-300 mx-auto mb-3" />
              <p className="text-sm font-medium text-slate-500">No jobs yet</p>
              <p className="text-xs text-slate-400 mt-1">Click "Create Job" to add the first one.</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold w-44">Date</th>
                    <th className="text-left px-4 py-3 font-semibold">Description</th>
                    <th className="text-center px-4 py-3 font-semibold w-16">Men</th>
                    <th className="text-center px-4 py-3 font-semibold w-16">Vans</th>
                    <th className="text-center px-4 py-3 font-semibold w-16">HGV</th>
                    <th className="text-right px-4 py-3 font-semibold w-32">Subtotal</th>
                    <th className="text-center px-4 py-3 font-semibold w-28">Status</th>
                    <th className="w-24"></th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((j, idx) => {
                    const subtotal = j.items.reduce((s, i) => s + i.total, 0);
                    return (
                      <tr key={j.id} className={idx > 0 ? 'border-t border-slate-100' : ''}>
                        <td className="px-4 py-3 text-slate-700 font-medium">{fmtDateLong(j.job_date)}</td>
                        <td className="px-4 py-3 text-slate-700">
                          <div>{j.description || <span className="text-slate-400">—</span>}</div>
                          {j.items.length > 0 && (
                            <div className="text-xs text-slate-400 mt-0.5 truncate max-w-md">
                              {j.items.map(i => `${i.quantity}× ${i.description}`).join(' · ')}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center tabular-nums text-slate-600">{j.men_needed || '—'}</td>
                        <td className="px-4 py-3 text-center tabular-nums text-slate-600">{j.vans_needed || '—'}</td>
                        <td className="px-4 py-3 text-center tabular-nums text-slate-600">{j.hgv_needed || '—'}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-800 font-medium">{fmtMoney(subtotal)}</td>
                        <td className="px-4 py-3 text-center">
                          {j.invoiced ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700">Invoiced</span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">Open</span>
                          )}
                        </td>
                        <td className="px-2 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => setEditJob(j)}
                              disabled={j.invoiced}
                              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                              title={j.invoiced ? 'Job is on a finalised invoice' : 'Edit'}
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => setConfirmDeleteJob(j)}
                              disabled={j.invoiced}
                              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                              title={j.invoiced ? 'Job is on a finalised invoice' : 'Delete'}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Invoices tab */}
      {tab === 'invoices' && (
        <>
          <div className="flex justify-end mb-3">
            <button onClick={() => setNewInvoiceOpen(true)} className="btn-primary flex items-center gap-2">
              <Plus className="w-4 h-4" />
              New Weekly Invoice
            </button>
          </div>

          {invoices.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 border-dashed py-16 text-center">
              <FileText className="w-8 h-8 text-slate-300 mx-auto mb-3" />
              <p className="text-sm font-medium text-slate-500">No invoices yet</p>
              <p className="text-xs text-slate-400 mt-1">Pick a Monday and the system will draft a weekly invoice from that week's jobs.</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold w-32">Invoice #</th>
                    <th className="text-left px-4 py-3 font-semibold">Week</th>
                    <th className="text-right px-4 py-3 font-semibold w-32">Total</th>
                    <th className="text-center px-4 py-3 font-semibold w-28">Status</th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv, idx) => (
                    <tr
                      key={inv.id}
                      className={`cursor-pointer hover:bg-slate-50/60 ${idx > 0 ? 'border-t border-slate-100' : ''}`}
                      onClick={() => navigate(`/admin/crm/contract-jobs/${cid}/invoices/${inv.id}`)}
                    >
                      <td className="px-4 py-3 font-mono text-slate-700">{inv.invoice_number}</td>
                      <td className="px-4 py-3 text-slate-700">
                        Week of {fmtDateLong(inv.week_start)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold text-slate-900">{fmtMoney(inv.total)}</td>
                      <td className="px-4 py-3 text-center">
                        {inv.status === 'paid' ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700">Paid</span>
                        ) : inv.status === 'sent' ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">Sent</span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">Draft</span>
                        )}
                      </td>
                      <td className="px-2 py-3 text-right">
                        <ChevronRight className="w-4 h-4 text-slate-300 inline" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Create / edit job modal */}
      {createOpen && (
        <CreateContractJobModal
          contract={contractor}
          onClose={() => setCreateOpen(false)}
          onSaved={async () => { setCreateOpen(false); await fetchAll(); showToast('Job created'); }}
        />
      )}
      {editJob && (
        <CreateContractJobModal
          contract={contractor}
          editJob={editJob}
          onClose={() => setEditJob(null)}
          onSaved={async () => { setEditJob(null); await fetchAll(); showToast('Job updated'); }}
        />
      )}

      {/* Delete confirm */}
      <Modal open={!!confirmDeleteJob} onClose={() => setConfirmDeleteJob(null)} title="Delete Job" size="sm">
        <p className="text-sm text-slate-600 mb-5">
          Delete this job on <span className="font-semibold">{confirmDeleteJob && fmtDateLong(confirmDeleteJob.job_date)}</span>? This will also remove it from the planner.
        </p>
        <div className="flex gap-3 justify-end">
          <button onClick={() => setConfirmDeleteJob(null)} className="btn-secondary">Cancel</button>
          <button onClick={handleDeleteJob} className="btn-danger">Delete</button>
        </div>
      </Modal>

      {/* New invoice modal */}
      <Modal open={newInvoiceOpen} onClose={() => setNewInvoiceOpen(false)} title="New Weekly Invoice" size="sm">
        <p className="text-sm text-slate-600 mb-4">
          Pick the <strong>Monday</strong> of the week to invoice. All open (un-invoiced) jobs from that Monday through Sunday will be added as line items.
        </p>
        <div className="flex items-center gap-2 mb-5">
          <Calendar className="w-4 h-4 text-slate-400" />
          <input
            type="date"
            value={newInvoiceWeek}
            onChange={e => setNewInvoiceWeek(e.target.value)}
            className="input-field flex-1"
          />
        </div>
        <div className="flex gap-3 justify-end">
          <button onClick={() => setNewInvoiceOpen(false)} className="btn-secondary">Cancel</button>
          <button onClick={handleAutoDraft} disabled={draftingInvoice} className="btn-primary">
            {draftingInvoice ? 'Drafting…' : 'Create Draft'}
          </button>
        </div>
      </Modal>

      {toast && <Toast message={toast.message} type={toast.type} onDone={() => setToast(null)} />}
    </CRMLayout>
  );
}
