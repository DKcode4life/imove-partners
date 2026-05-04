import { useState, useEffect, useCallback } from 'react';
import { Pencil, RefreshCw, Plus, Minus, X } from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ItemEntry { count: number; note: string; photo?: string }
type RoomRecord = Record<string, ItemEntry>;
type SurveyData = Record<string, RoomRecord>;

export interface CoverItem {
  id: string;
  label: string;
  qty: number;
}

// ─── All available cover types (for the "add" picker) ────────────────────────

const COVER_TYPES: { id: string; label: string }[] = [
  { id: 'sofa-2',          label: 'Sofa 2-Seater Cover' },
  { id: 'sofa-3',          label: 'Sofa 3-Seater Cover' },
  { id: 'sofa-4',          label: 'Sofa 4-Seater Cover' },
  { id: 'corner-sofa-3',   label: 'Corner Sofa 3-Seater Cover' },
  { id: 'corner-sofa-4',   label: 'Corner Sofa 4-Seater Cover' },
  { id: 'sofa-bed',        label: 'Sofa Bed Cover' },
  { id: 'armchair',        label: 'Armchair Cover' },
  { id: 'mattress-single', label: 'Single Mattress Bag' },
  { id: 'mattress-double', label: 'Double Mattress Bag' },
  { id: 'table',           label: 'Dining Table Cover' },
  { id: 'dining-chair',    label: 'Dining Chair Bag (2 per bag)' },
  { id: 'office-chair',    label: 'Office Chair Cover' },
  { id: 'washing-machine', label: 'Washing Machine Cover' },
  { id: 'dryer',           label: 'Dryer Cover' },
  { id: 'fridge',          label: 'Fridge Freezer Cover' },
  { id: 'fridge-american', label: 'American Fridge Freezer Cover' },
  { id: 'tv',              label: 'TV Cover' },
  { id: 'picture-large',   label: 'Picture Bag (Large, 4 per bag)' },
  { id: 'picture-small',   label: 'Picture Bag (Small/Medium, 8 per bag)' },
];

// ─── Survey data helpers ──────────────────────────────────────────────────────

function parseSurveyRaw(raw: string): SurveyData {
  try {
    const obj = JSON.parse(raw) as Record<string, Record<string, number | ItemEntry>>;
    const out: SurveyData = {};
    for (const [room, items] of Object.entries(obj)) {
      out[room] = {};
      for (const [item, val] of Object.entries(items)) {
        out[room][item] = typeof val === 'number' ? { count: val, note: '' } : val;
      }
    }
    return out;
  } catch { return {}; }
}

function mergeData(a: SurveyData, b: SurveyData): SurveyData {
  const out: SurveyData = {};
  for (const [room, items] of Object.entries(a)) {
    out[room] = { ...items };
  }
  for (const [room, items] of Object.entries(b)) {
    if (!out[room]) out[room] = {};
    for (const [item, entry] of Object.entries(items)) {
      if (out[room][item]) {
        out[room][item] = { ...out[room][item], count: out[room][item].count + entry.count };
      } else {
        out[room][item] = { ...entry };
      }
    }
  }
  return out;
}

function loadAllSurveyData(jobId: string): SurveyData {
  const main   = parseSurveyRaw(localStorage.getItem(`crm-survey-${jobId}`)        ?? '{}');
  const search = parseSurveyRaw(localStorage.getItem(`crm-survey-search-${jobId}`) ?? '{}');
  return mergeData(main, search);
}

function countItems(data: SurveyData, ...names: string[]): number {
  return Object.values(data).reduce(
    (total, room) => total + names.reduce((s, n) => s + (room[n]?.count ?? 0), 0),
    0,
  );
}

// ─── Cover calculation ────────────────────────────────────────────────────────

function calculateCovers(jobId: string): CoverItem[] {
  const data = loadAllSurveyData(jobId);
  const out: CoverItem[] = [];

  const add = (id: string, label: string, qty: number) => {
    if (qty > 0) out.push({ id, label, qty });
  };

  // Sofas
  add('sofa-2',        'Sofa 2-Seater Cover',        countItems(data, 'Sofa 2 seater'));
  add('sofa-3',        'Sofa 3-Seater Cover',        countItems(data, 'Sofa 3 seater'));
  add('sofa-4',        'Sofa 4-Seater Cover',        countItems(data, 'Sofa 4 seater'));
  add('sofa-bed',      'Sofa Bed Cover',             countItems(data, 'Sofa bed'));
  add('corner-sofa-3', 'Corner Sofa 3-Seater Cover', countItems(data, 'Corner sofa 3 seater'));
  add('corner-sofa-4', 'Corner Sofa 4-Seater Cover', countItems(data, 'Corner sofa 4 seater'));

  // Armchairs — any size → 1 cover each
  add('armchair', 'Armchair Cover',
    countItems(data, 'Armchair large', 'Armchair medium', 'Armchair recliner', 'Armchair small'),
  );

  // Mattress bags — single vs double/king
  add('mattress-single', 'Single Mattress Bag',
    countItems(data,
      'Single mattress',
      'Divan bed single and mattress',
      'Frame single and mattress',
    ),
  );
  add('mattress-double', 'Double Mattress Bag',
    countItems(data,
      'Double mattress',
      'King size mattress',
      'Divan bed double and mattress',
      'Divan bed king and mattress',
      'Divan bed super-king and mattress',
      'Frame double and mattress',
      'Frame king and mattress',
      'Frame super king and mattress',
    ),
  );

  // Dining table
  add('table', 'Dining Table Cover',
    countItems(data, 'Dining table large', 'Dining table medium', 'Dining table small'),
  );

  // Dining chairs — 2 per bag
  const diningChairs = countItems(data, 'Dining chairs');
  add('dining-chair', 'Dining Chair Bag (2 per bag)', Math.ceil(diningChairs / 2));

  // Office chairs — 1 per bag
  add('office-chair', 'Office Chair Cover',
    countItems(data, 'Office chair', 'Desk chairs'),
  );

  // Appliances
  add('washing-machine', 'Washing Machine Cover',         countItems(data, 'Washing machine'));
  add('dryer',           'Dryer Cover',                   countItems(data, 'Tumble dryer'));
  add('fridge',          'Fridge Freezer Cover',          countItems(data, 'Fridge freezer'));
  add('fridge-american', 'American Fridge Freezer Cover', countItems(data, 'Fridge freezer American'));

  // TVs
  add('tv', 'TV Cover', countItems(data, 'TV 32in', 'TV 43in', 'TV 52in', 'TV 60in+'));

  // Pictures / mirrors
  // Large: 4 per bag; small/medium: 8 per bag
  const largePics  = countItems(data, 'Picture/mirror large');
  const smMedPics  = countItems(data, 'Picture/mirror medium', 'Picture/mirror small');
  add('picture-large', 'Picture Bag (Large, 4 per bag)',        Math.ceil(largePics / 4));
  add('picture-small', 'Picture Bag (Small/Medium, 8 per bag)', Math.ceil(smMedPics / 8));

  return out;
}

// ─── Persistence ──────────────────────────────────────────────────────────────

const coversKey = (jobId: string) => `crm-covers-${jobId}`;

function loadSavedCovers(jobId: string): CoverItem[] | null {
  try {
    const raw = localStorage.getItem(coversKey(jobId));
    return raw ? (JSON.parse(raw) as CoverItem[]) : null;
  } catch { return null; }
}

function persistCovers(jobId: string, items: CoverItem[]) {
  localStorage.setItem(coversKey(jobId), JSON.stringify(items));
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function FurnitureCovers({ jobId }: { jobId: string | undefined }) {
  const [items,    setItems]    = useState<CoverItem[]>([]);
  const [isCustom, setIsCustom] = useState(false);
  const [editing,  setEditing]  = useState(false);
  const [draft,    setDraft]    = useState<CoverItem[]>([]);
  const [addSel,   setAddSel]   = useState('');

  useEffect(() => {
    if (!jobId) return;
    const saved = loadSavedCovers(jobId);
    if (saved) {
      setItems(saved);
      setIsCustom(true);
    } else {
      setItems(calculateCovers(jobId));
    }
  }, [jobId]);

  const recalculate = useCallback(() => {
    if (!jobId) return;
    localStorage.removeItem(coversKey(jobId));
    setItems(calculateCovers(jobId));
    setIsCustom(false);
  }, [jobId]);

  const startEdit = () => {
    setDraft(items.map(i => ({ ...i })));
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setDraft([]);
    setAddSel('');
  };

  const confirmEdit = () => {
    const final = draft.filter(i => i.qty > 0);
    setItems(final);
    setIsCustom(true);
    if (jobId) persistCovers(jobId, final);
    setEditing(false);
    setDraft([]);
    setAddSel('');
  };

  const adjustQty = (id: string, delta: number) => {
    setDraft(prev => prev.map(i =>
      i.id === id ? { ...i, qty: Math.max(0, i.qty + delta) } : i,
    ));
  };

  const removeItem = (id: string) => {
    setDraft(prev => prev.filter(i => i.id !== id));
  };

  const addType = (typeId: string) => {
    if (!typeId) return;
    const type = COVER_TYPES.find(t => t.id === typeId);
    if (!type) return;
    setDraft(prev => {
      const existing = prev.find(i => i.id === typeId);
      if (existing) return prev.map(i => i.id === typeId ? { ...i, qty: i.qty + 1 } : i);
      return [...prev, { id: type.id, label: type.label, qty: 1 }];
    });
    setAddSel('');
  };

  const display = editing ? draft : items;
  const total   = display.reduce((s, i) => s + i.qty, 0);

  return (
    <div className="card p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          <span className="w-1.5 h-4 rounded-full flex-shrink-0 bg-amber-400" />
          Furniture Covers
        </h2>
        <div className="flex items-center gap-2">
          {!editing ? (
            <>
              <button
                type="button"
                onClick={recalculate}
                title={isCustom ? 'Reset to auto-calculated' : 'Recalculate from survey'}
                className="flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-teal-600 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                {isCustom ? 'Reset' : 'Recalculate'}
              </button>
              <button
                type="button"
                onClick={startEdit}
                className="flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-brand-600 transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" /> Edit
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={cancelEdit} className="btn-secondary text-xs py-1 px-2.5">
                Cancel
              </button>
              <button type="button" onClick={confirmEdit} className="btn-primary text-xs py-1 px-2.5">
                Done
              </button>
            </>
          )}
        </div>
      </div>

      {/* Source indicator */}
      {!editing && (
        <p className="text-xs text-slate-400 mb-3 flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full inline-block flex-shrink-0 ${isCustom ? 'bg-amber-400' : 'bg-teal-400'}`} />
          {isCustom
            ? 'Manually edited · click Reset to re-scan survey'
            : 'Auto-calculated from survey'}
        </p>
      )}

      {/* Cover list */}
      {display.length === 0 ? (
        <p className="text-sm text-slate-400 italic">
          {editing
            ? 'No covers added yet.'
            : 'No furniture covers required based on the current survey.'}
        </p>
      ) : (
        <div className="space-y-1.5">
          {display.map(item => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-3 py-1.5 px-2.5 rounded-lg bg-slate-50 border border-slate-100"
            >
              <span className="text-sm text-slate-700 flex-1 min-w-0">{item.label}</span>

              {!editing ? (
                <span className="text-sm font-semibold text-slate-900 bg-white border border-slate-200 rounded px-2.5 py-0.5 min-w-[2.25rem] text-center flex-shrink-0">
                  ×{item.qty}
                </span>
              ) : (
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => adjustQty(item.id, -1)}
                    className="w-6 h-6 flex items-center justify-center rounded border border-slate-200 bg-white text-slate-500 hover:bg-slate-100 transition-colors"
                  >
                    <Minus className="w-3 h-3" />
                  </button>
                  <span className="text-sm font-semibold text-slate-900 w-7 text-center select-none">
                    {item.qty}
                  </span>
                  <button
                    type="button"
                    onClick={() => adjustQty(item.id, 1)}
                    className="w-6 h-6 flex items-center justify-center rounded border border-slate-200 bg-white text-slate-500 hover:bg-slate-100 transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeItem(item.id)}
                    className="w-6 h-6 flex items-center justify-center rounded text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors ml-1"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Total (view mode) */}
      {!editing && total > 0 && (
        <p className="text-xs text-slate-400 mt-3 text-right">
          Total:{' '}
          <span className="font-semibold text-slate-600">{total}</span>{' '}
          {total === 1 ? 'cover / bag' : 'covers / bags'}
        </p>
      )}

      {/* Add cover (edit mode) */}
      {editing && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <select
            value={addSel}
            onChange={e => addType(e.target.value)}
            className="input text-sm w-full"
          >
            <option value="">+ Add a cover type…</option>
            {COVER_TYPES.map(t => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
