//? @adr 0061
//? Dev-only guard around the Socket.io server that `getIoInstance()` hands to
//? consumer code (multi-instance handoff, DEV-376).
//?
//? Socket.io exposes three ways to reach the sockets of a room and they look
//? identical in an editor: `io.sockets.adapter.rooms.get(room)` and
//? enumerating `io.sockets.sockets` see ONLY this instance, while
//? `io.in(room).fetchSockets()` spans every instance behind the Redis adapter.
//? The adapter synchronises delivery (`io.to(room).emit()`), not those two
//? local maps, so a fan-out built on them works with one instance and goes
//? silently dead on every other one. One consumer made that mistake three
//? times independently; the ESLint rule `luckystack/no-local-socket-enumeration`
//? catches what is WRITTEN, this proxy catches what is COMPUTED (destructuring,
//? bracket access, a lookup behind a variable) by throwing at the access.
//?
//? Scope is deliberately narrow: only the value `getIoInstance()` returns is
//? wrapped, only outside production, and only the three per-instance surfaces
//? throw. `sockets.sockets.get(id)` stays allowed — a local lookup from a local
//? socket handler is correct by definition; only ENUMERATION is the bug. The
//? raw server stays reachable through `getIoInstance({ raw: true })` for the
//? deliberate per-instance cases (backpressure sampling, a sweep cleaning up its
//? own connections). Framework internals and the Redis adapter always hold the
//? raw instance; nothing here runs in production.

const ENUMERATING_MAP_MEMBERS: ReadonlySet<PropertyKey> = new Set<PropertyKey>([
  'values',
  'keys',
  'entries',
  'forEach',
  'size',
  Symbol.iterator,
]);

const PER_INSTANCE_ADAPTER_MEMBERS: ReadonlySet<PropertyKey> = new Set<PropertyKey>(['rooms', 'sids']);

/** Thrown (outside production) when consumer code touches a per-instance socket map. */
export class LocalSocketEnumerationError extends Error {
  constructor(surface: string) {
    super(
      `${surface} only sees the sockets connected to THIS instance. With the Redis adapter ` +
        'every other instance is invisible here, so a fan-out or membership check built on it ' +
        'silently misses them. Use `getRoomSockets(room, { userId })` from `@luckystack/core` or ' +
        '`io.in(room).fetchSockets()` for a cross-instance view, or `getIoInstance({ raw: true })` ' +
        'when you deliberately want the local one. (Thrown outside production only.)',
    );
    this.name = 'LocalSocketEnumerationError';
  }
}

/**
 * Structural subset of a Socket.io `Server` the guard needs. Typed this way so
 * the real server AND a structural test double both satisfy it without a cast.
 */
export interface GuardableSocketServer {
  sockets: {
    adapter: object;
    sockets: Map<string, unknown>;
  };
}

//? Methods read through a Proxy must be bound to the REAL target: socket.io and
//? `Map` methods dereference private state on `this`, which the proxy does not
//? carry.
const readBound = (target: object, prop: PropertyKey): unknown => {
  const value: unknown = Reflect.get(target, prop);
  return typeof value === 'function' ? value.bind(target) : value;
};

const guardSocketsMap = <T extends Map<string, unknown>>(map: T): T =>
  new Proxy(map, {
    get(target, prop) {
      if (ENUMERATING_MAP_MEMBERS.has(prop)) {
        throw new LocalSocketEnumerationError('Enumerating `io.sockets.sockets`');
      }
      return readBound(target, prop);
    },
  });

const guardAdapter = <T extends object>(adapter: T): T =>
  new Proxy(adapter, {
    get(target, prop) {
      if (PER_INSTANCE_ADAPTER_MEMBERS.has(prop)) {
        throw new LocalSocketEnumerationError(`\`io.sockets.adapter.${String(prop)}\``);
      }
      return readBound(target, prop);
    },
  });

const guardNamespace = <T extends GuardableSocketServer['sockets']>(namespace: T): T =>
  new Proxy(namespace, {
    get(target, prop) {
      if (prop === 'adapter') return guardAdapter(target.adapter);
      if (prop === 'sockets') return guardSocketsMap(target.sockets);
      return readBound(target, prop);
    },
  });

/**
 * Wrap a Socket.io server so that the per-instance surfaces
 * (`sockets.adapter.rooms`, `sockets.adapter.sids`, enumerating `sockets.sockets`)
 * throw {@link LocalSocketEnumerationError}. Everything else — `in()`, `to()`,
 * `fetchSockets()`, `emit()`, `sockets.sockets.get(id)` — passes through
 * unchanged. Identity of the wrapper is NOT stable across calls; callers cache it.
 */
export const guardLocalSocketEnumeration = <T extends GuardableSocketServer>(io: T): T =>
  new Proxy(io, {
    get(target, prop) {
      if (prop === 'sockets') return guardNamespace(target.sockets);
      return readBound(target, prop);
    },
  });
