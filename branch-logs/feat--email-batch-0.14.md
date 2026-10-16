# Branch log — feat/email-batch-0.14

## 2026-10-16 17:30 — Batchmail 0.14.0 plus twee reviewrondes

**User prompt (summary):** de vier batchpunten van Flexbuddy bouwen volgens mijn advies ("1. jouw advies"), daarna "voordat je pushed … met 2 opus 5.5 AIs een review ronde … dan fixed met 1 opus 5.5 agent en dit 2x", gericht op gaten en fouten in de recente versies; melden zodra 0.14 op npm staat.

**What I did:**
- `EmailResult`-fout kreeg optioneel `code`, `status`, `blocksSender`; Resend en SMTP vullen ze (Resend-quota en sleutelfouten, SMTP `EAUTH` blokkeren de verzender en zijn `not-sent`). `BatchItemResult` draagt `code`/`status`.
- Geblokkeerde verzender: de rest van dié verzender (per slot-object, niet per adapternaam) wordt `not-sent` / `sender-blocked` met de blokkerende code; andere verzenders gaan door; `rate_limit_exceeded` blokkeert niet.
- Tekstversie automatisch uit de HTML bij de tokenvorm zonder `text` (`htmlToText`, lineair, cellen met ` | `).
- Afgeleide sleutel uit batchsleutel + adres + inhoud (gerenderd onderwerp/HTML/tekst of sjabloon+data, afzender, kopieën, headers, bijlagen incl. `href`/`cid`/type), niet de positie. ADR 0070 vervangt 0069.
- Reviewronde 1 (2 reviewers, 1 fixer, 16 punten): SMTP-fouten niet meer per mail met adres naar de tracker; afbreken en geblokkeerde mails wachten geen tempo-slots meer uit; ontbrekende verplichte verzender = `not-sent`; Map/Set in sjabloondata; Resend-bijlagen `cid`/`href`/`Uint8Array`; `nodemailer`-peerbereik 6–10 (zelf getest met 6.10, 7.0 en 10.1 tegen een nagebootste SMTP-server); devkit haalt de lintkop uit geïnjecteerde routes; cli levert zijn CHANGELOG mee met de upgradestappen van vóór 0.12; `add login` noemt de twee vertaalsleutels; `remove login` geen valse waarschuwing meer.
- Reviewronde 2 (2 reviewers, 1 fixer, 13 punten): sleutelvelden aangevuld; `htmlToText` overal lineair en één keer decoderen; tempo-slots pas toegewezen als ze aan de beurt zijn; hookfouten in een batch gegroepeerd via een nieuwe optionele `onError` op core `dispatchHook`; trackeroorzaak is een nieuw, geschoond Error-object zonder providervelden; templates lint-schoon na injectie (`{}` toegestaan in `_api`/`_sync`, ook in de root-config); BOM; `luckystack config` voegt `resend`/`nodemailer` toe of haalt ze weg.

**Notes / decisions:**
- Ronde-1-fix voor de lintkop maakte nieuwe routes juist lint-rood; ronde 2 vond en herstelde dat. `{}` blijft in de templates omdat de devkit die letterlijke vorm herschrijft bij het koppelen van sync-bestanden; daarom een regeluitzondering in plaats van een ander type.
- Bewust gelaten (eerder besloten): dubbel tracker-event bij een gooiende adapter in een losse `sendEmail`; SMTP-tijdelijke fouten blijven `unknown`; afwijzing van alle ontvangers (`EENVELOPE`) blijft `unknown`.
- Niet gefixt, gemeld: `sync_client.template.ts` wordt door geen standaardregel gekozen.

**Verification:** `npm run verify` groen (**2350/2350**, 226 bestanden), root `npm run lint`, `lint:packages`, `ai:check-ids -- --backrefs` (98 records), `ai:changelog-check`, `ai:lint`, `audit:production` (0 high/critical). SMTP-grens met echte `nodemailer` 6/7/10. e2e-matrix en tarballproef: zie het publicatieverslag in `main.md`.

**Files touched:** `packages/email/src/{sendEmail,sendEmailBatch,htmlToText,renderTokens}.ts` + tests, `packages/email/src/adapters/{resend,smtp}.ts` + tests, `packages/core/src/{emailRegistry,hooks/registry,index}.ts`, `packages/devkit/src/{templateInjector.ts,templates/*}`, `packages/create-luckystack-app/{src/index.ts,template/eslint.official.config.js,template/_dot_luckystack/templates/*}`, `packages/cli/src/{commands/{upgrade,addLogin,remove}.ts,transitions.ts,featureOptions.ts}`, `eslint.official.config.js`, `docs/decisions/{0069,0070}-…md`, `packages/email/docs/batch.md`, CHANGELOGs (core, email, cli, devkit, create-luckystack-app), 17 × `package.json` (0.14.0), `package-lock.json`.

**Runtime / remaining:** branch-containers Mongo 27102 en Redis 6412 (`luckystack-v2-*-email-batch-014`) alleen voor de e2e-matrix; worden na publicatie opgeruimd.
