import {
  classifySettlementDraftLifecycle,
  isSettlementDraftSerializationConflict,
  loadSettlementDraftLifecycles
} from "./settlement-draft-lifecycle";

describe("settlement draft lifecycle", () => {
  const draft = {
    id: "draft-1",
    projectId: "project-1",
    contractId: "contract-1",
    contractVersionId: "version-1",
    code: "JS-2026-031",
    processId: "process-1",
    status: "draft",
    submittedSettlementId: null,
    submittedAt: null,
    abandonReason: null
  };

  it("keeps historical invalidated evidence monotonic", () => {
    expect(classifySettlementDraftLifecycle(draft, {
      historicalEvidenceCount: 1,
      draftApprovalInstanceCount: 0,
      formalSettlementIds: [],
      processSettlementId: null,
      paymentRequestCount: 0,
      formalApprovalInstanceCount: 0
    })).toEqual({
      lifecycleKind: "approval_draft",
      expectedAction: "abandon_application",
      blockers: ["存在冻结或签章文件"]
    });
  });

  it("treats a draft-scoped approval instance as application evidence", () => {
    expect(classifySettlementDraftLifecycle(draft, {
      historicalEvidenceCount: 0,
      draftApprovalInstanceCount: 1,
      formalSettlementIds: [],
      processSettlementId: null,
      paymentRequestCount: 0,
      formalApprovalInstanceCount: 0
    })).toMatchObject({
      lifecycleKind: "approval_draft",
      expectedAction: "abandon_application",
      blockers: ["存在草稿审批记录"]
    });
  });

  it("fails closed on process-linked formal settlement, approval and payment facts", async () => {
    const client = {
      settlementSignedDocument: {
        findMany: jest.fn().mockResolvedValue([{
          settlementDraftId: "draft-1",
          purpose: "frozen_counterparty_copy",
          status: "invalidated"
        }])
      },
      contractSettlementProcess: {
        findMany: jest.fn().mockResolvedValue([{
          id: "process-1",
          settlementId: "settlement-1"
        }])
      },
      settlement: {
        findMany: jest.fn().mockResolvedValue([{
          id: "settlement-1",
          projectId: "project-1",
          contractId: "contract-1",
          contractVersionId: "version-1",
          code: "JS-2026-031",
          processId: "process-1"
        }])
      },
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([{
          id: "payment-1",
          settlementId: "settlement-1"
        }])
      },
      approvalInstance: {
        findMany: jest.fn().mockResolvedValue([{
          id: "approval-1",
          businessType: "settlement",
          businessId: "settlement-1"
        }])
      }
    };

    const lifecycle = (await loadSettlementDraftLifecycles(
      client as never,
      [draft as never]
    )).get("draft-1");

    expect(lifecycle).toMatchObject({
      lifecycleKind: "formal_record",
      expectedAction: null,
      blockers: expect.arrayContaining([
        "存在正式结算",
        "存在关联付款申请",
        "存在正式结算审批"
      ]),
      facts: {
        formalSettlementIds: ["settlement-1"],
        processSettlementId: "settlement-1",
        paymentRequestCount: 1,
        formalApprovalInstanceCount: 1,
        historicalEvidenceCount: 1,
        draftApprovalInstanceCount: 0
      }
    });
  });

  it("skips formal downstream scans under mutation lock while preserving draft approval evidence", async () => {
    const paymentFindMany = jest.fn().mockResolvedValue([
      { id: "payment-1", settlementId: "settlement-1" }
    ]);
    const approvalFindMany = jest.fn().mockResolvedValue([{
      id: "draft-approval-1",
      businessType: "settlement_draft",
      businessId: "draft-1"
    }]);
    const client = {
      settlementSignedDocument: {
        findMany: jest.fn().mockResolvedValue([])
      },
      contractSettlementProcess: {
        findMany: jest.fn().mockResolvedValue([{
          id: "process-1",
          settlementDraftId: "draft-1",
          settlementId: "settlement-1"
        }])
      },
      settlement: {
        findMany: jest.fn().mockResolvedValue([{
          id: "settlement-1",
          projectId: "project-1",
          contractId: "contract-1",
          contractVersionId: "version-1",
          code: "JS-2026-031",
          processId: "process-1"
        }])
      },
      paymentRequest: { findMany: paymentFindMany },
      approvalInstance: { findMany: approvalFindMany }
    };

    const lifecycle = (await loadSettlementDraftLifecycles(
      client as never,
      [draft as never],
      { includeFormalDownstreamFacts: false }
    )).get("draft-1");

    expect(lifecycle).toMatchObject({
      lifecycleKind: "formal_record",
      facts: {
        draftApprovalInstanceCount: 1,
        paymentRequestCount: 0,
        formalApprovalInstanceCount: 0
      }
    });
    expect(paymentFindMany).not.toHaveBeenCalled();
    expect(approvalFindMany).toHaveBeenCalledTimes(1);
    expect(approvalFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        businessType: "settlement_draft",
        businessId: { in: ["draft-1"] }
      }
    }));
  });

  it("does not treat a reused non-unique coordinate as formal identity", async () => {
    const client = {
      settlementSignedDocument: {
        findMany: jest.fn().mockResolvedValue([])
      },
      contractSettlementProcess: {
        findMany: jest.fn().mockResolvedValue([])
      },
      settlement: {
        findMany: jest.fn().mockResolvedValue([{
          id: "unrelated",
          projectId: "project-1",
          contractId: "contract-1",
          contractVersionId: "version-1",
          code: "JS-2026-031",
          processId: "process-other"
        }])
      },
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([])
      },
      approvalInstance: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };

    const lifecycle = (await loadSettlementDraftLifecycles(
      client as never,
      [{ ...draft, processId: null } as never]
    )).get("draft-1");

    expect(lifecycle).toMatchObject({
      lifecycleKind: "pristine_draft",
      expectedAction: "delete_pristine_draft",
      facts: { formalSettlementIds: [] }
    });
    expect(client.settlement.findMany).not.toHaveBeenCalled();
  });

  it("finds a process-linked settlement even when the draft process marker drifted", async () => {
    const client = {
      settlementSignedDocument: {
        findMany: jest.fn().mockResolvedValue([])
      },
      contractSettlementProcess: {
        findMany: jest.fn().mockResolvedValue([{
          id: "process-legacy",
          settlementDraftId: "draft-1",
          settlementId: "settlement-legacy"
        }])
      },
      settlement: {
        findMany: jest.fn().mockResolvedValue([])
      },
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([])
      },
      approvalInstance: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };

    const lifecycle = (await loadSettlementDraftLifecycles(
      client as never,
      [{ ...draft, processId: null } as never]
    )).get("draft-1");

    expect(lifecycle).toMatchObject({
      lifecycleKind: "formal_record",
      expectedAction: null,
      facts: {
        processSettlementId: "settlement-legacy",
        formalSettlementIds: ["settlement-legacy"]
      }
    });
  });

  it.each([
    { code: "P2034" },
    { code: "40001" },
    { code: "P2010", meta: { code: "40001" } }
  ])("recognizes serialization conflict %o", (error) => {
    expect(isSettlementDraftSerializationConflict(error)).toBe(true);
  });
});
