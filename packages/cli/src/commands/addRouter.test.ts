import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setInvocationTransport } from './addRouter';
import type { ConsumerProject } from '../lib/project';

let root: string;
let project: ConsumerProject;
const socketLine = "invocation: 'socket' as 'socket' | 'routed-http',";
const routedLine = "invocation: 'routed-http' as 'socket' | 'routed-http',";

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'luckystack-add-router-'));
  const pkgPath = path.join(root, 'package.json');
  fs.writeFileSync(pkgPath, '{"name":"fixture"}\n');
  fs.writeFileSync(path.join(root, 'config.ts'), `${socketLine}\n`);
  project = { root, pkgPath, pkg: { name: 'fixture' } };
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('router invocation transport wiring', () => {
  it('switches routed invocation on add and restores socket invocation on remove', () => {
    setInvocationTransport(project, socketLine, routedLine);
    expect(fs.readFileSync(path.join(root, 'config.ts'), 'utf8')).toContain(routedLine);

    setInvocationTransport(project, routedLine, socketLine);
    expect(fs.readFileSync(path.join(root, 'config.ts'), 'utf8')).toContain(socketLine);
  });
});
