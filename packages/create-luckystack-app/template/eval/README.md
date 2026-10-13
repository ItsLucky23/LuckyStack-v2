# AI-context evaluation

This optional evaluation checks whether a project's AI context actually improves outcomes, rather than assuming more documents always help. Compare the same prompt with and without the available context, then grade observable results. The scorer does not run an AI model or establish causation on its own: keep candidate runs comparable and review surprising results manually.

Run `npm run ai:eval -- --help` for current scoring options and `npm run ai:eval -- --selftest` to check the scorer. Consult the scenario definitions and scorer source for current candidate fields and checks; do not maintain a second inventory here. A consistently poor result is a reason to investigate context quality before adding a more complicated retrieval layer.
