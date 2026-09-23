/**
 * Sanitises a post-login "return to" path.
 *
 * Only same-origin, absolute app paths are allowed. Protocol-relative URLs
 * ("//evil.example"), backslash tricks ("/\evil.example" — the react-router
 * open-redirect CVE class) and anything with a scheme are rejected and fall
 * back to the dashboard. Defence in depth on top of the patched router.
 */
export function safeRedirect(target: unknown, fallback = '/app'): string {
  if (typeof target !== 'string') return fallback;
  if (!target.startsWith('/')) return fallback;
  if (target.startsWith('//') || target.includes('\\')) return fallback;
  if (/^\/[^/]*:/.test(target) || /[\u0000-\u001f]/.test(target)) return fallback;
  if (target.startsWith('/signin') || target.startsWith('/signup')) return fallback;
  return target;
}
