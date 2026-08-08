import "reflect-metadata";
import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { AuditService } from "../audit/audit.service";
import { PermissionGuard } from "../auth/guards/permission.guard";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { ContractWorkbenchService } from "../contract-workbench/contract-workbench.service";
import { PrismaService } from "../database/prisma.service";
import { ContractAuthorizationService } from "./contract-authorization.service";
import { ContractController } from "./contract.controller";
import { ContractFormalFileService } from "./contract-formal-file.service";
import { ContractReadService } from "./contract-read.service";
import { ContractSealService } from "./contract-seal.service";
import { ContractService } from "./contract.service";

const contractVersionId = "contract-version-final-route-1";
const contractId = "contract-final-route-1";
const projectId = "project-final-route-1";
const globalDirectorHandlerId = "global-director-handler-1";
const projectDirectorId = "project-director-1";
const superAdminId = "super-admin-1";

describe("Issue #15 final archive real HTTP integration", () => {
  let app: INestApplication | undefined;
  let sealService: ContractSealService | undefined;
  const auditEntries: Array<Record<string, unknown>> = [];
  const version = {
    id: contractVersionId,
    contractId,
    status: "seal_approved_pending_archive",
    contractGovernanceVersion: 1,
    draftRevision: 1,
    changeType: "original",
    baseVersionId: null
  };
  const task = {
    id: "seal-task-final-route-1",
    contractVersionId,
    handlerUserId: globalDirectorHandlerId,
    status: "completed"
  };
  const original = {
    id: "approval-original-final-route-1",
    contractVersionId,
    purpose: "approval_original",
    fileId: "approval-original-file-1",
    contentSha256: "b".repeat(64),
    pageCount: 1,
    sourceRevision: 1,
    status: "active"
  };
  const formalRecords: Array<Record<string, unknown>> = [original];
  const fileObjects = new Map<string, Record<string, unknown>>([
    ["approval-original-file-1", {
      id: "approval-original-file-1",
      uploadedByUserId: "staff-1",
      storageStatus: "active",
      mimeType: "application/pdf",
      sizeBytes: 100,
      contentSha256: "b".repeat(64)
    }],
    ["final-upload-file-1", {
      id: "final-upload-file-1",
      uploadedByUserId: globalDirectorHandlerId,
      storageStatus: "active",
      mimeType: "image/png",
      sizeBytes: 120,
      contentSha256: "a".repeat(64)
    }]
  ]);
  const globalRoleUserIds = new Set([globalDirectorHandlerId]);
  const projectRoleUserIds = new Set([projectDirectorId]);
  const superAdminUserIds = new Set([superAdminId]);
  const positions = [
    { id: "position-contract-director", key: "contract_director" },
    { id: "position-super-admin", key: "super_admin" }
  ];

  const tx = {
    $queryRaw: jest.fn(),
    contractVersion: {
      findUnique: jest.fn().mockImplementation(() => Promise.resolve(version)),
      updateMany: jest.fn().mockImplementation(({ data }: { data: { status: string } }) => {
        version.status = data.status;
        return Promise.resolve({ count: 1 });
      })
    },
    contractSealTask: { findFirst: jest.fn().mockResolvedValue(task) },
    contract: { findUnique: jest.fn().mockResolvedValue({ projectId, contractTypeKey: "material_purchase" }) },
    contractFormalFile: {
      findFirst: jest.fn().mockImplementation(({ where }: { where: Record<string, unknown> }) => {
        if (typeof where.id === "string") {
          return Promise.resolve(formalRecords.find((record) => record.id === where.id) ?? null);
        }
        if (where.purpose === "approval_original") return Promise.resolve(original);
        if (where.purpose === "mutually_signed_final") {
          return Promise.resolve(formalRecords.find((record) =>
            record.purpose === "mutually_signed_final" && record.status === "active"
          ) ?? null);
        }
        if (typeof where.fileId === "string") {
          return Promise.resolve(formalRecords.find((record) => record.fileId === where.fileId) ?? null);
        }
        return Promise.resolve(null);
      }),
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        const created = { id: "final-record-1", ...data };
        formalRecords.push(created);
        return Promise.resolve(created);
      }),
      update: jest.fn().mockImplementation(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const record = formalRecords.find((item) => item.id === where.id);
        if (record) Object.assign(record, data);
        return Promise.resolve(record);
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 })
    },
    contractAuthorization: { findFirst: jest.fn().mockResolvedValue(null) },
    position: {
      findUnique: jest.fn().mockImplementation(({ where }: { where: { key: string } }) =>
        Promise.resolve(positions.find((position) => position.key === where.key) ?? null)
      ),
      findMany: jest.fn().mockImplementation(({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(positions.filter((position) => where.id.in.includes(position.id)))
      )
    },
    user: {
      findUnique: jest.fn().mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve({ id: where.id, isActive: true })
      )
    },
    userPosition: {
      findMany: jest.fn().mockImplementation(({ where }: { where: { userId: string; projectId: string | null } }) => {
        const roleUserIds = where.projectId === null ? globalRoleUserIds : projectRoleUserIds;
        return Promise.resolve(roleUserIds.has(where.userId)
          ? [{ positionId: "position-contract-director", projectId: where.projectId }]
          : superAdminUserIds.has(where.userId) && where.projectId === null
            ? [{ positionId: "position-super-admin", projectId: null }]
            : []);
      }),
      findFirst: jest.fn().mockImplementation(({ where }: { where: { userId: string; projectId: string | null; positionId: string } }) =>
        Promise.resolve(
          where.projectId === null &&
          where.positionId === "position-contract-director" &&
          globalRoleUserIds.has(where.userId)
            ? { id: "global-contract-director-assignment" }
            : null
        )
      )
    },
    projectMember: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null)
    },
    paymentTermsVersion: { findFirst: jest.fn().mockResolvedValue({ id: "terms-final-route-1" }) },
    paymentTermsStage: {
      findMany: jest.fn().mockResolvedValue([{
        id: "stage-final-route-1",
        stageType: "progress",
        basis: "current_settlement",
        ratioBps: 10000,
        fixedAmountCents: null,
        triggerAnchor: "settlement_effective",
        dueDays: 30
      }])
    },
    auditLog: {
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        auditEntries.push(data);
        return Promise.resolve({ id: `audit-${auditEntries.length}`, ...data });
      })
    }
  };
  const prisma = {
    $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)),
    get contractVersion() { return tx.contractVersion; },
    get contractSealTask() { return tx.contractSealTask; },
    get contract() { return tx.contract; },
    get contractFormalFile() { return tx.contractFormalFile; },
    get position() { return tx.position; },
    get user() { return tx.user; },
    get userPosition() { return tx.userPosition; },
    get projectMember() { return tx.projectMember; },
    get auditLog() { return tx.auditLog; }
  };

  beforeEach(() => {
    Object.assign(version, { status: "seal_approved_pending_archive" });
    task.handlerUserId = globalDirectorHandlerId;
    formalRecords.splice(0, formalRecords.length, original);
    auditEntries.splice(0, auditEntries.length);
    Object.assign(fileObjects.get("final-upload-file-1")!, {
      uploadedByUserId: globalDirectorHandlerId
    });
    globalRoleUserIds.clear();
    globalRoleUserIds.add(globalDirectorHandlerId);
    projectRoleUserIds.clear();
    projectRoleUserIds.add(projectDirectorId);
    tx.$queryRaw.mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([version])
      .mockResolvedValueOnce([task])
      .mockResolvedValueOnce([fileObjects.get("final-upload-file-1")])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([version])
      .mockResolvedValueOnce([task])
      .mockResolvedValueOnce([
        fileObjects.get("final-upload-file-1"),
        fileObjects.get("approval-original-file-1")
      ]);
  });

  beforeAll(async () => {
    const formalFiles = {
      inspectOwnedStoredFinalArchive: jest.fn().mockResolvedValue({
        sha256: "a".repeat(64),
        pageCount: 1,
        fileSnapshot: {
          storageStatus: "active",
          mimeType: "image/png",
          sizeBytes: 120,
          contentSha256: "a".repeat(64)
        }
      }),
      inspectLinkedStoredFinalArchive: jest.fn().mockResolvedValue({
        sha256: "a".repeat(64),
        pageCount: 1,
        fileSnapshot: {
          storageStatus: "active",
          mimeType: "image/png",
          sizeBytes: 120,
          contentSha256: "a".repeat(64)
        }
      }),
      inspectLinkedStoredPdf: jest.fn().mockResolvedValue({
        sha256: "b".repeat(64),
        pageCount: 1,
        fileSnapshot: {
          storageStatus: "active",
          mimeType: "application/pdf",
          sizeBytes: 100,
          contentSha256: "b".repeat(64)
        }
      })
    };
    const activation = {
      activate: jest.fn().mockImplementation(async () => {
        version.status = "effective";
        return { effectiveVersion: { ...version }, supersededVersionId: null };
      })
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [ContractController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: new AuditService(prisma as never) },
        {
          provide: ContractSealService,
          useFactory: (audit: AuditService) => new ContractSealService(
            prisma as never,
            audit,
            formalFiles as never,
            undefined,
            activation as never
          ),
          inject: [AuditService]
        },
        { provide: ContractService, useValue: {} },
        { provide: ContractReadService, useValue: {} },
        { provide: ContractWorkbenchService, useValue: {} },
        { provide: ProjectVisibilityService, useValue: {} },
        { provide: ContractFormalFileService, useValue: {} },
        { provide: ContractAuthorizationService, useValue: {} }
      ]
    }).compile();
    sealService = moduleRef.get(ContractSealService);
    app = moduleRef.createNestApplication();
    app.useGlobalGuards(new PermissionGuard(new Reflector(), prisma as never));
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.use((request: { user?: unknown; headers: Record<string, string | string[] | undefined> }, _response: unknown, next: () => void) => {
      request.user = {
        id: typeof request.headers["x-test-user"] === "string"
          ? request.headers["x-test-user"]
          : globalDirectorHandlerId,
        name: "route-test-user",
        phone: null
      };
      next();
    });
    await app.listen(0, "127.0.0.1");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it("blocks a project-scoped director handler at the HTTP guard, then permits the same handler after transfer to the current global role", async () => {
    const uploadUrl = `${await app!.getUrl()}/contracts/${contractVersionId}/formal-files/final`;
    const confirmUrl = `${uploadUrl}/confirmation`;
    task.handlerUserId = projectDirectorId;
    Object.assign(fileObjects.get("final-upload-file-1")!, { uploadedByUserId: projectDirectorId });
    const uploadSpy = jest.spyOn(sealService!, "uploadFinal");
    const confirmSpy = jest.spyOn(sealService!, "confirmArchive");

    await expect(post(uploadUrl, projectDirectorId, uploadBody())).resolves.toMatchObject({ status: 403 });
    expect(uploadSpy).not.toHaveBeenCalled();

    projectRoleUserIds.delete(projectDirectorId);
    globalRoleUserIds.add(projectDirectorId);

    const uploaded = await post(uploadUrl, projectDirectorId, uploadBody());
    expect(uploaded.status).toBe(201);
    const confirmed = await post(confirmUrl, projectDirectorId, confirmBody());
    expect(confirmed.status).toBe(201);
    expect(confirmSpy).toHaveBeenCalledWith(contractVersionId, projectDirectorId, expect.any(Object));
    expect(auditEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actorUserId: projectDirectorId,
        action: "contract.formal_file.final_upload",
        metadata: expect.objectContaining({
          archiveActionAttribution: expect.objectContaining({ actingRoleKey: "contract_director" })
        })
      }),
      expect.objectContaining({
        actorUserId: projectDirectorId,
        action: "contract.archive.confirm",
        metadata: expect.objectContaining({ selfReview: true })
      })
    ]));
  });

  it("runs the real HTTP upload and self-confirmation chain only for the current global director handler", async () => {
    const uploadUrl = `${await app!.getUrl()}/contracts/${contractVersionId}/formal-files/final`;
    const confirmUrl = `${uploadUrl}/confirmation`;

    const uploadSpy = jest.spyOn(sealService!, "uploadFinal");
    await expect(post(uploadUrl, projectDirectorId, uploadBody())).resolves.toMatchObject({ status: 403 });
    expect(uploadSpy).not.toHaveBeenCalled();
    await expect(post(uploadUrl, superAdminId, uploadBody())).resolves.toMatchObject({ status: 403 });

    const uploaded = await post(uploadUrl, globalDirectorHandlerId, uploadBody());
    expect(uploaded.status).toBe(201);
    expect(await uploaded.json()).toMatchObject({ id: "final-record-1", uploadedByUserId: globalDirectorHandlerId });

    const confirmSpy = jest.spyOn(sealService!, "confirmArchive");
    await expect(post(confirmUrl, projectDirectorId, confirmBody())).resolves.toMatchObject({ status: 403 });
    expect(confirmSpy).not.toHaveBeenCalled();
    await expect(post(confirmUrl, superAdminId, confirmBody())).resolves.toMatchObject({ status: 403 });

    const confirmed = await post(confirmUrl, globalDirectorHandlerId, confirmBody());
    expect(confirmed.status).toBe(201);
    expect(await confirmed.json()).toMatchObject({ id: contractVersionId, status: "effective" });
    expect(auditEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actorUserId: globalDirectorHandlerId,
        action: "contract.formal_file.final_upload",
        businessId: contractVersionId,
        metadata: expect.objectContaining({
          archiveActionAttribution: {
            actingRoleKey: "contract_director",
            representedUserId: globalDirectorHandlerId,
            nodeKey: "contract.final_archive",
            nodeRoleKey: "contract_director",
            sealTaskId: task.id,
            handlerUserId: globalDirectorHandlerId,
            businessType: "contract_version",
            businessId: contractVersionId,
            projectId
          }
        })
      }),
      expect.objectContaining({
        actorUserId: globalDirectorHandlerId,
        action: "contract.archive.confirm",
        businessId: contractVersionId,
        metadata: expect.objectContaining({
          selfReview: true,
          selfReviewRoleKey: "contract_director",
          archiveActionAttribution: expect.objectContaining({
            actingRoleKey: "contract_director",
            handlerUserId: globalDirectorHandlerId,
            businessId: contractVersionId,
            projectId
          })
        })
      })
    ]));
    expect(auditEntries).toHaveLength(2);
  });

  function post(url: string, userId: string, body: Record<string, unknown>) {
    return fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user": userId },
      body: JSON.stringify(body)
    });
  }
});

function uploadBody() {
  return {
    fileId: "final-upload-file-1",
    sourceRevision: 1,
    firstPartySignedOrStamped: true,
    companySealCompleted: true,
    crossPageSealCompleted: true,
    signingDateCompleted: true,
    onlyPermittedSignatureChanges: true,
    documentOrderConfirmed: true
  };
}

function confirmBody() {
  return {
    formalFileId: "final-record-1",
    firstPartySignedOrStamped: true,
    companySealCompleted: true,
    crossPageSealCompleted: true,
    signingDateCompleted: true,
    onlyPermittedSignatureChanges: true,
    documentOrderConfirmed: true
  };
}
