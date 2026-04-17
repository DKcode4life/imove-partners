import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ClipboardList, Users, PoundSterling, TrendingUp, ArrowRight, Star,
} from 'lucide-react';
import Layout from '../../components/Layout';
import StatCard from '../../components/StatCard';
import StatusBadge from '../../components/StatusBadge';
import api from '../../lib/api';
import type { AdminDashboard, Lead } from '../../types';

function fmt(n: number) {
  return `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function AdminDashboardPage() {
  const [data, setData] = useState<AdminDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/dashboard')
      .then(r => setData(r.data))
      .catch(() => setError('Failed to load dashboard. Please refresh the page.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
        </div>
      </Layout>
    );
  }

  if (error || !data) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <p className="text-slate-500 mb-2">{error || 'No data available.'}</p>
            <button className="btn-primary" onClick={() => window.location.reload()}>Retry</button>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="flex items-start justify-between mb-7">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Admin Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1">
            iMove Partner Portal · {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
        {data.newLeadsToday > 0 && (
          <div className="flex items-center gap-2 bg-brand-50 border border-brand-100 text-brand-700 px-4 py-2 rounded-xl text-sm font-medium">
            <Star className="w-4 h-4" />
            {data.newLeadsToday} new lead{data.newLeadsToday > 1 ? 's' : ''} today
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-7">
        <StatCard
          label="Active Partners"
          value={data.totalPartners}
          sub="Estate agencies"
          icon={<Users className="w-5 h-5 text-brand-600" />}
          iconBg="bg-brand-50"
        />
        <StatCard
          label="Total Leads"
          value={data.totalLeads}
          sub="All partners"
          icon={<ClipboardList className="w-5 h-5 text-violet-600" />}
          iconBg="bg-violet-50"
        />
        <StatCard
          label="Total Revenue"
          value={fmt(data.totalRevenue)}
          sub="From completed jobs"
          icon={<TrendingUp className="w-5 h-5 text-emerald-600" />}
          iconBg="bg-emerald-50"
        />
        <StatCard
          label="Commissions Owed"
          value={fmt(data.commissionsOwed)}
          sub="Pending payment"
          icon={<PoundSterling className="w-5 h-5 text-amber-600" />}
          iconBg="bg-amber-50"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Recent leads */}
        <div className="lg:col-span-2 card">
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-900">Recent Leads</h2>
            <Link to="/admin/leads" className="text-xs font-medium text-brand-600 hover:text-brand-700 flex items-center gap-1">
              View all <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="divide-y divide-slate-50">
            {data.recentLeads.map((lead: Lead) => (
              <Link
                key={lead.id}
                to={`/admin/leads/${lead.id}`}
                className="flex items-center gap-4 px-6 py-3.5 hover:bg-slate-50 transition-colors group"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-slate-900 truncate">{lead.client_name}</p>
                    <StatusBadge status={lead.status} size="sm" />
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {lead.agency_name} · {lead.partner_name} · {fmtDate(lead.created_at)}
                  </p>
                </div>
                <div className="flex-shrink-0 text-right">
                  {lead.estimated_commission != null && (
                    <p className="text-sm font-semibold text-emerald-600">{fmt(lead.estimated_commission)}</p>
                  )}
                  <ArrowRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-brand-500 transition-colors ml-auto mt-1" />
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Partner leaderboard */}
        <div className="card">
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-900">Commission Owed</h2>
            <Link to="/admin/partners" className="text-xs font-medium text-brand-600 hover:text-brand-700 flex items-center gap-1">
              Partners <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="divide-y divide-slate-50">
            {data.partnerStats.length === 0 ? (
              <p className="text-xs text-slate-400 px-6 py-6 text-center">No data yet</p>
            ) : (
              data.partnerStats.map((p, i) => (
                <div key={i} className="px-6 py-3.5">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-800">{p.agency_name}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {p.total_leads} leads · {p.confirmed_jobs} jobs
                      </p>
                    </div>
                    <span className={`text-sm font-bold ${p.owed > 0 ? 'text-amber-600' : 'text-slate-400'}`}>
                      {fmt(p.owed)}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

    </Layout>
  );
}
