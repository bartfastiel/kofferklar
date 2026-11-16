// The configurator's questions. Every option is a tag; items name the tags they are needed for (src/data/types.ts).
// Tags are stable identifiers: renaming one means migrating the items that use it.

export interface Option {
  tag: string;
  label: string;
  hint?: string;
}

export interface Question {
  id: string;
  title: string;
  /** one: a single choice (tap again to clear), many: any number */
  type: 'one' | 'many';
  options: Option[];
  /** asked only if this returns true */
  when?: (tags: Set<string>) => boolean;
}

/** the first question, always a single choice; its tag is `answers.kind` */
export const KINDS: Option[] = [
  { tag: 'urlaub', label: 'Urlaub' },
  { tag: 'dienstreise', label: 'Dienstreise' },
  { tag: 'besuch', label: 'Besuch', hint: 'Familie oder Freunde' },
  { tag: 'ausflug', label: 'Ausflug', hint: 'z. B. ein Angeltag' },
];

export const QUESTIONS: Question[] = [
  {
    id: 'travel',
    title: 'Wie kommst du hin?',
    type: 'many',
    options: [
      { tag: 'auto', label: 'Auto' },
      { tag: 'flug', label: 'Flugzeug' },
      { tag: 'handgepaeck', label: 'Nur Handgepäck', hint: 'Flüssigkeiten bis 100 ml' },
      { tag: 'bahn', label: 'Bahn oder Bus' },
      { tag: 'fahrrad', label: 'Fahrrad' },
    ],
  },
  {
    id: 'dest',
    title: 'Wohin?',
    type: 'one',
    options: [
      { tag: 'inland', label: 'Deutschland' },
      { tag: 'eu', label: 'EU-Ausland' },
      { tag: 'welt', label: 'Außerhalb der EU', hint: 'Reisepass, Adapter, Roaming' },
    ],
  },
  {
    id: 'weather',
    title: 'Welches Wetter erwartest du?',
    type: 'many',
    options: [
      { tag: 'warm', label: 'Warm', hint: 'Sommer, Sonne' },
      { tag: 'mild', label: 'Mild', hint: 'Frühling, Herbst' },
      { tag: 'kalt', label: 'Kalt', hint: 'Winter, Frost' },
      { tag: 'regen', label: 'Regen' },
    ],
  },
  {
    id: 'activities',
    title: 'Was hast du vor?',
    type: 'many',
    options: [
      { tag: 'angeln', label: 'Angeln' },
      { tag: 'wintersport', label: 'Ski & Wintersport' },
      { tag: 'wandern', label: 'Wandern' },
      { tag: 'baden', label: 'Baden & Strand' },
      { tag: 'sport', label: 'Laufen & Fitness' },
      { tag: 'radtour', label: 'Radtour' },
      { tag: 'festlich', label: 'Feier oder Anlass', hint: 'schicke Kleidung' },
      { tag: 'arbeit', label: 'Arbeiten', hint: 'Laptop, Termine' },
    ],
  },
  {
    id: 'stay',
    title: 'Wo übernachtest du?',
    type: 'one',
    when: (t) => t.has('nacht'),
    options: [
      { tag: 'hotel', label: 'Hotel' },
      { tag: 'ferienwohnung', label: 'Ferienwohnung' },
      { tag: 'zelt', label: 'Zelt oder Camping' },
      { tag: 'freunde', label: 'Bei Familie oder Freunden' },
    ],
  },
  {
    id: 'people',
    title: 'Wer kommt mit?',
    type: 'many',
    options: [
      { tag: 'kinder', label: 'Kinder' },
      { tag: 'partner', label: 'Partnerin oder Partner' },
    ],
  },
];

/** tags derived from the answers, not chosen directly */
export const DERIVED: Option[] = [
  { tag: 'nacht', label: 'Übernachtung' },
  { tag: 'lang', label: 'Ab 5 Nächten' },
  { tag: 'ausland', label: 'Ausland' },
];

const ALL: Option[] = [...KINDS, ...DERIVED, ...QUESTIONS.flatMap((q) => q.options)];

export function tagLabel(tag: string): string {
  const o = ALL.find((x) => x.tag === tag);
  return o ? o.label : tag;
}

/** every tag, grouped for pickers */
export function tagGroups(): { title: string; options: Option[] }[] {
  return [{ title: 'Art der Reise', options: KINDS }, { title: 'Dauer und Ziel', options: DERIVED }, ...QUESTIONS.map((q) => ({ title: q.title, options: q.options }))];
}

export const isTag = (tag: string): boolean => ALL.some((x) => x.tag === tag);

/** fixed order of the categories in the list; others come after them, alphabetically */
export const CATEGORIES = [
  'Dokumente & Geld',
  'Elektronik',
  'Kleidung',
  'Schuhe',
  'Bad & Hygiene',
  'Gesundheit',
  'Arbeit',
  'Angeln',
  'Wintersport',
  'Baden & Strand',
  'Draußen & Camping',
  'Sport',
  'Kinder',
  'Unterwegs',
  'Vor der Abfahrt',
  'Sonstiges',
];
