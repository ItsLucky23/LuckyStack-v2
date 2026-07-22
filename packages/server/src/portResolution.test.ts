import { describe, expect, it } from 'vitest';
import { normalizeServerPort, resolveServerPort } from './portResolution';

describe('server port resolution', () => {
  it('uses options.port above every other source', () => {
    expect(resolveServerPort({
      optionsPort: 4100,
      parsedPort: 4101,
      defaultPort: 4102,
      envPort: '4103',
    })).toBe(4100);
  });

  it('uses argv above config default and legacy env', () => {
    expect(resolveServerPort({ parsedPort: 4101, defaultPort: 4102, envPort: '4103' })).toBe(4101);
  });

  it('uses the config default above legacy SERVER_PORT', () => {
    expect(resolveServerPort({ parsedPort: null, defaultPort: 4102, envPort: '4103' })).toBe(4102);
  });

  it('falls back through legacy SERVER_PORT to port 80', () => {
    expect(resolveServerPort({ parsedPort: null, envPort: '4103' })).toBe(4103);
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
