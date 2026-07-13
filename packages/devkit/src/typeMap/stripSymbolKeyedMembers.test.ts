import { describe, it, expect } from 'vitest';
import * as ts from 'typescript';
import { stripSymbolKeyedMembers } from './emitterArtifacts';

//? DEVKIT-1: MikroORM entities carry symbol-keyed members whose escaped name is
//? `__@<name>@<id>` — an invalid TS identifier `checker.typeToString` can leak
//? into the generated file. `stripSymbolKeyedMembers` removes them, brace-aware.

const parses = (text: string): boolean => {
  const wrapped = `type T = ${text};`;
  const sf = ts.createSourceFile('t.ts', wrapped, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  //? A syntactic error surfaces as a parse diagnostic on the source file.
  return (sf as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length === 0;
};

describe('stripSymbolKeyedMembers', () => {
  it('returns the input untouched when there is no __@ marker', () => {
    const input = '{\n  id: string;\n  name: string;\n}';
    expect(stripSymbolKeyedMembers(input)).toBe(input);
  });

  it('strips a symbol member in the MIDDLE and keeps the siblings', () => {
    const input = "{\n  id: string;\n  __@OptionalProps@1255?: undefined | 'isFullyCached' | 'recordCount';\n  name: string;\n}";
    const out = stripSymbolKeyedMembers(input);
    expect(out).not.toContain('__@');
    expect(out).toContain('id: string;');
    expect(out).toContain('name: string;');
    expect(parses(out)).toBe(true);
  });

  it('strips a symbol member that is LAST (no trailing semicolon)', () => {
    const input = '{\n  id: string;\n  __@loadedType@1542?: undefined | { a: string }\n}';
    const out = stripSymbolKeyedMembers(input);
    expect(out).not.toContain('__@');
    expect(out).toContain('id: string;');
    expect(parses(out)).toBe(true);
  });

  it('strips a symbol member whose value is a MULTI-LINE object literal', () => {
    const input = [
      '{',
      '  id: string;',
      '  __@selectedType@6338?: undefined | {',
      '    nested: string;',
      '    deep: number;',
      '  };',
      '  email: string;',
      '}',
    ].join('\n');
    const out = stripSymbolKeyedMembers(input);
    expect(out).not.toContain('__@');
    expect(out).not.toContain('nested: string');
    expect(out).toContain('id: string;');
    expect(out).toContain('email: string;');
    expect(parses(out)).toBe(true);
  });

  it('strips multiple symbol members in one object', () => {
    const input = "{\n  __@OptionalProps@1?: 'a';\n  id: string;\n  __@loadedType@2?: undefined;\n  __@selectedType@3?: undefined;\n}";
    const out = stripSymbolKeyedMembers(input);
    expect(out).not.toContain('__@');
    expect(out).toContain('id: string;');
    expect(parses(out)).toBe(true);
  });

  it('handles a symbol member as the ONLY member (empty object result)', () => {
    const input = '{\n  __@OptionalProps@1?: undefined;\n}';
    const out = stripSymbolKeyedMembers(input);
    expect(out).not.toContain('__@');
    expect(parses(out)).toBe(true);
  });

  it('strips nested-entity symbol members inside an array value', () => {
    const input = '{\n  posts: {\n    id: string;\n    __@OptionalProps@9?: undefined;\n  }[];\n}';
    const out = stripSymbolKeyedMembers(input);
    expect(out).not.toContain('__@');
    expect(out).toContain('posts:');
    expect(out).toContain('id: string;');
    expect(parses(out)).toBe(true);
  });
});
