import {
  ConflictException,
  ForbiddenException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { ProjectService } from "./project.service";

const ACTION_ID = "33333333-3333-4333-8333-333333333333";
const CREATED_AT = new Date("2026-08-02T01:00:00.000Z");
const UPDATED_AT = new Date("2026-08-02T02:00:00.000Z");
const TERMINATED_AT = new Date("2026-08-02T03:00:00.000Z");
const SIGNATURE_SHA256 = "a".repeat(64);

function quotaRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "quota-1",
    projectId: "project-1",
    amountCents: 5_000_000n,
    reason: "阶段性垫资保障项目付款",
    validUntil: null,
    attachmentFileId: "file-1",
    attachmentFileSha256Snapshot: "b".repeat(64),
    requestedByUserId: "finance-staff-1",
    requestedByRoleKey: "finance_staff",
    requestIdempotencyKey: "11111111-1111-4111-8111-111111111111",
    requestFingerprint: "c".repeat(64),
    approvedByUserId: "chairman-1",
    approvedAt: CREATED_AT,
    status: "approved",
    terminatedAt: null,
    terminatedByUserId: null,
    terminationReason: null,
    terminationSignatureFileId: null,
    terminationSignatureSha256: null,
    terminationSignatureVersionId: null,
    terminationActionId: null,
    terminationRequestFingerprint: null,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides
  };
}

function approvalRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "approval-1",
    businessId: "quota-1",
    applicantUserId: "finance-staff-1",
    status: "approved",
    currentNodeIndex: 2,
    frozenNodes: [
      {
        name: "财务主管",
        mode: "any",
        roleKeys: ["finance_director"],
        approvedRoleKeys: ["finance_director"]
      },
      {
        name: "董事长/总经理",
        mode: "any",
        roleKeys: ["chairman", "general_manager"],
        approvedRoleKeys: ["chairman"]
      }
    ],
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides
  };
}

function lifecycleToken(
  quota: ReturnType<typeof quotaRow>,
  approval: ReturnType<typeof approvalRow>,
  netUsedAmountCents = 1_250_000n
) {
  const validUntil = quota.validUntil as Date | null;
  return createHash("sha256").update(JSON.stringify({
    quota: {
      id: quota.id,
      projectId: quota.projectId,
      status: quota.status,
      amountCents: quota.amountCents.toString(),
      reason: quota.reason,
      validUntil: validUntil instanceof Date ? validUntil.toISOString() : null,
      attachmentFileId: quota.attachmentFileId,
      attachmentFileSha256Snapshot: quota.attachmentFileSha256Snapshot,
      requestedByUserId: quota.requestedByUserId,
      requestedByRoleKey: quota.requestedByRoleKey,
      updatedAt: quota.updatedAt.toISOString(),
      ...(
        quota.status === "approved" || quota.status === "terminated"
          ? { netUsedAmountCents: netUsedAmountCents.toString() }
          : {}
      )
    },
    approval: {
      id: approval.id,
      businessId: approval.businessId,
      applicantUserId: approval.applicantUserId,
      status: approval.status,
      currentNodeIndex: approval.currentNodeIndex,
      frozenNodes: approval.frozenNodes,
      updatedAt: approval.updatedAt.toISOString()
    }
  })).digest("hex");
}

function requestFingerprint(input: {
  projectId: string;
  quotaId: string;
  actorUserId: string;
  expectedLifecycleToken: string;
  reason: string;
}) {
  return createHash("sha256").update(JSON.stringify({
    actionId: ACTION_ID,
    ...input
  })).digest("hex");
}

function queryText(query: unknown) {
  if (query && typeof query === "object" && "strings" in query) {
    return ((query as { strings: string[] }).strings ?? []).join("?");
  }
  return String(query);
}

type HarnessInput = {
  quota?: ReturnType<typeof quotaRow>;
  approval?: ReturnType<typeof approvalRow>;
  approvals?: Array<ReturnType<typeof approvalRow>>;
  roleKeys?: string[];
  quotaCasCount?: number;
  auditError?: Error;
  signatureVersion?: Record<string, unknown> | null;
  signatureFile?: Record<string, unknown> | null;
  ledgerError?: Error;
  netUsedAmountCents?: bigint;
  quotaUpdateError?: Error;
};

function makeHarness(input: HarnessInput = {}) {
  const quota = input.quota ?? quotaRow();
  const approval = input.approval ?? approvalRow();
  const lockOrder: string[] = [];
  const tx = {
    $queryRaw: jest.fn(async (query: unknown) => {
      const text = queryText(query);
      if (text.includes('FROM "Project"')) {
        lockOrder.push("project");
        return [{ id: "project-1" }];
      }
      if (text.includes('FROM "ProjectFinancingQuota"')) {
        lockOrder.push("quota");
        return [quota];
      }
      if (text.includes('FROM "ApprovalInstance"')) {
        lockOrder.push("approval");
        return input.approvals ?? [approval];
      }
      if (text.includes('FROM "User"')) {
        return [{ id: "finance-director-1", isActive: true }];
      }
      if (text.includes('FROM "HandwrittenSignatureVersion"')) {
        if (input.signatureVersion === null) return [];
        return [input.signatureVersion ?? {
          id: "signature-version-1",
          fileId: "signature-file-1",
          contentSha256: SIGNATURE_SHA256
        }];
      }
      if (text.includes('FROM "FileObject"')) {
        if (input.signatureFile === null) return [];
        return [input.signatureFile ?? {
          id: "signature-file-1",
          contentSha256: SIGNATURE_SHA256,
          storageStatus: "active"
        }];
      }
      throw new Error(`unexpected query: ${text}`);
    }),
    userPosition: { findMany: jest.fn().mockResolvedValue([]) },
    projectMember: {
      findMany: jest.fn().mockResolvedValue(
        (input.roleKeys ?? ["finance_director"]).map((positionKey) => ({ positionKey }))
      )
    },
    position: { findMany: jest.fn().mockResolvedValue([]) },
    projectFinancingQuota: {
      updateMany: jest.fn().mockImplementation(async () => {
        if (input.quotaUpdateError) throw input.quotaUpdateError;
        return { count: input.quotaCasCount ?? 1 };
      })
    }
  };
  const auditRecord = jest.fn().mockImplementation(async () => {
    if (input.auditError) throw input.auditError;
  });
  const funding = {
    lockFundingContext: jest.fn(),
    assertPersistedProjectFundingLedgerCoverage: jest.fn().mockImplementation(async () => {
      if (input.ledgerError) throw input.ledgerError;
      return {
        projectCashSourceAmountCents: 2_000_000n,
        allocationSummary: {
          debitBySource: new Map(),
          creditBySource: new Map(),
          netUsedBySource: new Map([[
            "financing_quota:quota-1",
            input.netUsedAmountCents ?? 1_250_000n
          ]])
        }
      };
    })
  };
  const prisma = {
    $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx))
  };
  const auth = { confirmPassword: jest.fn().mockResolvedValue({ ok: true }) };
  return {
    service: new ProjectService(
      prisma as never,
      { record: auditRecord } as never,
      auth as never,
      funding as never
    ),
    tx,
    prisma,
    auth,
    funding,
    auditRecord,
    quota,
    approval,
    lockOrder
  };
}

function terminationInput(
  quota: ReturnType<typeof quotaRow>,
  approval: ReturnType<typeof approvalRow>,
  overrides: Record<string, unknown> = {}
) {
  return {
    actionId: ACTION_ID,
    expectedLifecycleToken: lifecycleToken(quota, approval),
    reason: "项目已具备自有资金，不再允许新占用",
    confirmationPassword: "current-password",
    ...overrides
  };
}

describe("ProjectService project financing quota termination", () => {
  it.each([
    [{ actionId: "bad", expectedLifecycleToken: "a".repeat(64) }, "项目垫资额度终止 actionId 必须是 UUIDv4"],
    [{ actionId: ACTION_ID, expectedLifecycleToken: "A".repeat(64) }, "项目垫资额度终止生命周期令牌无效"]
  ])("rejects invalid immutable coordinates before opening a transaction", async (coordinates, message) => {
    const prisma = { $transaction: jest.fn() };
    const auth = { confirmPassword: jest.fn() };
    const service = new ProjectService(prisma as never, undefined, auth as never);

    await expect(service.terminateProjectFinancingQuota(
      "project-1",
      "quota-1",
      "finance-director-1",
      {
        ...coordinates,
        reason: "额度终止",
        confirmationPassword: "current-password"
      } as never
    )).rejects.toThrow(message);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(auth.confirmPassword).not.toHaveBeenCalled();
  });

  it("applies termination with fixed locks, transaction password, ledger proof, CAS, signature and exact receipt", async () => {
    const harness = makeHarness();

    await expect(harness.service.terminateProjectFinancingQuota(
      "project-1",
      "quota-1",
      "finance-director-1",
      terminationInput(harness.quota, harness.approval) as never
    )).resolves.toEqual({
      kind: "applied",
      actionId: ACTION_ID,
      projectId: "project-1",
      quotaId: "quota-1"
    });

    expect(harness.prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: "Serializable" }
    );
    expect(harness.lockOrder.slice(0, 3)).toEqual(["project", "quota", "approval"]);
    expect(harness.auth.confirmPassword).toHaveBeenCalledWith(
      "finance-director-1",
      "current-password",
      harness.tx
    );
    expect(harness.funding.lockFundingContext).not.toHaveBeenCalled();
    expect(harness.funding.assertPersistedProjectFundingLedgerCoverage)
      .toHaveBeenCalledWith(harness.tx, "project-1");
    expect(harness.tx.projectFinancingQuota.updateMany).toHaveBeenCalledWith({
      where: {
        id: "quota-1",
        projectId: "project-1",
        status: "approved",
        updatedAt: UPDATED_AT,
        terminatedAt: null,
        terminatedByUserId: null,
        terminationReason: null,
        terminationSignatureFileId: null,
        terminationSignatureSha256: null,
        terminationSignatureVersionId: null,
        terminationActionId: null,
        terminationRequestFingerprint: null
      },
      data: {
        status: "terminated",
        terminatedAt: expect.any(Date),
        terminatedByUserId: "finance-director-1",
        terminationReason: "项目已具备自有资金，不再允许新占用",
        terminationSignatureFileId: "signature-file-1",
        terminationSignatureSha256: SIGNATURE_SHA256,
        terminationSignatureVersionId: "signature-version-1",
        terminationActionId: ACTION_ID,
        terminationRequestFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u)
      }
    });
    expect(harness.auditRecord).toHaveBeenCalledWith(
      harness.tx,
      expect.objectContaining({
        actorUserId: "finance-director-1",
        action: "project.financing_quota.terminate",
        businessType: "project_financing_quota",
        businessId: "quota-1",
        metadata: expect.objectContaining({
          actionId: ACTION_ID,
          approvalInstanceId: "approval-1",
          expectedLifecycleToken: lifecycleToken(harness.quota, harness.approval),
          requestFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
          fromStatus: "approved",
          toStatus: "terminated",
          netUsedAmountCents: "1250000",
          remainingAmountCents: "3750000",
          terminationSignatureFileId: "signature-file-1",
          terminationSignatureSha256: SIGNATURE_SHA256,
          terminationSignatureVersionId: "signature-version-1"
        })
      })
    );
    expect((harness.tx as never as { projectFundingAllocation?: unknown }))
      .not.toHaveProperty("projectFundingAllocation");
  });

  it("preserves the exact confirmation password inside the transaction", async () => {
    const harness = makeHarness();

    await harness.service.terminateProjectFinancingQuota(
      "project-1",
      "quota-1",
      "finance-director-1",
      terminationInput(harness.quota, harness.approval, {
        confirmationPassword: " current-password "
      }) as never
    );

    expect(harness.auth.confirmPassword).toHaveBeenCalledWith(
      "finance-director-1",
      " current-password ",
      harness.tx
    );
  });

  it("enforces the reason Unicode boundary before opening a transaction", async () => {
    const prisma = { $transaction: jest.fn() };
    const service = new ProjectService(
      prisma as never,
      undefined,
      { confirmPassword: jest.fn() } as never
    );

    await expect(service.terminateProjectFinancingQuota(
      "project-1",
      "quota-1",
      "finance-director-1",
      {
        actionId: ACTION_ID,
        expectedLifecycleToken: "a".repeat(64),
        reason: "😀".repeat(501),
        confirmationPassword: "current-password"
      }
    )).rejects.toThrow("项目垫资额度终止原因不能超过 500 个字符");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects an oversized password without rewriting it or opening a transaction", async () => {
    const prisma = { $transaction: jest.fn() };
    const auth = { confirmPassword: jest.fn() };
    const service = new ProjectService(prisma as never, undefined, auth as never);

    await expect(service.terminateProjectFinancingQuota(
      "project-1",
      "quota-1",
      "finance-director-1",
      {
        actionId: ACTION_ID,
        expectedLifecycleToken: "a".repeat(64),
        reason: "额度终止",
        confirmationPassword: "密".repeat(257)
      }
    )).rejects.toThrow("当前登录密码格式不正确");
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(auth.confirmPassword).not.toHaveBeenCalled();
  });

  it("allows only a persisted finance director and fails before writes", async () => {
    const harness = makeHarness({ roleKeys: ["finance_staff"] });

    await expect(harness.service.terminateProjectFinancingQuota(
      "project-1",
      "quota-1",
      "finance-staff-1",
      terminationInput(harness.quota, harness.approval) as never
    )).rejects.toThrow(ForbiddenException);

    expect(harness.tx.projectFinancingQuota.updateMany).not.toHaveBeenCalled();
    expect(harness.auditRecord).not.toHaveBeenCalled();
  });

  it.each([
    ["lifecycle drift", { expectedLifecycleToken: "f".repeat(64) }, {}],
    ["missing approval", {}, { approvals: [] }],
    ["duplicate approval", {}, { approvals: [approvalRow(), approvalRow({ id: "approval-2" })] }],
    ["missing signature", {}, { signatureVersion: null }],
    ["signature SHA drift", {}, { signatureFile: { id: "signature-file-1", contentSha256: "b".repeat(64), storageStatus: "active" } }],
    ["ledger anomaly", {}, { ledgerError: new ConflictException("账本异常") }]
  ])("fails closed with zero writes on %s", async (_label, overrides, harnessInput) => {
    const harness = makeHarness(harnessInput as HarnessInput);

    await expect(harness.service.terminateProjectFinancingQuota(
      "project-1",
      "quota-1",
      "finance-director-1",
      terminationInput(harness.quota, harness.approval, overrides) as never
    )).rejects.toBeDefined();

    expect(harness.tx.projectFinancingQuota.updateMany).not.toHaveBeenCalled();
    expect(harness.auditRecord).not.toHaveBeenCalled();
  });

  it.each([
    ["non-approved state", { status: "rejected" }],
    ["legacy terminated state", {
      status: "terminated",
      terminatedAt: TERMINATED_AT,
      terminatedByUserId: "finance-director-1",
      terminationReason: "历史终止",
      terminationSignatureFileId: "signature-file-1",
      terminationSignatureSha256: SIGNATURE_SHA256,
      terminationSignatureVersionId: "signature-version-1",
      updatedAt: TERMINATED_AT
    }]
  ])("rejects a new actionId on %s with zero writes", async (_label, overrides) => {
    const quota = quotaRow(overrides);
    const harness = makeHarness({ quota });

    await expect(harness.service.terminateProjectFinancingQuota(
      "project-1",
      "quota-1",
      "finance-director-1",
      terminationInput(quotaRow(), harness.approval) as never
    )).rejects.toThrow(ConflictException);
    expect(harness.tx.projectFinancingQuota.updateMany).not.toHaveBeenCalled();
    expect(harness.auditRecord).not.toHaveBeenCalled();
  });

  it.each([
    ["approval applicant drift", {}, { applicantUserId: "other-applicant" }],
    ["approval frozen chain drift", {}, { frozenNodes: [] }],
    ["approved actor fact missing", { approvedByUserId: null }, {}],
    ["approved time fact missing", { approvedAt: null }, {}]
  ])("fails closed on %s", async (_label, quotaOverrides, approvalOverrides) => {
    const quota = quotaRow(quotaOverrides);
    const approval = approvalRow(approvalOverrides);
    const harness = makeHarness({ quota, approval });

    await expect(harness.service.terminateProjectFinancingQuota(
      "project-1",
      "quota-1",
      "finance-director-1",
      terminationInput(quota, approval) as never
    )).rejects.toThrow(ConflictException);
    expect(harness.tx.projectFinancingQuota.updateMany).not.toHaveBeenCalled();
    expect(harness.auditRecord).not.toHaveBeenCalled();
  });

  it("fails closed when quota occupation changes after capability capture", async () => {
    const harness = makeHarness({ netUsedAmountCents: 1_300_000n });

    await expect(harness.service.terminateProjectFinancingQuota(
      "project-1",
      "quota-1",
      "finance-director-1",
      terminationInput(harness.quota, harness.approval) as never
    )).rejects.toThrow("项目垫资额度终止事实已变化，请刷新后重试");
    expect(harness.tx.projectFinancingQuota.updateMany).not.toHaveBeenCalled();
    expect(harness.auditRecord).not.toHaveBeenCalled();
  });

  it("fails closed when the signature helper returns a non-lowercase digest", async () => {
    const harness = makeHarness({
      signatureVersion: {
        id: "signature-version-1",
        fileId: "signature-file-1",
        contentSha256: "A".repeat(64)
      },
      signatureFile: {
        id: "signature-file-1",
        contentSha256: "A".repeat(64),
        storageStatus: "active"
      }
    });

    await expect(harness.service.terminateProjectFinancingQuota(
      "project-1",
      "quota-1",
      "finance-director-1",
      terminationInput(harness.quota, harness.approval) as never
    )).rejects.toBeDefined();
    expect(harness.tx.projectFinancingQuota.updateMany).not.toHaveBeenCalled();
    expect(harness.auditRecord).not.toHaveBeenCalled();
  });

  it("rejects a failed quota CAS before the Audit write", async () => {
    const harness = makeHarness({ quotaCasCount: 0 });

    await expect(harness.service.terminateProjectFinancingQuota(
      "project-1",
      "quota-1",
      "finance-director-1",
      terminationInput(harness.quota, harness.approval) as never
    )).rejects.toThrow(ConflictException);
    expect(harness.auditRecord).not.toHaveBeenCalled();
  });

  it("replays an exact durable quota-owned receipt without a second write", async () => {
    const expectedLifecycleToken = lifecycleToken(quotaRow(), approvalRow());
    const fingerprint = requestFingerprint({
      projectId: "project-1",
      quotaId: "quota-1",
      actorUserId: "finance-director-1",
      expectedLifecycleToken,
      reason: "项目已具备自有资金，不再允许新占用"
    });
    const terminatedQuota = quotaRow({
      status: "terminated",
      terminatedAt: TERMINATED_AT,
      terminatedByUserId: "finance-director-1",
      terminationReason: "项目已具备自有资金，不再允许新占用",
      terminationSignatureFileId: "signature-file-1",
      terminationSignatureSha256: SIGNATURE_SHA256,
      terminationSignatureVersionId: "signature-version-1",
      terminationActionId: ACTION_ID,
      terminationRequestFingerprint: fingerprint,
      updatedAt: TERMINATED_AT
    });
    const harness = makeHarness({
      quota: terminatedQuota
    });

    await expect(harness.service.terminateProjectFinancingQuota(
      "project-1",
      "quota-1",
      "finance-director-1",
      terminationInput(quotaRow(), harness.approval) as never
    )).resolves.toEqual({
      kind: "replayed",
      actionId: ACTION_ID,
      projectId: "project-1",
      quotaId: "quota-1"
    });

    expect(harness.tx.projectFinancingQuota.updateMany).not.toHaveBeenCalled();
    expect(harness.funding.assertPersistedProjectFundingLedgerCoverage).not.toHaveBeenCalled();
    expect(harness.auditRecord).not.toHaveBeenCalled();
  });

  it("rejects actionId payload drift and inconsistent terminated facts without writes", async () => {
    const terminatedQuota = quotaRow({
      status: "terminated",
      terminatedAt: TERMINATED_AT,
      terminatedByUserId: "other-user",
      terminationReason: "其他原因",
      terminationSignatureFileId: "signature-file-1",
      terminationSignatureSha256: SIGNATURE_SHA256,
      terminationSignatureVersionId: "signature-version-1",
      terminationActionId: ACTION_ID,
      terminationRequestFingerprint: "d".repeat(64),
      updatedAt: TERMINATED_AT
    });
    const harness = makeHarness({ quota: terminatedQuota });

    await expect(harness.service.terminateProjectFinancingQuota(
      "project-1",
      "quota-1",
      "finance-director-1",
      terminationInput(quotaRow(), harness.approval) as never
    )).rejects.toThrow(ConflictException);
    expect(harness.tx.projectFinancingQuota.updateMany).not.toHaveBeenCalled();
    expect(harness.auditRecord).not.toHaveBeenCalled();
  });

  it("surfaces Audit failure from the same transaction after quota CAS", async () => {
    const harness = makeHarness({ auditError: new Error("audit failed") });

    await expect(harness.service.terminateProjectFinancingQuota(
      "project-1",
      "quota-1",
      "finance-director-1",
      terminationInput(harness.quota, harness.approval) as never
    )).rejects.toThrow("audit failed");
    expect(harness.tx.projectFinancingQuota.updateMany).toHaveBeenCalledTimes(1);
    expect(harness.auditRecord).toHaveBeenCalledTimes(1);
  });

  it.each(["40001", "40P01"])(
    "maps Prisma raw SQL P2010/%s to the stable concurrency conflict",
    async (sqlState) => {
      const quota = quotaRow();
      const approval = approvalRow();
      const prisma = {
        $transaction: jest.fn().mockRejectedValue({
          code: "P2010",
          meta: { code: sqlState }
        })
      };
      const service = new ProjectService(
        prisma as never,
        undefined,
        { confirmPassword: jest.fn() } as never
      );

      await expect(service.terminateProjectFinancingQuota(
        "project-1",
        "quota-1",
        "finance-director-1",
        terminationInput(quota, approval) as never
      )).rejects.toThrow(
        "项目垫资额度终止发生并发冲突，请刷新后重试"
      );
    }
  );

  it.each(["P2034", "40001", "40P01"])(
    "maps direct %s concurrency errors to the stable conflict",
    async (code) => {
      const quota = quotaRow();
      const approval = approvalRow();
      const service = new ProjectService({
        $transaction: jest.fn().mockRejectedValue({ code })
      } as never, undefined, { confirmPassword: jest.fn() } as never);

      await expect(service.terminateProjectFinancingQuota(
        "project-1",
        "quota-1",
        "finance-director-1",
        terminationInput(quota, approval) as never
      )).rejects.toThrow(
        "项目垫资额度终止发生并发冲突，请刷新后重试"
      );
    }
  );

  it("maps only the termination action unique target and does not swallow other P2002 errors", async () => {
    const actionConflict = new Prisma.PrismaClientKnownRequestError("unique", {
      code: "P2002",
      clientVersion: "test",
      meta: { target: ["terminationActionId"] }
    });
    const actionHarness = makeHarness({ quotaUpdateError: actionConflict });
    await expect(actionHarness.service.terminateProjectFinancingQuota(
      "project-1",
      "quota-1",
      "finance-director-1",
      terminationInput(actionHarness.quota, actionHarness.approval) as never
    )).rejects.toThrow(
      "项目垫资额度终止 actionId 已被其他额度使用"
    );

    const otherConflict = new Prisma.PrismaClientKnownRequestError("unique", {
      code: "P2002",
      clientVersion: "test",
      meta: { target: ["attachmentFileId"] }
    });
    const otherHarness = makeHarness({ quotaUpdateError: otherConflict });
    await expect(otherHarness.service.terminateProjectFinancingQuota(
      "project-1",
      "quota-1",
      "finance-director-1",
      terminationInput(otherHarness.quota, otherHarness.approval) as never
    )).rejects.toBe(otherConflict);
  });
});
