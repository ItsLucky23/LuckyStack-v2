import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

//? Per-route tests for `settings/requestEmailChange/v1`.
//? The auto-sweep already covers: contract validation, auth enforcement,
//? rate-limit clamp, fuzz crash-resistance. The cases below cover the
//? deterministic validation branches the sweep cannot reach: email-format
//? rejection, same-as-current rejection, and the cross-user emailTaken
//? guard.
//?
//? NOTE — the happy-path success branch calls `sendEmailChangeConfirmation`,
//? which lazy-imports the OPTIONAL peer `@luckystack/email`. When that peer
//? is absent the send returns `ok: false` and the route maps it to
//? `auth.emailSendFailed`. Because the outcome depends on whether the email
//? package is installed in the test environment, we assert the deterministic
//? rejection branches instead of pinning a success envelope here.
//?
//? The route reads the caller's CURRENT email from the SESSION (`user.email`),
//? so `session.login({ email })` controls the same-as-current comparison.
//?
//? Input shape (from the route source `requestEmailChange_v1.ts`):
//?   { newEmail: string }
//? Output envelope:
//?   { status: 'success' }
//?   | { status: 'error', errorCode: 'auth.invalidEmail' | 'auth.emailSameAsCurrent'
//?       | 'auth.emailTaken' | 'auth.emailSendFailed' | <preEmailChange veto code> }

interface RequestSuccess {
  status: 'success';
}
interface RequestError {
  status: 'error';
  errorCode: string;
}
type RequestResponse = RequestSuccess | RequestError;

const uniqueEmail = (prefix: string): string =>
  `${prefix}-${Date.now().toString()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

export const customTests: CustomTestCase[] = [
  {
    name: 'malformed new email is rejected with auth.invalidEmail',
    run: async (ctx: TestContext) => {
      await ctx.session.login({ email: uniqueEmail('req-current') });
      const result = await ctx.callApi<unknown, RequestResponse>({ newEmail: 'not-an-email' });
      ctx.expect.eq(result.status, 'error');
      if (result.status === 'error') ctx.expect.eq(result.errorCode, 'auth.invalidEmail');
    },
  },
  {
    name: 'requesting the current email is rejected with auth.emailSameAsCurrent',
    run: async (ctx: TestContext) => {
      const currentEmail = uniqueEmail('req-same');
      await ctx.session.login({ email: currentEmail });
      //? The route lowercases + trims before comparing, so an uppercased
      //? variant of the SAME address must still be rejected.
      const result = await ctx.callApi<unknown, RequestResponse>({
        newEmail: currentEmail.toUpperCase(),
      });
      ctx.expect.eq(result.status, 'error');
      if (result.status === 'error') ctx.expect.eq(result.errorCode, 'auth.emailSameAsCurrent');
    },
  },
  {
    name: 'address owned by another credentials user is rejected with auth.emailTaken',
    run: async (ctx: TestContext) => {
      //? Another credentials user already owns the target address.
      const takenEmail = uniqueEmail('req-taken');
      await ctx.prisma.user.create({
        data: {
          email: takenEmail,
          name: 'Existing Owner',
          provider: 'credentials',
          avatarFallback: 'E',
        },
      });

      //? Caller is a different user (distinct session email).
      await ctx.session.login({ email: uniqueEmail('req-caller') });

      const result = await ctx.callApi<unknown, RequestResponse>({ newEmail: takenEmail });
      ctx.expect.eq(result.status, 'error');
      if (result.status === 'error') ctx.expect.eq(result.errorCode, 'auth.emailTaken');
    },
  },
];
