import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft, User, MapPin, Phone, Mail, Calendar, Home,
  PoundSterling, CheckCircle, Clock, ChevronRight,
} from 'lucide-react';
import Layout from '../../components/Layout';
import StatusBadge from '../../components/StatusBadge';
import PipelineTracker from '../../components/PipelineTracker';
import api from '../../lib/api';
import type { Lead } from '../../types';

function fmt(n: number) {
  return `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(d: string | null) {
  if (!d) return '—';
  // ISO date (YYYY-MM-DD) → formatted date; free-text → display as-is
  if (/^\d{4}-\d{2}-\d{2}/.test(d)) {
    return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  }
  return d;
}

interface InfoRowProps {
  icon: React.ReactNode;
  label: string;
  value: string;
}

function InfoRow({ icon, label, value }: InfoRowProps) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-slate-50 last:border-0">
      <div className="text-slate-400 mt-0.5 flex-shrink-0">{icon}</div>
      <div>
        <p className="text-xs text-slate-400">{label}</p>
        <p className="text-sm font-medium text-slate-800 mt-0.5">{value}</p>
      </div>
    </div>
  );
}

export default function PartnerLeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/leads/${id}`)
      .then(r => setLead(r.data))
      .catch(() => setError('Lead not found'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <div className="w-7 h-7 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
        </div>
      </Layout>
    );
  }

  if (error || !lead) {
    return (
      <Layout>
        <div className="text-center py-16">
          <p className="text-slate-500 mb-4">{error || 'Lead not found'}</p>
          <Link to="/partner/leads" className="btn-primary">Back to leads</Link>
        </div>
      </Layout>
    );
  }

  const commission = lead.estimated_commission;
  const commissionRate = lead.commission_rate;

  return (
    <Layout>
      {/* Back */}
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700 mb-5 transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to leads
      </button>

      {/* Title row */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-slate-900">{lead.client_name}</h1>
            <StatusBadge status={lead.status} />
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Submitted {fmtDate(lead.created_at)} · Lead #{lead.id}
          </p>
        </div>
      </div>

      {/* Pipeline */}
      <div className="mb-5">
        <PipelineTracker currentStatus={lead.status} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left: client info */}
        <div className="lg:col-span-2 space-y-5">
          <div className="card p-6">
            <h2 className="text-sm font-semibold text-slate-900 mb-1">Client Information</h2>
            <div>
              <InfoRow icon={<User className="w-4 h-4" />} label="Full name" value={lead.client_name} />
              <InfoRow icon={<Phone className="w-4 h-4" />} label="Contact number" value={lead.contact_number} />
              <InfoRow icon={<Mail className="w-4 h-4" />} label="Email address" value={lead.email} />
              <InfoRow icon={<MapPin className="w-4 h-4" />} label="Current address" value={lead.current_address} />
              {lead.destination_address && (
                <InfoRow icon={<ChevronRight className="w-4 h-4" />} label="Destination address" value={lead.destination_address} />
              )}
              {lead.property_type && (
                <InfoRow icon={<Home className="w-4 h-4" />} label="Property type" value={
                  lead.property_type === 'Apartment' && lead.floor_number
                    ? `Apartment · ${lead.floor_number}${lead.has_lift ? ' · Lift available' : ' · No lift'}`
                    : lead.property_type
                } />
              )}
              <InfoRow icon={<Home className="w-4 h-4" />} label="Number of bedrooms" value={lead.property_size} />
              <InfoRow
                icon={<Calendar className="w-4 h-4" />}
                label="Moving date"
                value={lead.moving_date_type
                  ? `${lead.moving_date_type}: ${fmtDate(lead.estimated_moving_date)}`
                  : fmtDate(lead.estimated_moving_date)
                }
              />
              {lead.move_type && (
                <InfoRow icon={<ChevronRight className="w-4 h-4" />} label="Move type" value={lead.move_type} />
              )}
              <InfoRow icon={<ChevronRight className="w-4 h-4" />} label="Stage of move" value={lead.move_stage} />
            </div>
          </div>

          {lead.notes && (
            <div className="card p-6">
              <h2 className="text-sm font-semibold text-slate-900 mb-3">Notes</h2>
              <p className="text-sm text-slate-600 leading-relaxed">{lead.notes}</p>
            </div>
          )}
        </div>

        {/* Right: commission */}
        <div className="space-y-4">
          {/* Commission card */}
          <div className="card p-6">
            <h2 className="text-sm font-semibold text-slate-900 mb-4">Commission Breakdown</h2>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-500">Commission rate</span>
                <span className="text-sm font-semibold text-slate-700">{commissionRate}%</span>
              </div>
              {lead.quote_value ? (
                <>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-500">Job value</span>
                    <span className="text-sm font-semibold text-slate-700">{fmt(lead.quote_value)}</span>
                  </div>
                  <div className="border-t border-slate-100 pt-3 flex justify-between items-center">
                    <span className="text-sm font-semibold text-slate-700">Your commission</span>
                    <span className="text-lg font-bold text-emerald-600">
                      {commission !== null ? fmt(commission) : '—'}
                    </span>
                  </div>
                </>
              ) : (
                <div className="bg-slate-50 rounded-lg px-3 py-3 text-center">
                  <p className="text-xs text-slate-400">Quote pending from iMove</p>
                </div>
              )}
            </div>
          </div>

          {/* Payment status */}
          <div className="card p-6">
            <h2 className="text-sm font-semibold text-slate-900 mb-3">Payment Status</h2>
            {lead.commission_paid ? (
              <div className="flex items-center gap-2 text-emerald-600">
                <CheckCircle className="w-5 h-5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold">Commission Paid</p>
                  {lead.commission_paid_at && (
                    <p className="text-xs text-slate-400 mt-0.5">
                      {new Date(lead.commission_paid_at).toLocaleString('en-GB', {
                        day: 'numeric', month: 'short', year: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </p>
                  )}
                </div>
              </div>
            ) : ['Job Completed', 'Commission Paid'].includes(lead.status) ? (
              <div className="flex items-center gap-2 text-amber-600">
                <Clock className="w-5 h-5" />
                <div>
                  <p className="text-sm font-semibold">Payment Pending</p>
                  <p className="text-xs text-slate-400 mt-0.5">iMove will process your commission shortly</p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-slate-400">
                <PoundSterling className="w-5 h-5" />
                <p className="text-xs">Payment due once job is completed</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
