# Framework-first remediation — wat we VÓÓR Workspaces in LuckyStack oplossen

> **Directief (gebruiker, 2026-06-02):** "Alle punten die ons blokkeren en op framework-niveau opgelost moeten worden omdat het gewoon een gebrek aan configuratie is — oplossen vóór we aan het Workspaces-project beginnen." Gecombineerd met de keuze **"Workspaces bouwen ná de publish"** betekent dit: **deze items moeten in het framework landen vóór de publish**, anders bouwt Workspaces straks tegen workarounds.
>
> Dit document scheidt **wat wél framework-scope is** (config-gaten → fix in `packages/*` vóór publish) van **wat bewust app/infra blijft** (geen framework-defect — een app- of infra-keuze). Gap-verwijzingen → [`FRAMEWORK_GAPS.md`](./FRAMEWORK_GAPS.md).

---

## ✅ IN SCOPE — fixen in het framework, vóór publish

| ID | Framework-werk | Lost op | Waarom framework-scope | Package | Effort |
|---|---|---|---|---|---|
| **R1** | **Webhook-seam**: registreerbare origin-exempt path-prefix + optionele `skipBodyParse`/`PRE_PARAMS`-custom-route zodat een handler de ruwe body vóór `getParams` kan lezen | [G6](./FRAMEWORK_GAPS.md) + [G7](./FRAMEWORK_GAPS.md) | Server-to-server-webhooks (GitLab, Stripe, …) zijn een universele behoefte; nu 403't de fail-closed origin-policy elke header-loze POST en is de body al geconsumeerd. Puur een config-/seam-gat. | `@luckystack/server` | ~1 dag |
| **R2** | **Keyed client-registry**: `registerPrismaClient(client, key?)` + `getPrismaClientFor(key)` (idem Redis), naast de bestaande default | [G9](./FRAMEWORK_GAPS.md) | Gegradeerde credentials (read-only vs read-write, of per-tenant) zijn een terugkerend patroon; de registry is nu single-slot/last-write-wins. Een keyed-accessor is een kleine, generieke uitbreiding van een bestaande registry. | `@luckystack/core` | ~halve dag |
| **R3** | **`registerRedisKeyFormatter`** (staat al op de roadmap): afdwingbare key-prefix i.p.v. handmatige `getProjectName()`-conventie | [G24](./FRAMEWORK_GAPS.md) | Multi-tenant (tenant = Workspace) vereist per-tenant Redis-key-isolatie; nu zijn prefixes een per-call-conventie verspreid over ~8 files. Een formatter-hook is precies de ontbrekende config. | `@luckystack/core` | ~halve dag |
| **R4** | **Streaming/multipart upload-seam**: een upload-pad dat de 1 MiB JSON-body-cap omzeilt (raw `req`-stream of multipart-parser) met behoud van de `onUploadStart`/`onUploadComplete`-hooks + auth | [G17](./FRAMEWORK_GAPS.md) | Echte file-/audio-uploads zijn een algemene behoefte; nu is alleen base64-in-JSON (~0.75 MiB) mogelijk. Een streaming-seam is een framework-config-gat (geen multipart-parser bestaat). | `@luckystack/core` + `@luckystack/server` | ~1 dag |
| **R5** | **Leader-election helper**: een kleine Redis-lease-primitive (`acquireLease`/`renew`/`release`, SETNX+TTL) zodat single-instance-ownership / HA niet vanaf nul gebouwd wordt | [G8](./FRAMEWORK_GAPS.md) + [G16](./FRAMEWORK_GAPS.md) | Elk multi-instance-product met een single-writer-component (orchestrator, indexer, cron) heeft dit nodig; Redis is al een harde dependency. Klein, generiek, herbruikbaar. | `@luckystack/core` | ~halve dag |

**Totaal framework-first werk: ~3,5 dagen** gefocust werk, verdeeld over `@luckystack/core` (R2/R3/R5 + deel R4) en `@luckystack/server` (R1 + deel R4).

### Volgorde & aanpak
1. Elk item = eigen branch + PR tegen `master`, met de gap-scenario's als acceptatiecriteria en tests (de framework-`test-runner` + per-route `.tests.ts`).
2. R2/R3/R5 zijn de kleinste en raken `core` → eerst (laag risico, hoge hefboom). R1/R4 raken de HTTP-pipeline → daarna, met extra zorg voor de `getParams`-volgorde.
3. Na deze 5 → de bestaande publish-gates opnieuw draaien (build/lint/tsc/test/pack) → **dan pas publish** → dan Workspaces.
4. Houd je aan de strict-typing-policy ([[feedback_strict_typing_policy]]) en de peer-dep-guard-policy ([[feedback_peer_dep_guard_policy]]) bij elke PR.

### Documentatie-taak (geen code-PR, wel vóór Workspaces)
- **D-MT** — een **multi-tenant-patroon-doc** (`docs/ARCHITECTURE_MULTI_TENANCY.md`): hoe je tenant-scoping doet met composeable `Prisma $extends` (where-injection op `workspaceId`) + R3's key-formatter + per-workspace-secrets. Geen nieuwe code, maar het maakt het multi-tenant-pad (tenant = Workspace) first-class gedocumenteerd i.p.v. impliciet. RBAC zelf blijft app-domein (zie hieronder).

---

## ⛔ OUT OF SCOPE — blijft bewust app/infra (geen framework-defect)

| Onderwerp | Gap | Waarom NIET framework-scope |
|---|---|---|
| **Scheduler / job-queue** (serial indexer, cron-watcher) | [G1](./FRAMEWORK_GAPS.md) | Een scheduler is een feature, geen config-gat. LuckyStack is bewust een socket-first request/response-framework. → **bullmq + node-cron** (Redis is er al). |
| **Event-log / ordering / replay** (de duurzame per-ticket-stream) | [G2](./FRAMEWORK_GAPS.md), [G11](./FRAMEWORK_GAPS.md), [G12](./FRAMEWORK_GAPS.md) | Een CQRS-event-log met app-toegekende sequence is app-domein; sync is bewust fire-and-forget transport. → **app-eigen Mongo + Redis-`seq`**. |
| **Collaborator-roster** | [G13](./FRAMEWORK_GAPS.md) | Persistente aanwezigheid is app-state; presence levert transient pings (juiste altitude). → **app-eigen Redis-set**. |
| **PTY/terminal-gateway** | [G4](./FRAMEWORK_GAPS.md), [G5](./FRAMEWORK_GAPS.md) | Een interactieve-terminal-transport zou de "transport-framework, geen agent-runtime"-grens vervagen. De `io`-instance is al open → bouw de `/pty`-namespace app-side. (PR-4 bewust **niet** gedaan.) |
| **Proces-supervisor** | [G22](./FRAMEWORK_GAPS.md) | **Docker is de supervisor** (restart-policies + container-lifecycle). De Claude-CLI's draaien ín containers. devkit-supervisor hooguit als code-referentie. |
| **Subdomein/TLS-reverse-proxy** | [G3](./FRAMEWORK_GAPS.md) | `@luckystack/router` heeft een ander doel (service-split van één app). TLS-edge + wildcard + dynamische discovery = **Caddy**. Niet iets dat het framework moet worden. |
| **Vector-search-infra** | [G10](./FRAMEWORK_GAPS.md) | `$vectorSearch` is een Mongo/Atlas-feature; het framework geeft `DATABASE_URL` enkel door. → **Atlas Local** in de Docker-stack. |
| **RBAC / rollenmodel** | [B2](./FRAMEWORK_GAPS.md) | Owner/Admin/Member + per-workspace-membership is app-domein-policy (juiste altitude — auth ≠ authz). Het framework levert de auth-gate (`auth={login:true}`); de matrix bouw je in handlers. → **app-RBAC** (zie [`IDEE_SPEC.md`](./IDEE_SPEC.md)). |
| **STT (speech-to-text)** | [G27](./FRAMEWORK_GAPS.md) | Media-processing hoort niet in een web-framework. → **self-hosted whisper.cpp / cloud** (later). |
| **Skill/tool-registry voor de stage-AI** | [G28](./FRAMEWORK_GAPS.md) | Skills/tools/MCP zijn Claude-CLI-niveau (`.claude/settings.json`), geen LuckyStack-runtime-concept. LuckyStack slaat de per-stage-config op + levert 'm; het "biedt geen skill aan een AI". |

---

## Waarom deze snit klopt
De grens die we trekken is consequent: **"ontbrekende configuratie/seam in een bestaande framework-verantwoordelijkheid" → fix in het framework** (R1–R5: HTTP-pipeline, client-registry, Redis-keys, uploads, een Redis-primitive). **"Een feature of app/infra-keuze die buiten de transport-/routing-/sessie-kern valt" → app/infra** (scheduler, event-log, terminals, proxy, RBAC, STT). Dat houdt LuckyStack scherp op zijn "socket-first transport-framework"-belofte, terwijl de scherpe randen die élk serieus product zou raken (webhooks, gegradeerde clients, multi-tenant-keys, uploads, leader-election) vóór publish first-class worden.

> **Vervolg:** zodra je akkoord bent met deze 5 (R1–R5) + de multi-tenant-doc (D-MT), kan ik ze opdelen in concrete PR-werkpakketten met acceptatiecriteria — zeg het woord. De Workspaces-bouw start daarna, tegen de gepubliceerde packages.
