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
  findToggleTarget: (target: unknown, selectedText: string) => unknown;
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
      `${pureBody}\n return { buildGroups, renderEndpoint, renderSyncEntry, renderAuth, passesFilter, findToggleTarget };`,
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

//? Finding 106: a quote in route metadata must not reach JavaScript. The runner
//? reads route/method from data attributes through the delegated listener; the
//? fakes below stand in for the DOM pieces that listener and `runEndpoint` touch.
describe('live render core — try-it-out runner metadata', () => {
  const hostilePage = `a');alert(1);('`;

  it('renders no inline handler and keeps route/method in escaped data attributes', () => {
    const html = loadPureCore(true).renderEndpoint({ page: hostilePage, name: 'n', version: 'v1', method: 'get' });
    expect(html).not.toContain('onclick');
    expect(html).toContain(`data-route="api/a&#39;);alert(1);(&#39;/n/v1"`);
    expect(html).toContain('data-method="GET"');
  });

  it('sends the dataset route verbatim when the delegated listener sees a Send click', async () => {
    const script = extractScript(renderDocsHtml('/_docs/api.json', 'Docs', { enableTryItOut: true }));
    const pureBody = script.slice(0, script.indexOf('//? Thin orchestrator'));
    const captured: { clickListener?: (event: unknown) => void } = {};
    const fakeDocument = {
      getElementById: () => ({
        addEventListener: (_type: string, listener: (event: unknown) => void) => { captured.clickListener = listener; },
      }),
    };
    const requests: { url: string; method: string }[] = [];
    const fakeFetch = (url: string, init: { method: string }) => {
      requests.push({ url, method: init.method });
      return Promise.resolve({ text: () => Promise.resolve('{}') });
    };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- same rationale as loadPureCore: our own rendered helper code.
    const factory = new Function('document', 'fetch', `${pureBody}\n return { bindEndpointToggles };`) as (
      document: unknown,
      fetch: unknown,
    ) => { bindEndpointToggles: () => void };
    factory(fakeDocument, fakeFetch).bindEndpointToggles();

    const route = `api/${hostilePage}/n/v1`;
    const result = { textContent: '' };
    const button = {
      dataset: { route, method: 'GET' },
      disabled: false,
      previousElementSibling: { value: '{}' },
      parentElement: { querySelector: () => result },
      closest: (selector: string) => (selector === 'button[data-run-endpoint]' ? button : null),
    };
    captured.clickListener?.({ target: button });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(requests).toEqual([{ url: `/${route}?stream=false`, method: 'GET' }]);
    expect(result.textContent).toBe('{}');
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
    expect(html).toContain('const el = findToggleTarget(e.target, ');
  });
});

//? Minimal stand-in for an element: `closest` walks the parent chain and
//? matches the plain class selectors the delegated listener uses.
interface FakeNode {
  className: string;
  parent: FakeNode | null;
  closest: (selector: string) => FakeNode | null;
}
const fakeNode = (className: string, parent: FakeNode | null = null): FakeNode => {
  const node: FakeNode = {
    className,
    parent,
    closest: (selector) => {
      for (let current: FakeNode | null = node; current; current = current.parent) {
        if (selector.startsWith('.') && current.className.split(' ').includes(selector.slice(1))) return current;
      }
      return null;
    },
  };
  return node;
};

//? An open panel collapsed on any click inside it (the try-it-out textarea,
//? selecting output text) because every click bubbled to the delegated toggle.
describe('live render core — endpoint toggle target', () => {
  const endpoint = fakeNode('endpoint open');
  const summary = fakeNode('endpoint-summary', endpoint);
  const methodBadge = fakeNode('method GET', summary);
  const detail = fakeNode('endpoint-detail', endpoint);
  const tryItOut = fakeNode('try-it-out', detail);
  const textarea = fakeNode('', tryItOut);
  const outputPre = fakeNode('', fakeNode('detail-section', detail));

  it('toggles from the summary row and its children', () => {
    const { findToggleTarget } = loadPureCore(true);
    expect(findToggleTarget(summary, '')).toBe(endpoint);
    expect(findToggleTarget(methodBadge, '')).toBe(endpoint);
  });

  it('ignores clicks inside the expanded detail, including form controls', () => {
    const { findToggleTarget } = loadPureCore(true);
    expect(findToggleTarget(detail, '')).toBeNull();
    expect(findToggleTarget(textarea, '')).toBeNull();
    expect(findToggleTarget(outputPre, '')).toBeNull();
  });

  it('ignores a click that finishes a text selection, even on the summary', () => {
    const { findToggleTarget } = loadPureCore(true);
    expect(findToggleTarget(summary, '/api/p/n/v1')).toBeNull();
  });

  it('keeps an open panel open when the delegated listener sees a textarea click', () => {
    const script = extractScript(renderDocsHtml('/_docs/api.json', 'Docs', { enableTryItOut: true }));
    const pureBody = script.slice(0, script.indexOf('//? Thin orchestrator'));
    const captured: { clickListener?: (event: unknown) => void } = {};
    const fakeDocument = {
      getElementById: () => ({
        addEventListener: (_type: string, listener: (event: unknown) => void) => { captured.clickListener = listener; },
      }),
      getSelection: () => ({ toString: () => '' }),
    };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- same rationale as loadPureCore: our own rendered helper code.
    const factory = new Function('document', `${pureBody}\n return { bindEndpointToggles };`) as (
      document: unknown,
    ) => { bindEndpointToggles: () => void };
    factory(fakeDocument).bindEndpointToggles();

    const classes = new Set(['endpoint', 'open']);
    const panel = Object.assign(fakeNode('endpoint open'), {
      getAttribute: () => 'p/n@v1',
      classList: {
        contains: (name: string) => classes.has(name),
        toggle: (name: string) => { if (!classes.delete(name)) classes.add(name); },
      },
    });
    const panelSummary = fakeNode('endpoint-summary', panel);
    const panelTextarea = fakeNode('', fakeNode('try-it-out', fakeNode('endpoint-detail', panel)));

    captured.clickListener?.({ target: panelTextarea });
    expect(classes.has('open')).toBe(true);

    captured.clickListener?.({ target: panelSummary });
    expect(classes.has('open')).toBe(false);
  });
});
