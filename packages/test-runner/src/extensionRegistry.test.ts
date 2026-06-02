import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  registerTestLayer,
  listTestLayers,
  registerTestFixture,
  getTestFixture,
  registerTestReporter,
  getTestReporter,
  resetTestExtensionsForTests,
} from './extensionRegistry';
import type { TestLayer, TestFixture, TestReporter } from './extensionRegistry';

//? The extension registry is module-level mutable state (three Maps/refs).
//? `resetTestExtensionsForTests()` is the documented reset seam, so each test
//? starts from a clean slate. No infra / @luckystack/core involved — these
//? are pure in-memory registries.

const makeLayer = (name: string): TestLayer => ({
  name,
  run: () => ({ passed: true }),
});

describe('extension registry', () => {
  beforeEach(() => {
    resetTestExtensionsForTests();
  });

  describe('test layers', () => {
    it('starts empty', () => {
      expect(listTestLayers()).toEqual([]);
    });

    it('registers a layer and lists it back', () => {
      const layer = makeLayer('cors');
      registerTestLayer(layer);
      expect(listTestLayers()).toEqual([layer]);
    });

    it('keeps multiple distinctly-named layers', () => {
      registerTestLayer(makeLayer('cors'));
      registerTestLayer(makeLayer('multiTenant'));
      expect(listTestLayers().map((l) => l.name)).toEqual(['cors', 'multiTenant']);
    });

    it('replaces a layer registered under the same name', () => {
      const first = makeLayer('cors');
      const second: TestLayer = { name: 'cors', run: () => ({ passed: false }) };
      registerTestLayer(first);
      registerTestLayer(second);
      const layers = listTestLayers();
      expect(layers).toHaveLength(1);
      expect(layers[0]).toBe(second);
    });

    it('preserves the original insertion slot when a name is replaced', () => {
      registerTestLayer(makeLayer('a'));
      registerTestLayer(makeLayer('b'));
      registerTestLayer({ name: 'a', run: () => ({ passed: false }) });
      //? Map keeps first-insertion order on key overwrite, so 'a' stays first.
      expect(listTestLayers().map((l) => l.name)).toEqual(['a', 'b']);
    });

    it('returns a fresh array snapshot (mutating it does not affect the registry)', () => {
      registerTestLayer(makeLayer('cors'));
      const snapshot = listTestLayers();
      snapshot.pop();
      expect(listTestLayers()).toHaveLength(1);
    });

    it('actually invokes the registered layer run callback', async () => {
      const run = vi.fn(() => ({ passed: true, message: 'ok' }));
      registerTestLayer({ name: 'spy', run });
      const layer = listTestLayers()[0];
      const result = await layer?.run({ endpoint: 'api/x/y/v1', method: 'GET' });
      expect(run).toHaveBeenCalledWith({ endpoint: 'api/x/y/v1', method: 'GET' });
      expect(result).toEqual({ passed: true, message: 'ok' });
    });
  });

  describe('fixtures', () => {
    it('returns undefined for an unregistered typeKey', () => {
      expect(getTestFixture('Unknown')).toBeUndefined();
    });

    it('registers and reads back a fixture by typeKey', () => {
      const fixture: TestFixture<{ id: number }> = {
        valid: [{ id: 1 }],
        invalid: [{ id: -1 }],
      };
      registerTestFixture('Invoice', fixture);
      expect(getTestFixture('Invoice')).toEqual(fixture);
    });

    it('keeps fixtures isolated per typeKey', () => {
      registerTestFixture('A', { valid: ['a'], invalid: [] });
      registerTestFixture('B', { valid: ['b'], invalid: [] });
      expect(getTestFixture('A')?.valid).toEqual(['a']);
      expect(getTestFixture('B')?.valid).toEqual(['b']);
    });

    it('overwrites a fixture re-registered under the same typeKey', () => {
      registerTestFixture('Invoice', { valid: ['old'], invalid: [] });
      registerTestFixture('Invoice', { valid: ['new'], invalid: [] });
      expect(getTestFixture('Invoice')?.valid).toEqual(['new']);
    });
  });

  describe('reporter', () => {
    it('is null before any registration', () => {
      expect(getTestReporter()).toBeNull();
    });

    it('registers and reads back a reporter', () => {
      const reporter: TestReporter = {
        onResult: vi.fn(),
        webhookUrl: 'https://example.test/hook',
      };
      registerTestReporter(reporter);
      expect(getTestReporter()).toBe(reporter);
    });

    it('replaces a previously registered reporter', () => {
      const first: TestReporter = { onSummary: vi.fn() };
      const second: TestReporter = { onResult: vi.fn() };
      registerTestReporter(first);
      registerTestReporter(second);
      expect(getTestReporter()).toBe(second);
    });

    it('unregisters when passed null', () => {
      registerTestReporter({ onResult: vi.fn() });
      registerTestReporter(null);
      expect(getTestReporter()).toBeNull();
    });
  });

  describe('resetTestExtensionsForTests', () => {
    it('clears layers, fixtures, and the reporter together', () => {
      registerTestLayer(makeLayer('cors'));
      registerTestFixture('Invoice', { valid: [{}], invalid: [] });
      registerTestReporter({ onResult: vi.fn() });

      resetTestExtensionsForTests();

      expect(listTestLayers()).toEqual([]);
      expect(getTestFixture('Invoice')).toBeUndefined();
      expect(getTestReporter()).toBeNull();
    });
  });
});
