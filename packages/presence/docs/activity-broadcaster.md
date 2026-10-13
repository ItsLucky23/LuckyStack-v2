# Activity awareness

Activity events allow features to react to presence without embedding every activity type in the socket lifecycle. The default idle signal is a hint to peers, not a guarantee that a user is away. Keep sampler work out of the critical connect path. See `../src/activity/activitySampler.ts`, `../src/activity/afkEvent.ts`, `../src/activityEvents.ts`.

An intentional-disconnect signal comes from the client; it may influence reconnect grace but must not assert another user's identity. Resolve identity from the server session, and send peer updates without leaking session tokens. The signal is handled once per connection to avoid repeated notifications. See `../src/activity/lifecycle.ts`, `./disconnect-grace.md`.
