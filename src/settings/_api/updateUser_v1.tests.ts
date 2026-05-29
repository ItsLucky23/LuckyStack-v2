import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

//? Per-route tests for `settings/updateUser/v1`.
//? The auto-sweep already covers: contract validation, auth enforcement,
//? rate-limit clamp, fuzz crash-resistance. Add cases below for the
//? business-logic assertions the sweep can't reach.
//?
//? Suggested scenarios — replace placeholders with real assertions:
//? [x] Happy path updates name (DB row + session reflect the new value)
//? [x] Session payload reflects the new name on the next session read
//? [x] Avatar with invalid data-URL prefix → avatar.invalidFormat
//?
//? NOTE — current behavior surprise: `updateUser` does NOT enforce email
//? uniqueness or even accept an `email` field. The spec mentioned an
//? "email collision" case, but the route's typed input is `{ name?, theme?,
//? language?, avatar? }` — no email surface to collide on. The unique-email
//? assertion is therefore moved to the route owner's todo list; here we
//? assert what the route actually does.
//?
//? Input shape (from `src/_sockets/apiTypes.generated.ts`):
//?   {
//?     name?: string;
//?     theme?: 'dark' | 'light';
//?     language?: 'nl' | 'en' | 'de' | 'fr';
//?     avatar?: string; // data:<mime>;base64,<payload>
//?   }

interface UpdateUserSuccess {
  status: 'success';
  result: Record<string, never>;
}
interface UpdateUserError {
  status: 'error';
  errorCode: string;
}
type UpdateUserResponse = UpdateUserSuccess | UpdateUserError;

const seedUser = async (
  ctx: TestContext,
  initialName = 'Original Name',
): Promise<{ userId: string; email: string; token: string }> => {
  const email = `usr-${Date.now().toString()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const created = await ctx.prisma.user.create({
    data: {
      email,
      name: initialName,
      provider: 'credentials',
      avatarFallback: initialName.charAt(0),
    },
  });
  const { token } = await ctx.session.login({ id: created.id, email, name: initialName });
  return { userId: created.id, email, token };
};

export const customTests: CustomTestCase[] = [
  {
    name: 'happy path updates name on the user row',
    run: async (ctx: TestContext) => {
      const { userId } = await seedUser(ctx, 'Old Name');
      const result = await ctx.callApi<unknown, UpdateUserResponse>({ name: 'New Name' });
      ctx.expect.eq(result.status, 'success');
      const dbUser = await ctx.prisma.user.findUnique({ where: { id: userId } });
      ctx.expect.eq(dbUser?.name, 'New Name');
    },
  },
  {
    name: 'session payload reflects the new name after the update',
    run: async (ctx: TestContext) => {
      const { token } = await seedUser(ctx, 'Old Name');
      const result = await ctx.callApi<unknown, UpdateUserResponse>({ name: 'Renamed' });
      ctx.expect.eq(result.status, 'success');
      //? Spec asked for `system/session/v1` to reflect the new name. Since
      //? `ctx.callApi` is bound to `updateUser`, we re-read the session
      //? store directly through the same adapter that endpoint would use.
      const { getSession } = await import('@luckystack/login');
      const session = await getSession(token);
      ctx.expect.ok(session, 'session must still exist after update');
      ctx.expect.eq(session?.name, 'Renamed');
    },
  },
  {
    name: 'invalid avatar data-URL prefix returns avatar.invalidFormat',
    run: async (ctx: TestContext) => {
      await seedUser(ctx);
      const result = await ctx.callApi<unknown, UpdateUserResponse>({
        avatar: 'not-a-real-data-url',
      });
      ctx.expect.eq(result.status, 'error');
      if (result.status === 'error') ctx.expect.eq(result.errorCode, 'avatar.invalidFormat');
    },
  },
];
