import { describe, it, expect } from 'vitest';

import { renderDocsHtml } from './docsHtml';

//? `renderDocsHtml` is pure: it takes a JSON-endpoint path + page title +
//? options and returns a self-contained HTML document string. No I/O, no
//? registry, no env reads — so we assert directly on the produced markup.
//? We check structural markers (doctype, title, embedded JSON_PATH/flag),
//? the branding-driven CSS variables, the conditional logo/try-it-out
//? branches, and HTML-escaping of injected values.

describe('renderDocsHtml', () => {
  it('produces a complete HTML document with the page title in <title> and <h1>', () => {
    const html = renderDocsHtml('/_docs/api.json', 'My API Docs');
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<title>My API Docs</title>');
    expect(html).toContain('<h1>My API Docs</h1>');
    expect(html.trimEnd().endsWith('</html>')).toBe(true);
  });

  it('embeds the JSON path argument both in the client script and the raw-JSON link', () => {
    const jsonPath = '/custom-docs/api.json';
    const html = renderDocsHtml(jsonPath, 'Title');
    //? The fetch target is injected as a JSON.stringify literal for the script.
    expect(html).toContain(`const JSON_PATH = ${JSON.stringify(jsonPath)};`);
    //? And surfaced as a clickable link in the page lead.
    expect(html).toContain(`href="${jsonPath}"`);
  });

  it('defaults the accent color and font when no branding is provided', () => {
    const html = renderDocsHtml('/_docs/api.json', 'Title');
    expect(html).toContain('--accent: #58a6ff;');
    expect(html).toContain('--font-family: system-ui, -apple-system');
  });

  it('applies a custom brand color into the accent CSS variable', () => {
    const html = renderDocsHtml('/_docs/api.json', 'Title', {
      branding: { brandColor: '#ff0000' },
    });
    expect(html).toContain('--accent: #ff0000;');
    //? The accent also feeds the POST method swatch variable.
    expect(html).toContain('--post: #ff0000;');
  });

  it('applies a custom font family into the font CSS variable', () => {
    const html = renderDocsHtml('/_docs/api.json', 'Title', {
      branding: { fontFamily: 'Comic Sans MS, cursive' },
    });
    expect(html).toContain('--font-family: Comic Sans MS, cursive;');
  });

  it('renders a logo <img> when a logoUrl is supplied', () => {
    const html = renderDocsHtml('/_docs/api.json', 'Title', {
      branding: { logoUrl: 'https://cdn.example.com/logo.svg' },
    });
    expect(html).toContain('<img src="https://cdn.example.com/logo.svg"');
    expect(html).toContain('alt="logo"');
  });

  it('omits the logo markup entirely when no logoUrl is supplied', () => {
    const html = renderDocsHtml('/_docs/api.json', 'Title');
    //? The brand-row exists but contains only the <h1> when there is no logo.
    expect(html).toContain('<div class="brand-row"><h1>Title</h1></div>');
    expect(html).not.toContain('alt="logo"');
  });

  it('sets the try-it-out flag to false by default', () => {
    const html = renderDocsHtml('/_docs/api.json', 'Title');
    expect(html).toContain('const ENABLE_TRY_IT_OUT = false;');
  });

  it('sets the try-it-out flag to true when enableTryItOut is on', () => {
    const html = renderDocsHtml('/_docs/api.json', 'Title', { enableTryItOut: true });
    expect(html).toContain('const ENABLE_TRY_IT_OUT = true;');
  });

  it('HTML-escapes the page title to prevent markup injection', () => {
    const html = renderDocsHtml('/_docs/api.json', '<script>alert(1)</script>');
    expect(html).toContain('<title>&lt;script&gt;alert(1)&lt;/script&gt;</title>');
    //? The raw, unescaped tag must never appear in the title position.
    expect(html).not.toContain('<title><script>');
  });

  it('HTML-escapes the logo URL attribute', () => {
    const html = renderDocsHtml('/_docs/api.json', 'Title', {
      branding: { logoUrl: '"/><script>x</script>' },
    });
    expect(html).toContain('&quot;/&gt;&lt;script&gt;x&lt;/script&gt;');
    expect(html).not.toContain('<img src=""/><script>x</script>"');
  });

  it('HTML-escapes the JSON-link href and label', () => {
    const html = renderDocsHtml('/_docs/api.json?<x>', 'Title');
    //? Both the href and the visible label go through escapeHtml.
    expect(html).toContain('/_docs/api.json?&lt;x&gt;');
  });
});
