import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import Modal from './Modal';
import api from '../lib/api';
import type { Contract } from '../types';

interface ContractItem {
  id: number;
  name: string;
  unit_price: number;
  archived: boolean;
}

type AutoKind = 'porter' | 'van' | 'hgv';

interface JobItemDraft {
  contract_item_id: number | null;
  description: string;
  quantity: number;
  unit_price: number;
  auto_kind?: AutoKind | null; // transient — drives the top counters
}

interface ExistingJob {
  id: number;
  job_date: string;
  description: string | null;
  notes: string | null;
  men_needed: number;
  vans_needed: number;
  hgv_needed?: number;
  items: Array<{
    contract_item_id: number | null;
    description: string;
    quantity: number;
    unit_price: number;
  }>;
}

interface Props {
  contract: Contract;
  editJob?: ExistingJob | null;
  // Pre-select the job date when creating (e.g. the planner day the user
  // clicked before picking a contractor). Ignored in edit mode.
  defaultDate?: string;
  onClose: () => void;
  onSaved: () => void;
}

function todayISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

// Defaults used when the contractor has no matching price-list item yet.
const AUTO_DEFAULTS: Record<AutoKind, string> = {
  porter: 'Porter Daily Rate',
  van: 'iMove Van Used',
  hgv: 'HGV Driver Fee',
};

function matchItem(items: ContractItem[], kind: AutoKind): ContractItem | null {
  const lc = (s: string) => s.toLowerCase();
  if (kind === 'porter') {
    return items.find(i => lc(i.name).includes('porter')) || null;
  }
  if (kind === 'hgv') {
    return items.find(i => lc(i.name).includes('hgv')) || null;
  }
  // van — exclude anything HGV-named to avoid false matches
  return items.find(i => lc(i.name).includes('van') && !lc(i.name).includes('hgv')) || null;
}

/**
 * Detect which existing job-item lines came from the auto-counters so editing
 * an existing job keeps them in sync. Match by description keyword OR by the
 * resolved contract_item_id from the price list.
 */
function inferAutoKind(line: { description: string; contract_item_id: number | null }, items: ContractItem[]): AutoKind | null {
  const desc = (line.description || '').toLowerCase();
  const itemName = (items.find(i => i.id === line.contract_item_id)?.name || '').toLowerCase();
  const hay = `${desc} ${itemName}`;
  if (hay.includes('hgv')) return 'hgv';
  if (hay.includes('porter')) return 'porter';
  if (hay.includes('van')) return 'van';
  return null;
}

export default function CreateContractJobModal({ contract, editJob, defaultDate, onClose, onSaved }: Props) {
  const [items, setItems] = useState<ContractItem[]>([]);
  const [itemsLoaded, setItemsLoaded] = useState(false);
  const [jobDate, setJobDate] = useState(editJob?.job_date || defaultDate || todayISO());
  const [description, setDescription] = useState(editJob?.description || '');
  const [notes, setNotes] = useState(editJob?.notes || '');
  const [menNeeded, setMenNeeded] = useState<string>(String(editJob?.men_needed ?? ''));
  const [vansNeeded, setVansNeeded] = useState<string>(String(editJob?.vans_needed ?? ''));
  const [hgvNeeded, setHgvNeeded] = useState<string>(String(editJob?.hgv_needed ?? ''));
  const [lines, setLines] = useState<JobItemDraft[]>(
    editJob?.items?.length
      ? editJob.items.map(i => ({ ...i, auto_kind: null }))
      : []
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Load price list. Once loaded, retroactively tag existing edit-mode lines
  // with their auto_kind so the top counters reflect them and stay in sync.
  useEffect(() => {
    (async () => {
      try {
        const r = await api.get(`/contract-jobs/contractors/${contract.id}/items`);
        setItems(r.data);
        if (editJob?.items?.length) {
          setLines(prev => prev.map(l => ({ ...l, auto_kind: inferAutoKind(l, r.data) })));
        }
      } catch {
        // non-fatal
      } finally {
        setItemsLoaded(true);
      }
    })();
  }, [contract.id, editJob]);

  // Sync top counter → auto-line. Removes the line when qty hits 0; adds/updates
  // when qty > 0. Manual edits to non-auto lines are untouched.
  const syncAuto = (kind: AutoKind, qtyStr: string) => {
    const qty = parseInt(qtyStr, 10);
    setLines(prev => {
      const existingIdx = prev.findIndex(l => l.auto_kind === kind);
      const matched = matchItem(items, kind);
      const defaultDesc = AUTO_DEFAULTS[kind];

      if (!Number.isFinite(qty) || qty <= 0) {
        return existingIdx >= 0 ? prev.filter((_, i) => i !== existingIdx) : prev;
      }

      const fallbackPrice = existingIdx >= 0 ? prev[existingIdx].unit_price : 0;
      const newLine: JobItemDraft = {
        contract_item_id: matched?.id ?? null,
        description: existingIdx >= 0 && prev[existingIdx].description.trim()
          ? prev[existingIdx].description
          : (matched?.name || defaultDesc),
        quantity: qty,
        unit_price: matched?.unit_price ?? fallbackPrice,
        auto_kind: kind,
      };

      if (existingIdx >= 0) {
        const next = [...prev];
        next[existingIdx] = newLine;
        return next;
      }
      return [...prev, newLine];
    });
  };

  const onMenChange = (v: string) => { setMenNeeded(v); syncAuto('porter', v); };
  const onVansChange = (v: string) => { setVansNeeded(v); syncAuto('van', v); };
  const onHgvChange = (v: string) => { setHgvNeeded(v); syncAuto('hgv', v); };

  const subtotal = useMemo(
    () => lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0), 0),
    [lines],
  );

  const pickItem = (idx: number, contractItemId: string) => {
    const id = parseInt(contractItemId, 10);
    const it = items.find(x => x.id === id);
    setLines(prev => prev.map((l, i) =>
      i === idx
        ? it
          ? { ...l, contract_item_id: it.id, description: it.name, unit_price: it.unit_price }
          : { ...l, contract_item_id: null }
        : l,
    ));
  };

  const updateLine = (idx: number, patch: Partial<JobItemDraft>) => {
    setLines(prev => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };

  const removeLine = (idx: number) => {
    setLines(prev => {
      const removed = prev[idx];
      // If this is an auto line, also clear the corresponding top counter
      if (removed?.auto_kind === 'porter') setMenNeeded('');
      if (removed?.auto_kind === 'van') setVansNeeded('');
      if (removed?.auto_kind === 'hgv') setHgvNeeded('');
      return prev.filter((_, i) => i !== idx);
    });
  };

  const addLine = () => {
    setLines(prev => [...prev, { contract_item_id: null, description: '', quantity: 1, unit_price: 0, auto_kind: null }]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!jobDate) { setError('Job date is required'); return; }
    setSubmitting(true);
    setError('');

    const payload = {
      job_date: jobDate,
      description: description.trim() || null,
      notes: notes.trim() || null,
      men_needed: parseInt(menNeeded, 10) || 0,
      vans_needed: parseInt(vansNeeded, 10) || 0,
      hgv_needed: parseInt(hgvNeeded, 10) || 0,
      items: lines
        .filter(l => l.description.trim() || l.contract_item_id)
        .map(l => ({
          contract_item_id: l.contract_item_id,
          description: l.description.trim(),
          quantity: Number(l.quantity) || 1,
          unit_price: Number(l.unit_price) || 0,
        })),
    };

    try {
      if (editJob) {
        await api.put(`/contract-jobs/jobs/${editJob.id}`, payload);
      } else {
        await api.post(`/contract-jobs/contractors/${contract.id}/jobs`, payload);
      }
      onSaved();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save job');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={editJob ? `Edit Job — ${contract.company_name}` : `New Job — ${contract.company_name}`}
      size="xl"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div className="bg-red-50 border border-red-100 text-red-700 px-3 py-2 rounded-lg text-sm">{error}</div>
        )}

        {/* Date + crew/vans/hgv */}
        <div className="grid grid-cols-5 gap-3">
          <div className="col-span-2">
            <label className="block text-xs font-medium text-slate-500 mb-1">Job Date</label>
            <input
              type="date"
              value={jobDate}
              onChange={e => setJobDate(e.target.value)}
              className="input-field w-full"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Men</label>
            <input
              type="number" min="0"
              value={menNeeded}
              onChange={e => onMenChange(e.target.value)}
              placeholder="0"
              disabled={!itemsLoaded}
              className="input-field w-full"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Vans</label>
            <input
              type="number" min="0"
              value={vansNeeded}
              onChange={e => onVansChange(e.target.value)}
              placeholder="0"
              disabled={!itemsLoaded}
              className="input-field w-full"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">HGV</label>
            <input
              type="number" min="0"
              value={hgvNeeded}
              onChange={e => onHgvChange(e.target.value)}
              placeholder="0"
              disabled={!itemsLoaded}
              className="input-field w-full"
            />
          </div>
        </div>
        <p className="-mt-3 text-xs text-slate-400">
          Setting Men, Vans, or HGV adds a matching line below from this contractor's price list.
        </p>

        {/* Description */}
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Job Description</label>
          <input
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="e.g. Office move — Building 3 to Building 5"
            className="input-field w-full"
          />
        </div>

        {/* Items */}
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-2">Items</label>

          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">Item</th>
                  <th className="text-center px-3 py-2 font-semibold w-24">Qty</th>
                  <th className="text-right px-3 py-2 font-semibold w-36">Unit £</th>
                  <th className="text-right px-3 py-2 font-semibold w-36">Total</th>
                  <th className="text-center px-3 py-2 font-semibold w-16"></th>
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-sm text-slate-400">
                      No line items. Add one below, or set Men/Vans/HGV above to auto-create.
                    </td>
                  </tr>
                ) : lines.map((line, idx) => {
                  const total = (Number(line.quantity) || 0) * (Number(line.unit_price) || 0);
                  return (
                    <tr key={idx} className={idx > 0 ? 'border-t border-slate-100' : ''}>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          {line.auto_kind && (
                            <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 flex-shrink-0">
                              {line.auto_kind === 'porter' ? 'Men' : line.auto_kind === 'van' ? 'Van' : 'HGV'}
                            </span>
                          )}
                          <select
                            value={line.contract_item_id ?? ''}
                            onChange={e => pickItem(idx, e.target.value)}
                            className="input-field text-sm py-1 w-48 flex-shrink-0"
                          >
                            <option value="">— ad-hoc —</option>
                            {items.map(it => (
                              <option key={it.id} value={it.id}>{it.name} (£{it.unit_price.toFixed(2)})</option>
                            ))}
                          </select>
                          <input
                            value={line.description}
                            onChange={e => updateLine(idx, { description: e.target.value })}
                            placeholder="Description"
                            className="input-field text-sm py-1 flex-1"
                          />
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number" step="any" min="0"
                          value={line.quantity}
                          onChange={e => {
                            const q = parseFloat(e.target.value) || 0;
                            updateLine(idx, { quantity: q });
                            // Keep top counter in sync when an auto-line qty is edited inline
                            if (line.auto_kind === 'porter') setMenNeeded(String(q));
                            if (line.auto_kind === 'van') setVansNeeded(String(q));
                            if (line.auto_kind === 'hgv') setHgvNeeded(String(q));
                          }}
                          className="input-field text-sm py-1 w-full text-center"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number" step="0.01" min="0"
                          value={line.unit_price}
                          onChange={e => updateLine(idx, { unit_price: parseFloat(e.target.value) || 0 })}
                          className="input-field text-sm py-1 w-full text-right tabular-nums"
                        />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700 font-medium">
                        £{total.toFixed(2)}
                      </td>
                      <td className="px-2 py-2 text-center">
                        <button
                          type="button"
                          onClick={() => removeLine(idx)}
                          title="Remove this line"
                          aria-label="Remove this line"
                          className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-slate-200 text-slate-400 hover:border-red-200 hover:text-red-600 hover:bg-red-50 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                <tr className="border-t border-slate-200 bg-slate-50/60">
                  <td colSpan={3} className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Subtotal</td>
                  <td className="px-3 py-2 text-right font-bold text-slate-900 tabular-nums">£{subtotal.toFixed(2)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>

          {/* Add line — bottom-left, below the table */}
          <button
            type="button"
            onClick={addLine}
            className="mt-2 text-sm font-medium text-blue-600 hover:text-blue-700 flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            Add line
          </button>
        </div>

        {/* Notes */}
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Notes</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            placeholder="Anything the planner / dispatcher should know"
            className="input-field w-full resize-none"
          />
        </div>

        <div className="flex gap-3 justify-end pt-1">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={submitting} className="btn-primary">
            {submitting ? 'Saving…' : editJob ? 'Save Changes' : 'Create Job'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
