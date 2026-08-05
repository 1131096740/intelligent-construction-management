# Domain Docs

The repository uses a multi-context domain documentation layout.

## Before exploring

Read the root `CONTEXT-MAP.md`, then read the `CONTEXT.md` files relevant to the task:

- `services/api/CONTEXT.md` for backend business rules, persistence, transactions, permissions, audit, and integration boundaries.
- `apps/web-admin/CONTEXT.md` for the responsive Web workbench, UI governance, read models, and client workflow boundaries.
- `packages/shared-domain/CONTEXT.md` for shared types, permissions, statuses, money contracts, and cross-client domain invariants.

Read relevant system-wide decisions in `docs/adr/`. ADRs remain centralized at the repository root rather than being duplicated within package directories.

If a context file or ADR directory does not exist yet, proceed silently. Create it only when a real term or hard-to-reverse decision needs a durable home; do not create empty placeholders.

## Vocabulary

Use glossary terms from the relevant context document in issue titles, specifications, hypotheses, test names, and code. Avoid synonyms that the glossary explicitly rejects.

If a required concept is absent, first reconsider whether it belongs to the established model. Record a genuine gap instead of silently inventing competing language.

## ADR conflicts

If proposed work contradicts an existing ADR, identify the ADR and surface the conflict explicitly. Do not silently override an accepted decision.
