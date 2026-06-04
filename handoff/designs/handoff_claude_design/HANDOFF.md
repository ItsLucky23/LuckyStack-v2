# Workspaces UI — Handoff for Claude Code

> **Read this entire file before touching anything.** It defines *how* we work together on this
> project, not just *what* to build. The single most important rule: **you build one page at a
> time and STOP for my approval before starting the next.** Details in §4.

---

## 0. TL;DR of the workflow (do these in order)

1. **Orient** — read this file, then open `prototype/index.html` in a browser and click through
   the whole app so you understand what we're building (every screen, menu, and state already
   exists as a clickable mock).
2. **Phase A — Styling & component audit (NO page-building yet).** Compare the prototype's design
   tokens & components against **our existing codebase**. Produce a written mapping:
   *prototype concept → the component/style we already have*. **Prefer our own existing
   components/styles wherever they exist.** Only propose a new component when we genuinely don't
   have one. Present this for my review and **wait for my sign-off** before any page work.
3. **Phase B — Page-by-page build.** Build screens **one at a time**, in the agreed order, using
   the components we settled on in Phase A. **After each page, stop and ask me to approve it.
   Do not start the next page until I say go.**

If you ever feel unsure which component/style to use, or whether to add something new — **ask
me**, don't guess.

---

## 1. What's in this folder

```
handoff/
├─ HANDOFF.md            ← this file (the instructions)
├─ SCREEN_INVENTORY.md   ← every screen/overlay/state in the prototype, with file references
├─ DESIGN_TOKENS.md      ← the token system + the friendly/airy visual rules
└─ prototype/            ← the working, clickable reference app (open index.html)
   ├─ index.html         ← mounts React + all the .jsx, holds the shell CSS
   ├─ colors_and_type.css← the design tokens (colors light/dark, type scale, radii, shadows)
   ├─ screens.css        ← screen-level styles
   ├─ data.js            ← seed dataset (members, tickets, terminals, events, budget, …)
   ├─ Primitives.jsx     ← Avatar, Dropdown, StatusPill, Button, Tabs, Toggle, PopMenu, useClickAway …
   ├─ Shell.jsx          ← NavRail, TopBar, TabBar, AIPanel, MobileBottomBar
   ├─ Board.jsx · TicketDetail.jsx · Terminals.jsx · Pipeline.jsx · Backlog.jsx
   │  Sources.jsx · Activity.jsx · AIScreen.jsx · Settings.jsx · Usage.jsx · Auth.jsx
   ├─ Overlays.jsx · Overlays2.jsx  ← command palette, modals, sheets, reference picker, etc.
   └─ App.jsx            ← the router (nav + tabs drive one `view`) + desktop/phone composition
```

> **The prototype is a *reference*, not a dependency.** It's intentionally a lightweight,
> cosmetic mock: vanilla React via Babel-in-the-browser, FontAwesome via CDN, no real backend,
> interactions are stubs. **Do not lift it wholesale into the codebase.** Treat it as the source
> of truth for *layout, visual design, states, and interaction intent* — then implement it
> properly with our real stack and our real components.

---

## 2. What this app is (so the design makes sense)

**Workspaces** is a self-hosted app that orchestrates AI-driven development: you push **tickets**
through a configurable **pipeline** (stages: Unrefined → Refined → Plan → Implementatie → Test →
Review → Final). Each ticket runs in its own container with a **live terminal** you can drive from
your phone. One web app ties it together — a scrum **board** (a view on GitLab), live **terminals**,
a **sources/skills** system, and an overarching **Workspace-AI** that proposes suggestions.

**Mobile is first-class** (the touchstone: managing tickets from your phone on the water). The
visual direction is **friendly & airy**: generous whitespace, soft rounded corners, hairline
borders, light-first with full dark mode — but dense where it earns it (board column, terminal,
event-log). Terminals are always a dark surface, even in light mode.

Full screen list and seed data are in `SCREEN_INVENTORY.md`. Token/visual rules are in
`DESIGN_TOKENS.md`.

---

## 3. PHASE A — Styling & component consistency (do this FIRST, then STOP)

**Goal:** before building any page, agree on *what design system we're actually using* so the
result is consistent and reuses what we already have.

Do this:

1. **Inventory our existing codebase first.** Find our current component library, design tokens,
   theme, and utility setup (Tailwind config / CSS vars / styled components / whatever we use).
   List what already exists: buttons, inputs, dropdowns, modals, tabs, toggles, avatars, cards,
   tables, menus, layout primitives, etc.
2. **Map prototype → ours.** For each component the prototype uses (see `Primitives.jsx` and
   `SCREEN_INVENTORY.md`), decide one of:
   - ✅ **Use ours** — we already have an equivalent → name it and note any gaps.
   - 🟡 **Adapt ours** — we have something close that needs a small extension.
   - 🆕 **New** — we genuinely don't have it → propose adding it (only with my OK).
   **Default to ✅ / 🟡. Lean hard on our existing components for consistency.** New components are
   the exception, not the rule.
3. **Reconcile tokens.** Compare `colors_and_type.css` (prototype) with our real theme tokens.
   Our codebase tokens win. If the prototype introduced a color/size not in our system, flag it —
   we decide together whether to add it or map it to an existing token. **Never hard-code hex that
   isn't in our token system.**
4. **Write it up** as a short doc (`STYLING_DECISIONS.md` in our repo): the component mapping
   table, the token reconciliation, and any open questions.
5. **STOP. Present this to me and wait for sign-off.** Do not start building pages until I
   approve the mapping. This step is the whole point — it's what keeps the build consistent.

---

## 4. PHASE B — Build page by page (with approval gates)

Once Phase A is approved:

1. **Build ONE page at a time**, in the order I give you (if I don't specify, propose an order and
   confirm it — a sensible default is the prototype's own priority: Board → Ticket detail →
   Terminals → Pipeline → the rest).
2. For each page: implement it with the **components we agreed on in Phase A**, matching the
   prototype's layout, states, and interactions (reference `SCREEN_INVENTORY.md` for the full
   list of states/overlays that page needs — empty, loading, error, locked, paused, needs-input,
   etc.).
3. **When the page is done, STOP and ask me to review it.** Show me what you built. **Do not
   start the next page until I explicitly approve.** If I request changes, iterate on the current
   page until I'm happy, *then* stop again before the next one.
4. Keep desktop **and** mobile in mind for every page (breakpoint `md` = 768px), and both light
   and dark.

> **This gating is non-negotiable.** One page, then wait. It keeps us aligned and prevents you
> from compounding a wrong assumption across ten screens.

---

## 5. Ground rules (apply throughout)

- **Reuse before you build.** Prefer our existing components/tokens over recreating the
  prototype's. The prototype's components are reference shapes, not the thing to ship.
- **Tokens only — no arbitrary hex.** Match our theme system.
- **Every overlay** (menus, popovers, sheets, modals) closes on outside-click and Escape. The
  prototype's `useClickAway` in `Primitives.jsx` shows the intended behavior — use our equivalent.
- **Motion:** menus fade+scale from their edge; side panels slide in from the right (bottom-sheet
  up on mobile); modals scale+fade; respect `prefers-reduced-motion`. Keep it smooth, not stiff.
- **Status is never color-only** — always pair with a label/icon (needs-input / busy / done / no-AI).
- **Accessibility:** visible focus rings, keyboard nav for menus/palette, ≥44px touch targets on
  mobile.
- **Don't add scope.** If you think a page needs content/sections the prototype doesn't show,
  ask me first.
- **When in doubt, ask.** Especially about which existing component to use.

---

## 6. Running the prototype

Open `prototype/index.html` in a browser (no build step). The dark **kit toolbar** at the top is
*demo chrome, not part of the product* — it lets you switch **Desktop/Phone**, **Light/Dark**, and
a **View** dropdown (App / Login / SSH setup / Accept invite / Onboarding). FontAwesome loads from
a CDN, so icons may take a second on first load. The board, tabs, nav, menus, sheets, ⌘K, etc. are
all clickable.

---

*Questions about intent? Ask me before writing code. The two hard rules again: (1) finish the
styling/component mapping and get my sign-off before any page; (2) build one page, then stop for
approval before the next.*
