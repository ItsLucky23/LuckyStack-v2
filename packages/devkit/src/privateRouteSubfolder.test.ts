import { describe, it, expect, afterEach } from 'vitest';
import { isInsidePrivateRouteSubfolder } from './routeNamingValidation';
import { registerRoutingRules } from './routingRules';

//? DEVKIT-5: a `_`-prefixed segment AFTER the `_api`/`_sync` marker is a private
//? helper subtree (e.g. `_api/_lib/*`) and must be skipped by route discovery +
//? naming validation, so a helper file no longer trips a RouteNaming error.

afterEach(() => {
  registerRoutingRules({}); //? restore defaults
});

describe('isInsidePrivateRouteSubfolder', () => {
  it('flags a private helper folder under the API marker', () => {
    expect(isInsidePrivateRouteSubfolder('C:/app/src/_ai/_api/_lib/runHeadlessTurn.ts')).toBe(true);
  });

  it('flags a nested private test folder under a sync marker', () => {
    expect(isInsidePrivateRouteSubfolder('/app/src/chat/_sync/_lib/__tests__/x.test.ts')).toBe(true);
  });

  it('flags a `_`-prefixed FILE directly under the marker', () => {
    expect(isInsidePrivateRouteSubfolder('/app/src/_api/_helper.ts')).toBe(true);
  });

  it('does NOT flag a real versioned route file', () => {
    expect(isInsidePrivateRouteSubfolder('/app/src/data/_api/getUser_v1.ts')).toBe(false);
  });

  it('does NOT flag the marker segment itself (it also starts with `_`)', () => {
    expect(isInsidePrivateRouteSubfolder('/app/src/data/_api/foo_v1.ts')).toBe(false);
  });

  it('does NOT flag an invisible `_`-page folder BEFORE the marker', () => {
    expect(isInsidePrivateRouteSubfolder('/app/src/_admin/_api/list_v1.ts')).toBe(false);
  });

  it('returns false when there is no marker in the path', () => {
    expect(isInsidePrivateRouteSubfolder('/app/src/_components/Button.tsx')).toBe(false);
  });

  it('honors a custom marker + private prefix from registerRoutingRules', () => {
    registerRoutingRules({ apiMarker: '_routes', privateFolderPrefix: '~' });
    expect(isInsidePrivateRouteSubfolder('/app/src/_routes/~lib/helper.ts')).toBe(true);
    expect(isInsidePrivateRouteSubfolder('/app/src/_routes/get_v1.ts')).toBe(false);
  });
});
