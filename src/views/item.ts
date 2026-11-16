// Adding what was missing on a trip (#/fehlt/<trip>) and editing an item (#/ding/<id>, new: #/ding).
// Adding asks one thing beyond the name: for which trips it should come up in future – the tags of this trip are
// offered, so „Sturmfeuerzeug“ on a fishing trip becomes „bei Angeln“.
import { CATEGORIES, tagGroups, tagLabel } from '../data/questions.ts';
import type { Item, Priority, Quantity } from '../data/types.ts';
import { go, link } from '../nav.ts';
import { byCategory, matches, tagsOf } from '../plan.ts';
import { deleteItem, item, items, newItem, saveItem, saveTrip, trip } from '../state.ts';
import { chips, describeWhen } from '../ui/chips.ts';
import { clear, confirmButton, h, segmented, toast } from '../ui/dom.ts';

const PRIOS: { value: string; label: string }[] = [
  { value: '1', label: 'Unverzichtbar' },
  { value: '2', label: 'Wichtig' },
  { value: '3', label: 'Optional' },
];

function categories(): string[] {
  const all = CATEGORIES.slice();
  for (const i of items()) if (all.indexOf(i.category) < 0) all.push(i.category);
  return all.sort(byCategory);
}

function categoryField(value: string, onChange: (v: string) => void): HTMLElement {
  const listId = 'cats';
  return h(
    'label',
    { class: 'field' },
    'Kategorie',
    h('input', { type: 'text', list: listId, value, maxlength: 40, oninput: (e: Event) => onChange((e.target as HTMLInputElement).value) }),
    h('datalist', { id: listId }, categories().map((c) => h('option', { value: c }))),
  );
}

/** quantity: once, per day or per night, with „one per n“, extra and maximum */
function quantityField(q: Quantity | undefined, onChange: (q: Quantity | undefined) => void): HTMLElement {
  let cur = q ? { ...q } : undefined;
  const extra = h('div', { class: 'qty-fields' });
  const num = (label: string, key: 'every' | 'add' | 'max') =>
    h(
      'label',
      { class: 'field small' },
      label,
      h('input', {
        type: 'number',
        inputmode: 'numeric',
        min: 0,
        max: 99,
        value: cur && cur[key] ? cur[key] : '',
        oninput: (e: Event) => {
          if (!cur) return;
          const v = Number((e.target as HTMLInputElement).value);
          if (v > 0) cur[key] = v;
          else delete cur[key];
          onChange(cur);
        },
      }),
    );
  const render = () => {
    clear(extra);
    if (cur) extra.append(num('je … Tage eins', 'every'), num('extra', 'add'), num('höchstens', 'max'));
  };
  render();
  return h(
    'div',
    { class: 'field' },
    h('span', null, 'Menge'),
    segmented(
      'Menge',
      [
        { value: 'once', label: 'Einmal' },
        { value: 'day', label: 'Je Tag' },
        { value: 'night', label: 'Je Nacht' },
      ],
      cur ? cur.per : 'once',
      (v) => {
        cur = v === 'day' || v === 'night' ? { ...(cur || {}), per: v } : undefined;
        render();
        onChange(cur);
      },
      false,
    ),
    extra,
  );
}

function unlessField(selected: string[], onChange: (sel: string[]) => void): HTMLElement {
  return h(
    'details',
    { class: 'field', open: selected.length > 0 },
    h('summary', null, 'Außer bei …' + (selected.length ? ' (' + selected.map(tagLabel).join(', ') + ')' : '')),
    h('p', { class: 'muted' }, 'Nie vorschlagen, wenn eines davon zutrifft – z. B. Sturmfeuerzeug außer bei Flugzeug.'),
    tagGroups().map((g) => h('div', { class: 'tag-group' }, h('h3', null, g.title), chips(g.title, g.options, selected, true, onChange))),
  );
}

export function addView(root: HTMLElement, tripId: string): void {
  const t = trip(tripId);
  if (!t) return void root.appendChild(h('p', { class: 'empty' }, 'Diese Reise gibt es nicht mehr.'));
  const tags = tagsOf(t.answers);
  const tripTags = Array.from(tags);
  const acts = t.answers.pick.activities || [];
  let name = '';
  let category = 'Sonstiges';
  let priority: Priority = 2;
  let mode: 'match' | 'always' | 'once' = 'match';
  let group: string[] = acts.length === 1 ? acts.slice() : [];
  let unless: string[] = [];
  let qty: Quantity | undefined;
  const status = h('p', { class: 'hint', role: 'status', 'aria-live': 'polite' });
  const modeBox = h('div');

  const nameInput = h('input', {
    type: 'text',
    list: 'known',
    maxlength: 80,
    required: true,
    autocomplete: 'off',
    oninput: (e: Event) => {
      name = (e.target as HTMLInputElement).value;
      const known = items().find((i) => !i.trip && i.name.toLowerCase() === name.trim().toLowerCase());
      if (known) {
        category = known.category;
        catInput.value = known.category;
        status.textContent = matches(known, tags)
          ? `„${known.name}“ steht schon auf dieser Liste.`
          : `„${known.name}“ kennt Kofferklar schon (${describeWhen(known)}). Speichern ergänzt die gewählten Merkmale.`;
      } else status.textContent = '';
    },
  });
  const catField = categoryField(category, (v) => (category = v));
  const catInput = catField.querySelector('input') as HTMLInputElement;

  const renderMode = () => {
    clear(modeBox);
    if (mode !== 'match') return;
    modeBox.append(
      h('p', { class: 'muted' }, 'Tippe an, weshalb du es brauchst. Bei mehreren müssen alle zutreffen.'),
      chips(
        'Merkmale dieser Reise',
        tripTags.map((x) => ({ tag: x, label: tagLabel(x) })),
        group,
        true,
        (sel) => (group = sel),
      ),
      unlessField(unless, (sel) => (unless = sel)),
    );
  };
  renderMode();

  async function submit(): Promise<void> {
    const n = name.trim();
    if (!n) return void (status.textContent = 'Bitte einen Namen eingeben.'), nameInput.focus();
    if (mode === 'match' && !group.length) return void (status.textContent = 'Bitte mindestens ein Merkmal antippen – oder „Bei jeder Reise“ wählen.');
    const when = mode === 'match' ? [group] : [];
    const known = mode === 'once' ? undefined : items().find((i) => !i.trip && i.name.toLowerCase() === n.toLowerCase());
    let saved: Item;
    if (known) {
      const already = known.when.some((g) => g.length === when[0]?.length && g.every((x) => when[0].indexOf(x) >= 0));
      saved = {
        ...known,
        when: mode === 'always' ? [] : known.when.length === 0 || already ? known.when : known.when.concat(when),
        unless: known.unless.filter((u) => !tags.has(u)).concat(unless.filter((u) => known.unless.indexOf(u) < 0)),
      };
    } else {
      saved = newItem({ name: n, category: category.trim() || 'Sonstiges', priority, when, unless: mode === 'match' ? unless : [], ...(qty ? { qty } : {}), ...(mode === 'once' ? { trip: t!.id } : {}) });
    }
    await saveItem(saved);
    // what is added on the spot was usually just packed – or is still missing: leave it open
    const skipped = { ...t!.skipped };
    delete skipped[saved.id];
    await saveTrip({ ...t!, skipped });
    go('trip', t!.id);
    toast(mode === 'once' ? `${n}: nur für diese Reise` : `Gemerkt: ${n} – ${describeWhen(saved)}`);
  }

  root.append(
    h(
      'form',
      {
        class: 'form',
        onsubmit: (e: Event) => {
          e.preventDefault();
          void submit();
        },
      },
      h('label', { class: 'field' }, 'Gegenstand', nameInput, h('datalist', { id: 'known' }, items().filter((i) => !i.trip).map((i) => h('option', { value: i.name })))),
      catField,
      h('div', { class: 'field' }, h('span', null, 'Wie wichtig?'), segmented('Priorität', PRIOS, String(priority), (v) => (priority = Number(v || 2) as Priority), false)),
      h(
        'div',
        { class: 'field' },
        h('span', null, 'Künftig einpacken'),
        segmented(
          'Künftig einpacken',
          [
            { value: 'match', label: 'Bei passenden Reisen' },
            { value: 'always', label: 'Bei jeder Reise' },
            { value: 'once', label: 'Nur diesmal' },
          ],
          mode,
          (v) => {
            mode = (v || 'match') as typeof mode;
            renderMode();
          },
          false,
        ),
        modeBox,
      ),
      h('details', { class: 'field' }, h('summary', null, 'Menge'), quantityField(qty, (q) => (qty = q))),
      status,
      h('div', { class: 'form-actions' }, h('a', { class: 'button ghost', href: link('trip', t.id) }, 'Abbrechen'), h('button', { type: 'submit', class: 'primary' }, 'Speichern')),
    ),
  );
  nameInput.focus();
}

export function itemView(root: HTMLElement, id: string, params: URLSearchParams): void {
  const back = params.get('trip') ? link('trip', params.get('trip') as string) : link('items');
  const existing = id ? item(id) : undefined;
  if (id && !existing) return void root.appendChild(h('p', { class: 'empty' }, 'Diesen Gegenstand gibt es nicht mehr.'));
  const it: Item = existing ? JSON.parse(JSON.stringify(existing)) : newItem({ name: '', category: 'Sonstiges', priority: 2, when: [], unless: [] });
  const status = h('p', { class: 'hint', role: 'status', 'aria-live': 'polite' });
  const whenBox = h('div', { class: 'when' });

  function renderWhen(): void {
    clear(whenBox);
    if (it.trip) {
      const tr = trip(it.trip);
      whenBox.append(
        h('p', null, 'Nur für die Reise „' + (tr ? tr.title : '…') + '“.'),
        h('button', { type: 'button', class: 'ghost', onclick: () => (delete it.trip, renderWhen()) }, 'Künftig auch bei anderen Reisen'),
      );
      return;
    }
    whenBox.append(h('p', { class: 'muted' }, it.when.length ? 'Vorschlagen, wenn eine dieser Zeilen ganz zutrifft:' : 'Wird bei jeder Reise vorgeschlagen.'));
    it.when.forEach((g, gi) => {
      whenBox.append(
        h(
          'div',
          { class: 'when-row' },
          gi > 0 ? h('span', { class: 'or' }, 'oder') : null,
          h('span', { class: 'tags' }, g.map((x) => h('span', { class: 'tag' }, tagLabel(x)))),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Bedingung entfernen', onclick: () => (it.when.splice(gi, 1), renderWhen()) }, '✕'),
        ),
      );
    });
    let draft: string[] = [];
    const picker = h(
      'details',
      { class: 'field' },
      h('summary', null, '+ Bedingung hinzufügen'),
      h('p', { class: 'muted' }, 'Alle gewählten Merkmale müssen zutreffen.'),
      tagGroups().map((gr) => h('div', { class: 'tag-group' }, h('h3', null, gr.title), chips(gr.title, gr.options, [], true, (sel) => {
        draft = draft.filter((x) => !gr.options.some((o) => o.tag === x)).concat(sel);
      }))),
      h('button', { type: 'button', class: 'primary', onclick: () => (draft.length ? (it.when.push(draft), renderWhen()) : undefined) }, 'Hinzufügen'),
    );
    whenBox.append(picker, unlessField(it.unless, (sel) => (it.unless = sel)));
  }
  renderWhen();

  async function submit(): Promise<void> {
    it.name = it.name.trim();
    it.category = it.category.trim() || 'Sonstiges';
    if (!it.name) return void (status.textContent = 'Bitte einen Namen eingeben.');
    if (!it.qty) delete it.qty;
    if (!it.note) delete it.note;
    await saveItem(it);
    location.hash = back;
    toast('Gespeichert: ' + it.name);
  }

  root.append(
    h(
      'form',
      {
        class: 'form',
        onsubmit: (e: Event) => {
          e.preventDefault();
          void submit();
        },
      },
      h('label', { class: 'field' }, 'Gegenstand', h('input', { type: 'text', value: it.name, maxlength: 80, required: true, oninput: (e: Event) => (it.name = (e.target as HTMLInputElement).value) })),
      categoryField(it.category, (v) => (it.category = v)),
      h('div', { class: 'field' }, h('span', null, 'Wie wichtig?'), segmented('Priorität', PRIOS, String(it.priority), (v) => (it.priority = Number(v || 2) as Priority), false)),
      h('div', { class: 'field' }, h('span', null, 'Wann?'), whenBox),
      quantityField(it.qty, (q) => (q ? (it.qty = q) : delete it.qty)),
      h('label', { class: 'field' }, 'Notiz', h('textarea', { rows: 2, maxlength: 300, oninput: (e: Event) => (it.note = (e.target as HTMLTextAreaElement).value.trim()) }, it.note || '')),
      status,
      h('div', { class: 'form-actions' }, h('a', { class: 'button ghost', href: back }, 'Abbrechen'), h('button', { type: 'submit', class: 'primary' }, 'Speichern')),
      existing ? h('div', { class: 'form-actions' }, confirmButton('Gegenstand löschen', 'Wirklich löschen?', () => void deleteItem(it.id).then(() => (location.hash = back)))) : null,
    ),
  );
}
