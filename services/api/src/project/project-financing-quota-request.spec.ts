import {
  BadRequestException,
  ConflictException,
  NotFoundException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { ProjectService } from "./project.service";

const IDEMPOTENCY_KEY = "11111111-1111-4111-8111-111111111111";
const FILE_SHA256 = "a".repeat(64);
const CREATED_AT = new Date("2026-08-02T01:00:00.000Z");

type RequestInput = {
  amountCents: string;
  reason: string;
  validUntil?: string;
  attachmentFileId: string;
  idempotencyKey: string;
};

function requestInput(overrides: Partial<RequestInput> = {}): RequestInput {
  return {
    amountCents: "5000000",
    reason: " 阶段性垫资保障项目付款 ",
    attachmentFileId: "file-1",
    idempotencyKey: IDEMPOTENCY_KEY,
    ...overrides
  };
}

function requestFingerprint(input: {
  projectId?: string;
  actorUserId?: string;
  requestedByRoleKey?: "finance_staff" | "finance_director";
  amountCents?: string;
  reason?: string;
  validUntil?: string | null;
  attachmentFileId?: string;
  attachmentFileSha256Snapshot?: string;
}) {
  return createHash("sha256").update(JSON.stringify({
    projectId: input.projectId ?? "project-1",
    actorUserId: input.actorUserId ?? "finance-staff-1",
    requestedByRoleKey: input.requestedByRoleKey ?? "finance_staff",
    amountCents: input.amountCents ?? "5000000",
    reason: input.reason ?? "阶段性垫资保障项目付款",
    validUntil: input.validUntil ?? null,
    attachmentFileId: input.attachmentFileId ?? "file-1",
    attachmentFileSha256Snapshot:
      input.attachmentFileSha256Snapshot ?? FILE_SHA256
  })).digest("hex");
}

function quotaRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "financing-quota-1",
    projectId: "project-1",
    amountCents: 5000000n,
    reason: "阶段性垫资保障项目付款",
    validUntil: null,
    attachmentFileId: "file-1",
    attachmentFileSha256Snapshot: FILE_SHA256,
    requestedByUserId: "finance-staff-1",
    requestedByRoleKey: "finance_staff",
    requestIdempotencyKey: IDEMPOTENCY_KEY,
    requestFingerprint: requestFingerprint({}),
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
    updatedAt: CREATED_AT,
    ...overrides
  };
}

function approvalRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "approval-1",
    businessId: "financing-quota-1",
    applicantUserId: "finance-staff-1",
    status: "in_progress",
    currentNodeIndex: 0,
    frozenNodes: [
      { name: "财务主管", mode: "any", roleKeys: ["finance_director"] },
      { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
    ],
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides
  };
}

function makeTx(input: {
  roleKeys?: string[];
  activeUser?: boolean;
  projectRows?: Array<{ id: string }>;
  fileRows?: Array<{
    id: string;
    uploadedByUserId: string;
    storageStatus: string;
    contentSha256: string | null;
  }>;
  bindingRows?: Array<{ fileId: string }>;
  receiptPhotoBinding?: boolean;
  replays?: unknown[];
  approvalRows?: unknown[];
} = {}) {
  const replayResults = [...(input.replays ?? [null, null])];
  const rawResults: unknown[] = [
    input.projectRows ?? [{ id: "project-1" }]
  ];
  if (replayResults[0] === null) {
    rawResults.push(
      [{ lockResult: "" }],
      input.fileRows ?? [{
        id: "file-1",
        uploadedByUserId: "finance-staff-1",
        storageStatus: "active",
        contentSha256: FILE_SHA256
      }],
      input.bindingRows ?? []
    );
  }
  const created = quotaRow();
  return {
    $queryRaw: jest.fn().mockImplementation(() => Promise.resolve(rawResults.shift() ?? [])),
    user: {
      findFirst: jest.fn().mockResolvedValue(
        input.activeUser === false ? null : { id: "finance-staff-1" }
      )
    },
    userPosition: { findMany: jest.fn().mockResolvedValue([]) },
    projectMember: {
      findMany: jest.fn().mockResolvedValue(
        (input.roleKeys ?? ["finance_staff"]).map((positionKey) => ({ positionKey }))
      )
    },
    position: { findMany: jest.fn().mockResolvedValue([]) },
    spotProcurementReceiptPhoto: {
      findFirst: jest.fn().mockResolvedValue(
        input.receiptPhotoBinding ? { id: "receipt-photo-1" } : null
      )
    },
    projectFinancingQuota: {
      findUnique: jest.fn()
        .mockImplementation(() => Promise.resolve(replayResults.shift() ?? null)),
      create: jest.fn().mockResolvedValue(created)
    },
    approvalInstance: {
      findMany: jest.fn().mockResolvedValue(input.approvalRows ?? [approvalRow()]),
      create: jest.fn().mockResolvedValue(approvalRow())
    }
  };
}

function serviceFor(tx: ReturnType<typeof makeTx>, auditRecord = jest.fn().mockResolvedValue(undefined)) {
  const prisma = {
    $transaction: jest.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx))
  };
  return {
    service: new ProjectService(prisma as never, { record: auditRecord } as never),
    prisma,
    auditRecord
  };
}

describe("ProjectService project financing quota request", () => {
  it.each([
    [requestInput({ idempotencyKey: "not-a-uuid" }), "项目垫资申请幂等键必须是 UUID"],
    [requestInput({ amountCents: "0" }), "项目垫资额度金额必须大于零"],
    [
      requestInput({ validUntil: "2099-07-11T10:00:00" }),
      "项目垫资额度有效期无效"
    ]
  ])("rejects invalid request coordinates before opening a transaction", async (input, message) => {
    const prisma = { $transaction: jest.fn() };
    const service = new ProjectService(prisma as never);

    await expect(service.requestProjectFinancingQuota(
      "project-1",
      "finance-staff-1",
      input as never
    )).rejects.toThrow(message);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a newly requested expired validity date before file and business writes", async () => {
    const tx = makeTx();
    const { service, auditRecord } = serviceFor(tx);

    await expect(service.requestProjectFinancingQuota(
      "project-1",
      "finance-staff-1",
      requestInput({ validUntil: "2000-01-01T00:00:00.000Z" }) as never
    )).rejects.toThrow("项目垫资额度有效期必须晚于当前时间");
    expect(tx.projectFinancingQuota.create).not.toHaveBeenCalled();
    expect(tx.approvalInstance.create).not.toHaveBeenCalled();
    expect(auditRecord).not.toHaveBeenCalled();
  });

  it("keeps a selected Shanghai validity date usable through that natural day", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-08-02T10:00:00.000Z"));
    try {
      const tx = makeTx();
      const { service } = serviceFor(tx);

      await service.requestProjectFinancingQuota(
        "project-1",
        "finance-staff-1",
        requestInput({ validUntil: "2026-08-02" }) as never
      );

      expect(tx.projectFinancingQuota.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          validUntil: new Date("2026-08-02T15:59:59.999Z"),
          requestFingerprint: requestFingerprint({
            validUntil: "2026-08-02T15:59:59.999Z"
          })
        })
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it("rejects an inactive or missing project before any business write", async () => {
    const tx = makeTx({ projectRows: [] });
    const { service, auditRecord } = serviceFor(tx);

    await expect(service.requestProjectFinancingQuota(
      "project-1",
      "finance-staff-1",
      requestInput() as never
    )).rejects.toThrow("项目不存在或已停用");
    expect(tx.user.findFirst).not.toHaveBeenCalled();
    expect(tx.projectFinancingQuota.create).not.toHaveBeenCalled();
    expect(tx.approvalInstance.create).not.toHaveBeenCalled();
    expect(auditRecord).not.toHaveBeenCalled();
  });

  it("creates one frozen request, exact approval lifecycle and minimal receipt for finance staff", async () => {
    const tx = makeTx();
    const { service, auditRecord } = serviceFor(tx);

    const result = await service.requestProjectFinancingQuota(
      "project-1",
      "finance-staff-1",
      requestInput() as never
    );

    expect(result).toEqual({
      kind: "created",
      idempotencyKey: IDEMPOTENCY_KEY,
      projectId: "project-1",
      quotaId: "financing-quota-1"
    });
    expect(tx.projectFinancingQuota.create).toHaveBeenCalledWith({
      data: {
        projectId: "project-1",
        amountCents: 5000000n,
        reason: "阶段性垫资保障项目付款",
        validUntil: null,
        attachmentFileId: "file-1",
        attachmentFileSha256Snapshot: FILE_SHA256,
        requestedByUserId: "finance-staff-1",
        requestedByRoleKey: "finance_staff",
        requestIdempotencyKey: IDEMPOTENCY_KEY,
        requestFingerprint: requestFingerprint({}),
        status: "approval_pending"
      }
    });
    expect(tx.approvalInstance.create).toHaveBeenCalledWith({
      data: {
        flowType: "project_financing_quota.approve",
        businessType: "project_financing_quota",
        businessId: "financing-quota-1",
        status: "in_progress",
        currentNodeIndex: 0,
        frozenNodes: [
          { name: "财务主管", mode: "any", roleKeys: ["finance_director"] },
          { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
        ],
        applicantUserId: "finance-staff-1"
      }
    });
    expect(auditRecord).toHaveBeenCalledWith(tx, expect.objectContaining({
      actorUserId: "finance-staff-1",
      action: "project.financing_quota.request",
      businessId: "financing-quota-1",
      metadata: expect.objectContaining({
        requestedByRoleKey: "finance_staff",
        requestIdempotencyKey: IDEMPOTENCY_KEY,
        attachmentFileSha256Snapshot: FILE_SHA256,
        requestFingerprint: requestFingerprint({})
      })
    }));
  });

  it("freezes finance director when the requester holds both finance roles", async () => {
    const tx = makeTx({ roleKeys: ["finance_staff", "finance_director"] });
    const { service } = serviceFor(tx);

    await service.requestProjectFinancingQuota(
      "project-1",
      "finance-staff-1",
      requestInput() as never
    );

    expect(tx.projectFinancingQuota.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ requestedByRoleKey: "finance_director" })
    });
  });

  it.each([
    [["project_manager"], true, "只有财务人员或财务主管可以申请项目垫资额度"],
    [["finance_staff"], false, "当前账号已停用或不存在"]
  ])("rejects unauthorized or inactive requesters before file and business writes", async (
    roleKeys,
    activeUser,
    message
  ) => {
    const tx = makeTx({ roleKeys, activeUser });
    const { service, auditRecord } = serviceFor(tx);

    await expect(service.requestProjectFinancingQuota(
      "project-1",
      "finance-staff-1",
      requestInput() as never
    )).rejects.toThrow(message);
    expect(tx.projectFinancingQuota.findUnique).not.toHaveBeenCalled();
    expect(tx.projectFinancingQuota.create).not.toHaveBeenCalled();
    expect(tx.approvalInstance.create).not.toHaveBeenCalled();
    expect(auditRecord).not.toHaveBeenCalled();
  });

  it.each([
    [[], NotFoundException, "项目垫资额度附件不存在"],
    [[{ id: "file-1", uploadedByUserId: "other-user", storageStatus: "active", contentSha256: FILE_SHA256 }], BadRequestException, "项目垫资额度附件必须由申请人本人上传"],
    [[{ id: "file-1", uploadedByUserId: "finance-staff-1", storageStatus: "pending", contentSha256: FILE_SHA256 }], BadRequestException, "项目垫资额度附件尚未完成存储"],
    [[{ id: "file-1", uploadedByUserId: "finance-staff-1", storageStatus: "active", contentSha256: null }], BadRequestException, "项目垫资额度附件缺少有效 SHA-256"],
    [[{ id: "file-1", uploadedByUserId: "finance-staff-1", storageStatus: "active", contentSha256: "A".repeat(64) }], BadRequestException, "项目垫资额度附件缺少有效 SHA-256"]
  ])("rejects an invalid attachment with zero business writes", async (fileRows, errorType, message) => {
    const tx = makeTx({ fileRows });
    const { service, auditRecord } = serviceFor(tx);

    let thrown: unknown;
    try {
      await service.requestProjectFinancingQuota(
        "project-1",
        "finance-staff-1",
        requestInput() as never
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(errorType);
    expect(thrown).toMatchObject({ message });
    expect(tx.projectFinancingQuota.create).not.toHaveBeenCalled();
    expect(tx.approvalInstance.create).not.toHaveBeenCalled();
    expect(auditRecord).not.toHaveBeenCalled();
    expect(message).toBeTruthy();
  });

  it("rejects an attachment already bound to another business fact", async () => {
    const tx = makeTx({ bindingRows: [{ fileId: "file-1" }] });
    const { service, auditRecord } = serviceFor(tx);

    await expect(service.requestProjectFinancingQuota(
      "project-1",
      "finance-staff-1",
      requestInput() as never
    )).rejects.toThrow(ConflictException);
    expect(tx.projectFinancingQuota.create).not.toHaveBeenCalled();
    expect(tx.approvalInstance.create).not.toHaveBeenCalled();
    expect(auditRecord).not.toHaveBeenCalled();
  });

  it("rejects an attachment already bound as a spot-procurement receipt photo", async () => {
    const tx = makeTx({ receiptPhotoBinding: true });
    const { service, auditRecord } = serviceFor(tx);

    await expect(service.requestProjectFinancingQuota(
      "project-1",
      "finance-staff-1",
      requestInput() as never
    )).rejects.toThrow(ConflictException);
    expect(tx.projectFinancingQuota.create).not.toHaveBeenCalled();
    expect(tx.approvalInstance.create).not.toHaveBeenCalled();
    expect(auditRecord).not.toHaveBeenCalled();
  });

  it("replays the same normalized request without any additional write", async () => {
    const existing = quotaRow();
    const tx = makeTx({ replays: [existing], approvalRows: [approvalRow()] });
    const { service, auditRecord } = serviceFor(tx);

    const result = await service.requestProjectFinancingQuota(
      "project-1",
      "finance-staff-1",
      requestInput() as never
    );

    expect(result).toEqual({
      kind: "replayed",
      idempotencyKey: IDEMPOTENCY_KEY,
      projectId: "project-1",
      quotaId: "financing-quota-1"
    });
    expect(tx.projectFinancingQuota.create).not.toHaveBeenCalled();
    expect(tx.approvalInstance.create).not.toHaveBeenCalled();
    expect(auditRecord).not.toHaveBeenCalled();
  });

  it("replays a finance-staff request after the actor also gains finance-director", async () => {
    const tx = makeTx({
      roleKeys: ["finance_staff", "finance_director"],
      replays: [quotaRow()],
      approvalRows: [approvalRow()]
    });
    const { service } = serviceFor(tx);

    await expect(service.requestProjectFinancingQuota(
      "project-1",
      "finance-staff-1",
      requestInput() as never
    )).resolves.toMatchObject({ kind: "replayed", quotaId: "financing-quota-1" });
  });

  it("replays the exact request after its optional validity date has elapsed", async () => {
    const validUntil = "2000-01-01T00:00:00.000Z";
    const tx = makeTx({
      replays: [quotaRow({
        validUntil: new Date(validUntil),
        requestFingerprint: requestFingerprint({ validUntil })
      })],
      approvalRows: [approvalRow()]
    });
    const { service } = serviceFor(tx);

    await expect(service.requestProjectFinancingQuota(
      "project-1",
      "finance-staff-1",
      requestInput({ validUntil }) as never
    )).resolves.toMatchObject({ kind: "replayed", quotaId: "financing-quota-1" });
  });

  it.each([
    ["project-2", "finance-staff-1", requestInput()],
    ["project-1", "other-user", requestInput()],
    ["project-1", "finance-staff-1", requestInput({ amountCents: "5000001" })],
    ["project-1", "finance-staff-1", requestInput({ reason: "另一个原因" })],
    ["project-1", "finance-staff-1", requestInput({ validUntil: "2099-01-01T00:00:00.000Z" })],
    ["project-1", "finance-staff-1", requestInput({ attachmentFileId: "file-2" })]
  ])("rejects reuse of a key across changed project, actor or payload", async (
    projectId,
    actorUserId,
    input
  ) => {
    const tx = makeTx({ replays: [quotaRow()], approvalRows: [approvalRow()] });
    const { service, auditRecord } = serviceFor(tx);

    await expect(service.requestProjectFinancingQuota(
      projectId,
      actorUserId,
      input as never
    )).rejects.toThrow(ConflictException);
    expect(tx.projectFinancingQuota.create).not.toHaveBeenCalled();
    expect(auditRecord).not.toHaveBeenCalled();
  });

  it.each([
    [quotaRow({ requestFingerprint: requestFingerprint({ reason: "其他原因" }) }), [approvalRow()]],
    [quotaRow(), []],
    [quotaRow(), [approvalRow(), approvalRow({ id: "approval-2" })]],
    [quotaRow(), [approvalRow({ applicantUserId: "other-user" })]],
    [quotaRow(), [approvalRow({ frozenNodes: [{ name: "财务主管", mode: "any", roleKeys: ["finance_director"] }] })]]
  ])("fails closed for a conflicting request or drifted approval lifecycle", async (existing, approvalRows) => {
    const tx = makeTx({ replays: [existing], approvalRows });
    const { service, auditRecord } = serviceFor(tx);

    await expect(service.requestProjectFinancingQuota(
      "project-1",
      "finance-staff-1",
      requestInput() as never
    )).rejects.toThrow(ConflictException);
    expect(tx.projectFinancingQuota.create).not.toHaveBeenCalled();
    expect(auditRecord).not.toHaveBeenCalled();
  });

  it("replays the unique winner after a concurrent P2002 loser", async () => {
    const firstTx = makeTx();
    firstTx.projectFinancingQuota.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("unique", {
        code: "P2002",
        clientVersion: "test",
        meta: { target: "ProjectFinancingQuota_requestIdempotencyKey_key" }
      })
    );
    const replayTx = makeTx({ replays: [quotaRow()], approvalRows: [approvalRow()] });
    const prisma = {
      $transaction: jest.fn()
        .mockImplementationOnce(async (callback: (value: typeof firstTx) => Promise<unknown>) => callback(firstTx))
        .mockImplementationOnce(async (callback: (value: typeof replayTx) => Promise<unknown>) => callback(replayTx))
    };
    const service = new ProjectService(prisma as never, { record: jest.fn() } as never);

    await expect(service.requestProjectFinancingQuota(
      "project-1",
      "finance-staff-1",
      requestInput() as never
    )).resolves.toEqual(expect.objectContaining({
      kind: "replayed",
      quotaId: "financing-quota-1"
    }));
  });

  it("returns a stable conflict when a P2002 winner cannot be reloaded", async () => {
    const firstTx = makeTx();
    firstTx.projectFinancingQuota.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("unique", {
        code: "P2002",
        clientVersion: "test",
        meta: { target: ["requestIdempotencyKey"] }
      })
    );
    const replayTx = makeTx({ replays: [null] });
    const prisma = {
      $transaction: jest.fn()
        .mockImplementationOnce(async (callback: (value: typeof firstTx) => Promise<unknown>) => callback(firstTx))
        .mockImplementationOnce(async (callback: (value: typeof replayTx) => Promise<unknown>) => callback(replayTx))
    };
    const service = new ProjectService(prisma as never, { record: jest.fn() } as never);

    await expect(service.requestProjectFinancingQuota(
      "project-1",
      "finance-staff-1",
      requestInput() as never
    )).rejects.toThrow("项目垫资额度申请发生并发冲突，请刷新后重试");
  });

  it("does not misclassify an unrelated P2002 as an idempotency race", async () => {
    const tx = makeTx();
    const uniqueError = new Prisma.PrismaClientKnownRequestError("exclusive file", {
      code: "P2002",
      clientVersion: "test",
      meta: { target: "exclusive_file_business_binding_guard" }
    });
    tx.projectFinancingQuota.create.mockRejectedValue(uniqueError);
    const { service, prisma } = serviceFor(tx);

    await expect(service.requestProjectFinancingQuota(
      "project-1",
      "finance-staff-1",
      requestInput() as never
    )).rejects.toBe(uniqueError);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("propagates Audit failure from the same transaction", async () => {
    const tx = makeTx();
    const auditError = new Error("audit unavailable");
    const { service } = serviceFor(tx, jest.fn().mockRejectedValue(auditError));

    await expect(service.requestProjectFinancingQuota(
      "project-1",
      "finance-staff-1",
      requestInput() as never
    )).rejects.toBe(auditError);
    expect(tx.projectFinancingQuota.create).toHaveBeenCalledTimes(1);
    expect(tx.approvalInstance.create).toHaveBeenCalledTimes(1);
  });
});
