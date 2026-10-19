import { describe, expect, it } from 'vitest';
import { findRegistryEntry } from './registry';

describe('registry descriptions match package contracts', () => {
  it('cron never promises exactly-once runs; its leases are best-effort (finding 073)', () => {
    const description = findRegistryEntry('cron')?.description ?? '';
    expect(description.toLowerCase()).not.toContain('exactly one');
    expect(description).toContain('idempotent');
  });
});
