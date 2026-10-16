import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { pruneLoginDocs } from './remove';

describe('pruneLoginDocs', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-remove-'));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const warnings = () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => { /* captured */ });
    vi.spyOn(console, 'log').mockImplementation(() => { /* quiet */ });
    return warn;
  };

  it('stays silent on a README that never had the legacy login paragraphs', () => {
    const readme = '# app\n\nAuth pages live under `src/`.\n';
    fs.writeFileSync(path.join(root, 'README.md'), readme);
    const warn = warnings();

    pruneLoginDocs(root);

    expect(warn).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(root, 'README.md'), 'utf8')).toBe(readme);
  });

  it('reports a legacy paragraph that is present but was edited', () => {
    fs.writeFileSync(
      path.join(root, 'README.md'),
      "# app\n\nOAuth providers auto-wire from env at boot, and we changed the rest of this line.\n",
    );
    const warn = warnings();

    pruneLoginDocs(root);

    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]?.[0])).toContain('1 README login section(s) looked hand-edited');
  });
});
