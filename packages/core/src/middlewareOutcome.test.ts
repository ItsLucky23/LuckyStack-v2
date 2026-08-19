import { describe, it, expect } from 'vitest';
import { resolveMiddlewareOutcome, type MiddlewareResult } from './middlewareRegistry';

//? `<Middleware>` (direct URL hits) and `useRouter` (programmatic navigation)
//? both route through this resolver. They used to branch separately, which is
//? how `useRouter` ended up silently doing nothing for any result it did not
//? recognise — a guarded button that just did not respond.
//?
//? The React components themselves are not covered here: this repo's vitest
//? runs in a `node` environment with no jsdom/testing-library, so extracting
//? the decision into a pure function is what makes it testable at all.

describe('resolveMiddlewareOutcome', () => {
  it('allows on success', () => {
    expect(resolveMiddlewareOutcome({ success: true })).toEqual({ kind: 'allow' });
  });

  it('redirects when a destination is given', () => {
    expect(resolveMiddlewareOutcome({ success: false, redirect: '/login' }))
      .toEqual({ kind: 'redirect', to: '/login' });
  });

  it('denies in place when a status is given', () => {
    //? The new variant: keep the URL, render the status. For a signed-in user
    //? who simply lacks a permission, a redirect loses the URL and explains
    //? nothing.
    expect(resolveMiddlewareOutcome({ success: false, status: 403 }))
      .toEqual({ kind: 'deny', status: 403 });
    expect(resolveMiddlewareOutcome({ success: false, status: 404 }))
      .toEqual({ kind: 'deny', status: 404 });
  });

  it('falls back when the handler returns nothing', () => {
    expect(resolveMiddlewareOutcome(undefined)).toEqual({ kind: 'fallback' });
  });

  it('falls back on a malformed result rather than allowing it', () => {
    //? Fail closed: an unrecognised shape must never read as "allow".
    const malformed = { success: false } as unknown as MiddlewareResult;
    expect(resolveMiddlewareOutcome(malformed)).toEqual({ kind: 'fallback' });
  });

  it('prefers redirect over status when a handler sets both', () => {
    //? The type forbids it, but JS callers exist. Redirect is the safer read:
    //? it moves the user somewhere valid instead of parking them on a page they
    //? cannot use.
    const both = { success: false, redirect: '/login', status: 403 } as unknown as MiddlewareResult;
    expect(resolveMiddlewareOutcome(both)).toEqual({ kind: 'redirect', to: '/login' });
  });

  it('treats status 0 as a real status, not a falsy miss', () => {
    //? Guards against a `result.status ||` style regression.
    expect(resolveMiddlewareOutcome({ success: false, status: 0 }))
      .toEqual({ kind: 'deny', status: 0 });
  });
});
