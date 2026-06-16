import { describe, it, expect } from 'vitest';

import { renderDocsHtml } from './docsHtml';

//? Characterization of the LIVE browser render core embedded in
//? `docsHtml.ts` (`renderDocsScript`). The shipped renderer is a
//? template-literal `<script>` string, so it is normally untestable. Here we
//? extract the SHIPPED pure helpers (escapeHtml / renderAuth / renderTryItOut /
//? renderEndpoint / passesFilter / buildGroups) straight out of the rendered
//? HTML and evaluate THEM — not a hand-written twin — in a tiny sandbox. That
//? means these tests run the exact code that ships to the browser, pinning the
//? output of the `buildGroups` god-function decomposition extracted in this
//? pass. `render` / `bindEndpointToggles` / the fetch bootstrap touch the DOM
//? (document/fetch) and are guarded structurally below instead.

//? Pull the inline `<script>` body out of the rendered document.
const extractScript = (html: string): string => {
  const open = html.indexOf('<script>');
  const close = html.lastIndexOf('</script>');
  if (open === -1 || close === -1) throw new Error('no inline <script> found');
  return html.slice(open + '<script>'.length, close);
};

//? Build a callable handle to the SHIPPED pure helpers by evaluating the
//? script body up to (and including) `buildGroups`, then returning the
//? closure's `buildGroups` / `renderEndpoint` / `renderAuth` / `passesFilter`.
//? The DOM-touching tail (`render`, listeners, fetch) is sliced off so no
//? `document` / `fetch` globals are needed.
const loadPureCore = (
  enableTryItOut: boolean,
): {
  buildGroups: (
    apis: unknown,
    syncs: unknown,
    filter: string,
  ) => { summaryHtml: string; contentHtml: string };
  renderEndpoint: (entry: unknown) => string;
  renderSyncEntry: (entry: unknown) => string;
  renderAuth: (auth: unknown) => string;
  passesFilter: (filter: string, page: string, name: string) => boolean;
} => {
  const script = extractScript(renderDocsHtml('/_docs/api.json', 'Docs', { enableTryItOut }));
  //? Cut at the orchestrator `render` (the first DOM-bound function) so only
  //? the pure helpers + module consts (JSON_PATH/ENABLE_TRY_IT_OUT/stateByKey)
  //? are evaluated.
  const cutAt = script.indexOf('//? Thin orchestrator');
  if (cutAt === -1) throw new Error('orchestrator marker not found — script shape changed');
  const pureBody = script.slice(0, cutAt);
  //? Evaluating the SHIPPED browser helpers verbatim is the whole point — it
  //? is what makes this a characterization of the real code path rather than a
  //? hand-written twin. The evaluated source is OUR OWN rendered output for a
  //? literal input, never user/request data, so the implied-eval concern does
  //? not apply here.
  const factory =
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- see comment above: source is our own rendered helper code, not untrusted input.
    new Function(
      `${pureBody}\n return { buildGroups, renderEndpoint, renderSyncEntry, renderAuth, passesFilter };`,
    ) as () => ReturnType<typeof loadPureCore>;
  return factory();
};

describe('live render core — escapeHtml (via renderEndpoint output)', () => {
  it('escapes HTML-significant characters in injected values', () => {
    const { renderEndpoint } = loadPureCore(false);
    const html = renderEndpoint({ page: 'p', name: 'n', version: 'v1', input: `<script>"&'` });
    expect(html).toContain('&lt;script&gt;&quot;&amp;&#39;');
    expect(html).not.toContain('<script>"&');
  });
});

describe('live render core — renderAuth', () => {
  it('returns a public tag for missing auth', () => {
    const { renderAuth } = loadPureCore(false);
    expect(renderAuth(null)).toBe('<span class="auth-tag">public</span>');
  });

  it('renders login-required + additional rules, skipping null/keyless rules', () => {
    const { renderAuth } = loadPureCore(false);
    const html = renderAuth({
      login: true,
      additional: [{ key: 'role', value: 'admin' }, null, { value: 'x' }, { key: 'flag' }],
    });
    expect(html).toBe(
      '<span class="auth-tag">login required</span>' +
        '<span class="auth-tag">role=&quot;admin&quot;</span>' +
        '<span class="auth-tag">flag</span>',
    );
  });

  it('falls back to public when no tags accumulate', () => {
    const { renderAuth } = loadPureCore(false);
    expect(renderAuth({ login: false, additional: [] })).toBe(
      '<span class="auth-tag">public</span>',
    );
  });
});

describe('live render core — renderEndpoint (flat array entry)', () => {
  it('uppercases the method for class + label and builds the api path', () => {
    const { renderEndpoint } = loadPureCore(false);
    const html = renderEndpoint({ page: 'playground', name: 'search', version: 'v1', method: 'get' });
    expect(html).toContain('<span class="method GET">GET</span>');
    expect(html).toContain('<span class="endpoint-name">/api/playground/search/v1</span>');
  });

  it('whitelists the method class and escapes the label for a foreign method', () => {
    const { renderEndpoint } = loadPureCore(false);
    const html = renderEndpoint({ page: 'p', name: 'n', version: 'v1', method: '"><img src=x>' });
    //? Class falls back to POST (not the raw value); label is uppercased then
    //? escaped, so no raw markup survives.
    expect(html).toContain('class="method POST"');
    expect(html).not.toContain('<img src=x>');
    expect(html).not.toContain('<IMG SRC=X>');
  });

  it('labels rate limits: number/min, false=no limit, undefined=default', () => {
    const { renderEndpoint } = loadPureCore(false);
    expect(renderEndpoint({ page: 'p', name: 'n', version: 'v1', rateLimit: 30 })).toContain(
      '<span class="endpoint-meta">30/min</span>',
    );
    expect(renderEndpoint({ page: 'p', name: 'n', version: 'v1', rateLimit: false })).toContain(
      '<span class="endpoint-meta">no rate limit</span>',
    );
    expect(renderEndpoint({ page: 'p', name: 'n', version: 'v1' })).toContain(
      '<span class="endpoint-meta">default rate</span>',
    );
  });

  it('omits optional detail sections when fields are absent', () => {
    const { renderEndpoint } = loadPureCore(false);
    const html = renderEndpoint({ page: 'p', name: 'n', version: 'v1' });
    expect(html).not.toContain('<div class="detail-label">stream</div>');
    expect(html).not.toContain('<div class="detail-label">owner</div>');
    expect(html).not.toContain('<div class="detail-label">tags</div>');
    expect(html).not.toContain('<div class="detail-label">deprecated</div>');
  });

  it('skips the stream section for the "never" sentinel', () => {
    const { renderEndpoint } = loadPureCore(false);
    const html = renderEndpoint({ page: 'p', name: 'n', version: 'v1', stream: 'never' });
    expect(html).not.toContain('<div class="detail-label">stream</div>');
  });

  it('renders optional sections (stream/owner/tags/deprecated) from the nested meta', () => {
    const { renderEndpoint } = loadPureCore(false);
    const html = renderEndpoint({
      page: 'p',
      name: 'n',
      version: 'v1',
      stream: 'chunk[]',
      meta: { owner: 'mathijs', tags: ['a', 'b'], deprecated: 'use v2' },
    });
    expect(html).toContain('<div class="detail-label">stream</div>');
    expect(html).toContain('<div class="detail-label">owner</div>');
    expect(html).toContain('<span class="badge">a</span> <span class="badge">b</span>');
    expect(html).toContain('color:var(--delete);">use v2</div>');
  });

  it('appends the runner only when try-it-out is enabled', () => {
    expect(loadPureCore(true).renderEndpoint({ page: 'p', name: 'n', version: 'v1' })).toContain(
      'class="try-it-out"',
    );
    expect(loadPureCore(false).renderEndpoint({ page: 'p', name: 'n', version: 'v1' })).not.toContain(
      'class="try-it-out"',
    );
  });
});

describe('live render core — renderSyncEntry (flat array entry)', () => {
  it('renders a SYNC row with the sync path and present stream shapes', () => {
    const { renderSyncEntry } = loadPureCore(false);
    const html = renderSyncEntry({
      page: 'playground',
      name: 'streamBroadcast',
      version: 'v1',
      clientInput: '{ text: string }',
      serverStream: '{ chunk: string }',
      clientStream: 'never',
    });
    expect(html).toContain('class="method SYNC"');
    expect(html).toContain('<span class="endpoint-name">sync/playground/streamBroadcast/v1</span>');
    expect(html).toContain('{ text: string }');
    expect(html).toContain('{ chunk: string }');
    //? clientStream is "never" → no client-stream section.
    expect(html).not.toContain('<div class="detail-label">client stream</div>');
  });
});

describe('live render core — passesFilter', () => {
  it('passes everything for an empty filter and matches case-insensitively', () => {
    const { passesFilter } = loadPureCore(false);
    expect(passesFilter('', 'page', 'name')).toBe(true);
    expect(passesFilter('PLAY', 'playground', 'echo')).toBe(true);
    expect(passesFilter('echo', 'playground', 'echo')).toBe(true);
    expect(passesFilter('nope', 'playground', 'echo')).toBe(false);
  });
});

describe('live render core — buildGroups (FLAT array artifact shape)', () => {
  //? Mirrors the REAL `apiDocs.generated.json`: `apis[page]` / `syncs[page]`
  //? are FLAT ARRAYS of entries, not nested name→version objects. This is the
  //? fixture that the previous nested fixture masked the array-shape bug behind.
  const apis = {
    playground: [
      { page: 'playground', name: 'echo', version: 'v1', method: 'POST', rateLimit: 60, auth: { login: false } },
      { page: 'playground', name: 'search', version: 'v1', method: 'GET' },
    ],
    admin: [
      { page: 'admin', name: 'purge', version: 'v1', method: 'DELETE', auth: { login: true } },
    ],
  };

  it('renders each endpoint from its own array entry (not a stringified key)', () => {
    const { buildGroups } = loadPureCore(false);
    const { contentHtml } = buildGroups(apis, {}, '');
    expect(contentHtml).toContain('<span class="endpoint-name">/api/playground/echo/v1</span>');
    expect(contentHtml).toContain('<span class="method GET">GET</span>');
    expect(contentHtml).toContain('<span class="endpoint-name">/api/admin/purge/v1</span>');
  });

  it('tallies visible/total endpoints + total pages in the summary pills', () => {
    const { buildGroups } = loadPureCore(false);
    const { summaryHtml } = buildGroups(apis, {}, '');
    expect(summaryHtml).toContain('<strong>3</strong> of <strong>3</strong> endpoints');
    expect(summaryHtml).toContain('<strong>2</strong> pages');
  });

  it('applies the filter to the visible count, keeping total + page count', () => {
    const { buildGroups } = loadPureCore(false);
    const { summaryHtml, contentHtml } = buildGroups(apis, {}, 'admin');
    expect(summaryHtml).toContain('<strong>1</strong> of <strong>3</strong> endpoints');
    expect(summaryHtml).toContain('<strong>2</strong> pages');
    expect(contentHtml).toContain('<div class="group-header">admin</div>');
    expect(contentHtml).not.toContain('<div class="group-header">playground</div>');
  });

  it('emits the no-matches empty state when the filter excludes everything', () => {
    const { buildGroups } = loadPureCore(false);
    expect(buildGroups(apis, {}, 'zzz').contentHtml).toBe('<div class="empty">No matches.</div>');
  });

  it('only renders groups with at least one surviving row', () => {
    const { buildGroups } = loadPureCore(false);
    const { contentHtml } = buildGroups(apis, {}, 'echo');
    expect((contentHtml.match(/class="group-header"/g) ?? []).length).toBe(1);
  });

  it('renders sync events in their own per-page (sync) group', () => {
    const { buildGroups } = loadPureCore(false);
    const syncs = {
      playground: [
        { page: 'playground', name: 'broadcast', version: 'v1', clientInput: '{ text: string }' },
      ],
    };
    const { summaryHtml, contentHtml } = buildGroups(apis, syncs, '');
    //? 3 apis + 1 sync = 4 endpoints across 2 pages (playground counted once).
    expect(summaryHtml).toContain('<strong>4</strong> of <strong>4</strong> endpoints');
    expect(summaryHtml).toContain('<strong>2</strong> pages');
    expect(contentHtml).toContain('<div class="group-header">playground (sync)</div>');
    expect(contentHtml).toContain('<span class="endpoint-name">sync/playground/broadcast/v1</span>');
  });

  it('treats a null array entry as an empty endpoint without throwing', () => {
    const { buildGroups } = loadPureCore(false);
    const { contentHtml } = buildGroups({ p: [{ page: 'p', name: 'n', version: 'v1' }] }, {}, '');
    expect(contentHtml).toContain('<span class="endpoint-name">/api/p/n/v1</span>');
    expect(contentHtml).toContain('<span class="method POST">POST</span>');
    expect(contentHtml).toContain('<span class="endpoint-meta">default rate</span>');
  });
});

//? Structural guard: the orchestrator decomposition introduced this pass must
//? stay intact so the pure-core extraction above keeps matching the shipped
//? code. If a future edit re-inlines or swaps the binding model, this fails.
describe('docsHtml orchestrator decomposition guard', () => {
  const html = renderDocsHtml('/_docs/api.json', 'Docs');

  it('keeps buildGroups + bindEndpointToggles extracted and wired', () => {
    expect(html).toContain('const buildGroups = (apis, syncs, filter) => {');
    expect(html).toContain('const bindEndpointToggles = () => {');
    expect(html).toContain('const built = buildGroups(apis, syncs, filter);');
    expect(html).toContain('summary.innerHTML = built.summaryHtml;');
    expect(html).toContain('content.innerHTML = built.contentHtml;');
    //? bindEndpointToggles is called once at init (event delegation), not per render.
    expect(html).toContain('bindEndpointToggles();');
  });

  it('uses event delegation on #content for endpoint toggles (DOCSUI-O13 fix)', () => {
    //? bindEndpointToggles now attaches one delegated listener on the
    //? container rather than re-binding per element on every filter keystroke.
    expect(html).toContain("content.addEventListener('click', (e) => {");
    expect(html).toContain("e.target.closest('.endpoint')");
  });
});
