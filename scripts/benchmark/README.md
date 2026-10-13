# Runtime benchmarks

Use a real load generator rather than an ad-hoc Node HTTP loop: a client-side ceiling can masquerade as the server's limit. Historical evidence lives in `docs/findings/2026-07-16-npm-vs-bun-benchmark/`.

Install `oha` from its official distribution, then run:

```sh
node scripts/benchmark/runHttp.mjs
```

Inspect the driver/source for binary overrides and measurement settings; do not copy defaults into documentation. Use an explicitly owned disposable environment, not shared application traffic.

Compare equivalent workloads and verify the actual runtime. Record tool versions, machine conditions (including free memory), exact commands, repeated-run medians and limitations. A native-runtime benchmark is not proof that the framework's adapter path achieves the same result.

Benchmark findings belong in a dated requested-scan ledger only when the user asked for that analysis. They are measurements, not automatically defects.
