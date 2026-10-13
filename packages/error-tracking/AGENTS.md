# @luckystack/error-tracking — agent guidance

Use when server-side failures and traces must reach an external monitoring backend. Backend-neutral dispatch lives in core so packages without vendor integrations can report errors without importing vendor SDKs. Multiple trackers may coexist; one failing tracker must not break requests or sibling trackers. See `README.md` for installation and `docs/adapter-pattern.md` for the design.

Initialize tracing SDKs that patch Node I/O before framework imports. Treat monitoring as an outbound data boundary: redact secrets and project-specific personal information before forwarding, even when adapters provide default scrubbing. Request-scoped identity must not leak across concurrent requests; spans must be closed on failure too. Do not assume every backend supports the same span or metric semantics.
