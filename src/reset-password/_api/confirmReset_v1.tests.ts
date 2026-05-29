import type { CustomTestCase, TestContext } from '@luckystack/test-runner';
import {
  createPasswordResetToken,
  loginWithCredentialsCore,
  updatePasswordHash,
} from '@luckystack/login';

//? Per-route tests for `reset-password/confirmReset/v1`.
//? The auto-sweep already covers: contract validation, auth enforcement,
//? rate-limit clamp, fuzz crash-resistance. Cases below assert business-logic
//? invariants the sweep can't reach.
//?
//? Input shape: { token: string; password: string; confirmPassword: string }

const seedCredentialsUser = async (
  ctx: TestContext,
  email: string,
  initialPassword: string,
): Promise<{ id: string }> => {
  const created = await ctx.prisma.user.create({
    data: {
      email,
      provider: 'credentials',
      name: 'Reset Tester',
      avatarFallback: 'R',
    },
  });
  //? `updatePasswordHash` bcrypt-hashes through the active user adapter so a
  //? subsequent `loginWithCredentialsCore` can succeed against this seed.
  await updatePasswordHash(created.id, initialPassword);
  return { id: created.id };
};

const cleanupUser = async (ctx: TestContext, email: string): Promise<void> => {
  await ctx.prisma.user.deleteMany({ where: { email } });
};

interface ConfirmResetResponse {
  status: string;
  errorCode?: string;
}
interface ConfirmResetInput {
  token: string;
  password: string;
  confirmPassword: string;
}

export const customTests: CustomTestCase[] = [
  {
    name: 'happy path: valid token + matching passwords updates the password',
    run: async (ctx: TestContext) => {
      const email = `confirm-happy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}@example.com`;
      const oldPassword = 'OldPass!123';
      const newPassword = 'NewPass!456';
      const user = await seedCredentialsUser(ctx, email, oldPassword);
      const token = await createPasswordResetToken(user.id);

      const result = await ctx.callApi<ConfirmResetInput, ConfirmResetResponse>({
        token,
        password: newPassword,
        confirmPassword: newPassword,
      });
      ctx.expect.eq(result.status, 'success', `confirmReset failed: ${result.errorCode ?? 'unknown'}`);

      //? Post-condition: the new password actually works for login. Asserting
      //? success on the new password is the load-bearing check that the
      //? password hash was actually rewritten.
      const loginResult = await loginWithCredentialsCore({ email, password: newPassword });
      ctx.expect.eq(
        loginResult.status,
        true,
        `login with new password failed: ${JSON.stringify(loginResult)}`,
      );

      await cleanupUser(ctx, email);
    },
  },
  {
    name: 'invalid/unknown token returns login.resetInvalidToken',
    run: async (ctx: TestContext) => {
      const password = 'AnyPass!123';
      const result = await ctx.callApi<ConfirmResetInput, ConfirmResetResponse>({
        token: 'this-token-does-not-exist-anywhere-in-redis-1234567890',
        password,
        confirmPassword: password,
      });
      ctx.expect.eq(result.status, 'error');
      ctx.expect.eq(result.errorCode, 'login.resetInvalidToken');
    },
  },
  {
    name: 'password mismatch returns login.passwordNotMatch',
    run: async (ctx: TestContext) => {
      //? Use a structurally-valid (but unbound) token to get past the empty
      //? check — the route validates `password !== confirmPassword` BEFORE
      //? hitting Redis, so any non-empty string works here.
      const result = await ctx.callApi<ConfirmResetInput, ConfirmResetResponse>({
        token: 'any-non-empty-token',
        password: 'NewPass!123',
        confirmPassword: 'Different!456',
      });
      ctx.expect.eq(result.status, 'error');
      ctx.expect.eq(result.errorCode, 'login.passwordNotMatch');
    },
  },
  {
    name: 'token is single-use: second call with the same token fails',
    run: async (ctx: TestContext) => {
      const email = `confirm-singleuse-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}@example.com`;
      const user = await seedCredentialsUser(ctx, email, 'OldPass!123');
      const token = await createPasswordResetToken(user.id);
      const newPassword = 'NewPass!456';

      const first = await ctx.callApi<ConfirmResetInput, ConfirmResetResponse>({
        token,
        password: newPassword,
        confirmPassword: newPassword,
      });
      ctx.expect.eq(first.status, 'success', `first reset failed: ${first.errorCode ?? 'unknown'}`);

      const second = await ctx.callApi<ConfirmResetInput, ConfirmResetResponse>({
        token,
        password: newPassword,
        confirmPassword: newPassword,
      });
      ctx.expect.eq(second.status, 'error', 'second call must reject — token is single-use');
      ctx.expect.eq(second.errorCode, 'login.resetInvalidToken');

      await cleanupUser(ctx, email);
    },
  },
];
