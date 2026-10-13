# Error-tracking adapter design

The backend-neutral registry belongs in `@luckystack/core` so server packages can report failures without importing a vendor SDK. Optional adapters live in error-tracking and can coexist; a failing adapter must not break the request or stop a sibling tracker. Span scopes cannot simply fan out like independent error events, so do not assume each provider records identical traces. Consult the adapter contracts in source for signatures and current capabilities.

Outbound monitoring is a security boundary. Run per-project redaction/filtering **before** forwarding events; built-in scrubbing cannot know every private field. An adapter's filtered event must be the event it actually sends, not the original payload. Avoid global identity for concurrent users; use request-scoped context. Only install providers the project uses, and keep vendor credentials outside committed configuration.
