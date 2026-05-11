import { useEffect, useRef } from 'react';
import { useLocation, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../lib/api';

// Fires a page_view event each time the partner navigates within the portal.
// Wrapped around partner routes in App.tsx so admins on the CRM surface aren't
// tracked. Failures are swallowed so they never disrupt the user experience.
export default function PartnerActivityTracker() {
  const { user } = useAuth();
  const location = useLocation();
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    if (!user || user.role !== 'partner') return;
    const path = location.pathname;
    if (lastPath.current === path) return;
    lastPath.current = path;
    api.post('/analytics/track', { event_type: 'page_view', path }).catch(() => {});
  }, [user, location.pathname]);

  return <Outlet />;
}
