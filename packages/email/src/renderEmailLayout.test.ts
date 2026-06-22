import { describe, it, expect } from 'vitest';

import { renderEmailLayout } from './renderEmailLayout';

//? `renderEmailLayout` is a pure string builder — no registry, no env, no
//? infra. Every assertion targets a single branch of the optional-field /
//? escaping logic so the cause of a failure is unambiguous.

describe('renderEmailLayout', () => {
  it('renders the title into the <title>, the H1 heading, and the text body', () => {
    const { html, text } = renderEmailLayout({ title: 'Reset', intro: 'Hello there' });
    expect(html).toContain('<title>Reset</title>');
    expect(html).toContain('>Reset</h1>');
    expect(html).toContain('Hello there');
    expect(text).toContain('Reset');
    expect(text).toContain('Hello there');
  });

  it('omits the CTA block when only ctaLabel is supplied (needs both label and url)', () => {
    const { html, text } = renderEmailLayout({ title: 'T', intro: 'I', ctaLabel: 'Click' });
    expect(html).not.toContain('Click');
    expect(text).not.toContain('Click');
  });

  it('omits the CTA block when only ctaUrl is supplied (needs both label and url)', () => {
    const { html } = renderEmailLayout({ title: 'T', intro: 'I', ctaUrl: 'https://x.test' });
    expect(html).not.toContain('https://x.test');
  });

  it('renders a CTA button with the default accent when both ctaLabel and ctaUrl are present', () => {
    const { html, text } = renderEmailLayout({
      title: 'T',
      intro: 'I',
      ctaLabel: 'Reset password',
      ctaUrl: 'https://app.test/reset?token=abc',
    });
    expect(html).toContain('href="https://app.test/reset?token=abc"');
    expect(html).toContain('Reset password');
    expect(html).toContain('background:#3B82F6'); // default accent
    // Plain-text fallback joins label + url on one line.
    expect(text).toContain('Reset password: https://app.test/reset?token=abc');
  });

  it('uses a custom accent color in both the heading button background', () => {
    const { html } = renderEmailLayout({
      title: 'T',
      intro: 'I',
      ctaLabel: 'Go',
      ctaUrl: 'https://x.test',
      accent: '#FF0000',
    });
    expect(html).toContain('background:#FF0000');
    expect(html).not.toContain('background:#3B82F6');
  });

  it('renders brand, outro, and footer when supplied', () => {
    const { html, text } = renderEmailLayout({
      title: 'T',
      intro: 'I',
      brand: 'Acme',
      outro: 'If you did not request this, ignore it.',
      footer: 'Acme Inc, 123 St',
    });
    expect(html).toContain('Acme');
    expect(html).toContain('If you did not request this, ignore it.');
    expect(html).toContain('Acme Inc, 123 St');
    // Text body carries brand first, then a `---` divider before the footer.
    expect(text).toContain('Acme');
    expect(text).toContain('---');
    expect(text).toContain('Acme Inc, 123 St');
  });

  it('omits the footer row from the HTML when footer is absent', () => {
    const { html, text } = renderEmailLayout({ title: 'T', intro: 'I' });
    expect(html).not.toContain('border-top:1px solid #e5e5e5');
    expect(text).not.toContain('---');
  });

  it('escapes HTML metacharacters in user-supplied fields to prevent injection', () => {
    const { html } = renderEmailLayout({
      title: '<script>alert(1)</script>',
      intro: 'a & b "c" \'d\' <e>',
    });
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('a &amp; b &quot;c&quot; &#39;d&#39; &lt;e&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('does NOT escape the raw text fallback (text is not HTML)', () => {
    const { text } = renderEmailLayout({ title: '<b>', intro: 'a & b' });
    // Text uses the raw `title`/`intro`, not the escaped variants.
    expect(text).toContain('<b>');
    expect(text).toContain('a & b');
  });

  it('HTML-escapes the ctaUrl in the href attribute (ampersands become &amp;)', () => {
    //? After EMAIL-O3 the href is passed through escapeHtml so `&` in query
    //? strings becomes `&amp;` — correct HTML, still correct for click-through.
    const { html } = renderEmailLayout({
      title: 'T',
      intro: 'I',
      ctaLabel: 'Go',
      ctaUrl: 'https://x.test/?a=1&b=2',
    });
    expect(html).toContain('href="https://x.test/?a=1&amp;b=2"');
    expect(html).not.toContain('href="https://x.test/?a=1&b=2"');
  });

  it('suppresses the CTA block when ctaUrl has a disallowed scheme (EMAIL-O3)', () => {
    const { html, text } = renderEmailLayout({
      title: 'T',
      intro: 'I',
      ctaLabel: 'Click me',
      ctaUrl: 'javascript:alert(1)',
    });
    expect(html).not.toContain('Click me');
    expect(html).not.toContain('javascript:');
    expect(text).not.toContain('Click me');
  });

  it('suppresses the CTA block when ctaUrl is not a parseable URL (EMAIL-O3)', () => {
    const { html } = renderEmailLayout({
      title: 'T',
      intro: 'I',
      ctaLabel: 'Click',
      ctaUrl: 'not a url at all',
    });
    expect(html).not.toContain('Click');
  });

  it('falls back to the default accent when accent contains CSS injection characters (EMAIL-O3)', () => {
    const { html } = renderEmailLayout({
      title: 'T',
      intro: 'I',
      ctaLabel: 'Go',
      ctaUrl: 'https://x.test',
      accent: 'red;color:black',
    });
    // Malicious value is replaced with the safe default.
    expect(html).not.toContain('red;color:black');
    expect(html).toContain('background:#3B82F6');
  });
});
