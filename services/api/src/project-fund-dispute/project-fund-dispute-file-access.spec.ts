import { ForbiddenException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

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
    const bindingQuery = '/* private_file_project_binding */ SELECT dispute."projectId" FROM public."ProjectFundDisputeEntry" entry JOIN public."ProjectFundDispute" dispute ON dispute.id = entry."disputeId" WHERE entry."evidenceFileId" = $1 LIMIT 1';
    const rawLookup = jest.fn(async (query: Prisma.Sql): Promise<Array<{ projectId: string } | { state: string }>> => {
      if (query.text.includes("/* registered_payment_voucher_catalog */")) return [{ state: "absent" }];
      const statement = query.text.replace(/\s+/gu, " ").trim();
      if (query.values.length && query.values.every(value => value === file.id)) {
        if (statement === bindingQuery) return [{ projectId: "project-1" }];
        if (/^\/\* private_file_(offline_revision|expense_attachment|project)_binding \*\//u.test(statement)) {
          if (statement.includes('FROM public."ProjectFundDisputeEntry"')) throw new Error("Unexpected project binding projection");
          return [];
        }
      }
      throw new Error("Unexpected private-file lookup");
    });
    const tx = new Proxy(
      {
        $queryRaw: rawLookup,
        contractTakeoverCorrection: { groupBy: jest.fn().mockResolvedValue([]) },
        fileObject: { findUnique: jest.fn().mockResolvedValue(file) },
        projectFundDisputeEntry: { findFirst: jest.fn() },
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
    return { service, tx, bindingQuery };
  }

  it("allows only the new detail-read roles through the short-lived ticket seam", async () => {
    const { service, tx, bindingQuery } = createService("project_manager");

    const ticket = await service.createDownloadTicket("dispute-evidence-1", {
      actorUserId: "project-manager-1",
      downloadReason: "见证一般争议资金依据"
    });

    expect(ticket.downloadUrl).toContain("expiresAt=");
    expect(tx.$queryRaw.mock.calls.map(([query]) => query.text.replace(/\s+/gu, " ").trim())).toContain(bindingQuery);
    expect(tx.projectFundDisputeEntry.findFirst).not.toHaveBeenCalled();
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
    Reflect.deleteProperty(tx, "projectFundDisputeEntry");
    await expect(service.createDownloadTicket("dispute-evidence-1", {
      actorUserId: "evidence-uploader",
      downloadReason: "查看一般争议资金依据"
    })).rejects.toThrow("当前账号无权下载该一般争议资金依据");
    expect(tx.$queryRaw.mock.calls.map(([query]) => query.text)).toEqual(
      expect.arrayContaining([expect.stringContaining('FROM public."ProjectFundDisputeEntry"')])
    );
  });
});
