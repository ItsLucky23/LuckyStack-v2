import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

//? Per-route tests for `settings/revokeSession/v1`.
//? The auto-sweep already covers: contract validation, auth enforcement,
//? rate-limit clamp, fuzz crash-resistance. Add cases below for the
//? business-logic assertions the sweep can't reach.
//?
//? Suggested scenarios — replace placeholders with real assertions:
//? [ ] Happy path with valid input → expected output shape + side effects
//? [ ] Authenticated user A cannot affect user B's data
//? [ ] Post-conditions: did the expected hook fire? row inserted? cache invalidated?
//? [ ] Edge case: missing optional field, boundary values, unusual but valid input
//? [ ] Idempotency: calling twice with the same input is safe (if applicable)
//?
//? Input shape (from `src/_sockets/apiTypes.generated.ts`):
//?   {
//?             token: string;
//?           }

export const customTests: CustomTestCase[] = [
  {
    name: 'happy path returns success',
    run: async (ctx: TestContext) => {
      await ctx.session.login();
      // const result = await ctx.callApi({ /* TODO: fill in valid input */ });
      // ctx.expect.eq(result.status, 'success');
      throw new Error('TODO: implement this test case');
    },
  },
];
