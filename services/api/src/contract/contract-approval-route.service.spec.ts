import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { ContractApprovalRouteService } from "./contract-approval-route.service";

type RouteTx = Pick<Prisma.TransactionClient, "$queryRaw">;

interface CandidateRow {
  userId: string;
  roleKey: string;
}

function txFor(input?: {
  projectActive?: boolean;
  projectApplicantRoles?: CandidateRow[];
  globalApplicantRoles?: CandidateRow[];
  projectCandidates?: CandidateRow[];
  globalCandidates?: CandidateRow[];
}) {
  const responses = [
    input?.projectActive === false ? [{ id: "project-1", isActive: false }] : [{ id: "project-1", isActive: true }],
    input?.projectApplicantRoles ?? [{ userId: "staff-1", roleKey: "contract_staff" }],
    input?.globalApplicantRoles ?? [],
    input?.projectCandidates ?? [
      { userId: "manager-2", roleKey: "project_manager" },
      { userId: "engineer-2", roleKey: "engineering_director" }
    ],
    input?.globalCandidates ?? [
      { userId: "contract-director-2", roleKey: "contract_director" },
      { userId: "material-director-2", roleKey: "material_director" },
      { userId: "comprehensive-director-2", roleKey: "comprehensive_director" },
      { userId: "finance-director-2", roleKey: "finance_director" },
      { userId: "chairman-2", roleKey: "chairman" },
      { userId: "general-manager-2", roleKey: "general_manager" }
    ]
  ];
  const $queryRaw = jest.fn();
  for (const response of responses) {
    $queryRaw.mockResolvedValueOnce(response);
  }
  return { tx: { $queryRaw } as unknown as RouteTx, $queryRaw };
}

function contract(contractTypeKey: string | null, projectId = "project-1") {
  return { id: "contract-1", projectId, contractTypeKey };
}

describe("ContractApprovalRouteService", () => {
  const service = new ContractApprovalRouteService();

  it.each([
    [
      "material_purchase",
      ["contract_director", "material_director", "project_manager", "finance_director", "chairman|general_manager"]
    ],
    [
      "equipment_rental",
      ["contract_director", "material_director", "project_manager", "finance_director", "chairman|general_manager"]
    ],
    [
      "labor_subcontract",
      ["contract_director", "engineering_director", "project_manager", "finance_director", "chairman|general_manager"]
    ],
    [
      "professional_subcontract",
      ["contract_director", "engineering_director", "project_manager", "finance_director", "chairman|general_manager"]
    ],
    [
      "generic_contract",
      ["contract_director", "comprehensive_director", "project_manager", "finance_director", "chairman|general_manager"]
    ]
  ])("freezes the complete %s route and concrete candidates", async (contractTypeKey, expected) => {
    const { tx } = txFor();

    const frozen = await service.freezeNewContractRoute(
      tx as Prisma.TransactionClient,
      contract(contractTypeKey),
      "staff-1"
    );

    expect(frozen.map((node) => node.roleKeys.join("|"))).toEqual(expected);
    expect(frozen.every((node) => Object.prototype.hasOwnProperty.call(node, "candidateUserIdsByRole"))).toBe(true);
    expect(frozen.at(-1)).toMatchObject({
      candidateUserIds: ["chairman-2", "general-manager-2"],
      candidateUserIdsByRole: {
        chairman: ["chairman-2"],
        general_manager: ["general-manager-2"]
      }
    });
  });

  it("keeps the contract-director node for a project contract staff applicant", async () => {
    const { tx } = txFor();

    const frozen = await service.freezeNewContractRoute(
      tx as Prisma.TransactionClient,
      contract("material_purchase"),
      "staff-1"
    );

    expect(frozen[0]?.roleKeys).toEqual(["contract_director"]);
  });

  it("skips only the first node when a company-level contract director applies", async () => {
    const { tx } = txFor({
      projectApplicantRoles: [],
      globalApplicantRoles: [{ userId: "director-1", roleKey: "contract_director" }]
    });

    const frozen = await service.freezeNewContractRoute(
      tx as Prisma.TransactionClient,
      contract("generic_contract"),
      "director-1"
    );

    expect(frozen[0]?.roleKeys).toEqual(["comprehensive_director"]);
  });

  it("does not treat a project-scoped legacy contract director as an applicant role", async () => {
    const { tx } = txFor({ projectApplicantRoles: [], globalApplicantRoles: [] });

    await expect(
      service.freezeNewContractRoute(tx as Prisma.TransactionClient, contract("generic_contract"), "legacy-director")
    ).rejects.toThrow("仅允许所属项目合同员或公司级合同部主管发起新合同审批");
  });

  it.each([null, "", "unknown_type"])("fails closed for an unsupported type: %p", async (contractTypeKey) => {
    const { tx } = txFor();

    await expect(
      service.freezeNewContractRoute(tx as Prisma.TransactionClient, contract(contractTypeKey), "staff-1")
    ).rejects.toThrow("合同类型无法匹配审批路线，请先完善合同类型");
  });

  it("fails closed when the project is inactive", async () => {
    const { tx } = txFor({ projectActive: false });

    await expect(
      service.freezeNewContractRoute(tx as Prisma.TransactionClient, contract("material_purchase"), "staff-1")
    ).rejects.toThrow("合同所属项目不存在或已停用");
  });

  it("keeps candidates isolated to the locked contract project and uses only the transaction client", async () => {
    const { tx, $queryRaw } = txFor();

    await service.freezeNewContractRoute(
      tx as Prisma.TransactionClient,
      contract("material_purchase", "project-locked"),
      "staff-1"
    );

    expect($queryRaw).toHaveBeenCalledTimes(5);
    const sql = $queryRaw.mock.calls.map(([query]) => query.strings.join(" ")).join("\n");
    expect(sql).toContain('FROM "ProjectMember"');
    expect(sql).toContain('up."projectId" IS NULL');
    expect(sql).toContain('u."isActive" = TRUE');
    expect(sql).toContain('pm."positionKey" IN');
    expect(sql).toContain('p."key" IN');
    expect(sql).not.toContain("budget_staff");
  });

  it("checks project-engineer uniqueness before excluding the applicant", async () => {
    const { tx } = txFor({
      projectCandidates: [
        { userId: "staff-1", roleKey: "engineering_director" },
        { userId: "engineer-2", roleKey: "engineering_director" },
        { userId: "manager-2", roleKey: "project_manager" }
      ]
    });

    await expect(
      service.freezeNewContractRoute(tx as Prisma.TransactionClient, contract("labor_subcontract"), "staff-1")
    ).rejects.toThrow("所属项目的项目总工配置缺失或冲突");
  });

  it("blocks when the only project engineer is the applicant", async () => {
    const { tx } = txFor({
      projectCandidates: [
        { userId: "staff-1", roleKey: "engineering_director" },
        { userId: "manager-2", roleKey: "project_manager" }
      ]
    });

    await expect(
      service.freezeNewContractRoute(tx as Prisma.TransactionClient, contract("professional_subcontract"), "staff-1")
    ).rejects.toThrow("所属项目的项目总工不能审批本人发起的合同，请先配置其他审批人");
  });

  it("blocks a single-role node after excluding the applicant", async () => {
    const { tx } = txFor({
      projectCandidates: [{ userId: "staff-1", roleKey: "project_manager" }]
    });

    await expect(
      service.freezeNewContractRoute(tx as Prisma.TransactionClient, contract("material_purchase"), "staff-1")
    ).rejects.toThrow("项目经理没有可审批本合同的人员，请先完善岗位配置");
  });

  it("keeps both OR role keys and accepts one remaining leader", async () => {
    const { tx } = txFor({
      globalCandidates: [
        { userId: "contract-director-2", roleKey: "contract_director" },
        { userId: "material-director-2", roleKey: "material_director" },
        { userId: "finance-director-2", roleKey: "finance_director" },
        { userId: "chairman-2", roleKey: "chairman" }
      ]
    });

    const frozen = await service.freezeNewContractRoute(
      tx as Prisma.TransactionClient,
      contract("material_purchase"),
      "staff-1"
    );

    expect(frozen.at(-1)).toMatchObject({
      roleKeys: ["chairman", "general_manager"],
      candidateUserIds: ["chairman-2"],
      candidateUserIdsByRole: { chairman: ["chairman-2"], general_manager: [] }
    });
  });

  it("blocks when no chairman or general manager remains after excluding the applicant", async () => {
    const { tx } = txFor({
      globalCandidates: [
        { userId: "contract-director-2", roleKey: "contract_director" },
        { userId: "material-director-2", roleKey: "material_director" },
        { userId: "finance-director-2", roleKey: "finance_director" }
      ]
    });

    await expect(
      service.freezeNewContractRoute(tx as Prisma.TransactionClient, contract("equipment_rental"), "staff-1")
    ).rejects.toThrow("董事长或总经理没有可审批本合同的人员，请先完善岗位配置");
  });

  it("sorts and de-duplicates every frozen candidate list", async () => {
    const { tx } = txFor({
      globalCandidates: [
        { userId: "contract-z", roleKey: "contract_director" },
        { userId: "contract-a", roleKey: "contract_director" },
        { userId: "contract-a", roleKey: "contract_director" },
        { userId: "material-1", roleKey: "material_director" },
        { userId: "finance-1", roleKey: "finance_director" },
        { userId: "leader-z", roleKey: "chairman" },
        { userId: "leader-a", roleKey: "general_manager" }
      ]
    });

    const frozen = await service.freezeNewContractRoute(
      tx as Prisma.TransactionClient,
      contract("material_purchase"),
      "staff-1"
    );

    expect(frozen[0]?.candidateUserIds).toEqual(["contract-a", "contract-z"]);
    expect(frozen.at(-1)?.candidateUserIds).toEqual(["leader-a", "leader-z"]);
  });

  const integrationTest = process.env.RUN_CONTRACT_ROUTE_CONCURRENCY === "1" ? it : it.skip;
  integrationTest("serializes canonical role revocation against route freezing on two connections", async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl || process.env.NODE_ENV === "production") {
      throw new Error("合同路线并发测试必须连接非生产隔离数据库");
    }
    const schema = `contract_route_${randomUUID().replace(/-/g, "")}`;
    const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const isolatedUrl = new URL(databaseUrl);
    isolatedUrl.searchParams.set("schema", schema);
    const submitClient = new PrismaClient({ datasources: { db: { url: isolatedUrl.toString() } } });
    const roleClient = new PrismaClient({ datasources: { db: { url: isolatedUrl.toString() } } });

    try {
      await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      await submitClient.$executeRawUnsafe(`CREATE TABLE "Project" ("id" TEXT PRIMARY KEY, "isActive" BOOLEAN NOT NULL)`);
      await submitClient.$executeRawUnsafe(`CREATE TABLE "User" ("id" TEXT PRIMARY KEY, "isActive" BOOLEAN NOT NULL)`);
      await submitClient.$executeRawUnsafe(`CREATE TABLE "Position" ("id" TEXT PRIMARY KEY, "key" TEXT NOT NULL UNIQUE)`);
      await submitClient.$executeRawUnsafe(`CREATE TABLE "UserPosition" ("id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "positionId" TEXT NOT NULL, "projectId" TEXT)`);
      await submitClient.$executeRawUnsafe(`CREATE TABLE "ProjectMember" ("id" TEXT PRIMARY KEY, "projectId" TEXT NOT NULL, "userId" TEXT NOT NULL, "positionKey" TEXT NOT NULL)`);
      await submitClient.$executeRawUnsafe(`CREATE TABLE "ApprovalInstance" ("id" TEXT PRIMARY KEY, "frozenNodes" JSONB NOT NULL)`);
      await submitClient.$executeRawUnsafe(`INSERT INTO "Project" VALUES ('project-1', TRUE)`);
      await submitClient.$executeRawUnsafe(`
        INSERT INTO "User" VALUES
          ('staff-1', TRUE), ('manager-1', TRUE), ('contract-director-1', TRUE),
          ('material-director-1', TRUE), ('finance-director-1', TRUE), ('chairman-1', TRUE)
      `);
      await submitClient.$executeRawUnsafe(`
        INSERT INTO "Position" VALUES
          ('position-contract', 'contract_director'),
          ('position-material', 'material_director'),
          ('position-finance', 'finance_director'),
          ('position-chairman', 'chairman')
      `);
      await submitClient.$executeRawUnsafe(`
        INSERT INTO "UserPosition" VALUES
          ('up-contract', 'contract-director-1', 'position-contract', NULL),
          ('up-material', 'material-director-1', 'position-material', NULL),
          ('up-finance', 'finance-director-1', 'position-finance', NULL),
          ('up-chairman', 'chairman-1', 'position-chairman', NULL)
      `);
      await submitClient.$executeRawUnsafe(`
        INSERT INTO "ProjectMember" VALUES
          ('pm-staff', 'project-1', 'staff-1', 'contract_staff'),
          ('pm-manager', 'project-1', 'manager-1', 'project_manager')
      `);

      let routeLocked!: () => void;
      let releaseSubmit!: () => void;
      const routeLockedPromise = new Promise<void>((resolve) => { routeLocked = resolve; });
      const releaseSubmitPromise = new Promise<void>((resolve) => { releaseSubmit = resolve; });
      const submitFirst = submitClient.$transaction(async (tx) => {
        const nodes = await service.freezeNewContractRoute(
          tx,
          contract("material_purchase"),
          "staff-1"
        );
        routeLocked();
        await releaseSubmitPromise;
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO "ApprovalInstance" ("id", "frozenNodes")
          VALUES ('submit-first', ${JSON.stringify(nodes)}::jsonb)
        `);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      await routeLockedPromise;
      let projectRoleRevoked = false;
      const revokeProjectRole = roleClient.$transaction(async (tx) => {
        await tx.$executeRaw`DELETE FROM "ProjectMember" WHERE "id" = 'pm-manager'`;
        projectRoleRevoked = true;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(projectRoleRevoked).toBe(false);
      releaseSubmit();
      await Promise.all([submitFirst, revokeProjectRole]);
      const [submitFirstInstance] = await submitClient.$queryRaw<Array<{ frozenNodes: unknown }>>`
        SELECT "frozenNodes" FROM "ApprovalInstance" WHERE "id" = 'submit-first'
      `;
      expect(JSON.stringify(submitFirstInstance.frozenNodes)).toContain("manager-1");
      expect(await submitClient.$queryRaw`SELECT 1 FROM "ProjectMember" WHERE "id" = 'pm-manager'`)
        .toEqual([]);

      await submitClient.$executeRaw`INSERT INTO "ProjectMember" VALUES ('pm-manager', 'project-1', 'manager-1', 'project_manager')`;
      let globalRoleDeleted!: () => void;
      let releaseRoleDelete!: () => void;
      const globalRoleDeletedPromise = new Promise<void>((resolve) => { globalRoleDeleted = resolve; });
      const releaseRoleDeletePromise = new Promise<void>((resolve) => { releaseRoleDelete = resolve; });
      const revokeGlobalRoleFirst = roleClient.$transaction(async (tx) => {
        await tx.$executeRaw`DELETE FROM "UserPosition" WHERE "id" = 'up-material'`;
        globalRoleDeleted();
        await releaseRoleDeletePromise;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      await globalRoleDeletedPromise;
      const blockedSubmit = submitClient.$transaction(async (tx) => {
        const nodes = await service.freezeNewContractRoute(
          tx,
          contract("material_purchase"),
          "staff-1"
        );
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO "ApprovalInstance" ("id", "frozenNodes")
          VALUES ('revoke-first', ${JSON.stringify(nodes)}::jsonb)
        `);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      await new Promise((resolve) => setTimeout(resolve, 30));
      releaseRoleDelete();
      await revokeGlobalRoleFirst;
      const blockedError = await blockedSubmit.catch((error: unknown) => error);
      expect(blockedError).toMatchObject({
        code: "P2010",
        meta: expect.objectContaining({ code: "40001" })
      });
      expect(await submitClient.$queryRaw`SELECT 1 FROM "ApprovalInstance" WHERE "id" = 'revoke-first'`)
        .toEqual([]);
    } finally {
      await Promise.allSettled([submitClient.$disconnect(), roleClient.$disconnect()]);
      await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.$disconnect();
    }
  }, 20_000);
});
