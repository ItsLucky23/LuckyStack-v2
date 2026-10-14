---
name: loopback-connect-to-a-free-port-can-hang-instead-of-refusing
title: A connect to a free 127.0.0.1 port can hang for minutes instead of being refused
severity: medium
area: scripts/e2eVerdaccio.mjs (port probes); any "is this port free?" check
date: 2026-10-14
tags: [networking, wsl, e2e, timeouts, port-probe]
---

# 0026 — A connect to a free 127.0.0.1 port can hang for minutes instead of being refused

## What happened

`e2e:verdaccio` sometimes took 270 s instead of about 125 s. Timing every log
line showed 143 s passing between the work-dir line and "starting verdaccio";
the only code in between is the pre-flight check that port 4873 is free. The
slow and fast runs ran the same command, so it first looked like random load.

## Root cause

On a WSL machine with mirrored networking, a TCP connect to a 127.0.0.1 port
where nothing listens is often not answered at all, instead of being refused
immediately. The probe had no timeout, so it waited for the kernel to give up
after its SYN retries (`tcp_syn_retries=6`, roughly 130 s). A port that had a
listener shortly before is refused at once, which is why a run straight after
another one was fast.

## How to avoid

- Give every port probe a short timeout and treat "no answer" as "nothing
  listens": a local listener accepts within milliseconds.
- Reproduce with a probe that reports the outcome and the elapsed time against
  a port that was never used, not only against one that just closed.
- When a step is slow only sometimes, time each log line before blaming load.
