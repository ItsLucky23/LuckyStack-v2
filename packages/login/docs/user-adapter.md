# User adapter

Deep-dive on the `UserAdapter` extension point — the abstraction between auth flows and the consumer's user data store. Canonical source: [`./src/userAdapter.ts`](../src/userAdapter.ts).

---

## Why a User Adapter

`@luckystack/login` ships a default that reads and writes the framework's recommended Prisma `User` model:

```prisma
model User {
  id              String   @id @default(cuid())
  email           String   @unique
  provider        String   // enum: PROVIDERS in your schema
  password        String?
  name            String?
  avatar          String?
  avatarFallback  String?
  language        String?
  // lastLogin?    DateTime?   // optional — best-effort updated on each login
}
```

That default covers single-tenant apps with the canonical schema. The adapter exists for everything else:

- **Multi-tenant** — every query should be scoped by `tenantId` read from `AsyncLocalStorage`.
- **Soft delete** — `findByEmail` / `findById` should filter `deletedAt: null`.
- **Renamed columns** — your schema calls it `displayName` instead of `name`, or `emailAddress` instead of `email`.
- **Additional required columns** — your `User` model has a non-nullable `organizationId` that the framework can't supply.
- **Non-Prisma data layer** — Drizzle, Kysely, raw `pg`, a REST microservice, a GraphQL gateway.
- **Read-replica routing** — `findByEmail` hits the replica, `create` / `update` hit the primary.

The adapter has exactly four methods. Implement them and call `registerUserAdapter(adapter)` at boot.

## API surface

```ts
interface UserAdapter {
  findByEmail: (params: { email: string; provider: string }) => Promise<UserRecord | null>;
  findById:    (id: string) => Promise<UserRecord | null>;
  create:      (input: UserAdapterCreateInput) => Promise<UserRecord>;
  update:      (id: string, patch: Partial<UserRecord>) => Promise<UserRecord>;
}

registerUserAdapter(adapter: UserAdapter): UserAdapter;
getUserAdapter(): UserAdapter;
isUserAdapterRegistered(): boolean;
defaultPrismaUserAdapter(): UserAdapter;
```

`registerUserAdapter` is last-write-wins. `getUserAdapter` returns the registered adapter, or falls back to `defaultPrismaUserAdapter()` lazily on first call. `isUserAdapterRegistered()` returns `true` iff a custom adapter has been registered — useful when an integration package wants to bail with a helpful error if the consumer hasn't yet swapped the default.

## Required methods

### `findByEmail({ email, provider })`

Lookup a user by their (email, provider) pair. The pair is the unique identity in the framework — the same email registered via `'credentials'` and via `'google'` are two different `UserRecord`s. Return `null` when no row matches.

Called from:

- `registerWithCredentials` — duplicate-email guard.
- `loginWithCredentialsCore` — find-the-user-to-authenticate.
- `loginCallback` (OAuth) — find-or-create branch.
- `sendPasswordResetEmail` — locate the credentials user behind a reset request.

### `findById(id)`

Lookup a user by id. Returns `null` when missing. Called by consumer-side code that needs a fresh user read by id; the framework itself uses `findByEmail` everywhere except for hooks that pass `userId` and want the live record.

### `create(input)`

Insert a new user. `UserAdapterCreateInput` is intentionally loose (string-typed fields) because the framework cannot statically know consumer-side Prisma enums for `provider` / `language`:

```ts
interface UserAdapterCreateInput {
  email: string;
  provider: string;
  name?: string | null;
  password?: string | null;       // bcrypt hash for credentials; null for OAuth
  avatar?: string | null;
  avatarFallback?: string | null; // hex color string '#aabbcc' for the avatar initials fallback
  language?: string | null;
}
```

Return the freshly-inserted `UserRecord`. The framework wraps the call in `tryCatch` and surfaces a `login.createUserFailed` reason key when the call resolves to a falsy value (or `api.internalServerError` when it throws).

### `update(id, patch)`

Patch an existing user. The framework calls this for:

- `lastLogin: new Date()` on every successful login (best-effort, wrapped in `tryCatch`).
- `password: hashedNew` on `updatePasswordHash` from the password-reset / password-change flows.
- `avatar` after image upload (consumer-side).

`patch` is typed as `Partial<UserRecord>`. The framework casts to `never` at the call site for the `lastLogin` and `password` updates so a schema missing those fields doesn't break compilation — the adapter is responsible for accepting (or ignoring) unknown keys gracefully.

## `UserRecord` shape

```ts
interface UserRecord extends BaseSessionLayout {
  password?: string | null;
  provider?: string | null;
  lastLogin?: Date | null;
}
```

`BaseSessionLayout` (from `@luckystack/core`) covers the standard fields: `id`, `email`, `name`, `avatar`, `avatarFallback`, `admin`, `language`. `UserRecord` adds three things the session layout deliberately doesn't expose:

- `password` — the bcrypt hash. Stripped before the session is built (`sanitizeUserForSession`).
- `provider` — the auth provider. The session knows this only when the consumer needs it; some apps don't.
- `lastLogin` — best-effort timestamp. Mirrored on the session as both `lastLogin` (the just-written value) and `previousLogin` (the value before the update).

Consumers who add columns can either:

1. **Augment `BaseSessionLayout`** via module declaration so the new field flows to the session, OR
2. **Keep the field internal** to the adapter implementation and not expose it on `UserRecord`.

The first option is right for "data the UI should see" (preferences, role, organization id). The second is right for "data the auth layer doesn't care about" (audit fields, internal flags).

## `defaultPrismaUserAdapter`

The framework default. Implementation:

```ts
export const defaultPrismaUserAdapter = (): UserAdapter => {
  const user = (): PrismaUserDelegate => prisma.user as unknown as PrismaUserDelegate;

  return {
    findByEmail: async ({ email, provider }) =>
      user().findFirst({ where: { email, provider } }),
    findById: async (id) =>
      user().findUnique({ where: { id } }),
    create: async (input) =>
      user().create({
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
      user().update({ where: { id }, data: patch }),
  };
};
```

The single `as unknown as PrismaUserDelegate` cast is the only one of its kind in `@luckystack/login` and is intentional + load-bearing. It is the abstraction boundary between the framework's loose `UserAdapterCreateInput` (string-typed fields) and the consumer's strict Prisma model (which may declare enums for `provider` / `language`). The framework cannot know those enum types statically, so it type-erases once at this seam and trusts the runtime `prisma.user` to satisfy the documented `PrismaUserDelegate` shape:

```ts
interface PrismaUserDelegate {
  findFirst: (args: { where: { email: string; provider: string } }) => Promise<UserRecord | null>;
  findUnique: (args: { where: { id: string } }) => Promise<UserRecord | null>;
  create: (args: { data: Record<string, unknown> }) => Promise<UserRecord>;
  update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<UserRecord>;
}
```

Consumers whose schema diverges should NOT widen this cast further — register their own `UserAdapter` instead.

## Lazy initialization

`getUserAdapter` defers default construction until first use:

```ts
let registeredAdapter: UserAdapter | null = null;
let cachedDefaultAdapter: UserAdapter | null = null;

export const getUserAdapter = (): UserAdapter => {
  if (registeredAdapter) return registeredAdapter;
  if (!cachedDefaultAdapter) {
    cachedDefaultAdapter = defaultPrismaUserAdapter();
  }
  return cachedDefaultAdapter;
};
```

This matters because `defaultPrismaUserAdapter` calls `prisma.user` — which is a Prisma proxy that connects on first read. If we instantiated eagerly, modules that just import `@luckystack/login` (without ever logging anyone in) would open a database connection at import time.

Lazy + cached means:

- Pure imports never connect to the DB.
- The first login attempt creates one adapter and reuses it forever.
- Custom adapters bypass the cache entirely.

## Recipes

### Multi-tenant scoping

```ts
import { AsyncLocalStorage } from 'node:async_hooks';

export const tenantContext = new AsyncLocalStorage<{ tenantId: string }>();

const tenantedAdapter: UserAdapter = {
  findByEmail: async ({ email, provider }) => {
    const ctx = tenantContext.getStore();
    if (!ctx) throw new Error('No tenant context');
    return prisma.user.findFirst({
      where: { email, provider, tenantId: ctx.tenantId },
    });
  },
  // ... same for findById, create, update
};

registerUserAdapter(tenantedAdapter);
```

The HTTP middleware that resolves `tenantId` from the host header runs `tenantContext.run({ tenantId }, next)` so the adapter reads it without an explicit parameter.

### Soft delete

```ts
const softDeleteAdapter: UserAdapter = {
  ...defaultPrismaUserAdapter(),
  findByEmail: async ({ email, provider }) =>
    prisma.user.findFirst({
      where: { email, provider, deletedAt: null },
    }),
  findById: async (id) =>
    prisma.user.findFirst({
      where: { id, deletedAt: null },
    }),
};

registerUserAdapter(softDeleteAdapter);
```

The spread keeps `create` and `update` identical to the default — only the read methods get the `deletedAt: null` filter.

### Alternative ORM (Drizzle)

```ts
import { db } from './db';
import { users } from './schema';
import { and, eq } from 'drizzle-orm';

const drizzleAdapter: UserAdapter = {
  findByEmail: async ({ email, provider }) => {
    const rows = await db.select().from(users)
      .where(and(eq(users.email, email), eq(users.provider, provider)));
    return rows[0] ?? null;
  },
  findById: async (id) => {
    const rows = await db.select().from(users).where(eq(users.id, id));
    return rows[0] ?? null;
  },
  create: async (input) => {
    const [row] = await db.insert(users).values(input).returning();
    return row;
  },
  update: async (id, patch) => {
    const [row] = await db.update(users).set(patch).where(eq(users.id, id)).returning();
    return row;
  },
};

registerUserAdapter(drizzleAdapter);
```

### Additional required column

If your schema requires `organizationId` on create, override only the `create` method:

```ts
const orgScopedAdapter: UserAdapter = {
  ...defaultPrismaUserAdapter(),
  create: async (input) => {
    const orgId = tenantContext.getStore()?.tenantId;
    if (!orgId) throw new Error('No org context for create');
    return prisma.user.create({
      data: { ...input, organizationId: orgId },
    });
  },
};

registerUserAdapter(orgScopedAdapter);
```

### Read-replica routing

```ts
const replicaAdapter: UserAdapter = {
  findByEmail: async (args) => prismaReplica.user.findFirst({ where: args }),
  findById:    async (id)   => prismaReplica.user.findUnique({ where: { id } }),
  create:      async (input) => prismaPrimary.user.create({ data: { ...input } }),
  update:      async (id, patch) => prismaPrimary.user.update({ where: { id }, data: patch }),
};

registerUserAdapter(replicaAdapter);
```

The framework reads via `findByEmail` on every login, so routing reads to a replica is a meaningful production optimization. Reads after a write (e.g. `findByEmail` immediately after `create` during register) should still hit the primary — handle that with a read-your-writes timestamp or a per-request "stick to primary for N ms" flag inside your adapter.

## `lastLogin` semantics

The default adapter accepts `lastLogin` in `update` because it casts to `Record<string, unknown>` for the `data` field. The framework writes `{ lastLogin: new Date() }` after a successful credentials or OAuth login, wrapped in `tryCatch`:

```ts
await tryCatch(() => userAdapter.update(findUserResponse.id, { lastLogin: nowLogin } as never));
```

The cast to `never` is intentional — it tells TypeScript "we know `lastLogin` may not be in `UserRecord`, accept it anyway". If your schema doesn't have a `lastLogin` column, the call either:

- Fails inside Prisma's runtime field validation → `tryCatch` swallows the error, the login succeeds.
- Succeeds silently if your adapter ignores unknown keys (recommended).

The session's `lastLogin` and `previousLogin` are populated from this update — if it fails, both fields will be `undefined` on the session and the UI should treat them as optional.

For audit-grade tracking, register a `postLogin` hook instead of relying on the column:

```ts
registerHook('postLogin', async ({ userId, provider }) => {
  await prisma.loginEvent.create({
    data: { userId, provider, timestamp: new Date() },
  });
});
```

The hook gives you a row-per-login with full context, vs. the column which is a single mutating timestamp.

## Composing on top of the default

A common pattern is "the default but with one method overridden":

```ts
const base = defaultPrismaUserAdapter();

registerUserAdapter({
  ...base,
  findByEmail: async ({ email, provider }) => {
    const user = await base.findByEmail({ email, provider });
    if (!user) return null;
    if (user.disabledAt) return null; // app-level "disabled" flag
    return user;
  },
});
```

This avoids re-implementing the other three methods just to add a single filter.

## Related

- [`./credentials-auth.md`](./credentials-auth.md) — what calls `findByEmail` / `create` for credentials flows.
- [`./oauth-providers.md`](./oauth-providers.md) — `loginCallback` uses the same adapter surface.
- [`./password-reset.md`](./password-reset.md) — `updatePasswordHash` calls `update` with `{ password }`.
- [`./session-management.md`](./session-management.md) — the adapter does NOT touch sessions; sessions are a separate adapter.
- Architecture: [`/docs/ARCHITECTURE_AUTH.md`](../../../docs/ARCHITECTURE_AUTH.md).
