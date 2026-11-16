import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { createApp, createInvite, SESSION_COOKIE } from '../app.ts';
import { openDb } from '../db.ts';
import { insertItems, seedIfEmpty } from '../seed.ts';
import { SoftAuthenticator } from './authenticator.ts';

const ORIGIN = 'https://kofferklar.example.org';
const RP = 'kofferklar.example.org';
let server: Server;
let base = '';
let clock = Date.parse('2026-11-01T10:00:00Z');
const db = openDb(':memory:');
const app = createApp({ db, origins: [ORIGIN], rpId: RP, now: () => clock });

before(async () => {
  server = createServer((req, res) => void app.handle(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
});
after(() => server.close());

async function call(path: string, body?: unknown, cookie?: string, origin = ORIGIN) {
  const res = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: origin }), ...(cookie ? { Cookie: cookie } : {}), Accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });
  const set = res.headers.get('set-cookie') || '';
  const m = new RegExp(SESSION_COOKIE + '=([^;]*)').exec(set);
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null, cookie: m && m[1] ? `${SESSION_COOKIE}=${m[1]}` : undefined, headers: res.headers };
}

async function register(dev: SoftAuthenticator, code: string) {
  const o = await call('/api/auth/register/options', { invite: code });
  assert.equal(o.status, 200, JSON.stringify(o.data));
  const cred = dev.register({ challenge: o.data.public_key.challenge, origin: ORIGIN, rpId: RP });
  return call('/api/auth/register/verify', { invite: code, challenge_id: o.data.challenge_id, credential: cred });
}

async function login(dev: SoftAuthenticator) {
  const o = await call('/api/auth/login/options', {});
  const cred = dev.login({ challenge: o.data.public_key.challenge, origin: ORIGIN, rpId: RP });
  return call('/api/auth/login/verify', { challenge_id: o.data.challenge_id, credential: cred });
}

async function person(name: string, role: string) {
  const dev = new SoftAuthenticator();
  const r = await register(dev, createInvite(db, { name, role }).code);
  assert.equal(r.status, 200);
  const me = await call('/api/me', undefined, r.cookie);
  return { dev, cookie: r.cookie as string, id: me.data.user.id as string };
}

test('invite → passkey → session → logout → sign in again', async () => {
  const { code } = createInvite(db, { name: 'Daniel', role: 'owner' });
  assert.deepEqual((await call('/api/invites/info', { invite: code })).data, { name: 'Daniel', role: 'owner', new_device: false });
  const dev = new SoftAuthenticator();
  const r = await register(dev, code);
  assert.equal(r.status, 200);
  const me = await call('/api/me', undefined, r.cookie);
  assert.equal(me.data.user.name, 'Daniel');
  assert.equal(me.data.user.role, 'owner');
  assert.equal((await call('/api/auth/check', undefined, r.cookie)).status, 204);
  await call('/api/auth/logout', {}, r.cookie);
  assert.equal((await call('/api/me', undefined, r.cookie)).status, 401);
  const l = await login(dev);
  assert.equal(l.status, 200);
  assert.equal((await call('/api/me', undefined, l.cookie)).data.user.name, 'Daniel');
  assert.equal((await call('/api/auth/register/options', { invite: code })).data.error.code, 'invite_invalid');
  // second device for the same person
  const second = createInvite(db, { userId: me.data.user.id });
  assert.equal((await call('/api/invites/info', { invite: second.code })).data.new_device, true);
  const t = await register(new SoftAuthenticator('ed25519'), second.code);
  assert.equal((await call('/api/me', undefined, t.cookie)).data.user.id, me.data.user.id);
  assert.equal((await call('/api/me', undefined, t.cookie)).data.user.role, 'owner');
});

test('attacks are rejected; nothing is reachable without a session', async () => {
  const { dev } = await person('Ziel', 'reader');
  const other = new SoftAuthenticator();
  other.credentialId = dev.credentialId;
  assert.equal((await login(other)).data.error.code, 'passkey_rejected');
  const o = await call('/api/auth/login/options', {});
  const wrong = dev.login({ challenge: o.data.public_key.challenge, origin: 'https://evil.example', rpId: RP });
  assert.equal((await call('/api/auth/login/verify', { challenge_id: o.data.challenge_id, credential: wrong })).status, 401);
  dev.flags = 0x01;
  assert.equal((await login(dev)).status, 401);
  assert.equal((await call('/api/auth/login/options', {}, undefined, 'https://evil.example')).data.error.code, 'bad_origin');
  assert.equal((await call('/api/records')).status, 401);
  assert.equal((await call('/api/members')).status, 401);
  const page = await fetch(base + '/api/auth/check', { headers: { Accept: 'text/html', 'X-Forwarded-Uri': '/#/s/x' }, redirect: 'manual' });
  assert.equal(page.status, 302);
  assert.equal(page.headers.get('location'), '/login/?next=%2F%23%2Fs%2Fx');
  assert.equal((await call('/api/health')).headers.get('x-robots-tag'), 'noindex, nofollow');
  const old = createInvite(db, { name: 'Spät', now: clock - 15 * 86400000 });
  assert.equal((await call('/api/auth/register/options', { invite: old.code })).data.error.code, 'invite_invalid');
});

const item = (id: string, name: string) => ({ store: 'items', id, updated: clock, data: { id, name, category: 'Sonstiges', priority: 2, when: [], unless: [], created: clock } });

test('roles: editors write items and trips, readers only read; the newer change wins', async () => {
  const ed = await person('Daniel', 'editor');
  const kid = await person('Ben', 'reader');
  const trip = { store: 'trips', id: 't1', updated: clock, data: { id: 't1', title: 'Angeln', answers: { kind: 'ausflug', nights: 0, pick: {} }, checked: {}, skipped: {}, created: clock } };
  assert.deepEqual((await call('/api/records', { records: [item('i1', 'Kescher'), trip] }, ed.cookie)).data, { accepted: 2, rejected: 0 });
  assert.deepEqual((await call('/api/records', { records: [item('i2', 'Unfug')] }, kid.cookie)).data, { accepted: 0, rejected: 1 });
  const older = { ...item('i1', 'Alt'), updated: clock - 1 };
  assert.deepEqual((await call('/api/records', { records: [older] }, ed.cookie)).data, { accepted: 0, rejected: 0 });
  assert.equal((await call('/api/records', { records: [{ store: 'songs', id: 'x', updated: clock, data: {} }] }, ed.cookie)).status, 400);
  const all = await call('/api/records', undefined, kid.cookie);
  assert.deepEqual(all.data.records.map((r: { id: string }) => r.id).sort(), ['i1', 't1']);
  assert.equal(all.data.records.find((r: { id: string }) => r.id === 'i1').data.name, 'Kescher');
  assert.equal((await call('/api/records?since=' + all.data.cursor, undefined, kid.cookie)).data.records.length, 0);
});


test('invites from the app: owner only; removing a person ends their access', async () => {
  const owner = await person('Oma', 'owner');
  const reader = await person('Leser', 'reader');
  assert.equal((await call('/api/invites', { name: 'X' }, reader.cookie)).status, 403);
  const inv = await call('/api/invites', { name: 'Neu', role: 'editor' }, owner.cookie);
  assert.equal(inv.status, 200);
  assert.ok(inv.data.link.startsWith(ORIGIN + '/login/?invite='));
  const members = await call('/api/members', undefined, owner.cookie);
  assert.ok(members.data.members.some((m: { name: string }) => m.name === 'Leser'));
  assert.equal((await call('/api/members/remove', { user_id: reader.id }, reader.cookie)).status, 403);
  assert.equal((await call('/api/members/remove', { user_id: reader.id }, owner.cookie)).status, 200);
  assert.equal((await call('/api/records', undefined, reader.cookie)).status, 401);
  assert.equal((await login(reader.dev)).status, 401);
  assert.equal((await call('/api/me', { name: '  Opa  ' }, owner.cookie)).data.name, 'Opa');
});


test('starter list: written once into an empty database, never twice, deleted items stay deleted', () => {
  const d = openDb(':memory:');
  const n = seedIfEmpty(d, clock);
  assert.ok(n > 150, String(n));
  assert.equal(seedIfEmpty(d, clock), 0);
  d.prepare("UPDATE records SET deleted = 1 WHERE id = 's-zahnbuerste'").run();
  assert.equal(insertItems(d, [{ id: 's-zahnbuerste', name: 'Zahnbürste', category: 'Bad & Hygiene', priority: 1, when: [['nacht']], unless: [] }], clock), 0);
  const row = d.prepare("SELECT json FROM records WHERE id = 's-zahnbuerste'").get() as { json: string };
  assert.deepEqual(JSON.parse(row.json).when, [['nacht']]);
});
