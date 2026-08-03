# Domain Docs

The repository uses a multi-context domain documentation layout.

## Before exploring

Read the root `CONTEXT-MAP.md` when it exists, then read the `CONTEXT.md` files
relevant to the task:

- `services/api/CONTEXT.md` for backend business rules, persistence, transactions,
  permissions, audit, and integration boundaries.
- `apps/web-admin/CONTEXT.md` for the responsive Web workbench, UI governance,
  read models, and client workflow boundaries.
- `packages/shared-domain/CONTEXT.md` for shared types, permissions, statuses,
  money contracts, and cross-client domain invariants.

Read relevant system-wide decisions in `docs/adr/`. ADRs remain centralized at
the repository root rather than being duplicated within package directories.

If a context file, map, or ADR directory does not exist yet, proceed silently.
The domain-modeling workflows create them lazily when real terminology or
decisions are resolved; do not create empty placeholders.

## Vocabulary

Use the glossary terms defined in the relevant context document in issue titles,
specifications, hypotheses, test names, and code. Avoid synonyms that the
glossary explicitly rejects.

If a required concept is absent, first reconsider whether the term belongs to
the established model. Record a genuine gap for domain modeling rather than
silently inventing competing language.

## ADR conflicts

If proposed work contradicts an existing ADR, identify the ADR and surface the
conflict explicitly. Do not silently override an accepted decision.
