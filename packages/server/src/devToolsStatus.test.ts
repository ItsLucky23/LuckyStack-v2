import { describe, it, expect, beforeEach } from 'vitest';
import { markDevToolsInitFailed, getDevToolsInitError, clearDevToolsInitError } from './devToolsStatus';

describe('devToolsStatus', () => {
  beforeEach(() => {
    clearDevToolsInitError();
  });

  it('defaults to no failure', () => {
    expect(getDevToolsInitError()).toBeNull();
  });

  it('records the failure so the boot log + request handlers can name the cause', () => {
    const error = new Error('initializeAll blew up');
    markDevToolsInitFailed(error);
    expect(getDevToolsInitError()).toBe(error);
  });

  it('clears back to healthy', () => {
    markDevToolsInitFailed(new Error('boom'));
    clearDevToolsInitError();
    expect(getDevToolsInitError()).toBeNull();
  });
});
