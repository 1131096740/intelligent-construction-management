import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchContractDetail,
  fetchContractChangeEligibility,
  fetchContractLedger,
  fetchContractLifecycleLedger,
  fetchContractWorkbenchLedger,
  copyAbandonedContractDraft,
  copyAbandonedSettlementDraft,
  fetchDraftRetentionPreview,
  fetchPaymentDetail,
  fetchPaymentLedger,
  fetchPaymentLifecycleLedger,
  fetchPaymentContractOptions,
  fetchSettlementDetail,
  fetchSettlementContractOptions,
  fetchSettlementLedger,
  fetchSettlementLifecycleLedger,
  fetchSettlementWorkbenchLedger,
  fetchWorkbenchSummary,
  fetchContractPaymentApplication,
  fetchArchives,
  fetchAuditLogs,
  fetchFileDownloadAudits,
  fetchProjectExpenseRequests,
  fetchProjectExpenseApprovalDetail,
  fetchProjectOperatingOverview,
  fetchProjects,
  fetchContractCreateProjects,
  fetchProjectAffiliateMappingReport,
  assignProjectAffiliate,
  fetchWorkItems,
  createProject,
  updateProject,
  downloadProjectExpenseApprovalPdf,
  downloadProjectExpenseAttachment,
  confirmProjectOwnerContract,
  recordProjectOwnerContract,
  recordProjectUpstreamFundFact,
  confirmProjectUpstreamFundFact,
  fetchProjectAffiliateBusinessFacts,
  recordProjectAffiliateContractFact,
  confirmProjectAffiliateContractFact,
  recordProjectAffiliateSettlementFact,
  confirmProjectAffiliateSettlementFact,
  recordProjectAffiliatePaymentFact,
  confirmProjectAffiliatePaymentFact,
  supplementProjectAffiliateBusinessEvidence,
  fetchProjectAffiliateCompanyContracts,
  recordProjectAffiliateCompanyContract,
  createProjectAffiliateCompanyContractRecordAttemptState,
  recordProjectAffiliateCompanyContractWithUpload,
  confirmProjectAffiliateCompanyContract,
  recordProjectProxyPayment,
  recordProjectUpstreamSettlement,
  confirmProjectUpstreamSettlement,
  ContractApprovalReviewResultUnknownError,
  requestSettlementExceptionQuota,
  reviewSettlementExceptionQuota,
  createProjectExpenseRequest,
  executeProjectExpenseApprovalReviewAction,
  executeContractApprovalReviewAction,
  executeProjectExpenseWithdrawalAction,
  prepareProjectExpenseApprovalReviewAction,
  prepareContractApprovalReviewAction,
  prepareProjectExpenseWithdrawalAction,
  voidProjectExpenseRequest,
  createProjectExpenseExecutionRecordAttemptState,
  recordProjectExpenseExecution,
  recordProjectExpenseExecutionWithUpload,
  recordProjectExpenseFinance,
  recordProjectExpensePurchaseExecution,
  createContractDraft,
  createContractChangeDraft,
  createContractTakeover,
  abandonContractTakeover,
  applyContractTakeoverBatchAbandonment,
  createContractTakeoverDraftsFromImport,
  applyContractTakeoverExcelImport,
  downloadContractLedgerExport,
  downloadContractTakeoverDetailExport,
  downloadContractTakeoverImportTemplate,
  downloadContractTakeoverLedgerExport,
  downloadSettlementLedgerExport,
  listContractTakeoverImportBatches,
  listHistoricalCompanyEntityCandidates,
  createPaymentRequest,
  precheckContractTakeoverImport,
  previewContractTakeoverBatchAbandonment,
  previewContractTakeoverExcelImport,
  createPrivateFileDownloadTicket,
  createSettlementDraft,
  confirmContractTakeover,
  confirmContractTakeoverContractSide,
  confirmContractTakeoverFinanceSide,
  returnContractTakeoverForSupplement,
  confirmContractTakeoverChangeBaseline,
  confirmContractArchive,
  confirmSettlementArchive,
  regenerateSettlementSignedDocument,
  retrySettlementSignedDocumentGeneration,
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
  approveGovernedContractSeal,
  completeContractSeal,
  executeContractSigningMaterialChange,
  uploadMutuallySignedContract,
  returnMutuallySignedContractForCorrection,
  confirmMutuallySignedContract,
  remindContractApproval,
  remindPaymentApproval,
  remindSettlementApproval,
  reviewSettlementApproval,
  uploadContractArchiveFile,
  uploadPrivateFile,
  uploadSettlementArchiveFile,
  recordPaymentExecution,
  createPaymentExecutionRecordAttemptState,
  recordPaymentExecutionWithUpload,
  recordPaymentFinance,
  recordPaymentPdfArchive,
  executePaymentApprovalReviewAction,
  preparePaymentApprovalReviewAction,
  type PrepareProjectExpenseApprovalReviewActionInput,
  type PrepareContractApprovalReviewActionInput,
  type PreparePaymentApprovalReviewActionInput,
  withdrawContractApproval,
  withdrawPaymentApproval,
  abandonPaymentRequest,
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
  attachHistoricalPaymentVoucher,
  recordContractTakeoverCorrection,
  reviewContractTakeoverCorrection,
  reviewContractTakeoverCompanyEntityCorrection,
  fetchApprovalDelegationUserOptions,
  revokeApprovalDelegation,
  submitContractTakeoverReview,
  submitContractTakeoverCorrection,
  submitContractTakeoverCompanyEntityCorrection,
  reviewContractTakeoverImportBatch,
  updateContractTakeover,
  saveContractTakeoverContractSide,
  saveContractTakeoverFinanceSide,
  withdrawContractTakeoverContractSideConfirmation,
  withdrawContractTakeoverFinanceSideConfirmation
} from "./core-flow-read.api";
import { ContractSigningMaterialChangeResultUnknownError } from "../lib/contract-signing-material-change-result";

describe("core flow read API client", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("copies ended contract and settlement records into new draft resources", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ id: "new-draft", contract: { id: "new-contract" }, version: { id: "new-version" } })
    } as Response);

    await copyAbandonedContractDraft("version/1", "2026-07-20T01:00:00.000Z");
    await copyAbandonedSettlementDraft("project/1", "draft/1", "2026-07-20T02:00:00.000Z");
    await fetchDraftRetentionPreview();

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/contracts/version%2F1/copies",
      "/api/projects/project%2F1/settlement-drafts/draft%2F1/copies",
      "/api/draft-retention/preview"
    ]);
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ expectedUpdatedAt: "2026-07-20T01:00:00.000Z" })
    }));
  });

  it("calls the encoded single-takeover abandonment resource with exact CAS facts", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ takeoverId: "takeover/1", status: "abandoned" })
    } as Response);

    await abandonContractTakeover("project/1", "takeover/1", {
      expectedUpdatedAt: "2026-07-20T02:03:04.000Z",
      action: "abandon_application",
      reason: "接管资料不再继续补充"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/project%2F1/contract-takeovers/takeover%2F1/abandonment",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          expectedUpdatedAt: "2026-07-20T02:03:04.000Z",
          action: "abandon_application",
          reason: "接管资料不再继续补充"
        })
      })
    );
  });

  it("loads contract, settlement and payment lifecycle ledgers with server-owned pagination", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        rows: [],
        meta: { page: 2, pageSize: 20, total: 0, totalPages: 0 },
        summary: { formal_ledger: 0, my_drafts: 0, returned_for_revision: 0, ended: 0 }
      })
    } as Response);

    await fetchContractLifecycleLedger("returned_for_revision", 2, 20);
    await fetchContractWorkbenchLedger("pending_action", 1, 20);
    await fetchSettlementLifecycleLedger("ended", 3, 50);
    await fetchSettlementWorkbenchLedger("pending_action", 1, 20);
    await fetchPaymentLifecycleLedger("my_drafts", 1, 20);

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/contracts/lifecycle-ledger?view=returned_for_revision&page=2&pageSize=20",
      "/api/contracts/workbench?view=pending_action&page=1&pageSize=20",
      "/api/settlements/lifecycle-ledger?view=ended&page=3&pageSize=50",
      "/api/settlements/workbench?view=pending_action&page=1&pageSize=20",
      "/api/payments?view=my_drafts&page=1&pageSize=20"
    ]);
  });

  it("abandons a returned payment with exact CAS facts and encoded identity", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ id: "payment/1", status: "abandoned" })
    } as Response);

    await abandonPaymentRequest("payment/1", {
      expectedUpdatedAt: "2026-07-20T02:03:04.000Z",
      reason: "本次付款不再办理"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/payments/payment%2F1/abandonment",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          expectedUpdatedAt: "2026-07-20T02:03:04.000Z",
          reason: "本次付款不再办理"
        })
      })
    );
  });

  it("passes the server batch preview hash back unchanged on apply", async () => {
    const previewHash = "a".repeat(64);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        previewHash,
        rows: [{
          id: "takeover-1",
          importRowNo: 2,
          updatedAt: "2026-07-20T02:03:04.000Z",
          action: "delete_pristine_draft",
          eligible: true,
          blockers: [],
          contractNo: "HT-001",
          contractName: "零星材料采购合同"
        }]
      })
    } as Response);

    const preview = await previewContractTakeoverBatchAbandonment("project/1", "batch/1");
    expect(preview.rows[0]).toMatchObject({
      contractNo: "HT-001",
      contractName: "零星材料采购合同"
    });
    await applyContractTakeoverBatchAbandonment("project/1", "batch/1", {
      previewHash: preview.previewHash,
      reason: "整批导入有误"
    });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/projects/project%2F1/contract-takeovers/import-batches/batch%2F1/draft-abandonment-preview",
      "/api/projects/project%2F1/contract-takeovers/import-batches/batch%2F1/draft-abandonment-apply"
    ]);
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(JSON.stringify({
      previewHash,
      reason: "整批导入有误"
    }));
  });

  it("preserves the Chinese takeover abandonment conflict", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 409,
      clone() { return this; },
      json: async () => ({ message: "批次草稿在预览后已发生变化，请重新预览" })
    } as unknown as Response);

    await expect(applyContractTakeoverBatchAbandonment(
      "project-1",
      "batch-1",
      { previewHash: "b".repeat(64), reason: "整批放弃" }
    )).rejects.toThrow("批次草稿在预览后已发生变化，请重新预览");
  });

  it("loads project-scoped historical company entity candidates", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => []
    } as Response);

    await listHistoricalCompanyEntityCandidates("project/1");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/project%2F1/contract-takeovers/company-entity-candidates",
      expect.any(Object)
    );
  });

  it("submits and reviews a historical company entity correction", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ id: "correction-1", status: "submitted" })
    } as Response);

    await submitContractTakeoverCompanyEntityCorrection("project-1", "takeover-1", {
      targetCompanyEntityId: "entity-2",
      reason: "原匹配主体有误",
      responsibleUserId: "contract-staff-1",
      attachmentFileId: "file-1",
      currentPassword: "current-password"
    });
    await reviewContractTakeoverCompanyEntityCorrection(
      "project-1",
      "takeover-1",
      "correction-1",
      { decision: "approve", comment: "已核对原合同", currentPassword: "current-password" }
    );

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/projects/project-1/contract-takeovers/takeover-1/company-entity-corrections",
      "/api/projects/project-1/contract-takeovers/takeover-1/company-entity-corrections/correction-1/review"
    ]);
    expect(fetchMock.mock.calls.map((call) => call[1]?.method)).toEqual(["POST", "POST"]);
    expect(fetchMock.mock.calls[1][1]?.body).toBe(
      JSON.stringify({
        decision: "approve",
        comment: "已核对原合同",
        currentPassword: "current-password"
      })
    );
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

  it("uses contractVersionId routes for contract change eligibility and creation", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ eligible: true })
    } as Response);

    await fetchContractChangeEligibility("version/1");
    await createContractChangeDraft("version/1", {
      changeType: "change",
      changeReason: "补充工程量",
      changeDirection: "increase",
      changeAmountCents: "100"
    });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/contracts/version%2F1/change-eligibility",
      "/api/contracts/version%2F1/change-drafts"
    ]);
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        changeType: "change",
        changeReason: "补充工程量",
        changeDirection: "increase",
        changeAmountCents: "100"
      })
    }));
  });

  it("confirms a historical change baseline with canonical cents and password", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ changeBaselineConfirmed: true })
    } as Response);

    await confirmContractTakeoverChangeBaseline("project/1", "takeover/1", {
      originalSignedAmountCents: "1000000",
      preTakeoverPositiveIncreaseCents: "100000",
      currentPassword: "not-logged"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/project%2F1/contract-takeovers/takeover%2F1/change-baseline-confirmation",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          originalSignedAmountCents: "1000000",
          preTakeoverPositiveIncreaseCents: "100000",
          currentPassword: "not-logged"
        })
      })
    );
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

  it("uses the governed contract signing and archive endpoints", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ status: "ok" })
    } as Response);

    await approveGovernedContractSeal("version/1", { confirmationPassword: "current-password" });
    await completeContractSeal("version/1", {
      firstPartySignedOrStamped: true,
      companySealCompleted: true,
      crossPageSealCompleted: true,
      signingDateCompleted: true
    });
    await uploadMutuallySignedContract("version/1", {
      fileId: "file-1",
      sourceRevision: 3,
      firstPartySignedOrStamped: true,
      companySealCompleted: true,
      crossPageSealCompleted: true,
      signingDateCompleted: true,
      onlyPermittedSignatureChanges: true,
      documentOrderConfirmed: true
    });
    await returnMutuallySignedContractForCorrection("version/1", {
      formalFileId: "formal-1",
      reason: "扫描顺序有误"
    });
    await confirmMutuallySignedContract("version/1", {
      formalFileId: "formal-1",
      firstPartySignedOrStamped: true,
      companySealCompleted: true,
      crossPageSealCompleted: true,
      signingDateCompleted: true,
      onlyPermittedSignatureChanges: true,
      documentOrderConfirmed: true,
      confirmationPassword: "password"
    });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/contracts/version%2F1/seal/approve",
      "/api/contracts/version%2F1/seal/complete",
      "/api/contracts/version%2F1/formal-files/final",
      "/api/contracts/version%2F1/formal-files/final/return",
      "/api/contracts/version%2F1/formal-files/final/confirmation"
    ]);
  });

  it("freshly verifies signing material-change coordinates before one POST", async () => {
    const freshDetail = {
      id: "HT-2026-001",
      contractVersionId: "version/1",
      draftRevision: 4,
      sealTask: {
        id: "seal/1",
        status: "in_seal",
        handlerUserId: "handler-1"
      },
      signingMaterialChangeContext: {
        expectedRevision: 4,
        expectedSealTaskId: "seal/1",
        expectedStatus: "in_seal"
      },
      availableActions: [{
        key: "report_signing_material_change",
        label: "申报签署内容实质变化",
        kind: "danger",
        enabled: true,
        disabledReason: null,
        requiresComment: true
      }]
    };
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => freshDetail
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "draft",
          draftRevision: 5,
          requiresReapproval: true
        })
      } as Response);
    const stale = vi.fn();
    const context = {
      routeContractId: "HT-2026-001",
      contractId: "HT-2026-001",
      contractVersionId: "version/1",
      expectedRevision: 4,
      expectedSealTaskId: "seal/1",
      expectedStatus: "in_seal" as const
    };

    await expect(executeContractSigningMaterialChange({
      capture: () => context,
      current: () => true,
      stale,
      reason: "线下核对发现合同金额发生实质变化"
    })).resolves.toMatchObject({
      status: "completed",
      context,
      response: { status: "draft", draftRevision: 5 }
    });

    expect(stale).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/contracts/HT-2026-001",
      "/api/contracts/version%2F1/signing/material-change"
    ]);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "POST" });
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(JSON.stringify({
      expectedRevision: 4,
      expectedSealTaskId: "seal/1",
      expectedStatus: "in_seal",
      reason: "线下核对发现合同金额发生实质变化"
    }));
  });

  it.each([
    ["an invalid success body", {
      ok: true,
      json: async () => ({ status: "draft", draftRevision: 4, requiresReapproval: true })
    }],
    ["a lost response", new Error("socket closed after request dispatch")]
  ])("marks material-change %s as result unknown", async (_label, postResult) => {
    const freshDetail = {
      id: "HT-2026-001",
      contractVersionId: "version-1",
      draftRevision: 4,
      sealTask: { id: "seal-1", status: "in_seal", handlerUserId: "handler-1" },
      signingMaterialChangeContext: {
        expectedRevision: 4,
        expectedSealTaskId: "seal-1",
        expectedStatus: "in_seal"
      },
      availableActions: [{ key: "report_signing_material_change", enabled: true }]
    };
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => freshDetail
      } as Response);
    if (postResult instanceof Error) {
      fetchMock.mockRejectedValueOnce(postResult);
    } else {
      fetchMock.mockResolvedValueOnce(postResult as Response);
    }

    await expect(executeContractSigningMaterialChange({
      capture: () => ({
        routeContractId: "HT-2026-001",
        contractId: "HT-2026-001",
        contractVersionId: "version-1",
        expectedRevision: 4,
        expectedSealTaskId: "seal-1",
        expectedStatus: "in_seal"
      }),
      current: () => true,
      stale: vi.fn(),
      reason: "合同金额发生实质变化"
    })).rejects.toBeInstanceOf(
      ContractSigningMaterialChangeResultUnknownError
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("routes a handled material-change unknown result through fail and finish", async () => {
    const fail = vi.fn();
    const finish = vi.fn();
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "HT-2026-001",
          contractVersionId: "version-1",
          draftRevision: 4,
          sealTask: { id: "seal-1", status: "in_seal", handlerUserId: "handler-1" },
          signingMaterialChangeContext: {
            expectedRevision: 4,
            expectedSealTaskId: "seal-1",
            expectedStatus: "in_seal"
          },
          availableActions: [{ key: "report_signing_material_change", enabled: true }]
        })
      } as Response)
      .mockRejectedValueOnce(new Error("socket closed after request dispatch"));
    const context = {
      routeContractId: "HT-2026-001",
      contractId: "HT-2026-001",
      contractVersionId: "version-1",
      expectedRevision: 4,
      expectedSealTaskId: "seal-1",
      expectedStatus: "in_seal" as const
    };

    await expect(executeContractSigningMaterialChange({
      capture: () => context,
      current: () => true,
      stale: vi.fn(),
      fail,
      finish,
      reason: "合同金额发生实质变化"
    })).resolves.toEqual({ status: "failed", context });

    expect(fail).toHaveBeenCalledWith(
      context,
      expect.any(ContractSigningMaterialChangeResultUnknownError)
    );
    expect(finish).toHaveBeenCalledWith(context);
  });

  it.each([
    ["missing capability", { availableActions: [] }],
    ["duplicate capability", {
      availableActions: [
        { key: "report_signing_material_change", enabled: true },
        { key: "report_signing_material_change", enabled: true }
      ]
    }],
    ["revision drift", {
      draftRevision: 5,
      signingMaterialChangeContext: {
        expectedRevision: 5,
        expectedSealTaskId: "seal-1",
        expectedStatus: "in_seal"
      }
    }],
    ["task drift", {
      sealTask: { id: "seal-2", status: "in_seal", handlerUserId: "handler-1" },
      signingMaterialChangeContext: {
        expectedRevision: 4,
        expectedSealTaskId: "seal-2",
        expectedStatus: "in_seal"
      }
    }],
    ["status drift", {
      sealTask: { id: "seal-1", status: "completed", handlerUserId: "handler-1" },
      signingMaterialChangeContext: {
        expectedRevision: 4,
        expectedSealTaskId: "seal-1",
        expectedStatus: "pending_archive_confirm"
      }
    }]
  ])("does not POST material change when fresh detail has %s", async (_label, overrides) => {
    const detail = {
      id: "HT-2026-001",
      contractVersionId: "version-1",
      draftRevision: 4,
      sealTask: { id: "seal-1", status: "in_seal", handlerUserId: "handler-1" },
      signingMaterialChangeContext: {
        expectedRevision: 4,
        expectedSealTaskId: "seal-1",
        expectedStatus: "in_seal"
      },
      availableActions: [{ key: "report_signing_material_change", enabled: true }],
      ...overrides
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => detail
    } as Response);

    await expect(executeContractSigningMaterialChange({
      capture: () => ({
        routeContractId: "HT-2026-001",
        contractId: "HT-2026-001",
        contractVersionId: "version-1",
        expectedRevision: 4,
        expectedSealTaskId: "seal-1",
        expectedStatus: "in_seal"
      }),
      current: () => true,
      stale: vi.fn(),
      reason: "合同金额发生实质变化"
    })).rejects.toThrow("合同签署状态已变化");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBeUndefined();
  });

  it("stops a material-change submission after route ownership changes", async () => {
    const stale = vi.fn();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "HT-2026-001",
        contractVersionId: "version-1",
        draftRevision: 4,
        sealTask: { id: "seal-1", status: "in_seal", handlerUserId: "handler-1" },
        signingMaterialChangeContext: {
          expectedRevision: 4,
          expectedSealTaskId: "seal-1",
          expectedStatus: "in_seal"
        },
        availableActions: [{ key: "report_signing_material_change", enabled: true }]
      })
    } as Response);

    await expect(executeContractSigningMaterialChange({
      capture: () => ({
        routeContractId: "HT-2026-001",
        contractId: "HT-2026-001",
        contractVersionId: "version-1",
        expectedRevision: 4,
        expectedSealTaskId: "seal-1",
        expectedStatus: "in_seal"
      }),
      current: (_context, fresh) => fresh === undefined,
      stale,
      reason: "合同金额发生实质变化"
    })).resolves.toMatchObject({ status: "stale" });

    expect(stale).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
      json: async () => ({
        queues: {
          pending: [],
          blocked: [],
          started: [],
          drafts: [{ id: "takeover:draft-1" }]
        },
        approvalCenter: {}
      })
    } as Response);

    const result = await fetchWorkItems();

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(["/api/me/work-items"]);
    expect(result.queues.drafts).toEqual([{ id: "takeover:draft-1" }]);
  });

  it("requests project operating overview endpoints", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ project: { id: "project-1" } })
    } as Response);

    await fetchProjects();
    await fetchContractCreateProjects();
    await fetchProjectAffiliateMappingReport();
    await assignProjectAffiliate("project/1", {
      businessPartyVersionId: "party-version-1",
      effectiveFrom: "2026-07-28T00:00:00.000Z",
      changeReason: "建立显式挂靠关系"
    });
    await fetchProjectOperatingOverview("project-1");
    await fetchProjectExpenseRequests("project-1");

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/projects",
      "/api/projects/contract-create-options",
      "/api/projects/affiliate-mapping-report",
      "/api/projects/project%2F1/affiliate-assignment",
      "/api/projects/project-1/operating-funds-overview",
      "/api/projects/project-1/expense-requests"
    ]);
  });

  it("loads project expense lifecycle views without widening the resource route", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ rows: [], summary: {} })
    } as Response);

    await fetchProjectExpenseRequests("project/1", {
      view: "ended",
      page: 2,
      pageSize: 20
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/projects/project%2F1/expense-requests?view=ended&page=2&pageSize=20"
    );
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

  it("records and confirms upstream fund facts through encoded backend routes", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ id: "fund-fact-1" })
    } as Response);

    await recordProjectUpstreamFundFact("project/1", {
      factType: "affiliate_remittance_to_company",
      basisType: "written",
      occurredAt: "2026-07-02",
      amountCents: "123456",
      counterpartyName: "挂靠企业",
      evidenceFileId: "file-receipt-1",
      idempotencyKey: "9ae0147a-da7b-4dba-b378-e80f87efdc46",
      description: "挂靠企业向我方拨款"
    });
    await confirmProjectUpstreamFundFact("project/1", "fact/1", {
      confirmationPassword: "current-password",
      confirmationActionId: "6f9ac3b7-8c5e-4f98-8284-221ce7844a36"
    });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/projects/project%2F1/upstream-fund-facts",
      "/api/projects/project%2F1/upstream-fund-facts/fact%2F1/confirmation"
    ]);
    expect(fetchMock.mock.calls.every((call) => call[1]?.method === "POST")).toBe(true);
    expect(fetchMock.mock.calls[0][1]?.body).toBe(
      JSON.stringify({
        factType: "affiliate_remittance_to_company",
        basisType: "written",
        occurredAt: "2026-07-02",
        amountCents: "123456",
        counterpartyName: "挂靠企业",
        evidenceFileId: "file-receipt-1",
        idempotencyKey: "9ae0147a-da7b-4dba-b378-e80f87efdc46",
        description: "挂靠企业向我方拨款"
      })
    );
    expect(fetchMock.mock.calls[1][1]?.body).toBe(
      JSON.stringify({
        confirmationPassword: "current-password",
        confirmationActionId: "6f9ac3b7-8c5e-4f98-8284-221ce7844a36"
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

  it("uses encoded affiliate downstream fact routes without direct page fetch calls", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ id: "fact-1" })
    } as Response);

    await fetchProjectAffiliateBusinessFacts("project/1");
    await recordProjectAffiliateContractFact("project/1", {
      contractType: "material_purchase",
      externalContractReference: "GK-HT-2026-001",
      counterpartyName: "材料供应商",
      signedAt: "2026-07-20",
      amountNature: "fixed",
      amountCents: "100000",
      basisType: "oral",
      advanceAllowed: false,
      idempotencyKey: "2dfca5de-eb12-4b9e-b093-e392653a5cdf"
    });
    await confirmProjectAffiliateContractFact("project/1", "contract/1", {
      confirmationPassword: "current-password",
      confirmationActionId: "e832035b-e073-4c04-8d43-b72583e99c32"
    });
    await recordProjectAffiliateSettlementFact("project/1", {
      contractLedgerId: "contract-ledger-1",
      counterpartyName: "材料供应商",
      settledAt: "2026-07-25",
      periodLabel: "2026-07",
      amountCents: "50000",
      basisType: "oral",
      idempotencyKey: "e974f2f0-5b2e-4e6a-9d9d-03b81e1868ad"
    });
    await confirmProjectAffiliateSettlementFact("project/1", "settlement/1", {
      confirmationPassword: "current-password",
      confirmationActionId: "0763bc87-efb9-42dd-830f-e8f60ce3df59"
    });
    await recordProjectAffiliatePaymentFact("project/1", {
      contractLedgerId: "contract-ledger-1",
      settlementLedgerId: "settlement-ledger-1",
      counterpartyName: "材料供应商",
      paidAt: "2026-07-29",
      amountCents: "5000",
      paymentKind: "normal",
      externalPaymentReference: "BANK-20260729-001",
      basisType: "oral",
      idempotencyKey: "cdad0cb7-2e78-48db-ae27-86253bf54bbd"
    });
    await confirmProjectAffiliatePaymentFact("project/1", "payment/1", {
      confirmationPassword: "current-password",
      confirmationActionId: "439f38e7-d374-4275-9066-794a59a1cf0d"
    });
    await supplementProjectAffiliateBusinessEvidence("project/1", "contract/1", {
      businessType: "contract",
      fileId: "file-1",
      idempotencyKey: "c22598c5-98ff-4029-98e9-e4920a4b1d5f",
      description: "补充盖章合同"
    });
    await fetchProjectAffiliateCompanyContracts("project/1");
    await recordProjectAffiliateCompanyContract("project/1", {
      contractReference: "GL-2026-001",
      contractName: "项目挂靠管理协议",
      signedAt: "2026-07-20",
      rightsObligationsSummary: "双方权利义务摘要",
      companyEntityId: "company-1",
      fileId: "file-2",
      idempotencyKey: "a43073f9-9731-4d71-9498-b9727344dbd4"
    });
    await confirmProjectAffiliateCompanyContract(
      "project/1",
      "affiliate-company-contract/1",
      {
        confirmationPassword: "current-password",
        confirmationActionId: "6dfbdece-803c-44c5-bf68-edbcf1529ce5"
      }
    );

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/projects/project%2F1/affiliate-business-facts",
      "/api/projects/project%2F1/affiliate-contract-facts",
      "/api/projects/project%2F1/affiliate-contract-facts/contract%2F1/confirmation",
      "/api/projects/project%2F1/affiliate-settlement-facts",
      "/api/projects/project%2F1/affiliate-settlement-facts/settlement%2F1/confirmation",
      "/api/projects/project%2F1/affiliate-payment-facts",
      "/api/projects/project%2F1/affiliate-payment-facts/payment%2F1/confirmation",
      "/api/projects/project%2F1/affiliate-business-facts/contract%2F1/evidence",
      "/api/projects/project%2F1/affiliate-company-contracts",
      "/api/projects/project%2F1/affiliate-company-contracts",
      "/api/projects/project%2F1/affiliate-company-contracts/affiliate-company-contract%2F1/confirmation"
    ]);
    expect(fetchMock.mock.calls[0][1]?.method).toBeUndefined();
    expect(fetchMock.mock.calls[8][1]?.method).toBeUndefined();
    expect(
      fetchMock.mock.calls
        .filter((_call, index) => index !== 0 && index !== 8)
        .every((call) => call[1]?.method === "POST")
    ).toBe(true);
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
      voucherFileId: "file-upstream-1"
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
        voucherFileId: "file-upstream-1"
      })
    );
  });

  it("confirms project upstream settlements through the backend", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ id: "upstream-1", status: "confirmed" })
    } as Response);

    await confirmProjectUpstreamSettlement("project/1", "upstream/1", {
      confirmationPassword: "current-password"
    });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/projects/project%2F1/upstream-settlements/upstream%2F1/confirmation"
    ]);
    expect(fetchMock.mock.calls[0][1]?.method).toBe("POST");
    expect(fetchMock.mock.calls[0][1]?.body).toBe(
      JSON.stringify({ confirmationPassword: "current-password" })
    );
  });

  it("records and confirms project owner contracts through the backend", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ id: "owner-contract-1" })
    } as Response);

    await recordProjectOwnerContract("project/1", {
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
    await confirmProjectOwnerContract("project/1", "owner-contract/1", {
      confirmationPassword: "current-password"
    });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/projects/project%2F1/owner-contracts",
      "/api/projects/project%2F1/owner-contracts/owner-contract%2F1/confirmation"
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
    await voidProjectExpenseRequest("project-1", "expense-1", {
      reason: "重复提交"
    });
    await recordProjectExpenseExecution("project-1", "expense-1", {
      amountCents: "80000",
      paidAt: "2026-07-02T10:00:00.000Z",
      voucherFileId: "file-voucher-1",
      confirmationPassword: "current-password",
      expectedExpenseUpdatedAt: "2026-07-02T09:59:00.000Z",
      idempotencyKey: "2d74bb60-3c32-4c6a-93c9-a9baf7fe4572"
    });
    await recordProjectExpensePurchaseExecution("project-1", "expense-1", {
      executedAt: "2026-07-02T09:00:00.000Z",
      note: "已采购",
      confirmationPassword: "current-password"
    });
    await recordProjectExpenseFinance("project-1", "expense-1", {
      amountCents: "80000",
      occurredAt: "2026-07-02T11:00:00.000Z",
      confirmationPassword: "current-password",
      expectedExpenseUpdatedAt: "2026-07-02T10:59:00.000Z",
      idempotencyKey: "7b21c94f-4f2b-4d15-8b77-c4f145526dcb"
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
      "/api/projects/project-1/expense-requests/expense-1/voiding",
      "/api/projects/project-1/expense-requests/expense-1/executions",
      "/api/projects/project-1/expense-requests/expense-1/purchase-execution",
      "/api/projects/project-1/expense-requests/expense-1/finance-records",
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
    expect(fetchMock.mock.calls[1][1]?.body).toBe(JSON.stringify({ reason: "重复提交" }));
    expect(fetchMock.mock.calls[2][1]?.body).toBe(
      JSON.stringify({
        amountCents: "80000",
        paidAt: "2026-07-02T10:00:00.000Z",
        voucherFileId: "file-voucher-1",
        confirmationPassword: "current-password",
        expectedExpenseUpdatedAt: "2026-07-02T09:59:00.000Z",
        idempotencyKey: "2d74bb60-3c32-4c6a-93c9-a9baf7fe4572"
      })
    );
    expect(fetchMock.mock.calls[3][1]?.body).toBe(
      JSON.stringify({
        executedAt: "2026-07-02T09:00:00.000Z",
        note: "已采购",
        confirmationPassword: "current-password"
      })
    );
    expect(fetchMock.mock.calls[4][1]?.body).toBe(
      JSON.stringify({
        amountCents: "80000",
        occurredAt: "2026-07-02T11:00:00.000Z",
        confirmationPassword: "current-password",
        expectedExpenseUpdatedAt: "2026-07-02T10:59:00.000Z",
        idempotencyKey: "7b21c94f-4f2b-4d15-8b77-c4f145526dcb"
      })
    );
    expect(fetchMock.mock.calls[5][1]?.body).toBe(
      JSON.stringify({
        confirmationPassword: "current-password",
        downloadReason: "报销附件复核"
      })
    );
    expect(fetchMock.mock.calls[6][1]?.body).toBe(
      JSON.stringify({
        confirmationPassword: "current-password",
        downloadReason: "审批单复核"
      })
    );
  });

  it("reads project expense approval detail from the encoded route", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "expense-1",
        availableActions: [{
          key: "withdraw",
          label: "撤回项目支出申请",
          kind: "danger",
          enabled: true,
          disabledReason: null
        }],
        blockedReasons: []
      })
    } as Response);

    const detail = await fetchProjectExpenseApprovalDetail("project-1", "expense-1");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/projects/project-1/expense-requests/expense-1/approval-detail"
    );
    expect(fetchMock.mock.calls[0][1]?.method).toBeUndefined();
    expect(detail.availableActions[0]).toMatchObject({
      key: "withdraw",
      kind: "danger",
      enabled: true
    });
  });

  it.each([
    ["missing action", projectExpenseReviewDetail({ availableActions: [] })],
    [
      "disabled action",
      projectExpenseReviewDetail({
        availableActions: [projectExpenseReviewAction({ enabled: false })]
      })
    ],
    [
      "duplicate action",
      projectExpenseReviewDetail({
        availableActions: [projectExpenseReviewAction(), projectExpenseReviewAction()]
      })
    ],
    ["project drift", projectExpenseReviewDetail({ projectId: "project-b" })],
    ["expense drift", projectExpenseReviewDetail({ expenseRequestId: "expense-b" })],
    [
      "expense version drift",
      projectExpenseReviewDetail({ expectedExpenseUpdatedAt: "2026-07-31T09:00:00.000Z" })
    ],
    [
      "approval instance drift",
      projectExpenseReviewDetail({ expectedApprovalInstanceId: "approval-expense-b" })
    ],
    ["node drift", projectExpenseReviewDetail({ expectedNodeIndex: 2 })],
    [
      "approval version drift",
      projectExpenseReviewDetail({ expectedApprovalUpdatedAt: "2026-07-31T09:05:00.000Z" })
    ],
    ["missing context", projectExpenseReviewDetail({ reviewApprovalContext: null })]
  ])("refuses a %s project expense review preflight before POST", async (_label, detail) => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(detail));

    await expect(
      prepareProjectExpenseApprovalReviewAction(projectExpenseReviewActionInput())
    ).rejects.toThrow("项目支出审批资格或坐标已变化");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("freezes project expense approve fields behind a fresh GET and one encoded POST", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse(projectExpenseReviewDetail({ requiresSelfReviewConfirmation: true }))
      )
      .mockResolvedValueOnce(jsonResponse({ id: "expense/a", status: "approval_pending" }));
    const input = projectExpenseReviewActionInput({
      decision: "approve",
      approvedAmountCents: "80000",
      comment: "  同意按核定金额支付  ",
      requiresSelfReviewConfirmation: true,
      selfReviewReason: "  本人发起，已独立复核  ",
      confirmationPassword: " current-password "
    });
    const prepared = await prepareProjectExpenseApprovalReviewAction(input);
    input.comment = "随后篡改";
    input.approvedAmountCents = "1";

    await expect(
      executeProjectExpenseApprovalReviewAction({
        decision: "approve",
        capture: () => prepared.context,
        preflight: async () => prepared,
        current: () => true,
        complete: vi.fn(),
        fail: vi.fn(),
        finish: vi.fn()
      })
    ).resolves.toEqual(expect.objectContaining({ status: "completed" }));

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/projects/project%2Fa/expense-requests/expense%2Fa/approval-detail",
      "/api/projects/project%2Fa/expense-requests/expense%2Fa/approval"
    ]);
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(
      JSON.stringify({
        decision: "approve",
        approvedAmountCents: "80000",
        comment: "同意按核定金额支付",
        selfReviewReason: "本人发起，已独立复核",
        confirmationPassword: " current-password ",
        expectedExpenseUpdatedAt: "2026-07-31T00:00:00.000Z",
        expectedApprovalInstanceId: "approval-expense-a",
        expectedNodeIndex: 1,
        expectedApprovalUpdatedAt: "2026-07-31T00:05:00.000Z"
      })
    );
  });

  it("keeps project expense reject fixed, drops amount and stops stale work before POST", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(projectExpenseReviewDetail()))
      .mockResolvedValueOnce(jsonResponse({ id: "expense/a", status: "rejected" }));
    const prepared = await prepareProjectExpenseApprovalReviewAction(
      projectExpenseReviewActionInput({
        decision: "reject",
        approvedAmountCents: "80000",
        comment: "  支出依据不足  "
      })
    );

    await executeProjectExpenseApprovalReviewAction({
      decision: "reject",
      capture: () => prepared.context,
      preflight: async () => prepared,
      current: () => true,
      complete: vi.fn(),
      fail: vi.fn(),
      finish: vi.fn()
    });

    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      decision: "reject",
      comment: "支出依据不足",
      expectedExpenseUpdatedAt: "2026-07-31T00:00:00.000Z",
      expectedApprovalInstanceId: "approval-expense-a",
      expectedNodeIndex: 1,
      expectedApprovalUpdatedAt: "2026-07-31T00:05:00.000Z"
    });

    fetchMock.mockClear();
    await expect(
      executeProjectExpenseApprovalReviewAction({
        decision: "reject",
        capture: () => prepared.context,
        preflight: async () => ({ status: "stale", context: prepared.context }),
        current: () => false,
        complete: vi.fn(),
        fail: vi.fn(),
        finish: vi.fn()
      })
    ).resolves.toEqual(expect.objectContaining({ status: "stale" }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not complete a project expense review after its owner becomes stale during POST", async () => {
    const post = deferred<Response>();
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(projectExpenseReviewDetail()))
      .mockReturnValueOnce(post.promise);
    let current = true;
    const prepared = await prepareProjectExpenseApprovalReviewAction(
      projectExpenseReviewActionInput({ isCurrent: () => current })
    );
    if (prepared.status !== "ready") {
      throw new Error("项目支出审批预检未就绪");
    }
    const complete = vi.fn();
    const request = executeProjectExpenseApprovalReviewAction({
      decision: "approve",
      capture: () => prepared.context,
      preflight: async () => prepared,
      current: () => current,
      complete,
      fail: vi.fn(),
      finish: vi.fn()
    });

    await Promise.resolve();
    current = false;
    post.resolve(jsonResponse({ id: "expense/a" }));

    await expect(request).resolves.toEqual(
      expect.objectContaining({ status: "stale" })
    );
    expect(complete).not.toHaveBeenCalled();
  });

  it("freezes project expense withdrawal coordinates behind a fresh GET and one encoded POST", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(projectExpenseWithdrawalDetail()))
      .mockResolvedValueOnce(jsonResponse({ id: "expense/a", status: "withdrawn" }));
    const input = projectExpenseWithdrawalActionInput();
    const prepared = await prepareProjectExpenseWithdrawalAction(input);

    input.expectedExpenseUpdatedAt = "2026-07-31T09:00:00.000Z";
    input.expectedApprovalInstanceId = "forged-instance";
    const complete = vi.fn();
    const fail = vi.fn();
    const finish = vi.fn();
    await expect(
      executeProjectExpenseWithdrawalAction({
        action: "withdraw",
        capture: () => prepared.context,
        preflight: async () => prepared,
        current: () => true,
        complete,
        fail,
        finish
      })
    ).resolves.toEqual(expect.objectContaining({ status: "completed" }));

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/projects/project%2Fa/expense-requests/expense%2Fa/approval-detail",
      "/api/projects/project%2Fa/expense-requests/expense%2Fa/approval-withdrawal"
    ]);
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("POST");
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(
      JSON.stringify({
        expectedExpenseUpdatedAt: "2026-07-31T00:00:00.000Z",
        expectedApprovalInstanceId: "approval-expense-a",
        expectedNodeIndex: 1,
        expectedApprovalUpdatedAt: "2026-07-31T00:05:00.000Z"
      })
    );
    expect(complete).toHaveBeenCalledOnce();
    expect(fail).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledOnce();
  });

  it.each([
    ["missing action", projectExpenseWithdrawalDetail({ availableActions: [] })],
    [
      "disabled action",
      projectExpenseWithdrawalDetail({
        availableActions: [{
          key: "withdraw",
          label: "撤回项目支出申请",
          kind: "danger",
          enabled: false,
          disabledReason: "当前不可撤回"
        }]
      })
    ],
    [
      "duplicate action",
      projectExpenseWithdrawalDetail({
        availableActions: [
          projectExpenseWithdrawAction(),
          projectExpenseWithdrawAction()
        ]
      })
    ],
    ["project drift", projectExpenseWithdrawalDetail({ projectId: "project-b" })],
    ["expense drift", projectExpenseWithdrawalDetail({ expenseRequestId: "expense-b" })],
    [
      "expense version drift",
      projectExpenseWithdrawalDetail({
        expectedExpenseUpdatedAt: "2026-07-31T09:00:00.000Z"
      })
    ],
    [
      "approval instance drift",
      projectExpenseWithdrawalDetail({
        expectedApprovalInstanceId: "approval-expense-b"
      })
    ],
    ["node drift", projectExpenseWithdrawalDetail({ expectedNodeIndex: 2 })],
    [
      "approval version drift",
      projectExpenseWithdrawalDetail({
        expectedApprovalUpdatedAt: "2026-07-31T09:05:00.000Z"
      })
    ],
    ["missing context", projectExpenseWithdrawalDetail({ withdrawalContext: null })]
  ])("refuses a %s project expense withdrawal preflight before POST", async (_label, detail) => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(detail));

    await expect(
      prepareProjectExpenseWithdrawalAction(projectExpenseWithdrawalActionInput())
    ).rejects.toThrow("项目支出撤回资格或坐标已变化");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stops a stale project expense withdrawal after fresh GET and before POST", async () => {
    let current = true;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      current = false;
      return jsonResponse(projectExpenseWithdrawalDetail());
    });

    await expect(
      prepareProjectExpenseWithdrawalAction(
        projectExpenseWithdrawalActionInput({ isCurrent: () => current })
      )
    ).resolves.toEqual(expect.objectContaining({ status: "stale" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
      contractTypeKey: "material_purchase",
      companyEntityName: "建工集团",
      amountCents: "100000000",
      invoiceType: "vat_special" as const,
      taxMode: "single_rate" as const,
      defaultTaxRatePercent: "13",
      taxFactSource: "contract_document" as const,
      taxFactExplanation: "按原合同签署页和清单核对",
      pricingItems: [
        {
          billKey: "main",
          billName: "历史计价清单",
          rowKey: "row-1",
          itemCode: "CL-001",
          itemName: "钢材",
          unit: "吨",
          estimatedQuantity: "10",
          taxInclusiveUnitPrice: "4000.00"
        }
      ],
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
    await attachHistoricalPaymentVoucher("project-1", "takeover-1", { fileId: "file-2" });
    await recordContractTakeoverCorrection("project-1", "takeover-1", {
      correctionType: "evidence",
      reason: "补充历史付款凭证复核说明",
      responsibleUserId: "contract-director-1",
      afterSummary: "补充历史付款凭证，确认历史已付金额不变。",
      attachmentFileId: "file-1",
      currentPassword: "current-password"
    });
    await submitContractTakeoverReview("project-1", "takeover-1");
    await returnContractTakeoverForSupplement("project-1", "takeover-1", {
      reason: "缺少历史付款凭证"
    });
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
      "/api/projects/project-1/contract-takeovers/takeover-1/payment-evidence-files",
      "/api/projects/project-1/contract-takeovers/takeover-1/corrections",
      "/api/projects/project-1/contract-takeovers/takeover-1/review-submission",
      "/api/projects/project-1/contract-takeovers/takeover-1/supplement-return",
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
      JSON.stringify({ fileId: "file-2" })
    );
    expect(fetchMock.mock.calls[9][1]?.body).toBe(
      JSON.stringify({
        correctionType: "evidence",
        reason: "补充历史付款凭证复核说明",
        responsibleUserId: "contract-director-1",
        afterSummary: "补充历史付款凭证，确认历史已付金额不变。",
        attachmentFileId: "file-1",
        currentPassword: "current-password"
      })
    );
    expect(fetchMock.mock.calls[11][1]?.body).toBe(
      JSON.stringify({ reason: "缺少历史付款凭证" })
    );
    expect(fetchMock.mock.calls[12][1]?.body).toBe(
      JSON.stringify({ confirmationPassword: "current-password" })
    );
  });

  it("keeps contract and finance takeover writes on independent exact endpoints", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ takeoverId: "takeover-1" })
    } as Response);
    const contractPayload = {
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      expectedRevision: 2,
      signedAt: "2026-01-01",
      performanceStatus: "performing" as const,
      historicalSettledCents: "600000",
      settlementEvidenceSummary: "按历史结算台账核对",
      settlementEvidenceFileIds: ["settlement-evidence-1"],
      paymentTerms: { originalText: "按月结算付款", stages: [] },
      contractFacts: {
        contractNo: "HT-HIS-001",
        contractName: "历史材料合同",
        contractTypeKey: "material_purchase",
        counterparty: "供应商甲",
        originalAmountCents: "1000000",
        settlementCutoffDate: "2026-06-30",
        zeroSettlementDeclared: false
      }
    };
    const financePayload = {
      idempotencyKey: "22222222-2222-4222-8222-222222222222",
      expectedRevision: 3,
      basedOnContractRevision: 2,
      basedOnFinanceBasisRevision: 2,
      zeroPaymentDeclared: false,
      payments: [{
        rowKey: "payment-1",
        amountCents: "400000",
        paidAt: "2026-05-01",
        voucherFileIds: ["voucher-1"]
      }]
    };
    const confirmation = {
      idempotencyKey: "33333333-3333-4333-8333-333333333333",
      expectedRevision: 3,
      currentPassword: "current-password"
    };
    const withdrawal = {
      idempotencyKey: "44444444-4444-4444-8444-444444444444",
      expectedRevision: 3,
      currentPassword: "current-password",
      reason: "发现原始台账仍需复核"
    };
    const correction = {
      correctionScope: "historical_payment" as const,
      correctionOperation: "correction" as const,
      targetRevision: 3,
      targetHistoricalPaymentId: "historical-payment-1",
      targetAllocationId: "allocation-1",
      deltaCents: "1",
      reason: "补正一分钱差额",
      responsibleUserId: "finance-staff-1",
      attachmentFileId: "correction-file-1",
      applicationIdempotencyKey: "55555555-5555-4555-8555-555555555555",
      currentPassword: "current-password"
    };

    await saveContractTakeoverContractSide("project-1", "takeover-1", contractPayload);
    await saveContractTakeoverFinanceSide("project-1", "takeover-1", financePayload);
    await confirmContractTakeoverContractSide("project-1", "takeover-1", {
      ...confirmation,
      expectedRevision: 2
    });
    await confirmContractTakeoverFinanceSide("project-1", "takeover-1", {
      ...confirmation,
      basedOnContractRevision: 2,
      basedOnFinanceBasisRevision: 2
    });
    await withdrawContractTakeoverContractSideConfirmation(
      "project-1",
      "takeover-1",
      withdrawal
    );
    await withdrawContractTakeoverFinanceSideConfirmation(
      "project-1",
      "takeover-1",
      withdrawal
    );
    await submitContractTakeoverCorrection("project-1", "takeover-1", correction);
    await reviewContractTakeoverCorrection(
      "project-1",
      "takeover-1",
      "correction-1",
      {
        decision: "apply",
        reviewComment: "原始凭证与台账一致",
        currentPassword: "current-password"
      }
    );

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/projects/project-1/contract-takeovers/takeover-1/contract-side",
      "/api/projects/project-1/contract-takeovers/takeover-1/finance-side",
      "/api/projects/project-1/contract-takeovers/takeover-1/contract-side/confirmation",
      "/api/projects/project-1/contract-takeovers/takeover-1/finance-side/confirmation",
      "/api/projects/project-1/contract-takeovers/takeover-1/contract-side/confirmation-withdrawal",
      "/api/projects/project-1/contract-takeovers/takeover-1/finance-side/confirmation-withdrawal",
      "/api/projects/project-1/contract-takeovers/takeover-1/corrections",
      "/api/projects/project-1/contract-takeovers/takeover-1/corrections/correction-1/review"
    ]);
    expect(fetchMock.mock.calls.map((call) => call[1]?.method)).toEqual([
      "PUT",
      "PUT",
      "POST",
      "POST",
      "POST",
      "POST",
      "POST",
      "POST"
    ]);
    expect(fetchMock.mock.calls[0][1]?.body).toBe(JSON.stringify(contractPayload));
    expect(fetchMock.mock.calls[1][1]?.body).toBe(JSON.stringify(financePayload));
    expect(fetchMock.mock.calls[6][1]?.body).toBe(JSON.stringify(correction));
  });

  it("previews and applies the historical contract Excel import with the checked file facts", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ id: "ok" })
    } as Response);

    await previewContractTakeoverExcelImport("project-1", "file-1");
    await applyContractTakeoverExcelImport("project-1", {
      fileId: "file-1",
      fileSha256: "sha256-value",
      importFingerprint: "fingerprint-value",
      takeoverCutoffDate: "2026-07-17",
      responsibleUserId: "contract-director-1",
      reviewComment: "已核对合同主表和历史计价清单。",
      acceptanceConclusion: "通过预检的合同可以生成接管草稿。"
    });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/projects/project-1/contract-takeovers/imports/preview",
      "/api/projects/project-1/contract-takeovers/imports/apply"
    ]);
    expect(fetchMock.mock.calls.map((call) => call[1]?.method)).toEqual(["POST", "POST"]);
    expect(fetchMock.mock.calls[0][1]?.body).toBe(JSON.stringify({ fileId: "file-1" }));
    expect(fetchMock.mock.calls[1][1]?.body).toBe(
      JSON.stringify({
        fileId: "file-1",
        fileSha256: "sha256-value",
        importFingerprint: "fingerprint-value",
        takeoverCutoffDate: "2026-07-17",
        responsibleUserId: "contract-director-1",
        reviewComment: "已核对合同主表和历史计价清单。",
        acceptanceConclusion: "通过预检的合同可以生成接管草稿。"
      })
    );
  });

  it("downloads the historical contract takeover import template", async () => {
    const click = vi.fn();
    const anchor = {
      href: "",
      download: "",
      click,
      remove: vi.fn()
    } as unknown as HTMLAnchorElement;
    vi.stubGlobal("document", {
      createElement: vi.fn().mockReturnValue(anchor),
      body: { appendChild: vi.fn() }
    });
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn().mockReturnValue("blob:takeover-template"),
      revokeObjectURL: vi.fn()
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      blob: async () => new Blob(["xlsx"]),
      headers: new Headers({
        "Content-Disposition":
          "attachment; filename*=UTF-8''%E5%8E%86%E5%8F%B2%E5%90%88%E5%90%8C%E6%8E%A5%E7%AE%A1%E5%AF%BC%E5%85%A5%E6%A8%A1%E6%9D%BF.xlsx"
      })
    } as Response);

    await downloadContractTakeoverImportTemplate("project-1");

    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/projects/project-1/contract-takeovers/import-template"
    );
    expect(anchor.download).toBe("历史合同接管导入模板.xlsx");
    expect(click).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("downloads contract, settlement and historical takeover exports from authenticated endpoints", async () => {
    const click = vi.fn();
    const anchor = {
      href: "",
      download: "",
      click,
      remove: vi.fn()
    } as unknown as HTMLAnchorElement;
    vi.stubGlobal("document", {
      createElement: vi.fn().mockReturnValue(anchor),
      body: { appendChild: vi.fn() }
    });
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn().mockReturnValue("blob:ledger-export"),
      revokeObjectURL: vi.fn()
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      blob: async () => new Blob(["xlsx"]),
      headers: new Headers({
        "Content-Disposition": "attachment; filename*=UTF-8''ledger.xlsx"
      })
    } as Response);

    await downloadContractLedgerExport();
    await downloadSettlementLedgerExport();
    await downloadContractTakeoverLedgerExport("project/1");
    await downloadContractTakeoverDetailExport("project/1", "takeover/1");

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/contracts/ledger-export",
      "/api/settlements/ledger-export",
      "/api/projects/project%2F1/contract-takeovers/ledger-export",
      "/api/projects/project%2F1/contract-takeovers/takeover%2F1/detail-export"
    ]);
    expect(click).toHaveBeenCalledTimes(4);
    vi.unstubAllGlobals();
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
      settlementTemplateVersionId: "settlement-template-version-1",
      code: "JS-2026-019",
      periodLabel: "2026-06",
      settlementLines: [
        {
          sourceType: "contract_bill_row",
          contractBillRowId: "contract-bill-row-1",
          quantity: "12.5"
        }
      ]
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
      paymentTermsStageId: "stage-contract-due-1",
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
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toMatchObject({
      settlementTemplateVersionId: "settlement-template-version-1",
      settlementLines: [
        {
          sourceType: "contract_bill_row",
          contractBillRowId: "contract-bill-row-1",
          quantity: "12.5"
        }
      ]
    });
    expect(JSON.parse(fetchMock.mock.calls[3][1]?.body as string)).toMatchObject({
      sourceType: "contract_due",
      contractVersionId: "seed-contract-version-ht-2026-001-v1",
      paymentTermsStageId: "stage-contract-due-1"
    });
    expect(JSON.parse(fetchMock.mock.calls[2][1]?.body as string)).toEqual({
      sourceType: "contract_advance",
      contractVersionId: "seed-contract-version-ht-2026-001-v1",
      code: "FK-YF-2026-001",
      requestedAmountCents: "10000000"
    });
    expect(JSON.parse(fetchMock.mock.calls[3][1]?.body as string)).toEqual({
      sourceType: "contract_due",
      contractVersionId: "seed-contract-version-ht-2026-001-v1",
      paymentTermsStageId: "stage-contract-due-1",
      code: "FK-HT-2026-001",
      requestedAmountCents: "8000000"
    });
  });

  it("posts payment workflow actions to the backend", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ id: "ok" })
    } as Response);

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
      confirmationPassword: "current-password",
      expectedPaymentUpdatedAt:
        "2026-06-22T00:00:00.000Z",
      idempotencyKey:
        "f26e8632-5a5d-47a8-9f91-4f60591cbfa1"
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
    expect(fetchMock.mock.calls[5][1]?.body).toBe(
      JSON.stringify({
        amountCents: "5000000",
        occurredAt: "2026-06-22T01:00:00.000Z",
        confirmationPassword: "current-password"
      })
    );
  });

  it.each([
    ["missing action", paymentReviewDetail({ availableActions: [] })],
    [
      "disabled action",
      paymentReviewDetail({
        availableActions: [
          {
            key: "review_approval",
            label: "办理付款审批",
            kind: "primary",
            enabled: false,
            disabledReason: "当前不可审批",
            requiredRoles: []
          }
        ]
      })
    ],
    ["payment drift", paymentReviewDetail({ expectedPaymentUpdatedAt: "2026-07-31T01:00:00.000Z" })],
    ["approval drift", paymentReviewDetail({ expectedApprovalInstanceId: "approval-b" })],
    ["node drift", paymentReviewDetail({ expectedNodeIndex: 2 })],
    ["approval timestamp drift", paymentReviewDetail({ expectedApprovalUpdatedAt: "2026-07-31T01:00:00.000Z" })],
    ["missing coordinates", paymentReviewDetail({ reviewApprovalContext: null })]
  ])(
    "refuses a %s payment review preflight before the approval POST",
    async (_label, preflight) => {
      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(preflight));

      await expect(
        preparePaymentApprovalReviewAction(paymentReviewActionInput())
      ).rejects.toThrow("付款审批资格或审批坐标已变化");

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/payments/payment%2Fa",
        {}
      );
    }
  );

  it("freezes approve fields and performs one encoded POST after the fresh GET", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse(
          paymentReviewDetail({
            requiresSelfReviewConfirmation: true
          })
        )
      )
      .mockResolvedValueOnce(jsonResponse({ id: "approved" }));
    const input = paymentReviewActionInput({
      decision: "approve",
      approvedAmountCents: "5000000",
      comment: "  同意按核定金额付款  ",
      requiresSelfReviewConfirmation: true,
      selfReviewReason: "  本人发起，已独立复核  ",
      confirmationPassword: " current-password "
    });
    const prepared = await preparePaymentApprovalReviewAction(input);
    input.comment = "随后篡改";
    input.approvedAmountCents = "1";

    const complete = vi.fn();
    const fail = vi.fn();
    const finish = vi.fn();
    await expect(
      executePaymentApprovalReviewAction({
        decision: "approve",
        capture: () => prepared.context,
        preflight: async () => prepared,
        current: () => true,
        complete,
        fail,
        finish
      })
    ).resolves.toEqual(expect.objectContaining({ status: "completed" }));

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/payments/payment%2Fa",
      "/api/payments/payment%2Fa/approval"
    ]);
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("POST");
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(
      JSON.stringify({
        decision: "approve",
        approvedAmountCents: "5000000",
        comment: "同意按核定金额付款",
        selfReviewReason: "本人发起，已独立复核",
        confirmationPassword: " current-password ",
        expectedPaymentUpdatedAt: "2026-07-31T00:00:00.000Z",
        expectedApprovalInstanceId: "approval-a",
        expectedNodeIndex: 1,
        expectedApprovalUpdatedAt: "2026-07-31T00:05:00.000Z"
      })
    );
    expect(complete).toHaveBeenCalledOnce();
    expect(fail).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledOnce();
  });

  it("keeps reject fixed, drops approved amount and stops stale work before POST", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(paymentReviewDetail()))
      .mockResolvedValueOnce(jsonResponse({ id: "rejected" }));
    const prepared = await preparePaymentApprovalReviewAction(
      paymentReviewActionInput({
        decision: "reject",
        approvedAmountCents: "5000000",
        comment: "  付款依据不足  "
      })
    );

    await executePaymentApprovalReviewAction({
      decision: "reject",
      capture: () => prepared.context,
      preflight: async () => prepared,
      current: () => true,
      complete: vi.fn(),
      fail: vi.fn(),
      finish: vi.fn()
    });

    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      decision: "reject",
      comment: "付款依据不足",
      expectedPaymentUpdatedAt: "2026-07-31T00:00:00.000Z",
      expectedApprovalInstanceId: "approval-a",
      expectedNodeIndex: 1,
      expectedApprovalUpdatedAt: "2026-07-31T00:05:00.000Z"
    });

    fetchMock.mockClear();
    const stalePrepared = {
      status: "stale" as const,
      context: prepared.context
    };
    await expect(
      executePaymentApprovalReviewAction({
        decision: "reject",
        capture: () => prepared.context,
        preflight: async () => stalePrepared,
        current: () => false,
        complete: vi.fn(),
        fail: vi.fn(),
        finish: vi.fn()
      })
    ).resolves.toEqual(expect.objectContaining({ status: "stale" }));
    expect(fetchMock).not.toHaveBeenCalled();
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

  it("retries failed settlement generation separately from confirmed pure-render regeneration", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ status: "completed" })
    } as Response);

    await retrySettlementSignedDocumentGeneration("settlement/1");
    await regenerateSettlementSignedDocument("settlement/1", {
      confirmPureRenderingIssue: true,
      reason: "签名位置渲染偏移",
      confirmationPassword: "current-password"
    });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/settlements/settlement%2F1/signed-document-generation-retry",
      "/api/settlements/settlement%2F1/signed-document-regeneration"
    ]);
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({
      method: "POST",
      body: JSON.stringify({})
    }));
    expect(fetchMock.mock.calls[1][1]).toEqual(expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        confirmPureRenderingIssue: true,
        reason: "签名位置渲染偏移",
        confirmationPassword: "current-password"
      })
    }));
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
      decision: "approve",
      selfReviewReason: "不会在非自审页面生成",
      confirmationPassword: " settlement-password "
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
    expect(fetchMock.mock.calls[6][1]?.body).toBe(
      JSON.stringify({
        decision: "approve",
        selfReviewReason: "不会在非自审页面生成",
        confirmationPassword: " settlement-password "
      })
    );
  });

  it.each([
    ["missing action", contractReviewDetail({ availableActions: [] })],
    [
      "disabled action",
      contractReviewDetail({
        availableActions: [contractReviewAction({ enabled: false })]
      })
    ],
    [
      "duplicate enabled action",
      contractReviewDetail({
        availableActions: [contractReviewAction(), contractReviewAction()]
      })
    ],
    ["contract drift", contractReviewDetail({ contractId: "contract/b" })],
    ["version drift", contractReviewDetail({ contractVersionId: "version/b" })],
    [
      "contract timestamp drift",
      contractReviewDetail({ expectedContractUpdatedAt: "2026-08-01T01:00:00.000Z" })
    ],
    ["approval drift", contractReviewDetail({ expectedApprovalInstanceId: "approval-b" })],
    ["node drift", contractReviewDetail({ expectedNodeIndex: 2 })],
    [
      "approval timestamp drift",
      contractReviewDetail({ expectedApprovalUpdatedAt: "2026-08-01T01:05:00.000Z" })
    ],
    ["missing coordinates", contractReviewDetail({ reviewApprovalContext: null })],
    [
      "self review drift",
      contractReviewDetail({ requiresSelfReviewConfirmation: true })
    ],
    [
      "owner risk drift",
      contractReviewDetail({
        ownerContractRisk: contractOwnerRisk({ excessAmountCents: "2" })
      })
    ]
  ])(
    "refuses a %s contract review preflight before the approval POST",
    async (_label, preflight) => {
      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        jsonResponse(preflight)
      );

      await expect(
        prepareContractApprovalReviewAction(contractReviewActionInput())
      ).rejects.toThrow("合同审批资格、风险或审批坐标已变化");

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/contracts/route%2Fa",
        {}
      );
    }
  );

  it("freezes the contract review facts and performs one POST after the fresh GET", async () => {
    const risk = contractOwnerRisk();
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse(contractReviewDetail({
          requiresSelfReviewConfirmation: true,
          ownerContractRisk: risk
        }))
      )
      .mockResolvedValueOnce(jsonResponse({ id: "approved" }));
    const input = contractReviewActionInput({
      decision: "approve",
      comment: "  同意进入用章  ",
      requiresSelfReviewConfirmation: true,
      selfReviewReason: "  本人发起，已独立复核  ",
      confirmationPassword: " current-password ",
      ownerContractRisk: risk,
      ownerContractRiskConfirmed: true
    });
    const prepared = await prepareContractApprovalReviewAction(input);
    input.comment = "随后篡改";
    risk.message = "随后篡改风险文案";

    expect(Object.isFrozen(prepared.context)).toBe(true);
    expect(Object.isFrozen(prepared.context.ownerContractRisk)).toBe(true);
    const complete = vi.fn();
    const stale = vi.fn();
    const fail = vi.fn();
    const finish = vi.fn();
    await expect(
      executeContractApprovalReviewAction({
        decision: "approve",
        capture: () => prepared.context,
        preflight: async () => prepared,
        current: () => true,
        stale,
        complete,
        fail,
        finish
      })
    ).resolves.toEqual(expect.objectContaining({ status: "completed" }));

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/contracts/route%2Fa",
      "/api/contracts/version%2Fa/approval"
    ]);
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("POST");
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(
      JSON.stringify({
        decision: "approve",
        comment: "同意进入用章",
        selfReviewReason: "本人发起，已独立复核",
        confirmationPassword: " current-password ",
        ownerContractRiskConfirmed: true,
        expectedOwnerContractRisk: {
          status: "missing_owner_contract",
          ownerContractAmountCents: "0",
          downstreamContractAmountCents: "18000000",
          excessAmountCents: "18000000",
          message: "项目尚未登记生效业主主合同",
          requiresExplicitConfirmation: true
        },
        expectedContractUpdatedAt: "2026-08-01T00:00:00.000Z",
        expectedApprovalInstanceId: "approval-a",
        expectedNodeIndex: 1,
        expectedApprovalUpdatedAt: "2026-08-01T00:05:00.000Z"
      })
    );
    expect(stale).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledOnce();
    expect(fail).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledOnce();
  });

  it("does not send the owner-risk confirmation or snapshot when rejecting", async () => {
    const risk = contractOwnerRisk();
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(contractReviewDetail({
        ownerContractRisk: risk
      })))
      .mockResolvedValueOnce(jsonResponse({ id: "rejected" }));
    const prepared = await prepareContractApprovalReviewAction(
      contractReviewActionInput({
        decision: "reject",
        comment: "  合同价格依据不足  ",
        ownerContractRisk: risk,
        ownerContractRiskConfirmed: false
      })
    );

    await expect(
      executeContractApprovalReviewAction({
        decision: "reject",
        capture: () => prepared.context,
        preflight: async () => prepared,
        current: () => true,
        stale: vi.fn(),
        complete: vi.fn(),
        fail: vi.fn(),
        finish: vi.fn()
      })
    ).resolves.toEqual(expect.objectContaining({ status: "completed" }));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      decision: "reject",
      comment: "合同价格依据不足",
      expectedContractUpdatedAt: "2026-08-01T00:00:00.000Z",
      expectedApprovalInstanceId: "approval-a",
      expectedNodeIndex: 1,
      expectedApprovalUpdatedAt: "2026-08-01T00:05:00.000Z"
    });
  });

  it("keeps reject fixed and invokes stale without posting", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(contractReviewDetail())
    );
    const prepared = await prepareContractApprovalReviewAction(
      contractReviewActionInput({
        decision: "reject",
        comment: "  合同价格依据不足  "
      })
    );
    fetchMock.mockClear();
    const stale = vi.fn();
    const fail = vi.fn();
    const finish = vi.fn();

    await expect(
      executeContractApprovalReviewAction({
        decision: "reject",
        capture: () => prepared.context,
        preflight: async () => ({ status: "stale", context: prepared.context }),
        current: () => false,
        stale,
        complete: vi.fn(),
        fail,
        finish
      })
    ).resolves.toEqual(expect.objectContaining({ status: "stale" }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(stale).toHaveBeenCalledOnce();
    expect(fail).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledOnce();
  });

  it("does not complete stale work after the single contract review POST", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(contractReviewDetail()))
      .mockResolvedValueOnce(jsonResponse({ id: "approved" }));
    const prepared = await prepareContractApprovalReviewAction(
      contractReviewActionInput()
    );
    const stale = vi.fn();
    const complete = vi.fn();
    let currentChecks = 0;

    await expect(
      executeContractApprovalReviewAction({
        decision: "approve",
        capture: () => prepared.context,
        preflight: async () => prepared,
        current: () => ++currentChecks === 1,
        stale,
        complete,
        fail: vi.fn(),
        finish: vi.fn()
      })
    ).resolves.toEqual(expect.objectContaining({ status: "stale" }));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(stale).toHaveBeenCalledOnce();
    expect(complete).not.toHaveBeenCalled();
  });

  it("wraps an indeterminate contract review POST without retrying it", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(contractReviewDetail()))
      .mockRejectedValueOnce(new TypeError("socket closed after write"));
    const prepared = await prepareContractApprovalReviewAction(
      contractReviewActionInput()
    );
    const fail = vi.fn();

    await expect(
      executeContractApprovalReviewAction({
        decision: "approve",
        capture: () => prepared.context,
        preflight: async () => prepared,
        current: () => true,
        stale: vi.fn(),
        complete: vi.fn(),
        fail,
        finish: vi.fn()
      })
    ).resolves.toEqual(expect.objectContaining({ status: "failed" }));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fail).toHaveBeenCalledWith(
      prepared.context,
      expect.any(ContractApprovalReviewResultUnknownError)
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

  it("reuses the same private-upload idempotency key after an ambiguous response", async () => {
    const uploadIdempotencyKey =
      "a43073f9-9731-4d71-9498-b9727344dbd4";
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("upload response lost"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: uploadIdempotencyKey }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "affiliate-contract-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      );
    const state =
      createProjectAffiliateCompanyContractRecordAttemptState();
    const input = {
      form: {
        contractReference: "GL-2026-001",
        contractName: "项目挂靠管理协议",
        signedAt: "2026-07-20",
        rightsObligationsSummary: "双方权利义务摘要",
        companyEntityId: "company-1"
      },
      idempotencyKey: uploadIdempotencyKey,
      files: [
        {
          raw: Object.assign(new Blob(["signed"]), {
            name: "signed.pdf"
          })
        }
      ],
      context: "project-1",
      isCurrent: () => true
    };

    await expect(
      recordProjectAffiliateCompanyContractWithUpload(
        "project-1",
        input,
        state
      )
    ).rejects.toThrow("网络请求失败");
    await recordProjectAffiliateCompanyContractWithUpload(
      "project-1",
      input,
      state
    );

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/files",
      "/api/files",
      "/api/projects/project-1/affiliate-company-contracts"
    ]);
    const firstUpload = fetchMock.mock.calls[0]?.[1]?.body;
    const secondUpload = fetchMock.mock.calls[1]?.[1]?.body;
    expect(firstUpload).toBeInstanceOf(FormData);
    expect(secondUpload).toBeInstanceOf(FormData);
    expect((firstUpload as FormData).get("idempotencyKey")).toBe(
      uploadIdempotencyKey
    );
    expect((secondUpload as FormData).get("idempotencyKey")).toBe(
      uploadIdempotencyKey
    );
  });

  it("rejects an affiliate-company upload response that does not echo its idempotency key", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "legacy-random-file-id" }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      );
    const state =
      createProjectAffiliateCompanyContractRecordAttemptState();

    await expect(
      recordProjectAffiliateCompanyContractWithUpload(
        "project-1",
        {
          form: {
            contractReference: "GL-2026-001",
            contractName: "项目挂靠管理协议",
            signedAt: "2026-07-20",
            rightsObligationsSummary: "双方权利义务摘要",
            companyEntityId: "company-1"
          },
          idempotencyKey:
            "a43073f9-9731-4d71-9498-b9727344dbd4",
          files: [
            {
              raw: Object.assign(new Blob(["signed"]), {
                name: "signed.pdf"
              })
            }
          ],
          context: "project-1",
          isCurrent: () => true
        },
        state
      )
    ).rejects.toThrow("文件上传幂等响应不一致");

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/files"
    ]);
    expect(state.uploadedFileId).toBeNull();
  });

  it("reuses one uploaded affiliate-company contract file and frozen payload after a record retry", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "a43073f9-9731-4d71-9498-b9727344dbd4"
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "登记响应超时" }), {
          status: 503,
          headers: { "Content-Type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "affiliate-contract-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      );
    const state =
      createProjectAffiliateCompanyContractRecordAttemptState();
    const input = {
      form: {
        contractReference: " GL-2026-001 ",
        contractName: " 项目挂靠管理协议 ",
        signedAt: " 2026-07-20 ",
        rightsObligationsSummary: " 双方权利义务摘要 ",
        companyEntityId: " company-1 "
      },
      idempotencyKey: "a43073f9-9731-4d71-9498-b9727344dbd4",
      files: [
        {
          raw: Object.assign(new Blob(["signed"]), {
            name: "signed.pdf"
          })
        }
      ],
      context: "project-1",
      isCurrent: () => true
    };

    await expect(
      recordProjectAffiliateCompanyContractWithUpload(
        "project/1",
        input,
        state
      )
    ).rejects.toThrow("登记响应超时");
    input.form.contractName = "不得进入重试请求的改名";
    await recordProjectAffiliateCompanyContractWithUpload(
      "project/1",
      input,
      state
    );

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/files",
      "/api/projects/project%2F1/affiliate-company-contracts",
      "/api/projects/project%2F1/affiliate-company-contracts"
    ]);
    const firstRecordBody = fetchMock.mock.calls[1]?.[1]?.body;
    expect(fetchMock.mock.calls[2]?.[1]?.body).toBe(firstRecordBody);
    expect(JSON.parse(String(firstRecordBody))).toEqual({
      contractReference: "GL-2026-001",
      contractName: "项目挂靠管理协议",
      signedAt: "2026-07-20",
      rightsObligationsSummary: "双方权利义务摘要",
      companyEntityId: "company-1",
      idempotencyKey: "a43073f9-9731-4d71-9498-b9727344dbd4",
      fileId: "a43073f9-9731-4d71-9498-b9727344dbd4"
    });
  });

  it("preflights, uploads and records one frozen payment execution with the same idempotency key", async () => {
    const idempotencyKey =
      "f26e8632-5a5d-47a8-9f91-4f60591cbfa1";
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            paymentExecutionDetail(
              "payment/1",
              "2026-07-31T08:00:00.000Z"
            )
          ),
          {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: idempotencyKey }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "execution-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      );
    const state = createPaymentExecutionRecordAttemptState();
    const input = {
      amountCents: "5000000",
      paidAt: "2026-07-31T08:30:00.000Z",
      confirmationPassword: " current-password ",
      expectedPaymentUpdatedAt:
        "2026-07-31T08:00:00.000Z",
      idempotencyKey: idempotencyKey.toUpperCase(),
      file: Object.assign(new Blob(["voucher"]), {
        name: "付款凭证.pdf"
      }),
      fileName: "付款凭证.pdf",
      context: "payment/1",
      isCurrent: () => true
    };

    const request = recordPaymentExecutionWithUpload(
      "payment/1",
      input,
      state
    );
    input.amountCents = "1";
    input.paidAt = "2099-01-01T00:00:00.000Z";
    input.confirmationPassword = "changed-password";
    await request;

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/payments/payment%2F1",
      "/api/files",
      "/api/payments/payment%2F1/executions"
    ]);
    const uploadBody = fetchMock.mock.calls[1]?.[1]?.body;
    expect(uploadBody).toBeInstanceOf(FormData);
    expect((uploadBody as FormData).get("idempotencyKey")).toBe(
      idempotencyKey
    );
    expect(fetchMock.mock.calls[2]?.[1]?.body).toBe(
      JSON.stringify({
        amountCents: "5000000",
        paidAt: "2026-07-31T08:30:00.000Z",
        voucherFileId: idempotencyKey,
        confirmationPassword: " current-password ",
        expectedPaymentUpdatedAt:
          "2026-07-31T08:00:00.000Z",
        idempotencyKey
      })
    );
  });

  it("coalesces rapid payment execution confirms before preflight into one GET, upload and POST", async () => {
    const preflight = deferred<Response>();
    const idempotencyKey =
      "f26e8632-5a5d-47a8-9f91-4f60591cbfa1";
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockReturnValueOnce(preflight.promise)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: idempotencyKey }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "execution-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      );
    const state = createPaymentExecutionRecordAttemptState();
    const input = paymentExecutionInput(idempotencyKey);

    const first = recordPaymentExecutionWithUpload(
      "payment-a",
      input,
      state
    );
    const second = recordPaymentExecutionWithUpload(
      "payment-a",
      input,
      state
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    preflight.resolve(
      new Response(
        JSON.stringify(
          paymentExecutionDetail(
            "payment-a",
            "2026-07-31T08:00:00.000Z"
          )
        ),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      )
    );
    await Promise.all([first, second]);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/payments/payment-a",
      "/api/files",
      "/api/payments/payment-a/executions"
    ]);
  });

  it("stops a payment execution before upload when the fresh server capability is stale", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          paymentExecutionDetail(
            "payment-a",
            "2026-07-31T08:01:00.000Z"
          )
        ),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      )
    );

    await expect(
      recordPaymentExecutionWithUpload(
        "payment-a",
        paymentExecutionInput(
          "f26e8632-5a5d-47a8-9f91-4f60591cbfa1"
        ),
        createPaymentExecutionRecordAttemptState()
      )
    ).rejects.toThrow("付款执行资格或版本已变化");

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/payments/payment-a"
    ]);
  });

  it("checks page ownership again after preflight and before uploading", async () => {
    let current = true;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => {
        current = false;
        return paymentExecutionDetail(
          "payment-a",
          "2026-07-31T08:00:00.000Z"
        );
      }
    } as Response);
    const input = paymentExecutionInput(
      "f26e8632-5a5d-47a8-9f91-4f60591cbfa1"
    );
    input.isCurrent = () => current;

    await expect(
      recordPaymentExecutionWithUpload(
        "payment-a",
        input,
        createPaymentExecutionRecordAttemptState()
      )
    ).rejects.toThrow("实际付款上下文已失效");
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/payments/payment-a"
    ]);
  });

  it("checks page ownership again after voucher upload and before recording payment", async () => {
    let current = true;
    const idempotencyKey =
      "f26e8632-5a5d-47a8-9f91-4f60591cbfa1";
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            paymentExecutionDetail(
              "payment-a",
              "2026-07-31T08:00:00.000Z"
            )
          ),
          {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        )
      )
      .mockResolvedValueOnce({
        ok: true,
        json: async () => {
          current = false;
          return { id: idempotencyKey };
        }
      } as Response);
    const input = paymentExecutionInput(idempotencyKey);
    input.isCurrent = () => current;

    await expect(
      recordPaymentExecutionWithUpload(
        "payment-a",
        input,
        createPaymentExecutionRecordAttemptState()
      )
    ).rejects.toThrow("实际付款上下文已失效");
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/payments/payment-a",
      "/api/files"
    ]);
  });

  it("rejects a payment voucher upload response that does not echo the idempotency key", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            paymentExecutionDetail(
              "payment-a",
              "2026-07-31T08:00:00.000Z"
            )
          ),
          {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: "unexpected-file-id" }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        )
      );

    await expect(
      recordPaymentExecutionWithUpload(
        "payment-a",
        paymentExecutionInput(
          "f26e8632-5a5d-47a8-9f91-4f60591cbfa1"
        ),
        createPaymentExecutionRecordAttemptState()
      )
    ).rejects.toThrow("付款凭证上传幂等响应不一致");
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/payments/payment-a",
      "/api/files"
    ]);
  });

  it("rejects missing or duplicate enabled execution capabilities before upload", async () => {
    const missing = paymentExecutionDetail(
      "payment-a",
      "2026-07-31T08:00:00.000Z"
    );
    missing.availableActions = [];
    const duplicate = paymentExecutionDetail(
      "payment-a",
      "2026-07-31T08:00:00.000Z"
    );
    duplicate.availableActions.push({
      ...duplicate.availableActions[0]!
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify(missing), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(duplicate), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      );

    for (const idempotencyKey of [
      "f26e8632-5a5d-47a8-9f91-4f60591cbfa1",
      "1acdf14c-742f-4f8b-894d-0e098bf12040"
    ]) {
      await expect(
        recordPaymentExecutionWithUpload(
          "payment-a",
          paymentExecutionInput(idempotencyKey),
          createPaymentExecutionRecordAttemptState()
        )
      ).rejects.toThrow("付款执行资格或版本已变化");
    }
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/payments/payment-a",
      "/api/payments/payment-a"
    ]);
  });

  it("reuses the uploaded voucher, idempotency key and frozen body after an ambiguous execution response", async () => {
    const idempotencyKey =
      "f26e8632-5a5d-47a8-9f91-4f60591cbfa1";
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            paymentExecutionDetail(
              "payment-a",
              "2026-07-31T08:00:00.000Z"
            )
          ),
          {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: idempotencyKey }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "提交响应超时" }), {
          status: 503,
          headers: { "Content-Type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "execution-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      );
    const state = createPaymentExecutionRecordAttemptState();
    const input = paymentExecutionInput(idempotencyKey);

    await expect(
      recordPaymentExecutionWithUpload("payment-a", input, state)
    ).rejects.toThrow("提交响应超时");
    input.amountCents = "1";
    input.confirmationPassword = "changed-password";
    await recordPaymentExecutionWithUpload(
      "payment-a",
      input,
      state
    );

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/payments/payment-a",
      "/api/files",
      "/api/payments/payment-a/executions",
      "/api/payments/payment-a/executions"
    ]);
    expect(fetchMock.mock.calls[3]?.[1]?.body).toBe(
      fetchMock.mock.calls[2]?.[1]?.body
    );
  });

  it("allows correcting only the confirmation password after a deterministic password rejection", async () => {
    const idempotencyKey =
      "f26e8632-5a5d-47a8-9f91-4f60591cbfa1";
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            paymentExecutionDetail(
              "payment-a",
              "2026-07-31T08:00:00.000Z"
            )
          ),
          {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: idempotencyKey }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            message: "当前密码不正确，请重新输入"
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" }
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "execution-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      );
    const state = createPaymentExecutionRecordAttemptState();
    const input = paymentExecutionInput(idempotencyKey);
    input.confirmationPassword = "wrong-password";

    await expect(
      recordPaymentExecutionWithUpload("payment-a", input, state)
    ).rejects.toThrow("当前密码不正确");
    input.amountCents = "1";
    input.confirmationPassword = "correct-password";
    await recordPaymentExecutionWithUpload(
      "payment-a",
      input,
      state
    );

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/payments/payment-a",
      "/api/files",
      "/api/payments/payment-a/executions",
      "/api/payments/payment-a/executions"
    ]);
    expect(
      JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))
    ).toMatchObject({
      amountCents: "5000000",
      confirmationPassword: "wrong-password",
      idempotencyKey,
      voucherFileId: idempotencyKey
    });
    expect(
      JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body))
    ).toMatchObject({
      amountCents: "5000000",
      confirmationPassword: "correct-password",
      idempotencyKey,
      voucherFileId: idempotencyKey
    });
  });

  it("preflights, uploads and records one frozen project expense execution", async () => {
    const idempotencyKey =
      "2d74bb60-3c32-4c6a-93c9-a9baf7fe4572";
    const expectedExpenseUpdatedAt =
      "2026-07-31T08:00:00.000Z";
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse(
          projectExpenseExecutionDetail(
            "project/1",
            "expense/1",
            expectedExpenseUpdatedAt
          )
        )
      )
      .mockResolvedValueOnce(
        jsonResponse({ id: idempotencyKey })
      )
      .mockResolvedValueOnce(
        jsonResponse({ id: "expense-execution-1" })
      );
    const state =
      createProjectExpenseExecutionRecordAttemptState();
    const input = projectExpenseExecutionInput(
      idempotencyKey.toUpperCase()
    );

    const request = recordProjectExpenseExecutionWithUpload(
      "project/1",
      "expense/1",
      input,
      state
    );
    input.amountCents = "1";
    input.paidAt = "2099-01-01T00:00:00.000Z";
    input.confirmationPassword = "changed-password";
    const result = await request;

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/projects/project%2F1/expense-requests/expense%2F1/approval-detail",
      "/api/files",
      "/api/projects/project%2F1/expense-requests/expense%2F1/executions"
    ]);
    expect(
      (fetchMock.mock.calls[1]?.[1]?.body as FormData).get(
        "idempotencyKey"
      )
    ).toBe(idempotencyKey);
    expect(
      JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))
    ).toEqual({
      amountCents: "5000000",
      paidAt: "2026-07-31T08:30:00.000Z",
      voucherFileId: idempotencyKey,
      confirmationPassword: " current-password ",
      expectedExpenseUpdatedAt,
      idempotencyKey
    });
    expect(result).toEqual({ id: "expense-execution-1" });
  });

  it("keeps a fulfilled project expense attempt without a second upload or POST", async () => {
    const idempotencyKey =
      "2d74bb60-3c32-4c6a-93c9-a9baf7fe4572";
    const expectedExpenseUpdatedAt =
      "2026-07-31T08:00:00.000Z";
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse(
          projectExpenseExecutionDetail(
            "project-a",
            "expense-a",
            expectedExpenseUpdatedAt
          )
        )
      )
      .mockResolvedValueOnce(jsonResponse({ id: idempotencyKey }))
      .mockResolvedValueOnce(
        jsonResponse({ id: "expense-execution-1" })
      );
    const state =
      createProjectExpenseExecutionRecordAttemptState();
    const input = projectExpenseExecutionInput(idempotencyKey);

    const first = await recordProjectExpenseExecutionWithUpload(
      "project-a",
      "expense-a",
      input,
      state
    );
    input.amountCents = "1";
    input.confirmationPassword = "changed-password";
    const replay = await recordProjectExpenseExecutionWithUpload(
      "project-a",
      "expense-a",
      input,
      state
    );

    expect(replay).toBe(first);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/projects/project-a/expense-requests/expense-a/approval-detail",
      "/api/files",
      "/api/projects/project-a/expense-requests/expense-a/executions"
    ]);
  });

  it("stops project expense execution before upload when the fresh capability or CAS is stale", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse(
        projectExpenseExecutionDetail(
          "project-a",
          "expense-a",
          "2026-07-31T08:01:00.000Z"
        )
      )
    );

    await expect(
      recordProjectExpenseExecutionWithUpload(
        "project-a",
        "expense-a",
        projectExpenseExecutionInput(
          "2d74bb60-3c32-4c6a-93c9-a9baf7fe4572"
        ),
        createProjectExpenseExecutionRecordAttemptState()
      )
    ).rejects.toThrow("项目支出执行资格或版本已变化");

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/projects/project-a/expense-requests/expense-a/approval-detail"
    ]);
  });

  it("coalesces rapid project expense confirms and reuses the upload, UUID and frozen body after an ambiguous response", async () => {
    const idempotencyKey =
      "2d74bb60-3c32-4c6a-93c9-a9baf7fe4572";
    const preflight = deferred<Response>();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockReturnValueOnce(preflight.promise)
      .mockResolvedValueOnce(jsonResponse({ id: idempotencyKey }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "提交响应超时" }), {
          status: 503,
          headers: { "Content-Type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({ id: "expense-execution-1" })
      );
    const state =
      createProjectExpenseExecutionRecordAttemptState();
    const input = projectExpenseExecutionInput(idempotencyKey);

    const first = recordProjectExpenseExecutionWithUpload(
      "project-a",
      "expense-a",
      input,
      state
    );
    const duplicate = recordProjectExpenseExecutionWithUpload(
      "project-a",
      "expense-a",
      input,
      state
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    preflight.resolve(
      jsonResponse(
        projectExpenseExecutionDetail(
          "project-a",
          "expense-a",
          "2026-07-31T08:00:00.000Z"
        )
      )
    );
    await expect(first).rejects.toThrow("提交响应超时");
    await expect(duplicate).rejects.toThrow("提交响应超时");

    input.amountCents = "1";
    input.paidAt = "2099-01-01T00:00:00.000Z";
    input.confirmationPassword = "changed-password";
    await recordProjectExpenseExecutionWithUpload(
      "project-a",
      "expense-a",
      input,
      state
    );

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/projects/project-a/expense-requests/expense-a/approval-detail",
      "/api/files",
      "/api/projects/project-a/expense-requests/expense-a/executions",
      "/api/projects/project-a/expense-requests/expense-a/executions"
    ]);
    expect(fetchMock.mock.calls[3]?.[1]?.body).toBe(
      fetchMock.mock.calls[2]?.[1]?.body
    );
  });

  it("allows replacing only the project expense confirmation password after deterministic rejection", async () => {
    const idempotencyKey =
      "2d74bb60-3c32-4c6a-93c9-a9baf7fe4572";
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse(
          projectExpenseExecutionDetail(
            "project-a",
            "expense-a",
            "2026-07-31T08:00:00.000Z"
          )
        )
      )
      .mockResolvedValueOnce(jsonResponse({ id: idempotencyKey }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ message: "当前密码不正确，请重新输入" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" }
          }
        )
      )
      .mockResolvedValueOnce(
        jsonResponse({ id: "expense-execution-1" })
      );
    const state =
      createProjectExpenseExecutionRecordAttemptState();
    const input = projectExpenseExecutionInput(idempotencyKey);
    input.confirmationPassword = "wrong-password";

    await expect(
      recordProjectExpenseExecutionWithUpload(
        "project-a",
        "expense-a",
        input,
        state
      )
    ).rejects.toThrow("当前密码不正确");
    input.amountCents = "1";
    input.paidAt = "2099-01-01T00:00:00.000Z";
    input.confirmationPassword = "correct-password";
    await recordProjectExpenseExecutionWithUpload(
      "project-a",
      "expense-a",
      input,
      state
    );

    expect(
      JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))
    ).toMatchObject({
      amountCents: "5000000",
      paidAt: "2026-07-31T08:30:00.000Z",
      confirmationPassword: "wrong-password"
    });
    expect(
      JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body))
    ).toMatchObject({
      amountCents: "5000000",
      paidAt: "2026-07-31T08:30:00.000Z",
      confirmationPassword: "correct-password"
    });
  });

  it("rejects reuse of an affiliate-company contract record attempt for another project", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "a43073f9-9731-4d71-9498-b9727344dbd4"
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "登记响应超时" }), {
          status: 503,
          headers: { "Content-Type": "application/json" }
        })
      );
    const state =
      createProjectAffiliateCompanyContractRecordAttemptState();
    const input = {
      form: {
        contractReference: "GL-2026-001",
        contractName: "项目挂靠管理协议",
        signedAt: "2026-07-20",
        rightsObligationsSummary: "双方权利义务摘要",
        companyEntityId: "company-1"
      },
      idempotencyKey: "a43073f9-9731-4d71-9498-b9727344dbd4",
      files: [
        {
          raw: Object.assign(new Blob(["signed"]), {
            name: "signed.pdf"
          })
        }
      ],
      context: "project-1",
      isCurrent: () => true
    };

    await expect(
      recordProjectAffiliateCompanyContractWithUpload(
        "project-1",
        input,
        state
      )
    ).rejects.toThrow("登记响应超时");
    await expect(
      recordProjectAffiliateCompanyContractWithUpload(
        "project-2",
        input,
        state
      )
    ).rejects.toThrow("登记重试项目已变化");

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/files",
      "/api/projects/project-1/affiliate-company-contracts"
    ]);
  });

  it("coalesces concurrent affiliate-company contract submissions into one upload and record", async () => {
    let releaseUpload!: (response: Response) => void;
    const uploadResponse = new Promise<Response>((resolve) => {
      releaseUpload = resolve;
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockReturnValueOnce(uploadResponse)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "affiliate-contract-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      );
    const state =
      createProjectAffiliateCompanyContractRecordAttemptState();
    const input = {
      form: {
        contractReference: "GL-2026-001",
        contractName: "项目挂靠管理协议",
        signedAt: "2026-07-20",
        rightsObligationsSummary: "双方权利义务摘要",
        companyEntityId: "company-1"
      },
      idempotencyKey: "a43073f9-9731-4d71-9498-b9727344dbd4",
      files: [
        {
          raw: Object.assign(new Blob(["signed"]), {
            name: "signed.pdf"
          })
        }
      ],
      context: "project-1",
      isCurrent: () => true
    };

    const first = recordProjectAffiliateCompanyContractWithUpload(
      "project-1",
      input,
      state
    );
    const second = recordProjectAffiliateCompanyContractWithUpload(
      "project-1",
      input,
      state
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    releaseUpload(
      new Response(
        JSON.stringify({
          id: "a43073f9-9731-4d71-9498-b9727344dbd4"
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      )
    );
    await Promise.all([first, second]);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/files",
      "/api/projects/project-1/affiliate-company-contracts"
    ]);
  });

  it("stops an affiliate-company contract record after upload when its page context expires", async () => {
    let current = true;
    const isCurrent = vi.fn(() => current);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => {
        current = false;
        return {
          id: "a43073f9-9731-4d71-9498-b9727344dbd4"
        };
      }
    } as Response);
    const state =
      createProjectAffiliateCompanyContractRecordAttemptState();

    await expect(
      recordProjectAffiliateCompanyContractWithUpload(
        "project-1",
        {
          form: {
            contractReference: "GL-2026-001",
            contractName: "项目挂靠管理协议",
            signedAt: "2026-07-20",
            rightsObligationsSummary: "双方权利义务摘要",
            companyEntityId: "company-1"
          },
          idempotencyKey: "a43073f9-9731-4d71-9498-b9727344dbd4",
          files: [
            {
              raw: Object.assign(new Blob(["signed"]), {
                name: "signed.pdf"
              })
            }
          ],
          context: "project-1",
          isCurrent
        },
        state
      )
    ).rejects.toThrow("线下合同登记上下文已失效");
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/files"
    ]);
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

function projectExpenseWithdrawAction() {
  return {
    key: "withdraw",
    label: "撤回项目支出申请",
    kind: "danger",
    enabled: true,
    disabledReason: null
  };
}

function projectExpenseWithdrawalDetail(
  overrides: {
    projectId?: string;
    expenseRequestId?: string;
    expectedExpenseUpdatedAt?: string;
    expectedApprovalInstanceId?: string;
    expectedNodeIndex?: number;
    expectedApprovalUpdatedAt?: string;
    withdrawalContext?: null;
    availableActions?: Array<Record<string, unknown>>;
  } = {}
) {
  const expectedExpenseUpdatedAt =
    overrides.expectedExpenseUpdatedAt ?? "2026-07-31T00:00:00.000Z";
  return {
    id: overrides.expenseRequestId ?? "expense/a",
    projectId: overrides.projectId ?? "project/a",
    lifecycleUpdatedAt: expectedExpenseUpdatedAt,
    withdrawalContext:
      overrides.withdrawalContext === null
        ? null
        : {
            expectedExpenseUpdatedAt,
            expectedApprovalInstanceId:
              overrides.expectedApprovalInstanceId ??
              "approval-expense-a",
            expectedNodeIndex: overrides.expectedNodeIndex ?? 1,
            expectedApprovalUpdatedAt:
              overrides.expectedApprovalUpdatedAt ??
              "2026-07-31T00:05:00.000Z"
          },
    availableActions:
      overrides.availableActions ?? [projectExpenseWithdrawAction()]
  };
}

function projectExpenseWithdrawalActionInput(
  overrides: Partial<{
    action: "withdraw";
    ownerScope: string;
    routeGeneration: number;
    detailEpoch: number;
    dialogGeneration: number;
    operationId: number;
    projectId: string;
    expenseRequestId: string;
    expectedExpenseUpdatedAt: string;
    expectedApprovalInstanceId: string;
    expectedNodeIndex: number;
    expectedApprovalUpdatedAt: string;
    isCurrent: (context: unknown) => boolean;
  }> = {}
) {
  return {
    action: "withdraw" as const,
    ownerScope: "project-expense-withdraw-owner",
    routeGeneration: 1,
    detailEpoch: 2,
    dialogGeneration: 3,
    operationId: 4,
    projectId: "project/a",
    expenseRequestId: "expense/a",
    expectedExpenseUpdatedAt: "2026-07-31T00:00:00.000Z",
    expectedApprovalInstanceId: "approval-expense-a",
    expectedNodeIndex: 1,
    expectedApprovalUpdatedAt: "2026-07-31T00:05:00.000Z",
    isCurrent: () => true,
    ...overrides
  };
}

function projectExpenseReviewAction(
  overrides: { enabled?: boolean; requiresSelfReviewConfirmation?: boolean } = {}
) {
  return {
    key: "review_approval",
    label: "办理项目支出审批",
    kind: "primary",
    enabled: overrides.enabled ?? true,
    disabledReason: overrides.enabled === false ? "当前不可审批" : null,
    requiredRoles: [],
    requiresSelfReviewConfirmation:
      overrides.requiresSelfReviewConfirmation ?? false
  };
}

function projectExpenseReviewDetail(
  overrides: {
    projectId?: string;
    expenseRequestId?: string;
    expectedExpenseUpdatedAt?: string;
    expectedApprovalInstanceId?: string;
    expectedNodeIndex?: number;
    expectedApprovalUpdatedAt?: string;
    reviewApprovalContext?: null;
    availableActions?: Array<Record<string, unknown>>;
    requiresSelfReviewConfirmation?: boolean;
  } = {}
) {
  const expectedExpenseUpdatedAt =
    overrides.expectedExpenseUpdatedAt ?? "2026-07-31T00:00:00.000Z";
  return {
    id: overrides.expenseRequestId ?? "expense/a",
    projectId: overrides.projectId ?? "project/a",
    lifecycleUpdatedAt: expectedExpenseUpdatedAt,
    reviewApprovalContext:
      overrides.reviewApprovalContext === null
        ? null
        : {
            expectedExpenseUpdatedAt,
            expectedApprovalInstanceId:
              overrides.expectedApprovalInstanceId ?? "approval-expense-a",
            expectedNodeIndex: overrides.expectedNodeIndex ?? 1,
            expectedApprovalUpdatedAt:
              overrides.expectedApprovalUpdatedAt ??
              "2026-07-31T00:05:00.000Z"
          },
    availableActions:
      overrides.availableActions ??
      [
        projectExpenseReviewAction({
          requiresSelfReviewConfirmation:
            overrides.requiresSelfReviewConfirmation
        })
      ]
  };
}

function projectExpenseReviewActionInput(
  overrides: Partial<PrepareProjectExpenseApprovalReviewActionInput> = {}
): PrepareProjectExpenseApprovalReviewActionInput {
  return {
    ownerScope: "project-expense-review-owner",
    routeGeneration: 2,
    detailEpoch: 3,
    dialogGeneration: 4,
    operationId: 5,
    projectId: "project/a",
    expenseRequestId: "expense/a",
    expectedExpenseUpdatedAt: "2026-07-31T00:00:00.000Z",
    expectedApprovalInstanceId: "approval-expense-a",
    expectedNodeIndex: 1,
    expectedApprovalUpdatedAt: "2026-07-31T00:05:00.000Z",
    decision: "approve",
    requiresSelfReviewConfirmation: false,
    isCurrent: () => true,
    ...overrides
  };
}

function paymentReviewDetail(
  overrides: {
    paymentId?: string;
    expectedPaymentUpdatedAt?: string;
    expectedApprovalInstanceId?: string;
    expectedNodeIndex?: number;
    expectedApprovalUpdatedAt?: string;
    reviewApprovalContext?: null;
    availableActions?: Array<Record<string, unknown>>;
    requiresSelfReviewConfirmation?: boolean;
  } = {}
) {
  const expectedPaymentUpdatedAt =
    overrides.expectedPaymentUpdatedAt ?? "2026-07-31T00:00:00.000Z";
  return {
    id: overrides.paymentId ?? "payment/a",
    lifecycleUpdatedAt: expectedPaymentUpdatedAt,
    reviewApprovalContext:
      overrides.reviewApprovalContext === null
        ? null
        : {
            expectedPaymentUpdatedAt,
            expectedApprovalInstanceId:
              overrides.expectedApprovalInstanceId ?? "approval-a",
            expectedNodeIndex: overrides.expectedNodeIndex ?? 1,
            expectedApprovalUpdatedAt:
              overrides.expectedApprovalUpdatedAt ??
              "2026-07-31T00:05:00.000Z"
          },
    availableActions:
      overrides.availableActions ??
      [
        {
          key: "review_approval",
          label: "办理付款审批",
          kind: "primary",
          enabled: true,
          disabledReason: null,
          requiredRoles: [],
          requiresSelfReviewConfirmation:
            overrides.requiresSelfReviewConfirmation ?? false
        }
      ]
  };
}

function contractOwnerRisk(
  overrides: Partial<{
    status: "clear" | "missing_owner_contract" | "exceeds_owner_contract";
    ownerContractAmountCents: string;
    downstreamContractAmountCents: string;
    excessAmountCents: string;
    message: string;
    requiresExplicitConfirmation: boolean;
  }> = {}
) {
  return {
    status: "missing_owner_contract" as const,
    ownerContractAmountCents: "0",
    downstreamContractAmountCents: "18000000",
    excessAmountCents: "18000000",
    message: "项目尚未登记生效业主主合同",
    requiresExplicitConfirmation: true,
    ...overrides
  };
}

function contractReviewAction(
  overrides: Partial<{
    enabled: boolean;
    requiresSelfReviewConfirmation: boolean;
  }> = {}
) {
  return {
    key: "review_approval",
    label: "办理合同审批",
    kind: "primary",
    enabled: overrides.enabled ?? true,
    disabledReason: overrides.enabled === false ? "当前不可审批" : null,
    requiresSelfReviewConfirmation:
      overrides.requiresSelfReviewConfirmation ?? false
  };
}

function contractReviewDetail(
  overrides: {
    contractId?: string;
    contractVersionId?: string;
    expectedContractUpdatedAt?: string;
    expectedApprovalInstanceId?: string;
    expectedNodeIndex?: number;
    expectedApprovalUpdatedAt?: string;
    reviewApprovalContext?: null;
    availableActions?: Array<Record<string, unknown>>;
    requiresSelfReviewConfirmation?: boolean;
    ownerContractRisk?: ReturnType<typeof contractOwnerRisk>;
  } = {}
) {
  const expectedContractUpdatedAt =
    overrides.expectedContractUpdatedAt ?? "2026-08-01T00:00:00.000Z";
  return {
    id: overrides.contractId ?? "contract/a",
    contractVersionId: overrides.contractVersionId ?? "version/a",
    lifecycleUpdatedAt: expectedContractUpdatedAt,
    reviewApprovalContext:
      overrides.reviewApprovalContext === null
        ? null
        : {
            expectedContractUpdatedAt,
            expectedApprovalInstanceId:
              overrides.expectedApprovalInstanceId ?? "approval-a",
            expectedNodeIndex: overrides.expectedNodeIndex ?? 1,
            expectedApprovalUpdatedAt:
              overrides.expectedApprovalUpdatedAt ??
              "2026-08-01T00:05:00.000Z"
          },
    ownerContractRisk: overrides.ownerContractRisk ?? contractOwnerRisk(),
    availableActions:
      overrides.availableActions ??
      [
        contractReviewAction({
          requiresSelfReviewConfirmation:
            overrides.requiresSelfReviewConfirmation
        })
      ]
  };
}

function contractReviewActionInput(
  overrides: Partial<PrepareContractApprovalReviewActionInput> = {}
): PrepareContractApprovalReviewActionInput {
  return {
    ownerScope: "contract-page-a",
    routeGeneration: 2,
    detailEpoch: 3,
    dialogGeneration: 4,
    operationId: 5,
    routeContractId: "route/a",
    contractId: "contract/a",
    contractVersionId: "version/a",
    expectedContractUpdatedAt: "2026-08-01T00:00:00.000Z",
    expectedApprovalInstanceId: "approval-a",
    expectedNodeIndex: 1,
    expectedApprovalUpdatedAt: "2026-08-01T00:05:00.000Z",
    decision: "approve",
    requiresSelfReviewConfirmation: false,
    ownerContractRisk: contractOwnerRisk(),
    ownerContractRiskConfirmed: true,
    isCurrent: () => true,
    ...overrides
  };
}

function paymentReviewActionInput(
  overrides: Partial<PreparePaymentApprovalReviewActionInput> = {}
): PreparePaymentApprovalReviewActionInput {
  return {
    ownerScope: "payment-page-a",
    routeGeneration: 2,
    detailEpoch: 3,
    dialogGeneration: 4,
    operationId: 5,
    paymentId: "payment/a",
    expectedPaymentUpdatedAt: "2026-07-31T00:00:00.000Z",
    expectedApprovalInstanceId: "approval-a",
    expectedNodeIndex: 1,
    expectedApprovalUpdatedAt: "2026-07-31T00:05:00.000Z",
    decision: "approve" as const,
    requiresSelfReviewConfirmation: false,
    isCurrent: () => true,
    ...overrides
  };
}

function paymentExecutionDetail(
  paymentId: string,
  expectedPaymentUpdatedAt: string
) {
  return {
    id: paymentId,
    lifecycleUpdatedAt: expectedPaymentUpdatedAt,
    executionContext: { expectedPaymentUpdatedAt },
    availableActions: [
      {
        key: "record_execution",
        label: "登记实际付款",
        kind: "primary",
        enabled: true,
        disabledReason: null,
        requiredRoles: ["finance_staff"]
      }
    ]
  };
}

function paymentExecutionInput(idempotencyKey: string) {
  return {
    amountCents: "5000000",
    paidAt: "2026-07-31T08:30:00.000Z",
    confirmationPassword: " current-password ",
    expectedPaymentUpdatedAt:
      "2026-07-31T08:00:00.000Z",
    idempotencyKey,
    file: Object.assign(new Blob(["voucher"]), {
      name: "付款凭证.pdf"
    }),
    fileName: "付款凭证.pdf",
    context: "payment-a",
    isCurrent: () => true
  };
}

function projectExpenseExecutionDetail(
  projectId: string,
  expenseRequestId: string,
  expectedExpenseUpdatedAt: string,
  actionEnabled = true
) {
  return {
    id: expenseRequestId,
    projectId,
    lifecycleUpdatedAt: expectedExpenseUpdatedAt,
    executionContext: actionEnabled
      ? { expectedExpenseUpdatedAt }
      : null,
    availableActions: actionEnabled
      ? [
          {
            key: "record_execution",
            label: "登记项目支出实付",
            kind: "primary",
            enabled: true,
            disabledReason: null,
            requiredRoles: ["finance_staff"]
          }
        ]
      : []
  };
}

function projectExpenseExecutionInput(
  idempotencyKey: string
) {
  return {
    amountCents: "5000000",
    paidAt: "2026-07-31T08:30:00.000Z",
    confirmationPassword: " current-password ",
    expectedExpenseUpdatedAt:
      "2026-07-31T08:00:00.000Z",
    idempotencyKey,
    file: Object.assign(new Blob(["voucher"]), {
      name: "项目支出实付凭证.pdf"
    }),
    fileName: "项目支出实付凭证.pdf",
    context: "expense-a",
    isCurrent: () => true
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, reject, resolve };
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    json: async () => body
  } as Response;
}
