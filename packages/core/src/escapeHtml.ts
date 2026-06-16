//? Canonical HTML-escaping helper. Several packages (docs-ui's rendered HTML,
//? email's layout renderer) each carried their own copy with the same five
//? entity mappings — this is the single source of truth they migrate to so
//? the escaping convention can't drift between surfaces.
//?
//? Escapes the five characters that are unsafe in HTML text/attribute
//? contexts: `&`, `<`, `>`, `"`, `'`. `&` is replaced first so the ampersands
//? introduced by the other replacements are not double-escaped.

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escape `&`, `<`, `>`, `"`, `'` for safe interpolation into HTML text nodes
 * and quoted attribute values. Does NOT protect against CSS/JS/URL-context
 * injection — use a dedicated sanitizer for those contexts.
 */
export const escapeHtml = (str: string): string =>
  str.replaceAll(/[&<>"']/g, (c) => HTML_ESCAPE_MAP[c] ?? c);
