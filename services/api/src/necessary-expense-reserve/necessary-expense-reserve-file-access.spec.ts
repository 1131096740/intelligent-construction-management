import { ForbiddenException } from "@nestjs/common";

import { FileService } from "../file/file.service";

describe("necessary-expense reserve evidence file access", () => {
  function createService(role: string, scope: "project" | "global" = "project") {
    const file = {
      id: "reserve-evidence-1",
      bucket: "private-local",
      objectKey: "uploads/reserve-evidence-1.pdf",
      originalName: "必要费用准备依据.pdf",
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
        projectNecessaryExpenseReserveEntry: {
          findFirst: jest.fn().mockResolvedValue({
            reserve: { projectId: "project-1" }
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
          if (key === "projectNecessaryExpenseReserveEntry" && !(key in target)) {
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

    const ticket = await service.createDownloadTicket("reserve-evidence-1", {
      actorUserId: "project-manager-1",
      downloadReason: "见证必要费用准备依据"
    });

    expect(ticket.downloadUrl).toContain("expiresAt=");
    expect(tx.projectNecessaryExpenseReserveEntry.findFirst).toHaveBeenCalledWith({
      where: { evidenceFileId: "reserve-evidence-1" },
      select: { reserve: { select: { projectId: true } } }
    });
  });

  it("denies even the original uploader after the file is bound to a reserve", async () => {
    const { service } = createService("employee");

    await expect(service.createDownloadTicket("reserve-evidence-1", {
      actorUserId: "evidence-uploader",
      downloadReason: "查看必要费用准备依据"
    })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.createDownloadTicket("reserve-evidence-1", {
      actorUserId: "evidence-uploader",
      downloadReason: "查看必要费用准备依据"
    })).rejects.toThrow("当前账号无权下载该必要费用准备依据");
  });

  it("rejects a globally assigned project-only role for another project's evidence", async () => {
    const { service } = createService("project_manager", "global");

    await expect(service.createDownloadTicket("reserve-evidence-1", {
      actorUserId: "global-project-manager-1",
      downloadReason: "跨项目查看必要费用准备依据"
    })).rejects.toThrow("当前账号无权下载该必要费用准备依据");
  });

  it("keeps an allowed global business role able to review reserve evidence", async () => {
    const { service } = createService("finance_director", "global");

    await expect(service.createDownloadTicket("reserve-evidence-1", {
      actorUserId: "global-finance-director-1",
      downloadReason: "复核必要费用准备依据"
    })).resolves.toMatchObject({
      downloadUrl: expect.stringContaining("expiresAt=")
    });
  });

  it("keeps reserve evidence ACL fail-closed when the generated delegate is stale", async () => {
    const { service, tx } = createService("employee");
    const rawLookup = jest.fn().mockResolvedValue([{ projectId: "project-1" }]);
    Reflect.deleteProperty(tx, "projectNecessaryExpenseReserveEntry");
    Reflect.set(tx, "$queryRaw", rawLookup);

    await expect(service.createDownloadTicket("reserve-evidence-1", {
      actorUserId: "evidence-uploader",
      downloadReason: "查看必要费用准备依据"
    })).rejects.toThrow("当前账号无权下载该必要费用准备依据");
    expect(rawLookup).toHaveBeenCalledTimes(1);
  });
});
