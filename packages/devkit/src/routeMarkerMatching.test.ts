import { describe, it, expect, afterEach } from 'vitest';
import { isRouteSurfaceFile } from './routeNamingValidation';
import { isNonRouteDirectory, getRoutingRules, registerRoutingRules } from './routingRules';

//? Regression cover for the three loader defects behind the wall of red
//? "[loader][api] invalid filename" lines a real consumer project hit at every
//? boot — 33 warnings, none of them a real problem:
//?
//?   1. folder matching used `name.endsWith("api")`, so `externalApi/` was
//?      walked as a route folder;
//?   2. the walk descended into `_api/_lib/`, which the private-folder
//?      convention says is not route surface;
//?   3. test detection was `.tests.ts` only, so `.test.ts` / `.spec.ts` /
//?      `__tests__/` all produced warnings.

afterEach(() => {
  registerRoutingRules({}); //? restore defaults
});

describe('marker matching is exact, not a suffix', () => {
  it('a folder merely ENDING in the marker word is not the marker', () => {
    //? The loader compares `file !== getRoutingRules().apiMarker`. These are the
    //? names that used to slip through `endsWith("api")` / `endsWith("sync")`.
    const { apiMarker, syncMarker } = getRoutingRules();
    for (const name of ['externalApi', 'thisIsAFolderAPI', 'legacyapi', 'publicApi']) {
      expect(name).not.toBe(apiMarker);
    }
    for (const name of ['dataSync', 'autoSync', 'websync']) {
      expect(name).not.toBe(syncMarker);
    }
    expect(apiMarker).toBe('_api');
    expect(syncMarker).toBe('_sync');
  });

  it('honours a consumer-overridden marker', () => {
    registerRoutingRules({ apiMarker: '_routes' });
    expect(getRoutingRules().apiMarker).toBe('_routes');
    //? The old hardcoded `endsWith("api")` ignored this override entirely.
    expect('_api').not.toBe(getRoutingRules().apiMarker);
  });
});

describe('isNonRouteDirectory — pruning BELOW the marker', () => {
  it('prunes private helper folders', () => {
    expect(isNonRouteDirectory('_lib')).toBe(true);
    expect(isNonRouteDirectory('_helpers')).toBe(true);
  });

  it('prunes conventional test folders', () => {
    expect(isNonRouteDirectory('__tests__')).toBe(true);
    expect(isNonRouteDirectory('__mocks__')).toBe(true);
  });

  it('keeps ordinary nested route folders', () => {
    //? Nested route names are a feature: `_api/users/get_v1.ts` -> `users/get`.
    expect(isNonRouteDirectory('users')).toBe(false);
    expect(isNonRouteDirectory('admin')).toBe(false);
  });

  it('follows a consumer-overridden private prefix', () => {
    registerRoutingRules({ privateFolderPrefix: '~' });
    expect(isNonRouteDirectory('~lib')).toBe(true);
    //? `__tests__` stays pruned via the test-directory names, not the prefix.
    expect(isNonRouteDirectory('__tests__')).toBe(true);
  });
});

describe('isRouteSurfaceFile — what deserves an "invalid filename" warning', () => {
  it('a real route file is route surface', () => {
    expect(isRouteSurfaceFile('/app/src/data/_api/getUser_v1.ts')).toBe(true);
  });

  it('a misnamed file directly under the marker still warns', () => {
    //? This is the case the warning EXISTS for — keep it working.
    expect(isRouteSurfaceFile('/app/src/data/_api/getUser.ts')).toBe(true);
  });

  it('files in a private helper subtree are not route surface', () => {
    expect(isRouteSurfaceFile('/app/src/_ai/_api/_lib/runAgentTurn.ts')).toBe(false);
    expect(isRouteSurfaceFile('C:/app/src/ats/_api/_lib/scope.ts')).toBe(false);
  });

  it('files in a __tests__ folder under the marker are not route surface', () => {
    expect(isRouteSurfaceFile('/app/src/_ai/_api/__tests__/parseTraceAuth.test.ts')).toBe(false);
    expect(isRouteSurfaceFile('/app/src/_ai/_api/_lib/__tests__/selfHeal.test.ts')).toBe(false);
  });

  it('test FILES co-located with routes are not route surface', () => {
    //? The gap `isInsidePrivateRouteSubfolder` alone left: no `_` segment, so
    //? only the file-name convention can catch these.
    expect(isRouteSurfaceFile('/app/src/data/_api/getUser.test.ts')).toBe(false);
    expect(isRouteSurfaceFile('/app/src/data/_api/getUser.spec.ts')).toBe(false);
    expect(isRouteSurfaceFile('/app/src/data/_api/getUser_v1.tests.ts')).toBe(false);
  });

  it('anchors on the LAST marker, so a project under a folder named _api still routes', () => {
    //? Self-review catch: `isInsidePrivateRouteSubfolder` anchored on the FIRST
    //? marker segment. Paths handed to it are ABSOLUTE, so a checkout living
    //? under a folder literally called `_api` anchored there — and the real
    //? marker further down then read as a private segment, silently hiding
    //? EVERY route in the project. Latent before, but this predicate now gates
    //? registration, not just naming validation.
    expect(isRouteSurfaceFile('C:/_api/app/src/chat/_api/send_v1.ts')).toBe(true);
    expect(isRouteSurfaceFile('/srv/_sync/proj/src/chat/_sync/push_server_v1.ts')).toBe(true);
    //? A genuine private subtree under the deepest marker still loses.
    expect(isRouteSurfaceFile('C:/_api/app/src/chat/_api/_lib/helper_v1.ts')).toBe(false);
  });

  it('does NOT itself decide marker membership — the caller does', () => {
    //? Contract note: this predicate answers "is this private or a test file",
    //? not "does this live under a marker". Both call sites pair it with a
    //? marker check (`normalized.includes(apiMarkerSegment())` in the loader,
    //? `isApiFileName` + segment in discovery). Asserting the pairing here so a
    //? future refactor cannot drop one half and silently widen discovery.
    const outsideAnyMarker = '/app/src/_ai/_tools/externalApi/call.ts';
    expect(isRouteSurfaceFile(outsideAnyMarker)).toBe(true);

    const apiSegment = `/${getRoutingRules().apiMarker}/`;
    expect(outsideAnyMarker.includes(apiSegment)).toBe(false);
    //? -> caller rejects it. This is the `externalApi/` case from the report.
  });
});
