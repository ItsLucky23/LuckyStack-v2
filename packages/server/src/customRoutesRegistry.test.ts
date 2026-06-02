import { describe, it, expect, beforeEach } from 'vitest';

import {
  registerCustomRoute,
  getCustomRoutes,
  getPreParamsCustomRoutes,
  clearCustomRoutes,
} from './customRoutesRegistry';
import type { CustomRouteHandler } from './types';

//? The registry only stores handler references in registration order and
//? exposes a read snapshot + a clear. It never invokes the handlers, so the
//? handler bodies here are inert sentinels whose return value is irrelevant to
//? what's under test — we assert identity, order, and count only.
const makeHandler = (returns: boolean): CustomRouteHandler => () => returns;

describe('customRoutesRegistry', () => {
  beforeEach(() => {
    //? The registry is a module-level array shared across tests in this file.
    clearCustomRoutes();
  });

  it('starts empty', () => {
    expect(getCustomRoutes()).toHaveLength(0);
  });

  it('appends a registered handler', () => {
    const handler = makeHandler(true);
    registerCustomRoute(handler);
    const routes = getCustomRoutes();
    expect(routes).toHaveLength(1);
    expect(routes[0]).toBe(handler);
  });

  it('preserves registration order across multiple handlers', () => {
    const first = makeHandler(false);
    const second = makeHandler(true);
    const third = makeHandler(false);
    registerCustomRoute(first);
    registerCustomRoute(second);
    registerCustomRoute(third);

    const routes = getCustomRoutes();
    expect(routes).toHaveLength(3);
    expect(routes[0]).toBe(first);
    expect(routes[1]).toBe(second);
    expect(routes[2]).toBe(third);
  });

  it('keeps duplicate registrations as separate entries', () => {
    const handler = makeHandler(true);
    registerCustomRoute(handler);
    registerCustomRoute(handler);
    const routes = getCustomRoutes();
    expect(routes).toHaveLength(2);
    expect(routes[0]).toBe(handler);
    expect(routes[1]).toBe(handler);
  });

  it('clears all registered handlers', () => {
    registerCustomRoute(makeHandler(true));
    registerCustomRoute(makeHandler(false));
    expect(getCustomRoutes()).toHaveLength(2);

    clearCustomRoutes();
    expect(getCustomRoutes()).toHaveLength(0);
  });

  it('clears in place so a previously read snapshot reflects the same backing array', () => {
    //? `clearCustomRoutes` does `handlers.length = 0` rather than reassigning,
    //? so a reference grabbed before the clear is emptied too. This documents
    //? that callers must re-read after a clear rather than cache the snapshot.
    registerCustomRoute(makeHandler(true));
    const snapshot = getCustomRoutes();
    expect(snapshot).toHaveLength(1);

    clearCustomRoutes();
    expect(snapshot).toHaveLength(0);
  });

  it('supports re-registration after a clear', () => {
    registerCustomRoute(makeHandler(true));
    clearCustomRoutes();
    const handler = makeHandler(false);
    registerCustomRoute(handler);

    const routes = getCustomRoutes();
    expect(routes).toHaveLength(1);
    expect(routes[0]).toBe(handler);
  });

  describe('phases', () => {
    it('defaults to post-params — getCustomRoutes returns it, pre-params list stays empty', () => {
      const handler = makeHandler(true);
      registerCustomRoute(handler);
      expect(getCustomRoutes()).toEqual([handler]);
      expect(getPreParamsCustomRoutes()).toHaveLength(0);
    });

    it('an explicit post-params phase behaves like the default', () => {
      const handler = makeHandler(true);
      registerCustomRoute(handler, { phase: 'post-params' });
      expect(getCustomRoutes()).toEqual([handler]);
      expect(getPreParamsCustomRoutes()).toHaveLength(0);
    });

    it('routes a pre-params handler to the pre-params list, NOT getCustomRoutes', () => {
      const pre = makeHandler(true);
      registerCustomRoute(pre, { phase: 'pre-params' });
      expect(getCustomRoutes()).toHaveLength(0);
      expect(getPreParamsCustomRoutes()).toEqual([pre]);
    });

    it('keeps the two phases independent and ordered', () => {
      const post1 = makeHandler(false);
      const pre1 = makeHandler(false);
      const post2 = makeHandler(true);
      const pre2 = makeHandler(true);
      registerCustomRoute(post1);
      registerCustomRoute(pre1, { phase: 'pre-params' });
      registerCustomRoute(post2);
      registerCustomRoute(pre2, { phase: 'pre-params' });
      expect(getCustomRoutes()).toEqual([post1, post2]);
      expect(getPreParamsCustomRoutes()).toEqual([pre1, pre2]);
    });

    it('clearCustomRoutes empties both phases', () => {
      registerCustomRoute(makeHandler(true));
      registerCustomRoute(makeHandler(true), { phase: 'pre-params' });
      clearCustomRoutes();
      expect(getCustomRoutes()).toHaveLength(0);
      expect(getPreParamsCustomRoutes()).toHaveLength(0);
    });
  });
});
