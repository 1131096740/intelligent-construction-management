import "reflect-metadata";
import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { PrismaClient } from "@prisma/client";
import { PermissionGuard } from "../auth/guards/permission.guard";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { ContractDraftController } from "../contract-workbench/contract-draft.controller";
import { ContractDraftAggregateService } from "../contract-workbench/contract-draft-aggregate.service";
import { ContractDraftEditLeaseService } from "../contract-workbench/contract-draft-edit-lease.service";
import { ContractDocumentService } from "../contract-document/contract-document.service";
import { ContractWorkbenchService } from "../contract-workbench/contract-workbench.service";
import { ContractController } from "../contract/contract.controller";
import { ContractReadService } from "../contract/contract-read.service";
import { ContractService } from "../contract/contract.service";
import { PrismaService } from "./prisma.service";

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
      const intruderId = `lifecycle-route-intruder-${suffix}`;
      const adminId = `lifecycle-route-admin-${suffix}`;
      const projectId = `lifecycle-route-project-${suffix}`;
      const contractStaffPositionId = `lifecycle-route-contract-staff-${suffix}`;
      const superAdminPositionId = `lifecycle-route-super-admin-${suffix}`;
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
        await prisma.user.createMany({
          data: [
            {
              id: ownerId,
              name: "合同生命周期路由测试用户",
              mustChangePassword: false
            },
            {
              id: intruderId,
              name: "合同生命周期路由越权用户",
              mustChangePassword: false
            },
            {
              id: adminId,
              name: "合同生命周期路由系统管理员",
              mustChangePassword: false
            }
          ]
        });
        await prisma.position.createMany({
          data: [
            { id: contractStaffPositionId, key: "contract_staff", name: "合同员" },
            { id: superAdminPositionId, key: "super_admin", name: "系统管理员" }
          ]
        });
        await prisma.project.create({
          data: {
            id: projectId,
            code: `LIFECYCLE-${suffix}`,
            name: "合同生命周期路由测试项目"
          }
        });
        await prisma.userPosition.createMany({
          data: [
            {
              id: `lifecycle-route-owner-position-${suffix}`,
              userId: ownerId,
              positionId: contractStaffPositionId,
              projectId
            },
            {
              id: `lifecycle-route-admin-position-${suffix}`,
              userId: adminId,
              positionId: superAdminPositionId,
              projectId: null
            }
          ]
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
              ...(status === "approval_rejected" || status === "abandoned"
                ? { firstSubmittedAt: new Date() }
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
        const contractService = new ContractService(prisma as never);
        const moduleRef = await Test.createTestingModule({
          controllers: [ContractController, ContractDraftController],
          providers: [
            { provide: ContractService, useValue: contractService },
            { provide: ContractReadService, useValue: contractRead },
            { provide: ContractWorkbenchService, useValue: {} },
            { provide: ProjectVisibilityService, useValue: projectVisibility },
            { provide: ContractDraftAggregateService, useValue: {} },
            { provide: ContractDraftEditLeaseService, useValue: {} },
            { provide: ContractDocumentService, useValue: {} },
            { provide: PrismaService, useValue: prisma }
          ]
        }).compile();
        app = moduleRef.createNestApplication();
        app.useGlobalGuards(new PermissionGuard(new Reflector(), prisma as never));
        app.useGlobalPipes(
          new ValidationPipe({
            transform: true,
            whitelist: true,
            forbidNonWhitelisted: true
          })
        );
        app.use((
          request: { user?: unknown; headers: Record<string, string | string[] | undefined> },
          _response: unknown,
          next: () => void
        ) => {
          const userId = request.headers["x-test-user"] === intruderId
            ? intruderId
            : request.headers["x-test-user"] === adminId
              ? adminId
              : ownerId;
          request.user = {
            id: userId,
            name: userId === adminId
              ? "合同生命周期路由系统管理员"
              : userId === intruderId
                ? "合同生命周期路由越权用户"
                : "合同生命周期路由测试用户",
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
            status: string;
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
        expect(body.rows.map((row) => row.status).sort()).toEqual([
          "abandoned",
          "approval_rejected",
          "draft",
          "effective"
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

        const draftVersionId = `${contractIds[0]}-v1`;
        const forbiddenDelete = await fetch(
          `${await app.getUrl()}/contract-drafts/${draftVersionId}`,
          {
            method: "DELETE",
            headers: {
              "content-type": "application/json",
              "x-test-user": intruderId
            },
            body: JSON.stringify({ expectedRevision: 1 })
          }
        );
        expect(forbiddenDelete.status).toBe(403);

        const invalidDelete = await fetch(
          `${await app.getUrl()}/contract-drafts/${draftVersionId}`,
          {
            method: "DELETE",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ expectedRevision: 1, unexpected: true })
          }
        );
        expect(invalidDelete.status).toBe(400);

        const ownerDelete = await fetch(
          `${await app.getUrl()}/contract-drafts/${draftVersionId}`,
          {
            method: "DELETE",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ expectedRevision: 1 })
          }
        );
        expect(ownerDelete.status).toBe(200);
        expect(await ownerDelete.json()).toMatchObject({
          status: "deleting",
          action: "delete_pristine_draft",
          idempotent: false
        });
        await expect(prisma.contractVersion.findUnique({
          where: { id: draftVersionId },
          select: { status: true }
        })).resolves.toEqual({ status: "deleting" });

        const adminDelete = await fetch(
          `${await app.getUrl()}/contract-drafts/${draftVersionId}`,
          {
            method: "DELETE",
            headers: {
              "content-type": "application/json",
              "x-test-user": adminId
            },
            body: JSON.stringify({ expectedRevision: 1 })
          }
        );
        expect(adminDelete.status).toBe(200);
        expect(await adminDelete.json()).toMatchObject({
          status: "deleting",
          idempotent: true
        });
      } finally {
        if (app) await app.close();
        await prisma.userPosition.deleteMany({
          where: { userId: { in: [ownerId, intruderId, adminId] } }
        });
        await prisma.contractVersion.deleteMany({
          where: { contractId: { in: contractIds } }
        });
        await prisma.contract.deleteMany({ where: { id: { in: contractIds } } });
        await prisma.project.deleteMany({ where: { id: projectId } });
        await prisma.position.deleteMany({
          where: { id: { in: [contractStaffPositionId, superAdminPositionId] } }
        });
        await prisma.user.deleteMany({
          where: { id: { in: [ownerId, intruderId, adminId] } }
        });
        await prisma.$disconnect();
      }
    },
    60_000
  );
});
