import { describe, expect, it } from 'vitest';

import { htmlToText } from './htmlToText';

describe('htmlToText', () => {
  it('turns paragraphs, breaks and headings into lines', () => {
    expect(htmlToText('<h1>Factuur</h1><p>Beste Ann,<br>bedrag € 10.</p><p>Groet</p>'))
      .toBe('Factuur\n\nBeste Ann,\nbedrag € 10.\n\nGroet');
  });

  it('drops head, style, script and comments', () => {
    expect(htmlToText('<html><head><title>T</title><style>p{color:red}</style></head><body><!-- x --><script>alert(1)</script><p>Hi</p></body></html>'))
      .toBe('Hi');
  });

  it('keeps a link target next to its label unless they are the same', () => {
    expect(htmlToText('<p><a href="https://app.test/pay?id=1&amp;x=2">Betaal nu</a></p>'))
      .toBe('Betaal nu (https://app.test/pay?id=1&x=2)');
    expect(htmlToText('<a href="https://app.test">https://app.test</a>')).toBe('https://app.test');
    expect(htmlToText('<a href="https://app.test"><img src="logo.png"></a>')).toBe('https://app.test');
  });

  it('renders list items as dash lines', () => {
    expect(htmlToText('<ul><li>Een</li><li>Twee</li></ul>')).toBe('- Een\n- Twee');
  });

  it('decodes entities, including escaped token values, without re-parsing them as tags', () => {
    expect(htmlToText('<p>&lt;Ann&gt; &amp; &quot;Bob&quot; &#39;x&#39; &#x263A; &nbsp;ok</p>')).toBe(`<Ann> & "Bob" 'x' ☺ ok`);
  });

  it('collapses runs of whitespace and blank lines', () => {
    expect(htmlToText('<div>  a   b  </div>\n\n\n\n<div>c</div>')).toBe('a b\n\nc');
  });

  it('leaves unknown or invalid entities as they are', () => {
    expect(htmlToText('&bogus; &#0; &#xFFFFFFF;')).toBe('&bogus; &#0; &#xFFFFFFF;');
  });

  it('decodes common named entities', () => {
    expect(htmlToText('&euro; 10 &ndash; &copy; &reg; &trade; &mdash; &hellip; &lsquo;a&rsquo; &ldquo;b&rdquo; &laquo;c&raquo; &bull; &middot;'))
      .toBe('€ 10 – © ® ™ — … ‘a’ “b” «c» • ·');
  });

  it('separates table cells and drops empty layout cells', () => {
    expect(htmlToText('<table><tr><th>Invoice</th><th>Amount</th></tr><tr><td>2026-001</td>\n<td>&euro; 10</td><td> </td></tr></table>'))
      .toBe('Invoice | Amount\n2026-001 | € 10');
    expect(htmlToText('<table>\n  <tr>\n    <td>\n      Total\n    </td>\n    <td>€ 10</td>\n  </tr>\n</table>')).toBe('Total | € 10');
    //? An encoded or raw cell marker in the input does not split a cell.
    expect(htmlToText(`<td>a&#31;b\u001Fc</td>`)).toBe('a\u001Fbc');
  });

  it('handles unclosed anchors and tags in linear time', () => {
    const start = performance.now();
    htmlToText('<a href="x">'.repeat(20_000));
    htmlToText('<a href="x'.repeat(20_000));
    expect(performance.now() - start).toBeLessThan(1000);
    expect(htmlToText('<a href="x">a <a href="y">b</a>')).toBe('a b (y)');
  });
});
