---
name: one-unmocked-dynamic-import-fails-a-different-test
title: One unmocked runtime import made a load-dependent failure surface in a different test
severity: medium
area: packages/test-runner (vitest characterization suites)
date: 2026-08-28
tags: [testing, vitest, flaky, mocking, dynamic-import]
---

# 0020 — One unmocked runtime import made a load-dependent failure surface in a different test

## What happened

`packages/test-runner/src/runAllTests.test.ts` failed in the full parallel suite roughly one run in
three, always with exactly two failures, and always green when run on its own. The visible failure was
an assertion reading a **previous** test's value: a test expecting `Cookie: cfg_cookie=tok123` received
`my_cookie=tok123`, the header the test above it had built.

The obvious reading — "`vi.clearAllMocks()` in `beforeEach` is not working" — is wrong, and chasing it
costs the whole session. Nothing about the mock setup was broken.

## Root cause

The file mocked every collaborator except one. `buildAuthHeaders` resolves the CSRF token through a
**runtime** `await import('@luckystack/login')`, deliberately lazy so projects without login installed
don't crash. A `vi.mock` list assembled by reading the static `import` statements at the top of the
module under test does not cover it, so the test loaded the real package and its whole dependency tree
inside the assertion.

That import is fast on an idle machine and slow on a loaded one. Once it exceeded vitest's 5s timeout
the test aborted — but `runAllTests` kept running. Its continuation called the layer mocks *after* the
next test's `beforeEach` had already cleared them, so the stale call landed at `mock.calls[0]` of a test
that had done nothing wrong. Two failures, one cause, and the reported one is not the broken one.

Confirmation was in the timings, not the assertion: after mocking the import, that file's `tests` figure
dropped from 366ms to 35ms.

## How to avoid

- **Enumerate mocks from what the code CALLS, not from what it imports at the top.** A dynamic
  `await import(...)` inside a function is a dependency; a static-import scan will not list it.
- **A test that touches the network, the disk or a package tree is timing-dependent even when it
  passes.** Treat "green but occasionally slow" as unmocked, not as tolerable.
- **When a flake's failure is a value from the previous test, suspect a timed-out async test above it,
  not the mock reset.** An aborted test does not abort the promise chain it started; that chain still
  holds references to the mocks the next test just cleared.
- **Reproduce under load, not by repetition.** Six consecutive green runs proved nothing here; running
  the suite immediately after a full build reproduced it.

Related: `docs/lessons/0019-a-skipped-check-reports-the-same-value-as-a-clean-one.md` — the same family
of defect, where the reassuring reading of an ambiguous signal is the one everybody takes.
