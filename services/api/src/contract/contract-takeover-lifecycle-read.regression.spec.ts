import { ContractTakeoverService } from "../contract-takeover/contract-takeover.service";
import { ContractReadService } from "./contract-read.service";

describe("historical takeover closure and contract ledger reading", () => {
  it("loads the contract ledger after a takeover is submitted for review and abandoned without ordinary approval", async () => {
    const createdAt = new Date("2026-10-20T01:00:00.000Z");
    const contract = (id: string, source: string) => ({
      id,
      projectId: "project-regression",
      source,
      code: id === "historical-contract" ? "HIS-TEST-001" : "HT-TEST-001",
      temporaryCode: null,
      name: id === "historical-contract" ? "历史材料采购合同" : "正式施工合同",
      counterparty: "测试相对方",
      ownerUserId: "contract-handler",
      contractTypeKey: "material_purchase",
      companyEntityId: null,
      companyEntityName: null,
      voidedAt: null,
      createdAt,
      updatedAt: createdAt
    });
    const contracts = [
      contract("historical-contract", "historical_takeover"),
      contract("formal-contract", "system")
    ];
    const version = (id: string, contractId: string, changeType: string, status: string) => ({
      id,
      contractId,
      versionNo: 1,
      changeType,
      status,
      firstSubmittedAt: null,
      abandonedAt: null,
      abandonedByUserId: null,
      abandonReason: null,
      amountCents: 100_000n,
      amountLimitType: "capped",
      pricingNature: "fixed_total",
      draftRevision: 1,
      createdAt,
      updatedAt: createdAt
    });
    const historicalVersion = version(
      "historical-version", "historical-contract", "historical_takeover", "draft"
    );
    const versions = [
      historicalVersion,
      version("formal-version", "formal-contract", "original", "effective")
    ];
    const takeover = {
      id: "historical-takeover",
      projectId: "project-regression",
      contractId: "historical-contract",
      contractVersionId: "historical-version",
      paymentTermsVersionId: "historical-terms",
      takeoverLevel: "A",
      takeoverStatus: "draft",
      lifecycleStatus: "completed",
      signedAt: createdAt,
      historicalSettledCents: 0n,
      historicalApprovalPendingPaymentCents: 0n,
      historicalApprovedPendingPaymentCents: 0n,
      historicalPaidCents: 0n,
      historicalProxyPaidCents: 0n,
      historicalAdvancePaidCents: 0n,
      historicalAdvanceDeductedCents: 0n,
      historicalRetentionWithheldCents: 0n,
      historicalRetentionReleasedCents: 0n,
      otherConfirmedOccupancyCents: 0n,
      createdByUserId: "contract-handler",
      responsibleUserId: "contract-handler",
      submittedAt: null,
      submittedByUserId: null,
      confirmedAt: null,
      historicalBalanceConfirmedAt: null,
      createdAt,
      updatedAt: createdAt
    };
    const terms = {
      id: "historical-terms",
      contractId: "historical-contract",
      contractVersionId: "historical-version",
      status: "draft",
      versionNo: 1,
      originalText: "测试付款条款"
    };
    const emptyReader = () => ({ findMany: jest.fn().mockResolvedValue([]) });
    const prisma = {
      $queryRaw: jest.fn().mockImplementation(async () => [{ ...takeover }]),
      contract: { findMany: jest.fn().mockImplementation(async () => contracts) },
      contractVersion: {
        findMany: jest.fn().mockImplementation(async () => versions),
        updateMany: jest.fn().mockImplementation(async ({ data }: {
          data: Record<string, unknown>
        }) => {
          Object.assign(historicalVersion, data);
          return { count: 1 };
        })
      },
      contractTakeover: {
        findUnique: jest.fn().mockImplementation(async () => ({ ...takeover })),
        findMany: jest.fn().mockImplementation(async () => [{ ...takeover }]),
        update: jest.fn().mockImplementation(async ({ data }: {
          data: Record<string, unknown>
        }) => {
          Object.assign(takeover, data, { updatedAt: new Date() });
          return { ...takeover };
        }),
        updateMany: jest.fn().mockImplementation(async ({ data }: {
          data: Record<string, unknown>
        }) => {
          Object.assign(takeover, data, { updatedAt: new Date() });
          return { count: 1 };
        })
      },
      paymentTermsVersion: {
        findMany: jest.fn().mockImplementation(async () => [{ ...terms }]),
        updateMany: jest.fn().mockImplementation(async ({ data }: {
          data: Record<string, unknown>
        }) => {
          Object.assign(terms, data);
          return { count: 1 };
        })
      },
      project: {
        findMany: jest.fn().mockResolvedValue([
          { id: "project-regression", name: "历史接管读取回归项目" }
        ])
      },
      approvalInstance: emptyReader(),
      approvalActionLog: emptyReader(),
      contractFormalFile: emptyReader(),
      contractAuthorization: emptyReader(),
      contractVersionAuthorizationLink: emptyReader(),
      contractSealTask: emptyReader(),
      contractArchiveFile: emptyReader(),
      archiveRecord: { ...emptyReader(), count: jest.fn().mockResolvedValue(0) },
      contractTakeoverCorrection: { ...emptyReader(), count: jest.fn().mockResolvedValue(0) },
      settlement: { ...emptyReader(), count: jest.fn().mockResolvedValue(0) },
      paymentRequest: { ...emptyReader(), count: jest.fn().mockResolvedValue(0) }
    };
    const transactionalPrisma = {
      ...prisma,
      $transaction: jest.fn(async (run: (tx: typeof prisma) => Promise<unknown>) => run(prisma))
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const takeoverService = new ContractTakeoverService(
      transactionalPrisma as never, audit as never
    );
    const readService = new ContractReadService(transactionalPrisma as never, {
      effectiveRoleKeysByProject: jest.fn().mockResolvedValue(new Map([
        ["project-regression", ["contract_staff"]]
      ]))
    } as never);

    const submitted = await takeoverService.submitReview(
      "project-regression", "historical-takeover", "contract-handler"
    );
    expect(submitted).toMatchObject({ takeoverStatus: "pending_review", submittedAt: expect.any(Date) });

    await expect(takeoverService.abandonDraft(
      "project-regression", "historical-takeover", {
        action: "abandon_application",
        expectedUpdatedAt: takeover.updatedAt.toISOString(),
        reason: "0"
      }, "contract-handler"
    )).resolves.toMatchObject({ status: "abandoned", action: "abandon_application" });

    const formal = await readService.lifecycleLedger(
      "formal_ledger", 1, 20, ["project-regression"], "contract-handler"
    );
    expect(formal.rows).toEqual([
      expect.objectContaining({ contractVersionId: "formal-version", name: "正式施工合同" })
    ]);
    expect(formal.summary.formal_ledger).toBe(1);

    const workbench = await readService.workbenchLedger(
      "all", 1, 20, ["project-regression"], "contract-handler"
    );
    expect(workbench.rows).toHaveLength(2);
    expect(workbench.rows).toContainEqual(expect.objectContaining({ contractVersionId: "formal-version" }));
    expect(workbench.rows).toContainEqual(expect.objectContaining({
      contractVersionId: "historical-version",
      historicalTakeoverFlow: true,
      takeoverStatus: "abandoned",
      currentNode: "已放弃",
      contractLifecycleStage: "protected_formal",
      lifecycleKind: "formal_record",
      workbenchEditable: false,
      copyAvailable: false,
      contractLifecycleCapabilities: expect.objectContaining({
        canEdit: false,
        canSubmit: false,
        canAbandon: false,
        canPhysicallyDelete: false
      })
    }));
  });
});
