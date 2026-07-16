import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { getOutputTypeDetailsFromFile } from './extractors';
import { getServerProgram } from './tsProgram';

const FIXTURES = path.join(import.meta.dirname, '__fixtures__');
const EDGE_ROUTE = path.join(FIXTURES, 'wireEdgeRoute_v1.ts');
const BINARY_ROUTE = path.join(FIXTURES, 'binaryOutputRoute_v1.ts');

beforeAll(() => {
  getServerProgram();
}, 180_000);

describe('wire projection — JSON omission and transport-dependent outputs', () => {
  it('omits undefined/function properties, makes mixed values optional, and nulls tuple slots', () => {
    const output = getOutputTypeDetailsFromFile(EDGE_ROUTE).text;

    expect(output).not.toContain('alwaysMissing');
    expect(output).not.toContain('callableWithData');
    expect(output).toContain('maybeValue?: string');
    expect(output).toContain('list: [null, null]');
  });

  it('rejects Buffer instead of claiming one shape for incompatible HTTP/socket transports', () => {
    expect(() => getOutputTypeDetailsFromFile(BINARY_ROUTE)).toThrow(
      /Buffer has transport-dependent or non-JSON output semantics/,
    );
  });
});
