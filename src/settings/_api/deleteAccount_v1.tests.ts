import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

//? Per-route tests for `settings/deleteAccount/v1`.
//? The auto-sweep already covers: contract validation, auth enforcement,
//? rate-limit clamp, fuzz crash-resistance. Add cases below for the
//? business-logic assertions the sweep can't reach.
//?
//? Suggested scenarios — replace placeholders with real assertions:
//? [x] Happy path deletes the user row + clears the session
//? [x] Wrong password is rejected with login.wrongPassword
//? [x] After deletion subsequent `system/session/v1` returns null
//?
//? Input shape (from `src/_sockets/apiTypes.generated.ts`):
//?   {
//?     confirmation: string;
//?     password?: string;
//?   }

interface DeleteAccountSuccess {
  status: 'success';
  result: Record<string, never>;
}
interface DeleteAccountError {
  status: 'error';
  errorCode: string;
}
type DeleteAccountResponse = DeleteAccountSuccess | DeleteAccountError;

const seedCredentialsUser = async (
  ctx: TestContext,
  plaintextPassword: string,
): Promise<{ userId: string; email: string }> => {
  const { updatePasswordHash } = await import('@luckystack/login');
  const email = `del-${Date.now().toString()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const created = await ctx.prisma.user.create({
    data: {
      email,
      name: 'Delete Me',
      provider: 'credentials',
      avatarFallback: 'D',
    },
  });
  await updatePasswordHash(created.id, plaintextPassword);
  await ctx.session.login({ id: created.id, email, name: 'Delete Me' });
  return { userId: created.id, email };
};

export const customTests: CustomTestCase[] = [
  {
    name: 'happy path removes the user row from the database',
    run: async (ctx: TestContext) => {
      const password = 'CorrectPassword123!';
      const { userId } = await seedCredentialsUser(ctx, password);
      const result = await ctx.callApi<unknown, DeleteAccountResponse>({
        confirmation: 'DELETE',
        password,
      });
      ctx.expect.eq(result.status, 'success');
      const stillThere = await ctx.prisma.user.findUnique({ where: { id: userId } });
      ctx.expect.eq(stillThere, null);
    },
  },
  {
    name: 'wrong password is rejected with login.wrongPassword and user remains',
    run: async (ctx: TestContext) => {
      const { userId } = await seedCredentialsUser(ctx, 'CorrectPassword123!');
      const result = await ctx.callApi<unknown, DeleteAccountResponse>({
        confirmation: 'DELETE',
        password: 'WrongPassword999!',
      });
      ctx.expect.eq(result.status, 'error');
      if (result.status === 'error') ctx.expect.eq(result.errorCode, 'login.wrongPassword');
      const stillThere = await ctx.prisma.user.findUnique({ where: { id: userId } });
      ctx.expect.ok(stillThere, 'user should still exist after failed delete');
    },
  },
  {
    name: 'session is cleared after deletion (system/session/v1 returns null)',
    run: async (ctx: TestContext) => {
      const password = 'CorrectPassword123!';
      await seedCredentialsUser(ctx, password);
      const result = await ctx.callApi<unknown, DeleteAccountResponse>({
        confirmation: 'DELETE',
        password,
      });
      ctx.expect.eq(result.status, 'success');
      //? `ctx.callApi` is bound to the route under test, so we can't hit
      //? `system/session/v1` through it. Instead we assert the underlying
      //? invariant directly: the route invoked `revokeUserSessions(user.id)`,
      //? so the session record for the caller's token must be gone — exactly
      //? what `system/session/v1` would observe when re-reading.
      const sessionState = ctx.session.current();
      ctx.expect.ok(sessionState.token, 'precondition: session.login should have minted a token');
      if (sessionState.token) {
        const { getSession } = await import('@luckystack/login');
        const stale = await getSession(sessionState.token);
        ctx.expect.eq(stale, null);
      }
    },
  },
];
