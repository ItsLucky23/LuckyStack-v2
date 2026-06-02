# Workspaces — Design-brief voor Claude Design

> **Doel van dit document:** een zelfstandige, uitvoerbare design-brief waarmee **Claude Design** de **complete Workspaces-omgeving** ontwerpt zoals die er **live** uit zou zien — met rijk gevulde voorbeelddata, elk scherm op **desktop én mobiel**, en menu's/popovers voor alles. De brief is gebouwd op de **bestaande LuckyStack `src/_components`** en theme-tokens (zodat de designs ook echt implementeerbaar zijn).
>
> **Visuele richting: vriendelijk & luchtig** — ruime witruimte, zachte ronde hoeken (rounded-xl/2xl), lichte borders, **light-first** met volwaardige dark-mode, mobiel-vriendelijk — maar wél een capabel power-tool (dicht waar het moet: bord, terminal, event-log).
>
> Context: Workspaces is een zelf-gehoste app die AI-gedreven development orkestreert. Volledige product-spec: `sparring/IDEE_SPEC.md` + `sparring/BESLISSINGEN.md`. Deze brief vertaalt dat naar UI.

---

## 1. Hoe je deze brief gebruikt met Claude Design

1. **Lees §2–§5 eerst** (product + foundations + componentbibliotheek). Dat is de gedeelde taal voor álle schermen.
2. **Genereer scherm-voor-scherm** (§6, schermen A→O). Geef per prompt: de design-foundations (§3) + het specifieke scherm-blok. Eén scherm per prompt geeft de beste resultaten.
3. **Gebruik overal dezelfde seed-data** (§8) zodat de schermen samen één consistente live-omgeving vormen (dezelfde tickets, mensen, terminals).
4. **Spiegel de bestaande componenten** (§4a) bij naam; ontwerp de gemarkeerde **nieuwe** primitives (§4b) in dezelfde tokens.
5. **Lever per scherm zowel desktop als mobiel.** Breakpoint-grens: `md` = 768px.
6. **Blijf in de tokens** (§3.1). Gebruik nooit willekeurige hex buiten de gedefinieerde palette.

> Aanbevolen generatie-volgorde: B (app-shell) → C (bord) → E (ticket-detail) → F (terminals) → H (pipeline-editor) → de rest. De app-shell zet het frame waar alle andere schermen in leven.

---

## 2. Het product in het kort (voor een designer)

**Workspaces** laat je AI-agents (Claude Code CLI) tickets door een configureerbare pipeline duwen — elk ticket in een eigen container met een live terminal die je vanaf je telefoon kunt bedienen. Je beheert het via één webapp: een scrumbord (view op GitLab), live terminals, een informatie-/skill-systeem, en een overkoepelende Workspace-AI die suggesties verzamelt.

**De toetssteen (laat elk scherm hieraan voldoen):** *op een zonnige dag op het water liggen, de telefoon pakken, een paar voice-berichten inspreken, wat tickets managen, kijken wat de Workspace-AI zei, de app sluiten — en op de achtergrond worden meerdere tickets professioneel verwerkt.* → **mobiel moet eersteklas zijn**, niet een bijzaak.

### Kernobjecten (het mentale model achter de UI)
| Object | Wat | UI-verschijning |
|---|---|---|
| **Workspace** | De tenant/omgeving (= je team/organisatie). Heeft leden, rollen, een GitLab-token. | Workspace-switcher linksboven; org-beheer-scherm (L). |
| **Project** | Een GitLab-repo/-groep binnen een workspace. | Project-selector; het bord toont één project. |
| **Ticket** | Werk-item (GitLab-issue), prefix `DEV-1234`. Zit in **één stage** met **één status**. | Kaart op het bord (C); detailscherm (E). |
| **Stage** | Pipeline-stap (Unrefined → … → Final). Per stage geconfigureerd (AI, bronnen, skills, commands, permissies). | Kolom op het bord (C); pipeline-editor (H). |
| **Status** | Toestand *binnen* een stage: *vraag voor gebruiker / busy / done*. | Status-pill op de kaart. |
| **Terminal** | Live interactieve terminal van het Claude-CLI-proces van een ticket. | Terminal-workspace (F); tab in ticket-detail (E). |
| **Bron (context-doc)** | Geladen documentatie: project-summary, conventies, glossary, db-schema, spec. | Bronnen-manager (I); per stage gekoppeld (H). |
| **Skill/MCP** | On-demand capaciteit: RAG-search, graph, git-history, test, … | Bronnen-manager (I); per stage aan/uit (H). |
| **Event** | Onveranderlijke log-regel per ticket (command/file/MR/AI-bericht). | Event-log/activity (M); tab in ticket-detail (E). |
| **Workspace-AI** | Overkoepelende AI: verzamelt signalen → suggesties/notities (voorstellen + accept). | Rechter context-paneel (J). |

---

## 3. Design-foundations

### 3.1 Palette (exacte tokens — gebruik deze namen en waarden)
Tailwind-utilities heten naar het token (bv. `bg-container1`, `text-title`, `text-primary`, `border-divider`). Dark-mode via `.dark` op `<html>`; tokens wisselen automatisch.

| Rol | Token | Light | Dark |
|---|---|---|---|
| Pagina-achtergrond | `background` | `#F5F5F5` | `#0B0F19` |
| Oppervlak 1 (cards/panelen) | `container1` | `#FFFFFF` | `#111827` |
| · hover / border | `container1-hover` / `container1-border` | subtiel donkerder / hairline | idem dark |
| Oppervlak 2 (inputs, sub-panelen) | `container2` | licht-grijs | `#1E293B`-achtig |
| · hover / border | `container2-hover` / `container2-border` | | |
| Titeltekst | `title` | `#1E1F21` | `#F1F5F9` |
| Bodytekst | `common` | gedempt-donker | gedempt-licht |
| Secundaire tekst | `muted` | grijs | grijs |
| Disabled tekst | `disabled` | lichtgrijs | donkergrijs |
| Accent primair | `primary` (+`-hover`,`-border`) | `#3B82F6` | `#3B82F6` |
| Accent secundair | `secondary` (+`-hover`,`-border`) | | |
| Tekst-op-accent | `title-primary` / `common-primary` (+ `-secondary`) | wit / lichtwit | |
| Succes | `correct` (+`-hover`) | groen | groen |
| Waarschuwing | `warning` (+`-hover`) | amber | amber |
| Fout | `wrong` (+`-hover`) | rood | rood |
| Overlay (achter modals) | `overlay` | zwart/40% | zwart/60% |
| Focus-ring | `focus-ring` | primary-tint | primary-tint |
| Divider (hairline) | `divider` | lichter dan border | |

**Statuskleuren (afgeleid van semantisch):** *vraag-voor-gebruiker* = `warning`, *busy* = `primary`, *done* = `correct`, *geen-AI/idle* = `muted`. Stage-accenten mogen een zachte getinte achtergrond gebruiken (bv. `primary/8` als wash).

### 3.2 Vorm & ritme (de "vriendelijk/luchtig"-richting)
- **Radius:** cards/panelen `rounded-2xl`, inputs/knoppen/pills `rounded-xl`/`rounded-full`. Zacht, nooit scherp.
- **Spacing:** royaal — `p-5`/`p-6` in panelen, `gap-3`/`gap-4` tussen items, secties met `gap-5`/`gap-6`. Lucht boven dichtheid, behalve in dichte zones (bord-kolom, terminal, event-log) waar je compacter mag (`gap-2`, `text-sm`).
- **Borders:** zacht en dun (`border-container1-border`, hairline `border-divider`). Liever scheiding door witruimte + lichte border dan zware lijnen.
- **Elevation:** licht en diffuus. Cards: vrijwel plat met een hele zachte shadow op hover. Popovers/menus: duidelijke maar zachte shadow + `rounded-2xl`. Geen harde slagschaduwen.
- **Density-uitzonderingen:** terminals = monospace, compact, donker (altijd dark-surface, ook in light-mode). Event-log = compacte tijdlijn. Bord-kaarten = compact maar met lucht.

### 3.3 Typografie
- **Tekst:** systeem-sans (Inter-achtig). Titels `font-semibold text-title`, body `text-common`, meta `text-muted text-xs`.
- **Schaal:** page-title `text-xl/2xl font-semibold`, sectie `text-base font-semibold`, body `text-sm`, meta `text-xs`.
- **Mono:** terminals, commands, code, ticket-prefixes (`DEV-1240`), commit-hashes, file-paths → monospace.
- Vriendelijke toon in microcopy (kort, mensgericht), i18n-baar (alle teksten zijn `useTranslator`-keys; in mockups tonen we Engelse voorbeeldcopy).

### 3.4 Iconografie & motion
- **Icons:** FontAwesome (solid). Lijn-stijl, consistent formaat. Voorbeelden: `faTerminal`, `faColumns`/`faTableColumns` (bord), `faListCheck` (backlog), `faDiagramProject` (pipeline), `faRobot` (Workspace-AI), `faKey` (SSH), `faUsers` (org), `faBookOpen` (bronnen), `faMicrophone` (voice), `faMagnifyingGlass` (search), `faCodeBranch` (git), `faGear` (settings).
- **Motion:** menu's/drawers schuiven in vanaf rechts in **200ms** (mirror de `menuHandler`-animatie); bottom-sheets schuiven omhoog; kaarten hebben subtiele hover-lift; status-pills pulseren zacht bij *busy*. Respecteer `prefers-reduced-motion` (geen transforms, alleen fade).

### 3.5 Responsive
- **Breakpoint:** `md` = 768px. Desktop = `md:` en hoger.
- **Desktop:** Navbar-rail links (folded 56px / expanded 256px), main-area, optioneel rechter context-paneel (Workspace-AI / ticket-detail).
- **Mobiel:** Navbar wordt een **drawer** (hamburger) + een **bottom tab-bar** voor de 4 kern-bestemmingen (Bord, Terminals, Activity, AI). Popovers worden **bottom-sheets**. De browser-achtige tab/session-bar wordt een horizontaal scrollbare strip of een "tabs"-overzicht-sheet.

---

## 4. Componentbibliotheek

### 4a. Bestaande `_components` om te SPIEGELEN (hergebruik bij naam)
Ontwerp deze consistent met hun echte API; ze bestaan al in de codebase.

| Component | Rol in de designs | Belangrijke props/gedrag |
|---|---|---|
| **`Avatar`** | Gebruiker overal (navbar, kaarten, leden, presence). Beeld met initialen-fallback. | `user`, `textSize` (bv. `text-2xl`). Rond. |
| **`Dropdown`** | Single-select pickers (status, assignee, project, taal). | `items: DropdownItem[]`, `size: sm\|md\|lg\|xl`, `showSearch`, controlled/uncontrolled, checkmark op geselecteerd. |
| **`MultiSelectDropdown`** | Multi-select (skills per stage, filters, labels). | Als Dropdown + checkboxes + "N selected"-trigger. |
| **`MenuHandler` / `useMenuHandler`** | **Alle** modals/drawers/sheets via een stack. Schuift in vanaf rechts (200ms), optioneel `dimBackground`. | `open(el, {size: sm\|md\|lg, dimBackground, background})`, `replace`, `close`, `closeAll`. Stack = genest. Enter submit / Esc sluit. |
| **`ConfirmMenu`** via `menuHandler.confirm()` | Bevestigingen (ticket verwijderen, container teardown, lid verwijderen). | `{ title, content?, input? }` → `Promise<boolean>`. `input` = typ-ter-bevestiging (bv. typ `DEV-1240`). |
| **`Navbar` + `NavbarItem`** | Linker rail (desktop) / drawer (mobiel). | `items: NavbarItem[]` met `icon` (FontAwesome), `label`, `path`, `action`, `bottom`, `hideOnFolded/Expanded`. Avatar bovenaan. Folded/expanded. |
| **`TemplateProvider`** | `'dashboard'` (Navbar + content) voor alle ingelogde schermen; `'plain'` voor auth. | Bepaalt chrome. |
| **`LoginForm`** | Auth-scherm (A). | `formType: 'login'\|'register'`, OAuth-provider-knoppen dynamisch. |
| **Patroon `Section`** | Gegroepeerde content (instellingen, panelen). | `bg-container1 border border-container1-border rounded-2xl p-5 flex flex-col gap-3`, kop `text-base font-semibold text-title`. |
| **Patroon input** | Tekstvelden. | `bg-container2 border border-container2-border rounded-xl h-9 px-3 text-sm focus:ring-2 focus:ring-focus-ring`. Label `text-xs font-medium`. |
| **Patroon knoppen** | Acties. | primair `bg-primary hover:bg-primary-hover text-title-primary rounded-xl`; secundair `bg-container2 hover:bg-container2-hover border border-container2-border text-title`; danger `bg-wrong hover:bg-wrong-hover text-title-primary`. |
| **Toasts (sonner)** via `i18nNotify` | Korte feedback (rechtsboven / mobiel bovenaan). | `success/error/info`. |

### 4b. NIEUW te ontwerpen primitives (niet-shipped; ontwerp in dezelfde tokens, markeer als "nieuw")
Het framework is bewust licht op form-/data-primitives. Ontwerp deze fris, luchtig, in de tokens:

- **Tabs / SegmentedControl** — ticket-detail-tabs, view-switchers. Onderlijn-stijl (tabs) en pill-stijl (segmented). Actief = `text-title` + `primary`-indicator.
- **Table / DataGrid** — backlog, leden-lijst, sessies. Zebra-vrij, hairline-rows (`divider`), sticky header, rij-hover `container1-hover`, compacte en comfortabele dichtheid.
- **Checkbox / Toggle / Radio** — stage-config, settings. Toggle = pill met `primary` wanneer aan.
- **Badge / StatusPill / Chip / Tag** — status (*busy/done/vraag*), stage-label, labels, AI-aan/uit. Pill = `rounded-full px-2 py-0.5 text-xs` met getinte semantische achtergrond.
- **Card** — kanban-ticket, suggestie, bron. `rounded-2xl bg-container1 border` met lucht.
- **Tooltip** — folded navbar, iconen, afgekorte tekst.
- **Drawer (rechts) & BottomSheet (mobiel)** — bouw bovenop het `menuHandler`-stack-model (zelfde slide-in). Sheets met grijp-handle bovenaan.
- **CommandPalette** (⌘K) — global search + quick-create (ticket, workspace, terminal). Modal met zoekveld + gegroepeerde resultaten + keyboard-nav.
- **KanbanColumn + KanbanCard** — bord. Kolom-kop met stage-naam + telling + "+", scrollbare kaartenlijst, drag-handle, drop-zones.
- **Terminal (xterm)** — donker surface (ook in light), monospace, prompt-regel, scrollback, statusbalk (proces, exit-code), resize-grip, SSH-unlock-overlay als niet ontgrendeld.
- **Code / diff-viewer** — file-references, MR-diffs. Regelnummers, syntax-tint, +/- in `correct`/`wrong`-wash.
- **DatePicker / sprint-picker** — sprint-toewijzing.
- **AvatarStack** — meerdere leden/viewers (presence) overlappend + "+N".
- **EmptyState** — vriendelijke illustratie/icoon + korte tekst + primaire actie (leeg bord, geen tickets, geen terminals).
- **Skeleton / Loader** — laad-states (bord-kolommen, lijst, terminal-connect).
- **ReferencePicker** — popover om files/tickets/bronnen te zoeken & linken (zie scherm G).
- **PresenceBar / SocketStatusIndicator** — verbindingsstatus + wie kijkt mee (spiegelt `useSocketStatus`).

---

## 5. Informatie-architectuur & navigatie

### 5.1 App-shell (desktop)
```
┌──────────────────────────────────────────────────────────────────────────────┐
│ TopBar:  [≡] [Workspace ▾ YouComm Core]  [Project ▾ youcomm-app]   ⌘K-search   ⋯  [presence] [Avatar] │
├───────┬───────────────────────────────────────────────────────────┬──────────┤
│       │ Tab/Session-bar:  [▦ Board] [DEV-1240 ●] [DEV-1245 ●] [DEV-1242 ●] [+] │ (browser-stijl)
│ Nav   ├───────────────────────────────────────────────────────────┤  Workspace│
│ rail  │                                                           │  -AI panel │
│ (rail │              MAIN CONTENT (het actieve tabblad)            │  (in/uit-  │
│  56 / │                                                           │  klapbaar) │
│  256) │                                                           │           │
│       │                                                           │  suggesties│
│       │                                                           │  + notities│
└───────┴───────────────────────────────────────────────────────────┴──────────┘
```
- **TopBar:** workspace-switcher (Dropdown), project-switcher (Dropdown), global search/⌘K, presence (AvatarStack), Avatar-menu.
- **Tab/Session-bar (browser-achtig):** vaste eerste tab **Board**; daarna een tab per geopende ticket/terminal-sessie met een live status-dot; `[+]` opent quick-open (ticket zoeken / nieuwe terminal). Tabs sluitbaar (×), herschikbaar (drag). Dit is het "tabsysteem zoals een browser" uit de spec.
- **Nav-rail (`Navbar`):** Workspaces-logo/avatar bovenaan; items: **Board** (`faTableColumns`), **Backlog** (`faListCheck`), **Terminals** (`faTerminal`), **Activity** (`faWaveSquare`), **Sources** (`faBookOpen`), **Pipeline** (`faDiagramProject`); onderaan **Workspace-AI** (`faRobot`), **Settings** (`faGear`), Avatar/Logout. Folded = iconen + tooltips.
- **Workspace-AI-paneel (rechts):** inklapbaar; toont openstaande suggesties/notities (J). Op smal scherm verborgen achter een knop.

### 5.2 App-shell (mobiel)
```
┌───────────────────────────────┐
│ ☰  YouComm Core ▾      🔍  👤 │  TopBar (compact)
├───────────────────────────────┤
│ ‹ Board · DEV-1240 · DEV-1245 ›│  Tab-strip (horizontaal scroll) + "tabs"-knop → sheet
├───────────────────────────────┤
│                               │
│        MAIN CONTENT           │
│                               │
├───────────────────────────────┤
│  ▦Board  �term  ~Activity  ✦AI │  Bottom tab-bar (4 kern-bestemmingen)
└───────────────────────────────┘
```
- Hamburger → Navbar-drawer (overige bestemmingen). Bottom tab-bar = Board / Terminals / Activity / Workspace-AI. FAB (drijvende `+`) voor quick-create + **voice** (lang-indrukken = opnemen).

### 5.3 Routes (file-based, ter referentie)
`/` board · `/backlog` · `/ticket/[id]` · `/terminals` · `/activity` · `/sources` · `/pipeline` · `/ai` (Workspace-AI) · `/settings/*` (account) · `/workspace/*` (org-beheer) · `/login`, `/invite/[token]` (plain template).

---

## 6. Scherm-voor-scherm specs

> Per scherm: **doel · desktop-layout · mobiel-layout · componenten (echt + nieuw) · states · interacties/popovers · seed-data**. Gebruik de seed-dataset uit §8 overal.

### A. Auth & onboarding — template `plain`
**Doel:** inloggen via OAuth; daarna verplicht een SSH-publieke sleutel koppelen (vereist om terminals te openen); invite accepteren.

**A1 — Login.** Gecentreerde kaart (`max-w-sm`), luchtig. Logo + "Welcome to Workspaces". **OAuth-knoppen** (GitLab primair, GitHub secundair) — spiegelt `LoginForm` met provider-knoppen. Kleine footer "Self-hosted · your code stays yours". *States:* idle / loading (knop "Connecting…"). 
- Desktop: gecentreerde kaart op `bg-background`. Mobiel: full-bleed, knoppen groot/duimvriendelijk.

**A2 — SSH-key koppelen (na eerste login).** Kaart "Link an SSH key to open terminals". Uitleg (vriendelijk, 2 zinnen): *je private sleutel blijft op je apparaat; we bewaren alleen de publieke helft, net als GitLab.* Veld voor publieke sleutel (plak `ssh-ed25519 …`) + "Verify"-stap (challenge). Lijst van gekoppelde sleutels (naam, type, toegevoegd-op, "laatst gebruikt", verwijderen). Badge "Terminal access: enabled/disabled". *States:* geen sleutel (waarschuwing-banner "Terminals locked"), verifiëren (spinner), gekoppeld (`correct`-badge).
- Popover: "Add key" sheet met textarea + naam.

**A3 — Invite accepteren** (`/invite/[token]`). Kaart "Sanne invited you to **YouComm Core** as **Admin**". Workspace-avatar + rol-badge. Knoppen Accept / Decline. Na accept → login/SSH-flow indien nog niet ingelogd.

**Seed:** je = Mathijs (mathijs@youcomm.nl), 1 gekoppelde key "MacBook Pro · ed25519", pending invite van Sanne voor "LuckyStack OSS" als Member.

---

### B. App-shell + tab/session-bar — template `dashboard` (het frame voor alles)
**Doel:** het permanente frame (§5.1/5.2): TopBar, Navbar, tab/session-bar, main, Workspace-AI-paneel.

**Componenten:** `Navbar`+`NavbarItem`, `Avatar`, `Dropdown` (workspace/project-switcher), nieuw: Tab/Session-bar, AvatarStack (presence), CommandPalette-trigger, Workspace-AI-paneel.

**Desktop:** zoals §5.1. **Tab/session-bar:** "Board"-tab altijd eerst; ticket/terminal-tabs met live status-dot (kleur = status), favicon-achtig stage-icoon, ×-sluit; `[+]` → quick-open-popover. Rechts een "Workspace-AI"-toggle (badge met aantal openstaande suggesties).

**Mobiel:** TopBar compact, tab-strip horizontaal scroll + "⊞ tabs"-knop → bottom-sheet met alle open sessies (lijst, sluitbaar). Bottom tab-bar (Board/Terminals/Activity/AI) + FAB (`+`/voice).

**States:** geen open tabs (alleen Board) · veel tabs (overflow-scroll + "tabs"-sheet) · workspace-switch (laad-skeleton).

**Interacties/popovers:**
- **Workspace-switcher** (Dropdown, `showSearch`): lijst workspaces met avatar + rol-badge + "Create workspace" + "Manage members" onderaan.
- **Project-switcher** (Dropdown): projecten binnen de workspace.
- **Avatar-menu** (menuHandler, size sm): Account, Theme (light/dark/system toggle), Language (Dropdown en/nl/de/fr), Sign out.
- **⌘K Command palette** (§O).
- **`[+]` quick-open** (popover): "Open ticket…" (zoek), "New terminal…", "New ticket".
- **Presence AvatarStack** hover → tooltip "Sanne, Tom viewing".

**Seed:** workspace "YouComm Core", project "youcomm-app", open tabs: Board, DEV-1240, DEV-1245, DEV-1242. Workspace-AI-badge = "2".

---

### C. Scrumbord — `/`
**Doel:** het bord als view op GitLab; kolommen = pipeline-stages, kaarten = tickets met status, drag-and-drop tussen stages.

**Componenten:** nieuw KanbanColumn/KanbanCard, StatusPill, Badge (stage/AI), AvatarStack, `Dropdown`/`MultiSelectDropdown` (filters), `MenuHandler` (kaart-context + ticket-quickview), EmptyState, Skeleton.

**Desktop-layout:**
```
TopBar / Tab-bar (B)
┌──────────────────────────────────────────────────────────────────────────────┐
│ Board · youcomm-app        [Sprint 24 ▾]  [Filter ▾] [Assignee ▾] [⌕]   [+ Ticket] │
├─────────┬─────────┬─────────┬───────────────┬───────┬────────┬──────────────────┤
│Unrefined│ Refined │  Plan   │ Implementatie │ Test  │ Review │      Final        │
│   (2)   │   (2)   │   (3)   │      (2)      │  (1)  │  (1)   │       (1)         │
│ ┌─────┐ │ ┌─────┐ │ ┌─────┐ │   ┌─────┐     │┌─────┐│ ┌────┐ │    ┌─────┐         │
│ │card │ │ │card │ │ │card │ │   │card●│     ││card●││ │card●│    │card✓│         │
│ └─────┘ │ └─────┘ │ └─────┘ │   └─────┘     │└─────┘│ └────┘ │    └─────┘         │
│  + new  │         │         │               │       │        │                   │
└─────────┴─────────┴─────────┴───────────────┴───────┴────────┴──────────────────┘
```
- Horizontale scroll bij veel kolommen. Kolom-kop: stage-naam, telling, "+", en een klein AI-icoon als de stage AI-enabled is. Stage zonder AI (Unrefined) = subtiel grijzer.
- **KanbanCard:** `DEV-1240` (mono, klein) · titel · StatusPill (busy=primary-puls / done=correct / vraag=warning) · stage-AI-avatar of "no AI" · labels (chips) · onderaan AvatarStack (viewers) + "live"-dot als er een terminal draait + mini-meta (laatste activiteit "2m"). Drag-handle bij hover.

**Mobiel-layout:** één kolom tegelijk met een **stage-segmented-control** bovenaan (swipe tussen stages), of een verticale "swimlane"-scroll. Kaart full-width. Drag via lang-indrukken → "move to stage"-sheet (Dropdown van stages). Bottom tab-bar actief op "Board".

**States:** leeg bord (EmptyState "No tickets yet — pull from GitLab") · laden (kolom-skeletons) · drag-over (drop-zone highlight `primary/10`) · WIP-limit overschreden (kolom-kop `warning`).

**Interacties/popovers:**
- **Kaart klik** → opent ticket als **tab** (E) of een **quickview-sheet** (menuHandler, size md): titel, status-switch (Dropdown), stage-move, "Open terminal", "Open in GitLab", assignee.
- **Kaart context-menu** (rechtsklik / ⋯): Move to stage ▸, Set status ▸, Open terminal, Link ticket…, Archive (confirm via `menuHandler.confirm`).
- **Filter** (MultiSelectDropdown): labels, assignee, status, "has running terminal".
- **Sprint** (Dropdown/DatePicker): Sprint 24, Backlog.
- **+ Ticket** (menuHandler size md): titel, beschrijving, stage (default Unrefined), labels → maakt GitLab-issue.

**Seed:** gebruik de 12 tickets uit §8, verdeeld over de 7 kolommen met de gegeven statuses. Toon DEV-1240/1245/1242 met live-terminal-dot.

---

### D. Backlog — `/backlog`
**Doel:** platte, doorzoekbare lijst van alle tickets met stage + status; bulk-acties; voor het grovere beheer dat een bord niet geeft.

**Componenten:** nieuw Table/DataGrid, StatusPill, Badge, `MultiSelectDropdown` (filters), Checkbox (bulk-select), `MenuHandler` (bulk-acties), Tabs (All / Mine / Unrefined).

**Desktop:** tabel met kolommen: ☑ · `DEV-####` · Titel · Stage (badge) · Status (pill) · Assignee-AI (avatar) · Labels · Sprint · Laatste activiteit. Sticky header, hairline-rows, rij-hover. Bovenaan: zoek + filters + "Selected (N): Move ▾ · Set status ▾ · Assign ▾ · Archive". Linker quick-filters (Tabs/segmented: All / Unrefined / Needs input / Done).

**Mobiel:** lijst van compacte rij-kaarten (titel + `DEV-####` + stage-badge + status-pill). Tik = ticket-detail. Filters in een bottom-sheet. Bulk-select via "Select"-modus (checkbox links verschijnt).

**States:** leeg, gefilterd-leeg, veel-rijen (virtual scroll), bulk-select actief (sticky actiebalk onderaan).

**Interacties/popovers:** rij-⋯ context-menu (zoals kaart C); bulk-actie-sheets; "Set status" Dropdown; archive = `menuHandler.confirm`.

**Seed:** alle 12 tickets als rijen; toon 2 "Needs input" (DEV-1241) gehighlight met `warning`-pill.

---

### E. Ticket-detail — `/ticket/[id]` (opent als tab)
**Doel:** alles van één ticket: overzicht, de live terminal(s), gelinkte files/refs, event-log, gelinkte tickets, stage-historie.

**Componenten:** nieuw Tabs, Terminal (embed), Code/diff-viewer, ReferencePicker, StatusPill, Badge, AvatarStack, `Dropdown` (status/stage/assignee), `MenuHandler`, Timeline (event-log).

**Desktop-layout:**
```
┌──────────────────────────────────────────────────────────────────────────────┐
│ DEV-1240 · Fix avatar fallback flicker on slow networks      [Status ▾ Busy] ⋯ │
│ Implementatie · Sprint 24 · labels: bug, frontend · 👁 Sanne,Tom · ● terminal  │
├───────────────────────────────────────────────────────────────────────────────┤
│ [Overview] [Terminal] [Files & refs] [Activity] [Links] [Stage history]        │  ← Tabs
├───────────────────────────────────────────────────────────────────────────────┤
│  (tab-content)                                                                  │
└───────────────────────────────────────────────────────────────────────────────┘
```
- **Overview-tab:** beschrijving (markdown), GitLab-meta (issue #, branch `DEV-1240`, MR-status), huidige stage-config-samenvatting (welke bronnen/skills actief), "carry-over" van de vorige stage (de geïnjecteerde prompt-samenvatting), assignee-AI.
- **Terminal-tab:** embedded Terminal (F-component) van dit ticket; als meerdere process-terminals (process-start §7.5), sub-tabs of split.
- **Files & refs-tab:** lijst gelinkte files (path, mono) + Code/diff-viewer-preview; "Add reference" → ReferencePicker (G).
- **Activity-tab:** de event-log-timeline van dit ticket (zie M), gefilterd op dit ticket; "rewind"-knop.
- **Links-tab:** gelinkte tickets (relatie-type) + "Link ticket…" (ReferencePicker op tickets); toont AI-gesuggereerde links (bv. DEV-1241↔DEV-1249).
- **Stage history-tab:** tijdlijn van stages die het ticket doorliep, met per stage de output-samenvatting.

**Rechterkolom (desktop, optioneel):** snelle acties — Move stage (Dropdown), Set status, Open in GitLab, Open terminal in new tab, Teardown container (`menuHandler.confirm` met `input: DEV-1240`).

**Mobiel:** koptekst compact; Tabs worden een horizontaal-scroll segmented-control; terminal full-screen met een "back"-chip; acties in een ⋯-bottom-sheet.

**States:** geen terminal actief ("Start a terminal" EmptyState) · busy (live stream) · vraag-voor-gebruiker (gele banner "AI is waiting for your input" + quick-reply-veld) · done (groene banner + "Promote to next stage").

**Interacties/popovers:** status-Dropdown, stage-move, "Promote to next stage" (toont welke carry-over wordt meegestuurd, confirm), teardown-confirm, reference-picker.

**Seed:** DEV-1240, stage Implementatie, status Busy, branch `DEV-1240`, 1 draaiende terminal, 3 gelinkte files, event-log met ~8 regels, AI-gesuggereerde link naar DEV-1245 (beide raken Avatar/frontend).

---

### F. Terminal-workspace — `/terminals`
**Doel:** meerdere live terminal-instances tegelijk (het kernfeature). Bekijken/bedienen vanaf desktop én telefoon.

**Componenten:** nieuw Terminal (xterm), Tabs/Split-layout, StatusPill (proces), SSH-unlock-overlay, PresenceBar, `MenuHandler`.

**Desktop-layout (rijk gevuld — toon meerdere instances):**
```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Terminals   [▣ grid] [▭ tabs] [⬓ split]                         3 active   [+]  │
├───────────────────────────────┬───────────────────────────────────────────────┤
│ DEV-1240 · Implementatie  ●busy│ DEV-1245 · Implementatie · dev-server  ●busy   │
│ ┌───────────────────────────┐ │ ┌───────────────────────────────────────────┐ │
│ │ claude > editing Avatar.tsx│ │ │ ▲ vite ready on :5173  ·  HMR connected    │ │
│ │ ● Running tests…           │ │ │ claude > wiring dnd-kit columns…           │ │
│ │ █                          │ │ │ █                                          │ │
│ └───────────────────────────┘ │ └───────────────────────────────────────────┘ │
│ exit: —  · cwd: /app          │ tabs: [server] [client] [claude]              │
├───────────────────────────────┴───────────────────────────────────────────────┤
│ DEV-1242 · Review  ●busy   (collapsed strip — click to expand)                 │
└────────────────────────────────────────────────────────────────────────────────┘
```
- **Terminal-component:** donker surface (altijd), monospace, prompt, live-cursor, scrollback. Boven: ticket + stage + proces-naam + StatusPill (busy/exit-code). Onder: cwd, exit, resize-grip. Een ticket met process-start-config (§7.5) toont **sub-tabs per terminal** (bv. `server`, `client`, `claude`).
- **Layouts:** grid (meerdere naast elkaar), tabs (één groot + tabstrip), split (2 naast elkaar). "+" = open terminal voor een ticket (zoek-popover).
- **SSH-unlock-overlay:** als de gebruiker z'n SSH-key nog niet voor deze sessie heeft ontgrendeld → overlay "Unlock terminals with your SSH key" + "Unlock" (challenge). Daarna live.

**Mobiel:** één terminal full-screen, swipe/segmented tussen actieve terminals; onderin een input-balk + "send"-knop + speciale toetsen (Tab, Ctrl, ↑↓, Esc) als chips; "⌨"-toggle voor toetsenbord. Bovenin het ticket + status. Lang-indrukken op een regel = kopiëren.

**States:** connecting (skeleton + "Attaching to dev-1240…") · live · disconnected (auto-reconnect-indicator, "Reattaching…") · exited (exit-code badge) · locked (SSH-overlay) · geen terminals (EmptyState "No terminals running — open one from a ticket").

**Interacties/popovers:** terminal-⋯ (Restart, Kill (confirm), Pop out to tab, Copy buffer, Clear), layout-switcher, "+ open terminal" (ticket-zoek).

**Seed:** 3 terminals (DEV-1240 claude+tests, DEV-1245 met server/client/claude sub-tabs, DEV-1242 review). Eén toont een live "AI is waiting for input"-prompt.

---

### G. Tabs voor links + file-references (ReferencePicker)
**Doel:** binnen een ticket/sessie snel **links leggen** (naar andere tickets, MR's, bronnen) en **files referencen** — het "tabjes voor links te leggen, files te references" uit de wens.

**Componenten:** nieuw ReferencePicker (popover/sheet), Tabs (binnen de picker: Files / Tickets / MRs / Sources), Code-viewer-preview, Chip (gelegde refs), `MenuHandler`.

**Desktop:** ReferencePicker = een `menuHandler`-popover (size md) met bovenin een zoekveld + Tabs (Files · Tickets · MRs · Sources). 
- **Files-tab:** boomstructuur / fuzzy-zoek van de worktree-files (bevroren op commit-hash); selecteer → preview (Code-viewer, read-only) → "Reference" voegt 'm als chip toe aan het ticket.
- **Tickets-tab:** zoek tickets → kies relatie-type (relates to / blocks / duplicates) → link.
- **MRs / Sources:** idem voor merge-requests en informatiebronnen.
Gelegde refs verschijnen als **chips** in de "Files & refs"- en "Links"-tabs van het ticket (E), klikbaar.

**Mobiel:** ReferencePicker = bottom-sheet, full-height, zelfde Tabs; file-preview opent een sub-sheet.

**States:** zoekt (skeleton) · geen resultaten (EmptyState) · reeds-gelinkt (chip met ✓) · grote repo (virtual list).

**Seed:** DEV-1240 heeft refs: `src/_components/Avatar.tsx`, `src/_components/AvatarProvider` (source), en een link "relates to DEV-1245".

---

### H. Stage/pipeline-editor — `/pipeline`
**Doel:** de configureerbare pipeline bouwen/bewerken; per stage álles instellen (de rijkste config-UI van de app).

**Componenten:** nieuw stage-flow-editor (horizontale stage-chips/kolommen, herschikbaar), Toggle, `MultiSelectDropdown` (skills/bronnen), Checkbox, Badge, Tabs (per stage-config-categorie), `MenuHandler` (stage-config-drawer), Code/textarea (instructies, prompt-injectie).

**Desktop-layout:**
```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Pipeline · youcomm-app                       [+ Stage]   [Validate with AI ▸]   │
├──────────────────────────────────────────────────────────────────────────────┤
│  ① Unrefined → ② Refined → ③ Plan → ④ Implementatie → ⑤ Test → ⑥ Review → ⑦ Final│ ← stage-flow (drag te herschikken)
│   (no AI)      (AI)         (AI)      (AI)              (AI)     (AI)     (AI)    │
├──────────────────────────────────────────────────────────────────────────────┤
│  Geselecteerde stage:  ③ Plan                                          [Delete] │
│  ┌──────────────────────────────────────────────────────────────────────────┐ │
│  │ [General] [Context & skills] [Commands] [Tool access] [Visibility] [Process]│ │ ← config-tabs
│  │                                                                            │ │
│  │  General: ☑ AI enabled  · Custom instructions (textarea) · Statuses chips  │ │
│  │  Context & skills: 📄 docs (MultiSelect) · 🔧 skills/MCP (toggles list)     │ │
│  │  Commands: whitelisted shell commands (list + add) · accept-flow note      │ │
│  │  Tool access: Mongo [ro|rw] · Redis [ro|rw] (per-tier toggles)             │ │
│  │  Visibility: "Visible to stages" (MultiSelect)                             │ │
│  │  Process: ordered terminals × commands (T1: cmd,cmd · T2: cmd)             │ │
│  │  Prompt-injection: carry-over template (textarea) + preview                │ │
│  └──────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
```
- **Stage-flow** bovenaan: chips/mini-kolommen, drag te herschikken, AI-badge per stage, "+"-tussenvoegen. Klik = selecteer → config eronder (of in een rechter-drawer).
- **Config-tabs per stage:**
  - **General:** AI-Toggle, custom instructions (textarea), status-chips bewerken (vraag/busy/done + eigen).
  - **Context & skills:** 📄 **context-docs** (MultiSelectDropdown: project-summary, conventions, glossary, db-schema, spec) · 🔧 **skills/MCP** (lijst met toggles: RAG semantic_search, graphify impact_of, symbol lookup, route-index, git history, test runner, deps audit, cross-ticket). Elk met een mini-status (frozen-per-commit / live).
  - **Commands:** whitelisted shell-commands (lijst + add), met de notitie "still gated by .claude accept-flow".
  - **Tool access:** per tool (Mongo, Redis, +custom) een tier-keuze (read-only / read-write) via segmented control. Waarschuwing bij rw op gevoelige stages.
  - **Visibility:** "Visible to stages" (MultiSelect) — bron-stage bepaalt eigen zichtbaarheid.
  - **Process:** geordende terminals × commands (rijen toevoegen; T1: `npm run server`, T2: `npm run client`).
  - **Prompt-injection:** carry-over-template (textarea met variabelen `{{summary}}`, `{{changedFiles}}`, `{{commitHash}}`) + live preview.
- **"Validate with AI"**: roept de Workspace-AI-config-review aan → toont bevindingen (bv. "Refined loads full RAG but Plan only summary — likely swapped") inline als waarschuwingsbanners op de betrokken stages.

**Mobiel:** stage-flow = verticale lijst; tik stage → config-tabs als full-screen met segmented-control; textarea's full-width.

**States:** nieuwe lege pipeline (EmptyState + "Add first stage") · ongeldige config (AI-waarschuwingen) · stage zonder AI (config-tabs grijzen uit behalve General/Process/Visibility).

**Interacties/popovers:** add-stage-sheet, delete-stage (confirm), reorder (drag), skill-detail-popover (wat doet deze MCP), tier-change-confirm bij rw.

**Seed:** de 7-stage-pipeline; stage Plan geselecteerd met RAG+graph-skills aan, db-schema-doc aan, Mongo ro, visible to Implementatie/Test/Review.

---

### I. Informatiebronnen & lagen-manager — `/sources`
**Doel:** de context-docs + skills/MCP beheren (het herontworpen lagensysteem); status van RAG/graph-index; reindex.

**Componenten:** nieuw split-list (📄 Context-docs | 🔧 Skills/MCP), Card, Badge (frozen/live, index-status), Toggle, `MenuHandler`, progress (reindex), Code-viewer (preview doc).

**Desktop:** twee secties (Tabs of naast elkaar):
- **📄 Context-docs:** kaarten voor project-summary, conventions, glossary, db-schema, uploaded specs. Per kaart: bron (file in git / generated), laatst bijgewerkt, "frozen @ commit abc123", acties (preview, regenerate via Claude-CLI, upload nieuwe spec).
- **🔧 Skills/MCP:** kaarten voor RAG (semantic_search), code-graph (graphify), symbol-index, route-index, git-history, test-runner, deps-audit, cross-ticket. Per kaart: type (frozen-store / live), index-status (RAG: "12.4k chunks @ commit abc123 · healthy"), embedding-model (self-hosted nomic), "Reindex"-knop + progress, aan/uit per project.
- Bovenin: index-gezondheid-banner (alle bevroren stores up-to-date / merge-queue bezig).

**Mobiel:** één lijst, gesegmenteerd (Docs / Skills); kaart-detail in sheet.

**States:** indexeren (progress + "indexing delta for commit def456…") · stale (warning "RAG behind main by 3 commits") · error (re-index failed) · geen Atlas (info "vector search needs Atlas Local").

**Interacties/popovers:** reindex-confirm, doc-preview, upload-spec-sheet, skill-detail (beschrijving + welke stages het gebruiken).

**Seed:** RAG "12.4k chunks @ abc123 · healthy", graph "graphify · 1.8k nodes", db-schema-doc "generated 2h ago", 1 uploaded spec "Auth redesign.md".

---

### J. Workspace-AI-paneel — `/ai` (+ rechter context-paneel overal)
**Doel:** de overkoepelende AI tonen: verzamelde suggesties/notities (voorstellen + accept), config-review, bron-onderhoud-bewaking.

**Componenten:** nieuw Card (suggestie/notitie), Badge (type/severity), `Avatar` (`faRobot`-bot-avatar), accept/dismiss-knoppen, Tabs (Suggestions / Notes / Config review / Watch), Timeline, `MenuHandler`.

**Desktop:** als **rechter context-paneel** (inklapbaar, §5.1) én als volledig scherm `/ai`.
- **Suggestions-tab:** kaarten, elk: bot-avatar, korte titel, uitleg, betrokken tickets (chips), en **Accept / Dismiss / Snooze**. Bv. *"DEV-1241 (Microsoft SSO) en DEV-1249 (GitLab-token vault) overlappen — maak een gedeeld 'secrets'-epic?"* met Accept → maakt het epic + linkt de tickets.
- **Notes-tab:** vrije observaties die de AI bewaarde (read-only, archiveerbaar).
- **Config review-tab:** bevindingen over de pipeline-config (bv. *"Stage 'Refined' laadt volle RAG, 'Plan' alleen project-summary — waarschijnlijk omgedraaid"*) met "Go to pipeline"-knop → opent H gehighlight.
- **Watch-tab:** bron-onderhoud — waarschuwt als dynamische bronnen na merge niet zijn bijgewerkt (bv. "RAG behind main by 3 commits since DEV-1246 merged").

**Mobiel:** bottom tab-bar "AI"-bestemming → full-screen lijst; suggestie-kaart met grote Accept/Dismiss; bij terugkomst toont een badge "2 suggestions, 1 note" (de "kijken wat de Workspace-AI zei"-flow uit de toetssteen).

**States:** leeg ("All caught up ✨") · nieuwe suggesties (badge-count, lichte highlight) · AI denkt (subtiele "thinking"-indicator) · accept-in-uitvoering.

**Interacties/popovers:** Accept (kan een confirm/preview tonen van wat het doet), Dismiss (met optionele reden), Snooze (Dropdown: 1u/morgen), suggestie-detail-sheet.

**Seed:** 2 suggesties (de SSO↔vault-overlap; en "DEV-1248 flaky test lijkt op een eerder opgelost issue") + 1 config-review-bevinding + 1 watch-waarschuwing.

---

### K. Account-management — `/settings`
**Doel:** persoonlijke instellingen (los van workspace): profiel, OAuth-connecties, SSH-keys, thema/taal, actieve sessies.

**Componenten:** `Section`-patroon, `Avatar`, input-patroon, `Dropdown` (taal/thema), Toggle, nieuw Table (sessies), Badge, `menuHandler.confirm` (revoke/delete).

**Desktop:** `max-w-2xl mx-auto p-6 flex flex-col gap-5` met Sections:
- **Profile:** avatar (upload), naam, e-mail (read-only van OAuth), thema (light/dark/system segmented), taal (Dropdown en/nl/de/fr).
- **Connections:** gekoppelde OAuth-providers (GitLab ✓ primary, GitHub) met "Connect/Disconnect".
- **SSH keys:** lijst (naam, type, fingerprint, added, last-used, "Terminal access"-badge) + "Add key" (sheet, zoals A2) + verwijderen (confirm).
- **Sessions:** Table van actieve sessies (device, locatie, laatst actief, "this device"-badge) + "Revoke" + "Revoke all others".
- **Danger:** "Delete account" (confirm met `input`).

**Mobiel:** Sections gestapeld, full-width; Tables → rij-kaarten; pickers → bottom-sheets.

**States:** opslaan (knop "Saving…") · geen SSH-key (warning-banner "Terminals locked — add a key") · success-toast.

**Seed:** Mathijs, GitLab connected, 1 SSH-key, 2 sessies (MacBook = this device, iPhone).

---

### L. Organisatie/workspace-beheer — `/workspace`
**Doel:** de tenant beheren: leden + e-mail-invites + rollen (Owner/Admin/Member), GitLab-token, project-koppelingen, danger-zone. Rol-afhankelijk (Owner ziet alles).

**Componenten:** Tabs (Members / Invites / Integrations / Projects / Billing / Danger), nieuw Table (leden), `Dropdown` (rol), AvatarStack, Badge (rol), input (token, masked), `MenuHandler` (invite-modal, role-change-confirm, remove-confirm).

**Desktop:**
- **Members-tab:** Table — Avatar+naam · e-mail · rol (Dropdown: Owner/Admin/Member, alleen door Owner/Admin wijzigbaar) · laatst actief · ⋯ (Remove → confirm). Bovenaan "Invite members".
- **Invites-tab:** pending invites (e-mail, rol, verzonden, "Resend"/"Revoke"). "Invite" → **modal** (menuHandler size md): e-mailadres(sen) + rol (Dropdown) → verstuurt via `@luckystack/email`.
- **Integrations-tab:** **GitLab-token** voor deze workspace (masked input + "Update", test-knop "Verify connection" → ✓/✗ badge), GitLab base-URL, webhook-status.
- **Projects-tab:** gekoppelde GitLab-projecten (add/remove), default-pipeline per project.
- **Billing-tab:** placeholder (plan, usage) — laag-prio, simpel.
- **Danger-tab:** rename workspace, transfer ownership, delete workspace (confirm met `input: workspace-naam`).

**Mobiel:** Tabs → segmented/scroll; member-Table → rij-kaarten; invite → bottom-sheet.

**States:** alleen-Member (read-only, geen rol-edit/token), pending-invite-highlight, token-niet-gezet (warning "Board can't sync — add a GitLab token"), verify-loading.

**Interacties/popovers:** invite-modal, role-change-confirm ("Make Tom an Admin?"), remove-member-confirm, token-update, transfer-ownership (zware confirm met `input`).

**Seed:** workspace "YouComm Core" — Owner: Mathijs; Admin: Sanne; Members: Tom, Lina, Daan; pending invite: joost@youcomm.nl (Member). GitLab-token gezet ✓, project youcomm-app gekoppeld.

---

### M. Event-log / Activity — `/activity`
**Doel:** de live + persistente event-stream (audit) over alle tickets; per ticket "terugspoelen" (rewind).

**Componenten:** nieuw Timeline (compacte event-rijen), Badge (event-type), `Avatar` (actor: mens of bot), `MultiSelectDropdown` (filter), Tabs (Live / Ticket / Audit), nieuw rewind-scrubber, Code/diff-viewer (file-change-events).

**Desktop:**
```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Activity        [All tickets ▾] [Event type ▾] [Live ●]                ⟲ Rewind │
├──────────────────────────────────────────────────────────────────────────────┤
│ 14:32  🤖 DEV-1240  command   `npm test`  → 2 failing                           │
│ 14:31  🤖 DEV-1240  file      edited src/_components/Avatar.tsx (+12 −4)         │
│ 14:30  🤖 DEV-1245  message   "Wiring dnd-kit columns; need a Column type…"      │
│ 14:29  👤 Sanne     status    DEV-1241 → needs input                            │
│ 14:27  🔀 DEV-1246  mr        merged !88 into main (abc123)                      │
│ …                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```
- Compacte rijen: tijd · actor-avatar (🤖 AI of 👤 mens) · ticket-chip · event-type-badge · samenvatting. Klik op een file/command-event → expand (diff/output in Code-viewer).
- **Live-tab:** auto-scroll stream (sockets), "● Live" pulst; pauze-knop. Reconnect-indicator wanneer de socket even wegviel (mobiel) + "caught up"-toast na catch-up.
- **Rewind:** scrubber/tijdlijn per ticket — sleep terug om de staat op moment T te zien (de gecoalesceerde events stap-voor-stap).
- **Audit-tab:** doorzoekbaar, gefilterd, exporteerbaar.

**Mobiel:** full-screen stream, filters in sheet, tik-event = detail-sheet; "Activity" in de bottom tab-bar. Reconnect-/catch-up-indicator prominent (mobiel valt weg).

**States:** live-stream · gepauzeerd · reconnecting (banner "Reconnecting… will catch up") · rewind-modus (tijdlijn actief, "Live"-knop om terug te keren) · leeg.

**Seed:** ~10 events zoals hierboven, mix van DEV-1240/1245/1241/1246, AI + mens.

---

### N. Voice-input — mobiele capture (lage prio, wel ontwerpen)
**Doel:** vanaf de telefoon een spraakbericht inspreken → ticket aanmaken/managen of een prompt naar een AI sturen.

**Componenten:** nieuw VoiceCapture-bottom-sheet (golfvorm/waveform, timer, opnemen/stop), transcript-preview, target-keuze (Dropdown), `MenuHandler`.

**Mobiel (primair):** FAB lang-indrukken (of mic-knop in TopBar) → bottom-sheet: grote opname-knop met live waveform + timer; na stop → transcript-preview (bewerkbaar) + "Send to": *Create ticket* / *Reply to DEV-1240's AI* / *Workspace-AI* (Dropdown). Verzenden → toast.
**Desktop:** kleinere mic-popover (zelfde flow).

**States:** idle (mic) · recording (waveform + timer + stop) · transcribing (spinner "Transcribing…") · transcript-review (bewerkbaar) · sending · error (mic-permissie / STT-fout).

**Seed:** opname → transcript "Create a ticket: the avatar still flickers on 3G, similar to twelve-forty" → target "Create ticket".

---

### O. Command palette / global search / quick-create — ⌘K (overlay overal)
**Doel:** snel navigeren, zoeken (tickets, files, mensen, bronnen) en aanmaken.

**Componenten:** nieuw CommandPalette (modal via menuHandler, size lg, dimBackground), zoekveld, gegroepeerde resultaten, keyboard-nav, Badge (type), `Avatar`.

**Desktop:** centrale modal, zoekveld bovenaan, secties: *Jump to* (Board/Backlog/…), *Tickets* (DEV-#### fuzzy), *People*, *Sources*, *Actions* (New ticket, New terminal, Invite member, Switch workspace). Pijltjes + Enter; rechts per resultaat een hint (↵). 
**Mobiel:** full-screen search-sheet (zelfde inhoud), groot zoekveld, duim-bereikbare resultaten.

**States:** leeg (recent + suggested actions) · typt (live resultaten) · geen resultaten (EmptyState + "Create '<query>' as ticket").

**Seed:** typ "1240" → DEV-1240 bovenaan; typ "invite" → Action "Invite member".

---

## 7. Menu's, popovers & modals — catalogus (alles via het `menuHandler`-stack-model)
Alle overlays spiegelen `menuHandler` (slide-in vanaf rechts 200ms; mobiel = bottom-sheet omhoog; `dimBackground` voor focus-zware acties; genest stapelbaar; Esc sluit / Enter submit). Sizes: `sm` 384px · `md` 512px · `lg` 768px.

| # | Overlay | Type/size | Inhoud | Trigger |
|---|---|---|---|---|
| P1 | Confirm | ConfirmMenu sm | titel + content + optioneel `input`-typ-ter-bevestiging | verwijderen, teardown, revoke, transfer |
| P2 | Workspace-switcher | Dropdown | workspaces + rol + "Create"/"Manage" | TopBar |
| P3 | Project-switcher | Dropdown | projecten | TopBar |
| P4 | Avatar-menu | menu sm | Account, Theme, Language, Sign out | TopBar avatar |
| P5 | Command palette | modal lg, dim | search + acties | ⌘K |
| P6 | Quick-open `[+]` | popover sm | Open ticket / New terminal / New ticket | tab-bar + |
| P7 | Ticket quickview | sheet md | status/stage/terminal/GitLab | bord-kaart klik |
| P8 | Kaart/rij context-menu | menu sm | move stage ▸, set status ▸, link, archive | rechtsklik/⋯ |
| P9 | New/Edit ticket | modal md | titel, beschrijving, stage, labels, sprint | + Ticket |
| P10 | Filter | MultiSelectDropdown | labels/assignee/status/running | bord/backlog |
| P11 | Stage-config | drawer/right md | de config-tabs (H) | stage-klik |
| P12 | Add/Edit stage | sheet md | naam, AI-toggle, positie | + Stage |
| P13 | Skill/MCP detail | popover sm | wat doet deze skill + welke stages | sources/pipeline |
| P14 | Reindex confirm | ConfirmMenu sm | "Reindex RAG for commit …?" | sources |
| P15 | ReferencePicker | sheet md | Files/Tickets/MRs/Sources + preview | "Add reference"/"Link" |
| P16 | Invite member | modal md | e-mails + rol | org members |
| P17 | Role change | ConfirmMenu sm | "Make Tom an Admin?" | rol-Dropdown |
| P18 | Add SSH key | sheet md | textarea + naam + verify | account/onboarding |
| P19 | Terminal ⋯ | menu sm | Restart/Kill/Pop out/Copy/Clear | terminal-kop |
| P20 | Teardown container | ConfirmMenu sm, `input: DEV-####` | waarschuwing + bevestig-typ | ticket-acties |
| P21 | Voice capture | bottom-sheet | waveform + transcript + target | FAB/mic |
| P22 | AI suggestion detail | sheet md | uitleg + Accept/Dismiss/Snooze | AI-paneel |
| P23 | Promote to next stage | sheet md | toont carry-over preview + confirm | ticket-detail |
| P24 | Tabs overflow (mobiel) | bottom-sheet | lijst open sessies, sluitbaar | tab-strip ⊞ |

---

## 8. Voorbeeld-seed-dataset (gebruik dit consistent op álle schermen)

**Workspaces:** `YouComm Core` (actief), `LuckyStack OSS`.
**Project:** `youcomm-app` (GitLab `youcomm/app`), pipeline van 7 stages.
**Leden (YouComm Core):** Mathijs (Owner, `mathijs@youcomm.nl`, jij), Sanne (Admin), Tom (Member), Lina (Member), Daan (Member). Pending invite: `joost@youcomm.nl` (Member).
**Pipeline-stages:** ① Unrefined (no AI) · ② Refined (AI) · ③ Plan (AI) · ④ Implementatie (AI) · ⑤ Test (AI) · ⑥ Review (AI) · ⑦ Final (AI). Statussen: *needs input* (warning) · *busy* (primary) · *done* (correct).

**Tickets (12):**
| Prefix | Titel | Stage | Status | Terminal |
|---|---|---|---|---|
| DEV-1240 | Fix avatar fallback flicker on slow networks | Implementatie | busy | ● live |
| DEV-1245 | Board drag-and-drop with dnd-kit | Implementatie | busy | ● live (server/client/claude) |
| DEV-1242 | Refactor rate limiter to token bucket | Review | busy | ● live |
| DEV-1241 | Add SSO via Microsoft | Plan | needs input | — |
| DEV-1247 | graphify MCP: impact_of endpoint | Plan | busy | — |
| DEV-1249 | Per-workspace GitLab token vault | Plan | busy | — |
| DEV-1244 | Dark mode FOUC on unauth reload | Test | busy | — |
| DEV-1243 | Voice note → ticket pipeline | Refined | done | — |
| DEV-1250 | Mobile bottom-sheet for quick actions | Refined | busy | — |
| DEV-1246 | Email-change confirmation flow copy | Final | done | — |
| DEV-1248 | Investigate flaky sync test | Unrefined | — (no AI) | — |
| DEV-1251 | Cleanup: remove SESSION_STATE.md from root | Unrefined | — (no AI) | — |

**Terminals (3 actief):** DEV-1240 (claude editing Avatar.tsx, tests 2 failing), DEV-1245 (sub-tabs: `server` vite:5173 ready · `client` HMR · `claude` wiring dnd-kit), DEV-1242 (review running).
**Event-log (recent):** zie scherm M (npm test → 2 failing, file edit Avatar.tsx +12−4, AI-message DEV-1245, Sanne zette DEV-1241 op needs-input, MR !88 merged).
**Workspace-AI:** Suggestie 1 — *DEV-1241 (SSO) & DEV-1249 (token vault) overlappen → 'secrets'-epic?*; Suggestie 2 — *DEV-1248 flaky test lijkt op eerder opgelost issue*; Config-review — *Refined laadt volle RAG, Plan alleen summary — omgedraaid?*; Watch — *RAG 3 commits achter sinds DEV-1246 merge*.
**Sources/Skills:** 📄 docs: project-summary, conventions, glossary, db-schema (generated 2h ago), uploaded "Auth redesign.md". 🔧 skills: RAG (12.4k chunks @ abc123, self-hosted nomic, healthy), graphify (1.8k nodes), symbol-index, route-index, git-history, test-runner, deps-audit, cross-ticket.
**Account:** Mathijs, GitLab connected, 1 SSH-key (MacBook Pro · ed25519), 2 sessies (MacBook=this device, iPhone).

---

## 9. Interactie, motion & toegankelijkheid
- **Motion:** overlays slide-in 200ms (rechts desktop / omhoog mobiel); kaarten hover-lift subtiel; *busy*-status-pill zachte puls; live-event-stream auto-scroll met "new"-indicator. Alles respecteert `prefers-reduced-motion` (dan alleen fade, geen transform).
- **Focus & keyboard:** zichtbare `focus-ring` (token) op alle interactieve elementen; volledige keyboard-nav in Dropdowns/CommandPalette/menu-stack (↑↓, Home/End, Enter, Esc); ⌘K overal; Esc sluit bovenste overlay.
- **Touch:** mobiele tap-targets ≥ 44px; bottom-sheets met grijp-handle + swipe-to-dismiss; terminal-toetsenbalk (Tab/Ctrl/Esc/pijlen) als chips.
- **Contrast & states:** alle tekst voldoet aan WCAG AA op zijn surface; status nooit alléén via kleur (ook label/icoon: *busy*/*done*/*needs input*); duidelijke empty/loading/error-states overal (EmptyState + Skeleton).
- **Dark-mode:** elk scherm in beide modi; terminals altijd dark-surface (ook in light-mode). Geen FOUC: ontwerp een nette eerste-paint.
- **i18n:** alle zichtbare tekst is een vertaalbare key; ontwerp met ruimte voor langere strings (nl/de/fr). Voorbeeldcopy in mockups = Engels (base-locale).
- **Consistentie:** hergebruik de echte `_components` (§4a) bij naam; nieuwe primitives (§4b) in dezelfde tokens, radius en spacing; nooit hex buiten de palette.

---

> **Einde brief.** Lever per scherm (A–O) een desktop- én mobiel-mockup, met de bijbehorende popovers (§7) en de seed-data (§8), in de vriendelijk/luchtige stijl binnen de LuckyStack-tokens. Begin met de app-shell (B), dan bord (C), ticket-detail (E), terminals (F), pipeline-editor (H).
