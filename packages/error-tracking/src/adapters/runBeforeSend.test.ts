import { describe, it, expect } from 'vitest';

import type { ErrorTrackerEvent } from '@luckystack/core';

import { resolveExceptionEvent, resolveMessageEvent } from './runBeforeSend';

describe('resolveExceptionEvent', () => {
  it('passes the original error + context through when no hook is configured', () => {
    const err = new Error('boom');
    const resolved = resolveExceptionEvent(undefined, err, { route: 'api/x' });
    expect(resolved).toEqual({ error: err, context: { route: 'api/x' } });
  });

  it('returns context undefined when none was supplied and no hook adds one', () => {
    const err = new Error('boom');
    const resolved = resolveExceptionEvent(undefined, err, undefined);
    expect(resolved).toEqual({ error: err, context: undefined });
  });

  it('drops the event when the hook returns null', () => {
    const resolved = resolveExceptionEvent(() => null, new Error('boom'), undefined);
    expect(resolved).toBeNull();
  });

  it('drops the event when the hook returns forwarded: false (QUA-072)', () => {
    const hook = (event: ErrorTrackerEvent): ErrorTrackerEvent => ({ ...event, forwarded: false });
    const resolved = resolveExceptionEvent(hook, new Error('boom'), { secret: 'x' });
    expect(resolved).toBeNull();
  });

  it('forwards the TRANSFORMED context the hook returns, not the original (SEC-05)', () => {
    //? The canonical PII-redaction pattern: immutably return a copy with a
    //? scrubbed context. The adapter must forward the scrubbed copy.
    const hook = (event: ErrorTrackerEvent): ErrorTrackerEvent => ({
      ...event,
      payload: { ...event.payload, context: { route: 'api/x', email: '[redacted]' } },
    });
    const resolved = resolveExceptionEvent(hook, new Error('boom'), {
      route: 'api/x',
      email: 'real@example.com',
    });
    expect(resolved?.context).toEqual({ route: 'api/x', email: '[redacted]' });
  });

  it('forwards a replaced error object from the hook', () => {
    const replacement = new Error('sanitized');
    const hook = (event: ErrorTrackerEvent): ErrorTrackerEvent => ({
      ...event,
      payload: { ...event.payload, error: replacement },
    });
    const resolved = resolveExceptionEvent(hook, new Error('original'), undefined);
    expect(resolved?.error).toBe(replacement);
  });

  it('collapses a non-object context returned by the hook to undefined', () => {
    const hook = (event: ErrorTrackerEvent): ErrorTrackerEvent => ({
      ...event,
      payload: { ...event.payload, context: 'not-an-object' },
    });
    const resolved = resolveExceptionEvent(hook, new Error('boom'), { a: 1 });
    expect(resolved?.context).toBeUndefined();
  });
});

describe('resolveMessageEvent', () => {
  it('passes original message + level + context through with no hook', () => {
    const resolved = resolveMessageEvent(undefined, 'hello', 'warning', { tag: '1' });
    expect(resolved).toEqual({ message: 'hello', level: 'warning', context: { tag: '1' } });
  });

  it('drops the event when the hook returns forwarded: false', () => {
    const hook = (event: ErrorTrackerEvent): ErrorTrackerEvent => ({ ...event, forwarded: false });
    expect(resolveMessageEvent(hook, 'm', 'info', undefined)).toBeNull();
  });

  it('forwards a transformed message + context', () => {
    const hook = (event: ErrorTrackerEvent): ErrorTrackerEvent => ({
      ...event,
      payload: { ...event.payload, message: 'scrubbed', context: { safe: true } },
    });
    const resolved = resolveMessageEvent(hook, 'raw secret', 'error', { token: 'abc' });
    expect(resolved).toEqual({ message: 'scrubbed', level: 'error', context: { safe: true } });
  });

  it('falls back to the original message/level when the hook returns malformed values', () => {
    const hook = (event: ErrorTrackerEvent): ErrorTrackerEvent => ({
      ...event,
      payload: { ...event.payload, message: 42, level: 'not-a-level' },
    });
    const resolved = resolveMessageEvent(hook, 'orig', 'info', undefined);
    expect(resolved).toEqual({ message: 'orig', level: 'info', context: undefined });
  });
});
