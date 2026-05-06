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
export const defaultPrismaUserAdapter = (): UserAdapter => {
  const userClient = (): any => (prisma as any).user;

  return {
    findByEmail: async ({ email, provider }) => {
      const user = await userClient().findFirst({ where: { email, provider } });
      return user as UserRecord | null;
    },
    findById: async (id) => {
      const user = await userClient().findUnique({ where: { id } });
      return user as UserRecord | null;
    },
    create: async (input) => {
      const created = await userClient().create({
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
      return created as UserRecord;
    },
    update: async (id, patch) => {
      const updated = await userClient().update({ where: { id }, data: patch });
      return updated as UserRecord;
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
