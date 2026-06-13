# Job Categories Manager — Design

**Date:** 2026-06-14
**Status:** Approved (design)
**Branch:** feat/job-profit-and-loss (or a new feat branch)

## Problem

Job categories (the list a user picks from when adding a planner job — Loading,
Moving, Survey, Quick Job, etc.) are hardcoded in four places that can drift
apart:

1. `client/src/types/index.ts` → `PLANNER_CATEGORIES` (9 items) — drives the
   planner add-job dropdown.
2. `server/lib/planner-color.js` → `CONFIGURABLE_CATEGORIES` (11 items, adds
   "Removal Job" + "Contract Job") — drives the Settings → Planner Colors picker.
3. `client/src/lib/planner-colors.ts` → `CATEGORY_COLORS` (color fallbacks + legacy aliases).
4. `server/lib/planner-color.js` → `FALLBACK_BY_CATEGORY` (color fallbacks).

There is no way for an admin to add, edit, remove, or reorder categories, and no
way to control which categories appear in the weekly P&L list (today every
job/event in the week appears).

## Goal

Give admins one managed list of job categories under **Settings → Job Categories**
that:

- Supports **add, edit (rename), delete, and reorder** (up/down arrows).
- Is the **single source of truth** — feeds the planner add-job dropdown and the
  planner color resolution.
- Has a per-category **Include in P&L** toggle. Only categories with the toggle
  on appear in the weekly P&L list. (Example: a "House Service" category with the
  toggle off keeps those jobs out of P&L while leaving them everywhere else.)

## Decisions (locked)

| Decision | Choice |
|---|---|
| Structure | Merge: the existing "Planner Colors" section becomes the new "Job Categories" manager. One source of truth. |
| Rename behavior | Cascade — renaming updates the category name on all existing planner events using the old name. |
| Delete behavior | Reassign affected events to a built-in **"Unassigned"** category, then drop the entry. Admin re-categorizes later. |
| P&L scope | "Removal Job" and "Contract Job" are **system categories** with their own P&L toggle (default on), so the whole P&L list is controllable. |
| Reorder UI | Up/down arrows (no new dependency). |
| "Unassigned" P&L default | Included in P&L (toggle on by default). |

## Data Model

Single ordered list stored in the existing `companySetting` key/value table under
a **new key `job_categories`** (JSON array). No new DB table.

```jsonc
[
  { "id": "quick-job",    "name": "Quick Job",    "color": "#22C55E", "includeInPnl": true, "system": false },
  { "id": "survey",       "name": "Survey",       "color": "#06B6D4", "includeInPnl": true, "system": false },
  { "id": "loading",      "name": "Loading",      "color": "#3B82F6", "includeInPnl": true, "system": false },
  // ... other event categories ...
  { "id": "removal-job",  "name": "Removal Job",  "color": "#94A3B8", "includeInPnl": true, "system": true },
  { "id": "contract-job", "name": "Contract Job", "color": "#C026D3", "includeInPnl": true, "system": true },
  { "id": "unassigned",   "name": "Unassigned",   "color": "#94A3B8", "includeInPnl": true, "system": true }
]
```

Field semantics:

- **`id`** — stable slug, never changes once created. Lets the server distinguish
  a *rename* (same id, new name) from an *add* / *delete* when the whole array is
  saved. New categories get a slug derived from the name (deduped if needed).
- **`name`** — the value stored on `PlannerEvent.category` and shown in the UI.
- **`color`** — hex, drives planner color resolution (existing behavior).
- **`includeInPnl`** — boolean; controls visibility in the weekly P&L list.
- **`system`** — `true` for `Removal Job`, `Contract Job`, `Unassigned`. System
  rows: cannot be deleted, name not editable, and excluded from the planner
  add-job dropdown. Color + P&L toggle remain editable.

### Migration

On first load, if `job_categories` does not exist, build it from:

- the current `planner_category_colors` map (for colors), plus
- the existing `CONFIGURABLE_CATEGORIES` default list for ordering/names,
- plus the three system entries (`Removal Job`, `Contract Job` already exist as
  configurable; mark them `system: true`. Add `Unassigned`).
- `includeInPnl: true` for everything.

The old `planner_category_colors` key can be left in place (ignored) or removed
on save; leaving it is fine and lower-risk.

## Backend

### `server/lib/job-categories.js` (new)

Owns load/normalize/migrate logic so routes stay thin.

- `loadCategories()` → returns the ordered, defaults-merged array (runs migration
  from `planner_category_colors` if the new key is absent).
- `categoryColorMap(list)` → `{ [name]: "#hex" }` for color resolution.
- `slugify(name, existingIds)` → stable unique id for new categories.
- Default/system constants (`SYSTEM_IDS`, the seed list).

### `server/lib/planner-color.js` (refactor)

`loadCategoryColors()` (currently in planner.js) and `withDefaults()` derive the
`{name: color}` map from `loadCategories()` instead of reading
`planner_category_colors` directly. All existing color-resolution call sites
(`resolveItemColor`) keep working unchanged.

### Routes (in `server/routes/settings.js`)

- **`GET /api/settings/job-categories`** — returns the ordered list. Available to
  authenticated admins (same guard as other settings reads). Used by both the
  Settings page and the Planner.
- **`PUT /api/settings/job-categories`** (admin only) — body is the full ordered
  array. Server logic:
  1. Load the previously-saved array.
  2. Validate: names non-empty + unique (case-insensitive); colors valid hex;
     system entries still present and not renamed; at least the system entries
     intact. Reject with 400 + message on violation.
  3. Diff by `id`:
     - **Renamed** (id present in both, `name` differs) →
       `prisma.plannerEvent.updateMany({ where: { category: oldName }, data: { category: newName } })`.
     - **Deleted** (id in old, absent in new) → reassign:
       `prisma.plannerEvent.updateMany({ where: { category: deletedName }, data: { category: "Unassigned" } })`,
       then it's simply not written back. Deleting a `system` entry is rejected.
     - **Added** (id only in new) → assign a slug if missing; nothing to cascade.
  4. Persist the new array to `companySetting` key `job_categories`.
  5. Return the saved list.

Cascades run before the save in a best-effort sequence (acceptable given
single-admin usage and the existing codebase style; wrap in a transaction if
trivial with the current prisma setup).

### `server/routes/wages.js` — `/pnl` filtering

Load the category list, compute `excluded = Set(names where includeInPnl === false)`.

- **PlannerEvents**: skip rows where `event.category` ∈ `excluded`.
- **CrmJobs** (removals): skip when `"Removal Job"` ∈ `excluded`.
- A category name not present in the list at all (legacy/unknown) → **kept**
  (never silently drop data).
- Totals are computed from the filtered rows.

## Frontend

### Settings — `client/src/pages/admin/CRMSettings.tsx`

Rename the existing "Planner Colors" section to **"Job Categories"**. Each row:

- Up / down arrow buttons (reorder; disabled at ends).
- Name: text input for non-system rows; read-only label for system rows (with a
  small "system" tag).
- Color swatch using the existing color picker (`ColorPickerPopover` /
  `PLANNER_COLOR_PALETTE`).
- **Include in P&L** toggle.
- Delete button — shown only for non-system rows; confirms, then removes the row
  locally (cascade to "Unassigned" happens server-side on Save).

Plus an **"Add category"** button (appends a new editable row with a default
color and `includeInPnl: true`). A single **Save** button PUTs the whole array
and shows the affected-jobs cascade result if any.

### Planner add-job — `client/src/pages/admin/CRMPlanner.tsx`

- Fetch the category list (`GET /api/settings/job-categories`) on mount.
- Populate the Category `<select>` from the fetched list, **non-system entries
  only**.
- When editing an existing job whose category is `Unassigned`, a system, or a
  legacy value not in the dropdown, include that value as the current selection
  so it renders correctly and isn't silently changed.
- Fall back to a small hardcoded default list only if the fetch hasn't resolved.

### `client/src/types/index.ts`

`PLANNER_CATEGORIES` is reduced to a fallback-default constant (used only before
the API resolves) or removed in favor of the fetched list.

## Out of Scope (YAGNI)

- No new database table (key/value `companySetting` is sufficient).
- No per-category icons or descriptions.
- No drag-and-drop reorder (up/down arrows only).
- No bulk re-categorization UI beyond the automatic Unassigned reassignment.
- No change to how contract colors or per-item color overrides take precedence.

## Testing

- **Backend unit**: `slugify` uniqueness; migration from `planner_category_colors`;
  PUT diff producing correct rename/delete/add classifications; system-entry
  protection; `/pnl` exclusion logic (event excluded, removal excluded via
  "Removal Job", legacy category kept).
- **Integration**: rename cascades to existing PlannerEvents; delete reassigns to
  Unassigned; saving an array missing a system entry is rejected.
- **Manual/UAT**:
  1. Add "House Service" with P&L off → its jobs disappear from the weekly P&L
     list but remain in the planner.
  2. Rename a category → existing planner cards reflect the new name + color.
  3. Delete an in-use category → affected jobs show "Unassigned"; re-categorize one.
  4. Reorder → planner add-job dropdown order matches.
  5. Toggle "Removal Job" P&L off → customer removals drop out of the P&L list.
```
