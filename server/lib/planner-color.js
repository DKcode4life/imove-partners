/**
 * Planner color resolution — single source of truth for the dot/accent color
 * shown on a planner item across all views (Month, Week, Staff).
 *
 * Resolution order, highest priority first:
 *   1. item.planner_color  — explicit per-item override the user set via the
 *                            per-card color popover.
 *   2. contract.color      — the linked contract's default color (jobs under
 *                            "ABC Movers" all share that contract's color).
 *   3. settings[category]  — the category default configured under
 *                            Settings → Planner Colors (Quick Job, Survey,
 *                            Removal Job, etc.).
 *   4. FALLBACKS[category] — hardcoded gray-ish color so nothing renders blank.
 */

// Mirrors client/src/lib/planner-colors.ts so server-rendered defaults match
// what an unconfigured client would have shown historically. Keep these two
// lists in sync if you add a new built-in.
const FALLBACK_BY_CATEGORY = {
  // Event categories
  'Loading':        '#3B82F6',
  'Moving':         '#6366F1',
  'Unloading':      '#0EA5E9',
  'Packing':        '#8B5CF6',
  'Box Drop off':   '#F59E0B',
  'Box Collection': '#F97316',
  'Survey':         '#06B6D4',
  'Sundry':         '#94A3B8',
  'Quick Job':      '#22C55E',
  'Contract Job':   '#C026D3',
  // Pseudo-category used for CrmJob (customer removal) items
  'Removal Job':    '#94A3B8',
};

const DEFAULT_FALLBACK = '#94A3B8';

/**
 * Categories that the user can configure under Settings → Planner Colors.
 * Order matters — it's the order the picker renders them in.
 */
const CONFIGURABLE_CATEGORIES = [
  'Removal Job',
  'Quick Job',
  'Survey',
  'Loading',
  'Moving',
  'Unloading',
  'Packing',
  'Box Drop off',
  'Box Collection',
  'Sundry',
  'Contract Job',
];

/**
 * @typedef {Object} ResolveCtx
 * @property {Object} categoryColors  — { [category: string]: '#hex' } from settings
 *
 * @param {{source:'job'|'event', category?:string|null, planner_color?:string|null}} item
 * @param {{is_lux?:boolean, color?:string|null}|null} contract — null for CrmJob items
 * @param {ResolveCtx} ctx
 * @returns {string} hex color (e.g. "#3B82F6")
 */
function resolveItemColor(item, contract, ctx) {
  if (item?.planner_color) return item.planner_color;
  if (contract?.color) return contract.color;

  // CrmJob items have no category in this domain — they're "Removal Job".
  const category = item?.source === 'job'
    ? 'Removal Job'
    : (item?.category || null);

  if (category && ctx?.categoryColors?.[category]) {
    return ctx.categoryColors[category];
  }
  if (category && FALLBACK_BY_CATEGORY[category]) {
    return FALLBACK_BY_CATEGORY[category];
  }
  return DEFAULT_FALLBACK;
}

/**
 * Build the saved + defaults-merged category color map. Returns ALL configurable
 * categories with either the user-saved color or the hardcoded fallback.
 */
function withDefaults(savedColors) {
  const out = {};
  for (const cat of CONFIGURABLE_CATEGORIES) {
    out[cat] = savedColors?.[cat] || FALLBACK_BY_CATEGORY[cat] || DEFAULT_FALLBACK;
  }
  return out;
}

module.exports = {
  resolveItemColor,
  withDefaults,
  FALLBACK_BY_CATEGORY,
  CONFIGURABLE_CATEGORIES,
  DEFAULT_FALLBACK,
};
