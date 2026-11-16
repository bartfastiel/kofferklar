// Items and trips in memory and every change to them (mirrored to IndexedDB, synced by src/sync.ts).
import { parseList, seedId } from './data/listformat.ts';
import { SEED } from './data/seed.ts';
import { allRaw, loadAll, newId, put, remove, type DataSet } from './data/store.ts';
import type { Answers, Item, Trip } from './data/types.ts';
import { currentMode } from './sync.ts';

let data: DataSet = { items: [], trips: [] };

export async function reload(): Promise<void> {
  data = await loadAll();
  data.trips.sort((a, b) => Number(!!a.done) - Number(!!b.done) || b.created - a.created);
}

export const items = (): Item[] => data.items;
export const trips = (): Trip[] => data.trips;
export const item = (id: string): Item | undefined => data.items.find((i) => i.id === id);
export const trip = (id: string): Trip | undefined => data.trips.find((t) => t.id === id);

/** local mode and previews have no server that seeds: the starter list goes into an empty local database once */
export async function seedLocal(): Promise<void> {
  if (currentMode() === 'server' || (await allRaw('items')).length) return;
  const t = Date.now();
  await put(parseList(SEED).items.map((p) => ({ store: 'items' as const, value: { ...p, id: seedId(p.name), created: t } as Item })));
}

export async function saveItem(i: Item): Promise<void> {
  await put([{ store: 'items', value: i }]);
  await reload();
}

export function newItem(fields: Omit<Item, 'id' | 'created'>): Item {
  return { ...fields, id: newId(), created: Date.now() };
}

export async function deleteItem(id: string): Promise<void> {
  await remove('items', id);
  await reload();
}

export async function createTrip(title: string, answers: Answers, start?: string): Promise<string> {
  const t: Trip = { id: newId(), title, answers, checked: {}, skipped: {}, created: Date.now() };
  if (start) t.start = start;
  await put([{ store: 'trips', value: t }]);
  await reload();
  return t.id;
}

export async function saveTrip(t: Trip): Promise<void> {
  await put([{ store: 'trips', value: t }]);
  await reload();
}

/** deletes the trip and the items that belonged only to it */
export async function deleteTrip(id: string): Promise<void> {
  for (const i of data.items.filter((x) => x.trip === id)) await remove('items', i.id);
  await remove('trips', id);
  await reload();
}

/** adds items whose name is not on the list yet (case-insensitive); returns how many were added */
export async function importItems(list: Omit<Item, 'id' | 'created'>[]): Promise<number> {
  const known = new Set(data.items.filter((i) => !i.trip).map((i) => i.name.trim().toLowerCase()));
  const fresh = list.filter((i) => !known.has(i.name.trim().toLowerCase()));
  if (fresh.length) await put(fresh.map((f) => ({ store: 'items' as const, value: newItem(f) })));
  await reload();
  return fresh.length;
}
