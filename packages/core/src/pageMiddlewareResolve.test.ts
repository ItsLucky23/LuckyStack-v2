import { afterEach, describe, expect, it } from 'vitest';

import {
  clearPageMiddlewaresForTests,
  registerPageMiddleware,
  registerPageRoute,
  resolvePageMiddleware,
  type PageMiddleware,
} from './middlewareRegistry';

const guard = (): PageMiddleware => () => ({ success: false, status: 403 });

//? Patterns are registered the way main.tsx does it: lowercased route with
//? `[id]` already turned into `:id`. Lookups use what React Router renders for.
describe('resolvePageMiddleware', () => {
  afterEach(() => {
    clearPageMiddlewaresForTests();
  });

  it('finds the guard for case variants, trailing slashes, query, hash and encoded segments', () => {
    const admin = guard();
    registerPageMiddleware('/admin', admin);

    for (const url of ['/admin', '/ADMIN', '/admin/', '/Admin?tab=users', '/admin#top', '/%61dmin']) {
      expect(resolvePageMiddleware(url), url).toBe(admin);
    }
  });

  it('fills dynamic segments', () => {
    const order = guard();
    registerPageMiddleware('/orders/:id', order);

    expect(resolvePageMiddleware('/orders/123')).toBe(order);
    expect(resolvePageMiddleware('/orders')).toBeUndefined();
    expect(resolvePageMiddleware('/orders/123/edit')).toBeUndefined();
  });

  it('matches sub-paths of a splat pattern', () => {
    const workspaces = guard();
    registerPageMiddleware('/workspaces/*', workspaces);

    expect(resolvePageMiddleware('/workspaces/x/y')).toBe(workspaces);
    expect(resolvePageMiddleware('/workspaces')).toBe(workspaces);
  });

  it('prefers the most specific pattern and leaves unrelated routes to the global handler', () => {
    const byId = guard();
    const create = guard();
    const root = guard();
    registerPageMiddleware('/orders/:id', byId);
    registerPageMiddleware('/orders/new', create);
    registerPageMiddleware('/', root);

    expect(resolvePageMiddleware('/orders/new')).toBe(create);
    expect(resolvePageMiddleware('/orders/7')).toBe(byId);
    expect(resolvePageMiddleware('/')).toBe(root);
    expect(resolvePageMiddleware('/settings')).toBeUndefined();
  });

  it('never lends an unguarded route the guard of a less specific loaded page', () => {
    //? Review 1 finding 3: guards register lazily, so after `/x` loaded the
    //? `/:slug` guard was the only candidate for `/about`.
    const slug = guard();
    registerPageRoute('/about');
    registerPageRoute('/:slug');
    registerPageMiddleware('/:slug', slug);

    expect(resolvePageMiddleware('/about')).toBeUndefined();
    expect(resolvePageMiddleware('/x')).toBe(slug);
  });
});
