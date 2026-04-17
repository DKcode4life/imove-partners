import { useEffect, useState } from 'react';
import { NavLink, Link, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, LogOut, ArrowLeftCircle, UserCircle2, ClipboardList, CalendarDays,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import api from '../lib/api';
import { CRM_STATUSES } from '../types';

const STATUS_COLORS: Record<string, string> = {
  'New Lead':          'bg-blue-500',
  'Contacted':         'bg-violet-500',
  'Survey Booked':     'bg-cyan-500',
  'Survey Completed':  'bg-teal-500',
  'Awaiting Quote':    'bg-yellow-500',
  'Quote Sent':        'bg-amber-500',
  'Quote Accepted':    'bg-orange-500',
  'Booked Move':       'bg-green-500',
  'In Progress':       'bg-emerald-500',
  'Completed':         'bg-slate-400',
  'Lost / Cancelled':  'bg-red-500',
};

const MAIN_NAV = [
  { to: '/admin/crm',           label: 'Overview',   icon: <LayoutDashboard className="w-5 h-5" />, end: true },
  { to: '/admin/crm/jobs',      label: 'Jobs',       icon: <ClipboardList className="w-5 h-5" />,   end: false },
  { to: '/admin/crm/planner',   label: 'Planner',    icon: <CalendarDays className="w-5 h-5" />,    end: false },
  { to: '/admin/crm/customers', label: 'Customers',  icon: <UserCircle2 className="w-5 h-5" />,     end: false },
];

export default function CRMSidebar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [collapsed, setCollapsed] = useState(() =>
    localStorage.getItem('crm-sidebar-collapsed') === 'true'
  );

  const [summary, setSummary] = useState<Record<string, number>>({});

  useEffect(() => {
    api.get('/crm/jobs/summary')
      .then(r => {
        const map: Record<string, number> = {};
        for (const row of r.data.by_status) map[row.status] = row.count;
        setSummary(map);
      })
      .catch(() => {});
  }, [location.pathname, location.search]);

  const params = new URLSearchParams(location.search);
  const activeStatus = params.get('status');
  const isOnOverview = location.pathname === '/admin/crm';

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const toggle = () => {
    setCollapsed(c => {
      localStorage.setItem('crm-sidebar-collapsed', String(!c));
      return !c;
    });
  };

  return (
    <aside className={`${collapsed ? 'w-14' : 'w-64'} flex-shrink-0 bg-slate-900 flex flex-col h-screen sticky top-0 transition-all duration-200`}>

      {/* Brand / collapse button */}
      <div className={`border-b border-slate-700/60 flex items-center ${collapsed ? 'justify-center py-3 px-1' : 'px-4 py-4'}`}>
        {!collapsed && (
          <div className="flex-1 min-w-0">
            <div className="bg-white rounded-xl px-3 py-2 inline-flex items-center">
              <img src="/logo.png" alt="iMove" className="h-9 w-auto object-contain" />
            </div>
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mt-2.5 px-1">
              CRM · Operations
            </p>
          </div>
        )}
        <button
          onClick={toggle}
          className="p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-white/10 transition-colors flex-shrink-0"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* Main nav */}
      <nav className={`pt-4 pb-2 space-y-0.5 ${collapsed ? 'px-1' : 'px-3'}`}>
        {MAIN_NAV.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            title={collapsed ? item.label : undefined}
            className={({ isActive }) =>
              `flex items-center rounded-lg text-sm font-medium transition-colors ${
                collapsed ? 'justify-center px-2 py-2.5' : 'gap-3 px-3 py-2.5'
              } ${
                isActive
                  ? 'bg-white/10 text-white'
                  : 'text-slate-400 hover:bg-white/5 hover:text-white'
              }`
            }
          >
            {item.icon}
            {!collapsed && item.label}
          </NavLink>
        ))}
      </nav>

      {/* Pipeline section */}
      {!collapsed && (
        <div className="flex-1 overflow-y-auto px-3 pb-3">
          <div className="border-t border-slate-700/60 pt-4 mt-2">
            <p className="px-3 pb-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Pipeline
            </p>
            {CRM_STATUSES.map(status => {
              const count = summary[status] ?? 0;
              const isActive = isOnOverview && activeStatus === status;
              const dot = STATUS_COLORS[status] ?? 'bg-slate-400';
              return (
                <Link
                  key={status}
                  to={`/admin/crm?status=${encodeURIComponent(status)}`}
                  className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-white/10 text-white'
                      : 'text-slate-400 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dot}`} />
                    <span className="truncate">{status}</span>
                  </span>
                  <span className={`ml-2 text-xs font-bold tabular-nums flex-shrink-0 ${
                    isActive ? 'text-white' : count > 0 ? 'text-slate-300' : 'text-slate-600'
                  }`}>
                    {count}
                  </span>
                </Link>
              );
            })}
            {isOnOverview && activeStatus && (
              <Link
                to="/admin/crm"
                className="flex items-center gap-2.5 px-3 py-2 mt-1 rounded-lg text-xs font-medium text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors"
              >
                ✕ Clear filter
              </Link>
            )}
          </div>
        </div>
      )}

      {collapsed && <div className="flex-1" />}

      {/* Bottom: back + user + logout */}
      <div className={`border-t border-slate-700/60 p-2 space-y-0.5 ${collapsed ? 'flex flex-col items-center gap-1' : 'p-3'}`}>
        <Link
          to="/admin/dashboard"
          title={collapsed ? 'Partner Portal' : undefined}
          className={`flex items-center rounded-lg text-sm font-medium text-slate-400 hover:bg-white/5 hover:text-white transition-colors ${
            collapsed ? 'justify-center px-2 py-2' : 'gap-3 px-3 py-2'
          }`}
        >
          <ArrowLeftCircle className="w-5 h-5" />
          {!collapsed && 'Partner Portal'}
        </Link>

        {!collapsed ? (
          <div className="flex items-center gap-3 px-2 py-2 mt-1">
            <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0 bg-slate-700 flex items-center justify-center">
              {user?.avatar
                ? <img src={user.avatar} alt={user.name} className="w-full h-full object-cover" />
                : <span className="text-xs font-bold text-slate-300">{user?.name?.charAt(0).toUpperCase()}</span>
              }
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-200 truncate">{user?.name}</p>
              <p className="text-xs text-slate-500 truncate">{user?.email}</p>
            </div>
          </div>
        ) : (
          <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0 bg-slate-700 flex items-center justify-center">
            {user?.avatar
              ? <img src={user.avatar} alt={user.name} className="w-full h-full object-cover" />
              : <span className="text-xs font-bold text-slate-300">{user?.name?.charAt(0).toUpperCase()}</span>
            }
          </div>
        )}

        <button
          onClick={handleLogout}
          title={collapsed ? 'Sign out' : undefined}
          className={`w-full flex items-center text-sm text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors ${
            collapsed ? 'justify-center px-2 py-2' : 'gap-3 px-3 py-2'
          }`}
        >
          <LogOut className="w-5 h-5" />
          {!collapsed && 'Sign out'}
        </button>
      </div>
    </aside>
  );
}
