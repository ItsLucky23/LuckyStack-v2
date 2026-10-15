import { Linter } from 'eslint';
import { describe, it, expect } from 'vitest';

import luckystackConfig, { rules } from '../index';
import rule from './no-untranslated-jsx-text';

const RULE_ID = 'luckystack/no-untranslated-jsx-text';

const linter = new Linter();

const lint = (code: string, options?: { allowedStrings: string[] }) =>
  linter.verify(code, {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { luckystack: { rules: { 'no-untranslated-jsx-text': rule } } },
    rules: { [RULE_ID]: options ? ['warn', options] : 'warn' },
  });

const reported = (code: string, options?: { allowedStrings: string[] }): string[] =>
  lint(code, options).map((m) => {
    expect(m.ruleId).toBe(RULE_ID);
    return m.message;
  });

describe('luckystack/no-untranslated-jsx-text', () => {
  describe('reports text children', () => {
    it('plain JSX text', () => {
      expect(reported('const a = <p>Hello world</p>;')).toEqual([
        'Untranslated text in JSX: "Hello world". Put user-facing text through the project translator (`useTranslator`) so every language gets it.',
      ]);
    });

    it('text inside a fragment', () => {
      expect(reported('const a = <>Save</>;')).toHaveLength(1);
    });

    it('a string literal as a `{…}` child', () => {
      expect(reported("const a = <p>{'Save'}</p>;")).toHaveLength(1);
    });

    it('both pieces of a string concatenation child', () => {
      expect(reported("const a = <p>{'Hello ' + name + '!'}</p>;")).toHaveLength(1);
    });

    it('a template literal child', () => {
      expect(reported('const a = <p>{`Hello ${name}`}</p>;')).toHaveLength(1);
    });

    it('each text run separately', () => {
      expect(reported('const a = <p>Hello <b>{name}</b> welcome</p>;')).toHaveLength(2);
    });
  });

  describe('allows', () => {
    it('translated text', () => {
      expect(reported("const a = <p>{translate({ key: 'home.title' })}</p>;")).toEqual([]);
    });

    it('attribute values (props)', () => {
      expect(reported('const a = <input placeholder="Name" title={\'Title\'} aria-label={`x ${y}`} />;')).toEqual([]);
    });

    it('whitespace-only text between elements', () => {
      expect(reported('const a = (\n  <div>\n    <span>{x}</span>\n  </div>\n);')).toEqual([]);
    });

    it.each(['-', '|', ' • ', '...', '10', 'px', '°', '—'])('default allow-list entry %j', (text) => {
      expect(reported(`const a = <p>${text}</p>;`)).toEqual([]);
    });

    it('non-string literals', () => {
      expect(reported('const a = <p>{42}{null}{true}</p>;')).toEqual([]);
    });

    it('strings outside JSX', () => {
      expect(reported("const label = 'Save'; const a = <p>{label}</p>;")).toEqual([]);
    });

    it('ternary and logical branches (not inspected, as before)', () => {
      expect(reported("const a = <p>{ok ? 'Yes' : 'No'}{busy && 'Busy'}</p>;")).toEqual([]);
    });
  });

  describe('allowedStrings option', () => {
    it('replaces the default list', () => {
      expect(reported('const a = <p>OK</p>;', { allowedStrings: ['OK'] })).toEqual([]);
      expect(reported('const a = <p>-</p>;', { allowedStrings: ['OK'] })).toHaveLength(1);
    });

    it('compares after trimming', () => {
      expect(reported('const a = <p> OK </p>;', { allowedStrings: ['OK '] })).toEqual([]);
    });
  });

  it('is registered and on as a warning in the default config', () => {
    expect(rules['no-untranslated-jsx-text']).toBe(rule);
    expect(luckystackConfig[0]?.rules?.[RULE_ID]).toBe('warn');
  });
});
