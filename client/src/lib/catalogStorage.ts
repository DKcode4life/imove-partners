import api from './api';
import type { CatalogCategory } from '../data/inventoryCatalog';
import { DEFAULT_CATALOG } from '../data/inventoryCatalog';

const LS_KEY = 'imove-inventory-catalog';

// Load from the server (single source of truth across all devices).
// Falls back to the localStorage cache if offline, then to the built-in defaults.
export async function loadCatalog(): Promise<CatalogCategory[]> {
  try {
    const r = await api.get<CatalogCategory[] | null>('/settings/catalog');
    if (Array.isArray(r.data)) {
      localStorage.setItem(LS_KEY, JSON.stringify(r.data));
      return r.data;
    }
  } catch {
    // Offline or not yet authenticated — use local cache
  }
  try {
    const cached = localStorage.getItem(LS_KEY);
    if (cached) return JSON.parse(cached) as CatalogCategory[];
  } catch {}
  return DEFAULT_CATALOG;
}

// Write to localStorage immediately (so the UI feels instant), then persist to the server.
export async function saveCatalog(catalog: CatalogCategory[]): Promise<void> {
  localStorage.setItem(LS_KEY, JSON.stringify(catalog));
  try {
    await api.put('/settings/catalog', catalog);
  } catch {
    // Changes are already in localStorage; server will sync next time
  }
}

// Clear the local cache and return the defaults. The caller is expected to
// follow up with saveCatalog(defaults) to wipe the server copy too.
export function resetCatalog(): CatalogCategory[] {
  localStorage.removeItem(LS_KEY);
  return DEFAULT_CATALOG;
}
