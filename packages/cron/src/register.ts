//? Side-effect `./register` entry for @luckystack/cron. Auto-imported at boot
//? by @luckystack/server's `bootstrapLuckyStack` when this package is
//? installed, so cron wires itself with NO consumer code edit — `npm i
//? @luckystack/cron` + restart is enough.
//?
//? Registers only the `preServerStop` teardown here; the scheduler itself
//? starts lazily on the first `registerCronJob(...)` call (typically from a
//? consumer overlay file in `luckystack/cron/`, which runs AFTER this import),
//? so a project with zero jobs pays zero timers and never competes for the
//? leader lease.

import './hookPayloads';
import { registerCronTeardown } from './scheduler';

registerCronTeardown();
