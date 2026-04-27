// Decides the default landing path for a logged-in user based on their role
// and the surface (subdomain) they're on.

import type { UserRole } from '../types';
import { getSurface, surfaceUrl } from './surface';

// Returns either an in-app path (for same-surface navigation) or an absolute
// URL (when we need to bounce a user to the other subdomain).
export function defaultLandingFor(role: UserRole): string {
  const surface = getSurface();

  if (role === 'admin') {
    if (surface === 'crm') return '/admin/crm';
    return '/admin/dashboard';
  }

  // Partners belong on the Partners Portal. If they end up on crm.*, bounce.
  if (surface === 'crm') return surfaceUrl('partners', '/partner/dashboard');
  return '/partner/dashboard';
}
