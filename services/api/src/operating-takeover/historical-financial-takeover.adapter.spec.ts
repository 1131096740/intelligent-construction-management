import { ConflictException } from "@nestjs/common";
import { HistoricalFinancialTakeoverAdapter } from "./historical-financial-takeover.adapter";
import {
  assertHistoricalFinancialTakeoverProjectionReadAllowed,
  assertHistoricalFinancialTakeoverWriteAllowed,
  serializeHistoricalFinancialTakeoverBatch
} from "./historical-financial-takeover.service";

const adapter = new HistoricalFinancialTakeoverAdapter();

const source = {
  projectId: "00000000-0000-4000-8000-000000000001",
  sourceType: "legacy_finance_ledger",
  sourceBusinessId: "PAY-2024-001",
  sourceVersion: 1,
  sourceCoordinate: "付款台账!A2:Z2",
  normalizedRowHash: "a".repeat(64),
  amountCents: 12_000n,
  currencyCode: "CNY",
  asOfDate: new Date("2026-08-01T00:00:00.000Z")
} as const;

describe("HistoricalFinancialTakeoverAdapter", () => {
  it("A 级付款只链接既有 PaymentExecution，并形成稳定银行 duplicate group", () => {
    const first = adapter.map({
      ...source,
      kind: "payment_execution",
      evidenceLevel: "A",
      paymentExecution: {
        id: "00000000-0000-4000-8000-000000000101",
        idempotencyKey: "payment:001",
        voucherFileId: "00000000-0000-4000-8000-000000000102",
        amountCents: 12_000n,
        paidAt: new Date("2024-01-15T10:00:00.000Z"),
        payerCompanyEntityId: "00000000-0000-4000-8000-000000000103"
      },
      legacyDedupeRefs: {
        projectProxyPaymentId: "00000000-0000-4000-8000-000000000104"
      }
    });
    const replay = adapter.map({
      ...source,
      kind: "payment_execution",
      evidenceLevel: "A",
      paymentExecution: {
        id: "00000000-0000-4000-8000-000000000101",
        idempotencyKey: "payment:001",
        voucherFileId: "00000000-0000-4000-8000-000000000102",
        amountCents: 12_000n,
        paidAt: new Date("2024-01-15T10:00:00.000Z"),
        payerCompanyEntityId: "00000000-0000-4000-8000-000000000103"
      },
      legacyDedupeRefs: {
        projectProxyPaymentId: "00000000-0000-4000-8000-000000000104"
      }
    });

    expect(first.decision).toBe("LINK");
    expect(first.targetKind).toBe("payment_execution");
    expect(first.targetRef).toBe("00000000-0000-4000-8000-000000000101");
    expect(first.bankDuplicateGroupKey).toMatch(/^bank:/);
    expect(replay.mappingFingerprint).toBe(first.mappingFingerprint);
    expect(first.legacyDedupeRefs).toEqual({
      projectProxyPaymentId: "00000000-0000-4000-8000-000000000104",
      projectAffiliatePaymentFactId: null
    });
  });

  it("A 级应付必须绑定封闭 payable 身份", () => {
    const mapped = adapter.map({
      ...source,
      kind: "payable",
      evidenceLevel: "A",
      payable: {
        payableRef: "wage_payable:00000000-0000-4000-8000-000000000201",
        sourceType: "wage_payable_ref",
        sourceAggregateId: "00000000-0000-4000-8000-000000000202",
        sourceLineId: "00000000-0000-4000-8000-000000000203",
        confirmedVersionId: "00000000-0000-4000-8000-000000000204",
        debtorCompanyId: "00000000-0000-4000-8000-000000000205",
        payeeSubjectType: "user",
        payeeSubjectId: "00000000-0000-4000-8000-000000000206",
        beneficiaryProjectId: source.projectId,
        grossAmountCents: 12_000n
      }
    });

    expect(mapped.decision).toBe("LINK");
    expect(mapped.payableDuplicateGroupKey).toMatch(/^payable:/);
    expect(mapped.targetRef).toBe("wage_payable:00000000-0000-4000-8000-000000000201");
  });

  it("A 级核销同时冻结既有分配、PaymentExecution 与 payable 身份", () => {
    const mapped = adapter.map({
      ...source,
      kind: "settlement_allocation",
      evidenceLevel: "A",
      settlementAllocation: {
        id: "00000000-0000-4000-8000-000000000211",
        settlementCaseId: "00000000-0000-4000-8000-000000000212",
        paymentExecutionId: "00000000-0000-4000-8000-000000000101",
        payableRef: "wage_payable:00000000-0000-4000-8000-000000000201",
        sourceType: "wage_payable_ref",
        sourceAggregateId: "00000000-0000-4000-8000-000000000202",
        sourceLineId: "00000000-0000-4000-8000-000000000203",
        confirmedVersionId: "00000000-0000-4000-8000-000000000204",
        debtorCompanyId: "00000000-0000-4000-8000-000000000205",
        payeeSubjectType: "user",
        payeeSubjectId: "00000000-0000-4000-8000-000000000206",
        beneficiaryProjectId: source.projectId,
        amountCents: 12_000n,
        currencyCode: "CNY",
        paymentIdempotencyKey: "payment:001",
        paymentVoucherFileId: "00000000-0000-4000-8000-000000000102",
        paymentPaidAt: new Date("2024-01-15T10:00:00.000Z"),
        payerCompanyEntityId: "00000000-0000-4000-8000-000000000103"
      }
    });

    expect(mapped).toMatchObject({
      decision: "LINK",
      targetKind: "settlement_allocation",
      targetRef: "00000000-0000-4000-8000-000000000211"
    });
    expect(mapped.bankDuplicateGroupKey).toMatch(/^bank:/);
    expect(mapped.payableDuplicateGroupKey).toMatch(/^payable:/);
  });

  it("B 级只产生可证明期初毛额余额，禁止伪造付款或核销", () => {
    const mapped = adapter.map({
      ...source,
      kind: "opening_balance",
      evidenceLevel: "B",
      openingBalance: {
        axis: "payable",
        subjectKey: "company:00000000-0000-4000-8000-000000000301",
        counterpartyKey: "party:00000000-0000-4000-8000-000000000302",
        categoryCode: "supplier_payable",
        period: "2024-01",
        grossAmountCents: 12_000n,
        evidenceReference: "2024年1月财务总账第18页"
      }
    });

    expect(mapped.decision).toBe("OPENING_BALANCE");
    expect(mapped.targetKind).toBe("historical_opening_balance");
    expect(mapped.bankDuplicateGroupKey).toBeNull();
    expect(mapped.targetSnapshot).not.toHaveProperty("paymentExecutionId");
    expect(mapped.targetSnapshot).not.toHaveProperty("settledAmountCents");
  });

  it("拒绝 B 级携带银行付款身份", () => {
    expect(() => adapter.map({
      ...source,
      kind: "opening_balance",
      evidenceLevel: "B",
      openingBalance: {
        axis: "fund",
        subjectKey: "company:00000000-0000-4000-8000-000000000301",
        counterpartyKey: "project:00000000-0000-4000-8000-000000000001",
        categoryCode: "project_fund",
        period: "2024-01",
        grossAmountCents: 12_000n,
        evidenceReference: "银行余额调节表"
      },
      paymentExecution: {
        id: "00000000-0000-4000-8000-000000000101",
        idempotencyKey: "payment:001",
        voucherFileId: "00000000-0000-4000-8000-000000000102",
        amountCents: 12_000n,
        paidAt: new Date("2024-01-15T10:00:00.000Z"),
        payerCompanyEntityId: "00000000-0000-4000-8000-000000000103"
      }
    })).toThrow(ConflictException);
  });

  it("C 级只形成待核对 gap", () => {
    const mapped = adapter.map({
      ...source,
      kind: "fund_movement",
      evidenceLevel: "C",
      gapReason: "只能证明大概金额，缺少银行与主体证据"
    });

    expect(mapped.decision).toBe("GAP");
    expect(mapped.targetKind).toBeNull();
    expect(mapped.targetRef).toBeNull();
    expect(mapped.conflictGroupKeys).toEqual([expect.stringMatching(/^source:/)]);
  });

  it("旧 ProjectProxyPayment/ProjectAffiliatePaymentFact 不能成为正式 target", () => {
    expect(() => adapter.map({
      ...source,
      kind: "payment_execution",
      evidenceLevel: "A",
      legacyDedupeRefs: {
        projectAffiliatePaymentFactId: "00000000-0000-4000-8000-000000000401"
      }
    })).toThrow("A 级付款必须引用既有 PaymentExecution");
  });
});

describe("POL-224 production authorization boundary", () => {
  it.each(["prepare", "apply_inactive", "attest", "activate", "compensate"] as const)(
    "fails closed for production %s without a separately authorized production path",
    (action) => {
      expect(() => assertHistoricalFinancialTakeoverWriteAllowed(action, "production"))
        .toThrow("未获独立生产授权");
      expect(() => assertHistoricalFinancialTakeoverWriteAllowed(action, "test"))
        .not.toThrow();
    }
  );

  it("restricts the active financial projection to finance roles", () => {
    expect(() => assertHistoricalFinancialTakeoverProjectionReadAllowed(["contract_director"]))
      .toThrow("只允许财务岗位读取");
    expect(() => assertHistoricalFinancialTakeoverProjectionReadAllowed(["finance_staff"]))
      .not.toThrow();
  });

  it("redacts canonical target identifiers and compensation causes for non-finance detail readers", () => {
    const batch = {
      id: "batch-1",
      projectId: "project-1",
      asOfDate: new Date("2026-06-30T00:00:00.000Z"),
      status: "activated",
      revision: 4,
      manifestFingerprint: "manifest",
      readSetFingerprint: "read-set",
      candidateBaselineSha: "a".repeat(40),
      rows: [{
        id: "row-1",
        rowNo: 1,
        kind: "payable",
        evidenceLevel: "A",
        mappingDecision: "LINK",
        amountCents: 100n,
        currencyCode: "CNY",
        targetKind: "payable",
        targetRef: "wage:person:secret",
        targetFingerprint: "target-fingerprint",
        targetSnapshot: { payeeSubjectId: "secret-person" },
        projectionStatus: "applied_inactive",
        newPaymentAllowed: false,
        settlementAllocationAllowed: false
      }],
      receipts: [],
      activation: { id: "activation-1" },
      compensation: { reverseCausalitySnapshot: [{ targetRef: "wage:person:secret" }] }
    };

    const redacted = serializeHistoricalFinancialTakeoverBatch(batch, false);
    expect(redacted.rows[0]).toMatchObject({ targetRef: null, targetSnapshot: null });
    expect(redacted.compensation).toEqual({ redacted: true });

    const finance = serializeHistoricalFinancialTakeoverBatch(batch, true);
    expect(finance.rows[0]).toMatchObject({
      targetRef: "wage:person:secret",
      targetSnapshot: { payeeSubjectId: "secret-person" }
    });
  });
});
