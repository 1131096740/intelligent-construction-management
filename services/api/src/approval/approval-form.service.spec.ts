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
      "当前可申请余额",
      "发票类型提醒",
      "本次付款金额",
      "收款方名称",
      "开户银行",
      "银行账号",
      "转款手续费",
      "备注"
    ]);
    expect(rows.find((row) => row.label === "本次付款金额")?.value).toBe("1,234.56 元");
    expect(rows.find((row) => row.label === "当前可申请余额")?.value).toBe("—");
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
      currentAvailableCents: 1100000000n
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
      { assertCanDownloadFileById: jest.fn() } as never,
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
      { assertCanDownloadFileById: jest.fn().mockResolvedValue(undefined) } as never,
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
});
