// Local data in IndexedDB – the app works offline; src/sync.ts reconciles with the server.
//
// One database (kofferklar); previews (…/pr-<nr>/) and local mode without a server get databases of their own and
// never sync. Every change sets `updated`; deleting leaves a tombstone ({id, deleted: true}) so other devices learn
// about it.
import type { Base, Item, Trip } from './types.ts';

export type StoreName = 'items' | 'trips';
export const STORES: StoreName[] = ['items', 'trips'];

let name = 'kofferklar-local';
let dbPromise: Promise<IDBDatabase> | null = null;
const listeners: (() => void)[] = [];

export function previewName(pathname: string): string | null {
  const m = /\/(pr-\d+)\//.exec(pathname);
  return m ? 'kofferklar-preview-' + m[1] : null;
}

/** selects the database; must be called before any other access */
export function useDatabase(server: boolean): void {
  const next = previewName(location.pathname) || (server ? 'kofferklar' : 'kofferklar-local');
  if (next === name && dbPromise) return;
  if (dbPromise) void dbPromise.then((db) => db.close());
  name = next;
  dbPromise = null;
}

export function onLocalChange(fn: () => void): void {
  listeners.push(fn);
}

function open(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function allRaw<T extends Base>(store: StoreName): Promise<T[]> {
  const db = await open();
  return request(db.transaction(store).objectStore(store).getAll() as IDBRequest<T[]>);
}

/** writes records in one transaction; each gets a fresh `updated` */
export async function put(items: { store: StoreName; value: Base }[]): Promise<void> {
  const db = await open();
  const stores = items.map((i) => i.store).filter((s, i, a) => a.indexOf(s) === i);
  const tx = db.transaction(stores, 'readwrite');
  const t = Date.now();
  for (const { store, value } of items) {
    const v: Base = { ...value, updated: t };
    delete v.deleted;
    tx.objectStore(store).put(v);
  }
  await done(tx);
  listeners.forEach((f) => f());
}

export async function remove(store: StoreName, id: string): Promise<void> {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put({ id, updated: Date.now(), deleted: true });
  await done(tx);
  listeners.forEach((f) => f());
}

export async function applyRemote(records: { store: string; id: string; updated: number; deleted: boolean; data: unknown }[]): Promise<number> {
  const db = await open();
  const tx = db.transaction(STORES, 'readwrite');
  let count = 0;
  for (const r of records) {
    if (STORES.indexOf(r.store as StoreName) < 0) continue;
    const os = tx.objectStore(r.store);
    const local = (await request(os.get(r.id))) as Base | undefined;
    if (local && (local.updated || 0) > r.updated) continue;
    os.put(r.deleted ? { id: r.id, updated: r.updated, deleted: true } : { ...(r.data as object), id: r.id, updated: r.updated });
    count++;
  }
  await done(tx);
  return count;
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const db = await open();
  return request(db.transaction('meta').objectStore('meta').get(key) as IDBRequest<T | undefined>);
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  const db = await open();
  const tx = db.transaction('meta', 'readwrite');
  tx.objectStore('meta').put(value, key);
  await done(tx);
}

export interface DataSet {
  items: Item[];
  trips: Trip[];
}

export async function loadAll(): Promise<DataSet> {
  const db = await open();
  const tx = db.transaction(STORES, 'readonly');
  const get = <T extends Base>(store: StoreName) => request(tx.objectStore(store).getAll() as IDBRequest<T[]>).then((rows) => rows.filter((r) => !r.deleted));
  const [items, trips] = await Promise.all([get<Item>('items'), get<Trip>('trips')]);
  return { items, trips };
}

export const newId = (): string => {
  const b = crypto.getRandomValues(new Uint8Array(12));
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
};
