import assert from 'node:assert/strict';
import path from 'node:path';
import { getOutputTypeDetailsFromFile } from '../packages/devkit/src/typeMap/extractors';

const FIXTURES = path.resolve('packages/devkit/src/typeMap/__fixtures__');
const runtime = 'Bun' in globalThis ? 'bun' : 'node';

const extract = (file: string): string => {
  const output = getOutputTypeDetailsFromFile(path.join(FIXTURES, file));
  assert.deepEqual(output.unresolvedSymbols, [], `${file}: unresolved symbols`);
  assert.doesNotMatch(output.text, /:\s*Date\b/, `${file}: Date leaked to the wire type`);
  assert.doesNotMatch(output.text, /:\s*any\b/, `${file}: output degraded to any`);
  assert.doesNotMatch(output.text, /__@/, `${file}: symbol-keyed ORM internals leaked`);
  return output.text;
};

const prisma = extract('prismaDeepRoute_v1.ts');
assert.equal(prisma.match(/createdAt: string/g)?.length, 4);
assert.equal(prisma.match(/preferences: JsonValue/g)?.length, 4);
assert.doesNotMatch(prisma, /company:\s*JsonValue/);

const prismaSession = extract('prismaJsonifySessionRoute_v1.ts');
assert.match(prismaSession, /preferences: JsonValue/);
assert.match(prismaSession, /createdAt: string/);
assert.match(prismaSession, /lastLogin: null \| string/);
assert.doesNotMatch(prismaSession, /\.\.\./);

const drizzle = extract('drizzleDeepRoute_v1.ts');
assert.equal(drizzle.match(/createdAt: string/g)?.length, 3);
assert.match(drizzle, /companyId: string/);
assert.match(drizzle, /departmentId: string/);

const mikro = extract('mikroDeepDtoRoute_v1.ts');
assert.equal(mikro.match(/createdAt: string/g)?.length, 3);
assert.match(mikro, /company: string/);
assert.match(mikro, /department: string/);
assert.match(mikro, /manager\?: null \| string/);

//? Runtime ground truth for the serializer shared by API output and Socket.io's
//? JSON path: every nested Date becomes an ISO string while JSON-compatible ORM
//? scalar values and relation arrays retain their shape.
const source = {
  id: 'c1',
  createdAt: new Date('2026-07-16T10:00:00.000Z'),
  preferences: { locale: 'nl' },
  departments: [{
    id: 'd1',
    createdAt: new Date('2026-07-16T10:01:00.000Z'),
    employees: [{
      id: 'e1',
      createdAt: new Date('2026-07-16T10:02:00.000Z'),
    }],
  }],
};
const serialized = JSON.parse(JSON.stringify(source)) as {
  createdAt: unknown;
  preferences: unknown;
  departments: { createdAt: unknown; employees: { createdAt: unknown }[] }[];
};
assert.equal(serialized.createdAt, '2026-07-16T10:00:00.000Z');
assert.equal(serialized.departments[0]?.createdAt, '2026-07-16T10:01:00.000Z');
assert.equal(serialized.departments[0]?.employees[0]?.createdAt, '2026-07-16T10:02:00.000Z');
assert.deepEqual(serialized.preferences, { locale: 'nl' });

console.log(`[orm-wire] ${runtime}: Prisma, Drizzle, MikroORM deep projection + Date serialization passed`);
