/**
 * Job categories — single source of truth for the planner's selectable job
 * categories, their planner colors, and whether each appears in the weekly P&L.
 *
 * Stored as one ordered JSON array in CompanySetting key `job_categories`.
 * Each entry: { id, name, color, includeInPnl, system }.
 *   - id: stable slug; never changes once created. Lets a save tell a rename
 *         (same id, new name) apart from an add/delete.
 *   - system: Removal Job / Contract Job / Unassigned. Cannot be deleted or
 *             renamed, and are hidden from the planner add-job dropdown.
 */

const SETTING_KEY = 'job_categories';
const LEGACY_COLOR_KEY = 'planner_category_colors';

const SYSTEM_IDS = ['removal-job', 'contract-job', 'unassigned'];
const UNASSIGNED_NAME = 'Unassigned';

// Seed list — mirrors the historical CONFIGURABLE_CATEGORIES order/colors so a
// fresh migration looks identical to what users saw before.
const DEFAULT_CATEGORIES = [
  { id: 'removal-job',    name: 'Removal Job',    color: '#94A3B8', includeInPnl: true, system: true },
  { id: 'quick-job',      name: 'Quick Job',      color: '#22C55E', includeInPnl: true, system: false },
  { id: 'survey',         name: 'Survey',         color: '#06B6D4', includeInPnl: true, system: false },
  { id: 'loading',        name: 'Loading',        color: '#3B82F6', includeInPnl: true, system: false },
  { id: 'moving',         name: 'Moving',         color: '#6366F1', includeInPnl: true, system: false },
  { id: 'unloading',      name: 'Unloading',      color: '#0EA5E9', includeInPnl: true, system: false },
  { id: 'packing',        name: 'Packing',        color: '#8B5CF6', includeInPnl: true, system: false },
  { id: 'box-drop-off',   name: 'Box Drop off',   color: '#F59E0B', includeInPnl: true, system: false },
  { id: 'box-collection', name: 'Box Collection', color: '#F97316', includeInPnl: true, system: false },
  { id: 'sundry',         name: 'Sundry',         color: '#94A3B8', includeInPnl: true, system: false },
  { id: 'contract-job',   name: 'Contract Job',   color: '#C026D3', includeInPnl: true, system: true },
  { id: 'unassigned',     name: UNASSIGNED_NAME,  color: '#94A3B8', includeInPnl: true, system: true },
];

function cleanHex(v) {
  if (typeof v !== 'string') return null;
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v.toUpperCase() : null;
}

function slugify(name, existingIds = []) {
  let base = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!base) base = 'category';
  const taken = new Set(existingIds);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/** { [name]: '#HEX' } map for planner color resolution. */
function colorMap(list) {
  const out = {};
  for (const c of list) out[c.name] = cleanHex(c.color) || '#94A3B8';
  return out;
}

/** Set of category names that must NOT appear in the P&L list. */
function excludedPnlNames(list) {
  return new Set(list.filter(c => c.includeInPnl === false).map(c => c.name));
}

/**
 * Compare a previously-saved list with an incoming one (matched by id).
 * Returns { renames: [{oldName,newName}], deletes: ['Name', ...] }.
 * System ids are never reported as deletes.
 */
function diffCategories(oldList, newList) {
  const oldById = new Map(oldList.map(c => [c.id, c]));
  const newById = new Map(newList.map(c => [c.id, c]));
  const renames = [];
  for (const [id, oldCat] of oldById) {
    const next = newById.get(id);
    if (next && next.name !== oldCat.name) {
      renames.push({ oldName: oldCat.name, newName: next.name });
    }
  }
  const deletes = [];
  for (const [id, oldCat] of oldById) {
    if (!newById.has(id) && !SYSTEM_IDS.includes(id)) deletes.push(oldCat.name);
  }
  return { renames, deletes };
}

/**
 * Validate an incoming list against the saved one. Returns an error string,
 * or null if valid.
 */
function validateList(newList, oldList) {
  if (!Array.isArray(newList)) return 'Expected an array of categories';
  const seen = new Set();
  for (const c of newList) {
    if (!c || typeof c !== 'object') return 'Each category must be an object';
    const name = String(c.name || '').trim();
    if (!name) return 'Category name cannot be empty';
    const lower = name.toLowerCase();
    if (seen.has(lower)) return `Duplicate category name: ${name}`;
    seen.add(lower);
    if (!cleanHex(c.color)) return `Invalid color for ${name}`;
  }
  // All system entries must still be present, with their canonical names.
  const byId = new Map(newList.map(c => [c.id, c]));
  for (const sysId of SYSTEM_IDS) {
    const canonical = DEFAULT_CATEGORIES.find(d => d.id === sysId);
    const present = byId.get(sysId);
    if (!present) return `Missing required system category: ${canonical.name}`;
    if (present.name !== canonical.name) return `Cannot rename system category: ${canonical.name}`;
  }
  return null;
}

/** Build a fresh default list, overriding colors from a legacy {name:hex} map. */
function buildDefaultList(savedColors = {}) {
  return DEFAULT_CATEGORIES.map(c => ({
    ...c,
    color: cleanHex(savedColors[c.name]) || c.color,
  }));
}

function safeJsonArray(s) {
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : null; } catch { return null; }
}

/** Ensure a stored list has every field + all system entries (self-healing). */
function normalizeStored(list) {
  const byId = new Map(list.map(c => [c.id, c]));
  // Backfill any missing system entry from defaults.
  for (const sysId of SYSTEM_IDS) {
    if (!byId.has(sysId)) {
      const def = DEFAULT_CATEGORIES.find(d => d.id === sysId);
      list = list.concat([{ ...def }]);
    }
  }
  return list.map(c => ({
    id: c.id || slugify(c.name, list.map(x => x.id)),
    name: String(c.name || '').trim(),
    color: cleanHex(c.color) || '#94A3B8',
    includeInPnl: c.includeInPnl !== false,
    system: SYSTEM_IDS.includes(c.id) ? true : !!c.system,
  }));
}

/**
 * Load the ordered category list. Migrates from the legacy
 * `planner_category_colors` map the first time, persisting the result so ids
 * stay stable thereafter.
 */
async function loadCategories(prisma) {
  const row = await prisma.companySetting.findUnique({ where: { key: SETTING_KEY } });
  const parsed = row?.value ? safeJsonArray(row.value) : null;
  if (parsed) return normalizeStored(parsed);

  // First run — migrate colors from the legacy key, then persist.
  const legacy = await prisma.companySetting.findUnique({ where: { key: LEGACY_COLOR_KEY } });
  let savedColors = {};
  if (legacy?.value) { try { savedColors = JSON.parse(legacy.value) || {}; } catch { savedColors = {}; } }
  const list = buildDefaultList(savedColors);
  await saveCategories(prisma, list);
  return list;
}

async function saveCategories(prisma, list) {
  const value = JSON.stringify(list);
  await prisma.companySetting.upsert({
    where: { key: SETTING_KEY },
    update: { value },
    create: { key: SETTING_KEY, value },
  });
  return list;
}

module.exports = {
  SETTING_KEY, LEGACY_COLOR_KEY, SYSTEM_IDS, UNASSIGNED_NAME, DEFAULT_CATEGORIES,
  cleanHex, slugify, colorMap, excludedPnlNames, diffCategories, validateList, buildDefaultList,
  safeJsonArray, normalizeStored, loadCategories, saveCategories,
};
