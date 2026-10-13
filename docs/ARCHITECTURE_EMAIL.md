# Email architecture

Transactional email is optional. An app that handles mail itself should not inherit a provider SDK just because it uses login. A registry in core lets optional email adapters supply sending without making login import an email package. Consumer adapters remain possible without forking the framework. See the installed email package README/declarations for setup and API; the [framework guide](https://github.com/ItsLucky23/LuckyStack-v2/blob/main/packages/email/README.md) is available without a monorepo checkout.

## Delivery and failure boundaries

- A development-only console sender is not a production delivery mechanism. Before enabling mail-dependent authentication, register a real sender and verify delivery; otherwise password-reset or email-code flows cannot work.
- Sending has a result contract rather than assuming a provider call succeeded. A timeout or cancellation **after dispatch** can leave delivery unknown: do not interpret it as proof that no message arrived. Retrying with a new identity can duplicate mail; reuse a stable idempotency key where supported, and remember SMTP cannot guarantee cancellation or deduplication.
- Capture failures independently of terminal logging. An unconfigured error tracker must not make sending crash, and logging must not expose reset links, credentials or recipient secrets.
- Send-time hooks cover application-driven and framework-driven mail alike so auditing and suppression do not miss password-reset messages. An interception intended to stop delivery must happen before the provider call, not only after it.

Provider choice, hooks, templates and exact configuration belong to the installed package's source and README. The distinction between optional packages and consumer-owned files is described in [optional package design](./DESIGN_OPTIONAL_SERVER_PACKAGES.md).
