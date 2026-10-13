# Sentry integration

The Sentry-specific entry remains available for older integrations, while the backend-neutral adapter path allows Sentry to coexist with other trackers. Keep vendor-specific configuration inside the optional package rather than expanding core's project configuration for every consumer. See the installed registration API and config types for current setup.

Initialize the SDK before assuming framework capture reaches it. During migration, avoid double-registration or double-reporting from parallel legacy and adapter calls. Credentials and event context can leave the application: configure sampling and project-specific data scrubbing deliberately. A Sentry-only helper does not imply equivalent behavior in Datadog or PostHog; see `adapter-pattern.md` and `span-helpers.md`.
