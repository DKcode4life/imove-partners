import type { CatalogCategory } from '../data/inventoryCatalog';
import { DEFAULT_CATALOG } from '../data/inventoryCatalog';

const STORAGE_KEY = 'imove-inventory-catalog';

export function loadCatalog(): CatalogCategory[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as CatalogCategory[];
  } catch {}
  return DEFAULT_CATALOG;
}

export function saveCatalog(catalog: CatalogCategory[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(catalog));
}

export function resetCatalog(): CatalogCategory[] {
  localStorage.removeItem(STORAGE_KEY);
  return DEFAULT_CATALOG;
}
