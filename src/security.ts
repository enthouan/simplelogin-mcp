/**
 * @module security
 * Pure, side-effect-free predicates that decide whether an HTTP bind address or a
 * request Origin is safe. Kept apart from config/transport wiring so the security
 * decisions are trivially unit-testable in isolation.
 */

/**
 * Is `host` a loopback bind address, reachable only from the local machine?
 * Covers `localhost`, the entire `127.0.0.0/8` block, and IPv6 `::1` (with or
 * without brackets). Wildcards (`0.0.0.0`, `::`) are NOT loopback: they bind every
 * interface and therefore expose the server to the LAN / internet.
 */
export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (h === 'localhost' || h === '::1') return true;
  return /^127(?:\.\d{1,3}){3}$/.test(h);
}

/**
 * Is `origin` allowed to drive `POST /mcp`? Used to defend a loopback-bound server
 * against DNS-rebinding / CSRF from a malicious web page: a browser always sends an
 * `Origin` header, and an attacker page's origin (e.g. `https://evil.com`) will not
 * match. Loopback origins are trusted by default so local tooling (the MCP Inspector,
 * a localhost web client on another port) keeps working; operators can allow extra
 * origins via `MCP_ALLOWED_ORIGINS`. Non-browser MCP clients send no Origin at all;
 * those are handled by the caller, which only consults this for a present Origin.
 */
export function isAllowedOrigin(origin: string, allowedOrigins: string[]): boolean {
  if (allowedOrigins.includes(origin)) return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  return isLoopbackHost(url.hostname);
}
