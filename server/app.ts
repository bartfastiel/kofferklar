// HTTP layer: passkey sign-in with invite links, sessions, the check for Caddy (forward_auth), sync of the records
// (items, trips), invites and people. Taken from Liederbuch (itself from Herdgang), without tenants and push.
//
// Conventions: errors as {"error": {"code", "message"}} (messages in German, they are shown in the app), fields in
// snake_case, times in milliseconds. Every changing request needs a matching Origin header. Session cookie `__Host-kk`
// (HttpOnly, Secure, SameSite=Lax); only the SHA-256 of the token is stored. Sessions last 90 days from last use.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { b64url, verifyAssertion, verifyRegistration } from './webauthn.ts';

export interface Config {
  db: DatabaseSync;
  /** allowed origins, e.g. https://kofferklar.example.org; the first one is the main address */
  origins: string[];
  rpId: string;
  rpName?: string;
  trustProxy?: boolean;
  /** development and tests only: serve this directory with the same access check as Caddy */
  staticDir?: string;
  now?: () => number;
}

export const SESSION_COOKIE = '__Host-kk';
const SESSION_TTL = 90 * 24 * 3600 * 1000;
const CHALLENGE_TTL = 5 * 60 * 1000;
export const STORES = ['items', 'trips'];
export const ROLES = ['owner', 'editor', 'reader'];
/** reachable without a session (sign-in page, icons, manifest) */
const PUBLIC_PATHS = /^\/(login\/.*|icon[^/]*\.(svg|png)|manifest\.webmanifest|robots\.txt|favicon\.ico)$/;

/** STATIC_DIR only (development, tests): the same headers as Caddy in production */
export const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const sha256hex = (s: string) => createHash('sha256').update(s).digest('hex');
const token = (bytes = 32) => b64url(randomBytes(bytes));

interface Session {
  userId: string;
  name: string;
  role: string;
  hash: string;
}

interface Invite {
  hash: string;
  role: string;
  name: string | null;
  user_id: string | null;
}

/** next value for records.received: strictly increasing, also across the CLI writing into the same database */
export function nextReceived(db: DatabaseSync, now: number): number {
  const r = db.prepare('SELECT max(received) AS m FROM records').get() as { m: number | null };
  return Math.max(now, Number(r.m || 0) + 1);
}

export function createApp(cfg: Config) {
  const { db } = cfg;
  const now = cfg.now || Date.now;
  const failures = new Map<string, number[]>();

  const audit = (event: string, userId: string | null, ip: string, detail?: string) =>
    db.prepare('INSERT INTO audit (time, user_id, event, ip, detail) VALUES (?, ?, ?, ?, ?)').run(now(), userId, event, ip, detail || null);

  function clientIp(req: IncomingMessage): string {
    if (cfg.trustProxy) {
      const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (xff.length) return xff[xff.length - 1];
    }
    return req.socket.remoteAddress || '';
  }

  const starts = new Map<string, number[]>();
  const WINDOW = 15 * 60 * 1000;

  /** recent timestamps of one IP; the maps are emptied of stale IPs once they grow, so they stay small */
  function recent(map: Map<string, number[]>, ip: string): number[] {
    const t = now();
    if (map.size > 5000) for (const [k, v] of map) if (!v.length || t - v[v.length - 1] >= WINDOW) map.delete(k);
    const list = (map.get(ip) || []).filter((x) => t - x < WINDOW);
    map.set(ip, list);
    return list;
  }

  function limited(ip: string): boolean {
    return recent(failures, ip).length >= 20;
  }

  function fail(ip: string): void {
    recent(failures, ip).push(now());
  }

  /** sign-in attempts without a session write a challenge each: at most 60 per IP and 15 minutes */
  function throttleStart(req: IncomingMessage): void {
    const list = recent(starts, clientIp(req));
    if (list.length >= 60) throw new HttpError(429, 'rate_limited', 'Zu viele Versuche. Bitte später noch einmal.');
    list.push(now());
  }

  function cookies(req: IncomingMessage): Record<string, string> {
    const out: Record<string, string> = {};
    for (const part of String(req.headers.cookie || '').split(';')) {
      const i = part.indexOf('=');
      if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
    }
    return out;
  }

  function session(req: IncomingMessage): Session | null {
    const raw = cookies(req)[SESSION_COOKIE];
    if (!raw) return null;
    const hash = sha256hex(raw);
    const row = db
      .prepare('SELECT s.user_id, s.last_used, u.name, u.role, u.disabled FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?')
      .get(hash) as { user_id: string; last_used: number; name: string; role: string; disabled: number } | undefined;
    if (!row || row.disabled || now() - row.last_used > SESSION_TTL) return null;
    if (now() - row.last_used > 3600 * 1000) db.prepare('UPDATE sessions SET last_used = ? WHERE token_hash = ?').run(now(), hash);
    return { userId: row.user_id, name: row.name, role: row.role, hash };
  }

  function requireSession(req: IncomingMessage): Session {
    const s = session(req);
    if (!s) throw new HttpError(401, 'unauthenticated', 'Bitte anmelden.');
    return s;
  }

  function startSession(res: ServerResponse, userId: string, req: IncomingMessage): void {
    const t = token();
    db.prepare('INSERT INTO sessions (token_hash, user_id, created, last_used, user_agent) VALUES (?, ?, ?, ?, ?)').run(
      sha256hex(t),
      userId,
      now(),
      now(),
      String(req.headers['user-agent'] || '').slice(0, 200),
    );
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${t}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=34560000`);
  }

  function newChallenge(kind: string, inviteHash: string | null, userId?: string): { id: string; challenge: string } {
    db.prepare('DELETE FROM challenges WHERE created < ?').run(now() - CHALLENGE_TTL);
    // overall cap, so many addresses together cannot fill the disk either
    const open = db.prepare('SELECT count(*) AS n FROM challenges').get() as { n: number };
    if (open.n >= 1000) throw new HttpError(429, 'rate_limited', 'Gerade zu viele Anmeldungen. Bitte gleich noch einmal.');
    const c = { id: randomUUID(), challenge: token() };
    db.prepare('INSERT INTO challenges (id, challenge, kind, invite_hash, created) VALUES (?, ?, ?, ?, ?)').run(c.id, c.challenge + (userId ? '|' + userId : ''), kind, inviteHash, now());
    return c;
  }

  function takeChallenge(id: unknown, kind: string): { challenge: string; userId: string | null; invite_hash: string | null } {
    if (typeof id !== 'string') throw new HttpError(400, 'bad_request', 'Challenge fehlt.');
    const row = db.prepare('SELECT * FROM challenges WHERE id = ? AND kind = ?').get(id, kind) as { challenge: string; invite_hash: string | null; created: number } | undefined;
    db.prepare('DELETE FROM challenges WHERE id = ?').run(id);
    if (!row || now() - row.created > CHALLENGE_TTL) throw new HttpError(400, 'challenge_expired', 'Die Anmeldung hat zu lange gedauert. Bitte noch einmal.');
    const [challenge, userId] = row.challenge.split('|');
    return { challenge, userId: userId || null, invite_hash: row.invite_hash };
  }

  function validInvite(code: unknown): Invite {
    if (typeof code !== 'string' || !code) throw new HttpError(404, 'invite_invalid', 'Die Einladung ist ungültig oder abgelaufen.');
    const hash = sha256hex(code);
    const row = db.prepare('SELECT * FROM invites WHERE code_hash = ?').get(hash) as (Invite & { expires: number; used: number | null }) | undefined;
    if (!row || row.used || row.expires < now()) throw new HttpError(404, 'invite_invalid', 'Die Einladung ist ungültig oder abgelaufen.');
    if (row.user_id) {
      const u = db.prepare('SELECT disabled FROM users WHERE id = ?').get(row.user_id) as { disabled: number } | undefined;
      if (!u || u.disabled) throw new HttpError(404, 'invite_invalid', 'Die Einladung ist ungültig oder abgelaufen.');
    }
    return { hash, role: row.role, name: row.name, user_id: row.user_id };
  }

  async function raw(req: IncomingMessage, limit: number): Promise<Buffer> {
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > limit) throw new HttpError(413, 'too_large', 'Die Anfrage ist zu groß.');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > limit) throw new HttpError(413, 'too_large', 'Die Anfrage ist zu groß.');
      chunks.push(c as Buffer);
    }
    return Buffer.concat(chunks);
  }

  async function body(req: IncomingMessage, limit: number): Promise<Record<string, unknown>> {
    const buf = await raw(req, limit);
    if (!buf.length) return {};
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new HttpError(400, 'bad_request', 'JSON erwartet.');
    try {
      const v = JSON.parse(buf.toString('utf8'));
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
      return v;
    } catch {
      throw new HttpError(400, 'bad_request', 'Ungültiges JSON.');
    }
  }

  function json(res: ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
    res.end(JSON.stringify(data));
  }

  const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

  const routes: Record<string, (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void> | void> = {
    'GET /api/health': (_req, res) => json(res, 200, { ok: true }),

    // For Caddy forward_auth: 204 with a session; otherwise page requests are sent to the sign-in page, others get 401.
    'GET /api/auth/check': (req, res) => {
      if (session(req)) {
        res.writeHead(204, { 'Cache-Control': 'no-store' });
        res.end();
        return;
      }
      const uri = String(req.headers['x-forwarded-uri'] || '/');
      if (String(req.headers.accept || '').indexOf('text/html') >= 0) {
        res.writeHead(302, { Location: '/login/?next=' + encodeURIComponent(uri), 'Cache-Control': 'no-store' });
        res.end();
        return;
      }
      json(res, 401, { error: { code: 'unauthenticated', message: 'Bitte anmelden.' } });
    },

    'GET /api/me': (req, res) => {
      const s = requireSession(req);
      json(res, 200, { user: { id: s.userId, name: s.name, role: s.role } });
    },

    'POST /api/me': async (req, res) => {
      const s = requireSession(req);
      const b = await body(req, 4096);
      const name = text(b.name, 40);
      if (!name) throw new HttpError(400, 'bad_request', 'Bitte einen Namen angeben.');
      db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, s.userId);
      json(res, 200, { ok: true, name });
    },

    'POST /api/invites/info': async (req, res) => {
      const inv = validInvite((await body(req, 4096)).invite);
      const user = inv.user_id ? (db.prepare('SELECT name FROM users WHERE id = ?').get(inv.user_id) as { name: string }) : null;
      json(res, 200, { name: user ? user.name : inv.name, role: inv.role, new_device: !!user });
    },

    'POST /api/invites': async (req, res) => {
      const s = requireSession(req);
      if (s.role !== 'owner') throw new HttpError(403, 'forbidden', 'Nur der Besitzer kann einladen.');
      const b = await body(req, 4096);
      const r = typeof b.role === 'string' && ROLES.indexOf(b.role) >= 0 ? b.role : 'reader';
      const userId = typeof b.user_id === 'string' && b.user_id ? b.user_id : undefined;
      const name = text(b.name, 40);
      if (!userId && !name) throw new HttpError(400, 'bad_request', 'Bitte einen Namen angeben.');
      let inv;
      try {
        inv = createInvite(db, { name, userId, role: r, createdBy: s.userId, now: now() });
      } catch (err) {
        throw new HttpError(400, 'bad_request', (err as Error).message);
      }
      audit('invite_created', s.userId, clientIp(req), r);
      json(res, 200, { link: cfg.origins[0] + '/login/?invite=' + inv.code, expires: inv.expires });
    },

    'GET /api/members': (req, res) => {
      requireSession(req);
      const rows = db
        .prepare('SELECT u.id, u.name, u.role, (SELECT max(last_used) FROM sessions x WHERE x.user_id = u.id) AS last_seen FROM users u WHERE u.disabled = 0 ORDER BY u.created')
        .all();
      json(res, 200, { members: rows });
    },

    'POST /api/members/remove': async (req, res) => {
      const s = requireSession(req);
      if (s.role !== 'owner') throw new HttpError(403, 'forbidden', 'Nur der Besitzer kann Zugänge entfernen.');
      const b = await body(req, 4096);
      if (b.user_id === s.userId) throw new HttpError(400, 'bad_request', 'Den eigenen Zugang bitte nicht entfernen.');
      const id = String(b.user_id);
      db.prepare('UPDATE users SET disabled = 1 WHERE id = ?').run(id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
      audit('member_removed', s.userId, clientIp(req), id);
      json(res, 200, { ok: true });
    },

    'POST /api/auth/register/options': async (req, res) => {
      throttleStart(req);
      const b = await body(req, 64 * 1024);
      const inv = validInvite(b.invite);
      const userId = inv.user_id || randomUUID();
      const name = inv.user_id ? (db.prepare('SELECT name FROM users WHERE id = ?').get(userId) as { name: string }).name : inv.name || 'Gast';
      const c = newChallenge('register', inv.hash, userId);
      const existing = db.prepare('SELECT id FROM credentials WHERE user_id = ?').all(userId) as { id: string }[];
      json(res, 200, {
        challenge_id: c.id,
        name,
        public_key: {
          challenge: c.challenge,
          rp: { id: cfg.rpId, name: cfg.rpName || 'Kofferklar' },
          user: { id: b64url(Buffer.from(userId)), name, displayName: name },
          pubKeyCredParams: [
            { type: 'public-key', alg: -7 },
            { type: 'public-key', alg: -8 },
            { type: 'public-key', alg: -257 },
          ],
          authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
          attestation: 'none',
          timeout: CHALLENGE_TTL,
          excludeCredentials: existing.map((e) => ({ type: 'public-key', id: e.id })),
        },
      });
    },

    'POST /api/auth/register/verify': async (req, res) => {
      const ip = clientIp(req);
      if (limited(ip)) throw new HttpError(429, 'rate_limited', 'Zu viele Versuche. Bitte später noch einmal.');
      const b = await body(req, 64 * 1024);
      const ch = takeChallenge(b.challenge_id, 'register');
      const inv = validInvite(b.invite);
      if (inv.hash !== ch.invite_hash || !ch.userId) throw new HttpError(400, 'bad_request', 'Einladung passt nicht zur Challenge.');
      const cred = b.credential as { clientDataJSON?: string; attestationObject?: string } | undefined;
      let v;
      try {
        v = verifyRegistration({ clientDataJSON: String(cred && cred.clientDataJSON), attestationObject: String(cred && cred.attestationObject) }, {
          challenge: ch.challenge,
          origins: cfg.origins,
          rpId: cfg.rpId,
        });
      } catch (err) {
        fail(ip);
        audit('register_fail', inv.user_id, ip, (err as Error).message);
        throw new HttpError(401, 'passkey_rejected', 'Der Passkey konnte nicht eingerichtet werden.');
      }
      const userId = ch.userId;
      db.exec('BEGIN');
      try {
        if (!inv.user_id) db.prepare('INSERT INTO users (id, name, role, created) VALUES (?, ?, ?, ?)').run(userId, inv.name || 'Gast', inv.role, now());
        db.prepare('INSERT INTO credentials (id, user_id, jwk, alg, sign_count, label, created) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
          v.credentialId,
          userId,
          JSON.stringify(v.jwk),
          v.alg,
          v.signCount,
          text(b.label, 80) || null,
          now(),
        );
        db.prepare('UPDATE invites SET used = ? WHERE code_hash = ?').run(now(), inv.hash);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      audit('register_ok', userId, ip, v.credentialId.slice(0, 12));
      startSession(res, userId, req);
      json(res, 200, { ok: true });
    },

    'POST /api/auth/login/options': (req, res) => {
      throttleStart(req);
      const c = newChallenge('login', null);
      json(res, 200, {
        challenge_id: c.id,
        public_key: { challenge: c.challenge, rpId: cfg.rpId, userVerification: 'required', timeout: CHALLENGE_TTL, allowCredentials: [] },
      });
    },

    'POST /api/auth/login/verify': async (req, res) => {
      const ip = clientIp(req);
      if (limited(ip)) throw new HttpError(429, 'rate_limited', 'Zu viele Versuche. Bitte später noch einmal.');
      const b = await body(req, 64 * 1024);
      const ch = takeChallenge(b.challenge_id, 'login');
      const cred = (b.credential || {}) as { id?: string; clientDataJSON?: string; authenticatorData?: string; signature?: string };
      const row = db
        .prepare('SELECT c.*, u.disabled FROM credentials c JOIN users u ON u.id = c.user_id WHERE c.id = ?')
        .get(String(cred.id || '')) as { id: string; user_id: string; jwk: string; alg: number; sign_count: number; disabled: number } | undefined;
      try {
        if (!row || row.disabled) throw new Error('unknown passkey');
        const count = verifyAssertion(
          { clientDataJSON: String(cred.clientDataJSON), authenticatorData: String(cred.authenticatorData), signature: String(cred.signature) },
          { jwk: JSON.parse(row.jwk), alg: row.alg, signCount: row.sign_count },
          { challenge: ch.challenge, origins: cfg.origins, rpId: cfg.rpId },
        );
        db.prepare('UPDATE credentials SET sign_count = ?, last_used = ? WHERE id = ?').run(count, now(), row.id);
      } catch (err) {
        fail(ip);
        audit('login_fail', row ? row.user_id : null, ip, (err as Error).message);
        throw new HttpError(401, 'passkey_rejected', 'Die Anmeldung hat nicht geklappt.');
      }
      audit('login_ok', row.user_id, ip);
      startSession(res, row.user_id, req);
      json(res, 200, { ok: true });
    },

    'POST /api/auth/logout': (req, res) => {
      const s = session(req);
      if (s) {
        db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(s.hash);
        audit('logout', s.userId, clientIp(req));
      }
      res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
      json(res, 200, { ok: true });
    },

    // Sync: records since a cursor (time of arrival at the server), or upload. The newer change wins.
    'GET /api/records': (req, res, url) => {
      requireSession(req);
      const since = Number(url.searchParams.get('since') || 0) || 0;
      const rows = db
        .prepare('SELECT store, id, json, updated, deleted, received FROM records WHERE received > ? ORDER BY received LIMIT 2001')
        .all(since) as { store: string; id: string; json: string; updated: number; deleted: number; received: number }[];
      const more = rows.length > 2000;
      const page = rows.slice(0, 2000);
      json(res, 200, {
        records: page.map((r) => ({ store: r.store, id: r.id, updated: r.updated, deleted: !!r.deleted, data: JSON.parse(r.json) })),
        cursor: page.length ? page[page.length - 1].received : since,
        more,
      });
    },

    'POST /api/records': async (req, res) => {
      const s = requireSession(req);
      const b = await body(req, 8 * 1024 * 1024);
      const list = b.records;
      if (!Array.isArray(list) || list.length > 5000) throw new HttpError(400, 'bad_request', 'records fehlt oder zu viele.');
      // readers only read: their uploads are rejected (they have nothing to write anyway)
      const mayWrite = s.role === 'owner' || s.role === 'editor';
      let accepted = 0;
      let rejected = 0;
      const get = db.prepare('SELECT json, updated, deleted FROM records WHERE store = ? AND id = ?');
      const put = db.prepare(
        'INSERT INTO records (store, id, json, updated, received, deleted) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (store, id) DO UPDATE SET json = excluded.json, updated = excluded.updated, received = excluded.received, deleted = excluded.deleted',
      );
      db.exec('BEGIN');
      try {
        let received = nextReceived(db, now());
        for (const rec of list as { store?: unknown; id?: unknown; updated?: unknown; deleted?: unknown; data?: unknown }[]) {
          if (!rec || typeof rec.store !== 'string' || STORES.indexOf(rec.store) < 0 || typeof rec.id !== 'string' || !rec.id || rec.id.length > 100) {
            throw new HttpError(400, 'bad_request', 'Ungültiger Datensatz.');
          }
          const data = rec.deleted ? null : rec.data === undefined ? null : rec.data;
          const serial = JSON.stringify(data);
          if (serial.length > 256 * 1024) throw new HttpError(413, 'too_large', 'Datensatz zu groß.');
          const updated = Number(rec.updated) || 0;
          const old = get.get(rec.store, rec.id) as { json: string; updated: number; deleted: number } | undefined;
          if (old && old.updated > updated) continue;
          if (!mayWrite) {
            rejected++;
            continue;
          }
          if (old && old.json === serial && !!old.deleted === !!rec.deleted) continue;
          put.run(rec.store, rec.id, serial, updated, received++, rec.deleted ? 1 : 0);
          accepted++;
        }
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      if (rejected) audit('records_rejected', s.userId, clientIp(req), String(rejected));
      json(res, 200, { accepted, rejected });
    },
  };

  const TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.json': 'application/json',
    '.webmanifest': 'application/manifest+json',
    '.txt': 'text/plain; charset=utf-8',
  };

  async function serveStatic(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const base = resolve(cfg.staticDir as string);
    const path = decodeURIComponent(url.pathname);
    if (!PUBLIC_PATHS.test(path) && !session(req)) {
      if (String(req.headers.accept || '').indexOf('text/html') >= 0) {
        res.writeHead(302, { Location: '/login/?next=' + encodeURIComponent(url.pathname + url.search) });
        res.end();
      } else json(res, 401, { error: { code: 'unauthenticated', message: 'Bitte anmelden.' } });
      return;
    }
    let file = resolve(join(base, path));
    if (file !== base && !file.startsWith(base + sep)) throw new HttpError(404, 'not_found', 'Nicht gefunden.');
    try {
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
      const data = await readFile(file);
      res.writeHead(200, {
        'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'Content-Security-Policy': CSP,
        'X-Robots-Tag': 'noindex, nofollow',
      });
      res.end(data);
    } catch {
      throw new HttpError(404, 'not_found', 'Nicht gefunden.');
    }
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url || '/', 'http://local');
      const method = req.method === 'HEAD' ? 'GET' : req.method || 'GET';
      if (method !== 'GET') {
        const origin = String(req.headers.origin || '');
        if (cfg.origins.indexOf(origin) < 0) throw new HttpError(403, 'bad_origin', 'Anfrage von fremder Adresse.');
      }
      const route = routes[method + ' ' + url.pathname];
      if (route) return await route(req, res, url);
      if (url.pathname.startsWith('/api/')) throw new HttpError(404, 'not_found', 'Nicht gefunden.');
      if (cfg.staticDir && method === 'GET') return await serveStatic(req, res, url);
      throw new HttpError(404, 'not_found', 'Nicht gefunden.');
    } catch (err) {
      if (err instanceof HttpError) return json(res, err.status, { error: { code: err.code, message: err.message } });
      console.error(err);
      json(res, 500, { error: { code: 'internal', message: 'Unerwarteter Fehler.' } });
    }
  }

  return { handle };
}

/**
 * Creates an invite (128 bit, single use, 14 days by default). With a name it creates a new person with that role; with
 * userId it adds a device (passkey) for an existing person.
 */
export function createInvite(
  db: DatabaseSync,
  opts: { name?: string; userId?: string; role?: string; days?: number; createdBy?: string; now?: number },
): { code: string; expires: number } {
  const t = opts.now || Date.now();
  if (opts.userId && !db.prepare('SELECT id FROM users WHERE id = ? AND disabled = 0').get(opts.userId)) throw new Error('User not found: ' + opts.userId);
  const r = opts.role || 'reader';
  if (ROLES.indexOf(r) < 0) throw new Error('Unknown role: ' + r);
  const code = b64url(randomBytes(16));
  const expires = t + (opts.days || 14) * 86400000;
  db.prepare('INSERT INTO invites (code_hash, role, name, user_id, created_by, created, expires) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    sha256hex(code),
    r,
    opts.userId ? null : opts.name || null,
    opts.userId || null,
    opts.createdBy || null,
    t,
    expires,
  );
  db.prepare('INSERT INTO audit (time, user_id, event, detail) VALUES (?, ?, ?, ?)').run(t, opts.createdBy || null, 'invite_created', r);
  return { code, expires };
}
