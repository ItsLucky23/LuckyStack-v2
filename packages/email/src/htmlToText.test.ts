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
});
