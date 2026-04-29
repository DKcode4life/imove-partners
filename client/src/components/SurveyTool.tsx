import { useState, useEffect, useCallback, useRef } from 'react';
import { X, ClipboardList, Minus, Plus, MessageSquare } from 'lucide-react';
import type { CatalogCategory } from '../data/inventoryCatalog';
import { loadCatalog } from '../lib/catalogStorage';

// ── Survey room definitions ────────────────────────────────────────────────────
// Each room has a fixed display name (used as the key in SurveyData) and a
// categoryId that maps to the inventory catalog for its item list.

const SURVEY_ROOMS = [
  { id: 'living-room',   name: 'Living Room',        categoryId: 'living-room' },
  { id: 'bedroom-1',     name: 'Bedroom 1',           categoryId: 'bedroom' },
  { id: 'bedroom-2',     name: 'Bedroom 2',           categoryId: 'bedroom' },
  { id: 'bedroom-3',     name: 'Bedroom 3',           categoryId: 'bedroom' },
  { id: 'kitchen',       name: 'Kitchen & Utility',   categoryId: 'kitchen-utility' },
  { id: 'garage',        name: 'Garage / Garden',     categoryId: 'garage-garden' },
  { id: 'office',        name: 'Office & Commercial', categoryId: 'office-commercial' },
];

// ── Volume helpers ─────────────────────────────────────────────────────────────

const FT3_TO_M3 = 0.028317;
const fmtFt = (n: number) => n.toFixed(1);
const fmtM3 = (n: number) => (n * FT3_TO_M3).toFixed(2);

function roomVolumeFt(
  roomName: string,
  roomData: RoomRecord,
  catalog: CatalogCategory[],
  categoryId: string,
): number {
  const cat = catalog.find(c => c.id === categoryId);
  if (!cat) return 0;
  return Object.entries(roomData).reduce((total, [itemName, entry]) => {
    const catalogItem = cat.items.find(i => i.name === itemName);
    return total + (catalogItem?.volumeCuFt ?? 0) * entry.count;
  }, 0);
}

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
        out[room][item] = typeof val === 'number' ? { count: val, note: '' } : val;
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
    <div
      className="absolute inset-0 z-[10] flex items-center justify-center bg-black/30 backdrop-blur-sm p-6"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
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

function ItemSquare({ name, icon, count, note, volumeCuFt, onIncrement, onDecrement, onSetCount, onOpenNote }: {
  name: string; icon: string; count: number; note: string; volumeCuFt: number;
  onIncrement: () => void;
  onDecrement: () => void;
  onSetCount: (n: number) => void;
  onOpenNote: () => void;
}) {
  const [editingCount, setEditingCount] = useState(false);
  const [raw,          setRaw]          = useState('');

  const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressState = useRef<'pending' | 'fired' | 'idle'>('idle');

  const active  = count > 0;
  const hasNote = note.trim().length > 0;

  const handlePointerDown = (e: React.PointerEvent) => {
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
      {/* Count badge */}
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

      {/* Note indicator */}
      {hasNote && (
        <button
          onClick={e => { e.stopPropagation(); onOpenNote(); }}
          title="Has note — tap to edit"
          className="absolute top-1.5 left-1.5 w-5 h-5 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center hover:bg-amber-200 transition-colors"
        >
          <MessageSquare className="w-2.5 h-2.5" />
        </button>
      )}

      {/* Emoji — tap = add, long press = note */}
      <button
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerCancel}
        onPointerCancel={handlePointerCancel}
        onContextMenu={e => e.preventDefault()}
        title="Tap to add · hold to add a note"
        className="text-3xl leading-none mb-1.5 select-none hover:scale-110 transition-transform active:scale-95 touch-none"
      >
        {icon}
      </button>

      {/* Name */}
      <p className={`text-[10px] font-medium text-center leading-tight px-1 ${
        active ? 'text-teal-800' : 'text-slate-500'
      }`}>
        {name}
      </p>

      {/* Volume per unit */}
      {volumeCuFt > 0 && (
        <p className="text-[9px] text-slate-400 tabular-nums mt-0.5">
          {volumeCuFt} ft³
        </p>
      )}

      {/* −/+ controls */}
      <div className="flex items-center gap-2 mt-auto pt-2">
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
  const [catalog, setCatalog] = useState<CatalogCategory[]>([]);
  useEffect(() => { loadCatalog().then(setCatalog); }, []);
  const [open,           setOpen]           = useState(false);
  const [data,           setData]           = useState<SurveyData>(() => loadData(jobId));
  const [selectedRoomId, setSelectedRoomId] = useState(SURVEY_ROOMS[0].id);
  const [noteModal,      setNoteModal]      = useState<{ room: string; item: string; icon: string } | null>(null);

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
    setEntry(room, item, { count: Math.max(e.count, note ? 1 : e.count), note });
  };

  // ── Derived stats ────────────────────────────────────────────────────────────

  const roomItemCount = (roomName: string) =>
    Object.values(data[roomName] || {}).reduce((s, e) => s + e.count, 0);

  const grandItemCount = SURVEY_ROOMS.reduce(
    (s, r) => s + roomItemCount(r.name), 0);

  const roomsWithItems = SURVEY_ROOMS.filter(r => roomItemCount(r.name) > 0).length;

  const getRoomVol = (r: typeof SURVEY_ROOMS[0]) =>
    roomVolumeFt(r.name, data[r.name] ?? {}, catalog, r.categoryId);

  const totalVolFt = SURVEY_ROOMS.reduce((s, r) => s + getRoomVol(r), 0);

  const currentRoom = SURVEY_ROOMS.find(r => r.id === selectedRoomId) ?? SURVEY_ROOMS[0];
  const roomData    = data[currentRoom.name] ?? {};
  const catItems    = catalog.find(c => c.id === currentRoom.categoryId)?.items ?? [];
  const curRoomVol  = getRoomVol(currentRoom);
  const curRoomCount= roomItemCount(currentRoom.name);

  return (
    <>
      {/* ── Compact card (shown in CRM job profile) ───────────────────────────── */}
      <div className="space-y-3">
        {totalVolFt > 0 ? (
          <div className="flex items-center gap-3 bg-gradient-to-r from-teal-50 to-teal-100/50 rounded-xl px-3 py-2.5 border border-teal-100">
            <ClipboardList className="w-4 h-4 text-teal-600 flex-shrink-0" />
            <div>
              <p className="text-xs font-bold text-teal-800 tabular-nums">
                {fmtFt(totalVolFt)} ft³ &nbsp;·&nbsp; {fmtM3(totalVolFt)} m³
              </p>
              <p className="text-[11px] text-teal-600">
                {grandItemCount} item{grandItemCount !== 1 ? 's' : ''} across {roomsWithItems} room{roomsWithItems !== 1 ? 's' : ''}
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
                {totalVolFt > 0 ? (
                  <p className="text-xs text-slate-500 tabular-nums">
                    <span className="font-semibold text-teal-700">{fmtFt(totalVolFt)} ft³</span>
                    {' '}·{' '}
                    <span className="font-semibold text-teal-700">{fmtM3(totalVolFt)} m³</span>
                    {' '}total &nbsp;·&nbsp; {grandItemCount} item{grandItemCount !== 1 ? 's' : ''} across {roomsWithItems} room{roomsWithItems !== 1 ? 's' : ''}
                  </p>
                ) : (
                  <p className="text-xs text-slate-500">Tap to add · hold to add a note</p>
                )}
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
              {SURVEY_ROOMS.map(r => {
                const count   = roomItemCount(r.name);
                const vol     = getRoomVol(r);
                const isActive = r.id === selectedRoomId;
                return (
                  <button
                    key={r.id}
                    onClick={() => setSelectedRoomId(r.id)}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium transition-all mb-1 ${
                      isActive
                        ? 'bg-teal-50 text-teal-800 shadow-sm ring-1 ring-teal-100'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-800'
                    }`}
                  >
                    <span className="truncate text-left">{r.name}</span>
                    {count > 0 && (
                      <div className="flex-shrink-0 ml-2 text-right">
                        <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full tabular-nums block ${
                          isActive ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600'
                        }`}>
                          {count}
                        </span>
                        {vol > 0 && (
                          <span className="text-[9px] text-slate-400 tabular-nums">
                            {fmtFt(vol)} ft³
                          </span>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {/* ── Items grid ───────────────────────────────────────────────── */}
            <div className="flex-1 overflow-y-auto p-6">
              {/* Room header with volume total */}
              <div className="flex items-start justify-between mb-5">
                <div>
                  <h3 className="text-lg font-bold text-slate-900 tracking-tight">
                    {currentRoom.name}
                  </h3>
                  {curRoomVol > 0 && (
                    <p className="text-sm text-slate-500 tabular-nums mt-0.5">
                      <span className="font-semibold text-teal-700">{fmtFt(curRoomVol)} ft³</span>
                      {' '}·{' '}
                      <span className="font-semibold text-teal-700">{fmtM3(curRoomVol)} m³</span>
                    </p>
                  )}
                </div>
                {curRoomCount > 0 && (
                  <span className="px-2.5 py-1 rounded-full bg-teal-100 text-teal-700 text-xs font-bold tabular-nums flex-shrink-0">
                    {curRoomCount} item{curRoomCount !== 1 ? 's' : ''}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-5 gap-3">
                {catItems.map(({ id, name, icon, volumeCuFt }) => {
                  const entry = roomData[name] ?? { count: 0, note: '' };
                  return (
                    <ItemSquare
                      key={id}
                      name={name}
                      icon={icon}
                      count={entry.count}
                      note={entry.note}
                      volumeCuFt={volumeCuFt}
                      onIncrement={() => increment(currentRoom.name, name)}
                      onDecrement={() => decrement(currentRoom.name, name)}
                      onSetCount={n => setItemCount(currentRoom.name, name, n)}
                      onOpenNote={() => setNoteModal({ room: currentRoom.name, item: name, icon })}
                    />
                  );
                })}
              </div>

              <p className="text-xs text-slate-400 mt-6 text-center">
                Tap icon or + to add · hold icon to add a note · tap teal badge to edit count
              </p>
            </div>

            {/* Note modal */}
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
