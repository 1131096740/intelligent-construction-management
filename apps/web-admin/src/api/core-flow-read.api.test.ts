import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchContractDetail,
  fetchContractLedger,
  fetchPaymentDetail,
  fetchPaymentLedger,
  fetchSettlementDetail,
  fetchSettlementLedger,
  fetchArchives,
  fetchAuditLogs,
  fetchProjectOperatingOverview,
  fetchProjects,
  confirmProjectOwnerContract,
  recordProjectReceipt,
  recordProjectOwnerContract,
  recordProjectProxyPayment,
  recordProjectUpstreamSettlement,
  requestSettlementExceptionQuota,
  requestProjectFinancingQuota,
  reviewSettlementExceptionQuota,
  reviewProjectFinancingQuota,
  createProjectExpenseRequest,
  reviewProjectExpenseApproval,
  withdrawProjectExpenseApproval,
  voidProjectExpenseRequest,
  recordProjectExpenseExecution,
  recordProjectExpenseFinance,
  createContractDraft,
  createPaymentRequest,
  createPrivateFileDownloadTicket,
  createSettlementDraft,
  confirmContractArchive,
  confirmSettlementArchive,
  delegateContractApproval,
  delegatePaymentApproval,
  fetchActiveContractNumberRules,
  generateContractPdfArchive,
  generatePaymentPdfArchive,
  generateSettlementPdfArchive,
  approveContractSeal,
  remindContractApproval,
  remindPaymentApproval,
  remindSettlementApproval,
  reviewContractApproval,
  reviewSettlementApproval,
  submitContractApproval,
  uploadContractArchiveFile,
  uploadPrivateFile,
  uploadSettlementArchiveFile,
  recordPaymentExecution,
  recordPaymentFinance,
  recordPaymentPdfArchive,
  reviewPaymentApproval,
  withdrawContractApproval,
  withdrawPaymentApproval,
  withdrawSettlementApproval,
  transferSettlementApproval,
  delegateSettlementApproval,
  transferContractApproval,
  transferPaymentApproval,
  listApprovalDelegations,
  createApprovalDelegation,
  revokeApprovalDelegation
} from "./core-flow-read.api";

describe("core flow read API client", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requests the first read-only detail endpoints", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ id: "ok" })
    } as Response);

    await fetchContractDetail("HT-2026-001");
    await fetchSettlementDetail("JS-2026-018");
    await fetchPaymentDetail("FK-2026-006");

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/contracts/HT-2026-001",
      "/api/settlements/JS-2026-018",
      "/api/payments/FK-2026-006"
    ]);
  });

  it("requests operational ledger endpoints", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ rows: [], summary: {} })
    } as Response);

    await fetchContractLedger();
    await fetchSettlementLedger();
    await fetchPaymentLedger();
    await fetchAuditLogs();
    await fetchArchives();

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/contracts",
      "/api/settlements",
      "/api/payments",
      "/api/audit-logs",
      "/api/archives"
    ]);
  });

  it("requests project operating overview endpoints", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ project: { id: "project-1" } })
    } as Response);

    await fetchProjects();
    await fetchProjectOperatingOverview("project-1");

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/projects",
      "/api/projects/project-1/operating-funds-overview"
    ]);
  });

  it("records project actual receipts through the backend", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ id: "receipt-1" })
    } as Response);

    await recordProjectReceipt("project-1", {
      receivedAt: "2026-07-02",
      amountCents: 123456,
      payerName: "建设单位",
      sourceType: "owner_direct_payment",
      description: "业主直付",
      voucherFileId: "file-receipt-1",
      confirmationPassword: "current-password"
    });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/projects/project-1/receipts"
    ]);
    expect(fetchMock.mock.calls[0][1]?.method).toBe("POST");
    expect(fetchMock.mock.calls[0][1]?.body).toBe(
      JSON.stringify({
        receivedAt: "2026-07-02",
        amountCents: 123456,
        payerName: "建设单位",
        sourceType: "owner_direct_payment",
        description: "业主直付",
        voucherFileId: "file-receipt-1",
        confirmationPassword: "current-password"
      })
    );
  });

  it("records project proxy payments through the backend", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ id: "direct-payment-1" })
    } as Response);

    await recordProjectProxyPayment("project-1", {
      paidAt: "2026-07-02",
      amountCents: 123456,
      generalContractorName: "总包单位",
      paidTargetName: "材料供应商",
      paymentType: "material",
      description: "总包代付材料款",
      voucherFileId: "file-direct-payment-1",
      confirmationPassword: "current-password"
    });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/projects/project-1/proxy-payments"
    ]);
    expect(fetchMock.mock.calls[0][1]?.method).toBe("POST");
    expect(fetchMock.mock.calls[0][1]?.body).toBe(
      JSON.stringify({
        paidAt: "2026-07-02",
        amountCents: 123456,
        generalContractorName: "总包单位",
        paidTargetName: "材料供应商",
        paymentType: "material",
        description: "总包代付材料款",
        voucherFileId: "file-direct-payment-1",
        confirmationPassword: "current-password"
      })
    );
  });

  it("records project upstream settlements through the backend", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ id: "upstream-1" })
    } as Response);

    await recordProjectUpstreamSettlement("project-1", {
      settledAt: "2026-07-02",
      reportedAmountCents: 35000000,
      approvedAmountCents: 30000000,
      approvingPartyName: "总包单位",
      periodLabel: "2026-06",
      isFinal: false,
      description: "六月对上审定",
      voucherFileId: "file-upstream-1",
      confirmationPassword: "current-password"
    });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/projects/project-1/upstream-settlements"
    ]);
    expect(fetchMock.mock.calls[0][1]?.method).toBe("POST");
    expect(fetchMock.mock.calls[0][1]?.body).toBe(
      JSON.stringify({
        settledAt: "2026-07-02",
        reportedAmountCents: 35000000,
        approvedAmountCents: 30000000,
        approvingPartyName: "总包单位",
        periodLabel: "2026-06",
        isFinal: false,
        description: "六月对上审定",
        voucherFileId: "file-upstream-1",
        confirmationPassword: "current-password"
      })
    );
  });

  it("records and confirms project owner contracts through the backend", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ id: "owner-contract-1" })
    } as Response);

    await recordProjectOwnerContract("project-1", {
      ownerName: "建设单位",
      contractName: "一期施工总承包合同",
      contractCode: "YZ-2026-001",
      signedAt: "2026-07-02",
      amountCents: 200000000,
      taxRateBps: 900,
      pricingMethod: "fixed_total",
      paymentTermsSummary: "按进度支付",
      retentionSummary: "3%质保金",
      fileId: "file-owner-contract-1"
    });
    await confirmProjectOwnerContract("project-1", "owner-contract-1", {
      confirmationPassword: "current-password"
    });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/projects/project-1/owner-contracts",
      "/api/projects/project-1/owner-contracts/owner-contract-1/confirmation"
    ]);
    expect(fetchMock.mock.calls.every((call) => call[1]?.method === "POST")).toBe(true);
    expect(fetchMock.mock.calls[0][1]?.body).toBe(
      JSON.stringify({
        ownerName: "建设单位",
        contractName: "一期施工总承包合同",
        contractCode: "YZ-2026-001",
        signedAt: "2026-07-02",
        amountCents: 200000000,
        taxRateBps: 900,
        pricingMethod: "fixed_total",
        paymentTermsSummary: "按进度支付",
        retentionSummary: "3%质保金",
        fileId: "file-owner-contract-1"
      })
    );
    expect(fetchMock.mock.calls[1][1]?.body).toBe(
      JSON.stringify({ confirmationPassword: "current-password" })
    );
  });

  it("requests and reviews settlement exception quotas through the backend", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ id: "quota-1" })
    } as Response);

    await requestSettlementExceptionQuota("project-1", {
      contractId: "contract-1",
      amountCents: 1200000,
      reason: "对上审定暂未覆盖的现场签证",
      validUntil: "2026-08-31",
      attachmentFileId: "file-quota-1"
    });
    await reviewSettlementExceptionQuota("project-1", "quota-1", {
      decision: "approve",
      confirmationPassword: "current-password",
      comment: "同意"
    });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/projects/project-1/settlement-exception-quotas",
      "/api/projects/project-1/settlement-exception-quotas/quota-1/approval"
    ]);
    expect(fetchMock.mock.calls.every((call) => call[1]?.method === "POST")).toBe(true);
    expect(fetchMock.mock.calls[0][1]?.body).toBe(
      JSON.stringify({
        contractId: "contract-1",
        amountCents: 1200000,
        reason: "对上审定暂未覆盖的现场签证",
        validUntil: "2026-08-31",
        attachmentFileId: "file-quota-1"
      })
    );
    expect(fetchMock.mock.calls[1][1]?.body).toBe(
      JSON.stringify({
        decision: "approve",
        confirmationPassword: "current-password",
        comment: "同意"
      })
    );
  });

  it("requests and reviews project financing quotas through the backend", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ id: "quota-1" })
    } as Response);

    await requestProjectFinancingQuota("project-1", {
      amountCents: 5000000,
      reason: "阶段性垫资保障项目付款",
      validUntil: "2026-08-31",
      attachmentFileId: "file-financing-1"
    });
    await reviewProjectFinancingQuota("project-1", "quota-1", {
      decision: "approve",
      confirmationPassword: "current-password",
      comment: "同意"
    });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/projects/project-1/financing-quotas",
      "/api/projects/project-1/financing-quotas/quota-1/approval"
    ]);
    expect(fetchMock.mock.calls.every((call) => call[1]?.method === "POST")).toBe(true);
    expect(fetchMock.mock.calls[0][1]?.body).toBe(
      JSON.stringify({
        amountCents: 5000000,
        reason: "阶段性垫资保障项目付款",
        validUntil: "2026-08-31",
        attachmentFileId: "file-financing-1"
      })
    );
    expect(fetchMock.mock.calls[1][1]?.body).toBe(
      JSON.stringify({
        decision: "approve",
        confirmationPassword: "current-password",
        comment: "同意"
      })
    );
  });

  it("posts project expense request workflow actions to the backend", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ id: "expense-1" })
    } as Response);

    await createProjectExpenseRequest("project-1", {
      code: "ZC-2026-001",
      expenseType: "sporadic_payment",
      expenseSubtype: "sporadic_machinery",
      paymentSubject: "零星吊车费",
      reason: "现场临时吊装",
      requestedAmountCents: 80000,
      paymentMethod: "bank_transfer",
      counterpartyName: "张三",
      counterpartyAccountName: "张三",
      counterpartyBankName: "建设银行",
      counterpartyBankAccount: "6222000000000000",
      handlerUserId: "handler-1",
      attachmentFileId: "file-expense-1"
    });
    await reviewProjectExpenseApproval("project-1", "expense-1", {
      decision: "approve",
      approvedAmountCents: 80000,
      comment: "同意"
    });
    await withdrawProjectExpenseApproval("project-1", "expense-1");
    await voidProjectExpenseRequest("project-1", "expense-1", {
      reason: "重复提交"
    });
    await recordProjectExpenseExecution("project-1", "expense-1", {
      amountCents: 80000,
      paidAt: "2026-07-02T10:00:00.000Z",
      voucherFileId: "file-voucher-1",
      confirmationPassword: "current-password"
    });
    await recordProjectExpenseFinance("project-1", "expense-1", {
      amountCents: 80000,
      occurredAt: "2026-07-02T11:00:00.000Z"
    });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/projects/project-1/expense-requests",
      "/api/projects/project-1/expense-requests/expense-1/approval",
      "/api/projects/project-1/expense-requests/expense-1/approval-withdrawal",
      "/api/projects/project-1/expense-requests/expense-1/voiding",
      "/api/projects/project-1/expense-requests/expense-1/executions",
      "/api/projects/project-1/expense-requests/expense-1/finance-records"
    ]);
    expect(fetchMock.mock.calls.every((call) => call[1]?.method === "POST")).toBe(true);
    expect(fetchMock.mock.calls[0][1]?.body).toBe(
      JSON.stringify({
        code: "ZC-2026-001",
        expenseType: "sporadic_payment",
        expenseSubtype: "sporadic_machinery",
        paymentSubject: "零星吊车费",
        reason: "现场临时吊装",
        requestedAmountCents: 80000,
        paymentMethod: "bank_transfer",
        counterpartyName: "张三",
        counterpartyAccountName: "张三",
        counterpartyBankName: "建设银行",
        counterpartyBankAccount: "6222000000000000",
        handlerUserId: "handler-1",
        attachmentFileId: "file-expense-1"
      })
    );
    expect(fetchMock.mock.calls[1][1]?.body).toBe(
      JSON.stringify({
        decision: "approve",
        approvedAmountCents: 80000,
        comment: "同意"
      })
    );
    expect(fetchMock.mock.calls[3][1]?.body).toBe(JSON.stringify({ reason: "重复提交" }));
    expect(fetchMock.mock.calls[4][1]?.body).toBe(
      JSON.stringify({
        amountCents: 80000,
        paidAt: "2026-07-02T10:00:00.000Z",
        voucherFileId: "file-voucher-1",
        confirmationPassword: "current-password"
      })
    );
    expect(fetchMock.mock.calls[5][1]?.body).toBe(
      JSON.stringify({
        amountCents: 80000,
        occurredAt: "2026-07-02T11:00:00.000Z"
      })
    );
  });

  it("creates contract drafts through the backend", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ contract: { code: "HT-2026-002" } })
    } as Response);

    await createContractDraft({
      projectId: "seed-project-jgxm-001",
      code: "HT-2026-002",
      name: "测试合同",
      counterparty: "测试供应商",
      amountCents: 1000000,
      paymentTermsOriginalText: "结算归档确认后30天内付款。",
      paymentStages: [
        {
          name: "当期结算款",
          basis: "current_settlement",
          ratioBps: 8000,
          triggerEvent: "结算归档确认生效",
          dueDays: 30,
          requiresInvoice: true,
          allowsEarlyPayment: false,
          allowsInstallments: true,
          originalText: "结算归档确认后30天内付款80%。"
        }
      ]
    });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(["/api/contracts"]);
    expect(fetchMock.mock.calls[0][1]?.method).toBe("POST");
  });

  it("creates settlement and payment requests through the backend", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ code: "ok" })
    } as Response);

    await createSettlementDraft({
      contractVersionId: "seed-contract-version-ht-2026-001-v1",
      code: "JS-2026-019",
      periodLabel: "2026-06",
      amountCents: 32000000
    });
    await createPaymentRequest({
      settlementId: "seed-settlement-js-2026-018",
      code: "FK-2026-007",
      requestedAmountCents: 25600000
    });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/settlements",
      "/api/payments"
    ]);
    expect(fetchMock.mock.calls.every((call) => call[1]?.method === "POST")).toBe(true);
  });

  it("posts payment workflow actions to the backend", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ id: "ok" })
    } as Response);

    await reviewPaymentApproval("FK-2026-006", {
      decision: "approve",
      approvedAmountCents: 5000000
    });
    await withdrawPaymentApproval("FK-2026-006");
    await remindPaymentApproval("FK-2026-006");
    await transferPaymentApproval("FK-2026-006", {
      toUserId: "payment-transfer-user"
    });
    await delegatePaymentApproval("FK-2026-006", {
      toUserId: "payment-delegate-user"
    });
    await recordPaymentExecution("FK-2026-006", {
      amountCents: 5000000,
      paidAt: "2026-06-22T00:00:00.000Z",
      voucherFileId: "file-1",
      confirmationPassword: "current-password"
    });
    await recordPaymentFinance("FK-2026-006", {
      amountCents: 5000000,
      occurredAt: "2026-06-22T01:00:00.000Z"
    });
    await recordPaymentPdfArchive("FK-2026-006", {
      fileId: "file-2"
    });
    await generatePaymentPdfArchive("FK-2026-006");

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/payments/FK-2026-006/approval",
      "/api/payments/FK-2026-006/approval-withdrawal",
      "/api/payments/FK-2026-006/approval-reminder",
      "/api/payments/FK-2026-006/approval-transfer",
      "/api/payments/FK-2026-006/approval-delegation",
      "/api/payments/FK-2026-006/executions",
      "/api/payments/FK-2026-006/finance-records",
      "/api/payments/FK-2026-006/pdf-archive",
      "/api/payments/FK-2026-006/pdf-generation"
    ]);
    expect(fetchMock.mock.calls.every((call) => call[1]?.method === "POST")).toBe(true);
    expect(fetchMock.mock.calls[0][1]?.body).toBe(
      JSON.stringify({
        decision: "approve",
        approvedAmountCents: 5000000
      })
    );
  });

  it("posts contract and settlement archive actions to the backend", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ id: "ok" })
    } as Response);

    await uploadContractArchiveFile("contract-version-1", {
      fileId: "file-contract-archive"
    });
    await confirmContractArchive("contract-version-1", {
      archiveFileId: "contract-archive-file-1",
      confirmationPassword: "current-password"
    });
    await generateContractPdfArchive("contract-version-1");
    await uploadSettlementArchiveFile("settlement-1", {
      fileId: "file-settlement-archive"
    });
    await confirmSettlementArchive("settlement-1", {
      archiveFileId: "settlement-archive-file-1",
      confirmationPassword: "current-password"
    });
    await generateSettlementPdfArchive("settlement-1");

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/contracts/contract-version-1/archive-files",
      "/api/contracts/contract-version-1/archive-confirmation",
      "/api/contracts/contract-version-1/pdf-generation",
      "/api/settlements/settlement-1/archive-files",
      "/api/settlements/settlement-1/archive-confirmation",
      "/api/settlements/settlement-1/pdf-generation"
    ]);
    expect(fetchMock.mock.calls.every((call) => call[1]?.method === "POST")).toBe(true);
    expect(fetchMock.mock.calls[0][1]?.body).toBe(
      JSON.stringify({
        fileId: "file-contract-archive"
      })
    );
  });

  it("posts contract and settlement approval actions to the backend", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ id: "ok" })
    } as Response);

    await fetchActiveContractNumberRules();
    await submitContractApproval("contract-version-1", {
      numberRuleId: "rule-1"
    });
    await reviewContractApproval("contract-version-1", {
      decision: "approve"
    });
    await withdrawContractApproval("contract-version-1");
    await remindContractApproval("contract-version-1");
    await transferContractApproval("contract-version-1", {
      toUserId: "contract-transfer-user"
    });
    await delegateContractApproval("contract-version-1", {
      toUserId: "contract-delegate-user"
    });
    await approveContractSeal("contract-version-1");
    await reviewSettlementApproval("settlement-1", {
      decision: "approve"
    });
    await withdrawSettlementApproval("settlement-1");
    await remindSettlementApproval("settlement-1");
    await transferSettlementApproval("settlement-1", {
      toUserId: "delegate-user-1"
    });
    await delegateSettlementApproval("settlement-1", {
      toUserId: "agent-user-1"
    });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/contract-number-rules",
      "/api/contracts/contract-version-1/approval-submission",
      "/api/contracts/contract-version-1/approval",
      "/api/contracts/contract-version-1/approval-withdrawal",
      "/api/contracts/contract-version-1/approval-reminder",
      "/api/contracts/contract-version-1/approval-transfer",
      "/api/contracts/contract-version-1/approval-delegation",
      "/api/contracts/contract-version-1/seal-approval",
      "/api/settlements/settlement-1/approval",
      "/api/settlements/settlement-1/approval-withdrawal",
      "/api/settlements/settlement-1/approval-reminder",
      "/api/settlements/settlement-1/approval-transfer",
      "/api/settlements/settlement-1/approval-delegation"
    ]);
    expect(fetchMock.mock.calls[0][1]?.method).toBeUndefined();
    expect(fetchMock.mock.calls.slice(1).every((call) => call[1]?.method === "POST")).toBe(true);
    expect(fetchMock.mock.calls[1][1]?.body).toBe(
      JSON.stringify({
        numberRuleId: "rule-1"
      })
    );
    expect(fetchMock.mock.calls[2][1]?.body).toBe(
      JSON.stringify({
        decision: "approve"
      })
    );
  });

  it("uploads private files through the backend", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ id: "file-1" })
    } as Response);

    await uploadPrivateFile(new Blob(["file"]), "盖章合同.pdf");

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(["/api/files"]);
    expect(fetchMock.mock.calls[0][1]?.method).toBe("POST");
    expect(fetchMock.mock.calls[0][1]?.body).toBeInstanceOf(FormData);
  });

  it("requests private file download tickets through the backend", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ downloadUrl: "/files/file-1/download?token=t" })
    } as Response);

    await createPrivateFileDownloadTicket("file-1", {
      confirmationPassword: "current-password"
    });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/files/file-1/download-ticket"
    ]);
    expect(fetchMock.mock.calls[0][1]?.method).toBe("POST");
    expect(fetchMock.mock.calls[0][1]?.body).toBe(
      JSON.stringify({ confirmationPassword: "current-password" })
    );
  });

  it("manages approval delegations through the backend", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ id: "delegation-1" })
    } as Response);

    await listApprovalDelegations();
    await createApprovalDelegation({
      toUserId: "user-b",
      startsAt: "2026-06-23T00:00:00.000Z",
      endsAt: "2026-07-23T00:00:00.000Z"
    });
    await revokeApprovalDelegation("delegation-1");

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/approval-delegations",
      "/api/approval-delegations",
      "/api/approval-delegations/delegation-1"
    ]);
    expect(fetchMock.mock.calls.map((call) => call[1]?.method)).toEqual([
      undefined,
      "POST",
      "DELETE"
    ]);
    expect(fetchMock.mock.calls[1][1]?.body).toBe(
      JSON.stringify({
        toUserId: "user-b",
        startsAt: "2026-06-23T00:00:00.000Z",
        endsAt: "2026-07-23T00:00:00.000Z"
      })
    );
  });
});
