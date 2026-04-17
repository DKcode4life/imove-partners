import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronLeft, ChevronRight, CalendarDays, Plus, Users, Truck,
  X, Edit2, Trash2, CheckCircle, AlertCircle, Save, GripVertical, Copy,
} from 'lucide-react';
import CRMSidebar from '../../components/CRMSidebar';
import Modal from '../../components/Modal';
import api from '../../lib/api';
import type { PlannerAsset, PlannerCalendarItem, PlannerAssignment, PlannerEvent } from '../../types';
import { PLANNER_CATEGORIES } from '../../types';

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  'Loading':         { bg: 'bg-blue-100',    text: 'text-blue-700',    dot: '#3B82F6' },
  'Moving':          { bg: 'bg-indigo-100',  text: 'text-indigo-700',  dot: '#6366F1' },
  'Unloading':       { bg: 'bg-sky-100',     text: 'text-sky-700',     dot: '#0EA5E9' },
  'Packing':         { bg: 'bg-purple-100',  text: 'text-purple-700',  dot: '#8B5CF6' },
  'Box Drop off':    { bg: 'bg-amber-100',   text: 'text-amber-700',   dot: '#F59E0B' },
  'Box Collection':  { bg: 'bg-orange-100',  text: 'text-orange-700',  dot: '#F97316' },
  'Survey':          { bg: 'bg-cyan-100',    text: 'text-cyan-700',    dot: '#06B6D4' },
  'Sundry':          { bg: 'bg-slate-100',   text: 'text-slate-600',   dot: '#94A3B8' },
  'Quick Job':       { bg: 'bg-green-100',   text: 'text-green-700',   dot: '#22C55E' },
  // legacy aliases kept for existing records
  'Move':             { bg: 'bg-blue-100',    text: 'text-blue-700',    dot: '#3B82F6' },
  'Packing Box':      { bg: 'bg-purple-100',  text: 'text-purple-700',  dot: '#8B5CF6' },
  'Drop-off':         { bg: 'bg-amber-100',   text: 'text-amber-700',   dot: '#F59E0B' },
  'Box Drop-off':     { bg: 'bg-amber-100',   text: 'text-amber-700',   dot: '#F59E0B' },
  // Old CRM status names (pre-migration, kept for any surviving records)
  'Survey Booked':    { bg: 'bg-cyan-100',    text: 'text-cyan-700',    dot: '#06B6D4' },
  'Survey Completed': { bg: 'bg-teal-100',    text: 'text-teal-700',    dot: '#0D9488' },
  'Awaiting Quote':   { bg: 'bg-yellow-100',  text: 'text-yellow-800',  dot: '#EAB308' },
  'In Progress':      { bg: 'bg-emerald-100', text: 'text-emerald-700', dot: '#10B981' },
  'Booked Move':      { bg: 'bg-green-100',   text: 'text-green-700',   dot: '#22C55E' },
  'Job Completed':    { bg: 'bg-slate-100',   text: 'text-slate-500',   dot: '#94A3B8' },
  // Current CRM status names
  'New Lead':               { bg: 'bg-blue-100',    text: 'text-blue-700',    dot: '#3B82F6' },
  'Called V/M':             { bg: 'bg-violet-100',  text: 'text-violet-700',  dot: '#8B5CF6' },
  'Contacted':              { bg: 'bg-purple-100',  text: 'text-purple-700',  dot: '#7C3AED' },
  'Survey Physical':        { bg: 'bg-cyan-100',    text: 'text-cyan-700',    dot: '#06B6D4' },
  'Survey Video':           { bg: 'bg-teal-100',    text: 'text-teal-700',    dot: '#0D9488' },
  'Quote Sent':             { bg: 'bg-amber-100',   text: 'text-amber-700',   dot: '#F59E0B' },
  'Quote Chased':           { bg: 'bg-orange-100',  text: 'text-orange-700',  dot: '#F97316' },
  'Most Likely':            { bg: 'bg-yellow-100',  text: 'text-yellow-800',  dot: '#EAB308' },
  'Quote Accepted':         { bg: 'bg-emerald-100', text: 'text-emerald-700', dot: '#10B981' },
  'Confirmed No Date':      { bg: 'bg-green-100',   text: 'text-green-700',   dot: '#059669' },
  'Confirmed Deposit':      { bg: 'bg-lime-100',    text: 'text-lime-700',    dot: '#65A30D' },
  'Confirmed Paid':         { bg: 'bg-green-100',   text: 'text-green-800',   dot: '#15803D' },
  'Completed':              { bg: 'bg-slate-100',   text: 'text-slate-500',   dot: '#94A3B8' },
  'Archived / Review Done': { bg: 'bg-gray-100',    text: 'text-gray-600',    dot: '#6B7280' },
  'Lost / Cancelled':       { bg: 'bg-red-100',     text: 'text-red-700',     dot: '#EF4444' },
};

function catColor(cat: string) {
  return CATEGORY_COLORS[cat] ?? { bg: 'bg-slate-100', text: 'text-slate-600', dot: '#94A3B8' };
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
                     'July', 'August', 'September', 'October', 'November', 'December'];

function fmtDate(d: string) {
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function getWeekStart(d: Date): Date {
  const dt = new Date(d);
  const day = dt.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  dt.setDate(dt.getDate() + diff);
  return dt;
}

function toISO(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function Toast({ msg, type, onClose }: { msg: string; type: 'success' | 'error' | 'warning'; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 3500); return () => clearTimeout(t); }, [onClose]);
  const cfg = type === 'success'
    ? 'bg-green-50 border-green-200 text-green-800'
    : type === 'warning'
    ? 'bg-amber-50 border-amber-200 text-amber-800'
    : 'bg-red-50 border-red-200 text-red-800';
  return (
    <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl border shadow-lg text-sm font-medium ${cfg}`}>
      {type === 'success' ? <CheckCircle className="w-4 h-4 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 flex-shrink-0" />}
      {msg}
      <button onClick={onClose} className="ml-1 opacity-60 hover:opacity-100"><X className="w-3.5 h-3.5" /></button>
    </div>
  );
}

// ── Category badge ────────────────────────────────────────────────────────────

function CatBadge({ cat, size = 'sm' }: { cat: string; size?: 'xs' | 'sm' }) {
  const c = catColor(cat);
  return (
    <span className={`inline-flex items-center gap-1 rounded-full font-medium ${size === 'xs' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs'} ${c.bg} ${c.text}`}>
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: c.dot }} />
      {cat}
    </span>
  );
}

// ── Item chip (monthly view) ──────────────────────────────────────────────────

function ItemChip({ item, onClick }: { item: PlannerCalendarItem; onClick: () => void }) {
  const c = catColor(item.category);
  return (
    <button
      onClick={e => { e.stopPropagation(); onClick(); }}
      className={`w-full text-left px-1.5 py-0.5 rounded text-[11px] font-medium truncate transition-opacity hover:opacity-75 ${c.bg} ${c.text}`}
    >
      {item.title}
    </button>
  );
}

// ── Monthly grid ──────────────────────────────────────────────────────────────

function MonthlyView({
  currentDate, items, onDayClick, onItemClick, onAddQuickJob,
}: {
  currentDate: Date;
  items: PlannerCalendarItem[];
  onDayClick: (date: string) => void;
  onItemClick: (item: PlannerCalendarItem) => void;
  onAddQuickJob: (date?: string) => void;
}) {
  const year  = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // Adjust so week starts Monday
  const startOffset = firstDay === 0 ? 6 : firstDay - 1;
  const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;

  const today = toISO(new Date());

  const itemsByDate: Record<string, PlannerCalendarItem[]> = {};
  for (const item of items) {
    if (!item.date) continue;
    if (!itemsByDate[item.date]) itemsByDate[item.date] = [];
    itemsByDate[item.date].push(item);
  }

  const cells: { date: string | null; day: number; isCurrentMonth: boolean }[] = [];
  for (let i = 0; i < totalCells; i++) {
    const offset = i - startOffset;
    if (offset < 0 || offset >= daysInMonth) {
      cells.push({ date: null, day: 0, isCurrentMonth: false });
    } else {
      const d = offset + 1;
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      cells.push({ date: dateStr, day: d, isCurrentMonth: true });
    }
  }

  return (
    <div className="flex-1 overflow-auto">
      {/* Day headers */}
      <div className="grid grid-cols-7 border-b border-slate-200">
        {DAY_NAMES.map(d => (
          <div key={d} className="px-2 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider text-center">
            {d}
          </div>
        ))}
      </div>
      {/* Grid */}
      <div className="grid grid-cols-7 border-l border-slate-200">
        {cells.map((cell, idx) => {
          const dayItems = cell.date ? (itemsByDate[cell.date] || []) : [];
          const isToday  = cell.date === today;
          const overflow = dayItems.length > 3 ? dayItems.length - 3 : 0;
          return (
            <div
              key={idx}
              onClick={() => cell.date && onDayClick(cell.date)}
              className={`border-r border-b border-slate-200 min-h-[100px] p-1.5 flex flex-col gap-0.5 cursor-pointer transition-colors group ${
                cell.isCurrentMonth ? 'bg-white hover:bg-slate-50' : 'bg-slate-50/50 hover:bg-slate-100/50'
              }`}
            >
              {/* Day number */}
              <div className="flex items-center justify-between mb-0.5">
                <span className={`text-xs font-semibold w-5 h-5 flex items-center justify-center rounded-full ${
                  isToday ? 'bg-slate-900 text-white' : cell.isCurrentMonth ? 'text-slate-700' : 'text-slate-300'
                }`}>
                  {cell.isCurrentMonth ? cell.day : ''}
                </span>
                {cell.isCurrentMonth && (
                  <button
                    onClick={e => { e.stopPropagation(); onAddQuickJob(cell.date || undefined); }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity w-4 h-4 rounded flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-200"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                )}
              </div>
              {/* Items */}
              {dayItems.slice(0, 3).map((item, i) => (
                <ItemChip key={`${item.source}-${item.id}-${i}`} item={item} onClick={() => onItemClick(item)} />
              ))}
              {overflow > 0 && (
                <span className="text-[10px] text-slate-400 px-1 font-medium">+{overflow} more</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Asset chip (draggable) ────────────────────────────────────────────────────

function AssetChip({
  asset,
  reorderMode,
  onJobDragStart,
  onJobDragEnd,
  onReorderDragStart,
  onReorderDragOver,
  onReorderDrop,
  onReorderDragEnd,
  onEdit,
  onDelete,
}: {
  asset: PlannerAsset;
  reorderMode: boolean;
  isReorderTarget?: boolean;
  onJobDragStart: () => void;
  onJobDragEnd: () => void;
  onReorderDragStart: () => void;
  onReorderDragOver: () => void;
  onReorderDrop: () => void;
  onReorderDragEnd: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const isAvailable = asset.availability === 'available';
  return (
    <div
      draggable={reorderMode || isAvailable}
      onDragStart={e => {
        if (reorderMode) {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', String(asset.id));
          setTimeout(() => onReorderDragStart(), 0);
        } else if (isAvailable) {
          e.dataTransfer.effectAllowed = 'copy';
          e.dataTransfer.setData('text/plain', String(asset.id));
          setTimeout(() => onJobDragStart(), 0);
        } else {
          e.preventDefault();
        }
      }}
      onDragEnd={() => { onJobDragEnd(); onReorderDragEnd(); }}
      onDragOver={e => { if (reorderMode) { e.preventDefault(); e.stopPropagation(); onReorderDragOver(); } }}
      onDrop={e => { if (reorderMode) { e.preventDefault(); e.stopPropagation(); onReorderDrop(); } }}
      className={`group flex items-center gap-2 px-2.5 py-2 rounded-lg border text-sm transition-all ${
        reorderMode
          ? 'bg-white border-slate-200 hover:border-indigo-200 cursor-grab active:cursor-grabbing active:opacity-60'
          : isAvailable
            ? 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-sm cursor-grab active:cursor-grabbing active:opacity-60'
            : 'bg-slate-50 border-slate-200 opacity-60 cursor-not-allowed'
      }`}
    >
      <span className="flex-shrink-0">
        <GripVertical className={`w-3 h-3 transition-colors ${
          reorderMode ? 'text-indigo-400' : 'text-slate-200 group-hover:text-slate-300'
        }`} />
      </span>
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isAvailable ? 'bg-green-400' : 'bg-slate-300'}`} />
      <span className="text-xs font-medium text-slate-700 flex-1 truncate">{asset.name}</span>

      {!reorderMode && (
        <div className="hidden group-hover:flex items-center gap-0.5 flex-shrink-0">
          <button onClick={e => { e.stopPropagation(); onEdit(); }} className="p-0.5 text-slate-400 hover:text-slate-700"><Edit2 className="w-3 h-3" /></button>
          <button onClick={e => { e.stopPropagation(); onDelete(); }} className="p-0.5 text-slate-400 hover:text-red-500"><Trash2 className="w-3 h-3" /></button>
        </div>
      )}
    </div>
  );
}

// ── Asset panel ───────────────────────────────────────────────────────────────

function AssetPanel({
  assets: initialAssets,
  assignments,
  draggingAsset,
  draggingAssignment,
  onJobDragStart,
  onJobDragEnd,
  onAddAsset,
  onEditAsset,
  onDeleteAsset,
  onAssetsReordered,
}: {
  assets: PlannerAsset[];
  assignments: PlannerAssignment[];
  draggingAsset: PlannerAsset | null;
  draggingAssignment: PlannerAssignment | null;
  onJobDragStart: (a: PlannerAsset) => void;
  onJobDragEnd: () => void;
  onAddAsset: () => void;
  onEditAsset: (a: PlannerAsset) => void;
  onDeleteAsset: (a: PlannerAsset) => void;
  onAssetsReordered: (ordered: PlannerAsset[]) => void;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [reorderMode, setReorderMode] = useState(false);
  // Local ordered list — we optimistically reorder then persist
  const [assets, setAssets] = useState<PlannerAsset[]>(initialAssets);
  // Keep in sync when parent refreshes (after add/edit/delete)
  useEffect(() => { setAssets(initialAssets); }, [initialAssets]);

  const reorderDragId = useRef<number | null>(null);
  // "insert before" target: asset id, or 'end' to append at end of list
  const [reorderOverId, setReorderOverId] = useState<number | 'end' | null>(null);

  // Build set of (asset_id, date) combos that are booked
  const bookedMap: Record<number, Set<string>> = {};
  for (const a of assignments) {
    if (!bookedMap[a.asset_id]) bookedMap[a.asset_id] = new Set();
    bookedMap[a.asset_id].add(a.assigned_date);
  }

  // targetId: insert dragged item BEFORE this id; 'end' = append at end
  function handleReorderDrop(targetId: number | 'end') {
    const dragId = reorderDragId.current;
    reorderDragId.current = null;
    setReorderOverId(null);
    if (!dragId) return;
    if (targetId !== 'end' && dragId === targetId) return;
    const next = [...assets];
    const fromIdx = next.findIndex(a => a.id === dragId);
    if (fromIdx === -1) return;
    const [moved] = next.splice(fromIdx, 1);
    if (targetId === 'end') {
      next.push(moved);
    } else {
      const toIdx = next.findIndex(a => a.id === targetId);
      if (toIdx === -1) { next.push(moved); }
      else { next.splice(toIdx, 0, moved); }
    }
    const reindexed = next.map((a, i) => ({ ...a, sort_order: i + 1 }));
    setAssets(reindexed);
    onAssetsReordered(reindexed);
  }

  const drivers    = assets.filter(a => a.type === 'staff' && a.role === 'driver');
  const porters    = assets.filter(a => a.type === 'staff' && a.role === 'porter');
  const otherStaff = assets.filter(a => a.type === 'staff' && a.role !== 'driver' && a.role !== 'porter');
  const vehicles   = assets.filter(a => a.type === 'vehicle');

  const toggle = (k: string) => setCollapsed(p => ({ ...p, [k]: !p[k] }));

  function Group({ title, items, groupKey, icon }: { title: string; items: PlannerAsset[]; groupKey: string; icon: React.ReactNode }) {
    return (
      <div>
        <button
          onClick={() => toggle(groupKey)}
          className="w-full flex items-center justify-between px-1 py-1 text-xs font-semibold text-slate-500 uppercase tracking-wider hover:text-slate-700"
        >
          <span className="flex items-center gap-1.5">{icon}{title} <span className="font-normal normal-case text-slate-400">({items.length})</span></span>
          <ChevronRight className={`w-3 h-3 transition-transform ${collapsed[groupKey] ? '' : 'rotate-90'}`} />
        </button>
        {!collapsed[groupKey] && (
          <div
            className="mt-1"
            onDragOver={e => {
              if (!reorderMode || !reorderDragId.current) return;
              e.preventDefault();
              // Only set 'end' if the event target is the container itself, not a child chip
              if (e.currentTarget === e.target) setReorderOverId('end');
            }}
            onDrop={e => {
              if (!reorderMode) return;
              e.stopPropagation();
              handleReorderDrop('end');
            }}
          >
            {items.length === 0 && <p className="text-xs text-slate-400 px-1 pb-1">None added yet</p>}
            {items.map(a => (
              <div key={a.id}>
                {/* Gap line: appears above this chip when it's the insert-before target */}
                {reorderMode && reorderOverId === a.id && reorderDragId.current !== a.id && (
                  <div className="h-0.5 mx-1 rounded-full bg-indigo-400 my-1" />
                )}
                <AssetChip
                  asset={a}
                  reorderMode={reorderMode}
                  isReorderTarget={false}
                  onJobDragStart={() => onJobDragStart(a)}
                  onJobDragEnd={onJobDragEnd}
                  onReorderDragStart={() => { reorderDragId.current = a.id; }}
                  onReorderDragOver={() => {
                    if (reorderDragId.current && reorderDragId.current !== a.id) setReorderOverId(a.id);
                  }}
                  onReorderDrop={() => handleReorderDrop(a.id)}
                  onReorderDragEnd={() => setReorderOverId(null)}
                  onEdit={() => onEditAsset(a)}
                  onDelete={() => onDeleteAsset(a)}
                />
              </div>
            ))}
            {/* Gap line at end of list */}
            {reorderMode && reorderOverId === 'end' && items.length > 0 && (
              <div className="h-0.5 mx-1 rounded-full bg-indigo-400 my-1" />
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="w-52 flex-shrink-0 bg-white border-r border-slate-200 flex flex-col">
      <div className="px-3 py-3 border-b border-slate-200">
        <p className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Assets</p>
        {draggingAsset && (
          <p className="text-[10px] text-indigo-600 mt-1 font-medium">Dragging: {draggingAsset.name} — drop onto a job</p>
        )}
        {draggingAssignment && (
          <p className="text-[10px] text-amber-600 mt-1 font-medium">Moving: {draggingAssignment.asset_name} — drop onto another job</p>
        )}
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        <Group title="Drivers"  items={drivers}    groupKey="drivers"  icon={<Users className="w-3 h-3" />} />
        <Group title="Porters"  items={porters}    groupKey="porters"  icon={<Users className="w-3 h-3" />} />
        {otherStaff.length > 0 && <Group title="Staff" items={otherStaff} groupKey="staff" icon={<Users className="w-3 h-3" />} />}
        <Group title="Vehicles" items={vehicles}   groupKey="vehicles" icon={<Truck className="w-3 h-3" />} />
      </div>
      <div className="px-3 py-3 border-t border-slate-200 space-y-1.5">
        {reorderMode && (
          <p className="text-[10px] text-indigo-600 font-medium text-center pb-1">
            Drag to reorder — click Done when finished
          </p>
        )}
        <button
          onClick={onAddAsset}
          className="w-full flex items-center gap-2 px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 rounded-lg border border-dashed border-slate-300 hover:border-slate-400 transition-colors"
        >
          <Plus className="w-3 h-3" />Add asset
        </button>
        <button
          onClick={() => setReorderMode(m => !m)}
          className={`w-full flex items-center gap-2 px-2 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
            reorderMode
              ? 'bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700'
              : 'text-slate-600 hover:bg-slate-50 border-dashed border-slate-300 hover:border-slate-400'
          }`}
        >
          <GripVertical className="w-3 h-3" />
          {reorderMode ? 'Done reordering' : 'Change order'}
        </button>
      </div>
    </div>
  );
}

// ── Assignment chip ───────────────────────────────────────────────────────────

function AssignmentChip({
  a, onRemove, onDragStart, onDragEnd,
}: {
  a: PlannerAssignment;
  onRemove: () => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}) {
  return (
    <span
      data-assignment-chip
      draggable={!!onDragStart}
      onDragStart={e => { e.stopPropagation(); e.dataTransfer.setData('text/plain', '1'); setTimeout(() => onDragStart?.(), 0); }}
      onDragEnd={onDragEnd}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium transition-opacity select-none ${
        onDragStart ? 'cursor-grab active:cursor-grabbing active:opacity-50' : ''
      } ${a.asset_type === 'staff' ? 'bg-indigo-100 text-indigo-700' : 'bg-teal-100 text-teal-700'}`}
    >
      <GripVertical className="w-2.5 h-2.5 opacity-30" />
      {a.asset_type === 'staff' ? <Users className="w-3 h-3" /> : <Truck className="w-3 h-3" />}
      {a.asset_name}
      {a.asset_role && <span className="text-[10px] opacity-60 ml-0.5 capitalize">({a.asset_role})</span>}
      <button
        onClick={e => { e.stopPropagation(); onRemove(); }}
        className="ml-0.5 opacity-60 hover:opacity-100"
      >
        <X className="w-2.5 h-2.5" />
      </button>
    </span>
  );
}

// ── Staff assignment row (expanded card) ─────────────────────────────────────

function StaffAssignmentRow({
  a,
  vehicleAssignments,
  onRemove,
  onUpdateRate,
  onUpdateVehicle,
  onDragStart,
  onDragEnd,
}: {
  a: PlannerAssignment;
  vehicleAssignments: PlannerAssignment[];
  onRemove: () => void;
  onUpdateRate: (rate: number) => void;
  onUpdateVehicle: (vehicleAssetId: number | null) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}) {
  const [editingRate, setEditingRate] = useState(false);
  const [rateInput, setRateInput] = useState('');
  const isDriver = (a.assigned_role ?? a.asset_role) === 'driver';

  function commitRate() {
    const n = parseFloat(rateInput);
    if (!isNaN(n) && n >= 0) onUpdateRate(n);
    setEditingRate(false);
  }

  return (
    <div
      data-assignment-chip
      draggable={!!onDragStart}
      onDragStart={e => { e.stopPropagation(); e.dataTransfer.setData('text/plain', '1'); setTimeout(() => onDragStart?.(), 0); }}
      onDragEnd={onDragEnd}
      className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-indigo-50 border border-indigo-100 text-xs select-none ${onDragStart ? 'cursor-grab active:cursor-grabbing active:opacity-50' : ''}`}
    >
      <GripVertical className="w-3 h-3 text-indigo-200 flex-shrink-0" />
      <Users className="w-3 h-3 text-indigo-400 flex-shrink-0" />
      <span className="font-medium text-indigo-700 flex-1 min-w-0 truncate">{a.asset_name}</span>

      {/* Daily rate badge / editor */}
      {editingRate ? (
        <span className="flex items-center gap-0.5 flex-shrink-0">
          <span className="text-[10px] text-slate-400">£</span>
          <input
            type="number" min="0" step="5" autoFocus
            value={rateInput}
            onChange={e => setRateInput(e.target.value)}
            onBlur={commitRate}
            onKeyDown={e => { if (e.key === 'Enter') commitRate(); if (e.key === 'Escape') setEditingRate(false); }}
            className="w-10 text-[10px] border-b border-indigo-300 bg-transparent outline-none text-slate-700"
          />
          <span className="text-[10px] text-slate-400">/day</span>
        </span>
      ) : (
        <button
          onClick={e => { e.stopPropagation(); setRateInput(String(a.daily_rate ?? '')); setEditingRate(true); }}
          title="Click to edit daily rate"
          className="flex items-center gap-0.5 flex-shrink-0 text-[10px] bg-white border border-indigo-100 rounded px-1.5 py-0.5 text-slate-600 hover:border-indigo-300 hover:text-indigo-700 transition-colors"
        >
          {a.daily_rate != null ? `£${a.daily_rate}/day` : <span className="text-slate-400 italic">+rate</span>}
          <Edit2 className="w-2.5 h-2.5 opacity-40 ml-0.5" />
        </button>
      )}

      {/* Vehicle dropdown for drivers */}
      {isDriver && vehicleAssignments.length > 0 && (
        <select
          value={a.vehicle_asset_id != null ? String(a.vehicle_asset_id) : ''}
          onChange={e => { e.stopPropagation(); onUpdateVehicle(e.target.value ? Number(e.target.value) : null); }}
          onClick={e => e.stopPropagation()}
          className="flex-shrink-0 text-[10px] border border-slate-200 rounded bg-white text-slate-600 py-0.5 px-1 max-w-[76px] hover:border-indigo-300 focus:outline-none focus:border-indigo-300"
        >
          <option value="">No van</option>
          {vehicleAssignments.map(v => (
            <option key={v.asset_id} value={String(v.asset_id)}>{v.asset_name}</option>
          ))}
        </select>
      )}
      {isDriver && vehicleAssignments.length === 0 && (
        <span className="flex-shrink-0 text-[10px] text-slate-300 italic">no vans</span>
      )}

      <button onClick={e => { e.stopPropagation(); onRemove(); }} className="flex-shrink-0 text-indigo-200 hover:text-red-500 transition-colors">
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

// ── Job card (weekly view) ────────────────────────────────────────────────────

function JobCard({
  cardKey,
  item,
  isExpanded,
  onToggle,
  dragOverZone,
  onDragOver,
  onDragLeave,
  onDropStaff,
  onDropDriver,
  onDropPorter,
  onDropVehicle,
  onRemoveAssignment,
  onAssignmentDragStart,
  onAssignmentDragEnd,
  onUpdateAssignment,
  hasActiveDrag,
  onCardDragStart,
  onCardDragEnd,
  onEditEvent,
  onDeleteEvent,
  onDuplicate,
  navigate,
}: {
  cardKey: string;
  item: PlannerCalendarItem;
  isExpanded: boolean;
  onToggle: () => void;
  dragOverZone: string | null;
  onDragOver: (zone: string) => void;
  onDragLeave: () => void;
  onDropStaff: () => void;
  onDropDriver: () => void;
  onDropPorter: () => void;
  onDropVehicle: () => void;
  onRemoveAssignment: (id: number) => void;
  onAssignmentDragStart: (a: PlannerAssignment) => void;
  onAssignmentDragEnd: () => void;
  onUpdateAssignment: (id: number, data: { daily_rate?: number | null; vehicle_asset_id?: number | null }) => void;
  hasActiveDrag: boolean;
  onCardDragStart: () => void;
  onCardDragEnd: () => void;
  onEditEvent?: () => void;
  onDeleteEvent?: () => void;
  onDuplicate: () => void;
  navigate: (path: string) => void;
}) {
  const c = catColor(item.category);
  const staffAssignments   = (item.assignments || []).filter(a => a.asset_type === 'staff');
  const vehicleAssignments = (item.assignments || []).filter(a => a.asset_type === 'vehicle');
  const driverAssignments  = staffAssignments.filter(a => (a.assigned_role ?? a.asset_role) === 'driver');
  const porterAssignments  = staffAssignments.filter(a => (a.assigned_role ?? a.asset_role) !== 'driver');

  return (
    <div
      draggable
      onDragStart={e => {
        // Don't trigger card drag if dragging an assignment chip inside
        if ((e.target as HTMLElement).closest('[data-assignment-chip]')) { e.preventDefault(); return; }
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', '1');
        setTimeout(() => onCardDragStart(), 0);
      }}
      onDragEnd={onCardDragEnd}
      className={`rounded-lg border transition-all duration-150 cursor-grab active:cursor-grabbing active:opacity-70 ${
        isExpanded ? 'border-indigo-300 shadow-md' : 'border-slate-200 hover:border-slate-300 hover:shadow-sm'
      } bg-white overflow-hidden`}
    >
      {/* Header (always visible) */}
      <button
        onClick={onToggle}
        className="w-full text-left px-3 py-2.5 flex items-start gap-2"
      >
        <span className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5" style={{ background: c.dot }} />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-slate-800 truncate">{item.title}</p>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            <CatBadge cat={item.category} size="xs" />
            {item.time && <span className="text-[10px] text-slate-400">{item.time}</span>}
            {(staffAssignments.length + vehicleAssignments.length) > 0 && (
              <span className="text-[10px] text-slate-400 flex items-center gap-0.5">
                <Users className="w-2.5 h-2.5" />{staffAssignments.length}
                <Truck className="w-2.5 h-2.5 ml-0.5" />{vehicleAssignments.length}
              </span>
            )}
          </div>
        </div>
      </button>

      {/* Mini drop targets shown on collapsed card when a drag is in flight */}
      {hasActiveDrag && !isExpanded && (
        <div className="flex gap-1 px-2 pb-2">
          <div
            onDragOver={e => { e.preventDefault(); onDragOver('staff'); }}
            onDragLeave={onDragLeave}
            onDrop={e => { e.preventDefault(); onDropStaff(); }}
            className={`flex-1 h-7 rounded border-2 border-dashed flex items-center justify-center gap-1 text-[10px] font-medium transition-colors ${
              dragOverZone === `${cardKey}|staff`
                ? 'border-indigo-400 bg-indigo-50 text-indigo-600'
                : 'border-slate-200 text-slate-400 hover:border-slate-300'
            }`}
          >
            <Users className="w-2.5 h-2.5" />
            {dragOverZone === `${cardKey}|staff` ? 'Drop here' : 'Staff'}
          </div>
          <div
            onDragOver={e => { e.preventDefault(); onDragOver('vehicle'); }}
            onDragLeave={onDragLeave}
            onDrop={e => { e.preventDefault(); onDropVehicle(); }}
            className={`flex-1 h-7 rounded border-2 border-dashed flex items-center justify-center gap-1 text-[10px] font-medium transition-colors ${
              dragOverZone === `${cardKey}|vehicle`
                ? 'border-teal-400 bg-teal-50 text-teal-600'
                : 'border-slate-200 text-slate-400 hover:border-slate-300'
            }`}
          >
            <Truck className="w-2.5 h-2.5" />
            {dragOverZone === `${cardKey}|vehicle` ? 'Drop here' : 'Van'}
          </div>
        </div>
      )}

      {/* Expanded detail */}
      {isExpanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-slate-100">
          {/* Info grid */}
          <div className="pt-2 space-y-1.5 text-xs text-slate-600">
            {item.phone && <p><span className="text-slate-400">Phone:</span> {item.phone}</p>}
            {(item.from_line1 || item.from_postcode) && (
              <p><span className="text-slate-400">From:</span> {[item.from_line1, item.from_city, item.from_postcode].filter(Boolean).join(', ')}</p>
            )}
            {(item.to_line1 || item.to_postcode) && (
              <p><span className="text-slate-400">To:</span> {[item.to_line1, item.to_city, item.to_postcode].filter(Boolean).join(', ')}</p>
            )}
            {item.contract_name && <p><span className="text-slate-400">Contractor:</span> <span className="font-medium text-indigo-700">{item.contract_name}</span></p>}
            {item.address && <p><span className="text-slate-400">Address:</span> {item.address}</p>}
            {item.bedrooms && <p><span className="text-slate-400">Bedrooms:</span> {item.bedrooms}</p>}
            {item.notes && <p><span className="text-slate-400">Notes:</span> {item.notes}</p>}
            {item.internal_notes && <p><span className="text-slate-400">Internal:</span> {item.internal_notes}</p>}
            <div className="flex gap-2">
              {item.packing_required  ? <span className="px-1.5 py-0.5 bg-purple-50 text-purple-700 rounded text-[10px]">Packing</span> : null}
              {item.storage_required  ? <span className="px-1.5 py-0.5 bg-sky-50 text-sky-700 rounded text-[10px]">Storage</span> : null}
            </div>
          </div>

          {/* Drivers drop zone */}
          <div>
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1">
              <Users className="w-3 h-3" />Drivers
              <span className="font-normal normal-case text-slate-400 ml-0.5">£150/day</span>
            </p>
            <div
              onDragOver={e => { e.preventDefault(); onDragOver('driver'); }}
              onDragLeave={onDragLeave}
              onDrop={e => { e.preventDefault(); onDropDriver(); }}
              className={`min-h-[36px] rounded-lg border-2 border-dashed p-1.5 flex flex-col gap-1 transition-colors ${
                dragOverZone === `${cardKey}|driver`
                  ? 'border-indigo-400 bg-indigo-50'
                  : 'border-slate-200 bg-slate-50'
              }`}
            >
              {driverAssignments.map(a => (
                <StaffAssignmentRow
                  key={a.id} a={a}
                  vehicleAssignments={vehicleAssignments}
                  onRemove={() => onRemoveAssignment(a.id)}
                  onUpdateRate={rate => onUpdateAssignment(a.id, { daily_rate: rate })}
                  onUpdateVehicle={vid => onUpdateAssignment(a.id, { vehicle_asset_id: vid })}
                  onDragStart={() => onAssignmentDragStart(a)}
                  onDragEnd={onAssignmentDragEnd}
                />
              ))}
              {driverAssignments.length === 0 && dragOverZone !== `${cardKey}|driver` && (
                <span className="text-[10px] text-slate-400 self-center ml-1">Drop drivers here</span>
              )}
              {dragOverZone === `${cardKey}|driver` && (
                <span className="text-[10px] text-indigo-500 font-medium self-center ml-1">Release to assign</span>
              )}
            </div>
          </div>

          {/* Porters drop zone */}
          <div>
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1">
              <Users className="w-3 h-3" />Porters
              <span className="font-normal normal-case text-slate-400 ml-0.5">£125/day</span>
            </p>
            <div
              onDragOver={e => { e.preventDefault(); onDragOver('porter'); }}
              onDragLeave={onDragLeave}
              onDrop={e => { e.preventDefault(); onDropPorter(); }}
              className={`min-h-[36px] rounded-lg border-2 border-dashed p-1.5 flex flex-col gap-1 transition-colors ${
                dragOverZone === `${cardKey}|porter`
                  ? 'border-violet-400 bg-violet-50'
                  : 'border-slate-200 bg-slate-50'
              }`}
            >
              {porterAssignments.map(a => (
                <StaffAssignmentRow
                  key={a.id} a={a}
                  vehicleAssignments={vehicleAssignments}
                  onRemove={() => onRemoveAssignment(a.id)}
                  onUpdateRate={rate => onUpdateAssignment(a.id, { daily_rate: rate })}
                  onUpdateVehicle={vid => onUpdateAssignment(a.id, { vehicle_asset_id: vid })}
                  onDragStart={() => onAssignmentDragStart(a)}
                  onDragEnd={onAssignmentDragEnd}
                />
              ))}
              {porterAssignments.length === 0 && dragOverZone !== `${cardKey}|porter` && (
                <span className="text-[10px] text-slate-400 self-center ml-1">Drop porters here</span>
              )}
              {dragOverZone === `${cardKey}|porter` && (
                <span className="text-[10px] text-violet-500 font-medium self-center ml-1">Release to assign</span>
              )}
            </div>
          </div>

          {/* Vehicle drop zone */}
          <div>
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1"><Truck className="w-3 h-3" />Vehicles</p>
            <div
              onDragOver={e => { e.preventDefault(); onDragOver('vehicle'); }}
              onDragLeave={onDragLeave}
              onDrop={e => { e.preventDefault(); onDropVehicle(); }}
              className={`min-h-[36px] rounded-lg border-2 border-dashed p-1.5 flex flex-wrap gap-1 transition-colors ${
                dragOverZone === `${cardKey}|vehicle`
                  ? 'border-teal-400 bg-teal-50'
                  : 'border-slate-200 bg-slate-50'
              }`}
            >
              {vehicleAssignments.map(a => (
                <AssignmentChip
                  key={a.id} a={a}
                  onRemove={() => onRemoveAssignment(a.id)}
                  onDragStart={() => onAssignmentDragStart(a)}
                  onDragEnd={onAssignmentDragEnd}
                />
              ))}
              {vehicleAssignments.length === 0 && dragOverZone !== `${cardKey}|vehicle` && (
                <span className="text-[10px] text-slate-400 self-center ml-1">Drop vehicles here</span>
              )}
              {dragOverZone === `${cardKey}|vehicle` && (
                <span className="text-[10px] text-teal-500 font-medium self-center ml-1">Release to assign</span>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2">
              {item.source === 'job' && (
                <button
                  onClick={() => navigate(`/admin/crm/${item.id}`)}
                  className="text-[10px] text-indigo-600 hover:underline"
                >
                  Open job record →
                </button>
              )}
              {item.source === 'event' && (
                <>
                  <button
                    onClick={e => { e.stopPropagation(); onEditEvent?.(); }}
                    className="flex items-center gap-1 text-[10px] font-medium text-slate-500 hover:text-slate-700 transition-colors"
                  >
                    <Edit2 className="w-3 h-3" />Edit
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); onDeleteEvent?.(); }}
                    className="flex items-center gap-1 text-[10px] font-medium text-red-400 hover:text-red-600 transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />Delete
                  </button>
                </>
              )}
            </div>
            {item.source === 'event' && (
              <button
                onClick={e => { e.stopPropagation(); onDuplicate(); }}
                className="flex items-center gap-1 text-[10px] font-medium text-slate-400 hover:text-indigo-600 transition-colors"
                title="Duplicate this job"
              >
                <Copy className="w-3 h-3" />Duplicate
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Weekly view ───────────────────────────────────────────────────────────────

function WeeklyView({
  weekDates,
  items,
  assets,
  assignments,
  expandedKeys,
  setExpandedKeys,
  draggingAsset,
  setDraggingAsset,
  draggingAssignment,
  setDraggingAssignment,
  draggingJobCard,
  setDraggingJobCard,
  dragOverZone,
  setDragOverZone,
  onDrop,
  onReschedule,
  onRemoveAssignment,
  onUpdateAssignment,
  onAddAsset,
  onEditAsset,
  onDeleteAsset,
  onAssetsReordered,
  onAddQuickJob,
  onEditEvent,
  onDeleteEvent,
  onDuplicate,
  navigate,
}: {
  weekDates: string[];
  items: PlannerCalendarItem[];
  assets: PlannerAsset[];
  assignments: PlannerAssignment[];
  expandedKeys: Set<string>;
  setExpandedKeys: React.Dispatch<React.SetStateAction<Set<string>>>;
  draggingAsset: PlannerAsset | null;
  setDraggingAsset: (a: PlannerAsset | null) => void;
  draggingAssignment: PlannerAssignment | null;
  setDraggingAssignment: (a: PlannerAssignment | null) => void;
  draggingJobCard: PlannerCalendarItem | null;
  setDraggingJobCard: (item: PlannerCalendarItem | null) => void;
  dragOverZone: string | null;
  setDragOverZone: (z: string | null) => void;
  onDrop: (item: PlannerCalendarItem, zone: 'driver' | 'porter' | 'staff' | 'vehicle') => void;
  onReschedule: (item: PlannerCalendarItem, newDate: string) => void;
  onRemoveAssignment: (id: number) => void;
  onUpdateAssignment: (id: number, data: { daily_rate?: number | null; vehicle_asset_id?: number | null }) => void;
  onAddAsset: () => void;
  onEditAsset: (a: PlannerAsset) => void;
  onDeleteAsset: (a: PlannerAsset) => void;
  onAssetsReordered: (ordered: PlannerAsset[]) => void;
  onAddQuickJob: (date: string) => void;
  onEditEvent: (item: PlannerCalendarItem) => void;
  onDeleteEvent: (item: PlannerCalendarItem) => void;
  onDuplicate: (item: PlannerCalendarItem) => void;
  navigate: (path: string) => void;
}) {
  const itemsByDate: Record<string, PlannerCalendarItem[]> = {};
  for (const item of items) {
    if (!item.date) continue;
    if (!itemsByDate[item.date]) itemsByDate[item.date] = [];
    itemsByDate[item.date].push(item);
  }

  const today = toISO(new Date());
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);

  // ── Within-day ordering (localStorage-backed) ────────────────────────────
  const [dayOrders, setDayOrders] = useState<Record<string, string[]>>(() => {
    try { return JSON.parse(localStorage.getItem('planner-day-orders') || '{}'); }
    catch { return {}; }
  });

  function saveDayOrders(next: Record<string, string[]>) {
    setDayOrders(next);
    localStorage.setItem('planner-day-orders', JSON.stringify(next));
  }

  function getSortedItems(date: string, raw: PlannerCalendarItem[]): PlannerCalendarItem[] {
    const order = dayOrders[date];
    if (!order?.length) return raw;
    const map = new Map(raw.map(i => [`${i.source}-${i.id}`, i]));
    const sorted: PlannerCalendarItem[] = [];
    for (const k of order) { const i = map.get(k); if (i) { sorted.push(i); map.delete(k); } }
    for (const i of map.values()) sorted.push(i); // items not yet in stored order
    return sorted;
  }

  // [gapOverKey] = "date|index" e.g. "2025-04-14|2"
  const [gapOverKey, setGapOverKey] = useState<string | null>(null);

  function handleGapDrop(targetDate: string, targetIndex: number) {
    const item = draggingJobCard;
    if (!item) return;
    setDraggingJobCard(null);
    setDragOverDate(null);
    setGapOverKey(null);

    const itemKey = `${item.source}-${item.id}`;
    const isDifferentDate = targetDate !== item.date;

    // Build new order for target date (insert at targetIndex)
    const targetRaw = itemsByDate[targetDate] || [];
    const targetSorted = getSortedItems(targetDate, targetRaw).map(i => `${i.source}-${i.id}`).filter(k => k !== itemKey);
    targetSorted.splice(targetIndex, 0, itemKey);

    // Build new order for source date (remove item)
    const sourceRaw = itemsByDate[item.date] || [];
    const sourceSorted = getSortedItems(item.date, sourceRaw).map(i => `${i.source}-${i.id}`).filter(k => k !== itemKey);

    const updatedOrders = { ...dayOrders, [targetDate]: targetSorted };
    if (isDifferentDate) updatedOrders[item.date] = sourceSorted;
    saveDayOrders(updatedOrders);

    if (isDifferentDate) onReschedule(item, targetDate);
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      <AssetPanel
        assets={assets}
        assignments={assignments}
        draggingAsset={draggingAsset}
        draggingAssignment={draggingAssignment}
        onJobDragStart={setDraggingAsset}
        onJobDragEnd={() => setDraggingAsset(null)}
        onAddAsset={onAddAsset}
        onEditAsset={onEditAsset}
        onDeleteAsset={onDeleteAsset}
        onAssetsReordered={onAssetsReordered}
      />

      {/* Day columns */}
      <div className="flex-1 overflow-x-auto">
        <div className="flex min-w-[700px] h-full">
          {weekDates.map(date => {
            const rawItems = itemsByDate[date] || [];
            const dayItems = getSortedItems(date, rawItems);
            const isToday = date === today;
            const isDraggingHere = !!draggingJobCard && dragOverDate === date && !gapOverKey;
            const [, , day] = date.split('-');
            const dayName = new Date(date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short' });

            // Gap line rendered between items (and before first / after last) when job card is being dragged
            const Gap = ({ index }: { index: number }) => {
              const key = `${date}|${index}`;
              const isOver = gapOverKey === key;
              return (
                <div
                  className="relative py-1 -my-0.5 z-10"
                  onDragOver={e => { if (!draggingJobCard) return; e.preventDefault(); e.stopPropagation(); setGapOverKey(key); setDragOverDate(date); }}
                  onDragLeave={() => { if (gapOverKey === key) setGapOverKey(null); }}
                  onDrop={e => { e.preventDefault(); e.stopPropagation(); handleGapDrop(date, index); }}
                >
                  <div className={`h-0.5 rounded-full mx-1 transition-all ${isOver ? 'bg-indigo-400 scale-y-150' : 'bg-transparent'}`} />
                </div>
              );
            };

            return (
              <div
                key={date}
                className={`flex-1 border-r border-slate-200 flex flex-col transition-colors ${
                  isDraggingHere ? 'bg-indigo-50/60' : isToday ? 'bg-indigo-50/30' : 'bg-white'
                }`}
                onDragOver={e => { if (!draggingJobCard) return; e.preventDefault(); setDragOverDate(date); }}
                onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) { setDragOverDate(null); setGapOverKey(null); } }}
                onDrop={e => {
                  // Fallback: drop on empty space → append at end
                  if (!draggingJobCard || gapOverKey) return;
                  e.preventDefault();
                  handleGapDrop(date, dayItems.length);
                }}
              >
                {/* Day header */}
                <div className={`px-2 py-2.5 border-b border-slate-200 text-center transition-colors ${
                  isDraggingHere ? 'bg-indigo-100' : isToday ? 'bg-indigo-50' : ''
                }`}>
                  <p className="text-[10px] font-semibold text-slate-500 uppercase">{dayName}</p>
                  <p className={`text-lg font-bold ${isToday || isDraggingHere ? 'text-indigo-600' : 'text-slate-800'}`}>{parseInt(day, 10)}</p>
                  {isDraggingHere && <p className="text-[10px] text-indigo-500 font-medium mt-0.5">Drop to move here</p>}
                </div>

                {/* Items */}
                <div className="flex-1 overflow-y-auto p-1.5">
                  {/* Empty column */}
                  {dayItems.length === 0 && !draggingJobCard && (
                    <button
                      onClick={() => onAddQuickJob(date)}
                      className="w-full flex items-center justify-center rounded-xl border-2 border-dashed border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/50 text-slate-300 hover:text-indigo-400 transition-colors py-4"
                    >
                      <Plus className="w-5 h-5" />
                    </button>
                  )}
                  {dayItems.length === 0 && draggingJobCard && (
                    <Gap index={0} />
                  )}

                  {/* Gap before first item */}
                  {dayItems.length > 0 && draggingJobCard && <Gap index={0} />}

                  {dayItems.map((item, idx) => {
                    const key = `${item.source}-${item.id}-${date}`;
                    const isExpanded = expandedKeys.has(key);
                    const hasActiveDrag = !!(draggingAsset || draggingAssignment);
                    const isBeingDragged = draggingJobCard?.source === item.source && draggingJobCard?.id === item.id;
                    return (
                      <div key={key} className={isBeingDragged ? 'opacity-40' : ''}>
                        <JobCard
                          cardKey={key}
                          item={item}
                          isExpanded={isExpanded}
                          onToggle={() => setExpandedKeys(prev => {
                            const next = new Set(prev);
                            if (next.has(key)) next.delete(key); else next.add(key);
                            return next;
                          })}
                          dragOverZone={(isExpanded || hasActiveDrag) ? dragOverZone : null}
                          onDragOver={zone => { setDragOverZone(`${key}|${zone}`); }}
                          onDragLeave={() => setDragOverZone(null)}
                          onDropStaff={() => { if (draggingAsset || draggingAssignment) onDrop(item, 'staff'); setDragOverZone(null); }}
                          onDropDriver={() => { if (draggingAsset || draggingAssignment) onDrop(item, 'driver'); setDragOverZone(null); }}
                          onDropPorter={() => { if (draggingAsset || draggingAssignment) onDrop(item, 'porter'); setDragOverZone(null); }}
                          onDropVehicle={() => { if (draggingAsset || draggingAssignment) onDrop(item, 'vehicle'); setDragOverZone(null); }}
                          onRemoveAssignment={onRemoveAssignment}
                          onAssignmentDragStart={setDraggingAssignment}
                          onAssignmentDragEnd={() => setDraggingAssignment(null)}
                          onUpdateAssignment={onUpdateAssignment}
                          hasActiveDrag={hasActiveDrag}
                          onCardDragStart={() => setDraggingJobCard(item)}
                          onCardDragEnd={() => { setDraggingJobCard(null); setDragOverDate(null); setGapOverKey(null); }}
                          onEditEvent={item.source === 'event' ? () => onEditEvent(item) : undefined}
                          onDeleteEvent={item.source === 'event' ? () => onDeleteEvent(item) : undefined}
                          onDuplicate={() => onDuplicate(item)}
                          navigate={navigate}
                        />
                        {/* Gap after each item */}
                        {draggingJobCard && <Gap index={idx + 1} />}
                      </div>
                    );
                  })}

                  {/* Add button (shown when not dragging, only for days with items — empty days have their own above) */}
                  {!draggingJobCard && dayItems.length > 0 && (
                    <button
                      onClick={() => onAddQuickJob(date)}
                      className="w-full flex items-center justify-center rounded-xl border-2 border-dashed border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/50 text-slate-300 hover:text-indigo-400 transition-colors py-2 mt-1.5"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Quick job form ────────────────────────────────────────────────────────────

const EMPTY_QUICK: {
  title: string; category: string; customer_name: string; contact_number: string;
  address: string; event_date: string; event_time: string; notes: string; contract_id: string;
} = { title: '', category: 'Quick Job', customer_name: '', contact_number: '', address: '', event_date: '', event_time: '', notes: '', contract_id: '' };

function QuickJobModal({
  open, onClose, defaultDate, editItem, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  defaultDate: string;
  editItem?: PlannerCalendarItem | null;
  onSaved: (ev: PlannerEvent) => void;
}) {
  const [form, setForm] = useState({ ...EMPTY_QUICK });
  const [contracts, setContracts] = useState<{ id: number; company_name: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/contracts').then(r => setContracts(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!open) return;
    if (editItem) {
      setForm({
        title: editItem.title || '',
        category: editItem.category || 'Quick Job',
        customer_name: editItem.customer_name || '',
        contact_number: editItem.phone || '',
        address: editItem.address || '',
        event_date: editItem.date || defaultDate,
        event_time: editItem.time || '',
        notes: editItem.notes || '',
        contract_id: editItem.contract_id ? String(editItem.contract_id) : '',
      });
    } else {
      setForm({ ...EMPTY_QUICK, event_date: defaultDate });
    }
    setError('');
  }, [open, defaultDate, editItem]);

  const set = (k: keyof typeof form, v: string) => setForm(p => ({ ...p, [k]: v }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) { setError('Title is required'); return; }
    if (!form.event_date)   { setError('Date is required'); return; }
    setSaving(true); setError('');
    try {
      const payload = { ...form, contract_id: form.contract_id ? parseInt(form.contract_id, 10) : null };
      const r = editItem
        ? await api.put(`/planner/events/${editItem.id}`, payload)
        : await api.post('/planner/events', payload);
      onSaved(r.data);
      onClose();
    } catch {
      setError('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={editItem ? 'Edit Quick Job' : 'Add Quick Job'} size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
        <div className="grid grid-cols-2 gap-3">
          {contracts.length > 0 && (
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-600 mb-1">Contractor</label>
              <select className="input" value={form.contract_id} onChange={e => set('contract_id', e.target.value)}>
                <option value="">— None —</option>
                {contracts.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
              </select>
            </div>
          )}
          <div className="col-span-2">
            <label className="block text-xs font-medium text-slate-600 mb-1">Title *</label>
            <input className="input" placeholder="e.g. Box drop-off for Williams" value={form.title} onChange={e => set('title', e.target.value)} required />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Category *</label>
            <select className="input" value={form.category} onChange={e => set('category', e.target.value)}>
              {PLANNER_CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Date *</label>
            <input className="input" type="date" value={form.event_date} onChange={e => set('event_date', e.target.value)} required />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Customer name</label>
            <input className="input" placeholder="Optional" value={form.customer_name} onChange={e => set('customer_name', e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Contact number</label>
            <input className="input" placeholder="Optional" value={form.contact_number} onChange={e => set('contact_number', e.target.value)} />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-slate-600 mb-1">Address / Location</label>
            <input className="input" placeholder="Optional" value={form.address} onChange={e => set('address', e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Time (optional)</label>
            <input className="input" type="time" value={form.event_time} onChange={e => set('event_time', e.target.value)} />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
            <textarea className="input resize-none" rows={2} placeholder="Optional notes" value={form.notes} onChange={e => set('notes', e.target.value)} />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Saving…</> : <><Save className="w-4 h-4" /> Save Job</>}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ── Asset form ────────────────────────────────────────────────────────────────

const EMPTY_ASSET = {
  type: 'staff' as 'staff' | 'vehicle',
  name: '', role: 'driver', phone: '',
  make_model: '', registration: '', capacity_notes: '',
  availability: 'available', notes: '',
};

function AssetFormModal({
  open, onClose, initial, defaultType, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  initial: PlannerAsset | null;
  defaultType?: 'staff' | 'vehicle';
  onSaved: (a: PlannerAsset) => void;
}) {
  const [form, setForm] = useState({ ...EMPTY_ASSET });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      if (initial) {
        setForm({
          type: initial.type,
          name: initial.name,
          role: initial.role || 'driver',
          phone: initial.phone || '',
          make_model: initial.make_model || '',
          registration: initial.registration || '',
          capacity_notes: initial.capacity_notes || '',
          availability: initial.availability,
          notes: initial.notes || '',
        });
      } else {
        setForm({ ...EMPTY_ASSET, type: defaultType || 'staff' });
      }
      setError('');
    }
  }, [open, initial, defaultType]);

  const set = (k: keyof typeof form, v: string) => setForm(p => ({ ...p, [k]: v }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError('Name is required'); return; }
    setSaving(true); setError('');
    try {
      const payload = {
        type: form.type,
        name: form.name.trim(),
        role: form.type === 'staff' ? form.role : null,
        phone: form.type === 'staff' ? (form.phone || null) : null,
        make_model: form.type === 'vehicle' ? (form.make_model || null) : null,
        registration: form.type === 'vehicle' ? (form.registration || null) : null,
        capacity_notes: form.type === 'vehicle' ? (form.capacity_notes || null) : null,
        availability: form.availability,
        notes: form.notes || null,
      };
      const r = initial
        ? await api.put(`/planner/assets/${initial.id}`, payload)
        : await api.post('/planner/assets', payload);
      onSaved(r.data);
      onClose();
    } catch {
      setError('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={initial ? 'Edit Asset' : 'Add Asset'} size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

        {/* Type toggle */}
        {!initial && (
          <div className="flex rounded-lg border border-slate-200 overflow-hidden">
            {(['staff', 'vehicle'] as const).map(t => (
              <button
                key={t}
                type="button"
                onClick={() => set('type', t)}
                className={`flex-1 py-2 text-sm font-medium flex items-center justify-center gap-1.5 transition-colors ${
                  form.type === t ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {t === 'staff' ? <Users className="w-4 h-4" /> : <Truck className="w-4 h-4" />}
                {t === 'staff' ? 'Staff' : 'Vehicle'}
              </button>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-xs font-medium text-slate-600 mb-1">{form.type === 'staff' ? 'Full name' : 'Nickname'} *</label>
            <input className="input" placeholder={form.type === 'staff' ? 'e.g. Mark Johnson' : 'e.g. Big Van'} value={form.name} onChange={e => set('name', e.target.value)} required />
          </div>

          {form.type === 'staff' && (
            <>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Role</label>
                <select className="input" value={form.role} onChange={e => set('role', e.target.value)}>
                  <option value="driver">Driver</option>
                  <option value="porter">Porter</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Phone (optional)</label>
                <input className="input" placeholder="07700 900000" value={form.phone} onChange={e => set('phone', e.target.value)} />
              </div>
            </>
          )}

          {form.type === 'vehicle' && (
            <>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Make & Model</label>
                <input className="input" placeholder="e.g. Renault Master" value={form.make_model} onChange={e => set('make_model', e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Registration</label>
                <input className="input" placeholder="e.g. AB12 CDE" value={form.registration} onChange={e => set('registration', e.target.value)} />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">Capacity / Notes</label>
                <input className="input" placeholder="e.g. Long-wheelbase, 15 cubic metres" value={form.capacity_notes} onChange={e => set('capacity_notes', e.target.value)} />
              </div>
            </>
          )}

          <div className="col-span-2">
            <label className="block text-xs font-medium text-slate-600 mb-1">Availability</label>
            <select className="input" value={form.availability} onChange={e => set('availability', e.target.value)}>
              <option value="available">Available</option>
              <option value="unavailable">Unavailable</option>
            </select>
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-slate-600 mb-1">Notes (optional)</label>
            <textarea className="input resize-none" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Saving…</> : <><Save className="w-4 h-4" /> Save</>}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ── Item detail modal (monthly view item click) ───────────────────────────────

function ItemDetailModal({
  item, open, onClose, navigate,
}: {
  item: PlannerCalendarItem | null;
  open: boolean;
  onClose: () => void;
  navigate: (path: string) => void;
}) {
  if (!item) return null;
  return (
    <Modal open={open} onClose={onClose} title={item.title} size="sm">
      <div className="space-y-3 text-sm">
        <CatBadge cat={item.category} />
        {item.date && <p className="text-slate-600"><span className="text-slate-400">Date:</span> {fmtDate(item.date)}{item.time ? ` at ${item.time}` : ''}</p>}
        {item.phone && <p className="text-slate-600"><span className="text-slate-400">Phone:</span> {item.phone}</p>}
        {item.from_line1 && <p className="text-slate-600"><span className="text-slate-400">From:</span> {[item.from_line1, item.from_city, item.from_postcode].filter(Boolean).join(', ')}</p>}
        {item.to_line1 && <p className="text-slate-600"><span className="text-slate-400">To:</span> {[item.to_line1, item.to_city, item.to_postcode].filter(Boolean).join(', ')}</p>}
        {item.contract_name && <p className="text-slate-600"><span className="text-slate-400">Contractor:</span> <span className="font-medium text-indigo-700">{item.contract_name}</span></p>}
        {item.address && <p className="text-slate-600"><span className="text-slate-400">Address:</span> {item.address}</p>}
        {item.notes && <p className="text-slate-600"><span className="text-slate-400">Notes:</span> {item.notes}</p>}
        {item.source === 'job' && (
          <button
            onClick={() => { navigate(`/admin/crm/${item.id}`); onClose(); }}
            className="btn-primary w-full justify-center text-sm"
          >
            Open job record →
          </button>
        )}
      </div>
    </Modal>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CRMPlanner() {
  const navigate = useNavigate();

  const [view,        setView]        = useState<'month' | 'week'>('month');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [items,       setItems]       = useState<PlannerCalendarItem[]>([]);
  const [assets,      setAssets]      = useState<PlannerAsset[]>([]);
  const [assignments, setAssignments] = useState<PlannerAssignment[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [weekDates,   setWeekDates]   = useState<string[]>([]);

  // Modals
  const [showQuickJob,  setShowQuickJob]  = useState(false);
  const [quickJobDate,  setQuickJobDate]  = useState('');
  const [editEvent,     setEditEvent]     = useState<PlannerCalendarItem | null>(null);
  const [showAssetForm, setShowAssetForm] = useState(false);
  const [editAsset,     setEditAsset]     = useState<PlannerAsset | null>(null);
  const [assetInitType, setAssetInitType] = useState<'staff' | 'vehicle'>('staff');
  const [modalItem,     setModalItem]     = useState<PlannerCalendarItem | null>(null);

  // DnD
  const [draggingAsset,       setDraggingAsset]       = useState<PlannerAsset | null>(null);
  const [draggingAssignment,  setDraggingAssignment]  = useState<PlannerAssignment | null>(null);
  const [draggingJobCard,     setDraggingJobCard]     = useState<PlannerCalendarItem | null>(null);
  const [dragOverZone,        setDragOverZone]        = useState<string | null>(null);

  // Expanded card in weekly view
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  // Toast
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' | 'warning' } | null>(null);
  const showToast = useCallback((msg: string, type: 'success' | 'error' | 'warning' = 'success') => {
    setToast({ msg, type });
  }, []);

  // ── Load assets (once) ────────────────────────────────────────────────────

  const loadAssets = useCallback(async () => {
    try {
      const r = await api.get('/planner/assets');
      setAssets(r.data);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { loadAssets(); }, [loadAssets]);

  // ── Load calendar data ────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      if (view === 'month') {
        const y = currentDate.getFullYear();
        const m = currentDate.getMonth() + 1;
        const r = await api.get(`/planner/calendar?year=${y}&month=${m}`);
        setItems(r.data);
        setAssignments([]);
        setWeekDates([]);
      } else {
        const ws = getWeekStart(currentDate);
        const start = toISO(ws);
        const r = await api.get(`/planner/week?start=${start}`);
        setWeekDates(r.data.dates);
        setItems(r.data.items);
        // Flatten all assignments for asset panel "busy" indicator
        const allA: PlannerAssignment[] = r.data.items.flatMap((i: PlannerCalendarItem) => i.assignments || []);
        setAssignments(allA);
        // Expand all job cards by default
        const allKeys = new Set<string>(
          r.data.items.map((i: PlannerCalendarItem) => `${i.source}-${i.id}-${i.date}`)
        );
        setExpandedKeys(allKeys);
      }
    } catch {
      showToast('Failed to load planner data', 'error');
    } finally {
      setLoading(false);
    }
  }, [view, currentDate, showToast]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Navigation ────────────────────────────────────────────────────────────

  function prevPeriod() {
    setCurrentDate(d => {
      const nd = new Date(d);
      if (view === 'month') { nd.setMonth(nd.getMonth() - 1); }
      else { nd.setDate(nd.getDate() - 7); }
      return nd;
    });
    setExpandedKeys(new Set());
  }

  function nextPeriod() {
    setCurrentDate(d => {
      const nd = new Date(d);
      if (view === 'month') { nd.setMonth(nd.getMonth() + 1); }
      else { nd.setDate(nd.getDate() + 7); }
      return nd;
    });
    setExpandedKeys(new Set());
  }

  function switchToWeek(fromDate?: string) {
    if (fromDate) setCurrentDate(new Date(fromDate + 'T00:00:00'));
    setView('week');
    setExpandedKeys(new Set());
  }

  // ── Period label ──────────────────────────────────────────────────────────

  function periodLabel() {
    if (view === 'month') {
      return `${MONTH_NAMES[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
    }
    if (weekDates.length) {
      return `Week of ${fmtDate(weekDates[0])}`;
    }
    const ws = getWeekStart(currentDate);
    return `Week of ${fmtDate(toISO(ws))}`;
  }

  // ── Drag-and-drop handler ─────────────────────────────────────────────────

  async function handleDrop(item: PlannerCalendarItem, zone: 'driver' | 'porter' | 'staff' | 'vehicle') {
    const assignedDate = item.date;
    if (!assignedDate) return;

    const targetAssetType = zone === 'vehicle' ? 'vehicle' : 'staff';
    const defaultRate =
      zone === 'driver' ? 150 :
      zone === 'porter' ? 125 :
      zone === 'staff'  ? (draggingAsset?.role === 'driver' ? 150 : draggingAsset?.role === 'porter' ? 125 : null) :
      null;

    // ── Moving an existing assignment chip between jobs ─────────────────────
    if (draggingAssignment) {
      if (draggingAssignment.asset_type !== targetAssetType) {
        showToast(`${draggingAssignment.asset_name} is a ${draggingAssignment.asset_type} — drop into the correct zone`, 'warning');
        return;
      }
      const isSameTarget =
        (item.source === 'job'   && draggingAssignment.job_id   === item.id) ||
        (item.source === 'event' && draggingAssignment.event_id === item.id);
      if (isSameTarget) return;

      try {
        const payload: Record<string, unknown> = {
          asset_id: draggingAssignment.asset_id,
          assigned_date: assignedDate,
          assigned_role: draggingAssignment.assigned_role ?? null,
          daily_rate: draggingAssignment.daily_rate ?? null,
        };
        if (item.source === 'job')   payload.job_id   = item.id;
        if (item.source === 'event') payload.event_id = item.id;

        await api.post('/planner/assignments', payload);
        await api.delete(`/planner/assignments/${draggingAssignment.id}`);
        showToast(`${draggingAssignment.asset_name} moved to ${item.title}`, 'success');
        await loadData();
      } catch (err: unknown) {
        const status = (err as { response?: { status: number } })?.response?.status;
        if (status === 409) {
          showToast(`${draggingAssignment.asset_name} is already assigned to this job`, 'warning');
        } else {
          showToast('Failed to move assignment', 'error');
        }
      }
      return;
    }

    // ── Assigning a new asset from the panel ────────────────────────────────
    if (!draggingAsset) return;
    if (draggingAsset.type !== targetAssetType) {
      showToast(`${draggingAsset.name} is a ${draggingAsset.type} — drop into the correct zone`, 'warning');
      return;
    }

    try {
      const assignedRole =
        zone === 'driver' ? 'driver' :
        zone === 'porter' ? 'porter' :
        zone === 'staff'  ? (draggingAsset.role || null) :
        null;

      const payload: Record<string, unknown> = {
        asset_id: draggingAsset.id,
        assigned_date: assignedDate,
        assigned_role: assignedRole,
        daily_rate: defaultRate,
      };
      if (item.source === 'job')   payload.job_id   = item.id;
      if (item.source === 'event') payload.event_id = item.id;

      const r = await api.post('/planner/assignments', payload);
      if (r.data.conflict) {
        showToast(`${draggingAsset.name} is already assigned on another job this day`, 'warning');
      } else {
        showToast(`${draggingAsset.name} assigned to ${item.title}`, 'success');
      }
      await loadData();
    } catch (err: unknown) {
      const status = (err as { response?: { status: number } })?.response?.status;
      if (status === 409) {
        showToast(`${draggingAsset.name} is already assigned to this job`, 'warning');
      } else {
        showToast('Failed to assign asset', 'error');
      }
    }
  }

  async function handleUpdateAssignment(id: number, data: { daily_rate?: number | null; vehicle_asset_id?: number | null }) {
    try {
      await api.patch(`/planner/assignments/${id}`, data);
      await loadData();
    } catch {
      showToast('Failed to update assignment', 'error');
    }
  }

  async function handleRemoveAssignment(id: number) {
    try {
      await api.delete(`/planner/assignments/${id}`);
      showToast('Assignment removed', 'success');
      await loadData();
    } catch {
      showToast('Failed to remove assignment', 'error');
    }
  }

  // ── Asset CRUD ────────────────────────────────────────────────────────────

  function openAddAsset() {
    setEditAsset(null);
    setAssetInitType('staff');
    setShowAssetForm(true);
  }
  function openEditAsset(a: PlannerAsset) {
    setEditAsset(a);
    setShowAssetForm(true);
  }

  async function handleReschedule(item: PlannerCalendarItem, newDate: string) {
    if (item.date === newDate) return;
    try {
      await api.patch('/planner/reschedule', { source: item.source, id: item.id, date: newDate });
      showToast(`Moved to ${new Date(newDate + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`, 'success');
      await loadData();
    } catch {
      showToast('Failed to reschedule', 'error');
    }
  }

  async function handleDuplicate(item: PlannerCalendarItem) {
    try {
      if (item.source === 'event') {
        await api.post('/planner/events', {
          title: item.title,
          category: item.category,
          customer_name: item.customer_name || '',
          contact_number: item.phone || '',
          address: item.address || '',
          event_date: item.date,
          event_time: item.time || '',
          notes: item.notes || '',
          contract_id: item.contract_id || null,
        });
      } else {
        await api.post(`/crm/jobs/${item.id}/duplicate`);
      }
      showToast(`"${item.title}" duplicated`, 'success');
      await loadData();
    } catch {
      showToast('Failed to duplicate', 'error');
    }
  }

  async function handleDeleteEvent(item: PlannerCalendarItem) {
    if (!window.confirm(`Delete "${item.title}"?`)) return;
    try {
      await api.delete(`/planner/events/${item.id}`);
      showToast(`"${item.title}" deleted`, 'success');
      await loadData();
    } catch {
      showToast('Failed to delete', 'error');
    }
  }

  async function handleDeleteAsset(a: PlannerAsset) {
    if (!window.confirm(`Delete "${a.name}"? All assignments will also be removed.`)) return;
    try {
      await api.delete(`/planner/assets/${a.id}`);
      showToast(`${a.name} deleted`, 'success');
      await loadAssets();
      await loadData();
    } catch {
      showToast('Failed to delete asset', 'error');
    }
  }

  function handleAssetSaved(a: PlannerAsset) {
    showToast(editAsset ? `${a.name} updated` : `${a.name} added`, 'success');
    loadAssets();
  }

  async function handleAssetsReordered(ordered: PlannerAsset[]) {
    // Optimistic update already applied in AssetPanel — just persist
    setAssets(ordered);
    try {
      await api.put('/planner/assets/reorder', ordered.map(a => ({ id: a.id, sort_order: a.sort_order })));
    } catch {
      showToast('Failed to save order', 'error');
      loadAssets(); // revert on failure
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      <CRMSidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex-shrink-0 bg-white border-b border-slate-200 px-5 py-3 flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <CalendarDays className="w-5 h-5 text-slate-500 flex-shrink-0" />
            <h1 className="text-base font-semibold text-slate-900">Planner</h1>
            <span className="text-slate-400">/</span>
            <span className="text-sm text-slate-600 font-medium">{periodLabel()}</span>
          </div>

          {/* Nav controls */}
          <div className="flex items-center gap-1">
            <button onClick={prevPeriod} className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 transition-colors">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => { setCurrentDate(new Date()); setExpandedKeys(new Set()); }}
              className="px-2.5 py-1 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Today
            </button>
            <button onClick={nextPeriod} className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 transition-colors">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* View toggle */}
          <div className="flex rounded-lg border border-slate-200 overflow-hidden">
            <button
              onClick={() => { setView('month'); setExpandedKeys(new Set()); }}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${view === 'month' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
            >
              Month
            </button>
            <button
              onClick={() => switchToWeek()}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${view === 'week' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
            >
              Week
            </button>
          </div>

          {/* Add quick job */}
          <button
            onClick={() => { setQuickJobDate(toISO(new Date())); setShowQuickJob(true); }}
            className="btn-primary text-sm"
          >
            <Plus className="w-4 h-4" />
            Add quick job
          </button>
        </div>

        {/* Main area */}
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <span className="w-6 h-6 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
          </div>
        ) : view === 'month' ? (
          <MonthlyView
            currentDate={currentDate}
            items={items}
            onDayClick={date => switchToWeek(date)}
            onItemClick={item => {
              if (item.source === 'job') { navigate(`/admin/crm/${item.id}`); }
              else { setModalItem(item); }
            }}
            onAddQuickJob={date => { setQuickJobDate(date || toISO(new Date())); setShowQuickJob(true); }}
          />
        ) : (
          <WeeklyView
            weekDates={weekDates}
            items={items}
            assets={assets}
            assignments={assignments}
            expandedKeys={expandedKeys}
            setExpandedKeys={setExpandedKeys}
            draggingAsset={draggingAsset}
            setDraggingAsset={setDraggingAsset}
            draggingAssignment={draggingAssignment}
            setDraggingAssignment={setDraggingAssignment}
            draggingJobCard={draggingJobCard}
            setDraggingJobCard={setDraggingJobCard}
            dragOverZone={dragOverZone}
            setDragOverZone={setDragOverZone}
            onDrop={handleDrop}
            onReschedule={handleReschedule}
            onRemoveAssignment={handleRemoveAssignment}
            onUpdateAssignment={handleUpdateAssignment}
            onAddAsset={openAddAsset}
            onEditAsset={openEditAsset}
            onDeleteAsset={handleDeleteAsset}
            onAssetsReordered={handleAssetsReordered}
            onAddQuickJob={date => { setEditEvent(null); setQuickJobDate(date); setShowQuickJob(true); }}
            onEditEvent={item => { setEditEvent(item); setShowQuickJob(true); }}
            onDeleteEvent={handleDeleteEvent}
            onDuplicate={handleDuplicate}
            navigate={navigate}
          />
        )}
      </div>

      {/* Modals */}
      <QuickJobModal
        open={showQuickJob}
        onClose={() => { setShowQuickJob(false); setEditEvent(null); }}
        defaultDate={quickJobDate}
        editItem={editEvent}
        onSaved={() => { loadData(); showToast(editEvent ? 'Quick job updated' : 'Quick job added', 'success'); }}
      />

      <AssetFormModal
        open={showAssetForm}
        onClose={() => { setShowAssetForm(false); setEditAsset(null); }}
        initial={editAsset}
        defaultType={editAsset ? editAsset.type : assetInitType}
        onSaved={handleAssetSaved}
      />

      <ItemDetailModal
        item={modalItem}
        open={!!modalItem}
        onClose={() => setModalItem(null)}
        navigate={navigate}
      />

      {toast && (
        <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />
      )}
    </div>
  );
}
