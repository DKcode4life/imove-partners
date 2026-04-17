import { useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle, AlertCircle, Eye, EyeOff, Lock } from 'lucide-react';
import Layout from '../../components/Layout';
import api from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';

// Resize + compress an image file to a small JPEG thumbnail (max 200×200 px).
// Keeps the base64 payload well under 20 kb so it fits in the DB and JSON limit.
function resizeAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = ev => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const MAX = 200;
        let { width, height } = img;
        if (width > height) {
          if (width > MAX) { height = Math.round((height * MAX) / width); width = MAX; }
        } else {
          if (height > MAX) { width = Math.round((width * MAX) / height); height = MAX; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.src = ev.target!.result as string;
    };
    reader.readAsDataURL(file);
  });
}

const PAYMENT_METHODS = ['Bank Transfer', 'Amazon Gift Card', 'Cash'] as const;
type PaymentMethod = typeof PAYMENT_METHODS[number];

interface PartnerProfile {
  agency_name: string;
  phone: string;
  payment_method: PaymentMethod | '';
  bank_account: string;
  bank_sort_code: string;
  gift_card_email: string;
}

function SaveStatus({ status }: { status: 'idle' | 'saving' | 'saved' | 'error'; error?: string }) {
  if (status === 'idle') return null;
  if (status === 'saving') return <span className="text-xs text-slate-400">Saving…</span>;
  if (status === 'saved') return (
    <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium">
      <CheckCircle className="w-3.5 h-3.5" /> Saved
    </span>
  );
  return <span className="text-xs text-red-600">{error || 'Failed to save'}</span>;
}

export default function PartnerSettingsPage() {
  const { user, updateUser } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Profile fields
  const [name, setName]   = useState('');
  const [email, setEmail] = useState('');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [profileStatus, setProfileStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [profileError, setProfileError] = useState('');

  // Partner fields
  const [partner, setPartner] = useState<PartnerProfile>({
    agency_name: '', phone: '',
    payment_method: '',
    bank_account: '', bank_sort_code: '', gift_card_email: '',
  });

  // Password fields
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' });
  const [showPw, setShowPw] = useState({ current: false, next: false, confirm: false });
  const [pwStatus, setPwStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [pwError, setPwError] = useState('');

  // Load fresh profile on mount
  useEffect(() => {
    api.get('/auth/me').then(r => {
      const u = r.data.user;
      const p = r.data.partner;
      setName(u.name);
      setEmail(u.email);
      setAvatar(u.avatar || null);
      if (p) {
        setPartner({
          agency_name:    p.agency_name  || '',
          phone:          p.phone        || '',
          payment_method: (p.payment_method as PaymentMethod) || '',
          bank_account:   p.bank_account   || '',
          bank_sort_code: p.bank_sort_code || '',
          gift_card_email: p.gift_card_email || '',
        });
      }
    });
  }, []);

  // Avatar file selection — resize to thumbnail before storing
  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file');
      return;
    }
    try {
      const resized = await resizeAvatar(file);
      setAvatar(resized);
    } catch {
      alert('Could not process image. Please try a different file.');
    }
  };

  const removeAvatar = () => setAvatar(null);

  // Save profile + agency + payment
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileStatus('saving');
    setProfileError('');
    try {
      const res = await api.put('/auth/me', {
        name:           name.trim(),
        email:          email.trim(),
        avatar:         avatar,
        agency_name:    partner.agency_name || null,
        phone:          partner.phone || null,
        payment_method: partner.payment_method || null,
        bank_account:   partner.bank_account || null,
        bank_sort_code: partner.bank_sort_code || null,
        gift_card_email: partner.gift_card_email || null,
      });
      updateUser({ name: res.data.user.name, email: res.data.user.email, avatar: res.data.user.avatar, agencyName: res.data.partner?.agency_name ?? null });
      setProfileStatus('saved');
      setTimeout(() => setProfileStatus('idle'), 3000);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setProfileError(msg || 'Failed to save');
      setProfileStatus('error');
    }
  };

  // Change password
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pwForm.next !== pwForm.confirm) {
      setPwError('New passwords do not match');
      setPwStatus('error');
      return;
    }
    if (pwForm.next.length < 6) {
      setPwError('Password must be at least 6 characters');
      setPwStatus('error');
      return;
    }
    setPwStatus('saving');
    setPwError('');
    try {
      await api.put('/auth/password', { current_password: pwForm.current, new_password: pwForm.next });
      setPwForm({ current: '', next: '', confirm: '' });
      setPwStatus('saved');
      setTimeout(() => setPwStatus('idle'), 3000);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setPwError(msg || 'Failed to update password');
      setPwStatus('error');
    }
  };

  const setP = (k: keyof PartnerProfile) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setPartner(prev => ({ ...prev, [k]: e.target.value }));

  const initials = (name || user?.name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <Layout>
      <div className="max-w-2xl">
        <div className="page-header">
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Manage your profile, agency details, and account security</p>
        </div>

        <form onSubmit={handleSaveProfile} className="space-y-5">

          {/* ── Profile Picture ─────────────────────────────────────── */}
          <div className="card p-6">
            <h2 className="text-sm font-semibold text-slate-900 pb-3 border-b border-slate-100 mb-4">Profile Picture</h2>
            <div className="flex items-center gap-5">
              {/* Avatar circle */}
              <div className="relative flex-shrink-0">
                <div className="w-20 h-20 rounded-full overflow-hidden bg-brand-100 flex items-center justify-center border-2 border-white shadow-md">
                  {avatar
                    ? <img src={avatar} alt="Profile" className="w-full h-full object-cover" />
                    : <span className="text-xl font-bold text-brand-700">{initials}</span>
                  }
                </div>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="absolute -bottom-1 -right-1 w-7 h-7 bg-brand-600 rounded-full flex items-center justify-center shadow hover:bg-brand-700 transition-colors"
                  title="Upload photo"
                >
                  <Camera className="w-3.5 h-3.5 text-white" />
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleAvatarChange}
                />
              </div>

              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="btn-secondary text-sm"
                >
                  Upload photo
                </button>
                {avatar && (
                  <button
                    type="button"
                    onClick={removeAvatar}
                    className="block text-xs text-slate-400 hover:text-red-500 transition-colors"
                  >
                    Remove photo
                  </button>
                )}
                <p className="text-xs text-slate-400">JPG, PNG or GIF · max 2 MB</p>
              </div>
            </div>
          </div>

          {/* ── Personal Details ─────────────────────────────────────── */}
          <div className="card p-6 space-y-4">
            <h2 className="text-sm font-semibold text-slate-900 pb-1 border-b border-slate-100">Personal Details</h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Full name</label>
                <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Your full name" required />
              </div>
              <div>
                <label className="label">Phone number</label>
                <input type="tel" className="input" value={partner.phone} onChange={setP('phone')} placeholder="07700 900000" />
              </div>
            </div>

            <div>
              <label className="label">Email address</label>
              <input type="email" className="input" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@agency.co.uk" required />
            </div>
          </div>

          {/* ── Agency Details ───────────────────────────────────────── */}
          <div className="card p-6 space-y-4">
            <h2 className="text-sm font-semibold text-slate-900 pb-1 border-b border-slate-100">Agency Details</h2>

            <div>
              <label className="label">Agency / Estate agency name</label>
              <input className="input" value={partner.agency_name} onChange={setP('agency_name')} placeholder="Premier Properties" />
            </div>
          </div>

          {/* ── Payment Details ──────────────────────────────────────── */}
          <div className="card p-6 space-y-4">
            <h2 className="text-sm font-semibold text-slate-900 pb-1 border-b border-slate-100">Payment Details</h2>

            <div>
              <label className="label">Preferred payment method</label>
              <div className="flex rounded-xl border border-slate-200 overflow-hidden">
                {PAYMENT_METHODS.map((method, i) => (
                  <button
                    key={method}
                    type="button"
                    className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                      partner.payment_method === method
                        ? 'bg-brand-600 text-white'
                        : 'text-slate-600 hover:bg-slate-50'
                    }${i > 0 ? ' border-l border-slate-200' : ''}`}
                    onClick={() => setPartner(prev => ({ ...prev, payment_method: method }))}
                  >
                    {method}
                  </button>
                ))}
              </div>
            </div>

            {/* Bank Transfer details */}
            {partner.payment_method === 'Bank Transfer' && (
              <div className="bg-slate-50 rounded-xl p-4 space-y-3 border border-slate-100">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Bank Details</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Account number</label>
                    <input className="input" value={partner.bank_account} onChange={setP('bank_account')} placeholder="12345678" maxLength={8} />
                  </div>
                  <div>
                    <label className="label">Sort code</label>
                    <input className="input" value={partner.bank_sort_code} onChange={setP('bank_sort_code')} placeholder="00-00-00" maxLength={8} />
                  </div>
                </div>
              </div>
            )}

            {/* Amazon Gift Card details */}
            {partner.payment_method === 'Amazon Gift Card' && (
              <div className="bg-amber-50 rounded-xl p-4 space-y-3 border border-amber-100">
                <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">Gift Card Details</p>
                <div>
                  <label className="label">Email for gift cards</label>
                  <input type="email" className="input" value={partner.gift_card_email} onChange={setP('gift_card_email')} placeholder="you@email.com" />
                  <p className="text-xs text-slate-400 mt-1">Amazon gift cards will be sent to this address</p>
                </div>
              </div>
            )}
          </div>

          {/* Save profile button */}
          <div className="flex items-center justify-between">
            <SaveStatus status={profileStatus} error={profileError} />
            {profileStatus === 'error' && (
              <span className="flex items-center gap-1.5 text-xs text-red-600">
                <AlertCircle className="w-3.5 h-3.5" /> {profileError}
              </span>
            )}
            <button type="submit" className="btn-primary ml-auto" disabled={profileStatus === 'saving'}>
              {profileStatus === 'saving' ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Saving…
                </span>
              ) : 'Save Changes'}
            </button>
          </div>
        </form>

        {/* ── Change Password ──────────────────────────────────────── */}
        <form onSubmit={handleChangePassword} className="mt-5">
          <div className="card p-6 space-y-4">
            <h2 className="text-sm font-semibold text-slate-900 pb-1 border-b border-slate-100 flex items-center gap-2">
              <Lock className="w-4 h-4 text-slate-400" /> Change Password
            </h2>

            {[
              { key: 'current', label: 'Current password',  placeholder: 'Your current password' },
              { key: 'next',    label: 'New password',       placeholder: 'At least 6 characters' },
              { key: 'confirm', label: 'Confirm new password', placeholder: 'Repeat new password' },
            ].map(({ key, label, placeholder }) => (
              <div key={key}>
                <label className="label">{label}</label>
                <div className="relative">
                  <input
                    type={showPw[key as keyof typeof showPw] ? 'text' : 'password'}
                    className="input pr-10"
                    placeholder={placeholder}
                    value={pwForm[key as keyof typeof pwForm]}
                    onChange={e => setPwForm(prev => ({ ...prev, [key]: e.target.value }))}
                    required
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    onClick={() => setShowPw(prev => ({ ...prev, [key]: !prev[key as keyof typeof showPw] }))}
                  >
                    {showPw[key as keyof typeof showPw] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            ))}

            {pwStatus === 'error' && (
              <div className="flex items-center gap-2 bg-red-50 border border-red-100 text-red-700 px-3 py-2 rounded-lg text-sm">
                <AlertCircle className="w-4 h-4 flex-shrink-0" /> {pwError}
              </div>
            )}
            {pwStatus === 'saved' && (
              <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-100 text-emerald-700 px-3 py-2 rounded-lg text-sm">
                <CheckCircle className="w-4 h-4 flex-shrink-0" /> Password updated successfully
              </div>
            )}

            <div className="flex justify-end pt-1">
              <button type="submit" className="btn-primary" disabled={pwStatus === 'saving'}>
                {pwStatus === 'saving' ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Updating…
                  </span>
                ) : 'Update Password'}
              </button>
            </div>
          </div>
        </form>

      </div>
    </Layout>
  );
}
