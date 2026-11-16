// Every item (#/dinge): search, by category, with the conditions in words. Tap to edit.
import { link } from '../nav.ts';
import { byCategory } from '../plan.ts';
import { items } from '../state.ts';
import { describeWhen } from '../ui/chips.ts';
import { clear, h } from '../ui/dom.ts';

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function itemsView(root: HTMLElement): void {
  const list = h('div', { class: 'list' });
  let query = '';
  const render = () => {
    clear(list);
    const q = fold(query.trim());
    const shown = items()
      .filter((i) => !i.trip && (!q || fold(i.name + ' ' + i.category + ' ' + (i.note || '')).indexOf(q) >= 0))
      .sort((a, b) => byCategory(a.category, b.category) || a.priority - b.priority || a.name.localeCompare(b.name, 'de'));
    let cat = '';
    let ul: HTMLElement | null = null;
    for (const i of shown) {
      if (i.category !== cat || !ul) {
        cat = i.category;
        ul = h('ul', { class: 'lines' });
        list.append(h('h2', { class: 'cat' }, cat), ul);
      }
      ul.append(
        h(
          'li',
          { class: 'line p' + i.priority },
          h('a', { class: 'check', href: link('item', i.id) }, h('span', { class: 'text' }, h('span', { class: 'title-line' }, h('span', { class: 'name' }, i.name), i.priority === 1 ? h('span', { class: 'must' }, ' !') : null), h('small', null, describeWhen(i)))),
        ),
      );
    }
    if (!shown.length) list.append(h('p', { class: 'empty' }, 'Nichts gefunden.'));
  };
  root.append(
    h('input', { type: 'search', class: 'search', placeholder: 'Suchen …', 'aria-label': 'Gegenstände durchsuchen', oninput: (e: Event) => ((query = (e.target as HTMLInputElement).value), render()) }),
    h('a', { class: 'button primary wide', href: link('item') }, '+ Neuer Gegenstand'),
    list,
  );
  render();
}
