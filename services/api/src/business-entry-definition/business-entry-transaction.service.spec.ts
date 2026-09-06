import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  createBusinessEntryDefinitionRegistry,
  type BusinessEntrySceneDefinition
} from "@jiangkong/shared-domain";
import { BusinessEntryTransactionService } from "./business-entry-transaction.service";
import { createBusinessEntryTransactionSceneRegistry } from "./business-entry-transaction-scene-registry";

const definition: BusinessEntrySceneDefinition = {
  key: "contract_formal_entry",
  entityType: "contract_version",
  name: "合同正式录入",
  description: "测试正式合同对象的事务快照。",
  version: 2,
  fields: [{
    key: "name",
    label: "合同名称",
    description: "合同名称。",
    example: "示例合同",
    type: "text",
    scope: "header",
    unit: "",
    precision: 0,
    required: true,
    permissions: { view: ["contract_staff"], edit: ["contract_staff"] },
    display: {
      formHint: "填写合同名称",
      gridColumn: "合同名称",
      mobilePriority: 1,
      readonlyText: "以冻结值为准"
    },
    excel: { column: "合同名称", paste: "single", errorLocation: "cell" },
    bulk: { enabled: false, strategy: "replace" }
  }],
  rules: []
};

const target = {
  projectId: "project-1",
  entityType: "contract_version",
  entityId: "contract-version-1"
} as const;

function harness(options: {
  ownership?: unknown[];
  roles?: string[];
  entityType?: string;
} = {}) {
  const resolveOwnership = jest.fn().mockResolvedValue(
    options.ownership ?? [{ projectId: "project-1" }]
  );
  const resolveAuthorization = jest.fn().mockResolvedValue(
    options.roles ?? ["contract_staff"]
  );
  const snapshots = {
    saveStandalone: jest.fn(),
    saveInTransaction: jest.fn().mockImplementation(
      async (_tx, _projectId, _actorUserId, snapshot) => snapshot
    )
  };
  const service = new BusinessEntryTransactionService(
    createBusinessEntryDefinitionRegistry([definition]),
    createBusinessEntryTransactionSceneRegistry([{
      sceneKey: definition.key,
      targetKind: "project_owned_entity",
      entityType: options.entityType ?? definition.entityType,
      action: "contract.submit",
      resolveOwnership,
      resolveAuthorization
    }]),
    snapshots
  );
  return { service, resolveOwnership, resolveAuthorization, snapshots };
}

describe("BusinessEntryTransactionService", () => {
  it("uses the caller transaction for ownership, domain authorization, drift validation and persistence", async () => {
    const tx = { marker: "caller-transaction" } as unknown as Prisma.TransactionClient;
    const { service, resolveOwnership, resolveAuthorization, snapshots } = harness();

    await expect(service.freezeSubmissionSnapshotInTransaction(
      tx,
      "actor-1",
      {
        sceneKey: definition.key,
        definitionVersion: 2,
        target,
        values: { name: "合同 A" }
      },
      "2026-09-06T01:00:00.000Z"
    )).resolves.toMatchObject({ target, definitionVersion: 2 });

    expect(resolveOwnership).toHaveBeenCalledTimes(2);
    expect(resolveOwnership).toHaveBeenNthCalledWith(1, expect.objectContaining({ tx, target }));
    expect(resolveOwnership).toHaveBeenNthCalledWith(2, expect.objectContaining({ tx, target }));
    expect(resolveAuthorization).toHaveBeenCalledWith(expect.objectContaining({
      tx,
      target,
      actorUserId: "actor-1",
      action: "contract.submit"
    }));
    expect(snapshots.saveInTransaction).toHaveBeenCalledWith(
      tx,
      "project-1",
      "actor-1",
      expect.objectContaining({ target }),
      undefined
    );
    expect(snapshots.saveStandalone).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", [], BadRequestException, "正式业务对象不存在"],
    ["non-unique", [{ projectId: "project-1" }, { projectId: "project-1" }], ConflictException, "正式业务对象归属不唯一"],
    ["cross-project", [{ projectId: "project-2" }], ForbiddenException, "正式业务对象不属于目标项目"]
  ])("fails closed for %s ownership", async (_name, ownership, ErrorType, message) => {
    const { service, snapshots } = harness({ ownership });

    await expect(service.freezeSubmissionSnapshotInTransaction(
      {} as Prisma.TransactionClient,
      "actor-1",
      {
        sceneKey: definition.key,
        definitionVersion: 2,
        target,
        values: { name: "合同 A" }
      }
    )).rejects.toEqual(expect.objectContaining({ constructor: ErrorType, message }));
    expect(snapshots.saveInTransaction).not.toHaveBeenCalled();
  });

  it("rejects an unauthorized actor before any snapshot write", async () => {
    const { service, snapshots } = harness({ roles: ["employee"] });

    await expect(service.freezeSubmissionSnapshotInTransaction(
      {} as Prisma.TransactionClient,
      "actor-1",
      {
        sceneKey: definition.key,
        definitionVersion: 2,
        target,
        values: { name: "合同 A" }
      }
    )).rejects.toThrow("当前账号无权执行事务业务场景动作");
    expect(snapshots.saveInTransaction).not.toHaveBeenCalled();
  });

  it("rejects target and definition drift before persistence", async () => {
    const mismatch = harness({ entityType: "settlement" });
    await expect(mismatch.service.freezeSubmissionSnapshotInTransaction(
      {} as Prisma.TransactionClient,
      "actor-1",
      {
        sceneKey: definition.key,
        definitionVersion: 2,
        target: { ...target, entityType: "settlement" },
        values: { name: "合同 A" }
      }
    )).rejects.toThrow("事务业务场景目标类型与定义不一致");
    expect(mismatch.snapshots.saveInTransaction).not.toHaveBeenCalled();

    const drift = harness();
    drift.resolveOwnership
      .mockResolvedValueOnce([{ projectId: "project-1" }])
      .mockResolvedValueOnce([]);
    await expect(drift.service.freezeSubmissionSnapshotInTransaction(
      {} as Prisma.TransactionClient,
      "actor-1",
      {
        sceneKey: definition.key,
        definitionVersion: 2,
        target,
        values: { name: "合同 A" }
      }
    )).rejects.toThrow("正式业务对象归属在冻结期间发生漂移");
    expect(drift.snapshots.saveInTransaction).not.toHaveBeenCalled();
  });

  it("rejects legacy, incomplete and unregistered targets", async () => {
    const { service, snapshots } = harness();
    const invalidInputs = [
      { entityType: "contract_version", entityId: "contract-version-1" },
      { projectId: "", entityType: "contract_version", entityId: "contract-version-1" },
      { projectId: "project-1", entityType: "settlement", entityId: "contract-version-1" }
    ];
    for (const invalidTarget of invalidInputs) {
      await expect(service.freezeSubmissionSnapshotInTransaction(
        {} as Prisma.TransactionClient,
        "actor-1",
        {
          sceneKey: definition.key,
          definitionVersion: 2,
          target: invalidTarget as never,
          values: { name: "合同 A" }
        }
      )).rejects.toBeInstanceOf(BadRequestException);
    }
    await expect(service.freezeSubmissionSnapshotInTransaction(
      {} as Prisma.TransactionClient,
      "actor-1",
      {
        sceneKey: "settlement_formal_entry",
        definitionVersion: 2,
        target,
        values: { name: "合同 A" }
      }
    )).rejects.toThrow("事务业务场景未登记");
    expect(snapshots.saveInTransaction).not.toHaveBeenCalled();
  });
});
