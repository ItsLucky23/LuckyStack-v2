import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(new URL('createServer.ts', import.meta.url), 'utf8').replaceAll('\r\n', '\n');

describe('server boot-UUID heartbeat wiring', () => {
  it('starts the heartbeat only after HTTP listen succeeds', () => {
    const listenStart = source.indexOf('const listen = async');
    const listenEnd = source.indexOf('//? Idempotent graceful shutdown', listenStart);
    const listenBlock = source.slice(listenStart, listenEnd);

    expect(listenStart).toBeGreaterThanOrEqual(0);
    expect(listenBlock).toContain('await listenLuckyStackServer');
    expect(listenBlock).toContain('bootUuidHeartbeat ??= startBootUuidHeartbeat();');
    expect(listenBlock.indexOf('await listenLuckyStackServer'))
      .toBeLessThan(listenBlock.indexOf('startBootUuidHeartbeat()'));
  });

  it('stops the heartbeat before graceful resource shutdown', () => {
    const stopStart = source.indexOf('const stop = (stopOptions');
    const stopEnd = source.indexOf('//? Production signal wiring', stopStart);
    const stopBlock = source.slice(stopStart, stopEnd);

    expect(stopStart).toBeGreaterThanOrEqual(0);
    expect(stopBlock).toContain('bootUuidHeartbeat?.stop();');
    expect(stopBlock.indexOf('bootUuidHeartbeat?.stop();'))
      .toBeLessThan(stopBlock.indexOf('runGracefulShutdown'));
  });
});
