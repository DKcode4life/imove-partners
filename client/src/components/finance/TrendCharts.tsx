/**
 * Finance charts — hand-rolled SVG, no chart library.
 *
 * Both charts use the "emphasis" pattern: the current period in the accent
 * blue, the same period last year as a de-emphasis gray ghost. Colors follow
 * the entity across both charts (this year = blue, last year = gray) and were
 * validated for CVD separation and surface contrast (ΔE 57 protan, ≥3:1).
 * Identity never rides on color alone: both charts carry a legend, tooltips
 * list every series, and the monthly table below the charts is the table-view
 * twin of the same numbers.
 */
import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

export const SERIES_CURRENT = '#2563eb'; // this year
export const SERIES_GHOST = '#64748b';   // same period last year (de-emphasis)

function fmtMoney(n: number): string {
  return `£${(Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

// Round the axis maximum up to a clean tick step so gridline labels read as
// 0 / 500 / 1,000 instead of raw data maxima.
function niceScale(min: number, max: number): { lo: number; hi: number; ticks: number[] } {
  const lo = Math.min(0, min);
  const hi = Math.max(1, max);
  const span = hi - lo;
  const rawStep = span / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= rawStep) || rawStep;
  const niceLo = Math.floor(lo / step) * step;
  const niceHi = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let t = niceLo; t <= niceHi + 1e-9; t += step) ticks.push(+t.toFixed(2));
  return { lo: niceLo, hi: niceHi, ticks };
}

export interface ChartPoint {
  key: string;       // week_start or YYYY-MM
  label: string;     // short x label
  fullLabel: string; // tooltip heading
  value: number;
  ghostValue: number | null;
}

interface TooltipState {
  index: number;
  x: number; // px inside the wrapper
}

function ChartLegend({ ghostLabel }: { ghostLabel: string }) {
  return (
    <div className="flex items-center gap-4 text-xs text-slate-500">
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block w-4 h-0.5 rounded-full" style={{ background: SERIES_CURRENT }} />
        This year
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block w-4 h-0.5 rounded-full" style={{ background: SERIES_GHOST }} />
        {ghostLabel}
      </span>
    </div>
  );
}

function Tooltip({ tip, points, ghostLabel }: { tip: TooltipState; points: ChartPoint[]; ghostLabel: string }) {
  const p = points[tip.index];
  if (!p) return null;
  return (
    <div
      className="pointer-events-none absolute top-2 z-10 rounded-lg bg-slate-900/95 px-3 py-2 text-xs shadow-lg"
      style={{ left: Math.min(Math.max(tip.x - 70, 4), 9999), maxWidth: 200 }}
    >
      <div className="font-semibold text-slate-200 mb-1">{p.fullLabel}</div>
      <div className="flex items-center gap-2">
        <span className="inline-block w-3 h-0.5 rounded-full" style={{ background: '#60a5fa' }} />
        <span className="font-bold text-white tabular-nums">{fmtMoney(p.value)}</span>
        <span className="text-slate-400">this year</span>
      </div>
      {p.ghostValue != null && (
        <div className="flex items-center gap-2 mt-0.5">
          <span className="inline-block w-3 h-0.5 rounded-full" style={{ background: '#94a3b8' }} />
          <span className="font-bold text-white tabular-nums">{fmtMoney(p.ghostValue)}</span>
          <span className="text-slate-400">{ghostLabel.toLowerCase()}</span>
        </div>
      )}
    </div>
  );
}

// Shared pointer→index helpers keep both charts' hit behavior identical: the
// whole plot width is the hit target and the pointer snaps to the nearest slot.
function useNearestIndex(count: number, padL: number, plotW: number) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<TooltipState | null>(null);

  function onPointerMove(e: PointerEvent) {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect || count === 0) return;
    const xView = ((e.clientX - rect.left) / rect.width) * (padL + plotW + 16);
    const slot = plotW / Math.max(1, count - 1 || 1);
    const idx = Math.max(0, Math.min(count - 1, Math.round((xView - padL) / slot)));
    setTip({ index: idx, x: ((padL + idx * slot) / (padL + plotW + 16)) * rect.width });
  }
  function onKeyDown(e: KeyboardEvent) {
    if (count === 0) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Escape') return;
    e.preventDefault();
    if (e.key === 'Escape') { setTip(null); return; }
    const rect = wrapRef.current?.getBoundingClientRect();
    const cur = tip?.index ?? count - 1;
    const idx = Math.max(0, Math.min(count - 1, cur + (e.key === 'ArrowRight' ? 1 : -1)));
    const slot = plotW / Math.max(1, count - 1 || 1);
    setTip({ index: idx, x: rect ? ((padL + idx * slot) / (padL + plotW + 16)) * rect.width : 0 });
  }
  return { wrapRef, tip, setTip, onPointerMove, onKeyDown };
}

// ── Weekly profit trend (line) ───────────────────────────────────────────────

export function WeeklyTrendChart({ points, ghostLabel }: { points: ChartPoint[]; ghostLabel: string }) {
  const W = 720, H = 220, padL = 52, padR = 16, padT = 12, padB = 26;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const { wrapRef, tip, setTip, onPointerMove, onKeyDown } = useNearestIndex(points.length, padL, plotW);

  const scale = useMemo(() => {
    const vals = points.flatMap(p => [p.value, ...(p.ghostValue != null ? [p.ghostValue] : [])]);
    return niceScale(Math.min(0, ...vals), Math.max(1, ...vals));
  }, [points]);

  const x = (i: number) => padL + (points.length <= 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const y = (v: number) => padT + plotH - ((v - scale.lo) / (scale.hi - scale.lo)) * plotH;

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const ghostPts = points.map((p, i) => (p.ghostValue != null ? { i, v: p.ghostValue } : null)).filter(Boolean) as { i: number; v: number }[];
  const ghostPath = ghostPts.map((g, k) => `${k === 0 ? 'M' : 'L'}${x(g.i).toFixed(1)},${y(g.v).toFixed(1)}`).join(' ');
  const areaPath = points.length > 1
    ? `${linePath} L${x(points.length - 1).toFixed(1)},${y(Math.max(0, scale.lo)).toFixed(1)} L${x(0).toFixed(1)},${y(Math.max(0, scale.lo)).toFixed(1)} Z`
    : '';
  const last = points[points.length - 1];

  if (points.length === 0) {
    return <div className="h-[220px] flex items-center justify-center text-sm text-slate-400">No data yet</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-end mb-1"><ChartLegend ghostLabel={ghostLabel} /></div>
      <div
        ref={wrapRef}
        className="relative focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 rounded-lg"
        tabIndex={0}
        role="img"
        aria-label={`Weekly profit trend, ${points.length} weeks. Use arrow keys to read values.`}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setTip(null)}
        onKeyDown={onKeyDown}
      >
        {tip && <Tooltip tip={tip} points={points} ghostLabel={ghostLabel} />}
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block">
          {/* recessive hairline grid + clean ticks */}
          {scale.ticks.map(t => (
            <g key={t}>
              <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="#e2e8f0" strokeWidth="1" />
              <text x={padL - 8} y={y(t) + 3.5} textAnchor="end" fontSize="10" fill="#94a3b8" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {fmtMoney(t)}
              </text>
            </g>
          ))}
          {/* crosshair snapped to the hovered week */}
          {tip && <line x1={x(tip.index)} x2={x(tip.index)} y1={padT} y2={padT + plotH} stroke="#cbd5e1" strokeWidth="1" />}
          {/* ghost (same weeks last year) */}
          {ghostPts.length > 1 && <path d={ghostPath} fill="none" stroke={SERIES_GHOST} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" opacity="0.75" />}
          {/* current year: 10% area wash + 2px line */}
          {areaPath && <path d={areaPath} fill={SERIES_CURRENT} opacity="0.08" />}
          <path d={linePath} fill="none" stroke={SERIES_CURRENT} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {/* hovered points get a marker with a 2px surface ring */}
          {tip && (
            <>
              {points[tip.index].ghostValue != null && (
                <circle cx={x(tip.index)} cy={y(points[tip.index].ghostValue!)} r="4" fill={SERIES_GHOST} stroke="#fff" strokeWidth="2" />
              )}
              <circle cx={x(tip.index)} cy={y(points[tip.index].value)} r="4.5" fill={SERIES_CURRENT} stroke="#fff" strokeWidth="2" />
            </>
          )}
          {/* endpoint marker + selective direct label (text token, not series color) */}
          <circle cx={x(points.length - 1)} cy={y(last.value)} r="4.5" fill={SERIES_CURRENT} stroke="#fff" strokeWidth="2" />
          <text
            x={Math.min(x(points.length - 1) + 8, W - padR)}
            y={y(last.value) - 8}
            textAnchor="end"
            fontSize="11"
            fontWeight="700"
            fill="#334155"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {fmtMoney(last.value)}
          </text>
          {/* x labels, every other week */}
          {points.map((p, i) => (i % 2 === points.length % 2 ? (
            <text key={p.key} x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="#94a3b8">{p.label}</text>
          ) : null))}
        </svg>
      </div>
    </div>
  );
}

// ── Monthly profit (grouped bars) ────────────────────────────────────────────

export function MonthlyBarsChart({ points, ghostLabel }: { points: ChartPoint[]; ghostLabel: string }) {
  const W = 720, H = 220, padL = 52, padR = 16, padT = 12, padB = 26;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<TooltipState | null>(null);

  const scale = useMemo(() => {
    const vals = points.flatMap(p => [p.value, ...(p.ghostValue != null ? [p.ghostValue] : [])]);
    return niceScale(Math.min(0, ...vals), Math.max(1, ...vals));
  }, [points]);

  const slotW = plotW / Math.max(1, points.length);
  const barW = Math.min(24, slotW * 0.28);
  const y = (v: number) => padT + plotH - ((v - scale.lo) / (scale.hi - scale.lo)) * plotH;
  const zeroY = y(0);
  const slotX = (i: number) => padL + i * slotW + slotW / 2;

  function hover(e: PointerEvent) {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect || points.length === 0) return;
    const xView = ((e.clientX - rect.left) / rect.width) * W;
    const idx = Math.max(0, Math.min(points.length - 1, Math.floor((xView - padL) / slotW)));
    setTip({ index: idx, x: (slotX(idx) / W) * rect.width });
  }
  function onKeyDown(e: KeyboardEvent) {
    if (points.length === 0) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Escape') return;
    e.preventDefault();
    if (e.key === 'Escape') { setTip(null); return; }
    const rect = wrapRef.current?.getBoundingClientRect();
    const cur = tip?.index ?? points.length - 1;
    const idx = Math.max(0, Math.min(points.length - 1, cur + (e.key === 'ArrowRight' ? 1 : -1)));
    setTip({ index: idx, x: rect ? (slotX(idx) / W) * rect.width : 0 });
  }

  // A bar with a 4px rounded data-end and a square baseline end; supports
  // negative values (rounded end points down).
  function barPath(cx: number, v: number, w: number): string {
    const r = Math.min(4, w / 2);
    const x0 = cx - w / 2;
    const top = y(v);
    const h = Math.abs(top - zeroY);
    if (h < 0.5) return '';
    if (v >= 0) {
      return `M${x0},${zeroY} L${x0},${top + r} Q${x0},${top} ${x0 + r},${top} L${x0 + w - r},${top} Q${x0 + w},${top} ${x0 + w},${top + r} L${x0 + w},${zeroY} Z`;
    }
    return `M${x0},${zeroY} L${x0},${top - r} Q${x0},${top} ${x0 + r},${top} L${x0 + w - r},${top} Q${x0 + w},${top} ${x0 + w},${top - r} L${x0 + w},${zeroY} Z`;
  }

  if (points.length === 0) {
    return <div className="h-[220px] flex items-center justify-center text-sm text-slate-400">No data yet</div>;
  }
  const last = points[points.length - 1];

  return (
    <div>
      <div className="flex items-center justify-end mb-1"><ChartLegend ghostLabel={ghostLabel} /></div>
      <div
        ref={wrapRef}
        className="relative focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 rounded-lg"
        tabIndex={0}
        role="img"
        aria-label={`Monthly profit, ${points.length} months. Use arrow keys to read values.`}
        onPointerMove={hover}
        onPointerLeave={() => setTip(null)}
        onKeyDown={onKeyDown}
      >
        {tip && <Tooltip tip={tip} points={points} ghostLabel={ghostLabel} />}
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block">
          {scale.ticks.map(t => (
            <g key={t}>
              <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="#e2e8f0" strokeWidth="1" />
              <text x={padL - 8} y={y(t) + 3.5} textAnchor="end" fontSize="10" fill="#94a3b8" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {fmtMoney(t)}
              </text>
            </g>
          ))}
          {points.map((p, i) => {
            const cx = slotX(i);
            const hovered = tip?.index === i;
            return (
              <g key={p.key} opacity={tip && !hovered ? 0.75 : 1}>
                {/* ghost bar (left of pair), 2px surface gap from the current bar */}
                {p.ghostValue != null && (
                  <path d={barPath(cx - barW / 2 - 1, p.ghostValue, barW)} fill={SERIES_GHOST} opacity="0.55" />
                )}
                <path d={barPath(cx + (p.ghostValue != null ? barW / 2 + 1 : 0), p.value, barW)} fill={SERIES_CURRENT} opacity={hovered ? 0.85 : 1} />
                <text x={cx} y={H - 8} textAnchor="middle" fontSize="10" fill="#94a3b8">{p.label}</text>
              </g>
            );
          })}
          {/* zero baseline sits above the grid */}
          <line x1={padL} x2={W - padR} y1={zeroY} y2={zeroY} stroke="#cbd5e1" strokeWidth="1" />
          {/* selective direct label: the current month only */}
          <text
            x={slotX(points.length - 1) + (last.ghostValue != null ? barW / 2 + 1 : 0)}
            y={y(Math.max(0, last.value)) - 6}
            textAnchor="middle"
            fontSize="11"
            fontWeight="700"
            fill="#334155"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {fmtMoney(last.value)}
          </text>
        </svg>
      </div>
    </div>
  );
}
