# Peer notifications

Presence announcements should reveal a server-resolved user identity, never a raw session token. A client signal alone cannot claim someone else's AFK status. Notify peers through tenant-aware physical room names, and use adapter-aware enumeration so users on other instances receive the same events as local peers. Source: `../src/activity/peerNotifier.ts`, `../src/activity/afkEvent.ts`, `../../core/src/roomNameFormatterRegistry.ts`.

A shared raw room code can collide across tenants unless the application prefixes it or registers a formatter. Preserve the pre-update veto before emitting and report actual deliveries after emitting; hooks are not interchangeable. This helper remains internal so applications cannot bypass the normal lifecycle and broadcast forged presence. See `../src/activity/peerNotifier.ts`, `./lifecycle.md`.
