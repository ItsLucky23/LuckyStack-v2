# AI-context evaluation

Extra context is justified by better work, not by how much documentation exists. This harness compares the same task with and without generated context/queries before adding a more complex retrieval layer.

## Run a comparison

Use `npm run ai:eval` to select a scenario, then run its prompt twice in equivalent isolated environments: one with context available, one without. Capture the agent's actual actions in candidate records and score both with the harness's current command help/schema. Do not delete context from a shared working checkout to create the control case.

Hold model, input task and environment constant; record differences and failed checks honestly. A score is only as trustworthy as the candidate evidence and assertions, not proof of general correctness.

Use `npm run ai:eval -- --selftest` to verify the scorer. Consult `scoreEval.mjs` and scenario records for the authoritative candidate/checker shape rather than maintaining a second schema here. Consumer projects need their own scenarios; framework ADR references are not consumer truth.
