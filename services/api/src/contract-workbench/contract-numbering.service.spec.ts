import { ForbiddenException } from "@nestjs/common";
import { ContractNumberingService } from "./contract-numbering.service";

describe("ContractNumberingService", () => {
  const audit = { record: jest.fn() };

  beforeEach(() => {
    audit.record.mockReset();
  });

  function roleTx(roleKey: string) {
    return {
      userPosition: {
        findMany: jest.fn().mockResolvedValue([{ positionId: `position-${roleKey}` }])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([{ key: roleKey }])
      }
    };
  }

  it("allows only global contract staff to list active rules", async () => {
    const prisma = {
      ...roleTx("contract_staff"),
      contractNumberRule: {
        findMany: jest.fn().mockResolvedValue([{ id: "rule-1", isActive: true }])
      }
    };
    const service = new ContractNumberingService(prisma as never, audit as never);

    await expect(service.listActive("staff-1")).resolves.toHaveLength(1);
    expect(prisma.contractNumberRule.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: { createdAt: "asc" }
    });
  });

  it("requires a global contract director to create rules", async () => {
    const tx = {
      ...roleTx("contract_staff"),
      contractNumberRule: { create: jest.fn() }
    };
    const service = new ContractNumberingService(
      { $transaction: jest.fn(async (callback) => callback(tx)) } as never,
      audit as never
    );

    await expect(
      service.create("staff-1", {
        name: "材料合同",
        pattern: "HT-{project}-{year}-{sequence}",
        sequenceWidth: 3
      })
    ).rejects.toThrow(ForbiddenException);
  });

  it("rejects unknown numbering tokens", async () => {
    const tx = {
      ...roleTx("contract_director"),
      contractNumberRule: { create: jest.fn() }
    };
    const service = new ContractNumberingService(
      { $transaction: jest.fn(async (callback) => callback(tx)) } as never,
      audit as never
    );

    expect(() =>
      service.create("director-1", {
        name: "错误规则",
        pattern: "HT-{unknown}-{sequence}",
        sequenceWidth: 3
      })
    ).toThrow("合同编号规则包含未支持的占位符");
  });

  it("uses Chinese business errors when formal numbering cannot be allocated", async () => {
    const activeRule = {
      id: "rule-1",
      name: "材料合同",
      pattern: "HT-{sequence}",
      companyEntityId: null,
      projectId: null,
      contractTypeKey: null,
      nextSequence: 7,
      sequenceWidth: 3,
      isActive: true
    };
    const contract = {
      projectId: "project-1",
      contractTypeKey: "material_purchase",
      companyEntityId: null,
      companyEntityName: null
    };
    const service = new ContractNumberingService({} as never, audit as never);

    await expect(
      service.allocate(
        {
          $queryRaw: jest.fn().mockResolvedValue([]),
          contractNumberRule: { update: jest.fn() },
          contract: { findFirst: jest.fn() }
        } as never,
        "rule-missing",
        contract,
        "staff-1",
        {}
      )
    ).rejects.toThrow("未找到所选合同编号规则");

    await expect(
      service.allocate(
        {
          $queryRaw: jest.fn().mockResolvedValue([{ ...activeRule, isActive: false }]),
          contractNumberRule: { update: jest.fn() },
          contract: { findFirst: jest.fn() }
        } as never,
        "rule-1",
        contract,
        "staff-1",
        {}
      )
    ).rejects.toThrow("所选合同编号规则已停用");

    await expect(
      service.allocate(
        {
          $queryRaw: jest.fn().mockResolvedValue([activeRule]),
          ...roleTx("contract_director"),
          contractNumberRule: { update: jest.fn() },
          contract: { findFirst: jest.fn().mockResolvedValue(null) }
        } as never,
        "rule-1",
        contract,
        "director-1",
        { formalCodeOverride: "HT-MANUAL-001" }
      )
    ).rejects.toThrow("手工指定正式合同编号时请填写调整原因");

    await expect(
      service.allocate(
        {
          $queryRaw: jest.fn().mockResolvedValue([activeRule]),
          contractNumberRule: { update: jest.fn() },
          contract: { findFirst: jest.fn().mockResolvedValue(null) }
        } as never,
        "rule-1",
        contract,
        "staff-1",
        { overrideReason: "历史编号衔接" }
      )
    ).rejects.toThrow("填写编号调整原因时必须同步填写手工正式合同编号");

    await expect(
      service.allocate(
        {
          $queryRaw: jest.fn().mockResolvedValue([activeRule]),
          contractNumberRule: { update: jest.fn() },
          contract: { findFirst: jest.fn().mockResolvedValue({ id: "contract-1" }) }
        } as never,
        "rule-1",
        contract,
        "staff-1",
        {}
      )
    ).rejects.toThrow("正式合同编号已存在");
  });

  it("allocates unique formal numbers under a row lock", async () => {
    let nextSequence = 1;
    let queue = Promise.resolve();
    const tx = {
      $queryRaw: jest.fn(
        () =>
          new Promise<Array<Record<string, unknown>>>((resolve) => {
            queue = queue.then(() => {
              const current = nextSequence;
              nextSequence += 1;
              resolve([
                {
                  id: "rule-1",
                  name: "材料合同",
                  pattern: "HT-{project}-{year}-{type}-{sequence}",
                  companyEntityId: null,
                  projectId: "project-1",
                  contractTypeKey: "material_purchase",
                  nextSequence: current,
                  sequenceWidth: 3,
                  isActive: true
                }
              ]);
            });
          })
      ),
      contractNumberRule: {
        update: jest.fn().mockImplementation(async () => ({ nextSequence }))
      },
      project: {
        findUnique: jest.fn().mockResolvedValue({ id: "project-1", code: "JGXM" })
      },
      contract: { findFirst: jest.fn().mockResolvedValue(null) }
    };
    const service = new ContractNumberingService({} as never, audit as never);
    const contract = {
      projectId: "project-1",
      contractTypeKey: "material_purchase",
      companyEntityId: null,
      companyEntityName: null
    };

    const [first, second] = await Promise.all([
      service.allocate(tx as never, "rule-1", contract, "staff-1", {}, new Date("2026-06-25")),
      service.allocate(tx as never, "rule-1", contract, "staff-1", {}, new Date("2026-06-25"))
    ]);

    expect([first, second]).toEqual([
      "HT-JGXM-2026-材料-001",
      "HT-JGXM-2026-材料-002"
    ]);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.contractNumberRule.update).toHaveBeenCalledTimes(2);
  });

  it("allows a director manual override only with a reason", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: "rule-1",
          name: "材料合同",
          pattern: "HT-{sequence}",
          companyEntityId: null,
          projectId: null,
          contractTypeKey: null,
          nextSequence: 7,
          sequenceWidth: 3,
          isActive: true
        }
      ]),
      ...roleTx("contract_director"),
      contract: { findFirst: jest.fn().mockResolvedValue(null) },
      contractNumberRule: { update: jest.fn() }
    };
    const service = new ContractNumberingService({} as never, audit as never);

    await expect(
      service.allocate(
        tx as never,
        "rule-1",
        {
          projectId: "project-1",
          contractTypeKey: "material_purchase",
          companyEntityId: null,
          companyEntityName: null
        },
        "director-1",
        { formalCodeOverride: "HT-MANUAL-001", overrideReason: "历史编号衔接" }
      )
    ).resolves.toBe("HT-MANUAL-001");
    expect(tx.contractNumberRule.update).not.toHaveBeenCalled();
  });

  it("rejects a manual override from contract staff", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: "rule-1",
          name: "材料合同",
          pattern: "HT-{sequence}",
          companyEntityId: null,
          projectId: null,
          contractTypeKey: null,
          nextSequence: 7,
          sequenceWidth: 3,
          isActive: true
        }
      ]),
      ...roleTx("contract_staff"),
      contract: { findFirst: jest.fn().mockResolvedValue(null) },
      contractNumberRule: { update: jest.fn() }
    };
    const service = new ContractNumberingService({} as never, audit as never);

    await expect(
      service.allocate(
        tx as never,
        "rule-1",
        {
          projectId: "project-1",
          contractTypeKey: "material_purchase",
          companyEntityId: null,
          companyEntityName: null
        },
        "staff-1",
        { formalCodeOverride: "HT-MANUAL-001", overrideReason: "历史编号衔接" }
      )
    ).rejects.toThrow(ForbiddenException);
  });

  it("uses a Chinese fallback label for an unknown contract type token", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: "rule-1",
          name: "材料合同",
          pattern: "HT-{type}-{sequence}",
          companyEntityId: null,
          projectId: null,
          contractTypeKey: null,
          nextSequence: 1,
          sequenceWidth: 3,
          isActive: true
        }
      ]),
      contractNumberRule: {
        update: jest.fn().mockResolvedValue({ nextSequence: 2 })
      },
      contract: { findFirst: jest.fn().mockResolvedValue(null) }
    };
    const service = new ContractNumberingService({} as never, audit as never);
    const contract = {
      projectId: "project-1",
      contractTypeKey: "0",
      companyEntityId: null,
      companyEntityName: null
    };

    const code = await service.allocate(tx as never, "rule-1", contract, "staff-1", {});

    expect(code).toBe("HT-其他-001");
  });

  it("never reuses a consumed sequence after a later contract is voided", async () => {
    let nextSequence = 5;
    const tx = {
      $queryRaw: jest.fn().mockImplementation(async () => [
        {
          id: "rule-1",
          name: "材料合同",
          pattern: "HT-{sequence}",
          companyEntityId: null,
          projectId: null,
          contractTypeKey: null,
          nextSequence,
          sequenceWidth: 3,
          isActive: true
        }
      ]),
      contractNumberRule: {
        update: jest.fn().mockImplementation(async () => {
          nextSequence += 1;
        })
      },
      contract: { findFirst: jest.fn().mockResolvedValue(null) }
    };
    const service = new ContractNumberingService({} as never, audit as never);
    const contract = {
      projectId: "project-1",
      contractTypeKey: "material_purchase",
      companyEntityId: null,
      companyEntityName: null
    };

    expect(
      await service.allocate(tx as never, "rule-1", contract, "staff-1", {})
    ).toBe("HT-005");
    // Voiding the first contract never changes ContractNumberRule.nextSequence.
    expect(
      await service.allocate(tx as never, "rule-1", contract, "staff-1", {})
    ).toBe("HT-006");
  });
});
