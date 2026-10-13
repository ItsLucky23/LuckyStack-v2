# @luckystack/error-tracking

Pluggable server-side error monitoring for LuckyStack. In a scaffolded app, run `npx luckystack add error-tracking`, then install the SDK for your chosen backend. An app can use multiple adapters; one failing backend must not break a request or the other trackers. See [adapter rationale](./docs/adapter-pattern.md) and the installed exports for configuration.

For Datadog, initialize its Node patching before framework imports. For other providers, consult the installed package's registration entry and [Sentry integration](./docs/sentry-integration.md) instead of maintaining a duplicate boot recipe here. Vendor-specific SDKs are optional; do not install one you do not use.

**Data boundary:** default scrubbing cannot know your project's sensitive fields. Apply project-specific filtering before sending personal information, message text, or contextual data to an external tracker. Request-scoped identity must remain isolated across concurrent users; consult [auto-instrumentation](./docs/auto-instrumentation.md) and [span ownership](./docs/span-helpers.md).
