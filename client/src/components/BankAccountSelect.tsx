import { useEffect, useState } from 'react';
import api from '../lib/api';

export type BankAccountOption = {
  id: number;
  label: string;
  account_name: string;
  sort_code: string;
  account_number: string;
  is_default: boolean;
};

type Props = {
  value: number | null;
  onChange: (id: number | null) => void;
  disabled?: boolean;
  className?: string;
  /** Show "(default)" suffix when no value is selected, signalling fallback. */
  showDefaultHint?: boolean;
};

/**
 * Dropdown for picking a bank account on an invoice. Loads bank accounts from
 * /api/settings/bank-accounts. If none exist, renders a disabled informational
 * select pointing the user to Settings.
 */
export default function BankAccountSelect({ value, onChange, disabled, className, showDefaultHint = true }: Props) {
  const [accounts, setAccounts] = useState<BankAccountOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.get<BankAccountOption[]>('/settings/bank-accounts')
      .then(r => { if (!cancelled) setAccounts(r.data); })
      .catch(() => { if (!cancelled) setAccounts([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return <div className={`text-xs text-slate-400 ${className ?? ''}`}>Loading bank accounts…</div>;
  }

  if (accounts.length === 0) {
    return (
      <div className={`text-xs text-slate-400 ${className ?? ''}`}>
        No bank accounts configured. Add one in Settings → Company Details.
      </div>
    );
  }

  return (
    <select
      value={value ?? ''}
      onChange={e => onChange(e.target.value === '' ? null : parseInt(e.target.value, 10))}
      disabled={disabled}
      className={`input-field ${className ?? ''}`}
    >
      {showDefaultHint && (
        <option value="">
          {(() => {
            const def = accounts.find(a => a.is_default);
            return def ? `Default — ${def.label}` : 'Use default';
          })()}
        </option>
      )}
      {accounts.map(a => (
        <option key={a.id} value={a.id}>
          {a.label}{a.is_default ? ' (default)' : ''}
        </option>
      ))}
    </select>
  );
}
