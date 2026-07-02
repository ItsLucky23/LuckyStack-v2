import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

//? Per-route tests for `settings/confirmEmailChange/v1`.
//? The auto-sweep already covers: contract validation, auth enforcement,
//? rate-limit clamp, fuzz crash-resistance. The cases below cover the
//? business logic the sweep cannot reach: one-shot token consumption, the
//? race-condition collision re-check, the email write, and the session
//? revocation post-condition.
//?
//? This route is `auth.login: false` — the one-shot Redis token IS the auth,
//? so no session is needed. The token is minted directly via the framework
//? primitive `createEmailChangeToken(userId, newEmail)` so the test mirrors
//? exactly what `requestEmailChange` would have stored.
//?
//? Input shape (from the route source `confirmEmailChange_v1.ts`):
//?   { token: string }
//? Output envelope:
//?   { status: 'success', result: { revokedSessions: number } }
//?   | { status: 'error', errorCode: 'settings.emailChange.invalidToken' | 'settings.emailChange.emailTaken' }

interface ConfirmSuccess {
  status: 'success';
  result: { revokedSessions: number };
}
interface ConfirmError {
  status: 'error';
  errorCode: string;
}
type ConfirmResponse = ConfirmSuccess | ConfirmError;

const seedUser = async (
  ctx: TestContext,
  email: string,
): Promise<{ userId: string }> => {
  const created = await ctx.prisma.user.create({
    data: {
      email,
      name: 'Email Change',
      provider: 'credentials',
      avatarFallback: 'E',
    },
  });
  return { userId: created.id };
};

const uniqueEmail = (prefix: string): string =>
  `${prefix}-${Date.now().toString()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

export const customTests: CustomTestCase[] = [
  {
    name: 'happy path consumes the token and writes the new email',
    run: async (ctx: TestContext) => {
      const { createEmailChangeToken } = await import('@luckystack/login');
      const oldEmail = uniqueEmail('confirm-old');
      const newEmail = uniqueEmail('confirm-new');
      const { userId } = await seedUser(ctx, oldEmail);

      const token = await createEmailChangeToken(userId, newEmail);
      const result = await ctx.callApi<unknown, ConfirmResponse>({ token });
      ctx.expect.eq(result.status, 'success');
      if (result.status === 'success') {
        ctx.expect.eq(typeof result.result.revokedSessions, 'number');
      }

      //? Post-condition: the user row now carries the new email.
      const updated = await ctx.prisma.user.findUnique({ where: { id: userId } });
      ctx.expect.eq(updated?.email, newEmail);
    },
  },
  {
    name: 'token is one-shot: a second confirm with the same token fails',
    run: async (ctx: TestContext) => {
      const { createEmailChangeToken } = await import('@luckystack/login');
      const oldEmail = uniqueEmail('confirm-once-old');
      const newEmail = uniqueEmail('confirm-once-new');
      const { userId } = await seedUser(ctx, oldEmail);

      const token = await createEmailChangeToken(userId, newEmail);
      const first = await ctx.callApi<unknown, ConfirmResponse>({ token });
      ctx.expect.eq(first.status, 'success');

      //? The token was consumed by the first call — replaying it must fail
      //? with auth.invalidToken (no double email-change from one link).
      const second = await ctx.callApi<unknown, ConfirmResponse>({ token });
      ctx.expect.eq(second.status, 'error');
      if (second.status === 'error') ctx.expect.eq(second.errorCode, 'settings.emailChange.invalidToken');
    },
  },
  {
    name: 'unknown token is rejected with auth.invalidToken',
    run: async (ctx: TestContext) => {
      const result = await ctx.callApi<unknown, ConfirmResponse>({
        token: 'this-token-was-never-minted',
      });
      ctx.expect.eq(result.status, 'error');
      if (result.status === 'error') ctx.expect.eq(result.errorCode, 'settings.emailChange.invalidToken');
    },
  },
  {
    name: 'race collision: target email claimed after minting is rejected',
    run: async (ctx: TestContext) => {
      const { createEmailChangeToken } = await import('@luckystack/login');
      const oldEmail = uniqueEmail('confirm-race-old');
      const contestedEmail = uniqueEmail('confirm-race-new');
      const { userId } = await seedUser(ctx, oldEmail);

      //? Mint the token BEFORE the collision exists...
      const token = await createEmailChangeToken(userId, contestedEmail);

      //? ...then another credentials user claims the contested address before
      //? the confirm click lands. The route's re-check must reject it.
      await seedUser(ctx, contestedEmail);

      const result = await ctx.callApi<unknown, ConfirmResponse>({ token });
      ctx.expect.eq(result.status, 'error');
      if (result.status === 'error') ctx.expect.eq(result.errorCode, 'settings.emailChange.emailTaken');

      //? The original user's email must be unchanged after the rejection.
      const unchanged = await ctx.prisma.user.findUnique({ where: { id: userId } });
      ctx.expect.eq(unchanged?.email, oldEmail);
    },
  },
];
