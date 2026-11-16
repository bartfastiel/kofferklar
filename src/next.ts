// Where the sign-in page may send someone afterwards.
/** only a path on this site (no other host, also not via „/\host“ or control characters), never back to /login */
export function safeNext(v: string | null, origin: string): string {
  if (!v || v.charAt(0) !== '/' || /[\\\u0000-\u001f]/.test(v)) return '/';
  try {
    const u = new URL(v, origin);
    const path = u.pathname + u.search + u.hash;
    // dot segments can normalise to a path starting with „//“, which the browser reads as another host
    if (u.origin !== origin || u.pathname.indexOf('/login') === 0 || path.charAt(1) === '/' || new URL(path, origin).origin !== origin) return '/';
    return path;
  } catch {
    return '/';
  }
}
