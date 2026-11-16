import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatList, parseList, seedId } from '../../src/data/listformat.ts';
import { SEED } from '../../src/data/seed.ts';
import type { Answers, Item, Trip } from '../../src/data/types.ts';
import { count, defaultTitle, matches, plan, progress, tagsOf } from '../../src/plan.ts';
import { tagLabel } from '../../src/data/questions.ts';

const seed = parseList(SEED);
const items: Item[] = seed.items.map((p) => ({ ...p, id: seedId(p.name), created: 0 }));

function trip(a: Partial<Answers> & { pick?: Record<string, string[]> }, extra: Partial<Trip> = {}): Trip {
  return { id: 't1', title: 'Test', answers: { kind: 'urlaub', nights: 7, pick: {}, ...a }, checked: {}, skipped: {}, created: 0, ...extra };
}

const names = (t: Trip) => plan(items, t).flatMap((s) => s.lines.map((l) => l.item.name));

test('the starter list parses without errors and has unique ids', () => {
  assert.deepEqual(seed.errors, []);
  assert.ok(seed.items.length > 150, String(seed.items.length));
  const ids = items.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('tags: nights, abroad, hand luggage implies flight, accommodation only with a night', () => {
  const t = tagsOf({ kind: 'ausflug', nights: 0, pick: { dest: ['eu'], travel: ['handgepaeck'], stay: ['hotel'] } });
  assert.deepEqual([...t].sort(), ['ausflug', 'ausland', 'eu', 'flug', 'handgepaeck']);
  assert.ok(tagsOf({ kind: 'urlaub', nights: 5, pick: {} }).has('lang'));
});

test('an overnight business trip gets toothbrush and laptop, no fishing gear', () => {
  const n = names(trip({ kind: 'dienstreise', nights: 1, pick: { travel: ['bahn'], activities: ['arbeit'] } }));
  for (const x of ['Zahnbürste', 'Zahnpasta', 'Rasierer', 'Laptop mit Netzteil', 'Fahrkarten', 'Hemden', 'Personalausweis']) assert.ok(n.includes(x), x);
  for (const x of ['Köder', 'Reisepass', 'Zelt']) assert.ok(!n.includes(x), x);
});

test('a day of fishing: gear, licence, no toothbrush', () => {
  const n = names(trip({ kind: 'ausflug', nights: 0, pick: { travel: ['auto'], activities: ['angeln'] } }));
  for (const x of ['Köder', 'Haken', 'Angelruten', 'Rollen', 'Knüppel (Fischtöter)', 'Abhakmatte', 'Zange', 'Leatherman', 'Gummistiefel', 'Fischereischein', 'Sturmfeuerzeug']) assert.ok(n.includes(x), x);
  assert.ok(!n.includes('Zahnbürste'));
  assert.ok(!n.includes('Feuerzeug'));
});

test('flying to a fishing holiday abroad: passport, a normal lighter instead of a storm lighter', () => {
  const n = names(trip({ pick: { travel: ['flug', 'handgepaeck'], dest: ['welt'], activities: ['angeln'] } }));
  assert.ok(n.includes('Reisepass'));
  assert.ok(n.includes('Feuerzeug'));
  assert.ok(!n.includes('Sturmfeuerzeug'));
  assert.ok(!n.includes('Leatherman'), 'no knife in hand luggage');
});

test('quantities follow the days and are capped', () => {
  assert.equal(count({ per: 'day', add: 1, max: 8 }, 2), 4);
  assert.equal(count({ per: 'day', add: 1, max: 8 }, 13), 8);
  assert.equal(count({ per: 'day', every: 3, max: 3 }, 1), 1);
  assert.equal(count({ per: 'night' }, 0), 1);
  assert.equal(count(undefined, 10), 1);
});

test('matches reports the reason; unless wins', () => {
  assert.deepEqual(matches({ when: [['angeln'], ['zelt']], unless: [] }, new Set(['zelt'])), ['zelt']);
  assert.equal(matches({ when: [['angeln']], unless: ['flug'] }, new Set(['angeln', 'flug'])), null);
  assert.deepEqual(matches({ when: [], unless: [] }, new Set()), []);
});

test('items of one trip only show there; sorted by priority; progress counts essentials', () => {
  const extra: Item = { id: 'x', name: 'Angelstuhl vom Nachbarn zurückgeben', category: 'Sonstiges', priority: 1, when: [], unless: [], trip: 't1', created: 0 };
  const t = trip({ kind: 'ausflug', nights: 0, pick: { activities: ['angeln'] } }, { checked: { 's-koeder': true }, skipped: { 's-wathose': true } });
  const all = [...items, extra];
  assert.ok(plan(all, t).some((s) => s.lines.some((l) => l.item.id === 'x')));
  assert.ok(!plan(all, { ...t, id: 't2' }).some((s) => s.lines.some((l) => l.item.id === 'x')));
  const fishing = plan(all, t).find((s) => s.category === 'Angeln')!;
  assert.equal(fishing.lines[0].item.priority, 1);
  assert.equal(fishing.lines[fishing.lines.length - 1].item.priority, 3);
  const p = progress(plan(all, t));
  assert.equal(p.done, 1);
  assert.ok(p.missingEssential > 5);
  assert.equal(p.total, plan(all, t).reduce((s, x) => s + x.lines.length, 0) - 1);
});

test('the list format round-trips and reports mistakes', () => {
  assert.deepEqual(parseList(formatList(seed.items)).items, seed.items);
  const r = parseList('# Test\nDing | 4\nAnderes | 1 | gibtsnicht\nNoch | 2 | | | jede Woche\nGut | | angeln+flug | | Nacht /2 +1 max 3 | Hinweis');
  assert.equal(r.errors.length, 3);
  assert.deepEqual(r.items, [{ name: 'Gut', category: 'Test', priority: 2, when: [['angeln', 'flug']], unless: [], qty: { per: 'night', every: 2, add: 1, max: 3 }, note: 'Hinweis' }]);
});

test('default title', () => {
  assert.equal(defaultTitle({ kind: 'urlaub', nights: 7, pick: { activities: ['angeln', 'wandern'] } }, tagLabel), 'Urlaub · 7 Nächte · Angeln, Wandern');
  assert.equal(defaultTitle({ kind: 'dienstreise', nights: 0, pick: { dest: ['eu'] } }, tagLabel), 'Dienstreise · ohne Übernachtung · EU-Ausland');
});
