import { randomUUID } from "node:crypto";
import { hash } from "bcryptjs";
import * as ExcelJS from "exceljs";
import { assertOrderedIssue333Database } from "../../test-support/ordered-issue333-fixture";
import { PrismaService } from "./prisma.service";
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { CompanyRoleResolverService } from "../auth/company-role-resolver.service";
import { JwtTokenService } from "../auth/jwt-token.service";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { BusinessNumberingService } from "../business-number/business-numbering.service";
import { ClearingReconciliationReaderService } from "../clearing/clearing-reconciliation-reader.service";
import { ExpenseClaimService } from "../expense-claim/expense-claim.service";
import {
  EXPENSE_CLAIM_APPROVAL_SOURCE_TYPE,
  EXPENSE_CLAIM_PAYMENT_EXECUTION_SOURCE_TYPE
} from "../expense-claim/expense-claim-operating-source.adapter";
import { FundFlowService } from "../fund-flow/fund-flow.service";
import { PublicCashHandoverService } from "../fund-account/public-cash-handover.service";
import { OperatingCostAttributionService } from "../operating-ledger/operating-cost-attribution.service";
import { createOperatingSourceRegistry } from "../operating-ledger/operating-ledger.module";
import { OperatingLedgerService } from "../operating-ledger/operating-ledger.service";
import { OperatingSourceReplayService } from "../operating-ledger/operating-source-replay.service";
import { OperatingProjectionService } from "../operating-projection/operating-projection.service";

const run = process.env.ISSUE418_CASH_ATTRIBUTION_RUN === "1" ? describe : describe.skip;

// These cases start from synthetic approved expense sources in a separate project.
// Cash payment and attribution use the same producers as the application.
run("issue #418 public cash attribution and fund flow on the ordered ledger", () => {
  let prisma: PrismaService;
  let scope: Awaited<ReturnType<typeof seedCashCase>>;

  beforeAll(async () => {
    const raw = process.env.ISSUE418_CASH_ATTRIBUTION_DATABASE_URL;
    if (!raw) throw new Error("ISSUE418_CASH_ATTRIBUTION_DATABASE_REQUIRED");
    prisma = new PrismaService({ datasources: { db: { url: assertOrderedIssue333Database(raw) } } });
    scope = await seedCashCase(prisma);
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("成本归属读侧分列承担公司、待归属与公共现金来源", async () => {
    const { projectId, directorId, companyA, companyB, audit, auth, visibility } = scope;
    const projections = new OperatingProjectionService(
      prisma, visibility, new ClearingReconciliationReaderService(prisma, new CompanyRoleResolverService(prisma)),
      audit, auth
    );
    const view = await projections.getProjectView(directorId, { projectId });
    expect(view.costAttribution.unattributedCostCents).toBe("8700");
    expect(view.costAttribution.publicCashCostCents).toBe("1700");
    expect(view.costAttribution.byBearingCompany).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: companyA.versionId, name: "甲公司", costCents: "3000" }),
      expect.objectContaining({ id: companyB.versionId, name: "乙公司", costCents: "1000" })
    ]));
  });

  it("G4 公共现金待归属确认后转正、幂等且不新增成本", async () => {
    const { projectId, staffId, directorId, bearing, factId, costLinkId, audit, auth, visibility } = scope;
    const attributions = new OperatingCostAttributionService(prisma, visibility, audit, auth);
    const before = await prisma.operatingFact.count({ where: { projectId } });
    const candidates = await attributions.list(projectId, staffId);
    expect(candidates.candidates.find(row => row.factId === factId && row.expenseCashCostLinkId === costLinkId))
      .toEqual(expect.objectContaining({ amountCents: "700", activeStatus: null }));
    const request = {
      companyEntityId: bearing.id, reason: "公共现金支出由丙公司承担",
      idempotencyKey: randomUUID(), expenseCashCostLinkId: costLinkId
    };
    const requested = await attributions.request(projectId, factId, request, staffId);
    expect(requested).toMatchObject({ status: "pending_review", attributedAmountCents: "700" });
    const repeated = await attributions.request(projectId, factId, request, staffId);
    expect(repeated.id).toBe(requested.id);
    const confirmed = await attributions.review(projectId, requested.id,
      { decision: "confirm", revision: requested.revision, reason: "财务主管核对" }, directorId);
    expect(confirmed).toMatchObject({ status: "confirmed", companyName: "丙公司", factId, attributedAmountCents: "700" });
    const fact = await prisma.operatingFact.findUniqueOrThrow({ where: { id: factId } });
    expect(fact.costBearingCompanySubjectId).toBeNull();
    expect(fact.amountCents).toBe(700n);
    expect(await prisma.operatingFact.count({ where: { projectId } })).toBe(before);
    const projections = new OperatingProjectionService(
      prisma, visibility, new ClearingReconciliationReaderService(prisma, new CompanyRoleResolverService(prisma)),
      audit, auth
    );
    const view = await projections.getProjectView(directorId, { projectId });
    expect(view.costAttribution.unattributedCostCents).toBe("8000");
    expect(view.costAttribution.byBearingCompany).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: bearing.versionId, name: "丙公司", costCents: "700" })
    ]));
    expect(view.operating.confirmedCostCents).toBe("12700");
    const after = await attributions.list(projectId, directorId);
    expect(after.candidates.some(row => row.factId === factId)).toBe(false);
  });

  it("G5 资金流水与经营事实一致，支持类型过滤与导出", async () => {
    const { projectId, directorId, assignedCash, pendingCash, visibility, audit } = scope;
    const fundFlow = new FundFlowService(prisma, visibility, audit);
    const page = await fundFlow.list(projectId, directorId, {});
    const paymentRows = [pendingCash, assignedCash].map(cash => expect.objectContaining({
      impactId: cash.impactId, holderKind: "public_cash", holderName: "公共现金",
      direction: "out", type: "payment", amountCents: cash.amountCents.toString(),
      sourceBusinessCode: cash.sourceBusinessCode
    }));
    expect(page.rows).toEqual(paymentRows);
    const payments = await fundFlow.list(projectId, directorId, { type: "payment" });
    expect(payments.rows).toEqual(paymentRows);
    const refunds = await fundFlow.list(projectId, directorId, { type: "refund" });
    expect(refunds.rows).toHaveLength(0);

    const exported = await fundFlow.export(projectId, directorId, {});
    expect(exported.buffer.length).toBeGreaterThan(0);
    expect(exported.fileName).toContain("资金流水");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(exported.buffer as unknown as ExcelJS.Buffer);
    const sheet = workbook.getWorksheet("资金流水")!;
    expect(sheet.rowCount).toBe(4); // headings, two payments, totals
    expect([2, 3].map(row => [sheet.getCell(row, 7).value, sheet.getCell(row, 10).value])).toEqual([
      [7, pendingCash.sourceBusinessCode], [10, assignedCash.sourceBusinessCode]
    ]);
    expect(await prisma.auditLog.findMany({
      where: { action: "fund_flow.export", actorUserId: directorId, businessId: projectId }
    })).toMatchObject([{ metadata: { rowCount: 2, type: null } }]);
  });
});

async function seedCashCase(prisma: PrismaService) {
  const secret = process.env.OPERATING_LEDGER_DB_WRITE_SECRET;
  if (!secret || !/^[a-f0-9]{64}$/u.test(secret)) throw new Error("ISSUE418_ISOLATED_LEDGER_SECRET");
  expect(await prisma.$executeRaw`
    INSERT INTO public."OperatingLedgerWriteSecret" ("id", "secretHash")
    VALUES (1, public.crypt(${secret}, public.gen_salt('bf'))) ON CONFLICT ("id") DO NOTHING
  `).toBe(1);
  const audit = new AuditService(prisma);
  const auth = new AuthService(prisma, new JwtTokenService(), audit);
  const visibility = new ProjectVisibilityService(prisma);
  const password = randomUUID();
  const enabledAt = new Date("2026-10-01T00:00:00.000Z");
  const approvedAt = new Date("2026-11-01T00:00:00.000Z");
  const project = await prisma.project.create({ data: {
    code: "XM-418-CASH", name: "公共现金归属与流水隔离项目", createdAt: enabledAt
  } });
  async function actor(key: string, name: string) {
    const user = await prisma.user.create({ data: { name, isActive: true, passwordHash: await hash(password, 4) } });
    const role = await prisma.position.upsert({ where: { key }, update: {}, create: { key, name } });
    await prisma.userPosition.create({ data: { userId: user.id, positionId: role.id } });
    await prisma.projectRosterMember.create({ data: { projectId: project.id, userId: user.id } });
    return user;
  }
  const keeper = await actor("comprehensive_director", "合成现金保管人");
  const staff = await actor("finance_staff", "合成财务经办");
  const director = await actor("finance_director", "合成财务主管");
  const affiliate = await prisma.businessParty.create({ data: {
    name: "合成施工企业", normalizedName: "issue418-cash-enterprise",
    unifiedSocialCreditCode: "91350211M000100Y46", createdByUserId: keeper.id
  } });
  const enterprise = await prisma.businessPartyVersion.create({ data: {
    businessPartyId: affiliate.id, versionNo: 1, snapshot: { name: affiliate.name }, createdByUserId: keeper.id
  } });
  await prisma.projectAffiliateAssignment.create({ data: {
    projectId: project.id, businessPartyId: affiliate.id, businessPartyVersionId: enterprise.id,
    affiliateNameSnapshot: affiliate.name, affiliateCreditCodeSnapshot: affiliate.unifiedSocialCreditCode,
    effectiveFrom: enabledAt, changeReason: "合成验收", assignedByUserId: keeper.id
  } });
  async function participatingCompany(name: string, credit: string) {
    const company = await prisma.companyEntity.create({ data: {
      name, unifiedSocialCreditCode: credit, currentVersionNo: 1, dataStatus: "complete"
    } });
    const version = await prisma.companyEntityVersion.create({ data: {
      companyEntityId: company.id, versionNo: 1, name, unifiedSocialCreditCode: credit,
      isActive: true, action: "create", actorUserId: keeper.id
    } });
    await prisma.projectParticipatingCompany.create({ data: {
      projectId: project.id, companyEntityId: company.id, companyEntityVersionId: version.id,
      companyNameSnapshot: name, companyCreditCodeSnapshot: credit,
      effectiveFrom: enabledAt, changeReason: "合成验收", addedByUserId: keeper.id
    } });
    return { id: company.id, name, versionId: version.id };
  }
  const companyA = await participatingCompany("甲公司", "91110108772558259B");
  const companyB = await participatingCompany("乙公司", "91440300708461136T");
  const bearing = await participatingCompany("丙公司", "91310115MA1K3X9E25");
  await prisma.project.update({ where: { id: project.id }, data: { operatingLedgerEffectiveDate: enabledAt } });
  const account = await prisma.registeredFundAccount.create({ data: { kind: "public_cash", scopeKey: "public_cash" } });
  const opening = await prisma.fundAccountBalanceRegistration.create({ data: {
    accountId: account.id, version: 1, kind: "opening", status: "confirmed", balanceYuan: "30.0000",
    asOfDate: "2026-10-02", evidenceReference: "合成原始盘点记录", reconciliationNote: "隔离核对", reason: "隔离期初",
    idempotencyKey: randomUUID(), payloadFingerprint: "a".repeat(64), createdByUserId: keeper.id,
    confirmedByUserId: keeper.id, confirmedAt: enabledAt,
    sources: { create: [{ lineNo: 1, amountYuan: "30.0000", sourceStatus: "known",
      sourceName: "合成出资来源", projectStatus: "pending" }] }
  }, include: { sources: true } });
  await expect(new PublicCashHandoverService(prisma, audit).claimInitial(keeper.id,
    { expectedRevision: 0, idempotencyKey: randomUUID() })).resolves.toMatchObject({ custodianId: keeper.id });

  const replay = new OperatingSourceReplayService(
    prisma, new OperatingLedgerService(prisma), createOperatingSourceRegistry()
  );
  async function approvedExpense(code: string, amountCents: bigint, companyId: string | null) {
    const id = randomUUID();
    const approval = await prisma.approvalInstance.create({ data: {
      flowType: "expense_claim.approve", businessType: "expense_claim", businessId: id, status: "approved",
      currentNodeIndex: 0, frozenNodes: [], applicantUserId: staff.id, createdAt: approvedAt
    } });
    await prisma.approvalActionLog.create({ data: {
      approvalInstanceId: approval.id, action: "approve", actorUserId: director.id, createdAt: approvedAt
    } });
    const claim = await prisma.expenseClaim.create({ data: {
      id, code, claimType: "incidental_expense", incidentalExpenseCategory: "temporary_service",
      projectId: project.id, status: "approved_pending_payment", approvedAt, submittedAt: approvedAt, createdAt: approvedAt,
      companyEntityId: companyB.id, companyEntityNameSnapshot: companyB.name, costBearingCompanySpecified: true,
      costBearingCompanyEntityId: companyId, applicantUserId: staff.id, applicantNameSnapshot: staff.name,
      handledByUserId: staff.id, handledByNameSnapshot: staff.name, reason: "隔离费用归属",
      payeeNameSnapshot: "合成服务方", requestedAmountCents: amountCents, companyPayableAmountCents: amountCents,
      approvalInstanceId: approval.id
    } });
    await expect(prisma.$transaction(tx => replay.appendConfirmedSourceIfEnabledInTransaction(tx, {
      projectId: project.id, sourceType: EXPENSE_CLAIM_APPROVAL_SOURCE_TYPE, sourceBusinessId: claim.id
    }, director.id))).resolves.toMatchObject({ created: true, sourceBusinessId: claim.id });
    return claim;
  }
  const expense = new ExpenseClaimService(prisma, new BusinessNumberingService(), audit, auth, visibility,
    undefined, undefined, undefined, replay);
  async function payInPublicCash(
    claim: Awaited<ReturnType<typeof approvedExpense>>, paidAt: string, registrationId: string, sourceBatchId: string
  ) {
    const amountCents = claim.requestedAmountCents;
    const fact = await prisma.operatingFact.findFirstOrThrow({ where: {
      projectId: project.id, sourceType: EXPENSE_CLAIM_APPROVAL_SOURCE_TYPE, sourceBusinessId: claim.id
    }, include: { impacts: { where: { impactKind: "confirmed_cost" } } } });
    expect(fact.impacts.map(row => row.amountCents)).toEqual([amountCents]);
    const costImpactId = fact.impacts[0]!.id;
    const voucher = await prisma.fileObject.create({ data: {
      bucket: "private-local", objectKey: "issue418-cash/" + randomUUID(), originalName: "合成付款凭证.png",
      mimeType: "image/png", sizeBytes: 64, uploadedByUserId: keeper.id, contentSha256: "a".repeat(64)
    } });
    const execution = await expense.recordPayment(claim.id, keeper.id, {
      amountCents: amountCents.toString(), paidAt, voucherFileId: voucher.id,
      paymentMethod: "现金", confirmationPassword: password,
      registeredFunding: { scopeKey: "public_cash", expectedRegistrationId: registrationId,
        sourceAllocations: [{ sourceBatchId, amountCents: amountCents.toString() }],
        costAllocations: [{ costImpactId, amountCents: amountCents.toString() }]
      }
    });
    expect(execution).toMatchObject({ status: "paid", registeredFunding: { actualPayerKind: "public_cash" } });
    const link = await prisma.expensePublicCashCostLink.findFirstOrThrow({ where: { costImpactId } });
    expect(link.amountCents).toBe(amountCents);
    const cashImpact = await prisma.operatingImpactEntry.findFirstOrThrow({ where: {
      projectId: project.id, sourceType: EXPENSE_CLAIM_PAYMENT_EXECUTION_SOURCE_TYPE,
      sourceBusinessId: execution.id, impactKind: "public_cash_funds_decrease"
    } });
    return {
      factId: fact.id, costLinkId: link.id, impactId: cashImpact.id, executionId: execution.id,
      amountCents, sourceBusinessCode: `${claim.code}/实付/${execution.id}`
    };
  }

  await approvedExpense("合成待归属-8000", 8000n, null);
  await approvedExpense("合成已归属-3000", 3000n, companyA.id);
  const assignedClaim = await approvedExpense("合成已归属-1000", 1000n, companyB.id);
  const pendingClaim = await approvedExpense("现金待归属-001", 700n, null);
  const assignedCash = await payInPublicCash(assignedClaim, "2026-11-19", opening.id, opening.sources[0]!.id);
  const firstPayment = await prisma.registeredOperationalPayment.findUniqueOrThrow({
    where: { expenseExecutionId: assignedCash.executionId },
    select: { registration: { select: { id: true, sources: { select: { id: true } } } } }
  });
  const next = firstPayment.registration;
  expect(next.sources).toHaveLength(1);
  const pendingCash = await payInPublicCash(pendingClaim, "2026-11-20", next.id, next.sources[0]!.id);
  return { projectId: project.id, staffId: staff.id, directorId: director.id, audit, auth, visibility,
    companyA, companyB, bearing, assignedCash, pendingCash, factId: pendingCash.factId, costLinkId: pendingCash.costLinkId };
}
