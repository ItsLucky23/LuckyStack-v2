# Skill: add-new-package

Introduce a framework package only when a real ownership/reuse boundary justifies it, not because an export list grew.

## Procedure

1. Confirm why an existing package cannot own the capability. Define its public contract, application-owned seams and genuinely required dependencies.
2. Use a current neighbouring manifest/build setup rather than copying versions or configuration from prose. Follow lockstep release policy in `CONTRIBUTING.md`.
3. Keep internals private and avoid cross-package relative source imports. Use existing registries/adapters for consumer-owned policy.
4. Write a brief README for purpose/minimal adoption and `AGENTS.md` for rationale/constraints. Do not create `CLAUDE.md`, a Function Index, config tables or speculative documentation stubs.
5. Integrate the package with authoritative workspace/build/publish sources. Obtain approval for installation needed to link dependencies.
6. Verify exported typing, tests and actual tarball/scaffold delivery. A local workspace import is not proof npm consumers receive a working package.
7. Update the purpose map only when the package adds a new consumer decision. Capture the real rationale and rejected alternative at wrap-up if it meets the decision bar.

Use the full feature-boundary gate from `AGENTS.md`. Exact export/dependency/build facts remain in source/manifests.
