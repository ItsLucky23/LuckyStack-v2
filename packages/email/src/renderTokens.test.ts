import { describe, expect, it } from 'vitest';

import { renderTokens } from './renderTokens';

describe('renderTokens', () => {
  it('replaces tokens by exact key, tolerating spaces inside the braces', () => {
    expect(renderTokens('Hi {{name}}, ref {{ order.id }}!', { name: 'Sam', 'order.id': 42 }))
      .toBe('Hi Sam, ref 42!');
  });

  it('accepts dashes, underscores, digits and non-ASCII letters in names', () => {
    expect(renderTokens('{{first-name}} {{last_name}} {{line2}} {{straße}}', {
      'first-name': 'A', last_name: 'B', line2: 'C', straße: 'D',
    })).toBe('A B C D');
  });

  it('prefers the exact key and falls back to a case-insensitive match', () => {
    expect(renderTokens('{{Name}}', { name: 'lower', Name: 'exact' })).toBe('exact');
    expect(renderTokens('{{ReceiverEmail}}', { receiveremail: 'a@b.test' })).toBe('a@b.test');
  });

  it('leaves an unknown token literally in place', () => {
    expect(renderTokens('Hi {{nmae}}', { name: 'Sam' })).toBe('Hi {{nmae}}');
  });

  it('renders an empty string as empty but leaves null and undefined values as the token', () => {
    expect(renderTokens('[{{a}}][{{b}}][{{c}}]', { a: '', b: null, c: undefined })).toBe('[][{{b}}][{{c}}]');
  });

  it('does not resolve tokens to Object.prototype members', () => {
    expect(renderTokens('{{constructor}} {{toString}} {{__proto__}}', {}))
      .toBe('{{constructor}} {{toString}} {{__proto__}}');
  });

  it('HTML-escapes values by default and leaves them raw with escape none', () => {
    const values = { v: `<b>"Tom" & 'Jo'</b>` };
    expect(renderTokens('{{v}}', values)).toBe('&lt;b&gt;&quot;Tom&quot; &amp; &#39;Jo&#39;&lt;/b&gt;');
    expect(renderTokens('{{v}}', values, { escape: 'none' })).toBe(values.v);
  });

  it('never re-expands a token that appears inside a substituted value', () => {
    expect(renderTokens('{{a}}', { a: '{{b}}', b: 'leak' }, { escape: 'none' })).toBe('{{b}}');
  });

  it('ignores malformed tokens and tokens spanning a newline', () => {
    expect(renderTokens('{{}} {{a b}} {{\na}} {a}', { a: 'x' })).toBe('{{}} {{a b}} {{\na}} {a}');
  });
});
