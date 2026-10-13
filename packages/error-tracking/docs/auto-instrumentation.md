# Automatic monitoring integration

Core owns cross-package error dispatch so API and sync packages need not import optional monitoring implementations. Hook-based instrumentation can attach request identity and spans without forcing every project to install a vendor SDK. A handler exception should be captured centrally rather than counted as separate duplicate error-hook notifications.

Request-scoped identity prevents concurrent users from contaminating one another's events; spans must be closed on both success and failure. Built-in redaction is only a baseline: project-specific personal data and secrets require explicit filtering before leaving the process. The current hook subscriptions and data flow live in source, not in a copied event-by-event diagram here. See `adapter-pattern.md` for isolation and `span-helpers.md` for scope ownership.
