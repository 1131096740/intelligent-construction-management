import { ApprovalFormService } from "./approval-form.service";

// 构造一个「付款审批已通过」的最小 prisma 桩，覆盖 generateForInstance 用到的查询。
function buildPrisma(overrides: Record<string, unknown> = {}) {
  const created = { id: "pdf-1", fileId: "file-1", templateKey: "approval_form" };
  return {
    created,
    approvalInstance: {
      findUnique: jest.fn().mockResolvedValue({
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
      findUnique: jest.fn().mockResolvedValue({ id: "pay-1", projectId: "proj-1", code: "PAY-2026-001" })
    },
    user: {
      findMany: jest.fn().mockResolvedValue([
        { id: "user-applicant", name: "申请人甲" },
        { id: "user-chair", name: "董事长乙" }
      ])
    },
    userPosition: { findMany: jest.fn().mockResolvedValue([]) },
    projectMember: { findMany: jest.fn().mockResolvedValue([]) },
    position: { findMany: jest.fn().mockResolvedValue([]) },
    ...overrides
  };
}

describe("ApprovalFormService", () => {
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
    expect(uploaded?.originalName).toBe("审批单-PAY-2026-001.pdf");
    expect(prisma.pdfDocument.create).toHaveBeenCalledWith({
      data: {
        businessType: "payment_request",
        businessId: "pay-1",
        fileId: "file-1",
        templateKey: "approval_form"
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
