import type { ReactNode } from 'react';

interface Props {
  label: string;
  value: string | number;
  sub?: string;
  icon: ReactNode;
  iconBg?: string;
  trend?: 'up' | 'down' | 'neutral';
}

export default function StatCard({ label, value, sub, icon, iconBg = 'bg-brand-50' }: Props) {
  return (
    <div className="card p-5 flex items-start gap-4">
      <div className={`${iconBg} p-3 rounded-xl flex-shrink-0`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-500 truncate">{label}</p>
        <p className="text-2xl font-bold text-slate-900 mt-0.5 leading-tight">{value}</p>
        {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
      </div>
    </div>
  );
}
