import { useEffect, useState } from 'react';
import { NavLink, Link, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, ClipboardList, Users, LogOut, PoundSterling, Settings, Briefcase,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import api from '../lib/api';

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
}

const PARTNER_NAV: NavItem[] = [
  { to: '/partner/dashboard',   label: 'Dashboard',   icon: <LayoutDashboard className="w-4 h-4" /> },
  { to: '/partner/leads',       label: 'My Leads',    icon: <ClipboardList className="w-4 h-4" /> },
  { to: '/partner/commissions', label: 'Commissions', icon: <PoundSterling className="w-4 h-4" /> },
];

const ADMIN_NAV: NavItem[] = [
  { to: '/admin/dashboard', label: 'Dashboard', icon: <LayoutDashboard className="w-4 h-4" /> },
  { to: '/admin/leads',     label: 'All Leads',  icon: <ClipboardList className="w-4 h-4" /> },
  { to: '/admin/partners',  label: 'Partners',   icon: <Users className="w-4 h-4" /> },
  { to: '/admin/crm',       label: 'iMove CRM',  icon: <Briefcase className="w-4 h-4" /> },
];

// Order as requested — Quote Declined at the bottom
const STATUS_ORDER = [
  'New Lead',
  'Contacted',
  'Survey Booked',
  'Quoted',
  'Quote Accepted',
  'Job Completed',
  'Commission Paid',
  'Quote Declined',
];

export default function Sidebar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const nav = user?.role === 'admin' ? ADMIN_NAV : PARTNER_NAV;

  const [statusCounts, setStatusCounts] = useState<{ status: string; count: number }[]>([]);

  // Refresh counts on every page navigation (admin only)
  useEffect(() => {
    if (user?.role !== 'admin') return;
    api.get('/leads/counts').then(r => setStatusCounts(r.data)).catch(() => {});
  }, [user?.role, location.pathname]);

  const countMap = Object.fromEntries(statusCounts.map(s => [s.status, s.count]));

  // Which status is currently active in the URL
  const params = new URLSearchParams(location.search);
  const activeStatus = params.get('status');
  const isOnLeads = location.pathname === '/admin/leads';

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <aside className="w-60 flex-shrink-0 bg-white border-r border-slate-200 flex flex-col h-screen sticky top-0">
      {/* Logo */}
      <div className="px-5 py-4 border-b border-slate-100">
        <img
          src="/logo.png"
          alt="iMove Removals & Storage"
          className="h-11 w-auto object-contain"
        />
      </div>

      {/* Role badge */}
      <div className="px-5 pt-4 pb-2">
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
          user?.role === 'admin'
            ? 'bg-amber-50 text-amber-700'
            : 'bg-brand-50 text-brand-700'
        }`}>
          {user?.role === 'admin' ? 'Admin' : 'Partner'}
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-2 space-y-0.5 overflow-y-auto">
        {nav.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`
            }
          >
            {item.icon}
            {item.label}
          </NavLink>
        ))}

        {/* ── Admin: Leads by status ──────────────────────────────── */}
        {user?.role === 'admin' && (
          <>
            {/* Thick divider */}
            <div className="!mt-4 !mb-1 border-t-2 border-slate-200" />

            <p className="px-3 pt-1 pb-1 text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Leads
            </p>

            {STATUS_ORDER.map(status => {
              const count = countMap[status] ?? 0;
              const isActive = isOnLeads && activeStatus === status;
              return (
                <Link
                  key={status}
                  to={`/admin/leads?status=${encodeURIComponent(status)}`}
                  className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-brand-50 text-brand-700'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  <span className="truncate">{status}</span>
                  <span className={`ml-2 text-xs font-bold tabular-nums flex-shrink-0 min-w-[1.25rem] text-right ${
                    isActive ? 'text-brand-600' : count > 0 ? 'text-slate-700' : 'text-slate-300'
                  }`}>
                    {count}
                  </span>
                </Link>
              );
            })}
          </>
        )}
      </nav>

      {/* User info + logout */}
      <div className="border-t border-slate-100 p-3">
        {/* Settings — partner only */}
        {user?.role === 'partner' && (
          <NavLink
            to="/partner/settings"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors mb-1 ${
                isActive
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
              }`
            }
          >
            <Settings className="w-4 h-4" />
            Settings
          </NavLink>
        )}

        <div className="flex items-center gap-3 px-2 py-2 rounded-lg mb-1">
          <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0 bg-brand-100 flex items-center justify-center">
            {user?.avatar
              ? <img src={user.avatar} alt={user.name} className="w-full h-full object-cover" />
              : <span className="text-xs font-bold text-brand-700">{user?.name?.charAt(0).toUpperCase()}</span>
            }
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-slate-900 truncate">{user?.name}</p>
            <p className="text-xs text-slate-400 truncate">{user?.email}</p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2 text-sm text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
