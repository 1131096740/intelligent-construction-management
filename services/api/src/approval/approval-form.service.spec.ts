import {
  ApprovalFormService,
  buildProjectPaymentApprovalRows
} from "./approval-form.service";
import { createHash } from "node:crypto";

// 有效 1x1 PNG，供签名图嵌入测试（doc.image 需要可解码图片）。
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=",
  "base64"
);

// 构造一个「付款审批已通过」的最小 prisma 桩，覆盖 generateForInstance 用到的查询。
function buildPrisma(overrides: Record<string, unknown> = {}) {
  const created = { id: "pdf-1", fileId: "file-1", templateKey: "approval_form" };
  let generationClaim: Record<string, unknown> | null = null;
  const approvalFormGenerationClaim = {
    findUnique: jest.fn().mockImplementation(() => Promise.resolve(generationClaim)),
    create: jest.fn().mockImplementation(({ data }) => {
      generationClaim = {
        ...data,
        uploadedFileId: null,
        pdfDocumentId: null,
        attemptCount: 1,
        safeFailureCode: null,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      return Promise.resolve(generationClaim);
    }),
    update: jest.fn().mockImplementation(({ data }) => {
      if (!generationClaim) return Promise.reject(new Error("claim missing"));
      generationClaim = {
        ...generationClaim,
        ...data,
        attemptCount: typeof data.attemptCount === "object"
          ? Number(generationClaim.attemptCount) + Number(data.attemptCount.increment ?? 0)
          : (data.attemptCount ?? generationClaim.attemptCount),
        updatedAt: new Date()
      };
      return Promise.resolve(generationClaim);
    }),
    updateMany: jest.fn().mockImplementation(({ where, data }) => {
      if (!generationClaim ||
        (where.claimToken !== undefined && generationClaim.claimToken !== where.claimToken) ||
        (where.status !== undefined && generationClaim.status !== where.status)) {
        return Promise.resolve({ count: 0 });
      }
      generationClaim = { ...generationClaim, ...data, updatedAt: new Date() };
      return Promise.resolve({ count: 1 });
    })
  };
  const prisma = {
    created,
    approvalInstance: {
      findUnique: jest.fn().mockResolvedValue({
        id: "inst-1",
        businessType: "payment_request",
        businessId: "pay-1",
        status: "approved",
        applicantUserId: "user-applicant",
        frozenNodes: [{ name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }]
      }),
      findFirst: jest.fn().mockResolvedValue({
        id: "inst-1",
        businessType: "payment_request",
        businessId: "pay-1",
        status: "approved",
        applicantUserId: "user-applicant",
        frozenNodes: [{ name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }]
      })
    },
    pdfDocument: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(created)
    },
    approvalActionLog: {
      findMany: jest.fn().mockResolvedValue([
        {
          actorUserId: "user-chair",
          action: "approve",
          comment: "同意付款，注意分期",
          createdAt: new Date("2026-06-24T08:30:00.000Z")
        }
      ])
    },
    paymentRequest: {
      findUnique: jest.fn().mockResolvedValue({
        id: "pay-1",
        projectId: "proj-1",
        code: "PAY-2026-001",
        settlementId: "set-1",
        contractId: "con-1",
        contractVersionId: "version-1",
        requestedAmountCents: 123456n,
        approvedAmountCents: 123456n,
        paidAmountCents: 0n,
        sourceType: "settlement",
        createdAt: new Date("2026-06-24T00:00:00.000Z"),
        dueDate: new Date("2026-07-01T00:00:00.000Z")
      }),
      findMany: jest.fn().mockResolvedValue([{ paidAmountCents: 100000n }])
    },
    project: {
      findUnique: jest.fn().mockResolvedValue({ id: "proj-1", name: "建工智管试运行项目" })
    },
    settlement: {
      findUnique: jest.fn().mockResolvedValue({
        id: "set-1",
        code: "SET-2026-001",
        periodLabel: "2026-06",
        amountCents: 2000000n,
        payableAmountCents: 1600000n
      }),
      findMany: jest.fn().mockResolvedValue([{ amountCents: 2000000n }])
    },
    contract: {
      findUnique: jest.fn().mockResolvedValue({
        id: "con-1",
        code: "HT-2026-001",
        name: "钢材采购合同",
        counterparty: "某某建筑公司",
        companyEntityName: "四川建工智管建筑工程有限公司"
      })
    },
    contractVersion: {
      findUnique: jest.fn().mockResolvedValue({
        id: "version-1",
        amountCents: 5000000n
      })
    },
    user: {
      findMany: jest.fn().mockResolvedValue([
        { id: "user-applicant", name: "申请人甲", signatureFileId: null },
        { id: "user-chair", name: "董事长乙", signatureFileId: null }
      ]),
      findUnique: jest.fn().mockResolvedValue({ id: "user-chair", name: "董事长乙" })
    },
    userPosition: { findMany: jest.fn().mockResolvedValue([]) },
    projectMember: { findMany: jest.fn().mockResolvedValue([]) },
    position: { findMany: jest.fn().mockResolvedValue([]) },
    approvalFormGenerationClaim,
    ...overrides
  };
  Object.assign(prisma, {
    $queryRaw: (prisma as { $queryRaw?: unknown }).$queryRaw ?? jest.fn().mockResolvedValue([{ id: "inst-1" }]),
    $transaction: (prisma as { $transaction?: unknown }).$transaction ??
      jest.fn(async (callback: (tx: typeof prisma) => unknown) => callback(prisma))
  });
  return prisma;
}

describe("ApprovalFormService", () => {
  it("renders frozen transfer and delegation relationships with names but never internal user IDs", async () => {
    const prisma = buildPrisma({
      approvalActionLog: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "log-transfer",
            actorUserId: "user-chair",
            action: "transfer",
            comment: null,
            metadata: {
              kind: "transfer",
              fromUserId: "user-chair",
              toUserId: "user-agent-a",
              fromRoleKey: "chairman"
            },
            approvedRoleKey: "chairman",
            representedUserId: "user-chair",
            signatureFileIdSnapshot: null,
            signatureSha256Snapshot: null,
            createdAt: new Date("2026-07-18T08:00:00.000Z")
          },
          {
            id: "log-retransfer",
            actorUserId: "user-chair",
            action: "transfer",
            comment: "改派处理人",
            metadata: {
              kind: "transfer",
              fromUserId: "user-chair",
              toUserId: "user-agent-b",
              fromRoleKey: "chairman"
            },
            approvedRoleKey: "chairman",
            representedUserId: "user-chair",
            signatureFileIdSnapshot: null,
            signatureSha256Snapshot: null,
            createdAt: new Date("2026-07-18T08:30:00.000Z")
          },
          {
            id: "log-delegate",
            actorUserId: "user-agent-a",
            action: "delegate",
            comment: null,
            metadata: {
              kind: "delegate",
              fromUserId: "user-chair",
              toUserId: "user-agent-b",
              fromRoleKey: "chairman"
            },
            approvedRoleKey: "chairman",
            representedUserId: "user-chair",
            signatureFileIdSnapshot: null,
            signatureSha256Snapshot: null,
            createdAt: new Date("2026-07-18T09:00:00.000Z")
          },
          {
            id: "log-approve",
            actorUserId: "user-agent-b",
            action: "approve",
            comment: "同意",
            metadata: null,
            approvedRoleKey: "chairman",
            representedUserId: "user-chair",
            signatureFileIdSnapshot: null,
            signatureSha256Snapshot: null,
            createdAt: new Date("2026-07-18T10:00:00.000Z")
          }
        ])
      },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: "user-applicant", name: "申请人甲" },
          { id: "user-chair", name: "董事长乙" },
          { id: "user-agent-a", name: "受托人丙" },
          { id: "user-agent-b", name: "受托人丁" }
        ]),
        findUnique: jest.fn()
      }
    });
    const service = new ApprovalFormService(prisma as never) as unknown as {
      buildRenderInput(instance: unknown): Promise<{
        logs: Array<{ action: string; name: string; relationship: string }>;
      }>;
    };

    const rendered = await service.buildRenderInput({
      id: "inst-1",
      businessType: "payment_request",
      businessId: "pay-1",
      applicantUserId: "user-applicant",
      frozenNodes: []
    });

    expect(rendered.logs).toEqual([
      expect.objectContaining({
        action: "转交",
        name: "董事长乙",
        relationship: "转交关系：董事长乙 → 受托人丙（董事长）"
      }),
      expect.objectContaining({
        action: "转交",
        name: "董事长乙",
        relationship: "转交关系：董事长乙 → 受托人丁（董事长）"
      }),
      expect.objectContaining({
        action: "委托",
        name: "受托人丙",
        relationship: "委托关系：董事长乙 → 受托人丁（董事长）"
      }),
      expect.objectContaining({
        action: "通过",
        name: "受托人丁",
        relationship: "代批关系：董事长乙 → 受托人丁（董事长）"
      })
    ]);
    expect(JSON.stringify(rendered)).not.toContain("user-chair");
    expect(JSON.stringify(rendered)).not.toContain("user-agent-a");
    expect(JSON.stringify(rendered)).not.toContain("user-agent-b");
  });

  it("uses a neutral compatibility note for historical transfer logs without relationship metadata", async () => {
    const prisma = buildPrisma({
      approvalActionLog: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "log-legacy-transfer",
            actorUserId: "user-chair",
            action: "transfer",
            comment: null,
            metadata: null,
            approvedRoleKey: "chairman",
            representedUserId: "user-chair",
            signatureFileIdSnapshot: null,
            signatureSha256Snapshot: null,
            createdAt: new Date("2026-06-18T08:00:00.000Z")
          }
        ])
      }
    });
    const service = new ApprovalFormService(prisma as never) as unknown as {
      buildRenderInput(instance: unknown): Promise<{
        logs: Array<{ relationship: string }>;
      }>;
    };

    const rendered = await service.buildRenderInput({
      id: "inst-1",
      businessType: "payment_request",
      businessId: "pay-1",
      applicantUserId: "user-applicant",
      frozenNodes: []
    });

    expect(rendered.logs[0]?.relationship).toBe("历史记录未冻结委托/转交双方关系");
  });

  it("builds the real company project payment approval form rows", () => {
    const rows = buildProjectPaymentApprovalRows({
      payment: {
        sourceType: "settlement",
        requestedAmountCents: 123456n,
        approvedAmountCents: 120000n,
        createdAt: new Date("2026-06-24T00:00:00.000Z"),
        dueDate: new Date("2026-07-01T00:00:00.000Z")
      },
      applicantName: "申请人甲",
      companyName: "四川建工智管建筑工程有限公司",
      projectName: "建工智管试运行项目",
      contract: {
        code: "HT-2026-001",
        name: "钢材采购合同",
        counterparty: "某某建筑公司"
      },
      settlement: { code: "SET-2026-001", periodLabel: "2026-06" },
      contractAmountCents: 5000000n,
      cumulativeSettledCents: 2000000n,
      cumulativePaidCents: 100000n
    });

    expect(rows.map((row) => row.label)).toEqual([
      "项目名称",
      "申请日期",
      "付款主体",
      "经办人",
      "付款事由",
      "计划付款日期",
      "合同名称",
      "合同编号",
      "付款方式",
      "付款类型",
      "合同金额",
      "累计生效结算金额",
      "累计已付款",
      "发票类型提醒",
      "本次付款金额",
      "收款方名称",
      "开户银行",
      "银行账号",
      "转款手续费",
      "备注"
    ]);
    expect(rows.find((row) => row.label === "本次付款金额")?.value).toBe("1,234.56 元");
    expect(rows.some((row) => row.label === "当前可申请余额")).toBe(false);
    expect(rows.find((row) => row.label === "付款事由")?.value).toBe(
      "2026-06 结算付款（SET-2026-001）"
    );
  });

  it("formats large payment amounts in approval PDF rows without number conversion", () => {
    const rows = buildProjectPaymentApprovalRows({
      payment: {
        sourceType: "settlement",
        requestedAmountCents: 9007199254740993n
      },
      applicantName: "验收经办人",
      companyName: "四川建工智管建筑工程有限公司",
      contractAmountCents: 9007199254740993n,
      cumulativeSettledCents: 2100000001n,
      cumulativePaidCents: 1000000001n,
    });

    expect(rows.find((row) => row.label === "本次付款金额")?.value).toBe(
      "90,071,992,547,409.93 元"
    );
    expect(rows.find((row) => row.label === "合同金额")?.value).toBe(
      "90,071,992,547,409.93 元"
    );
    expect(rows.find((row) => row.label === "累计生效结算金额")?.value).toBe(
      "21,000,000.01 元"
    );
  });

  it("将通用合同冻结阶段直接付款与结算累计付款明确区分", () => {
    const rows = buildProjectPaymentApprovalRows({
      payment: {
        sourceType: "contract_due",
        paymentTermsStageId: "stage-direct-1",
        requestedAmountCents: 300000n
      },
      applicantName: "合同员甲",
      companyName: "四川建工智管建筑工程有限公司",
      contract: { name: "通用服务合同" },
      contractAmountCents: 1000000n,
      cumulativeSettledCents: 800000n,
      paymentTermsStageName: "验收后付款"
    });

    expect(rows.find((row) => row.label === "付款类型")?.value).toBe(
      "合同冻结阶段直接付款"
    );
    expect(rows.find((row) => row.label === "付款事由")?.value).toBe(
      "通用服务合同·验收后付款直接付款"
    );
    expect(rows.find((row) => row.label === "合同冻结付款阶段")?.value).toBe(
      "验收后付款"
    );
    expect(rows.some((row) => row.label === "累计生效结算金额")).toBe(false);
  });

  it("renders an approval-form PDF and archives it as a PdfDocument", async () => {
    const prisma = buildPrisma();
    let uploaded: { buffer: Buffer; sizeBytes: number; originalName: string } | undefined;
    const files = {
      uploadPrivateFile: jest.fn().mockImplementation((input) => {
        uploaded = input;
        return Promise.resolve({ id: "file-1" });
      })
    };
    const audit = { record: jest.fn() };
    const service = new ApprovalFormService(prisma as never, files as never, audit as never);

    const result = await service.generateForInstance("inst-1", "user-chair");

    expect(result).toBe(prisma.created);
    expect(files.uploadPrivateFile).toHaveBeenCalledTimes(1);
    // 真正渲染出 PDF：以 %PDF 开头、字节数与 sizeBytes 一致、文件名含单号。
    expect(uploaded?.buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(uploaded?.sizeBytes).toBe(uploaded?.buffer.length);
    expect(uploaded?.buffer.length).toBeGreaterThan(1000);
    expect(uploaded?.originalName).toBe("项目付款审批表-PAY-2026-001.pdf");
    expect(prisma.pdfDocument.create).toHaveBeenCalledWith({
      data: {
        businessType: "payment_request",
        businessId: "pay-1",
        fileId: "file-1",
        templateKey: "approval_form",
        approvalInstanceId: "inst-1"
      }
    });
    expect(audit.record).toHaveBeenCalled();
  });

  it("renders a payment void action with a Chinese approval label", async () => {
    const prisma = buildPrisma({
      approvalActionLog: {
        findMany: jest.fn().mockResolvedValue([
          {
            actorUserId: "user-chair",
            action: "void",
            comment: "重复申请，予以作废",
            createdAt: new Date("2026-07-17T08:30:00.000Z")
          }
        ])
      }
    });
    const files = {
      uploadPrivateFile: jest.fn().mockResolvedValue({ id: "file-1" })
    };
    const service = new ApprovalFormService(
      prisma as never,
      files as never,
      { record: jest.fn() } as never
    );
    const renderPdf = jest.fn().mockResolvedValue(Buffer.from("%PDF-test"));
    (service as unknown as { renderPdf: typeof renderPdf }).renderPdf = renderPdf;

    await service.generateForInstance("inst-1", "user-chair");

    expect(renderPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        logs: [
          expect.objectContaining({
            action: "作废"
          })
        ]
      })
    );
  });

  it("is idempotent: returns the existing form without re-uploading", async () => {
    const prisma = buildPrisma({
      pdfDocument: {
        findFirst: jest.fn().mockResolvedValue({ id: "pdf-existing", fileId: "file-x" }),
        create: jest.fn()
      }
    });
    const files = { uploadPrivateFile: jest.fn() };
    const service = new ApprovalFormService(prisma as never, files as never, { record: jest.fn() } as never);

    const result = await service.generateForInstance("inst-1", "user-chair");

    expect(result).toEqual({ id: "pdf-existing", fileId: "file-x" });
    expect(files.uploadPrivateFile).not.toHaveBeenCalled();
  });

  it("并发生成按审批实例串行化，竞争者复用 winner 且只上传一份", async () => {
    const committed = { id: "pdf-winner", fileId: "file-winner", approvalInstanceId: "inst-1" };
    let stored: typeof committed | null = null;
    let queue = Promise.resolve();
    const pdfDocument = {
      findFirst: jest.fn().mockImplementation(() => Promise.resolve(stored)),
      create: jest.fn().mockImplementation(() => {
        stored = committed;
        return Promise.resolve(committed);
      })
    };
    const prisma = buildPrisma({ pdfDocument }) as ReturnType<typeof buildPrisma> & {
      $transaction: jest.Mock;
    };
    prisma.$transaction = jest.fn(async (callback: (tx: typeof prisma) => unknown) => {
      const previous = queue;
      let release!: () => void;
      queue = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      try {
        return await callback(prisma);
      } finally {
        release();
      }
    });
    const files = {
      uploadPrivateFile: jest.fn().mockResolvedValue({ id: "file-winner" })
    };
    const service = new ApprovalFormService(
      prisma as never,
      files as never,
      { record: jest.fn() } as never
    );

    await expect(Promise.all([
      service.generateForInstance("inst-1", "user-chair"),
      service.generateForInstance("inst-1", "user-chair")
    ])).resolves.toEqual([committed, committed]);
    expect(files.uploadPrivateFile).toHaveBeenCalledTimes(1);
    expect(pdfDocument.create).toHaveBeenCalledTimes(1);
  });

  it("终结失败的 uploaded claim 重试时复用已登记文件，不重复上传", async () => {
    let claim = {
      approvalInstanceId: "inst-1",
      claimToken: "old-token",
      status: "failed",
      claimedAt: new Date(Date.now() - 1_000),
      uploadedFileId: "file-recoverable",
      pdfDocumentId: null,
      attemptCount: 1,
      safeFailureCode: "finalize_retry_required"
    };
    const claimStore = {
      findUnique: jest.fn().mockImplementation(() => Promise.resolve(claim)),
      create: jest.fn(),
      update: jest.fn().mockImplementation(({ data }) => {
        claim = {
          ...claim,
          ...data,
          attemptCount: claim.attemptCount + Number(data.attemptCount?.increment ?? 0)
        };
        return Promise.resolve(claim);
      }),
      updateMany: jest.fn().mockImplementation(({ where, data }) => {
        if (where.claimToken && where.claimToken !== claim.claimToken) {
          return Promise.resolve({ count: 0 });
        }
        claim = { ...claim, ...data };
        return Promise.resolve({ count: 1 });
      })
    };
    const prisma = buildPrisma({ approvalFormGenerationClaim: claimStore });
    const files = { uploadPrivateFile: jest.fn() };
    const service = new ApprovalFormService(
      prisma as never,
      files as never,
      { record: jest.fn() } as never
    );

    await expect(service.generateForInstance("inst-1", "user-chair"))
      .resolves.toMatchObject({ id: "pdf-1", fileId: "file-1" });
    expect(files.uploadPrivateFile).not.toHaveBeenCalled();
    expect(claim.status).toBe("completed");
    expect(claim.uploadedFileId).toBe("file-recoverable");
  });

  it("超时 pending claim 可被新 token 接管并完成，且只上传一份", async () => {
    let claim = {
      approvalInstanceId: "inst-1",
      claimToken: "stale-token",
      status: "pending",
      claimedAt: new Date(Date.now() - 180_000),
      uploadedFileId: null as string | null,
      pdfDocumentId: null as string | null,
      attemptCount: 1,
      safeFailureCode: null as string | null
    };
    const claimStore = {
      findUnique: jest.fn().mockImplementation(() => Promise.resolve(claim)),
      create: jest.fn(),
      update: jest.fn().mockImplementation(({ data }) => {
        claim = {
          ...claim,
          ...data,
          attemptCount: claim.attemptCount + Number(data.attemptCount?.increment ?? 0)
        };
        return Promise.resolve(claim);
      }),
      updateMany: jest.fn().mockImplementation(({ where, data }) => {
        if (where.claimToken && where.claimToken !== claim.claimToken) {
          return Promise.resolve({ count: 0 });
        }
        claim = { ...claim, ...data };
        return Promise.resolve({ count: 1 });
      })
    };
    const prisma = buildPrisma({ approvalFormGenerationClaim: claimStore });
    const files = { uploadPrivateFile: jest.fn().mockResolvedValue({ id: "file-new" }) };
    const service = new ApprovalFormService(
      prisma as never,
      files as never,
      { record: jest.fn() } as never
    );

    await expect(service.generateForInstance("inst-1", "user-chair"))
      .resolves.toMatchObject({ id: "pdf-1" });
    expect(files.uploadPrivateFile).toHaveBeenCalledTimes(1);
    expect(claim.claimToken).not.toBe("stale-token");
    expect(claim.attemptCount).toBe(2);
    expect(claim.status).toBe("completed");
  });

  it("embeds an approver signature image when the user has one", async () => {
    const prisma = buildPrisma({
      approvalActionLog: {
        findMany: jest.fn().mockResolvedValue([{
          id: "log-1",
          actorUserId: "user-chair",
          action: "approve",
          comment: "同意付款，注意分期",
          approvedRoleKey: "chairman",
          signatureFileIdSnapshot: "sig-1",
          signatureSha256Snapshot: createHash("sha256").update(PNG_1X1).digest("hex"),
          representedUserId: "user-chair",
          createdAt: new Date("2026-06-24T08:30:00.000Z")
        }])
      },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: "user-applicant", name: "申请人甲", signatureFileId: null },
          { id: "user-chair", name: "董事长乙", signatureFileId: "sig-1" }
        ])
      }
    });
    let uploaded: { buffer: Buffer } | undefined;
    const files = {
      uploadPrivateFile: jest.fn().mockImplementation((input) => {
        uploaded = input;
        return Promise.resolve({ id: "file-1" });
      }),
      getFileBuffer: jest.fn().mockResolvedValue({
        file: { id: "sig-1" },
        buffer: PNG_1X1
      })
    };
    const service = new ApprovalFormService(prisma as never, files as never, { record: jest.fn() } as never);

    await service.generateForInstance("inst-1", "user-chair");

    expect(files.getFileBuffer).toHaveBeenCalledWith("sig-1");
    expect(uploaded?.buffer.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("does not persist an approval form when a frozen signature cannot be read", async () => {
    const prisma = buildPrisma({
      approvalActionLog: {
        findMany: jest.fn().mockResolvedValue([{
          id: "log-1",
          actorUserId: "user-chair",
          action: "approve",
          approvedRoleKey: "chairman",
          signatureFileIdSnapshot: "sig-1",
          signatureSha256Snapshot: "a".repeat(64),
          createdAt: new Date("2026-06-24T08:30:00.000Z")
        }])
      }
    });
    const files = {
      uploadPrivateFile: jest.fn(),
      getFileBuffer: jest.fn().mockRejectedValue(new Error("COS temporarily unavailable"))
    };
    const service = new ApprovalFormService(
      prisma as never,
      files as never,
      { record: jest.fn() } as never
    );

    await expect(service.generateForInstance("inst-1", "user-chair"))
      .rejects.toThrow("COS temporarily unavailable");
    expect(files.uploadPrivateFile).not.toHaveBeenCalled();
    expect(prisma.pdfDocument.create).not.toHaveBeenCalled();
  });

  it("does not backfill a historical approval from the user's current signature", async () => {
    const prisma = buildPrisma({
      approvalActionLog: {
        findMany: jest.fn().mockResolvedValue([{
          id: "legacy-log-1",
          actorUserId: "user-chair",
          action: "approve",
          comment: "历史审批",
          approvedRoleKey: null,
          signatureFileIdSnapshot: null,
          createdAt: new Date("2026-06-24T08:30:00.000Z")
        }])
      },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: "user-applicant", name: "申请人甲", signatureFileId: null },
          { id: "user-chair", name: "董事长乙", signatureFileId: "current-signature" }
        ])
      }
    });
    const files = {
      uploadPrivateFile: jest.fn().mockResolvedValue({ id: "file-1" }),
      getFileBuffer: jest.fn()
    };
    const service = new ApprovalFormService(prisma as never, files as never, { record: jest.fn() } as never);

    await service.generateForInstance("inst-1", "user-chair");

    expect(files.getFileBuffer).not.toHaveBeenCalledWith("current-signature");
  });

  it("renders a contract advance approval form without querying a null settlement", async () => {
    const settlement = {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([])
    };
    const prisma = buildPrisma({
      paymentRequest: {
        findUnique: jest.fn().mockResolvedValue({
          id: "pay-advance-1",
          projectId: "proj-1",
          code: "PAY-YF-2026-001",
          sourceType: "contract_advance",
          settlementId: null,
          contractId: "con-1",
          contractVersionId: "version-1",
          requestedAmountCents: 10000000n,
          approvedAmountCents: 10000000n,
          paidAmountCents: 0n,
          createdAt: new Date("2026-06-24T00:00:00.000Z"),
          dueDate: null
        }),
        findMany: jest.fn().mockResolvedValue([])
      },
      settlement,
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "con-1",
          code: "HT-2026-009",
          name: "幕墙分包合同",
          counterparty: "某某建筑公司"
        })
      }
    });
    const files = {
      uploadPrivateFile: jest.fn().mockResolvedValue({ id: "file-1" })
    };
    const service = new ApprovalFormService(prisma as never, files as never, { record: jest.fn() } as never);

    await service.generateForInstance("inst-1", "user-chair");

    expect(settlement.findUnique).not.toHaveBeenCalled();
    expect(files.uploadPrivateFile).toHaveBeenCalledTimes(1);
  });

  it("renderForDownload stamps a per-downloader watermark and audits the download", async () => {
    const prisma = buildPrisma({
      pdfDocument: {
        findFirst: jest.fn().mockResolvedValue({ id: "pdf-1", fileId: "file-1" }),
        create: jest.fn()
      }
    });
    const files = {
      uploadPrivateFile: jest.fn(),
      getFileBuffer: jest.fn().mockRejectedValue(new Error("Private file not found")),
      assertCanDownloadApprovalFormByBusiness: jest.fn().mockResolvedValue(undefined),
      assertCanDownloadFileById: jest.fn().mockResolvedValue(undefined)
    };
    const audit = { record: jest.fn() };
    const auth = { confirmPassword: jest.fn().mockResolvedValue({ ok: true }) };
    const service = new ApprovalFormService(
      prisma as never,
      files as never,
      audit as never,
      auth as never
    );

    const result = await service.renderForDownload(
      "payment_request",
      "pay-1",
      "user-chair",
      "current-password",
      "付款审批复核"
    );

    expect(auth.confirmPassword).toHaveBeenCalledWith("user-chair", "current-password");
    expect(files.assertCanDownloadFileById).toHaveBeenCalledWith("file-1", "user-chair");
    expect(result.buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(result.fileName).toBe("项目付款审批表-PAY-2026-001.pdf");
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "approval.form.download",
        actorUserId: "user-chair",
        metadata: expect.objectContaining({ downloadReason: "付款审批复核" })
      })
    );
  });

  it("合同审批单下载必须先通过业务 ACL，拒绝时不触发惰性生成", async () => {
    const prisma = buildPrisma({
      pdfDocument: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn()
      }
    });
    const files = {
      assertCanDownloadContractApprovalForm: jest.fn()
        .mockRejectedValue(new Error("当前账号无权下载该合同审批单")),
      assertCanDownloadFileById: jest.fn(),
      uploadPrivateFile: jest.fn()
    };
    const auth = { confirmPassword: jest.fn().mockResolvedValue({ ok: true }) };
    const service = new ApprovalFormService(
      prisma as never,
      files as never,
      { record: jest.fn() } as never,
      auth as never
    );

    await expect(service.renderForDownload(
      "contract_version",
      "version-1",
      "outsider-1",
      "current-password",
      "合同审批复核"
    )).rejects.toThrow("当前账号无权下载该合同审批单");

    expect(files.assertCanDownloadContractApprovalForm).toHaveBeenCalledWith(
      "version-1",
      "outsider-1"
    );
    expect(prisma.pdfDocument.findFirst).not.toHaveBeenCalled();
    expect(files.uploadPrivateFile).not.toHaveBeenCalled();
    expect(files.assertCanDownloadFileById).not.toHaveBeenCalled();
  });

  it("非合同审批单下载必须先通过业务 ACL，拒绝时不触发惰性生成", async () => {
    const prisma = buildPrisma({
      pdfDocument: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn()
      }
    });
    const files = {
      assertCanDownloadApprovalFormByBusiness: jest.fn()
        .mockRejectedValue(new Error("当前账号无权下载该审批单")),
      assertCanDownloadFileById: jest.fn(),
      uploadPrivateFile: jest.fn()
    };
    const auth = { confirmPassword: jest.fn().mockResolvedValue({ ok: true }) };
    const service = new ApprovalFormService(
      prisma as never,
      files as never,
      { record: jest.fn() } as never,
      auth as never
    );

    await expect(service.renderForDownload(
      "payment_request",
      "pay-1",
      "outsider-1",
      "current-password",
      "付款审批复核"
    )).rejects.toThrow("当前账号无权下载该审批单");

    expect(files.assertCanDownloadApprovalFormByBusiness).toHaveBeenCalledWith(
      "payment_request",
      "pay-1",
      "outsider-1"
    );
    expect(prisma.pdfDocument.findFirst).not.toHaveBeenCalled();
    expect(files.uploadPrivateFile).not.toHaveBeenCalled();
    expect(files.assertCanDownloadFileById).not.toHaveBeenCalled();
  });

  it("authorizes a Spot business before attempting any PDF repair write", async () => {
    const prisma = buildPrisma();
    const files = {
      uploadPrivateFile: jest.fn(),
      assertCanDownloadFileById: jest.fn()
    };
    const auth = { confirmPassword: jest.fn().mockResolvedValue({ ok: true }) };
    const spotAccess = {
      resolveBusinessDownloadAccess: jest.fn().mockResolvedValue("denied")
    };
    const service = new ApprovalFormService(
      prisma as never,
      files as never,
      { record: jest.fn() } as never,
      auth as never,
      spotAccess as never
    );
    const repair = jest.spyOn(service, "getOrCreateByBusiness");

    await expect(
      service.renderForDownload(
        "spot_procurement_version",
        "version-1",
        "unrelated-user",
        "current-password",
        "采购审批复核"
      )
    ).rejects.toThrow("当前账号无权下载该零星采购审批单");

    expect(auth.confirmPassword).toHaveBeenCalledWith(
      "unrelated-user",
      "current-password"
    );
    expect(spotAccess.resolveBusinessDownloadAccess).toHaveBeenCalledWith(
      "spot_procurement_version",
      "version-1",
      "unrelated-user"
    );
    expect(repair).not.toHaveBeenCalled();
    expect(files.uploadPrivateFile).not.toHaveBeenCalled();
    expect(files.assertCanDownloadFileById).not.toHaveBeenCalled();
  });

  it("does not expose internal user accounts in approval form names or watermark", async () => {
    const prisma = buildPrisma({
      pdfDocument: {
        findFirst: jest.fn().mockResolvedValue({ id: "pdf-1", fileId: "file-1" }),
        create: jest.fn()
      },
      user: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null)
      }
    });
    const files = {
      uploadPrivateFile: jest.fn(),
      assertCanDownloadApprovalFormByBusiness: jest.fn().mockResolvedValue(undefined),
      assertCanDownloadFileById: jest.fn().mockResolvedValue(undefined)
    };
    const audit = { record: jest.fn() };
    const auth = { confirmPassword: jest.fn().mockResolvedValue({ ok: true }) };
    const service = new ApprovalFormService(
      prisma as never,
      files as never,
      audit as never,
      auth as never
    );
    const renderPdf = jest.fn().mockResolvedValue(Buffer.from("%PDF-test"));
    (service as unknown as { renderPdf: typeof renderPdf }).renderPdf = renderPdf;

    await service.renderForDownload(
      "payment_request",
      "pay-1",
      "downloader-internal-id",
      "current-password",
      "付款审批复核"
    );

    expect(renderPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        applicantName: "申请人未读取",
        watermark: expect.arrayContaining(["下载人：下载人未读取"]),
        logs: [
          expect.objectContaining({
            name: "处理人未读取"
          })
        ]
      })
    );
  });

  it("rejects approval-form downloads without current password confirmation", async () => {
    const service = new ApprovalFormService(
      buildPrisma() as never,
      { assertCanDownloadFileById: jest.fn() } as never,
      { record: jest.fn() } as never,
      { confirmPassword: jest.fn() } as never
    );

    await expect(
      service.renderForDownload("payment_request", "pay-1", "user-chair", "", "付款审批复核")
    ).rejects.toThrow("审批单下载密码必填");
  });

  it("uses business message when downloading approval form before approval completion", async () => {
    const prisma = buildPrisma({
      approvalInstance: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null)
      },
      pdfDocument: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn()
      }
    });
    const service = new ApprovalFormService(
      prisma as never,
      {
        assertCanDownloadApprovalFormByBusiness: jest.fn().mockRejectedValue(
          new Error("当前业务尚未完成审批，暂不能下载审批单")
        ),
        assertCanDownloadFileById: jest.fn()
      } as never,
      { record: jest.fn() } as never,
      { confirmPassword: jest.fn().mockResolvedValue({ ok: true }) } as never
    );

    await expect(
      service.renderForDownload(
        "payment_request",
        "pay-1",
        "user-chair",
        "current-password",
        "付款审批复核"
      )
    ).rejects.toThrow("当前业务尚未完成审批，暂不能下载审批单");
  });

  it("uses business message when completed approval disappears before approval form download", async () => {
    const prisma = buildPrisma({
      approvalInstance: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null)
      },
      pdfDocument: {
        findFirst: jest.fn().mockResolvedValue({ id: "pdf-1", fileId: "file-1" }),
        create: jest.fn()
      }
    });
    const service = new ApprovalFormService(
      prisma as never,
      {
        assertCanDownloadApprovalFormByBusiness: jest.fn().mockResolvedValue(undefined),
        assertCanDownloadFileById: jest.fn().mockResolvedValue(undefined)
      } as never,
      { record: jest.fn() } as never,
      { confirmPassword: jest.fn().mockResolvedValue({ ok: true }) } as never
    );

    await expect(
      service.renderForDownload(
        "payment_request",
        "pay-1",
        "user-chair",
        "current-password",
        "付款审批复核"
      )
    ).rejects.toThrow("当前业务尚未完成审批，暂不能下载审批单");
  });

  it("skips generation when the approval is not completed", async () => {
    const prisma = buildPrisma({
      approvalInstance: {
        findUnique: jest.fn().mockResolvedValue({ id: "inst-1", status: "in_progress" })
      }
    });
    const files = { uploadPrivateFile: jest.fn() };
    const service = new ApprovalFormService(prisma as never, files as never, { record: jest.fn() } as never);

    const result = await service.generateForInstance("inst-1", "user-chair");

    expect(result).toBeNull();
    expect(files.uploadPrivateFile).not.toHaveBeenCalled();
  });

  it("为零星采购申请和付款组装共享审批单摘要", async () => {
    const prisma = {
      spotProcurementVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-spot-1",
          procurementId: "procurement-1",
          versionNo: 1,
          reason: "临时增加砌筑作业面",
          supplierNameSnapshot: "利民建材店",
          totalAmountCents: 1350n,
          status: "approval_pending"
        })
      },
      spotProcurement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "procurement-1",
          projectId: "project-1",
          code: "LXCG-001",
          supplierNameSnapshot: "利民建材店"
        })
      },
      spotProcurementLine: {
        findMany: jest.fn().mockResolvedValue([
          {
            sortOrder: 1,
            materialName: "免烧砖",
            specification: "240×115×53",
            unit: "块",
            quantity: { toString: () => "3" },
            invoiceMode: "invoice",
            invoiceType: "vat_special",
            vatRateLabelSnapshot: "13%",
            unitPrice: { toString: () => "4.5" },
            amountCents: 1350n,
            note: "现场急用"
          },
          {
            sortOrder: 2,
            materialName: "水泥",
            specification: "P.O 42.5",
            unit: "袋",
            quantity: { toString: () => "2" },
            invoiceMode: "invoice",
            invoiceType: "vat_general",
            vatRateLabelSnapshot: "3%",
            unitPrice: { toString: () => "20" },
            amountCents: 4000n,
            note: null
          },
          {
            sortOrder: 3,
            materialName: "手套",
            specification: null,
            unit: "包",
            quantity: { toString: () => "1" },
            invoiceMode: "no_invoice",
            invoiceType: null,
            vatRateLabelSnapshot: null,
            unitPrice: { toString: () => "8" },
            amountCents: 800n,
            note: null
          }
        ])
      },
      project: {
        findUnique: jest.fn().mockResolvedValue({ id: "project-1", name: "一号项目" })
      },
      spotProcurementPayment: {
        findUnique: jest.fn().mockResolvedValue({
          id: "spot-payment-1",
          procurementId: "procurement-1",
          procurementVersionId: "version-spot-1",
          projectId: "project-1",
          code: "LXCG-001-V1-P001",
          settlementAmountCents: 1350n,
          supplierBalanceAmountCents: 300n,
          companyPaymentAmountCents: 1050n,
          paidAmountCents: 500n,
          canceledAmountCents: 0n,
          status: "partially_paid"
        })
      },
      spotProcurementPaymentExecution: {
        findMany: jest.fn().mockResolvedValue([
          {
            amountCents: 500n,
            paidAt: new Date("2026-07-17T08:00:00.000Z"),
            paymentMethod: "bank_transfer",
            voucherFileId: "voucher-1"
          }
        ])
      },
      spotProcurementDiscrepancy: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      spotProcurementRefund: {
        findUnique: jest.fn().mockResolvedValue(null)
      },
      supplierBalanceEntry: {
        findUnique: jest.fn().mockResolvedValue(null)
      }
    };
    const service = new ApprovalFormService(prisma as never);
    const resolveSummary = (
      service as unknown as {
        resolveBusinessSummary(
          client: unknown,
          businessType: string,
          businessId: string,
          context: { applicantName: string; companyName: string }
        ): Promise<Array<{ label: string; value: string }>>;
      }
    ).resolveBusinessSummary.bind(service);

    const procurementRows = await resolveSummary(
      prisma,
      "spot_procurement_version",
      "version-spot-1",
      { applicantName: "物资员甲", companyName: "" }
    );
    const paymentRows = await resolveSummary(
      prisma,
      "spot_procurement_payment",
      "spot-payment-1",
      { applicantName: "经办人乙", companyName: "" }
    );

    expect(procurementRows).toEqual(
      expect.arrayContaining([
        { label: "项目名称", value: "一号项目" },
        { label: "采购原因", value: "临时增加砌筑作业面" },
        expect.objectContaining({
          label: "材料明细 1",
          value: expect.stringContaining("免烧砖")
        }),
        expect.objectContaining({
          label: "材料明细 2",
          value: expect.stringContaining("水泥")
        }),
        expect.objectContaining({
          label: "材料明细 3",
          value: expect.stringContaining("手套")
        })
      ])
    );
    expect(paymentRows).toEqual(
      expect.arrayContaining([
        { label: "结算申请金额", value: "13.50 元" },
        { label: "供应商余额抵扣", value: "3.00 元" },
        { label: "公司付款申请", value: "10.50 元" },
        { label: "累计实际付款", value: "5.00 元" },
        { label: "付款申请状态", value: "部分已付款" },
        { label: "公司实际付款事实", value: "部分已付" }
      ])
    );
  });

  it("付款审批单展示退款结算且退款不改写公司实际付款事实", async () => {
    const prisma = {
      spotProcurementPayment: {
        findUnique: jest.fn().mockResolvedValue({
          id: "payment-refund-1",
          procurementId: "procurement-1",
          procurementVersionId: "version-1",
          projectId: "project-1",
          code: "LXCG-001-P001",
          status: "partially_paid",
          settlementAmountCents: 1000n,
          supplierBalanceAmountCents: 0n,
          companyPaymentAmountCents: 1000n,
          executedSupplierBalanceAmountCents: 0n,
          canceledAmountCents: 0n,
          canceledCompanyPaymentAmountCents: 0n,
          canceledSupplierBalanceAmountCents: 0n,
          payeeNameSnapshot: "利民建材店"
        })
      },
      spotProcurement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "procurement-1",
          code: "LXCG-001",
          supplierNameSnapshot: "利民建材店"
        })
      },
      project: {
        findUnique: jest.fn().mockResolvedValue({
          name: "一号项目"
        })
      },
      spotProcurementPaymentExecution: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "execution-1",
            amountCents: 900n,
            paidAt: new Date("2026-07-17T08:00:00.000Z"),
            paymentMethod: "bank_transfer",
            voucherFileId: "payment-voucher-1"
          }
        ])
      },
      spotProcurementDiscrepancy: {
        findFirst: jest.fn().mockResolvedValue({
          id: "discrepancy-1",
          procurementId: "procurement-1",
          procurementVersionId: "version-1",
          status: "resolved",
          actualCostCentsSnapshot: 800n,
          shortageAmountCents: 200n,
          canceledUnexecutedAmountCents: 0n,
          overpaidAmountCents: 100n,
          resolutionType: "full_refund",
          supplierBalanceEntryId: null,
          updatedAt: new Date("2026-07-17T09:00:00.000Z")
        })
      },
      spotProcurementRefund: {
        findUnique: jest.fn().mockResolvedValue({
          id: "refund-1",
          discrepancyId: "discrepancy-1",
          procurementId: "procurement-1",
          amountCents: 100n,
          receivedAt: new Date("2026-07-17T10:00:00.000Z"),
          refundMethod: "bank_transfer",
          voucherFileId: "refund-voucher-1"
        })
      },
      supplierBalanceEntry: {
        findUnique: jest.fn().mockResolvedValue(null)
      }
    };
    const service = new ApprovalFormService(
      prisma as never
    ) as unknown as {
      resolveBusinessSummary(
        client: unknown,
        businessType: string,
        businessId: string,
        context: {
          applicantName: string;
          companyName: string;
        }
      ): Promise<Array<{ label: string; value: string }>>;
    };

    const rows = await service.resolveBusinessSummary(
      prisma,
      "spot_procurement_payment",
      "payment-refund-1",
      { applicantName: "经办人", companyName: "" }
    );

    expect(rows).toEqual(
      expect.arrayContaining([
        { label: "累计实际付款", value: "9.00 元" },
        { label: "公司实际付款事实", value: "部分已付" },
        { label: "本次采购实际成本", value: "8.00 元" },
        { label: "少货差额", value: "2.00 元" },
        {
          label: "差异处置",
          value: "已解决；整笔退款"
        },
        {
          label: "已确认到账退款",
          value: expect.stringContaining("1.00 元")
        }
      ])
    );
  });

  it("付款审批单展示整笔转入供应商余额事实", async () => {
    const prisma = {
      spotProcurementPayment: {
        findUnique: jest.fn().mockResolvedValue({
          id: "payment-balance-1",
          procurementId: "procurement-1",
          procurementVersionId: "version-1",
          projectId: "project-1",
          code: "LXCG-001-P001",
          status: "paid",
          settlementAmountCents: 1000n,
          supplierBalanceAmountCents: 0n,
          companyPaymentAmountCents: 1000n,
          executedSupplierBalanceAmountCents: 0n,
          canceledAmountCents: 0n,
          canceledCompanyPaymentAmountCents: 0n,
          canceledSupplierBalanceAmountCents: 0n,
          payeeNameSnapshot: "利民建材店"
        })
      },
      spotProcurement: {
        findUnique: jest.fn().mockResolvedValue({
          code: "LXCG-001",
          supplierNameSnapshot: "利民建材店"
        })
      },
      project: {
        findUnique: jest.fn().mockResolvedValue({
          name: "一号项目"
        })
      },
      spotProcurementPaymentExecution: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "execution-1",
            amountCents: 1000n,
            paidAt: new Date("2026-07-17T08:00:00.000Z"),
            paymentMethod: "bank_transfer",
            voucherFileId: "payment-voucher-1"
          }
        ])
      },
      spotProcurementDiscrepancy: {
        findFirst: jest.fn().mockResolvedValue({
          id: "discrepancy-1",
          procurementId: "procurement-1",
          procurementVersionId: "version-1",
          status: "resolved",
          actualCostCentsSnapshot: 800n,
          shortageAmountCents: 200n,
          canceledUnexecutedAmountCents: 0n,
          overpaidAmountCents: 200n,
          resolutionType: "full_supplier_balance",
          supplierBalanceEntryId: "balance-entry-1",
          updatedAt: new Date("2026-07-17T09:00:00.000Z")
        })
      },
      spotProcurementRefund: {
        findUnique: jest.fn().mockResolvedValue(null)
      },
      supplierBalanceEntry: {
        findUnique: jest.fn().mockResolvedValue({
          id: "balance-entry-1",
          procurementId: "procurement-1",
          entryType: "credit_from_discrepancy",
          availableDeltaCents: 200n,
          reservedDeltaCents: 0n
        })
      }
    };
    const service = new ApprovalFormService(
      prisma as never
    ) as unknown as {
      resolveBusinessSummary(
        client: unknown,
        businessType: string,
        businessId: string,
        context: {
          applicantName: string;
          companyName: string;
        }
      ): Promise<Array<{ label: string; value: string }>>;
    };

    const rows = await service.resolveBusinessSummary(
      prisma,
      "spot_procurement_payment",
      "payment-balance-1",
      { applicantName: "经办人", companyName: "" }
    );

    expect(rows).toEqual(
      expect.arrayContaining([
        {
          label: "差异处置",
          value: "已解决；整笔转供应商余额"
        },
        {
          label: "已转入供应商余额",
          value: "2.00 元"
        }
      ])
    );
  });

  it("零星采购未通过审批时不生成或刷新原始审批单", async () => {
    const prisma: Record<string, unknown> = {
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-1",
          businessType: "spot_procurement_version",
          businessId: "version-spot-1",
          status: "approval_pending",
          applicantUserId: "material-1",
          frozenNodes: [],
          updatedAt: new Date("2026-07-17T08:00:00.000Z")
        })
      },
      approvalActionLog: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([])
      },
      spotProcurementVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-spot-1",
          procurementId: "procurement-1",
          updatedAt: new Date("2026-07-17T08:00:00.000Z")
        })
      },
      spotProcurement: {
        findUnique: jest.fn().mockResolvedValue({ projectId: "project-1", code: "LXCG-001" })
      },
      project: { findUnique: jest.fn().mockResolvedValue({ id: "project-1", name: "一号项目" }) },
      spotProcurementLine: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: { findMany: jest.fn().mockResolvedValue([]) },
      position: { findMany: jest.fn().mockResolvedValue([]) }
    };
    prisma.pdfDocument = { findFirst: jest.fn().mockResolvedValue(null) };
    prisma.auditLog = { findFirst: jest.fn().mockResolvedValue(null) };
    prisma.$transaction = jest.fn(async (callback: (tx: unknown) => unknown) => callback(prisma));
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const files = {
      uploadPrivateFile: jest.fn().mockRejectedValue(new Error("cos://private/secret-token"))
    };
    const service = new ApprovalFormService(prisma as never, files as never, audit as never);
    const tryRefresh = (
      service as unknown as {
        tryRefreshLatestForBusiness(
          businessType: string,
          businessId: string,
          actorUserId: string,
          trigger: string
        ): Promise<void>;
      }
    ).tryRefreshLatestForBusiness.bind(service);

    await expect(
      tryRefresh(
        "spot_procurement_version",
        "version-spot-1",
        "material-1",
        "approval.submit"
      )
    ).resolves.toBeUndefined();
    expect(files.uploadPrivateFile).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("付款审批单只按未作废执行明细判断已付事实", async () => {
    const executions = { findMany: jest.fn().mockResolvedValue([]) };
    const prisma = {
      spotProcurementPayment: {
        findUnique: jest.fn().mockResolvedValue({
          id: "payment-1",
          procurementId: "procurement-1",
          procurementVersionId: "version-1",
          projectId: "project-1",
          code: "LXCG-001-P001",
          settlementAmountCents: 1000n,
          supplierBalanceAmountCents: 0n,
          companyPaymentAmountCents: 1000n,
          paidAmountCents: 999n,
          executedSupplierBalanceAmountCents: 0n,
          canceledAmountCents: 0n,
          canceledCompanyPaymentAmountCents: 0n,
          payeeNameSnapshot: "利民建材店"
        })
      },
      spotProcurement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "procurement-1",
          code: "LXCG-001",
          supplierNameSnapshot: "利民建材店"
        })
      },
      project: { findUnique: jest.fn().mockResolvedValue({ name: "一号项目" }) },
      spotProcurementPaymentExecution: executions,
      spotProcurementDiscrepancy: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      spotProcurementRefund: {
        findUnique: jest.fn().mockResolvedValue(null)
      },
      supplierBalanceEntry: {
        findUnique: jest.fn().mockResolvedValue(null)
      }
    };
    const service = new ApprovalFormService(prisma as never) as unknown as {
      resolveBusinessSummary(
        client: unknown,
        businessType: string,
        businessId: string,
        context: { applicantName: string; companyName: string }
      ): Promise<Array<{ label: string; value: string }>>;
    };

    const rows = await service.resolveBusinessSummary(
      prisma,
      "spot_procurement_payment",
      "payment-1",
      { applicantName: "经办人", companyName: "" }
    );

    expect(executions.findMany).toHaveBeenCalledWith({
      where: { paymentId: "payment-1", voidedAt: null },
      orderBy: [{ paidAt: "asc" }, { id: "asc" }]
    });
    expect(rows).toEqual(
      expect.arrayContaining([
        { label: "累计实际付款", value: "0.00 元" },
        { label: "付款申请状态", value: "状态未读取" },
        { label: "公司实际付款事实", value: "未付款" }
      ])
    );
  });

  it.each([
    ["draft", "草稿", 0n, "未付款"],
    ["approval_pending", "审批中", 0n, "未付款"],
    ["approved_pending_payment", "已审批待付款", 0n, "未付款"],
    ["returned", "已退回", 0n, "未付款"],
    ["rejected", "已驳回", 0n, "未付款"],
    ["withdrawn", "已撤回", 0n, "未付款"],
    ["voided", "已作废", 0n, "未付款"],
    ["partially_paid", "部分已付款", 400n, "部分已付"],
    ["paid", "已付款", 1000n, "已付款"],
    ["settled", "已结清", 1000n, "已付款"],
    ["invalidated", "已失效", 0n, "未付款"]
  ])(
    "付款审批单分开表达业务状态 %s 与有效实付事实",
    async (status, expectedStatus, executionAmountCents, expectedExecutionFact) => {
      const prisma = {
        spotProcurementPayment: {
          findUnique: jest.fn().mockResolvedValue({
            id: "payment-status-1",
            procurementId: "procurement-1",
            procurementVersionId: "version-1",
            projectId: "project-1",
            code: "LXCG-STATUS-P001",
            status,
            settlementAmountCents: 1000n,
            supplierBalanceAmountCents: 0n,
            companyPaymentAmountCents: 1000n,
            executedSupplierBalanceAmountCents: 0n,
            canceledAmountCents: 0n,
            canceledCompanyPaymentAmountCents: 0n,
            payeeNameSnapshot: "利民建材店"
          })
        },
        spotProcurement: {
          findUnique: jest.fn().mockResolvedValue({
            id: "procurement-1",
            code: "LXCG-STATUS",
            supplierNameSnapshot: "利民建材店"
          })
        },
        project: { findUnique: jest.fn().mockResolvedValue({ name: "一号项目" }) },
        spotProcurementPaymentExecution: {
          findMany: jest.fn().mockResolvedValue(
            executionAmountCents > 0n
              ? [
                  {
                    id: "execution-1",
                    amountCents: executionAmountCents,
                    paidAt: new Date("2026-07-17T08:00:00.000Z"),
                    paymentMethod: "bank_transfer",
                    voucherFileId: "voucher-1"
                  }
                ]
              : []
          )
        },
        spotProcurementDiscrepancy: {
          findFirst: jest.fn().mockResolvedValue(null)
        },
        spotProcurementRefund: {
          findUnique: jest.fn().mockResolvedValue(null)
        },
        supplierBalanceEntry: {
          findUnique: jest.fn().mockResolvedValue(null)
        }
      };
      const service = new ApprovalFormService(prisma as never) as unknown as {
        resolveBusinessSummary(
          client: unknown,
          businessType: string,
          businessId: string,
          context: { applicantName: string; companyName: string }
        ): Promise<Array<{ label: string; value: string }>>;
      };

      const rows = await service.resolveBusinessSummary(
        prisma,
        "spot_procurement_payment",
        "payment-status-1",
        { applicantName: "经办人", companyName: "" }
      );

      expect(rows).toEqual(
        expect.arrayContaining([
          { label: "付款申请状态", value: expectedStatus },
          { label: "公司实际付款事实", value: expectedExecutionFact }
        ])
      );
    }
  );

  it("零星采购审批未完成时即使已有内部 PDF 也不开放正式下载", async () => {
    const prisma = {
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({ id: "approval-1", status: "approval_pending" })
      },
      pdfDocument: {
        findFirst: jest.fn().mockResolvedValue({ id: "pdf-1", fileId: "file-1" })
      }
    };
    const service = new ApprovalFormService(prisma as never);

    await expect(
      service.getOrCreateByBusiness(
        "spot_procurement_version",
        "version-1",
        "material-1"
      )
    ).rejects.toThrow("当前业务尚未完成审批，暂不能生成审批单");
    expect(prisma.pdfDocument.findFirst).not.toHaveBeenCalled();
  });

  it("审批通过后只创建一次零星采购原始审批单，后续付款触发不会替换它", async () => {
    const updatedAt = new Date("2026-07-18T08:00:00.000Z");
    const instance = {
      id: "approval-1",
      businessType: "spot_procurement_version",
      businessId: "version-1",
      status: "approved",
      applicantUserId: "material-1",
      frozenNodes: [],
      updatedAt
    };
    const sourceTx = {
      approvalInstance: { findFirst: jest.fn().mockResolvedValue(instance) },
      approvalActionLog: { findFirst: jest.fn().mockResolvedValue({ id: "log-1" }) },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) }
    };
    const associationTx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "version-1" }]),
      approvalInstance: { findFirst: jest.fn().mockResolvedValue(instance) },
      approvalActionLog: { findFirst: jest.fn().mockResolvedValue({ id: "log-1" }) },
      pdfDocument: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "pdf-1", fileId: "file-1" }),
        update: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest
        .fn()
        .mockImplementationOnce(async (callback: (tx: unknown) => unknown) => callback(sourceTx))
        .mockImplementationOnce(async (callback: (tx: unknown) => unknown) => callback(associationTx))
    };
    const files = {
      uploadPrivateFile: jest.fn().mockResolvedValue({ id: "file-1" }),
      linkFileReplacement: jest.fn()
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new ApprovalFormService(prisma as never, files as never, audit as never);
    const internal = service as unknown as {
      buildSpotProcurementApprovalFormInput: jest.Mock;
    };
    internal.buildSpotProcurementApprovalFormInput = jest.fn().mockResolvedValue({
      kind: "application",
      projectName: "一号项目",
      procurementCode: "LXCG-001",
      applicationDepartment: "工程部",
      applicationName: "杨帅",
      purchaserDepartment: "物资部",
      purchaserName: "杨帅",
      requestedArrivalAt: updatedAt,
      reason: "现场急需材料",
      lines: [],
      signatures: {
        materialDirector: { name: "张齐", signedAt: updatedAt },
        projectManager: { name: "马利江", signedAt: updatedAt }
      }
    });

    await expect(
      service.refreshLatestForBusiness(
        "spot_procurement_version",
        "version-1",
        "material-1",
        "approval.approve"
      )
    ).resolves.toEqual({ id: "pdf-1", fileId: "file-1" });

    expect(associationTx.pdfDocument.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        templateKey: "spot_procurement_approval_original_v1",
        fileId: "file-1"
      })
    });
    expect(associationTx.pdfDocument.update).not.toHaveBeenCalled();
    expect(files.linkFileReplacement).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      associationTx,
      expect.objectContaining({ action: "approval.form.freeze" })
    );
  });

  it("真实付款、退款或发票后的派生触发只复用已冻结原件", async () => {
    const instance = {
      id: "approval-payment-1",
      businessType: "spot_procurement_payment",
      businessId: "payment-1",
      status: "approved",
      applicantUserId: "handler-1",
      frozenNodes: [],
      updatedAt: new Date("2026-07-18T08:00:00.000Z")
    };
    const currentPdf = { id: "pdf-original", fileId: "file-original" };
    const tx = {
      approvalInstance: { findFirst: jest.fn().mockResolvedValue(instance) },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue(currentPdf) }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: unknown) => unknown) => callback(tx))
    };
    const files = { uploadPrivateFile: jest.fn(), linkFileReplacement: jest.fn() };
    const service = new ApprovalFormService(
      prisma as never,
      files as never,
      { record: jest.fn() } as never
    );

    await expect(
      service.refreshLatestForBusiness(
        "spot_procurement_payment",
        "payment-1",
        "finance-1",
        "payment.execution.record"
      )
    ).resolves.toEqual(currentPdf);

    expect(files.uploadPrivateFile).not.toHaveBeenCalled();
    expect(files.linkFileReplacement).not.toHaveBeenCalled();
  });

  it.skip("旧版：在业务行锁后切换最新 PDF 指针并保留文件替换链", async () => {
    const updatedAt = new Date("2026-07-17T08:00:00.000Z");
    const instance = {
      id: "approval-1",
      businessType: "spot_procurement_version",
      businessId: "version-1",
      status: "approved",
      applicantUserId: "material-1",
      frozenNodes: [],
      updatedAt
    };
    const sourceTx = {
      approvalInstance: { findFirst: jest.fn().mockResolvedValue(instance) },
      approvalActionLog: { findFirst: jest.fn().mockResolvedValue({ id: "log-1" }) },
      spotProcurementVersion: { findUnique: jest.fn().mockResolvedValue({ updatedAt }) },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue({ id: "pdf-1", fileId: "old-file" }) },
      auditLog: { findFirst: jest.fn().mockResolvedValue(null) }
    };
    const associationTx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "version-1" }]),
      approvalInstance: { findFirst: jest.fn().mockResolvedValue(instance) },
      approvalActionLog: { findFirst: jest.fn().mockResolvedValue({ id: "log-1" }) },
      spotProcurementVersion: { findUnique: jest.fn().mockResolvedValue({ updatedAt }) },
      pdfDocument: {
        findFirst: jest.fn().mockResolvedValue({ id: "pdf-1", fileId: "old-file" }),
        update: jest.fn().mockResolvedValue({ id: "pdf-1", fileId: "new-file" }),
        create: jest.fn()
      },
      auditLog: { findFirst: jest.fn().mockResolvedValue(null) }
    };
    const prisma = {
      $transaction: jest
        .fn()
        .mockImplementationOnce(async (callback: (tx: unknown) => unknown) => callback(sourceTx))
        .mockImplementationOnce(async (callback: (tx: unknown) => unknown) => callback(associationTx))
    };
    const files = {
      uploadPrivateFile: jest.fn().mockResolvedValue({ id: "new-file" }),
      linkFileReplacement: jest.fn().mockResolvedValue(undefined)
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new ApprovalFormService(prisma as never, files as never, audit as never);
    const internal = service as unknown as {
      buildRenderInput: jest.Mock;
      renderPdf: jest.Mock;
    };
    internal.buildRenderInput = jest.fn().mockResolvedValue({
      title: "项目零星材料采购申请单",
      companyName: "",
      businessCode: "LXCG-001",
      applicantName: "物资员",
      summary: [],
      nodes: [],
      logs: []
    });
    internal.renderPdf = jest.fn().mockResolvedValue(Buffer.from("%PDF-test"));

    await service.refreshLatestForBusiness(
      "spot_procurement_version",
      "version-1",
      "material-1",
      "approval.approve"
    );

    expect(associationTx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      associationTx.pdfDocument.findFirst.mock.invocationCallOrder[0]
    );
    expect(files.linkFileReplacement).toHaveBeenCalledWith(associationTx, {
      newFileId: "new-file",
      oldFileId: "old-file",
      actorUserId: "material-1"
    });
    expect(associationTx.pdfDocument.update).toHaveBeenCalledWith({
      where: { id: "pdf-1" },
      data: { fileId: "new-file" }
    });
    expect(associationTx.pdfDocument.create).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      associationTx,
      expect.objectContaining({
        action: "approval.form.refresh",
        metadata: expect.objectContaining({
          pdfDocumentId: "pdf-1",
          newFileId: "new-file",
          oldFileId: "old-file",
          trigger: "approval.approve",
          sourceSnapshotToken: expect.objectContaining({
            approvalInstanceId: "approval-1",
            latestActionLogId: "log-1",
            businessUpdatedAt: updatedAt.toISOString()
          })
        })
      })
    );
  });

  it.skip("旧版：实付并发变化时旧快照 PDF 不能覆盖新付款事实", async () => {
    const updatedAt = new Date("2026-07-17T08:00:00.000Z");
    const instance = {
      id: "approval-payment-1",
      businessType: "spot_procurement_payment",
      businessId: "payment-1",
      status: "approved",
      applicantUserId: "material-1",
      frozenNodes: [],
      updatedAt
    };
    const sourceTx = {
      approvalInstance: { findFirst: jest.fn().mockResolvedValue(instance) },
      approvalActionLog: { findFirst: jest.fn().mockResolvedValue({ id: "log-1" }) },
      spotProcurementPayment: {
        findUnique: jest.fn().mockResolvedValue({
          procurementId: "procurement-1",
          procurementVersionId: "version-1",
          updatedAt
        })
      },
      spotProcurementPaymentExecution: { findMany: jest.fn().mockResolvedValue([]) },
      spotProcurementDiscrepancy: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) },
      auditLog: { findFirst: jest.fn() }
    };
    const associationTx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "payment-1" }]),
      approvalInstance: { findFirst: jest.fn().mockResolvedValue(instance) },
      approvalActionLog: { findFirst: jest.fn().mockResolvedValue({ id: "log-1" }) },
      spotProcurementPayment: {
        findUnique: jest.fn().mockResolvedValue({
          procurementId: "procurement-1",
          procurementVersionId: "version-1",
          updatedAt
        })
      },
      spotProcurementPaymentExecution: {
        findMany: jest.fn().mockResolvedValue([{ id: "execution-new", amountCents: 500n }])
      },
      spotProcurementDiscrepancy: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      pdfDocument: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
      auditLog: { findFirst: jest.fn() }
    };
    const cleanupTx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "payment-1" }]),
      pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) },
      fileObject: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    };
    const prisma = {
      $transaction: jest
        .fn()
        .mockImplementationOnce(async (callback: (tx: unknown) => unknown) => callback(sourceTx))
        .mockImplementationOnce(async (callback: (tx: unknown) => unknown) => callback(associationTx))
        .mockImplementationOnce(async (callback: (tx: unknown) => unknown) => callback(cleanupTx))
    };
    const files = {
      uploadPrivateFile: jest.fn().mockResolvedValue({ id: "stale-file" }),
      linkFileReplacement: jest.fn()
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new ApprovalFormService(prisma as never, files as never, audit as never);
    const internal = service as unknown as {
      buildRenderInput: jest.Mock;
      renderPdf: jest.Mock;
    };
    internal.buildRenderInput = jest.fn().mockResolvedValue({
      title: "项目零星材料付款审批单",
      companyName: "",
      businessCode: "LXCG-001-P001",
      applicantName: "经办人",
      summary: [],
      nodes: [],
      logs: []
    });
    internal.renderPdf = jest.fn().mockResolvedValue(Buffer.from("%PDF-stale"));

    await expect(
      service.refreshLatestForBusiness(
        "spot_procurement_payment",
        "payment-1",
        "finance-1",
        "payment.execution.record"
      )
    ).rejects.toThrow("审批或付款事实已变化");
    expect(files.linkFileReplacement).not.toHaveBeenCalled();
    expect(associationTx.pdfDocument.update).not.toHaveBeenCalled();
    expect(associationTx.pdfDocument.create).not.toHaveBeenCalled();
    expect(cleanupTx.pdfDocument.findFirst).toHaveBeenCalledWith({
      where: { fileId: "stale-file" },
      select: { id: true, businessType: true, businessId: true }
    });
    expect(cleanupTx.fileObject.updateMany).toHaveBeenCalledWith({
      where: {
        id: "stale-file",
        uploadedByUserId: "finance-1",
        storageStatus: "active",
        supersedesFileObjectId: null
      },
      data: { storageStatus: "quarantined" }
    });
    expect(audit.record).toHaveBeenCalledWith(
      cleanupTx,
      expect.objectContaining({
        action: "approval.form.orphan_file",
        metadata: expect.objectContaining({
          orphanFileId: "stale-file",
          reason: "stale_snapshot",
          cleanupStatus: "quarantined"
        })
      })
    );
  });

  it.skip("旧版：差异与退款事实变化会改变付款审批单快照", async () => {
    const updatedAt = new Date(
      "2026-07-17T08:00:00.000Z"
    );
    const instance = {
      id: "approval-payment-1",
      updatedAt
    };
    const discrepancyBase = {
      id: "discrepancy-1",
      procurementId: "procurement-1",
      procurementVersionId: "version-1",
      actualCostCentsSnapshot: 800n,
      shortageAmountCents: 200n,
      canceledUnexecutedAmountCents: 0n,
      overpaidAmountCents: 100n,
      resolutionType: "full_refund",
      supplierBalanceEntryId: null
    };
    const buildClient = (
      discrepancy: object,
      refund: object | null
    ) => ({
      approvalActionLog: {
        findFirst: jest.fn().mockResolvedValue({
          id: "log-1"
        })
      },
      spotProcurementPayment: {
        findUnique: jest.fn().mockResolvedValue({
          procurementId: "procurement-1",
          procurementVersionId: "version-1",
          updatedAt
        })
      },
      spotProcurementPaymentExecution: {
        findMany: jest.fn().mockResolvedValue([
          { id: "execution-1", amountCents: 900n }
        ])
      },
      spotProcurementDiscrepancy: {
        findFirst: jest
          .fn()
          .mockResolvedValue(discrepancy)
      },
      spotProcurementRefund: {
        findUnique: jest.fn().mockResolvedValue(refund)
      },
      supplierBalanceEntry: {
        findUnique: jest.fn().mockResolvedValue(null)
      }
    });
    const beforeClient = buildClient(
      {
        ...discrepancyBase,
        status: "awaiting_refund",
        updatedAt: new Date(
          "2026-07-17T08:30:00.000Z"
        )
      },
      null
    );
    const afterClient = buildClient(
      {
        ...discrepancyBase,
        status: "resolved",
        updatedAt: new Date(
          "2026-07-17T09:30:00.000Z"
        )
      },
      {
        id: "refund-1",
        discrepancyId: "discrepancy-1",
        procurementId: "procurement-1",
        amountCents: 100n,
        receivedAt: new Date(
          "2026-07-17T09:00:00.000Z"
        ),
        refundMethod: "bank_transfer",
        voucherFileId: "refund-voucher-1"
      }
    );
    const service = new ApprovalFormService(
      {} as never
    ) as unknown as {
      loadSnapshotToken(
        client: unknown,
        approvalInstance: {
          id: string;
          updatedAt: Date;
        },
        businessType: string,
        businessId: string
      ): Promise<{
        activeExecutionFingerprint: string | null;
      }>;
    };

    const before = await service.loadSnapshotToken(
      beforeClient,
      instance,
      "spot_procurement_payment",
      "payment-1"
    );
    const after = await service.loadSnapshotToken(
      afterClient,
      instance,
      "spot_procurement_payment",
      "payment-1"
    );

    expect(before.activeExecutionFingerprint).not.toBe(
      after.activeExecutionFingerprint
    );
    expect(after.activeExecutionFingerprint).toContain(
      "refund-1"
    );
  });

  it.skip("旧版：上传后发现同一事实已有当前 PDF 时隔离未关联派生文件", async () => {
    const updatedAt = new Date("2026-07-17T08:00:00.000Z");
    const snapshotToken = {
      approvalInstanceId: "approval-1",
      approvalInstanceUpdatedAt: updatedAt.toISOString(),
      latestActionLogId: "log-1",
      businessUpdatedAt: updatedAt.toISOString(),
      activeExecutionFingerprint: null
    };
    const instance = {
      id: "approval-1",
      businessType: "spot_procurement_version",
      businessId: "version-1",
      status: "approved",
      applicantUserId: "material-1",
      frozenNodes: [],
      updatedAt
    };
    const sourceTx = {
      approvalInstance: { findFirst: jest.fn().mockResolvedValue(instance) },
      approvalActionLog: { findFirst: jest.fn().mockResolvedValue({ id: "log-1" }) },
      spotProcurementVersion: { findUnique: jest.fn().mockResolvedValue({ updatedAt }) },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) },
      auditLog: { findFirst: jest.fn() }
    };
    const associationTx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "version-1" }]),
      approvalInstance: { findFirst: jest.fn().mockResolvedValue(instance) },
      approvalActionLog: { findFirst: jest.fn().mockResolvedValue({ id: "log-1" }) },
      spotProcurementVersion: { findUnique: jest.fn().mockResolvedValue({ updatedAt }) },
      pdfDocument: {
        findFirst: jest.fn().mockResolvedValue({ id: "pdf-current", fileId: "file-current" })
      },
      auditLog: {
        findFirst: jest.fn().mockResolvedValue({
          metadata: {
            pdfDocumentId: "pdf-current",
            newFileId: "file-current",
            sourceSnapshotToken: snapshotToken
          }
        })
      }
    };
    const cleanupTx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "version-1" }]),
      pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) },
      fileObject: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    };
    const prisma = {
      $transaction: jest
        .fn()
        .mockImplementationOnce(async (callback: (tx: unknown) => unknown) => callback(sourceTx))
        .mockImplementationOnce(async (callback: (tx: unknown) => unknown) => callback(associationTx))
        .mockImplementationOnce(async (callback: (tx: unknown) => unknown) => callback(cleanupTx))
    };
    const files = {
      uploadPrivateFile: jest.fn().mockResolvedValue({ id: "file-orphan" }),
      linkFileReplacement: jest.fn()
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new ApprovalFormService(prisma as never, files as never, audit as never);
    const internal = service as unknown as { buildRenderInput: jest.Mock; renderPdf: jest.Mock };
    internal.buildRenderInput = jest.fn().mockResolvedValue({
      title: "项目零星材料采购申请单",
      companyName: "",
      businessCode: "LXCG-001",
      applicantName: "物资员",
      summary: [],
      nodes: [],
      logs: []
    });
    internal.renderPdf = jest.fn().mockResolvedValue(Buffer.from("%PDF-orphan"));

    await expect(
      service.refreshLatestForBusiness(
        "spot_procurement_version",
        "version-1",
        "material-1",
        "approval.approve"
      )
    ).resolves.toEqual({ id: "pdf-current", fileId: "file-current" });
    expect(cleanupTx.fileObject.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { storageStatus: "quarantined" } })
    );
    expect(audit.record).toHaveBeenCalledWith(
      cleanupTx,
      expect.objectContaining({
        action: "approval.form.orphan_file",
        metadata: expect.objectContaining({
          orphanFileId: "file-orphan",
          reason: "already_current",
          cleanupStatus: "quarantined"
        })
      })
    );
  });

  it.skip("旧版：关联事务失败时隔离确认未绑定的派生 PDF 并保留原异常", async () => {
    const updatedAt = new Date("2026-07-17T08:00:00.000Z");
    const instance = {
      id: "approval-1",
      businessType: "spot_procurement_version",
      businessId: "version-1",
      applicantUserId: "material-1",
      frozenNodes: [],
      updatedAt
    };
    const sourceTx = {
      approvalInstance: { findFirst: jest.fn().mockResolvedValue(instance) },
      approvalActionLog: { findFirst: jest.fn().mockResolvedValue({ id: "log-1" }) },
      spotProcurementVersion: { findUnique: jest.fn().mockResolvedValue({ updatedAt }) },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) },
      auditLog: { findFirst: jest.fn() }
    };
    const associationError = new Error("association failed with private details");
    const associationTx = {
      $queryRaw: jest.fn().mockRejectedValue(associationError)
    };
    const cleanupTx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "version-1" }]),
      pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) },
      fileObject: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    };
    const prisma = {
      $transaction: jest
        .fn()
        .mockImplementationOnce(async (callback: (tx: unknown) => unknown) => callback(sourceTx))
        .mockImplementationOnce(async (callback: (tx: unknown) => unknown) => callback(associationTx))
        .mockImplementationOnce(async (callback: (tx: unknown) => unknown) => callback(cleanupTx))
    };
    const files = {
      uploadPrivateFile: jest.fn().mockResolvedValue({ id: "file-orphan" }),
      linkFileReplacement: jest.fn()
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new ApprovalFormService(prisma as never, files as never, audit as never);
    const internal = service as unknown as { buildRenderInput: jest.Mock; renderPdf: jest.Mock };
    internal.buildRenderInput = jest.fn().mockResolvedValue({
      title: "项目零星材料采购申请单",
      companyName: "",
      businessCode: "LXCG-001",
      applicantName: "物资员",
      summary: [],
      nodes: [],
      logs: []
    });
    internal.renderPdf = jest.fn().mockResolvedValue(Buffer.from("%PDF-orphan"));

    await expect(
      service.refreshLatestForBusiness(
        "spot_procurement_version",
        "version-1",
        "material-1",
        "approval.approve"
      )
    ).rejects.toBe(associationError);
    expect(cleanupTx.fileObject.updateMany).toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      cleanupTx,
      expect.objectContaining({
        metadata: expect.objectContaining({
          orphanFileId: "file-orphan",
          reason: "association_failed",
          cleanupStatus: "quarantined"
        })
      })
    );
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain("private details");
  });

  it.skip("旧版：关联提交结果不明时若 PDF 已绑定则绝不隔离当前文件", async () => {
    const updatedAt = new Date("2026-07-17T08:00:00.000Z");
    const instance = {
      id: "approval-1",
      businessType: "spot_procurement_version",
      businessId: "version-1",
      applicantUserId: "material-1",
      frozenNodes: [],
      updatedAt
    };
    const sourceTx = {
      approvalInstance: { findFirst: jest.fn().mockResolvedValue(instance) },
      approvalActionLog: { findFirst: jest.fn().mockResolvedValue({ id: "log-1" }) },
      spotProcurementVersion: { findUnique: jest.fn().mockResolvedValue({ updatedAt }) },
      pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) },
      auditLog: { findFirst: jest.fn() }
    };
    const associationError = new Error("commit outcome unknown");
    const cleanupTx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "version-1" }]),
      pdfDocument: {
        findFirst: jest.fn().mockResolvedValue({
          id: "pdf-current",
          businessType: "spot_procurement_version",
          businessId: "version-1"
        })
      },
      fileObject: { updateMany: jest.fn() }
    };
    const prisma = {
      $transaction: jest
        .fn()
        .mockImplementationOnce(async (callback: (tx: unknown) => unknown) => callback(sourceTx))
        .mockRejectedValueOnce(associationError)
        .mockImplementationOnce(async (callback: (tx: unknown) => unknown) => callback(cleanupTx))
    };
    const files = {
      uploadPrivateFile: jest.fn().mockResolvedValue({ id: "file-maybe-current" }),
      linkFileReplacement: jest.fn()
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new ApprovalFormService(prisma as never, files as never, audit as never);
    const internal = service as unknown as { buildRenderInput: jest.Mock; renderPdf: jest.Mock };
    internal.buildRenderInput = jest.fn().mockResolvedValue({
      title: "项目零星材料采购申请单",
      companyName: "",
      businessCode: "LXCG-001",
      applicantName: "物资员",
      summary: [],
      nodes: [],
      logs: []
    });
    internal.renderPdf = jest.fn().mockResolvedValue(Buffer.from("%PDF-current"));

    await expect(
      service.refreshLatestForBusiness(
        "spot_procurement_version",
        "version-1",
        "material-1",
        "approval.approve"
      )
    ).rejects.toBe(associationError);
    expect(cleanupTx.fileObject.updateMany).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      cleanupTx,
      expect.objectContaining({
        metadata: expect.objectContaining({
          orphanFileId: "file-maybe-current",
          cleanupStatus: "bound_pdf_preserved",
          boundPdfDocumentId: "pdf-current"
        })
      })
    );
  });

  it.skip("旧版：关联结果不明且已被下一版替换时保留合法历史 PDF", async () => {
    const cleanupTx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "version-1" }]),
      // 当前指针已指向下一版，所以本文件不再直接绑定 PdfDocument。
      pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) },
      fileObject: {
        // 下一版 FileObject 已把它作为被替换前驱，证明它是合法历史件。
        findFirst: jest.fn().mockResolvedValue({ id: "file-next" }),
        updateMany: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (tx: unknown) => unknown) => callback(cleanupTx))
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new ApprovalFormService(
      prisma as never,
      { uploadPrivateFile: jest.fn() } as never,
      audit as never
    ) as unknown as {
      handleUnlinkedApprovalFormFile(input: {
        businessType: string;
        businessId: string;
        actorUserId: string;
        trigger: string;
        orphanFileId: string;
        reason: "association_failed";
      }): Promise<void>;
    };

    await service.handleUnlinkedApprovalFormFile({
      businessType: "spot_procurement_version",
      businessId: "version-1",
      actorUserId: "material-1",
      trigger: "approval.approve",
      orphanFileId: "file-previous-current",
      reason: "association_failed"
    });

    expect(cleanupTx.fileObject.findFirst).toHaveBeenCalledWith({
      where: { supersedesFileObjectId: "file-previous-current" },
      select: { id: true }
    });
    expect(cleanupTx.fileObject.updateMany).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      cleanupTx,
      expect.objectContaining({
        metadata: expect.objectContaining({
          orphanFileId: "file-previous-current",
          cleanupStatus: "bound_replacement_preserved",
          successorFileId: "file-next"
        })
      })
    );
  });

  it.skip("旧版：Read Committed 交错下不把旧 PDF 指针与新刷新审计拼成当前件", async () => {
    const updatedAt = new Date("2026-07-17T08:00:00.000Z");
    const snapshotToken = {
      approvalInstanceId: "approval-1",
      approvalInstanceUpdatedAt: updatedAt.toISOString(),
      latestActionLogId: "log-1",
      businessUpdatedAt: updatedAt.toISOString(),
      activeExecutionFingerprint: null
    };
    const client = {
      pdfDocument: {
        // 第一条 SELECT 读到并发事务提交前的旧指针。
        findFirst: jest.fn().mockResolvedValue({
          id: "pdf-current",
          fileId: "file-old"
        })
      },
      auditLog: {
        // 第二条 SELECT 读到并发事务已提交的新审计。
        findFirst: jest.fn().mockResolvedValue({
          metadata: {
            pdfDocumentId: "pdf-current",
            newFileId: "file-new",
            sourceSnapshotToken: snapshotToken
          }
        })
      }
    };
    const service = new ApprovalFormService({} as never) as unknown as {
      findCurrentPdfForSnapshot(
        client: unknown,
        businessType: string,
        businessId: string,
        token: typeof snapshotToken
      ): Promise<unknown>;
    };

    await expect(
      service.findCurrentPdfForSnapshot(
        client,
        "spot_procurement_version",
        "version-1",
        snapshotToken
      )
    ).resolves.toBeNull();
  });

  it.skip("旧版：同一事实的幂等重试直接复用当前 PDF，不重复替换文件", async () => {
    const updatedAt = new Date("2026-07-17T08:00:00.000Z");
    const snapshotToken = {
      approvalInstanceId: "approval-1",
      approvalInstanceUpdatedAt: updatedAt.toISOString(),
      latestActionLogId: "log-1",
      businessUpdatedAt: updatedAt.toISOString(),
      activeExecutionFingerprint: null
    };
    const tx = {
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-1",
          updatedAt,
          businessType: "spot_procurement_version",
          businessId: "version-1"
        })
      },
      approvalActionLog: { findFirst: jest.fn().mockResolvedValue({ id: "log-1" }) },
      spotProcurementVersion: { findUnique: jest.fn().mockResolvedValue({ updatedAt }) },
      pdfDocument: {
        findFirst: jest.fn().mockResolvedValue({ id: "pdf-current", fileId: "file-current" })
      },
      auditLog: {
        findFirst: jest.fn().mockResolvedValue({
          metadata: {
            pdfDocumentId: "pdf-current",
            newFileId: "file-current",
            sourceSnapshotToken: snapshotToken
          }
        })
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: unknown) => unknown) => callback(tx))
    };
    const files = { uploadPrivateFile: jest.fn(), linkFileReplacement: jest.fn() };
    const service = new ApprovalFormService(
      prisma as never,
      files as never,
      { record: jest.fn() } as never
    );

    await expect(
      service.refreshLatestForBusiness(
        "spot_procurement_version",
        "version-1",
        "material-1",
        "approval.submit"
      )
    ).resolves.toEqual({ id: "pdf-current", fileId: "file-current" });
    expect(files.uploadPrivateFile).not.toHaveBeenCalled();
    expect(files.linkFileReplacement).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
