import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../../..');

describe('record authoring template parity', () => {
  for (const layer of ['decisions', 'lessons']) {
    it(`ships the same ${layer} guidance with consumer-relative protocol pointers`, () => {
      const relative = `docs/${layer}/0000-template.md`;
      const canonical = fs.readFileSync(path.join(root, relative), 'utf8');
      const consumer = fs.readFileSync(path.join(root, 'packages/create-luckystack-app/template', relative), 'utf8');
      expect(consumer.replaceAll('docs/luckystack/', 'docs/')).toBe(canonical);
      expect(consumer).not.toContain('CLAUDE.md');
      if (layer === 'decisions') {
        expect(consumer).toContain('obtain approval for a new always-on rule');
        expect(consumer).toContain('`relates:` is not a field\nfor an AGENTS.md rule number');
        expect(consumer).toContain('at wrap-up under AGENTS.md');
        expect(consumer).toContain('docs/luckystack/DECISION_MEMORY_PROTOCOL.md');
      }
    });
  }
});
