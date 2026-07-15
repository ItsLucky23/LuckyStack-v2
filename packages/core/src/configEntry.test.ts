import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = path.dirname(fileURLToPath(import.meta.url));

//? Walk the LOCAL import graph from an entry, following only relative specifiers.
//? Bare specifiers are the leaves we care about (`ioredis`, `node:fs`, ...).
const walkLocalGraph = (entry: string): { files: Set<string>; bareImports: Set<string> } => {
  const files = new Set<string>();
  const bareImports = new Set<string>();
  const queue = [entry];

  while (queue.length > 0) {
    const current = queue.pop();
    if (current === undefined || files.has(current)) continue;
    files.add(current);

    //? Comments MUST be stripped first. These files document their collaborators
    //? with inline examples (`import '@luckystack/login/register'`), and matching
    //? those would report dependencies that do not exist — the guard would fail
    //? on prose. (Learned twice: the capabilities guard tripped on its own
    //? explanatory comment the same way.)
    const source = fs
      .readFileSync(current, 'utf8')
      .replaceAll(/\/\*[\S\s]*?\*\//g, '')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('//'))
      .join('\n');
    //? Covers `import ... from 'x'`, `export ... from 'x'` and bare `import 'x'`.
    const specifiers = [...source.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);

    for (const specifier of specifiers) {
      if (specifier === undefined) continue;
      if (!specifier.startsWith('.')) {
        bareImports.add(specifier);
        continue;
      }
      const resolved = path.resolve(path.dirname(current), specifier);
      const candidate = [`${resolved}.ts`, path.join(resolved, 'index.ts')].find((option) => fs.existsSync(option));
      if (candidate !== undefined) queue.push(candidate);
    }
  }
  return { files, bareImports };
};

describe('@luckystack/core/config is client-bundle safe', () => {
  //? WHY THIS EXISTS: a project's config.ts is imported by BOTH bundles. When it
  //? pulled `registerProjectConfig` from the main barrel, Vite dragged the whole
  //? server surface into the browser — measured on this repo with a clean cache:
  //? barrel = 10697 KB with ioredis present in a client chunk, this entry =
  //? 10417 KB with none. A future "just re-export it from index" refactor would
  //? silently undo that, and nobody would notice until a bundle got audited.
  const graph = walkLocalGraph(path.join(SRC, 'config.ts'));

  it('never reaches the redis module', () => {
    const reachesRedis = [...graph.files].some((file) => /[/\\]redis(?:KeyFormatter)?\.ts$/.test(file));
    expect(
      reachesRedis,
      `config.ts must not reach redis.ts. Reached:\n${[...graph.files].map((f) => `  - ${path.basename(f)}`).join('\n')}`,
    ).toBe(false);
  });

  it('pulls in no third-party or node: dependency at all', () => {
    //? The entry is pure config plumbing: projectConfig imports only configUtils
    //? + createRegistry, and sessionTypes imports nothing. Anything else here
    //? means a new transitive edge that will land in the client bundle.
    expect(
      [...graph.bareImports],
      'config.ts must stay dependency-free — a bare import here ships to the browser',
    ).toEqual([]);
  });

  it('exports what a consumer config.ts actually needs', () => {
    //? Guards the other direction: a too-thin entry pushes consumers back to the
    //? barrel, which reintroduces the bundle problem.
    const source = fs.readFileSync(path.join(SRC, 'config.ts'), 'utf8');
    for (const name of ['registerProjectConfig', 'getProjectConfig', 'BaseSessionLayout', 'AuthProps']) {
      expect(source, `config entry must export ${name}`).toContain(name);
    }
  });
});
