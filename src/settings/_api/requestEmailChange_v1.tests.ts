import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

//? Per-route tests for `settings/requestEmailChange/v1`.
//? The auto-sweep already covers: contract validation, auth enforcement,
//? rate-limit clamp, fuzz crash-resistance. The cases below cover the
//? deterministic validation branches the sweep cannot reach: email-format
//? rejection, same-as-current rejection, and the cross-user emailTaken
//? guard.
//?
//? The confirmation send runs in the background (finding 082), so a free
//? address answers `success` whether or not `@luckystack/email` is installed —
//? the same answer as a taken address.
//?
//? The route reads the caller's CURRENT email from the SESSION (`user.email`),
//? so `session.login({ email })` controls the same-as-current comparison.
//?
//? Input shape (from the route source `requestEmailChange_v1.ts`):
//?   { newEmail: string; currentPassword?: string }
//? Output envelope:
//?   { status: 'success' }
//?   | { status: 'error', errorCode: 'settings.emailChange.managedByProvider' | 'settings.emailChange.invalidEmail'
//?       | 'settings.emailChange.emailSameAsCurrent' | 'settings.emailChange.currentPasswordRequired'
//?       | 'settings.emailChange.wrongCurrentPassword' | <preEmailChange veto code> }

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
      if (result.status === 'error') ctx.expect.eq(result.errorCode, 'settings.emailChange.invalidEmail');
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
      if (result.status === 'error') ctx.expect.eq(result.errorCode, 'settings.emailChange.emailSameAsCurrent');
    },
  },
  {
    //? DD-ROOTSRC-O6 (anti-enumeration): the route silently succeeds when the
    //? target address is already owned by another credentials user rather than
    //? revealing the address exists in the database. A logged-in attacker could
    //? otherwise enumerate every credentials account with a trivial loop.
    name: 'address owned by another credentials user returns success (anti-enumeration — no email sent)',
    run: async (ctx: TestContext) => {
      const { updatePasswordHash } = await import('@luckystack/login');
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

      //? LOGIN-EMAILCHG: initiating an email change for a credentials account now
      //? requires the current password (re-auth). Create a REAL caller user, set a
      //? known password, then log in as them and pass it — otherwise the route
      //? correctly short-circuits with `currentPasswordRequired` before the
      //? anti-enumeration branch under test is ever reached.
      const callerEmail = uniqueEmail('req-caller');
      const password = 'CallerReAuth#2026';
      const caller = await ctx.prisma.user.create({
        data: {
          email: callerEmail,
          name: 'Caller',
          provider: 'credentials',
          avatarFallback: 'C',
        },
      });
      await updatePasswordHash(caller.id, password);
      await ctx.session.login({ id: caller.id, email: callerEmail });

      //? Anti-enumeration: the response is identical to the "address available"
      //? success path so the caller cannot tell whether the address is taken.
      const result = await ctx.callApi<unknown, RequestResponse>({ newEmail: takenEmail, currentPassword: password });
      ctx.expect.eq(result.status, 'success');
    },
  },
  {
    //? Finding 082: the free-address branch used to await the send and return
    //? `emailSendFailed` on failure, which the taken branch never can. It now
    //? answers exactly like the taken branch, even without an email sender.
    name: 'free address returns success without waiting on the send (same answer as a taken address)',
    run: async (ctx: TestContext) => {
      const { updatePasswordHash } = await import('@luckystack/login');
      const callerEmail = uniqueEmail('req-free-caller');
      const password = 'CallerReAuth#2026';
      const caller = await ctx.prisma.user.create({
        data: { email: callerEmail, name: 'Caller', provider: 'credentials', avatarFallback: 'C' },
      });
      await updatePasswordHash(caller.id, password);
      await ctx.session.login({ id: caller.id, email: callerEmail });

      const result = await ctx.callApi<unknown, RequestResponse>({ newEmail: uniqueEmail('req-free'), currentPassword: password });
      ctx.expect.eq(result.status, 'success');
    },
  },
  {
    //? Finding 008: OAuth accounts are found by (email, provider); changing the
    //? email orphans the account or lets a stolen session rebind it.
    name: 'OAuth session is refused with settings.emailChange.managedByProvider',
    run: async (ctx: TestContext) => {
      const { getSession, saveSession } = await import('@luckystack/login');
      const email = uniqueEmail('req-oauth');
      const created = await ctx.prisma.user.create({
        data: { email, name: 'OAuth', provider: 'google', avatarFallback: 'O' },
      });
      const { token } = await ctx.session.login({ id: created.id, email });
      //? `session.login` always mints a credentials session; re-save the same
      //? token as a Google session (keeps its CSRF token).
      const current = await getSession(token);
      if (!current) throw new Error('session not found after login');
      const googleSession = { ...current, provider: 'google' };
      await saveSession(token, googleSession, false);

      const result = await ctx.callApi<unknown, RequestResponse>({ newEmail: uniqueEmail('req-oauth-new') });
      ctx.expect.eq(result.status, 'error');
      if (result.status === 'error') ctx.expect.eq(result.errorCode, 'settings.emailChange.managedByProvider');
    },
  },
];
