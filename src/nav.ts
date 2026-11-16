// Navigation through the hash (#/r/<id>), so the app runs under any path (also in previews).
export type Route = 'home' | 'new' | 'trip' | 'answers' | 'add' | 'items' | 'item' | 'settings';

export interface Place {
  route: Route;
  id: string;
  params: URLSearchParams;
}

const PATHS: Record<string, Route> = { neu: 'new', r: 'trip', fragen: 'answers', fehlt: 'add', dinge: 'items', ding: 'item', einstellungen: 'settings' };

export function current(): Place {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query] = raw.split('?');
  const [head, id] = path.split('/');
  return { route: PATHS[head] || 'home', id: decodeURIComponent(id || ''), params: new URLSearchParams(query || '') };
}

export function link(route: Route, id?: string, query?: string): string {
  const head = route === 'home' ? '' : (Object.keys(PATHS).find((k) => PATHS[k] === route) as string);
  return '#/' + head + (id ? '/' + encodeURIComponent(id) : '') + (query ? '?' + query : '');
}

export function go(route: Route, id?: string, query?: string): void {
  location.hash = link(route, id, query);
}
