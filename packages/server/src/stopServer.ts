import type { Server as HttpServer } from 'node:http';
import type { Server as SocketIOServer } from 'socket.io';
import type { Redis as RedisClient } from 'ioredis';
import {
  dispatchHook,
  flushErrorTrackers,
  getLogger,
  tryCatch,
} from '@luckystack/core';
import type { StopLuckyStackServerOptions } from './types';

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

export interface GracefulShutdownDeps {
  httpServer: HttpServer;
  ioServer: SocketIOServer;
  adapterClients: { pubClient: RedisClient; subClient: RedisClient };
}

//? Race a promise against a timeout so one hanging shutdown step (a stuck
//? `flush`, a socket that never closes, a half-dead Redis connection) can never
//? stall the whole sequence past the deadline. Resolves `true` if `fn`
//? completed, `false` if the timeout won. Never rejects — shutdown is
//? best-effort and a thrown step must not abort the remaining steps.
const withTimeout = async (
  label: string,
  timeoutMs: number,
  fn: () => Promise<void>,
): Promise<boolean> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => {
      getLogger().warn(`[shutdown] step "${label}" exceeded ${String(timeoutMs)}ms — moving on`);
      resolve(false);
    }, timeoutMs);
    //? Don't let the timer keep the event loop alive once everything else is done.
    timer.unref();
  });
  const run = (async (): Promise<true> => {
    const [error] = await tryCatch(fn);
    if (error) getLogger().warn(`[shutdown] step "${label}" failed: ${error.message}`);
    return true;
  })();
  const completed = await Promise.race([run, timeout]);
  if (timer) clearTimeout(timer);
  return completed;
};

const closeHttpServer = (httpServer: HttpServer): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    //? `close()` stops accepting NEW connections and fires the callback once all
    //? existing connections end. The timeout race in the caller bounds the wait
    //? for slow keep-alive clients. Surface the callback error (e.g.
    //? `ERR_SERVER_NOT_RUNNING` when close() is called before listen()) so the
    //? caller's `withTimeout` tryCatch logs it like every other shutdown step,
    //? instead of resolving silently.
    httpServer.close((error) => { if (error) reject(error); else resolve(); });
  });

const closeIoServer = (ioServer: SocketIOServer): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    //? `io.close(cb)` also returns a promise in socket.io 4.x; we drive
    //? completion off the callback, so explicitly ignore the returned promise.
    //? Surface the callback error (forwarded from the underlying http close) so
    //? the caller's `withTimeout` tryCatch logs it instead of swallowing it.
    void ioServer.close((error) => { if (error) reject(error); else resolve(); });
  });

const quitRedisClient = async (client: RedisClient): Promise<void> => {
  await client.quit();
};

/**
 * Run the graceful-shutdown sequence (MIS-016). Ordered + isolated:
 *   1. Stop accepting NEW HTTP connections (`httpServer.close()` is kicked off
 *      immediately; we await it last so in-flight requests can drain).
 *   2. Dispatch the core `preServerStop` hook so consumers can flush queues /
 *      release leases / close pools.
 *   3. `flushErrorTrackers()` so buffered events aren't lost — bounded by the
 *      timeout race.
 *   4. Close the Socket.io server, then the HTTP server, then `quit()` the
 *      Redis-adapter pub/sub clients.
 *
 * Every step is wrapped in {@link withTimeout} so a single failing/hanging step
 * cannot hang the whole shutdown — the sequence always settles within
 * `timeoutMs` per step. Never rejects.
 */
export const runGracefulShutdown = async (
  deps: GracefulShutdownDeps,
  options: StopLuckyStackServerOptions = {},
): Promise<void> => {
  const { httpServer, ioServer, adapterClients } = deps;
  const reason = options.reason ?? 'manual';
  const timeoutMs = options.timeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;

  getLogger().info(`[shutdown] graceful shutdown started (reason=${reason})`);

  //? Kick off "stop accepting new connections" first. `httpServer.close()` only
  //? finishes once existing connections drain, so START it now and AWAIT it near
  //? the end — that way the hook + flush run while connections wind down.
  const httpClosed = withTimeout('http-close', timeoutMs, () => closeHttpServer(httpServer));

  //? Best-effort consumer shutdown hook. A returned stop signal is ignored — the
  //? process is going down — and the dispatcher already swallows per-handler
  //? throws; the timeout guards against a handler that simply never resolves.
  await withTimeout('preServerStop-hook', timeoutMs, async () => {
    await dispatchHook('preServerStop', { reason, timeoutMs });
  });

  //? Flush buffered error-tracker events before tearing down. Bounded so a
  //? wedged transport (e.g. Sentry unreachable) can't hang shutdown.
  await withTimeout('flush-error-trackers', timeoutMs, () => flushErrorTrackers());

  //? Close the socket layer before the HTTP server fully settles so no new
  //? socket upgrades sneak in.
  await withTimeout('io-close', timeoutMs, () => closeIoServer(ioServer));

  await httpClosed;

  //? Disconnect the Redis-adapter pub/sub clients — `io.close()` leaves them
  //? open, so without this the process keeps two live Redis sockets.
  await withTimeout('redis-pub-quit', timeoutMs, () => quitRedisClient(adapterClients.pubClient));
  await withTimeout('redis-sub-quit', timeoutMs, () => quitRedisClient(adapterClients.subClient));

  getLogger().info('[shutdown] graceful shutdown complete');
};
