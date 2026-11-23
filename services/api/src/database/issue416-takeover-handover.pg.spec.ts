import { randomUUID } from "node:crypto";
import * as assert from "node:assert/strict";

import { PrismaClient } from "@prisma/client";

import { AuditService } from "../audit/audit.service";
import { ContractTakeoverHandoverService } from "../contract-takeover/contract-takeover-handover.service";
import {
  assertTakeoverContinuationAllowed,
  resolveTakeoverHandoverDuty
} from "../contract-takeover/contract-takeover-handover";

/**
 * #416 真库证据（真实 PostgreSQL 16）：
 * 1) 无等级历史合同确认后，未登记分工前不能继续办理；
 * 2) 登记合同/财务/复核三项职责后可以继续办理；
 * 3) 历史接管事实行前后完全一致；
 * 4) 换人必须填原因，历史保留且审计可追溯；
 * 5) 旧 A/B 等级不登记分工仍按原路径继续。
 *
 * 只允许本机一次性 PostgreSQL 16 专库。运行入口：
 *   node services/api/prisma/run-issue416-takeover-handover-local.cjs
 */
describe("issue 416 no-grade historical takeover handover on PostgreSQL", () => {
  const integrationTest =
    process.env.RUN_ISSUE416_HANDOVER_DATABASE === "1" ? it : it.skip;

  integrationTest(
    "blocks a no-grade takeover before its division handover, allows it after registration, keeps facts and traces reassignment",
    async () => {
      const databaseUrl = assertDedicatedDatabase();
      const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
      const ids = fixtureIds();
      try {
        await prisma.$connect();
        await seedFixture(prisma, ids);
        const service = new ContractTakeoverHandoverService(
          prisma as never,
          new AuditService()
        );

        const before = await prisma.contractTakeover.findUniqueOrThrow({
          where: { id: ids.takeover }
        });
        await prisma.approvalInstance.create({
          data: {
            id: "issue416-completed-approval",
            flowType: "formal_approval_evidence",
            businessType: "contract_takeover",
            businessId: ids.takeover,
            status: "approved",
            currentNodeIndex: 0,
            frozenNodes: [
              {
                name: "合同部主管",
                mode: "any",
                roleKeys: ["contract_director"],
                approvedRoleKeys: ["contract_director"]
              }
            ],
            applicantUserId: ids.creator
          }
        });
        const completedApprovalBefore =
          await prisma.approvalInstance.findUniqueOrThrow({
            where: { id: "issue416-completed-approval" }
          });

        // 1) 无等级接管已确认，但没有分工登记时，后续办理被后端阻断。
        await assert.rejects(
          assertTakeoverContinuationAllowed(
            prisma as never,
            before as never,
            "发起后续结算"
          ),
          /请先完成接管分工登记/
        );
        const unregistered = await service.read(
          ids.project,
          ids.takeover,
          ids.supervisor
        );
        assert.deepEqual(
          {
            registered: unregistered.registered,
            requiresHandover: unregistered.requiresHandover,
            assignments: unregistered.assignments,
            takeoverLevel: unregistered.takeoverLevel
          },
          {
            registered: false,
            requiresHandover: true,
            assignments: [],
            takeoverLevel: "NONE"
          }
        );

        // 2) 分工负责人必须匹配部门岗位，不能把合同职责交给项目经理。
        await assert.rejects(
          service.register(ids.project, ids.takeover, ids.supervisor, {
            contractUserId: ids.projectManager,
            financeUserId: ids.finance,
            supervisorUserId: ids.supervisor,
            idempotencyKey: randomUUID()
          }),
          /合同办理负责人需为合同员或合同部主管/
        );

        // 3) 登记三项职责后，同一接管可以继续办理。
        const registered = await service.register(
          ids.project,
          ids.takeover,
          ids.supervisor,
          {
            contractUserId: ids.contract,
            financeUserId: ids.finance,
            supervisorUserId: ids.supervisor,
            idempotencyKey: randomUUID()
          }
        );
        assert.equal(registered.registered, true);
        assert.equal(registered.revision, 1);
        assert.deepEqual(
          registered.assignments.map((item) => [item.duty, item.userId]),
          [
            ["contract", ids.contract],
            ["finance", ids.finance],
            ["supervisor", ids.supervisor]
          ]
        );
        assert.equal(registered.actorDuty, "supervisor");
        await assert.doesNotReject(
          assertTakeoverContinuationAllowed(
            prisma as never,
            before as never,
            "发起后续结算"
          )
        );
        assert.equal(
          await resolveTakeoverHandoverDuty(prisma as never, ids.takeover, ids.finance),
          "finance"
        );

        // 4) 分工登记不改变任何历史接管事实。
        const afterRegister = await prisma.contractTakeover.findUniqueOrThrow({
          where: { id: ids.takeover }
        });
        assert.deepEqual(afterRegister, before);

        // 5) 换人必须填原因；换人后当前负责人更新、历史保留、审计可追。
        await assert.rejects(
          service.register(ids.project, ids.takeover, ids.supervisor, {
            contractUserId: ids.contractReplacement,
            financeUserId: ids.finance,
            supervisorUserId: ids.supervisor,
            idempotencyKey: randomUUID()
          }),
          /更换接管责任人必须填写原因/
        );
        const reassigned = await service.register(
          ids.project,
          ids.takeover,
          ids.supervisor,
          {
            contractUserId: ids.contractReplacement,
            financeUserId: ids.finance,
            supervisorUserId: ids.supervisor,
            reason: "原合同经办调岗，由新合同员接续",
            idempotencyKey: randomUUID()
          }
        );
        assert.equal(reassigned.revision, 2);
        assert.equal(
          reassigned.assignments.find((item) => item.duty === "contract")?.userId,
          ids.contractReplacement
        );
        assert.deepEqual(
          reassigned.history.map((item) => [
            item.revision,
            item.action,
            item.reason
          ]),
          [
            [1, "handover_register", null],
            [2, "handover_reassign", "原合同经办调岗，由新合同员接续"]
          ]
        );
        assert.deepEqual(
          await prisma.contractTakeover.findUniqueOrThrow({
            where: { id: ids.takeover }
          }),
          before
        );
        assert.deepEqual(
          await prisma.approvalInstance.findUniqueOrThrow({
            where: { id: "issue416-completed-approval" }
          }),
          completedApprovalBefore
        );
        const audits = await prisma.auditLog.findMany({
          where: { businessId: ids.takeover },
          orderBy: { createdAt: "asc" },
          select: {
            action: true,
            actorUserId: true,
            metadata: true,
            createdAt: true
          }
        });
        assert.deepEqual(
          audits.map((row) => [row.action, row.actorUserId]),
          [
            ["contract_takeover.handover.register", ids.supervisor],
            ["contract_takeover.handover.reassign", ids.supervisor]
          ]
        );
        assert.ok(audits.every((row) => row.createdAt instanceof Date));
        assert.deepEqual(
          (audits[1].metadata as Record<string, unknown>).toAssignments,
          {
            contract: ids.contractReplacement,
            finance: ids.finance,
            supervisor: ids.supervisor
          }
        );

        // 6) 旧 A 级接管保留原路径，不需要补登记分工。
        const legacyA = await prisma.contractTakeover.findUniqueOrThrow({
          where: { id: ids.legacyTakeover }
        });
        await assert.doesNotReject(
          assertTakeoverContinuationAllowed(
            prisma as never,
            legacyA as never,
            "发起后续结算"
          )
        );
      } finally {
        await prisma.$disconnect();
      }
    },
    120_000
  );
});

function assertDedicatedDatabase(): string {
  const url = process.env.ISSUE416_HANDOVER_DATABASE_URL ?? "";
  const target = new URL(url);
  if (
    process.env.NODE_ENV !== "test" ||
    target.hostname !== "127.0.0.1" ||
    !target.pathname.endsWith("_issue416_handover")
  ) {
    throw new Error("ISSUE416_ISOLATED_DATABASE_REQUIRED");
  }
  return url;
}

function fixtureIds() {
  return {
    project: "issue416-project",
    contract: "issue416-contract",
    version: "issue416-contract-v1",
    terms: "issue416-terms-v1",
    takeover: "issue416-takeover",
    legacyContract: "issue416-legacy-contract",
    legacyVersion: "issue416-legacy-contract-v1",
    legacyTerms: "issue416-legacy-terms-v1",
    legacyTakeover: "issue416-legacy-takeover",
    contractReplacement: "issue416-user-contract-2",
    projectManager: "issue416-user-manager",
    finance: "issue416-user-finance",
    supervisor: "issue416-user-supervisor",
    creator: "issue416-user-creator"
  };
}

async function seedFixture(
  prisma: PrismaClient,
  ids: ReturnType<typeof fixtureIds>
): Promise<void> {
  const users = [
    [ids.contract, "合同经办", "contract_staff"],
    [ids.contractReplacement, "合同经办替换", "contract_staff"],
    [ids.projectManager, "项目经理", "project_manager"],
    [ids.finance, "财务经办", "finance_staff"],
    [ids.supervisor, "合同主管", "contract_director"],
    [ids.creator, "接管制单", "contract_staff"]
  ] as const;
  await prisma.user.createMany({
    data: users.map(([id, name], index) => ({
      id,
      name,
      phone: `139000041${String(index).padStart(2, "0")}`,
      passwordHash: "not-used-in-this-test",
      mustChangePassword: false,
      isActive: true
    }))
  });
  const positions = [
    ["issue416-pos-contract-staff", "contract_staff", "合同员"],
    ["issue416-pos-project-manager", "project_manager", "项目经理"],
    ["issue416-pos-finance-staff", "finance_staff", "财务"],
    ["issue416-pos-contract-director", "contract_director", "合同部主管"]
  ] as const;
  await prisma.position.createMany({
    data: positions.map(([id, key, name]) => ({ id, key, name }))
  });
  const positionByKey = new Map(positions.map(([id, key]) => [key, id]));
  await prisma.userPosition.createMany({
    data: users.map(([userId, , roleKey]) => ({
      userId,
      positionId: positionByKey.get(roleKey)!,
      projectId: null
    }))
  });
  await prisma.project.create({
    data: { id: ids.project, code: "ISSUE416", name: "Issue416 真库项目", isActive: true }
  });
  await createHistoricalContract(prisma, {
    project: ids.project,
    contract: ids.contract,
    version: ids.version,
    terms: ids.terms,
    takeover: ids.takeover,
    takeoverLevel: "NONE",
    creator: ids.creator,
    supervisor: ids.supervisor
  });
  await createHistoricalContract(prisma, {
    project: ids.project,
    contract: ids.legacyContract,
    version: ids.legacyVersion,
    terms: ids.legacyTerms,
    takeover: ids.legacyTakeover,
    takeoverLevel: "A",
    creator: ids.creator,
    supervisor: ids.supervisor
  });
}

async function createHistoricalContract(
  prisma: PrismaClient,
  input: {
    project: string;
    contract: string;
    version: string;
    terms: string;
    takeover: string;
    takeoverLevel: string;
    creator: string;
    supervisor: string;
  }
): Promise<void> {
  await prisma.contract.create({
    data: {
      id: input.contract,
      projectId: input.project,
      source: "historical_takeover",
      code: `HT-${input.takeover}`,
      name: `历史合同 ${input.takeover}`,
      counterparty: "历史相对方",
      contractTypeKey: "material_purchase",
      ownerUserId: input.creator
    }
  });
  await prisma.contractVersion.create({
    data: {
      id: input.version,
      contractId: input.contract,
      versionNo: 1,
      changeType: "historical_takeover",
      status: "effective",
      amountCents: 1_000_000n,
      amountLimitType: "capped",
      settlementMode: "settlement_required",
      settlementModeSource: "contract_takeover",
      effectiveAt: new Date("2026-10-01T00:00:00Z"),
      draftData: { historicalTakeover: true },
      templateSnapshot: { historicalTakeover: true },
      clauseSnapshot: []
    }
  });
  await prisma.paymentTermsVersion.create({
    data: {
      id: input.terms,
      contractId: input.contract,
      contractVersionId: input.version,
      versionNo: 1,
      status: "effective",
      originalText: "历史付款约定：按月结算。"
    }
  });
  await prisma.contractTakeover.create({
    data: {
      id: input.takeover,
      projectId: input.project,
      contractId: input.contract,
      contractVersionId: input.version,
      paymentTermsVersionId: input.terms,
      takeoverLevel: input.takeoverLevel,
      takeoverStatus: "confirmed",
      lifecycleStatus: "in_progress",
      signedAt: new Date("2025-01-15T00:00:00Z"),
      historicalSettledCents: 600_000n,
      historicalPaidCents: 700_000n,
      takeoverCutoffDate: new Date("2026-10-31T00:00:00Z"),
      responsibleUserId: input.creator,
      createdByUserId: input.creator,
      confirmedByUserId: input.supervisor,
      confirmedAt: new Date("2026-11-01T00:00:00Z"),
      historicalBalanceConfirmedByUserId: input.supervisor,
      historicalBalanceConfirmedAt: new Date("2026-11-01T00:00:00Z"),
      activatedAt: new Date("2026-11-01T00:00:00Z"),
      activatedByUserId: input.supervisor
    }
  });
}
