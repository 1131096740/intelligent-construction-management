import { ConflictException, ForbiddenException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { ProjectService } from "./project.service";

const ACTION_ID = "22222222-2222-4222-8222-222222222222";
const CREATED_AT = new Date("2026-08-02T01:00:00.000Z");
const UPDATED_AT = new Date("2026-08-02T02:00:00.000Z");
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
    approvedByUserId: null,
    approvedAt: null,
    status: "approval_pending",
    terminatedAt: null,
    terminatedByUserId: null,
    terminationReason: null,
    terminationSignatureFileId: null,
    terminationSignatureSha256: null,
    terminationSignatureVersionId: null,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides
  };
}

function approvalRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "approval-1",
    flowType: "project_financing_quota.approve",
    businessType: "project_financing_quota",
    businessId: "quota-1",
    applicantUserId: "finance-staff-1",
    status: "in_progress",
    currentNodeIndex: 0,
    frozenNodes: [
      { name: "财务主管", mode: "any", roleKeys: ["finance_director"] },
      { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
    ],
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides
  };
}

function lifecycleToken(
  quota: ReturnType<typeof quotaRow>,
  approval: ReturnType<typeof approvalRow>
) {
  const validUntil = quota.validUntil as Date | null;
  return createHash("sha256").update(JSON.stringify({
    quota: {
      id: quota.id,
      projectId: quota.projectId,
      status: quota.status,
      amountCents: quota.amountCents.toString(),
      reason: quota.reason,
      validUntil: validUntil instanceof Date
        ? validUntil.toISOString()
        : null,
      attachmentFileId: quota.attachmentFileId,
      attachmentFileSha256Snapshot: quota.attachmentFileSha256Snapshot,
      requestedByUserId: quota.requestedByUserId,
      requestedByRoleKey: quota.requestedByRoleKey,
      updatedAt: quota.updatedAt.toISOString()
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

function queryText(query: unknown) {
  if (query && typeof query === "object" && "strings" in query) {
    return ((query as { strings: string[] }).strings ?? []).join("?");
  }
  return String(query);
}

function makeHarness(input: {
  quota?: ReturnType<typeof quotaRow>;
  approval?: ReturnType<typeof approvalRow>;
  roleKeys?: string[];
  existingAction?: Record<string, unknown> | null;
  quotaCasCount?: number;
  approvalCasCount?: number;
  auditError?: Error;
  signatureVersion?: Record<string, unknown> | null;
  signatureFile?: Record<string, unknown> | null;
  actionCreateError?: Error;
} = {}) {
  const quota = input.quota ?? quotaRow();
  const approval = input.approval ?? approvalRow();
  const createdAction: Record<string, unknown>[] = [];
  const tx = {
    $queryRaw: jest.fn(async (query: unknown) => {
      const text = queryText(query);
      if (text.includes('FROM "Project"')) return [{ id: "project-1" }];
      if (text.includes('FROM "ProjectFinancingQuota"')) return [quota];
      if (text.includes('FROM "ApprovalInstance"')) return [approval];
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
    user: { findUnique: jest.fn().mockResolvedValue({ id: "finance-director-1" }) },
    userPosition: { findMany: jest.fn().mockResolvedValue([]) },
    projectMember: {
      findMany: jest.fn().mockResolvedValue(
        (input.roleKeys ?? ["finance_director"]).map((positionKey) => ({ positionKey }))
      )
    },
    position: { findMany: jest.fn().mockResolvedValue([]) },
    projectFinancingQuota: {
      updateMany: jest.fn().mockResolvedValue({ count: input.quotaCasCount ?? 1 })
    },
    approvalInstance: {
      updateMany: jest.fn().mockResolvedValue({ count: input.approvalCasCount ?? 1 })
    },
    approvalActionLog: {
      findUnique: jest.fn().mockResolvedValue(input.existingAction ?? null),
      create: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        if (input.actionCreateError) throw input.actionCreateError;
        createdAction.push(data);
        return data;
      })
    }
  };
  const auditRecord = jest.fn().mockImplementation(async () => {
    if (input.auditError) throw input.auditError;
  });
  const prisma = {
    $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx))
  };
  const auth = { confirmPassword: jest.fn().mockResolvedValue({ ok: true }) };
  return {
    service: new ProjectService(
      prisma as never,
      { record: auditRecord } as never,
      auth as never
    ),
    tx,
    prisma,
    auth,
    auditRecord,
    quota,
    approval,
    createdAction
  };
}

function reviewInput(
  quota: ReturnType<typeof quotaRow>,
  approval: ReturnType<typeof approvalRow>,
  overrides: Record<string, unknown> = {}
) {
  return {
    actionId: ACTION_ID,
    expectedLifecycleToken: lifecycleToken(quota, approval),
    decision: "approve",
    confirmationPassword: "current-password",
    comment: "同意",
    ...overrides
  };
}

describe("ProjectService project financing quota review", () => {
  it.each([
    [{ actionId: "bad", expectedLifecycleToken: "a".repeat(64) }, "项目垫资额度审批 actionId 必须是 UUIDv4"],
    [{ actionId: ACTION_ID, expectedLifecycleToken: "A".repeat(64) }, "项目垫资额度审批生命周期令牌无效"]
  ])("rejects invalid immutable review coordinates before opening a transaction", async (coordinates, message) => {
    const prisma = { $transaction: jest.fn() };
    const auth = { confirmPassword: jest.fn() };
    const service = new ProjectService(prisma as never, undefined, auth as never);

    await expect(service.reviewProjectFinancingQuota(
      "project-1",
      "quota-1",
      "finance-director-1",
      {
        ...coordinates,
        decision: "approve",
        confirmationPassword: "current-password"
      } as never
    )).rejects.toThrow(message);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(auth.confirmPassword).not.toHaveBeenCalled();
  });

  it("applies a supervisor approval with fixed locks, transaction password, CAS, signature and minimal receipt", async () => {
    const harness = makeHarness();

    await expect(harness.service.reviewProjectFinancingQuota(
      "project-1",
      "quota-1",
      "finance-director-1",
      reviewInput(harness.quota, harness.approval) as never
    )).resolves.toEqual({
      kind: "applied",
      actionId: ACTION_ID,
      projectId: "project-1",
      quotaId: "quota-1"
    });

    expect(harness.auth.confirmPassword).toHaveBeenCalledWith(
      "finance-director-1",
      "current-password",
      harness.tx
    );
    expect(harness.prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: "Serializable" }
    );
    const lockQueries = harness.tx.$queryRaw.mock.calls
      .map(([query]) => queryText(query))
      .filter((text) => text.includes("FOR UPDATE"));
    expect(lockQueries.slice(0, 3)).toEqual([
      expect.stringContaining('FROM "Project"'),
      expect.stringContaining('FROM "ProjectFinancingQuota"'),
      expect.stringContaining('FROM "ApprovalInstance"')
    ]);
    expect(harness.tx.projectFinancingQuota.updateMany).toHaveBeenCalledWith({
      where: {
        id: "quota-1",
        projectId: "project-1",
        status: "approval_pending",
        updatedAt: UPDATED_AT
      },
      data: { status: "approval_pending" }
    });
    expect(harness.tx.approvalInstance.updateMany).toHaveBeenCalledWith({
      where: {
        id: "approval-1",
        status: "in_progress",
        currentNodeIndex: 0,
        updatedAt: UPDATED_AT
      },
      data: expect.objectContaining({ currentNodeIndex: 1, status: "in_progress" })
    });
    expect(harness.tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: ACTION_ID,
        action: "approve",
        signatureFileIdSnapshot: "signature-file-1",
        signatureSha256Snapshot: SIGNATURE_SHA256,
        signatureVersionIdSnapshot: "signature-version-1",
        metadata: expect.objectContaining({
          actionId: ACTION_ID,
          expectedLifecycleToken: lifecycleToken(harness.quota, harness.approval),
          requestFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u)
        })
      })
    });
    expect(harness.auditRecord).toHaveBeenCalledTimes(1);
  });

  it("preserves the exact confirmation password inside the transaction", async () => {
    const harness = makeHarness();

    await harness.service.reviewProjectFinancingQuota(
      "project-1",
      "quota-1",
      "finance-director-1",
      reviewInput(harness.quota, harness.approval, {
        confirmationPassword: " current-password "
      }) as never
    );

    expect(harness.auth.confirmPassword).toHaveBeenCalledWith(
      "finance-director-1",
      " current-password ",
      harness.tx
    );
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

      await expect(service.reviewProjectFinancingQuota(
        "project-1",
        "quota-1",
        "finance-director-1",
        reviewInput(quota, approval) as never
      )).rejects.toThrow(
        "项目垫资额度审批发生并发冲突，请刷新后重试"
      );
    }
  );

  it.each([
    ["comment", "审批意见不能超过 500 个字符"],
    ["selfReviewReason", "自审原因不能超过 500 个字符"]
  ])(
    "rejects an oversized %s before opening a transaction",
    async (field, message) => {
      const quota = quotaRow();
      const approval = approvalRow();
      const prisma = { $transaction: jest.fn() };
      const service = new ProjectService(
        prisma as never,
        undefined,
        { confirmPassword: jest.fn() } as never
      );

      await expect(service.reviewProjectFinancingQuota(
        "project-1",
        "quota-1",
        "finance-director-1",
        reviewInput(quota, approval, { [field]: "字".repeat(501) }) as never
      )).rejects.toThrow(message);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    }
  );

  it("fails closed with zero log and audit writes when the lifecycle token drifts", async () => {
    const harness = makeHarness();

    await expect(harness.service.reviewProjectFinancingQuota(
      "project-1",
      "quota-1",
      "finance-director-1",
      reviewInput(harness.quota, harness.approval, {
        expectedLifecycleToken: "f".repeat(64)
      }) as never
    )).rejects.toThrow(ConflictException);

    expect(harness.tx.projectFinancingQuota.updateMany).not.toHaveBeenCalled();
    expect(harness.tx.approvalInstance.updateMany).not.toHaveBeenCalled();
    expect(harness.tx.approvalActionLog.create).not.toHaveBeenCalled();
    expect(harness.auditRecord).not.toHaveBeenCalled();
  });

  it("replays the exact actionId with zero additional mutation and rejects payload drift", async () => {
    const first = makeHarness();
    const input = reviewInput(first.quota, first.approval);
    await first.service.reviewProjectFinancingQuota(
      "project-1",
      "quota-1",
      "finance-director-1",
      input as never
    );
    const storedAction = first.createdAction[0]!;

    const replay = makeHarness({ existingAction: storedAction });
    await expect(replay.service.reviewProjectFinancingQuota(
      "project-1",
      "quota-1",
      "finance-director-1",
      input as never
    )).resolves.toEqual({
      kind: "replayed",
      actionId: ACTION_ID,
      projectId: "project-1",
      quotaId: "quota-1"
    });
    expect(replay.tx.projectFinancingQuota.updateMany).not.toHaveBeenCalled();
    expect(replay.tx.approvalInstance.updateMany).not.toHaveBeenCalled();
    expect(replay.tx.approvalActionLog.create).not.toHaveBeenCalled();
    expect(replay.auditRecord).not.toHaveBeenCalled();

    const terminalQuota = quotaRow({
      status: "approved",
      approvedByUserId: "chairman-1",
      approvedAt: new Date("2026-08-02T03:00:00.000Z"),
      updatedAt: new Date("2026-08-02T03:00:00.000Z")
    });
    const terminalApproval = approvalRow({
      status: "approved",
      currentNodeIndex: 2,
      updatedAt: new Date("2026-08-02T03:00:00.000Z")
    });
    const terminalReplay = makeHarness({
      quota: terminalQuota,
      approval: terminalApproval,
      existingAction: storedAction
    });
    await expect(terminalReplay.service.reviewProjectFinancingQuota(
      "project-1",
      "quota-1",
      "finance-director-1",
      input as never
    )).resolves.toEqual({
      kind: "replayed",
      actionId: ACTION_ID,
      projectId: "project-1",
      quotaId: "quota-1"
    });
    expect(terminalReplay.tx.projectFinancingQuota.updateMany).not.toHaveBeenCalled();
    expect(terminalReplay.tx.approvalInstance.updateMany).not.toHaveBeenCalled();
    expect(terminalReplay.auditRecord).not.toHaveBeenCalled();

    const drift = makeHarness({ existingAction: storedAction });
    await expect(drift.service.reviewProjectFinancingQuota(
      "project-1",
      "quota-1",
      "finance-director-1",
      reviewInput(drift.quota, drift.approval, { comment: "改为驳回依据" }) as never
    )).rejects.toThrow("actionId 与已有审批事实不一致");
    expect(drift.tx.projectFinancingQuota.updateMany).not.toHaveBeenCalled();
    expect(drift.tx.approvalInstance.updateMany).not.toHaveBeenCalled();
    expect(drift.tx.approvalActionLog.create).not.toHaveBeenCalled();
    expect(drift.auditRecord).not.toHaveBeenCalled();
  });

  it.each(["finance_staff", null])(
    "does not grant applicant self-review when the frozen requester role is %p",
    async (requestedByRoleKey) => {
      const quota = quotaRow({
        requestedByUserId: "finance-director-1",
        requestedByRoleKey
      });
      const approval = approvalRow({ applicantUserId: "finance-director-1" });
      const harness = makeHarness({ quota, approval });

      await expect(harness.service.reviewProjectFinancingQuota(
        "project-1",
        "quota-1",
        "finance-director-1",
        reviewInput(quota, approval, {
          selfReviewReason: "本人独立复核"
        }) as never
      )).rejects.toThrow(ForbiddenException);

      expect(harness.tx.approvalActionLog.create).not.toHaveBeenCalled();
      expect(harness.auditRecord).not.toHaveBeenCalled();
    }
  );

  it("rolls back the action path when a CAS or Audit step fails", async () => {
    const quotaCasHarness = makeHarness({ quotaCasCount: 0 });
    await expect(quotaCasHarness.service.reviewProjectFinancingQuota(
      "project-1",
      "quota-1",
      "finance-director-1",
      reviewInput(quotaCasHarness.quota, quotaCasHarness.approval) as never
    )).rejects.toThrow(ConflictException);
    expect(quotaCasHarness.tx.approvalInstance.updateMany).not.toHaveBeenCalled();
    expect(quotaCasHarness.tx.approvalActionLog.create).not.toHaveBeenCalled();
    expect(quotaCasHarness.auditRecord).not.toHaveBeenCalled();

    const casHarness = makeHarness({ approvalCasCount: 0 });
    await expect(casHarness.service.reviewProjectFinancingQuota(
      "project-1",
      "quota-1",
      "finance-director-1",
      reviewInput(casHarness.quota, casHarness.approval) as never
    )).rejects.toThrow(ConflictException);
    expect(casHarness.tx.approvalActionLog.create).not.toHaveBeenCalled();
    expect(casHarness.auditRecord).not.toHaveBeenCalled();

    const auditError = new Error("audit unavailable");
    const auditHarness = makeHarness({ auditError });
    await expect(auditHarness.service.reviewProjectFinancingQuota(
      "project-1",
      "quota-1",
      "finance-director-1",
      reviewInput(auditHarness.quota, auditHarness.approval) as never
    )).rejects.toBe(auditError);
    expect(auditHarness.tx.approvalActionLog.create).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      "missing signature",
      { signatureVersion: null },
      "审批手写签名未配置"
    ],
    [
      "signature SHA drift",
      {
        signatureFile: {
          id: "signature-file-1",
          contentSha256: "b".repeat(64),
          storageStatus: "active"
        }
      },
      "审批手写签名版本校验失败"
    ]
  ])(
    "fails closed on %s before state, log or audit writes",
    async (_caseName, harnessInput, message) => {
      const harness = makeHarness(harnessInput);

      await expect(harness.service.reviewProjectFinancingQuota(
        "project-1",
        "quota-1",
        "finance-director-1",
        reviewInput(harness.quota, harness.approval) as never
      )).rejects.toThrow(message);
      expect(harness.tx.projectFinancingQuota.updateMany).not.toHaveBeenCalled();
      expect(harness.tx.approvalInstance.updateMany).not.toHaveBeenCalled();
      expect(harness.tx.approvalActionLog.create).not.toHaveBeenCalled();
      expect(harness.auditRecord).not.toHaveBeenCalled();
    }
  );

  it("maps an ActionLog primary-key winner to a stable actionId conflict", async () => {
    const harness = makeHarness({
      actionCreateError: new Prisma.PrismaClientKnownRequestError("unique", {
        code: "P2002",
        clientVersion: "test",
        meta: { target: ["id"] }
      })
    });

    await expect(harness.service.reviewProjectFinancingQuota(
      "project-1",
      "quota-1",
      "finance-director-1",
      reviewInput(harness.quota, harness.approval) as never
    )).rejects.toThrow(
      "项目垫资额度审批 actionId 已被其他请求使用"
    );
    expect(harness.tx.approvalActionLog.create).toHaveBeenCalledTimes(1);
    expect(harness.auditRecord).not.toHaveBeenCalled();
  });
});
