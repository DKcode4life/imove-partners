// Subdomain-aware "surface" helpers.
//
// Production: partners.myimove.co.uk → 'partners', crm.myimove.co.uk → 'crm'.
// Anywhere else (localhost, IP, legacy single domain) → 'unknown', and the app
// falls back to its pre-split behaviour where every route is reachable.

export type Surface = 'partners' | 'crm' | 'unknown';

export function getSurface(host: string = window.location.hostname): Surface {
  if (host.startsWith('partners.')) return 'partners';
  if (host.startsWith('crm.')) return 'crm';
  return 'unknown';
}

// Build a URL on the *other* subdomain, preserving the apex domain, port, and
// protocol of the current host. On unknown surfaces (dev), falls back to a
// same-origin path so the rest of the flow still works locally.
export function surfaceUrl(target: 'partners' | 'crm', path: string = '/'): string {
  const { protocol, hostname, port } = window.location;
  const match = hostname.match(/^(partners|crm)\.(.+)$/);
  if (match) {
    const apex = match[2];
    const portPart = port ? `:${port}` : '';
    return `${protocol}//${target}.${apex}${portPart}${path}`;
  }
  return path;
}
