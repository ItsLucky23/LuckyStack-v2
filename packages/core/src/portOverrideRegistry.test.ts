import { afterEach, describe, expect, it } from 'vitest';
import {
  getPortOverride,
  registerPortOverride,
  resetPortOverrideForTests,
} from './portOverrideRegistry';

afterEach(() => resetPortOverrideForTests());

describe('port override registry', () => {
  it('starts empty', () => {
    expect(getPortOverride()).toBeUndefined();
  });

  it('registers valid ports including zero', () => {
    registerPortOverride(4911);
    expect(getPortOverride()).toBe(4911);

    registerPortOverride(0);
    expect(getPortOverride()).toBe(0);
  });

  it('clears the override when null is registered', () => {
    registerPortOverride(4911);
    registerPortOverride(null);
    expect(getPortOverride()).toBeUndefined();
  });

  it.each([-1, 65_536, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid port %s',
    (port) => {
      expect(() => registerPortOverride(port)).toThrow(/integer from 0 through 65535/);
    },
  );

  it('offers an explicit test reset', () => {
    registerPortOverride(4911);
    resetPortOverrideForTests();
    expect(getPortOverride()).toBeUndefined();
  });
});
