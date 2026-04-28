import { useState, useEffect, useCallback, useRef } from 'react';
import { X, ClipboardList, Minus, Plus, MessageSquare } from 'lucide-react';

// ── Room catalogue ─────────────────────────────────────────────────────────────

type RoomItem = { name: string; icon: string };
type Room     = { name: string; items: RoomItem[] };

const ROOMS: Room[] = [
  {
    name: 'Living Room',
    items: [
      { name: 'Sofa',         icon: '🛋️' },
      { name: 'Coffee Table', icon: '🍵' },
      { name: 'TV Unit',      icon: '📺' },
      { name: 'Armchair',     icon: '🪑' },
      { name: 'Bookcase',     icon: '📚' },
    ],
  },
  {
    name: 'Bedroom 1',
    items: [
      { name: 'King Bed',         icon: '🛏️' },
      { name: 'Wardrobe',         icon: '🚪' },
      { name: 'Bedside Table',    icon: '💡' },
      { name: 'Chest of Drawers', icon: '🗄️' },
      { name: 'Dressing Table',   icon: '🪞' },
    ],
  },
  {
    name: 'Bedroom 2',
    items: [
      { name: 'Double Bed',       icon: '🛏️' },
      { name: 'Wardrobe',         icon: '🚪' },
      { name: 'Bedside Table',    icon: '💡' },
      { name: 'Chest of Drawers', icon: '🗄️' },
      { name: 'Desk',             icon: '✏️' },
    ],
  },
  {
    name: 'Bedroom 3',
    items: [
      { name: 'Single Bed',       icon: '🛏️' },
      { name: 'Wardrobe',         icon: '🚪' },
      { name: 'Bedside Table',    icon: '💡' },
      { name: 'Chest of Drawers', icon: '🗄️' },
      { name: 'Desk',             icon: '✏️' },
    ],
  },
  {
    name: 'Kitchen',
    items: [
      { name: 'Fridge Freezer',  icon: '🧊' },
      { name: 'Washing Machine', icon: '🫧' },
      { name: 'Dishwasher',      icon: '🍽️' },
      { name: 'Microwave',       icon: '📡' },
      { name: 'Kitchen Table',   icon: '🍴' },
    ],
  },
  {
    name: 'Study',
    items: [
      { name: 'Desk',             icon: '🖥️' },
      { name: 'Office Chair',     icon: '🪑' },
      { name: 'Bookcase',         icon: '📚' },
      { name: 'Filing Cabinet',   icon: '🗃️' },
      { name: 'Computer Monitor', icon: '💻' },
    ],
  },
  {
    name: 'Dining Room',
    items: [
      { name: 'Dining Table',    icon: '🍽️' },
      { name: 'Dining Chairs',   icon: '🪑' },
      { name: 'Sideboard',       icon: '🗄️' },
      { name: 'Display Cabinet', icon: '🪟' },
      { name: 'Bar Stool',       icon: '🍺' },
    ],
  },
  {
    name: 'Utility Room',
    items: [
      { name: 'Washing Machine', icon: '🌊' },
      { name: 'Tumble Dryer',    icon: '🌀' },
      { name: 'Storage Shelves', icon: '📦' },
      { name: 'Ironing Board',   icon: '👕' },
      { name: 'Chest Freezer',   icon: '🧊' },
    ],
  },
  {
    name: 'Garage',
    items: [
      { name: 'Workbench',     icon: '🔨' },
      { name: 'Tool Cabinet',  icon: '🔧' },
      { name: 'Shelving Unit', icon: '📦' },
      { name: 'Lawnmower',     icon: '🌱' },
      { name: 'Bicycle',       icon: '🚲' },
    ],
  },
  {
    name: 'Garden',
    items: [
      { name: 'Garden Table',  icon: '🪴' },
      { name: 'Garden Chairs', icon: '🪑' },
      { name: 'BBQ',           icon: '🔥' },
      { name: 'Garden Shed',   icon: '🏠' },
      { name: 'Parasol',       icon: '☂️' },
    ],
  },
];

// ── Data types & storage ───────────────────────────────────────────────────────

type ItemEntry  = { count: number; note: string };
type RoomRecord = Record<string, ItemEntry>;
type SurveyData = Record<string, RoomRecord>;

const storageKey = (jobId: string | undefined) => `crm-survey-${jobId}`;

function loadData(jobId: string | undefined): SurveyData {
  if (!jobId) return {};
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey(jobId)) || '{}') as
      Record<string, Record<string, number | ItemEntry>>;
    // Migrate old format where values were plain numbers
    const out: SurveyData = {};
    for (const [room, items] of Object.entries(raw)) {
      out[room] = {};
      for (const [item, val] of Object.entries(items)) {
        out[room][item] = typeof val === 'number'
          ? { count: val, note: '' }
          : val;
      }
    }
    return out;
  } catch {
    return {};
  }
}

// ── Note modal ─────────────────────────────────────────────────────────────────

function NoteModal({ itemName, itemIcon, currentNote, onSave, onClose }: {
  itemName: string;
  itemIcon: string;
  currentNote: string;
  onSave: (note: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(currentNote);

  return (
    // Backdrop — click outside to cancel
    <div
      className="absolute inset-0 z-[10] flex items-center justify-center bg-black/30 backdrop-blur-sm p-6"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 pt-5 pb-3">
          <span className="text-2xl leading-none">{itemIcon}</span>
          <div className="flex-1">
            <h3 className="text-sm font-bold text-slate-900">{itemName}</h3>
            <p className="text-xs text-slate-400">Add a note for this item</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Textarea */}
        <div className="px-5 pb-4">
          <textarea
            autoFocus
            rows={4}
            placeholder="e.g. Needs disassembly · fragile · customer to pack separately…"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 resize-none outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100 transition"
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                onSave(text.trim());
                onClose();
              }
            }}
          />
          <p className="text-[11px] text-slate-400 mt-1.5">⌘ Enter to save</p>
        </div>

        {/* Actions */}
        <div className="flex gap-2 px-5 pb-5">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => { onSave(text.trim()); onClose(); }}
            className="flex-1 py-2 rounded-xl bg-teal-600 text-sm font-semibold text-white hover:bg-teal-700 transition-colors active:scale-[0.98]"
          >
            Save Note
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Item square card ───────────────────────────────────────────────────────────

const LONG_PRESS_MS = 500;

function ItemSquare({ name, icon, count, note, onIncrement, onDecrement, onSetCount, onOpenNote }: {
  name: string; icon: string; count: number; note: string;
  onIncrement: () => void;
  onDecrement: () => void;
  onSetCount: (n: number) => void;
  onOpenNote: () => void;
}) {
  const [editingCount, setEditingCount] = useState(false);
  const [raw,          setRaw]          = useState('');

  const timerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressState  = useRef<'pending' | 'fired' | 'idle'>('idle');

  const active  = count > 0;
  const hasNote = note.trim().length > 0;

  // ── Long-press handlers ────────────────────────────────────────────────────
  const handlePointerDown = (e: React.PointerEvent) => {
    // Only respond to primary button / finger
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pressState.current = 'pending';
    timerRef.current = setTimeout(() => {
      pressState.current = 'fired';
      if (navigator.vibrate) navigator.vibrate(25);
      onOpenNote();
    }, LONG_PRESS_MS);
  };

  const handlePointerUp = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (pressState.current === 'pending') onIncrement();
    pressState.current = 'idle';
  };

  const handlePointerCancel = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    pressState.current = 'idle';
  };

  // ── Count edit ─────────────────────────────────────────────────────────────
  const startCountEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setRaw(String(count));
    setEditingCount(true);
  };

  const commitCount = () => {
    const n = parseInt(raw, 10);
    onSetCount(isNaN(n) ? 0 : Math.max(0, n));
    setEditingCount(false);
  };

  return (
    <div
      className={`relative flex flex-col items-center rounded-2xl border pt-4 pb-2.5 px-2 transition-all ${
        active
          ? 'bg-gradient-to-b from-teal-50 to-white border-teal-200 shadow-sm ring-1 ring-teal-100'
          : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-sm'
      }`}
    >
      {/* Count badge — top-right */}
      {active && (
        editingCount ? (
          <input
            autoFocus
            type="number"
            min="0"
            className="absolute top-1.5 right-1.5 w-9 h-6 text-center text-xs font-bold border border-teal-400 rounded-lg outline-none ring-2 ring-teal-100 bg-white z-10"
            value={raw}
            onChange={e => setRaw(e.target.value)}
            onBlur={commitCount}
            onKeyDown={e => {
              if (e.key === 'Enter')  commitCount();
              if (e.key === 'Escape') setEditingCount(false);
            }}
          />
        ) : (
          <button
            onClick={startCountEdit}
            title="Tap to edit count"
            className="absolute top-1.5 right-1.5 min-w-[22px] h-[22px] px-1.5 rounded-full bg-teal-600 text-white text-[11px] font-bold flex items-center justify-center tabular-nums hover:bg-teal-700 transition-colors"
          >
            {count}
          </button>
        )
      )}

      {/* Note indicator — top-left */}
      {hasNote && (
        <button
          onClick={e => { e.stopPropagation(); onOpenNote(); }}
          title="Has note — tap to edit"
          className="absolute top-1.5 left-1.5 w-5 h-5 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center hover:bg-amber-200 transition-colors"
        >
          <MessageSquare className="w-2.5 h-2.5" />
        </button>
      )}

      {/* Emoji — short tap = add, long press = note */}
      <button
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerCancel}
        onPointerCancel={handlePointerCancel}
        onContextMenu={e => e.preventDefault()}
        title="Tap to add · hold to add a note"
        className="text-3xl leading-none mb-2 select-none hover:scale-110 transition-transform active:scale-95 touch-none"
      >
        {icon}
      </button>

      {/* Name */}
      <p className={`text-[11px] font-medium text-center leading-tight mb-2.5 px-1 ${
        active ? 'text-teal-800' : 'text-slate-500'
      }`}>
        {name}
      </p>

      {/* − + controls */}
      <div className="flex items-center gap-2 mt-auto">
        <button
          onClick={onDecrement}
          disabled={!active}
          className={`w-6 h-6 rounded-lg flex items-center justify-center transition-all active:scale-90 ${
            active
              ? 'text-slate-400 hover:bg-red-50 hover:text-red-400'
              : 'text-slate-200 cursor-not-allowed'
          }`}
        >
          <Minus className="w-3 h-3" />
        </button>
        <button
          onClick={onIncrement}
          className="w-6 h-6 rounded-lg flex items-center justify-center text-teal-500 hover:bg-teal-100 transition-all active:scale-90"
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function SurveyTool({ jobId }: { jobId: string | undefined }) {
  const [open,         setOpen]         = useState(false);
  const [data,         setData]         = useState<SurveyData>(() => loadData(jobId));
  const [selectedRoom, setSelectedRoom] = useState(ROOMS[0].name);
  const [noteModal,    setNoteModal]    = useState<{ room: string; item: string; icon: string } | null>(null);

  useEffect(() => { setData(loadData(jobId)); }, [jobId]);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

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

  const clone = () => JSON.parse(JSON.stringify(data)) as SurveyData;

  const getEntry = (room: string, item: string): ItemEntry =>
    data[room]?.[item] ?? { count: 0, note: '' };

  const setEntry = (room: string, item: string, entry: ItemEntry) => {
    const next = clone();
    if (entry.count <= 0 && !entry.note) {
      if (next[room]) {
        delete next[room][item];
        if (!Object.keys(next[room]).length) delete next[room];
      }
    } else {
      if (!next[room]) next[room] = {};
      next[room][item] = entry;
    }
    persist(next);
  };

  const increment = (room: string, item: string) => {
    const e = getEntry(room, item);
    setEntry(room, item, { ...e, count: e.count + 1 });
  };

  const decrement = (room: string, item: string) => {
    const e = getEntry(room, item);
    if (e.count <= 0) return;
    setEntry(room, item, { ...e, count: e.count - 1 });
  };

  const setItemCount = (room: string, item: string, n: number) => {
    const e = getEntry(room, item);
    setEntry(room, item, { ...e, count: Math.max(0, n) });
  };

  const saveNote = (room: string, item: string, note: string) => {
    const e = getEntry(room, item);
    // If item has no count yet, opening a note still adds a count of 1
    setEntry(room, item, { count: Math.max(e.count, note ? 1 : e.count), note });
  };

  // ── Derived stats ────────────────────────────────────────────────────────────

  const roomTotal = (room: string) =>
    Object.values(data[room] || {}).reduce((s, e) => s + e.count, 0);

  const grandTotal = Object.values(data).reduce(
    (s, r) => s + Object.values(r).reduce((ss, e) => ss + e.count, 0), 0);

  const roomsWithItems = Object.values(data).filter(
    r => Object.values(r).some(e => e.count > 0)
  ).length;

  const currentRoom = ROOMS.find(r => r.name === selectedRoom)!;
  const roomData    = data[selectedRoom] || {};

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
                    : 'Tap to add · hold to add a note'}
                </p>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              title="Close (Esc)"
              className="p-2 rounded-xl hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex flex-1 min-h-0 relative">
            {/* ── Room sidebar ─────────────────────────────────────────────── */}
            <div className="w-52 bg-white border-r border-slate-200 flex-shrink-0 overflow-y-auto py-3 px-2">
              {ROOMS.map(r => {
                const tot      = roomTotal(r.name);
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
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full tabular-nums ${
                        isActive ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600'
                      }`}>
                        {tot}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* ── Items grid ───────────────────────────────────────────────── */}
            <div className="flex-1 overflow-y-auto p-6">
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

              <div className="grid grid-cols-5 gap-3">
                {currentRoom.items.map(({ name, icon }) => {
                  const entry = roomData[name] ?? { count: 0, note: '' };
                  return (
                    <ItemSquare
                      key={name}
                      name={name}
                      icon={icon}
                      count={entry.count}
                      note={entry.note}
                      onIncrement={() => increment(selectedRoom, name)}
                      onDecrement={() => decrement(selectedRoom, name)}
                      onSetCount={n => setItemCount(selectedRoom, name, n)}
                      onOpenNote={() => setNoteModal({ room: selectedRoom, item: name, icon })}
                    />
                  );
                })}
              </div>

              <p className="text-xs text-slate-400 mt-6 text-center">
                Tap icon or + to add · hold icon to add a note · tap teal badge to edit count
              </p>
            </div>

            {/* ── Note modal (rendered inside the overlay to keep z-index simple) */}
            {noteModal && (
              <NoteModal
                itemName={noteModal.item}
                itemIcon={noteModal.icon}
                currentNote={data[noteModal.room]?.[noteModal.item]?.note ?? ''}
                onSave={note => saveNote(noteModal.room, noteModal.item, note)}
                onClose={() => setNoteModal(null)}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}
