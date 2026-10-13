---
name: agent-browser
description: Turn approved interactive browser evidence into deterministic end-to-end tests.
category: automation
---

# Browser test capture

Interactive `agent-browser` exploration and permanent test-runner assertions have different jobs. Do not invent a test API for a browser CLI or assume an authenticated session helper exists.

1. Confirm requested flows and query current routes/components. Reuse the project's installed browser test framework and fixtures; consult actual tool docs/types before suggesting dependencies.
2. Obtain explicit browser approval and an authorized test environment/account. Use `/agent-browser-verify` for interactive evidence where useful.
3. Capture meaningful success, denial and failure assertions in deterministic tests. Selectors and expected outcomes must come from the actual UI/product intent, not guessed titles.
4. Preserve existing tests and consumer edits. Ask before installing tools, changing CI authority or overwriting a customized artifact.
5. Run the real test command with required app services available. A TODO-filled skeleton, untested login fixture or successful file discovery is not completion.
6. Report coverage, skips, observed results and remaining assertions. Keep secrets/session state out of Git.

Follow `AGENTS.md` and the browser policy. CI must run without repeating an LLM's exploratory choices.
