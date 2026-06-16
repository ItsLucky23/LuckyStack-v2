//? Embedded HTML for the docs page. Self-contained — no build-time bundler
//? needed. Fetches `<routePath>/api.json` at runtime and renders the API
//? catalog grouped by page. Style mirrors the framework's Tailwind tokens
//? (background / container / muted / common) loosely so it doesn't look
//? wildly out of place in projects that haven't customized them.

import { escapeHtml } from '@luckystack/core';

export interface RenderDocsHtmlOptions {
  branding?: {
    logoUrl?: string;
    brandColor?: string;
    fontFamily?: string;
  };
  /**
   * When true, the renderer injects an inline "try-it-out" form per
   * endpoint. The form calls `apiRequest` from `@luckystack/core` against
   * the live server. Disabled by default (requires a logged-in session).
   */
  enableTryItOut?: boolean;
}

//? Strip CSS-break characters from a value before injecting it into a
//? <style> block. Removes `}` (would close the rule-set), `;` (would inject
//? extra declarations) and `<` (would close the <style> element).
const sanitizeCssValue = (value: string): string =>
  value.replaceAll('}', '').replaceAll(';', '').replaceAll('<', '');

//? Only allow http: and https: schemes for the logo URL to block javascript:
//? and data: XSS vectors. data: URLs are explicitly rejected because an SVG
//? data-URI can carry script.
const isSafeLogoUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    // Relative URLs (no scheme) are safe — they resolve on the same origin.
    return !url.includes(':');
  }
};

//? Renders the `<style>` block. Split out of `renderDocsHtml` so the
//? document assembler stays readable; `accent` + `fontFamily` are the only
//? two values interpolated into the stylesheet. Output is byte-identical to
//? the previously inlined CSS.
const renderDocsCss = (accent: string, fontFamily: string): string => `<style>
  :root {
    --bg: #0e1116;
    --container: #161b22;
    --container-hover: #1c232b;
    --border: #2a313c;
    --title: #e6edf3;
    --common: #c9d1d9;
    --muted: #8b949e;
    --accent: ${accent};
    --font-family: ${fontFamily};
    --get: #3fb950;
    --post: ${accent};
    --put: #d29922;
    --delete: #f85149;
  }
  @media (prefers-color-scheme: light) {
    :root {
      --bg: #ffffff;
      --container: #f6f8fa;
      --container-hover: #eaeef2;
      --border: #d0d7de;
      --title: #1f2328;
      --common: #1f2328;
      --muted: #59636e;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 0;
    font-family: var(--font-family);
    background: var(--bg); color: var(--common);
    line-height: 1.5;
  }
  .brand-row { display: flex; align-items: center; }
  .try-it-out { margin-top: 12px; padding: 12px; background: var(--container-hover); border: 1px solid var(--border); border-radius: 6px; }
  .try-it-out textarea { width: 100%; min-height: 80px; background: var(--bg); color: var(--common); border: 1px solid var(--border); padding: 6px; font-family: ui-monospace, monospace; font-size: 12px; }
  .try-it-out button { margin-top: 6px; padding: 6px 12px; background: var(--accent); color: white; border: 0; border-radius: 4px; cursor: pointer; }
  .try-it-out pre.result { margin-top: 8px; padding: 8px; background: var(--bg); border: 1px solid var(--border); border-radius: 4px; max-height: 240px; overflow: auto; font-size: 12px; }
  .layout {
    max-width: 1200px;
    margin: 0 auto;
    padding: 32px 24px 96px;
  }
  h1 { color: var(--title); margin: 0 0 4px; font-size: 28px; }
  .lead { color: var(--muted); margin: 0 0 32px; font-size: 14px; }
  .summary { display: flex; gap: 24px; margin-bottom: 24px; flex-wrap: wrap; }
  .summary-pill {
    background: var(--container);
    border: 1px solid var(--border);
    padding: 8px 14px;
    border-radius: 8px;
    font-size: 13px;
  }
  .summary-pill strong { color: var(--title); }
  .filter-bar {
    margin-bottom: 24px;
    display: flex;
    gap: 12px;
    align-items: center;
  }
  input[type="search"] {
    flex: 1;
    background: var(--container);
    border: 1px solid var(--border);
    color: var(--common);
    padding: 10px 14px;
    border-radius: 8px;
    font-size: 14px;
    font-family: inherit;
  }
  input[type="search"]:focus {
    outline: none;
    border-color: var(--accent);
  }
  .group {
    margin-bottom: 24px;
    background: var(--container);
    border: 1px solid var(--border);
    border-radius: 12px;
    overflow: hidden;
  }
  .group-header {
    padding: 12px 18px;
    background: var(--container-hover);
    font-size: 13px;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    border-bottom: 1px solid var(--border);
  }
  .endpoint {
    padding: 14px 18px;
    border-bottom: 1px solid var(--border);
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Consolas, monospace;
    font-size: 13px;
    cursor: pointer;
    transition: background 80ms;
  }
  .endpoint:last-child { border-bottom: none; }
  .endpoint:hover { background: var(--container-hover); }
  .endpoint-summary { display: flex; align-items: center; gap: 12px; }
  .method {
    display: inline-block;
    min-width: 56px;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 700;
    text-align: center;
    color: #fff;
  }
  .method.GET    { background: var(--get); }
  .method.POST   { background: var(--post); }
  .method.PUT    { background: var(--put); color: #1f2328; }
  .method.DELETE { background: var(--delete); }
  .method.SYNC   { background: var(--muted); }
  .badge {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 4px;
    background: var(--container-hover);
    color: var(--muted);
    font-size: 11px;
    margin-right: 4px;
  }
  .endpoint-name { color: var(--title); font-weight: 500; }
  .endpoint-meta { margin-left: auto; color: var(--muted); font-size: 12px; }
  .endpoint-detail {
    margin-top: 12px;
    padding: 12px;
    background: var(--bg);
    border-radius: 8px;
    border: 1px solid var(--border);
    display: none;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .endpoint.open .endpoint-detail { display: block; }
  .detail-section { margin-bottom: 12px; }
  .detail-section:last-child { margin-bottom: 0; }
  .detail-label {
    color: var(--muted);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 4px;
  }
  pre {
    margin: 0;
    color: var(--common);
    font-size: 12px;
    overflow-x: auto;
  }
  .auth-tag {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 4px;
    background: var(--container-hover);
    color: var(--muted);
    font-size: 11px;
    margin-right: 4px;
  }
  .empty {
    padding: 48px;
    text-align: center;
    color: var(--muted);
  }
  a.json-link { color: var(--accent); }
</style>`;

//? Renders the self-contained client `<script>` block. Split out of
//? `renderDocsHtml` for readability; `jsonPath` (fetch target, injected as a
//? JSON.stringify literal) and `tryItOutData` (`'true'`/`'false'`) are the
//? only two interpolations. This is browser-runtime JavaScript embedded as a
//? string — it cannot import from `@luckystack/core`, so it carries its own
//? minimal `escapeHtml` mirror of core's escaping. Output is byte-identical
//? to the previously inlined script.
const renderDocsScript = (jsonPath: string, tryItOutData: string): string => `<script>
  const JSON_PATH = ${JSON.stringify(jsonPath)};
  const ENABLE_TRY_IT_OUT = ${tryItOutData};
  const stateByKey = new Map();

  //? Inline runner: hits the live server using the same fetch transport
  //? that the framework apiRequest helper uses. Auth comes from the
  //? browser's existing session cookie or sessionStorage; no token prompt.
  const runEndpoint = async (button, route, method, dataField) => {
    //? The framework enforces the route's declared HTTP method (405 on
    //? mismatch), so the runner must send that method, not a hardcoded POST.
    const httpMethod = (method || 'POST').toUpperCase();
    const hasBody = httpMethod !== 'GET' && httpMethod !== 'DELETE';
    let parsed;
    try {
      parsed = dataField.value.trim().length === 0 ? {} : JSON.parse(dataField.value);
    } catch (err) {
      const resultEl = button.parentElement.querySelector('pre.result');
      resultEl.textContent = 'JSON parse error: ' + err.message;
      return;
    }
    button.disabled = true;
    const resultEl = button.parentElement.querySelector('pre.result');
    resultEl.textContent = 'Sending...';
    try {
      const response = await fetch('/' + route + '?stream=false', {
        method: httpMethod,
        headers: hasBody ? { 'Content-Type': 'application/json' } : {},
        credentials: 'include',
        body: hasBody ? JSON.stringify(parsed) : undefined,
      });
      const text = await response.text();
      try {
        resultEl.textContent = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        resultEl.textContent = text;
      }
    } catch (err) {
      resultEl.textContent = 'Network error: ' + err.message;
    } finally {
      button.disabled = false;
    }
  };

  const renderTryItOut = (route, method) => {
    if (!ENABLE_TRY_IT_OUT) return '';
    return '<div class="try-it-out">' +
      '<div style="font-weight:600;font-size:12px;margin-bottom:4px;">Try it out (live request)</div>' +
      '<textarea placeholder=\\'{"key":"value"}\\'>{}</textarea>' +
      '<button onclick="runEndpoint(this,\\'' + route + '\\',\\'' + method + '\\',this.previousElementSibling)">Send</button>' +
      '<pre class="result"></pre>' +
      '</div>';
  };

  const escapeHtml = (str) => String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);

  const renderAuth = (auth) => {
    if (!auth) return '<span class="auth-tag">public</span>';
    const tags = [];
    if (auth.login) tags.push('login required');
    if (Array.isArray(auth.additional)) {
      for (const rule of auth.additional) {
        if (rule && rule.key) tags.push(rule.key + (rule.value !== undefined ? '=' + JSON.stringify(rule.value) : ''));
      }
    }
    if (tags.length === 0) tags.push('public');
    return tags.map(t => '<span class="auth-tag">' + escapeHtml(t) + '</span>').join('');
  };

  const renderEndpoint = (entry) => {
    const page = entry.page || '';
    const name = entry.name || '';
    const version = entry.version || '';
    const key = page + '/' + name + '@' + version;
    const method = (entry.method || 'POST').toUpperCase();
    const methodClass = ['GET', 'POST', 'PUT', 'DELETE'].includes(method) ? method : 'POST';
    const rate = entry.rateLimit;
    const rateLabel = rate === false ? 'no rate limit' : rate === undefined ? 'default rate' : (rate + '/min');
    const isOpen = stateByKey.get(key) === true;
    const path = '/api/' + page + '/' + name + '/' + version;
    const meta = entry.meta || {};
    return \`
      <div class="endpoint \${isOpen ? 'open' : ''}" data-key="\${escapeHtml(key)}">
        <div class="endpoint-summary">
          <span class="method \${methodClass}">\${escapeHtml(method)}</span>
          <span class="endpoint-name">\${escapeHtml(path)}</span>
          <span class="endpoint-meta">\${escapeHtml(rateLabel)}</span>
        </div>
        <div class="endpoint-detail">
          <div class="detail-section">
            <div class="detail-label">auth</div>
            <div>\${renderAuth(entry.auth)}</div>
          </div>
          <div class="detail-section">
            <div class="detail-label">input</div>
            <pre>\${escapeHtml(entry.input || '{}')}</pre>
          </div>
          <div class="detail-section">
            <div class="detail-label">output</div>
            <pre>\${escapeHtml(entry.output || 'unknown')}</pre>
          </div>
          \${entry.stream && entry.stream !== 'never' ? \`
            <div class="detail-section">
              <div class="detail-label">stream</div>
              <pre>\${escapeHtml(entry.stream)}</pre>
            </div>
          \` : ''}
          \${meta.owner ? \`
            <div class="detail-section">
              <div class="detail-label">owner</div>
              <div>\${escapeHtml(meta.owner)}</div>
            </div>
          \` : ''}
          \${Array.isArray(meta.tags) && meta.tags.length ? \`
            <div class="detail-section">
              <div class="detail-label">tags</div>
              <div>\${meta.tags.map(t => '<span class="badge">' + escapeHtml(String(t)) + '</span>').join(' ')}</div>
            </div>
          \` : ''}
          \${meta.deprecated ? \`
            <div class="detail-section">
              <div class="detail-label">deprecated</div>
              <div style="color:var(--delete);">\${escapeHtml(String(meta.deprecated))}</div>
            </div>
          \` : ''}
          \${renderTryItOut('api/' + page + '/' + name + '/' + version, method)}
        </div>
      </div>
    \`;
  };

  const renderSyncEntry = (entry) => {
    const page = entry.page || '';
    const name = entry.name || '';
    const version = entry.version || '';
    const key = 'sync:' + page + '/' + name + '@' + version;
    const isOpen = stateByKey.get(key) === true;
    const path = 'sync/' + page + '/' + name + '/' + version;
    const meta = entry.meta || {};
    const section = (label, value) => value && value !== 'never'
      ? '<div class="detail-section"><div class="detail-label">' + escapeHtml(label) + '</div><pre>' + escapeHtml(value) + '</pre></div>'
      : '';
    return \`
      <div class="endpoint \${isOpen ? 'open' : ''}" data-key="\${escapeHtml(key)}">
        <div class="endpoint-summary">
          <span class="method SYNC">SYNC</span>
          <span class="endpoint-name">\${escapeHtml(path)}</span>
        </div>
        <div class="endpoint-detail">
          \${section('client input', entry.clientInput)}
          \${section('server output', entry.serverOutput)}
          \${section('client output', entry.clientOutput)}
          \${section('server stream', entry.serverStream)}
          \${section('client stream', entry.clientStream)}
          \${meta.owner ? \`
            <div class="detail-section">
              <div class="detail-label">owner</div>
              <div>\${escapeHtml(meta.owner)}</div>
            </div>
          \` : ''}
        </div>
      </div>
    \`;
  };

  const passesFilter = (filter, page, name) => {
    if (!filter) return true;
    const haystack = (page + '/' + name).toLowerCase();
    return haystack.includes(filter.toLowerCase());
  };

  //? Pure (DOM-free) core: walks the FLAT \`apis[page] = Entry[]\` and
  //? \`syncs[page] = SyncEntry[]\` maps (the real emitted artifact shape),
  //? builds the grouped endpoint markup, and tallies the summary counts.
  //? Extracted from \`render\` so the orchestrator stays a thin DOM shell and
  //? the assembly logic can be reasoned about / tested in isolation.
  const buildGroups = (apis, syncs, filter) => {
    let total = 0;
    let visible = 0;
    const groups = [];
    for (const [page, entries] of Object.entries(apis || {})) {
      const rows = [];
      for (const entry of (Array.isArray(entries) ? entries : [])) {
        total++;
        if (!passesFilter(filter, page, entry.name || '')) continue;
        visible++;
        rows.push(renderEndpoint(entry || {}));
      }
      if (rows.length > 0) {
        groups.push(\`
          <div class="group">
            <div class="group-header">\${escapeHtml(page)}</div>
            \${rows.join('')}
          </div>
        \`);
      }
    }
    for (const [page, entries] of Object.entries(syncs || {})) {
      const rows = [];
      for (const entry of (Array.isArray(entries) ? entries : [])) {
        total++;
        if (!passesFilter(filter, page, entry.name || '')) continue;
        visible++;
        rows.push(renderSyncEntry(entry || {}));
      }
      if (rows.length > 0) {
        groups.push(\`
          <div class="group">
            <div class="group-header">\${escapeHtml(page)} (sync)</div>
            \${rows.join('')}
          </div>
        \`);
      }
    }
    const pageCount = new Set([...Object.keys(apis || {}), ...Object.keys(syncs || {})]).size;
    const summaryHtml = \`
      <div class="summary-pill"><strong>\${visible}</strong> of <strong>\${total}</strong> endpoints</div>
      <div class="summary-pill"><strong>\${pageCount}</strong> pages</div>
    \`;
    const contentHtml = groups.join('') || '<div class="empty">No matches.</div>';
    return { summaryHtml, contentHtml };
  };

  //? Event-delegation toggle: one listener on the #content container handles
  //? all endpoint clicks. This replaces the per-element re-bind that was
  //? called on every filter keystroke (DOCSUI-O13).
  const bindEndpointToggles = () => {
    const content = document.getElementById('content');
    content.addEventListener('click', (e) => {
      const el = e.target.closest('.endpoint');
      if (!el) return;
      const key = el.getAttribute('data-key');
      const next = !el.classList.contains('open');
      stateByKey.set(key, next);
      el.classList.toggle('open');
    });
  };

  //? Thin orchestrator: resolve the DOM targets, guard the data shape, then
  //? delegate assembly to \`buildGroups\`. Toggles are wired once via delegation.
  const render = (data, filter) => {
    const summary = document.getElementById('summary');
    const content = document.getElementById('content');
    //? Accept both the new artifact shape \`{apis,syncs}\` and the legacy bare
    //? map \`{page:Entry[]}\`. Warn in dev so consumers migrate (DOCSUI-O12).
    const apis = data && data.apis ? data.apis : data;
    const syncs = data && data.syncs ? data.syncs : {};
    if (data && !data.apis && typeof data === 'object' && typeof console !== 'undefined') {
      console.warn('[docs-ui] legacy artifact shape detected (bare map). Re-generate apiDocs.generated.json to get the {apis,syncs} shape.');
    }
    if (!apis || typeof apis !== 'object') {
      content.innerHTML = '<div class="empty">No API docs available. Run <code>npm run generateArtifacts</code> to generate them.</div>';
      summary.innerHTML = '';
      return;
    }
    const built = buildGroups(apis, syncs, filter);
    summary.innerHTML = built.summaryHtml;
    content.innerHTML = built.contentHtml;
  };

  let cachedData = null;
  //? Delegation is registered once; filter keystrokes only rebuild innerHTML.
  bindEndpointToggles();
  document.getElementById('filter').addEventListener('input', (e) => {
    if (cachedData) render(cachedData, e.target.value);
  });

  //? On non-OK responses, try to surface the JSON error body's \`error\` field
  //? rather than just the raw status code (DOCSUI-O14).
  fetch(JSON_PATH, { credentials: 'include' })
    .then(r => r.ok ? r.json() : r.json().then(
      (j) => Promise.reject(new Error((j && j.error) ? j.error : String(r.status))),
      () => Promise.reject(new Error(String(r.status)))
    ))
    .then(data => { cachedData = data; render(data, ''); })
    .catch(err => {
      document.getElementById('content').innerHTML =
        '<div class="empty">Could not load API docs: ' + escapeHtml(err.message) + '</div>';
    });
</script>`;

export const renderDocsHtml = (
  jsonPath: string,
  pageTitle: string,
  options: RenderDocsHtmlOptions = {},
): string => {
  const branding = options.branding ?? {};
  //? Sanitize CSS-injected values to prevent rule-set / style-element breakout
  //? (DOCSUI-O9). Sanitize logoUrl scheme to block javascript:/data: XSS (DOCSUI-O11).
  const accent = sanitizeCssValue(branding.brandColor ?? '#58a6ff');
  const fontFamily = sanitizeCssValue(branding.fontFamily ?? `system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`);
  const logoMarkup = branding.logoUrl && isSafeLogoUrl(branding.logoUrl)
    ? `<img src="${escapeHtml(branding.logoUrl)}" alt="logo" style="height:32px;width:auto;margin-right:12px;" />`
    : '';
  const tryItOutData = options.enableTryItOut ? 'true' : 'false';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(pageTitle)}</title>
${renderDocsCss(accent, fontFamily)}
</head>
<body>
<div class="layout">
  <div class="brand-row">${logoMarkup}<h1>${escapeHtml(pageTitle)}</h1></div>
  <p class="lead">Generated from <code>apiDocs.generated.json</code>. Raw JSON: <a class="json-link" href="${escapeHtml(jsonPath)}">${escapeHtml(jsonPath)}</a></p>
  <div class="summary" id="summary"></div>
  <div class="filter-bar">
    <input type="search" id="filter" placeholder="Filter by route name…" autofocus />
  </div>
  <div id="content"></div>
</div>
${renderDocsScript(jsonPath, tryItOutData)}
</body>
</html>`;
};
