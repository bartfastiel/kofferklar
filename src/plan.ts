// From the configurator's answers to the packing list: tags of a trip, which items apply, how many and why. No DOM.
import { CATEGORIES, QUESTIONS } from './data/questions.ts';
import type { Answers, Item, Quantity, Trip } from './data/types.ts';

export function tagsOf(a: Answers): Set<string> {
  const t = new Set<string>();
  if (a.kind) t.add(a.kind);
  if (a.nights > 0) t.add('nacht');
  if (a.nights >= 5) t.add('lang');
  for (const q of QUESTIONS) for (const tag of a.pick[q.id] || []) t.add(tag);
  if (t.has('eu') || t.has('welt')) t.add('ausland');
  if (t.has('handgepaeck')) t.add('flug');
  if (!t.has('nacht')) for (const o of QUESTIONS.find((q) => q.id === 'stay')!.options) t.delete(o.tag);
  return t;
}

/** the first group of `when` the tags satisfy: [] for items that are always suggested, null if it does not apply */
export function matches(item: Pick<Item, 'when' | 'unless'>, tags: Set<string>): string[] | null {
  if (item.unless.some((u) => tags.has(u))) return null;
  if (!item.when.length) return [];
  for (const g of item.when) if (g.every((x) => tags.has(x))) return g;
  return null;
}

export function count(q: Quantity | undefined, nights: number): number {
  if (!q) return 1;
  const base = q.per === 'night' ? nights : nights + 1;
  let n = Math.ceil(base / (q.every || 1)) + (q.add || 0);
  if (q.max) n = Math.min(n, q.max);
  return Math.max(1, n);
}

export interface Line {
  item: Item;
  qty: number;
  /** the tags that brought the item onto the list (empty: always) */
  reason: string[];
  checked: boolean;
  skipped: boolean;
}

export interface Section {
  category: string;
  lines: Line[];
}

export function categoryRank(c: string): number {
  const i = CATEGORIES.indexOf(c);
  return i < 0 ? CATEGORIES.length - 1 : i;
}

export const byCategory = (a: string, b: string): number => categoryRank(a) - categoryRank(b) || a.localeCompare(b, 'de');

/** the packing list of a trip, by category; within a category by priority, then by name */
export function plan(items: Item[], trip: Trip): Section[] {
  const tags = tagsOf(trip.answers);
  const lines: Line[] = [];
  for (const item of items) {
    if (item.trip && item.trip !== trip.id) continue;
    const reason = item.trip ? [] : matches(item, tags);
    if (!reason) continue;
    lines.push({ item, qty: count(item.qty, trip.answers.nights), reason, checked: !!trip.checked[item.id], skipped: !!trip.skipped[item.id] });
  }
  const sections = new Map<string, Line[]>();
  for (const l of lines) {
    const list = sections.get(l.item.category) || [];
    list.push(l);
    sections.set(l.item.category, list);
  }
  return Array.from(sections.keys())
    .sort(byCategory)
    .map((category) => ({
      category,
      lines: (sections.get(category) as Line[]).sort((a, b) => a.item.priority - b.item.priority || a.item.name.localeCompare(b.item.name, 'de')),
    }));
}

export interface Progress {
  done: number;
  total: number;
  /** essential items not packed yet */
  missingEssential: number;
}

export function progress(sections: Section[]): Progress {
  let done = 0;
  let total = 0;
  let missingEssential = 0;
  for (const s of sections) {
    for (const l of s.lines) {
      if (l.skipped) continue;
      total++;
      if (l.checked) done++;
      else if (l.item.priority === 1) missingEssential++;
    }
  }
  return { done, total, missingEssential };
}

/** a short default title from the answers, e.g. „Urlaub · 7 Nächte · Angeln“ */
export function defaultTitle(a: Answers, label: (tag: string) => string): string {
  const parts = [label(a.kind) || 'Reise'];
  parts.push(a.nights === 0 ? 'ohne Übernachtung' : a.nights === 1 ? '1 Nacht' : a.nights + ' Nächte');
  const acts = (a.pick.activities || []).filter((t) => t !== 'arbeit').map(label);
  if (acts.length) parts.push(acts.slice(0, 2).join(', '));
  else if ((a.pick.dest || [])[0] && a.pick.dest[0] !== 'inland') parts.push(label(a.pick.dest[0]));
  return parts.join(' · ');
}
