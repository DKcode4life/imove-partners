/**
 * Staff View — per-staff weekly grid with drag-and-drop assignment.
 *
 * Layout per day column:
 *   1. "Jobs" tray at the top — every CrmJob and PlannerEvent scheduled that
 *      day. Each card shows needed staff/vans (when available) and how many
 *      are already assigned. Cards are draggable onto staff rows below.
 *   2. Assignment rows grouped by job. Each row shows
 *      Staff · Job · VH · Start [· Finish] · Wage. Finish only appears when
 *      the day has at least one Lux job (server-provided `has_lux[date]`).
 *   3. Available staff (no assignment, no time off).
 *   4. Day-off staff (red rows).
 *
 * Drag sources:
 *   - Top-tray job card: payload {kind:'job', source, id}
 *   - An assigned-row's job label: payload {kind:'assignment', assignment_id}
 *
 * Drop target = any staff row for that date. The handler decides:
 *   - kind=job → POST /planner/assignments (create)
 *   - kind=assignment → PATCH /planner/assignments/:id { asset_id } (reassign)
 */
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Loader2, Users, Truck, X } from 'lucide-react';
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

// Column-template strings — switched per-day depending on whether Finish is shown.
// Job column is widened (1.4 → 2.0) so longer descriptions fit.
// Vehicle column widened so longer nicknames stay readable in the dropdown.
const COLS_NO_FINISH = '1.5fr 1.8fr 1.4fr 0.7fr 0.9fr';
const COLS_WITH_FINISH = '1.5fr 1.8fr 1.4fr 0.7fr 0.7fr 0.9fr';

// ── Component ────────────────────────────────────────────────────────────────

export default function StaffWeekView({ weekStart }: { weekStart: string }) {
  const [data, setData] = useState<StaffWeekPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => { load(); }, [load]);

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
        className="grid h-full p-2 gap-2"
        style={{ gridTemplateColumns: `repeat(${data.dates.length}, minmax(420px, 1fr))` }}
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
          />
        ))}
      </div>
    </div>
  );
}

// ── Single day column ────────────────────────────────────────────────────────

function StaffDayColumn({
  date, dayName, staff, day_jobs, has_lux, vehicles, onChange, luxRate,
}: {
  date: string;
  dayName: string;
  staff: StaffEntry[];
  day_jobs: DayJob[];
  has_lux: boolean;
  vehicles: VehicleOption[];
  onChange: () => void;
  luxRate: number;
}) {
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

  const cols = has_lux ? COLS_WITH_FINISH : COLS_NO_FINISH;

  // Centralized drop handler so all staff rows route through one place.
  // Reads the JSON payload off the dataTransfer and dispatches to the right
  // API call. Errors bubble up via the parent's onChange refetch.
  //
  // `staffRole` is required for new assignments so the Weekly View can
  // route the staff member into the right zone (driver vs porter) and the
  // wage default matches what Weekly View would have applied if the assignment
  // had been created there.
  async function dropOnStaff(assetId: number, staffRole: string | null, payload: DragPayload) {
    try {
      if (payload.kind === 'job') {
        const role = String(staffRole || '').toLowerCase();
        const assigned_role = role === 'driver' || role === 'porter' ? role : null;
        const daily_rate = role === 'driver' ? 150 : role === 'porter' ? 125 : null;
        await api.post('/planner/assignments', {
          asset_id: assetId,
          assigned_date: date,
          assigned_role,
          daily_rate,
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
        {has_lux && (
          <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.08em] text-blue-700 bg-blue-50 ring-1 ring-blue-200/70 rounded-full px-1.5 py-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
            Lux
          </span>
        )}
      </div>

      {/* Jobs tray — compact title chip + draggable job cards */}
      <div className="px-2 pt-2 pb-1.5 space-y-1">
        <div className="flex items-center gap-1.5 px-1">
          <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-slate-400">Jobs</span>
          <span className="text-[10px] font-semibold text-slate-500 tabular-nums">{day_jobs.length}</span>
        </div>
        {day_jobs.length === 0 ? (
          <div className="text-[11px] text-slate-400 italic px-1 py-0.5">No jobs scheduled</div>
        ) : (
          day_jobs.map(j => (
            <JobTrayCard
              key={`${j.source}-${j.id}`}
              job={j}
              onOpenColor={(rect, current) => {
                setColorAnchor(rect);
                setColorCurrent(current);
                setOpenColorKey(`${j.source}|${j.id}`);
              }}
            />
          ))
        )}
      </div>

      {/* Column header — soft chip-style band */}
      <div
        className="grid text-[9px] font-bold uppercase tracking-[0.08em] text-slate-400 px-3 py-1.5 mt-1"
        style={{ gridTemplateColumns: cols }}
      >
        <span>Staff</span>
        <span>Job</span>
        <span>Vehicle</span>
        <span>Start</span>
        {has_lux && <span>Finish</span>}
        <span className="text-right">Wage</span>
      </div>

      <div className="px-2 pb-2 space-y-2">
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
              </div>
              {g.rows.map(({ staff, row }) => (
                <AssignmentGridRow
                  key={row.assignment_id}
                  staffName={staff.name}
                  staffRole={row.assigned_role || staff.role}
                  row={row}
                  cols={cols}
                  hasFinish={has_lux}
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
                  hasFinish={has_lux}
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
                hasFinish={has_lux}
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
    </div>
  );
}

// ── Top-of-column draggable job card ─────────────────────────────────────────

function JobTrayCard({
  job, onOpenColor,
}: {
  job: DayJob;
  onOpenColor: (anchor: DOMRect, currentPlannerColor: string | null) => void;
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
  staffName, staffRole, row, cols, hasFinish, vehicles, onChange, luxRate, onDropOnRow,
}: {
  staffName: string;
  staffRole: string | null;
  row: StaffWeekRow;
  cols: string;
  hasFinish: boolean;
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

  // This row is a drag source for its own job (so the user can grab the
  // job label and drop on another staff row to reassign).
  function onJobDragStart(e: DragEvent<HTMLSpanElement>) {
    const payload: DragPayload = {
      kind: 'assignment',
      assignment_id: row.assignment_id,
      source: row.source,
      source_id: row.source_id,
      from_asset_id: -1,
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
      <span className="truncate text-slate-800 font-medium flex items-center gap-1.5">
        <span className="truncate">{staffName}</span>
        {staffRole && (
          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider flex-shrink-0">
            {staffRole.charAt(0)}
          </span>
        )}
      </span>
      <span
        draggable
        onDragStart={onJobDragStart}
        className="cursor-grab active:cursor-grabbing truncate text-slate-600 hover:text-blue-700 inline-flex items-center gap-1.5 transition-colors"
        title={row.job_label ? `${row.job_label}${row.is_lux_job ? ' · Lux Move' : ''}\nDrag onto another staff row to reassign` : 'Drag onto another staff row to reassign'}
      >
        {row.is_lux_job && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />}
        <span className="truncate">{row.job_label || '—'}</span>
      </span>
      <VehicleSelect
        value={row.vehicle_asset_id}
        vehicles={vehicles}
        onChange={async v => { await patch({ vehicle_asset_id: v }); }}
      />
      <input
        type="time"
        value={startTime}
        onChange={e => setStartTime(e.target.value)}
        onBlur={() => {
          if (startTime === (row.start_time || '')) return;
          patch({ start_time: startTime || null });
        }}
        className="bg-transparent ring-1 ring-transparent hover:ring-slate-200 focus:ring-blue-300 focus:bg-white focus:outline-none rounded-md px-1.5 py-0.5 w-full text-[11px] tabular-nums transition-all"
      />
      {hasFinish && (
        <input
          type="time"
          value={finishTime}
          onChange={e => setFinishTime(e.target.value)}
          onBlur={() => {
            if (finishTime === (row.finish_time || '')) return;
            patch({ finish_time: finishTime || null });
          }}
          disabled={!row.is_lux_job}
          placeholder={row.is_lux_job ? '' : '—'}
          className="bg-transparent ring-1 ring-transparent hover:ring-slate-200 focus:ring-blue-300 focus:bg-white focus:outline-none rounded-md px-1.5 py-0.5 w-full text-[11px] tabular-nums disabled:text-slate-300 disabled:cursor-not-allowed transition-all"
        />
      )}
      <span className="justify-self-end inline-flex items-center gap-1 tabular-nums">
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
        <button
          type="button"
          onClick={unassign}
          disabled={saving}
          title={`Unassign ${staffName} from this job`}
          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 inline-flex items-center justify-center w-5 h-5 rounded-md text-slate-400 hover:text-white hover:bg-red-500 transition-all"
        >
          <X className="w-3 h-3" />
        </button>
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
      className={`bg-transparent ring-1 ring-transparent hover:ring-slate-200 focus:ring-blue-300 focus:bg-white focus:outline-none rounded-md px-1.5 py-0.5 w-full min-w-0 text-[11px] truncate transition-all cursor-pointer ${
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
  staff, date, cols, hasFinish, onChange, onDropOnRow,
}: {
  staff: StaffEntry; date: string; cols: string; hasFinish: boolean;
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
      <span className="truncate text-slate-700 font-medium leading-tight">{staff.name}</span>
      <span className="text-emerald-600/80 italic text-[11px] leading-tight">Free</span>
      <span className="text-slate-300 text-center">·</span>
      <span className="text-slate-300 text-center">·</span>
      {hasFinish && <span className="text-slate-300 text-center">·</span>}
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
  staff, date, reason, cols, hasFinish, onChange,
}: {
  staff: StaffEntry; date: string; reason: string | null;
  cols: string; hasFinish: boolean; onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  async function clear() {
    setBusy(true);
    try {
      await api.delete('/planner/time-off', { data: { asset_id: staff.asset_id, date } });
      onChange();
    } finally { setBusy(false); }
  }
  return (
    <div
      className="grid items-center gap-1 px-3 py-0.5 text-xs text-red-700/90"
      style={{ gridTemplateColumns: cols }}
      title={reason || 'Day off'}
    >
      <span className="truncate font-medium leading-tight">{staff.name}</span>
      <span className="italic truncate text-[11px]" title="Day off">{reason || 'Day off'}</span>
      <span className="text-red-200 text-center">·</span>
      <span className="text-red-200 text-center">·</span>
      {hasFinish && <span className="text-red-200 text-center">·</span>}
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
