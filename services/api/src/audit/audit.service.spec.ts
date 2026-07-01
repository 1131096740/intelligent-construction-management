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
});
