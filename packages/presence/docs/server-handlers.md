# Presence server integration

Server boot connects socket lifecycle events to presence, but only when the application opts in to activity broadcasting. A reconnect must cancel a pending disconnect timer so peer departure and session cleanup do not race against an active socket. Do not equate a transport close with explicit logout. See `../src/activity/lifecycle.ts`, `../../server/src/loadSocket.ts`.

Room departures and peer notifications need server-resolved sessions; the client cannot claim another user's rooms. Keep server-side membership updates coordinated with session persistence rather than assuming a helper changes both. See `../src/activity/leaveRoom.ts`, `./disconnect-grace.md`, `./peer-notifier.md`.
