# Branch log — feat/email-batch

## 2026-10-15 15:10 — Batch-transactiemail met uitkomst per ontvanger (0.13.0)

**User prompt (summary):** opdracht van een andere AI: `@luckystack/email` krijgt `{{token}}`-sjablonen en batchversturen met een uitkomst per ontvanger, alleen transactiemail. Na mijn review: "alles volgens aanbeveling, met de twee afwijkingen (lege waarde = leeg, 429 = niet verstuurd)".

**What I did:**
- `renderTokens`: exacte sleutel, dan hoofdletterongevoelig; onbekende token blijft staan; `null`/`undefined` → leeg (afwijking van de gebruiker); HTML-escape of `none`; één doorgang, dus geen dubbele vervanging; alleen eigen sleutels (Flexbuddy's `in`-lookup gaf `{{constructor}}` de Object-functie).
- `sendEmailBatch`: twee vormen — gedeelde inhoud met tokens + ontvangers, of kant-en-klare berichten (ook geregistreerde sjablonen; het veld heet niet `template` omdat dat bij `sendEmail` een sjabloonnaam is). Elk bericht via `sendEmail` (hooks, CRLF, time-out, redactie per mail). Begrensd aantal tegelijk (2), optionele rem per seconde, stoppen via signal, max. 500 (instelbaar) → weigeren zonder versturen. Sleutel per bericht = sha256(batchsleutel:positie:adres); eigen sleutel per bericht wint. cc/bcc alleen op de eerste mail.
- Uitkomstregel: `sent` / `not-sent` / `unknown`; een fout zonder expliciete uitkomst = `unknown`. Daarom geven `sendEmail` (geen verzender, geen sjabloon, render mislukt, hook-veto) en de adapters (geen `from`) nu expliciet `not-sent`; Resend-429 (rate limit/quota) = `not-sent` (afwijking van de gebruiker), overige Resend-fouten blijven zonder uitkomst.
- ADR 0069; `packages/email/docs/batch.md` (rationale); één regel in het pakket-`AGENTS.md` (batch ja, marketing nee); changelog; alle pakketten 0.13.0.

**Notes / decisions:**
- De gevraagde "functie-index in CLAUDE.md van het pakket" niet gemaakt: de repo verbiedt een handmatige functie-index en het pakket heeft `AGENTS.md`. De te wijzigen regel "geen bulk" bestond niet; de keuze staat nu in ADR 0069.
- Een timingtest (rem per seconde) faalde één keer onder `verify`-belasting doordat hij gaten tussen buren mat; nu gemeten vanaf de batchstart (vertraging kan een start alleen later maken).
- Niet gedaan (bewust, buiten scope): SMTP-tijdelijke weigeringen als `not-sent` markeren, herhaalpogingen, wachtrij.

**Verification:** `npm run verify` groen (unit **2276/2276**), `lint:packages`, typecheck, `ai:changelog-check`, `ai:check-ids -- --backrefs` (97 records), `ai:lint`, `audit:production`. Nieuwe tests: 9 tokens, 16 batch, 2 Resend (429 / 5xx); 4 bestaande verwachtingen kregen het veld `deliveryOutcome`. Proef via het gebouwde pakket (`@luckystack/email` dist + `ConsoleSender`): tokens, escape, lege waarde, onbekende token en uitkomst per ontvanger zoals bedoeld.

**Files touched:** `packages/email/src/{renderTokens,sendEmailBatch}{,.test}.ts`, `packages/email/src/{index,sendEmail}.ts`, `packages/email/src/adapters/{resend,smtp}.ts`, `packages/email/src/{sendEmailOrchestration,sendEmailTemplateResolution}.test.ts`, `packages/email/src/adapters/resend.test.ts`, `packages/email/{AGENTS.md,CHANGELOG.md,docs/batch.md}`, `docs/decisions/0069-…md`, 17 × `package.json` (0.13.0), `package-lock.json`.

**Runtime / remaining:** branch-omgeving `https://feat-email-batch-luckystack-v2.keetlerop.nl` (frontend 5181, backend 4105, Mongo 27102, Redis 6412). Nog niet gepusht of gepubliceerd — wacht op akkoord.
