//? Wire contract of the dev/test `/_test/reset` endpoint's `?only=` selector,
//? shared by the server (which clears) and the test-runner (which asks). One
//? list, so a new target cannot exist on one side only.
//?
//? Why a selector exists at all: the unscoped reset also deletes every Redis
//? session, including the one an authenticated test sweep runs on — so a sweep
//? that reset between endpoints logged itself out halfway through.

export const TEST_RESET_TARGETS = ['rateLimits', 'sessions', 'activeUsers', 'hooks'] as const;

export type TestResetTarget = typeof TEST_RESET_TARGETS[number];

/** Query parameter that limits a reset to the listed targets (comma-separated). */
export const TEST_RESET_ONLY_PARAM = 'only';

export const isTestResetTarget = (value: string): value is TestResetTarget =>
  (TEST_RESET_TARGETS as readonly string[]).includes(value);
