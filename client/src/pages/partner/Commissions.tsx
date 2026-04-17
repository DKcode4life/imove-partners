import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Clock, TrendingUp, CheckCircle, BadgeCheck, PoundSterling,
  ChevronRight, ArrowRight, FileText,
} from 'lucide-react';
import Layout from '../../components/Layout';
import api from '../../lib/api';
import type { Lead } from '../../types';

function fmt(n: number) {
  return `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDateTime(d: string) {
  return new Date(d).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function sum(leads: Lead[]) {
  return leads.reduce((s, l) => s + (l.estimated_commission ?? 0), 0);
}

// ── Stage definitions ──────────────────────────────────────────────────────────
const PENDING_STATUSES   = new Set(['New Lead', 'Contacted', 'Survey Booked']);
const QUOTED_STATUSES    = new Set(['Quoted']);
const CONFIRMED_STATUSES = new Set(['Quote Accepted']);
const COMPLETED_STATUSES = new Set(['Job Completed']);

function bucket(leads: Lead[]) {
  const pending   = leads.filter(l => PENDING_STATUSES.has(l.status));
  const quoted    = leads.filter(l => QUOTED_STATUSES.has(l.status));
  const confirmed = leads.filter(l => CONFIRMED_STATUSES.has(l.status));
  const completed = leads.filter(l => COMPLETED_STATUSES.has(l.status));
  const paid      = leads.filter(l => l.commission_paid || l.status === 'Commission Paid');
  return { pending, quoted, confirmed, completed, paid };
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function EmptyRow({ message }: { message: string }) {
  return (
    <p className="text-xs text-slate-400 py-5 text-center">{message}</p>
  );
}

interface SectionProps {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  accent: string;        // Tailwind border-l color
  headerBg: string;      // Tailwind bg color for header
  iconColor: string;
  children: React.ReactNode;
  total?: number | null;
  totalLabel?: string;
  totalColor?: string;
  badge?: number;
}

function Section({ title, subtitle, icon, accent, headerBg, iconColor, children, total, totalLabel, totalColor, badge }: SectionProps) {
  return (
    <div className={`card overflow-hidden border-l-4 ${accent}`}>
      {/* Header */}
      <div className={`flex items-center justify-between px-5 py-4 ${headerBg}`}>
        <div className="flex items-center gap-3">
          <div className={`${iconColor}`}>{icon}</div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
            <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
          </div>
        </div>
        {badge !== undefined && (
          <span className="text-xs font-bold text-slate-600 bg-white/70 border border-slate-200 px-2.5 py-1 rounded-full">
            {badge} {badge === 1 ? 'lead' : 'leads'}
          </span>
        )}
      </div>

      {/* Body */}
      <div className="divide-y divide-slate-50">
        {children}
      </div>

      {/* Total footer */}
      {total !== undefined && total !== null && total > 0 && (
        <div className={`flex items-center justify-between px-5 py-3 border-t border-slate-100 ${headerBg}`}>
          <span className="text-xs font-medium text-slate-500">{totalLabel}</span>
          <span className={`text-sm font-bold ${totalColor ?? 'text-slate-800'}`}>{fmt(total)}</span>
        </div>
      )}
    </div>
  );
}

function LeadRow({ lead, showCommission = true, showDate = false, showPaidAt = false }: {
  lead: Lead;
  showCommission?: boolean;
  showDate?: boolean;
  showPaidAt?: boolean;
}) {
  return (
    <Link
      to={`/partner/leads/${lead.id}`}
      className="flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50/80 transition-colors group"
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-900 truncate">{lead.client_name}</p>
        <p className="text-xs text-slate-400 mt-0.5 truncate">
          {showDate && `Submitted ${fmtDate(lead.created_at)}`}
          {showPaidAt && lead.commission_paid_at && `Paid ${fmtDateTime(lead.commission_paid_at)}`}
          {!showDate && !showPaidAt && lead.current_address}
        </p>
      </div>
      {showCommission && lead.estimated_commission !== null ? (
        <div className="text-right flex-shrink-0">
          <p className="text-sm font-semibold text-slate-800">{fmt(lead.estimated_commission)}</p>
          {lead.quote_value && (
            <p className="text-xs text-slate-400">{lead.commission_rate}% of {fmt(lead.quote_value)}</p>
          )}
        </div>
      ) : showCommission ? (
        <span className="text-xs text-slate-400 flex-shrink-0">No quote yet</span>
      ) : null}
      <ArrowRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-brand-400 transition-colors flex-shrink-0 ml-1" />
    </Link>
  );
}

// ── Pipeline summary strip ─────────────────────────────────────────────────────

interface PipelineStage {
  label: string;
  sublabel: string;
  value: string;
  color: string;
  bg: string;
  iconColor: string;
  icon: React.ReactNode;
}

function PipelineStrip({ stages }: { stages: PipelineStage[] }) {
  return (
    <div className="card p-5">
      <div className="flex items-stretch gap-0">
        {stages.map((s, i) => (
          <div key={s.label} className="flex items-center flex-1 min-w-0">
            <div className={`flex-1 rounded-xl ${s.bg} px-3 py-3 text-center`}>
              <div className={`flex justify-center mb-1.5 ${s.iconColor}`}>{s.icon}</div>
              <p className={`text-base font-bold ${s.color}`}>{s.value}</p>
              <p className="text-xs font-semibold text-slate-700 mt-0.5 leading-tight">{s.label}</p>
              <p className="text-xs text-slate-400 mt-0.5 leading-tight hidden sm:block">{s.sublabel}</p>
            </div>
            {i < stages.length - 1 && (
              <ChevronRight className="w-4 h-4 text-slate-300 flex-shrink-0 mx-1" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function PartnerCommissionsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/leads').then(r => setLeads(r.data)).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <div className="w-7 h-7 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
        </div>
      </Layout>
    );
  }

  const { pending, quoted, confirmed, completed, paid } = bucket(leads);

  const totalUpcoming = sum(quoted) + sum(confirmed) + sum(completed);
  const totalPaid     = sum(paid);

  const stages: PipelineStage[] = [
    {
      label:     'Pending',
      sublabel:  'Awaiting quote',
      value:     `${pending.length} lead${pending.length !== 1 ? 's' : ''}`,
      color:     'text-slate-700',
      bg:        'bg-slate-50',
      iconColor: 'text-slate-400',
      icon:      <Clock className="w-4 h-4" />,
    },
    {
      label:     'Quoted',
      sublabel:  'Estimate received',
      value:     quoted.length ? fmt(sum(quoted)) : '—',
      color:     'text-amber-700',
      bg:        'bg-amber-50',
      iconColor: 'text-amber-400',
      icon:      <FileText className="w-4 h-4" />,
    },
    {
      label:     'Confirmed',
      sublabel:  'Job accepted',
      value:     confirmed.length ? fmt(sum(confirmed)) : '—',
      color:     'text-brand-700',
      bg:        'bg-brand-50',
      iconColor: 'text-brand-400',
      icon:      <TrendingUp className="w-4 h-4" />,
    },
    {
      label:     'Completed',
      sublabel:  'Awaiting payment',
      value:     completed.length ? fmt(sum(completed)) : '—',
      color:     'text-emerald-700',
      bg:        'bg-emerald-50',
      iconColor: 'text-emerald-400',
      icon:      <BadgeCheck className="w-4 h-4" />,
    },
    {
      label:     'Paid',
      sublabel:  'Received',
      value:     paid.length ? fmt(totalPaid) : '—',
      color:     'text-emerald-700',
      bg:        'bg-emerald-100',
      iconColor: 'text-emerald-600',
      icon:      <CheckCircle className="w-4 h-4" />,
    },
  ];

  return (
    <Layout>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="page-header mb-0">
          <h1 className="page-title">Commissions</h1>
          <p className="page-subtitle">Track your earnings at every stage of the pipeline</p>
        </div>
        {(totalUpcoming > 0 || totalPaid > 0) && (
          <div className="text-right">
            <p className="text-xs text-slate-400">Total upcoming</p>
            <p className="text-xl font-bold text-slate-900">{fmt(totalUpcoming)}</p>
            {totalPaid > 0 && (
              <p className="text-xs text-emerald-600 font-medium mt-0.5">{fmt(totalPaid)} received</p>
            )}
          </div>
        )}
      </div>

      {/* Pipeline summary */}
      <div className="mb-6">
        <PipelineStrip stages={stages} />
      </div>

      <div className="space-y-5">

        {/* ── 1. Pending Leads ─────────────────────────────────────── */}
        <Section
          title="Pending Leads"
          subtitle="Submitted — waiting for iMove to quote"
          icon={<Clock className="w-4 h-4" />}
          accent="border-l-slate-300"
          headerBg="bg-slate-50/60"
          iconColor="text-slate-400"
          badge={pending.length}
        >
          {pending.length === 0 ? (
            <EmptyRow message="No pending leads" />
          ) : (
            pending.map(lead => (
              <LeadRow key={lead.id} lead={lead} showCommission={false} showDate />
            ))
          )}
        </Section>

        {/* ── 2. Quoted Leads ──────────────────────────────────────── */}
        <Section
          title="Quoted Leads"
          subtitle="Quote received — commission calculated, awaiting acceptance"
          icon={<FileText className="w-4 h-4" />}
          accent="border-l-amber-400"
          headerBg="bg-amber-50/60"
          iconColor="text-amber-500"
          badge={quoted.length}
          total={sum(quoted)}
          totalLabel="Estimated commission if accepted"
          totalColor="text-amber-700"
        >
          {quoted.length === 0 ? (
            <EmptyRow message="No quoted leads at the moment" />
          ) : (
            quoted.map(lead => (
              <LeadRow key={lead.id} lead={lead} />
            ))
          )}
        </Section>

        {/* ── 3. Confirmed Jobs ────────────────────────────────────── */}
        <Section
          title="Confirmed Jobs"
          subtitle="Quote accepted — commission confirmed, job in progress"
          icon={<TrendingUp className="w-4 h-4" />}
          accent="border-l-brand-500"
          headerBg="bg-brand-50/60"
          iconColor="text-brand-500"
          badge={confirmed.length}
          total={sum(confirmed)}
          totalLabel="Confirmed commission"
          totalColor="text-brand-700"
        >
          {confirmed.length === 0 ? (
            <EmptyRow message="No confirmed jobs yet" />
          ) : (
            confirmed.map(lead => (
              <LeadRow key={lead.id} lead={lead} />
            ))
          )}
        </Section>

        {/* ── 4. Completed Jobs ────────────────────────────────────── */}
        <Section
          title="Completed Jobs"
          subtitle="Job done — commission secured, awaiting payment from iMove"
          icon={<BadgeCheck className="w-4 h-4" />}
          accent="border-l-emerald-400"
          headerBg="bg-emerald-50/60"
          iconColor="text-emerald-500"
          badge={completed.length}
          total={sum(completed)}
          totalLabel="Commission secured"
          totalColor="text-emerald-700"
        >
          {completed.length === 0 ? (
            <EmptyRow message="No completed jobs awaiting payment" />
          ) : (
            completed.map(lead => (
              <div key={lead.id} className="flex items-center">
                <div className="flex-1">
                  <LeadRow lead={lead} />
                </div>
              </div>
            ))
          )}
          {completed.length > 0 && (
            <div className="px-5 py-2.5 bg-emerald-50/80">
              <p className="text-xs text-emerald-600 font-medium">
                iMove will process your payment shortly for the above jobs
              </p>
            </div>
          )}
        </Section>

        {/* ── 5. Paid Commissions ──────────────────────────────────── */}
        <Section
          title="Paid Commissions"
          subtitle="Commission received — payment confirmed"
          icon={<CheckCircle className="w-4 h-4" />}
          accent="border-l-slate-400"
          headerBg="bg-slate-50/60"
          iconColor="text-emerald-500"
          badge={paid.length}
          total={totalPaid}
          totalLabel={`Total received across ${paid.length} job${paid.length !== 1 ? 's' : ''}`}
          totalColor="text-emerald-700"
        >
          {paid.length === 0 ? (
            <EmptyRow message="No payments received yet" />
          ) : (
            paid.map(lead => (
              <LeadRow key={lead.id} lead={lead} showPaidAt />
            ))
          )}
        </Section>

        {/* ── Overall summary ──────────────────────────────────────── */}
        {(totalUpcoming > 0 || totalPaid > 0) && (
          <div className="card p-5">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">Your Earnings Summary</h3>
            <div className="space-y-2">
              {sum(quoted) > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-600">Potential (quoted)</span>
                  <span className="text-sm font-semibold text-amber-600">{fmt(sum(quoted))}</span>
                </div>
              )}
              {sum(confirmed) > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-600">Confirmed (in progress)</span>
                  <span className="text-sm font-semibold text-brand-600">{fmt(sum(confirmed))}</span>
                </div>
              )}
              {sum(completed) > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-600">Secured (awaiting payment)</span>
                  <span className="text-sm font-semibold text-emerald-600">{fmt(sum(completed))}</span>
                </div>
              )}
              {totalUpcoming > 0 && (
                <div className="flex justify-between items-center pt-2 border-t border-slate-100">
                  <span className="text-sm font-semibold text-slate-800">Total upcoming</span>
                  <span className="text-base font-bold text-slate-900">{fmt(totalUpcoming)}</span>
                </div>
              )}
              {totalPaid > 0 && (
                <div className="flex justify-between items-center pt-2 border-t border-slate-100">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-emerald-500" />
                    <span className="text-sm font-semibold text-slate-800">Total received</span>
                  </div>
                  <span className="text-base font-bold text-emerald-600">{fmt(totalPaid)}</span>
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </Layout>
  );
}
