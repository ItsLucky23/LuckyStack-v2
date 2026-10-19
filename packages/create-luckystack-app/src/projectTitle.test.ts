//? The project title comes from the raw project name (only the slug is
//? sanitised). It landed unescaped in `pageTitle: '…'` in config.ts, so
//? `"bob's app"` produced a config.ts that does not parse — and config.ts is
//? imported by both server and client. A backslash was swallowed as an escape.

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildTemplateVars, DEFAULT_CHOICES, escapeHtml, parseArgs, replacePlaceholders } from './index';

const TEMPLATE = path.resolve(import.meta.dirname, '..', 'template');

const varsFor = (projectName: string) =>
  buildTemplateVars('slug', parseArgs([projectName]), DEFAULT_CHOICES, '0.0.0');

const renderedPageTitleLiteral = (projectName: string): string => {
  const config = replacePlaceholders(fs.readFileSync(path.join(TEMPLATE, 'config.ts'), 'utf8'), varsFor(projectName));
  const match = /pageTitle: (.*),\n/.exec(config);
  if (!match?.[1]) throw new Error('pageTitle line not found in the rendered config.ts');
  return match[1];
};

//? Evaluate the rendered literal on its own: it must be ONE string literal whose
//? value is exactly the title (a stray quote would make this throw or differ).
const evaluateLiteral = (literal: string): unknown => new Function(`return ${literal};`)() as unknown;

describe('project title escaping', () => {
  it.each([
    ["bob's app", "Bob's App"],
    [String.raw`back\slash app`, String.raw`Back\slash App`],
    ["it's a 'quoted' \\ mix", String.raw`It's A 'quoted' \ Mix`],
  ])('renders %j into config.ts as a valid string literal', (projectName, title) => {
    const literal = renderedPageTitleLiteral(projectName);
    expect(literal.startsWith("'") && literal.endsWith("'")).toBe(true);
    expect(evaluateLiteral(literal)).toBe(title);
  });

  it('HTML-escapes the title in index.html', () => {
    const html = replacePlaceholders(fs.readFileSync(path.join(TEMPLATE, 'index.html'), 'utf8'), varsFor('<b>bob\'s</b> & co'));
    expect(html).toContain(`<title>${escapeHtml("<b>bob's</b> & Co")}</title>`);
    expect(html).toContain('<title>&lt;b&gt;bob&#39;s&lt;/b&gt; &amp; Co</title>');
  });

  it('leaves no unrendered title placeholder in config.ts or index.html', () => {
    for (const file of ['config.ts', 'index.html']) {
      const rendered = replacePlaceholders(fs.readFileSync(path.join(TEMPLATE, file), 'utf8'), varsFor('my app'));
      expect(rendered).not.toMatch(/{{PROJECT_TITLE\w*}}/);
    }
  });
});
