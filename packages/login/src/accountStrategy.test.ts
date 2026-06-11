import { describe, it, expect, vi, beforeEach } from 'vitest';

//? `resolveUserByEmail` reads `getProjectConfig().auth.providerAccountStrategy`
//? at call time and logs via `getLogger()`. Mock @luckystack/core so both are
//? test-controlled and no real config/registry is touched.
const getProjectConfigMock = vi.fn<() => { auth: { providerAccountStrategy: 'per-provider' | 'unified' } }>();
const warnMock = vi.fn();

vi.mock('@luckystack/core', () => ({
  getProjectConfig: () => getProjectConfigMock(),
  getLogger: () => ({ warn: warnMock, info: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { resolveUserByEmail, resetAccountStrategyWarningForTests } from './accountStrategy';
import type { UserAdapter, UserRecord } from './userAdapter';

const userRow = (overrides: Partial<UserRecord> = {}): UserRecord => ({
  id: 'u1',
  email: 'sam@example.com',
  provider: 'google',
  ...overrides,
}) as UserRecord;

const makeAdapter = (overrides: Partial<UserAdapter> = {}): UserAdapter => ({
  findByEmail: vi.fn(async () => null),
  findById: vi.fn(async () => null),
  create: vi.fn(async () => userRow()),
  update: vi.fn(async () => userRow()),
  ...overrides,
});

const setStrategy = (strategy: 'per-provider' | 'unified'): void => {
  getProjectConfigMock.mockReturnValue({ auth: { providerAccountStrategy: strategy } });
};

describe('resolveUserByEmail', () => {
  beforeEach(() => {
    getProjectConfigMock.mockReset();
    warnMock.mockReset();
    resetAccountStrategyWarningForTests();
  });

  it('per-provider: looks up scoped to the given provider', async () => {
    setStrategy('per-provider');
    const findByEmail = vi.fn(async () => null);
    const findByEmailAnyProvider = vi.fn(async () => userRow());
    const adapter = makeAdapter({ findByEmail, findByEmailAnyProvider });

    await resolveUserByEmail(adapter, { email: 'sam@example.com', provider: 'credentials' });

    expect(findByEmail).toHaveBeenCalledWith({ email: 'sam@example.com', provider: 'credentials' });
    expect(findByEmailAnyProvider).not.toHaveBeenCalled();
  });

  it('unified: looks up by email across providers (ignores provider) when the adapter supports it', async () => {
    setStrategy('unified');
    const existing = userRow({ provider: 'google' });
    const findByEmail = vi.fn(async () => null);
    const findByEmailAnyProvider = vi.fn(async () => existing);
    const adapter = makeAdapter({ findByEmail, findByEmailAnyProvider });

    const result = await resolveUserByEmail(adapter, { email: 'sam@example.com', provider: 'github' });

    expect(findByEmailAnyProvider).toHaveBeenCalledWith({ email: 'sam@example.com' });
    expect(findByEmail).not.toHaveBeenCalled();
    expect(result).toBe(existing); // links to the google account on a github sign-in
  });

  it('unified but adapter lacks findByEmailAnyProvider: warns once and falls back to provider-scoped', async () => {
    setStrategy('unified');
    const findByEmail = vi.fn(async () => null);
    const adapter = makeAdapter({ findByEmail, findByEmailAnyProvider: undefined });

    await resolveUserByEmail(adapter, { email: 'sam@example.com', provider: 'github' });
    await resolveUserByEmail(adapter, { email: 'sam@example.com', provider: 'github' });

    expect(findByEmail).toHaveBeenCalledTimes(2);
    expect(findByEmail).toHaveBeenCalledWith({ email: 'sam@example.com', provider: 'github' });
    //? Warning is latched — only the first miss logs.
    expect(warnMock).toHaveBeenCalledTimes(1);
    expect(warnMock.mock.calls[0]?.[0]).toContain('findByEmailAnyProvider');
  });
});
