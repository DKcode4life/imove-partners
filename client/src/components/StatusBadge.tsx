import type { LeadStatus } from '../types';

const CONFIG: Record<LeadStatus, { bg: string; text: string; dot: string }> = {
  'New Lead':        { bg: 'bg-blue-50',    text: 'text-blue-700',   dot: 'bg-blue-500' },
  'Contacted':       { bg: 'bg-violet-50',  text: 'text-violet-700', dot: 'bg-violet-500' },
  'Survey Booked':   { bg: 'bg-pink-50',    text: 'text-pink-700',   dot: 'bg-pink-500' },
  'Quoted':          { bg: 'bg-amber-50',   text: 'text-amber-700',  dot: 'bg-amber-500' },
  'Quote Declined':  { bg: 'bg-red-50',     text: 'text-red-700',    dot: 'bg-red-500' },
  'Quote Accepted':  { bg: 'bg-orange-50',  text: 'text-orange-700', dot: 'bg-orange-500' },
  'Job Confirmed':   { bg: 'bg-green-50',   text: 'text-green-700',  dot: 'bg-green-500' },
  'Job Completed':   { bg: 'bg-emerald-50', text: 'text-emerald-700',dot: 'bg-emerald-500' },
  'Commission Paid': { bg: 'bg-green-50',   text: 'text-green-700',  dot: 'bg-green-600' },
};

interface Props {
  status: LeadStatus | string;
  size?: 'sm' | 'md';
}

export default function StatusBadge({ status, size = 'md' }: Props) {
  const cfg = CONFIG[status as LeadStatus] ?? { bg: 'bg-slate-100', text: 'text-slate-600', dot: 'bg-slate-400' };
  const padding = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs';

  return (
    <span className={`inline-flex items-center gap-1.5 font-medium rounded-full ${cfg.bg} ${cfg.text} ${padding}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {status}
    </span>
  );
}
