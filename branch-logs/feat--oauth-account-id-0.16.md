# Branch log — feat/oauth-account-id-0.16

## 2026-10-20 15:20 — OAuth-accounts aan de vaste provider-ID, plus twee kleine fixes (0.16.0)

**User prompt (summary):** na 0.15 drie open punten. "1. c." — Microsoft-accountovername dichtzetten door accounts aan de vaste gebruikers-ID van de provider te koppelen; "2. jouw advies" — docs-ui-paneel en het nooit gekozen sync-sjabloon meenemen; "3. ja mag jij allemaal doen" — `npm ci`, build en `prisma generate` in de hoofdcheckout. Daarna: "microsoft oauth is nog nooit gebruikt dus geen legacy support bouwen", koppeling voor alle providers, uitbrengen zoals 0.15 (2 reviewrondes, publiceren zonder opnieuw te vragen).

**What I did:**
- OAuth-binding (ADR 0086; 0083 aangevuld): nullable `providerAccountId` op User, hoort bij de eigen `provider` van de rij. Opzoeken eerst op (provider, id); daarna op e-mail, waarbij een rij met een andere opgeslagen ID altijd geweigerd wordt en een ongekoppelde rij alleen bij een geverifieerd e-mailadres gekoppeld wordt; anders nieuw account met ID. Alle ingebouwde providers (Google `sub`, GitHub `id`, Discord `id`, Facebook `id`, Microsoft Graph `id`); eigen providers opt-in via `accountIdKey`. Opgeslagen e-mail wordt niet overschreven.
- Index niet-uniek bij Prisma/MikroORM (MongoDB weigert een tweede null in een unieke index), uniek bij de drizzle-starter (alleen SQL).
- Reviewronde 1 (12 punten): ID-vergelijking ook bij rijen zonder `provider` en bij niet-string-ID's; `preLogin` na het opzoeken met opgeslagen e-mail + `userId`; eigen weigerredenen (`oauth.accountIdMissing`, `oauth.accountBoundElsewhere`, `oauth.emailUnverified`); `providerAccountId` uit de browsersessie; upgradestappen (`create` én `update`, ook zonder auth), MySQL-varchar-noot, schema-hint bij `add login`, starters typechecken.
- Reviewronde 2 (2 punten): `preLogin` krijgt ook `providerEmail` (het actuele adres bij de provider); documentatie dat een nieuwe Facebook-app opnieuw koppelen vraagt (Facebook-ID's zijn per app).
- docs-ui: alleen de kopregel van een endpoint klapt het paneel in/uit, een klik in het tekstvak of een tekstselectie niet meer.
- devkit: het nooit gekozen `sync_client.template.ts` verwijderd (devkit, template, `server/dev/templates`); bestaande projecten krijgen via `update` een `.removed`-melding.
- Hoofdcheckout: `npm ci`, `build:packages`, `prisma generate` na 0.15.

**Files touched:** `packages/login/src/{login,userAdapter,oauthProviders,session,hookPayloads}.ts` + tests, `packages/login/{README.md,docs/*}`, `prisma/schema.prisma`, `config.ts`, `packages/create-luckystack-app/{src/index.ts,template/prisma/schema.prisma,template/config.ts}`, `packages/cli/src/commands/addLogin.ts`, `packages/docs-ui/src/docsHtml.ts`, `packages/devkit/src/templates/`, `server/dev/templates/`, `docs/decisions/0086-*.md` (+ aanvulling 0083), CHANGELOGs van login, cli, create-luckystack-app, devkit, docs-ui; 17 × `package.json`, `package-lock.json`.

**Notes / decisions:**
- Gevolg van de eigenaarsregels: Microsoft met `tenant: 'common'` (standaard) laat niemand binnen — nieuwe accounts én ongekoppelde rijen vragen een geverifieerd e-mailadres. Alleen een app aan één organisatie ondersteunt Microsoft echt. De opstartwaarschuwing zegt dat.
- Breaking voor projecten: nieuwe kolom + `prisma db push`/migratie; tot dan faalt OAuth-inloggen (wachtwoordlogin blijft werken). `preLogin.email` is bij een bestaand OAuth-account nu het opgeslagen adres.
- Agents gebruikten twee keer een script/heredoc i.p.v. Edit (inhoud nagekeken); `npx drizzle-kit` kwam eenmaal in de npx-cache (geen projectafhankelijkheid).
- Verificatie op de eindversie: zie het publicatie-item in `main.md`.
