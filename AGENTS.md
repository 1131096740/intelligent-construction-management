# AGENTS.md

## Project Truth

- This is an enterprise construction project management system, not merely a WeChat mini program.
- Current source of truth: Obsidian `Ai-Obsidian/建工智管/建工智管_第一阶段MVP_产品与架构设计.md`.
- Upstream reference: Obsidian `建工智管_完整方案_20260608.md`.
- Older notes/code describing 6 approval types, 8 roles, WeChat cloud database, or 41 cloud functions are historical references only.

## Phase 1 Scope

Build the enterprise core loop for approval, contract, settlement, payment, seal, archive, PDF, and audit.

Required business chain:

```text
contract draft
  -> payment terms entry
  -> contract approval
  -> seal approval
  -> signed contract archive confirmation
  -> contract version effective
  -> settlement approval
  -> signed settlement archive confirmation
  -> settlement effective
  -> payment request approval
  -> approved pending payment
  -> cashier payment execution
  -> payment voucher upload
  -> finance record, PDF archive, audit log
```

Do not dilute Phase 1 with full material issuing, attendance, HR onboarding/offboarding, safety workflow, full cost dashboard, or saving-bonus features. Leave extension points only.

## Current Phase

- The project is now in production-equivalent validation, real trial-run preparation, and Web Admin UI governance rollout.
- Do not expand new major modules unless `PROGRESS.md` says the real trial run is blocked by them.
- Current priority: real data initialization, historical contract takeover, 3-5 active contract flows, contract master sign-off, permission matrix validation, and Go-Live approval.
- Mini program, OCR, full OA, invoicing, attendance, HR, safety, and large dashboards stay out of current P0 unless explicitly re-scoped.

## Architecture Decisions

- Web admin is the primary system: `Vue 3 + TypeScript + TDesign Web + Vite`.
- Mini program is the mobile work client: native WeChat mini program + TDesign mini program.
- Backend is the business center: `Node.js + NestJS + PostgreSQL`.
- Deploy target: Tencent Cloud Lighthouse, HTTPS, PostgreSQL not public, Tencent COS private bucket.
- Do not use fixed IP allowlists; use strong identity, permissions, private files, audit logs, and backups.
- Both Web and mini program must call the same backend API. Frontends must not access database or object storage directly.

## Core Business Rules

- Contract and settlement must be archived and confirmed before they become effective.
- No settlement may be created from a non-effective contract version.
- No payment request may be created from a non-effective settlement.
- Payment approval is not actual payment. Approved payments enter `approved_pending_payment`.
- Actual payment is recorded separately by finance/cashier, with voucher upload.
- One settlement may have multiple payment requests and multiple actual payment executions.
- Payment amount checks must be enforced in backend transactions.
- Contract payment terms are versioned. Historical settlements/payments must keep their original `contract_version_id` and `payment_terms_version_id`.
- Contract terms cannot be edited after contract effectiveness. Changes require contract change or supplemental agreement approval, seal, archive, and a new contract version.

## Approval Rules

- Contract signing and contract changes require chairman/general manager final approval.
- Chairman and general manager are an OR-sign node: either one may approve.
- Settlement approval does not go through chairman/general manager.
- All payment approvals require chairman/general manager OR-sign approval.
- Contract archive files are uploaded by contract staff and confirmed by contract director.
- Settlement archive files are uploaded by contract staff and confirmed by contract director.
- Finance reads business archive files but does not upload contract/settlement archive files.
- Approval engine must support instance freezing, conditional nodes, countersign, OR-sign, transfer, delegation, withdrawal, reject to previous node, return to applicant, reminders, and full audit history.

## Key Roles

Use real business positions, not old generic roles:

- `chairman`
- `general_manager`
- `project_manager`
- `contract_director`
- `contract_staff`
- `budget_director`
- `budget_staff`
- `finance_director`
- `finance_staff`
- `material_director`
- `material_staff`
- `engineering_director`
- `engineering_foreman`
- `engineering_tech`
- `comprehensive_director`
- `employee`
- `super_admin` only for technical administration, not business approval.

## Security Baseline

- All sensitive files must live in private object storage.
- File download must go through backend permission checks and short-lived URLs.
- Audit log required for login, approval, archive upload/confirmation, payment execution, voucher upload, permission changes, document voiding, and sensitive file download.
- Sensitive actions require second confirmation.
- Secrets must not be committed or exposed to Web/mini program clients.

## Frontend UI Governance

- Web Admin uses Vue 3 + TypeScript + TDesign Vue Next.
- TDesign is the only base UI component library.
- Base UI controls must use TDesign first: buttons, inputs, selects, tables, dialogs, drawers, tags, tabs, cards, alerts, messages, upload controls, and forms.
- If similar UI structure appears more than twice, extract a reusable component before adding a third copy.
- Business components must compose TDesign and `--jg-*` design tokens; they must not create a second visual system.
- Colors, font sizes, spacing, radii, shadows, and layout dimensions must come from project design tokens or TDesign variables.
- Pages live in `apps/web-admin/src/pages/<domain>/`.
- Domain-only components live in `apps/web-admin/src/pages/<domain>/components/`.
- Cross-domain reusable components live in `apps/web-admin/src/components/`.
- API calls live in `apps/web-admin/src/api/<domain>.api.ts`; pages must not call `fetch` directly.
- Pure helpers live in `apps/web-admin/src/lib/` or the nearest existing helper module.
- Do not introduce a second UI library, low-code runtime, generic workflow engine, or full-site rewrite.

## Engineering Discipline

- Keep changes surgical and aligned with the current MVP.
- Do not resurrect old 6-flow mini-program assumptions.
- Prefer domain models and backend invariants over front-end-only validation.
- Add tests around money, status transitions, permission checks, and version traceability.
- When uncertain about business rules, stop and ask; do not silently choose a shortcut.

## Verification

- Web UI changes: run the narrowest relevant Vitest, then `typecheck`, `lint`, and `check:ui`.
- API business changes: run targeted Jest plus `typecheck` and `lint`.
- Money, permission, status transition, archive, PDF, and audit changes require backend tests.
- Production/trial-run work must follow the relevant runbook or verify script and update `PROGRESS.md`.

## 进度跟踪

- 项目实时进度以 `PROGRESS.md` 为唯一真相。
- 每完成一个子任务，必须在 `PROGRESS.md` 勾选/更新，并随代码一起 commit。
- 接手开发（CodeX 或 Claude）第一件事：先读 `PROGRESS.md`。
