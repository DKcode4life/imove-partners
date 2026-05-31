/**
 * Shared category colors used by both the job-centric Planner view and the
 * Staff View grid. Keeping this in one place so a job's accent color is the
 * same wherever it appears.
 */
export const CATEGORY_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  'Loading':         { bg: 'bg-blue-100',    text: 'text-blue-700',    dot: '#3B82F6' },
  'Moving':          { bg: 'bg-indigo-100',  text: 'text-indigo-700',  dot: '#6366F1' },
  'Unloading':       { bg: 'bg-sky-100',     text: 'text-sky-700',     dot: '#0EA5E9' },
  'Packing':         { bg: 'bg-purple-100',  text: 'text-purple-700',  dot: '#8B5CF6' },
  'Box Drop off':    { bg: 'bg-amber-100',   text: 'text-amber-700',   dot: '#F59E0B' },
  'Box Collection':  { bg: 'bg-orange-100',  text: 'text-orange-700',  dot: '#F97316' },
  'Survey':          { bg: 'bg-cyan-100',    text: 'text-cyan-700',    dot: '#06B6D4' },
  'Sundry':          { bg: 'bg-slate-100',   text: 'text-slate-600',   dot: '#94A3B8' },
  'Quick Job':       { bg: 'bg-green-100',   text: 'text-green-700',   dot: '#22C55E' },
  'Contract Job':    { bg: 'bg-fuchsia-100', text: 'text-fuchsia-700', dot: '#C026D3' },
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

export function catColor(cat: string | null | undefined) {
  if (!cat) return { bg: 'bg-slate-100', text: 'text-slate-600', dot: '#94A3B8' };
  return CATEGORY_COLORS[cat] ?? { bg: 'bg-slate-100', text: 'text-slate-600', dot: '#94A3B8' };
}

// ── Hex-based palette (used by the color picker and per-item override) ──────

/**
 * The swatch palette shown in the per-card color picker and the Settings
 * → Planner Colors page. Kept short so the popover stays compact.
 */
export const PLANNER_COLOR_PALETTE: string[] = [
  '#3B82F6', // blue
  '#6366F1', // indigo
  '#8B5CF6', // violet
  '#A855F7', // purple
  '#EC4899', // pink
  '#EF4444', // red
  '#F97316', // orange
  '#F59E0B', // amber
  '#EAB308', // yellow
  '#22C55E', // green
  '#10B981', // emerald
  '#14B8A6', // teal
  '#06B6D4', // cyan
  '#0EA5E9', // sky
  '#64748B', // slate
  '#94A3B8', // light slate
];

/**
 * Given a hex like "#3B82F6", return inline styles for a soft tinted
 * background and a dark text color. Used in lieu of Tailwind class lookups
 * when the color is arbitrary (user-picked / per-card override).
 */
export function tintFromHex(hex: string, opacity = 0.12) {
  return {
    backgroundColor: hexWithAlpha(hex, opacity),
    color: hex,
  };
}

export function hexWithAlpha(hex: string, alpha: number) {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return hex;
  const a = Math.max(0, Math.min(1, alpha));
  const aa = Math.round(a * 255).toString(16).padStart(2, '0');
  return `#${m[1]}${aa}`;
}

/**
 * Resolve the effective dot color for an item, given the server-supplied
 * effective_color and any local fallback by category. Server already does
 * resolution including overrides; this is the client-side adapter for code
 * paths that still pass a category name.
 */
export function effectiveDot(
  item: { effective_color?: string | null; category?: string | null } | null | undefined
): string {
  if (item?.effective_color) return item.effective_color;
  if (item?.category) return catColor(item.category).dot;
  return '#94A3B8';
}
