import { useEffect, useState } from 'react';
import { NavLink, Link, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, LogOut, ArrowLeftCircle, UserCircle2, ClipboardList, CalendarDays,
  ChevronLeft, ChevronRight, Settings,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import api from '../lib/api';
import { getSurface, surfaceUrl } from '../lib/surface';
import type { JobStatusSetting } from '../types';

// Shown immediately and replaced by API data once loaded
const FALLBACK_STATUSES: JobStatusSetting[] = [
  { id:  0, name: 'New Lead',               color: '#3b82f6', sort_order: 0,  created_at: '' },
  { id:  1, name: 'Called V/M',             color: '#8b5cf6', sort_order: 1,  created_at: '' },
  { id:  2, name: 'Contacted',              color: '#7c3aed', sort_order: 2,  created_at: '' },
  { id:  3, name: 'Estimate Sent',          color: '#fbbf24', sort_order: 3,  created_at: '' },
  { id:  4, name: 'Survey Physical',        color: '#06b6d4', sort_order: 4,  created_at: '' },
  { id:  5, name: 'Survey Video',           color: '#0d9488', sort_order: 5,  created_at: '' },
  { id:  6, name: 'Quote Sent',             color: '#f59e0b', sort_order: 6,  created_at: '' },
  { id:  7, name: 'Quote Chased',           color: '#f97316', sort_order: 7,  created_at: '' },
  { id:  8, name: 'Most Likely',            color: '#eab308', sort_order: 8,  created_at: '' },
  { id:  9, name: 'Quote Accepted',         color: '#10b981', sort_order: 9,  created_at: '' },
  { id: 10, name: 'Confirmed No Date',      color: '#059669', sort_order: 10, created_at: '' },
  { id: 11, name: 'Confirmed Deposit',      color: '#65a30d', sort_order: 11, created_at: '' },
  { id: 12, name: 'Confirmed Paid',         color: '#15803d', sort_order: 12, created_at: '' },
  { id: 13, name: 'Completed',              color: '#94a3b8', sort_order: 13, created_at: '' },
  { id: 14, name: 'Archived / Review Done', color: '#6b7280', sort_order: 14, created_at: '' },
  { id: 15, name: 'Lost / Cancelled',       color: '#ef4444', sort_order: 15, created_at: '' },
];

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
  const [statuses, setStatuses] = useState<JobStatusSetting[]>(FALLBACK_STATUSES);

  // Refresh pipeline statuses on every route change; fall back to hardcoded list on error
  useEffect(() => {
    api.get('/settings/statuses')
      .then(r => { if (r.data?.length) setStatuses(r.data); })
      .catch(() => {});
  }, [location.pathname]);

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

  const surface = getSurface();
  const [switchingToPartners, setSwitchingToPartners] = useState(false);

  // On crm.*, the Partner Portal lives on a different subdomain. Issue a
  // one-shot handoff token and bounce so the admin lands already signed in.
  async function switchToPartners() {
    if (switchingToPartners) return;
    setSwitchingToPartners(true);
    try {
      const r = await api.post('/auth/handoff');
      const dest = surfaceUrl('partners', `/auth/handoff?t=${encodeURIComponent(r.data.token)}`);
      window.location.assign(dest);
    } catch {
      window.location.assign(surfaceUrl('partners', '/admin/dashboard'));
    }
  }

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
            {statuses.map(s => {
              const count = summary[s.name] ?? 0;
              const isActive = isOnOverview && activeStatus === s.name;
              return (
                <Link
                  key={s.id}
                  to={`/admin/crm?status=${encodeURIComponent(s.name)}`}
                  className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-white/10 text-white'
                      : 'text-slate-400 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                    <span className="truncate">{s.name}</span>
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

      {/* Settings */}
      <div className={`border-t border-slate-700/60 pt-2 pb-1 ${collapsed ? 'px-1' : 'px-3'}`}>
        <NavLink
          to="/admin/crm/settings"
          title={collapsed ? 'Settings' : undefined}
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
          <Settings className="w-5 h-5" />
          {!collapsed && 'Settings'}
        </NavLink>
      </div>

      {/* Bottom: back + user + logout */}
      <div className={`border-t border-slate-700/60 p-2 space-y-0.5 ${collapsed ? 'flex flex-col items-center gap-1' : 'p-3'}`}>
        {surface === 'crm' ? (
          <button
            onClick={switchToPartners}
            disabled={switchingToPartners}
            title={collapsed ? 'Partner Portal' : undefined}
            className={`w-full flex items-center rounded-lg text-sm font-medium text-slate-400 hover:bg-white/5 hover:text-white transition-colors disabled:opacity-60 ${
              collapsed ? 'justify-center px-2 py-2' : 'gap-3 px-3 py-2'
            }`}
          >
            <ArrowLeftCircle className="w-5 h-5" />
            {!collapsed && (switchingToPartners ? 'Switching…' : 'Partner Portal')}
          </button>
        ) : (
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
        )}

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
