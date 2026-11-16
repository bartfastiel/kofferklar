// Writes the starter list (src/data/seed.ts) into an empty database once: as long as no item was ever stored. Ids are
// stable (seedId), so a second run never duplicates anything.
import type { DatabaseSync } from 'node:sqlite';
import { parseList, seedId, type ParsedItem } from '../src/data/listformat.ts';
import { SEED } from '../src/data/seed.ts';
import { nextReceived } from './app.ts';

/** inserts items as records; existing ids (also deleted ones) are left alone. Returns the number written. */
export function insertItems(db: DatabaseSync, items: (ParsedItem & { id: string })[], now = Date.now()): number {
  const exists = db.prepare("SELECT 1 FROM records WHERE store = 'items' AND id = ?");
  const put = db.prepare("INSERT INTO records (store, id, json, updated, received, deleted) VALUES ('items', ?, ?, ?, ?, 0)");
  let n = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    let received = nextReceived(db, now);
    for (const it of items) {
      if (exists.get(it.id)) continue;
      put.run(it.id, JSON.stringify({ ...it, created: now, updated: now }), now, received++);
      n++;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return n;
}

export function seedIfEmpty(db: DatabaseSync, now = Date.now()): number {
  if (db.prepare("SELECT 1 FROM records WHERE store = 'items' LIMIT 1").get()) return 0;
  const { items, errors } = parseList(SEED);
  if (errors.length) throw new Error('Starter list: ' + errors.join('; '));
  return insertItems(db, items.map((p) => ({ ...p, id: seedId(p.name) })), now);
}
