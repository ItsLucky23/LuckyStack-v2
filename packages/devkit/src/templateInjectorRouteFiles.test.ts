import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

//? The project lives under a folder named `src` on purpose: a path reader that
//? anchors on the first `src/` of an absolute path instead of the configured
//? srcDir gets the page path wrong here.
const ROOT = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ls-injector-')), 'src', 'app');
const SRC = path.join(ROOT, 'src');
const GENERATED = path.join(ROOT, 'apiTypes.generated.ts');
fs.mkdirSync(SRC, { recursive: true });

vi.mock('@luckystack/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@luckystack/core')>();
  return {
    ...actual,
    ROOT_DIR: ROOT,
    getSrcDir: () => SRC,
    getGeneratedSocketTypesPath: () => GENERATED,
  };
});

const {
  extractClientInputFromGeneratedTypes,
  extractSyncName,
  extractSyncPagePath,
  extractSyncVersion,
  getRouteFilenameValidationMessage,
  shouldInjectTemplate,
  updateClientFileForPairedServer,
} = await import('./templateInjector');
const { registerRoutingRules } = await import('./routingRules');

vi.spyOn(console, 'log').mockImplementation(() => undefined);

afterAll(() => {
  fs.rmSync(path.dirname(path.dirname(ROOT)), { recursive: true, force: true });
});

afterEach(() => {
  registerRoutingRules({}); //? restore defaults
});

const writeFile = (relative: string, content: string): string => {
  const file = path.join(SRC, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
};

describe('non-route files under a marker', () => {
  it('a private helper is not reported as a misnamed route', () => {
    expect(getRouteFilenameValidationMessage(path.join(SRC, 'chat/_api/_lib/helpers.ts'))).toBeNull();
    expect(getRouteFilenameValidationMessage(path.join(SRC, 'chat/_sync/_lib/helpers.ts'))).toBeNull();
  });

  it('a co-located test file is not reported as a misnamed route', () => {
    expect(getRouteFilenameValidationMessage(path.join(SRC, 'chat/_api/send.test.ts'))).toBeNull();
    expect(getRouteFilenameValidationMessage(path.join(SRC, 'chat/_sync/push.spec.ts'))).toBeNull();
  });

  it('a new empty helper does not get a template or guidance', () => {
    const helper = writeFile('chat/_api/_lib/new.ts', '');
    expect(shouldInjectTemplate(helper, { isNewFile: true })).toBe(false);
  });

  it('a misnamed route file still gets the guidance message', () => {
    expect(getRouteFilenameValidationMessage(path.join(SRC, 'chat/_api/BADNAME.ts'))).toContain('Invalid API filename');
  });
});

describe('sync path readers follow srcDir and the sync marker', () => {
  it('reads the page from srcDir, not from the first `src/` in the path', () => {
    const file = path.join(SRC, 'examples/_sync/x_server_v1.ts');
    expect(extractSyncPagePath(file)).toBe('examples');
    expect(extractSyncName(file)).toBe('x');
    expect(extractSyncVersion(file)).toBe('v1');
  });

  it('maps a root sync to `system`', () => {
    expect(extractSyncPagePath(path.join(SRC, '_sync/x_server_v2.ts'))).toBe('system');
    expect(extractSyncVersion(path.join(SRC, '_sync/x_server_v2.ts'))).toBe('v2');
  });

  it('honours a custom sync marker', () => {
    registerRoutingRules({ syncMarker: '_live' });
    const file = path.join(SRC, 'chat/_live/push_client_v3.ts');
    expect(extractSyncPagePath(file)).toBe('chat');
    expect(extractSyncName(file)).toBe('push');
  });

  it('writes the srcDir-relative PagePath into a paired client', async () => {
    const client = writeFile(
      'examples/_sync/x_client_v1.ts',
      [
        "import { SyncClientInput } from '../../../src/_sockets/apiTypes.generated';",
        '',
        'export interface SyncParams {',
        '  clientInput: { message: string };',
        '}',
        '',
        'export const main = async ({ clientInput }: SyncParams) => {',
        '  return { status: "success" as const, text: clientInput.message };',
        '};',
        '',
      ].join('\n'),
    );

    expect(await updateClientFileForPairedServer(client)).toBe(true);
    expect(fs.readFileSync(client, 'utf8')).toContain("type PagePath = 'examples';");
  });
});

describe('template injection on add keeps user content', () => {
  it('an empty new file gets the template', () => {
    expect(shouldInjectTemplate(writeFile('chat/_api/a_v1.ts', ''), { isNewFile: true })).toBe(true);
  });

  it('a file holding only the injector guidance gets the template once renamed', () => {
    const guidance = '// Invalid API filename: b.ts Reason: Missing required version suffix. This file is ignored by route loading and type generation until it is renamed.\n';
    expect(shouldInjectTemplate(writeFile('chat/_api/b_v1.ts', guidance), { isNewFile: true })).toBe(true);
  });

  it('a fully commented-out route that arrives by rename is left alone', () => {
    const commentedOut = '// export const main = async () => {\n//   return { status: "success" };\n// };\n';
    expect(shouldInjectTemplate(writeFile('chat/_api/c_v2.ts', commentedOut), { isNewFile: true })).toBe(false);
    expect(shouldInjectTemplate(writeFile('chat/page.tsx', '/* export default function Page() {} */\n'), { isNewFile: true })).toBe(false);
  });
});

describe('client input from the generated sync type map', () => {
  //? The API map is emitted first and has an entry for the same page; the sync
  //? map has a version level. Both shapes the file is found in are covered:
  //? the emitter's quoted keys and a formatter's unquoted ones.
  const emitterOutput = `
type _ProjectApiTypeMap = {
  'playground': {
    'echo': {
      'v1': {
        input: { wrong: number };
        output: { status: 'success' };
      };
    };
  };
};

type _ProjectSyncTypeMap = {
  'playground': {
    'echo': {
      'v1': {
        clientInput: {
          message: string;
        };
        serverOutput: { status: 'success' };
      };
      'v2': {
        clientInput: { other: boolean };
        serverOutput: { status: 'success' };
      };
    };
  };
  'system': {
    'ping': {
      'v1': {
        clientInput: { at: number };
      };
    };
  };
};
`;

  it('finds the versioned entry in the sync map, not the API map', () => {
    fs.writeFileSync(GENERATED, emitterOutput);
    expect(extractClientInputFromGeneratedTypes('playground', 'echo', 'v1')).toBe('{\n          message: string;\n        }');
    expect(extractClientInputFromGeneratedTypes('playground', 'echo', 'v2')).toBe('{ other: boolean }');
    expect(extractClientInputFromGeneratedTypes('system', 'ping', 'v1')).toBe('{ at: number }');
  });

  it('reads a formatter-rewritten file with unquoted keys', () => {
    fs.writeFileSync(GENERATED, emitterOutput.replaceAll(/'([A-Za-z]\w*)':/g, '$1:'));
    expect(extractClientInputFromGeneratedTypes('playground', 'echo', 'v1')).toBe('{\n          message: string;\n        }');
  });

  it('returns null for an unknown route', () => {
    fs.writeFileSync(GENERATED, emitterOutput);
    expect(extractClientInputFromGeneratedTypes('playground', 'missing', 'v1')).toBeNull();
    expect(extractClientInputFromGeneratedTypes('playground', 'echo', 'v9')).toBeNull();
  });
});
