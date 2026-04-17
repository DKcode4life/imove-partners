import { useEffect, useState } from 'react';
import { NavLink, Link, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, LogOut, ArrowLeftCircle, UserCircle2, ClipboardList, CalendarDays,
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

export default function CRMSidebar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

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

  return (
    <aside className="w-64 flex-shrink-0 bg-slate-900 flex flex-col h-screen sticky top-0">
      {/* Brand */}
      <div className="px-4 py-4 border-b border-slate-700/60">
        <div className="bg-white rounded-xl px-3 py-2 inline-flex items-center">
          <img
            src="/logo.png"
            alt="iMove Removals & Storage"
            className="h-9 w-auto object-contain"
          />
        </div>
        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mt-2.5 px-1">
          CRM · Operations
        </p>
      </div>

      {/* Main nav */}
      <nav className="px-3 pt-4 pb-2 space-y-0.5">
        <NavLink
          to="/admin/crm"
          end
          className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              isActive
                ? 'bg-white/10 text-white'
                : 'text-slate-400 hover:bg-white/5 hover:text-white'
            }`
          }
        >
          <LayoutDashboard className="w-4 h-4" />
          Overview
        </NavLink>

        <NavLink
          to="/admin/crm/jobs"
          className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              isActive
                ? 'bg-white/10 text-white'
                : 'text-slate-400 hover:bg-white/5 hover:text-white'
            }`
          }
        >
          <ClipboardList className="w-4 h-4" />
          Jobs
        </NavLink>

        <NavLink
          to="/admin/crm/planner"
          className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              isActive
                ? 'bg-white/10 text-white'
                : 'text-slate-400 hover:bg-white/5 hover:text-white'
            }`
          }
        >
          <CalendarDays className="w-4 h-4" />
          Planner
        </NavLink>

        <NavLink
          to="/admin/crm/customers"
          className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              isActive
                ? 'bg-white/10 text-white'
                : 'text-slate-400 hover:bg-white/5 hover:text-white'
            }`
          }
        >
          <UserCircle2 className="w-4 h-4" />
          Customers
        </NavLink>
      </nav>

      {/* Pipeline section */}
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

          {/* "All" reset link */}
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

      {/* Bottom: back to portal + user + logout */}
      <div className="border-t border-slate-700/60 p-3 space-y-0.5">
        {/* Back to Partner Portal */}
        <Link
          to="/admin/dashboard"
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-slate-400 hover:bg-white/5 hover:text-white transition-colors"
        >
          <ArrowLeftCircle className="w-4 h-4" />
          Partner Portal
        </Link>

        {/* User info */}
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

        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2 text-sm text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
