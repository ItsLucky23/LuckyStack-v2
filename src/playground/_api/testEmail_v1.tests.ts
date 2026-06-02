import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

//? Per-route tests for `playground/testEmail/v1`.
//? The auto-sweep already covers: contract validation, auth enforcement,
//? rate-limit clamp, fuzz crash-resistance. The cases below cover the
//? deterministic branches the sweep can't reach: empty-email rejection and
//? the success-envelope shape that holds whether or not the OPTIONAL
//? `@luckystack/email` peer is installed in the test environment.
//?
//? This is an explicitly dev-only diagnostic fixture (login-gated). When the
//? email peer is absent the route returns a `success` envelope carrying
//? `reason: 'email-package-not-installed'`; when present it passes through the
//? adapter's `{ ok, reason, id }`. Both are `status: 'success'`, so we assert
//? the envelope without pinning a single environment.
//?
//? Input shape (from the route source `testEmail_v1.ts`):
//?   { email: string }
//? Output envelope:
//?   { status: 'success', result: { ok: boolean; reason: string | null; ... } }
//?   | { status: 'error', errorCode: 'login.invalidEmailFormat' }

interface TestEmailResponse {
  status: string;
  errorCode?: string;
  result?: { ok?: boolean; reason?: string | null; id?: string | null };
}

export const customTests: CustomTestCase[] = [
  {
    name: 'empty email is rejected with login.invalidEmailFormat',
    run: async (ctx: TestContext) => {
      await ctx.session.login();
      const result = await ctx.callApi<unknown, TestEmailResponse>({ email: '   ' });
      ctx.expect.eq(result.status, 'error');
      ctx.expect.eq(result.errorCode, 'login.invalidEmailFormat');
    },
  },
  {
    name: 'a valid email yields a success envelope with an ok boolean',
    run: async (ctx: TestContext) => {
      await ctx.session.login();
      const result = await ctx.callApi<unknown, TestEmailResponse>({
        email: 'diagnostic@example.com',
      });
      //? Diagnostic route always resolves to a `success` envelope (it surfaces
      //? send outcomes inside `result`, never as an error status) — true both
      //? when the email peer is missing and when it is installed.
      ctx.expect.eq(result.status, 'success');
      ctx.expect.eq(typeof result.result?.ok, 'boolean');
    },
  },
];
