import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ChevronLeft, ChevronRight, CalendarDays, Plus, Users, Truck,
  X, Edit2, Trash2, CheckCircle, AlertCircle, Save, GripVertical, Copy, ArrowUpRight,
} from 'lucide-react';
import CRMSidebar from '../../components/CRMSidebar';
import Modal from '../../components/Modal';
import JobPnlPanel from '../../components/JobPnlPanel';
import StaffWeekView from '../../components/StaffWeekView';
import ColorPickerPopover from '../../components/ColorPickerPopover';
import CreateContractJobModal from '../../components/CreateContractJobModal';
import api from '../../lib/api';
import type { PlannerAsset, PlannerCalendarItem, PlannerAssignment, PlannerEvent, Contract, JobDayPnl, JobLedgerLine } from '../../types';
import { fetchJobCategories, FALLBACK_CATEGORY_NAMES } from '../../lib/jobCategories';
import { catColor } from '../../lib/planner-colors';
import { offsetLabel } from '../../lib/moveSchedule';

// ── Constants ─────────────────────────────────────────────────────────────────

// CATEGORY_COLORS / catColor live in client/src/lib/planner-colors.ts so the
// Staff View can reuse the same scheme.

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

// ── Mobile detection ─────────────────────────────────────────────────────────

function useIsMobile() {
  const [mobile, setMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const fn = (e: MediaQueryListEvent) => setMobile(e.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return mobile;
}

// ── Mobile assignment zone (dropdown + add button) ────────────────────────────

function MobileAssignZone({
  label,
  colorClass,
  assignments,
  availableAssets,
  allVehicles,
  onAdd,
  onRemove,
  onUpdateVehicle,
}: {
  label: string;
  colorClass: { border: string; bg: string; text: string; btnBg: string };
  assignments: PlannerAssignment[];
  availableAssets: PlannerAsset[];
  // Global list of vehicle assets — used to populate the driver chip's van
  // dropdown. Vehicles are no longer dragged onto jobs; the dropdown lists
  // every recorded vehicle so any one can be picked per driver.
  allVehicles?: PlannerAsset[];
  onAdd: (assetId: number) => void;
  onRemove: (id: number) => void;
  onUpdateVehicle?: (id: number, vid: number | null, rateOverride?: number) => void;
}) {
  const [selectedId, setSelectedId] = useState('');

  return (
    <div>
      <p className={`text-[10px] font-bold uppercase tracking-wider mb-1.5 flex items-center gap-1 ${colorClass.text}`}>
        {label}
      </p>
      <div className="space-y-1 mb-2">
        {assignments.map(a => {
          return (
          <div
            key={a.id}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs ${colorClass.bg} ${colorClass.border}`}
          >
            <Users className="w-3 h-3 flex-shrink-0 opacity-60" />
            <span className={`font-semibold flex-1 min-w-0 truncate ${colorClass.text}`}>{a.asset_name}</span>

            {/* Vehicle picker (drivers only) — lists ALL vehicles, not job-bound */}
            {onUpdateVehicle && allVehicles && allVehicles.length > 0 && (
              <select
                value={a.vehicle_asset_id != null ? String(a.vehicle_asset_id) : ''}
                onChange={e => {
                  e.stopPropagation();
                  const vid = e.target.value ? Number(e.target.value) : null;
                  const v = vid != null ? allVehicles.find(x => x.id === vid) : null;
                  // Lorry bonus: +£30 on top of the £150 driver default. Only auto-adjust
                  // when the current rate is a default (null/150/180); custom edits stay.
                  const cur = a.daily_rate;
                  const isDefaultRate = cur == null || cur === 150 || cur === 180;
                  const rateOverride = isDefaultRate
                    ? (v && v.is_lorry ? 180 : 150)
                    : undefined;
                  onUpdateVehicle(a.id, vid, rateOverride);
                }}
                onClick={e => e.stopPropagation()}
                className="flex-shrink-0 text-[10px] border border-slate-200 rounded bg-white text-slate-600 py-0.5 px-1 max-w-[76px]"
              >
                <option value="">No van</option>
                {allVehicles.map(v => (
                  <option key={v.id} value={String(v.id)}>{v.name}</option>
                ))}
              </select>
            )}

            <button
              onClick={e => { e.stopPropagation(); onRemove(a.id); }}
              className="flex-shrink-0 opacity-50 hover:opacity-100 hover:text-red-500 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          );
        })}
      </div>

      {availableAssets.length > 0 && (
        <div className="flex gap-2">
          <select
            value={selectedId}
            onChange={e => setSelectedId(e.target.value)}
            onClick={e => e.stopPropagation()}
            className="flex-1 text-xs border border-slate-200 rounded-lg px-2.5 py-2 bg-white text-slate-700 focus:outline-none focus:border-indigo-300"
          >
            <option value="">Select {label.toLowerCase()}…</option>
            {availableAssets.map(a => (
              <option key={a.id} value={String(a.id)}>{a.name}</option>
            ))}
          </select>
          <button
            onClick={e => {
              e.stopPropagation();
              if (!selectedId) return;
              onAdd(parseInt(selectedId));
              setSelectedId('');
            }}
            disabled={!selectedId}
            className={`px-3 py-2 text-xs font-semibold rounded-lg text-white transition-opacity disabled:opacity-35 ${colorClass.btnBg}`}
          >
            Add
          </button>
        </div>
      )}
      {availableAssets.length === 0 && assignments.length === 0 && (
        <p className="text-[10px] text-slate-400 italic">None available</p>
      )}
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
  // Additional move days (packing, delivery, …) are read-only markers — give
  // them a dashed outline so they read as "linked extra day", not a main move.
  const extra = item.is_extra_day ? 'border border-dashed border-slate-400/70' : '';
  return (
    <button
      onClick={e => { e.stopPropagation(); onClick(); }}
      title={item.is_extra_day ? `Additional move day (${item.schedule_offset != null ? offsetLabel(item.schedule_offset) : 'extra day'})` : undefined}
      className={`w-full text-left px-1.5 py-0.5 rounded text-[11px] font-medium truncate transition-opacity hover:opacity-75 ${c.bg} ${c.text} ${extra}`}
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

// ── Staff assignment row (expanded card) ─────────────────────────────────────

function StaffAssignmentRow({
  a,
  allVehicles,
  onRemove,
  onUpdateVehicle,
  onDragStart,
  onDragEnd,
}: {
  a: PlannerAssignment;
  // Global list of vehicle assets (PlannerAsset rows where type='vehicle').
  // Drivers pick any vehicle from this list; vehicles are no longer dragged
  // onto jobs separately.
  allVehicles: PlannerAsset[];
  onRemove: () => void;
  onUpdateVehicle: (vehicleAssetId: number | null, rateOverride?: number) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}) {
  const isDriver = (a.assigned_role ?? a.asset_role) === 'driver';

  return (
    <div
      data-assignment-chip
      data-drag-assignment={onDragStart ? String(a.id) : undefined}
      data-asset-id={String(a.asset_id)}
      data-assigned-date={a.assigned_date}
      onContextMenu={e => e.preventDefault()}
      draggable={!!onDragStart}
      onDragStart={e => { e.stopPropagation(); e.dataTransfer.setData('text/plain', '1'); setTimeout(() => onDragStart?.(), 0); }}
      onDragEnd={onDragEnd}
      className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-gradient-to-r from-indigo-50 via-indigo-50/80 to-white border border-indigo-200/70 shadow-sm text-xs select-none transition-all duration-150 ${onDragStart ? 'cursor-grab active:cursor-grabbing active:scale-[0.98] hover:shadow-md hover:border-indigo-300' : ''}`}
    >
      <GripVertical className="w-3 h-3 text-indigo-300 flex-shrink-0" />
      <Users className="w-3 h-3 text-indigo-500 flex-shrink-0" />
      <span className="font-semibold text-indigo-800 flex-1 min-w-0 truncate tracking-tight">{a.asset_name}</span>

      {/* Vehicle dropdown for drivers — lists ALL registered vehicles */}
      {isDriver && allVehicles.length > 0 && (
        <select
          value={a.vehicle_asset_id != null ? String(a.vehicle_asset_id) : ''}
          onChange={e => {
            e.stopPropagation();
            const vid = e.target.value ? Number(e.target.value) : null;
            const v = vid != null ? allVehicles.find(x => x.id === vid) : null;
            // Lorry bonus: +£30 on top of the £150 driver default. Only auto-adjust
            // when the current rate is a default (null/150/180); custom edits stay.
            const cur = a.daily_rate;
            const isDefaultRate = cur == null || cur === 150 || cur === 180;
            const rateOverride = isDefaultRate
              ? (v && v.is_lorry ? 180 : 150)
              : undefined;
            onUpdateVehicle(vid, rateOverride);
          }}
          onClick={e => e.stopPropagation()}
          className="flex-shrink-0 text-[10px] border border-slate-200 rounded bg-white text-slate-600 py-0.5 px-1 max-w-[76px] hover:border-indigo-300 focus:outline-none focus:border-indigo-300"
        >
          <option value="">No van</option>
          {allVehicles.map(v => (
            <option key={v.id} value={String(v.id)}>{v.name}</option>
          ))}
        </select>
      )}
      {isDriver && allVehicles.length === 0 && (
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
  onConvertToJob,
  onItemColorChange,
  navigate,
  allAssets,
  onAssign,
  readOnly = false,
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
  onConvertToJob?: () => void;
  // Sets per-item planner_color override. Pass null to clear.
  onItemColorChange: (color: string | null) => void;
  navigate: (path: string) => void;
  allAssets: PlannerAsset[];
  onAssign: (asset: PlannerAsset, zone: 'driver' | 'porter' | 'vehicle') => void;
  // Jobs tab: hide drag-and-drop and show crew read-only (assignment happens in
  // the Staff tab). The card still expands, recolors, and shows the P&L panel.
  readOnly?: boolean;
}) {
  const isMobile = useIsMobile();
  // Server-resolved color (override → contract → category → fallback). Fall
  // back to local CATEGORY_COLORS for pre-existing data that hasn't been
  // re-fetched yet.
  const effectiveDotColor = item.effective_color || catColor(item.category).dot;
  const c = catColor(item.category);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const accentRef = useRef<HTMLDivElement>(null);
  const [accentRect, setAccentRect] = useState<DOMRect | null>(null);
  const isSurveyEvent = item.source === 'event' && item.category === 'Survey';
  const staffAssignments   = (item.assignments || []).filter(a => a.asset_type === 'staff');
  const driverAssignments  = staffAssignments.filter(a => (a.assigned_role ?? a.asset_role) === 'driver');
  const porterAssignments  = staffAssignments.filter(a => (a.assigned_role ?? a.asset_role) !== 'driver');
  // Global vehicle list — populates the per-driver van dropdown. Vehicles are
  // no longer dragged onto jobs as their own assignments, so the dropdown
  // sources from the master asset list.
  const allVehicles = allAssets.filter(a => a.type === 'vehicle');

  return (
    <div
      data-drag-card={`${item.source}:${item.id}`}
      onContextMenu={e => e.preventDefault()}
      draggable={!isMobile && !readOnly}
      onDragStart={(isMobile || readOnly) ? undefined : e => {
        if ((e.target as HTMLElement).closest('[data-assignment-chip]')) { e.preventDefault(); return; }
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', '1');
        setTimeout(() => onCardDragStart(), 0);
      }}
      onDragEnd={(isMobile || readOnly) ? undefined : onCardDragEnd}
      className={`group relative rounded-xl border bg-gradient-to-br from-white via-white to-slate-50/60 transition-all duration-200 overflow-hidden backdrop-blur-sm ${(isMobile || readOnly) ? '' : 'cursor-grab active:cursor-grabbing active:scale-[0.98]'} ${
        isExpanded
          ? 'border-indigo-200/80 shadow-[0_8px_24px_-6px_rgba(79,70,229,0.18),0_2px_6px_-2px_rgba(15,23,42,0.06)] ring-1 ring-indigo-100'
          : 'border-slate-200/70 shadow-[0_1px_2px_0_rgba(15,23,42,0.04)] hover:border-slate-300 hover:shadow-[0_6px_16px_-6px_rgba(15,23,42,0.18),0_2px_4px_-2px_rgba(15,23,42,0.06)] hover:-translate-y-px'
      }`}
    >
      {/* Top accent stripe — click to recolor this card */}
      <div
        ref={accentRef}
        role="button"
        tabIndex={0}
        onClick={e => {
          e.stopPropagation();
          if (accentRef.current) setAccentRect(accentRef.current.getBoundingClientRect());
          setColorPickerOpen(true);
        }}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (accentRef.current) setAccentRect(accentRef.current.getBoundingClientRect());
            setColorPickerOpen(true);
          }
        }}
        title="Click to change this card's color"
        className="absolute top-0 left-0 right-0 h-[6px] cursor-pointer hover:h-[8px] transition-all"
        style={{ background: `linear-gradient(90deg, ${effectiveDotColor}, ${effectiveDotColor}cc 60%, ${effectiveDotColor}55)` }}
      />
      <ColorPickerPopover
        open={colorPickerOpen}
        anchorRect={accentRect}
        currentColor={item.planner_color ?? null}
        onPick={color => onItemColorChange(color)}
        onClose={() => setColorPickerOpen(false)}
      />

      {/* Header (always visible) */}
      <button
        onClick={onToggle}
        className="w-full text-left px-3 pt-3 pb-2.5 flex items-start gap-2"
      >
        <span
          className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ring-2 ring-white shadow-[0_0_0_1px_rgba(15,23,42,0.06)]"
          style={{ background: effectiveDotColor, boxShadow: `0 0 0 1px rgba(15,23,42,0.06), 0 0 8px ${effectiveDotColor}55` }}
        />
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-slate-900 truncate tracking-tight leading-snug">{item.title}</p>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <CatBadge cat={item.category} size="xs" />
            {item.time && (
              <span className="text-[10px] font-medium text-slate-500 tabular-nums tracking-tight">{item.time}</span>
            )}
            {staffAssignments.length > 0 && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-500 bg-slate-100/80 rounded-full px-1.5 py-0.5 tabular-nums">
                <Users className="w-2.5 h-2.5" />{staffAssignments.length}
              </span>
            )}
          </div>
        </div>
      </button>

      {/* Mini drop target shown on collapsed card when a staff drag is in flight */}
      {!readOnly && hasActiveDrag && !isExpanded && (
        <div className="px-2.5 pb-2.5">
          <div
            data-drop-zone="staff"
            data-drop-card-key={cardKey}
            onDragOver={e => { e.preventDefault(); onDragOver('staff'); }}
            onDragLeave={onDragLeave}
            onDrop={e => { e.preventDefault(); onDropStaff(); }}
            className={`h-8 rounded-lg border-2 border-dashed flex items-center justify-center gap-1 text-[10px] font-semibold transition-all duration-150 ${
              dragOverZone === `${cardKey}|staff`
                ? 'border-indigo-400 bg-gradient-to-br from-indigo-50 to-indigo-100/70 text-indigo-700 ring-2 ring-indigo-200/60 scale-[1.02]'
                : 'border-slate-200 text-slate-400 hover:border-indigo-300 hover:text-indigo-500 hover:bg-indigo-50/40'
            }`}
          >
            <Users className="w-3 h-3" />
            {dragOverZone === `${cardKey}|staff` ? 'Drop here' : 'Staff'}
          </div>
        </div>
      )}

      {/* Expanded detail */}
      {isExpanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-slate-100/80 bg-gradient-to-b from-slate-50/40 to-transparent">
          {/* Info grid */}
          <div className="pt-2.5 space-y-1.5 text-[11px] text-slate-600 leading-relaxed">
            {item.phone && <p><span className="text-slate-400 font-medium">Phone</span> <span className="text-slate-700 ml-1 tabular-nums">{item.phone}</span></p>}
            {(item.from_line1 || item.from_postcode) && (
              <p><span className="text-slate-400 font-medium">From</span> <span className="text-slate-700 ml-1">{[item.from_line1, item.from_city, item.from_postcode].filter(Boolean).join(', ')}</span></p>
            )}
            {(item.to_line1 || item.to_postcode) && (
              <p><span className="text-slate-400 font-medium">To</span> <span className="text-slate-700 ml-1">{[item.to_line1, item.to_city, item.to_postcode].filter(Boolean).join(', ')}</span></p>
            )}
            {item.contract_name && <p><span className="text-slate-400 font-medium">Contractor</span> <span className="font-semibold text-indigo-700 ml-1">{item.contract_name}</span></p>}
            {item.address && <p><span className="text-slate-400 font-medium">Address</span> <span className="text-slate-700 ml-1">{item.address}</span></p>}
            {item.bedrooms && <p><span className="text-slate-400 font-medium">Bedrooms</span> <span className="text-slate-700 ml-1 tabular-nums">{item.bedrooms}</span></p>}
            {item.notes && <p><span className="text-slate-400 font-medium">Notes</span> <span className="text-slate-700 ml-1">{item.notes}</span></p>}
            {item.internal_notes && <p><span className="text-slate-400 font-medium">Internal</span> <span className="text-slate-700 ml-1">{item.internal_notes}</span></p>}
            {(item.packing_required || item.storage_required) && (
              <div className="flex gap-1.5 pt-0.5">
                {item.packing_required ? (
                  <span className="px-2 py-0.5 bg-gradient-to-r from-purple-50 to-purple-100/70 text-purple-700 border border-purple-200/60 rounded-full text-[10px] font-semibold">Packing</span>
                ) : null}
                {item.storage_required ? (
                  <span className="px-2 py-0.5 bg-gradient-to-r from-sky-50 to-sky-100/70 text-sky-700 border border-sky-200/60 rounded-full text-[10px] font-semibold">Storage</span>
                ) : null}
              </div>
            )}
          </div>

          {/* ── Read-only crew (Jobs tab) ── */}
          {readOnly ? (
            <div>
              <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                <Users className="w-3 h-3 text-indigo-500" />Crew
              </p>
              {staffAssignments.length === 0 ? (
                <p className="text-[10px] text-slate-400 italic">No crew assigned — assign staff & vehicles in the Staff tab.</p>
              ) : (
                <div className="space-y-1">
                  {[...driverAssignments, ...porterAssignments].map(a => {
                    const role = (a.assigned_role ?? a.asset_role) || '';
                    const isDriver = role === 'driver';
                    const van = a.vehicle_asset_id != null ? allVehicles.find(v => v.id === a.vehicle_asset_id) : null;
                    return (
                      <div key={a.id} className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-50 border border-slate-200/70 text-xs">
                        <Users className="w-3 h-3 text-slate-400 flex-shrink-0" />
                        <span className="font-medium text-slate-700 truncate flex-1 min-w-0">{a.asset_name}</span>
                        {role && <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 flex-shrink-0">{role}</span>}
                        {isDriver && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-slate-500 flex-shrink-0">
                            <Truck className="w-3 h-3" />{van ? van.name : 'No van'}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : isMobile ? (
            <div className="space-y-3">
              <MobileAssignZone
                label="Drivers"
                colorClass={{ border: 'border-indigo-200/70', bg: 'bg-indigo-50', text: 'text-indigo-700', btnBg: 'bg-indigo-600' }}
                assignments={driverAssignments}
                availableAssets={allAssets.filter(a =>
                  a.type === 'staff' && a.role === 'driver' && a.availability === 'available' &&
                  !(item.assignments || []).some(x => x.asset_id === a.id)
                )}
                allVehicles={allVehicles}
                onAdd={id => { const a = allAssets.find(x => x.id === id); if (a) onAssign(a, 'driver'); }}
                onRemove={onRemoveAssignment}
                onUpdateVehicle={(id, vid, rateOverride) => onUpdateAssignment(id, rateOverride !== undefined ? { vehicle_asset_id: vid, daily_rate: rateOverride } : { vehicle_asset_id: vid })}
              />
              <MobileAssignZone
                label="Porters"
                colorClass={{ border: 'border-violet-200/70', bg: 'bg-violet-50', text: 'text-violet-700', btnBg: 'bg-violet-600' }}
                assignments={porterAssignments}
                availableAssets={allAssets.filter(a =>
                  a.type === 'staff' && a.availability === 'available' &&
                  !(item.assignments || []).some(x => x.asset_id === a.id)
                )}
                onAdd={id => { const a = allAssets.find(x => x.id === id); if (a) onAssign(a, 'porter'); }}
                onRemove={onRemoveAssignment}
              />
              {/* Vehicles zone removed — vehicles are now picked from the per-driver dropdown */}
            </div>
          ) : (
            <>
              {/* ── Desktop: drag-and-drop zones ── */}

              {/* Drivers drop zone */}
              <div>
                <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                  <Users className="w-3 h-3 text-indigo-500" />Drivers
                </p>
                <div
                  data-drop-zone="driver"
                  data-drop-card-key={cardKey}
                  onDragOver={e => { e.preventDefault(); onDragOver('driver'); }}
                  onDragLeave={onDragLeave}
                  onDrop={e => { e.preventDefault(); onDropDriver(); }}
                  className={`min-h-[40px] rounded-xl border-2 border-dashed p-1.5 flex flex-col gap-1 transition-all duration-150 ${
                    dragOverZone === `${cardKey}|driver`
                      ? 'border-indigo-400 bg-gradient-to-br from-indigo-50 to-indigo-100/60 ring-2 ring-indigo-200/50'
                      : 'border-slate-200/80 bg-gradient-to-br from-slate-50 to-slate-100/30'
                  }`}
                >
                  {driverAssignments.map(a => (
                    <StaffAssignmentRow
                      key={a.id} a={a}
                      allVehicles={allVehicles}
                      onRemove={() => onRemoveAssignment(a.id)}
                      onUpdateVehicle={(vid, rateOverride) => onUpdateAssignment(a.id, rateOverride !== undefined ? { vehicle_asset_id: vid, daily_rate: rateOverride } : { vehicle_asset_id: vid })}
                      onDragStart={() => onAssignmentDragStart(a)}
                      onDragEnd={onAssignmentDragEnd}
                    />
                  ))}
                  {driverAssignments.length === 0 && dragOverZone !== `${cardKey}|driver` && (
                    <span className="text-[10px] text-slate-400 self-center ml-1 italic">Drop drivers here</span>
                  )}
                  {dragOverZone === `${cardKey}|driver` && (
                    <span className="text-[10px] text-indigo-600 font-semibold self-center ml-1">Release to assign</span>
                  )}
                </div>
              </div>

              {/* Porters drop zone */}
              <div>
                <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                  <Users className="w-3 h-3 text-violet-500" />Porters
                </p>
                <div
                  data-drop-zone="porter"
                  data-drop-card-key={cardKey}
                  onDragOver={e => { e.preventDefault(); onDragOver('porter'); }}
                  onDragLeave={onDragLeave}
                  onDrop={e => { e.preventDefault(); onDropPorter(); }}
                  className={`min-h-[40px] rounded-xl border-2 border-dashed p-1.5 flex flex-col gap-1 transition-all duration-150 ${
                    dragOverZone === `${cardKey}|porter`
                      ? 'border-violet-400 bg-gradient-to-br from-violet-50 to-violet-100/60 ring-2 ring-violet-200/50'
                      : 'border-slate-200/80 bg-gradient-to-br from-slate-50 to-slate-100/30'
                  }`}
                >
                  {porterAssignments.map(a => (
                    <StaffAssignmentRow
                      key={a.id} a={a}
                      allVehicles={allVehicles}
                      onRemove={() => onRemoveAssignment(a.id)}
                      onUpdateVehicle={(vid, rateOverride) => onUpdateAssignment(a.id, rateOverride !== undefined ? { vehicle_asset_id: vid, daily_rate: rateOverride } : { vehicle_asset_id: vid })}
                      onDragStart={() => onAssignmentDragStart(a)}
                      onDragEnd={onAssignmentDragEnd}
                    />
                  ))}
                  {porterAssignments.length === 0 && dragOverZone !== `${cardKey}|porter` && (
                    <span className="text-[10px] text-slate-400 self-center ml-1 italic">Drop porters here</span>
                  )}
                  {dragOverZone === `${cardKey}|porter` && (
                    <span className="text-[10px] text-violet-600 font-semibold self-center ml-1">Release to assign</span>
                  )}
                </div>
              </div>

            </>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between gap-1.5 pt-1 flex-wrap">
            <div className="flex items-center gap-1.5 flex-wrap">
              {item.source === 'job' && (
                <button
                  onClick={() => navigate(`/admin/crm/${item.id}`)}
                  className="inline-flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1.5 rounded-lg bg-gradient-to-br from-indigo-500 to-indigo-600 text-white border border-indigo-600/40 shadow-sm hover:shadow-md hover:-translate-y-px active:scale-95 transition-all"
                >
                  Open job
                  <ArrowUpRight className="w-3 h-3" />
                </button>
              )}
              {item.source === 'event' && (
                <>
                  {/* Survey created from a job profile → jump straight to that job. */}
                  {item.survey_job_id && (
                    <button
                      onClick={e => { e.stopPropagation(); navigate(`/admin/crm/${item.survey_job_id}`); }}
                      className="inline-flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1.5 rounded-lg bg-gradient-to-br from-indigo-500 to-indigo-600 text-white border border-indigo-600/40 shadow-sm hover:shadow-md hover:-translate-y-px active:scale-95 transition-all"
                      title="Open the job this survey belongs to"
                    >
                      Open job
                      <ArrowUpRight className="w-3 h-3" />
                    </button>
                  )}
                  <button
                    onClick={e => { e.stopPropagation(); onEditEvent?.(); }}
                    className="inline-flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1.5 rounded-lg bg-white text-slate-700 border border-slate-200 shadow-sm hover:border-slate-300 hover:bg-slate-50 hover:shadow active:scale-95 transition-all"
                  >
                    <Edit2 className="w-3 h-3" />Edit
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); onDeleteEvent?.(); }}
                    className="inline-flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1.5 rounded-lg bg-white text-red-600 border border-red-200/70 shadow-sm hover:bg-red-50 hover:border-red-300 hover:shadow active:scale-95 transition-all"
                  >
                    <Trash2 className="w-3 h-3" />Delete
                  </button>
                  {/* Only offer Convert for a standalone survey (no linked job) —
                      e.g. a customer who self-booked a survey online. */}
                  {isSurveyEvent && !item.survey_job_id && (
                    <button
                      onClick={e => { e.stopPropagation(); onConvertToJob?.(); }}
                      className="inline-flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1.5 rounded-lg bg-gradient-to-br from-cyan-500 to-cyan-600 text-white border border-cyan-600/40 shadow-sm hover:shadow-md hover:-translate-y-px active:scale-95 transition-all"
                      title="Create a CRM job from this survey"
                    >
                      <ArrowUpRight className="w-3 h-3" />Convert
                    </button>
                  )}
                </>
              )}
            </div>
            {item.source === 'event' && (
              <button
                onClick={e => { e.stopPropagation(); onDuplicate(); }}
                className="inline-flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1.5 rounded-lg bg-white text-slate-600 border border-slate-200 shadow-sm hover:border-indigo-300 hover:text-indigo-700 hover:bg-indigo-50/50 hover:shadow active:scale-95 transition-all"
                title="Duplicate this job"
              >
                <Copy className="w-3 h-3" />Duplicate
              </button>
            )}
          </div>

          {/* ── Profit & Loss ── */}
          {!isSurveyEvent && (
            <JobPnlPanel source={item.source} id={item.id} />
          )}
        </div>
      )}
    </div>
  );
}

// ── Per-day P&L panel (additional-day card) ───────────────────────────────────
// Wages for that day's crew (read-only) + expense lines tagged to the day. No
// income and no profit — those live on the main job; everything here rolls into
// the main job's total P&L.

function fmtPnlMoney(n: number): string {
  return `£${(Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function ScheduleDayPanel({ jobId, dayKey, date }: { jobId: number; dayKey: string; date: string }) {
  const [pnl, setPnl] = useState<JobDayPnl | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get<JobDayPnl>('/planner/pnl/day', { params: { id: jobId, day_key: dayKey, date } });
      setPnl(r.data);
    } catch { setPnl(null); } finally { setLoading(false); }
  }, [jobId, dayKey, date]);
  useEffect(() => { load(); }, [load]);

  async function addExpense() {
    await api.post('/planner/pnl/line', { source: 'job', id: jobId, kind: 'expense', label: 'Expense', amount: 0, day_key: dayKey });
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

  if (loading && !pnl) return <div className="text-[11px] text-slate-400 py-1">Loading…</div>;
  if (!pnl) return null;

  return (
    <div className="rounded-lg border border-slate-200/80 bg-white/70 p-2.5 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-slate-600">Wages</span>
        <span className="text-xs font-semibold text-slate-700 tabular-nums pr-1">{fmtPnlMoney(pnl.wages_total)}</span>
      </div>
      <div className="border-t border-slate-100 pt-1.5 space-y-1.5">
        <span className="text-[11px] font-medium text-slate-600">Expenses</span>
        {pnl.expense_lines.map(line => (
          <DayLineRow key={line.id} line={line} onUpdate={updateLine} onDelete={deleteLine} />
        ))}
        <button
          type="button"
          onClick={addExpense}
          className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 hover:text-amber-800"
        >
          <Plus className="w-3 h-3" /> Add expense
        </button>
      </div>
      <p className="text-[10px] text-slate-400 italic border-t border-slate-100 pt-1.5">
        Wages &amp; expenses roll into the main move job's P&amp;L.
      </p>
    </div>
  );
}

// Compact editable expense row (label + amount + delete) for the day panel.
function DayLineRow({
  line, onUpdate, onDelete,
}: {
  line: JobLedgerLine;
  onUpdate: (id: number, patch: { label?: string; amount?: string }) => void;
  onDelete: (id: number) => void;
}) {
  const [label, setLabel] = useState(line.label);
  const [amount, setAmount] = useState(String(line.amount));
  useEffect(() => { setLabel(line.label); }, [line.label]);
  useEffect(() => { setAmount(String(line.amount)); }, [line.amount]);
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="text"
        value={label}
        onChange={e => setLabel(e.target.value)}
        onBlur={() => { if (label !== line.label) onUpdate(line.id, { label }); }}
        className="flex-1 min-w-0 px-2 py-1 rounded border border-slate-200 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400"
      />
      <div className="relative">
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-slate-400">£</span>
        <input
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
          onBlur={() => { if (amount !== String(line.amount)) onUpdate(line.id, { amount }); }}
          className="w-20 pl-5 pr-1 py-1 rounded border border-slate-200 text-xs text-right tabular-nums focus:outline-none focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400"
        />
      </div>
      <button type="button" onClick={() => onDelete(line.id)} title="Remove" className="p-1 text-slate-300 hover:text-red-500">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ── Schedule marker card (Jobs view, additional move day) ─────────────────────
// An additional move day (packing, pre-load, delivery, …). Crew is assigned on
// the Staff view, so it's read-only here; expanding shows the day's crew plus a
// wages/expenses panel that rolls into the main job. The main move date owns
// income and the overall P&L.

function ScheduleMarkerCard({
  item, isExpanded, onToggle, navigate, allAssets,
}: {
  item: PlannerCalendarItem;
  isExpanded: boolean;
  onToggle: () => void;
  navigate: (path: string) => void;
  allAssets: PlannerAsset[];
}) {
  const color = item.effective_color || catColor(item.category).dot;
  // item.title is "Label — Customer"; show the customer name as the subline.
  const customer = item.title.includes('—') ? item.title.split('—').slice(1).join('—').trim() : item.title;
  const crew = (item.assignments || []).filter(a => a.asset_type === 'staff');
  const allVehicles = allAssets.filter(a => a.type === 'vehicle');

  return (
    <div className="group relative rounded-xl border border-dashed border-slate-300 bg-white/70 overflow-hidden shadow-[0_1px_2px_0_rgba(15,23,42,0.04)]">
      <div
        className="absolute top-0 left-0 right-0 h-[6px]"
        style={{ background: `linear-gradient(90deg, ${color}, ${color}cc 60%, ${color}55)` }}
      />
      {/* Header — click to expand */}
      <button onClick={onToggle} className="w-full text-left px-3 pt-3 pb-2.5 flex items-start gap-2">
        <span className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ring-2 ring-white" style={{ background: color }} />
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-slate-900 truncate tracking-tight leading-snug">
            {item.schedule_label || 'Extra day'}
          </p>
          <p className="text-[11px] text-slate-500 truncate">{customer}</p>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-500 bg-slate-100/80 rounded-full px-1.5 py-0.5">
              <CalendarDays className="w-2.5 h-2.5" />
              {item.schedule_offset != null ? offsetLabel(item.schedule_offset) : 'Extra day'}
            </span>
            {crew.length > 0 && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-500 bg-slate-100/80 rounded-full px-1.5 py-0.5 tabular-nums">
                <Users className="w-2.5 h-2.5" />{crew.length}
              </span>
            )}
          </div>
        </div>
      </button>

      {isExpanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-slate-100/80 bg-gradient-to-b from-slate-50/40 to-transparent">
          {/* Crew (read-only — assign on Staff view) */}
          <div className="pt-2.5">
            <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1.5 flex items-center gap-1">
              <Users className="w-3 h-3 text-indigo-500" />Crew
            </p>
            {crew.length === 0 ? (
              <p className="text-[10px] text-slate-400 italic">No crew yet — assign staff &amp; vehicles in the Staff tab.</p>
            ) : (
              <div className="space-y-1">
                {crew.map(a => {
                  const role = (a.assigned_role ?? a.asset_role) || '';
                  const van = a.vehicle_asset_id != null ? allVehicles.find(v => v.id === a.vehicle_asset_id) : null;
                  return (
                    <div key={a.id} className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-50 border border-slate-200/70 text-xs">
                      <Users className="w-3 h-3 text-slate-400 flex-shrink-0" />
                      <span className="font-medium text-slate-700 truncate flex-1 min-w-0">{a.asset_name}</span>
                      {role && <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 flex-shrink-0">{role}</span>}
                      {role === 'driver' && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-slate-500 flex-shrink-0">
                          <Truck className="w-3 h-3" />{van ? van.name : 'No van'}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Per-day wages + expenses */}
          {item.schedule_id && item.date && (
            <ScheduleDayPanel jobId={item.id} dayKey={item.schedule_id} date={item.date} />
          )}

          <button
            onClick={() => navigate(`/admin/crm/${item.id}`)}
            className="inline-flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1.5 rounded-lg bg-white text-slate-700 border border-slate-200 shadow-sm hover:border-indigo-300 hover:text-indigo-700 active:scale-95 transition-all"
          >
            Open job <ArrowUpRight className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
}

// ── Jobs view (weekly, read-only assignments) ─────────────────────────────────
// Renamed from the old "Week" tab. Shows the week's jobs as cards with their
// assigned crew/vehicles (read-only) and the P&L panel for adjusting expenses.
// All staff/vehicle assignment lives in the Staff tab; there's no asset sidebar
// and no drag-and-drop here.

function JobsView({
  weekDates,
  items,
  expandedKeys,
  setExpandedKeys,
  onAddQuickJob,
  onEditEvent,
  onDeleteEvent,
  onDuplicate,
  onConvertToJob,
  onItemColorChange,
  navigate,
  allAssets,
}: {
  weekDates: string[];
  items: PlannerCalendarItem[];
  expandedKeys: Set<string>;
  setExpandedKeys: React.Dispatch<React.SetStateAction<Set<string>>>;
  onAddQuickJob: (date: string) => void;
  onEditEvent: (item: PlannerCalendarItem) => void;
  onDeleteEvent: (item: PlannerCalendarItem) => void;
  onDuplicate: (item: PlannerCalendarItem) => void;
  onConvertToJob: (item: PlannerCalendarItem) => void;
  onItemColorChange: (item: PlannerCalendarItem, color: string | null) => void;
  navigate: (path: string) => void;
  allAssets: PlannerAsset[];
}) {
  const itemsByDate: Record<string, PlannerCalendarItem[]> = {};
  for (const item of items) {
    if (!item.date) continue;
    if (!itemsByDate[item.date]) itemsByDate[item.date] = [];
    itemsByDate[item.date].push(item);
  }
  const today = toISO(new Date());
  const noop = () => {};

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="flex-1 overflow-x-auto">
        <div className="flex min-w-[700px] h-full">
          {weekDates.map(date => {
            const dayItems = itemsByDate[date] || [];
            const isToday = date === today;
            const [, , day] = date.split('-');
            const dayName = new Date(date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short' });

            return (
              <div
                key={date}
                className={`flex-1 border-r border-slate-200/70 flex flex-col ${isToday ? 'bg-gradient-to-b from-indigo-50/40 to-transparent' : 'bg-white'}`}
              >
                {/* Day header */}
                <div className="px-2 py-3 border-b border-slate-200/70 text-center">
                  <p className={`text-[10px] font-bold uppercase tracking-widest ${isToday ? 'text-indigo-600' : 'text-slate-500'}`}>{dayName}</p>
                  <div className="flex justify-center mt-1">
                    {isToday ? (
                      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-indigo-600 text-white flex items-center justify-center shadow-[0_4px_12px_-2px_rgba(79,70,229,0.45)] ring-2 ring-white">
                        <span className="text-base font-bold tabular-nums">{parseInt(day, 10)}</span>
                      </div>
                    ) : (
                      <span className="text-lg font-bold text-slate-800 tabular-nums leading-none py-1.5">{parseInt(day, 10)}</span>
                    )}
                  </div>
                </div>

                {/* Items */}
                <div className="flex-1 overflow-y-auto p-1.5 space-y-1.5">
                  {dayItems.length === 0 && (
                    <button
                      onClick={() => onAddQuickJob(date)}
                      className="w-full flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-slate-200 hover:border-indigo-300 hover:bg-gradient-to-br hover:from-indigo-50/60 hover:to-transparent text-slate-300 hover:text-indigo-500 transition-all py-6 group"
                    >
                      <Plus className="w-5 h-5 transition-transform group-hover:scale-110" />
                      <span className="text-[10px] font-medium opacity-0 group-hover:opacity-100 transition-opacity">Add job</span>
                    </button>
                  )}

                  {dayItems.map(item => {
                    if (item.is_extra_day) {
                      const mKey = `sched-${item.id}-${item.schedule_id}-${date}`;
                      return (
                        <ScheduleMarkerCard
                          key={mKey}
                          item={item}
                          isExpanded={expandedKeys.has(mKey)}
                          onToggle={() => setExpandedKeys(prev => {
                            const next = new Set(prev);
                            if (next.has(mKey)) next.delete(mKey); else next.add(mKey);
                            return next;
                          })}
                          navigate={navigate}
                          allAssets={allAssets}
                        />
                      );
                    }
                    const key = `${item.source}-${item.id}-${date}`;
                    const isExpanded = expandedKeys.has(key);
                    return (
                      <JobCard
                        key={key}
                        cardKey={key}
                        item={item}
                        isExpanded={isExpanded}
                        onToggle={() => setExpandedKeys(prev => {
                          const next = new Set(prev);
                          if (next.has(key)) next.delete(key); else next.add(key);
                          return next;
                        })}
                        dragOverZone={null}
                        onDragOver={noop}
                        onDragLeave={noop}
                        onDropStaff={noop}
                        onDropDriver={noop}
                        onDropPorter={noop}
                        onRemoveAssignment={noop}
                        onAssignmentDragStart={noop}
                        onAssignmentDragEnd={noop}
                        onUpdateAssignment={noop}
                        hasActiveDrag={false}
                        onCardDragStart={noop}
                        onCardDragEnd={noop}
                        onEditEvent={item.source === 'event' ? () => onEditEvent(item) : undefined}
                        onDeleteEvent={item.source === 'event' ? () => onDeleteEvent(item) : undefined}
                        onDuplicate={() => onDuplicate(item)}
                        onConvertToJob={item.source === 'event' && item.category === 'Survey' ? () => onConvertToJob(item) : undefined}
                        onItemColorChange={color => onItemColorChange(item, color)}
                        navigate={navigate}
                        allAssets={allAssets}
                        onAssign={noop}
                        readOnly
                      />
                    );
                  })}

                  {dayItems.length > 0 && (
                    <button
                      onClick={() => onAddQuickJob(date)}
                      className="w-full flex items-center justify-center gap-1 rounded-xl border-2 border-dashed border-slate-200 hover:border-indigo-300 hover:bg-gradient-to-br hover:from-indigo-50/60 hover:to-transparent text-slate-300 hover:text-indigo-500 transition-all py-2 group"
                    >
                      <Plus className="w-4 h-4 transition-transform group-hover:scale-110" />
                      <span className="text-[10px] font-semibold opacity-0 group-hover:opacity-100 transition-opacity">Add</span>
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
  open, onClose, defaultDate, editItem, onSaved, onPickContractor,
}: {
  open: boolean;
  onClose: () => void;
  defaultDate: string;
  editItem?: PlannerCalendarItem | null;
  onSaved: (ev: PlannerEvent) => void;
  // Create mode only: the user picked a contractor, so swap this quick-job
  // form out for the full contractor-job form (price-list lines + crew/vans/HGV
  // that sync to the contractor's weekly invoice). Passes the chosen date so the
  // contractor job lands on the same day.
  onPickContractor: (contract: Contract, date: string) => void;
}) {
  const [form, setForm] = useState({ ...EMPTY_QUICK });
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [categoryNames, setCategoryNames] = useState<string[]>(FALLBACK_CATEGORY_NAMES);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/contracts').then(r => setContracts(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    let alive = true;
    fetchJobCategories()
      .then(list => {
        if (!alive) return;
        // Selectable = non-system categories, in saved order.
        setCategoryNames(list.filter(c => !c.system).map(c => c.name));
      })
      .catch(() => { /* keep fallback names */ });
    return () => { alive = false; };
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
              <select
                className="input"
                value={form.contract_id}
                onChange={e => {
                  const v = e.target.value;
                  // In create mode, picking a contractor swaps this form out for
                  // the full contractor-job form (which syncs to the contractor's
                  // weekly invoice). In edit mode we keep the simple tag behaviour.
                  if (!editItem && v) {
                    const c = contracts.find(x => String(x.id) === v);
                    if (c) { onPickContractor(c, form.event_date); return; }
                  }
                  set('contract_id', v);
                }}
              >
                <option value="">— None —</option>
                {contracts.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
              </select>
              {!editItem && (
                <p className="mt-1 text-[11px] text-slate-400">
                  Selecting a contractor opens the contractor job form (crew, vans &amp; price-list lines that feed the weekly invoice).
                </p>
              )}
            </div>
          )}
          <div className="col-span-2">
            <label className="block text-xs font-medium text-slate-600 mb-1">Title *</label>
            <input className="input" placeholder="e.g. Box drop-off for Williams" value={form.title} onChange={e => set('title', e.target.value)} required />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Category *</label>
            <select className="input" value={form.category} onChange={e => set('category', e.target.value)}>
              {(categoryNames.includes(form.category) || !form.category
                ? categoryNames
                : [form.category, ...categoryNames]
              ).map(c => <option key={c}>{c}</option>)}
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
        {/* Survey booked from a job profile → straight to that job. */}
        {item.source === 'event' && item.survey_job_id && (
          <button
            onClick={() => { navigate(`/admin/crm/${item.survey_job_id}`); onClose(); }}
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
  const [searchParams] = useSearchParams();

  // Honour ?view=week and ?date=YYYY-MM-DD on first mount so other pages can
  // deep-link to a specific week (e.g. clicking a wage cell on the Wages page).
  const initialView: 'month' | 'week' | 'staff' = (() => {
    const v = searchParams.get('view');
    if (v === 'week') return 'week';
    if (v === 'staff') return 'staff';
    return 'month';
  })();
  const initialDate = (() => {
    const d = searchParams.get('date');
    return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + 'T00:00:00') : new Date();
  })();
  // Deep-link from the Wages page: when present, flash that staff member's
  // chip on the specific day so the user can spot them immediately.
  const initialHighlightAssetId = (() => {
    const h = searchParams.get('highlight');
    const n = h ? parseInt(h, 10) : NaN;
    return Number.isFinite(n) ? n : null;
  })();
  const initialHighlightDate = (() => {
    const d = searchParams.get('date');
    return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
  })();
  const [highlightAssetId, setHighlightAssetId] = useState<number | null>(initialHighlightAssetId);
  const [highlightDate, setHighlightDate] = useState<string | null>(initialHighlightDate);

  const [view,        setView]        = useState<'month' | 'week' | 'staff'>(initialView);
  const [currentDate, setCurrentDate] = useState(initialDate);
  const [items,       setItems]       = useState<PlannerCalendarItem[]>([]);
  const [assets,      setAssets]      = useState<PlannerAsset[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [weekDates,   setWeekDates]   = useState<string[]>([]);

  // Modals
  const [showQuickJob,  setShowQuickJob]  = useState(false);
  const [quickJobDate,  setQuickJobDate]  = useState('');
  // Bumped after a quick job is saved so the Staff View (which loads its own
  // data) refetches and shows the new job without a manual reload.
  const [staffReloadKey, setStaffReloadKey] = useState(0);
  const [editEvent,     setEditEvent]     = useState<PlannerCalendarItem | null>(null);
  // Contractor job form, opened when a contractor is picked in the quick-job
  // modal. Creating one here makes a real ContractJob that syncs to the planner
  // and the contractor's weekly invoice (same flow as the Contract Jobs page).
  const [contractJobTarget, setContractJobTarget] = useState<Contract | null>(null);
  const [contractJobDate,   setContractJobDate]   = useState('');
  const [modalItem,     setModalItem]     = useState<PlannerCalendarItem | null>(null);

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
        setWeekDates([]);
      } else if (view === 'week') {
        const ws = getWeekStart(currentDate);
        const start = toISO(ws);
        const r = await api.get(`/planner/week?start=${start}`);
        setWeekDates(r.data.dates);
        setItems(r.data.items);
        // Expand all job cards by default
        const allKeys = new Set<string>(
          r.data.items.map((i: PlannerCalendarItem) => `${i.source}-${i.id}-${i.date}`)
        );
        setExpandedKeys(allKeys);
      } else {
        // staff view — child fetches its own data from /planner/staff-week
        setItems([]); setWeekDates([]);
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
      // week + staff views step 7 days; month steps a month.
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

  function switchToStaff(fromDate?: string) {
    if (fromDate) setCurrentDate(new Date(fromDate + 'T00:00:00'));
    setView('staff');
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

  // Persist the per-card color override. `color === null` clears it so the
  // card falls back to contract / category color.
  async function handleUpdateItemColor(item: PlannerCalendarItem, color: string | null) {
    try {
      await api.patch('/planner/items/color', { source: item.source, id: item.id, color });
      await loadData();
    } catch {
      showToast('Failed to update color', 'error');
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

  async function handleConvertToJob(item: PlannerCalendarItem) {
    const fullName = item.customer_name?.trim() || item.title;
    try {
      const r = await api.post('/crm/jobs', {
        full_name: fullName,
        phone: item.phone || null,
        from_line1: item.address || null,
        survey_required: true,
        survey_type: 'In Person',
        survey_date: item.date,
        survey_time: item.time || null,
        client_notes: item.notes || null,
        status: 'Survey Physical',
      });
      // Creating the job auto-makes a survey event linked to it, so remove the
      // original standalone survey to avoid a duplicate booking on the same day.
      try { await api.delete(`/planner/events/${item.id}`); } catch { /* already gone */ }
      showToast(`CRM job created for "${fullName}"`, 'success');
      navigate(`/admin/crm/${r.data.id}`);
    } catch {
      showToast('Failed to create CRM job', 'error');
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

  // Open a job's profile/form from the Staff view tray card:
  //   - removal job (CrmJob)   → its CRM detail page
  //   - contract job (event w/ contract) → that contractor's page
  //   - quick job (plain event) → the quick-job edit modal (fetched for full data)
  async function handleOpenStaffJob(
    job: { source: 'job' | 'event'; id: number; contract_id?: number | null; survey_job_id?: number | null },
    date: string,
  ) {
    if (job.source === 'job') { navigate(`/admin/crm/${job.id}`); return; }
    if (job.survey_job_id) { navigate(`/admin/crm/${job.survey_job_id}`); return; } // survey → its job
    if (job.contract_id) { navigate(`/admin/crm/contract-jobs/${job.contract_id}`); return; }
    try {
      const r = await api.get('/planner/events', { params: { start: date, end: date } });
      const ev = (r.data || []).find((e: { id: number }) => e.id === job.id);
      if (!ev) { showToast('Job not found', 'error'); return; }
      setEditEvent({
        source: 'event', id: ev.id, title: ev.title, category: ev.category,
        date: String(ev.event_date).slice(0, 10), time: ev.event_time || undefined,
        customer_name: ev.customer_name || undefined, phone: ev.contact_number || undefined,
        address: ev.address || undefined, notes: ev.notes || undefined,
        contract_id: ev.contract_id ?? null,
      });
      setQuickJobDate(date);
      setShowQuickJob(true);
    } catch {
      showToast('Failed to open job', 'error');
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
              title="Weekly job cards — view jobs, assigned crew, and adjust profit & expenses"
            >
              Jobs
            </button>
            <button
              onClick={() => { setView('staff'); setExpandedKeys(new Set()); }}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${view === 'staff' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              title="Per-staff weekly grid — assign crew & vehicles, set wages, mark days off"
            >
              Staff
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
            onDayClick={date => switchToStaff(date)}
            onItemClick={item => {
              if (item.source === 'job') { navigate(`/admin/crm/${item.id}`); }
              else { setModalItem(item); }
            }}
            onAddQuickJob={date => { setQuickJobDate(date || toISO(new Date())); setShowQuickJob(true); }}
          />
        ) : view === 'staff' ? (
          <StaffWeekView
            weekStart={toISO(getWeekStart(currentDate))}
            highlightAssetId={highlightAssetId}
            highlightDate={highlightDate}
            onHighlightConsumed={() => { setHighlightAssetId(null); setHighlightDate(null); }}
            onAddJob={date => { setEditEvent(null); setQuickJobDate(date); setShowQuickJob(true); }}
            onOpenJob={handleOpenStaffJob}
            reloadKey={staffReloadKey}
          />
        ) : (
          <JobsView
            weekDates={weekDates}
            items={items}
            expandedKeys={expandedKeys}
            setExpandedKeys={setExpandedKeys}
            onAddQuickJob={date => { setEditEvent(null); setQuickJobDate(date); setShowQuickJob(true); }}
            onEditEvent={item => { setEditEvent(item); setShowQuickJob(true); }}
            onDeleteEvent={handleDeleteEvent}
            onDuplicate={handleDuplicate}
            onConvertToJob={handleConvertToJob}
            onItemColorChange={handleUpdateItemColor}
            navigate={navigate}
            allAssets={assets}
          />
        )}
      </div>

      {/* Modals */}
      <QuickJobModal
        open={showQuickJob}
        onClose={() => { setShowQuickJob(false); setEditEvent(null); }}
        defaultDate={quickJobDate}
        editItem={editEvent}
        onSaved={() => { loadData(); setStaffReloadKey(k => k + 1); showToast(editEvent ? 'Quick job updated' : 'Quick job added', 'success'); }}
        onPickContractor={(contract, date) => {
          // Swap the quick-job form for the full contractor-job form on the
          // same day. The contractor job syncs to the planner + weekly invoice.
          setShowQuickJob(false);
          setEditEvent(null);
          setContractJobDate(date || quickJobDate);
          setContractJobTarget(contract);
        }}
      />

      {contractJobTarget && (
        <CreateContractJobModal
          contract={contractJobTarget}
          defaultDate={contractJobDate}
          onClose={() => setContractJobTarget(null)}
          onSaved={() => {
            setContractJobTarget(null);
            loadData();
            setStaffReloadKey(k => k + 1);
            showToast('Contractor job added', 'success');
          }}
        />
      )}

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
