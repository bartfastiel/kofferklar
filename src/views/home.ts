// Overview (#/): start a new trip, open trips first, finished ones below.
import type { Trip } from '../data/types.ts';
import { link } from '../nav.ts';
import { plan, progress } from '../plan.ts';
import { items, trips } from '../state.ts';
import { add, fmtDate, h } from '../ui/dom.ts';

function card(t: Trip): HTMLElement {
  const p = progress(plan(items(), t));
  return h(
    'li',
    null,
    h(
      'a',
      { class: 'trip-card' + (t.done ? ' done' : ''), href: link('trip', t.id) },
      h('span', { class: 'name' }, t.title),
      h('small', null, [t.start ? fmtDate(Date.parse(t.start + 'T12:00:00')) : '', t.done ? 'abgeschlossen' : `${p.done} von ${p.total} eingepackt`].filter(Boolean).join(' · ')),
      t.done ? null : h('progress', { max: Math.max(1, p.total), value: p.done, 'aria-hidden': 'true' }),
    ),
  );
}

export function homeView(root: HTMLElement): void {
  const open = trips().filter((t) => !t.done);
  const done = trips().filter((t) => t.done);
  add(root,
    h('a', { class: 'button primary wide big', href: link('new') }, '+ Neue Reise packen'),
    open.length ? h('section', null, h('h2', { class: 'cat' }, 'Offen'), h('ul', { class: 'cards' }, open.map(card))) : h('p', { class: 'empty' }, 'Noch keine Reise. Ein paar Fragen, dann steht deine Packliste.'),
    done.length ? h('details', { class: 'done-trips' }, h('summary', null, `Abgeschlossen (${done.length})`), h('ul', { class: 'cards' }, done.map(card))) : null,
    h('a', { class: 'button ghost wide', href: link('items') }, `Alle Gegenstände (${items().filter((i) => !i.trip).length})`),
  );
}
