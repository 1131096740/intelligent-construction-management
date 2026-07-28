import {
  BadRequestException,
  ForbiddenException,
  NotFoundException
} from "@nestjs/common";
import { ContractDraftAggregateService } from "./contract-draft-aggregate.service";

describe("ContractDraftAggregateService", () => {
  const version = {
    id: "cv-1",
    contractId: "contract-1",
    status: "draft",
    draftRevision: 3,
    draftData: { fieldValues: { name: "精确版本一" } }
  };
  const legacyReadModel = {
    contract: { id: "contract-1", code: null, temporaryCode: "DRAFT-001" },
    version: { ...version },
    lifecycleKind: "pristine_draft",
    checkpoints: [{ id: "legacy-checkpoint" }],
    parties: [],
    bills: [],
    paymentTerms: { originalText: "", stages: [] },
    documents: [],
    readiness: { ready: false, issues: [] }
  };

  function makeService(overrides: {
    foundVersion?: typeof version | null;
    readError?: Error;
  } = {}) {
    const prisma = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue(
          overrides.foundVersion === undefined ? version : overrides.foundVersion
        )
      },
      contractDraftAttachment: {
        findMany: jest.fn().mockResolvedValue([])
      },
      contractDraftEditLease: {
        findUnique: jest.fn().mockResolvedValue(null)
      },
      user: {
        findUnique: jest.fn()
      }
    };
    const workbench = {
      getDraftFromExactVersion: overrides.readError
        ? jest.fn().mockRejectedValue(overrides.readError)
        : jest.fn().mockResolvedValue(legacyReadModel)
    };
    return {
      prisma,
      workbench,
      service: new ContractDraftAggregateService(prisma as never, workbench as never)
    };
  }

  it("loads the requested version id and never asks the legacy service to choose the latest", async () => {
    const { prisma, workbench, service } = makeService();

    const result = await service.getWorkbench("cv-1", "actor-1");

    expect(prisma.contractVersion.findUnique).toHaveBeenCalledWith({
      where: { id: "cv-1" }
    });
    expect(workbench.getDraftFromExactVersion).toHaveBeenCalledWith(version, "actor-1");
    expect(result.version.id).toBe("cv-1");
    expect(result.draft).toEqual(version.draftData);
    expect(result).not.toHaveProperty("checkpoints");
    expect(result.lease).toEqual({
      state: "available",
      holderDisplayName: null,
      expiresAt: null,
      canTakeOver: false
    });
  });

  it("returns stable errors for a missing or non-editable version", async () => {
    await expect(
      makeService({ foundVersion: null }).service.getWorkbench("missing", "actor-1")
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      makeService({ foundVersion: { ...version, status: "effective" } }).service.getWorkbench(
        "cv-1",
        "actor-1"
      )
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("preserves the workbench permission failure", async () => {
    await expect(
      makeService({
        readError: new ForbiddenException("无权查看该合同草稿")
      }).service.getWorkbench("cv-1", "actor-2")
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
