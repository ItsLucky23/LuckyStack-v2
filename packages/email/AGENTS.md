# @luckystack/email — agent guidance

Use for transactional messages, especially when login's password-reset flow needs a sender. Register a real sender before relying on delivery; a development console sender is not real mail. Explicit adapter selection for compliance-critical mail must fail rather than silently route to a different sender. See `README.md` for setup and the focused `docs/` pages for rationale.

Delivery can be uncertain after a provider error: do not retry with a new idempotency key when the outcome is unknown. Keep recipients and secret-bearing provider errors out of logs. Pre-send stop signals suppress mail; hook exceptions do not. Mandatory suppression policy must fail closed across both framework and application sends; verify denial and error cases under `docs/hooks.md`. Reset flows must not reveal whether an account exists.
