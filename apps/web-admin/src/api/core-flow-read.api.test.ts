import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchContractDetail,
  fetchContractLedger,
  fetchPaymentDetail,
  fetchPaymentLedger,
  fetchPaymentContractOptions,
  fetchSettlementDetail,
  fetchSettlementContractOptions,
  fetchSettlementLedger,
  fetchWorkbenchSummary,
  fetchContractPaymentApplication,
  fetchArchives,
  fetchAuditLogs,
  fetchFileDownloadAudits,
  fetchProjectExpenseRequests,
  fetchProjectOperatingOverview,
  fetchProjects,
  fetchContractCreateProjects,
  fetchWorkItems,
  createProject,
  updateProject,
  downloadProjectExpenseApprovalPdf,
  downloadProjectExpenseAttachment,
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
  confirmProjectExpenseReceipt,
  recordProjectExpenseExecution,
  recordProjectExpenseFinance,
  recordProjectExpensePurchaseExecution,
  createContractDraft,
  createContractTakeover,
  createContractTakeoverDraftsFromImport,
  listContractTakeoverImportBatches,
  createPaymentRequest,
  precheckContractTakeoverImport,
  createPrivateFileDownloadTicket,
  createSettlementDraft,
  confirmContractTakeover,
  confirmContractArchive,
  confirmSettlementArchive,
  delegateContractApproval,
  delegatePaymentApproval,
  downloadSettlementAttachmentTemplate,
  downloadSettlementLatestApprovalPdf,
  downloadSettlementDraftExcel,
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
  getContractTakeover,
  listContractTakeovers,
  listApprovalDelegations,
  createApprovalDelegation,
  attachContractTakeoverEvidenceFile,
  recordContractTakeoverCorrection,
  fetchApprovalDelegationUserOptions,
  revokeApprovalDelegation,
  submitContractTakeoverReview,
  reviewContractTakeoverImportBatch,
  updateContractTakeover
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

  it("rejects detail reads with server error messages", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 403,
      clone() {
        return this;
      },
      json: async () => ({ message: "无权访问该项目详情" })
    } as Response);

    await expect(fetchSettlementDetail("JS-2026-018")).rejects.toThrow("无权访问该项目详情");
    await expect(fetchPaymentDetail("FK-2026-006")).rejects.toThrow("无权访问该项目详情");
  });

  it("does not expose technical backend messages to business users", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
      clone() {
        return this;
      },
      json: async () => ({ message: "Internal server error" })
    } as Response);

    await expect(fetchPaymentDetail("FK-2026-006")).rejects.toThrow(
      "系统暂时无法完成操作，请稍后重试或联系管理员。"
    );
  });

  it("maps project role guard errors to a Chinese permission message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 403,
      clone() {
        return this;
      },
      json: async () => ({ message: "Missing required project role" })
    } as Response);

    await expect(fetchContractDetail("HT-2026-001")).rejects.toThrow(
      "当前账号暂无该项目或当前节点的处理权限。"
    );
  });

  it("maps forced password-change API errors to a business message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 403,
      clone() {
        return this;
      },
      json: async () => ({ message: "Password change required" })
    } as Response);

    await expect(fetchSettlementDetail("JS-2026-018")).rejects.toThrow(
      "请先完成初始密码修改，再继续办理业务。"
    );
  });

  it("requests the contract payment application preview endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ contract: { contractVersionId: "contract-version/1" } })
    } as Response);

    await fetchContractPaymentApplication("contract-version/1");

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/payments/contract-application?contractVersionId=contract-version%2F1"
    ]);
  });

  it("requests business contract option endpoints for settlement and payment forms", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => []
    } as Response);

    await fetchSettlementContractOptions("project/1");
    await fetchPaymentContractOptions("project/1");

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/contracts/settlement-create-options?projectId=project%2F1",
      "/api/contracts/payment-create-options?projectId=project%2F1"
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
    await fetchFileDownloadAudits();
    await fetchArchives();

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/contracts",
      "/api/settlements",
      "/api/payments",
      "/api/audit-logs",
      "/api/audit-logs/file-downloads",
      "/api/archives"
    ]);
  });

  it("requests the personal workbench summary endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ cards: [] })
    } as Response);

    await fetchWorkbenchSummary();

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/me/workbench-summary"
    ]);
  });

  it("requests the personal work items endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ queues: {}, approvalCenter: {} })
    } as Response);

    await fetchWorkItems();

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(["/api/me/work-items"]);
  });

  it("requests project operating overview endpoints", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ project: { id: "project-1" } })
    } as Response);

    await fetchProjects();
    await fetchContractCreateProjects();
    await fetchProjectOperatingOverview("project-1");
    await fetchProjectExpenseRequests("project-1");

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/projects",
      "/api/projects/contract-create-options",
      "/api/projects/project-1/operating-funds-overview",
      "/api/projects/project-1/expense-requests"
    ]);
  });

  it("creates projects through the backend", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ id: "project-1", code: "KM-2023-001", name: "昆明项目" })
    } as Response);

    await createProject({ code: "KM-2023-001", name: "昆明项目" });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(["/api/projects"]);
    expect(fetchMock.mock.calls[0][1]?.method).toBe("POST");
    expect(fetchMock.mock.calls[0][1]?.body).toBe(
      JSON.stringify({ code: "KM-2023-001", name: "昆明项目" })
    );
  });

  it("updates project names through the backend", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ id: "project-1", code: "KM-2023-001", name: "昆明项目" })
    } as Response);

    await updateProject("project-1", { name: "昆明项目" });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(["/api/projects/project-1"]);
    expect(fetchMock.mock.calls[0][1]?.method).toBe("PATCH");
    expect(fetchMock.mock.calls[0][1]?.body).toBe(JSON.stringify({ name: "昆明项目" }));
  });

  it("records project actual receipts through the backend", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ id: "receipt-1" })
    } as Response);

    await recordProjectReceipt("project-1", {
      receivedAt: "2026-07-02",
      amountCents: "123456",
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
        amountCents: "123456",
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
      amountCents: "123456",
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
        amountCents: "123456",
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
      reportedAmountCents: "35000000",
      approvedAmountCents: "30000000",
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
        reportedAmountCents: "35000000",
        approvedAmountCents: "30000000",
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
      amountCents: "200000000",
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
        amountCents: "200000000",
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
      amountCents: "1200000",
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
        amountCents: "1200000",
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
      amountCents: "5000000",
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
        amountCents: "5000000",
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
      expenseType: "comprehensive_expense",
      expenseSubtype: "travel",
      paymentSubject: "差旅费",
      reason: "项目现场协调差旅",
      requestedAmountCents: "80000",
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
      approvedAmountCents: "80000",
      comment: "同意"
    });
    await withdrawProjectExpenseApproval("project-1", "expense-1");
    await voidProjectExpenseRequest("project-1", "expense-1", {
      reason: "重复提交"
    });
    await recordProjectExpenseExecution("project-1", "expense-1", {
      amountCents: "80000",
      paidAt: "2026-07-02T10:00:00.000Z",
      voucherFileId: "file-voucher-1",
      confirmationPassword: "current-password"
    });
    await recordProjectExpensePurchaseExecution("project-1", "expense-1", {
      executedAt: "2026-07-02T09:00:00.000Z",
      note: "已采购",
      confirmationPassword: "current-password"
    });
    await recordProjectExpenseFinance("project-1", "expense-1", {
      amountCents: "80000",
      occurredAt: "2026-07-02T11:00:00.000Z",
      confirmationPassword: "current-password"
    });
    await confirmProjectExpenseReceipt("project-1", "expense-1", {
      confirmationPassword: "current-password",
      note: "数量无误"
    });
    await downloadProjectExpenseAttachment("project-1", "expense-1", {
      confirmationPassword: "current-password",
      downloadReason: "报销附件复核"
    });
    await downloadProjectExpenseApprovalPdf("project-1", "expense-1", {
      confirmationPassword: "current-password",
      downloadReason: "审批单复核"
    });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/projects/project-1/expense-requests",
      "/api/projects/project-1/expense-requests/expense-1/approval",
      "/api/projects/project-1/expense-requests/expense-1/approval-withdrawal",
      "/api/projects/project-1/expense-requests/expense-1/voiding",
      "/api/projects/project-1/expense-requests/expense-1/executions",
      "/api/projects/project-1/expense-requests/expense-1/purchase-execution",
      "/api/projects/project-1/expense-requests/expense-1/finance-records",
      "/api/projects/project-1/expense-requests/expense-1/receipt-confirmation",
      "/api/projects/project-1/expense-requests/expense-1/attachment-download-ticket",
      "/api/projects/project-1/expense-requests/expense-1/approval-pdf-download-ticket"
    ]);
    expect(fetchMock.mock.calls.every((call) => call[1]?.method === "POST")).toBe(true);
    expect(fetchMock.mock.calls[0][1]?.body).toBe(
      JSON.stringify({
        code: "ZC-2026-001",
        expenseType: "comprehensive_expense",
        expenseSubtype: "travel",
        paymentSubject: "差旅费",
        reason: "项目现场协调差旅",
        requestedAmountCents: "80000",
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
        approvedAmountCents: "80000",
        comment: "同意"
      })
    );
    expect(fetchMock.mock.calls[3][1]?.body).toBe(JSON.stringify({ reason: "重复提交" }));
    expect(fetchMock.mock.calls[4][1]?.body).toBe(
      JSON.stringify({
        amountCents: "80000",
        paidAt: "2026-07-02T10:00:00.000Z",
        voucherFileId: "file-voucher-1",
        confirmationPassword: "current-password"
      })
    );
    expect(fetchMock.mock.calls[5][1]?.body).toBe(
      JSON.stringify({
        executedAt: "2026-07-02T09:00:00.000Z",
        note: "已采购",
        confirmationPassword: "current-password"
      })
    );
    expect(fetchMock.mock.calls[6][1]?.body).toBe(
      JSON.stringify({
        amountCents: "80000",
        occurredAt: "2026-07-02T11:00:00.000Z",
        confirmationPassword: "current-password"
      })
    );
    expect(fetchMock.mock.calls[7][1]?.body).toBe(
      JSON.stringify({
        confirmationPassword: "current-password",
        note: "数量无误"
      })
    );
    expect(fetchMock.mock.calls[8][1]?.body).toBe(
      JSON.stringify({
        confirmationPassword: "current-password",
        downloadReason: "报销附件复核"
      })
    );
    expect(fetchMock.mock.calls[9][1]?.body).toBe(
      JSON.stringify({
        confirmationPassword: "current-password",
        downloadReason: "审批单复核"
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
      amountCents: "1000000",
      paymentTermsOriginalText: "结算归档确认后30天内付款。",
      paymentStages: [
        {
          name: "当期结算款",
          stageType: "progress",
          triggerAnchor: "settlement_effective",
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

  it("manages historical contract takeover workflow through the backend", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ id: "takeover-1" })
    } as Response);
    const takeoverPayload = {
      code: "HT-LS-2026-001",
      name: "历史材料采购合同",
      counterparty: "历史供应商",
      companyEntityName: "建工集团",
      amountCents: "100000000",
      signedAt: "2026-01-01",
      takeoverLevel: "B" as const,
      lifecycleStatus: "in_progress" as const,
      paymentTermsOriginalText: "按月结算付款。",
      historicalSettledCents: "60000000",
      historicalApprovalPendingPaymentCents: "1000000",
      historicalApprovedPendingPaymentCents: "2000000",
      historicalPaidCents: "30000000",
      historicalProxyPaidCents: "4000000",
      historicalAdvancePaidCents: "5000000",
      historicalAdvanceDeductedCents: "1000000",
      historicalRetentionWithheldCents: "3000000",
      historicalRetentionReleasedCents: "1000000",
      otherConfirmedOccupancyCents: "800000",
      balanceSourceSummary: "财务台账核对",
      evidenceSummary: "合同与付款凭证已归档",
      takeoverLevelAdjustmentReason: "资料可控，按 B级接管并继续跟踪付款限制",
      reviewComment: "合同部已完成单合同补录，提交预算和财务复核。"
    };

    await listContractTakeovers("project-1");
    await listContractTakeoverImportBatches("project-1");
    await getContractTakeover("project-1", "takeover-1");
    await createContractTakeover("project-1", takeoverPayload);
    await updateContractTakeover("project-1", "takeover-1", takeoverPayload);
    await precheckContractTakeoverImport("project-1", {
      rows: [takeoverPayload]
    });
    await createContractTakeoverDraftsFromImport("project-1", {
      rows: [takeoverPayload],
      takeoverCutoffDate: "2026-07-10",
      responsibleUserId: "contract-director-1",
      reviewComment: "合同部已完成预检，提交预算和财务复核。",
      acceptanceConclusion: "本批次先生成草稿，待主管确认后形成接管事实。"
    });
    await attachContractTakeoverEvidenceFile("project-1", "takeover-1", {
      fileId: "file-1",
      purpose: "historical_contract_scan"
    });
    await recordContractTakeoverCorrection("project-1", "takeover-1", {
      correctionType: "evidence",
      reason: "补充历史付款凭证复核说明",
      responsibleUserId: "contract-director-1",
      afterSummary: "补充历史付款凭证，确认历史已付金额不变。",
      attachmentFileId: "file-1",
      currentPassword: "current-password"
    });
    await submitContractTakeoverReview("project-1", "takeover-1");
    await confirmContractTakeover("project-1", "takeover-1", {
      confirmationPassword: "current-password"
    });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/projects/project-1/contract-takeovers",
      "/api/projects/project-1/contract-takeovers/import-batches",
      "/api/projects/project-1/contract-takeovers/takeover-1",
      "/api/projects/project-1/contract-takeovers",
      "/api/projects/project-1/contract-takeovers/takeover-1",
      "/api/projects/project-1/contract-takeovers/import-precheck",
      "/api/projects/project-1/contract-takeovers/import-drafts",
      "/api/projects/project-1/contract-takeovers/takeover-1/evidence-files",
      "/api/projects/project-1/contract-takeovers/takeover-1/corrections",
      "/api/projects/project-1/contract-takeovers/takeover-1/review-submission",
      "/api/projects/project-1/contract-takeovers/takeover-1/confirmation"
    ]);
    expect(fetchMock.mock.calls.map((call) => call[1]?.method)).toEqual([
      undefined,
      undefined,
      undefined,
      "POST",
      "PATCH",
      "POST",
      "POST",
      "POST",
      "POST",
      "POST",
      "POST"
    ]);
    expect(fetchMock.mock.calls[3][1]?.body).toBe(
      JSON.stringify({
        ...takeoverPayload
      })
    );
    expect(fetchMock.mock.calls[4][1]?.body).toBe(JSON.stringify(takeoverPayload));
    expect(fetchMock.mock.calls[5][1]?.body).toBe(
      JSON.stringify({ rows: [takeoverPayload] })
    );
    expect(fetchMock.mock.calls[6][1]?.body).toBe(
      JSON.stringify({
        rows: [takeoverPayload],
        takeoverCutoffDate: "2026-07-10",
        responsibleUserId: "contract-director-1",
        reviewComment: "合同部已完成预检，提交预算和财务复核。",
        acceptanceConclusion: "本批次先生成草稿，待主管确认后形成接管事实。"
      })
    );
    expect(fetchMock.mock.calls[7][1]?.body).toBe(
      JSON.stringify({ fileId: "file-1", purpose: "historical_contract_scan" })
    );
    expect(fetchMock.mock.calls[8][1]?.body).toBe(
      JSON.stringify({
        correctionType: "evidence",
        reason: "补充历史付款凭证复核说明",
        responsibleUserId: "contract-director-1",
        afterSummary: "补充历史付款凭证，确认历史已付金额不变。",
        attachmentFileId: "file-1",
        currentPassword: "current-password"
      })
    );
    expect(fetchMock.mock.calls[10][1]?.body).toBe(
      JSON.stringify({ confirmationPassword: "current-password" })
    );
  });

  it("submits takeover import batch review results through the backend", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ id: "batch-1", status: "under_review" })
    } as Response);

    await reviewContractTakeoverImportBatch("project-1", "batch-1", {
      status: "under_review",
      reviewComment: "合同部已完成预检，提交预算和财务复核。",
      acceptanceConclusion: "本批次先生成草稿，待主管确认后形成接管事实。"
    });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/projects/project-1/contract-takeovers/import-batches/batch-1/review-result"
    ]);
    expect(fetchMock.mock.calls[0][1]?.method).toBe("PATCH");
    expect(fetchMock.mock.calls[0][1]?.body).toBe(
      JSON.stringify({
        status: "under_review",
        reviewComment: "合同部已完成预检，提交预算和财务复核。",
        acceptanceConclusion: "本批次先生成草稿，待主管确认后形成接管事实。"
      })
    );
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
      amountCents: "32000000",
      isFinal: true
    });
    await createPaymentRequest({
      settlementId: "seed-settlement-js-2026-018",
      code: "FK-2026-007",
      requestedAmountCents: "25600000"
    });
    await createPaymentRequest({
      sourceType: "contract_advance",
      contractVersionId: "seed-contract-version-ht-2026-001-v1",
      code: "FK-YF-2026-001",
      requestedAmountCents: "10000000"
    });
    await createPaymentRequest({
      sourceType: "contract_due",
      contractVersionId: "seed-contract-version-ht-2026-001-v1",
      code: "FK-HT-2026-001",
      requestedAmountCents: "8000000"
    });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/settlements",
      "/api/payments",
      "/api/payments",
      "/api/payments"
    ]);
    expect(fetchMock.mock.calls.every((call) => call[1]?.method === "POST")).toBe(true);
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string).isFinal).toBe(true);
    expect(JSON.parse(fetchMock.mock.calls[2][1]?.body as string)).toEqual({
      sourceType: "contract_advance",
      contractVersionId: "seed-contract-version-ht-2026-001-v1",
      code: "FK-YF-2026-001",
      requestedAmountCents: "10000000"
    });
    expect(JSON.parse(fetchMock.mock.calls[3][1]?.body as string)).toEqual({
      sourceType: "contract_due",
      contractVersionId: "seed-contract-version-ht-2026-001-v1",
      code: "FK-HT-2026-001",
      requestedAmountCents: "8000000"
    });
  });

  it("posts payment workflow actions to the backend", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ id: "ok" })
    } as Response);

    await reviewPaymentApproval("FK-2026-006", {
      decision: "approve",
      approvedAmountCents: "5000000"
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
      amountCents: "5000000",
      paidAt: "2026-06-22T00:00:00.000Z",
      voucherFileId: "file-1",
      confirmationPassword: "current-password"
    });
    await recordPaymentFinance("FK-2026-006", {
      amountCents: "5000000",
      occurredAt: "2026-06-22T01:00:00.000Z",
      confirmationPassword: "current-password"
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
        approvedAmountCents: "5000000"
      })
    );
    expect(fetchMock.mock.calls[6][1]?.body).toBe(
      JSON.stringify({
        amountCents: "5000000",
        occurredAt: "2026-06-22T01:00:00.000Z",
        confirmationPassword: "current-password"
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

  it("downloads settlement draft Excel as a blob", async () => {
    const click = vi.fn();
    const anchor = {
      href: "",
      download: "",
      click,
      remove: vi.fn()
    } as unknown as HTMLAnchorElement;
    const appendChild = vi.fn().mockReturnValue(anchor);
    const createElement = vi.fn().mockReturnValue(anchor);
    const createObjectUrl = vi.fn().mockReturnValue("blob:download");
    const revokeObjectUrl = vi.fn();
    vi.stubGlobal("document", {
      createElement,
      body: { appendChild }
    });
    vi.stubGlobal("URL", {
      createObjectURL: createObjectUrl,
      revokeObjectURL: revokeObjectUrl
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      blob: async () => new Blob(["xlsx"]),
      headers: new Headers({
        "Content-Disposition":
          "attachment; filename=\"draft.xlsx\"; filename*=UTF-8''JS-2026-019-%E7%BB%93%E7%AE%97%E5%8D%95-%E8%8D%89%E7%A8%BF.xlsx"
      })
    } as Response);

    await downloadSettlementDraftExcel("settlement-1");

    expect(fetchMock.mock.calls[0][0]).toBe("/api/settlements/settlement-1/draft-excel");
    expect(fetchMock.mock.calls[0][1]?.method).toBeUndefined();
    expect(anchor.download).toBe("JS-2026-019-结算单-草稿.xlsx");
    expect(click).toHaveBeenCalled();
    expect(createObjectUrl).toHaveBeenCalled();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:download");

    vi.unstubAllGlobals();
  });

  it("downloads the latest settlement approval PDF as a blob", async () => {
    const click = vi.fn();
    const anchor = {
      href: "",
      download: "",
      click,
      remove: vi.fn()
    } as unknown as HTMLAnchorElement;
    const appendChild = vi.fn().mockReturnValue(anchor);
    const createElement = vi.fn().mockReturnValue(anchor);
    const createObjectUrl = vi.fn().mockReturnValue("blob:download");
    const revokeObjectUrl = vi.fn();
    vi.stubGlobal("document", {
      createElement,
      body: { appendChild }
    });
    vi.stubGlobal("URL", {
      createObjectURL: createObjectUrl,
      revokeObjectURL: revokeObjectUrl
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      blob: async () => new Blob(["pdf"]),
      headers: new Headers({
        "Content-Disposition":
          "attachment; filename*=UTF-8''JS-2026-019-%E7%BB%93%E7%AE%97%E5%AE%A1%E6%89%B9%E6%9C%80%E6%96%B0.pdf"
      })
    } as Response);

    await downloadSettlementLatestApprovalPdf("settlement-1", {
      confirmationPassword: "current-password",
      downloadReason: "结算审批复核"
    });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/settlements/settlement-1/approval-pdf/latest"
    );
    expect(fetchMock.mock.calls[0][1]?.method).toBe("POST");
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("Content-Type")).toBe(
      "application/json"
    );
    expect(fetchMock.mock.calls[0][1]?.body).toBe(
      JSON.stringify({ confirmationPassword: "current-password", downloadReason: "结算审批复核" })
    );
    expect(anchor.download).toBe("JS-2026-019-结算审批最新.pdf");
    expect(click).toHaveBeenCalled();
    expect(createObjectUrl).toHaveBeenCalled();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:download");

    vi.unstubAllGlobals();
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
      confirmationPassword: "current-password",
      downloadReason: "合同归档复核"
    });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/files/file-1/download-ticket"
    ]);
    expect(fetchMock.mock.calls[0][1]?.method).toBe("POST");
    expect(fetchMock.mock.calls[0][1]?.body).toBe(
      JSON.stringify({ confirmationPassword: "current-password", downloadReason: "合同归档复核" })
    );
  });

  it("downloads settlement attachment templates through the backend", async () => {
    const click = vi.fn();
    const appendChild = vi.fn();
    const anchor = {
      click,
      remove: vi.fn(),
      set href(value: string) {
        this._href = value;
      },
      get href() {
        return this._href;
      },
      set download(value: string) {
        this._download = value;
      },
      get download() {
        return this._download;
      },
      _href: "",
      _download: ""
    };
    vi.stubGlobal("document", {
      createElement: vi.fn().mockReturnValue(anchor),
      body: { appendChild }
    });
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn().mockReturnValue("blob:template"),
      revokeObjectURL: vi.fn()
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      blob: async () => new Blob(["xlsx"]),
      headers: new Headers({
        "Content-Disposition": "attachment; filename*=UTF-8''%E6%94%B6%E6%96%B9%E5%8D%95%E6%A8%A1%E6%9D%BF.xlsx"
      })
    } as Response);

    await downloadSettlementAttachmentTemplate("JS-2026-018", "receipt-form");

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/settlements/JS-2026-018/attachment-templates/receipt-form/download"
    ]);
    expect(anchor._download).toBe("收方单模板.xlsx");
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("manages approval delegations through the backend", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ id: "delegation-1" })
    } as Response);

    await listApprovalDelegations();
    await fetchApprovalDelegationUserOptions();
    await createApprovalDelegation({
      toUserId: "user-b",
      startsAt: "2026-06-23T00:00:00.000Z",
      endsAt: "2026-07-23T00:00:00.000Z"
    });
    await revokeApprovalDelegation("delegation-1");

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/approval-delegations",
      "/api/approval-delegations/user-options",
      "/api/approval-delegations",
      "/api/approval-delegations/delegation-1"
    ]);
    expect(fetchMock.mock.calls.map((call) => call[1]?.method)).toEqual([
      undefined,
      undefined,
      "POST",
      "DELETE"
    ]);
    expect(fetchMock.mock.calls[2][1]?.body).toBe(
      JSON.stringify({
        toUserId: "user-b",
        startsAt: "2026-06-23T00:00:00.000Z",
        endsAt: "2026-07-23T00:00:00.000Z"
      })
    );
  });
});
