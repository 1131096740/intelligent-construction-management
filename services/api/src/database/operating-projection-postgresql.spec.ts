import { BadRequestException, PayloadTooLargeException } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";

import { AuditService } from "../audit/audit.service";
import { CompanyRoleResolverService } from "../auth/company-role-resolver.service";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { ClearingService } from "../clearing/clearing.service";
import { ClearingReconciliationReaderService } from "../clearing/clearing-reconciliation-reader.service";
import { FileService } from "../file/file.service";
import { FundsWorkbenchService } from "../funds-workbench/funds-workbench.service";
import { MeService } from "../me/me.service";
import { NecessaryExpenseReserveOperatingSourceAdapter } from "../necessary-expense-reserve/necessary-expense-reserve-operating-source.adapter";
import { NecessaryExpenseReserveService } from "../necessary-expense-reserve/necessary-expense-reserve.service";
import {
  OperatingLedgerService,
  type AppendOperatingFactInput,
  type OperatingImpactInput,
  type OperatingSubjectReference
} from "../operating-ledger/operating-ledger.service";
import { OperatingSourceAdapterRegistry } from "../operating-ledger/operating-source-adapter";
import { OperatingSourceReplayService } from "../operating-ledger/operating-source-replay.service";
import { OperatingProjectionService } from "../operating-projection/operating-projection.service";
import { ProjectOperatingProfileService } from "../project/project-operating-profile.service";
import {
  ProjectService,
  upstreamFundFactSnapshotQuery
} from "../project/project.service";
import { ProjectFundDisputeOperatingSourceAdapter } from "../project-fund-dispute/project-fund-dispute-operating-source.adapter";
import { ProjectFundDisputeService } from "../project-fund-dispute/project-fund-dispute.service";

const RUN_POSTGRES = process.env.RUN_POL108_OPERATING_PROJECTION_PG16 === "1";
const describePostgres = RUN_POSTGRES ? describe : describe.skip;
const PROJECT_ID = "seed-project-jgxm-001";
const WRITER_ID = "seed-user-cashier";
const READER_ID = "seed-user-finance-director";
const PROJECT_MANAGER_ID = "seed-user-project-manager";
const OCCURRED_AT = new Date("2026-09-01T08:00:00.000Z");
const CONFIRMED_AT = new Date("2026-09-10T08:00:00.000Z");
const CUTOFF_DATE = "2026-09-05";

function isDetailFindManyQuery(value: unknown): value is {
  select: Record<string, unknown> & { fact: { select: Record<string, unknown> } };
} {
  if (!value || typeof value !== "object") return false;
  const select = (value as { select?: unknown }).select;
  if (!select || typeof select !== "object") return false;
  const fact = (select as { fact?: unknown }).fact;
  return Boolean(
    fact && typeof fact === "object" &&
    (fact as { select?: unknown }).select &&
    typeof (fact as { select?: unknown }).select === "object"
  );
}

describePostgres("POL-108 operating projection PostgreSQL 16", () => {
  jest.setTimeout(15 * 60_000);
  const prisma = new PrismaClient();
  const audit = new AuditService();
  const ledger = new OperatingLedgerService(prisma as never);
  const reserveAdapter = new NecessaryExpenseReserveOperatingSourceAdapter();
  const disputeAdapter = new ProjectFundDisputeOperatingSourceAdapter();
  const registry = new OperatingSourceAdapterRegistry(
    [reserveAdapter, disputeAdapter],
    [reserveAdapter.sourceType, disputeAdapter.sourceType]
  );
  const replay = new OperatingSourceReplayService(prisma as never, ledger, registry);
  const visibility = new ProjectVisibilityService(prisma as never);
  const roles = new CompanyRoleResolverService(prisma as never);
  const clearing = new ClearingReconciliationReaderService(prisma as never, roles);
  const clearingWorkflow = new ClearingService(
    prisma as never,
    roles,
    ledger,
    audit
  );
  const files = new FileService(prisma as never, audit);
  const reserveService = new NecessaryExpenseReserveService(prisma as never, replay, audit);
  const disputeService = new ProjectFundDisputeService(
    prisma as never,
    replay,
    audit,
    clearing,
    files
  );
  const exportConfirmation = {
    confirmPassword: jest.fn().mockResolvedValue(undefined)
  };
  const projection = new OperatingProjectionService(
    prisma as never,
    visibility,
    clearing,
    audit,
    exportConfirmation as never
  );
  const projects = new ProjectService(
    prisma as never,
    audit,
    undefined,
    undefined,
    undefined,
    projection
  );
  const me = new MeService(prisma as never, files, audit);
  const funds = new FundsWorkbenchService(me, projection);
  const operatingProfile = new ProjectOperatingProfileService(prisma as never, audit);
  const runId = randomUUID();
  let affiliate: {
    assignmentId: string;
    businessPartyId: string;
    businessPartyVersionId: string;
    name: string;
    creditCode?: string;
  };
  let enterprise: OperatingSubjectReference;
  let company: OperatingSubjectReference;
  let companyEntityId: string;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL || process.env.NODE_ENV === "production") {
      throw new Error("POL-108 PG16 测试必须连接非生产 disposable database");
    }
    const writeSecret = process.env.OPERATING_LEDGER_DB_WRITE_SECRET;
    if (!writeSecret) {
      throw new Error("POL-108 PG16 测试缺少一次性经营账写入密钥");
    }
    await prisma.$connect();
    await prisma.$executeRaw`
      INSERT INTO "OperatingLedgerWriteSecret" ("id", "secretHash")
      VALUES (1, crypt(${writeSecret}, gen_salt('bf')))
      ON CONFLICT ("id") DO UPDATE SET "secretHash" = EXCLUDED."secretHash"
    `;
    await operatingProfile.updateProfile(PROJECT_ID, WRITER_ID, {
      operatingLedgerEffectiveDate: "2026-08-01"
    });
    const assignment = await prisma.projectAffiliateAssignment.findUniqueOrThrow({
      where: { id: "seed-construction-enterprise-assignment-jgxm-001" },
      select: {
        id: true,
        businessPartyId: true,
        businessPartyVersionId: true,
        affiliateNameSnapshot: true,
        affiliateCreditCodeSnapshot: true
      }
    });
    const participant = await prisma.projectParticipatingCompany.findFirstOrThrow({
      where: { projectId: PROJECT_ID },
      select: { companyEntityId: true, companyEntityVersionId: true }
    });
    affiliate = {
      assignmentId: assignment.id,
      businessPartyId: assignment.businessPartyId,
      businessPartyVersionId: assignment.businessPartyVersionId,
      name: assignment.affiliateNameSnapshot,
      ...(assignment.affiliateCreditCodeSnapshot
        ? { creditCode: assignment.affiliateCreditCodeSnapshot }
        : {})
    };
    enterprise = {
      kind: "construction_enterprise",
      id: assignment.businessPartyVersionId
    };
    companyEntityId = participant.companyEntityId;
    company = {
      kind: "participating_company",
      id: participant.companyEntityVersionId
    };

    await append("owner_settlement", {
      factKind: "owner_settlement",
      amountCents: 1_000n,
      direction: "inflow",
      subjects: {
        debtor: { kind: "owner", id: `owner-${runId}` },
        creditor: enterprise
      },
      impacts: [
        impact("income", "confirmed_income", 1_000n, "increase"),
        impact("receivable", "receivable_increase", 1_000n, "increase")
      ]
    });
    await append("downstream_settlement", {
      factKind: "downstream_settlement",
      evidenceLevel: "B",
      amountCents: 300n,
      direction: "outflow",
      subjects: {
        debtor: enterprise,
        creditor: { kind: "downstream_counterparty", id: `vendor-${runId}` }
      },
      impacts: [
        impact("cost", "confirmed_cost", 300n, "increase", {
          costCategoryCode: "other_project_cost"
        }),
        impact("payable", "payable_increase", 300n, "increase")
      ]
    });
    await append("owner_payment", {
      factKind: "owner_payment",
      amountCents: 800n,
      direction: "inflow",
      subjects: {
        actualPayer: { kind: "owner", id: `owner-${runId}` },
        payee: enterprise
      },
      impacts: [
        impact("enterprise-cash", "construction_enterprise_funds_increase", 800n, "increase", {
          subjectRole: "payee",
          subject: enterprise
        }),
        impact("receivable-paid", "receivable_decrease", 800n, "decrease")
      ]
    });
    await append("fund_movement", {
      factKind: "fund_movement",
      amountCents: 100n,
      direction: "neutral",
      subjects: { actualPayer: enterprise, payee: company },
      impacts: [
        impact("enterprise-transfer", "construction_enterprise_funds_decrease", 100n, "decrease", {
          subjectRole: "actual_payer",
          subject: enterprise
        }),
        impact("company-transfer", "company_project_funds_increase", 100n, "increase", {
          subjectRole: "payee",
          subject: company
        }),
        impact("inter-subject", "inter_subject_balance_increase", 100n, "increase")
      ]
    });
    await append("payment_execution", {
      factKind: "downstream_payment",
      amountCents: 100n,
      direction: "outflow",
      sourceSnapshot: {
        schema: "pol108_fixture/V1",
        paymentRequestId: `payment-request-${runId}`
      },
      subjects: {
        actualPayer: company,
        payee: { kind: "downstream_counterparty", id: `vendor-${runId}` }
      },
      impacts: [
        impact("payable-paid", "payable_decrease", 100n, "decrease"),
        impact("company-cash", "company_project_funds_decrease", 100n, "decrease", {
          subjectRole: "actual_payer",
          subject: company
        })
      ]
    });
    await append("project_cash_restriction", {
      factKind: "project_cash_restriction",
      evidenceLevel: "B",
      amountCents: 150n,
      direction: "neutral",
      subjects: {},
      impacts: [
        impact("estimated-clearing", "estimated_clearing_expense", 40n, "increase", {
          costCategoryCode: "other_project_cost"
        }),
        impact("frozen", "construction_enterprise_funds_freeze", 10n, "increase", {
          subjectRole: "fund_holder",
          subject: enterprise
        }),
        impact("advance", "company_advance_for_project_increase", 50n, "increase", {
          subjectRole: "fund_holder",
          subject: company
        }),
        impact("temporary-distribution", "temporary_profit_distribution", 50n, "increase", {
          subjectRole: "fund_holder",
          subject: company
        })
      ]
    });
    await appendRestrictionSource({
      sourceType: "project_necessary_expense_reserve_entry",
      amountCents: 30n
    });
    await appendRestrictionSource({
      sourceType: "project_fund_dispute_entry",
      amountCents: 20n
    });
    await append("operating_takeover", {
      factKind: "historical_gap",
      evidenceLevel: "C",
      amountCents: 75n,
      direction: "neutral",
      subjects: { payee: enterprise },
      impacts: [
        impact("gap", "evidence_gap_notice", 75n, "notice")
      ]
    });
    await append("future_owner_settlement", {
      factKind: "owner_settlement",
      amountCents: 9_999n,
      direction: "inflow",
      occurredAt: new Date("2026-09-06T08:00:00.000Z"),
      subjects: {
        debtor: { kind: "owner", id: `owner-${runId}` },
        creditor: enterprise
      },
      impacts: [impact("future-income", "confirmed_income", 9_999n, "increase")]
    });
    await createCurrentClearingRiskFixture();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("通过公开写入缝与同一只读快照重算项目四层投影、追溯事实和可分配上限", async () => {
    const view = await projection.getProjectView(READER_ID, {
      projectId: PROJECT_ID,
      asOf: CUTOFF_DATE
    });

    expect(view.asOf).toMatchObject({
      businessDate: CUTOFF_DATE,
      retroactiveFactCount: 9
    });
    expect(view.integrity).toMatchObject({
      statusLabel: "金额完整",
      moneyComplete: true
    });
    expect(view.operating).toEqual({
      confirmedIncomeCents: "1000",
      confirmedCostCents: "300",
      receivableCents: "200",
      payableCents: "200"
    });
    expect(view.actualFunds).toEqual(expect.objectContaining({
      constructionEnterpriseFundsCents: "700",
      companyProjectFundsCents: "0",
      netProjectCashPositionCents: "700",
      nonNegativeUsableCashStartCents: "700"
    }));
    expect(view.profitAndLoss).toEqual({
      currentOperatingProfitCents: "700",
      estimatedClearingExpenseCents: "40",
      currentEstimatedProfitCents: "660",
      finalConfirmedProfitCents: null,
      finalConfirmable: false
    });
    expect(view.distribution).toEqual({
      cashCeilingCents: "300",
      projectedProfitCeilingCents: "610",
      currentDistributableProfitCents: "300"
    });
    expect(view.evidence).toEqual(expect.objectContaining({
      A: { factCount: 4, amountCents: "2000" },
      B: { factCount: 4, amountCents: "500" },
      C: { factCount: 1, amountCents: "75" },
      gapFactCount: 1,
      gapAmountCents: "75"
    }));
    const compatibility = await projection.readFundsCompatibilitySnapshot(
      READER_ID,
      { projectIds: [PROJECT_ID] },
      async () => null
    );
    expect(compatibility.sourceReferenceTotals).toEqual(expect.arrayContaining([{
      sourceReferenceId: `payment-request-${runId}`,
      confirmedProjectOutflowCents: "100"
    }]));
    const fundsView = await funds.list(READER_ID, {
      view: "all",
      source: "contract_payment"
    });
    expect(fundsView.viewCounts.all).toBeGreaterThanOrEqual(fundsView.items.length);
    const pendingEvidenceView = await funds.list(READER_ID, {
      view: "pending_evidence",
      source: "spot_procurement_payment"
    });
    expect(pendingEvidenceView.items.every((item) => item.pendingEvidence)).toBe(true);
    expect(pendingEvidenceView.sourceCounts).toEqual(fundsView.sourceCounts);
    expect(view.sources.some((source) => source.sourceTypeLabel === "必要费用准备")).toBe(true);
    expect(view.sources.some((source) => source.sourceTypeLabel === "一般争议资金")).toBe(true);
  });

  it("保持项目/项目集/公司/施工企业/往来方/成本分类/来源下钻与中文导出共用同一投影结果", async () => {
    const companyView = await projection.getCompanyView(READER_ID, {
      companyEntityId,
      asOf: CUTOFF_DATE
    });
    expect(companyView.scope.label).toBe("公司归属口径");
    expect(companyView.sources.length).toBeGreaterThan(0);
    expect(companyView.actualFunds.companyProjectFundsCents).toBe("0");
    expect(companyView.actualFunds.constructionEnterpriseFundsCents).toBe("0");
    expect(companyView.restrictions.constructionEnterpriseFrozenFundsCents).toBe("0");
    expect(companyView.distribution.currentDistributableProfitCents).toBeNull();

    const projectSetView = await projection.getAsOfView(READER_ID, {
      scopeKind: "projects",
      projectIds: [PROJECT_ID],
      asOf: CUTOFF_DATE
    });
    expect(projectSetView.scope).toEqual({ label: "多项目汇总口径", projectCount: 1 });
    expect(projectSetView.profitAndLoss.currentOperatingProfitCents).toBe("700");
    expect(projectSetView.distribution.currentDistributableProfitCents).toBeNull();

    const enterpriseView = await projection.getProjectView(READER_ID, {
      projectId: PROJECT_ID,
      asOf: CUTOFF_DATE,
      constructionEnterpriseId: affiliate.businessPartyVersionId
    });
    expect(enterpriseView.sources.length).toBeGreaterThan(0);
    expect(enterpriseView.operating.confirmedIncomeCents).toBe("1000");

    const companyFilterView = await projection.getProjectView(READER_ID, {
      projectId: PROJECT_ID,
      asOf: CUTOFF_DATE,
      companyEntityId
    });
    expect(companyFilterView.actualFunds.constructionEnterpriseFundsCents).toBe("0");
    expect(companyFilterView.actualFunds.companyProjectFundsCents).toBe("0");
    expect(companyFilterView.actualFunds.nonNegativeUsableCashStartCents).toBe("0");

    const counterpartyView = await projection.getProjectView(READER_ID, {
      projectId: PROJECT_ID,
      asOf: CUTOFF_DATE,
      counterpartyId: `vendor-${runId}`
    });
    expect(counterpartyView.operating.confirmedCostCents).toBe("300");
    expect(counterpartyView.operating.payableCents).toBe("200");

    const reserveSourceView = await projection.getProjectView(READER_ID, {
      projectId: PROJECT_ID,
      sourceType: "project_necessary_expense_reserve_entry"
    });
    expect(reserveSourceView.integrity.moneyComplete).toBe(true);
    expect(reserveSourceView.restrictions.relationshipCompletenessLabel)
      .not.toBe("对账或限制关系完整性冲突");
    expect(reserveSourceView.restrictions.necessaryExpenseReserveCents).toBe("30");
    expect(reserveSourceView.actualFunds.constructionEnterpriseFundsCents).toBe("0");
    expect(reserveSourceView.sources).toEqual([
      expect.objectContaining({ sourceTypeLabel: "必要费用准备" })
    ]);

    const disputeCounterpartyView = await projection.getProjectView(READER_ID, {
      projectId: PROJECT_ID,
      sourceType: "project_fund_dispute_entry",
      counterpartyId: `owner-${runId}`
    });
    expect(disputeCounterpartyView.integrity.moneyComplete).toBe(true);
    expect(disputeCounterpartyView.restrictions.projectDisputedFundsCents).toBe("20");
    expect(disputeCounterpartyView.actualFunds.constructionEnterpriseFundsCents).toBe("0");
    expect(disputeCounterpartyView.sources).toEqual([
      expect.objectContaining({ sourceTypeLabel: "一般争议资金" })
    ]);
    const disputeDetails = await projection.getProjectDetailPage(READER_ID, {
      projectId: PROJECT_ID,
      sourceType: "project_fund_dispute_entry",
      counterpartyId: `owner-${runId}`,
      pageSize: 10
    });
    expect(disputeDetails.items).toEqual([
      expect.objectContaining({
        sourceTypeLabel: "一般争议资金",
        signedImpactCents: "20"
      })
    ]);
    expect(JSON.stringify(disputeDetails.items)).not.toContain("经营投影验收业主");
    expect(JSON.stringify(disputeDetails.items)).not.toContain("sourceSnapshot");
    const otherCounterpartyView = await projection.getProjectView(READER_ID, {
      projectId: PROJECT_ID,
      sourceType: "project_fund_dispute_entry",
      counterpartyId: `other-owner-${runId}`
    });
    expect(otherCounterpartyView.restrictions.projectDisputedFundsCents).toBe("0");
    expect(otherCounterpartyView.sources).toEqual([]);

    const costCategoryView = await projection.getProjectView(READER_ID, {
      projectId: PROJECT_ID,
      asOf: CUTOFF_DATE,
      costCategoryCode: "other_project_cost"
    });
    expect(costCategoryView.operating.confirmedCostCents).toBe("300");
    expect(costCategoryView.restrictions.estimatedClearingExpenseCents).toBe("40");

    const exported = await projection.exportView(READER_ID, {
      scopeKind: "project",
      projectId: PROJECT_ID,
      asOf: CUTOFF_DATE,
      sourceType: "owner_settlement"
    }, "pg16-confirmation-password");
    expect(exported.fileName).toBe(`经营投影_${CUTOFF_DATE}.csv`);
    const exportedContent = await readUtf8Stream(exported.stream);
    expect(exportedContent).toContain(
      '"分类","业务项目","金额（元）或数量","口径说明"'
    );
    expect(exportedContent).toContain('"已确认收入","10.00"');
    expect(exported).not.toHaveProperty("projection");
    const auditLog = await prisma.auditLog.findFirst({
      where: { actorUserId: READER_ID, action: "operating_projection.export" },
      orderBy: { createdAt: "desc" }
    });
    expect(auditLog).not.toBeNull();
    expect(exportConfirmation.confirmPassword).toHaveBeenCalledWith(
      READER_ID,
      "pg16-confirmation-password"
    );
    expect(auditLog?.metadata).toEqual(expect.objectContaining({
      scope: expect.objectContaining({
        kind: "project",
        projectId: PROJECT_ID,
        projectIds: [PROJECT_ID]
      }),
      filters: expect.objectContaining({ sourceType: "owner_settlement" }),
      effectiveRoleKeysByProject: expect.objectContaining({
        [PROJECT_ID]: expect.arrayContaining(["finance_director"])
      })
    }));

    const currentClearingView = await projection.getProjectView(READER_ID, {
      projectId: PROJECT_ID,
      sourceType: "clearing_event_version",
      costCategoryCode: "construction_enterprise_deduction",
      constructionEnterpriseId: affiliate.businessPartyId
    });
    expect(currentClearingView.restrictions.openPendingReconciliationGrossCents).toBe("60");
    expect(currentClearingView.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceTypeLabel: "施工企业清分" })
    ]));
    const currentClearingDetails = await projection.getProjectDetailPage(READER_ID, {
      projectId: PROJECT_ID,
      sourceType: "clearing_event_version",
      costCategoryCode: "construction_enterprise_deduction",
      constructionEnterpriseId: affiliate.businessPartyId
    });
    expect(currentClearingDetails.items.length).toBeGreaterThan(0);
    expect(currentClearingDetails.items[0]).not.toHaveProperty("factId");
    expect(currentClearingDetails.items[0]).not.toHaveProperty("impactId");
    expect(currentClearingDetails.items[0]).not.toHaveProperty("subjectId");
    expect(currentClearingDetails.items[0]).not.toHaveProperty("description");

    const historicalClearingView = await projection.getProjectView(READER_ID, {
      projectId: PROJECT_ID,
      asOf: CUTOFF_DATE,
      sourceType: "clearing_event_version"
    });
    expect(historicalClearingView.restrictions.openPendingReconciliationGrossCents).toBe("0");

    for (const filters of [
      { constructionEnterpriseId: `other-enterprise-${runId}` },
      { companyEntityId },
      { counterpartyId: `owner-${runId}` },
      { costCategoryCode: "other_project_cost" },
      { sourceType: "owner_settlement" }
    ]) {
      const isolated = await projection.getProjectView(READER_ID, {
        projectId: PROJECT_ID,
        ...filters
      });
      expect(isolated.restrictions.openPendingReconciliationGrossCents).toBe("0");
    }
  });

  it("以同一 readAt 遍历签名游标并排除首屏之后补录的回填确认事实", async () => {
    const query = { projectId: PROJECT_ID, asOf: CUTOFF_DATE, pageSize: 2 };
    const first = await projection.getProjectDetailPage(READER_ID, query);
    expect(first.page.nextCursor).toEqual(expect.any(String));
    expect(first.page.nextCursor).not.toContain(PROJECT_ID);
    const fixedReadAt = first.page.readAt;

    const sourceType = `cursor_backdated_${runId}`;
    await append(sourceType, {
      factKind: "owner_settlement",
      amountCents: 777n,
      direction: "inflow",
      confirmedAt: new Date("2026-09-05T01:00:00.000Z"),
      subjects: {
        debtor: { kind: "owner", id: `owner-${runId}` },
        creditor: enterprise
      },
      impacts: [impact("cursor-backdated", "confirmed_income", 777n, "increase")]
    });

    const items = [...first.items];
    let cursor = first.page.nextCursor;
    let pageCount = 1;
    while (cursor) {
      const page = await projection.getProjectDetailPage(READER_ID, {
        ...query,
        cursor
      });
      expect(page.page.readAt).toBe(fixedReadAt);
      items.push(...page.items);
      cursor = page.page.nextCursor;
      pageCount += 1;
      expect(pageCount).toBeLessThan(100);
    }
    expect(items.length).toBeGreaterThan(2);
    expect(items.some((item) => item.sourceTypeLabel === "其他正式来源" &&
      item.signedImpactCents === "777")).toBe(false);
    expect(new Set(items.map((item) => JSON.stringify(item))).size).toBe(items.length);
    expect(JSON.stringify(items)).not.toContain("description");
    expect(JSON.stringify(items)).not.toContain("sourceSnapshot");
  });

  it("以上游资金 V2 指纹稳定分页，并在 20,001 行内验证有界快照", async () => {
    const occurredAt = new Date("2026-09-11T12:00:00.000Z");
    const createdAt = new Date("2026-09-10T12:00:00.000Z");
    const expectedIds = Array.from({ length: 201 }, (_value, index) =>
      `pol108-upstream-page-${runId}-${String(index).padStart(3, "0")}`
    );
    await prisma.projectUpstreamFundFact.createMany({
      data: expectedIds.map((id, index) => ({
        id,
        projectId: PROJECT_ID,
        factType: "owner_payment_to_affiliate",
        occurredAt,
        amountCents: BigInt(index + 1),
        counterpartyName: "分页验收业主",
        basisType: "oral",
        affiliateAssignmentId: affiliate.assignmentId,
        affiliateBusinessPartyVersionId: affiliate.businessPartyVersionId,
        affiliateNameSnapshot: affiliate.name,
        description: index === 0 ? null : "分页与快照验收",
        idempotencyKey: `pol108-upstream-page-${runId}-${index}`,
        requestFingerprint: createHash("sha256").update(id).digest("hex"),
        recordedByUserId: READER_ID,
        recordedByRoleKey: "finance_director",
        createdAt,
        updatedAt: createdAt
      }))
    });

    const firstStartedAt = Date.now();
    const first = await projects.listUpstreamFundFacts(
      PROJECT_ID,
      READER_ID,
      { pageSize: 50 }
    );
    expect(Date.now() - firstStartedAt).toBeLessThan(15_000);
    expect(first.page.nextCursor).toEqual(expect.any(String));
    expect(first.page.nextCursor).not.toContain(PROJECT_ID);
    const lateId = `pol108-upstream-late-${runId}`;
    await prisma.projectUpstreamFundFact.create({
      data: {
        id: lateId,
        projectId: PROJECT_ID,
        factType: "owner_payment_to_affiliate",
        occurredAt,
        amountCents: 999n,
        counterpartyName: "首屏后新增业主",
        basisType: "oral",
        affiliateAssignmentId: affiliate.assignmentId,
        affiliateBusinessPartyVersionId: affiliate.businessPartyVersionId,
        affiliateNameSnapshot: affiliate.name,
        description: "不得进入固定 readAt 的续页",
        idempotencyKey: randomUUID(),
        requestFingerprint: createHash("sha256").update(lateId).digest("hex"),
        recordedByUserId: READER_ID,
        recordedByRoleKey: "finance_director"
      }
    });
    const seen = [...first.items];
    let cursor = first.page.nextCursor;
    let pageCount = 1;
    while (cursor) {
      const pageStartedAt = Date.now();
      const page = await projects.listUpstreamFundFacts(
        PROJECT_ID,
        READER_ID,
        { pageSize: 50, cursor }
      );
      expect(Date.now() - pageStartedAt).toBeLessThan(15_000);
      expect(page.page.readAt).toBe(first.page.readAt);
      seen.push(...page.items);
      cursor = page.page.nextCursor;
      pageCount += 1;
      expect(pageCount).toBeLessThan(20);
    }
    const pagedIds = seen
      .map((fact) => fact.id)
      .filter((id) => id.startsWith(`pol108-upstream-page-${runId}-`));
    expect(pagedIds).toHaveLength(201);
    expect(new Set(pagedIds).size).toBe(201);
    expect(pagedIds).toEqual([...expectedIds].sort());
    expect(seen.some((fact) => fact.id === lateId)).toBe(false);

    const scaleOccurredAt = new Date("2026-09-12T12:00:00.000Z");
    const scaleIds = Array.from({ length: 20_001 }, (_value, index) =>
      `pol108-upstream-scale-${runId}-${String(index).padStart(5, "0")}`
    );
    for (let start = 0; start < scaleIds.length; start += 1_000) {
      await prisma.projectUpstreamFundFact.createMany({
        data: scaleIds.slice(start, start + 1_000).map((id, offset) => ({
          id,
          projectId: PROJECT_ID,
          factType: "owner_payment_to_affiliate",
          occurredAt: scaleOccurredAt,
          amountCents: BigInt(start + offset + 1),
          counterpartyName: "指纹规模验收业主",
          basisType: "oral",
          affiliateAssignmentId: affiliate.assignmentId,
          affiliateBusinessPartyVersionId: affiliate.businessPartyVersionId,
          affiliateNameSnapshot: affiliate.name,
          description: offset === 0 ? null : "20,001 行常量内存快照验收",
          idempotencyKey: `pol108-upstream-scale-${runId}-${start + offset}`,
          requestFingerprint: createHash("sha256").update(id).digest("hex"),
          recordedByUserId: READER_ID,
          recordedByRoleKey: "finance_director",
          createdAt,
          updatedAt: createdAt
        }))
      });
    }
    const emptySnapshot = (await prisma.$queryRaw<Array<{
      snapshotRowCount: string;
      snapshotStateFingerprint: string;
    }>>(upstreamFundFactSnapshotQuery(
      `pol108-empty-project-${runId}`,
      new Date()
    )))[0];
    expect(emptySnapshot).toEqual({
      snapshotRowCount: "0",
      snapshotStateFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u)
    });
    const highLane = (await prisma.$queryRaw<Array<{ lane: string }>>(Prisma.sql`
      SELECT (('x' || repeat('f', 16))::bit(64))::text AS lane
    `))[0]?.lane;
    expect(highLane).toMatch(/^1[01]{63}$/u);
    const explain = await prisma.$queryRaw<Array<{ "QUERY PLAN": unknown }>>(Prisma.sql`
      EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
      ${upstreamFundFactSnapshotQuery(PROJECT_ID, new Date())}
    `);
    expect(JSON.stringify(explain)).not.toMatch(
      /"Temp (?:Read|Written) Blocks":[1-9][0-9]*/u
    );

    const scaleStartedAt = Date.now();
    const scaleFirst = await projects.listUpstreamFundFacts(
      PROJECT_ID,
      READER_ID,
      { pageSize: 200 }
    );
    expect(Date.now() - scaleStartedAt).toBeLessThan(15_000);
    expect(scaleFirst.page.nextCursor).toEqual(expect.any(String));
    const scaleLateId = `pol108-upstream-scale-late-${runId}`;
    await prisma.projectUpstreamFundFact.create({
      data: {
        id: scaleLateId,
        projectId: PROJECT_ID,
        factType: "owner_payment_to_affiliate",
        occurredAt: scaleOccurredAt,
        amountCents: 1n,
        counterpartyName: "规模首屏后新增业主",
        basisType: "oral",
        affiliateAssignmentId: affiliate.assignmentId,
        affiliateBusinessPartyVersionId: affiliate.businessPartyVersionId,
        affiliateNameSnapshot: affiliate.name,
        idempotencyKey: `pol108-upstream-scale-late-${runId}`,
        requestFingerprint: createHash("sha256").update(scaleLateId).digest("hex"),
        recordedByUserId: READER_ID,
        recordedByRoleKey: "finance_director"
      }
    });
    const scaleSecondStartedAt = Date.now();
    const scaleSecond = await projects.listUpstreamFundFacts(
      PROJECT_ID,
      READER_ID,
      { pageSize: 200, cursor: scaleFirst.page.nextCursor! }
    );
    expect(Date.now() - scaleSecondStartedAt).toBeLessThan(15_000);
    expect(scaleSecond.items.some((fact) => fact.id === scaleLateId)).toBe(false);
    expect(new Set([...scaleFirst.items, ...scaleSecond.items].map((fact) => fact.id)).size)
      .toBe(400);

    const semanticDriftId = `pol108-upstream-semantic-drift-${runId}`;
    await prisma.projectUpstreamFundFact.create({
      data: {
        id: semanticDriftId,
        projectId: PROJECT_ID,
        factType: "owner_payment_to_affiliate",
        occurredAt: scaleOccurredAt,
        amountCents: 1n,
        counterpartyName: "回填语义漂移业主",
        basisType: "oral",
        affiliateAssignmentId: affiliate.assignmentId,
        affiliateBusinessPartyVersionId: affiliate.businessPartyVersionId,
        affiliateNameSnapshot: affiliate.name,
        description: "首屏后补录但落入固定 readAt 的持久事实",
        idempotencyKey: `pol108-upstream-semantic-drift-${runId}`,
        requestFingerprint: createHash("sha256").update(semanticDriftId).digest("hex"),
        recordedByUserId: READER_ID,
        recordedByRoleKey: "finance_director",
        createdAt,
        updatedAt: createdAt
      }
    });
    await expect(projects.listUpstreamFundFacts(
      PROJECT_ID,
      READER_ID,
      { pageSize: 200, cursor: scaleSecond.page.nextCursor! }
    )).rejects.toBeInstanceOf(BadRequestException);
  });

  it("对可变参与关系漂移失败关闭，同时忽略 readAt 后新增和范围外关系", async () => {
    const first = await projection.getProjectDetailPage(READER_ID, {
      projectId: PROJECT_ID,
      pageSize: 2
    });
    expect(first.page.nextCursor).toEqual(expect.any(String));
    const lateParticipantId = `pol108-late-participant-${runId}`;
    const lateCompanyId = `pol108-late-company-${runId}`;
    const lateCompanyVersionId = `pol108-late-company-version-${runId}`;
    const lateCompanyCreditCode = `POL108-LATE-${runId}`;
    const driftParticipantId = `pol108-drift-participant-${runId}`;
    const driftCompanyId = `pol108-drift-company-${runId}`;
    const driftCompanyVersionId = `pol108-drift-company-version-${runId}`;
    const driftCompanyCreditCode = `POL108-DRIFT-${runId}`;
    const unrelatedProject = await prisma.project.findFirst({
      where: { id: { not: PROJECT_ID }, isActive: true },
      select: { id: true, name: true }
    });
    try {
      await prisma.companyEntity.create({
        data: {
          id: lateCompanyId,
          name: "首屏后追溯新增公司",
          unifiedSocialCreditCode: lateCompanyCreditCode,
          dataStatus: "complete",
          currentVersionNo: 1,
          isActive: true
        }
      });
      await prisma.companyEntityVersion.create({
        data: {
          id: lateCompanyVersionId,
          companyEntityId: lateCompanyId,
          versionNo: 1,
          name: "首屏后追溯新增公司",
          unifiedSocialCreditCode: lateCompanyCreditCode,
          isActive: true,
          action: "create",
          actorUserId: WRITER_ID,
          actorRoleKey: "finance_staff"
        }
      });
      await prisma.projectParticipatingCompany.create({
        data: {
          id: lateParticipantId,
          projectId: PROJECT_ID,
          companyEntityId: lateCompanyId,
          companyEntityVersionId: lateCompanyVersionId,
          companyNameSnapshot: "首屏后追溯新增公司",
          companyCreditCodeSnapshot: lateCompanyCreditCode,
          effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
          changeReason: "验证 readAt 排除",
          addedByUserId: WRITER_ID
        }
      });
      await prisma.companyEntity.create({
        data: {
          id: driftCompanyId,
          name: "游标上下文漂移专用公司",
          unifiedSocialCreditCode: driftCompanyCreditCode,
          dataStatus: "complete",
          currentVersionNo: 1,
          isActive: true
        }
      });
      await prisma.companyEntityVersion.create({
        data: {
          id: driftCompanyVersionId,
          companyEntityId: driftCompanyId,
          versionNo: 1,
          name: "游标上下文漂移专用公司",
          unifiedSocialCreditCode: driftCompanyCreditCode,
          isActive: true,
          action: "create",
          actorUserId: WRITER_ID,
          actorRoleKey: "finance_staff"
        }
      });
      await prisma.projectParticipatingCompany.create({
        data: {
          id: driftParticipantId,
          projectId: PROJECT_ID,
          companyEntityId: driftCompanyId,
          companyEntityVersionId: driftCompanyVersionId,
          companyNameSnapshot: "游标上下文漂移专用公司",
          companyCreditCodeSnapshot: driftCompanyCreditCode,
          effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
          changeReason: "验证合法的历史参与关系漂移",
          addedByUserId: WRITER_ID
        }
      });
      if (unrelatedProject) {
        await prisma.project.update({
          where: { id: unrelatedProject.id },
          data: { name: `${unrelatedProject.name}-范围外变更` }
        });
      }
      await expect(projection.getProjectDetailPage(READER_ID, {
        projectId: PROJECT_ID,
        pageSize: 2,
        cursor: first.page.nextCursor!
      })).resolves.toEqual(expect.objectContaining({
        page: expect.objectContaining({ readAt: first.page.readAt })
      }));

      const driftFirst = await projection.getProjectDetailPage(READER_ID, {
        projectId: PROJECT_ID,
        pageSize: 2
      });
      expect(driftFirst.page.nextCursor).toEqual(expect.any(String));
      await prisma.projectParticipatingCompany.update({
        where: { id: driftParticipantId },
        data: { endedAt: new Date("2026-08-15T00:00:00.000Z") }
      });
      await expect(projection.getProjectDetailPage(READER_ID, {
        projectId: PROJECT_ID,
        pageSize: 2,
        cursor: driftFirst.page.nextCursor!
      })).rejects.toBeInstanceOf(BadRequestException);
    } finally {
      await prisma.projectParticipatingCompany.deleteMany({
        where: { id: { in: [lateParticipantId, driftParticipantId] } }
      });
      await prisma.companyEntityVersion.deleteMany({
        where: { id: { in: [lateCompanyVersionId, driftCompanyVersionId] } }
      });
      await prisma.companyEntity.deleteMany({
        where: { id: { in: [lateCompanyId, driftCompanyId] } }
      });
      if (unrelatedProject) {
        await prisma.project.update({
          where: { id: unrelatedProject.id },
          data: { name: unrelatedProject.name }
        });
      }
    }
  });

  it("在读取事实前按主体 fallback 预检两类限制来源与高压缩快照字节", async () => {
    const counterpartyId = `preflight-counterparty-${runId}`;
    const otherCounterpartyId = `preflight-other-${runId}`;
    const payload = "P".repeat(4_300_000);
    const reserveSourceBusinessId = `project_necessary_expense_reserve_entry-${runId}`;
    const disputeSourceBusinessId = `project_fund_dispute_entry-${runId}`;

    await append("project_necessary_expense_reserve_entry", {
      sourceSnapshot: {
        schema: "pol108_preflight_compressible/V1",
        payload
      },
      subjects: {
        payee: { kind: "owner", id: counterpartyId }
      },
      impacts: [impact(
        "preflight-reserve-fallback",
        "construction_enterprise_funds_freeze",
        1n,
        "increase",
        {
          subjectRole: "payee",
          subject: { kind: "owner", id: otherCounterpartyId }
        }
      )]
    });
    await append("project_fund_dispute_entry", {
      sourceSnapshot: {
        schema: "project_fund_dispute_entry/V1",
        entryId: disputeSourceBusinessId,
        counterpartyId,
        payload
      },
      subjects: {},
      impacts: [impact(
        "preflight-dispute-frozen-counterparty",
        "project_disputed_funds_increase",
        1n,
        "increase",
        { costCategoryCode: "construction_enterprise_deduction" }
      )]
    });

    const sizes = await prisma.$queryRaw<Array<{
      sourceType: string;
      storedBytes: number;
      logicalBytes: number;
    }>>`
      SELECT
        "sourceType",
        pg_column_size("sourceSnapshot")::integer AS "storedBytes",
        octet_length("sourceSnapshot"::text)::integer AS "logicalBytes"
      FROM "OperatingFact"
      WHERE "sourceBusinessId" IN (${reserveSourceBusinessId}, ${disputeSourceBusinessId})
      ORDER BY "sourceType" ASC
    `;
    expect(sizes.map((row) => row.sourceType)).toEqual([
      "project_fund_dispute_entry",
      "project_necessary_expense_reserve_entry"
    ]);
    expect(sizes.every((row) => row.storedBytes < row.logicalBytes)).toBe(true);
    expect(sizes.reduce((total, row) => total + row.logicalBytes, 0))
      .toBeGreaterThan(8 * 1024 * 1024);

    const factRead = jest.spyOn(prisma.operatingFact, "findMany");
    try {
      await expect(projection.getProjectView(READER_ID, {
        projectId: PROJECT_ID,
        sourceType: "owner_settlement",
        costCategoryCode: "other_project_cost",
        counterpartyId
      })).rejects.toBeInstanceOf(PayloadTooLargeException);
      expect(factRead).not.toHaveBeenCalled();
    } finally {
      factRead.mockRestore();
    }
  });

  it("以窄列跨越稀疏筛选的内部批次且保持公开明细响应不变", async () => {
    const noiseSourceType = `detail_noise_${runId}`;
    const targetSourceType = `detail_target_${runId}`;
    await append(noiseSourceType, {
      factKind: "owner_settlement",
      amountCents: 200n,
      direction: "inflow",
      occurredAt: new Date("2026-09-04T08:00:00.000Z"),
      impacts: Array.from({ length: 200 }, (_value, index) => impact(
        `detail-noise-${String(index).padStart(3, "0")}`,
        "confirmed_income",
        1n,
        "increase"
      ))
    });
    await append(targetSourceType, {
      factKind: "owner_settlement",
      amountCents: 9n,
      direction: "inflow",
      occurredAt: new Date("2026-09-03T08:00:00.000Z"),
      impacts: [impact("detail-target", "confirmed_income", 9n, "increase")]
    });
    const detailRead = jest.spyOn(prisma.operatingImpactEntry, "findMany");
    try {
      const result = await projection.getProjectDetailPage(READER_ID, {
        projectId: PROJECT_ID,
        sourceType: targetSourceType,
        pageSize: 1
      });

      expect(result.items).toEqual([expect.objectContaining({
        sourceTypeLabel: "其他正式来源",
        signedImpactCents: "9"
      })]);
      expect(JSON.stringify(result.items)).not.toContain("sourceSnapshot");
      expect(JSON.stringify(result.items)).not.toContain("subjectSnapshot");
      const detailQueries = detailRead.mock.calls
        .map(([query]) => query)
        .filter(isDetailFindManyQuery);
      expect(detailQueries.length).toBeGreaterThanOrEqual(2);
      expect(detailQueries.every((query) =>
        !Object.hasOwn(query.select.fact.select, "sourceSnapshot") &&
        !Object.hasOwn(query.select.fact.select, "subjectSnapshot") &&
        !Object.hasOwn(query.select, "impactSnapshot") &&
        !Object.hasOwn(query.select, "description")
      )).toBe(true);
    } finally {
      detailRead.mockRestore();
    }
  });

  it("在 ORM 明细物化前拒绝普通非限制事实的大快照字节", async () => {
    const sourceTypes = [
      `detail_large_snapshot_a_${runId}`,
      `detail_large_snapshot_b_${runId}`
    ];
    const counterpartyId = `detail-large-owner-${runId}`;
    const payload = "L".repeat(4_300_000);
    for (const [index, sourceType] of sourceTypes.entries()) {
      await append(sourceType, {
        factKind: "owner_settlement",
        amountCents: 1n,
        direction: "inflow",
        occurredAt: new Date(`2026-09-02T08:00:0${index}.000Z`),
        sourceSnapshot: {
          schema: "pol108_detail_large_snapshot/V1",
          payload
        },
        subjects: {
          debtor: { kind: "owner", id: counterpartyId },
          creditor: enterprise
        },
        impacts: [impact(
          `detail-large-snapshot-${index}`,
          "confirmed_income",
          1n,
          "increase"
        )]
      });
    }
    const detailRead = jest.spyOn(prisma.operatingImpactEntry, "findMany");
    try {
      await expect(projection.getProjectDetailPage(READER_ID, {
        projectId: PROJECT_ID,
        counterpartyId,
        pageSize: 1
      })).rejects.toBeInstanceOf(PayloadTooLargeException);
      expect(detailRead.mock.calls.some(
        ([query]) => isDetailFindManyQuery(query)
      )).toBe(false);
    } finally {
      detailRead.mockRestore();
    }
  });

  async function createCurrentClearingRiskFixture() {
    const preparerUserId = `pol108-clearing-preparer-${runId}`;
    const attesterUserId = `pol108-clearing-attester-${runId}`;
    const confirmerUserId = `pol108-clearing-confirmer-${runId}`;
    await prisma.user.createMany({
      data: [preparerUserId, attesterUserId, confirmerUserId].map((id) => ({
        id,
        name: "POL-108 清分风险动态验收",
        mustChangePassword: false,
        isActive: true
      }))
    });
    const [financeStaffPosition, financeDirectorPosition] = await Promise.all([
      prisma.position.findUniqueOrThrow({ where: { key: "finance_staff" } }),
      prisma.position.findUniqueOrThrow({ where: { key: "finance_director" } })
    ]);
    await prisma.userPosition.createMany({
      data: [
        {
          userId: preparerUserId,
          positionId: financeStaffPosition.id,
          projectId: null
        },
        {
          userId: attesterUserId,
          positionId: financeStaffPosition.id,
          projectId: null
        },
        {
          userId: confirmerUserId,
          positionId: financeDirectorPosition.id,
          projectId: null
        }
      ]
    });
    const clearingCase = await prisma.clearingCase.create({
      data: {
        id: randomUUID(),
        projectId: PROJECT_ID,
        constructionEnterpriseAssignmentId: affiliate.assignmentId,
        category: "management_fee",
        governedSubjectKey: `pol108-clearing-subject-${runId}`,
        authoritativeGrossCapCents: 1_000n,
        createdByUserId: preparerUserId
      }
    });
    const prepared = clearingEventResult(await clearingWorkflow.createEvent(
      preparerUserId,
      clearingCase.id,
      {
        idempotencyKey: randomUUID(),
        expectedRevision: clearingCase.revision,
        kind: "pending_reconciliation",
        amountCents: "60",
        evidenceLevel: "B",
        businessReason: "POL-108 风险筛选与历史截止动态验收",
        reconciliationIntent: {
          operation: "open_item",
          itemDefinition: { mode: "independent", amountCents: "60" },
          coverages: []
        }
      }
    ));
    const draft = await prisma.clearingEventVersion.findUniqueOrThrow({
      where: { id: prepared.versionId },
      select: { id: true, fingerprint: true }
    });
    const submitted = clearingEventResult(await clearingWorkflow.submitEvent(
      preparerUserId,
      prepared.id,
      {
        idempotencyKey: randomUUID(),
        expectedRevision: prepared.revision,
        eventVersionId: draft.id,
        expectedFingerprint: draft.fingerprint
      }
    ));
    const submittedVersion = await prisma.clearingEventVersion.findUniqueOrThrow({
      where: { id: submitted.versionId },
      select: { id: true, fingerprint: true }
    });
    const attested = clearingEventResult(await clearingWorkflow.attestEvent(
      attesterUserId,
      prepared.id,
      {
        idempotencyKey: randomUUID(),
        expectedRevision: submitted.revision,
        eventVersionId: submittedVersion.id,
        expectedFingerprint: submittedVersion.fingerprint
      }
    ));
    const currentCase = await prisma.clearingCase.findUniqueOrThrow({
      where: { id: clearingCase.id },
      select: { revision: true }
    });
    await clearingWorkflow.confirmEvent(confirmerUserId, prepared.id, {
      idempotencyKey: randomUUID(),
      expectedRevision: attested.revision,
      expectedCaseRevision: currentCase.revision,
      eventVersionId: submittedVersion.id,
      expectedFingerprint: submittedVersion.fingerprint,
      confirmed: true
    });
  }

  async function append(
    sourceType: string,
    overrides: Partial<AppendOperatingFactInput>
  ) {
    const sourceBusinessId = `${sourceType}-${runId}`;
    return ledger.appendFromSource({
      projectId: PROJECT_ID,
      sourceType,
      sourceBusinessId,
      sourceBusinessCode: `POL108-${sourceType}-${runId}`,
      sourceVersion: 1,
      idempotencyKey: `pol108:${sourceBusinessId}:fact`,
      occurredAt: OCCURRED_AT,
      confirmedAt: CONFIRMED_AT,
      confirmedByUserId: WRITER_ID,
      factKind: "project_cash_restriction",
      operatingLevel: "project",
      evidenceLevel: "A",
      amountCents: 1n,
      currencyCode: "CNY",
      direction: "neutral",
      isBeforeOperatingLedgerEffectiveDate: false,
      affiliateAssignmentId: affiliate.assignmentId,
      affiliateBusinessPartyVersionId: affiliate.businessPartyVersionId,
      affiliateNameSnapshot: affiliate.name,
      ...(affiliate.creditCode
        ? { affiliateCreditCodeSnapshot: affiliate.creditCode }
        : {}),
      sourceSnapshot: { schema: "pol108_fixture/V1", runId },
      subjects: {},
      impacts: [],
      ...overrides
    }, WRITER_ID);
  }

  async function appendRestrictionSource(input: {
    sourceType: "project_necessary_expense_reserve_entry" | "project_fund_dispute_entry";
    amountCents: bigint;
  }) {
    const shortRunId = runId.slice(0, 8);
    const isReserve = input.sourceType === "project_necessary_expense_reserve_entry";
    const evidenceFileId = randomUUID();
    const evidenceSha256 = createHash("sha256")
      .update(`pol108:${input.sourceType}:${runId}`)
      .digest("hex");
    await prisma.fileObject.create({
      data: {
        id: evidenceFileId,
        bucket: "private-local",
        objectKey: `pol108/${evidenceFileId}.pdf`,
        originalName: `pol108-${isReserve ? "reserve" : "dispute"}.pdf`,
        mimeType: "application/pdf",
        sizeBytes: 108,
        uploadedByUserId: WRITER_ID,
        contentSha256: evidenceSha256
      }
    });
    if (isReserve) {
      const draft = await reserveService.saveDraft({
        projectId: PROJECT_ID,
        businessCode: `POL108-RES-${shortRunId}`,
        affiliateAssignmentId: affiliate.assignmentId,
        fundHolderKind: "construction_enterprise",
        fundHolderId: affiliate.businessPartyVersionId,
        reasonKind: "mandatory_closeout",
        title: "经营投影必要费用准备",
        basisKind: "written_evidence",
        basisBusinessIdOrEvidenceSha256: evidenceSha256,
        basisSummary: "POL-108 经营投影动态验收",
        entryKind: "establish",
        amountCents: input.amountCents.toString(),
        occurredAt: OCCURRED_AT.toISOString().slice(0, 10),
        evidenceLevel: "B",
        evidenceFileId,
        evidenceSha256,
        reason: "经营投影动态验收",
        idempotencyKey: randomUUID()
      }, { userId: WRITER_ID });
      const submitted = await reserveTransition(draft, "submit", WRITER_ID);
      const attested = await reserveTransition(submitted, "attest", PROJECT_MANAGER_ID);
      await reserveTransition(attested, "confirm", READER_ID);
      return;
    }
    const draft = await disputeService.saveDraft({
      projectId: PROJECT_ID,
      businessCode: `POL108-DIS-${shortRunId}`,
      affiliateAssignmentId: affiliate.assignmentId,
      fundHolderKind: "construction_enterprise",
      fundHolderId: affiliate.businessPartyVersionId,
      disputeKind: "upstream",
      counterpartyKind: "owner",
      counterpartyId: `owner-${runId}`,
      counterpartyNameSnapshot: "经营投影验收业主",
      referenceCode: `POL108-REF-${shortRunId}`,
      basisKind: "written_evidence",
      basisBusinessIdOrEvidenceSha256: evidenceSha256,
      entryKind: "establish",
      amountCents: input.amountCents.toString(),
      occurredAt: OCCURRED_AT.toISOString().slice(0, 10),
      evidenceLevel: "B",
      evidenceFileId,
      evidenceSha256,
      disputeSummary: "POL-108 经营投影动态验收",
      idempotencyKey: randomUUID()
    }, { userId: WRITER_ID });
    const submitted = await disputeTransition(draft, "submit", WRITER_ID);
    const attested = await disputeTransition(submitted, "attest", PROJECT_MANAGER_ID);
    await disputeTransition(attested, "confirm", READER_ID);
  }

  function reserveTransition(
    entry: { id: string; revision: number; fingerprint: string },
    action: "submit" | "attest" | "confirm",
    userId: string
  ) {
    return reserveService.transition({
      entryId: entry.id,
      action,
      expectedRevision: entry.revision,
      expectedFingerprint: entry.fingerprint,
      idempotencyKey: randomUUID()
    }, { userId });
  }

  function disputeTransition(
    entry: { id: string; revision: number; fingerprint: string },
    action: "submit" | "attest" | "confirm",
    userId: string
  ) {
    return disputeService.transition({
      entryId: entry.id,
      action,
      expectedRevision: entry.revision,
      expectedFingerprint: entry.fingerprint,
      idempotencyKey: randomUUID()
    }, { userId });
  }

  function impact(
    key: string,
    impactKind: OperatingImpactInput["impactKind"],
    amountCents: bigint,
    direction: OperatingImpactInput["direction"],
    overrides: Partial<OperatingImpactInput> = {}
  ): OperatingImpactInput {
    return {
      idempotencyKey: `pol108:${runId}:${key}`,
      sourceImpactKey: key,
      impactKind,
      amountCents,
      direction,
      description: `POL-108 ${key}`,
      ...overrides
    };
  }

  function clearingEventResult(value: unknown): {
    id: string;
    versionId: string;
    revision: number;
  } {
    return value as {
      id: string;
      versionId: string;
      revision: number;
    };
  }
});

async function readUtf8Stream(stream: AsyncIterable<unknown>): Promise<string> {
  let result = "";
  for await (const chunk of stream) result += String(chunk);
  return result;
}
