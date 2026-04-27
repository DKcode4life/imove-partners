import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import api from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { defaultLandingFor } from '../lib/landing';

// Lands here from a "Switch to <other surface>" button on the sibling subdomain.
// Reads the one-time handoff token from the URL, exchanges it for a normal
// session token, and forwards the user to their natural landing page.
export default function AuthHandoff() {
  const [params] = useSearchParams();
  const { setSession } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = params.get('t');
    if (!token) {
      setError('Missing handoff token.');
      return;
    }
    let cancelled = false;
    api.post('/auth/exchange', { token })
      .then(r => {
        if (cancelled) return;
        setSession(r.data.token, r.data.user);
        const dest = defaultLandingFor(r.data.user.role);
        if (/^https?:\/\//.test(dest)) {
          window.location.replace(dest);
        } else {
          navigate(dest, { replace: true });
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
        setError(msg || 'Could not complete sign-in.');
      });
    return () => { cancelled = true; };
  }, [params, setSession, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="flex flex-col items-center gap-3 max-w-sm text-center">
        {error ? (
          <>
            <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center">
              <AlertCircle className="w-5 h-5 text-red-500" />
            </div>
            <p className="text-sm font-semibold text-slate-900">Sign-in failed</p>
            <p className="text-sm text-slate-500">{error}</p>
            <a href="/login" className="text-sm text-brand-600 font-semibold hover:underline mt-2">
              Go to sign in
            </a>
          </>
        ) : (
          <>
            <div className="w-8 h-8 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-slate-500">Signing you in…</p>
          </>
        )}
      </div>
    </div>
  );
}
