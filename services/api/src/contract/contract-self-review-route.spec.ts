import "reflect-metadata";
import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { PermissionGuard } from "../auth/guards/permission.guard";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { PrismaService } from "../database/prisma.service";
import { ContractWorkbenchService } from "../contract-workbench/contract-workbench.service";
import { ContractAuthorizationService } from "./contract-authorization.service";
import { ContractController } from "./contract.controller";
import { ContractFormalFileService } from "./contract-formal-file.service";
import { ContractReadService } from "./contract-read.service";
import { ContractSealService } from "./contract-seal.service";
import { ContractService } from "./contract.service";

const contractVersionId = "contract-version-self-review-1";
const projectId = "project-self-review-1";
const directorId = "director-handler-1";
const projectDirectorId = "project-director-1";
const projectManagerId = "project-manager-1";

describe("Issue #15 contract self-review routes", () => {
  let app: INestApplication | undefined;
  const contracts = { reviewApproval: jest.fn().mockResolvedValue({ status: "in_approval" }) };
  const seals = {
    uploadFinal: jest.fn().mockResolvedValue({ id: "formal-file-1" }),
    confirmArchive: jest.fn().mockResolvedValue({ status: "effective" })
  };
  const globalRoleKeysByUser: Record<string, string[]> = {
    [directorId]: ["contract_director"],
    "super-admin-1": ["super_admin"]
  };
  const projectRoleKeysByUser: Record<string, string[]> = {
    [projectDirectorId]: ["contract_director"],
    [projectManagerId]: ["project_manager"]
  };
  const positionByKey = new Map([
    ["contract_director", { id: "position-contract-director", key: "contract_director" }],
    ["project_manager", { id: "position-project-manager", key: "project_manager" }],
    ["super_admin", { id: "position-super-admin", key: "super_admin" }]
  ]);
  const prisma = {
    contractVersion: {
      findUnique: jest.fn().mockResolvedValue({ contractId: "contract-self-review-1" })
    },
    contract: {
      findUnique: jest.fn().mockResolvedValue({ projectId })
    },
    userPosition: {
      findMany: jest.fn().mockImplementation(({ where }: { where: { userId: string; projectId: string | null } }) => {
        const roleKeys = where.projectId === null
          ? globalRoleKeysByUser[where.userId] ?? []
          : projectRoleKeysByUser[where.userId] ?? [];
        return roleKeys.map((roleKey) => ({
          positionId: positionByKey.get(roleKey)?.id
        }));
      })
    },
    projectMember: { findMany: jest.fn().mockResolvedValue([]) },
    position: {
      findMany: jest.fn().mockImplementation(({ where }: { where: { id: { in: string[] } } }) =>
        [...positionByKey.values()].filter((position) => where.id.in.includes(position.id))
      )
    },
    approvalInstance: { findFirst: jest.fn() }
  };
  let currentFrozenNode: Record<string, unknown>;

  beforeEach(() => {
    currentFrozenNode = {
      name: "合同部主管",
      roleKeys: ["contract_director"],
      candidateUserIdsByRole: { contract_director: [directorId, projectDirectorId] }
    };
    prisma.approvalInstance.findFirst.mockImplementation(() => Promise.resolve({
      frozenNodes: [currentFrozenNode],
      currentNodeIndex: 0
    }));
    contracts.reviewApproval.mockClear();
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ContractController],
      providers: [
        { provide: ContractService, useValue: contracts },
        { provide: ContractReadService, useValue: {} },
        { provide: ContractWorkbenchService, useValue: {} },
        { provide: ProjectVisibilityService, useValue: {} },
        { provide: ContractFormalFileService, useValue: {} },
        { provide: ContractAuthorizationService, useValue: {} },
        { provide: ContractSealService, useValue: seals },
        { provide: PrismaService, useValue: prisma }
      ]
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalGuards(new PermissionGuard(new Reflector(), prisma as never));
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.use((
      request: { user?: unknown; headers: Record<string, string | string[] | undefined> },
      _response: unknown,
      next: () => void
    ) => {
      const userId = typeof request.headers["x-test-user"] === "string"
        ? request.headers["x-test-user"]
        : directorId;
      request.user = { id: userId, name: userId, phone: null };
      next();
    });
    await app.listen(0, "127.0.0.1");
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it("allows only the current multi-role director frozen at the contract-director node to review", async () => {
    const url = `${await app!.getUrl()}/contracts/${contractVersionId}/approval`;
    const body = reviewBody();

    const allowed = await post(url, directorId, body);
    expect(allowed.status).toBe(201);
    expect(contracts.reviewApproval).toHaveBeenCalledWith(contractVersionId, directorId, body);

    const otherRequiredRole = await post(url, projectManagerId, body);
    expect(otherRequiredRole.status).toBe(403);
    const superAdmin = await post(url, "super-admin-1", body);
    expect(superAdmin.status).toBe(403);
  });

  it("enforces inferred scopes for a legacy governed contract route through HTTP", async () => {
    const url = `${await app!.getUrl()}/contracts/${contractVersionId}/approval`;
    const body = reviewBody();

    const globalDirector = await post(url, directorId, body);
    expect(globalDirector.status).toBe(201);

    const transferredToProjectRole = await post(url, projectDirectorId, body);
    expect(transferredToProjectRole.status).toBe(403);

    currentFrozenNode = {
      name: "项目经理",
      roleKeys: ["project_manager"],
      candidateUserIdsByRole: { project_manager: [projectManagerId] }
    };
    const projectManager = await post(url, projectManagerId, body);
    expect(projectManager.status).toBe(201);
    expect(contracts.reviewApproval).toHaveBeenCalledTimes(2);
  });

  it("allows the narrowed final-upload route for a contract director but not super_admin", async () => {
    const url = `${await app!.getUrl()}/contracts/${contractVersionId}/formal-files/final`;
    const body = finalFileBody();

    const director = await post(url, directorId, body);
    expect(director.status).toBe(201);
    expect(seals.uploadFinal).toHaveBeenCalledWith(contractVersionId, directorId, body);

    const superAdmin = await post(url, "super-admin-1", body);
    expect(superAdmin.status).toBe(403);
  });

  it("allows the same current contract director to reach final archive confirmation, never super_admin", async () => {
    const url = `${await app!.getUrl()}/contracts/${contractVersionId}/formal-files/final/confirmation`;
    const body = finalConfirmationBody();

    const director = await post(url, directorId, body);
    expect(director.status).toBe(201);
    expect(seals.confirmArchive).toHaveBeenCalledWith(contractVersionId, directorId, body);

    const superAdmin = await post(url, "super-admin-1", body);
    expect(superAdmin.status).toBe(403);
  });

  function post(url: string, userId: string, body: Record<string, unknown>) {
    return fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user": userId },
      body: JSON.stringify(body)
    });
  }
});

function reviewBody() {
  return {
    decision: "approve",
    expectedContractUpdatedAt: "2026-08-08T00:00:00.000Z",
    expectedApprovalInstanceId: "approval-self-review-1",
    expectedNodeIndex: 0,
    expectedApprovalUpdatedAt: "2026-08-08T00:00:01.000Z"
  };
}

function finalFileBody() {
  return {
    fileId: "private-final-file-1",
    sourceRevision: 1,
    firstPartySignedOrStamped: true,
    companySealCompleted: true,
    crossPageSealCompleted: true,
    signingDateCompleted: true,
    onlyPermittedSignatureChanges: true,
    documentOrderConfirmed: true
  };
}

function finalConfirmationBody() {
  return {
    formalFileId: "formal-file-1",
    firstPartySignedOrStamped: true,
    companySealCompleted: true,
    crossPageSealCompleted: true,
    signingDateCompleted: true,
    onlyPermittedSignatureChanges: true,
    documentOrderConfirmed: true
  };
}
