//? Plain-text alternative for a batch mail that has HTML but no text body. A
//? multipart mail with a text part is less likely to be filed as spam, and
//? text-only clients get something readable. Deliberately rough: mail HTML is
//? simple, and a full HTML parser is not worth a dependency here.

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: String.fromCodePoint(0xA0),
};

const decodeEntities = (text: string): string =>
  text.replaceAll(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith('#')) {
      const isHex = entity[1] === 'x' || entity[1] === 'X';
      const codePoint = Number.parseInt(entity.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      return Number.isInteger(codePoint) && codePoint > 0 && codePoint <= 0x10_FF_FF
        ? String.fromCodePoint(codePoint)
        : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });

const stripTags = (html: string): string => html.replaceAll(/<[^>]*>/g, '');

/**
 * Turn mail HTML into readable plain text: drops `<head>`, `<style>` and
 * `<script>`, turns breaks and block ends into newlines, list items into
 * `- ` lines, and a link into `label (url)` when the label is not the URL.
 */
export const htmlToText = (html: string): string => {
  const text = html
    .replaceAll(/<(head|style|script)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replaceAll(/<!--[\s\S]*?-->/g, '')
    .replaceAll(/<a\b[^>]*?\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a\s*>/gi, (_match, _quote: string, href: string, inner: string) => {
      const label = decodeEntities(stripTags(inner)).trim();
      const url = decodeEntities(href).trim();
      if (label.length === 0) return url;
      return label === url || url.length === 0 || url.startsWith('#') ? label : `${label} (${url})`;
    })
    .replaceAll(/<br\s*\/?>/gi, '\n')
    .replaceAll(/<li\b[^>]*>/gi, '\n- ')
    //? No `</li>`: the next `<li>` already starts a new line.
    .replaceAll(/<\/(p|div|h[1-6]|tr|table|ul|ol|blockquote|section|header|footer)\s*>/gi, '\n')
    .replaceAll(/<(p|div|h[1-6]|tr|table|blockquote)\b[^>]*>/gi, '\n');

  return decodeEntities(stripTags(text))
    .split('\n')
    //? `\s` also covers the non-breaking space that `&nbsp;` decodes into.
    .map((line) => line.replaceAll(/\s+/g, ' ').trim())
    .join('\n')
    .replaceAll(/\n{3,}/g, '\n\n')
    .trim();
};
