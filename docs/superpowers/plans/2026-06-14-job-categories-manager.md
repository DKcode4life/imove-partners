# Job Categories Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give admins one managed list of job categories (Settings → Job Categories) with add/edit/delete/reorder and a per-category Include-in-P&L toggle; the list is the single source of truth feeding the planner add-job dropdown, planner colors, and the weekly P&L filter.

**Architecture:** Categories are stored as one ordered JSON array in the existing `companySetting` key/value table under key `job_categories`. A new pure-logic module `server/lib/job-categories.js` owns load/migrate/diff/validate. The settings PUT saves the whole array atomically and diffs by stable `id` to cascade renames and reassign deleted-category jobs to a system "Unassigned" category. Planner color resolution and the planner dropdown both read this one list. The `/pnl` route filters rows by the include-in-P&L flag.

**Tech Stack:** Node/Express + Prisma (PostgreSQL) backend; React + TypeScript + Tailwind frontend. Tests use Node's built-in `node:test` runner (no new dependency) for the pure backend logic; routes and UI are verified manually (the repo has no existing test framework).

---

## File Structure

**Backend**
- Create `server/lib/job-categories.js` — pure helpers (`slugify`, `cleanHex`, `colorMap`, `excludedPnlNames`, `diffCategories`, `validateList`, `buildDefaultList`) + async `loadCategories(prisma)` / `saveCategories(prisma, list)`.
- Create `server/lib/job-categories.test.js` — `node:test` unit tests for the pure helpers.
- Modify `server/routes/planner.js` — `loadCategoryColors()` derives colors from `loadCategories()`.
- Modify `server/routes/settings.js` — replace `/planner-colors` GET/PUT with `/job-categories` GET/PUT (diff + cascade).
- Modify `server/routes/wages.js` — `/pnl` filters rows by include-in-P&L.

**Frontend**
- Create `client/src/lib/jobCategories.ts` — `JobCategory` type, `fetchJobCategories()`, fallback name list.
- Modify `client/src/pages/admin/CRMSettings.tsx` — replace `PlannerColorsSection` with `JobCategoriesSection`.
- Modify `client/src/pages/admin/CRMPlanner.tsx` — populate the category `<select>` from the API.
- Modify `client/src/types/index.ts` — keep `PLANNER_CATEGORIES` only as a pre-load fallback constant.

---

## Task 1: Pure category-logic module + tests

**Files:**
- Create: `server/lib/job-categories.js`
- Test: `server/lib/job-categories.test.js`
- Modify: `package.json` (add `test` script)

- [ ] **Step 1: Add a test script**

In `package.json`, inside `"scripts"`, add this line after the `"db:reset"` line (add a comma to the previous line as needed):

```json
    "test": "node --test server/"
```

- [ ] **Step 2: Write the pure module (no DB yet)**

Create `server/lib/job-categories.js`:

```js
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

module.exports = {
  SETTING_KEY, LEGACY_COLOR_KEY, SYSTEM_IDS, UNASSIGNED_NAME, DEFAULT_CATEGORIES,
  cleanHex, slugify, colorMap, excludedPnlNames, diffCategories, validateList, buildDefaultList,
};
```

- [ ] **Step 3: Write the failing tests**

Create `server/lib/job-categories.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const jc = require('./job-categories');

test('slugify makes kebab-case ids', () => {
  assert.equal(jc.slugify('Box Drop off'), 'box-drop-off');
  assert.equal(jc.slugify('  House  Service! '), 'house-service');
});

test('slugify dedupes against existing ids', () => {
  assert.equal(jc.slugify('Survey', ['survey']), 'survey-2');
  assert.equal(jc.slugify('Survey', ['survey', 'survey-2']), 'survey-3');
});

test('slugify falls back when name has no alphanumerics', () => {
  assert.equal(jc.slugify('!!!'), 'category');
});

test('cleanHex normalizes and rejects bad values', () => {
  assert.equal(jc.cleanHex('#aabbcc'), '#AABBCC');
  assert.equal(jc.cleanHex('red'), null);
  assert.equal(jc.cleanHex(123), null);
});

test('colorMap maps name -> hex', () => {
  const map = jc.colorMap([{ name: 'Survey', color: '#06b6d4' }]);
  assert.equal(map['Survey'], '#06B6D4');
});

test('excludedPnlNames collects only includeInPnl:false', () => {
  const set = jc.excludedPnlNames([
    { name: 'Quick Job', includeInPnl: true },
    { name: 'House Service', includeInPnl: false },
  ]);
  assert.ok(set.has('House Service'));
  assert.ok(!set.has('Quick Job'));
});

test('diffCategories detects rename, delete, and skips system deletes', () => {
  const oldList = [
    { id: 'survey', name: 'Survey' },
    { id: 'house', name: 'House Service' },
    { id: 'unassigned', name: 'Unassigned' },
  ];
  const newList = [
    { id: 'survey', name: 'Site Survey' },     // rename
    { id: 'unassigned', name: 'Unassigned' },  // system, untouched
    // 'house' deleted
  ];
  const { renames, deletes } = jc.diffCategories(oldList, newList);
  assert.deepEqual(renames, [{ oldName: 'Survey', newName: 'Site Survey' }]);
  assert.deepEqual(deletes, ['House Service']);
});

test('validateList rejects empty names, dupes, bad colors', () => {
  const base = jc.buildDefaultList();
  assert.equal(jc.validateList(base, base), null);

  const emptyName = base.map(c => c.id === 'survey' ? { ...c, name: '' } : c);
  assert.match(jc.validateList(emptyName, base), /empty/);

  const dupe = base.concat([{ id: 'x', name: 'quick job', color: '#000000', includeInPnl: true, system: false }]);
  assert.match(jc.validateList(dupe, base), /Duplicate/);

  const badColor = base.map(c => c.id === 'survey' ? { ...c, color: 'blue' } : c);
  assert.match(jc.validateList(badColor, base), /Invalid color/);
});

test('validateList requires system categories present and unrenamed', () => {
  const base = jc.buildDefaultList();
  const missing = base.filter(c => c.id !== 'unassigned');
  assert.match(jc.validateList(missing, base), /Missing required system category/);

  const renamedSystem = base.map(c => c.id === 'unassigned' ? { ...c, name: 'Spare' } : c);
  assert.match(jc.validateList(renamedSystem, base), /Cannot rename system category/);
});

test('buildDefaultList overrides colors from legacy map', () => {
  const list = jc.buildDefaultList({ 'Quick Job': '#123456' });
  assert.equal(list.find(c => c.id === 'quick-job').color, '#123456');
  assert.equal(list.find(c => c.id === 'survey').color, '#06B6D4'); // untouched default
});
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: all tests pass (the module already implements the behavior). If any fail, fix the module — not the test.

- [ ] **Step 5: Commit**

```bash
git add server/lib/job-categories.js server/lib/job-categories.test.js package.json
git commit -m "feat(categories): pure job-categories logic module + tests"
```

---

## Task 2: DB load/save + wire planner color resolution

**Files:**
- Modify: `server/lib/job-categories.js`
- Modify: `server/routes/planner.js:27-32` (`loadCategoryColors`), `server/routes/planner.js:9` (imports)

- [ ] **Step 1: Add async load/save to the module**

In `server/lib/job-categories.js`, add before `module.exports`:

```js
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
```

Then extend the `module.exports` object to also export: `safeJsonArray, normalizeStored, loadCategories, saveCategories`.

- [ ] **Step 2: Point planner color resolution at the new list**

In `server/routes/planner.js`, change the import on line 9 from:

```js
const { resolveItemColor, withDefaults } = require('../lib/planner-color');
```

to:

```js
const { resolveItemColor } = require('../lib/planner-color');
const { loadCategories, colorMap } = require('../lib/job-categories');
```

Then replace `loadCategoryColors` (lines 27-32) with:

```js
async function loadCategoryColors() {
  return colorMap(await loadCategories(prisma));
}
```

- [ ] **Step 3: Verify the server boots and colors still resolve**

Run: `npm run dev` (or `node server/index.js`), then in another terminal:

```bash
curl -s http://localhost:3000/api/planner/month?year=2026&month=6 -H "Authorization: Bearer <admin-token>" | head -c 400
```

Expected: JSON with planner items each having an `effective_color` hex (unchanged behavior). The server log shows no error. (If you don't have a token handy, instead just confirm `node -e "require('./server/routes/planner.js')"` loads without throwing.)

- [ ] **Step 4: Commit**

```bash
git add server/lib/job-categories.js server/routes/planner.js
git commit -m "feat(categories): DB load/migrate + route planner colors through category list"
```

---

## Task 3: Replace planner-colors endpoints with job-categories CRUD

**Files:**
- Modify: `server/routes/settings.js:449-484` (the `Planner category colors` block)

- [ ] **Step 1: Swap the require and the endpoints**

In `server/routes/settings.js`, replace lines 449-484 (the entire `// ── Planner category colors ──` block, from the comment through the `safeJson` helper) with:

```js
// ── Job Categories ────────────────────────────────────────────────────────────
// One ordered JSON array in CompanySetting (`job_categories`). Single source of
// truth for the planner add-job dropdown, planner colors, and the P&L filter.
// Saving the whole array diffs by stable id: renames cascade onto existing
// PlannerEvents; deletes reassign their events to the system "Unassigned"
// category; system entries cannot be deleted or renamed.

const jobCats = require('../lib/job-categories');

router.get('/job-categories', wrap(async (_req, res) => {
  const list = await jobCats.loadCategories(prisma);
  res.json(list);
}));

router.put('/job-categories', wrap(async (req, res) => {
  const incoming = req.body;
  const previous = await jobCats.loadCategories(prisma);

  // Assign ids to any brand-new rows (no id yet) before validating/diffing.
  const usedIds = [];
  const withIds = (Array.isArray(incoming) ? incoming : []).map(c => {
    const id = c && c.id ? c.id : jobCats.slugify(c && c.name, usedIds);
    usedIds.push(id);
    return { ...c, id };
  });

  const error = jobCats.validateList(withIds, previous);
  if (error) return res.status(400).json({ error });

  const normalized = jobCats.normalizeStored(withIds);
  const { renames, deletes } = jobCats.diffCategories(previous, normalized);

  // Cascade renames, then reassign deleted-category jobs to "Unassigned".
  for (const { oldName, newName } of renames) {
    await prisma.plannerEvent.updateMany({ where: { category: oldName }, data: { category: newName } });
  }
  let reassigned = 0;
  for (const name of deletes) {
    const r = await prisma.plannerEvent.updateMany({
      where: { category: name },
      data: { category: jobCats.UNASSIGNED_NAME },
    });
    reassigned += r.count;
  }

  await jobCats.saveCategories(prisma, normalized);
  res.json({ ok: true, categories: normalized, reassigned });
}));
```

> Note: the old `/planner-colors` routes and the `safeJson` helper are removed. `safeJson` had no other callers in this file (the catalog/distance/day-order handlers parse inline).

- [ ] **Step 2: Verify CRUD over HTTP**

Run the server, then (with an admin token):

```bash
# GET seeds + returns the list
curl -s localhost:3000/api/settings/job-categories -H "Authorization: Bearer <t>" | python -m json.tool | head -40
```

Expected: an array including system entries `Removal Job`, `Contract Job`, `Unassigned` (each `"system": true`) plus the editable ones, each with `id`, `name`, `color`, `includeInPnl`.

- [ ] **Step 3: Verify rename cascade + delete reassign**

```bash
# Save back the same list but rename "Survey" -> "Site Survey" and drop a custom one.
# (Edit the JSON you fetched, then:)
curl -s -X PUT localhost:3000/api/settings/job-categories \
  -H "Authorization: Bearer <t>" -H "Content-Type: application/json" \
  -d @edited.json | python -m json.tool
```

Expected: `{ "ok": true, "categories": [...], "reassigned": <n> }`. Any PlannerEvent that had the old category name now has the new one; events whose category was deleted now read `"Unassigned"`. Attempting to omit a system entry returns HTTP 400 with a clear message.

- [ ] **Step 4: Commit**

```bash
git add server/routes/settings.js
git commit -m "feat(categories): job-categories CRUD endpoint with rename/delete cascade"
```

---

## Task 4: Filter the weekly P&L by include-in-P&L

**Files:**
- Modify: `server/routes/wages.js:7` (imports), `:230-236` (event select), `:297-327` (row builders)

- [ ] **Step 1: Import the module + load the excluded set**

In `server/routes/wages.js`, after line 7 (`const pnlCalc = require('../lib/pnl-calc');`) add:

```js
const jobCats = require('../lib/job-categories');
```

Add `category: true` to the `plannerEvent.findMany` select (currently lines 232-235) so it becomes:

```js
      select: {
        id: true, title: true, event_date: true, pnl_income: true, category: true,
        contract_job: { select: { items: { select: { total: true } } } },
      },
```

- [ ] **Step 2: Compute the excluded set and filter rows**

Immediately after the `Promise.all([...])` block ends (after line 260, before the `// Vehicles referenced...` comment), add:

```js
  const categories = await jobCats.loadCategories(prisma);
  const excludedPnl = jobCats.excludedPnlNames(categories);
  const removalExcluded = excludedPnl.has('Removal Job');
```

In the CrmJob loop, change the opening of `for (const j of jobs) {` (line 298) to skip removals when excluded:

```js
  for (const j of jobs) {
    if (removalExcluded) continue;
    const key = `job|${j.id}`;
```

In the PlannerEvent loop, change the opening of `for (const e of events) {` (line 313) to skip excluded categories:

```js
  for (const e of events) {
    if (e.category && excludedPnl.has(e.category)) continue;
    const key = `event|${e.id}`;
```

- [ ] **Step 3: Verify filtering**

Run the server. In Settings, the next task's UI doesn't exist yet, so test via the API: PUT the category list with one event-category set to `includeInPnl: false`, create/keep a PlannerEvent in the target week using that category, then:

```bash
curl -s "localhost:3000/api/wages/pnl?start=2026-06-08" -H "Authorization: Bearer <t>" | python -m json.tool
```

Expected: the rows array excludes events whose category is toggled off; totals reflect the smaller set. Toggle `Removal Job` off → customer-removal rows disappear. Legacy categories not present in the list still appear (not dropped).

- [ ] **Step 4: Commit**

```bash
git add server/routes/wages.js
git commit -m "feat(pnl): filter weekly P&L by category include-in-P&L flag"
```

---

## Task 5: Frontend category fetch helper + type

**Files:**
- Create: `client/src/lib/jobCategories.ts`

- [ ] **Step 1: Create the helper**

Create `client/src/lib/jobCategories.ts`:

```ts
import api from './api';

export interface JobCategory {
  id: string;
  name: string;
  color: string;
  includeInPnl: boolean;
  system: boolean;
}

/** Names shown in the planner dropdown before the API resolves (and as a
 *  hard fallback if the request fails). Non-system, sensible defaults. */
export const FALLBACK_CATEGORY_NAMES = [
  'Loading', 'Moving', 'Unloading', 'Packing', 'Box Drop off',
  'Box Collection', 'Survey', 'Sundry', 'Quick Job',
];

export async function fetchJobCategories(): Promise<JobCategory[]> {
  const r = await api.get<JobCategory[]>('/settings/job-categories');
  return r.data;
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors referencing `jobCategories.ts`.

- [ ] **Step 3: Commit**

```bash
git add client/src/lib/jobCategories.ts
git commit -m "feat(categories): client fetch helper + JobCategory type"
```

---

## Task 6: Job Categories settings section (replaces Planner Colors)

**Files:**
- Modify: `client/src/pages/admin/CRMSettings.tsx` — remove `PlannerColorsSection` (lines 685-764) and its `<PlannerColorsSection .../>` mount (line 680); add `JobCategoriesSection`.

- [ ] **Step 1: Add the import**

Near the other `lib` imports at the top of `client/src/pages/admin/CRMSettings.tsx`, add:

```tsx
import { fetchJobCategories, type JobCategory } from '../../lib/jobCategories';
```

- [ ] **Step 2: Replace the mounted section**

Change line 680 from `<PlannerColorsSection showToast={showToast} />` to:

```tsx
    <JobCategoriesSection showToast={showToast} />
```

- [ ] **Step 3: Replace the component definition**

Delete the entire `// ── Planner Colors section ──` block (the comment, `type PlannerColorsPayload`, and `function PlannerColorsSection`, lines ~685-764) and replace it with:

```tsx
// ── Job Categories section ───────────────────────────────────────────────────
// Single source of truth for the planner add-job categories, their colors, and
// whether each appears in the weekly P&L. Renames cascade and deletes reassign
// to "Unassigned" — handled server-side on Save. System rows (Removal Job,
// Contract Job, Unassigned) can't be renamed/deleted; their color + P&L toggle
// stay editable.

const NEW_CATEGORY_COLOR = '#64748B';

function JobCategoriesSection({ showToast }: { showToast: (m: string, t?: 'success' | 'error') => void }) {
  const [saved, setSaved] = useState<JobCategory[] | null>(null);
  const [draft, setDraft] = useState<JobCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchJobCategories()
      .then(list => { setSaved(list); setDraft(list); })
      .catch(() => showToast('Failed to load job categories', 'error'))
      .finally(() => setLoading(false));
  }, [showToast]);

  const dirty = saved && JSON.stringify(draft) !== JSON.stringify(saved);

  function update(idx: number, patch: Partial<JobCategory>) {
    setDraft(d => d.map((c, i) => i === idx ? { ...c, ...patch } : c));
  }
  function move(idx: number, dir: -1 | 1) {
    setDraft(d => {
      const next = [...d];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return d;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  }
  function remove(idx: number) {
    setDraft(d => d.filter((_, i) => i !== idx));
  }
  function add() {
    setDraft(d => [
      ...d,
      { id: '', name: '', color: NEW_CATEGORY_COLOR, includeInPnl: true, system: false },
    ]);
  }

  async function save() {
    // Guard: no empty names before sending.
    if (draft.some(c => !c.name.trim())) {
      showToast('Every category needs a name', 'error');
      return;
    }
    setSaving(true);
    try {
      const r = await api.put<{ ok: boolean; categories: JobCategory[]; reassigned: number }>(
        '/settings/job-categories', draft,
      );
      setSaved(r.data.categories);
      setDraft(r.data.categories);
      showToast(
        r.data.reassigned > 0
          ? `Saved — ${r.data.reassigned} job(s) moved to Unassigned`
          : 'Job categories saved',
      );
    } catch (e: any) {
      showToast(e?.response?.data?.error || 'Failed to save job categories', 'error');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 text-sm text-slate-400">Loading job categories…</div>
  );

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-700">Job Categories</h2>
        <p className="text-[11px] text-slate-400 mt-0.5">
          Categories you can pick when adding a planner job. Set each one's planner colour and whether it appears in the weekly P&amp;L. Renaming updates existing jobs; deleting moves their jobs to “Unassigned”. System categories can be re-coloured but not renamed or removed.
        </p>
      </div>

      <div className="space-y-2">
        {draft.map((cat, idx) => (
          <div key={cat.id || `new-${idx}`} className="flex items-center gap-2 px-3 py-2 rounded-lg ring-1 ring-slate-200/60 bg-slate-50/40">
            <div className="flex flex-col">
              <button type="button" onClick={() => move(idx, -1)} disabled={idx === 0}
                className="text-slate-400 hover:text-slate-700 disabled:opacity-30 leading-none" title="Move up">▲</button>
              <button type="button" onClick={() => move(idx, 1)} disabled={idx === draft.length - 1}
                className="text-slate-400 hover:text-slate-700 disabled:opacity-30 leading-none" title="Move down">▼</button>
            </div>

            <ColorSwatch color={cat.color} onChange={hex => update(idx, { color: hex })} />

            {cat.system ? (
              <span className="flex-1 text-xs font-medium text-slate-700 flex items-center gap-1.5">
                {cat.name}
                <span className="text-[9px] uppercase tracking-wide text-slate-400 ring-1 ring-slate-200 rounded px-1 py-0.5">system</span>
              </span>
            ) : (
              <input
                className="input flex-1 text-xs"
                value={cat.name}
                placeholder="Category name"
                onChange={e => update(idx, { name: e.target.value })}
              />
            )}

            <label className="flex items-center gap-1.5 text-[11px] text-slate-600 whitespace-nowrap cursor-pointer">
              <input type="checkbox" checked={cat.includeInPnl}
                onChange={e => update(idx, { includeInPnl: e.target.checked })} />
              In P&amp;L
            </label>

            {!cat.system && (
              <button type="button" onClick={() => remove(idx)}
                className="text-slate-300 hover:text-red-600 text-sm px-1" title="Delete category">✕</button>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between pt-1">
        <button type="button" onClick={add}
          className="text-xs font-medium text-blue-600 hover:text-blue-800">+ Add category</button>
        <button type="button" onClick={save} disabled={!dirty || saving}
          className="btn-primary disabled:opacity-50">
          {saving ? 'Saving…' : 'Save Categories'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify it type-checks and builds**

Run: `cd client && npx tsc --noEmit`
Expected: no errors. (If `useEffect`/`useState`/`useCallback` weren't already imported, they are — this file already uses them.)

- [ ] **Step 5: Manual UI check**

Run the app, open Settings (CRM). The "Job Categories" card shows the list with up/down arrows, colour swatches, editable names (system rows read-only with a "system" tag), an "In P&L" checkbox per row, a delete ✕ on non-system rows, "+ Add category", and "Save Categories". Add "House Service", untick its P&L box, Save → toast confirms.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/admin/CRMSettings.tsx
git commit -m "feat(categories): Job Categories settings section with reorder + P&L toggle"
```

---

## Task 7: Populate planner add-job dropdown from the API

**Files:**
- Modify: `client/src/pages/admin/CRMPlanner.tsx:14` (import), `:1415-1500` (the event add/edit form component that renders the category `<select>` at line 1498-1500)

- [ ] **Step 1: Swap the import**

In `client/src/pages/admin/CRMPlanner.tsx`, change line 14 from:

```tsx
import { PLANNER_CATEGORIES } from '../../types';
```

to:

```tsx
import { fetchJobCategories } from '../../lib/jobCategories';
import { FALLBACK_CATEGORY_NAMES } from '../../lib/jobCategories';
```

- [ ] **Step 2: Fetch categories inside the event form component**

The form component containing the category `<select>` (around lines 1415-1500) already has React hooks in scope. Inside it, alongside its other `useState` hooks, add:

```tsx
  const [categoryNames, setCategoryNames] = useState<string[]>(FALLBACK_CATEGORY_NAMES);

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
```

> If `useEffect` isn't already imported in this file, add it to the existing `react` import. Check the top of the file.

- [ ] **Step 3: Render options from state (and never drop the current value)**

Replace the `<select>` block at lines 1498-1500:

```tsx
            <select className="input" value={form.category} onChange={e => set('category', e.target.value)}>
              {PLANNER_CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
```

with:

```tsx
            <select className="input" value={form.category} onChange={e => set('category', e.target.value)}>
              {(categoryNames.includes(form.category) || !form.category
                ? categoryNames
                : [form.category, ...categoryNames]
              ).map(c => <option key={c}>{c}</option>)}
            </select>
```

This keeps an editing job's current category visible even if it's now "Unassigned", a system, or a legacy value not in the selectable list.

- [ ] **Step 4: Verify type-check and behavior**

Run: `cd client && npx tsc --noEmit`
Expected: no errors, and no remaining references to `PLANNER_CATEGORIES` in this file (search to confirm).

Manual: open the planner, click Add Job → the Category dropdown lists exactly the non-system categories in the order set in Settings (reorder in Settings, reload, confirm order matches). Adding "House Service" in Settings makes it appear here.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/admin/CRMPlanner.tsx
git commit -m "feat(categories): planner add-job dropdown reads managed category list"
```

---

## Task 8: Demote the hardcoded constant + final verification

**Files:**
- Modify: `client/src/types/index.ts:455-458`

- [ ] **Step 1: Keep the constant only as documented fallback**

In `client/src/types/index.ts`, update the comment above `PLANNER_CATEGORIES` (line ~454) to note it's now only a legacy fallback, and leave the constant for any other importers. Search first:

Run: `cd client && grep -rn "PLANNER_CATEGORIES" src/`
Expected after Task 7: only the definition in `types/index.ts` remains (no consumers). If a consumer remains, point it at `FALLBACK_CATEGORY_NAMES` or the fetched list.

Replace lines 455-458 with:

```ts
// Legacy fallback only. The live, editable list comes from
// GET /settings/job-categories (see client/src/lib/jobCategories.ts).
export const PLANNER_CATEGORIES = [
  'Loading', 'Moving', 'Unloading', 'Packing', 'Box Drop off', 'Box Collection', 'Survey', 'Sundry', 'Quick Job',
] as const;
export type PlannerCategory = typeof PLANNER_CATEGORIES[number];
```

- [ ] **Step 2: Full backend test + client build**

Run:

```bash
npm test
cd client && npx tsc --noEmit && npm run build
```

Expected: all `node:test` tests pass; client type-checks and builds with no errors.

- [ ] **Step 3: End-to-end manual UAT**

With the app running:
1. Settings → add "House Service", P&L off → Save (toast OK).
2. Planner → Add Job → "House Service" appears in the dropdown; create one in the current week.
3. Wages / P&L → "House Service" job is absent from the P&L list; other jobs present.
4. Settings → rename a category in use → planner cards + dropdown show the new name and colour.
5. Settings → delete an in-use category → its planner jobs now show "Unassigned"; re-categorise one from the planner.
6. Settings → reorder with ▲/▼, Save, reload planner Add Job → dropdown order matches.
7. Settings → toggle "Removal Job" P&L off → customer removals drop out of the P&L list.

- [ ] **Step 4: Commit**

```bash
git add client/src/types/index.ts
git commit -m "refactor(categories): demote PLANNER_CATEGORIES to legacy fallback"
```

---

## Self-Review Notes

- **Spec coverage:** add/edit/delete/reorder (Task 6) ✔; sync to planner dropdown (Task 7) ✔; single source of truth replacing the 4 hardcoded lists (Tasks 1,2,6,7,8) ✔; per-category include-in-P&L filtering incl. system Removal/Contract jobs (Tasks 1,4) ✔; rename cascade + delete→Unassigned (Tasks 1,3) ✔; migration from `planner_category_colors` (Task 2) ✔; up/down arrows + Unassigned-in-P&L default (Tasks 1,6) ✔.
- **Types consistent:** `JobCategory { id, name, color, includeInPnl, system }` used identically across server module, `jobCategories.ts`, and both UI components. Endpoint `/settings/job-categories` GET returns the array; PUT returns `{ ok, categories, reassigned }`.
- **No placeholders:** every step has concrete code/commands.
