# Phase 1 Contract Layout And Approval Closeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish Phase 1 for the Web admin + backend core loop by fixing the Word layout issues found in spot-check, extending live contract generation coverage to all four contract types, and closing the remaining approval-engine gaps.

**Architecture:** Reuse the existing DOCX template assets, `verify-contract-workbench.cjs`, and current approval instance model. Do not introduce a new workflow engine; extend the contract/payment services to match the settlement service behavior already in the codebase.

**Tech Stack:** NestJS, Prisma, PostgreSQL, Vue 3/TDesign Web, docxtemplater, LibreOffice conversion, Jest, existing shell verifier scripts.

---

## File Map

- Modify `services/api/assets/templates/material-purchase-real-v1.docx`: add seller name in signature table and adjust tax-rate text to avoid the `%)` orphan line.
- Modify `services/api/assets/templates/labor-subcontract-real-v1.docx`: add placeholders for project name, owner, and counterparty on cover/body starter fields.
- Modify `services/api/assets/templates/equipment-rental-real-v1.docx`: replace the rotated certificate attachment with a corrected/cropped embedded image if technically feasible with the existing DOCX package.
- Modify `services/api/src/database/contract-template-docx-assets.spec.ts`: assert the new placeholders exist and the known missing placeholders stay fixed.
- Modify `services/api/prisma/verify-contract-workbench.cjs`: generate draft DOCX/PDF for generic, material purchase, equipment rental, and labor subcontract; keep offline revision smoke on one generated draft.
- Modify `services/api/src/database/contract-workbench-verification.spec.ts`: assert the verifier covers all four live generation paths.
- Modify `services/api/src/contract/dto/review-contract-approval.dto.ts`: allow `reject_previous` and `return_to_applicant`.
- Modify `services/api/src/payment/dto/review-payment-approval.dto.ts`: allow `reject_previous` and `return_to_applicant`.
- Modify `services/api/src/contract/contract.service.ts`: implement previous-node rejection and return-to-applicant for contract approval using current frozen nodes.
- Modify `services/api/src/payment/payment-request.service.ts`: implement previous-node rejection and return-to-applicant for payment approval using current frozen nodes.
- Modify `services/api/src/contract/contract.service.spec.ts`: cover contract approval previous-node rejection and return-to-applicant.
- Modify `services/api/src/payment/payment-request.service.spec.ts`: cover payment approval previous-node rejection and return-to-applicant.
- Modify `PROGRESS.md`: record Phase 1 closeout status after verification.

---

### Task 1: Word Template Spot-Check Fixes

- [ ] Add regression assertions in `contract-template-docx-assets.spec.ts`:
  - material purchase DOCX contains `party.counterparty.name` in the signature table.
  - labor subcontract DOCX contains `field.projectName`, `party.owner.name`, and `party.counterparty.name` in the cover/start fields.
- [ ] Run:
  - `pnpm --filter @jiangkong/api test -- contract-template-docx-assets.spec.ts`
  - Expected before fix: fail on missing placeholders.
- [ ] Patch the DOCX XML in the smallest possible way:
  - material: insert `{party.counterparty.name}` after `卖方（章）：`.
  - material: keep the tax-rate `%` pair on the same run/line if simple XML patch is enough.
  - labor: replace blank underline runs after `工程名称：` with `{field.projectName}`, after `发 包 人：` with `{party.owner.name}`, and after `承 包 人：` with `{party.counterparty.name}`.
  - equipment: rotate/crop the embedded certificate image only if the image can be identified without rebuilding the whole document; otherwise record a manual-template-edit follow-up.
- [ ] Re-run the asset test.
- [ ] Convert the three DOCX assets to PDF with LibreOffice and spot-check first/last pages.
- [ ] Commit: `fix: polish phase1 contract docx templates`.

### Task 2: Four-Type Live Contract Generation Verifier

- [ ] Refactor `verify-contract-workbench.cjs` just enough to create and save a draft per workbench seed:
  - generic: existing generic fields and `genericItems`.
  - material: existing material fields and `materials`.
  - equipment: use existing equipment seed schema and its primary bill key from `core-flow-seed-data.ts`.
  - labor: use existing labor seed schema and `laborItems`.
- [ ] Queue `draft` generation for all four types and assert each document has both `docxFileId` and `pdfFileId`.
- [ ] Keep internal-review generation, offline revision upload, readiness check, and approval submission on the material path only.
- [ ] Update `contract-workbench-verification.spec.ts` to assert the verifier contains all four live generation labels.
- [ ] Run:
  - `pnpm --filter @jiangkong/api test -- contract-workbench-verification.spec.ts core-flow-seed-data.spec.ts contract-template-docx-assets.spec.ts`
  - `DOC_CONVERTER_COMMAND=/Applications/LibreOffice.app/Contents/MacOS/soffice pnpm --filter @jiangkong/api verify:contract-workbench`
- [ ] Commit: `test: verify all phase1 contract document generation`.

### Task 3: Contract Approval Return Controls

- [ ] Extend `ReviewContractApprovalDto.decision` to include `reject_previous` and `return_to_applicant`.
- [ ] Add tests in `contract.service.spec.ts`:
  - `reject_previous` decrements `currentNodeIndex`, keeps `ApprovalInstance.status = in_progress`, keeps `ContractVersion.status = in_approval`, writes `ApprovalActionLog.action = reject_previous`, and audits `contract.approval.reject_previous`.
  - `return_to_applicant` sets `ContractVersion.status = draft`, sets `ApprovalInstance.status = returned`, writes `ApprovalActionLog.action = return_to_applicant`, and audits `contract.approval.return_to_applicant`.
  - rejecting previous from node index `0` is rejected.
- [ ] Implement in `contract.service.ts` by mirroring the settlement service logic and keeping existing approve/reject behavior unchanged.
- [ ] Run:
  - `pnpm --filter @jiangkong/api test -- src/contract/contract.service.spec.ts`
- [ ] Commit: `feat: complete contract approval return controls`.

### Task 4: Payment Approval Return Controls

- [ ] Extend `ReviewPaymentApprovalDto.decision` to include `reject_previous` and `return_to_applicant`.
- [ ] Add tests in `payment-request.service.spec.ts`:
  - `reject_previous` decrements `currentNodeIndex`, keeps `ApprovalInstance.status = in_progress`, keeps payment status in approval, writes log and audit.
  - `return_to_applicant` sets `PaymentRequest.status = draft`, sets instance returned, writes log and audit.
  - previous-node rejection from node index `0` is rejected.
- [ ] Implement in `payment-request.service.ts` by mirroring the settlement service pattern.
- [ ] Run:
  - `pnpm --filter @jiangkong/api test -- src/payment/payment-request.service.spec.ts`
- [ ] Commit: `feat: complete payment approval return controls`.

### Task 5: Phase 1 Final Verification And Progress

- [ ] Run backend targeted tests:
  - `pnpm --filter @jiangkong/api test -- contract-template-docx-assets.spec.ts contract-workbench-verification.spec.ts contract.service.spec.ts payment-request.service.spec.ts settlement.service.spec.ts`
- [ ] Run backend migration/seed/live verifier:
  - `pnpm --filter @jiangkong/api exec prisma migrate deploy`
  - `pnpm --filter @jiangkong/api seed`
  - `DOC_CONVERTER_COMMAND=/Applications/LibreOffice.app/Contents/MacOS/soffice pnpm --filter @jiangkong/api verify:contract-workbench`
- [ ] Run compile/lint checks:
  - `pnpm --filter @jiangkong/api typecheck`
  - `pnpm --filter @jiangkong/api lint`
  - `pnpm --filter @jiangkong/web-admin typecheck`
  - `pnpm --filter @jiangkong/web-admin lint`
- [ ] Convert latest generated PDFs to PNG and manually spot-check material, equipment, labor, and generic first/signature/attachment pages.
- [ ] Update `PROGRESS.md`: Task 22 complete if verification passes; explicitly note deployment and mini program remain out of Phase 1.
- [ ] Commit: `docs: close phase1 contract workbench progress`.
