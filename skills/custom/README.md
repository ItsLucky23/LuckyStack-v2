# Custom skills

A skill should encode the decisions and verification that make a task safe, not a copied implementation, tool API or inventory of siblings.

Keep each workflow bounded. Before adding one, check existing skill files for a reusable task and consult `AGENTS.md` for authority. Describe acceptance evidence, failures/skips and escalation rather than prescribing guessed commands or safe-sounding heuristics.

Use the actual installed tool documentation and source contracts. Do not turn one known edge case into a per-case prompt patch.
