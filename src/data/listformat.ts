// A plain text format for packing lists (docs/list-format.md): the starter list is written in it, and Daniel's own
// lists can be imported with it. One item per line, fields separated by „|“:
//
//   # Kategorie
//   Name | Priorität | wenn | außer | Menge | Notiz
//   Sturmfeuerzeug | 2 | angeln, zelt | flug
//   Socken | 1 | nacht | | Tag +1 max 8
//
// Priorität 1–3 (default 2). „wenn“: groups separated by commas, tags within a group joined by „+“ (all of them);
// empty = always. „außer“: tags separated by commas. Menge: „Tag“ or „Nacht“, then optionally „/n“ (one per n),
// „+n“ (extra), „max n“.
import { isTag } from './questions.ts';
import type { Priority, Quantity } from './types.ts';

export interface ParsedItem {
  name: string;
  category: string;
  priority: Priority;
  when: string[][];
  unless: string[];
  qty?: Quantity;
  note?: string;
}

export interface ParseResult {
  items: ParsedItem[];
  errors: string[];
}

const tags = (s: string): string[] =>
  s
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);

export function parseQuantity(s: string): Quantity | undefined | null {
  const t = s.trim();
  if (!t) return undefined;
  const m = /^(tag|nacht)(?:\s*\/\s*(\d+))?(?:\s*\+\s*(\d+))?(?:\s*max\s*(\d+))?$/i.exec(t);
  if (!m) return null;
  const q: Quantity = { per: m[1].toLowerCase() === 'tag' ? 'day' : 'night' };
  if (m[2]) q.every = Number(m[2]);
  if (m[3]) q.add = Number(m[3]);
  if (m[4]) q.max = Number(m[4]);
  return q;
}

export function formatQuantity(q: Quantity | undefined): string {
  if (!q) return '';
  return (q.per === 'day' ? 'Tag' : 'Nacht') + (q.every ? ' /' + q.every : '') + (q.add ? ' +' + q.add : '') + (q.max ? ' max ' + q.max : '');
}

export function parseList(text: string): ParseResult {
  const items: ParsedItem[] = [];
  const errors: string[] = [];
  let category = 'Sonstiges';
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    if (line.charAt(0) === '#') {
      category = line.replace(/^#+/, '').trim() || 'Sonstiges';
      return;
    }
    const [name, prio = '', when = '', unless = '', qty = '', ...note] = line.split('|').map((x) => x.trim());
    const at = `Zeile ${i + 1}: `;
    if (!name) return void errors.push(at + 'Name fehlt');
    const p = prio ? Number(prio) : 2;
    if (p !== 1 && p !== 2 && p !== 3) return void errors.push(at + 'Priorität muss 1, 2 oder 3 sein');
    const groups = when
      .split(',')
      .map((g) => g.split('+').map((x) => x.trim().toLowerCase()).filter(Boolean))
      .filter((g) => g.length);
    const not = tags(unless);
    const unknown = [...groups.flat(), ...not].filter((t) => !isTag(t));
    if (unknown.length) return void errors.push(at + 'unbekannte Merkmale: ' + unknown.join(', '));
    const q = parseQuantity(qty);
    if (q === null) return void errors.push(at + 'Menge nicht verstanden: ' + qty);
    const item: ParsedItem = { name, category, priority: p, when: groups, unless: not };
    if (q) item.qty = q;
    if (note.join('|').trim()) item.note = note.join('|').trim();
    items.push(item);
  });
  return { items, errors };
}

export function formatList(items: ParsedItem[]): string {
  const out: string[] = [];
  let category = '';
  for (const it of items) {
    if (it.category !== category) {
      if (out.length) out.push('');
      out.push('# ' + it.category);
      category = it.category;
    }
    const fields = [it.name, String(it.priority), it.when.map((g) => g.join('+')).join(', '), it.unless.join(', '), formatQuantity(it.qty), it.note || ''];
    while (fields.length > 1 && !fields[fields.length - 1]) fields.pop();
    out.push(fields.join(' | '));
  }
  return out.join('\n') + '\n';
}

/** stable id for an item of the starter list, so seeding twice never duplicates */
export function seedId(name: string): string {
  return (
    's-' +
    name
      .toLowerCase()
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  );
}
