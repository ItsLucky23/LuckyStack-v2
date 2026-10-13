# Decision Memory Protocol

## 1. Purpose

A decision record answers **why this choice, and why not the real alternative?** Committed rationale travels with the project; private developer memory does not.

## 2. Keep the layers distinct

Branch logs record session intent and work. `AGENTS.md` states working rules. Decisions preserve durable rationale. Do not auto-promote a decision into a user rule without approval.

## 3. Storage

Keep committed records in `docs/decisions/NNNN-slug.md`. The generated decision index is an ignored, rebuildable cache; it is not a second committed record. Use `list_decisions`, `get_decision` or `decision_for_file` before re-deriving a reason.

## 4. File format

Use the template `docs/decisions/0000-template.md`. Keep frontmatter `name`, `title`, `status`, absolute `date`, `deciders`, `tags`, `supersedes` and `relates`; the slug must match the filename. Status vocabulary: `proposed`, `accepted`, `superseded`, `deprecated`.

Body sections: **Context**, **Decision**, **Rejected alternatives**, **Consequences**. Make the decision's first statement understandable by itself. Write the forces, actual choice, genuine alternatives and future cost; do not copy signatures, defaults or an implementation tour.

## 5. Capture bar

Record only a durable choice implemented in the session or explicitly confirmed by the user, with a genuine rejected alternative. Routine code and discussed-but-unselected options do not qualify. Missing rationale is better than fabricated history.

## 6. Supersession

Accepted decisions are immutable in substance. For a changed choice, create a new record with `supersedes: [OLD]`, change the old record's status to `superseded`, and refresh the index. Keep the old rationale readable.

## 7. Capture timing

Follow `AGENTS.md`: sparring is write-free, implementation keeps an in-session buffer, wrap-up writes the batch autonomously. A deviation not yet agreed with the user remains gated. Refresh with `npm run ai:decisions` after capture; the pre-commit checks do not author records or regenerate the cache for you.

## 8. Missing-memory backfill

Offer a one-time, focused history review plus a resumable interview when a substantial project lacks rationale coverage. Act only on approval. Mine written history, ask small batches of targeted questions about real undocumented choices, and record confirmed reasons in the user's words. Private memory requires separate permission and classification; do not silently import personal preferences as team truth.

## 9. Staleness

A cache refresh cannot make an outdated decision current. Handle changed policy through supersession, not rewriting accepted substance. Consult code for present behaviour, history for past intent.

## 10. Numbers are identities

Never reuse or shift published numbers. Different slugs can make duplicate-number additions merge without a conflict; later renumbering can silently redirect references to a real but wrong decision. On collision, move the unmerged record and its own references to a free number; keep published identities fixed.

Run `npm run ai:check-ids -- --backrefs`. A valid reference number is necessary but cannot prove a reference means the correct decision; inspect provenance when resolving a collision.

## 11. Point, do not paste

A source pointer or `//? @adr NNNN` link lets a reader discover implementation without maintaining it twice. Rationale should survive refactoring; a copied code explanation cannot.
