# Workspaces — Stage-config ↔ `.claude/settings.json` mapping (B-38)

> **Doel (B-38):** wat we in de stage/pipeline-editor instellen moet 1-op-1 op de **échte** Claude-Code-config mappen, zodat het ook echt werkt in de container. Dit document koppelt elk Workspaces-concept aan de werkelijke `.claude/settings.json`-sleutel of CLI-flag. Bron: geverifieerde Claude-Code-config-referentie (2026-06).
>
> **Hoofdinzicht:** veel van wat we dachten zelf te moeten bouwen, levert Claude Code native — **hooks** (de integratie-backbone), **`--max-budget-usd`/`--max-turns`** (budget/runaway), **`--json-schema`** (gestructureerde carry-over), **`--mcp-config`/`--strict-mcp-config`** (skills-per-stage), en een ingebouwde **sandbox** met network-egress-control. Dat de-riskt B-35, B-O2, B-15 en de container-hygiëne fors.

---

## 1. Hoe de orchestrator een stage-AI start
Per stage rendert de orchestrator de config naar bestanden in de container (`.claude/settings.json`, `.mcp.json`, `CLAUDE.md`, `.claude/skills/`) en start de CLI. **Twee modi:**

**a) Interactieve terminal (de browser-terminal, B-31):** gewone `claude` in de worktree, met de gerenderde `.claude/settings.json`. De pty-agent attacht stdin/stdout. De gebruiker ziet/bedient live.

**b) Autonome/headless run (autonoom doorlopen terwijl je weg bent):**
```bash
claude --settings ./.claude/settings.json \
  --permission-mode dontAsk \           # alleen vooraf-toegestane tools; nooit blokkeren op een prompt
  --allowedTools "<StageCommand-allow>" \
  --mcp-config ./.mcp.json --strict-mcp-config \   # alleen deze stage's skills/MCP
  --append-system-prompt-file ./stage-instructions.txt \  # custom instructions + carry-over
  --max-turns <cap> --max-budget-usd <cap> \        # runaway + budget (B-35)
  --output-format stream-json --include-hook-events --include-partial-messages \  # live stream + events
  --json-schema ./stage-output.schema.json \         # gestructureerd eind-contract (B-O2)
  -p "<geïnjecteerde stage-start-prompt>"
```

> `--permission-mode dontAsk` = de juiste modus voor onbewaakte runs: tools die niet vooraf zijn toegestaan worden **geweigerd** (niet: blijven hangen op een prompt). De accept-flow voor gevoelige acties regelen we via `ask`-rules + de needs-input-escalatie (zie §4).

---

## 2. Mapping: Workspaces-stageconfig → Claude-Code-config

| Workspaces (datamodel) | Claude Code | Notitie |
|---|---|---|
| `PipelineStage.claudeSettings` (Json) | het hele `.claude/settings.json`-blok | gerenderd in de container per stage |
| `StageCommand{pattern, mode}` | `permissions.allow/ask/deny[]` (`"Bash(npm run test:*)"`, `"Read(...)"`, `"Edit(...)"`, `"WebFetch(domain:...)"`, `"mcp__server__tool"`, `"Agent(...)"`) | `mode` → allow/ask/deny. Deny-first precedence. Whitelisting = de native permission-rules |
| `PipelineStage.aiEnabled=false` | geen CLI starten (stage zonder AI, bv. Unrefined) | — |
| `PipelineStage.customInstructions` | `--append-system-prompt-file` / `CLAUDE.md` in de worktree | — |
| `PipelineStage.promptInjectionTemplate` (carry-over, B-O2) | de `-p "<prompt>"` + `--append-system-prompt-file`; **structured output via `--json-schema`** | de vorige-stage-subset wordt in de prompt geïnjecteerd; de stage moet zijn subset terug-emitten → `--json-schema {summary, changedFiles, openQuestions, commitHash}` |
| `StageSkill{skillKey}` (RAG/graph/…) | MCP-server in `.mcp.json` + `--mcp-config ./.mcp.json --strict-mcp-config` | elke skill = een MCP-server (stdio/http). `--strict-mcp-config` = alleen déze stage's skills. `permissions.allow: ["mcp__rag__*"]` om ze toe te staan |
| `StageToolPermission{tool,tier}` (mongo:ro/rw) | **app-laag**, niet `.claude` | de DB-tier (R2 `getPrismaClientFor`) zit in de MCP-server/handler die de tool exposeert, niet in settings.json |
| `StageProcess{terminalOrder,commands}` | shell-commando's die de orchestrator in de container draait (los van de CLI) | dev-servers (Vite/backend) staan náást de Claude-CLI |
| `PipelineStage` model/effort | `model` + `effortLevel` (settings) of `--model`/`--effort` | per stage een model kiezen (bv. Haiku voor refine, Opus voor plan) |
| env per stage | `env` (settings) of `--env` | secrets/connecties; let op: geen ruwe gevoelige secrets (zie §5) |
| `visibleStageIds` (§4.6 zichtbaarheid) | **app-laag** (welke andere stages de cross-ticket-skill mag inlezen) | niet `.claude`; afgedwongen in de cross-ticket-MCP/handler |
| Context-docs (project-summary, conventions, …) | `CLAUDE.md` + `@imports` + `.claude/skills/` in de worktree | conventions ≈ `CLAUDE.md`; skills-docs in `.claude/skills/<name>/SKILL.md` |
| Worktree-config (B-31/§5) | `worktree.baseRef`, `worktree.symlinkDirectories` (node_modules!), `worktree.sparsePaths` | native worktree-support; symlink node_modules scheelt kopieer-tijd |

---

## 3. Hooks = de integratie-backbone (event-log, status, gating)
Claude Code's **hooks** zijn de sleutel waarmee de container terugpraat naar de orchestrator. Hook-type **`http`** POST't naar een URL → de orchestrator-endpoints. Zo voeden we de **event-log** (B-21) en de **status** (AgentSession) zónder de stdout te hoeven parsen.

| Hook-event | Gebruik in Workspaces |
|---|---|
| `PostToolUse` (matcher `Bash`/`Edit`/`Write`/`mcp__*`) | → `TicketEvent` (command uitgevoerd, file gewijzigd) — de **event-log-bron** |
| `PostToolUseFailure` | → `TicketEvent` (fout) + evt. needs-input |
| `Stop` | stage-AI klaar met antwoorden → status `done`/needs-input bepalen; trigger volgende-stage-promotie |
| `Notification` (matcher `permission_prompt`/`idle_prompt`) | → **status `needs-input`** + **notificatie** (B-34) naar de afwezige gebruiker |
| `SessionStart` | registreer de AgentSession; injecteer carry-over |
| `UserPromptSubmit` | log de prompt (incl. voice-transcript) als `TicketEvent` |
| `WorktreeCreate`/`WorktreeRemove` | sync met de orchestrator's worktree-state |
| `PreToolUse` (matcher per tool) | extra app-gating (bv. tool-tier-check) bovenop de permission-rules |

**Hook-config (http) voorbeeld** — elke tool-use streamt naar de orchestrator:
```json
{
  "hooks": {
    "PostToolUse": [{ "hooks": [{
      "type": "http",
      "url": "http://orchestrator.internal/hooks/ticket-event?ticket=DEV-1240",
      "headers": { "Authorization": "Bearer $WS_HOOK_TOKEN" },
      "allowedEnvVars": ["WS_HOOK_TOKEN"]
    }] }],
    "Notification": [{ "matcher": "permission_prompt|idle_prompt", "hooks": [{
      "type": "http", "url": "http://orchestrator.internal/hooks/needs-input?ticket=DEV-1240"
    }] }]
  }
}
```
> De orchestrator-endpoints draaien op de LuckyStack-server via een **`pre-params` custom-route** (R1) en wrappen hun werk in `runInTenant(workspaceId, …)`. Hook-payloads bevatten `session_id`, `tool_name`, `tool_input`, `tool_result` → genoeg voor gecoalesceerde events (B-21).

---

## 4. Budget & runaway-control — grotendeels native (B-35)
- **`--max-budget-usd <cap>`** — de CLI stopt zelf bij de spend-cap per run. Per-stage/per-ticket budget = dit per run zetten; per-workspace-budget = de orchestrator telt de runs op (`SpendRecord`) en weigert nieuwe runs bij `WorkspaceBudget`-cap (`autoPause`).
- **`--max-turns <n>`** — harde iteratie-cap tegen loops.
- **`Notification`-hook (`idle_prompt`)** + **`Stop`-hook** + **`lastHeartbeatAt`** → stuck/idle-detectie → status `stuck` → escaleer naar `needs-input` + notificatie.
- **`--output-format stream-json`** levert token/usage-info per turn → voedt `SpendRecord` (token-accounting).

> Dit betekent: B-35 is grotendeels **CLI-native** + een dunne app-laag (optellen + auto-pause), niet een volledig zelf-gebouwd budget-systeem.

---

## 5. Container-hygiëne & egress — native sandbox (AF1/LP5, trusted-group-passend)
De CLI heeft een ingebouwde **OS-sandbox voor Bash** met network-control:
```json
{
  "sandbox": {
    "enabled": true,
    "network": { "allowedDomains": ["gitlab.internal", "registry.npmjs.org"], "deniedDomains": ["*"] },
    "filesystem": { "allowWrite": ["/app"], "denyRead": ["/run/secrets"] },
    "excludedCommands": ["docker *"]
  }
}
```
Voor de trusted-small-group-opzet (B-26) is dit ruim voldoende: **egress-allowlist** beperkt waar een dependency naartoe kan bellen (mitigeert de postinstall-exfiltratie-zorg) zónder gVisor/Firecracker. Combineer met Docker-resource-limits (CPU/mem/PID) + de **per-workspace GitLab-token niet als ruwe env** maar via een scoped/kortlevende token (TV4) of een MCP-tool die 'm server-side gebruikt.

---

## 6. Skills/MCP per stage (B-15/B-16)
- Elke `StageSkill` = een MCP-server-entry in een per-stage gerenderde `.mcp.json` (stdio voor lokale skills zoals RAG/graph; http voor gedeelde).
- Start met **`--mcp-config ./.mcp.json --strict-mcp-config`** → de stage ziet **alleen** zijn eigen skills (geen lekken tussen stages).
- Toestaan: `permissions.allow: ["mcp__rag", "mcp__code-graph__impact_of", …]`.
- De RAG/graph-MCP-servers krijgen de ticket-`commitHash` + `StageSource.filter` mee → de slice-query (DH3); de DB-tier (B-O8) zit binnen de MCP-server (`getPrismaClientFor('mongo:ro')`).

---

## 7. Wat NIET via settings kan (zodat de UI niets nepts belooft)
- Je kunt **geen nieuwe native tools** toevoegen — alleen built-ins (Bash/Read/Edit/Write/WebFetch/Agent) + MCP-tools allow/deny. Eigen capaciteiten = MCP-servers.
- **Permission-matching** is gitignore-stijl/regex/glob — geen rijkere policy-taal. De stage→tool→tier-matrix (B-O8) is daarom **app-laag** (in de MCP-server/handler), niet in settings.
- **Model-fallback** alleen in print/background-mode (prima — onze autonome runs zijn print-mode).
- **Context window** niet uit te breiden — vandaar de slice-queries (DH3) i.p.v. hele bronnen laden.
- Hook-exit-codes (`0` ok, `2` blocking) liggen vast — onze hooks gebruiken `http`/`command` met die conventie.

---

## 8. Gevolg voor het ontwerp
De stage/pipeline-editor (DESIGN_BRIEF §H) krijgt tabs die 1-op-1 mappen: **General** (model/effort/instructions), **Permissions** (allow/ask/deny-rules = `StageCommand`), **Skills/MCP** (`.mcp.json`-entries = `StageSkill`), **Hooks** (event-log/status/gating — meestal door ons voor-geconfigureerd, niet door de gebruiker), **Tool access** (DB-tiers, app-laag), **Sandbox/egress** (allowlist), **Process** (`StageProcess`), **Carry-over** (`--json-schema` + template). Zo is élk veld in de UI traceerbaar naar iets dat de CLI echt doet — precies wat B-38 vraagt.
