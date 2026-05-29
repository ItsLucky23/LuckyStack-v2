import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

//? Per-route tests for `settings/changePassword/v1`.
//? The auto-sweep already covers: contract validation, auth enforcement,
//? rate-limit clamp, fuzz crash-resistance. Add cases below for the
//? business-logic assertions the sweep can't reach.
//?
//? Suggested scenarios — replace placeholders with real assertions:
//? [x] Happy path with valid input → expected output shape + side effects
//? [x] Wrong current password → login.wrongPassword
//? [x] New + confirm mismatch → login.passwordNotMatch
//? [x] Policy violation (too short) → login.passwordCharacterMinimum
//?
//? Input shape (from `src/_sockets/apiTypes.generated.ts`):
//?   {
//?     currentPassword: string;
//?     newPassword: string;
//?     confirmPassword: string;
//?   }

interface ChangePasswordSuccess {
  status: 'success';
  result: { revokedSessions: number };
}
interface ChangePasswordError {
  status: 'error';
  errorCode: string;
}
type ChangePasswordResponse = ChangePasswordSuccess | ChangePasswordError;

//? Provision a fully-realised User row that matches the credentials provider:
//? a bcrypt-hashed password, defaulted enums, then a fresh session bound to it.
const seedCredentialsUser = async (
  ctx: TestContext,
  plaintextPassword: string,
): Promise<{ userId: string; email: string; token: string }> => {
  const { updatePasswordHash } = await import('@luckystack/login');
  const email = `pw-${Date.now().toString()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const created = await ctx.prisma.user.create({
    data: {
      email,
      name: 'Test User',
      provider: 'credentials',
      avatarFallback: 'T',
    },
  });
  //? `updatePasswordHash` runs the project password policy + bcrypt. Reusing it
  //? keeps the test in lockstep with the production hashing path.
  await updatePasswordHash(created.id, plaintextPassword);
  const { token } = await ctx.session.login({ id: created.id, email, name: 'Test User' });
  return { userId: created.id, email, token };
};

export const customTests: CustomTestCase[] = [
  {
    name: 'happy path: valid current + matching new password returns success',
    run: async (ctx: TestContext) => {
      const oldPassword = 'OldPassword123!';
      const newPassword = 'NewPassword456!';
      await seedCredentialsUser(ctx, oldPassword);
      const result = await ctx.callApi<unknown, ChangePasswordResponse>({
        currentPassword: oldPassword,
        newPassword,
        confirmPassword: newPassword,
      });
      ctx.expect.eq(result.status, 'success');
    },
  },
  {
    name: 'wrong current password is rejected with login.wrongPassword',
    run: async (ctx: TestContext) => {
      await seedCredentialsUser(ctx, 'OldPassword123!');
      const result = await ctx.callApi<unknown, ChangePasswordResponse>({
        currentPassword: 'TotallyWrong999!',
        newPassword: 'NewPassword456!',
        confirmPassword: 'NewPassword456!',
      });
      ctx.expect.eq(result.status, 'error');
      if (result.status === 'error') ctx.expect.eq(result.errorCode, 'login.wrongPassword');
    },
  },
  {
    name: 'new + confirm mismatch is rejected with login.passwordNotMatch',
    run: async (ctx: TestContext) => {
      const oldPassword = 'OldPassword123!';
      await seedCredentialsUser(ctx, oldPassword);
      const result = await ctx.callApi<unknown, ChangePasswordResponse>({
        currentPassword: oldPassword,
        newPassword: 'NewPassword456!',
        confirmPassword: 'DifferentPassword789!',
      });
      ctx.expect.eq(result.status, 'error');
      if (result.status === 'error') ctx.expect.eq(result.errorCode, 'login.passwordNotMatch');
    },
  },
  {
    name: 'too-short new password is rejected with login.passwordCharacterMinimum',
    run: async (ctx: TestContext) => {
      const oldPassword = 'OldPassword123!';
      await seedCredentialsUser(ctx, oldPassword);
      const result = await ctx.callApi<unknown, ChangePasswordResponse>({
        currentPassword: oldPassword,
        newPassword: 'x',
        confirmPassword: 'x',
      });
      ctx.expect.eq(result.status, 'error');
      if (result.status === 'error') ctx.expect.eq(result.errorCode, 'login.passwordCharacterMinimum');
    },
  },
];
