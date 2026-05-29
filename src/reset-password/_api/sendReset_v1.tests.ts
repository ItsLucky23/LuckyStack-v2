import type { CustomTestCase, TestContext } from '@luckystack/test-runner';
import { getProjectName, redis } from '@luckystack/core';

//? Per-route tests for `reset-password/sendReset/v1`.
//? The auto-sweep already covers: contract validation, auth enforcement,
//? rate-limit clamp, fuzz crash-resistance. The cases below assert the
//? business-logic invariants the sweep can't reach:
//?   - registered email returns success AND mints a Redis reset token
//?   - unknown email STILL returns success (anti-enumeration) and mints NO token
//?
//? Note on hooks: `passwordResetRequested` is dispatched in the SERVER process
//? via `void dispatchHook(...)`. The hook registry is in-process only — a
//? listener registered in the test process would never see it. We assert the
//? observable side-effect instead (the `${projectName}-pwreset:*` Redis key
//? that `createPasswordResetToken` writes whenever the user is matched).
//?
//? Input shape: { email: string }

const countPwresetTokens = async (): Promise<number> => {
  const pattern = `${getProjectName()}-pwreset:*`;
  const keys = await redis.keys(pattern);
  return keys.length;
};

export const customTests: CustomTestCase[] = [
  {
    name: 'registered email returns success and mints a reset token',
    run: async (ctx: TestContext) => {
      const email = `reset-happy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}@example.com`;
      await ctx.prisma.user.create({
        data: {
          email,
          provider: 'credentials',
          password: 'placeholder-bcrypt-hash',
          name: 'Reset Happy',
          avatarFallback: 'R',
        },
      });

      const before = await countPwresetTokens();
      const result = await ctx.callApi<{ email: string }, { status: string }>({ email });
      ctx.expect.eq(result.status, 'success', 'sendReset on matched email should return success');

      //? `sendPasswordResetEmail` lazy-imports `@luckystack/email` and may
      //? fail at send time when no sender is registered. The route still
      //? returns success in that case (the sender returns { ok: false }
      //? without throwing), but the token IS minted before the send attempt.
      const after = await countPwresetTokens();
      ctx.expect.ok(
        after > before,
        `expected pwreset key count to increase (${before.toString()} -> ${after.toString()})`,
      );

      await ctx.prisma.user.deleteMany({ where: { email } });
    },
  },
  {
    name: 'unknown email still returns success (anti-enumeration) and mints no token',
    run: async (ctx: TestContext) => {
      const email = `reset-unknown-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}@example.com`;
      const before = await countPwresetTokens();
      const result = await ctx.callApi<{ email: string }, { status: string }>({ email });
      ctx.expect.eq(
        result.status,
        'success',
        'unknown email must still return success — anti-enumeration contract',
      );
      const after = await countPwresetTokens();
      ctx.expect.eq(
        after,
        before,
        'no reset token should be minted for an unknown email',
      );
    },
  },
];
