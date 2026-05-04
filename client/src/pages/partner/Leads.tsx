import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Search, ArrowRight, ClipboardList } from 'lucide-react';
import Layout from '../../components/Layout';
import StatusBadge from '../../components/StatusBadge';
import api from '../../lib/api';
import type { Lead, LeadStatus } from '../../types';
import { LEAD_STATUSES } from '../../types';

function fmt(n: number) {
  return `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const ALL = 'All' as const;

export default function PartnerLeadsPage() {
  const navigate = useNavigate();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<LeadStatus | typeof ALL>(ALL);

  useEffect(() => {
    api.get('/leads').then(r => setLeads(r.data)).finally(() => setLoading(false));
  }, []);

  const filtered = leads.filter(l => {
    const matchStatus = filterStatus === ALL || l.status === filterStatus;
    const q = search.toLowerCase();
    const matchSearch = !q
      || l.client_name.toLowerCase().includes(q)
      || l.current_address.toLowerCase().includes(q)
      || l.email.toLowerCase().includes(q);
    return matchStatus && matchSearch;
  });

  return (
    <Layout>
      <div className="flex items-start justify-between mb-6">
        <div className="page-header mb-0">
          <h1 className="page-title">My Leads</h1>
          <p className="page-subtitle">{leads.length} lead{leads.length !== 1 ? 's' : ''} submitted</p>
        </div>
        <Link to="/partner/leads/new" className="btn-primary">
          <Plus className="w-4 h-4" /> Submit Lead
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            className="input pl-9"
            placeholder="Search leads…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {[ALL, ...LEAD_STATUSES].map(s => (
            <button
              key={s}
              onClick={() => setFilterStatus(s as LeadStatus | typeof ALL)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                filterStatus === s
                  ? 'bg-brand-600 text-white border-brand-600'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
              }`}
            >
              {s}
            </button>
          ))}
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
            <p className="text-sm text-slate-500">
              {leads.length === 0 ? 'No leads yet' : 'No leads match your filters'}
            </p>
            {leads.length === 0 && (
              <Link to="/partner/leads/new" className="btn-primary mt-4">
                <Plus className="w-4 h-4" /> Submit your first lead
              </Link>
            )}
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50">
                <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-6 py-3">Client</th>
                <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-4 py-3 hidden md:table-cell">Address</th>
                <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-4 py-3">Status</th>
                <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-4 py-3 hidden sm:table-cell">Commission</th>
                <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-4 py-3 hidden lg:table-cell">Submitted</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map(lead => (
                <tr
                  key={lead.id}
                  className="hover:bg-slate-50/60 transition-colors group cursor-pointer"
                  onClick={() => navigate(`/partner/leads/${lead.id}`)}
                >
                  <td className="px-6 py-4">
                    <p className="text-sm font-medium text-slate-900">{lead.client_name}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{lead.property_size} · {lead.move_stage}</p>
                  </td>
                  <td className="px-4 py-4 hidden md:table-cell">
                    <p className="text-sm text-slate-600 truncate max-w-[200px]">{lead.current_address}</p>
                    {lead.destination_address && (
                      <p className="text-xs text-slate-400 mt-0.5">→ {lead.destination_address}</p>
                    )}
                  </td>
                  <td className="px-4 py-4">
                    <StatusBadge status={lead.status} size="sm" />
                  </td>
                  <td className="px-4 py-4 hidden sm:table-cell">
                    {lead.estimated_commission !== null ? (
                      <div>
                        <p className="text-sm font-semibold text-slate-800">{fmt(lead.estimated_commission)}</p>
                        <p className="text-xs text-slate-400">{lead.commission_rate}% of {lead.quote_value ? fmt(lead.quote_value) : '–'}</p>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">Pending quote</span>
                    )}
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
    </Layout>
  );
}
