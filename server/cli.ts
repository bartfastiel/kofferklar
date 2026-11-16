// Administration on the server, e.g. inside the container: node /srv/server/cli.mjs <command>
//
//   invite --name <person> [--role owner|editor|reader] [--days 14]   new person
//   invite --user <id|name> [--days 14]                               another device for an existing person
//   users | audit [n] | logout <user-id> | passkey-remove <passkey-id> | backup <file>
//   user-remove <user-id|name>                  disable a person, end their sessions
//
// Packing list (for agents and scripts; format in docs/list-format.md):
//   items                                       every item in the list format, by category
//   import [--probe] < list.txt                 adds items whose name is not on the list yet; --probe only reports
//   trips                                       trips with their progress
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatList, parseList } from '../src/data/listformat.ts';
import type { Item, Trip } from '../src/data/types.ts';
import { byCategory, plan, progress } from '../src/plan.ts';
import { createInvite, ROLES } from './app.ts';
import { openDb } from './db.ts';
import { insertItems } from './seed.ts';

const dataDir = process.env.DATA_DIR || 'data';
mkdirSync(dataDir, { recursive: true });
const db = openDb(join(dataDir, 'kofferklar.db'));
const origin = (process.env.ORIGIN || 'http://localhost:8080').split(',')[0].trim();
const [cmd, ...args] = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : undefined;
};

function user(key: string | undefined): string {
  if (!key) throw new Error('--user missing');
  const row = db.prepare('SELECT id FROM users WHERE (id = ? OR name = ?) AND disabled = 0').all(key, key) as { id: string }[];
  if (row.length !== 1) throw new Error(row.length ? 'Ambiguous user: ' + key : 'User not found: ' + key);
  return row[0].id;
}

function records<T>(store: string): T[] {
  return (db.prepare('SELECT json FROM records WHERE store = ? AND deleted = 0').all(store) as { json: string }[]).map((r) => JSON.parse(r.json) as T);
}

const fold = (s: string) => s.trim().toLowerCase();

try {
  if (cmd === 'invite') {
    const userId = opt('user') ? user(opt('user')) : undefined;
    const role = opt('role') || 'owner';
    if (ROLES.indexOf(role) < 0) throw new Error('--role must be owner, editor or reader');
    if (!userId && !opt('name')) throw new Error('--name or --user missing');
    const inv = createInvite(db, { name: opt('name'), userId, role, days: Number(opt('days') || 14) });
    console.log(`${origin}/login/?invite=${inv.code}`);
    console.log(`valid until ${new Date(inv.expires).toISOString()}, single use`);
  } else if (cmd === 'users') {
    const sql = `SELECT u.id, u.name, u.role, u.disabled,
      (SELECT count(*) FROM credentials c WHERE c.user_id = u.id) AS passkeys,
      (SELECT count(*) FROM sessions s WHERE s.user_id = u.id) AS sessions
      FROM users u`;
    for (const u of db.prepare(sql).all()) console.log(u);
    for (const c of db.prepare('SELECT id, user_id, label, created, last_used FROM credentials').all()) console.log(c);
  } else if (cmd === 'logout' && args[0]) {
    console.log(db.prepare('DELETE FROM sessions WHERE user_id = ?').run(args[0]));
  } else if (cmd === 'user-remove' && args[0]) {
    const id = user(args[0]);
    db.prepare('UPDATE users SET disabled = 1 WHERE id = ?').run(id);
    db.prepare('DELETE FROM invites WHERE used IS NULL AND (user_id = ? OR created_by = ?)').run(id, id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    console.log('disabled ' + id);
  } else if (cmd === 'passkey-remove' && args[0]) {
    console.log(db.prepare('DELETE FROM credentials WHERE id = ?').run(args[0]));
  } else if (cmd === 'audit') {
    for (const r of db.prepare('SELECT * FROM audit ORDER BY time DESC LIMIT ?').all(Number(args[0] || 30))) console.log(r);
  } else if (cmd === 'backup' && args[0]) {
    db.prepare('VACUUM INTO ?').run(args[0]);
    console.log('Backup written: ' + args[0]);
  } else if (cmd === 'items') {
    const items = records<Item>('items')
      .filter((i) => !i.trip)
      .sort((a, b) => byCategory(a.category, b.category) || a.priority - b.priority || a.name.localeCompare(b.name, 'de'));
    process.stdout.write(formatList(items));
  } else if (cmd === 'import') {
    const { items, errors } = parseList(readFileSync(0, 'utf8'));
    if (errors.length) throw new Error(errors.join('\n'));
    const known = new Set(records<Item>('items').filter((i) => !i.trip).map((i) => fold(i.name)));
    const fresh = items.filter((i) => !known.has(fold(i.name)));
    for (const i of items) console.log((known.has(fold(i.name)) ? '= ' : '+ ') + i.category + ' / ' + i.name);
    if (args.includes('--probe')) console.log(`${fresh.length} new, ${items.length - fresh.length} already there (probe, nothing written)`);
    else console.log(`${insertItems(db, fresh.map((i) => ({ ...i, id: randomBytes(12).toString('hex') })))} new, ${items.length - fresh.length} already there`);
  } else if (cmd === 'trips') {
    const items = records<Item>('items');
    for (const t of records<Trip>('trips').sort((a, b) => b.created - a.created)) {
      const p = progress(plan(items, t));
      console.log(`${t.id}  ${t.done ? 'done ' : 'open '} ${p.done}/${p.total}  ${t.title}`);
    }
  } else {
    console.log('Commands: invite | users | user-remove | logout | passkey-remove | audit | backup | items | import | trips');
    process.exitCode = 1;
  }
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
}
db.close();
