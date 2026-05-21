# Migration: Hook-based Error Tracking Wiring

> **ARCHIVED 2026-05-21**: Migration executed. Kept for historical reference.
> Implementation lives in `packages/error-tracking/src/autoInstrumentation.ts` and the framework handlers in `packages/api/src/` + `packages/sync/src/`. Hook-based wiring is live op de `chore/package-split-prep` branch.

## Context

`@luckystack/api` en `@luckystack/sync` instrumenteren request-pipelines vandaag
met DIRECTE imports vanuit `@luckystack/error-tracking`. Dat introduceert een
harde build-time dependency op het error-tracking package vanuit twee
core-framework packages, en bindt het framework aan de legacy single-Sentry
helpers (`setSentryUser` + `startSpan`) die in `packages/error-tracking/src/sentry.ts`
wonen.

### Huidige call sites

| File | Line | Import | Gebruik |
| --- | --- | --- | --- |
| `packages/api/src/handleApiRequest.ts` | 21 | `import { setSentryUser, startSpan } from '@luckystack/error-tracking'` | `setSentryUser(...)` per request (regel 402), `startSpan(name, 'api.request')` rond `executeApiHandler` (regel 252). |
| `packages/api/src/handleHttpApiRequest.ts` | 19 | `import { setSentryUser, startSpan } from '@luckystack/error-tracking'` | `setSentryUser(...)` (regel 186), `startSpan(resolvedName, 'api.request.http')` (regel 444). |
| `packages/sync/src/handleSyncRequest.ts` | 25 | `import { setSentryUser } from '@luckystack/error-tracking'` | `setSentryUser(...)` (regel 318). Socket-sync path opent GEEN span. |
| `packages/sync/src/handleHttpSyncRequest.ts` | 21 | `import { setSentryUser, startSpan } from '@luckystack/error-tracking'` | `setSentryUser(...)` (regel 214), `startSpan(name, 'sync.request.http')` (regel 218). |

### Waarom dit moet veranderen

1. **Coupling.** `@luckystack/api` en `@luckystack/sync` hebben vandaag een
   harde `dependencies`-entry voor `@luckystack/error-tracking` in hun
   `package.json` (zie `packages/api/package.json` regel 58 en
   `packages/sync/package.json` regel 62). Een project dat geen
   observability backend gebruikt sleept toch het error-tracking package
   mee in zijn lockfile.
2. **Side effects.** De direct imports zijn boot-time observable. Een
   consumer kan ze niet verwijderen of vervangen zonder framework-code
   te forken.
3. **Testbaarheid.** De `setSentryUser` + `startSpan` calls zijn niet
   mock-baar zonder module-stub gedoe. Een hook-based versie laat een test
   `registerHook(...)` registreren en assertions doen op de payload.
4. **Custom adapters zonder framework-fork.** Een consumer die enkel
   CloudWatch / Honeybadger / New Relic wil draaien moet vandaag nog steeds
   accepteren dat het framework `setSentryUser` + `startSpan` aanroept en
   die forwards via `sentrySetup.ts` doen niets als er geen Sentry SDK
   geinitialiseerd is. Met hooks kan de consumer beslissen of identity +
   spans uberhaupt opgepakt worden.
5. **Documentatie-belofte.** `packages/error-tracking/docs/auto-instrumentation.md`
   (regels 144-176) noemt expliciet dat "future work may move the imperative
   `setSentryUser` / `startSpan` calls in `@luckystack/api` and
   `@luckystack/sync` behind hook subscriptions". Dit document werkt die
   belofte uit.

## Target State

Na de migratie:

- `@luckystack/api` en `@luckystack/sync` importeren NIETS meer uit
  `@luckystack/error-tracking`. Hun `package.json` `dependencies` verliezen
  de `@luckystack/error-tracking` entry.
- Beide handlers dispatchen ENKEL nog hooks (de bestaande hook-bus uit
  `packages/core/src/hooks/registry.ts`).
- `@luckystack/error-tracking` registreert zelf handlers op die hooks via
  een nieuwe export (`enableErrorTrackingAutoInstrumentation()` of
  als side-effect van `initializeSentry()`).
- Consumers die geen error-tracking gebruiken: hook-bus blijft leeg, geen
  performance impact.
- Consumers die enkel custom adapters gebruiken: `registerErrorTracker(...)`
  + `enableErrorTrackingAutoInstrumentation()` is voldoende, GEEN
  `initializeSentry()` nodig.
- Bestaande hooks (`preApiExecute`, `postApiExecute`, `apiError`, `syncError`,
  `postLogin`, `postLogout`) krijgen de identity + span verantwoordelijkheid.

### Consumer ervaring

```ts
// server/server.ts (project-level boot)
import { registerErrorTracker, createSentryAdapter, enableErrorTrackingAutoInstrumentation } from '@luckystack/error-tracking';

registerErrorTracker(createSentryAdapter());
enableErrorTrackingAutoInstrumentation();
// Of: initializeSentry() roept enableErrorTrackingAutoInstrumentation() intern aan.
```

Een project dat geen error-tracking wil installeert het package gewoon niet.
Geen import-spagaat in `@luckystack/api`/`@luckystack/sync`.

## Migration Steps

### Step 1: Verbreed hook-payloads voor identity + span context

`packages/core/src/hooks/types.ts` bevat al `PreApiExecutePayload`,
`PostApiExecutePayload`, `PreSyncFanoutPayload`, `PostSyncFanoutPayload`.
Identity (`user`) zit al in elk payload. Span timing moet eraan toegevoegd:

- Voeg een nieuwe optionele property `transport: 'socket' | 'http'` toe aan
  `PreApiExecutePayload` + `PostApiExecutePayload` zodat een
  span-handler kan onderscheiden of het `api.request` of `api.request.http`
  is.
- Voeg `transport` toe aan `PreSyncFanoutPayload`. De sync-handler heeft
  vandaag verschillende span-namen voor socket vs HTTP.
- Geen nieuwe top-level hooks nodig — `preApiExecute` / `postApiExecute`
  vormen al een natuurlijke `try / finally`-bracketing voor een span, en
  `setSentryUser` mapt op `postLogin` / `postLogout` plus per-request op
  `preApiExecute`.

### Step 2: Voeg `enableErrorTrackingAutoInstrumentation()` toe aan `@luckystack/error-tracking`

Nieuwe file: `packages/error-tracking/src/autoInstrumentation.ts`.

```ts
import { registerHook } from '@luckystack/core';
import { setSentryUser, startSpan } from './sentry';

let installed = false;
const activeSpans = new WeakMap<object, { end?: () => void }>();

export const enableErrorTrackingAutoInstrumentation = (): void => {
  if (installed) return;
  installed = true;

  // Per-request identity propagation.
  registerHook('preApiExecute', (payload) => {
    setSentryUser(payload.user?.id ? {
      id: payload.user.id,
      email: payload.user.email ?? undefined,
      username: payload.user.name ?? undefined,
    } : null);
    // Open span. We pinnen 'm op `payload` zodat postApiExecute 'm weer
    // kan ophalen zonder globale state.
    const op = payload.transport === 'http' ? 'api.request.http' : 'api.request';
    const span = startSpan(payload.routeName, op) as { end?: () => void } | undefined;
    if (span) activeSpans.set(payload, span);
    return undefined;
  });

  registerHook('postApiExecute', (payload) => {
    activeSpans.get(payload)?.end?.();
    return undefined;
  });

  // Sync identity + span.
  registerHook('preSyncAuthorize', (payload) => {
    setSentryUser(payload.user?.id ? {
      id: payload.user.id,
      email: payload.user.email ?? undefined,
      username: payload.user.name ?? undefined,
    } : null);
    return undefined;
  });

  registerHook('preSyncFanout', (payload) => {
    if (payload.transport !== 'http') return undefined;
    const span = startSpan(payload.routeName, 'sync.request.http') as { end?: () => void } | undefined;
    if (span) activeSpans.set(payload, span);
    return undefined;
  });

  registerHook('postSyncFanout', (payload) => {
    activeSpans.get(payload)?.end?.();
    return undefined;
  });

  // Logout-time identity clear (login zelf migreren in Step 4).
  registerHook('postLogout', () => {
    setSentryUser(null);
    return undefined;
  });
};
```

> Implementatie-detail: `WeakMap<object, span>` werkt alleen als de
> framework-handlers dezelfde payload-referentie doorgeven aan zowel
> `preApiExecute` als `postApiExecute`. Dat is vandaag al het geval in
> `packages/api/src/handleApiRequest.ts` (regels 535-564) en
> `packages/api/src/handleHttpApiRequest.ts` (regels 431-464) — beide
> bouwen het payload-object EEN keer en geven dezelfde reference door.
> Bevestig dit voor sync (regel 516 in `handleSyncRequest.ts`) tijdens
> implementatie.

Exporteer `enableErrorTrackingAutoInstrumentation` uit
`packages/error-tracking/src/index.ts`.

### Step 3: Trigger de auto-instrumentation vanuit `initializeSentry()`

`packages/error-tracking/src/sentry.ts` `initializeSentry()` roept aan het
einde van zijn body `enableErrorTrackingAutoInstrumentation()` aan. Dit
houdt de upgrade backwards-compatible: projecten die alleen
`initializeSentry()` aanroepen krijgen automatisch de hook-based wiring.

Voor de adapter-only flow (geen `initializeSentry()` aanroep) moet de
consumer expliciet `enableErrorTrackingAutoInstrumentation()` aanroepen na
`registerErrorTracker(...)`. Documenteer dit prominent in
`packages/error-tracking/docs/adapter-pattern.md`.

### Step 4: Verplaats `setSentryUser` uit `@luckystack/login`

`packages/login/src/login.ts` en `packages/login/src/logout.ts` dispatchen
al `postLogin` / `postLogout`. Geen code changes nodig — Step 2 hooked die
events al af. Optionele extra: verifieer dat `postLogin`-payload de user
shape die `setSentryUser` verwacht meegeeft (id, email).

### Step 5: Strip direct imports uit `@luckystack/api`

`packages/api/src/handleApiRequest.ts`:

- Verwijder regel 21: `import { setSentryUser, startSpan } from '@luckystack/error-tracking';`
- Verwijder regel 252: `const span = startSpan(name, 'api.request') ...`
- Verwijder regel 263: `span?.end?.();`
- Verwijder regels 402-405 (`setSentryUser(...)` call). Hook van Step 2
  pakt dit op via `preApiExecute`.
- Pas `executeApiHandler` aan zodat het GEEN span meer wraps — alleen
  `tryCatch`.
- Voeg `transport: 'socket'` toe aan beide `dispatchHook('preApiExecute', ...)`
  en `dispatchHook('postApiExecute', ...)` aanroepen.

`packages/api/src/handleHttpApiRequest.ts`:

- Verwijder regel 19 (`import ... from '@luckystack/error-tracking'`).
- Verwijder regels 186-189 (`setSentryUser`).
- Verwijder regels 444 + 455 (`startSpan` + `span?.end?.()`).
- Voeg `transport: 'http'` toe aan beide `dispatchHook('preApiExecute', ...)`
  en `dispatchHook('postApiExecute', ...)` aanroepen.

`packages/api/package.json`:

- Verwijder `"@luckystack/error-tracking": "^0.1.0"` uit `dependencies`.

### Step 6: Strip direct imports uit `@luckystack/sync`

`packages/sync/src/handleSyncRequest.ts`:

- Verwijder regel 25 (`import { setSentryUser } from '@luckystack/error-tracking';`).
- Verwijder regels 318-321 (`setSentryUser(...)` call).
- `preSyncAuthorize`-hook van Step 2 pakt identity propagation op. Bevestig
  dat `preSyncAuthorize` daadwerkelijk gedispatched wordt — de huidige code
  toont enkel `preSyncFanout` en `postSyncFanout` in greps. Mogelijk moet
  `preSyncAuthorize` toegevoegd worden aan de socket-sync handler (zie
  `packages/sync/docs/server-vs-client-handlers.md` regel 167 voor de
  beoogde positie).

`packages/sync/src/handleHttpSyncRequest.ts`:

- Verwijder regel 21 (import).
- Verwijder regels 214-217 (`setSentryUser`).
- Verwijder regel 218 (`startSpan`).
- Bewaar `span?.end?.()` referentie -> hook van Step 2 pakt span op via
  `preSyncFanout` + `postSyncFanout`.
- Voeg `transport: 'http'` toe aan de `dispatchHook('preSyncFanout', ...)` +
  `dispatchHook('postSyncFanout', ...)` aanroepen.

`packages/sync/package.json`:

- Verwijder `"@luckystack/error-tracking": "^0.1.0"` uit `dependencies`.

### Step 7: Verbreed `apiError` / `syncError` hook gebruik

`packages/server/src/httpRoutes/apiRoute.ts` (regel 93) en
`packages/server/src/httpRoutes/syncRoute.ts` (regel 128) dispatchen al
`apiError` / `syncError`. De auto-instrumentation in Step 2 kan een extra
handler registreren die deze hook payloads via `captureExceptionAcrossTrackers`
forwardt — handig voor consumer-side error monitoring zonder dat de
framework code expliciet `captureException` hoeft aan te roepen.

Optioneel; `tryCatch` (in `packages/core/src/tryCatch.ts` regel 11) roept
al `captureException` aan, dus dit is grotendeels redundant. Documenteer
het als extension point, niet als verplichting.

### Step 8: Update legacy helpers in `@luckystack/core/sentrySetup.ts`

Geen code wijziging nodig. `captureException` / `setSentryUser` / `startSpan`
in `packages/core/src/sentrySetup.ts` blijven leven voor:
- `tryCatch` in `packages/core/src/tryCatch.ts`
- `dispatchHook` zelf in `packages/core/src/hooks/registry.ts` (regels 47 + 95)
- legacy consumers die de helpers direct aanroepen

Markeer in de `//?` comments dat de framework-call-sites in `api` + `sync`
ze NIET meer aanroepen.

### Step 9: Update documentatie

Zie sectie "Documentation Updates Needed" hieronder.

### Step 10: Voeg een test toe in `@luckystack/error-tracking`

Een minimale jest/vitest test die:

1. `registerHook('preApiExecute', ...)` mockt
2. `enableErrorTrackingAutoInstrumentation()` aanroept
3. een dummy span-recorder registreert via `registerErrorTracker(...)`
4. verifieert dat `preApiExecute` + `postApiExecute` payloads de span open
   en sluiten

Past binnen het bestaande no-test-files-in-installer policy (uit
`.claude/CLAUDE.md` rule 7) want dit zit IN het package, niet in
`src/` van het installer-project.

## Files Affected

| File | Wijziging type | Impact |
| --- | --- | --- |
| `packages/error-tracking/src/autoInstrumentation.ts` | **NEW** | Centrale plek voor hook-registratie. ~80 regels. |
| `packages/error-tracking/src/index.ts` | Edit | Export `enableErrorTrackingAutoInstrumentation`. |
| `packages/error-tracking/src/sentry.ts` | Edit | Roep `enableErrorTrackingAutoInstrumentation()` aan binnen `initializeSentry()` na `initSharedSentry(...)`. |
| `packages/api/src/handleApiRequest.ts` | Edit | Verwijder error-tracking import (regel 21), `setSentryUser` call (regel 402), span wrap in `executeApiHandler` (regels 252 + 263). Voeg `transport: 'socket'` toe aan execute-hook payloads. |
| `packages/api/src/handleHttpApiRequest.ts` | Edit | Verwijder error-tracking import (regel 19), `setSentryUser` (regel 186), `startSpan` + `span?.end?.()` (regels 444, 455). Voeg `transport: 'http'` toe aan execute-hook payloads. |
| `packages/sync/src/handleSyncRequest.ts` | Edit | Verwijder error-tracking import (regel 25) + `setSentryUser` call (regel 318). Voeg `preSyncAuthorize`-dispatch toe als deze ontbreekt. |
| `packages/sync/src/handleHttpSyncRequest.ts` | Edit | Verwijder error-tracking import (regel 21), `setSentryUser` (regel 214), `startSpan` (regel 218). Voeg `transport: 'http'` toe aan fanout-hook payloads. |
| `packages/api/package.json` | Edit | Verwijder `@luckystack/error-tracking` uit `dependencies` (regel 58). |
| `packages/sync/package.json` | Edit | Verwijder `@luckystack/error-tracking` uit `dependencies` (regel 62). |
| `packages/core/src/hooks/types.ts` | Edit | Voeg optionele `transport?: 'socket' \| 'http'` toe aan `PreApiExecutePayload`, `PostApiExecutePayload`, `PreSyncAuthorizePayload`, `PreSyncFanoutPayload`, `PostSyncFanoutPayload`. |
| `packages/core/src/sentrySetup.ts` | Comment update only | Markeer dat framework call-sites in api/sync de legacy helpers NIET meer gebruiken. |

## Documentation Updates Needed

| Doc file | Wat moet bijgewerkt |
| --- | --- |
| `packages/error-tracking/docs/auto-instrumentation.md` | Sectie "Call site catalogue" (regels 44-176): herschrijf "API request handlers" + "Sync request handlers" zodat de wiring via hooks beschreven wordt ipv directe imports. Sectie "Hook bus" (regels 148-176) loopt over van "future work" naar "current implementation". Verwijder de placeholder paragraaf "Future work may move the imperative `setSentryUser` / `startSpan` calls..." |
| `packages/error-tracking/docs/auto-instrumentation.md` | Sectie "Cross-package signal flow summary" (regels 226-260): hertekening van het ASCII-diagram zodat de pijl van "setSentryUser (api)" en "startSpan (api / sync http)" loopt via "core hook bus" ipv directe import. |
| `packages/error-tracking/docs/auto-instrumentation.md` | Sectie "Migration notes" (regels 262-289): vervang door pointer naar dit document; haal de twee bullets weg die zeggen dat `initializeSentry()` moet blijven omdat api/sync nog direct importen. |
| `packages/error-tracking/docs/sentry-integration.md` | Sectie "Migration path: singleton -> registry" (regels 211-256), stap 5: "Remove the legacy entry": update zodat dit stap NU mogelijk is voor api/sync, en de overgebleven legacy call-sites enkel `tryCatch` + `dispatchHook` internals zijn. |
| `packages/error-tracking/docs/adapter-pattern.md` | Sectie "Why the registry lives in `@luckystack/core`" (regels 8-41): voeg toe dat na migratie de framework-deps op `@luckystack/error-tracking` voor `api` + `sync` weg zijn. Update de zin "Framework packages that only need to dispatch (never register) import directly from `@luckystack/core`" zodat het concreet wordt. |
| `packages/error-tracking/docs/span-helpers.md` | Bijwerken dat de framework-call-sites span-acquisitie via hook doen; `startSpan` blijft public API voor consumer code maar wordt niet meer aangeroepen door api/sync direct. |
| `packages/error-tracking/AI_INDEX.md` | "What this package does" (regel 7) + "Function Index": `initializeSentry()` regel: voeg toe dat het auto-instrumentation registreert. Voeg row toe voor `enableErrorTrackingAutoInstrumentation()`. |
| `packages/error-tracking/README.md` | Quickstart-voorbeeld: laat zien dat adapter-only path ook `enableErrorTrackingAutoInstrumentation()` moet aanroepen (of dat de adapter een convenience wrapper biedt). |
| `packages/api/docs/api-request-lifecycle.md` | Regel 27: stap 11 ("`executeApiHandler(...)` ... in a `startSpan(name, 'api.request')`") moet aangepast worden — span komt nu uit een hook subscriber van `@luckystack/error-tracking`, niet uit api-code zelf. |
| `packages/api/docs/auth-flow.md` | Regel 29 sectie "`setSentryUser(user)` (from `@luckystack/error-tracking`)": herschrijf dat identity-propagation via `preApiExecute` hook gebeurt, niet via directe call. |
| `packages/api/docs/error-handling.md` | Regel 135 sectie "`setSentryUser` + `startSpan` (from `@luckystack/error-tracking`)": verwijder of vervang door pointer naar de hook-based wiring. Regel 199 zin over auto-capture via `tryCatch` blijft correct. |
| `packages/api/AI_INDEX.md` | Regel 41 "Internal pipeline helpers" `executeApiHandler` row: verwijder "and a `startSpan` from `@luckystack/error-tracking`". Regel 79 "Required (runtime deps)": verwijder `@luckystack/error-tracking`. Sectie "Pipeline order" (regel 95) stap 2 "setSentryUser(...)" moet weg. |
| `packages/api/README.md` | Regel 8 + 96: verwijder `@luckystack/error-tracking` uit npm install lijst. |
| `packages/sync/AI_INDEX.md` | Regel 88 "Required" peer-deps: verwijder `@luckystack/error-tracking`. |
| `packages/sync/README.md` | Regel 8 + 146: verwijder `@luckystack/error-tracking` uit npm install lijst. |
| `packages/sync/docs/error-states.md` | Regel 185: zin over expliciet `captureException` aanroepen blijft correct (consumer-code use case). |
| `docs/ARCHITECTURE_EXTENSION_POINTS.md` | Voeg een rij toe onder `@luckystack/error-tracking` (nieuwe sectie als die ontbreekt): `enableErrorTrackingAutoInstrumentation()` registreert hook subscribers op `preApiExecute`, `postApiExecute`, `preSyncAuthorize`, `preSyncFanout`, `postSyncFanout`, `postLogout`. |
| `docs/ARCHITECTURE_API.md` | Sectie over request lifecycle: span/sentry-user staat nu in extension layer, niet in core api package. |
| `docs/ARCHITECTURE_SYNC.md` | Idem voor sync lifecycle. |
| `docs/ARCHITECTURE_PACKAGING.md` | Update dep-graph: pijl van `@luckystack/api` -> `@luckystack/error-tracking` en `@luckystack/sync` -> `@luckystack/error-tracking` weghalen. |
| `PROJECT_CONTEXT.md` | Snapshot section "Error tracking" updaten met hook-based wiring. |

## Hooks to Add (if any new)

Geen nieuwe top-level hooks. Wel een **payload-extensie** voor bestaande
hooks:

| Hook | Payload veld toegevoegd | Default als framework het niet zet |
| --- | --- | --- |
| `preApiExecute` | `transport: 'socket' \| 'http'` | Verplicht aanwezig na migratie (geen default). |
| `postApiExecute` | `transport: 'socket' \| 'http'` | Idem. |
| `preSyncAuthorize` | `transport: 'socket' \| 'http'` | Idem. |
| `preSyncFanout` | `transport: 'socket' \| 'http'` | Idem. |
| `postSyncFanout` | `transport: 'socket' \| 'http'` | Idem. |

Type-augmentatie gaat via `packages/core/src/hooks/types.ts` direct (core-owned
payloads). Geen module-augmentation file in `@luckystack/error-tracking`
nodig.

## Hooks to Repurpose

| Bestaande hook | Nieuw gebruik door `@luckystack/error-tracking` |
| --- | --- |
| `preApiExecute` | Open span + `setErrorTrackerUser(user)`. |
| `postApiExecute` | Sluit span. |
| `preSyncAuthorize` | `setErrorTrackerUser(user)` (sync identity). |
| `preSyncFanout` | Open span (HTTP transport only). |
| `postSyncFanout` | Sluit span (HTTP transport only). |
| `postLogout` | `setErrorTrackerUser(null)` (clear identity). |
| `apiError` | Optioneel: `captureExceptionAcrossTrackers(error, { route, user })`. Redundant met `tryCatch` maar handig voor consumers die `apiError` als enige observation-punt willen. |
| `syncError` | Idem. |

## Backwards Compatibility

### Wat blijft werken

- Bestaande consumer code die `setSentryUser(...)` / `startSpan(...)` /
  `captureException(...)` direct aanroept blijft ondersteund. Deze exports
  zijn public API van `@luckystack/error-tracking` en blijven leven.
- `initializeSentry()` blijft het primaire entry point. Het registreert nu
  ALLEEN auto-instrumentation EXTRA bovenop wat het al deed; bestaande
  installer-code (`server/server.ts`) verandert niet.
- `tryCatch` in `@luckystack/core` blijft `captureException` aanroepen —
  geen verandering voor consumer-code errors die door `tryCatch` lopen.
- `registerErrorTracker(...)` / `createSentryAdapter()` /
  `createDatadogAdapter(...)` / `createPostHogAdapter(...)` API blijft
  identiek.

### Breaking changes

- **Geen** breaking changes voor consumers. Wel een breaking change voor
  consumer-projecten die de framework dep-tree pinden op
  `@luckystack/error-tracking` via `@luckystack/api` / `@luckystack/sync`
  als transitive dep. Na de migratie moeten ze het package expliciet
  installeren als ze het willen gebruiken — wat de hele aanleiding van
  deze migratie is. Documenteer dit in CHANGELOG.

- Voor consumers met enkel `registerErrorTracker(...)` (geen
  `initializeSentry()`): VOOR migratie deed het framework toch
  `setSentryUser` / `startSpan` calls, maar die waren no-ops omdat de
  `sharedSentry` slot leeg was. NA migratie loopt het identical via
  `enableErrorTrackingAutoInstrumentation()`. Adapter-only consumers
  MOETEN deze functie expliciet aanroepen, anders krijgen ze geen
  identity/span signals. Documenteer prominent.

### Deprecation strategy

- Geen deprecated APIs. `setSentryUser` + `startSpan` blijven exporteren
  als public API voor consumer-code use cases (background jobs, custom
  transports).
- In `packages/error-tracking/AI_INDEX.md` "When to USE" sectie: vermeld dat
  direct `setSentryUser` / `startSpan` aanroepen vanuit
  application-code nog OK is voor edge cases zoals background jobs die
  buiten een API/sync handler draaien.

## Verification Checklist

- [ ] `packages/api/package.json` en `packages/sync/package.json` bevatten
      `@luckystack/error-tracking` niet meer onder `dependencies`.
- [ ] `grep -r "@luckystack/error-tracking" packages/api/src packages/sync/src`
      geeft 0 hits.
- [ ] `grep -r "setSentryUser\|startSpan" packages/api/src packages/sync/src`
      geeft 0 hits.
- [ ] `npm run build` slaagt voor `@luckystack/api`, `@luckystack/sync`,
      `@luckystack/error-tracking` (in die volgorde).
- [ ] `npm pack` van `@luckystack/api` produceert een tarball waarvan de
      `package.json` GEEN error-tracking dep heeft.
- [ ] Test-project: `npm install @luckystack/api @luckystack/sync` zonder
      `@luckystack/error-tracking` -> server start zonder errors. Geen
      identity-propagation, geen spans (verwacht gedrag).
- [ ] Test-project: `npm install ... @luckystack/error-tracking`, daarna
      `initializeSentry()` in boot. Dashboard-zicht laat zien dat identity +
      spans nog steeds doorkomen — gelijk aan pre-migratie gedrag.
- [ ] Adapter-only test: `registerErrorTracker(createDatadogAdapter({ tracer, statsd }))`
      + `enableErrorTrackingAutoInstrumentation()`, GEEN `initializeSentry()`.
      Verifieer dat `tracer.startSpan` aangeroepen wordt door de
      `preApiExecute` hook.
- [ ] Geen call-site in `@luckystack/api` of `@luckystack/sync` importeert
      uit `@luckystack/error-tracking` (verifieer via ESLint custom rule of
      pre-commit grep).
- [ ] `docs/ARCHITECTURE_EXTENSION_POINTS.md` weerspiegelt de nieuwe wiring.
- [ ] Alle docs in "Documentation Updates Needed" tabel zijn aangepast.
- [ ] `npx repomix` is gedraaid na doc-updates (per `.claude/CLAUDE.md` rule
      13).
- [ ] Geen `as any` / `as unknown` casts toegevoegd in de
      `autoInstrumentation.ts` implementatie (per rule 16).

## Risks & Mitigations

- **Risico:** `WeakMap`-pinning van span op payload-object werkt niet als
  framework-handler een nieuw object construeert tussen `preApiExecute`
  en `postApiExecute`.
  **Mitigatie:** Eerste step van implementatie is `console.assert(prePayload === postPayload)`
  in dev mode tijdens een testbuild. Als dit faalt, fallback op een
  request-scoped `Map<requestId, span>` met een nieuwe `requestId` veld in
  de payload.

- **Risico:** Hook handlers zijn `Promise<HookResult> | HookResult`
  (zie `packages/core/src/hooks/types.ts` regel 52). `dispatchHook` is
  `await`ed. Een synchroon span-acquire kan dus blokkeren als de tracker
  slow is.
  **Mitigatie:** `setErrorTrackerUser` + `startSpan` returnen al synchroon
  in de bestaande Sentry-adapter. Geen async werk in de auto-instrumentation.
  Voor adapter-implementaties die wel async willen zijn: documenteer dat
  de auto-instrumentation handlers fire-and-forget (`void`) zijn.

- **Risico:** Hook-fout in een auto-instrumentation handler crasht de
  request-flow.
  **Mitigatie:** `dispatchHook` (`packages/core/src/hooks/registry.ts`
  regels 41-50) vangt al per-handler exceptions op en logt ze. Geen extra
  bescherming nodig.

- **Risico:** Volgorde-afhankelijkheid van hook handlers. Een installer
  die `registerHook('preApiExecute', ...)` aanroept VOOR `initializeSentry()`
  krijgt zijn handler eerst — wat OK is, maar de installer rekent er
  misschien op dat sentry-user al gezet is.
  **Mitigatie:** Documenteer in `packages/error-tracking/docs/auto-instrumentation.md`
  dat `initializeSentry()` / `enableErrorTrackingAutoInstrumentation()`
  zo VROEG mogelijk in de boot-sequence aangeroepen moeten worden, voor
  installer-eigen `registerHook` calls.

- **Risico:** Bestaande `apiError` / `syncError` dispatch sites blijven
  redundant zodra `tryCatch` al `captureException` doet.
  **Mitigatie:** Geen actie. `apiError` / `syncError` zijn observation-only
  hooks die consumers ook voor audit-logs gebruiken. Niet aanraken.

- **Risico:** `@luckystack/login`'s `postLogin` payload-shape (zie
  `packages/login/src/login.ts` regels 240 + 578) bevat al `userId`, maar
  niet `email` of `name`. De `setSentryUser` call heeft die wel nodig.
  **Mitigatie:** Of `postLogin`-payload verrijken (breaking voor consumer
  hook handlers), of `setSentryUser` accepteert `{ id }` alleen — en laat
  email/name op een latere `preApiExecute` invullen wanneer
  `getSession(token)` ze terugleest. Kies optie 2 — geen breaking change.

- **Risico:** Service-side projecten die hun eigen Sentry-init doen
  (`Sentry.init(...)` direct, geen `initializeSentry()`) zien geen
  auto-instrumentation tenzij ze `enableErrorTrackingAutoInstrumentation()`
  expliciet aanroepen.
  **Mitigatie:** Documenteer prominent in `sentry-integration.md` en
  README. Eventueel: auto-detect via `getActiveErrorTrackers().length > 0`
  bij eerste `dispatchHook` — maar dat is magic en hard te debuggen.
  Prefereer explicit opt-in.

## Rollback Strategy

- Alle wijzigingen zijn isoleerbaar per package. Rollback gebeurt door:
  1. `git revert` van de migratie-commit(s).
  2. Re-installeer `@luckystack/error-tracking` als `dependencies` in
     `packages/api/package.json` + `packages/sync/package.json`.
  3. `npm install` in monorepo root om lockfile bij te werken.
- Geen Redis-state, geen database-migraties, geen wire-protocol
  veranderingen. Rollback is volledig source-code-only.
- `enableErrorTrackingAutoInstrumentation()` is een no-op als hij niet
  geregistreerd is — de nieuwe file kan blijven staan na rollback zonder
  effect, dus geen race tijdens partial rollback.
- Voor consumers die al migrated zijn en de hook-based wiring gebruiken:
  ze blijven werken na rollback omdat de oude direct imports gewoon weer
  IN de framework-pad zitten. Wel: hook subscribers van
  `enableErrorTrackingAutoInstrumentation()` registreren dubbele identity
  + dubbele spans. Documenteer in rollback-notes dat een consumer die op
  een rolled-back framework-versie gaat: ofwel `initializeSentry()`
  expliciet aanroepen (oude pad), ofwel de hook-registratie uitschakelen
  via een nieuwe `disableErrorTrackingAutoInstrumentation()` helper —
  alleen toevoegen als die concrete situatie zich voordoet.

## Related

- Huidige direct-import flow: `packages/error-tracking/docs/auto-instrumentation.md`.
- Adapter pattern + registry: `packages/error-tracking/docs/adapter-pattern.md`.
- Core hook-bus: `packages/core/src/hooks/registry.ts`, `packages/core/src/hooks/types.ts`.
- Existing migration notes: `packages/error-tracking/docs/sentry-integration.md` (sectie "Migration path: singleton -> registry").
- Framework call-site reference: `packages/api/src/handleApiRequest.ts`, `packages/api/src/handleHttpApiRequest.ts`, `packages/sync/src/handleSyncRequest.ts`, `packages/sync/src/handleHttpSyncRequest.ts`.
- Extension points overview: `docs/ARCHITECTURE_EXTENSION_POINTS.md`.
