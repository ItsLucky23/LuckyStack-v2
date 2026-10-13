# Logging and redaction architecture

LuckyStack delegates logging to a registered logger rather than prescribing a vendor. The framework redacts configured sensitive keys before handing payloads to that logger or to error tracking. This matters because logging a request before authorization or a failed response after it can otherwise turn credentials into long-lived copies in stdout and aggregators.

## Boundaries

- Extend the sensitive-key registry for domain-specific secrets **before** logging those payloads. A default key set cannot know every project's credentials. Inspect `packages/core/src/` for the current registry and redaction behavior instead of copying its key list here.
- Do not reset a production registry as though it were a test fixture: that can undo feature-package redactions and re-expose previously masked values.
- Redaction by field name is defense in depth, not a guarantee for secrets inside free-form strings, unexpected nested formats or third-party logging code. Avoid logging raw tokens, links or request bodies unnecessarily; verify custom loggers and trackers preserve the boundary.
- Error tracking and terminal output are independent sinks. Disabling one does not make the other safe by default. See [email architecture](./ARCHITECTURE_EMAIL.md) for delivery failures and [authentication](./ARCHITECTURE_AUTH.md) for credential boundaries.

Choose a structured production logger appropriate to the deployment. For registration and exact settings, consult `@luckystack/core` and its config guidance; this document intentionally does not duplicate defaults or adapter signatures.
