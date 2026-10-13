# @luckystack/email

Transactional email for LuckyStack, including pluggable delivery and password-reset messages. In a scaffolded app, select email when creating it or add it later; otherwise install `@luckystack/email` and the provider SDK you actually use. Register a sender before relying on delivery. Console delivery is useful in development but does **not** send real mail. See [adapters](./docs/adapters.md) and the installed types for setup details.

## Delivery safety

Use a stable idempotency key for retries. A provider failure can have an **unknown delivery outcome**: do not retry that logical email with a fresh key or you may send it twice. When missing mail would break an important flow, configure fail-loud sender requirements rather than silently accepting a console/no-sender fallback. Explicit adapter routing for compliance-critical mail should never silently switch providers. A pre-send stop signal suppresses mail, but a thrown hook error does not. Mandatory consent policy must cover framework and application sends and fail closed; see [hooks](./docs/hooks.md).

Reset flows should never reveal whether an email address belongs to an account; see [password-reset integration](./docs/password-reset-integration.md). Protect recipient and provider-error data in logging and monitoring.
