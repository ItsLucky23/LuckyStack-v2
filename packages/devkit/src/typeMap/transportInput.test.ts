import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { getInputTypeDetailsFromFile, getSyncClientDataTypeDetailsFromFile } from './extractors';
import { getServerProgram } from './tsProgram';

const FIXTURES = path.join(import.meta.dirname, '__fixtures__');
const API_ROUTE = path.join(FIXTURES, 'dateInputRoute_v1.ts');
const SYNC_ROUTE = path.join(FIXTURES, 'dateInputSync_server_v1.ts');

beforeAll(() => {
  getServerProgram();
}, 180_000);

describe('transport inputs reject Date annotations', () => {
  it('fails API generation with an actionable wire-contract message', () => {
    expect(() => getInputTypeDetailsFromFile(API_ROUTE)).toThrow(
      /JSON delivers an ISO string; declare string and validate\/convert it explicitly/,
    );
  });

  it('applies the same fail-fast contract to sync clientInput', () => {
    expect(() => getSyncClientDataTypeDetailsFromFile(SYNC_ROUTE)).toThrow(
      /declares Date in a transport input/,
    );
  });
});
