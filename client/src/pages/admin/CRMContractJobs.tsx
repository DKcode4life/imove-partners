import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Briefcase, Plus, Mail, Phone, MapPin, ChevronRight, AlertCircle, CheckCircle } from 'lucide-react';
import CRMLayout from '../../components/CRMLayout';
import api from '../../lib/api';
import type { Contract } from '../../types';
import CreateContractJobModal from '../../components/CreateContractJobModal';

interface ContractorRow extends Contract {
  open_jobs?: number;
  draft_invoices?: number;
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

export default function CRMContractJobs() {
  const navigate = useNavigate();
  const [contractors, setContractors] = useState<ContractorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [createTarget, setCreateTarget] = useState<Contract | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const showToast = (message: string, type: 'success' | 'error' = 'success') => setToast({ message, type });

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get('/contracts');
        setContractors(r.data);
      } finally { setLoading(false); }
    })();
  }, []);

  return (
    <CRMLayout>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Contract Jobs</h1>
          <p className="text-sm text-slate-500 mt-1">Daily B2B jobs and weekly invoices for each contractor.</p>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-slate-400 py-10 text-center">Loading…</div>
      ) : contractors.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 border-dashed py-16 text-center">
          <Briefcase className="w-8 h-8 text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-medium text-slate-500">No contractors yet</p>
          <p className="text-xs text-slate-400 mt-1">
            Add contractors and their price-list items in <span className="font-medium text-slate-600">Settings → Contracts</span>.
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {contractors.map(c => (
            <div
              key={c.id}
              className="bg-white rounded-xl border border-slate-200 hover:border-slate-300 transition-colors overflow-hidden"
            >
              <div className="flex items-stretch">
                <button
                  onClick={() => navigate(`/admin/crm/contract-jobs/${c.id}`)}
                  className="flex-1 text-left p-5 hover:bg-slate-50/60 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold text-slate-800">{c.company_name}</h3>
                    <ChevronRight className="w-4 h-4 text-slate-300" />
                  </div>
                  <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2 text-sm text-slate-500">
                    {c.contact_name && <span>{c.contact_name}</span>}
                    {c.email && (
                      <span className="flex items-center gap-1.5">
                        <Mail className="w-3.5 h-3.5 text-slate-400" />
                        {c.email}
                      </span>
                    )}
                    {(c.office_number || c.direct_line) && (
                      <span className="flex items-center gap-1.5">
                        <Phone className="w-3.5 h-3.5 text-slate-400" />
                        {c.office_number || c.direct_line}
                      </span>
                    )}
                    {c.address && (
                      <span className="flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-slate-400" />
                        <span className="truncate max-w-xs">{c.address}</span>
                      </span>
                    )}
                  </div>
                </button>
                <div className="border-l border-slate-100 flex items-center px-4">
                  <button
                    onClick={() => setCreateTarget(c)}
                    className="btn-primary flex items-center gap-2 whitespace-nowrap"
                  >
                    <Plus className="w-4 h-4" />
                    Create Job
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {createTarget && (
        <CreateContractJobModal
          contract={createTarget}
          onClose={() => setCreateTarget(null)}
          onSaved={() => {
            setCreateTarget(null);
            showToast('Job created');
          }}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onDone={() => setToast(null)} />}
    </CRMLayout>
  );
}
