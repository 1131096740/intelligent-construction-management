import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PrismaClient } from "@prisma/client";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { ContractWorkbenchService } from "../contract-workbench/contract-workbench.service";
import { ContractController } from "../contract/contract.controller";
import { ContractReadService } from "../contract/contract-read.service";
import { ContractService } from "../contract/contract.service";

const TEST_DATABASE = "jiangkong_contract_draft_aggregate_test";

function localLifecycleDatabaseUrl(value: string | undefined) {
  if (!value || process.env.NODE_ENV === "production") {
    throw new Error("合同生命周期路由测试必须连接非生产专用数据库");
  }
  const url = new URL(value);
  if (
    !["postgresql:", "postgres:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "::1"].includes(url.hostname) ||
    url.pathname !== `/${TEST_DATABASE}`
  ) {
    throw new Error("合同生命周期路由测试拒绝非本机专用数据库");
  }
  return url.toString();
}

describe("contract lifecycle Nest route and PostgreSQL evidence", () => {
  const integrationTest =
    process.env.RUN_CONTRACT_DRAFT_AGGREGATE_DATABASE === "1" ? it : it.skip;

  integrationTest(
    "projects one authoritative lifecycle stage and capability set per contract version",
    async () => {
      const databaseUrl = localLifecycleDatabaseUrl(
        process.env.CONTRACT_DRAFT_AGGREGATE_DATABASE_URL
      );
      const prisma = new PrismaClient({
        datasources: { db: { url: databaseUrl } }
      });
      const suffix = `${process.pid}-${Date.now()}`;
      const ownerId = `lifecycle-route-owner-${suffix}`;
      const projectId = `lifecycle-route-project-${suffix}`;
      const stages = [
        ["unsubmitted_draft", "draft"],
        ["returned_editable", "approval_rejected"],
        ["ended_retained", "abandoned"],
        ["protected_formal", "effective"]
      ] as const;
      const contractIds = stages.map(([stage]) =>
        `lifecycle-route-contract-${stage}-${suffix}`
      );
      let app: INestApplication | undefined;

      try {
        await prisma.user.create({
          data: {
            id: ownerId,
            name: "合同生命周期路由测试用户",
            mustChangePassword: false
          }
        });
        await prisma.project.create({
          data: {
            id: projectId,
            code: `LIFECYCLE-${suffix}`,
            name: "合同生命周期路由测试项目"
          }
        });
        for (const [[stage, status], contractId] of stages.map(
          (stage, index) => [stage, contractIds[index]] as const
        )) {
          await prisma.contract.create({
            data: {
              id: contractId,
              projectId,
              name: `合同生命周期 ${stage}`,
              counterparty: "测试相对方",
              ownerUserId: ownerId,
              temporaryCode: `TMP-${stage}-${suffix}`
            }
          });
          await prisma.contractVersion.create({
            data: {
              id: `${contractId}-v1`,
              contractId,
              versionNo: 1,
              changeType: "original",
              status,
              amountCents: 100n,
              draftData: {},
              templateSnapshot: {},
              clauseSnapshot: [],
              ...(status === "abandoned"
                ? {
                    abandonedAt: new Date(),
                    abandonedByUserId: ownerId,
                    abandonReason: "路由测试结束记录"
                  }
                : {}),
              ...(status === "effective" ? { effectiveAt: new Date() } : {})
            }
          });
        }

        const projectVisibility = {
          visibleProjectIds: jest.fn().mockResolvedValue([projectId]),
          effectiveRoleKeysByProject: jest.fn().mockResolvedValue(
            new Map([[projectId, ["contract_staff"]]])
          )
        };
        const contractRead = new ContractReadService(
          prisma as never,
          projectVisibility as never
        );
        const moduleRef = await Test.createTestingModule({
          controllers: [ContractController],
          providers: [
            { provide: ContractService, useValue: {} },
            { provide: ContractReadService, useValue: contractRead },
            { provide: ContractWorkbenchService, useValue: {} },
            { provide: ProjectVisibilityService, useValue: projectVisibility }
          ]
        }).compile();
        app = moduleRef.createNestApplication();
        app.use((
          request: { user?: unknown },
          _response: unknown,
          next: () => void
        ) => {
          request.user = {
            id: ownerId,
            name: "合同生命周期路由测试用户",
            phone: null
          };
          next();
        });
        await app.listen(0, "127.0.0.1");

        const response = await fetch(
          `${await app.getUrl()}/contracts/workbench?view=all&pageSize=20`
        );
        expect(response.status).toBe(200);
        const body = await response.json() as {
          rows: Array<{
            contractLifecycleStage: string;
            contractLifecycleCapabilities: {
              canEdit: boolean;
              canPhysicallyDelete: boolean;
              historyRetention: string;
            };
          }>;
        };
        const rowByStage = new Map(
          body.rows.map((row) => [row.contractLifecycleStage, row])
        );
        expect(body.rows).toHaveLength(4);
        expect([...rowByStage.keys()].sort()).toEqual([
          "ended_retained",
          "protected_formal",
          "returned_editable",
          "unsubmitted_draft"
        ]);
        expect(rowByStage.get("unsubmitted_draft"))
          .toMatchObject({
            contractLifecycleCapabilities: {
              canEdit: true,
              canPhysicallyDelete: true,
              historyRetention: "none"
            }
          });
        expect(rowByStage.get("returned_editable"))
          .toMatchObject({
            contractLifecycleCapabilities: {
              canEdit: true,
              canPhysicallyDelete: false,
              historyRetention: "none"
            }
          });
        expect(rowByStage.get("ended_retained"))
          .toMatchObject({
            contractLifecycleCapabilities: {
              canEdit: false,
              canPhysicallyDelete: false,
              historyRetention: "three_calendar_months"
            }
          });
        expect(rowByStage.get("protected_formal"))
          .toMatchObject({
            contractLifecycleCapabilities: {
              canEdit: false,
              canPhysicallyDelete: false,
              historyRetention: "permanent"
            }
          });
      } finally {
        if (app) await app.close();
        await prisma.contractVersion.deleteMany({
          where: { contractId: { in: contractIds } }
        });
        await prisma.contract.deleteMany({ where: { id: { in: contractIds } } });
        await prisma.project.deleteMany({ where: { id: projectId } });
        await prisma.user.deleteMany({ where: { id: ownerId } });
        await prisma.$disconnect();
      }
    },
    60_000
  );
});
