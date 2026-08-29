import { getLogger, tryCatch } from '@luckystack/core';
import type { AfterListenOptions } from './types';

//? Runs work that belongs AFTER the server is accepting traffic, isolated from
//? the caller's fatal boot chain.
//?
//? WHY this exists: the scaffolded `server/server.ts` wraps its boot in an IIFE
//? whose `.catch` calls `process.exit(1)`. That is right for anything BEFORE
//? `listen()` — a failure there means there is no server. Appending post-listen
//? work to the same chain silently extends "fatal" to tasks that run while the
//? server is already serving, so one unreachable dependency (a queue's
//? database, say) kills a healthy process. Behind a supervisor that becomes a
//? crash-loop: restart, dependency still down, repeat — while the log claims
//? "failed to start" about a server that started fine.
//?
//? Default is therefore log-and-continue. `fatal: true` restores propagation
//? for a task the process genuinely cannot run without.
export const runAfterListenTask = async (
  task: () => void | Promise<void>,
  { fatal = false, label = 'post-listen task' }: AfterListenOptions = {},
): Promise<void> => {
  const [error] = await tryCatch(async () => task());
  if (!error) return;
  if (fatal) throw error;
  getLogger().error(
    `[server] ${label} failed — the server is listening and stays up. Fix the underlying cause; ` +
    `pass { fatal: true } to afterListen if this process should not run without it.`,
    error,
  );
};
