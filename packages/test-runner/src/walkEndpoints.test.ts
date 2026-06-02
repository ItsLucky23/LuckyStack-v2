import { describe, it, expect } from 'vitest';

import { walkEndpoints } from './walkEndpoints';
import type { EndpointDescriptor } from './types';

//? `walkEndpoints` is a pure transform: the nested generated `apiMethodMap`
//? (page -> name -> version -> method) flattened into `EndpointDescriptor[]`.
//? No infra, no @luckystack/core import — the map is passed in directly, so
//? every branch (nullish nameMap / versionMap, undefined method, ordering,
//? fullPath shape) is deterministically exercisable.

describe('walkEndpoints', () => {
  it('returns an empty array for an empty map', () => {
    expect(walkEndpoints({})).toEqual([]);
  });

  it('flattens a single page/name/version into one descriptor', () => {
    const result = walkEndpoints({
      billing: { getInvoice: { v1: 'GET' } },
    });
    expect(result).toEqual<EndpointDescriptor[]>([
      {
        page: 'billing',
        name: 'getInvoice',
        version: 'v1',
        method: 'GET',
        fullPath: 'api/billing/getInvoice/v1',
      },
    ]);
  });

  it('builds fullPath as api/<page>/<name>/<version>', () => {
    const [endpoint] = walkEndpoints({
      vehicles: { listAll: { v3: 'POST' } },
    });
    expect(endpoint?.fullPath).toBe('api/vehicles/listAll/v3');
  });

  it('carries the method through verbatim', () => {
    const result = walkEndpoints({
      users: {
        create: { v1: 'POST' },
        remove: { v1: 'DELETE' },
        update: { v1: 'PUT' },
        read: { v1: 'GET' },
      },
    });
    const byName = Object.fromEntries(result.map((e) => [e.name, e.method]));
    expect(byName).toEqual({
      create: 'POST',
      remove: 'DELETE',
      update: 'PUT',
      read: 'GET',
    });
  });

  it('emits one descriptor per version of the same name', () => {
    const result = walkEndpoints({
      billing: { getInvoice: { v1: 'GET', v2: 'POST' } },
    });
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.version)).toEqual(['v1', 'v2']);
    expect(result.map((e) => e.fullPath)).toEqual([
      'api/billing/getInvoice/v1',
      'api/billing/getInvoice/v2',
    ]);
  });

  it('walks multiple pages and names into a flat list', () => {
    const result = walkEndpoints({
      billing: { getInvoice: { v1: 'GET' }, pay: { v1: 'POST' } },
      vehicles: { listAll: { v1: 'GET' } },
    });
    expect(result).toHaveLength(3);
    expect(result.map((e) => e.fullPath).sort()).toEqual([
      'api/billing/getInvoice/v1',
      'api/billing/pay/v1',
      'api/vehicles/listAll/v1',
    ]);
  });

  it('skips a page whose nameMap is undefined', () => {
    const result = walkEndpoints({
      billing: undefined,
      vehicles: { listAll: { v1: 'GET' } },
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.page).toBe('vehicles');
  });

  it('skips a name whose versionMap is undefined', () => {
    const result = walkEndpoints({
      billing: { getInvoice: undefined, pay: { v1: 'POST' } },
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('pay');
  });

  it('skips a version whose method is undefined', () => {
    const result = walkEndpoints({
      billing: { getInvoice: { v1: undefined, v2: 'GET' } },
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.version).toBe('v2');
  });

  it('produces an empty list when every page maps to undefined', () => {
    expect(walkEndpoints({ a: undefined, b: undefined })).toEqual([]);
  });

  it('preserves insertion order of pages, names, and versions', () => {
    const result = walkEndpoints({
      zeta: { b: { v1: 'GET' }, a: { v1: 'GET' } },
      alpha: { x: { v2: 'GET', v1: 'GET' } },
    });
    expect(result.map((e) => e.fullPath)).toEqual([
      'api/zeta/b/v1',
      'api/zeta/a/v1',
      'api/alpha/x/v2',
      'api/alpha/x/v1',
    ]);
  });
});
