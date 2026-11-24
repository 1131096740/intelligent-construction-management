import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { hash } from "bcryptjs";
import { randomUUID } from "node:crypto";
import { AppModule } from "../app.module";
import { apiJsonReplacer } from "../api-json-replacer";
import { PrismaService } from "../database/prisma.service";
import { createApiValidationPipe } from "../validation/api-validation";

const acceptance = process.env.RUN_EXPENSE_REGISTERED_PAYMENT_PG16 === "1" ? test : test.skip;

acceptance("real expense HTTP records two independent registered payers and preserves a historical replay", async () => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (process.env.NODE_ENV !== "test" || url.hostname !== "127.0.0.1" ||
      url.pathname !== "/jiangkong_payment_execution_concurrency" || !url.port ||
      process.env.FILE_STORAGE_DRIVER !== "local" || !process.env.FILE_STORAGE_ROOT) {
    throw new Error("EXPENSE_REGISTERED_REQUIRES_ISOLATED_POSTGRES");
  }
  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app: INestApplication = module.createNestApplication({ logger: false });
  try {
    app.getHttpAdapter().getInstance().set("json replacer", apiJsonReplacer);
    app.useGlobalPipes(createApiValidationPipe());
    await app.listen(0, "127.0.0.1");
    const base = await app.getUrl();
    const db = app.get(PrismaService);
    const suffix = randomUUID();
    const password = randomUUID();
    const paidAt = new Date("2026-11-10");
    const debtorAmount = 400n;
    const proxyAmount = 600n;
    const owner = await db.user.create({
      data: { name: "报销财务合成", phone: suffix, passwordHash: await hash(password, 4), mustChangePassword: false }
    });
    const finance = await db.position.upsert({
      where: { key: "finance_staff" }, update: {}, create: { key: "finance_staff", name: "财务人员" }
    });
    await db.userPosition.create({ data: { userId: owner.id, positionId: finance.id } });
    const project = await db.project.create({ data: { code: `FND19-${suffix}`, name: "合成报销项目" } });
    const affiliate = await db.businessParty.create({
      data: { name: "合成总包", normalizedName: suffix, unifiedSocialCreditCode: "91310000FND1900001", createdByUserId: owner.id }
    });
    const affiliateVersion = await db.businessPartyVersion.create({
      data: { businessPartyId: affiliate.id, versionNo: 1, snapshot: { name: affiliate.name }, createdByUserId: owner.id }
    });
    const start = new Date("2026-01-01");
    await db.projectAffiliateAssignment.create({
      data: { projectId: project.id, businessPartyId: affiliate.id, businessPartyVersionId: affiliateVersion.id,
        affiliateNameSnapshot: affiliate.name, affiliateCreditCodeSnapshot: affiliate.unifiedSocialCreditCode,
        effectiveFrom: start, changeReason: "虚构报销验收", assignedByUserId: owner.id }
    });
    const companyAccount = async (name: string, credit: string) => {
      const company = await db.companyEntity.create({
        data: { name, unifiedSocialCreditCode: credit, currentVersionNo: 1, dataStatus: "complete" }
      });
      const version = await db.companyEntityVersion.create({
        data: { companyEntityId: company.id, versionNo: 1, name, unifiedSocialCreditCode: credit,
          isActive: true, action: "test_master", actorUserId: owner.id }
      });
      await db.projectParticipatingCompany.create({
        data: { projectId: project.id, companyEntityId: company.id, companyEntityVersionId: version.id,
          companyNameSnapshot: name, companyCreditCodeSnapshot: credit, effectiveFrom: start,
          changeReason: "虚构报销验收", addedByUserId: owner.id }
      });
      const scopeKey = `company:${company.id}`;
      const account = await db.registeredFundAccount.create({
        data: { scopeKey, kind: "company", companyEntityId: company.id }
      });
      const registration = await db.fundAccountBalanceRegistration.create({
        data: { accountId: account.id, version: 1, kind: "opening", status: "confirmed", balanceYuan: "20.0000",
          asOfDate: "2026-11-01", evidenceReference: "虚构余额证据", reconciliationNote: "已核对",
          reason: "虚构期初", idempotencyKey: randomUUID(), payloadFingerprint: "a".repeat(64),
          createdByUserId: owner.id, confirmedByUserId: owner.id, confirmedAt: start,
          sources: { create: [{ lineNo: 1, amountYuan: "20.0000", sourceStatus: "known",
            sourceName: "虚构项目资金", projectStatus: "project", projectId: project.id }] } },
        include: { sources: true }
      });
      return { company, scopeKey, registration };
    };
    const debtor = await companyAccount("原债务公司", "91310000FND1900002");
    const proxy = await companyAccount("实际代付公司", "91310000FND1900003");
    await db.project.update({ where: { id: project.id }, data: { operatingLedgerEffectiveDate: start } });
    const seedClaim = (code: string, total: bigint, paid = 0n) => {
      return db.expenseClaim.create({
        data: { code, claimType: "reimbursement", status: paid ? "paid" : "approved_pending_payment",
          companyEntityId: debtor.company.id, companyEntityNameSnapshot: debtor.company.name, projectId: project.id,
          paymentSubjectCompanyEntityId: debtor.company.id, paymentSubjectNameSnapshot: debtor.company.name,
          applicantUserId: owner.id, applicantNameSnapshot: owner.name, handledByUserId: owner.id,
          handledByNameSnapshot: owner.name, reason: "虚构在册实付", requestedAmountCents: total,
          companyPayableAmountCents: total, fundedAmountCents: paid, submittedAt: start, approvedAt: start }
      });
    };
    const claim = await seedClaim(`BX-${suffix}`, debtorAmount + proxyAmount);
    const oldClaim = await seedClaim(`OLD-BX-${suffix}`, 100n, 100n);
    const oldVoucher = await db.fileObject.create({
      data: { bucket: "expense-fnd19-test", objectKey: suffix, originalName: "合成历史凭证",
        mimeType: "image/png", sizeBytes: 1, uploadedByUserId: owner.id, storageStatus: "active" }
    });
    const oldPayment = await db.expenseClaimPaymentExecution.create({
      data: { expenseClaimId: oldClaim.id, amountCents: 100n, paidAt, paymentMethod: "银行转账",
        voucherFileId: oldVoucher.id, recordedByUserId: owner.id }
    });
    await db.projectFundingAllocation.create({
      data: { projectId: project.id, executionType: "expense_claim_payment_execution", executionId: oldPayment.id,
        businessType: "expense_claim", businessId: oldClaim.id, sourceType: "project_cash", sourceKey: "project_cash",
        direction: "debit", amountCents: 100n, occurredAt: paidAt, createdByUserId: owner.id }
    });
    const statuses: Array<{ phase: string; status: number }> = [];
    const exchange = async (phase: string, path: string, expected: number, token?: string, body?: unknown) => {
      const multipart = body instanceof FormData;
      const result = await fetch(`${base}${path}`, {
        method: body === undefined ? "GET" : "POST", signal: AbortSignal.timeout(15_000),
        headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(multipart ? {} : { "content-type": "application/json" }) },
        ...(body === undefined ? {} : { body: multipart ? body : JSON.stringify(body) })
      });
      statuses.push({ phase, status: result.status });
      process.stdout.write(`EXPENSE_FND19_HTTP ${phase} ${result.status}\n`);
      expect(result.status).toBe(expected);
      return result.json();
    };
    const session = await exchange("LOGIN", "/auth/login", 201, undefined, { phone: owner.phone, password });
    const token: string = session.tokens.accessToken;
    const root = `/expense-claims/${claim.id}`;
    const voucher = async (phase: string, claimPath = root) => {
      const form = new FormData();
      form.append("idempotencyKey", randomUUID());
      form.append("file", new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=", "base64")], { type: "image/png" }), "合成报销凭证.png");
      return (await exchange(phase, `${claimPath}/payment-voucher-file-uploads`, 201, token, form)).id as string;
    };
    const command = (amountCents: bigint, voucherFileId: string, account?: typeof debtor) => {
      return {
        amountCents: amountCents.toString(), paidAt: "2026-11-10", paymentMethod: "银行转账",
        confirmationPassword: password, voucherFileId,
        ...(account ? { registeredFunding: { scopeKey: account.scopeKey, expectedRegistrationId: account.registration.id,
          sourceAllocations: [{ sourceBatchId: account.registration.sources[0]!.id, amountCents: amountCents.toString() }] } } : {})
      };
    };
    const firstCommand = command(debtorAmount, await voucher("UPLOAD_OWN"), debtor);
    const first = await exchange("PAY_OWN", `${root}/payments`, 201, token, firstCommand);
    expect(first).toMatchObject({ status: "partially_paid", registeredFunding: { actualPayerCompanyId: debtor.company.id, relationshipEntryId: null } });
    const secondCommand = command(proxyAmount, await voucher("UPLOAD_PROXY"), proxy);
    const second = await exchange("PAY_PROXY", `${root}/payments`, 201, token, secondCommand);
    expect(second).toMatchObject({ status: "paid", registeredFunding: { actualPayerCompanyId: proxy.company.id, relationshipEntryId: expect.any(String) } });
    expect(await exchange("REPLAY_PROXY", `${root}/payments`, 201, token, secondCommand)).toEqual(second);
    await exchange("MISMATCH_PROXY", `${root}/payments`, 409, token, { ...secondCommand, note: "不同重放" });
    const detail = await exchange("PAYMENT_HISTORY", root, 200, token);
    expect(detail).toMatchObject({ originalDebtorCompanyId: debtor.company.id, paymentExecutions: expect.arrayContaining([
      expect.objectContaining({ id: first.id, registeredFunding: { actualPayerCompanyId: debtor.company.id, actualPayerName: debtor.company.name, originalDebtorCompanyId: debtor.company.id, relationshipEntryId: null } }),
      expect.objectContaining({ id: second.id, registeredFunding: { actualPayerCompanyId: proxy.company.id, actualPayerName: proxy.company.name, originalDebtorCompanyId: debtor.company.id, relationshipEntryId: second.registeredFunding.relationshipEntryId } })
    ]) });
    const oldPath = `/expense-claims/${oldClaim.id}/payments`;
    const old = await exchange("REPLAY_HISTORY", oldPath, 201, token, command(100n, oldVoucher.id));
    expect(old.id).toBe(oldPayment.id);
    expect(old).not.toHaveProperty("registeredFunding");
    await exchange("HISTORY_RECLASSIFY_DENIED", oldPath, 409, token, command(100n, oldVoucher.id, debtor));

    const ids = [first.id, second.id] as string[];
    const funding = await db.registeredOperationalPayment.findMany({
      where: { expenseExecutionId: { in: ids } },
      include: { allocations: true, registration: { include: { sources: true } } }
    });
    expect(funding).toHaveLength(2);
    for (const [executionId, account, amount, leftover] of [
      [first.id, debtor, debtorAmount, "16.0000"], [second.id, proxy, proxyAmount, "14.0000"]
    ] as const) {
      const row = funding.find((item) => item.expenseExecutionId === executionId);
      expect(row).toMatchObject({ originalDebtorCompanyId: debtor.company.id, actualPayerCompanyId: account.company.id, amountCents: amount });
      expect(row?.registration.balanceYuan?.toFixed(4)).toBe(leftover);
      expect(row?.registration.sources.map((source) => source.amountYuan.toFixed(4))).toEqual([leftover]);
      expect(row?.allocations).toMatchObject([{ sourceBatchId: account.registration.sources[0]!.id, amountCents: amount }]);
    }
    expect(funding.find((row) => row.expenseExecutionId === second.id)?.id).toBe(second.registeredFunding.relationshipEntryId);
    const facts = await db.operatingFact.findMany({ where: {
      sourceType: "expense_claim_payment_execution", sourceBusinessId: { in: ids }
    }, include: { impacts: true } });
    expect(facts).toHaveLength(2);
    for (const [id, payer] of [[first.id, debtor.company.id], [second.id, proxy.company.id]]) {
      const fact = facts.find((item) => item.sourceBusinessId === id);
      expect(fact).toMatchObject({ entryKind: "original", actualPayerSubjectId: payer });
      expect(fact?.impacts.map((impact) => impact.impactKind).sort()).toEqual(["company_project_funds_decrease", "payable_decrease"]);
    }
    expect(await db.expenseClaimPaymentExecution.count({ where: { expenseClaimId: claim.id } })).toBe(2);
    expect(await db.projectFundingAllocation.count({ where: { executionId: { in: ids } } })).toBe(0);
    expect(await db.projectFundingAllocation.count({ where: { executionId: oldPayment.id } })).toBe(1);
    expect(await db.registeredOperationalPayment.count({ where: { expenseExecutionId: oldPayment.id } })).toBe(0);
    // V1 source documents are historical. The current public create endpoint emits V2,
    // which has no V1 expense-payment entry. Start from a valid archived V1 fixture.
    const reviewers: string[] = [];
    for (const role of ["comprehensive_director", "project_manager", "finance_director", "chairman"]) {
      const actor = await db.user.create({
        data: { name: `合成采购审批${role}`, phone: `${role}-${suffix}`, passwordHash: await hash(password, 4),
          mustChangePassword: false }
      });
      const position = await db.position.upsert({ where: { key: role }, update: {}, create: { key: role, name: role } });
      await db.userPosition.create({ data: { userId: actor.id, positionId: position.id,
        projectId: role === "project_manager" ? project.id : null } });
      const auth = await exchange(`PROCUREMENT_LOGIN_${reviewers.length}`, "/auth/login", 201, undefined, {
        phone: actor.phone, password
      });
      const reviewer: string = auth.tokens.accessToken;
      const form = new FormData();
      form.append("file", new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=", "base64")], { type: "image/png" }), "合成审批签名.png");
      await exchange(`PROCUREMENT_SIGNATURE_${reviewers.length}`, "/me/signature/canvas", 201, reviewer, form);
      reviewers.push(reviewer);
    }
    const archiveFile = await db.fileObject.create({
      data: { bucket: "expense-fnd19-test", objectKey: `archive-${suffix}`, originalName: "合成采购归档",
        mimeType: "application/pdf", sizeBytes: 1, uploadedByUserId: owner.id, storageStatus: "active" }
    });
    const procurement = await db.generalProcurement.create({
      data: { code: `CG-${suffix}`, requestKey: randomUUID(), creationFingerprint: "b".repeat(64),
        projectId: project.id, companyEntityId: debtor.company.id, companyNameSnapshot: debtor.company.name,
        applicantUserId: owner.id, applicantNameSnapshot: owner.name, category: "office_supplies",
        reason: "历史综合采购原单", requestedAmountCents: 200n, requestProtocolVersion: 1, status: "archived",
        revision: 6, archivedByUserId: owner.id, archivedAt: start, archiveFileId: archiveFile.id, archiveNote: "合成历史原单" }
    });
    const procurementPath = `/general-procurements/${procurement.id}`;
    const requestPayment = {
      generalProcurementId: procurement.id, generalProcurementRequestKey: randomUUID(), claimType: "incidental_expense",
      incidentalExpenseCategory: "procurement_office_supplies", requestedAmountCents: "200",
      projectId: project.id, companyEntityId: debtor.company.id, payeeName: "合成办公用品商", reason: "采购合同付款"
    };
    await exchange("PROCUREMENT_WRONG_DEBTOR", "/expense-claims", 400, reviewers[0], {
      ...requestPayment, companyEntityId: proxy.company.id
    });
    const linked = await exchange("PROCUREMENT_CREATE_EXPENSE", "/expense-claims", 201, reviewers[0], requestPayment);
    const linkedExpensePath = `/expense-claims/${linked.id}`;
    await exchange("PROCUREMENT_SUBMIT_EXPENSE", `${linkedExpensePath}/submission`, 201, reviewers[0], {});
    for (const [index, reviewer] of reviewers.entries()) {
      const detail = await exchange(`PROCUREMENT_DUTY_${index}`, linkedExpensePath, 200, reviewer);
      const { approvalInstanceId, actionableDuties } = detail.approval;
      const approval = await exchange(`PROCUREMENT_APPROVE_EXPENSE_${index}`, `${linkedExpensePath}/approval`, 201, reviewer, {
        decision: "approve", approvalInstanceId, approvalDutyIndex: actionableDuties[0].index,
        ...(index === 0 ? { selfReviewReason: "合成综合部发起核对", confirmationPassword: password } : {})
      });
      expect(approval.status).toBe(index === reviewers.length - 1 ? "approved_pending_payment" : "approval_pending");
    }
    const previousProxyRegistration = funding.find((row) => row.expenseExecutionId === second.id)!.registration;
    const registered = await exchange("PROCUREMENT_PAYMENT", `${linkedExpensePath}/payments`, 201, token,
      command(200n, await voucher("PROCUREMENT_VOUCHER", linkedExpensePath), { ...proxy, registration: previousProxyRegistration }));
    expect(registered).toMatchObject({ status: "paid", registeredFunding: {
      actualPayerCompanyId: proxy.company.id, relationshipEntryId: expect.any(String)
    } });
    expect(await exchange("PROCUREMENT_EXPENSE_TRACE", linkedExpensePath, 200, token)).toMatchObject({
      generalProcurement: { id: procurement.id, code: procurement.code }, originalDebtorCompanyId: debtor.company.id,
      paymentExecutions: [expect.objectContaining({ id: registered.id, registeredFunding: {
        originalDebtorCompanyId: debtor.company.id, actualPayerCompanyId: proxy.company.id,
        actualPayerName: proxy.company.name, relationshipEntryId: registered.registeredFunding.relationshipEntryId
      } })]
    });
    expect(await exchange("PROCUREMENT_ORIGIN_TRACE", procurementPath, 200, reviewers[0])).toMatchObject({
      id: procurement.id, companyEntityId: debtor.company.id, status: "archived",
      payments: [expect.objectContaining({ id: linked.id, status: "paid", fundedAmountCents: "200" })]
    });
    const procurementFunding = await db.registeredOperationalPayment.findUniqueOrThrow({
      where: { expenseExecutionId: registered.id }, include: { registration: { include: { sources: true } } }
    });
    expect(procurementFunding).toMatchObject({ id: registered.registeredFunding.relationshipEntryId,
      originalDebtorCompanyId: debtor.company.id, actualPayerCompanyId: proxy.company.id, amountCents: 200n });
    expect(procurementFunding.registration.balanceYuan?.toFixed(4)).toBe("12.0000");
    expect(procurementFunding.registration.sources.map((source) => source.amountYuan.toFixed(4))).toEqual(["12.0000"]);
    const procurementFacts = await db.operatingFact.findMany({ where: { sourceBusinessId: { in: [linked.id, registered.id] } },
      include: { impacts: true } });
    expect(procurementFacts).toHaveLength(2);
    expect(procurementFacts.find((fact) => fact.sourceBusinessId === linked.id)?.impacts.map((impact) => impact.impactKind).sort())
      .toEqual(["confirmed_cost", "payable_increase"]);
    const procurementPaymentFact = procurementFacts.find((fact) => fact.sourceBusinessId === registered.id);
    expect(procurementPaymentFact).toMatchObject({ actualPayerSubjectId: proxy.company.id, entryKind: "original" });
    expect(procurementPaymentFact?.impacts.map((impact) => impact.impactKind).sort())
      .toEqual(["company_project_funds_decrease", "payable_decrease"]);
    process.stdout.write(`EXPENSE_FND19_ACCEPTED ${JSON.stringify({ statuses, sourceBalances: ["16.0000", "14.0000"],
      sameCompanyDebt: 0, proxyDebt: 1, originalFacts: 2, extraCost: 0, legacyAllocationsForRegistered: 0,
      procurementLinked: true, procurementProxyDebt: 1, procurementBalance: "12.0000", procurementApprovalCostCount: 1,
      procurementPaymentExtraCost: 0 })}\n`);
  } finally {
    await app.close();
  }
}, 120_000);
