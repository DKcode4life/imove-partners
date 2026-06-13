import { useEffect, useState } from 'react';
import { Plus, X, TrendingUp } from 'lucide-react';
import api from '../lib/api';
import type { JobPnl, JobLedgerLine } from '../types';

function fmtMoney(n: number): string {
  return `£${(Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

// Inline money input that commits on blur. `placeholder` shows the suggestion in grey.
function MoneyField({
  value, placeholder, onCommit,
}: { value: number | ''; placeholder?: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value === '' ? '' : String(value));
  useEffect(() => { setText(value === '' ? '' : String(value)); }, [value]);
  return (
    <div className="relative">
      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-slate-400">£</span>
      <input
        type="text"
        inputMode="decimal"
        value={text}
        placeholder={placeholder}
        onChange={e => setText(e.target.value.replace(/[^0-9.]/g, ''))}
        onBlur={() => onCommit(text)}
        className="w-24 pl-5 pr-1 py-1 rounded border border-slate-200 text-xs text-right tabular-nums focus:outline-none focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400"
      />
    </div>
  );
}

export default function JobPnlPanel({ source, id }: { source: 'job' | 'event'; id: number }) {
  const [pnl, setPnl] = useState<JobPnl | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const r = await api.get<JobPnl>('/planner/pnl', { params: { source, id } });
      setPnl(r.data);
    } catch (err) {
      console.error('Failed to load P&L', err);
      setPnl(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [source, id]);

  async function saveIncome(v: string) {
    await api.put('/planner/pnl/income', { source, id, income: v === '' ? null : v });
    await load();
  }
  async function addLine(kind: 'income' | 'expense', label: string) {
    await api.post('/planner/pnl/line', { source, id, kind, label, amount: 0 });
    await load();
  }
  async function updateLine(lineId: number, patch: { label?: string; amount?: string }) {
    await api.patch(`/planner/pnl/line/${lineId}`, patch);
    await load();
  }
  async function deleteLine(lineId: number) {
    await api.delete(`/planner/pnl/line/${lineId}`);
    await load();
  }

  if (loading && !pnl) {
    return <div className="text-[11px] text-slate-400 py-2">Loading P&L…</div>;
  }
  if (!pnl) return null;

  // Diesel starter row: when there are no saved expense lines, show a single
  // editable Diesel row that only persists once the user gives it a value.
  const hasExpenses = pnl.expense_lines.length > 0;

  return (
    <div className="rounded-lg border border-slate-200/80 bg-white/70 p-2.5 space-y-2">
      <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-700 uppercase tracking-wider">
        <TrendingUp className="w-3 h-3 text-emerald-600" /> Profit &amp; Loss
      </div>

      {/* Income */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-slate-600">Income</span>
        <MoneyField
          value={pnl.income ?? ''}
          placeholder={pnl.income_suggestion ? String(pnl.income_suggestion) : '0'}
          onCommit={saveIncome}
        />
      </div>
      {pnl.income_lines.map(line => (
        <LineRow key={line.id} line={line} onUpdate={updateLine} onDelete={deleteLine} />
      ))}
      <button
        type="button"
        onClick={() => addLine('income', 'Extra income')}
        className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 hover:text-emerald-800"
      >
        <Plus className="w-3 h-3" /> Add income
      </button>

      {/* Wages (read-only) */}
      <div className="flex items-center justify-between border-t border-slate-100 pt-1.5">
        <span className="text-[11px] font-medium text-slate-600">Wages</span>
        <span className="text-xs font-semibold text-slate-700 tabular-nums pr-1">{fmtMoney(pnl.wages_total)}</span>
      </div>

      {/* Expenses */}
      <div className="border-t border-slate-100 pt-1.5 space-y-1.5">
        <span className="text-[11px] font-medium text-slate-600">Expenses</span>
        {!hasExpenses && <DieselStarter source={source} id={id} onAdded={load} />}
        {pnl.expense_lines.map(line => (
          <LineRow key={line.id} line={line} onUpdate={updateLine} onDelete={deleteLine} />
        ))}
        <button
          type="button"
          onClick={() => addLine('expense', 'Expense')}
          className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 hover:text-amber-800"
        >
          <Plus className="w-3 h-3" /> Add expense
        </button>
      </div>

      {/* Profit */}
      <div className="flex items-center justify-between border-t border-slate-200 pt-1.5">
        <span className="text-[11px] font-bold text-slate-700">Profit</span>
        <span className={`text-sm font-bold tabular-nums pr-1 ${pnl.profit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
          {fmtMoney(pnl.profit)}
        </span>
      </div>
    </div>
  );
}

// One editable income/expense line (label + amount + delete).
function LineRow({
  line, onUpdate, onDelete,
}: {
  line: JobLedgerLine;
  onUpdate: (id: number, patch: { label?: string; amount?: string }) => void;
  onDelete: (id: number) => void;
}) {
  const [label, setLabel] = useState(line.label);
  useEffect(() => { setLabel(line.label); }, [line.label]);
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="text"
        value={label}
        onChange={e => setLabel(e.target.value)}
        onBlur={() => { if (label !== line.label) onUpdate(line.id, { label }); }}
        className="flex-1 min-w-0 px-2 py-1 rounded border border-slate-200 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400"
      />
      <MoneyField value={line.amount} onCommit={v => onUpdate(line.id, { amount: v })} />
      <button
        type="button"
        onClick={() => onDelete(line.id)}
        title="Remove"
        className="p-1 text-slate-300 hover:text-red-500"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// Diesel starter: a blank Diesel row that only creates a real line when given a value.
function DieselStarter({ source, id, onAdded }: { source: 'job' | 'event'; id: number; onAdded: () => void }) {
  const [text, setText] = useState('');
  async function commit() {
    const amount = parseFloat(text);
    if (!Number.isFinite(amount) || amount <= 0) return; // nothing entered — don't persist
    await api.post('/planner/pnl/line', { source, id, kind: 'expense', label: 'Diesel', amount });
    setText('');
    await onAdded();
  }
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="text"
        value="Diesel"
        disabled
        className="flex-1 min-w-0 px-2 py-1 rounded border border-slate-200 bg-slate-50 text-xs text-slate-500"
      />
      <div className="relative">
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-slate-400">£</span>
        <input
          type="text"
          inputMode="decimal"
          value={text}
          placeholder="0"
          onChange={e => setText(e.target.value.replace(/[^0-9.]/g, ''))}
          onBlur={commit}
          className="w-24 pl-5 pr-1 py-1 rounded border border-slate-200 text-xs text-right tabular-nums focus:outline-none focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400"
        />
      </div>
      <span className="w-[26px]" />
    </div>
  );
}
