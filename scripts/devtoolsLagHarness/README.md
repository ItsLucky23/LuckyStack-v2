# DevTools-lag harness

Dit harnas helpt debugger-overhead van applicatiewerk te onderscheiden. Een trage meting met DevTools open bewijst niet dat dezelfde vertraging buiten de debugger bestaat; zie `branch-logs/debug-devtools-lag.md` voor historische context.

## Gebruik

Gebruik een toegestane testomgeving en een eigen testaccount; zet inloggegevens niet in documentatie. Start een gezonde dev-stack en gebruik de werkelijk gemelde URL.

De meet- en analysecommando's staan in de scripts naast dit bestand. Controleer daar hun huidige argumenten voordat je een run start. Vraag toestemming voor browsergebruik en registreer langdurige processen volgens de lokale runtimepolicy.

## Meetgrens

De simulatie richt zich op async-tracking door de debugger, niet op alle effecten van de DevTools-interface. Combineer metingen daarom met een handmatige vergelijking van dezelfde pagina met DevTools open en gesloten. Noteer die beperking bij conclusies; verander niet meerdere variabelen tegelijk.
