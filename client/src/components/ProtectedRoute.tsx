import { useEffect } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import type { UserRole } from '../types';
import { defaultLandingFor } from '../lib/landing';

interface Props {
  role: UserRole;
}

export default function ProtectedRoute({ role }: Props) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-slate-500">Loading…</p>
        </div>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  if (user.role !== role) {
    return <RoleMismatchRedirect role={user.role} />;
  }

  return <Outlet />;
}

// Renders nothing while bouncing the user to their natural landing surface.
// If the destination is an absolute URL (cross-subdomain), use a hard
// navigation; otherwise use SPA navigation.
function RoleMismatchRedirect({ role }: { role: UserRole }) {
  const dest = defaultLandingFor(role);
  const isAbsolute = /^https?:\/\//.test(dest);

  useEffect(() => {
    if (isAbsolute) window.location.assign(dest);
  }, [dest, isAbsolute]);

  if (isAbsolute) return null;
  return <Navigate to={dest} replace />;
}
