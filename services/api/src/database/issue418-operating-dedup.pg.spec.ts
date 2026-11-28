import { Prisma, PrismaClient } from "@prisma/client";
import {
  reduceOperatingProjection,
  toOperatingProjectionDetailedView,
  type ProjectionFactInput
} from "../operating-projection/operating-projection.reducer";
import { assertNoConfirmedSignedSettlementForPeriod } from "../operating-ledger/settlement-source-dedup";
import { OperatingCostAttributionService } from "../operating-ledger/operating-cost-attribution.service";
import { OperatingProjectionService } from "../operating-projection/operating-projection.service";
import { FundFlowService } from "../fund-flow/fund-flow.service";
import { AuditService } from "../audit/audit.service";
import { mergeContractDrilldown } from "../project/project-operating-drilldown";

const run = process.env.ISSUE418_OPERATING_DEDUP_RUN === "1" ? describe : describe.skip;

/**
 * #418 真实 PostgreSQL 用例：只使用本机一次性容器（db push 建 Schema），
 * 不重放迁移账、不接触生产或真实数据。覆盖：
 * - 同合同双入口（旧 settlement + 新 signed_contract_settlement）只计一次成本；
 * - upward / outside_fact 已签结算进入经营投影；
 * - 施工企业已付与项目对外支付成对且不可相加；
 * - 成本来源可追溯（factId/impactId/sourceType/sourceBusinessId）；
 * - 跨来源写入守卫在真实表上冲突。
 */
run("issue #418 operating dedup on real PostgreSQL", () => {
  jest.setTimeout(180_000);
  let prisma: PrismaClient;
  const id = {
    project: "issue418-project",
    user: "issue418-user",
    assignment: "issue418-assignment"
  };
  const day = new Date("2026-11-01T00:00:00.000Z");
  const ledgerEffective = new Date("2026-10-01T00:00:00.000Z");

  const fact = async (input: {
    id: string;
    sourceType: string;
    sourceBusinessId: string;
    sourceBusinessCode?: string;
    factKind: string;
    amountCents: bigint;
    direction?: string;
    sourceSnapshot: Prisma.InputJsonObject;
    operatingLevel?: string;
    costBearingCompany?: { kind: string; id: string; name: string } | null;
    actualPayer?: { kind: string; id: string } | null;
    impacts: Array<{
      id: string;
      impactKind: string;
      amountCents: bigint;
      direction: string;
      subjectRole?: string;
      subjectKind?: string;
      subjectId?: string;
      costCategoryCode?: string;
    }>;
  }) => {
    const occurredAt = new Date(day.getTime() + input.id.length * 60_000);
    await prisma.operatingFact.create({
      data: {
        id: input.id,
        projectId: id.project,
        sourceType: input.sourceType,
        sourceBusinessId: input.sourceBusinessId,
        sourceVersion: 1,
        sourceBusinessCode: input.sourceBusinessCode ?? input.sourceBusinessId,
        occurredAt,
        confirmedAt: occurredAt,
        affiliateAssignmentId: id.assignment,
        affiliateBusinessPartyVersionId: "affiliate-version",
        affiliateNameSnapshot: "施工企业甲",
        operatingLedgerEffectiveDateSnapshot: ledgerEffective,
        isBeforeOperatingLedgerEffectiveDate: false,
        factKind: input.factKind,
        operatingLevel: input.operatingLevel ?? "project",
        evidenceLevel: "A",
        amountCents: input.amountCents,
        currencyCode: "CNY",
        direction: input.direction ?? "neutral",
        ...(input.costBearingCompany
          ? {
              costBearingCompanySubjectKind: input.costBearingCompany.kind,
              costBearingCompanySubjectId: input.costBearingCompany.id
            }
          : {}),
        ...(input.actualPayer
          ? {
              actualPayerSubjectKind: input.actualPayer.kind,
              actualPayerSubjectId: input.actualPayer.id
            }
          : {}),
        subjectSnapshot: {
          ...(input.costBearingCompany
            ? { costBearingCompany: input.costBearingCompany }
            : {}),
          ...(input.actualPayer ? { actualPayer: input.actualPayer } : {})
        },
        sourceSnapshot: input.sourceSnapshot,
        entryKind: "original",
        idempotencyKey: `${input.sourceType}:${input.sourceBusinessId}`,
        recordedByUserId: id.user,
        confirmedByUserId: id.user,
        status: "confirmed",
        impacts: {
          create: input.impacts.map((impact) => ({
            id: impact.id,
            sourceType: input.sourceType,
            sourceBusinessId: input.sourceBusinessId,
            sourceImpactKey: impact.impactKind,
            idempotencyKey: `${input.sourceType}:${input.sourceBusinessId}:${impact.id}`,
            impactKind: impact.impactKind,
            amountCents: impact.amountCents,
            direction: impact.direction,
            subjectRole: impact.subjectRole ?? null,
            subjectKind: impact.subjectKind ?? null,
            subjectId: impact.subjectId ?? null,
            costCategoryCode: impact.costCategoryCode ?? null,
            impactSnapshot: {}
          }))
        }
      }
    });
  };

  beforeAll(async () => {
    const databaseUrl = process.env.ISSUE418_OPERATING_DEDUP_DATABASE_URL;
    if (!databaseUrl) throw new Error("缺少 ISSUE418_OPERATING_DEDUP_DATABASE_URL");
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await prisma.user.create({
      data: { id: id.user, name: "验收用户", isActive: true }
    });
    await prisma.project.create({
      data: {
        id: id.project,
        code: "XM-418",
        name: "合一口径验收项目",
        operatingLedgerEffectiveDate: ledgerEffective,
        isActive: true
      }
    });
    await prisma.projectAffiliateAssignment.create({
      data: {
        id: id.assignment,
        projectId: id.project,
        businessPartyId: "affiliate-party",
        businessPartyVersionId: "affiliate-version",
        affiliateNameSnapshot: "施工企业甲",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        changeReason: "验收初始化",
        assignedByUserId: id.user
      }
    });

    await fact({
      id: "fact-legacy-settlement",
      sourceType: "settlement",
      sourceBusinessId: "legacy-settlement-1",
      sourceBusinessCode: "JS-LEGACY-1",
      factKind: "downstream_settlement",
      amountCents: 6000n,
      sourceSnapshot: {
        contractId: "contract-1",
        contractVersionId: "contract-version-1",
        periodLabel: "第1期"
      },
      impacts: [
        { id: "legacy-cost", impactKind: "confirmed_cost", amountCents: 6000n, direction: "increase", costCategoryCode: "crew_and_labor" },
        { id: "legacy-payable", impactKind: "payable_increase", amountCents: 6000n, direction: "increase" }
      ]
    });
    await fact({
      id: "fact-signed-duplicate",
      sourceType: "signed_contract_settlement",
      sourceBusinessId: "signed-settlement-duplicate",
      sourceBusinessCode: "JS-2026-001",
      factKind: "downstream_settlement",
      amountCents: 6000n,
      sourceSnapshot: {
        contractId: "contract-1",
        contractKind: "downstream",
        contractVersionId: "contract-version-1",
        settlementNumber: "第 1 期",
        relationship: "inside"
      },
      impacts: [
        { id: "signed-cost", impactKind: "confirmed_cost", amountCents: 6000n, direction: "increase", costCategoryCode: "crew_and_labor" },
        { id: "signed-payable", impactKind: "payable_increase", amountCents: 6000n, direction: "increase" }
      ]
    });
    await fact({
      id: "fact-outside-settlement",
      sourceType: "signed_contract_settlement",
      sourceBusinessId: "signed-settlement-outside",
      sourceBusinessCode: "OUT-2026-001",
      factKind: "downstream_settlement",
      amountCents: 3000n,
      costBearingCompany: { kind: "participating_company", id: "company-a", name: "甲公司" },
      sourceSnapshot: {
        contractId: "outside-contract-1",
        contractKind: "outside_fact",
        contractVersionId: "outside-contract-1",
        settlementNumber: "OUT-2026-001",
        relationship: "outside"
      },
      impacts: [
        { id: "outside-cost", impactKind: "confirmed_cost", amountCents: 3000n, direction: "increase", costCategoryCode: "crew_and_labor" },
        { id: "outside-payable", impactKind: "payable_increase", amountCents: 3000n, direction: "increase" }
      ]
    });
    await fact({
      id: "fact-upward-settlement",
      sourceType: "signed_contract_settlement",
      sourceBusinessId: "signed-settlement-upward",
      sourceBusinessCode: "UP-2026-001",
      factKind: "downstream_settlement",
      amountCents: 5000n,
      operatingLevel: "participating_company",
      sourceSnapshot: {
        contractKind: "upward",
        contractVersionId: "upward-contract-1",
        settlementNumber: "UP-2026-001",
        relationship: "upward"
      },
      impacts: [
        { id: "upward-receivable", impactKind: "receivable_increase", amountCents: 5000n, direction: "increase", subjectRole: "creditor", subjectKind: "participating_company", subjectId: "company-a" }
      ]
    });
    await fact({
      id: "fact-owner-income",
      sourceType: "owner_settlement",
      sourceBusinessId: "owner-settlement-1",
      factKind: "owner_settlement",
      amountCents: 10000n,
      sourceSnapshot: {},
      impacts: [
        { id: "owner-income", impactKind: "confirmed_income", amountCents: 10000n, direction: "increase" },
        { id: "owner-receivable", impactKind: "receivable_increase", amountCents: 10000n, direction: "increase" }
      ]
    });
    await fact({
      id: "fact-affiliate-downstream-30",
      sourceType: "project_affiliate_payment_fact",
      sourceBusinessId: "affiliate-payment-30",
      factKind: "downstream_payment",
      amountCents: 3000n,
      direction: "outflow",
      sourceSnapshot: { contractId: "contract-1" },
      impacts: [
        { id: "affiliate-30-payable", impactKind: "payable_decrease", amountCents: 3000n, direction: "decrease" },
        { id: "affiliate-30-funds", impactKind: "construction_enterprise_funds_decrease", amountCents: 3000n, direction: "decrease" }
      ]
    });
    await fact({
      id: "fact-affiliate-remit-50",
      sourceType: "project_upstream_fund_fact",
      sourceBusinessId: "affiliate-remit-50",
      factKind: "fund_movement",
      amountCents: 5000n,
      direction: "outflow",
      sourceSnapshot: {},
      impacts: [
        { id: "remit-50-enterprise", impactKind: "construction_enterprise_funds_decrease", amountCents: 5000n, direction: "decrease" },
        { id: "remit-50-company", impactKind: "company_project_funds_increase", amountCents: 5000n, direction: "increase" }
      ]
    });
    await fact({
      id: "fact-our-downstream-40",
      sourceType: "payment_execution",
      sourceBusinessId: "our-payment-40",
      factKind: "downstream_payment",
      amountCents: 4000n,
      direction: "outflow",
      sourceSnapshot: { contractId: "contract-1" },
      impacts: [
        { id: "our-40-payable", impactKind: "payable_decrease", amountCents: 4000n, direction: "decrease" },
        { id: "our-40-funds", impactKind: "company_project_funds_decrease", amountCents: 4000n, direction: "decrease" }
      ]
    });
    await fact({
      id: "fact-unattributed-cost",
      sourceType: "history_expense",
      sourceBusinessId: "expense-unattributed",
      factKind: "expense",
      amountCents: 2000n,
      sourceSnapshot: {},
      impacts: [
        { id: "unattributed-cost", impactKind: "confirmed_cost", amountCents: 2000n, direction: "increase", costCategoryCode: "other_project_cost" }
      ]
    });
    await fact({
      id: "fact-public-cash-cost",
      sourceType: "payment_execution",
      sourceBusinessId: "payment-public-cash",
      factKind: "expense",
      amountCents: 1000n,
      direction: "outflow",
      actualPayer: { kind: "public_cash", id: "public_cash" },
      costBearingCompany: { kind: "participating_company", id: "company-b", name: "乙公司" },
      sourceSnapshot: {},
      impacts: [
        { id: "public-cash-cost", impactKind: "confirmed_cost", amountCents: 1000n, direction: "increase", costCategoryCode: "other_project_cost" },
        { id: "public-cash-out", impactKind: "public_cash_funds_decrease", amountCents: 1000n, direction: "decrease" }
      ]
    });
    await fact({
      id: "fact-public-cash-pending",
      sourceType: "payment_execution",
      sourceBusinessId: "payment-public-cash-pending",
      sourceBusinessCode: "现金待归属-001",
      factKind: "expense",
      amountCents: 700n,
      direction: "outflow",
      actualPayer: { kind: "public_cash", id: "public_cash" },
      sourceSnapshot: {},
      impacts: [
        { id: "pending-cash-cost", impactKind: "confirmed_cost", amountCents: 700n, direction: "increase", costCategoryCode: "other_project_cost" },
        { id: "pending-cash-out", impactKind: "public_cash_funds_decrease", amountCents: 700n, direction: "decrease", subjectRole: "actual_payer", subjectKind: "public_cash", subjectId: "public_cash" }
      ]
    });
    await prisma.user.create({
      data: { id: "issue418-finance-staff", name: "财务经办", isActive: true }
    });
    await prisma.user.create({
      data: { id: "issue418-finance-director", name: "财务主管", isActive: true }
    });
    await prisma.projectParticipatingCompany.create({
      data: {
        id: "issue418-company-c",
        projectId: id.project,
        companyEntityId: "company-c",
        companyEntityVersionId: "company-c-v1",
        companyNameSnapshot: "丙公司",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        changeReason: "验收初始化",
        addedByUserId: id.user
      }
    });
    await prisma.contract.create({
      data: {
        id: "contract-1",
        projectId: id.project,
        code: "HT-418-1",
        name: "下游合同一",
        counterparty: "劳务公司"
      }
    });
    await prisma.contract.create({
      data: {
        id: "outside-contract-1",
        projectId: id.project,
        code: "HT-418-OUT",
        name: "表外合同一",
        counterparty: "材料公司"
      }
    });
    await prisma.paymentRequest.create({
      data: {
        id: "issue418-payment-pending",
        projectId: id.project,
        contractId: "contract-1",
        contractVersionId: "contract-version-1",
        paymentTermsVersionId: "terms-1",
        code: "FK-418-001",
        status: "approval_pending",
        requestedAmountCents: 2000n
      }
    });
    await prisma.paymentRequest.create({
      data: {
        id: "issue418-payment-approved",
        projectId: id.project,
        contractId: "contract-1",
        contractVersionId: "contract-version-1",
        paymentTermsVersionId: "terms-1",
        code: "FK-418-002",
        status: "approved_pending_payment",
        requestedAmountCents: 3000n,
        approvedAmountCents: 3000n,
        paidAmountCents: 1000n
      }
    });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function loadProjectionFacts(): Promise<ProjectionFactInput[]> {
    const rows = await prisma.operatingFact.findMany({
      where: { projectId: id.project },
      include: { impacts: true },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }]
    });
    return rows.map((row) => ({
      id: row.id,
      projectId: row.projectId,
      projectCode: "XM-418",
      projectName: "合一口径验收项目",
      sourceType: row.sourceType,
      sourceBusinessId: row.sourceBusinessId,
      sourceVersion: row.sourceVersion,
      sourceBusinessCode: row.sourceBusinessCode,
      occurredAt: row.occurredAt.toISOString(),
      confirmedAt: row.confirmedAt.toISOString(),
      affiliateBusinessPartyVersionId: row.affiliateBusinessPartyVersionId,
      affiliateNameSnapshot: row.affiliateNameSnapshot,
      factKind: row.factKind,
      operatingLevel: row.operatingLevel,
      evidenceLevel: row.evidenceLevel,
      amountCents: row.amountCents ?? 0n,
      direction: row.direction,
      sourceSnapshot: row.sourceSnapshot,
      entryKind: row.entryKind,
      adjustsFactId: row.adjustsFactId,
      debtorSubject: row.debtorSubjectKind && row.debtorSubjectId ? { kind: row.debtorSubjectKind, id: row.debtorSubjectId } : null,
      creditorSubject: row.creditorSubjectKind && row.creditorSubjectId ? { kind: row.creditorSubjectKind, id: row.creditorSubjectId } : null,
      costBearingCompanySubject:
        row.costBearingCompanySubjectKind && row.costBearingCompanySubjectId
          ? {
              kind: row.costBearingCompanySubjectKind,
              id: row.costBearingCompanySubjectId,
              name:
                ((row.subjectSnapshot as Record<string, unknown>)?.costBearingCompany as Record<string, unknown> | undefined)?.name as string | null ?? null
            }
          : null,
      actualPayerSubject:
        row.actualPayerSubjectKind && row.actualPayerSubjectId
          ? { kind: row.actualPayerSubjectKind, id: row.actualPayerSubjectId }
          : null,
      subjectReferences: [],
      impacts: row.impacts.map((impact) => ({
        id: impact.id,
        impactKind: impact.impactKind,
        amountCents: impact.amountCents ?? 0n,
        direction: impact.direction,
        subjectRole: impact.subjectRole,
        subjectKind: impact.subjectKind,
        subjectId: impact.subjectId,
        costCategoryCode: impact.costCategoryCode,
        description: impact.description
      }))
    }));
  }

  const context = () => ({
    scope: { kind: "project" as const, projectId: id.project, projectIds: [id.project] },
    readAt: "2026-12-01T00:00:00.000Z",
    cutoffAt: "2026-12-01T00:00:00.000Z",
    riskByProject: []
  });

  it("同合同双入口只计一次成本，upward 不进成本，outside 进入成本", async () => {
    const result = reduceOperatingProjection({ ...context(), facts: await loadProjectionFacts() });
    expect(result.operating.confirmedIncomeCents).toBe("10000");
    // 6000 旧结算 + 3000 表外 + 2000 待归属 + 1000 公共现金 + 700 待归属公共现金；重复的已签结算 6000 被去重。
    expect(result.operating.confirmedCostCents).toBe("12700");
    expect(result.asOf.crossSourceDedupedFactCount).toBe(1);
    expect(result.integrity.notices.join("\n")).toContain("同一合同期次");
    expect(result.integrity.notices.join("\n")).toContain("存在多来源结算");
    expect(result.relationshipTotals?.find((row) => row.relationship === "upward")).toEqual(
      expect.objectContaining({ confirmedCostCents: "0", receivableCents: "5000" })
    );
  });

  it("施工企业已付80、项目对外支付70，两指标成对且不可相加", async () => {
    const result = reduceOperatingProjection({ ...context(), facts: await loadProjectionFacts() });
    expect(result.actualFunds.constructionEnterprisePaidCents).toBe("8000");
    expect(result.actualFunds.projectExternalPaidCents).toBe("7000");
    // 施工企业已付 80 与项目对外支付 70 是成对口径；两者相加 150 不是任何官方指标。
    expect(result.actualFunds.constructionEnterprisePaidCents).not.toBe(
      result.actualFunds.projectExternalPaidCents
    );
  });

  it("成本归属读侧分列承担公司、待归属与公共现金来源", async () => {
    const result = reduceOperatingProjection({ ...context(), facts: await loadProjectionFacts() });
    // 旧结算 6000 与未明公司费用 2000 + 700 都没有承担公司，合并显示待归属。
    expect(result.costAttribution.unattributedCostCents).toBe("8700");
    expect(result.costAttribution.publicCashCostCents).toBe("1700");
    expect(result.costAttribution.byBearingCompany).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "company-a", name: "甲公司", costCents: "3000" }),
        expect.objectContaining({ id: "company-b", name: "乙公司", costCents: "1000" })
      ])
    );
  });

  it("明细可追溯到事实、影响、来源类型和源业务 ID", async () => {
    const result = reduceOperatingProjection({ ...context(), facts: await loadProjectionFacts() });
    const detailed = toOperatingProjectionDetailedView(result);
    // 同期次只保留一个来源的成本明细；两条旧/新来源不会同时进入明细。
    const settlementCosts = detailed.details.filter((row) =>
      ["legacy-cost", "signed-cost"].includes(row.impactId)
    );
    expect(settlementCosts).toHaveLength(1);
    const cost = settlementCosts[0];
    expect(cost).toEqual(expect.objectContaining({
      factId: "fact-signed-duplicate",
      impactId: "signed-cost",
      sourceType: "signed_contract_settlement",
      sourceBusinessId: "signed-settlement-duplicate"
    }));
    expect(detailed.sourceDrilldown).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceType: "signed_contract_settlement",
          sourceBusinessId: "signed-settlement-upward"
        })
      ])
    );
  });

  it("数据库来源唯一键阻止同一来源重复入账", async () => {
    await expect(
      prisma.operatingFact.create({
        data: {
          id: "fact-single-source-duplicate",
          projectId: id.project,
          sourceType: "settlement",
          sourceBusinessId: "legacy-settlement-1",
          sourceVersion: 1,
          sourceBusinessCode: "JS-LEGACY-1",
          occurredAt: day,
          confirmedAt: day,
          affiliateAssignmentId: id.assignment,
          affiliateBusinessPartyVersionId: "affiliate-version",
          affiliateNameSnapshot: "施工企业甲",
          operatingLedgerEffectiveDateSnapshot: ledgerEffective,
          isBeforeOperatingLedgerEffectiveDate: false,
          factKind: "downstream_settlement",
          operatingLevel: "project",
          evidenceLevel: "A",
          amountCents: 6000n,
          currencyCode: "CNY",
          direction: "neutral",
          subjectSnapshot: {},
          sourceSnapshot: {},
          entryKind: "original",
          idempotencyKey: "settlement:legacy-settlement-1:duplicate",
          recordedByUserId: id.user,
          confirmedByUserId: id.user,
          status: "confirmed"
        }
      })
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("跨来源写入守卫在真实 Settlement/SignedContractSettlement 行上拒绝同期次重复登记", async () => {
    await prisma.settlement.create({
      data: {
        id: "legacy-settlement-row",
        projectId: id.project,
        contractId: "contract-1",
        contractVersionId: "contract-version-1",
        paymentTermsVersionId: "terms-1",
        code: "JS-ROW-001",
        periodLabel: "第1期",
        status: "effective",
        amountCents: 6000n,
        payableAmountCents: 6000n,
        paidAmountCents: 0n
      }
    });
    await prisma.signedContractSettlement.create({
      data: {
        id: "signed-settlement-row",
        projectId: id.project,
        contractKind: "downstream",
        contractId: "contract-1",
        ownerUserId: id.user,
        number: "第1期",
        amountYuan: "60.0000",
        state: "confirmed",
        revision: 2,
        submittedAt: day,
        reviewedAt: day,
        reviewedByUserId: id.user,
        confirmationNo: 1n,
        confirmedContractSource: {
          sourceRecordId: "contract-version-1",
          sourceVersion: 1,
          contractTypeKey: "labor_subcontract"
        }
      }
    });
    await expect(
      assertNoConfirmedSignedSettlementForPeriod(prisma as never, {
        projectId: id.project,
        contractId: "contract-1",
        contractVersionId: "contract-version-1",
        periodLabel: "第1期",
        code: "JS-ROW-001"
      })
    ).rejects.toThrow("不能重复计成本");
  });

  it("G4 公共现金待归属确认后转正、幂等且不新增成本", async () => {
    const visibility = {
      visibleRequestedProjectIdsInTransaction: async (
        _tx: unknown,
        _actor: string,
        ids: string[]
      ) => ids,
      visibleProjectIdsInTransaction: async () => [id.project],
      visibleProjectIdsWithinBudgetInTransaction: async () => [id.project],
      effectiveRoleKeysByProjectInTransaction: async (
        _tx: unknown,
        actor: string,
        projectIds: string[]
      ) =>
        new Map(
          projectIds.map((projectId) => [
            projectId,
            actor === "issue418-finance-director"
              ? ["finance_director"]
              : actor === "issue418-finance-staff"
                ? ["finance_staff"]
                : ["finance_director"]
          ])
        ),
      effectiveRoleKeysByProject: async (
        actor: string,
        projectIds: string[]
      ) =>
        new Map(
          projectIds.map((projectId) => [
            projectId,
            actor === "issue418-finance-director"
              ? ["finance_director"]
              : ["finance_staff"]
          ])
        )
    };
    const auth = { confirmPassword: jest.fn().mockResolvedValue(undefined) };
    const audit = new AuditService(prisma as never);
    const attributions = new OperatingCostAttributionService(
      prisma as never,
      visibility as never,
      audit,
      auth as never
    );
    const before = await prisma.operatingFact.count({
      where: { projectId: id.project }
    });
    const listBefore = await attributions.list(
      id.project,
      "issue418-finance-staff"
    );
    const candidate = listBefore.candidates.find(
      (row) => row.factId === "fact-public-cash-pending"
    );
    expect(candidate).toEqual(
      expect.objectContaining({ amountCents: "700", activeStatus: null })
    );
    const requested = await attributions.request(
      id.project,
      "fact-public-cash-pending",
      {
        companyEntityId: "company-c-v1",
        reason: "公共现金支出由丙公司承担",
        idempotencyKey: "issue418-attribution-1"
      },
      "issue418-finance-staff"
    );
    expect(requested.status).toBe("pending_review");
    const repeated = await attributions.request(
      id.project,
      "fact-public-cash-pending",
      {
        companyEntityId: "company-c-v1",
        reason: "公共现金支出由丙公司承担",
        idempotencyKey: "issue418-attribution-1"
      },
      "issue418-finance-staff"
    );
    expect(repeated.id).toBe(requested.id);
    const confirmed = await attributions.review(
      id.project,
      requested.id,
      { decision: "confirm", revision: requested.revision, reason: "财务主管核对" },
      "issue418-finance-director"
    );
    expect(confirmed).toEqual(
      expect.objectContaining({
        status: "confirmed",
        companyName: "丙公司",
        factId: "fact-public-cash-pending"
      })
    );
    const fact = await prisma.operatingFact.findUniqueOrThrow({
      where: { id: "fact-public-cash-pending" }
    });
    expect(fact.costBearingCompanySubjectId).toBeNull();
    expect(fact.amountCents).toBe(700n);
    expect(
      await prisma.operatingFact.count({ where: { projectId: id.project } })
    ).toBe(before);

    const projection = new OperatingProjectionService(
      prisma as never,
      visibility as never,
      {} as never,
      audit,
      auth as never
    );
    const view = await projection.getProjectView(
      "issue418-finance-director",
      { projectId: id.project }
    );
    expect(view.costAttribution.unattributedCostCents).toBe("8000");
    expect(view.costAttribution.byBearingCompany).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "company-c-v1", name: "丙公司", costCents: "700" })
      ])
    );
    expect(view.operating.confirmedCostCents).toBe("12700");
    const listAfter = await attributions.list(
      id.project,
      "issue418-finance-director"
    );
    expect(
      listAfter.candidates.some(
        (row) => row.factId === "fact-public-cash-pending"
      )
    ).toBe(false);
  });

  it("G5 资金流水与经营事实一致，支持类型过滤与导出", async () => {
    const visibility = {
      visibleProjectIdsInTransaction: async () => [id.project],
      effectiveRoleKeysByProjectInTransaction: async (
        _tx: unknown,
        _actor: string,
        projectIds: string[]
      ) =>
        new Map(projectIds.map((projectId) => [projectId, ["finance_director"]]))
    };
    const fundFlow = new FundFlowService(
      prisma as never,
      visibility as never,
      new AuditService(prisma as never)
    );
    const page = await fundFlow.list(id.project, "issue418-finance-director", {});
    expect(page.rows.length).toBeGreaterThan(0);
    const pendingCash = page.rows.find(
      (row) => row.impactId === "pending-cash-out"
    );
    expect(pendingCash).toEqual(
      expect.objectContaining({
        holderKind: "public_cash",
        holderName: "公共现金",
        direction: "out",
        type: "payment",
        amountCents: "700",
        sourceBusinessCode: "现金待归属-001"
      })
    );
    const payments = await fundFlow.list(
      id.project,
      "issue418-finance-director",
      { type: "payment" }
    );
    expect(payments.rows.every((row) => row.type === "payment")).toBe(true);
    const refunds = await fundFlow.list(
      id.project,
      "issue418-finance-director",
      { type: "refund" }
    );
    expect(refunds.rows).toHaveLength(0);
    const exported = await fundFlow.export(
      id.project,
      "issue418-finance-director",
      {}
    );
    expect(exported.buffer.length).toBeGreaterThan(0);
    expect(exported.fileName).toContain("资金流水");
    const auditRows = await prisma.auditLog.findMany({
      where: { action: "fund_flow.export", actorUserId: "issue418-finance-director" }
    });
    expect(auditRows).toHaveLength(1);
  });

  it("G9 总览按合同钻取：审批中与已批待付分列，跨合同不抵扣", async () => {
    const visibility = {
      visibleRequestedProjectIdsInTransaction: async (
        _tx: unknown,
        _actor: string,
        ids: string[]
      ) => ids,
      visibleProjectIdsInTransaction: async () => [id.project],
      visibleProjectIdsWithinBudgetInTransaction: async () => [id.project],
      effectiveRoleKeysByProjectInTransaction: async (
        _tx: unknown,
        _actor: string,
        projectIds: string[]
      ) =>
        new Map(projectIds.map((projectId) => [projectId, ["finance_director"]])),
      effectiveRoleKeysByProject: async (
        _actor: string,
        projectIds: string[]
      ) =>
        new Map(projectIds.map((projectId) => [projectId, ["finance_director"]]))
    };
    const projection = new OperatingProjectionService(
      prisma as never,
      visibility as never,
      {} as never,
      new AuditService(prisma as never),
      { confirmPassword: jest.fn() } as never
    );
    const view = await projection.getProjectView(
      "issue418-finance-director",
      { projectId: id.project }
    );
    const rows = mergeContractDrilldown({
      projectionRows: view.contractDrilldown,
      contracts: await prisma.contract.findMany({
        where: { projectId: id.project },
        select: { id: true, code: true, name: true }
      }),
      affiliateContracts: [],
      companyContracts: [],
      paymentRequests: await prisma.paymentRequest.findMany({
        where: { projectId: id.project },
        select: {
          contractId: true,
          status: true,
          requestedAmountCents: true,
          approvedAmountCents: true,
          paidAmountCents: true
        }
      })
    });
    expect(rows.find((row) => row.contractKey === "contract-1")).toEqual(
      expect.objectContaining({
        contractCode: "HT-418-1",
        settledCents: "6000",
        paidCents: "7000",
        unpaidCents: "0",
        approvalPendingRequestCents: "2000",
        approvedPendingPaymentCents: "2000"
      })
    );
    expect(rows.find((row) => row.contractKey === "outside-contract-1")).toEqual(
      expect.objectContaining({
        contractCode: "HT-418-OUT",
        settledCents: "3000",
        paidCents: "0",
        unpaidCents: "3000"
      })
    );
    expect(rows.every(row => row.unpaidCents !== null)).toBe(true);
    const contractUnpaidTotal = rows.reduce(
      (sum, row) => sum + BigInt(row.unpaidCents!),
      0n
    );
    expect(contractUnpaidTotal).toBe(3000n);
    // 合同一超付不抵扣表外欠款：总体应付净额 2000，而按合同未付合计 3000。
    expect(view.operating.payableCents).toBe("2000");
  });
});
