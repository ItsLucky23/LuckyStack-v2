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
//? Once Phase 1.3 lands, the `prisma` export flows through a registry so
//? consumers can substitute their own Prisma client (TLS, Accelerate, custom
//? logger, ...) without touching this adapter.
//?
//? Why the narrow `PrismaUserDelegate` shape: framework can't know the
//? consumer's User model (column names, extra fields, etc.). We define the
//? minimum surface this adapter actually calls and assert that the runtime
//? `prisma.user` provides it. Consumers whose User schema diverges from the
//? recommended one should register their own `UserAdapter` via
//? `registerUserAdapter(...)` instead of relying on this default.
interface PrismaUserDelegate {
  findFirst: (args: { where: { email: string; provider: string } }) => Promise<UserRecord | null>;
  findUnique: (args: { where: { id: string } }) => Promise<UserRecord | null>;
  create: (args: { data: Record<string, unknown> }) => Promise<UserRecord>;
  update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<UserRecord>;
}

export const defaultPrismaUserAdapter = (): UserAdapter => {
  //? Single, well-defined boundary: type-erase to `unknown` once, narrow back
  //? to the documented delegate shape. Resolved at call time so a registered
  //? `prisma` proxy still wins.
  const userClient = (): PrismaUserDelegate => {
    const delegate = (prisma as unknown as { user: unknown }).user;
    return delegate as PrismaUserDelegate;
  };

  return {
    findByEmail: async ({ email, provider }) => {
      return userClient().findFirst({ where: { email, provider } });
    },
    findById: async (id) => {
      return userClient().findUnique({ where: { id } });
    },
    create: async (input) => {
      return userClient().create({
        data: {
          email: input.email,
          provider: input.provider,
          name: input.name,
          password: input.password ?? null,
          avatar: input.avatar ?? '',
          avatarFallback: input.avatarFallback,
          language: input.language,
        },
      });
    },
    update: async (id, patch) => {
      return userClient().update({ where: { id }, data: patch as Record<string, unknown> });
    },
  };
};

let cachedDefaultAdapter: UserAdapter | null = null;

export const getUserAdapter = (): UserAdapter => {
  if (registeredAdapter) return registeredAdapter;
  if (!cachedDefaultAdapter) {
    cachedDefaultAdapter = defaultPrismaUserAdapter();
  }
  return cachedDefaultAdapter;
};
