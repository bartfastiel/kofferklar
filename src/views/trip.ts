// A trip's packing list (#/r/<id>): tap a line to pack it. Essentials are marked, optional things are quieter, every
// line says why it is there. „Etwas fehlt?“ teaches the list for next time.
import { tagLabel } from '../data/questions.ts';
import type { Trip } from '../data/types.ts';
import { go, link } from '../nav.ts';
import { plan, progress, tagsOf, type Line } from '../plan.ts';
import { deleteTrip, items, saveTrip, trip } from '../state.ts';
import { clear, confirmButton, h, toast } from '../ui/dom.ts';

const HIDE_KEY = 'kofferklar.hidePacked';

function hidePacked(): boolean {
  try {
    return localStorage.getItem(HIDE_KEY) === '1';
  } catch {
    return false;
  }
}

export function tripView(root: HTMLElement, id: string): void {
  const t0 = trip(id);
  if (!t0) return void root.appendChild(h('p', { class: 'empty' }, 'Diese Reise gibt es nicht mehr.', h('br'), h('a', { href: '#/' }, 'Zur Übersicht')));
  let t: Trip = t0;
  let hide = hidePacked();
  const head = h('div', { class: 'trip-head' });
  const listBox = h('div', { class: 'list' });
  root.append(head, listBox);

  const save = (next: Trip) => {
    t = next;
    void saveTrip(next);
  };

  function renderHead(): void {
    clear(head);
    const sections = plan(items(), t);
    const p = progress(sections);
    const tags = Array.from(tagsOf(t.answers)).filter((x) => x !== 'nacht' && x !== 'lang' && x !== 'ausland');
    head.append(
      h(
        'a',
        { class: 'summary', href: link('answers', t.id), 'aria-label': 'Angaben ändern' },
        tags.map((x) => h('span', { class: 'tag' }, tagLabel(x))),
        h('span', { class: 'tag edit' }, 'ändern'),
      ),
      h('progress', { class: 'packed', max: Math.max(1, p.total), value: p.done, 'aria-label': 'Eingepackt' }),
      h(
        'p',
        { class: 'progress-text', role: 'status' },
        p.total && p.done === p.total ? 'Alles eingepackt – gute Reise!' : `${p.done} von ${p.total} eingepackt`,
        p.missingEssential ? h('strong', { class: 'essential-left' }, ` · ${p.missingEssential} unverzichtbar offen`) : null,
      ),
      h(
        'label',
        { class: 'switch' },
        h('input', {
          type: 'checkbox',
          checked: hide,
          onchange: (e: Event) => {
            hide = (e.target as HTMLInputElement).checked;
            try {
              localStorage.setItem(HIDE_KEY, hide ? '1' : '0');
            } catch {}
            renderList();
          },
        }),
        'Eingepacktes ausblenden',
      ),
    );
  }

  function row(l: Line): HTMLElement {
    const i = l.item;
    const reason = l.reason.length ? 'wegen ' + l.reason.map(tagLabel).join(' + ') : i.trip ? 'nur diesmal' : '';
    const actions = h('div', { class: 'row-actions', hidden: true });
    const el = h(
      'li',
      { class: 'line p' + i.priority + (l.checked ? ' checked' : '') },
      h(
        'button',
        {
          type: 'button',
          class: 'check',
          role: 'checkbox',
          'aria-checked': String(l.checked),
          onclick: () => {
            const checked = { ...t.checked };
            if (checked[i.id]) delete checked[i.id];
            else checked[i.id] = true;
            save({ ...t, checked });
            l.checked = !!checked[i.id];
            el.classList.toggle('checked', l.checked);
            (el.querySelector('.check') as HTMLElement).setAttribute('aria-checked', String(l.checked));
            renderHead();
            if (hide && l.checked) window.setTimeout(() => el.remove(), 350);
          },
        },
        h('span', { class: 'box', 'aria-hidden': 'true' }),
        h(
          'span',
          { class: 'text' },
          h('span', { class: 'title-line' }, h('span', { class: 'name' }, i.name), l.qty > 1 ? h('span', { class: 'qty' }, ' × ' + l.qty) : null, i.priority === 1 ? h('span', { class: 'must', title: 'unverzichtbar' }, ' !') : null),
          reason || i.note ? h('small', null, [reason, i.note].filter(Boolean).join(' · ')) : null,
        ),
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'more',
          'aria-label': 'Mehr zu ' + i.name,
          'aria-expanded': 'false',
          onclick: (e: Event) => {
            actions.hidden = !actions.hidden;
            (e.currentTarget as HTMLElement).setAttribute('aria-expanded', String(!actions.hidden));
          },
        },
        '⋯',
      ),
      actions,
    );
    actions.append(
      h(
        'button',
        {
          type: 'button',
          class: 'ghost',
          onclick: () => {
            save({ ...t, skipped: { ...t.skipped, [i.id]: true } });
            renderAll();
            toast(i.name + ': diesmal nicht nötig', { label: 'Rückgängig', run: () => unskip(i.id) });
          },
        },
        'Diesmal nicht nötig',
      ),
      h('a', { class: 'button ghost', href: link('item', i.id, 'trip=' + t.id) }, 'Bearbeiten'),
    );
    return el;
  }

  function unskip(itemId: string): void {
    const skipped = { ...t.skipped };
    delete skipped[itemId];
    save({ ...t, skipped });
    renderAll();
  }

  function renderList(): void {
    clear(listBox);
    const sections = plan(items(), t);
    const skipped: Line[] = [];
    for (const s of sections) {
      const lines = s.lines.filter((l) => {
        if (l.skipped) skipped.push(l);
        return !l.skipped && !(hide && l.checked);
      });
      const left = s.lines.filter((l) => !l.skipped && !l.checked).length;
      if (!lines.length) continue;
      listBox.append(h('h2', { class: 'cat' }, s.category, h('span', { class: 'count' }, left ? String(left) : '✓')), h('ul', { class: 'lines' }, lines.map(row)));
    }
    if (hide && !listBox.childNodes.length) listBox.append(h('p', { class: 'empty' }, 'Alles eingepackt.'));
    listBox.append(
      h('a', { class: 'button primary wide add', href: link('add', t.id) }, '+ Etwas fehlt?'),
      h('p', { class: 'muted center' }, 'Was dir unterwegs fehlt, merkt sich Kofferklar für passende Reisen.'),
    );
    if (skipped.length) {
      listBox.append(
        h(
          'details',
          { class: 'skipped' },
          h('summary', null, `Diesmal nicht nötig (${skipped.length})`),
          h(
            'ul',
            { class: 'plain' },
            skipped.map((l) => h('li', null, h('span', null, l.item.name), h('button', { type: 'button', class: 'link', onclick: () => unskip(l.item.id) }, 'wieder aufnehmen'))),
          ),
        ),
      );
    }
    listBox.append(
      h(
        'div',
        { class: 'trip-actions' },
        h(
          'button',
          {
            type: 'button',
            class: 'ghost',
            onclick: () => {
              save({ ...t, done: !t.done });
              if (!t.done) renderAll();
              else go('home');
            },
          },
          t.done ? 'Reise wieder öffnen' : 'Reise abschließen',
        ),
        confirmButton('Reise löschen', 'Wirklich löschen?', () => void deleteTrip(t.id).then(() => go('home'))),
      ),
    );
  }

  function renderAll(): void {
    renderHead();
    renderList();
  }

  renderAll();
}
