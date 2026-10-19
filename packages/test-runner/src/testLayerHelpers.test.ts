import { describe, it, expect } from 'vitest';

import { createHttpProbeTransport, defaultProbeTransport } from './probeRequest';
import { hasSessionHeaders, metaMapFor, selectEndpoints, transportFor } from './testLayerHelpers';
import { walkSyncEndpoints } from './walkEndpoints';
import type { ApiMetaMap, SyncMetaMap } from './types';

//? Endpoint selection is where `TEST_FILTER` takes effect: a filtered sweep
//? must never REQUEST a non-matching route (it used to sweep everything and
//? only filter the report, so a filtered run still mutated unrelated routes).

const apiMethodMap = {
  billing: { getInvoice: { v1: 'GET' as const }, pay: { v1: 'POST' as const } },
  users: { list: { v1: 'GET' as const } },
};
const syncMetaMap: SyncMetaMap = {
  chat: { send: { v1: { auth: { login: true } } } },
};

describe('walkSyncEndpoints', () => {
  it('marks every sync route as kind sync, POST, under the sync/ prefix', () => {
    expect(walkSyncEndpoints(syncMetaMap)).toStrictEqual([
      { page: 'chat', name: 'send', version: 'v1', method: 'POST', fullPath: 'sync/chat/send/v1', kind: 'sync' },
    ]);
  });
});

describe('selectEndpoints', () => {
  it('returns API routes only when no syncMetaMap is given', () => {
    expect(selectEndpoints({ apiMethodMap }).map((e) => e.fullPath)).toStrictEqual([
      'api/billing/getInvoice/v1',
      'api/billing/pay/v1',
      'api/users/list/v1',
    ]);
  });

  it('appends sync routes when a syncMetaMap is given', () => {
    expect(selectEndpoints({ apiMethodMap, syncMetaMap }).map((e) => e.fullPath)).toContain('sync/chat/send/v1');
  });

  it('applies the filter before any request is made, across API and sync', () => {
    expect(selectEndpoints({ apiMethodMap, syncMetaMap, filter: 'billing/' }).map((e) => e.fullPath)).toStrictEqual([
      'api/billing/getInvoice/v1',
      'api/billing/pay/v1',
    ]);
    expect(selectEndpoints({ apiMethodMap, syncMetaMap, filter: 'chat' }).map((e) => e.fullPath)).toStrictEqual([
      'sync/chat/send/v1',
    ]);
  });
});

describe('metaMapFor / transportFor', () => {
  const apiMetaMap: ApiMetaMap = {};
  const [syncEndpoint] = walkSyncEndpoints(syncMetaMap);
  const [apiEndpoint] = selectEndpoints({ apiMethodMap });

  it('reads sync routes from syncMetaMap and API routes from apiMetaMap', () => {
    if (!syncEndpoint || !apiEndpoint) throw new Error('fixture endpoints missing');
    expect(metaMapFor(syncEndpoint, apiMetaMap, syncMetaMap)).toBe(syncMetaMap);
    expect(metaMapFor(apiEndpoint, apiMetaMap, syncMetaMap)).toBe(apiMetaMap);
  });

  it('uses the sync transport for sync routes only', () => {
    if (!syncEndpoint || !apiEndpoint) throw new Error('fixture endpoints missing');
    const syncTransport = createHttpProbeTransport({ syncReceiver: 'room' });
    expect(transportFor(syncEndpoint, syncTransport)).toBe(syncTransport);
    expect(transportFor(apiEndpoint, syncTransport)).toBe(defaultProbeTransport);
    expect(transportFor(syncEndpoint, undefined)).toBe(defaultProbeTransport);
  });

  it('uses the API transport for API routes only', () => {
    if (!syncEndpoint || !apiEndpoint) throw new Error('fixture endpoints missing');
    const syncTransport = createHttpProbeTransport({ syncReceiver: 'room' });
    const apiTransport = createHttpProbeTransport();
    expect(transportFor(apiEndpoint, syncTransport, apiTransport)).toBe(apiTransport);
    expect(transportFor(syncEndpoint, syncTransport, apiTransport)).toBe(syncTransport);
    expect(transportFor(syncEndpoint, undefined, apiTransport)).toBe(defaultProbeTransport);
  });
});

describe('hasSessionHeaders', () => {
  it('treats a session Cookie or a Bearer header as an authenticated sweep', () => {
    expect(hasSessionHeaders({ Cookie: 'session=tok' })).toBe(true);
    expect(hasSessionHeaders({ Authorization: 'Bearer tok' })).toBe(true);
    expect(hasSessionHeaders({})).toBe(false);
    expect(hasSessionHeaders(undefined)).toBe(false);
  });
});
