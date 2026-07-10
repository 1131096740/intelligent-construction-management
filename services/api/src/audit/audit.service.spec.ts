import { AuditService } from "./audit.service";

describe("AuditService", () => {
  it("lists recent audit logs with actor names and summary counts", async () => {
    const prisma = {
      auditLog: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "audit-1",
            actorUserId: "user-1",
            action: "file.download",
            businessType: "file",
            businessId: "file-1",
            ipAddress: "127.0.0.1",
            metadata: { fileId: "file-1" },
            createdAt: new Date("2026-07-01T08:00:00.000Z")
          },
          {
            id: "audit-2",
            actorUserId: null,
            action: "auth.login",
            businessType: null,
            businessId: null,
            ipAddress: null,
            metadata: null,
            createdAt: new Date("2026-07-01T07:00:00.000Z")
          }
        ])
      },
      user: {
        findMany: jest.fn().mockResolvedValue([{ id: "user-1", name: "张三" }])
      }
    };
    const service = new AuditService(prisma as never);

    const result = await service.listRecent("50");

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
      take: 50,
      orderBy: { createdAt: "desc" }
    });
    expect(result.rows[0]).toMatchObject({
      id: "audit-1",
      actor: "张三",
      action: "file.download",
      actionTone: "warning",
      businessTarget: "file-1",
      resultRisk: "需复核"
    });
    expect(result.rows[1].actor).toBe("系统");
    expect(result.summary).toMatchObject({ total: 2, login: 1, file: 1 });
  });

  it("lists file download audits with reason and sanitized trace details", async () => {
    const prisma = {
      auditLog: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "audit-ticket-1",
            actorUserId: "user-1",
            action: "file.download.ticket",
            businessType: "file_object",
            businessId: "file-1",
            ipAddress: null,
            metadata: {
              downloadReason: "合同归档复核",
              expiresAt: "2026-07-01T08:05:00.000Z",
              token: "secret-token",
              cosUrl: "https://cos.example.com/private"
            },
            createdAt: new Date("2026-07-01T08:00:00.000Z")
          },
          {
            id: "audit-download-1",
            actorUserId: "user-1",
            action: "file.download",
            businessType: "file_object",
            businessId: "file-1",
            ipAddress: "127.0.0.1",
            metadata: {
              originalName: "HT-2026-001.pdf",
              sizeBytes: 1024,
              downloadReason: "合同归档复核",
              downloadUrl: "/files/file-1/download?token=secret-token"
            },
            createdAt: new Date("2026-07-01T08:01:00.000Z")
          },
          {
            id: "audit-approval-form-1",
            actorUserId: "user-1",
            action: "approval.form.download",
            businessType: "approval_instance",
            businessId: "approval-1",
            ipAddress: "127.0.0.1",
            metadata: {
              originalName: "合同审批单.pdf",
              downloadReason: "领导复核"
            },
            createdAt: new Date("2026-07-01T08:02:00.000Z")
          },
          {
            id: "audit-settlement-approval-1",
            actorUserId: "user-1",
            action: "settlement.approval_pdf.download",
            businessType: "settlement",
            businessId: "settlement-1",
            ipAddress: "127.0.0.1",
            metadata: {
              originalName: "结算审批单.pdf",
              downloadReason: "结算归档复核"
            },
            createdAt: new Date("2026-07-01T08:03:00.000Z")
          }
        ])
      },
      user: {
        findMany: jest.fn().mockResolvedValue([{ id: "user-1", name: "张三" }])
      },
      fileObject: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "file-1",
            originalName: "HT-2026-001.pdf",
            mimeType: "application/pdf",
            sizeBytes: 1024
          }
        ])
      }
    };
    const service = new AuditService(prisma as never);

    const result = await service.listFileDownloads("20");

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
      take: 20,
      orderBy: { createdAt: "desc" },
      where: {
        action: {
          in: [
            "file.download.ticket",
            "file.download",
            "approval.form.download",
            "settlement.approval_pdf.download"
          ]
        }
      }
    });
    expect(result.rows[0]).toMatchObject({
      id: "audit-ticket-1",
      actor: "张三",
      action: "生成下载票据",
      fileName: "HT-2026-001.pdf",
      downloadReason: "合同归档复核",
      traceId: "audit-ticket-1",
      sensitive: "未返回短链/token/COS地址"
    });
    expect(result.rows.map((row) => row.action)).toEqual([
      "生成下载票据",
      "实际下载",
      "审批单下载",
      "结算审批单下载"
    ]);
    expect(JSON.stringify(result.rows)).not.toContain("secret-token");
    expect(JSON.stringify(result.rows)).not.toContain("cos.example.com");
    expect(result.summary).toEqual({
      total: 4,
      ticket: 1,
      downloaded: 1,
      missingReason: 0
    });
  });

  it("redacts sensitive metadata from generic audit trace output", async () => {
    const prisma = {
      auditLog: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "audit-1",
            actorUserId: null,
            action: "file.download.ticket",
            businessType: null,
            businessId: null,
            ipAddress: null,
            metadata: {
              downloadReason: "合同归档复核",
              token: "secret-token",
              downloadUrl: "/files/file-1/download?token=secret-token"
            },
            createdAt: new Date("2026-07-01T08:00:00.000Z")
          }
        ])
      },
      user: {
        findMany: jest.fn()
      }
    };
    const service = new AuditService(prisma as never);

    const result = await service.listRecent("1");

    expect(result.rows[0].trace).toContain("[redacted]");
    expect(result.rows[0].trace).not.toContain("secret-token");
    expect(result.rows[0].trace).not.toContain("/files/file-1/download");
  });
});
