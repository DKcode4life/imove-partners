/**
 * Staff View — per-staff weekly grid with drag-and-drop assignment.
 *
 * Layout per day column:
 *   1. "Jobs" tray at the top — every CrmJob and PlannerEvent scheduled that
 *      day. Each card shows needed staff/vans (when available) and how many
 *      are already assigned. Cards are draggable onto staff rows below.
 *   2. Assignment rows grouped by job. The job description shows once in the
 *      group header; each row shows Staff · Vehicle · Start · Finish · Hours ·
 *      Wage. Finish + Hours appear on every job (not just Lux) so overtime can
 *      be reconciled by total hours worked. Picking a vehicle promotes the row
 *      to driver wage (a lorry adds the lorry bonus); clearing it reverts to
 *      porter.
 *   3. Available staff (no assignment, no time off).
 *   4. Day-off staff (red rows).
 *
 * Drag sources:
 *   - Top-tray job card: payload {kind:'job', source, id}
 *   - An assigned-row's staff name: payload {kind:'assignment', assignment_id}
 *
 * Drop target = any staff row for that date. The handler decides:
 *   - kind=job → POST /planner/assignments (create)
 *   - kind=assignment → PATCH /planner/assignments/:id { asset_id } (reassign)
 */
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Loader2, Users, Truck, X, Plus, Check, UserPlus } from 'lucide-react';
import api from '../lib/api';
import { catColor } from '../lib/planner-colors';
import ColorPickerPopover from './ColorPickerPopover';

// ── Types matching server payload (GET /planner/staff-week) ──────────────────

export interface StaffWeekRow {
  assignment_id: number;
  source: 'job' | 'event' | null;
  source_id: number | null;
  job_id: number | null;
  event_id: number | null;
  job_label: string | null;
  job_category: string | null;
  planner_color: string | null;
  effective_color: string;
  contract_id: number | null;
  contract_name: string | null;
  is_lux_job: boolean;
  vehicle_asset_id: number | null;
  vehicle_label: string | null;
  vehicle_is_lorry: boolean;
  assigned_role: string | null;
  start_time: string | null;
  finish_time: string | null;
  daily_rate: number | null;
  wage_override: number | null;
  wage_total: number;
  wage_mode: 'lux' | 'daily' | 'override';
  wage_bonus: number;
  wage_hours: number | null;
  // Effective Lux £/hr for this row (per-staff override or company default) —
  // used for the live wage preview while the user types start/finish times.
  lux_hourly_rate: number;
}

interface StaffDayBucket {
  rows: StaffWeekRow[];
  day_off: { id: number; reason: string | null } | null;
}

interface StaffEntry {
  asset_id: number;
  name: string;
  role: string | null;
  availability: string;
  days: Record<string, StaffDayBucket>;
}

interface DayJob {
  source: 'job' | 'event';
  id: number;
  label: string;
  category: string | null;
  contract_name: string | null;
  is_lux: boolean;
  men_needed: number | null;
  vans_needed: number | null;
  hgv_needed: number | null;
  assigned_count: number;
  time: string | null;
  planner_color: string | null;
  effective_color: string;
}

interface VehicleOption {
  id: number;
  label: string;
  is_lorry: boolean;
  availability: string;
}

interface StaffWeekPayload {
  dates: string[];
  staff: StaffEntry[];
  day_jobs: Record<string, DayJob[]>;
  has_lux: Record<string, boolean>;
  vehicles: VehicleOption[];
  settings: { lux_hourly_rate: number; lorry_driving_bonus: number };
}

// ── Drag payload shape ───────────────────────────────────────────────────────

type DragPayload =
  | { kind: 'job'; source: 'job' | 'event'; id: number; label: string }
  | { kind: 'assignment'; assignment_id: number; source: 'job' | 'event' | null; source_id: number | null; from_asset_id: number };

const DRAG_MIME = 'application/x-staffview-payload';

// ── Helpers ──────────────────────────────────────────────────────────────────

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function fmtMoney(n: number) {
  return `£${(Number(n) || 0).toFixed(2)}`;
}

// Parse a #rgb / #rrggbb hex string into its components. Returns null for
// anything we can't read (e.g. an already-rgb() string) so callers can fall back.
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  let h = (hex || '').replace('#', '').trim();
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (h.length !== 6) return null;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if ([r, g, b].some(n => Number.isNaN(n))) return null;
  return { r, g, b };
}

// Faded "watermark" fill for a by-job group, in the job's own color. Kept light
// enough that the dark row text stays readable, with a gentle top→bottom fade so
// each group reads as a single tinted block — making the boundary between two
// adjacent jobs obvious. Falls back to the old neutral wash for non-hex colors.
function groupTintBg(color: string): string {
  const rgb = hexToRgb(color);
  if (!rgb) return 'linear-gradient(to bottom, rgba(248,250,252,0.4), #fff)';
  const { r, g, b } = rgb;
  return `linear-gradient(to bottom, rgba(${r},${g},${b},0.16), rgba(${r},${g},${b},0.06))`;
}

// Single column template shared by the header AND every data row so the titles
// line up exactly over their columns. Columns:
//   Staff · Vehicle · Start · Finish · Hours · Wage
//
// Start/Finish/Hours are FIXED-width px tracks, not fractions. The time inputs
// have their native picker indicator hidden (see the input className), so they
// only need room for the plain "HH:MM" text — ~58px renders it in full with no
// clipping. Fixed widths also mean these columns are identical on every row, so
// the grid never goes out of alignment.
//
// The flexible text columns (Staff, Vehicle, Wage) are minmax(0, …fr) — the 0
// lower bound lets them truncate instead of pushing neighbours. Dropping the
// clock icon freed ~44px which goes to Vehicle, so the selected van is legible
// at a glance; Wage is a wide flex track so its right-aligned amount keeps clear
// whitespace from the Hours column.
const COLS =
  'minmax(0,1.55fr) minmax(0,1.3fr) 58px 58px 44px minmax(0,1.2fr)';

// True on touch-first devices (phones, tablets) where HTML5 drag-and-drop is
// unavailable or unreliable. We key off the pointer media query rather than
// screen width so a large tablet still gets the tap-to-assign flow while a small
// desktop window keeps drag-and-drop. Reacts live if the primary pointer changes
// (e.g. a 2-in-1 docking/undocking).
function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(pointer: coarse)').matches
      : false,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(pointer: coarse)');
    const onChange = (e: MediaQueryListEvent) => setCoarse(e.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return coarse;
}

// Format derived hours for the Hours column. Null/zero render as a dash.
function fmtHours(h: number | null): string {
  if (h == null || h <= 0) return '—';
  return `${h % 1 === 0 ? h.toFixed(0) : h.toFixed(2).replace(/0$/, '')}h`;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function StaffWeekView({
  weekStart,
  highlightAssetId = null,
  highlightDate = null,
  onHighlightConsumed,
  onAddJob,
  reloadKey,
}: {
  weekStart: string;
  // Deep-link from the Wages page: flash this staff member's name on the given
  // day's column so the user can spot exactly where that wage was earned.
  highlightAssetId?: number | null;
  highlightDate?: string | null;
  onHighlightConsumed?: () => void;
  // Open the quick-job modal pre-filled with a day's date. Wired to the same
  // QuickJobModal the rest of the planner uses; the per-day "+" button calls it.
  onAddJob?: (date: string) => void;
  // Bumped by the parent after a quick job is saved so the grid refetches and
  // shows the new job without a manual reload.
  reloadKey?: number;
}) {
  const [data, setData] = useState<StaffWeekPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const touch = useCoarsePointer();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get<StaffWeekPayload>(`/planner/staff-week?start=${weekStart}`);
      setData(r.data);
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Failed to load staff week');
    } finally {
      setLoading(false);
    }
  }, [weekStart]);

  useEffect(() => { load(); }, [load, reloadKey]);

  // Deep-link flash: once the grid is rendered, pulse the staff member's name
  // in the target day's column three times and scroll it into view. The name
  // cells carry data-staff-asset-id / data-staff-date so we can target the
  // exact (person, day) regardless of which bucket they fall in (assigned,
  // available, or day-off).
  useEffect(() => {
    if (highlightAssetId == null || !highlightDate || !data) return;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let target: HTMLElement | null = null;
    const raf = requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(
        `[data-staff-asset-id="${highlightAssetId}"][data-staff-date="${highlightDate}"]`,
      );
      if (!el) {
        onHighlightConsumed?.();
        return;
      }
      target = el;
      el.classList.remove('planner-flash');
      // Force reflow so re-triggering the animation always restarts it.
      void el.offsetWidth;
      el.classList.add('planner-flash');
      el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      // 3 pulses × 0.55s ≈ 1.7s — strip the class afterwards so it can re-fire.
      timeoutId = setTimeout(() => {
        el.classList.remove('planner-flash');
        onHighlightConsumed?.();
      }, 1900);
    });
    return () => {
      cancelAnimationFrame(raf);
      if (timeoutId) clearTimeout(timeoutId);
      if (target) target.classList.remove('planner-flash');
    };
  }, [highlightAssetId, highlightDate, data, onHighlightConsumed]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
      </div>
    );
  }
  if (error || !data) {
    return <div className="flex-1 flex items-center justify-center text-sm text-red-600">{error || 'No data'}</div>;
  }

  return (
    <div className="flex-1 overflow-auto bg-gradient-to-b from-slate-50 to-slate-100/40">
      <div
        className="grid h-full p-2 gap-2 items-start"
        style={{
          // Per-day track sizing: a day with jobs gets a full, flexible column
          // (wide enough for the Staff·Vehicle·Start·Finish·Hours·Wage grid); a
          // day with no jobs collapses to a thin rail that only needs room for a
          // staff name + the OFF toggle. Mixing a fixed-thin track with the
          // flexible ones means the populated days absorb the freed width.
          gridTemplateColumns: data.dates
            .map(d => ((data.day_jobs[d]?.length ?? 0) > 0 ? 'minmax(460px,1fr)' : 'minmax(150px,180px)'))
            .join(' '),
        }}
      >
        {data.dates.map((date, i) => (
          <StaffDayColumn
            key={date}
            date={date}
            dayName={DAY_NAMES[i]}
            staff={data.staff}
            day_jobs={data.day_jobs[date] || []}
            has_lux={!!data.has_lux[date]}
            vehicles={data.vehicles}
            onChange={load}
            luxRate={data.settings.lux_hourly_rate}
            onAddJob={onAddJob}
            touch={touch}
          />
        ))}
      </div>
    </div>
  );
}

// ── Single day column ────────────────────────────────────────────────────────

function StaffDayColumn({
  date, dayName, staff, day_jobs, has_lux, vehicles, onChange, luxRate, onAddJob, touch,
}: {
  date: string;
  dayName: string;
  staff: StaffEntry[];
  day_jobs: DayJob[];
  has_lux: boolean;
  vehicles: VehicleOption[];
  onChange: () => void;
  luxRate: number;
  onAddJob?: (date: string) => void;
  // Touch device → show the tap-to-assign button + sheet instead of relying on
  // drag-and-drop, which doesn't work on phones/tablets.
  touch: boolean;
}) {
  // Which job's staff-picker sheet is open (touch only). Null = closed.
  const [assignJob, setAssignJob] = useState<DayJob | null>(null);
  const dt = new Date(date + 'T00:00:00');
  const dayNum = dt.getDate();
  const monthShort = dt.toLocaleDateString('en-GB', { month: 'short' });
  const isToday = (() => {
    const t = new Date();
    return t.getFullYear() === dt.getFullYear() && t.getMonth() === dt.getMonth() && t.getDate() === dt.getDate();
  })();
  // Split into 3 buckets for this day: assigned / available / day off.
  const { byJob, available, dayOff } = useMemo(() => {
    const assigned: { staff: StaffEntry; row: StaffWeekRow }[] = [];
    const available: StaffEntry[] = [];
    const dayOff: { staff: StaffEntry; reason: string | null }[] = [];
    for (const s of staff) {
      const bucket = s.days[date];
      if (!bucket) continue;
      if (bucket.day_off) {
        dayOff.push({ staff: s, reason: bucket.day_off.reason });
        continue;
      }
      if (bucket.rows.length === 0) {
        available.push(s);
        continue;
      }
      for (const r of bucket.rows) assigned.push({ staff: s, row: r });
    }

    // Group assigned rows by job_id/event_id for clustered display.
    const groups = new Map<string, {
      label: string;
      category: string | null;
      isLux: boolean;
      source: 'job' | 'event' | null;
      sourceId: number | null;
      effectiveColor: string;
      plannerColor: string | null;
      rows: { staff: StaffEntry; row: StaffWeekRow }[];
    }>();
    for (const a of assigned) {
      const key = `${a.row.source ?? 'x'}-${a.row.source_id ?? 0}-${a.row.job_label ?? ''}`;
      const g = groups.get(key) ?? {
        label: a.row.job_label || '(untitled)',
        category: a.row.job_category,
        isLux: a.row.is_lux_job,
        source: a.row.source,
        sourceId: a.row.source_id,
        effectiveColor: a.row.effective_color,
        plannerColor: a.row.planner_color,
        rows: [],
      };
      g.rows.push(a);
      groups.set(key, g);
    }
    return { byJob: Array.from(groups.values()), available, dayOff };
  }, [date, staff]);

  // Color popover state — only one open at a time across the column.
  // Identified by `${source}|${id}`. Used by both tray cards and group headers.
  const [openColorKey, setOpenColorKey] = useState<string | null>(null);
  const [colorAnchor, setColorAnchor] = useState<DOMRect | null>(null);
  const [colorCurrent, setColorCurrent] = useState<string | null>(null);

  async function patchItemColor(source: 'job' | 'event', id: number, color: string | null) {
    try {
      await api.patch('/planner/items/color', { source, id, color });
      onChange();
    } catch (e: any) {
      console.error('[StaffView] color update failed', e?.response?.data || e);
    }
  }

  const cols = COLS;

  // A day with no jobs collapses to a thin rail: no Jobs tray, no column-title
  // band, and the staff rows render in a compact name + toggle layout. The
  // moment a job lands on the day it expands back to the full grid.
  const collapsed = day_jobs.length === 0;

  // Centralized drop handler so all staff rows route through one place.
  // Reads the JSON payload off the dataTransfer and dispatches to the right
  // API call. Errors bubble up via the parent's onChange refetch.
  //
  // New assignments always start as a PORTER (porter wage) regardless of the
  // staff member's default role. The Staff View workflow is: assign → porter,
  // then pick a vehicle on the row to promote them to driver (and a lorry adds
  // the lorry bonus). daily_rate is left null so the server derives the wage
  // from the role (per-staff porter rate, else the porter default).
  async function dropOnStaff(assetId: number, _staffRole: string | null, payload: DragPayload) {
    try {
      if (payload.kind === 'job') {
        await api.post('/planner/assignments', {
          asset_id: assetId,
          assigned_date: date,
          assigned_role: 'porter',
          daily_rate: null,
          [payload.source === 'job' ? 'job_id' : 'event_id']: payload.id,
        });
      } else {
        if (payload.from_asset_id === assetId) return; // dropped on self
        await api.patch(`/planner/assignments/${payload.assignment_id}`, { asset_id: assetId });
      }
      onChange();
    } catch (e: any) {
      // 409 = duplicate (target already on this job). Silent — UI stays put.
      if (e?.response?.status !== 409) {
        console.error('[StaffView] drop failed', e?.response?.data || e);
      }
    }
  }

  return (
    <div className="rounded-2xl bg-white shadow-[0_1px_3px_0_rgba(15,23,42,0.04),0_1px_2px_-1px_rgba(15,23,42,0.04)] ring-1 ring-slate-200/60 flex flex-col min-h-0 overflow-hidden">
      {/* Day header — clean, with prominent date and optional Lux pill */}
      <div className={`sticky top-0 z-10 px-3.5 py-2.5 flex items-center justify-between border-b ${
        isToday
          ? 'bg-gradient-to-b from-indigo-50/80 to-white border-indigo-200/60'
          : 'bg-gradient-to-b from-slate-50/80 to-white border-slate-200/50'
      }`}>
        <div className="flex items-baseline gap-1.5">
          <span className={`text-[10px] font-bold uppercase tracking-[0.12em] ${isToday ? 'text-indigo-500' : 'text-slate-400'}`}>{dayName}</span>
          <span className={`text-sm font-bold tabular-nums ${isToday ? 'text-indigo-700' : 'text-slate-800'}`}>{dayNum}</span>
          <span className="text-[11px] font-medium text-slate-400">{monthShort}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {has_lux && (
            <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.08em] text-blue-700 bg-blue-50 ring-1 ring-blue-200/70 rounded-full px-1.5 py-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
              Lux
            </span>
          )}
          {onAddJob && (
            <button
              type="button"
              onClick={() => onAddJob(date)}
              title={`Add a job on ${dayName} ${dayNum} ${monthShort}`}
              aria-label="Add job on this day"
              className={`inline-flex items-center justify-center w-5 h-5 rounded-md transition-colors ${
                isToday
                  ? 'text-indigo-500 hover:text-white hover:bg-indigo-500'
                  : 'text-slate-400 hover:text-white hover:bg-slate-600'
              }`}
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Jobs tray — compact title chip + draggable job cards. Hidden entirely
          on a collapsed (no-jobs) day; the day-header "+" is the add path. */}
      {!collapsed && (
        <div className="px-2 pt-2 pb-1.5 space-y-1">
          <div className="flex items-center gap-1.5 px-1">
            <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-slate-400">Jobs</span>
            <span className="text-[10px] font-semibold text-slate-500 tabular-nums">{day_jobs.length}</span>
          </div>
          {day_jobs.map(j => (
            <JobTrayCard
              key={`${j.source}-${j.id}`}
              job={j}
              onOpenColor={(rect, current) => {
                setColorAnchor(rect);
                setColorCurrent(current);
                setOpenColorKey(`${j.source}|${j.id}`);
              }}
              onAssign={touch ? () => setAssignJob(j) : undefined}
            />
          ))}
        </div>
      )}

      {/* Column header — soft chip-style band. Skipped when collapsed: with no
          jobs there are no Vehicle/Start/Finish/Hours/Wage cells to label. */}
      {!collapsed && (
        <div
          className="grid items-center gap-1 text-[9px] font-bold uppercase tracking-[0.08em] text-slate-400 px-5 py-1.5 mt-1"
          style={{ gridTemplateColumns: cols }}
        >
          <span className="truncate">Staff</span>
          <span className="truncate">Vehicle</span>
          <span className="truncate">Start</span>
          <span className="truncate">Finish</span>
          <span className="truncate">Hours</span>
          <span className="truncate text-right">Wage</span>
        </div>
      )}

      <div className={`px-2 pb-2 space-y-2 ${collapsed ? 'pt-2' : ''}`}>
        {/* By-job groups — each group is its own subtle card with the item's
            effective color as a left accent. Click the accent to recolor. */}
        {byJob.map((g, gi) => {
          const key = g.source && g.sourceId != null ? `${g.source}|${g.sourceId}` : null;
          return (
            <div
              key={gi}
              className="relative rounded-xl ring-1 ring-slate-200/50 overflow-hidden"
              style={{ boxShadow: `inset 3px 0 0 0 ${g.effectiveColor}`, background: groupTintBg(g.effectiveColor) }}
            >
              {/* Clickable color accent — wider hit area than the visible stripe */}
              {key && g.source && g.sourceId != null && (
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setColorAnchor(rect);
                    setColorCurrent(g.plannerColor);
                    setOpenColorKey(key);
                  }}
                  title="Click to change color"
                  className="absolute left-0 top-0 bottom-0 w-2 hover:w-3 transition-all"
                  style={{ backgroundColor: 'transparent' }}
                  aria-label="Change color"
                />
              )}
              <div className="flex items-center gap-1.5 pl-3 pr-2.5 py-1.5">
                {g.isLux && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" title="Lux Move" />}
                <span className="text-[11px] font-semibold text-slate-700 truncate">{g.label}</span>
                {touch && g.source && g.sourceId != null && (() => {
                  const gj = day_jobs.find(j => j.source === g.source && j.id === g.sourceId);
                  return gj ? (
                    <button
                      type="button"
                      onClick={() => setAssignJob(gj)}
                      className="ml-auto flex-shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold text-blue-700 bg-blue-50 ring-1 ring-blue-200/70 rounded-full px-2 py-0.5 active:bg-blue-100"
                    >
                      <UserPlus className="w-3 h-3" />
                      Staff
                    </button>
                  ) : null;
                })()}
              </div>
              {g.rows.map(({ staff, row }) => (
                <AssignmentGridRow
                  key={row.assignment_id}
                  staffName={staff.name}
                  staffAssetId={staff.asset_id}
                  date={date}
                  staffRole={row.assigned_role || staff.role}
                  row={row}
                  cols={cols}
                  vehicles={vehicles}
                  onChange={onChange}
                  luxRate={luxRate}
                  onDropOnRow={p => dropOnStaff(staff.asset_id, staff.role, p)}
                />
              ))}
            </div>
          );
        })}

        {/* Available staff — split into Drivers / Porters / Other based on role */}
        {available.length > 0 && (() => {
          const drivers: StaffEntry[] = [];
          const porters: StaffEntry[] = [];
          const other: StaffEntry[] = [];
          for (const s of available) {
            const r = String(s.role || '').toLowerCase();
            if (r === 'driver') drivers.push(s);
            else if (r === 'porter') porters.push(s);
            else other.push(s);
          }
          const renderGroup = (label: string, list: StaffEntry[]) => list.length > 0 && (
            <div key={label}>
              <div className="flex items-center gap-1.5 pl-3 pr-2.5 py-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-emerald-700">{label}</span>
                <span className="text-[10px] font-semibold text-emerald-600/70 tabular-nums">{list.length}</span>
              </div>
              {list.map(s => (
                <AvailableRow
                  key={s.asset_id}
                  staff={s}
                  date={date}
                  cols={cols}
                  collapsed={collapsed}
                  onChange={onChange}
                  onDropOnRow={p => dropOnStaff(s.asset_id, s.role, p)}
                />
              ))}
            </div>
          );
          return (
            <div className="rounded-xl ring-1 ring-emerald-200/50 bg-gradient-to-b from-emerald-50/40 to-white overflow-hidden">
              {renderGroup('Drivers', drivers)}
              {renderGroup('Porters', porters)}
              {renderGroup('Available', other)}
            </div>
          );
        })()}

        {/* Day-off — soft red-tinted card */}
        {dayOff.length > 0 && (
          <div className="rounded-xl ring-1 ring-red-200/50 bg-gradient-to-b from-red-50/40 to-white overflow-hidden">
            <div className="flex items-center gap-1.5 pl-3 pr-2.5 py-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
              <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-red-700">Day off</span>
              <span className="text-[10px] font-semibold text-red-600/70 tabular-nums">{dayOff.length}</span>
            </div>
            {dayOff.map(({ staff, reason }) => (
              <DayOffRow
                key={staff.asset_id}
                staff={staff}
                date={date}
                reason={reason}
                cols={cols}
                collapsed={collapsed}
                onChange={onChange}
              />
            ))}
          </div>
        )}

        {byJob.length === 0 && available.length === 0 && dayOff.length === 0 && (
          <div className="px-3 py-6 text-xs text-slate-400 text-center italic">No staff data</div>
        )}
      </div>

      {/* Shared color popover — one per column, anchored to whichever stripe/tray was clicked */}
      {openColorKey && (() => {
        const [source, idStr] = openColorKey.split('|');
        const id = parseInt(idStr, 10);
        return (
          <ColorPickerPopover
            open={true}
            anchorRect={colorAnchor}
            currentColor={colorCurrent}
            onPick={async color => {
              await patchItemColor(source as 'job' | 'event', id, color);
            }}
            onClose={() => { setOpenColorKey(null); setColorAnchor(null); }}
          />
        );
      })()}

      {/* Touch-only staff picker: tap names to assign/unassign instantly */}
      {assignJob && (
        <MobileAssignSheet
          job={assignJob}
          date={date}
          staff={staff}
          onChange={onChange}
          onClose={() => setAssignJob(null)}
        />
      )}
    </div>
  );
}

// ── Top-of-column draggable job card ─────────────────────────────────────────

function JobTrayCard({
  job, onOpenColor, onAssign,
}: {
  job: DayJob;
  onOpenColor: (anchor: DOMRect, currentPlannerColor: string | null) => void;
  // Provided only on touch devices — renders an "Assign Staff" button that opens
  // the tap-to-pick sheet in place of drag-and-drop.
  onAssign?: () => void;
}) {
  const dotColor = job.effective_color || catColor(job.category).dot;
  const haveNeeds = job.men_needed != null || job.vans_needed != null || job.hgv_needed != null;
  const needsMet = job.men_needed != null && job.assigned_count >= job.men_needed;

  function onDragStart(e: DragEvent<HTMLDivElement>) {
    const payload: DragPayload = { kind: 'job', source: job.source, id: job.id, label: job.label };
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
    // Also stash on a plain text MIME — some browsers expose `types` more reliably for built-ins.
    e.dataTransfer.setData('text/plain', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'all';
  }

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className="relative cursor-grab active:cursor-grabbing select-none flex items-center gap-2 pl-3 pr-2 py-1.5 rounded-lg ring-1 ring-slate-200/60 bg-white hover:ring-blue-300/70 hover:shadow-[0_4px_12px_-4px_rgba(59,130,246,0.25)] hover:-translate-y-px transition-all"
      style={{ boxShadow: `inset 2px 0 0 0 ${dotColor}` }}
      title={`${job.label}${job.is_lux ? ' · Lux Move' : ''}${job.contract_name ? `\n${job.contract_name}` : ''}\nDrag onto a staff row to assign`}
    >
      {/* Clickable color hotspot covering the left accent area */}
      <button
        type="button"
        draggable={false}
        onClick={e => {
          e.stopPropagation();
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          onOpenColor(rect, job.planner_color);
        }}
        title="Click to change color"
        className="absolute left-0 top-0 bottom-0 w-2 hover:bg-slate-900/5"
        aria-label="Change color"
      />
      {job.is_lux && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" title="Lux Move" />}
      <div className="min-w-0 flex-1">
        <div className="text-[11.5px] font-semibold text-slate-800 truncate leading-tight">{job.label}</div>
        {(job.contract_name || job.time) && (
          <div className="text-[10px] text-slate-500 truncate leading-tight mt-0.5">
            {job.contract_name && <span>{job.contract_name}</span>}
            {job.contract_name && job.time && <span className="text-slate-300"> · </span>}
            {job.time && <span className="tabular-nums">{job.time}</span>}
          </div>
        )}
      </div>
      {haveNeeds && (
        <div className="flex items-center gap-1 text-[10px] tabular-nums flex-shrink-0">
          {job.men_needed != null && (
            <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full font-semibold ${
              needsMet
                ? 'text-emerald-700 bg-emerald-50 ring-1 ring-emerald-200/60'
                : 'text-slate-600 bg-slate-100/80 ring-1 ring-slate-200/60'
            }`}>
              <Users className="w-2.5 h-2.5" />
              {job.assigned_count}/{job.men_needed}
            </span>
          )}
          {job.vans_needed != null && job.vans_needed > 0 && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full font-semibold text-slate-600 bg-slate-100/80 ring-1 ring-slate-200/60">
              <Truck className="w-2.5 h-2.5" />
              {job.vans_needed}
            </span>
          )}
        </div>
      )}
      {onAssign && (
        <button
          type="button"
          draggable={false}
          onClick={e => { e.stopPropagation(); onAssign(); }}
          className="flex-shrink-0 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-white bg-blue-600 active:bg-blue-700 rounded-full px-2.5 py-1 shadow-sm"
          title="Assign staff to this job"
        >
          <UserPlus className="w-3 h-3" />
          Assign
        </button>
      )}
    </div>
  );
}

// ── Drop target hook (used by every staff row variant) ──────────────────────
//
// Quirks of the HTML5 DnD API we work around here:
//   1. `dataTransfer.types` is unreliable for *custom* MIME types during
//      `dragover` in some Chromium versions — checking the type would cause
//      the dragover handler to no-op, and without preventDefault() the
//      browser refuses to fire `drop`. So we always preventDefault and
//      validate the payload on drop instead.
//   2. dropEffect must be compatible with the source's effectAllowed. We use
//      'all' on sources and don't bother setting dropEffect — the browser
//      picks a compatible one.

function useDropTarget(onDrop: (p: DragPayload) => void) {
  const [over, setOver] = useState(false);
  // HTML5 dragenter/dragleave fire every time the cursor crosses a child
  // element boundary, which makes a naive `setOver(true/false)` flicker as the
  // user moves across nested spans/inputs. Tracking a depth counter keeps the
  // highlight on until the cursor truly exits the row.
  const depthRef = useRef(0);
  return {
    over,
    handlers: {
      onDragOver: (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
      },
      onDragEnter: (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        depthRef.current += 1;
        if (depthRef.current === 1) setOver(true);
      },
      onDragLeave: () => {
        depthRef.current = Math.max(0, depthRef.current - 1);
        if (depthRef.current === 0) setOver(false);
      },
      onDrop: (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        depthRef.current = 0;
        setOver(false);
        const raw = e.dataTransfer.getData(DRAG_MIME) || e.dataTransfer.getData('text/plain');
        if (!raw) return;
        try {
          const p = JSON.parse(raw) as DragPayload;
          if (p && (p.kind === 'job' || p.kind === 'assignment')) onDrop(p);
        } catch { /* malformed — ignore */ }
      },
    },
  };
}

// ── Assigned row (editable, drag source for its job, drop target) ────────────

function AssignmentGridRow({
  staffName, staffAssetId, date, staffRole, row, cols, vehicles, onChange, luxRate, onDropOnRow,
}: {
  staffName: string;
  staffAssetId: number;
  date: string;
  staffRole: string | null;
  row: StaffWeekRow;
  cols: string;
  vehicles: VehicleOption[];
  onChange: () => void;
  luxRate: number;
  onDropOnRow: (p: DragPayload) => void;
}) {
  const [startTime, setStartTime] = useState(row.start_time || '');
  const [finishTime, setFinishTime] = useState(row.finish_time || '');
  const [saving, setSaving] = useState(false);
  const [editingWage, setEditingWage] = useState(false);
  const [wageInput, setWageInput] = useState('');

  useEffect(() => {
    setStartTime(row.start_time || '');
    setFinishTime(row.finish_time || '');
  }, [row.start_time, row.finish_time]);

  // Live wage preview while editing times. A manual override always wins;
  // otherwise for Lux jobs recompute from start/finish so the user sees the
  // wage track their typing without waiting for the server round-trip.
  const previewWage = useMemo(() => {
    if (row.wage_override != null) return row.wage_override;
    if (row.is_lux_job && startTime && finishTime) {
      const h = deriveHoursClient(startTime, finishTime);
      // Per-row rate (per-staff override) beats the global company rate so the
      // preview matches what the server will compute on save.
      const rate = row.lux_hourly_rate ?? luxRate;
      if (h != null) return h * rate + row.wage_bonus;
    }
    return row.wage_total;
  }, [row, startTime, finishTime, luxRate]);

  // Live worked-hours preview — derived from the current start/finish inputs so
  // the Hours column updates as the user types, before the server round-trip.
  const liveHours = useMemo(
    () => deriveHoursClient(startTime, finishTime),
    [startTime, finishTime],
  );

  async function patch(body: Record<string, unknown>) {
    setSaving(true);
    try {
      await api.patch(`/planner/assignments/${row.assignment_id}`, body);
      onChange();
    } finally {
      setSaving(false);
    }
  }

  async function unassign() {
    setSaving(true);
    try {
      await api.delete(`/planner/assignments/${row.assignment_id}`);
      onChange();
    } catch (e: any) {
      console.error('[StaffView] unassign failed', e?.response?.data || e);
    } finally {
      setSaving(false);
    }
  }

  function commitWage() {
    setEditingWage(false);
    const raw = wageInput.trim();
    // Empty input clears the override and restores the calculated wage.
    if (raw === '') {
      if (row.wage_override != null) patch({ wage_override: null });
      return;
    }
    const n = parseFloat(raw);
    if (!isFinite(n) || n < 0) return;
    if (row.wage_override != null && +n.toFixed(2) === +row.wage_override.toFixed(2)) return;
    patch({ wage_override: n });
  }

  // This row is a drag source for its own assignment — grab the staff name and
  // drop on another staff row to reassign the job to that person, or drop onto
  // empty space (any non-row area) to remove them from the job entirely.
  function onJobDragStart(e: DragEvent<HTMLSpanElement>) {
    const payload: DragPayload = {
      kind: 'assignment',
      assignment_id: row.assignment_id,
      source: row.source,
      source_id: row.source_id,
      from_asset_id: staffAssetId,
    };
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
    e.dataTransfer.setData('text/plain', JSON.stringify(payload));
    // Use 'all' so the drop target's effect doesn't have to match exactly —
    // Chromium otherwise silently rejects copy→move (and vice-versa) drops.
    e.dataTransfer.effectAllowed = 'all';
    // Stop the row's drag handlers (if any) from also firing — only the
    // <span> is supposed to be the drag source.
    e.stopPropagation();
  }

  // Released over empty space → unassign. A drop that lands on a real staff row
  // is handled by that row's drop target (which calls preventDefault), so the
  // browser reports a concrete dropEffect ('move'/'copy'). Only a drop that
  // landed on no valid target reports 'none' — that's our "drag to remove".
  function onJobDragEnd(e: DragEvent<HTMLSpanElement>) {
    if (e.dataTransfer.dropEffect === 'none') unassign();
  }

  const { over, handlers } = useDropTarget(onDropOnRow);

  return (
    <div
      {...handlers}
      className={`group grid items-center gap-1 px-3 py-0.5 text-xs transition-colors ${
        over
          ? 'bg-blue-50/80 ring-1 ring-blue-300/70 ring-inset'
          : 'hover:bg-slate-50/70'
      }`}
      style={{ gridTemplateColumns: cols }}
    >
      <span
        draggable
        onDragStart={onJobDragStart}
        onDragEnd={onJobDragEnd}
        data-staff-asset-id={staffAssetId}
        data-staff-date={date}
        className="min-w-0 cursor-grab active:cursor-grabbing text-slate-800 font-medium flex items-center gap-1.5"
        title={`Drag ${staffName} onto another staff row to reassign, or onto empty space to remove from this job`}
      >
        {row.is_lux_job && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />}
        <span className="truncate">{staffName}</span>
        {staffRole && (
          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider flex-shrink-0">
            {staffRole.charAt(0)}
          </span>
        )}
      </span>
      <VehicleSelect
        value={row.vehicle_asset_id}
        vehicles={vehicles}
        onChange={async v => {
          // Picking a vehicle promotes the staff member to DRIVER (driver wage,
          // plus the lorry bonus when the van is a lorry — the server adds that
          // automatically once the role is driver). Clearing it reverts to
          // PORTER. daily_rate is reset to null so the wage re-derives from the
          // new role rather than keeping the previous rate.
          await patch({
            vehicle_asset_id: v,
            assigned_role: v != null ? 'driver' : 'porter',
            daily_rate: null,
          });
        }}
      />
      <input
        type="time"
        value={startTime}
        onChange={e => setStartTime(e.target.value)}
        onBlur={() => {
          if (startTime === (row.start_time || '')) return;
          patch({ start_time: startTime || null });
        }}
        className="min-w-0 bg-transparent ring-1 ring-transparent hover:ring-slate-200 focus:ring-blue-300 focus:bg-white focus:outline-none rounded-md px-1 py-0.5 w-full text-[11px] tabular-nums transition-all [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:m-0 [&::-webkit-calendar-picker-indicator]:w-0"
      />
      <input
        type="time"
        value={finishTime}
        onChange={e => setFinishTime(e.target.value)}
        onBlur={() => {
          if (finishTime === (row.finish_time || '')) return;
          patch({ finish_time: finishTime || null });
        }}
        className="min-w-0 bg-transparent ring-1 ring-transparent hover:ring-slate-200 focus:ring-blue-300 focus:bg-white focus:outline-none rounded-md px-1 py-0.5 w-full text-[11px] tabular-nums transition-all [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:m-0 [&::-webkit-calendar-picker-indicator]:w-0"
      />
      <span
        className={`min-w-0 truncate text-[11px] tabular-nums px-1 ${liveHours != null && liveHours > 0 ? 'text-slate-600 font-medium' : 'text-slate-300'}`}
        title={liveHours != null && liveHours > 0 ? `${liveHours} hours worked` : 'Set start and finish to compute hours'}
      >
        {fmtHours(liveHours)}
      </span>
      <span className="min-w-0 justify-self-end inline-flex items-center gap-1 tabular-nums">
        {editingWage ? (
          <span className="inline-flex items-center gap-0.5">
            <span className="text-[10px] text-slate-400">£</span>
            <input
              type="number"
              min="0"
              step="5"
              autoFocus
              value={wageInput}
              onChange={e => setWageInput(e.target.value)}
              onBlur={commitWage}
              onKeyDown={e => {
                if (e.key === 'Enter') commitWage();
                if (e.key === 'Escape') setEditingWage(false);
              }}
              placeholder="auto"
              className="w-14 text-[11px] font-semibold bg-white ring-1 ring-blue-300 rounded-md px-1.5 py-0.5 outline-none text-slate-800 text-right tabular-nums"
            />
          </span>
        ) : (
          <button
            type="button"
            onClick={() => {
              setWageInput(row.wage_override != null ? String(row.wage_override) : '');
              setEditingWage(true);
            }}
            title={row.wage_override != null
              ? `Manual override — click to edit (clear to restore ${row.is_lux_job ? 'hours × rate' : 'daily rate'})`
              : 'Click to set a manual wage'}
            className={`px-2 py-0.5 rounded-md text-[11px] font-semibold transition-colors ${
              row.wage_override != null
                ? 'text-amber-800 bg-amber-50 ring-1 ring-amber-200 hover:ring-amber-300'
                : row.is_lux_job
                  ? 'text-blue-700 bg-blue-50 ring-1 ring-blue-100 hover:ring-blue-300'
                  : 'text-slate-700 bg-slate-100/70 ring-1 ring-transparent hover:ring-slate-300'
            }`}
          >
            {saving ? '…' : fmtMoney(previewWage)}
          </button>
        )}
        {row.wage_override != null && !editingWage && (
          <button
            type="button"
            onClick={() => patch({ wage_override: null })}
            disabled={saving}
            title="Clear manual wage and restore calculated amount"
            className="inline-flex items-center justify-center w-4 h-4 rounded-full text-amber-500 hover:text-white hover:bg-amber-500 transition-colors"
          >
            <X className="w-2.5 h-2.5" />
          </button>
        )}
      </span>
    </div>
  );
}

// ── Vehicle dropdown ────────────────────────────────────────────────────────

function VehicleSelect({
  value, vehicles, onChange,
}: {
  value: number | null;
  vehicles: VehicleOption[];
  onChange: (id: number | null) => void;
}) {
  const selected = value != null ? vehicles.find(v => v.id === value) : null;
  const tooltip = selected
    ? `${selected.label}${selected.is_lorry ? ' (HGV)' : ''}`
    : 'Pick a vehicle';
  return (
    <select
      value={value ?? ''}
      onChange={e => onChange(e.target.value === '' ? null : parseInt(e.target.value, 10))}
      // Keep this floor tight so the native dropdown arrow sits close to the van
      // name rather than floating far right (the gap the user flagged). ~3rem is
      // enough for 3–4 letters plus the arrow before the ellipsis kicks in; the
      // minmax(0,…) track lets it truncate gracefully past that.
      style={{ minWidth: '3rem' }}
      className={`min-w-0 bg-transparent ring-1 ring-transparent hover:ring-slate-200 focus:ring-blue-300 focus:bg-white focus:outline-none rounded-md px-1 py-0.5 w-full text-[11px] truncate transition-all cursor-pointer ${
        value != null ? 'text-slate-700 font-medium' : 'text-slate-400'
      }`}
      title={tooltip}
    >
      <option value="">— pick van —</option>
      {vehicles.map(v => (
        <option key={v.id} value={v.id}>
          {v.label}{v.is_lorry ? ' (HGV)' : ''}
        </option>
      ))}
    </select>
  );
}

// ── Available row (drop target + mark-day-off) ──────────────────────────────

function AvailableRow({
  staff, date, cols, collapsed = false, onChange, onDropOnRow,
}: {
  staff: StaffEntry; date: string; cols: string; collapsed?: boolean;
  onChange: () => void; onDropOnRow: (p: DragPayload) => void;
}) {
  const [busy, setBusy] = useState(false);
  async function markOff() {
    // Prompt for an optional reason. Cancel aborts. Empty string = no reason
    // (DayOffRow then renders "Day off"); any text becomes the row label.
    const raw = window.prompt(`Mark ${staff.name} off on ${date}.\n\nReason (optional):`, '');
    if (raw === null) return; // user hit Cancel
    const reason = raw.trim() || null;
    setBusy(true);
    try {
      await api.post('/planner/time-off', { asset_id: staff.asset_id, date, reason });
      onChange();
    } finally { setBusy(false); }
  }
  const { over, handlers } = useDropTarget(onDropOnRow);

  // Compact rail layout for a collapsed (no-jobs) day: just the name + OFF
  // toggle in a simple flex row, no Vehicle/Start/Finish/Hours/Wage cells.
  if (collapsed) {
    return (
      <div
        {...handlers}
        className={`flex items-center gap-1 px-3 py-0.5 text-xs transition-colors ${
          over ? 'bg-blue-100/70 ring-1 ring-blue-400/70 ring-inset' : 'hover:bg-white/50'
        }`}
        title="Drop a job here to assign this staff member"
      >
        <span
          data-staff-asset-id={staff.asset_id}
          data-staff-date={date}
          className="min-w-0 flex-1 text-slate-700 font-medium leading-tight flex items-center gap-1.5"
        >
          <span className="truncate">{staff.name}</span>
          <span className="text-emerald-600/70 italic text-[10px] font-normal flex-shrink-0">Free</span>
        </span>
        <button
          onClick={markOff}
          disabled={busy}
          className="flex-shrink-0 text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md px-1.5 py-0.5 transition-colors"
          title="Mark this staff member off for the day"
        >
          OFF
        </button>
      </div>
    );
  }

  return (
    <div
      {...handlers}
      className={`grid items-center gap-1 px-3 py-0.5 text-xs transition-colors ${
        over
          ? 'bg-blue-100/70 ring-1 ring-blue-400/70 ring-inset'
          : 'hover:bg-white/50'
      }`}
      style={{ gridTemplateColumns: cols }}
      title="Drop a job here to assign this staff member"
    >
      <span
        data-staff-asset-id={staff.asset_id}
        data-staff-date={date}
        className="min-w-0 text-slate-700 font-medium leading-tight flex items-center gap-1.5"
      >
        <span className="truncate">{staff.name}</span>
        <span className="text-emerald-600/70 italic text-[10px] font-normal flex-shrink-0">Free</span>
      </span>
      <span className="text-slate-300 text-center">·</span>
      <span className="text-slate-300 text-center">·</span>
      <span className="text-slate-300 text-center">·</span>
      <span className="text-slate-300 text-center">·</span>
      <button
        onClick={markOff}
        disabled={busy}
        className="justify-self-end text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md px-1.5 py-0.5 transition-colors whitespace-nowrap"
        title="Mark this staff member off for the day"
      >
        OFF
      </button>
    </div>
  );
}

// ── Day-off row ──────────────────────────────────────────────────────────────

function DayOffRow({
  staff, date, reason, cols, collapsed = false, onChange,
}: {
  staff: StaffEntry; date: string; reason: string | null;
  cols: string; collapsed?: boolean; onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  async function clear() {
    setBusy(true);
    try {
      await api.delete('/planner/time-off', { data: { asset_id: staff.asset_id, date } });
      onChange();
    } finally { setBusy(false); }
  }

  // Compact rail layout for a collapsed (no-jobs) day: name + reason + Clear.
  if (collapsed) {
    return (
      <div
        className="flex items-center gap-1 px-3 py-0.5 text-xs text-red-700/90"
        title={reason || 'Day off'}
      >
        <span
          data-staff-asset-id={staff.asset_id}
          data-staff-date={date}
          className="min-w-0 flex-1 font-medium leading-tight flex items-center gap-1.5"
        >
          <span className="truncate flex-shrink-0 max-w-[55%]">{staff.name}</span>
          <span className="italic text-[10px] font-normal text-red-500/70 truncate" title="Day off">{reason || 'Day off'}</span>
        </span>
        <button
          onClick={clear}
          disabled={busy}
          className="flex-shrink-0 text-[10px] font-medium text-red-500/70 hover:text-red-700 hover:bg-red-100/60 rounded-md px-1.5 py-0.5 transition-colors"
        >
          Clear
        </button>
      </div>
    );
  }

  return (
    <div
      className="grid items-center gap-1 px-3 py-0.5 text-xs text-red-700/90"
      style={{ gridTemplateColumns: cols }}
      title={reason || 'Day off'}
    >
      <span
        data-staff-asset-id={staff.asset_id}
        data-staff-date={date}
        className="min-w-0 font-medium leading-tight flex items-center gap-1.5"
      >
        <span className="truncate flex-shrink-0 max-w-[60%]">{staff.name}</span>
        <span className="italic text-[10px] font-normal text-red-500/70 truncate" title="Day off">{reason || 'Day off'}</span>
      </span>
      <span className="text-red-200 text-center">·</span>
      <span className="text-red-200 text-center">·</span>
      <span className="text-red-200 text-center">·</span>
      <span className="text-red-200 text-center">·</span>
      <button
        onClick={clear}
        disabled={busy}
        className="justify-self-end text-[10px] font-medium text-red-500/70 hover:text-red-700 hover:bg-red-100/60 rounded-md px-1.5 py-0.5 transition-colors"
      >
        Clear
      </button>
    </div>
  );
}

// ── Mobile/tablet staff picker sheet ────────────────────────────────────────
//
// Touch alternative to drag-and-drop. Opened from a job's "Assign" button, it
// shows the job at the top and a list of staff with square toggles. Tapping a
// name assigns/unassigns that person to THIS job immediately (instant mode):
//   - unchecked → checked: POST a porter assignment (same as a drag-drop)
//   - checked → unchecked: DELETE that person's assignment for this job
// After each change it refetches via onChange, so the toggles reflect the live
// server state (and the planner rows below update too). Day-off staff are shown
// disabled so it's clear why they can't be picked.
function MobileAssignSheet({
  job, date, staff, onChange, onClose,
}: {
  job: DayJob;
  date: string;
  staff: StaffEntry[];
  onChange: () => void;
  onClose: () => void;
}) {
  // Local selection — which staff SHOULD be on this job. Seeded from the current
  // assignments and edited freely by tapping; nothing hits the server until the
  // user taps Done (batch mode). `saving` guards the apply round-trip.
  const [selected, setSelected] = useState<Set<number>>(() => {
    const set = new Set<number>();
    for (const s of staff) {
      if (s.days[date]?.rows.some(r => r.source === job.source && r.source_id === job.id)) {
        set.add(s.asset_id);
      }
    }
    return set;
  });
  const [saving, setSaving] = useState(false);

  // Bucket every staff member by their CURRENT (server) state for this day/job.
  // The grouping stays put while you toggle; only the checkmark follows your
  // selection, so the list doesn't jump around under your thumb.
  const { onJob, free, elsewhere, off } = useMemo(() => {
    const onJob: StaffEntry[] = [];
    const free: StaffEntry[] = [];
    const elsewhere: { s: StaffEntry; other: string }[] = [];
    const off: { s: StaffEntry; reason: string | null }[] = [];
    for (const s of staff) {
      const bucket = s.days[date];
      // No bucket → this person isn't on the roster for this day; skip them, the
      // same way the planner's own available/assigned lists do.
      if (!bucket) continue;
      if (bucket.day_off) { off.push({ s, reason: bucket.day_off.reason }); continue; }
      const rows = bucket.rows;
      if (rows.some(r => r.source === job.source && r.source_id === job.id)) onJob.push(s);
      else if (rows.length > 0) elsewhere.push({ s, other: rows[0].job_label || 'another job' });
      else free.push(s);
    }
    return { onJob, free, elsewhere, off };
  }, [staff, date, job.source, job.id]);

  // Local-only toggle — no network. Just flips membership in `selected`.
  function toggle(s: StaffEntry) {
    setSelected(prev => {
      const n = new Set(prev);
      if (n.has(s.asset_id)) n.delete(s.asset_id);
      else n.add(s.asset_id);
      return n;
    });
  }

  // How many adds/removes are pending vs the current server state — drives the
  // count badge on the Done button so the user sees there's something to save.
  const pendingCount = useMemo(() => {
    let n = 0;
    for (const s of staff) {
      const bucket = s.days[date];
      if (!bucket || bucket.day_off) continue;
      const existing = bucket.rows.some(r => r.source === job.source && r.source_id === job.id);
      if (selected.has(s.asset_id) !== existing) n++;
    }
    return n;
  }, [staff, date, job.source, job.id, selected]);

  // Done → apply the whole diff at once (POST adds, DELETE removes), then refetch
  // and close. Nothing pending → just close without a round-trip.
  async function applyAndClose() {
    if (pendingCount === 0) { onClose(); return; }
    setSaving(true);
    const ops: Promise<unknown>[] = [];
    for (const s of staff) {
      const bucket = s.days[date];
      if (!bucket || bucket.day_off) continue;
      const existing = bucket.rows.find(r => r.source === job.source && r.source_id === job.id);
      const want = selected.has(s.asset_id);
      if (want && !existing) {
        ops.push(api.post('/planner/assignments', {
          asset_id: s.asset_id,
          assigned_date: date,
          assigned_role: 'porter',
          daily_rate: null,
          [job.source === 'job' ? 'job_id' : 'event_id']: job.id,
        }));
      } else if (!want && existing) {
        ops.push(api.delete(`/planner/assignments/${existing.assignment_id}`));
      }
    }
    // allSettled so one failed op doesn't abort the rest; 409 (already assigned)
    // is benign and the refetch reconciles whatever actually landed.
    const results = await Promise.allSettled(ops);
    const failed = results.filter(
      r => r.status === 'rejected' && (r.reason as any)?.response?.status !== 409,
    );
    if (failed.length) console.error('[StaffView] batch assign: some ops failed', failed);
    onChange();
    setSaving(false);
    onClose();
  }

  function StaffToggle({ s, subtitle }: { s: StaffEntry; subtitle?: string }) {
    const checked = selected.has(s.asset_id);
    return (
      <button
        type="button"
        onClick={() => toggle(s)}
        disabled={saving}
        className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-slate-50 disabled:opacity-60 transition-colors"
      >
        <span
          className={`flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center transition-colors ${
            checked ? 'bg-blue-600 text-white' : 'bg-white ring-2 ring-slate-300'
          }`}
        >
          {checked ? <Check className="w-4 h-4" /> : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-slate-800 truncate">{s.name}</span>
            {s.role && (
              <span className="flex-shrink-0 text-[9px] font-bold uppercase tracking-wider text-slate-400">{s.role}</span>
            )}
          </span>
          {subtitle && <span className="block text-[11px] text-amber-600 truncate mt-0.5">{subtitle}</span>}
        </span>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button type="button" aria-label="Cancel" disabled={saving} className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl shadow-[0_-8px_30px_-12px_rgba(15,23,42,0.4)] max-h-[82vh] flex flex-col">
        {/* Grab handle */}
        <div className="pt-2 pb-1 flex justify-center flex-shrink-0">
          <span className="w-9 h-1 rounded-full bg-slate-300" />
        </div>
        {/* Job header + Done */}
        <div className="px-4 pb-3 pt-1 flex items-start gap-3 border-b border-slate-100 flex-shrink-0">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              {job.is_lux && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />}
              <span className="text-base font-semibold text-slate-900 truncate">{job.label}</span>
            </div>
            {(job.contract_name || job.time) && (
              <div className="text-[12px] text-slate-500 truncate mt-0.5">
                {job.contract_name && <span>{job.contract_name}</span>}
                {job.contract_name && job.time && <span className="text-slate-300"> · </span>}
                {job.time && <span className="tabular-nums">{job.time}</span>}
              </div>
            )}
            <div className="text-[11px] text-slate-400 mt-0.5">Toggle staff on/off, then tap Done to save.</div>
          </div>
          <button
            type="button"
            onClick={applyAndClose}
            disabled={saving}
            className="flex-shrink-0 inline-flex items-center gap-1.5 text-sm font-semibold text-white bg-blue-600 active:bg-blue-700 disabled:opacity-70 rounded-full px-4 py-1.5 -mr-1"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {saving ? 'Saving…' : 'Done'}
            {!saving && pendingCount > 0 && (
              <span className="inline-flex items-center justify-center min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-white/25 text-[11px] tabular-nums">
                {pendingCount}
              </span>
            )}
          </button>
        </div>
        {/* Staff list */}
        <div className="overflow-y-auto overscroll-contain divide-y divide-slate-100">
          {onJob.length > 0 && (
            <>
              <SheetSectionLabel>On this job · {onJob.length}</SheetSectionLabel>
              {onJob.map(s => <StaffToggle key={s.asset_id} s={s} />)}
            </>
          )}
          {free.length > 0 && (
            <>
              <SheetSectionLabel>Available</SheetSectionLabel>
              {free.map(s => <StaffToggle key={s.asset_id} s={s} />)}
            </>
          )}
          {elsewhere.length > 0 && (
            <>
              <SheetSectionLabel>On another job</SheetSectionLabel>
              {elsewhere.map(({ s, other }) => (
                <StaffToggle key={s.asset_id} s={s} subtitle={`Already on ${other}`} />
              ))}
            </>
          )}
          {off.length > 0 && (
            <>
              <SheetSectionLabel>Day off</SheetSectionLabel>
              {off.map(({ s, reason }) => (
                <div key={s.asset_id} className="w-full flex items-center gap-3 px-4 py-3 opacity-50">
                  <span className="flex-shrink-0 w-6 h-6 rounded-md bg-slate-100 ring-2 ring-slate-200" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-slate-500 truncate">{s.name}</span>
                    <span className="block text-[11px] text-red-500/70 truncate">{reason || 'Day off'}</span>
                  </span>
                </div>
              ))}
            </>
          )}
          {onJob.length + free.length + elsewhere.length + off.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-slate-400">No staff to show</div>
          )}
        </div>
      </div>
    </div>
  );
}

function SheetSectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="sticky top-0 bg-slate-50/95 backdrop-blur px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400 z-10">
      {children}
    </div>
  );
}

// ── Client-side hours derivation (mirrors server/lib/wage-calc.js) ──────────

function deriveHoursClient(start: string, finish: string): number | null {
  const s = toMinutes(start);
  const f = toMinutes(finish);
  if (s == null || f == null) return null;
  let diff = f - s;
  if (diff < 0) diff += 24 * 60;
  return +(diff / 60).toFixed(2);
}

function toMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}
