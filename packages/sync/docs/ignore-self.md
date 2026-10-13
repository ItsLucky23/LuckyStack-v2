# Ignoring the sender in fanout

Optimistic interfaces have already applied their own change. Suppressing the echoed broadcast avoids needless re-rendering or flicker, but must not suppress the originator's direct acknowledgement: that response carries the server-authoritative result and lets the request complete. The sender can still be in the target room; ignore-self concerns the event audience, not authorization. Source: `../src/_shared/clientFanout.ts`, `../src/syncRequest.ts`.

Multiple tabs or devices may share an identity, so distinguish originator socket from other recipients rather than interpreting this option as 'exclude this user from all delivery'. Stream audience rules are separate: see `./streaming.md`.
