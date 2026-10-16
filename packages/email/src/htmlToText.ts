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
  euro: '€',
  copy: '©',
  reg: '®',
  trade: '™',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  bull: '•',
  middot: '·',
};

//? Marks the end of a table cell until lines are split; a control character
//? that never belongs in mail text.
const CELL_END = String.fromCodePoint(0x1F);

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

//? `[^<>]`, not `[^>]`: an unclosed `<` then stops at the next tag instead of
//? scanning to the end of the text once per `<`.
const stripTags = (html: string): string => html.replaceAll(/<[^<>]*>/g, '');

/**
 * Turn mail HTML into readable plain text: drops `<head>`, `<style>` and
 * `<script>`, turns breaks and block ends into newlines, list items into
 * `- ` lines, and a link into `label (url)` when the label is not the URL.
 * Table cells of one row are joined with ` | `; empty cells (layout spacers)
 * are dropped.
 */
export const htmlToText = (html: string): string => {
  const text = html
    .replaceAll(CELL_END, '')
    //? A line break in the source is whitespace, as in a browser; lines come
    //? from tags only. Otherwise cells written on separate source lines would
    //? never share a text line.
    .replaceAll(/[\r\n]+/g, ' ')
    .replaceAll(/<(head|style|script)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replaceAll(/<!--[\s\S]*?-->/g, '')
    //? Every part is bounded by the next `<`, `>`, quote or anchor tag, so
    //? unclosed anchors cost linear time: the label cannot run past another
    //? `<a`, and the attributes and href cannot run past a tag boundary.
    .replaceAll(
      /<a\b[^<>]*?\bhref\s*=\s*(?:"([^"<>]*)"|'([^'<>]*)')[^<>]*>([^<]*(?:<(?!\/?a\b)[^<]*)*)<\/a\s*>/gi,
      (_match, doubleQuoted: string | undefined, singleQuoted: string | undefined, inner: string) => {
        const label = decodeEntities(stripTags(inner)).trim();
        const url = decodeEntities(doubleQuoted ?? singleQuoted ?? '').trim();
        if (label.length === 0) return url;
        return label === url || url.length === 0 || url.startsWith('#') ? label : `${label} (${url})`;
      },
    )
    .replaceAll(/<br\s*\/?>/gi, '\n')
    .replaceAll(/<li\b[^>]*>/gi, '\n- ')
    .replaceAll(/<\/t[dh]\s*>/gi, () => CELL_END)
    //? No `</li>`: the next `<li>` already starts a new line.
    .replaceAll(/<\/(p|div|h[1-6]|tr|table|ul|ol|blockquote|section|header|footer)\s*>/gi, '\n')
    //? No `<tr>`: the previous `</tr>` already ends the row, so rows stay on
    //? consecutive lines.
    .replaceAll(/<(p|div|h[1-6]|table|blockquote)\b[^>]*>/gi, '\n');

  return stripTags(text)
    .split('\n')
    //? Entities are decoded per cell, after splitting, so an encoded character
    //? can never act as a line or cell break. `\s` also covers the
    //? non-breaking space that `&nbsp;` decodes into.
    .map((line) => line
      .split(CELL_END)
      .map((cell) => decodeEntities(cell).replaceAll(/\s+/g, ' ').trim())
      .filter((cell) => cell.length > 0)
      .join(' | '))
    .join('\n')
    .replaceAll(/\n{3,}/g, '\n\n')
    .trim();
};
