# Agent Team Playbook

Read this when staffing multiple agents. A team is useful when independent work can overlap or fresh review adds evidence, not as a ceremony around a bounded task.

## Accountability

The parent owns shared contracts, scope decisions, integration and the final verdict. Delegation changes who investigates a slice; it does not transfer authority to install, migrate, delete, publish or weaken acceptance criteria.

## Lane contract

Before launching, announce the lanes and why they are independent. Each brief must include:

- Goal and exact owned/read-only surfaces, with explicit paths to leave alone.
- Relevant requirements, source/doc pointers and known evidence; do not assume inherited repository context.
- Acceptance assertions and verification commands.
- Isolation directory for writers, one writer per worktree.
- A bounded stop rule, meaningful checkpoint and evidence-bearing handoff.

Shared schemas, manifests, lockfiles and integration code need one owner. Do not merge conflicting meanings mechanically. Never reset or clean another lane's work.

## Choose proportionate orchestration

Use the harness's actual tools and configured models, not a copied tool API or provider catalogue. One bounded specialist/fresh reviewer uses ordinary delegation; structured independent lanes can use a workflow. A serial scout–worker–reviewer chain is not automatically better than direct work.

Parallel readers may share a checkout. Parallel writers require separate worktrees and disjoint ownership. Keep worktrees and local-rule links under the applicable local layout policy; do not embed one developer's hosting setup in framework guidance.

Fresh review is especially valuable for security, migrations, concurrency and weak/conflicting evidence. Do not automatically add skeptics to every routine lane. Another round is justified by an unresolved correctness question, not elapsed time or available agent slots.

## Evidence and integration

- Inspect returned diffs yourself; a child's confidence is not verification.
- Report failures/skips and scope gaps. No sampling may masquerade as complete coverage.
- Run the feature-boundary gate after integration; verify consumer delivery when package/scaffold content changes.
- Keep active work visible and ask for a checkpoint when it runs beyond the agreed boundary. Preserve completed/remaining work rather than silently abandoning a child.
- Never claim a pending agent completed or background work exists without a real run receipt.

## Continuity

Use the save-handoff command/skill for `handoffs/<date>/` when a session must be resumable. Reconcile it with Git and active runs before relaunching work. Record-layer capture remains batched to wrap-up under `AGENTS.md`.

A handoff should explain decisions, failures, verification and exact next actions; it should not reproduce the code or prescribe a large line target.
