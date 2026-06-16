import { describe, it, expect } from 'vitest';
import { projectRoot, readDocFile } from './artifacts.js';

//? Regression coverage for the behavior-preserving containment guard added to
//? readDocFile: every legitimate in-root relative path still reads as before,
//? while a traversal escape or a null byte returns the same `null` any read
//? failure already yields (no new throw, no leaked path).
describe('readDocFile containment', () => {
  it('reads a legitimate in-root file (unchanged behavior)', async () => {
    //? projectRoot resolves to the nearest package.json ancestor, which always
    //? contains a package.json — a real, legitimate in-root read.
    const body = await readDocFile('package.json');
    expect(body).not.toBeNull();
    expect(body).toContain('"name"');
  });

  it('returns null for a path that escapes the project root', async () => {
    expect(await readDocFile('../../../etc/passwd')).toBeNull();
    expect(await readDocFile('docs/../../../etc/passwd')).toBeNull();
  });

  it('returns null for an absolute path outside the root', async () => {
    const root = await projectRoot();
    //? An absolute path that is NOT inside root must be rejected.
    expect(await readDocFile(`${root}/../outside.md`)).toBeNull();
  });

  it('returns null for a path containing a null byte', async () => {
    expect(await readDocFile('docs/ai-graph\0.json')).toBeNull();
  });

  it('returns null for the root directory itself (empty relative path)', async () => {
    expect(await readDocFile('.')).toBeNull();
  });
});
