import { useState, useEffect, useCallback } from 'react';
import { X, ClipboardList, Minus, Plus } from 'lucide-react';

// ── Room catalogue ─────────────────────────────────────────────────────────────

const ROOMS: { name: string; items: string[] }[] = [
  {
    name: 'Living Room',
    items: ['Sofa', 'Coffee Table', 'TV Unit', 'Armchair', 'Bookcase'],
  },
  {
    name: 'Bedroom 1',
    items: ['King Bed', 'Wardrobe', 'Bedside Table', 'Chest of Drawers', 'Dressing Table'],
  },
  {
    name: 'Bedroom 2',
    items: ['Double Bed', 'Wardrobe', 'Bedside Table', 'Chest of Drawers', 'Desk'],
  },
  {
    name: 'Bedroom 3',
    items: ['Single Bed', 'Wardrobe', 'Bedside Table', 'Chest of Drawers', 'Desk'],
  },
  {
    name: 'Kitchen',
    items: ['Fridge Freezer', 'Washing Machine', 'Dishwasher', 'Microwave', 'Kitchen Table'],
  },
  {
    name: 'Study',
    items: ['Desk', 'Office Chair', 'Bookcase', 'Filing Cabinet', 'Computer Monitor'],
  },
  {
    name: 'Dining Room',
    items: ['Dining Table', 'Dining Chairs', 'Sideboard', 'Display Cabinet', 'Bar Stool'],
  },
  {
    name: 'Utility Room',
    items: ['Washing Machine', 'Tumble Dryer', 'Storage Shelves', 'Ironing Board', 'Chest Freezer'],
  },
  {
    name: 'Garage',
    items: ['Workbench', 'Tool Cabinet', 'Shelving Unit', 'Lawnmower', 'Bicycle'],
  },
  {
    name: 'Garden',
    items: ['Garden Table', 'Garden Chairs', 'BBQ', 'Garden Shed', 'Parasol'],
  },
];

// ── Types & storage ────────────────────────────────────────────────────────────

type SurveyData = Record<string, Record<string, number>>;

function storageKey(jobId: string | undefined) {
  return `crm-survey-${jobId}`;
}

function loadData(jobId: string | undefined): SurveyData {
  if (!jobId) return {};
  try {
    return JSON.parse(localStorage.getItem(storageKey(jobId)) || '{}');
  } catch {
    return {};
  }
}

// ── Item row ───────────────────────────────────────────────────────────────────

function ItemRow({
  item, count,
  onIncrement, onDecrement, onSetCount,
}: {
  item: string; count: number;
  onIncrement: () => void;
  onDecrement: () => void;
  onSetCount: (n: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState('');

  const startEdit = () => { setRaw(String(count)); setEditing(true); };
  const commit = () => {
    const n = parseInt(raw, 10);
    onSetCount(isNaN(n) ? 0 : Math.max(0, n));
    setEditing(false);
  };

  const active = count > 0;

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all ${
        active
          ? 'bg-white border-teal-200 shadow-sm ring-1 ring-teal-50'
          : 'bg-white border-slate-200'
      }`}
    >
      {/* Name — click increments */}
      <button
        onClick={onIncrement}
        className={`flex-1 text-left text-sm font-medium transition-colors ${
          active ? 'text-teal-800' : 'text-slate-600 hover:text-teal-600'
        }`}
        title="Click to add one"
      >
        {item}
      </button>

      {/* Controls */}
      <div className="flex items-center gap-0.5 flex-shrink-0">
        {/* − */}
        <button
          onClick={onDecrement}
          disabled={count === 0}
          className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all active:scale-90 ${
            count > 0
              ? 'text-slate-400 hover:bg-red-50 hover:text-red-500'
              : 'text-slate-200 cursor-not-allowed'
          }`}
        >
          <Minus className="w-3.5 h-3.5" />
        </button>

        {/* Count (editable) */}
        {editing ? (
          <input
            type="number"
            min="0"
            autoFocus
            className="w-12 text-center text-sm font-bold border border-teal-400 rounded-lg py-0.5 outline-none ring-2 ring-teal-100"
            value={raw}
            onChange={e => setRaw(e.target.value)}
            onBlur={commit}
            onKeyDown={e => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') setEditing(false);
            }}
          />
        ) : (
          <button
            onClick={startEdit}
            title="Click to edit count"
            className={`w-12 text-center text-sm font-bold rounded-lg py-0.5 tabular-nums transition-colors ${
              active
                ? 'text-teal-700 hover:bg-teal-50'
                : 'text-slate-300 hover:bg-slate-50 hover:text-slate-500'
            }`}
          >
            {count}
          </button>
        )}

        {/* + */}
        <button
          onClick={onIncrement}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-teal-600 hover:bg-teal-50 transition-all active:scale-90"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function SurveyTool({ jobId }: { jobId: string | undefined }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<SurveyData>(() => loadData(jobId));
  const [selectedRoom, setSelectedRoom] = useState(ROOMS[0].name);

  useEffect(() => { setData(loadData(jobId)); }, [jobId]);

  // Lock body scroll while open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  // ESC to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  const persist = useCallback((next: SurveyData) => {
    setData(next);
    if (jobId) localStorage.setItem(storageKey(jobId), JSON.stringify(next));
  }, [jobId]);

  const increment = (room: string, item: string) => {
    const next = JSON.parse(JSON.stringify(data)) as SurveyData;
    if (!next[room]) next[room] = {};
    next[room][item] = (next[room][item] || 0) + 1;
    persist(next);
  };

  const decrement = (room: string, item: string) => {
    const next = JSON.parse(JSON.stringify(data)) as SurveyData;
    const cur = next[room]?.[item] || 0;
    if (cur <= 0) return;
    if (cur === 1) {
      delete next[room][item];
      if (!Object.keys(next[room]).length) delete next[room];
    } else {
      next[room][item] = cur - 1;
    }
    persist(next);
  };

  const setItemCount = (room: string, item: string, n: number) => {
    const next = JSON.parse(JSON.stringify(data)) as SurveyData;
    if (n <= 0) {
      if (next[room]) {
        delete next[room][item];
        if (!Object.keys(next[room]).length) delete next[room];
      }
    } else {
      if (!next[room]) next[room] = {};
      next[room][item] = n;
    }
    persist(next);
  };

  // ── Derived stats ────────────────────────────────────────────────────────────

  const roomTotal = (room: string) =>
    Object.values(data[room] || {}).reduce((s, c) => s + c, 0);

  const grandTotal = Object.values(data).reduce(
    (s, r) => s + Object.values(r).reduce((ss, c) => ss + c, 0),
    0,
  );
  const roomsWithItems = Object.values(data).filter(r => Object.keys(r).length > 0).length;

  const currentRoom = ROOMS.find(r => r.name === selectedRoom)!;
  const roomData = data[selectedRoom] || {};

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Card summary ─────────────────────────────────────────────────────── */}
      <div className="space-y-3">
        {grandTotal > 0 ? (
          <div className="flex items-center gap-2 bg-gradient-to-r from-teal-50 to-teal-100/50 rounded-xl px-3 py-2.5 border border-teal-100">
            <ClipboardList className="w-4 h-4 text-teal-600 flex-shrink-0" />
            <div>
              <p className="text-xs font-bold text-teal-800 tabular-nums">
                {grandTotal} item{grandTotal !== 1 ? 's' : ''}
              </p>
              <p className="text-[11px] text-teal-600">
                {roomsWithItems} room{roomsWithItems !== 1 ? 's' : ''} surveyed
              </p>
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-400 italic">No inventory recorded yet.</p>
        )}

        <button
          onClick={() => setOpen(true)}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-dashed border-teal-200 text-teal-600 text-sm font-semibold hover:border-teal-400 hover:bg-teal-50 transition-all active:scale-[0.98]"
        >
          <ClipboardList className="w-4 h-4" />
          Open Survey Tool
        </button>
      </div>

      {/* ── Full-screen overlay ───────────────────────────────────────────────── */}
      {open && (
        <div
          className="fixed inset-0 z-[200] flex flex-col bg-slate-50"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-slate-200 shadow-sm flex-shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-teal-500 to-teal-600 flex items-center justify-center shadow-sm flex-shrink-0">
                <ClipboardList className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900 tracking-tight">Survey Inventory</h2>
                <p className="text-xs text-slate-500">
                  {grandTotal > 0
                    ? `${grandTotal} item${grandTotal !== 1 ? 's' : ''} across ${roomsWithItems} room${roomsWithItems !== 1 ? 's' : ''}`
                    : 'Click items to add them · click the count to edit'}
                </p>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="p-2 rounded-xl hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors"
              title="Close (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex flex-1 min-h-0">
            {/* ── Room sidebar ─────────────────────────────────────────────── */}
            <div className="w-56 bg-white border-r border-slate-200 flex-shrink-0 overflow-y-auto py-3 px-2">
              {ROOMS.map(r => {
                const tot = roomTotal(r.name);
                const isActive = r.name === selectedRoom;
                return (
                  <button
                    key={r.name}
                    onClick={() => setSelectedRoom(r.name)}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium transition-all mb-1 ${
                      isActive
                        ? 'bg-teal-50 text-teal-800 shadow-sm ring-1 ring-teal-100'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-800'
                    }`}
                  >
                    <span>{r.name}</span>
                    {tot > 0 && (
                      <span
                        className={`text-xs font-bold px-2 py-0.5 rounded-full tabular-nums ${
                          isActive
                            ? 'bg-teal-600 text-white'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {tot}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* ── Items area ───────────────────────────────────────────────── */}
            <div className="flex-1 overflow-y-auto p-6">
              <div className="max-w-2xl mx-auto">
                {/* Room heading */}
                <div className="flex items-center gap-3 mb-5">
                  <h3 className="text-lg font-bold text-slate-900 tracking-tight">
                    {currentRoom.name}
                  </h3>
                  {roomTotal(selectedRoom) > 0 && (
                    <span className="px-2.5 py-0.5 rounded-full bg-teal-100 text-teal-700 text-xs font-bold tabular-nums">
                      {roomTotal(selectedRoom)} item{roomTotal(selectedRoom) !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>

                <div className="space-y-2">
                  {currentRoom.items.map(item => (
                    <ItemRow
                      key={item}
                      item={item}
                      count={roomData[item] || 0}
                      onIncrement={() => increment(selectedRoom, item)}
                      onDecrement={() => decrement(selectedRoom, item)}
                      onSetCount={n => setItemCount(selectedRoom, item, n)}
                    />
                  ))}
                </div>

                <p className="text-xs text-slate-400 mt-6 text-center">
                  Click an item name or + to add · click the count to type a number · − to remove one
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
