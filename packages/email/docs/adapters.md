# Email delivery adapters

Adapters separate the transactional mail contract from any one provider. Console delivery is useful locally, but never proves an actual message was delivered. Provider SDKs are optional so projects install only the backend they use; check the installed package's peer dependencies and exported types for current setup.

Named adapters let a project keep compliance-sensitive mail on an approved provider. An explicitly requested adapter that is unavailable must **fail**, not silently use a default provider. A forced provider must not silently fall back to console in production. Custom adapters should report delivery outcomes without losing the uncertainty of a provider timeout; retries must reuse the logical message's idempotency key. Keep SMTP credentials and provider keys outside committed configuration. The sender registry and adapter source, not this document, define precedence and option shapes.
