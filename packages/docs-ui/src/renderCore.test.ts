import { describe, it, expect } from 'vitest';
import { escapeHtml as coreEscapeHtml } from '@luckystack/core';

import {
  DEFAULT_DOCS_UI_STRINGS,
  docsEscapeHtml,
  renderDocsAuth,
  renderDocsEndpoint,
  renderDocsSyncEntry,
  KNOWN_HTTP_METHODS,
  type DocsApiEntry,
  type DocsSyncEntry,
} from './renderCore';

//? These tests exercise the EMBEDDED render core directly — the same functions
//? that `docsHtml.ts` serializes into the inline browser `<script>` via
//? `.toString()`. The previous string-only HTML assertions never ran this code
//? against a representative artifact, which is exactly why the array-shape
//? (DUI-01) and missing-sync (DUI-06) bugs shipped. The fixtures below mirror
//? the real `apiDocs.generated.json` shape: `apis[page]` / `syncs[page]` are
//? FLAT ARRAYS of entries, not nested name→version objects.

const esc = docsEscapeHtml;
const S = DEFAULT_DOCS_UI_STRINGS;

const apiFixture: DocsApiEntry = {
  page: 'playground',
  name: 'echo',
  version: 'v1',
  method: 'POST',
  input: '{ message: string }',
  output: "{ status: 'success' }",
  rateLimit: 60,
  auth: { login: false },
  meta: { owner: 'mathijs', tags: ['playground', 'smoke-test'] },
};

const syncFixture: DocsSyncEntry = {
  page: 'playground',
  name: 'streamBroadcast',
  version: 'v1',
  clientInput: '{ text: string }',
  serverOutput: "{ status: 'success' }",
  clientOutput: '{ }',
  serverStream: '{ chunk: string }',
  clientStream: 'never',
};

describe('renderDocsEndpoint (array-shape entry)', () => {
  it('renders the correct /api/ path, method label, and rate from a flat entry', () => {
    const html = renderDocsEndpoint(apiFixture, false, '', esc, S);
    //? DUI-01: fields come straight off the entry, not off a stringified key.
    expect(html).toContain('/api/playground/echo/v1');
    expect(html).toContain('>POST<');
    expect(html).toContain('class="method POST"');
    expect(html).toContain('60/min');
  });

  it('renders input/output and the owner + tag badges', () => {
    const html = renderDocsEndpoint(apiFixture, false, '', esc, S);
    expect(html).toContain('{ message: string }');
    expect(html).toContain('mathijs');
    //? DUI-13: tags use the .badge class (now styled).
    expect(html).toContain('<span class="badge">playground</span>');
    expect(html).toContain('<span class="badge">smoke-test</span>');
  });

  it('whitelists the method class and escapes the label for a foreign/tampered method (DUI-08)', () => {
    const evil = renderDocsEndpoint(
      { ...apiFixture, method: '"><img src=x>' },
      false,
      '',
      esc,
      S,
    );
    //? Class falls back to POST (not the raw value); label is uppercased then
    //? escaped, so no raw markup survives.
    expect(evil).toContain('class="method POST"');
    expect(evil).not.toContain('<img src=x>');
    expect(evil).not.toContain('<IMG SRC=X>');
    expect(evil).toContain('&quot;&gt;&lt;IMG SRC=X&gt;');
  });

  it('falls back to POST when method is missing', () => {
    const html = renderDocsEndpoint({ ...apiFixture, method: undefined }, false, '', esc, S);
    expect(html).toContain('class="method POST"');
  });

  it('embeds the try-it-out markup verbatim when provided', () => {
    const html = renderDocsEndpoint(apiFixture, false, '<div class="try-it-out">RUNNER</div>', esc, S);
    expect(html).toContain('<div class="try-it-out">RUNNER</div>');
  });

  it('renders rate labels for false and undefined', () => {
    expect(renderDocsEndpoint({ ...apiFixture, rateLimit: false }, false, '', esc, S)).toContain('no rate limit');
    expect(renderDocsEndpoint({ ...apiFixture, rateLimit: undefined }, false, '', esc, S)).toContain('default rate');
  });
});

describe('renderDocsAuth', () => {
  it('renders a public badge for missing/empty auth', () => {
    expect(renderDocsAuth(undefined, esc, S)).toContain('public');
    expect(renderDocsAuth({ login: false }, esc, S)).toContain('public');
  });

  it('renders login-required and additional rules', () => {
    const html = renderDocsAuth({ login: true, additional: [{ key: 'role', value: 'admin' }] }, esc, S);
    expect(html).toContain('login required');
    expect(html).toContain('role=&quot;admin&quot;');
  });
});

describe('renderDocsSyncEntry (DUI-06 — syncs are rendered)', () => {
  it('renders a SYNC row with the sync path and stream shapes', () => {
    const html = renderDocsSyncEntry(syncFixture, false, esc, S);
    expect(html).toContain('class="method SYNC"');
    expect(html).toContain('sync/playground/streamBroadcast/v1');
    expect(html).toContain('{ text: string }');
    expect(html).toContain('{ chunk: string }');
  });

  it('omits "never" stream sections', () => {
    const html = renderDocsSyncEntry(syncFixture, false, esc, S);
    //? clientStream is "never" → no client-stream section.
    expect(html).not.toContain('client stream');
  });
});

describe('KNOWN_HTTP_METHODS', () => {
  it('is the 4-verb whitelist', () => {
    expect(KNOWN_HTTP_METHODS).toEqual(['GET', 'POST', 'PUT', 'DELETE']);
  });
});

describe('escapeHtml equivalence (DUI-19)', () => {
  it('the embedded escapeHtml matches core escapeHtml over a fixed corpus', () => {
    const corpus = [
      'plain', '<script>', '"quotes"', "it's", 'a & b', '<>&"\'',
      'mixed <b>"&\'</b>', '', '日本語<x>', String.fromCodePoint(0),
    ];
    for (const sample of corpus) {
      expect(docsEscapeHtml(sample)).toBe(coreEscapeHtml(sample));
    }
  });
});
