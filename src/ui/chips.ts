// Chips: tap to choose; one (radio) or many (toggle). Big tap targets for the configurator.
import { tagLabel, type Option } from '../data/questions.ts';
import type { Item } from '../data/types.ts';
import { clear, h } from './dom.ts';

export function chips(label: string, options: Option[], selected: string[], multi: boolean, onChange: (sel: string[]) => void): HTMLElement {
  const box = h('div', { class: 'chips', role: multi ? 'group' : 'radiogroup', 'aria-label': label });
  let sel = selected.slice();
  const render = () => {
    clear(box);
    for (const o of options) {
      const on = sel.indexOf(o.tag) >= 0;
      box.appendChild(
        h(
          'button',
          {
            type: 'button',
            class: 'chip' + (on ? ' on' : ''),
            role: multi ? null : 'radio',
            'aria-pressed': multi ? String(on) : null,
            'aria-checked': multi ? null : String(on),
            'data-tag': o.tag,
            onclick: () => {
              if (multi) sel = on ? sel.filter((t) => t !== o.tag) : sel.concat(o.tag);
              else sel = on ? [] : [o.tag];
              render();
              onChange(sel);
            },
          },
          h('span', null, o.label),
          o.hint ? h('small', null, o.hint) : null,
        ),
      );
    }
  };
  render();
  return box;
}

/** „bei Angeln oder Zelt + Flugzeug · außer Nur Handgepäck“ */
export function describeWhen(i: Pick<Item, 'when' | 'unless' | 'trip'>): string {
  if (i.trip) return 'nur für eine Reise';
  const when = i.when.length ? 'bei ' + i.when.map((g) => g.map(tagLabel).join(' + ')).join(' oder ') : 'bei jeder Reise';
  return when + (i.unless.length ? ' · außer ' + i.unless.map(tagLabel).join(', ') : '');
}
