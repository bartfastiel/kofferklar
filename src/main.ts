// Entry: header, page per route, sync, service worker.
import { current, link } from './nav.ts';
import { item, reload, seedLocal, trip } from './state.ts';
import { initSync, onStatus, syncInfo } from './sync.ts';
import { clear, h } from './ui/dom.ts';
import { homeView } from './views/home.ts';
import { addView, itemView } from './views/item.ts';
import { itemsView } from './views/items.ts';
import { settingsView } from './views/settings.ts';
import { tripView } from './views/trip.ts';
import { wizardView } from './views/wizard.ts';

const main = document.getElementById('main') as HTMLElement;
const top = document.getElementById('top') as HTMLElement;

function title(): string {
  const { route, id, params } = current();
  if (route === 'add') return 'Etwas fehlt';
  if (route === 'trip' || route === 'answers') {
    const t = trip(id);
    return t ? t.title : '';
  }
  if (route === 'new') return 'Neue Reise';
  if (route === 'items') return 'Gegenstände';
  if (route === 'item') return id ? (item(id) || { name: '' }).name : params.get('trip') ? 'Etwas fehlt' : 'Neuer Gegenstand';
  if (route === 'settings') return 'Einstellungen';
  return '';
}

function back(): string {
  const { route, id, params } = current();
  if (route === 'answers' || route === 'add') return link('trip', id);
  if (route === 'item') return params.get('trip') ? link('trip', params.get('trip') as string) : link('items');
  return '#/';
}

function header(): void {
  const { route } = current();
  clear(top);
  const info = syncInfo();
  // green: in sync with the server; grey: offline or not yet – everything saved on the device still works
  const live = !info.lastError && !!info.lastSync;
  const label = live ? 'Verbunden' : 'Offline – alles Gespeicherte ist da';
  if (route === 'home') top.appendChild(h('a', { class: 'brand', href: '#/' }, h('img', { src: 'icon.svg', alt: '', width: 30, height: 30 }), 'Kofferklar'));
  else {
    top.appendChild(h('a', { class: 'icon-btn back', href: back(), 'aria-label': 'Zurück' }, '‹'));
    top.appendChild(h(route === 'trip' ? 'h1' : 'span', { class: 'title' }, title()));
  }
  top.appendChild(h('span', { class: 'sync-dot' + (live ? ' ok' : ''), title: label, role: 'img', 'aria-label': label }));
  top.appendChild(h('a', { class: 'icon-btn', href: link('settings'), 'aria-label': 'Einstellungen' }, '⚙'));
}

function show(): void {
  const place = current();
  clear(main);
  header();
  document.body.dataset.route = place.route;
  if (place.route === 'new' || place.route === 'answers') wizardView(main, place.route === 'answers' ? place.id : '');
  else if (place.route === 'trip') tripView(main, place.id);
  else if (place.route === 'add') addView(main, place.id);
  else if (place.route === 'items') itemsView(main);
  else if (place.route === 'item') itemView(main, place.id, place.params);
  else if (place.route === 'settings') settingsView(main);
  else homeView(main);
  window.scrollTo(0, 0);
}

// after a sync: redraw overviews only, never in the middle of the configurator or a form (and never while typing)
const refresh = () =>
  void reload().then(() => {
    const { route } = current();
    const a = document.activeElement;
    const typing = a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT');
    if ((route === 'home' || route === 'items' || route === 'trip') && !typing) {
      const y = window.scrollY;
      show();
      window.scrollTo(0, y);
    }
  });

onStatus(header);
window.addEventListener('hashchange', show);

initSync(refresh)
  .then(() => seedLocal())
  .then(() => reload())
  .then(show)
  .catch((err) => {
    main.textContent = 'Der lokale Speicher ist nicht verfügbar (privates Fenster?): ' + String(err && err.message ? err.message : err);
  });

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => undefined);
}
