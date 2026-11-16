// The configurator: one question per screen, then the title. New trip (#/neu) or changing a trip's answers
// (#/fragen/<id>) – the list follows the answers, what is packed stays packed.
import { KINDS, QUESTIONS, tagLabel, type Question } from '../data/questions.ts';
import type { Answers } from '../data/types.ts';
import { go } from '../nav.ts';
import { defaultTitle, tagsOf } from '../plan.ts';
import { createTrip, saveTrip, trip } from '../state.ts';
import { chips } from '../ui/chips.ts';
import { add, clear, h } from '../ui/dom.ts';

type Step = { id: 'kind' } | { id: 'nights' } | { id: 'q'; q: Question } | { id: 'done' };

export function wizardView(root: HTMLElement, tripId: string): void {
  const existing = tripId ? trip(tripId) : undefined;
  if (tripId && !existing) return void root.appendChild(h('p', { class: 'empty' }, 'Diese Reise gibt es nicht mehr.'));
  const a: Answers = existing ? JSON.parse(JSON.stringify(existing.answers)) : { kind: '', nights: 1, pick: {} };
  let title = existing ? existing.title : '';
  let titleTouched = !!existing && existing.title !== defaultTitle(existing.answers, tagLabel);
  let start = existing ? existing.start || '' : '';
  let index = 0;

  const steps = (): Step[] => {
    const tags = tagsOf(a);
    return [{ id: 'kind' }, { id: 'nights' }, ...QUESTIONS.filter((q) => !q.when || q.when(tags)).map((q) => ({ id: 'q' as const, q })), { id: 'done' }];
  };

  const next = () => {
    index = Math.min(index + 1, steps().length - 1);
    render();
  };

  function nav(canGo: boolean): HTMLElement {
    return h(
      'div',
      { class: 'wizard-nav' },
      index > 0 ? h('button', { type: 'button', class: 'ghost', onclick: () => ((index -= 1), render()) }, 'Zurück') : h('span'),
      h('button', { type: 'button', class: 'primary', disabled: !canGo, onclick: next }, 'Weiter'),
    );
  }

  function render(): void {
    clear(root);
    const all = steps();
    const step = all[index];
    root.appendChild(h('progress', { class: 'steps', max: all.length, value: index + 1, 'aria-label': `Frage ${index + 1} von ${all.length}` }));
    const box = h('section', { class: 'wizard' });
    root.appendChild(box);
    if (step.id === 'kind') {
      box.append(
        h('h2', null, 'Was steht an?'),
        chips('Art der Reise', KINDS, a.kind ? [a.kind] : [], false, (sel) => {
          a.kind = sel[0] || '';
          if (a.kind === 'dienstreise' && !a.pick.activities) a.pick.activities = ['arbeit'];
          if (a.kind === 'ausflug' && !existing) a.nights = 0;
          if (a.kind) next();
          else render();
        }),
        nav(!!a.kind),
      );
    } else if (step.id === 'nights') {
      const value = h('output', { class: 'nights-value', 'aria-live': 'polite' });
      const show = () => (value.textContent = a.nights === 0 ? 'Ohne Übernachtung' : a.nights === 1 ? '1 Nacht' : a.nights + ' Nächte');
      show();
      const set = (n: number) => {
        a.nights = Math.max(0, Math.min(60, n));
        show();
      };
      box.append(
        h('h2', null, 'Wie viele Nächte?'),
        h(
          'div',
          { class: 'stepper' },
          h('button', { type: 'button', class: 'round', 'aria-label': 'Eine Nacht weniger', onclick: () => set(a.nights - 1) }, '−'),
          value,
          h('button', { type: 'button', class: 'round', 'aria-label': 'Eine Nacht mehr', onclick: () => set(a.nights + 1) }, '+'),
        ),
        h(
          'div',
          { class: 'quick' },
          [0, 1, 2, 3, 7, 14].map((n) => h('button', { type: 'button', class: 'chip small', onclick: () => (set(n), next()) }, n === 0 ? 'keine' : String(n))),
        ),
        h('label', { class: 'field' }, 'Erster Tag (optional)', h('input', { type: 'date', value: start, oninput: (e: Event) => (start = (e.target as HTMLInputElement).value) })),
        nav(true),
      );
    } else if (step.id === 'q') {
      const q = step.q;
      add(
        box,
        h('h2', null, q.title),
        q.type === 'many' ? h('p', { class: 'muted' }, 'Alles Zutreffende antippen – oder nichts.') : null,
        chips(q.title, q.options, a.pick[q.id] || [], q.type === 'many', (sel) => {
          a.pick[q.id] = sel;
          if (q.type === 'one' && sel.length) next();
        }),
        nav(true),
      );
    } else {
      if (!titleTouched) title = defaultTitle(a, tagLabel);
      const input = h('input', {
        type: 'text',
        value: title,
        maxlength: 80,
        oninput: (e: Event) => {
          title = (e.target as HTMLInputElement).value;
          titleTouched = true;
        },
      });
      const chosen = Array.from(tagsOf(a)).filter((t) => t !== 'nacht' && t !== 'lang' && t !== 'ausland');
      box.append(
        h('h2', null, existing ? 'Angaben übernehmen' : 'Fertig – deine Packliste'),
        h('label', { class: 'field' }, 'Name der Reise', input),
        h('p', { class: 'summary' }, chosen.map((t) => h('span', { class: 'tag' }, tagLabel(t)))),
        h(
          'div',
          { class: 'wizard-nav' },
          h('button', { type: 'button', class: 'ghost', onclick: () => ((index -= 1), render()) }, 'Zurück'),
          h('button', { type: 'button', class: 'primary', onclick: () => void finish() }, existing ? 'Übernehmen' : 'Packliste zeigen'),
        ),
      );
    }
  }

  async function finish(): Promise<void> {
    // answers for questions that are no longer asked (e.g. accommodation without a night) are dropped
    const asked = new Set(steps().filter((s) => s.id === 'q').map((s) => (s as { q: Question }).q.id));
    for (const k of Object.keys(a.pick)) if (!asked.has(k) || !a.pick[k].length) delete a.pick[k];
    const name = title.trim() || defaultTitle(a, tagLabel);
    if (existing) {
      const t = { ...existing, title: name, answers: a };
      if (start) t.start = start;
      else delete t.start;
      await saveTrip(t);
      go('trip', existing.id);
    } else go('trip', await createTrip(name, a, start || undefined));
  }

  render();
}
