# Workspaces UI kit

High-fidelity, reusable recreation of the **Workspaces** app — built against the real LuckyStack
component APIs and the design system's tokens. This is the **full app**: every core destination is
a working, navigable screen, on desktop and mobile, in light and dark.

> Cosmetic recreation, not production code. Components are simplified to their visual essence so
> they compose easily into mockups. The look mirrors the real `_components` (`Navbar`, `Dropdown`,
> `Avatar`, `MenuHandler`, …) and the friendly/airy redesign direction.

## Run it
Open `index.html`. A thin **kit toolbar** at the top (demo chrome, not product) switches
**Desktop ⇄ Phone** and **Light ⇄ Dark**; both persist to `localStorage`.

## Screens (all working)
- **Board** — kanban across the 7 pipeline stages; status pills (busy pulses), per-stage AI marker,
  "no AI" columns dimmed, hover-lift cards. Click a card → opens it as a tab.
- **Ticket detail** — tabbed: Overview (description, carry-over, stage config, actions), Terminal
  (embedded live view), Files & refs (diff list), Activity (filtered event-log), Links (with
  AI-suggested links), Stage history (timeline). Needs-input / done banners.
- **Terminals** — multi-instance workspace; grid/tabs/split layouts, process sub-tabs
  (server/client/claude), a "needs input" terminal with a reply box.
- **Pipeline editor** — drag-style stage flow + per-stage config tabs (General, Context & skills,
  Commands, Tool access, Visibility, Process).
- **Backlog** — sortable table (desktop) / row-cards (mobile) with quick-filter segments.
- **Sources** — context-docs + skills/MCP cards with toggles, index-health banner.
- **Workspace-AI** — full screen: Suggestions / Notes / Config review / Watch.
- **Activity** — live event-log stream with actor avatars, event-type badges, filters.
- **Settings** — Account (profile, theme, language, connections, SSH keys, sessions) +
  Workspace admin (Members, Invites, Integrations, Danger).
- **Command palette (⌘K)** — global search + jump-to + actions (also via the top-bar search / phone search).
- **Voice capture** — phone FAB → recording sheet → transcript review → send target.

## Navigation
- **Desktop:** left nav rail (folds), browser-style **tab/session bar** (Board + open tickets),
  right **Workspace-AI** panel (on board/ticket views), ⌘K anywhere.
- **Mobile:** bottom tab-bar (Board/Terminals/Activity/AI), hamburger **drawer** (all destinations),
  **FAB** → voice, per-stage segmented control on the board, back-chip on ticket detail.

## Files
| File | What |
|---|---|
| `index.html` | Mounts React + the kit; shell CSS inline. |
| `screens.css` | All screen-level styles. |
| `data.js` | Seed dataset — members, stages, 12 tickets, terminals, events, docs/skills, pipeline, sessions, AI. |
| `Primitives.jsx` | `Avatar`, `AvatarStack`, `StatusPill`, `Label`, `Button`, `Dropdown`, `Icon`, `Tabs`, `Segmented`, `Toggle`, `SectionCard`, `EmptyState`, `ScreenHead`. |
| `Board.jsx` | `KanbanCard`, `KanbanColumn`, `BoardHeader`, `BoardDesktop`, `BoardMobile`. |
| `Shell.jsx` | `NavRail`, `TopBar`, `TabBar`, `AIPanel`, `MobileBottomBar`. |
| `Terminals.jsx` | `TerminalView`, `TerminalsScreen`. |
| `TicketDetail.jsx` | Tabbed ticket detail. |
| `Backlog.jsx` · `Sources.jsx` · `Pipeline.jsx` · `Activity.jsx` · `AIScreen.jsx` · `Settings.jsx` | Screens. |
| `Overlays.jsx` | `CommandPalette`, `VoiceSheet`. |
| `App.jsx` | Router (nav + tabs drive one `view`), desktop/phone composition, kit toolbar. |

## Notes & caveats
- **Icons:** FontAwesome free-solid via SVG-JS (unpkg core + solid). It's the icon set the codebase
  uses; SVG-JS avoids webfont loading (cdnjs/jsdelivr appear blocked here, unpkg works). ~0.6MB, so
  on a cold load icons pop in after ~1–2s. Brand icons (GitLab/GitHub) are substituted with a neutral
  git glyph to avoid the heavier brands bundle.
- **Not wired:** real drag-and-drop, GitLab data, and many menu actions are visual stubs — the goal
  is a complete, navigable *feel*, not a working backend.
- **Login / SSH-link / invite-accept (screen A)** are the remaining auth-flow screens, not yet built.
