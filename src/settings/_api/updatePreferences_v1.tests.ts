import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

//? Per-route tests for `settings/updatePreferences/v1`.
//? The auto-sweep already covers: contract validation, auth enforcement,
//? rate-limit clamp, fuzz crash-resistance. Add cases below for the
//? business-logic assertions the sweep can't reach.
//?
//? Suggested scenarios — replace placeholders with real assertions:
//? [x] Happy path persists preferences (DB row reflects them)
//? [x] `false` is preserved (not collapsed to absent — guards against
//?     accidental truthy-check regressions in the allow-list filter)
//? [x] Idempotent: calling twice with same input keeps DB stable
//?
//? Input shape (from `src/_sockets/apiTypes.generated.ts`):
//?   {
//?     preferences: {
//?       notifyOnNewSignIn?: boolean;
//?       notifyOnPasswordChange?: boolean;
//?     };
//?   }

interface UpdatePreferencesSuccess {
  status: 'success';
  result: { preferences: Record<string, boolean> };
}
interface UpdatePreferencesError {
  status: 'error';
  errorCode: string;
}
type UpdatePreferencesResponse = UpdatePreferencesSuccess | UpdatePreferencesError;

const seedUser = async (ctx: TestContext): Promise<{ userId: string }> => {
  const email = `prefs-${Date.now().toString()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const created = await ctx.prisma.user.create({
    data: {
      email,
      name: 'Prefs User',
      provider: 'credentials',
      avatarFallback: 'P',
    },
  });
  await ctx.session.login({ id: created.id, email, name: 'Prefs User' });
  return { userId: created.id };
};

export const customTests: CustomTestCase[] = [
  {
    name: 'happy path persists preferences to DB and echoes them back',
    run: async (ctx: TestContext) => {
      const { userId } = await seedUser(ctx);
      const result = await ctx.callApi<unknown, UpdatePreferencesResponse>({
        preferences: { notifyOnNewSignIn: true, notifyOnPasswordChange: false },
      });
      ctx.expect.eq(result.status, 'success');
      if (result.status === 'success') {
        ctx.expect.eq(result.result.preferences.notifyOnNewSignIn, true);
        ctx.expect.eq(result.result.preferences.notifyOnPasswordChange, false);
      }
      //? Post-condition: the Prisma JSON column carries the sanitized blob.
      //? `eq` falls back to stable JSON.stringify for object comparison.
      const dbUser = await ctx.prisma.user.findUnique({ where: { id: userId } });
      ctx.expect.ok(dbUser, 'user row should still exist');
      ctx.expect.eq(
        JSON.stringify(dbUser?.preferences ?? null),
        JSON.stringify({ notifyOnNewSignIn: true, notifyOnPasswordChange: false }),
      );
    },
  },
  {
    name: 'boolean `false` survives the allow-list filter (not collapsed to absent)',
    run: async (ctx: TestContext) => {
      const { userId } = await seedUser(ctx);
      const result = await ctx.callApi<unknown, UpdatePreferencesResponse>({
        preferences: { notifyOnNewSignIn: false, notifyOnPasswordChange: false },
      });
      ctx.expect.eq(result.status, 'success');
      if (result.status === 'success') {
        ctx.expect.eq(result.result.preferences.notifyOnNewSignIn, false);
        ctx.expect.eq(result.result.preferences.notifyOnPasswordChange, false);
      }
      const dbUser = await ctx.prisma.user.findUnique({ where: { id: userId } });
      ctx.expect.eq(
        JSON.stringify(dbUser?.preferences ?? null),
        JSON.stringify({ notifyOnNewSignIn: false, notifyOnPasswordChange: false }),
      );
    },
  },
  {
    name: 'idempotent: calling twice with the same input is safe',
    run: async (ctx: TestContext) => {
      const { userId } = await seedUser(ctx);
      const payload = { preferences: { notifyOnNewSignIn: true, notifyOnPasswordChange: true } };
      const first = await ctx.callApi<unknown, UpdatePreferencesResponse>(payload);
      const second = await ctx.callApi<unknown, UpdatePreferencesResponse>(payload);
      ctx.expect.eq(first.status, 'success');
      ctx.expect.eq(second.status, 'success');
      const dbUser = await ctx.prisma.user.findUnique({ where: { id: userId } });
      ctx.expect.eq(
        JSON.stringify(dbUser?.preferences ?? null),
        JSON.stringify({ notifyOnNewSignIn: true, notifyOnPasswordChange: true }),
      );
    },
  },
];
