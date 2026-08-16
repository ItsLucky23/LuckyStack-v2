import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addDocker, checkDocker, renderDockerVariables } from './addDocker';
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
