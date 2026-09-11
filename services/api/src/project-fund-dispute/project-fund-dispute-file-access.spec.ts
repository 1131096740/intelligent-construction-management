import { ForbiddenException } from "@nestjs/common";

import { FileService } from "../file/file.service";

describe("project fund dispute evidence file access", () => {
  function createService(role: string, scope: "project" | "global" = "project") {
    const file = {
      id: "dispute-evidence-1",
      bucket: "private-local",
      objectKey: "uploads/dispute-evidence-1.pdf",
      originalName: "一般争议资金依据.pdf",
      mimeType: "application/pdf",
      sizeBytes: 12,
      uploadedByUserId: "evidence-uploader",
      storageStatus: "active",
      contentSha256: "a".repeat(64)
    };
    const emptyDelegate = {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null)
    };
    const tx = new Proxy(
      {
        fileObject: { findUnique: jest.fn().mockResolvedValue(file) },
        projectFundDisputeEntry: {
          findFirst: jest.fn().mockResolvedValue({
            dispute: { projectId: "project-1" }
          })
        },
        userPosition: {
          findMany: jest.fn().mockImplementation(({ where }: { where: { projectId: string | null } }) =>
            Promise.resolve(scope === "global" && where.projectId === null
              ? [{ positionId: "position-1", projectId: null }]
              : []))
        },
        position: {
          findMany: jest.fn().mockResolvedValue(scope === "global"
            ? [{ id: "position-1", key: role }]
            : [])
        },
        projectMember: {
          findMany: jest.fn().mockResolvedValue(scope === "project"
            ? [{ positionKey: role }]
            : [])
        }
      },
      {
        get(target, key) {
          if (key === "projectFundDisputeEntry" && !(key in target)) {
            return undefined;
          }
          return key in target
            ? target[key as keyof typeof target]
            : emptyDelegate;
        }
      }
    );
    const prisma = {
      $transaction: jest.fn(async (work: (client: typeof tx) => unknown) => work(tx))
    };
    const audit = { record: jest.fn() };
    const spotAccess = {
      resolveFileDownloadAccess: jest.fn().mockResolvedValue("not_spot")
    };
    const service = new FileService(
      prisma as never,
      audit as never,
      {} as never,
      spotAccess as never
    );
    return { service, tx };
  }

  it("allows only the new detail-read roles through the short-lived ticket seam", async () => {
    const { service, tx } = createService("project_manager");

    const ticket = await service.createDownloadTicket("dispute-evidence-1", {
      actorUserId: "project-manager-1",
      downloadReason: "见证一般争议资金依据"
    });

    expect(ticket.downloadUrl).toContain("expiresAt=");
    expect(tx.projectFundDisputeEntry.findFirst).toHaveBeenCalledWith({
      where: { evidenceFileId: "dispute-evidence-1" },
      select: { dispute: { select: { projectId: true } } }
    });
  });

  it("denies even the original uploader after the file is bound to a dispute", async () => {
    const { service } = createService("employee");

    await expect(service.createDownloadTicket("dispute-evidence-1", {
      actorUserId: "evidence-uploader",
      downloadReason: "查看一般争议资金依据"
    })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.createDownloadTicket("dispute-evidence-1", {
      actorUserId: "evidence-uploader",
      downloadReason: "查看一般争议资金依据"
    })).rejects.toThrow("当前账号无权下载该一般争议资金依据");
  });

  it("rejects a globally assigned project-only role for another project's evidence", async () => {
    const { service } = createService("project_manager", "global");

    await expect(service.createDownloadTicket("dispute-evidence-1", {
      actorUserId: "global-project-manager-1",
      downloadReason: "跨项目查看一般争议资金依据"
    })).rejects.toThrow("当前账号无权下载该一般争议资金依据");
  });

  it("keeps an allowed global business role able to review dispute evidence", async () => {
    const { service } = createService("finance_director", "global");

    await expect(service.createDownloadTicket("dispute-evidence-1", {
      actorUserId: "global-finance-director-1",
      downloadReason: "复核一般争议资金依据"
    })).resolves.toMatchObject({
      downloadUrl: expect.stringContaining("expiresAt=")
    });
  });

  it("keeps dispute evidence ACL fail-closed when the generated delegate is stale", async () => {
    const { service, tx } = createService("employee");
    const rawLookup = jest.fn().mockResolvedValue([{ projectId: "project-1" }]);
    Reflect.deleteProperty(tx, "projectFundDisputeEntry");
    Reflect.set(tx, "$queryRaw", rawLookup);

    await expect(service.createDownloadTicket("dispute-evidence-1", {
      actorUserId: "evidence-uploader",
      downloadReason: "查看一般争议资金依据"
    })).rejects.toThrow("当前账号无权下载该一般争议资金依据");
    expect(rawLookup).toHaveBeenCalledTimes(1);
  });
});
