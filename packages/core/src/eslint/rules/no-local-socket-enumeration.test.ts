import { Linter } from 'eslint';
import { describe, it, expect } from 'vitest';

import luckystackConfig, { rules } from '../index';
import rule from './no-local-socket-enumeration';

const RULE_ID = 'luckystack/no-local-socket-enumeration';

const linter = new Linter();

const lint = (code: string) =>
  linter.verify(code, {
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    plugins: { luckystack: { rules: { 'no-local-socket-enumeration': rule } } },
    rules: { [RULE_ID]: 'error' },
  });

const messageIds = (code: string): string[] => lint(code).map((m) => m.messageId ?? m.ruleId ?? '');

describe('luckystack/no-local-socket-enumeration', () => {
  describe('reports local adapter maps (a)', () => {
    it('`io.sockets.adapter.rooms`', () => {
      expect(messageIds('const r = io.sockets.adapter.rooms.get(room);')).toEqual(['localAdapterMap']);
    });

    it('`io.sockets.adapter.sids`', () => {
      expect(messageIds('const s = io.sockets.adapter.sids;')).toEqual(['localAdapterMap']);
    });

    it('`adapter.rooms.has(room)` gating an emit', () => {
      const code = 'if (io.of("/").adapter.rooms.has(room)) io.to(room).emit("x");';
      expect(messageIds(code)).toEqual(['localAdapterMap']);
    });
  });

  describe('reports enumeration of the local sockets map (b)', () => {
    it.each(['values', 'keys', 'entries'])('`io.sockets.sockets.%s()`', (method) => {
      expect(messageIds(`const all = io.sockets.sockets.${method}();`)).toEqual(['localSocketEnumeration']);
    });

    it('`io.sockets.sockets.forEach(...)`', () => {
      expect(messageIds('io.sockets.sockets.forEach((s) => s.emit("x"));')).toEqual(['localSocketEnumeration']);
    });

    it('`io.sockets.sockets.size`', () => {
      expect(messageIds('const n = io.sockets.sockets.size;')).toEqual(['localSocketEnumeration']);
    });

    it('`[...io.sockets.sockets.values()]` reports exactly once (from (b), not the spread)', () => {
      expect(messageIds('const all = [...io.sockets.sockets.values()];')).toEqual(['localSocketEnumeration']);
    });
  });

  describe('reports iteration syntax over the local sockets map (c, d)', () => {
    it('`for (const s of io.sockets.sockets)`', () => {
      expect(messageIds('for (const [, s] of io.sockets.sockets) { s.emit("x"); }')).toEqual([
        'localSocketEnumeration',
      ]);
    });

    it('`[...io.sockets.sockets]`', () => {
      expect(messageIds('const all = [...io.sockets.sockets];')).toEqual(['localSocketEnumeration']);
    });
  });

  describe('allows the correct and keyed-lookup forms', () => {
    it.each([
      'const s = io.sockets.sockets.get(id);',
      'if (io.sockets.sockets.has(id)) {}',
      'io.sockets.sockets.delete(id);',
      'const all = await io.in(room).fetchSockets();',
      'const all = await io.fetchSockets();',
      'io.to(room).emit("x", payload);',
      'if (socket.rooms.has(room)) {}',
      'const sockets = getRoomSockets(room, { userId });',
      'const rooms = state.rooms;',
    ])('%s', (code) => {
      expect(lint(code)).toEqual([]);
    });
  });

  it('is registered in the shared config as an error when core/sync are resolvable', () => {
    expect(rules['no-local-socket-enumeration']).toBe(rule);
    const block = luckystackConfig.find((c) => c.rules && RULE_ID in c.rules);
    expect(block?.rules?.[RULE_ID]).toBe('error');
  });
});
