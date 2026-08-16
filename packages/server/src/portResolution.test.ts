import { describe, expect, it } from 'vitest';
import { normalizeServerPort, resolveServerPort } from './portResolution';

describe('server port resolution', () => {
  it('uses options.port above every other source', () => {
    expect(resolveServerPort({
      optionsPort: 4100,
      parsedPort: 4101,
      defaultPort: 4102,
    })).toBe(4100);
  });

  it('uses argv above the config default', () => {
    expect(resolveServerPort({ parsedPort: 4101, defaultPort: 4102 })).toBe(4101);
  });

  it('uses the config.ports backend default', () => {
    expect(resolveServerPort({ parsedPort: null, defaultPort: 4787 })).toBe(4787);
  });

  it('falls back to port 80 for a generic consumer without a configured source', () => {
    expect(resolveServerPort({ parsedPort: null })).toBe(80);
  });

  it('accepts port zero and both numeric input shapes', () => {
    expect(normalizeServerPort(0)).toBe(0);
    expect(normalizeServerPort('8080')).toBe(8080);
  });

  it.each(['', '80abc', '-1', '65536', 1.5, -1, 65_536])(
    'rejects invalid port %s before node:http.listen',
    (value) => {
      expect(() => normalizeServerPort(value)).toThrow(/integer from 0 through 65535/);
    },
  );
});
