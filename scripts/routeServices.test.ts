import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assertRouteServicesDeclared as rootCheck, type RouteServicesConfig } from './routeServices';
import { assertRouteServicesDeclared as templateCheck } from '../packages/create-luckystack-app/template/scripts/routeServices';
import referenceServicesConfig from '../services.config';

//? REGRESSION (sweep 015): the production route-map generator skipped routes of
//? an undeclared service without a word, so every settings/* and
//? reset-password/* route existed in dev and in no production bundle.

const here = path.dirname(fileURLToPath(import.meta.url));

const config: RouteServicesConfig = {
  services: { system: { source: 'root' }, vehicles: { source: 'vehicles' }, orphan: { source: 'orphan' } },
  presets: { core: { services: ['system'] }, fleet: { services: ['vehicles'] } },
};

describe.each([
  ['reference app', rootCheck],
  ['template', templateCheck],
])('assertRouteServicesDeclared (%s)', (_label, check) => {
  it('accepts routes whose service is declared and in a preset', () => {
    expect(() => {
      check(['src/_api/session_v1.ts', 'src/_sync/ping_server_v1.ts', 'src/vehicles/_api/list_v1.ts'], config);
    }).not.toThrow();
  });

  it('fails on a route folder that is not declared as a service', () => {
    expect(() => {
      check(['src/_api/session_v1.ts', 'src/settings/_api/changePassword_v1.ts'], config);
    }).toThrow(/'settings' is not declared/);
  });

  it('fails on a declared service that no preset bundles', () => {
    expect(() => {
      check(['src/orphan/_api/thing_v1.ts'], config);
    }).toThrow(/'orphan' is in no preset/);
  });

  it('does not treat an inherited object key as a declared service', () => {
    expect(() => {
      check(['src/constructor/_api/x_v1.ts'], { ...config, presets: { all: { services: ['constructor'] } } });
    }).toThrow(/'constructor' is not declared/);
  });
});

describe('reference app route folders', () => {
  it('are all declared services in a preset', () => {
    //? One representative path per top-level src folder that holds routes.
    //? `playground` is a dev-only tree the generator never bundles.
    const srcDir = path.join(here, '..', 'src');
    const routeFolders = readdirSync(srcDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== 'playground')
      .filter((entry) => ['_api', '_sync'].some((transport) => existsSync(path.join(srcDir, entry.name, transport))))
      .map((entry) => `src/${entry.name}/_api/x_v1.ts`);
    expect(routeFolders).toContain('src/settings/_api/x_v1.ts');
    expect(routeFolders).toContain('src/reset-password/_api/x_v1.ts');

    expect(() => {
      rootCheck(['src/_api/x_v1.ts', ...routeFolders], referenceServicesConfig);
    }).not.toThrow();
  });
});

describe('route-service helper copies', () => {
  it('stay byte-identical between the reference app and the template', () => {
    const root = readFileSync(path.join(here, 'routeServices.ts'), 'utf8');
    const template = readFileSync(path.join(here, '..', 'packages', 'create-luckystack-app', 'template', 'scripts', 'routeServices.ts'), 'utf8');
    expect(template).toBe(root);
  });
});
