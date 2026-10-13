---
name: handwritten-docs-explain-design-not-code
title: Handwritten documentation explains design rather than duplicating implementation
status: accepted
date: 2026-10-13
deciders: [ItsLucky23]
tags: [docs, ai-context, consumer-delivery]
supersedes: [0049]
relates: [0055, 0056]
---

## Context

The earlier deep-doc policy treated curated function inventories and execution narratives as useful handwritten context. That conflicts with the later source-of-truth policy: the same implementation described twice can disagree without either copy looking suspicious. The user explicitly requested a retrospective cleanup, including the documentation and instructions delivered to consumers.

## Decision

Handwritten documentation explains purpose, design rationale, genuine alternatives, invariants and consequences. Exact contracts and structural discovery belong to installed declarations/source and generated queries, not handwritten inventories or generated paraphrases inserted into the prose.

Retain minimal usable adoption, upgrade and safety actions. An operator must be able to avoid plaintext secret storage or an unauthorized migration; “read the code” alone is not a useful safety procedure. Preserve history and established rationale rather than fabricating reasons during the rewrite.

## Rejected alternatives

- **Keep the handwritten Function Index and improve synchronization** — preserves a second implementation description and its silent-drift burden.
- **Generate full narrative documentation from source comments** — still spends context on implementation repetition and cannot establish historical rationale.
- **Remove every concrete instruction** — loses safety-critical prerequisites and makes existing-project adoption impractical.
- **Rewrite accepted history to match the present** — makes past decisions appear to have always supported the new policy.

## Consequences

The older inventory-maintenance obligation is superseded. Short source pointers can outlive refactors better than execution tours, but rationale still needs review against actual evidence; fewer words do not make an invented claim correct. Historical records remain available as history, not consumer-owned backlog or current API truth.
