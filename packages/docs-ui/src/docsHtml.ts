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
  const runEndpoint = async (button, route, version, dataField) => {
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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(parsed),
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

  const renderTryItOut = (route, version) => {
    if (!ENABLE_TRY_IT_OUT) return '';
    return '<div class="try-it-out">' +
      '<div style="font-weight:600;font-size:12px;margin-bottom:4px;">Try it out (live request)</div>' +
      '<textarea placeholder=\\'{"key":"value"}\\'>{}</textarea>' +
      '<button onclick="runEndpoint(this,\\'' + route + '\\',\\'' + version + '\\',this.previousElementSibling)">Send</button>' +
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
        if (rule.key) tags.push(rule.key + (rule.value !== undefined ? '=' + JSON.stringify(rule.value) : ''));
      }
    }
    if (tags.length === 0) tags.push('public');
    return tags.map(t => '<span class="auth-tag">' + escapeHtml(t) + '</span>').join('');
  };

  const renderEndpoint = (page, name, version, meta) => {
    const key = page + '/' + name + '@' + version;
    const method = (meta.method || 'POST').toUpperCase();
    const rate = meta.rateLimit;
    const rateLabel = rate === false ? 'no rate limit' : rate === undefined ? 'default rate' : (rate + '/min');
    const isOpen = stateByKey.get(key) === true;
    const path = '/api/' + page + '/' + name + '/' + version;
    return \`
      <div class="endpoint \${isOpen ? 'open' : ''}" data-key="\${escapeHtml(key)}">
        <div class="endpoint-summary">
          <span class="method \${method}">\${method}</span>
          <span class="endpoint-name">\${escapeHtml(path)}</span>
          <span class="endpoint-meta">\${escapeHtml(rateLabel)}</span>
        </div>
        <div class="endpoint-detail">
          <div class="detail-section">
            <div class="detail-label">auth</div>
            <div>\${renderAuth(meta.auth)}</div>
          </div>
          <div class="detail-section">
            <div class="detail-label">input</div>
            <pre>\${escapeHtml(meta.input || '{}')}</pre>
          </div>
          <div class="detail-section">
            <div class="detail-label">output</div>
            <pre>\${escapeHtml(meta.output || 'unknown')}</pre>
          </div>
          \${meta.stream ? \`
            <div class="detail-section">
              <div class="detail-label">stream</div>
              <pre>\${escapeHtml(meta.stream)}</pre>
            </div>
          \` : ''}
          \${meta.owner ? \`
            <div class="detail-section">
              <div class="detail-label">owner</div>
              <div>\${escapeHtml(meta.owner)}</div>
            </div>
          \` : ''}
          \${meta.tags && meta.tags.length ? \`
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
          \${renderTryItOut(page + '/' + name + '/' + version, version)}
        </div>
      </div>
    \`;
  };

  const passesFilter = (filter, page, name) => {
    if (!filter) return true;
    const haystack = (page + '/' + name).toLowerCase();
    return haystack.includes(filter.toLowerCase());
  };

  const render = (data, filter) => {
    const summary = document.getElementById('summary');
    const content = document.getElementById('content');
    const apis = data && data.apis ? data.apis : data;
    if (!apis || typeof apis !== 'object') {
      content.innerHTML = '<div class="empty">No API docs available. Run <code>npm run generateArtifacts</code> to generate them.</div>';
      summary.innerHTML = '';
      return;
    }

    let total = 0;
    let visible = 0;
    const groups = [];
    for (const [page, names] of Object.entries(apis)) {
      const rows = [];
      for (const [name, versions] of Object.entries(names)) {
        for (const [version, meta] of Object.entries(versions)) {
          total++;
          if (!passesFilter(filter, page, name)) continue;
          visible++;
          rows.push(renderEndpoint(page, name, version, meta || {}));
        }
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

    summary.innerHTML = \`
      <div class="summary-pill"><strong>\${visible}</strong> of <strong>\${total}</strong> endpoints</div>
      <div class="summary-pill"><strong>\${Object.keys(apis).length}</strong> pages</div>
    \`;
    content.innerHTML = groups.join('') || '<div class="empty">No matches.</div>';

    document.querySelectorAll('.endpoint').forEach((el) => {
      el.addEventListener('click', () => {
        const key = el.getAttribute('data-key');
        const next = !el.classList.contains('open');
        stateByKey.set(key, next);
        el.classList.toggle('open');
      });
    });
  };

  let cachedData = null;
  document.getElementById('filter').addEventListener('input', (e) => {
    if (cachedData) render(cachedData, e.target.value);
  });

  fetch(JSON_PATH, { credentials: 'include' })
    .then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
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
  const accent = branding.brandColor ?? '#58a6ff';
  const fontFamily = branding.fontFamily ?? `system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
  const logoMarkup = branding.logoUrl
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
