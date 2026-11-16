// Database (node:sqlite): one packing list, no tenants. People with a role and their passkeys and sessions, invites,
// the synced records (items, trips) and an audit log.
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = [
  // role: owner (everything, invites), editor (items and trips), reader (read only)
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    created INTEGER NOT NULL,
    disabled INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS credentials (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    jwk TEXT NOT NULL,
    alg INTEGER NOT NULL,
    sign_count INTEGER NOT NULL,
    label TEXT,
    created INTEGER NOT NULL,
    last_used INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    created INTEGER NOT NULL,
    last_used INTEGER NOT NULL,
    user_agent TEXT
  )`,
  // an invite either creates a new person (name, role) or adds a passkey to an existing one (user_id)
  `CREATE TABLE IF NOT EXISTS invites (
    code_hash TEXT PRIMARY KEY,
    role TEXT NOT NULL,
    name TEXT,
    user_id TEXT REFERENCES users(id),
    created_by TEXT,
    created INTEGER NOT NULL,
    expires INTEGER NOT NULL,
    used INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS challenges (
    id TEXT PRIMARY KEY,
    challenge TEXT NOT NULL,
    kind TEXT NOT NULL,
    invite_hash TEXT,
    created INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS audit (
    time INTEGER NOT NULL,
    user_id TEXT,
    event TEXT NOT NULL,
    ip TEXT,
    detail TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS records (
    store TEXT NOT NULL,
    id TEXT NOT NULL,
    json TEXT NOT NULL,
    updated INTEGER NOT NULL,
    received INTEGER NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (store, id)
  )`,
  `CREATE INDEX IF NOT EXISTS records_received ON records (received)`,
];

export function openDb(file: string): DatabaseSync {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  for (const s of SCHEMA) db.exec(s);
  return db;
}
