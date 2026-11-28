import { ConflictException, NotFoundException } from "@nestjs/common";
import { ContractTakeoverHandoverService } from "./contract-takeover-handover.service";

type EventRow = {
  id: string;
  idempotencyKey: string;
  takeoverId: string;
  side: string;
  action: string;
  revision: number;
  observedOtherSideRevision: number | null;
  observedFinanceBasisRevision: number | null;
  reason: string | null;
  actorUserId: string;
  responseSnapshot: unknown;
  createdAt: Date;
};

function buildFakePrisma(options: {
  takeover?: Record<string, unknown> | null;
  positions?: Record<string, string>;
  events?: EventRow[];
} = {}) {
  const events: EventRow[] = options.events ? [...options.events] : [];
  const positions = options.positions ?? {
    "user-contract": "contract_staff",
    "user-finance": "finance_staff",
    "user-supervisor": "contract_director",
    "user-other": "project_manager",
    "user-contract-2": "contract_staff",
    "user-inactive": "contract_staff"
  };
  const users = new Map<string, { id: string; name: string; isActive: boolean; phone: string }>();
  for (const id of Object.keys(positions)) {
    users.set(id, { id, name: `姓名-${id}`, isActive: id !== "user-inactive", phone: "13900000000" });
  }
  const takeover = options.takeover === undefined ? {
    id: "takeover-1",
    projectId: "project-1",
    contractId: "contract-1",
    contractVersionId: "version-1",
    takeoverStatus: "draft",
    takeoverLevel: "",
    confirmedAt: null
  } : options.takeover;
  const positionIdByKey = new Map(
    [...new Set(Object.values(positions))].map((key) => [`position-${key}`, key])
  );
  const userPositionIdByUser = new Map(
    Object.entries(positions).map(([userId, key]) => [userId, `position-${key}`])
  );
  const fake = {
    contractTakeover: {
      findFirst: jest.fn(async ({ where }: { where: { id: string; projectId: string } }) =>
        takeover && takeover.id === where.id && takeover.projectId === where.projectId ? takeover : null
      ),
      update: jest.fn(),
      create: jest.fn()
    },
    contractTakeoverConfirmationEvent: {
      findFirst: jest.fn(async () => {
        const latest = [...events].sort((a, b) => b.revision - a.revision)[0];
        return latest ?? null;
      }),
      findMany: jest.fn(async () => [...events].sort((a, b) => a.revision - b.revision)),
      findUnique: jest.fn(async ({ where }: { where: { idempotencyKey: string } }) =>
        events.find((event) => event.idempotencyKey === where.idempotencyKey) ?? null
      ),
      create: jest.fn(async ({ data }: { data: EventRow }) => {
        const row = { ...data, createdAt: new Date() };
        events.push(row);
        return row;
      })
    },
    user: {
      findMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.flatMap((id) => (users.has(id) ? [users.get(id)!] : []))
      )
    },
    userPosition: {
      findMany: jest.fn(async ({ where }: { where: { userId: { in: string[] } } }) =>
        where.userId.in.flatMap((userId) =>
          userPositionIdByUser.has(userId)
            ? [{ userId, positionId: userPositionIdByUser.get(userId)! }]
            : []
        )
      )
    },
    position: {
      findMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.flatMap((id) =>
          positionIdByKey.has(id) ? [{ id, key: positionIdByKey.get(id)! }] : []
        )
      )
    },
    projectMember: {
      findMany: jest.fn(async () => [])
    },
    $transaction: jest.fn(async (callback: (tx: unknown) => unknown): Promise<unknown> => callback(fake))
  };
  return { fake, events };
}

describe("ContractTakeoverHandoverService", () => {
  it("registers the three duties on a no-grade takeover without changing takeover facts", async () => {
    const { fake, events } = buildFakePrisma();
    const audit = { record: jest.fn() };
    const service = new ContractTakeoverHandoverService(fake as never, audit as never);

    const result = await service.register("project-1", "takeover-1", "user-supervisor", {
      contractUserId: "user-contract",
      financeUserId: "user-finance",
      supervisorUserId: "user-supervisor",
      idempotencyKey: "11111111-1111-4111-8111-111111111111"
    });

    expect(result).toMatchObject({
      takeoverId: "takeover-1",
      requiresHandover: true,
      registered: true,
      revision: 1,
      actorDuty: "supervisor"
    });
    expect(result.assignments.map((item) => [item.duty, item.userId])).toEqual([
      ["contract", "user-contract"],
      ["finance", "user-finance"],
      ["supervisor", "user-supervisor"]
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ side: "handover", action: "handover_register", revision: 1 });
    expect(fake.contractTakeover.update).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      fake,
      expect.objectContaining({ action: "contract_takeover.handover.register", actorUserId: "user-supervisor" })
    );
  });

  it("requires a reason and keeps history when a duty holder is replaced", async () => {
    const { fake, events } = buildFakePrisma();
    const audit = { record: jest.fn() };
    const service = new ContractTakeoverHandoverService(fake as never, audit as never);
    await service.register("project-1", "takeover-1", "user-supervisor", {
      contractUserId: "user-contract",
      financeUserId: "user-finance",
      supervisorUserId: "user-supervisor",
      idempotencyKey: "11111111-1111-4111-8111-111111111111"
    });

    await expect(
      service.register("project-1", "takeover-1", "user-supervisor", {
        contractUserId: "user-contract-2",
        financeUserId: "user-finance",
        supervisorUserId: "user-supervisor",
        idempotencyKey: "22222222-2222-4222-8222-222222222222"
      })
    ).rejects.toThrow("更换接管责任人必须填写原因");

    const result = await service.register("project-1", "takeover-1", "user-supervisor", {
      contractUserId: "user-contract-2",
      financeUserId: "user-finance",
      supervisorUserId: "user-supervisor",
      reason: "原合同经办调岗",
      idempotencyKey: "33333333-3333-4333-8333-333333333333"
    });
    expect(result.revision).toBe(2);
    expect(result.assignments.find((item) => item.duty === "contract")?.userId).toBe("user-contract-2");
    expect(result.history.map((item) => [item.revision, item.action, item.reason])).toEqual([
      [1, "handover_register", null],
      [2, "handover_reassign", "原合同经办调岗"]
    ]);
    expect(events).toHaveLength(2);
    expect(events[1].responseSnapshot).toMatchObject({
      revision: 2,
      previousAssignments: { contract: "user-contract" }
    });
    expect(audit.record).toHaveBeenLastCalledWith(
      fake,
      expect.objectContaining({
        action: "contract_takeover.handover.reassign",
        metadata: expect.objectContaining({ reason: "原合同经办调岗" })
      })
    );
  });

  it("rejects a duty holder without the matching business position", async () => {
    const { fake } = buildFakePrisma();
    const service = new ContractTakeoverHandoverService(fake as never, { record: jest.fn() } as never);
    await expect(
      service.register("project-1", "takeover-1", "user-supervisor", {
        contractUserId: "user-other",
        financeUserId: "user-finance",
        supervisorUserId: "user-supervisor",
        idempotencyKey: "11111111-1111-4111-8111-111111111111"
      })
    ).rejects.toThrow("合同办理负责人需为合同员或合同部主管");
  });

  it("rejects inactive users", async () => {
    const { fake } = buildFakePrisma();
    const service = new ContractTakeoverHandoverService(fake as never, { record: jest.fn() } as never);
    await expect(
      service.register("project-1", "takeover-1", "user-supervisor", {
        contractUserId: "user-inactive",
        financeUserId: "user-finance",
        supervisorUserId: "user-supervisor",
        idempotencyKey: "11111111-1111-4111-8111-111111111111"
      })
    ).rejects.toThrow("合同办理负责人不存在或已停用");
  });

  it("replays the same idempotency key without writing a second event", async () => {
    const { fake, events } = buildFakePrisma();
    const service = new ContractTakeoverHandoverService(fake as never, { record: jest.fn() } as never);
    const input = {
      contractUserId: "user-contract",
      financeUserId: "user-finance",
      supervisorUserId: "user-supervisor",
      idempotencyKey: "44444444-4444-4444-8444-444444444444"
    };
    await service.register("project-1", "takeover-1", "user-supervisor", input);
    const replay = await service.register("project-1", "takeover-1", "user-supervisor", input);
    expect(replay.revision).toBe(1);
    expect(events).toHaveLength(1);
  });

  it("rejects a takeover outside the project", async () => {
    const { fake } = buildFakePrisma();
    const service = new ContractTakeoverHandoverService(fake as never, { record: jest.fn() } as never);
    await expect(service.read("other-project", "takeover-1", "user-supervisor")).rejects.toThrow(
      NotFoundException
    );
  });

  it("rejects a null takeover", async () => {
    const { fake } = buildFakePrisma({ takeover: null });
    const service = new ContractTakeoverHandoverService(fake as never, { record: jest.fn() } as never);
    await expect(service.read("project-1", "takeover-1", "user-supervisor")).rejects.toThrow(
      NotFoundException
    );
  });

  it("does not let an idempotency key be reused for another takeover", async () => {
    const { fake } = buildFakePrisma();
    const service = new ContractTakeoverHandoverService(fake as never, { record: jest.fn() } as never);
    await service.register("project-1", "takeover-1", "user-supervisor", {
      contractUserId: "user-contract",
      financeUserId: "user-finance",
      supervisorUserId: "user-supervisor",
      idempotencyKey: "55555555-5555-4555-8555-555555555555"
    });
    await expect(
      service.register("project-1", "takeover-1", "user-contract", {
        contractUserId: "user-contract",
        financeUserId: "user-finance",
        supervisorUserId: "user-supervisor",
        idempotencyKey: "55555555-5555-4555-8555-555555555555"
      })
    ).rejects.toThrow(ConflictException);
  });
});
