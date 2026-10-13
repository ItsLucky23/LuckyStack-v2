# Skill: audit-error-code-coverage

Review whether user-facing errors can be translated in the project's supported languages. Static absence is evidence to inspect, not proof a dynamic key is dead.

## Procedure

1. Discover the requested handlers and actual locale/normalization sources from project code; do not assume English is canonical or every error is application-owned.
2. Compare statically resolvable error keys with locale leaves. Mark dynamic keys and framework-provided translations as separate evidence gaps.
3. Report missing translations with source pointers. Inspect component and dynamic uses before labelling any key orphaned; do not auto-delete it.
4. Propose fixes with meaningful text. Confirm fallback policy rather than silently placing English into every language and reporting it fully translated.
5. Apply only approved changes and verify the normalization/user-facing failure path, not merely JSON syntax.

Follow `AGENTS.md` capture rules. Do not paste a second catalogue of error codes or locale contents into the report.
