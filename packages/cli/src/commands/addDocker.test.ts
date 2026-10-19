import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addDocker, checkDocker, gitignoreCovers, renderDockerVariables } from './addDocker';
import { buildDockerTemplateVars, DEFAULT_CHOICES } from '../../../create-luckystack-app/src/index';
import type { ConsumerProject } from '../lib/project';

let root: string;
let project: ConsumerProject;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'luckystack-add-docker-'));
  const pkgPath = path.join(root, 'package.json');
  const pkg = {
    name: 'example-app',
    dependencies: { '@luckystack/core': '^0.7.6', '@luckystack/router': '^0.7.6' },
    scripts: {},
  };
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  fs.mkdirSync(path.join(root, 'prisma'), { recursive: true });
  fs.writeFileSync(path.join(root, 'prisma', 'schema.prisma'), 'datasource db { provider = "mongodb" }\n');
  fs.writeFileSync(path.join(root, 'config.ts'), "invocation: 'routed-http' as 'socket' | 'routed-http',\n");
  project = { root, pkgPath, pkg };
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('Docker assets', () => {
  it.each(['mongodb', 'postgresql', 'mysql', 'sqlite'] as const)(
    'keeps CLI and scaffold %s rendering equivalent',
    (provider) => {
      fs.writeFileSync(path.join(root, 'prisma', 'schema.prisma'), `datasource db { provider = "${provider}" }\n`);
      expect(renderDockerVariables(project)).toEqual({
        PROJECT_NAME: 'example-app',
        ...buildDockerTemplateVars('example-app', {
          ...DEFAULT_CHOICES,
          dbProvider: provider,
          router: true,
        }),
      });
    },
  );

  it('renders a generic preset-aware router stack without consumer-specific data', () => {
    expect(addDocker(project).ok).toBe(true);
    const compose = fs.readFileSync(path.join(root, 'compose.yaml'), 'utf8');
    expect(compose).toContain('name: example-app');
    expect(compose).toContain('LUCKYSTACK_PRESET: ${LUCKYSTACK_PRESET:-default}');
    expect(compose).toContain('target: router');
    expect(compose).not.toContain('{{');
    expect(compose.toLowerCase()).not.toContain('flexbuddy');
    expect(fs.readFileSync(path.join(root, 'docker', 'mongo-replica-init.js'), 'utf8')).not.toContain('insertOne');
    expect(fs.existsSync(path.join(root, '.dockerignore'))).toBe(true);
    expect(checkDocker(project).ok).toBe(true);
    expect(renderDockerVariables(project)).toEqual({
      PROJECT_NAME: 'example-app',
      ...buildDockerTemplateVars('example-app', {
        ...DEFAULT_CHOICES,
        router: true,
      }),
    });
  });
});

describe('Docker database detection (finding 022)', () => {
  const writeManifestChoices = (choices: Record<string, unknown>): void => {
    fs.mkdirSync(path.join(root, '.luckystack'), { recursive: true });
    fs.writeFileSync(path.join(root, '.luckystack', 'scaffold.json'), JSON.stringify({ schemaVersion: 1, choices, files: [] }));
  };

  it('uses the recorded dbProvider for a non-Prisma project instead of falling back to MongoDB', () => {
    fs.rmSync(path.join(root, 'prisma'), { recursive: true, force: true });
    writeManifestChoices({ orm: 'drizzle', dbProvider: 'postgresql' });

    expect(addDocker(project).ok).toBe(true);
    const compose = fs.readFileSync(path.join(root, 'compose.yaml'), 'utf8');
    expect(compose).toContain('postgres:17-alpine');
    expect(compose).not.toContain('mongo:7');
  });

  it('refuses to guess when nothing records the database, and names the --db flag', () => {
    fs.rmSync(path.join(root, 'prisma'), { recursive: true, force: true });

    const result = addDocker(project);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('--db=');
    expect(fs.existsSync(path.join(root, 'compose.yaml'))).toBe(false);
  });

  it('takes --db when detection finds nothing', () => {
    fs.rmSync(path.join(root, 'prisma'), { recursive: true, force: true });

    expect(addDocker(project, { dbProvider: 'mysql' }).ok).toBe(true);
    expect(fs.readFileSync(path.join(root, 'compose.yaml'), 'utf8')).toContain('mysql:8.4');
    expect(addDocker(project, { dbProvider: 'oracle' }).ok).toBe(false);
  });
});

describe('Docker .env.docker stays out of git (finding 010)', () => {
  const gitignore = (): string => fs.readFileSync(path.join(root, '.gitignore'), 'utf8');

  it('creates .gitignore with .env.docker when the project has none', () => {
    expect(addDocker(project).ok).toBe(true);
    expect(gitignore()).toBe('.env.docker\n');
  });

  it('appends .env.docker on its own line to an existing .gitignore', () => {
    fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules\n.env.local');
    expect(addDocker(project).ok).toBe(true);
    expect(gitignore()).toBe('node_modules\n.env.local\n.env.docker\n');
  });

  it('leaves a .gitignore that already covers it untouched, including the scaffold one', () => {
    const scaffoldIgnore = fs.readFileSync(
      path.join(import.meta.dirname, '..', '..', '..', 'create-luckystack-app', 'template', '_dot_gitignore'),
      'utf8',
    );
    for (const content of ['.env.*\n', '/.env.docker\n', scaffoldIgnore]) {
      fs.writeFileSync(path.join(root, '.gitignore'), content);
      expect(addDocker(project).ok).toBe(true);
      expect(gitignore()).toBe(content);
    }
  });

  it('treats a later negation as not covered', () => {
    expect(gitignoreCovers('.env*\n!.env.docker\n', '.env.docker')).toBe(false);
    expect(gitignoreCovers('# .env.docker\n.env.dockerfile\nenv/\n', '.env.docker')).toBe(false);
    expect(gitignoreCovers('.env.d?cker\n', '.env.docker')).toBe(true);
  });
});
