/**
 * Offline-first survey storage.
 *
 * Everything is persisted to IndexedDB so a surveyor can fill an entire job
 * with zero internet, hit "Sync now" later, and have the server caught up.
 *
 * Why IDB and not localStorage:
 *   - localStorage caps at ~5–10 MB and `setItem` throws on overflow.
 *     A survey with a dozen room photos blows past that easily.
 *   - localStorage failures used to be silent here; surveys came back
 *     half-saved with no warning. IDB lets us surface a real error.
 *
 * Schema (object stores in the `imove-surveys` DB):
 *   - `data`        — keyed by jobId, stores the inventory grid (SurveyData)
 *   - `searchData`  — keyed by jobId, stores search-added items
 *   - `customRooms` — keyed by jobId, stores the list of user-added rooms
 *   - `roomPhotos`  — keyed by jobId, stores compressed room photo data URLs
 *   - `meta`        — keyed by jobId, stores { lastModified, lastSyncedAt }
 */

const DB_NAME = 'imove-surveys';
const DB_VERSION = 1;
const STORES = ['data', 'searchData', 'customRooms', 'roomPhotos', 'meta'] as const;
type StoreName = typeof STORES[number];

export interface SurveyMeta {
  lastModified: number;   // epoch ms — bumped on every write
  lastSyncedAt: number;   // epoch ms — set when a server push succeeds
}

export interface SurveyDoc {
  data: Record<string, Record<string, { count: number; note: string; photo?: string }>>;
  searchData: Record<string, Record<string, { count: number; note: string; photo?: string }>>;
  customRooms: Array<{ id: string; name: string; categoryId: string }>;
  roomPhotos: Record<string, string[]>;
  meta: SurveyMeta;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    req.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another tab'));
  });
  return dbPromise;
}

async function txGet<T>(store: StoreName, key: string): Promise<T | undefined> {
  const db = await openDB();
  return new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error ?? new Error(`IDB get ${store}/${key} failed`));
  });
}

async function txPut(store: StoreName, key: string, value: unknown): Promise<void> {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error(`IDB put ${store}/${key} failed`));
  });
}

async function bumpModified(jobId: string): Promise<SurveyMeta> {
  const cur = (await txGet<SurveyMeta>('meta', jobId)) ?? { lastModified: 0, lastSyncedAt: 0 };
  const next: SurveyMeta = { lastModified: Date.now(), lastSyncedAt: cur.lastSyncedAt };
  await txPut('meta', jobId, next);
  return next;
}

// ── Public API ────────────────────────────────────────────────────────────

export async function loadDoc(jobId: string): Promise<SurveyDoc> {
  const [data, searchData, customRooms, roomPhotos, meta] = await Promise.all([
    txGet<SurveyDoc['data']>('data', jobId),
    txGet<SurveyDoc['searchData']>('searchData', jobId),
    txGet<SurveyDoc['customRooms']>('customRooms', jobId),
    txGet<SurveyDoc['roomPhotos']>('roomPhotos', jobId),
    txGet<SurveyMeta>('meta', jobId),
  ]);
  return {
    data: data ?? {},
    searchData: searchData ?? {},
    customRooms: customRooms ?? [],
    roomPhotos: roomPhotos ?? {},
    meta: meta ?? { lastModified: 0, lastSyncedAt: 0 },
  };
}

export async function isEmpty(jobId: string): Promise<boolean> {
  const doc = await loadDoc(jobId);
  return (
    Object.keys(doc.data).length === 0 &&
    Object.keys(doc.searchData).length === 0 &&
    doc.customRooms.length === 0 &&
    Object.keys(doc.roomPhotos).length === 0
  );
}

export async function saveData(jobId: string, data: SurveyDoc['data']): Promise<SurveyMeta> {
  await txPut('data', jobId, data);
  return bumpModified(jobId);
}

export async function saveSearchData(jobId: string, searchData: SurveyDoc['searchData']): Promise<SurveyMeta> {
  await txPut('searchData', jobId, searchData);
  return bumpModified(jobId);
}

export async function saveCustomRooms(jobId: string, customRooms: SurveyDoc['customRooms']): Promise<SurveyMeta> {
  await txPut('customRooms', jobId, customRooms);
  return bumpModified(jobId);
}

export async function saveRoomPhotos(jobId: string, roomPhotos: SurveyDoc['roomPhotos']): Promise<SurveyMeta> {
  await txPut('roomPhotos', jobId, roomPhotos);
  return bumpModified(jobId);
}

/** Replace the entire doc (used on server-pull when local is empty). */
export async function replaceDoc(jobId: string, doc: Partial<SurveyDoc>): Promise<void> {
  if (doc.data !== undefined)        await txPut('data',        jobId, doc.data);
  if (doc.searchData !== undefined)  await txPut('searchData',  jobId, doc.searchData);
  if (doc.customRooms !== undefined) await txPut('customRooms', jobId, doc.customRooms);
  if (doc.roomPhotos !== undefined)  await txPut('roomPhotos',  jobId, doc.roomPhotos);
  // Treat a fresh server pull as "fully synced" — no local edits pending.
  const now = Date.now();
  await txPut('meta', jobId, { lastModified: now, lastSyncedAt: now } satisfies SurveyMeta);
}

export async function markSynced(jobId: string, at: number = Date.now()): Promise<SurveyMeta> {
  const cur = (await txGet<SurveyMeta>('meta', jobId)) ?? { lastModified: 0, lastSyncedAt: 0 };
  const next: SurveyMeta = { lastModified: cur.lastModified, lastSyncedAt: at };
  await txPut('meta', jobId, next);
  return next;
}

export async function getMeta(jobId: string): Promise<SurveyMeta> {
  return (await txGet<SurveyMeta>('meta', jobId)) ?? { lastModified: 0, lastSyncedAt: 0 };
}

export function hasUnsynced(meta: SurveyMeta): boolean {
  return meta.lastModified > meta.lastSyncedAt;
}

// ── One-time localStorage → IDB migration ────────────────────────────────

const lsKey = {
  data:        (jobId: string) => `crm-survey-${jobId}`,
  searchData:  (jobId: string) => `crm-survey-search-${jobId}`,
  customRooms: (jobId: string) => `crm-survey-rooms-${jobId}`,
  roomPhotos:  (jobId: string) => `crm-survey-photos-${jobId}`,
  migrated:    (jobId: string) => `crm-survey-migrated-${jobId}`,
};

/**
 * If this job's data still lives in localStorage and not yet in IDB, copy
 * it across. Idempotent — sets a "migrated" sentinel in localStorage so we
 * only do it once per job. localStorage is left in place as a safety net
 * but no longer written to.
 */
export async function migrateFromLocalStorageOnce(jobId: string): Promise<void> {
  if (localStorage.getItem(lsKey.migrated(jobId))) return;

  const existing = await loadDoc(jobId);
  const needsMigration =
    Object.keys(existing.data).length === 0 &&
    Object.keys(existing.searchData).length === 0 &&
    existing.customRooms.length === 0 &&
    Object.keys(existing.roomPhotos).length === 0;

  if (!needsMigration) {
    // IDB already has data for this job — skip and remember.
    localStorage.setItem(lsKey.migrated(jobId), '1');
    return;
  }

  const safeParse = <T,>(raw: string | null, fallback: T): T => {
    if (!raw) return fallback;
    try { return JSON.parse(raw) as T; } catch { return fallback; }
  };

  const lsData        = safeParse<SurveyDoc['data']>(localStorage.getItem(lsKey.data(jobId)), {});
  const lsSearch      = safeParse<SurveyDoc['searchData']>(localStorage.getItem(lsKey.searchData(jobId)), {});
  const lsCustomRooms = safeParse<SurveyDoc['customRooms']>(localStorage.getItem(lsKey.customRooms(jobId)), []);
  const lsRoomPhotos  = safeParse<SurveyDoc['roomPhotos']>(localStorage.getItem(lsKey.roomPhotos(jobId)), {});

  const hasAny =
    Object.keys(lsData).length > 0 ||
    Object.keys(lsSearch).length > 0 ||
    lsCustomRooms.length > 0 ||
    Object.keys(lsRoomPhotos).length > 0;

  if (hasAny) {
    await Promise.all([
      txPut('data',        jobId, lsData),
      txPut('searchData',  jobId, lsSearch),
      txPut('customRooms', jobId, lsCustomRooms),
      txPut('roomPhotos',  jobId, lsRoomPhotos),
    ]);
    // Migrated content represents in-progress local work — treat as
    // unsynced until the user pushes (lastModified > lastSyncedAt = 0).
    await txPut('meta', jobId, { lastModified: Date.now(), lastSyncedAt: 0 } satisfies SurveyMeta);
  }

  localStorage.setItem(lsKey.migrated(jobId), '1');
}
