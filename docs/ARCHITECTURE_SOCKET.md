# Socket architecture

The browser holds one Socket.io connection for rooms, presence, reconnects and incoming realtime events. API and sync invocations can use that socket or routed HTTP/SSE; changing invocation transport must not silently create a second room channel. Socket connection setup lives in `@luckystack/server`; see [multi-instance architecture](./ARCHITECTURE_MULTI_INSTANCE.md).

## Trust and delivery boundaries

- Check the origin and resolve the session at connection time; socket middleware must not bypass the framework's connection gate. HTTP and socket token extraction must respect the same selected credential mode. See [session](./ARCHITECTURE_SESSION.md).
- Keep joining and leaving rooms subject to authentication and any consumer room policy. A room name is a delivery address, not proof that a caller is entitled to its contents.
- Transient disconnects should not immediately destroy sessions or presence state. A warm reconnect can rehydrate state without treating a cold first connection as a resumed one. The presence package owns grace behavior; consult it for actual timing.
- Offline requests are held in a browser-memory queue and replayed when connectivity returns. This is a convenience, **not** durable delivery or exactly-once execution; apply business-level deduplication where a repeated write would harm users.
- In a cluster, all socket-owning instances need the same Redis adapter backend. Otherwise broadcasts reach only local members and fail silently across servers. Redis enables delivery and remote room-member lookup, not remote execution of a missing handler.
- Raw socket listeners are for protocols incompatible with the typed sync envelope. They do not inherit typed sync authorization, rate limiting, queueing or fan-out; do not use them to bypass those protections. See [extension points](./ARCHITECTURE_EXTENSION_POINTS.md).

Use installed package declarations/source for event, hook and queue contracts; consult the [server package guide](https://github.com/ItsLucky23/LuckyStack-v2/blob/main/packages/server/README.md) for adoption rather than a copied API table.
