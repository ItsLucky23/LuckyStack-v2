import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { getOutputTypeDetailsFromFile } from './extractors';
import { getServerProgram } from './tsProgram';

const FIXTURES = path.join(import.meta.dirname, '__fixtures__');
const EXTRACTION_TIMEOUT_MS = 120_000;

const outputFor = (name: string): string => {
  const output = getOutputTypeDetailsFromFile(path.join(FIXTURES, name));
  expect(output.unresolvedSymbols).toEqual([]);
  expect(output.text).not.toMatch(/:\s*Date\b/);
  expect(output.text).not.toContain('__@');
  expect(output.text).not.toMatch(/:\s*any\b/);
  return output.text;
};

beforeAll(() => {
  getServerProgram();
}, 180_000);

describe('wire projection — real ORM type matrix', () => {
  it('preserves a deep Prisma GetResult graph and projects each Date without collapsing a JsonValue-bearing model', () => {
    const output = outputFor('prismaDeepRoute_v1.ts');

    expect(output.match(/createdAt: string/g)).toHaveLength(4);
    expect(output.match(/preferences: JsonValue/g)).toHaveLength(4);
    expect(output).toContain('departments: {');
    expect(output).toContain('employees: {');
    expect(output).toContain('manager: {');
    expect(output).not.toMatch(/company:\s*JsonValue/);
  }, EXTRACTION_TIMEOUT_MS);

  it('keeps Prisma JsonValue stable through the scaffold SessionLayout Jsonify wrapper', () => {
    const output = outputFor('prismaJsonifySessionRoute_v1.ts');

    expect(output).toContain('preferences: JsonValue');
    expect(output).toContain('createdAt: string');
    expect(output).toContain('lastLogin: null | string');
    expect(output).not.toContain('...');
  }, EXTRACTION_TIMEOUT_MS);

  it('preserves Drizzle relational-query inference across three levels', () => {
    const output = outputFor('drizzleDeepRoute_v1.ts');

    expect(output.match(/createdAt: string/g)).toHaveLength(3);
    expect(output).toContain('departments: {');
    expect(output).toContain('employees: {');
    expect(output).toContain('companyId: string');
    expect(output).toContain('departmentId: string');
    expect(output).not.toContain('SQLiteColumn');
  }, EXTRACTION_TIMEOUT_MS);

  it('preserves a populated MikroORM EntityDTO graph while keeping Ref back-references as primary keys', () => {
    const output = outputFor('mikroDeepDtoRoute_v1.ts');

    expect(output.match(/createdAt: string/g)).toHaveLength(3);
    expect(output).toContain('departments: ({');
    expect(output).toContain('employees: ({');
    expect(output).toContain('company: string');
    expect(output).toContain('department: string');
    expect(output).toContain('manager?: null | string');
    expect(output).not.toContain('EntityProperty');
    expect(output).not.toContain('EntityMetadata');
  }, EXTRACTION_TIMEOUT_MS);
});
