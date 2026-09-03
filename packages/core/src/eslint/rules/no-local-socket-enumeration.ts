//? Rule: forbid enumerating the Socket.io server's LOCAL socket maps.
//? Three ways of reaching a room's sockets look identical in the editor:
//?   - `io.sockets.adapter.rooms.get(room)` / `io.sockets.adapter.sids`
//?     — only THIS instance.
//?   - enumerating `io.sockets.sockets` (`.values()`, `.keys()`,
//?     `.entries()`, `.forEach()`, `.size`, `for...of`, spread)
//?     — only THIS instance.
//?   - `await io.in(room).fetchSockets()` — ALL instances (Redis-adapter
//?     aware).
//? The Redis adapter synchronises DELIVERY (`io.to(room).emit()`) but NOT
//? those two local maps. A broadcast that enumerates a local map, or an
//? emit gated on `adapter.rooms.has(room)`, works in dev (one instance)
//? and silently goes dead on every other instance of a split deployment.
//? A consumer project made this exact mistake three times independently.
//?
//? Good path: `getRoomSockets(room, { userId })` from `@luckystack/core`,
//? or `io.in(room).fetchSockets()`. A deliberate per-instance use (e.g. a
//? sweep cleaning up its own connections) opts out with
//? `// eslint-disable-next-line luckystack/no-local-socket-enumeration -- <why>`
//? and, at runtime, `getIoInstance({ raw: true })` — the dev-mode
//? `getIoInstance()` proxy throws on these accesses.
//?
//? Deliberately NOT reported:
//?   - `io.sockets.sockets.get(id)` / `.has(id)` / `.delete(id)` — a
//?     keyed lookup from a local socket handler is per definition local
//?     and correct; only ENUMERATION is wrong.
//?   - `socket.rooms.has(room)` — the per-socket room set is fine.
//?   - Computed access (`io['sockets']['adapter']['rooms']`) — out of
//?     scope here; the runtime proxy catches it.
//?
//? Gated by hasPackage('@luckystack/core') OR hasPackage('@luckystack/sync')
//? at the config-composition layer.

import type { Rule } from 'eslint';
import type * as ESTree from 'estree';

import type { EslintRule } from '../internal/ruleTypes.js';

const ADAPTER_LOCAL_MAPS = new Set(['rooms', 'sids']);
const ENUMERATING_MEMBERS = new Set(['values', 'keys', 'entries', 'forEach', 'size']);

//? `<X>.<name>` — a non-computed member access whose property is `name`.
const isNamedMember = (
  node: ESTree.Node,
  name: string,
): node is ESTree.MemberExpression & { property: ESTree.Identifier } =>
  node.type === 'MemberExpression' &&
  !node.computed &&
  node.property.type === 'Identifier' &&
  node.property.name === name;

//? `<Y>.sockets.sockets` — the local socket map on a Socket.io server.
const isLocalSocketsMap = (node: ESTree.Node): boolean =>
  isNamedMember(node, 'sockets') && isNamedMember(node.object, 'sockets');

const rule: EslintRule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow enumerating the Socket.io server\'s local socket maps (`.adapter.rooms`, `.adapter.sids`, iterating `io.sockets.sockets`). They only see THIS instance; use `getRoomSockets(...)` or `io.in(room).fetchSockets()`.',
    },
    messages: {
      localAdapterMap:
        '`.adapter.{{name}}` only sees sockets connected to THIS instance — on a multi-instance deployment every other instance is invisible here. Use `getRoomSockets(room, { userId })` from `@luckystack/core` or `await io.in(room).fetchSockets()`. For deliberate per-instance work use `getIoInstance({ raw: true })` and add `// eslint-disable-next-line luckystack/no-local-socket-enumeration -- <why>`.',
      localSocketEnumeration:
        'Enumerating `io.sockets.sockets` (`.{{name}}`) only sees sockets connected to THIS instance — on a multi-instance deployment every other instance is invisible here. Use `getRoomSockets(room, { userId })` from `@luckystack/core` or `await io.in(room).fetchSockets()`. For deliberate per-instance work use `getIoInstance({ raw: true })` and add `// eslint-disable-next-line luckystack/no-local-socket-enumeration -- <why>`.',
    },
    schema: [],
  },
  create(context: Rule.RuleContext) {
    const reportEnumeration = (node: ESTree.Node, name: string): void => {
      context.report({ node, messageId: 'localSocketEnumeration', data: { name } });
    };
    return {
      MemberExpression(node) {
        if (node.computed || node.property.type !== 'Identifier') return;
        const name = node.property.name;
        //? (a) `<X>.adapter.rooms` / `<X>.adapter.sids`
        if (ADAPTER_LOCAL_MAPS.has(name) && isNamedMember(node.object, 'adapter')) {
          context.report({ node, messageId: 'localAdapterMap', data: { name } });
          return;
        }
        //? (b) `<Y>.sockets.sockets.values()` / `.keys()` / `.entries()` /
        //? `.forEach()` / `.size` — `.get()` / `.has()` / `.delete()` pass.
        if (ENUMERATING_MEMBERS.has(name) && isLocalSocketsMap(node.object)) {
          reportEnumeration(node, name);
        }
      },
      //? (c) `for (const s of <Y>.sockets.sockets)`
      ForOfStatement(node) {
        if (isLocalSocketsMap(node.right)) reportEnumeration(node.right, 'for...of');
      },
      //? (d) `[...<Y>.sockets.sockets]`
      SpreadElement(node) {
        if (isLocalSocketsMap(node.argument)) reportEnumeration(node.argument, '...spread');
      },
    };
  },
};

export default rule;
