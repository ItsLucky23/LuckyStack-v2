//? `{{token}}` substitution for batch mail (ADR 0070). Deliberately not a
//? template language: no conditionals, loops or nested lookups. Projects that
//? need logic register an `EmailTemplate` and pass `data` instead.

export type TokenValue = string | number | boolean | bigint | null | undefined;
export type TokenValues = Readonly<Record<string, TokenValue>>;

export interface RenderTokensOptions {
  /**
   * `'html'` (default) escapes `& < > " '` in substituted values. Use `'none'`
   * for plain-text targets such as a subject line or the text body.
   */
  escape?: 'html' | 'none';
}

//? Spaces/tabs inside the braces are tolerated; newlines are not, so a token
//? cannot span lines. Names allow Unicode letters and digits plus `_ . -`.
const TOKEN_PATTERN = /\{\{[ \t]*([\p{L}\p{N}_.-]+)[ \t]*\}\}/gu;

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

/**
 * Replace `{{name}}` with `values.name`, exact key first, then
 * case-insensitive. A missing key, or one whose value is `null`/`undefined`,
 * leaves the token literally in the output so a gap in the data is visible in
 * the sent mail instead of silently blank; an empty string renders empty.
 * Substitution is a single pass, so a value that itself contains `{{…}}` is
 * never expanded.
 */
export const renderTokens = (
  template: string,
  values: TokenValues,
  options: RenderTokensOptions = {},
): string => {
  const escape = options.escape ?? 'html';
  //? Own keys only: `in` would also resolve `{{constructor}}` or
  //? `{{toString}}` to Object.prototype members and leak them into the mail.
  const lowerIndex = new Map<string, string>();
  for (const key of Object.keys(values)) {
    const lower = key.toLowerCase();
    if (!lowerIndex.has(lower)) lowerIndex.set(lower, key);
  }

  return template.replaceAll(TOKEN_PATTERN, (match, name: string) => {
    const key = Object.hasOwn(values, name) ? name : lowerIndex.get(name.toLowerCase());
    const value = key === undefined ? undefined : values[key];
    if (value === null || value === undefined) return match;
    const text = String(value);
    return escape === 'html' ? escapeHtml(text) : text;
  });
};
