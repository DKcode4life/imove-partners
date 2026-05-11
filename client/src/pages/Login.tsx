import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, Lock, ArrowRight, AlertCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getSurface, surfaceUrl } from '../lib/surface';
import { defaultLandingFor } from '../lib/landing';

const SURFACE_COPY = {
  partners: { title: 'iMove Partners Portal', subtitle: 'Sign in to your partner account' },
  crm: { title: 'iMove CRM', subtitle: 'Sign in to manage operations' },
  unknown: { title: 'iMove Partners Portal', subtitle: 'Sign in to your account' },
} as const;

export default function Login() {
  const { login, logout, user, loading } = useAuth();
  const navigate = useNavigate();

  const surface = getSurface();
  const copy = SURFACE_COPY[surface];

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (loading || !user) return;
    // Partners are not allowed on crm.*; bounce them to partners.*.
    if (surface === 'crm' && user.role === 'partner') {
      logout();
      window.location.assign(surfaceUrl('partners', '/login'));
      return;
    }
    const dest = defaultLandingFor(user.role);
    if (/^https?:\/\//.test(dest)) {
      window.location.assign(dest);
    } else {
      navigate(dest, { replace: true });
    }
  }, [user, loading, navigate, surface, logout]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(email, password);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-brand-900 to-slate-900 flex items-center justify-center p-4">
      {/* Background pattern */}
      <div className="absolute inset-0 opacity-5"
        style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)', backgroundSize: '40px 40px' }} />

      <div className="relative w-full max-w-md">
        {/* Card */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          {/* Logo */}
          <div className="flex items-center gap-3 mb-8">
            <img src="/logo.png" alt="iMove" className="h-12 w-auto object-contain flex-shrink-0" />
            <h1 className="text-xl font-bold text-slate-900 leading-tight">{copy.title}</h1>
          </div>

          <div className="mb-6">
            <h2 className="text-2xl font-bold text-slate-900">Welcome back</h2>
            <p className="text-sm text-slate-500 mt-1">{copy.subtitle}</p>
          </div>

          {error && (
            <div className="mb-4 flex items-start gap-2.5 bg-red-50 border border-red-100 text-red-700 px-4 py-3 rounded-xl text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Email address</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="email"
                  className="input pl-9"
                  placeholder="you@agency.co.uk"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  autoFocus
                />
              </div>
            </div>

            <div>
              <label className="label">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="password"
                  className="input pl-9"
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="btn-primary w-full justify-center py-2.5 mt-2"
            >
              {submitting ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Signing in…
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  Sign in <ArrowRight className="w-4 h-4" />
                </span>
              )}
            </button>
          </form>

          {/* Demo credentials — partner-only surface */}
          {surface !== 'crm' && (
            <div className="mt-6 pt-6 border-t border-slate-100">
              <p className="text-xs font-medium text-slate-500 mb-2">Demo credentials:</p>
              <div className="text-xs text-slate-500">
                <button
                  type="button"
                  onClick={() => {
                    setEmail('john@premierproperties.co.uk');
                    setPassword('partner123');
                  }}
                  className="w-full text-left bg-slate-50 hover:bg-brand-50 hover:border-brand-200 border border-transparent rounded-lg px-3 py-2 transition-colors cursor-pointer group"
                >
                  <p className="font-semibold text-slate-700 mb-0.5 group-hover:text-brand-700">Partner</p>
                  <p>john@premierproperties.co.uk</p>
                  <p>partner123</p>
                  <p className="text-brand-500 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">Click to fill in →</p>
                </button>
              </div>
            </div>
          )}

          {/* Cross-surface hint */}
          {surface === 'crm' && (
            <div className="mt-6 pt-6 border-t border-slate-100 text-xs text-slate-500">
              Looking for the Partner Portal?{' '}
              <a href={surfaceUrl('partners', '/login')} className="text-brand-600 font-semibold hover:underline">
                Go to partners.myimove.co.uk
              </a>
            </div>
          )}
          {surface === 'partners' && (
            <div className="mt-4 text-xs text-slate-500 text-center">
              <a href={surfaceUrl('crm', '/login')} className="text-slate-400 hover:text-slate-600 hover:underline">
                Admins: open iMove CRM →
              </a>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-white/40 mt-4">
          © {new Date().getFullYear()} iMove. All rights reserved.
        </p>
      </div>
    </div>
  );
}
