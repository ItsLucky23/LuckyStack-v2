//? Pure, DOM-free render core for the docs page. Every function here is
//? SELF-CONTAINED — it references no module-level imports, only its own
//? arguments and locally-declared helpers — because the whole module is
//? serialized into the inline browser `<script>` via `Function.prototype
//? .toString()` (see `docsHtml.ts`). That single-source-of-truth strategy is
//? what lets the embedded renderer be unit-tested directly (it was the
//? untested embedded program that let the array-shape + sync-rendering bugs
//? ship). Do NOT add an `import` reference inside any function body here.

//? Browser-runtime escaping. A standalone copy (mirrors core's `escapeHtml`)
//? is required because this code is serialized into the page; it cannot
//? import from `@luckystack/core` at runtime. The TS-side equivalence test
//? guards against drift.
export const docsEscapeHtml = (value: unknown): string =>
  String(value).replaceAll(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] ?? c));

//? UI strings, threaded from the server so an `enabledInProd` portal can be
//? localized without forfeiting the default renderer (Rule 13).
export interface DocsUiStrings {
  tryItOutTitle: string;
  sendButton: string;
  emptyNoDocs: string;
  emptyNoMatches: string;
  filterPlaceholder: string;
  endpointsLabel: string;
  pagesLabel: string;
  authLoginRequired: string;
  authPublic: string;
  rateNoLimit: string;
  rateDefault: string;
  ratePerMin: string;
  syncGroupSuffix: string;
  detailAuth: string;
  detailInput: string;
  detailOutput: string;
  detailStream: string;
  detailOwner: string;
  detailTags: string;
  detailDeprecated: string;
  detailClientInput: string;
  detailServerOutput: string;
  detailClientOutput: string;
  detailServerStream: string;
  detailClientStream: string;
}

export const DEFAULT_DOCS_UI_STRINGS: DocsUiStrings = {
  tryItOutTitle: 'Try it out (live request)',
  sendButton: 'Send',
  emptyNoDocs: 'No API docs available. Run `npm run generateArtifacts` to generate them.',
  emptyNoMatches: 'No matches.',
  filterPlaceholder: 'Filter by route name…',
  endpointsLabel: 'endpoints',
  pagesLabel: 'pages',
  authLoginRequired: 'login required',
  authPublic: 'public',
  rateNoLimit: 'no rate limit',
  rateDefault: 'default rate',
  ratePerMin: '/min',
  syncGroupSuffix: ' (sync)',
  detailAuth: 'auth',
  detailInput: 'input',
  detailOutput: 'output',
  detailStream: 'stream',
  detailOwner: 'owner',
  detailTags: 'tags',
  detailDeprecated: 'deprecated',
  detailClientInput: 'client input',
  detailServerOutput: 'server output',
  detailClientOutput: 'client output',
  detailServerStream: 'server stream',
  detailClientStream: 'client stream',
};

//? Method whitelist. The class on `.method` is constrained to a known verb so
//? a tampered/foreign artifact cannot inject arbitrary class tokens, and the
//? label is always escaped at the call site.
export const KNOWN_HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE'];

export interface DocsApiEntry {
  page?: string;
  name?: string;
  version?: string;
  method?: string;
  rateLimit?: number | false;
  auth?: { login?: boolean; additional?: { key?: string; value?: unknown }[] };
  input?: string;
  output?: string;
  stream?: string;
  meta?: { owner?: string; tags?: unknown[]; deprecated?: unknown };
}

export interface DocsSyncEntry {
  page?: string;
  name?: string;
  version?: string;
  clientInput?: string;
  serverOutput?: string;
  clientOutput?: string;
  serverStream?: string;
  clientStream?: string;
  meta?: { owner?: string; tags?: unknown[]; deprecated?: unknown };
}

//? Render the auth badges for an endpoint. `esc` + `strings` are passed in so
//? the function stays self-contained for `.toString()` serialization.
export const renderDocsAuth = (
  auth: DocsApiEntry['auth'],
  esc: (v: unknown) => string,
  strings: DocsUiStrings,
): string => {
  if (!auth) return '<span class="auth-tag">' + esc(strings.authPublic) + '</span>';
  const tags: string[] = [];
  if (auth.login) tags.push(strings.authLoginRequired);
  if (Array.isArray(auth.additional)) {
    for (const rule of auth.additional) {
      if (rule.key) tags.push(rule.key + (rule.value === undefined ? '' : '=' + JSON.stringify(rule.value)));
    }
  }
  if (tags.length === 0) tags.push(strings.authPublic);
  return tags.map((t) => '<span class="auth-tag">' + esc(t) + '</span>').join('');
};

//? Render one API endpoint row from a FLAT array entry (the real artifact
//? shape: `apis[page]` is `DocsApiEntry[]`). `tryItOut` is the already-built
//? runner markup (empty string when disabled).
export const renderDocsEndpoint = (
  entry: DocsApiEntry,
  isOpen: boolean,
  tryItOut: string,
  esc: (v: unknown) => string,
  strings: DocsUiStrings,
): string => {
  const page = entry.page ?? '';
  const name = entry.name ?? '';
  const version = entry.version ?? '';
  const key = page + '/' + name + '@' + version;
  const rawMethod = (entry.method ?? 'POST').toUpperCase();
  //? Whitelist inlined (NOT a module-level ref) because this function is
  //? serialized standalone into the browser via `.toString()` — a module
  //? const would be a ReferenceError there.
  const methodClass = ['GET', 'POST', 'PUT', 'DELETE'].includes(rawMethod) ? rawMethod : 'POST';
  const rate = entry.rateLimit;
  let rateLabel: string;
  if (rate === false) rateLabel = strings.rateNoLimit;
  else if (rate === undefined) rateLabel = strings.rateDefault;
  else rateLabel = rate + strings.ratePerMin;
  const path = '/api/' + page + '/' + name + '/' + version;
  const meta = entry.meta;
  return (
    '<div class="endpoint ' + (isOpen ? 'open' : '') + '" data-key="' + esc(key) + '">' +
      '<div class="endpoint-summary">' +
        '<span class="method ' + methodClass + '">' + esc(rawMethod) + '</span>' +
        '<span class="endpoint-name">' + esc(path) + '</span>' +
        '<span class="endpoint-meta">' + esc(rateLabel) + '</span>' +
      '</div>' +
      '<div class="endpoint-detail">' +
        '<div class="detail-section"><div class="detail-label">' + esc(strings.detailAuth) + '</div><div>' + renderDocsAuth(entry.auth, esc, strings) + '</div></div>' +
        '<div class="detail-section"><div class="detail-label">' + esc(strings.detailInput) + '</div><pre>' + esc(entry.input ?? '{}') + '</pre></div>' +
        '<div class="detail-section"><div class="detail-label">' + esc(strings.detailOutput) + '</div><pre>' + esc(entry.output ?? 'unknown') + '</pre></div>' +
        (entry.stream && entry.stream !== 'never'
          ? '<div class="detail-section"><div class="detail-label">' + esc(strings.detailStream) + '</div><pre>' + esc(entry.stream) + '</pre></div>'
          : '') +
        (meta?.owner
          ? '<div class="detail-section"><div class="detail-label">' + esc(strings.detailOwner) + '</div><div>' + esc(meta.owner) + '</div></div>'
          : '') +
        (meta && Array.isArray(meta.tags) && meta.tags.length > 0
          ? '<div class="detail-section"><div class="detail-label">' + esc(strings.detailTags) + '</div><div>' + meta.tags.map((t) => '<span class="badge">' + esc(t) + '</span>').join(' ') + '</div></div>'
          : '') +
        (meta?.deprecated
          ? '<div class="detail-section"><div class="detail-label">' + esc(strings.detailDeprecated) + '</div><div style="color:var(--delete);">' + esc(meta.deprecated) + '</div></div>'
          : '') +
        tryItOut +
      '</div>' +
    '</div>'
  );
};

//? Render one sync event row from a FLAT array entry (`syncs[page]` is
//? `DocsSyncEntry[]`). Sync events have no HTTP method / rate limit / runner;
//? they surface clientInput + server/client output + stream shapes.
export const renderDocsSyncEntry = (
  entry: DocsSyncEntry,
  isOpen: boolean,
  esc: (v: unknown) => string,
  strings: DocsUiStrings,
): string => {
  const page = entry.page ?? '';
  const name = entry.name ?? '';
  const version = entry.version ?? '';
  const key = 'sync:' + page + '/' + name + '@' + version;
  const path = 'sync/' + page + '/' + name + '/' + version;
  const meta = entry.meta;
  const section = (label: string, value: string | undefined): string =>
    value && value !== 'never'
      ? '<div class="detail-section"><div class="detail-label">' + esc(label) + '</div><pre>' + esc(value) + '</pre></div>'
      : '';
  return (
    '<div class="endpoint ' + (isOpen ? 'open' : '') + '" data-key="' + esc(key) + '">' +
      '<div class="endpoint-summary">' +
        '<span class="method SYNC">SYNC</span>' +
        '<span class="endpoint-name">' + esc(path) + '</span>' +
      '</div>' +
      '<div class="endpoint-detail">' +
        section(strings.detailClientInput, entry.clientInput) +
        section(strings.detailServerOutput, entry.serverOutput) +
        section(strings.detailClientOutput, entry.clientOutput) +
        section(strings.detailServerStream, entry.serverStream) +
        section(strings.detailClientStream, entry.clientStream) +
        (meta?.owner
          ? '<div class="detail-section"><div class="detail-label">' + esc(strings.detailOwner) + '</div><div>' + esc(meta.owner) + '</div></div>'
          : '') +
      '</div>' +
    '</div>'
  );
};
