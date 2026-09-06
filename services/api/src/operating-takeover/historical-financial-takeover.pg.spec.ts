import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { HistoricalFinancialTakeoverAdapter } from "./historical-financial-takeover.adapter";
import { HistoricalFinancialTakeoverService } from "./historical-financial-takeover.service";

const RUN_POSTGRES = process.env.RUN_POL224_HISTORICAL_FINANCIAL_PG === "1";
const describePostgres = RUN_POSTGRES ? describe : describe.skip;
const databaseUrl = process.env.POL224_HISTORICAL_FINANCIAL_DATABASE_URL;
const PROJECT_ID = "22400000-0000-4000-8000-000000000001";
const PAYMENT_REQUEST_ID = "22400000-0000-4000-8000-000000000002";
const PAYMENT_EXECUTION_ID = "22400000-0000-4000-8000-000000000003";
const SETTLEMENT_CASE_ID = "22400000-0000-4000-8000-000000000004";
const SETTLEMENT_ALLOCATION_ID = "22400000-0000-4000-8000-000000000005";
const CONTRACT_ID = "22400000-0000-4000-8000-000000000006";
const CONTRACT_VERSION_ID = "22400000-0000-4000-8000-000000000007";
const PAYMENT_TERMS_VERSION_ID = "22400000-0000-4000-8000-000000000008";
const COMPANY_ENTITY_ID = "22400000-0000-4000-8000-000000000009";
const VOUCHER_FILE_ID = "22400000-0000-4000-8000-000000000010";
const SOURCE_EVIDENCE_FILE_ID = "22400000-0000-4000-8000-000000000018";
const WAGE_SOURCE_VERSION_ID = "22400000-0000-4000-8000-000000000019";
const WAGE_STATEMENT_ID = "22400000-0000-4000-8000-000000000020";
const WAGE_STATEMENT_VERSION_ID = "22400000-0000-4000-8000-000000000021";
const WAGE_PERSON_LINE_ID = "22400000-0000-4000-8000-000000000022";
const WAGE_CREDITOR_BREAKDOWN_ID = "22400000-0000-4000-8000-000000000023";
const WAGE_SERVICE_BASIS_ID = "22400000-0000-4000-8000-000000000024";
const WAGE_PROJECT_ALLOCATION_ID = "22400000-0000-4000-8000-000000000025";
const WAGE_PAYABLE_REF_ID = "22400000-0000-4000-8000-000000000026";
const PREPARER_ID = "22400000-0000-4000-8000-000000000011";
const REVIEWER_ID = "22400000-0000-4000-8000-000000000012";
const ACTIVATOR_ID = "22400000-0000-4000-8000-000000000013";
const COMPENSATOR_ID = "22400000-0000-4000-8000-000000000014";

describePostgres("POL-224 historical financial takeover PostgreSQL 16 boundary", () => {
  const prisma = new PrismaClient(databaseUrl ? { datasources: { db: { url: databaseUrl } } } : undefined);
  const visibility = {
    effectiveRoleKeys: async (userId: string) => userId === REVIEWER_ID || userId === COMPENSATOR_ID
      ? ["finance_director"]
      : ["contract_director"]
  };
  const service = new HistoricalFinancialTakeoverService(
    prisma as never,
    visibility as never,
    new HistoricalFinancialTakeoverAdapter(),
    new AuditService()
  );

  beforeAll(async () => {
    if (!databaseUrl || process.env.NODE_ENV === "production") {
      throw new Error("POL-224 PG16 测试必须连接 runner 创建的非生产 disposable database");
    }
    if (process.env.BUILD_COMMIT_SHA !== undefined || !/^[0-9a-f]{40}$/u.test(process.env.GIT_COMMIT_SHA ?? "")) {
      throw new Error("POL-224 PG16 测试必须绑定 candidate GIT_COMMIT_SHA");
    }
    await prisma.$connect();
    await prisma.user.createMany({
      data: [PREPARER_ID, REVIEWER_ID, ACTIVATOR_ID, COMPENSATOR_ID].map((id, index) => ({
        id,
        name: `POL-224 动态测试人员 ${index + 1}`,
        isActive: true,
        mustChangePassword: false
      }))
    });
    await prisma.companyEntity.create({
      data: {
        id: COMPANY_ENTITY_ID,
        name: "POL-224 动态测试付款公司",
        unifiedSocialCreditCode: "91310000POL224TEST",
        dataStatus: "complete",
        currentVersionNo: 1,
        isActive: true
      }
    });
    await prisma.project.create({ data: { id: PROJECT_ID, code: "POL224-PG", name: "POL-224 动态测试项目" } });
    await prisma.projectAffiliateAssignment.create({
      data: {
        id: "22400000-0000-4000-8000-000000000015",
        projectId: PROJECT_ID,
        businessPartyId: "22400000-0000-4000-8000-000000000016",
        businessPartyVersionId: "22400000-0000-4000-8000-000000000017",
        affiliateNameSnapshot: "POL-224 动态测试施工企业",
        effectiveFrom: new Date("2024-01-01T00:00:00.000Z"),
        changeReason: "POL-224 disposable PostgreSQL 16 测试夹具",
        assignedByUserId: PREPARER_ID
      }
    });
    await prisma.contract.create({
      data: {
        id: CONTRACT_ID,
        projectId: PROJECT_ID,
        code: "POL224-CONTRACT",
        name: "POL-224 动态测试合同",
        counterparty: "POL-224 动态测试相对方",
        companyEntityId: COMPANY_ENTITY_ID,
        companyEntityName: "POL-224 动态测试付款公司",
        contractTypeKey: "labor_subcontract"
      }
    });
    await prisma.contractVersion.create({
      data: {
        id: CONTRACT_VERSION_ID,
        contractId: CONTRACT_ID,
        versionNo: 1,
        changeType: "original",
        status: "effective",
        amountCents: 12_000n,
        effectiveAt: new Date("2024-01-01T00:00:00.000Z"),
        companyEntityIdSnapshot: COMPANY_ENTITY_ID,
        companyEntityNameSnapshot: "POL-224 动态测试付款公司",
        companyEntityCreditCodeSnapshot: "91310000POL224TEST",
        draftData: {},
        templateSnapshot: {},
        clauseSnapshot: {}
      }
    });
    await prisma.paymentTermsVersion.create({
      data: {
        id: PAYMENT_TERMS_VERSION_ID,
        contractId: CONTRACT_ID,
        contractVersionId: CONTRACT_VERSION_ID,
        versionNo: 1,
        status: "effective",
        originalText: "POL-224 动态测试付款条款"
      }
    });
    await prisma.fileObject.create({
      data: {
        id: VOUCHER_FILE_ID,
        bucket: "local-private",
        objectKey: "pol224/payment-voucher.pdf",
        originalName: "payment-voucher.pdf",
        mimeType: "application/pdf",
        sizeBytes: 128,
        uploadedByUserId: PREPARER_ID,
        contentSha256: "e".repeat(64),
        storageStatus: "active"
      }
    });
    await prisma.fileObject.create({
      data: {
        id: SOURCE_EVIDENCE_FILE_ID,
        bucket: "local-private",
        objectKey: "pol224/wage-source.json",
        originalName: "wage-source.json",
        mimeType: "application/json",
        sizeBytes: 128,
        uploadedByUserId: PREPARER_ID,
        contentSha256: "a".repeat(64),
        storageStatus: "active"
      }
    });
    await prisma.wageApprovedSourceVersion.create({
      data: {
        id: WAGE_SOURCE_VERSION_ID,
        employmentCompanyId: COMPANY_ENTITY_ID,
        wageMonth: "2024-01",
        periodStart: new Date("2024-01-01T00:00:00.000Z"),
        periodEnd: new Date("2024-01-31T00:00:00.000Z"),
        sourceType: "external_approved_wage",
        externalReference: "POL224-WAGE-SOURCE",
        sourceVersion: "v1",
        basisDate: new Date("2024-01-31T00:00:00.000Z"),
        evidenceFileId: SOURCE_EVIDENCE_FILE_ID,
        evidenceSha256: "a".repeat(64),
        sourceFingerprint: "b".repeat(64),
        sourceSnapshot: { source: "POL-224 PG16" },
        createdByUserId: PREPARER_ID
      }
    });
    await prisma.wageStatement.create({
      data: {
        id: WAGE_STATEMENT_ID,
        employmentCompanyId: COMPANY_ENTITY_ID,
        wageMonth: "2024-01",
        currentRevision: 1,
        createdByUserId: PREPARER_ID
      }
    });
    await prisma.wageStatementVersion.create({
      data: {
        id: WAGE_STATEMENT_VERSION_ID,
        statementId: WAGE_STATEMENT_ID,
        revision: 1,
        kind: "base",
        status: "confirmed",
        sourceVersionId: WAGE_SOURCE_VERSION_ID,
        sourceSnapshot: { sourceVersionId: WAGE_SOURCE_VERSION_ID },
        createdByUserId: PREPARER_ID,
        lastEditedByUserId: PREPARER_ID,
        confirmedByUserId: REVIEWER_ID,
        confirmedAt: new Date("2024-02-01T00:00:00.000Z")
      }
    });
    await prisma.wagePersonLine.create({
      data: {
        id: WAGE_PERSON_LINE_ID,
        statementVersionId: WAGE_STATEMENT_VERSION_ID,
        employeeId: PREPARER_ID,
        employmentSnapshotId: randomUUID(),
        employeeSnapshot: { protected: true },
        employmentSnapshot: { protected: true },
        periodSnapshot: { wageMonth: "2024-01" },
        positionCategorySnapshot: { category: "general_worker" },
        approvedAmountCents: 12_000n
      }
    });
    await prisma.wageCreditorBreakdown.create({
      data: {
        id: WAGE_CREDITOR_BREAKDOWN_ID,
        personLineId: WAGE_PERSON_LINE_ID,
        creditorSubjectType: "employee_user",
        creditorUserId: PREPARER_ID,
        creditorSubjectIdentityKey: `employee_user:${PREPARER_ID}`,
        creditorNameSnapshot: "POL-224 动态测试工资债权人",
        creditorUnifiedIdentitySnapshot: null,
        creditorVersionFingerprint: "c".repeat(64),
        creditorCategory: "employee_net_pay",
        amountCents: 12_000n,
        sourceSnapshot: { protected: true }
      }
    });
    await prisma.wageServiceBasisBinding.create({
      data: {
        id: WAGE_SERVICE_BASIS_ID,
        sourceVersionId: WAGE_SOURCE_VERSION_ID,
        projectId: PROJECT_ID,
        serviceSnapshotId: randomUUID(),
        serviceMonth: "2024-01",
        evidenceSha256: "d".repeat(64),
        authorityFingerprint: "e".repeat(64)
      }
    });
    await prisma.wageProjectAllocation.create({
      data: {
        id: WAGE_PROJECT_ALLOCATION_ID,
        personLineId: WAGE_PERSON_LINE_ID,
        projectId: PROJECT_ID,
        serviceSnapshotId: randomUUID(),
        serviceBasisBindingId: WAGE_SERVICE_BASIS_ID,
        serviceSnapshot: { projectId: PROJECT_ID },
        amountCents: 12_000n
      }
    });
    await prisma.wagePayableRef.create({
      data: {
        id: WAGE_PAYABLE_REF_ID,
        confirmedVersionId: WAGE_STATEMENT_VERSION_ID,
        projectAllocationId: WAGE_PROJECT_ALLOCATION_ID,
        creditorBreakdownId: WAGE_CREDITOR_BREAKDOWN_ID,
        debtorCompanyId: COMPANY_ENTITY_ID,
        costBearingCompanyId: COMPANY_ENTITY_ID,
        projectId: PROJECT_ID,
        personLineId: WAGE_PERSON_LINE_ID,
        debtorCompanySnapshot: { companyId: COMPANY_ENTITY_ID },
        costBearingCompanySnapshot: { companyId: COMPANY_ENTITY_ID },
        projectSnapshot: { projectId: PROJECT_ID },
        personSnapshot: { protected: true },
        creditorSnapshot: {
          subjectType: "employee_user",
          identityKey: `employee_user:${PREPARER_ID}`,
          name: "POL-224 动态测试工资债权人"
        },
        amountCents: 12_000n,
        direction: "increase",
        settlementRecheckRequired: false
      }
    });
    await prisma.paymentRequest.create({
      data: {
        id: PAYMENT_REQUEST_ID,
        projectId: PROJECT_ID,
        sourceType: "contract_due",
        contractId: CONTRACT_ID,
        contractVersionId: CONTRACT_VERSION_ID,
        paymentTermsVersionId: PAYMENT_TERMS_VERSION_ID,
        code: "POL224-PAYMENT-REQUEST",
        status: "paid",
        requestedAmountCents: 12_000n,
        approvedAmountCents: 12_000n,
        paidAmountCents: 12_000n
      }
    });
    await prisma.paymentExecution.create({
      data: {
        id: PAYMENT_EXECUTION_ID,
        idempotencyKey: randomUUID(),
        paymentRequestId: PAYMENT_REQUEST_ID,
        companyEntityIdSnapshot: COMPANY_ENTITY_ID,
        companyEntityNameSnapshot: "POL-224 动态测试付款公司",
        companyEntityCreditCodeSnapshot: "91310000POL224TEST",
        amountCents: 12_000n,
        paidAt: new Date("2024-01-15T10:00:00.000Z"),
        executedByUserId: PREPARER_ID,
        voucherFileId: VOUCHER_FILE_ID
      }
    });
    await prisma.payableSettlementCase.create({
      data: {
        id: SETTLEMENT_CASE_ID,
        paymentExecutionId: PAYMENT_EXECUTION_ID,
        status: "draft",
        revision: 1,
        createdByUserId: PREPARER_ID
      }
    });
    await prisma.payableSettlementAllocation.create({
      data: {
        id: SETTLEMENT_ALLOCATION_ID,
        settlementCaseId: SETTLEMENT_CASE_ID,
        paymentExecutionId: PAYMENT_EXECUTION_ID,
        payableRef: WAGE_PAYABLE_REF_ID,
        sourceType: "wage_payable_ref",
        sourceAggregateId: WAGE_STATEMENT_VERSION_ID,
        sourceLineId: WAGE_PAYABLE_REF_ID,
        confirmedVersionId: WAGE_STATEMENT_VERSION_ID,
        debtorCompanyId: COMPANY_ENTITY_ID,
        payeeSubjectType: "employee_user",
        payeeSubjectId: `employee_user:${PREPARER_ID}`,
        currencyCode: "CNY",
        beneficiaryProjectId: PROJECT_ID,
        sourceSnapshot: { source: "POL-224 PG16" },
        confirmedAmountCents: 12_000n,
        amountCents: 12_000n,
        createdByUserId: PREPARER_ID
      }
    });
    await prisma.payableSettlementCase.update({
      where: { id: SETTLEMENT_CASE_ID },
      data: {
        status: "submitted",
        revision: { increment: 1 },
        submittedByUserId: PREPARER_ID,
        submittedAt: new Date("2024-01-16T10:00:00.000Z")
      }
    });
    await prisma.payableSettlementCase.update({
      where: { id: SETTLEMENT_CASE_ID },
      data: {
        status: "confirmed",
        revision: { increment: 1 },
        confirmedByUserId: REVIEWER_ID,
        confirmedAt: new Date("2024-01-17T10:00:00.000Z")
      }
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("keeps apply inactive, activates only A/B, then compensates in reverse causality", async () => {
    const prepared = await service.prepare(PROJECT_ID, PREPARER_ID, {
      idempotencyKey: randomUUID(),
      expectedRevision: 0,
      asOfDate: "2026-08-01",
      rows: [
        {
          sourceType: "legacy_finance_ledger",
          sourceBusinessId: "ALLOC-2024-001",
          sourceVersion: 1,
          sourceCoordinate: "核销台账!A2:Z2",
          normalizedRowHash: "f".repeat(64),
          kind: "settlement_allocation",
          evidenceLevel: "A",
          amountCents: "12000",
          targetRef: SETTLEMENT_ALLOCATION_ID
        },
        {
          sourceType: "legacy_finance_ledger",
          sourceBusinessId: "PAY-2024-001",
          sourceVersion: 1,
          sourceCoordinate: "付款台账!A2:Z2",
          normalizedRowHash: "a".repeat(64),
          kind: "payment_execution",
          evidenceLevel: "A",
          amountCents: "12000",
          targetRef: PAYMENT_EXECUTION_ID
        },
        {
          sourceType: "legacy_finance_ledger",
          sourceBusinessId: "OPENING-2024-001",
          sourceVersion: 1,
          sourceCoordinate: "期初余额!A2:Z2",
          normalizedRowHash: "b".repeat(64),
          kind: "opening_balance",
          evidenceLevel: "B",
          amountCents: "30000",
          openingBalance: {
            axis: "payable",
            subjectKey: "company:our-company",
            counterpartyKey: "party:supplier-a",
            categoryCode: "supplier_payable",
            period: "2024-01",
            grossAmountCents: "30000",
            evidenceReference: "2024年1月财务总账第18页"
          }
        },
        {
          sourceType: "legacy_finance_ledger",
          sourceBusinessId: "GAP-2024-001",
          sourceVersion: 1,
          sourceCoordinate: "待核对!A2:Z2",
          normalizedRowHash: "c".repeat(64),
          kind: "fund_movement",
          evidenceLevel: "C",
          amountCents: "500",
          gapReason: "只能证明大概金额，缺少银行与主体证据"
        }
      ]
    });
    expect(prepared).toMatchObject({ status: "prepared", revision: 1, rowCount: 4, decisions: ["LINK", "LINK", "OPENING_BALANCE", "GAP"] });

    await expect(service.activeProjection(PROJECT_ID, REVIEWER_ID)).resolves.toEqual([]);
    const applied = await service.applyInactive(PROJECT_ID, prepared.batchId, PREPARER_ID, {
      idempotencyKey: randomUUID(),
      expectedRevision: 1,
      manifestFingerprint: prepared.manifestFingerprint
    });
    expect(applied).toMatchObject({ status: "applied_inactive", revision: 2 });
    await expect(service.activeProjection(PROJECT_ID, REVIEWER_ID)).resolves.toEqual([]);

    await expect(service.attest(PROJECT_ID, prepared.batchId, PREPARER_ID, {
      idempotencyKey: randomUUID(),
      expectedRevision: 2,
      manifestFingerprint: prepared.manifestFingerprint
    })).rejects.toThrow("财务负责人");
    await expect(service.attest(PROJECT_ID, prepared.batchId, REVIEWER_ID, {
      idempotencyKey: randomUUID(),
      expectedRevision: 2,
      manifestFingerprint: prepared.manifestFingerprint
    })).resolves.toMatchObject({ status: "attested", revision: 3 });

    await expect(service.activate(PROJECT_ID, prepared.batchId, REVIEWER_ID, {
      idempotencyKey: randomUUID(),
      expectedRevision: 3,
      manifestFingerprint: prepared.manifestFingerprint
    })).rejects.toThrow("激活人与财务复核人必须分离");
    await expect(service.activate(PROJECT_ID, prepared.batchId, ACTIVATOR_ID, {
      idempotencyKey: randomUUID(),
      expectedRevision: 3,
      manifestFingerprint: prepared.manifestFingerprint
    })).resolves.toMatchObject({ status: "activated", revision: 4, activeFormalRows: 3, unresolvedGapRows: 1 });

    const active = await service.activeProjection(PROJECT_ID, REVIEWER_ID);
    expect(active).toHaveLength(3);
    expect(active.map((row) => row.evidenceLevel)).toEqual(["A", "A", "B"]);
    expect(active.every((row) => !row.newPaymentAllowed && !row.settlementAllocationAllowed)).toBe(true);

    await expect(service.compensate(PROJECT_ID, prepared.batchId, COMPENSATOR_ID, {
      idempotencyKey: randomUUID(),
      expectedRevision: 4,
      manifestFingerprint: prepared.manifestFingerprint,
      reason: "撤销本次测试接管资格"
    })).resolves.toMatchObject({ status: "compensated", revision: 5, reversedRows: 3 });
    await expect(service.activeProjection(PROJECT_ID, REVIEWER_ID)).resolves.toEqual([]);

    const compensation = await prisma.historicalFinancialTakeoverCompensation.findUniqueOrThrow({ where: { batchId: prepared.batchId } });
    expect(compensation.reverseCausalitySnapshot).toEqual([
      expect.objectContaining({ reverseOrdinal: 1, causesRowNo: 3 }),
      expect.objectContaining({ reverseOrdinal: 2, causesRowNo: 2 }),
      expect.objectContaining({ reverseOrdinal: 3, causesRowNo: 1 })
    ]);
  });

  it("rejects manifest drift and keeps mapping rows append-only", async () => {
    const prepared = await service.prepare(PROJECT_ID, PREPARER_ID, {
      idempotencyKey: randomUUID(),
      expectedRevision: 0,
      asOfDate: "2026-08-01",
      rows: [{
        sourceType: "legacy_finance_ledger",
        sourceBusinessId: "GAP-2024-DRIFT",
        sourceVersion: 1,
        sourceCoordinate: "待核对!A9:Z9",
        normalizedRowHash: "d".repeat(64),
        kind: "fund_movement",
        evidenceLevel: "C",
        amountCents: "500",
        gapReason: "资料缺少完整主体勾稽"
      }]
    });
    await expect(service.applyInactive(PROJECT_ID, prepared.batchId, PREPARER_ID, {
      idempotencyKey: randomUUID(),
      expectedRevision: 1,
      manifestFingerprint: "e".repeat(64)
    })).rejects.toThrow("manifest fingerprint 已漂移");

    const row = await prisma.historicalFinancialTakeoverRowMapping.findFirstOrThrow({ where: { batchId: prepared.batchId } });
    await expect(prisma.historicalFinancialTakeoverRowMapping.update({
      where: { id: row.id },
      data: { amountCents: 501n }
    })).rejects.toThrow("只允许追加");
  });

  it("rejects canonical read-set drift and atomically blocks conflicting duplicate groups", async () => {
    const prepared = await service.prepare(PROJECT_ID, PREPARER_ID, {
      idempotencyKey: randomUUID(),
      expectedRevision: 0,
      asOfDate: "2026-08-01",
      rows: [{
        sourceType: "legacy_finance_ledger",
        sourceBusinessId: "PAY-2024-DRIFT",
        sourceVersion: 1,
        sourceCoordinate: "付款台账!A20:Z20",
        normalizedRowHash: "1".repeat(64),
        kind: "payment_execution",
        evidenceLevel: "A",
        amountCents: "12000",
        targetRef: PAYMENT_EXECUTION_ID
      }]
    });
    await prisma.paymentRequest.update({
      where: { id: PAYMENT_REQUEST_ID },
      data: {
        status: "partially_paid",
        requestedAmountCents: 13_000n,
        approvedAmountCents: 13_000n
      }
    });
    await expect(service.applyInactive(PROJECT_ID, prepared.batchId, PREPARER_ID, {
      idempotencyKey: randomUUID(),
      expectedRevision: 1,
      manifestFingerprint: prepared.manifestFingerprint
    })).rejects.toThrow("权威 read-set 已漂移");

    const batchCount = await prisma.historicalFinancialTakeoverBatch.count();
    await expect(service.prepare(PROJECT_ID, PREPARER_ID, {
      idempotencyKey: randomUUID(),
      expectedRevision: 0,
      asOfDate: "2026-08-01",
      rows: [
        {
          sourceType: "legacy_finance_ledger",
          sourceBusinessId: "OPENING-CONFLICT-A",
          sourceVersion: 1,
          sourceCoordinate: "期初余额!A20:Z20",
          normalizedRowHash: "2".repeat(64),
          kind: "opening_balance",
          evidenceLevel: "B",
          amountCents: "100",
          openingBalance: {
            axis: "payable",
            subjectKey: "company:conflict",
            counterpartyKey: "party:conflict",
            categoryCode: "supplier_payable",
            period: "2024-01",
            grossAmountCents: "100",
            evidenceReference: "冲突测试依据 A"
          }
        },
        {
          sourceType: "legacy_finance_ledger",
          sourceBusinessId: "OPENING-CONFLICT-B",
          sourceVersion: 1,
          sourceCoordinate: "期初余额!A21:Z21",
          normalizedRowHash: "3".repeat(64),
          kind: "opening_balance",
          evidenceLevel: "B",
          amountCents: "200",
          openingBalance: {
            axis: "payable",
            subjectKey: "company:conflict",
            counterpartyKey: "party:conflict",
            categoryCode: "supplier_payable",
            period: "2024-01",
            grossAmountCents: "200",
            evidenceReference: "冲突测试依据 B"
          }
        }
      ]
    })).rejects.toThrow("duplicate group 存在关键冲突");
    await expect(prisma.historicalFinancialTakeoverBatch.count()).resolves.toBe(batchCount);
  });

  it("does not expose historical wage summary payable refs as payable targets", async () => {
    const migration = await prisma.$queryRaw<Array<{ definition: string }>>`
      SELECT pg_get_functiondef(oid) AS definition
      FROM pg_proc
      WHERE proname = 'jg_pol224_validate_row_target'
    `;
    expect(migration[0]?.definition).toContain("historical_reconciliation_only");
    expect(migration[0]?.definition).toContain("HistoricalWageSummaryPayableRef");
  });
});
