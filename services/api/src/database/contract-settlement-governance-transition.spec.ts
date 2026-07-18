import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

type TransitionItem = {
  kind: "contract_version" | "settlement";
  businessId: string;
  status: string;
  revision: number | null;
  updatedAt: string;
  governanceVersion: null;
  approvalInstance: {
    id: string;
    status: string;
    currentNodeIndex: number;
    applicantUserId?: string;
    updatedAt: string;
  } | null;
  approvalInstanceState?: Array<{ id: string; status: string }>;
  approvalFormClaimState?: Array<{ id: string; status: string }>;
  activeDocumentState: Array<{ id: string; purpose: string; status: string }>;
  archiveState: Array<{ id: string; status: string }>;
  sealTaskState: Array<{ id: string; status: string }>;
  paymentFacts: {
    requestCount: number;
    executionCount: number;
    financeRecordCount: number;
    paidAmountCents: string;
  };
  generationClaimState: Array<{ id: string; status: string }>;
  quotaUsageState: Array<{ id: string; status: string }>;
  settlementLineState?: Array<{ id: string; stateDigest: string }>;
  existingDraftState?: Array<{ id: string; status: string }>;
  replacementDraftOwnerState?: {
    userId: string;
    isActive: boolean;
    hasSettlementCreate: boolean;
    stateDigest: string;
  } | null;
  blockers?: string[];
  suggestedAction: string;
};

type TransitionModule = {
  APPLY_CONFIRMATION: string;
  parseArgs(argv: string[]): Record<string, unknown>;
  createManifest(
    items: TransitionItem[],
    candidateSha: string,
    generatedAt: Date,
    options?: { includes?: string[] }
  ): Record<string, unknown>;
  verifyManifestIntegrity(manifest: Record<string, unknown>): void;
  assertApplyGates(input: {
    args: Record<string, unknown>;
    manifest: Record<string, unknown>;
    currentSha: string;
    checkoutClean?: boolean;
  }): void;
  previewManifest(input: {
    prisma: { $transaction: (callback: (tx: unknown) => Promise<unknown>) => Promise<unknown> };
    candidateSha: string;
    now: Date;
    createStore: (tx: unknown) => { loadPreviewItems: () => Promise<TransitionItem[]> };
  }): Promise<Record<string, unknown>>;
  executeTransition(input: {
    store: {
      lockAndLoad: (items: TransitionItem[]) => Promise<TransitionItem[]>;
      findProcessedIdentities: (digest: string, items: TransitionItem[]) => Promise<string[]>;
      applyContract: (item: TransitionItem, context: Record<string, unknown>) => Promise<void>;
      applySettlement: (item: TransitionItem, context: Record<string, unknown>) => Promise<void>;
    };
    manifest: Record<string, unknown>;
    operatorUserId: string;
    now: Date;
  }): Promise<Record<string, unknown>>;
  createSqlStore(tx: {
    $queryRawUnsafe: jest.Mock;
    $executeRawUnsafe: jest.Mock;
  }): { assertActiveOperator: (operatorUserId: string) => Promise<void> };
  resolveApprovalSelection(
    approvals: Array<{ id: string; status: string }>,
    businessStatus: string
  ): { approval: { id: string; status: string } | null; blockers: string[] };
  resolveReplacementOwnerAccess(input: {
    owner: { isActive: boolean } | null;
    positions: Array<{ projectId: string | null }>;
    memberships: Array<{ projectId: string }>;
    projectId: string;
  }): { hasSettlementCreate: boolean };
};

const scriptPath = resolve(
  __dirname,
  "../../prisma/transition-contract-settlement-governance.cjs"
);
const requireFromHere = createRequire(__filename);

function loadModule(): TransitionModule {
  return requireFromHere(scriptPath) as TransitionModule;
}

function item(overrides: Partial<TransitionItem> = {}): TransitionItem {
  return {
    kind: "contract_version",
    businessId: "00000000-0000-4000-8000-000000000001",
    status: "in_approval",
    revision: 3,
    updatedAt: "2026-07-18T00:00:00.000Z",
    governanceVersion: null,
    approvalInstance: {
      id: "00000000-0000-4000-8000-000000000011",
      status: "in_progress",
      currentNodeIndex: 1,
      applicantUserId: "00000000-0000-4000-8000-000000000091",
      updatedAt: "2026-07-18T00:00:00.000Z"
    },
    approvalInstanceState: [],
    approvalFormClaimState: [],
    activeDocumentState: [
      { id: "00000000-0000-4000-8000-000000000021", purpose: "counterparty_signed", status: "active" }
    ],
    archiveState: [],
    sealTaskState: [],
    paymentFacts: {
      requestCount: 0,
      executionCount: 0,
      financeRecordCount: 0,
      paidAmountCents: "0"
    },
    generationClaimState: [],
    quotaUsageState: [],
    settlementLineState: [],
    existingDraftState: [],
    suggestedAction: "终止旧审批并退回合同草稿补充治理资料后重提",
    ...overrides
  };
}

describe("contract-settlement governance transition tool", () => {
  it("defaults to preview and requires all four apply gates", () => {
    const tool = loadModule();
    expect(tool.parseArgs([])).toMatchObject({ apply: false, includes: [] });
    expect(tool.parseArgs([
      "--include", "contract_version:version-1",
      "--include=settlement:settlement-1"
    ])).toMatchObject({
      apply: false,
      includes: ["contract_version:version-1", "settlement:settlement-1"]
    });

    const candidateSha = "a".repeat(40);
    const manifest = tool.createManifest([item()], candidateSha, new Date("2026-07-18T01:00:00Z"));
    const completeArgs = {
      apply: true,
      candidateSha,
      confirmation: tool.APPLY_CONFIRMATION,
      operatorUserId: "00000000-0000-4000-8000-000000000099",
      manifestPath: "/tmp/manifest.json"
    };

    expect(() => tool.assertApplyGates({
      args: completeArgs,
      manifest,
      currentSha: candidateSha,
      checkoutClean: true
    })).not.toThrow();
    for (const missing of ["candidateSha", "confirmation", "operatorUserId", "manifestPath"]) {
      expect(() => tool.assertApplyGates({
        args: { ...completeArgs, [missing]: undefined },
        manifest,
        currentSha: candidateSha,
        checkoutClean: true
      })).toThrow();
    }
    expect(() => tool.assertApplyGates({
      args: { ...completeArgs, candidateSha: "b".repeat(40) },
      manifest,
      currentSha: candidateSha,
      checkoutClean: true
    })).toThrow(/SHA/);
    expect(() => tool.assertApplyGates({
      args: completeArgs,
      manifest,
      currentSha: candidateSha,
      checkoutClean: false
    })).toThrow(/工作区/);
  });

  it("rejects a modified manifest before apply", () => {
    const tool = loadModule();
    const manifest = tool.createManifest([item()], "a".repeat(40), new Date("2026-07-18T01:00:00Z"));
    const changed = structuredClone(manifest) as { items: TransitionItem[] } & Record<string, unknown>;
    changed.items[0].status = "in_seal";
    expect(() => tool.verifyManifestIntegrity(changed)).toThrow(/manifest/i);
  });

  it("separates blocked rows and binds an explicit safe selection into the manifest digest", () => {
    const tool = loadModule();
    const safeContract = item();
    const safeSettlement = item({
      kind: "settlement",
      businessId: "00000000-0000-4000-8000-000000000002",
      status: "approval_pending",
      revision: null
    });
    const blocked = item({
      businessId: "00000000-0000-4000-8000-000000000003",
      blockers: ["已存在付款事实"]
    } as Partial<TransitionItem>);
    const explicitIdentity = `settlement:${safeSettlement.businessId}`;
    const manifest = tool.createManifest(
      [safeContract, safeSettlement, blocked],
      "a".repeat(40),
      new Date("2026-07-18T01:00:00Z"),
      { includes: [explicitIdentity] }
    ) as {
      items: TransitionItem[];
      blockedItems: TransitionItem[];
      selection: { mode: string; includes: string[] };
      digest: string;
    };

    expect(manifest.items.map((entry) => `${entry.kind}:${entry.businessId}`)).toEqual([
      explicitIdentity
    ]);
    expect(manifest.blockedItems).toHaveLength(1);
    expect(manifest.selection).toEqual({ mode: "explicit", includes: [explicitIdentity] });

    const allSafe = tool.createManifest(
      [safeContract, safeSettlement, blocked],
      "a".repeat(40),
      new Date("2026-07-18T01:00:00Z")
    ) as { items: TransitionItem[]; digest: string };
    expect(allSafe.items).toHaveLength(2);
    expect(allSafe.digest).not.toBe(manifest.digest);
    expect(() => tool.createManifest(
      [safeContract, safeSettlement, blocked],
      "a".repeat(40),
      new Date("2026-07-18T01:00:00Z"),
      { includes: [`contract_version:${blocked.businessId}`] }
    )).toThrow(/阻断/);
  });

  it("runs preview inside an explicit read-only transaction", async () => {
    const tool = loadModule();
    const tx = { $executeRawUnsafe: jest.fn().mockResolvedValue(0) };
    const prisma = {
      $transaction: jest.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx))
    };
    const loadPreviewItems = jest.fn().mockResolvedValue([item()]);

    const manifest = await tool.previewManifest({
      prisma,
      candidateSha: "a".repeat(40),
      now: new Date("2026-07-18T01:00:00Z"),
      createStore: () => ({ loadPreviewItems })
    });

    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith("SET TRANSACTION READ ONLY");
    expect(loadPreviewItems).toHaveBeenCalledTimes(1);
    expect(manifest).toMatchObject({ mode: "preview", itemCount: 1 });
  });

  it("allows apply only for an active global super administrator", async () => {
    const tool = loadModule();
    const tx = {
      $queryRawUnsafe: jest.fn()
        .mockResolvedValueOnce([{ id: "00000000-0000-4000-8000-000000000099" }])
        .mockResolvedValueOnce([]),
      $executeRawUnsafe: jest.fn()
    };
    await expect(
      tool.createSqlStore(tx).assertActiveOperator("00000000-0000-4000-8000-000000000099")
    ).rejects.toThrow(/全局超级管理员/);
  });

  it("blocks any extra active approval even when the expected approved instance is unique", () => {
    const tool = loadModule();
    expect(tool.resolveApprovalSelection(
      [{ id: "approved", status: "approved" }, { id: "unexpected-active", status: "in_progress" }],
      "approved_pending_archive"
    )).toMatchObject({
      approval: { id: "approved" },
      blockers: [expect.stringMatching(/活动审批实例/)]
    });
    expect(tool.resolveApprovalSelection(
      [{ id: "current", status: "in_progress" }, { id: "historical", status: "rejected" }],
      "approval_pending"
    )).toMatchObject({ approval: { id: "current" }, blockers: [] });
  });

  it("matches settlement.create owner access for global and project-scoped contract staff", () => {
    const tool = loadModule();
    const input = { owner: { isActive: true }, projectId: "project-a" };
    expect(tool.resolveReplacementOwnerAccess({
      ...input,
      positions: [{ projectId: null }],
      memberships: []
    }).hasSettlementCreate).toBe(true);
    expect(tool.resolveReplacementOwnerAccess({
      ...input,
      positions: [{ projectId: "project-a" }],
      memberships: []
    }).hasSettlementCreate).toBe(true);
    expect(tool.resolveReplacementOwnerAccess({
      ...input,
      positions: [],
      memberships: [{ projectId: "project-a" }]
    }).hasSettlementCreate).toBe(true);
    expect(tool.resolveReplacementOwnerAccess({
      ...input,
      positions: [{ projectId: "project-b" }],
      memberships: []
    }).hasSettlementCreate).toBe(false);
    expect(tool.resolveReplacementOwnerAccess({
      owner: { isActive: false },
      projectId: "project-a",
      positions: [{ projectId: null }],
      memberships: []
    }).hasSettlementCreate).toBe(false);
  });

  it("checks every snapshot before writing and leaves the batch untouched on drift", async () => {
    const tool = loadModule();
    const original = item();
    const manifest = tool.createManifest([original], "a".repeat(40), new Date("2026-07-18T01:00:00Z"));
    const applyContract = jest.fn();
    const applySettlement = jest.fn();

    await expect(tool.executeTransition({
      store: {
        lockAndLoad: jest.fn().mockResolvedValue([{ ...original, status: "in_seal" }]),
        findProcessedIdentities: jest.fn().mockResolvedValue([]),
        applyContract,
        applySettlement
      },
      manifest,
      operatorUserId: "00000000-0000-4000-8000-000000000099",
      now: new Date("2026-07-18T02:00:00Z")
    })).rejects.toThrow(/漂移/);

    expect(applyContract).not.toHaveBeenCalled();
    expect(applySettlement).not.toHaveBeenCalled();
  });

  it("transitions exact contract and settlement rows once and is idempotent", async () => {
    const tool = loadModule();
    const contract = item();
    const settlement = item({
      kind: "settlement",
      businessId: "00000000-0000-4000-8000-000000000002",
      status: "approval_pending",
      revision: null,
      suggestedAction: "终止旧审批并退回结算补充治理资料后重提"
    });
    const manifest = tool.createManifest([contract, settlement], "a".repeat(40), new Date("2026-07-18T01:00:00Z"));
    const applyContract = jest.fn().mockResolvedValue(undefined);
    const applySettlement = jest.fn().mockResolvedValue(undefined);
    const store = {
      lockAndLoad: jest.fn().mockResolvedValue([contract, settlement]),
      findProcessedIdentities: jest.fn().mockResolvedValue([]),
      applyContract,
      applySettlement
    };

    await expect(tool.executeTransition({
      store,
      manifest,
      operatorUserId: "00000000-0000-4000-8000-000000000099",
      now: new Date("2026-07-18T02:00:00Z")
    })).resolves.toMatchObject({ applied: 2, alreadyProcessed: 0 });
    expect(applyContract).toHaveBeenCalledTimes(1);
    expect(applySettlement).toHaveBeenCalledTimes(1);

    store.findProcessedIdentities.mockResolvedValue([
      `contract_version:${contract.businessId}`,
      `settlement:${settlement.businessId}`
    ]);
    applyContract.mockClear();
    applySettlement.mockClear();
    await expect(tool.executeTransition({
      store,
      manifest,
      operatorUserId: "00000000-0000-4000-8000-000000000099",
      now: new Date("2026-07-18T03:00:00Z")
    })).resolves.toMatchObject({ applied: 0, alreadyProcessed: 2 });
    expect(applyContract).not.toHaveBeenCalled();
    expect(applySettlement).not.toHaveBeenCalled();
  });

  it.each([
    [{ requestCount: 1, executionCount: 0, financeRecordCount: 0, paidAmountCents: "0" }, "付款申请"],
    [{ requestCount: 0, executionCount: 1, financeRecordCount: 0, paidAmountCents: "0" }, "实付"],
    [{ requestCount: 0, executionCount: 0, financeRecordCount: 1, paidAmountCents: "0" }, "入账"],
    [{ requestCount: 0, executionCount: 0, financeRecordCount: 0, paidAmountCents: "1" }, "已付金额"]
  ])("refuses any candidate carrying %s facts (%s)", async (paymentFacts) => {
    const tool = loadModule();
    const unsafe = item({ paymentFacts });
    const manifest = tool.createManifest([unsafe], "a".repeat(40), new Date("2026-07-18T01:00:00Z"));
    const applyContract = jest.fn();

    await expect(tool.executeTransition({
      store: {
        lockAndLoad: jest.fn().mockResolvedValue([unsafe]),
        findProcessedIdentities: jest.fn().mockResolvedValue([]),
        applyContract,
        applySettlement: jest.fn()
      },
      manifest,
      operatorUserId: "00000000-0000-4000-8000-000000000099",
      now: new Date("2026-07-18T02:00:00Z")
    })).rejects.toThrow(/付款/);
    expect(applyContract).not.toHaveBeenCalled();
  });

  it("keeps SQL scoped to governed records and never mutates payment tables or file objects", () => {
    const source = readFileSync(scriptPath, "utf8");
    expect(source).not.toContain('"objectKey"');
    expect(source).toMatch(/SET TRANSACTION READ ONLY/);
    expect(source).toMatch(/ORDER BY "id" FOR UPDATE/);
    expect(source).toMatch(/governance\.transition\.terminated/);
    expect(source).toMatch(/ApprovalActionLog/);
    expect(source).toMatch(/AuditLog/);
    expect(source).toMatch(/ContractFormalFile/);
    expect(source).toMatch(/SettlementSignedDocument/);
    expect(source).toMatch(/UPDATE "Settlement" SET "status" = 'withdrawn'/);
    expect(source).toMatch(/"contractGovernanceVersion" = 1/);
    expect(source).toMatch(/UPDATE "ApprovalFormGenerationClaim" SET "status" = 'failed'/);
    expect(source).toMatch(/"safeFailureCode" = 'finalize_retry_required'/);
    expect(source).toMatch(/INSERT INTO\s+"SettlementDraft"/i);
    expect(source).toMatch(/"governanceVersion"[\s\S]*VALUES[\s\S]*1/);
    expect(source).toMatch(/up\."projectId" IS NULL AND p\."key" = 'super_admin'/);
    expect(source).toMatch(/expectedApprovals\.length !== 1/);
    expect(source).toMatch(/unexpectedActiveApprovals/);
    expect(source).toMatch(/除选中当前审批外仍存在活动审批实例/);
    expect(source).toMatch(/replacementDraftOwnerState/);
    expect(source).toMatch(/p\."key" = 'contract_staff'/);
    expect(source).toMatch(/"positionKey" = 'contract_staff'/);
    expect(source).toMatch(/原申请人当前不具备该项目的结算编制权限/);
    expect(source).toMatch(/row\.id === item\.approvalInstance\?\.id/);
    expect(source).toMatch(/processedCounts/);
    expect(source).toMatch(/processedIdDigests/);
    expect(source).toMatch(/sourceSettlementId: item\.businessId/);
    expect(source).toMatch(/governance\.transition\.replacement_draft_created/);
    expect(source).toMatch(/settlementReplacements/);
    expect(source).not.toMatch(/(?:UPDATE|DELETE FROM|INSERT INTO)\s+"(?:PaymentRequest|PaymentExecution|PaymentExecutionAllocation|FinanceRecord)"/i);
    expect(source).not.toMatch(/(?:UPDATE|DELETE FROM)\s+"FileObject"/i);
    expect(source).not.toMatch(/DELETE FROM\s+"(?:ApprovalActionLog|AuditLog)"/i);
  });
});
