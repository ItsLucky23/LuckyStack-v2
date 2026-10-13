# AI Browser Verification

## Why approval and tool choice matter

Browser actions can change data and expose authenticated sessions. An AI must obtain explicit approval for a concrete verification goal and use an authorized test environment/account. Never obtain credentials from `.env.local`.

Use the smallest adequate tool:

- `agent-browser` for ordinary functional flows, console/network inspection and single-browser screenshots.
- Playwright MCP when the assertion requires cross-browser/mobile rendering or visual judgment.
- Chrome DevTools MCP for Lighthouse, performance traces or deep performance diagnostics.

Escalate because of a missing capability, not because a larger tool is available. Ask again when the approved goal or authority boundary changes.

## Before verification

- Start or reuse a healthy runtime under the applicable local policy; report its actual URL/ports and whether it stays running.
- Use a dedicated test account and tool-managed session persistence. Keep saved browser state out of Git.
- Inspect the selected tool's actual configuration and help for permissions/domain restrictions. `AGENTS.md` is a shared instruction file, **not** a replacement settings parser: Claude-specific permissions still belong in supported `.claude/settings.json`.
- State the observable assertion before taking actions, including failures to inspect rather than only a happy-path screenshot.

After verifying a useful flow, offer to capture it in a deterministic browser test. Interactive AI exploration and permanent CI tests have different jobs; CI must not depend on repeating an LLM's decisions.

See the project's browser skills for approved procedures and root `AGENTS.md` for the authority boundary.
