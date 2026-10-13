# Tracing span ownership

Spans describe a scoped operation, not a broadcast event: multiple monitoring backends cannot automatically share one parent/child tree. Choose the integration that owns a span and ensure the operation closes it even on failure. A backend without tracing support should not change the application result. Consult current span helper types and adapter source for supported semantics.

Legacy Sentry-specific helpers remain for compatible consumers; prefer backend-neutral boundaries for new multi-tracker work. Never put unredacted credentials, tokens or personal information into span names, tags or exception attributes. See `auto-instrumentation.md` for request identity and `adapter-pattern.md` for why fan-out differs from exception capture.
