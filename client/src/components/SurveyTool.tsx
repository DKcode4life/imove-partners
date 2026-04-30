import { useState, useEffect, useCallback, useRef } from 'react';
import { X, ClipboardList, Minus, Plus, MessageSquare, Search, Camera, Image as ImageIcon } from 'lucide-react';
import type { CatalogCategory } from '../data/inventoryCatalog';
import { loadCatalog } from '../lib/catalogStorage';
import ImageModal from './ImageModal';

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
  const primaryItems = categoryId === '__all__'
    ? catalog.flatMap(c => c.items)
    : (catalog.find(c => c.id === categoryId)?.items ?? []);
  const allItems = catalog.flatMap(c => c.items);
  return Object.entries(roomData).reduce((total, [itemName, entry]) => {
    const catalogItem = primaryItems.find(i => i.name === itemName)
      ?? allItems.find(i => i.name === itemName);
    return total + (catalogItem?.volumeCuFt ?? 0) * entry.count;
  }, 0);
}

// ── Data types & storage ───────────────────────────────────────────────────────

type ItemEntry  = { count: number; note: string; photo?: string };
type RoomRecord = Record<string, ItemEntry>;
type SurveyData = Record<string, RoomRecord>;

type CustomRoom = { id: string; name: string; categoryId: string };

const storageKey     = (jobId: string | undefined) => `crm-survey-${jobId}`;
const searchDataKey  = (jobId: string | undefined) => `crm-survey-search-${jobId}`;
const customRoomsKey = (jobId: string | undefined) => `crm-survey-rooms-${jobId}`;
const roomPhotosKey  = (jobId: string | undefined) => `crm-survey-photos-${jobId}`;

function loadCustomRooms(jobId: string | undefined): CustomRoom[] {
  if (!jobId) return [];
  try {
    const raw = JSON.parse(localStorage.getItem(customRoomsKey(jobId)) || '[]') as
      Array<{ id: string; name: string; categoryId?: string }>;
    return raw.map(r => ({ id: r.id, name: r.name, categoryId: r.categoryId ?? '__all__' }));
  }
  catch { return []; }
}

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

function loadSearchData(jobId: string | undefined): SurveyData {
  if (!jobId) return {};
  try {
    const raw = JSON.parse(localStorage.getItem(searchDataKey(jobId)) || '{}') as
      Record<string, Record<string, number | ItemEntry>>;
    const out: SurveyData = {};
    for (const [room, items] of Object.entries(raw)) {
      out[room] = {};
      for (const [item, val] of Object.entries(items)) {
        out[room][item] = typeof val === 'number' ? { count: val, note: '' } : val;
      }
    }
    return out;
  } catch { return {}; }
}

function loadRoomPhotos(jobId: string | undefined): Record<string, string[]> {
  if (!jobId) return {};
  try {
    return JSON.parse(localStorage.getItem(roomPhotosKey(jobId)) || '{}') as Record<string, string[]>;
  } catch { return {}; }
}

// ── Image compression ──────────────────────────────────────────────────────────

function compressImage(file: File, maxPx = 1200, quality = 0.72): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    img.src = url;
  });
}

// ── Note modal ─────────────────────────────────────────────────────────────────

function NoteModal({ itemName, itemIcon, currentNote, currentPhoto, onSave, onClose }: {
  itemName: string;
  itemIcon: string;
  currentNote: string;
  currentPhoto?: string;
  onSave: (note: string, photo: string | undefined) => void;
  onClose: () => void;
}) {
  const [text,  setText]  = useState(currentNote);
  const [photo, setPhoto] = useState<string | undefined>(currentPhoto);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try { setPhoto(await compressImage(file)); } catch { /* skip on error */ }
    e.target.value = '';
  };

  return (
    <div
      className="absolute inset-0 z-[10] flex items-center justify-center bg-black/30 backdrop-blur-sm p-4"
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
            <p className="text-xs text-slate-400">Note &amp; photo</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Photo section */}
        <div className="px-5 pb-3">
          {photo ? (
            <div className="relative rounded-xl overflow-hidden border border-slate-200">
              <img src={photo} alt="Item photo" className="w-full max-h-44 object-cover" />
              <button
                onClick={() => setPhoto(undefined)}
                className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-slate-200 text-slate-400 hover:border-teal-300 hover:text-teal-600 transition-colors"
            >
              <Camera className="w-4 h-4" />
              <span className="text-xs font-medium">Take / attach photo</span>
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleFile}
          />
        </div>

        {/* Note textarea */}
        <div className="px-5 pb-4">
          <textarea
            autoFocus
            rows={3}
            placeholder="e.g. Needs disassembly · fragile · customer to pack separately…"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 resize-none outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100 transition"
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                onSave(text.trim(), photo);
                onClose();
              }
            }}
          />
          <p className="text-[11px] text-slate-400 mt-1.5">⌘ Enter to save</p>
        </div>

        {/* Buttons */}
        <div className="flex gap-2 px-5 pb-5">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => { onSave(text.trim(), photo); onClose(); }}
            className="flex-1 py-2 rounded-xl bg-teal-600 text-sm font-semibold text-white hover:bg-teal-700 transition-colors active:scale-[0.98]"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Item square card ───────────────────────────────────────────────────────────

function ItemSquare({ name, icon, count, note, photo, volumeCuFt, onIncrement, onDecrement, onSetCount, onOpenNote }: {
  name: string; icon: string; count: number; note: string; photo?: string; volumeCuFt: number;
  onIncrement: () => void;
  onDecrement: () => void;
  onSetCount: (n: number) => void;
  onOpenNote: () => void;
}) {
  const [editingCount, setEditingCount] = useState(false);
  const [raw,          setRaw]          = useState('');

  const active    = count > 0;
  const hasNote   = note.trim().length > 0;
  const hasPhoto  = !!photo;

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

      {/* Note / photo indicator */}
      <button
        onClick={e => { e.stopPropagation(); onOpenNote(); }}
        title={hasPhoto ? 'Has photo · tap to edit' : hasNote ? 'Has note · tap to edit' : 'Add note or photo'}
        className={`absolute top-1.5 left-1.5 w-5 h-5 rounded-full flex items-center justify-center transition-colors ${
          hasPhoto
            ? 'bg-blue-100 text-blue-600 hover:bg-blue-200'
            : hasNote
              ? 'bg-amber-100 text-amber-600 hover:bg-amber-200'
              : 'bg-slate-100 text-slate-300 hover:bg-slate-200 hover:text-slate-500'
        }`}
      >
        {hasPhoto ? <Camera className="w-2.5 h-2.5" /> : <MessageSquare className="w-2.5 h-2.5" />}
      </button>

      {/* Icon — display only */}
      <div className="text-3xl leading-none mb-1.5 select-none">
        {icon}
      </div>

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
          className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all active:scale-90 ${
            active
              ? 'text-slate-400 hover:bg-red-50 hover:text-red-400'
              : 'text-slate-200 cursor-not-allowed'
          }`}
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onIncrement}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-teal-500 hover:bg-teal-100 transition-all active:scale-90"
        >
          <Plus className="w-3.5 h-3.5" />
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
  const [noteModal,      setNoteModal]      = useState<{ room: string; item: string; icon: string; isSearch: boolean } | null>(null);
  const [customRooms,    setCustomRooms]    = useState<CustomRoom[]>(() => loadCustomRooms(jobId));
  const [addingRoomType, setAddingRoomType] = useState<'bedroom' | 'room' | null>(null);
  const [newRoomName,    setNewRoomName]    = useState('');
  const [search,         setSearch]         = useState('');
  const [searchData,     setSearchData]     = useState<SurveyData>(() => loadSearchData(jobId));
  
  // Image modal state
  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [currentImage, setCurrentImage] = useState<string>('');
  const [currentImageAlt, setCurrentImageAlt] = useState<string>('');

  useEffect(() => { setData(loadData(jobId)); }, [jobId]);
  useEffect(() => { setSearchData(loadSearchData(jobId)); }, [jobId]);
  useEffect(() => { setCustomRooms(loadCustomRooms(jobId)); }, [jobId]);
  useEffect(() => { setSearch(''); }, [selectedRoomId]);

  // ── Room photos (reference photos of the entire room) ──────────────────────
  const [roomPhotos, setRoomPhotos] = useState<Record<string, string[]>>(() => loadRoomPhotos(jobId));
  const roomPhotoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setRoomPhotos(loadRoomPhotos(jobId)); }, [jobId]);

  const persistRoomPhotos = useCallback((next: Record<string, string[]>) => {
    setRoomPhotos(next);
    if (jobId) localStorage.setItem(roomPhotosKey(jobId), JSON.stringify(next));
  }, [jobId]);

  const addRoomPhoto = async (roomName: string, file: File) => {
    try {
      const dataUrl = await compressImage(file);
      const next = { ...roomPhotos };
      next[roomName] = [...(next[roomName] || []), dataUrl];
      persistRoomPhotos(next);
    } catch { /* skip on error */ }
  };

  const removeRoomPhoto = (roomName: string, index: number) => {
    const next = { ...roomPhotos };
    next[roomName] = next[roomName].filter((_, i) => i !== index);
    if (next[roomName].length === 0) delete next[roomName];
    persistRoomPhotos(next);
  };

  const allRooms = [
    ...SURVEY_ROOMS,
    ...customRooms.map(r => ({ id: r.id, name: r.name, categoryId: r.categoryId })),
  ];

  const handleAddRoom = (categoryId: string) => {
    const name = newRoomName.trim();
    if (!name) return;
    const id = `custom-${Date.now()}`;
    const next = [...customRooms, { id, name, categoryId }];
    setCustomRooms(next);
    if (jobId) localStorage.setItem(customRoomsKey(jobId), JSON.stringify(next));
    setNewRoomName('');
    setAddingRoomType(null);
    setSelectedRoomId(id);
  };

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

  const saveNote = (room: string, item: string, note: string, photo: string | undefined) => {
    const e = getEntry(room, item);
    setEntry(room, item, { count: Math.max(e.count, (note || photo) ? 1 : e.count), note, photo });
  };

  // ── Search-specific data (separate store so catItems grid is unaffected) ──────

  const persistSearch = useCallback((next: SurveyData) => {
    setSearchData(next);
    if (jobId) localStorage.setItem(searchDataKey(jobId), JSON.stringify(next));
  }, [jobId]);

  const cloneSearch    = () => JSON.parse(JSON.stringify(searchData)) as SurveyData;
  const getSearchEntry = (room: string, item: string): ItemEntry =>
    searchData[room]?.[item] ?? { count: 0, note: '' };

  const setSearchEntry = (room: string, item: string, entry: ItemEntry) => {
    const next = cloneSearch();
    if (entry.count <= 0 && !entry.note && !entry.photo) {
      if (next[room]) {
        delete next[room][item];
        if (!Object.keys(next[room]).length) delete next[room];
      }
    } else {
      if (!next[room]) next[room] = {};
      next[room][item] = entry;
    }
    persistSearch(next);
  };

  const searchIncrement = (room: string, item: string) => {
    const e = getSearchEntry(room, item);
    setSearchEntry(room, item, { ...e, count: e.count + 1 });
  };
  const searchDecrement = (room: string, item: string) => {
    const e = getSearchEntry(room, item);
    if (e.count <= 0) return;
    setSearchEntry(room, item, { ...e, count: e.count - 1 });
  };
  const searchSetCount = (room: string, item: string, n: number) => {
    const e = getSearchEntry(room, item);
    setSearchEntry(room, item, { ...e, count: Math.max(0, n) });
  };
  const searchSaveNote = (room: string, item: string, note: string, photo: string | undefined) => {
    const e = getSearchEntry(room, item);
    setSearchEntry(room, item, { count: Math.max(e.count, (note || photo) ? 1 : e.count), note, photo });
  };

  // Image modal helper
  const openRoomPhoto = (dataUrl: string, roomName: string, index: number) => {
    setCurrentImage(dataUrl);
    setCurrentImageAlt(`${roomName} photo ${index + 1}`);
    setImageModalOpen(true);
  };

  // ── Derived stats ────────────────────────────────────────────────────────────

  const roomItemCount = (roomName: string) =>
    Object.values(data[roomName] || {}).reduce((s, e) => s + e.count, 0) +
    Object.values(searchData[roomName] || {}).reduce((s, e) => s + e.count, 0);

  const grandItemCount = allRooms.reduce(
    (s, r) => s + roomItemCount(r.name), 0);

  const roomsWithItems = allRooms.filter(r => roomItemCount(r.name) > 0).length;

  const getRoomVol = (r: { name: string; categoryId: string }) =>
    roomVolumeFt(r.name, data[r.name] ?? {}, catalog, r.categoryId) +
    roomVolumeFt(r.name, searchData[r.name] ?? {}, catalog, '__all__');

  const totalVolFt = allRooms.reduce((s, r) => s + getRoomVol(r), 0);

  const currentRoom        = allRooms.find(r => r.id === selectedRoomId) ?? allRooms[0];
  const currentRoomPhotos  = roomPhotos[currentRoom.name] ?? [];
  const roomData           = data[currentRoom.name] ?? {};
  const searchRoomData = searchData[currentRoom.name] ?? {};
  const catItems    = currentRoom.categoryId === '__all__'
    ? catalog.flatMap(c => c.items)
    : (catalog.find(c => c.id === currentRoom.categoryId)?.items ?? []);
  const curRoomVol  = getRoomVol(currentRoom);
  const curRoomCount= roomItemCount(currentRoom.name);

  const searchTerm  = search.trim().toLowerCase();
  const displayItems = searchTerm
    ? catalog.flatMap(c => c.items).filter(i => i.name.toLowerCase().includes(searchTerm))
    : catItems;

  // Items added to this room via the search bar (stored separately in searchData)
  const allCatalogFlat = catalog.flatMap(c => c.items);
  const extraItems = !searchTerm
    ? Object.keys(searchRoomData)
        .flatMap(name => { const item = allCatalogFlat.find(i => i.name === name); return item ? [item] : []; })
    : [];

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
                  <p className="text-xs text-slate-500">Use + / − to add items · tap the note icon for notes</p>
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
              {allRooms.map(r => {
                const count    = roomItemCount(r.name);
                const vol      = getRoomVol(r);
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

              {/* Room photos indicator per room */}
              {Object.keys(roomPhotos).length > 0 && (
                <div className="border-t border-slate-100 pt-2 mt-1">
                  <p className="px-3 pb-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                    Room Photos
                  </p>
                  {allRooms.filter(r => (roomPhotos[r.name]?.length ?? 0) > 0).map(r => {
                    const count = roomPhotos[r.name]?.length ?? 0;
                    const isActive = r.id === selectedRoomId;
                    return (
                      <button
                        key={`photos-${r.id}`}
                        onClick={() => setSelectedRoomId(r.id)}
                        className={`w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs font-medium transition-all mb-0.5 ${
                          isActive
                            ? 'bg-teal-50 text-teal-800'
                            : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                        }`}
                      >
                        <span className="flex items-center gap-1.5 truncate">
                          <ImageIcon className="w-3 h-3 flex-shrink-0" />
                          <span className="truncate">{r.name}</span>
                        </span>
                        <span className={`text-[10px] font-bold px-1 rounded-full tabular-nums ${isActive ? 'text-teal-700' : 'text-slate-400'}`}>
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Add Bedroom / Add Room */}
              <div className="mt-1 border-t border-slate-100 pt-2 space-y-1">
                {addingRoomType ? (
                  <div className="px-1">
                    <p className="text-xs text-slate-500 mb-1.5">
                      {addingRoomType === 'bedroom' ? 'New bedroom name' : 'New room name'}
                    </p>
                    <input
                      autoFocus
                      type="text"
                      value={newRoomName}
                      onChange={e => setNewRoomName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleAddRoom(addingRoomType === 'bedroom' ? 'bedroom' : '__all__');
                        if (e.key === 'Escape') {
                          e.stopPropagation();
                          setAddingRoomType(null);
                          setNewRoomName('');
                        }
                      }}
                      placeholder={addingRoomType === 'bedroom' ? 'e.g. Bedroom 4…' : 'e.g. Conservatory…'}
                      className="w-full rounded-lg border border-teal-300 px-2.5 py-1.5 text-sm text-slate-800 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-teal-100 mb-1.5"
                    />
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => handleAddRoom(addingRoomType === 'bedroom' ? 'bedroom' : '__all__')}
                        className="flex-1 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold hover:bg-teal-700 transition-colors"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => { setAddingRoomType(null); setNewRoomName(''); }}
                        className="flex-1 py-1.5 rounded-lg border border-slate-200 text-slate-500 text-xs font-medium hover:bg-slate-50 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={() => setAddingRoomType('bedroom')}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium text-slate-400 hover:bg-slate-50 hover:text-teal-600 transition-colors border border-dashed border-slate-200"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add Bedroom
                    </button>
                    <button
                      onClick={() => setAddingRoomType('room')}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium text-slate-400 hover:bg-slate-50 hover:text-teal-600 transition-colors border border-dashed border-slate-200"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add Room
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* ── Items grid ───────────────────────────────────────────────── */}
            <div className="flex-1 overflow-y-auto p-6">
              {/* Search bar */}
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Escape') { e.stopPropagation(); setSearch(''); }
                  }}
                  placeholder="Search all items…"
                  className="w-full pl-9 pr-8 py-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 placeholder:text-slate-400 outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100 transition"
                />
                {search && (
                  <button
                    onClick={() => setSearch('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {searchTerm ? (
                /* ── Search mode ── */
                <>
                  <p className="text-sm text-slate-500 mb-4">
                    {displayItems.length > 0
                      ? <>{displayItems.length} result{displayItems.length !== 1 ? 's' : ''} · adding to <span className="font-semibold text-teal-700">{currentRoom.name}</span></>
                      : <>No items found for <span className="font-semibold text-slate-700">"{search}"</span></>
                    }
                  </p>
                  {displayItems.length > 0 ? (
                    <div className="grid grid-cols-5 gap-3">
                      {displayItems.map(({ id, name, icon, volumeCuFt }) => {
                        const entry = searchRoomData[name] ?? { count: 0, note: '' };
                        return (
                          <ItemSquare
                            key={id}
                            name={name}
                            icon={icon}
                            count={entry.count}
                            note={entry.note}
                            photo={entry.photo}
                            volumeCuFt={volumeCuFt}
                            onIncrement={() => searchIncrement(currentRoom.name, name)}
                            onDecrement={() => searchDecrement(currentRoom.name, name)}
                            onSetCount={n => searchSetCount(currentRoom.name, name, n)}
                            onOpenNote={() => setNoteModal({ room: currentRoom.name, item: name, icon, isSearch: true })}
                          />
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                      <Search className="w-8 h-8 mb-3 opacity-40" />
                      <p className="text-sm">Try a different search term</p>
                    </div>
                  )}
                </>
              ) : (
                /* ── Normal mode ── */
                <>
                  {/* Room header */}
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
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {curRoomCount > 0 && (
                        <span className="px-2.5 py-1 rounded-full bg-teal-100 text-teal-700 text-xs font-bold tabular-nums">
                          {curRoomCount} item{curRoomCount !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Room Photos */}
                  <div className="mb-5">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                        Room Photos <span className="text-slate-300 font-normal normal-case tracking-normal">({currentRoomPhotos.length})</span>
                      </p>
                      <button
                        onClick={() => roomPhotoInputRef.current?.click()}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-xs font-medium text-slate-500 hover:border-teal-300 hover:text-teal-600 transition-colors"
                      >
                        <Camera className="w-3 h-3" /> Add Photo
                      </button>
                      <input
                        ref={roomPhotoInputRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        onChange={e => {
                          const f = e.target.files?.[0];
                          if (f) addRoomPhoto(currentRoom.name, f);
                          e.target.value = '';
                        }}
                      />
                    </div>
                    {currentRoomPhotos.length > 0 ? (
                      <div className="flex gap-2 overflow-x-auto pb-1">
                        {currentRoomPhotos.map((dataUrl, i) => (
                          <div key={i} className="relative flex-shrink-0">
                            <img
                              src={dataUrl}
                              alt={`${currentRoom.name} photo ${i + 1}`}
                              className="w-24 h-20 rounded-xl object-cover border border-slate-200 hover:border-teal-300 cursor-pointer transition-colors"
                              onClick={() => openRoomPhoto(dataUrl, currentRoom.name, i)}
                            />
                            <button
                              onClick={() => removeRoomPhoto(currentRoom.name, i)}
                              className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600 transition-colors shadow-sm"
                              title="Remove photo"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <button
                        onClick={() => roomPhotoInputRef.current?.click()}
                        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-slate-200 text-slate-400 hover:border-teal-300 hover:text-teal-600 transition-colors"
                      >
                        <Camera className="w-4 h-4" />
                        <span className="text-xs font-medium">Add reference photos of {currentRoom.name}</span>
                      </button>
                    )}
                  </div>

                  {/* Standard category items */}
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
                          photo={entry.photo}
                          volumeCuFt={volumeCuFt}
                          onIncrement={() => increment(currentRoom.name, name)}
                          onDecrement={() => decrement(currentRoom.name, name)}
                          onSetCount={n => setItemCount(currentRoom.name, name, n)}
                          onOpenNote={() => setNoteModal({ room: currentRoom.name, item: name, icon, isSearch: false })}
                        />
                      );
                    })}
                  </div>

                  {/* Extra items added via search from other categories */}
                  {extraItems.length > 0 && (
                    <div className="mt-6 pt-5 border-t border-slate-200">
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                        Added from search
                      </p>
                      <div className="grid grid-cols-5 gap-3">
                        {extraItems.map(({ id, name, icon, volumeCuFt }) => {
                          const entry = searchRoomData[name] ?? { count: 0, note: '' };
                          return (
                            <ItemSquare
                              key={id}
                              name={name}
                              icon={icon}
                              count={entry.count}
                              note={entry.note}
                              photo={entry.photo}
                              volumeCuFt={volumeCuFt}
                              onIncrement={() => searchIncrement(currentRoom.name, name)}
                              onDecrement={() => searchDecrement(currentRoom.name, name)}
                              onSetCount={n => searchSetCount(currentRoom.name, name, n)}
                              onOpenNote={() => setNoteModal({ room: currentRoom.name, item: name, icon, isSearch: true })}
                            />
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}

              <p className="text-xs text-slate-400 mt-6 text-center">
                Use + / − to add items · search to find any item across all categories · tap the note icon for notes
              </p>
            </div>

            {/* Note modal */}
            {noteModal && (
              <NoteModal
                itemName={noteModal.item}
                itemIcon={noteModal.icon}
                currentNote={noteModal.isSearch
                  ? (searchData[noteModal.room]?.[noteModal.item]?.note ?? '')
                  : (data[noteModal.room]?.[noteModal.item]?.note ?? '')}
                currentPhoto={noteModal.isSearch
                  ? searchData[noteModal.room]?.[noteModal.item]?.photo
                  : data[noteModal.room]?.[noteModal.item]?.photo}
                onSave={(note, photo) => noteModal.isSearch
                  ? searchSaveNote(noteModal.room, noteModal.item, note, photo)
                  : saveNote(noteModal.room, noteModal.item, note, photo)}
                onClose={() => setNoteModal(null)}
              />
            )}
          </div>
        </div>
      )}

      {/* Image Modal */}
      <ImageModal
        open={imageModalOpen}
        onClose={() => setImageModalOpen(false)}
        imageUrl={currentImage}
        altText={currentImageAlt}
      />
    </>
  );
}
