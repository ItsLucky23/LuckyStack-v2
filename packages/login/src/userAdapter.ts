//? User adapter registry. Decouples auth flows from a specific Prisma User
//? schema so consumers with different column names, additional fields, or a
//? non-Prisma data layer can plug their own implementation.
//?
//? `defaultPrismaUserAdapter()` implements the framework's recommended schema
//? (id, email, password?, provider, name, avatar, avatarFallback, admin,
//? language) and is used automatically when no adapter has been registered.

import { prisma, type BaseSessionLayout } from '@luckystack/core';

export interface UserAdapterCreateInput {
  email: string;
  provider: string;
  name?: string | null;
  password?: string | null;
  avatar?: string | null;
  avatarFallback?: string | null;
  language?: string | null;
}

export interface UserRecord extends BaseSessionLayout {
  password?: string | null;
  provider?: string | null;
  /** Most recent successful login. Mirrors the optional `lastLogin` column on User. */
  lastLogin?: Date | null;
}

export interface UserAdapter {
  findByEmail: (params: { email: string; provider: string }) => Promise<UserRecord | null>;
  /**
   * Look up a user by email IRRESPECTIVE of provider. Required only when
   * `auth.providerAccountStrategy === 'unified'` — the framework resolves
   * accounts by email alone so the same address maps to one User across
   * providers. Optional so existing custom adapters keep compiling; when a
   * project sets `'unified'` but its adapter omits this method, the framework
   * logs a one-time warning and falls back to provider-scoped lookup.
   */
  findByEmailAnyProvider?: (params: { email: string }) => Promise<UserRecord | null>;
  findById: (id: string) => Promise<UserRecord | null>;
  create: (input: UserAdapterCreateInput) => Promise<UserRecord>;
  update: (id: string, patch: Partial<UserRecord>) => Promise<UserRecord>;
}

let registeredAdapter: UserAdapter | null = null;

export const registerUserAdapter = (adapter: UserAdapter): UserAdapter => {
  registeredAdapter = adapter;
  return registeredAdapter;
};

export const isUserAdapterRegistered = (): boolean => registeredAdapter !== null;

//? Default adapter: backed by the Prisma client exposed from `@luckystack/core`.
//?
//? The single `as unknown as PrismaUserDelegate` below is intentional and
//? load-bearing — it is the abstraction boundary between the framework's
//? loose `UserAdapterCreateInput` (string-typed fields) and the consumer's
//? strict Prisma model (which may declare enums for `provider`, `language`,
//? etc.). The framework cannot know those enum types statically, so it
//? type-erases once at this seam and assumes the runtime `prisma.user`
//? satisfies the documented `PrismaUserDelegate` shape. Consumers whose User
//? schema diverges (different column names, mandatory extra fields) should
//? register their own `UserAdapter` via `registerUserAdapter(...)` rather
//? than relying on this default.
interface PrismaUserDelegate {
  findFirst: (args: { where: { email: string; provider?: string } }) => Promise<UserRecord | null>;
  findUnique: (args: { where: { id: string } }) => Promise<UserRecord | null>;
  create: (args: { data: Record<string, unknown> }) => Promise<UserRecord>;
  update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<UserRecord>;
}

//? Bridge between Prisma's generated client surface and the adapter contract.
//? Structural cast required because Prisma's auto-generated delegate types
//? don't structurally match our trimmed `PrismaUserDelegate` shape; this is a
//? known framework boundary (see /docs/ARCHITECTURE_AUTH.md).
const getPrismaUser = (): PrismaUserDelegate =>
  // eslint-disable-next-line no-restricted-syntax -- structural Prisma boundary
  prisma.user as unknown as PrismaUserDelegate;

export const defaultPrismaUserAdapter = (): UserAdapter => {
  return {
    findByEmail: async ({ email, provider }) =>
      getPrismaUser().findFirst({ where: { email, provider } }),
    findByEmailAnyProvider: async ({ email }) =>
      getPrismaUser().findFirst({ where: { email } }),
    findById: async (id) =>
      getPrismaUser().findUnique({ where: { id } }),
    create: async (input) =>
      getPrismaUser().create({
        data: {
          email: input.email,
          provider: input.provider,
          name: input.name,
          password: input.password ?? null,
          avatar: input.avatar ?? '',
          avatarFallback: input.avatarFallback,
          language: input.language,
        },
      }),
    update: async (id, patch) =>
      getPrismaUser().update({ where: { id }, data: patch }),
  };
};

let cachedDefaultAdapter: UserAdapter | null = null;

export const getUserAdapter = (): UserAdapter => {
  if (registeredAdapter) return registeredAdapter;
  cachedDefaultAdapter ??= defaultPrismaUserAdapter();
  return cachedDefaultAdapter;
};
