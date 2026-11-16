// Settings (#/einstellungen): account, another device, import and export of the list as text, sign out.
import { formatList, parseList } from '../data/listformat.ts';
import { byCategory } from '../plan.ts';
import { importItems, items } from '../state.ts';
import { account, currentMode, logout, post, rename, syncInfo } from '../sync.ts';
import { clear, fmtDateTime, h, toast } from '../ui/dom.ts';

async function copy(text: string, what: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast(what + ' kopiert');
  } catch {
    toast('Kopieren nicht möglich – bitte von Hand markieren');
  }
}

export function settingsView(root: HTMLElement): void {
  const me = account();
  const mode = currentMode();
  if (mode === 'server' && me) {
    const nameInput = h('input', { type: 'text', value: me.user.name, maxlength: 40 });
    const linkBox = h('div');
    root.append(
      h(
        'section',
        { class: 'card' },
        h('h2', null, 'Konto'),
        h('label', { class: 'field' }, 'Name', nameInput),
        h('button', { type: 'button', class: 'ghost', onclick: () => void rename(nameInput.value.trim()).then((ok) => toast(ok ? 'Name gespeichert' : 'Nicht gespeichert')) }, 'Name speichern'),
        h('h3', null, 'Weiteres Gerät'),
        h('p', { class: 'muted' }, 'Ein Link, mit dem du auf einem anderen Gerät einen Passkey einrichtest. Einmal gültig, 14 Tage lang.'),
        h(
          'button',
          {
            type: 'button',
            class: 'ghost',
            onclick: async () => {
              const res = await post('/api/invites', { user_id: me.user.id, role: me.user.role });
              const data = await res.json().catch(() => ({}));
              clear(linkBox);
              if (!res.ok) return void linkBox.append(h('p', { class: 'hint' }, (data.error && data.error.message) || 'Nicht möglich.'));
              linkBox.append(h('input', { type: 'text', readonly: true, value: data.link, class: 'mono' }), h('button', { type: 'button', class: 'ghost', onclick: () => void copy(data.link, 'Link') }, 'Link kopieren'));
            },
          },
          'Link erzeugen',
        ),
        linkBox,
        h('button', { type: 'button', class: 'danger', onclick: () => void logout() }, 'Abmelden'),
      ),
    );
  } else {
    root.append(h('p', { class: 'notice' }, mode === 'preview' ? 'Vorschau: eigene Testdaten, kein Abgleich.' : 'Lokaler Modus: Daten nur auf diesem Gerät.'));
  }

  const area = h('textarea', { rows: 8, class: 'mono', placeholder: '# Angeln\nSturmfeuerzeug | 2 | angeln | flug\nKöderbox | 1 | angeln' });
  const result = h('div', { role: 'status', 'aria-live': 'polite' });
  root.append(
    h(
      'section',
      { class: 'card' },
      h('h2', null, 'Liste als Text'),
      h('p', { class: 'muted' }, 'Eine Zeile je Gegenstand: Name | Priorität 1–3 | wenn | außer | Menge | Notiz. Kategorien mit „#“. Neue Namen kommen dazu, vorhandene bleiben, wie sie sind.'),
      area,
      h(
        'div',
        { class: 'form-actions' },
        h(
          'button',
          {
            type: 'button',
            class: 'ghost',
            onclick: () => {
              const list = items()
                .filter((i) => !i.trip)
                .sort((a, b) => byCategory(a.category, b.category) || a.priority - b.priority || a.name.localeCompare(b.name, 'de'));
              void copy(formatList(list), 'Liste');
            },
          },
          'Ganze Liste kopieren',
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'primary',
            onclick: async () => {
              const r = parseList(area.value);
              clear(result);
              if (r.errors.length) return void result.append(h('p', { class: 'hint' }, r.errors.join(' · ')));
              const n = await importItems(r.items);
              result.append(h('p', null, `${n} neu, ${r.items.length - n} schon vorhanden.`));
              if (n) area.value = '';
            },
          },
          'Übernehmen',
        ),
      ),
      result,
    ),
  );
  const info = syncInfo();
  root.append(
    h(
      'p',
      { class: 'muted center' },
      'Kofferklar ' + (document.documentElement.dataset.version || ''),
      info.lastSync ? h('br') : null,
      info.lastSync ? 'Abgeglichen ' + fmtDateTime(info.lastSync) : null,
    ),
  );
}
