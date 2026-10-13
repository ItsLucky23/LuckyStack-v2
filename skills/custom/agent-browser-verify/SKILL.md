---
name: agent-browser-verify
description: Interactively verify an approved LuckyStack flow against an authorized running app.
category: automation
---

# Interactive browser verification

1. Propose the assertion and smallest adequate browser tool; wait for approval. Escalate only for a missing required capability under `docs/AI_BROWSER_TESTING.md` (consumer copy under `docs/luckystack/`).
2. Reuse/start the runtime under applicable local authority. Report the actual URL and use a dedicated test account; never read `.env.local` for credentials.
3. Inspect current tool configuration/help for domain/action restrictions. Preserve supported `.claude/settings.json` permissions; do not assume changing instructions to `AGENTS.md` changes a settings parser.
4. Verify the requested flow, including console/network evidence and denial/failure cases. For auth, test the actual configured token/cookie mode, CSRF policy, account switching and applicable provider flows; source/types are authoritative for transport details.
5. Report pass/fail/skipped cases separately. Offer a deterministic test after the flow is verified, not as proof that exploration already passed.

Do not broaden authority, print token values or create a second copied login-flow specification in this skill.
