import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  registerErrorFormatter,
  getErrorFormatter,
  applyErrorFormatter,
  type ErrorFormatter,
} from './errorFormatterRegistry';

//? The server package's `errorFormatterRegistry.ts` is a back-compat re-export
//? shim — the real implementation lives in @luckystack/core. We import through
//? the server shim (the package's own public surface) so the test stays inside
//? the package's `rootDir` and exercises exactly what consumers of
//? `@luckystack/server` receive. The registry is pure in-memory (no DB / Redis
//? / socket), so no infrastructure mocking is required.

//? Plain formatters used for identity / last-write-wins / dispatch assertions.
//? Hoisted to module scope because they close over nothing.
const taggingFormatter: ErrorFormatter = (error) => ({ ...error, tagged: true });
const firstFormatter: ErrorFormatter = (error) => ({ ...error, which: 'first' });
const secondFormatter: ErrorFormatter = (error) => ({ ...error, which: 'second' });
const identityFormatter: ErrorFormatter = (error) => error;
const throwingFormatter: ErrorFormatter = () => {
  throw new Error('formatter boom');
};

//? `applyErrorFormatter` logs to console.error on the resilience (catch)
//? branches. Silence it per-test and return the spy so the branch can assert
//? it was hit. The trailing `afterEach` restores all mocks.
const silenceConsoleError = () =>
  vi.spyOn(console, 'error').mockImplementation(() => {
    //? swallow — the resilience branch's log is asserted via the spy.
  });

describe('errorFormatterRegistry', () => {
  beforeEach(() => {
    //? Module-level `activeFormatter` slot persists across tests — reset it.
    registerErrorFormatter(null);
  });

  describe('register / read', () => {
    it('returns null when no formatter is registered', () => {
      expect(getErrorFormatter()).toBeNull();
    });

    it('returns the registered formatter', () => {
      registerErrorFormatter(taggingFormatter);
      expect(getErrorFormatter()).toBe(taggingFormatter);
    });

    it('applies last-write-wins on repeated registration', () => {
      registerErrorFormatter(firstFormatter);
      registerErrorFormatter(secondFormatter);
      expect(getErrorFormatter()).toBe(secondFormatter);
    });

    it('unregisters the active formatter when passed null', () => {
      registerErrorFormatter(identityFormatter);
      expect(getErrorFormatter()).not.toBeNull();
      registerErrorFormatter(null);
      expect(getErrorFormatter()).toBeNull();
    });
  });

  describe('applyErrorFormatter resolution chain', () => {
    it('returns non-error envelopes unchanged without invoking any formatter', () => {
      const globalFormatter = vi.fn<ErrorFormatter>((error) => ({ ...error, touched: true }));
      registerErrorFormatter(globalFormatter);
      const response = { status: 'success', result: { ok: 1 } };

      const out = applyErrorFormatter({
        response,
        routeName: 'api/billing/getInvoice/v1',
        transport: 'http',
      });

      expect(out).toBe(response);
      expect(globalFormatter).not.toHaveBeenCalled();
    });

    it('returns the error envelope unchanged when no formatter is registered', () => {
      const response = { status: 'error', errorCode: 'BOOM' };
      const out = applyErrorFormatter({
        response,
        routeName: 'sync/room/update/v1',
        transport: 'socket',
      });
      expect(out).toBe(response);
    });

    it('applies the global formatter to an error envelope', () => {
      registerErrorFormatter((error) => ({ ...error, correlationId: 'abc-123' }));
      const out = applyErrorFormatter({
        response: { status: 'error', errorCode: 'BOOM' },
        routeName: 'api/billing/getInvoice/v1',
        transport: 'http',
        userId: 'user-1',
      });
      expect(out).toEqual({ status: 'error', errorCode: 'BOOM', correlationId: 'abc-123' });
    });

    it('passes routeName, transport and userId through to the global formatter context', () => {
      const globalFormatter = vi.fn<ErrorFormatter>((error) => error);
      registerErrorFormatter(globalFormatter);

      applyErrorFormatter({
        response: { status: 'error', errorCode: 'BOOM' },
        routeName: 'api/billing/getInvoice/v1',
        transport: 'http',
        userId: 'user-1',
      });

      expect(globalFormatter).toHaveBeenCalledWith(
        { status: 'error', errorCode: 'BOOM' },
        { routeName: 'api/billing/getInvoice/v1', transport: 'http', userId: 'user-1' },
      );
    });

    it('prefers the per-route formatter over the global one', () => {
      const globalFormatter = vi.fn<ErrorFormatter>((error) => ({ ...error, src: 'global' }));
      const perRoute = vi.fn<ErrorFormatter>((error) => ({ ...error, src: 'per-route' }));
      registerErrorFormatter(globalFormatter);

      const out = applyErrorFormatter({
        response: { status: 'error', errorCode: 'BOOM' },
        routeName: 'api/billing/getInvoice/v1',
        transport: 'http',
        perRouteFormatter: perRoute,
      });

      expect(perRoute).toHaveBeenCalledTimes(1);
      expect(globalFormatter).not.toHaveBeenCalled();
      expect(out).toEqual({ status: 'error', errorCode: 'BOOM', src: 'per-route' });
    });

    it('falls through to the global formatter when the per-route formatter throws', () => {
      const errorSpy = silenceConsoleError();
      const globalFormatter = vi.fn<ErrorFormatter>((error) => ({ ...error, src: 'global' }));
      registerErrorFormatter(globalFormatter);

      const out = applyErrorFormatter({
        response: { status: 'error', errorCode: 'BOOM' },
        routeName: 'api/billing/getInvoice/v1',
        transport: 'http',
        perRouteFormatter: throwingFormatter,
      });

      expect(globalFormatter).toHaveBeenCalledTimes(1);
      expect(out).toEqual({ status: 'error', errorCode: 'BOOM', src: 'global' });
      expect(errorSpy).toHaveBeenCalled();
    });

    it('returns the original envelope when the global formatter throws', () => {
      const errorSpy = silenceConsoleError();
      const response = { status: 'error', errorCode: 'BOOM' };
      registerErrorFormatter(throwingFormatter);

      const out = applyErrorFormatter({
        response,
        routeName: 'api/billing/getInvoice/v1',
        transport: 'http',
      });

      expect(out).toBe(response);
      expect(errorSpy).toHaveBeenCalled();
    });

    it('returns the original envelope when a throwing per-route formatter has no global fallback', () => {
      const errorSpy = silenceConsoleError();
      const response = { status: 'error', errorCode: 'BOOM' };

      const out = applyErrorFormatter({
        response,
        routeName: 'api/billing/getInvoice/v1',
        transport: 'http',
        perRouteFormatter: throwingFormatter,
      });

      expect(out).toBe(response);
      expect(errorSpy).toHaveBeenCalled();
    });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
