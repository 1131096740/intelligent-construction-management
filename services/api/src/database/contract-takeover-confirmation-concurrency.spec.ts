import "reflect-metadata";
import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { apiJsonReplacer } from "../api-json-replacer";
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { PermissionGuard } from "../auth/guards/permission.guard";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { ContractTaxFactsService } from "../contract-tax-facts/contract-tax-facts.service";
import { FileService } from "../file/file.service";
import { ContractTakeoverController } from "../contract-takeover/contract-takeover.controller";
import { ContractTakeoverActivationService } from "../contract-takeover/contract-takeover-activation.service";
import { ContractTakeoverCorrectionService } from "../contract-takeover/contract-takeover-correction.service";
import { ContractTakeoverExcelService } from "../contract-takeover/contract-takeover-excel.service";
import { ContractTakeoverService } from "../contract-takeover/contract-takeover.service";

const TEST_DATABASE = "jiangkong_contract_takeover_task1_20260729";

export function contractTakeoverConfirmationDatabaseUrl(
  value: string | undefined
) {
  if (!value || process.env.NODE_ENV === "production") {
    throw new Error("历史接管确认并发测试必须连接非生产专用数据库");
  }
  const url = new URL(value);
  if (
    !["postgresql:", "postgres:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "::1"].includes(url.hostname) ||
    url.pathname !== `/${TEST_DATABASE}`
  ) {
    throw new Error("历史接管确认并发测试拒绝非本机专用数据库");
  }
  return url.toString();
}

describe("historical takeover confirmation PostgreSQL concurrency", () => {
  it("rejects a non-local or wrong database target", () => {
    expect(() =>
      contractTakeoverConfirmationDatabaseUrl(
        "postgresql://user:pass@example.com/production"
      )
    ).toThrow("历史接管确认并发测试拒绝非本机专用数据库");
  });

  const integrationTest =
    process.env.RUN_CONTRACT_TAKEOVER_CONFIRMATION_CONCURRENCY === "1"
      ? it
      : it.skip;

  integrationTest(
    "maps a real serializable baseline conflict to HTTP 409 without retrying",
    async () => {
      const databaseUrl = contractTakeoverConfirmationDatabaseUrl(
        process.env.CONTRACT_TAKEOVER_CONFIRMATION_DATABASE_URL
      );
      const prisma = new PrismaClient({
        datasources: { db: { url: databaseUrl } }
      });
      const suffix = `${process.pid}-${Date.now()}-${randomUUID().slice(0, 8)}`;
      const projectId = `takeover-baseline-project-${suffix}`;
      const userId = `takeover-baseline-user-${suffix}`;
      const contractId = `takeover-baseline-contract-${suffix}`;
      const versionId = `${contractId}-v1`;
      const termsId = `${contractId}-terms-v1`;
      const takeoverId = `takeover-baseline-${suffix}`;
      const password = "ContractTakeover#61";
      const triggerToken = randomUUID().replace(/-/gu, "");
      const triggerName = `takeover_baseline_${triggerToken}`;
      const triggerFunction = `takeover_baseline_pause_${triggerToken}`;
      let app: INestApplication | undefined;

      try {
        const directorPosition = await prisma.position.upsert({
          where: { key: "contract_director" },
          create: {
            id: `takeover-baseline-position-${suffix}`,
            key: "contract_director",
            name: "合同部主管"
          },
          update: {}
        });
        await prisma.user.create({
          data: {
            id: userId,
            name: "历史变更基线并发测试用户",
            passwordHash: await bcrypt.hash(password, 4),
            mustChangePassword: false
          }
        });
        await prisma.userPosition.create({
          data: {
            id: `takeover-baseline-user-position-${suffix}`,
            userId,
            positionId: directorPosition.id,
            projectId: null
          }
        });
        await prisma.project.create({
          data: {
            id: projectId,
            code: `TAKEOVER-BASELINE-${suffix}`,
            name: "历史变更基线并发测试项目"
          }
        });
        await prisma.contract.create({
          data: {
            id: contractId,
            projectId,
            name: "历史变更基线并发测试合同",
            counterparty: "测试相对方",
            contractTypeKey: "material_purchase"
          }
        });
        await prisma.contractVersion.create({
          data: {
            id: versionId,
            contractId,
            versionNo: 1,
            changeType: "historical_takeover",
            status: "effective",
            amountCents: 1_000n,
            draftData: {},
            templateSnapshot: {},
            clauseSnapshot: [],
            effectiveAt: new Date(),
            pricingNature: "fixed_total",
            amountLimitType: "capped"
          }
        });
        await prisma.paymentTermsVersion.create({
          data: {
            id: termsId,
            contractId,
            contractVersionId: versionId,
            versionNo: 1,
            status: "effective",
            originalText: "测试付款条款"
          }
        });
        await prisma.contractTakeover.create({
          data: {
            id: takeoverId,
            projectId,
            contractId,
            contractVersionId: versionId,
            paymentTermsVersionId: termsId,
            takeoverLevel: "A",
            takeoverStatus: "confirmed",
            lifecycleStatus: "in_progress",
            signedAt: new Date(),
            createdByUserId: userId,
            confirmedByUserId: userId,
            confirmedAt: new Date(),
            historicalBalanceConfirmedByUserId: userId,
            historicalBalanceConfirmedAt: new Date(),
            activationIdempotencyKey: randomUUID(),
            activatedByUserId: userId,
            activatedAt: new Date()
          }
        });

        await prisma.$executeRawUnsafe(`
          CREATE FUNCTION "${triggerFunction}"() RETURNS trigger AS $$
          BEGIN
            IF NEW."id" = '${versionId}' THEN
              PERFORM pg_sleep(0.25);
            END IF;
            RETURN NEW;
          END;
          $$ LANGUAGE plpgsql
        `);
        await prisma.$executeRawUnsafe(`
          CREATE TRIGGER "${triggerName}"
          BEFORE UPDATE OF "originalBaseAmountCents" ON "ContractVersion"
          FOR EACH ROW EXECUTE FUNCTION "${triggerFunction}"()
        `);

        const audit = new AuditService();
        const auth = new AuthService(prisma as never, {} as never, audit);
        const takeovers = new ContractTakeoverService(
          prisma as never,
          audit,
          auth
        );
        const moduleRef = await Test.createTestingModule({
          controllers: [ContractTakeoverController],
          providers: [
            { provide: ContractTakeoverService, useValue: takeovers },
            { provide: ContractTakeoverCorrectionService, useValue: {} },
            { provide: ProjectVisibilityService, useValue: {} },
            { provide: FileService, useValue: {} },
            { provide: ContractTakeoverExcelService, useValue: {} },
            { provide: ContractTaxFactsService, useValue: {} }
          ]
        }).compile();
        app = moduleRef.createNestApplication();
        app.getHttpAdapter().getInstance().set("json replacer", apiJsonReplacer);
        app.useGlobalGuards(new PermissionGuard(new Reflector(), prisma as never));
        app.useGlobalPipes(
          new ValidationPipe({
            transform: true,
            whitelist: true,
            forbidNonWhitelisted: true
          })
        );
        app.use((
          request: { user?: unknown },
          _response: unknown,
          next: () => void
        ) => {
          request.user = {
            id: userId,
            name: "历史变更基线并发测试用户",
            phone: null
          };
          next();
        });
        await app.listen(0, "127.0.0.1");

        const url = `${await app.getUrl()}/projects/${projectId}/contract-takeovers/${takeoverId}/change-baseline-confirmation`;
        const request = () => fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            originalSignedAmountCents: "900",
            preTakeoverPositiveIncreaseCents: "100",
            currentPassword: password
          })
        });
        const firstRequest = request();
        await waitForPgSleep(prisma, "ContractVersion");
        const responses = await Promise.all([firstRequest, request()]);
        expect(responses.map((response) => response.status).sort())
          .toEqual([201, 409]);
        expect(await prisma.auditLog.count({
          where: {
            businessId: takeoverId,
            action: "contract_takeover.change_baseline.confirm"
          }
        })).toBe(1);
      } finally {
        await app?.close();
        await prisma.$executeRawUnsafe(
          `DROP TRIGGER IF EXISTS "${triggerName}" ON "ContractVersion"`
        ).catch(() => undefined);
        await prisma.$executeRawUnsafe(
          `DROP FUNCTION IF EXISTS "${triggerFunction}"()`
        ).catch(() => undefined);
        await prisma.auditLog.deleteMany({ where: { businessId: takeoverId } });
        await prisma.contractTakeover.deleteMany({ where: { id: takeoverId } });
        await prisma.paymentTermsVersion.deleteMany({ where: { id: termsId } });
        await prisma.contractVersion.deleteMany({ where: { id: versionId } });
        await prisma.contract.deleteMany({ where: { id: contractId } });
        await prisma.userPosition.deleteMany({ where: { userId } });
        await prisma.user.deleteMany({ where: { id: userId } });
        await prisma.project.deleteMany({ where: { id: projectId } });
        await prisma.$disconnect();
      }
    },
    30_000
  );

  integrationTest(
    "activates once through the two public side-confirmation routes and replays from a fresh request",
    async () => {
      const databaseUrl = contractTakeoverConfirmationDatabaseUrl(
        process.env.CONTRACT_TAKEOVER_CONFIRMATION_DATABASE_URL
      );
      const prisma = new PrismaClient({
        datasources: { db: { url: databaseUrl } }
      });
      const suffix = `${process.pid}-${Date.now()}-${randomUUID().slice(0, 8)}`;
      const projectId = `takeover-route-project-${suffix}`;
      const contractUserId = `takeover-route-contract-user-${suffix}`;
      const financeUserId = `takeover-route-finance-user-${suffix}`;
      const contractId = `takeover-route-contract-${suffix}`;
      const versionId = `${contractId}-v1`;
      const termsId = `${contractId}-terms-v1`;
      const takeoverId = `takeover-route-${suffix}`;
      const evidenceFileId = `takeover-route-settlement-evidence-${suffix}`;
      const excessEvidenceFileId = `takeover-route-excess-evidence-${suffix}`;
      const paymentIds = [
        `takeover-route-payment-1-${suffix}`,
        `takeover-route-payment-2-${suffix}`
      ];
      const voucherFileIds = [
        `takeover-route-voucher-1-${suffix}`,
        `takeover-route-voucher-2-${suffix}`
      ];
      const companyEntityId = `takeover-route-company-${suffix}`;
      const companyEntityVersionId = `${companyEntityId}-v1`;
      const password = "ContractTakeover#61";
      const dualToken = randomUUID().replace(/-/gu, "");
      const dualTriggerName = `takeover_dual_${dualToken}`;
      const dualTriggerFunction = `takeover_dual_pause_${dualToken}`;
      const raceToken = randomUUID().replace(/-/gu, "");
      const raceTriggerName = `takeover_withdraw_${raceToken}`;
      const raceTriggerFunction = `takeover_withdraw_pause_${raceToken}`;
      let app: INestApplication | undefined;

      try {
        const [contractPosition, financePosition] = await Promise.all([
          prisma.position.upsert({
            where: { key: "contract_director" },
            create: {
              id: `takeover-route-contract-position-${suffix}`,
              key: "contract_director",
              name: "合同部主管"
            },
            update: {}
          }),
          prisma.position.upsert({
            where: { key: "finance_director" },
            create: {
              id: `takeover-route-finance-position-${suffix}`,
              key: "finance_director",
              name: "财务部主管"
            },
            update: {}
          })
        ]);
        const passwordHash = await bcrypt.hash(password, 4);
        await prisma.user.createMany({
          data: [
            {
              id: contractUserId,
              name: "历史接管合同侧确认测试用户",
              passwordHash,
              mustChangePassword: false
            },
            {
              id: financeUserId,
              name: "历史接管财务侧确认测试用户",
              passwordHash,
              mustChangePassword: false
            }
          ]
        });
        await prisma.userPosition.createMany({
          data: [
            {
              id: `takeover-route-contract-user-position-${suffix}`,
              userId: contractUserId,
              positionId: contractPosition.id,
              projectId: null
            },
            {
              id: `takeover-route-finance-user-position-${suffix}`,
              userId: financeUserId,
              positionId: financePosition.id,
              projectId: null
            }
          ]
        });
        await prisma.project.create({
          data: {
            id: projectId,
            code: `TAKEOVER-ROUTE-${suffix}`,
            name: "历史接管双边确认路由测试项目"
          }
        });
        await prisma.companyEntity.create({
          data: {
            id: companyEntityId,
            name: "测试建设有限公司",
            unifiedSocialCreditCode: "91310000TEST000061",
            registeredAddress: "上海市测试路 61 号",
            dataStatus: "complete",
            currentVersionNo: 1
          }
        });
        await prisma.companyEntityVersion.create({
          data: {
            id: companyEntityVersionId,
            companyEntityId,
            versionNo: 1,
            name: "测试建设有限公司",
            unifiedSocialCreditCode: "91310000TEST000061",
            registeredAddress: "上海市测试路 61 号",
            isActive: true,
            action: "create",
            actorUserId: contractUserId,
            actorRoleKey: "contract_director"
          }
        });
        await prisma.contract.create({
          data: {
            id: contractId,
            projectId,
            name: "历史接管双边确认路由测试合同",
            counterparty: "测试相对方",
            contractTypeKey: "material_purchase",
            companyEntityId,
            companyEntityName: "测试建设有限公司"
          }
        });
        await prisma.contractVersion.create({
          data: {
            id: versionId,
            contractId,
            versionNo: 1,
            changeType: "historical_takeover",
            status: "draft",
            amountCents: 1_000n,
            draftData: {},
            templateSnapshot: {},
            clauseSnapshot: [],
            pricingNature: "fixed_total",
            amountLimitType: "capped"
          }
        });
        await prisma.paymentTermsVersion.create({
          data: {
            id: termsId,
            contractId,
            contractVersionId: versionId,
            versionNo: 1,
            status: "draft",
            originalText: "测试付款条款"
          }
        });
        await prisma.contractTakeover.create({
          data: {
            id: takeoverId,
            projectId,
            contractId,
            contractVersionId: versionId,
            paymentTermsVersionId: termsId,
            takeoverLevel: "A",
            takeoverStatus: "draft",
            lifecycleStatus: "in_progress",
            signedAt: new Date(),
            historicalSettledCents: 600n,
            createdByUserId: contractUserId
          }
        });
        await prisma.contractTakeoverContractFacts.create({
          data: {
            takeoverId,
            revision: 3,
            financeBasisRevision: 4,
            signedAt: new Date(),
            historicalSettledCents: 600n,
            zeroSettlementDeclared: false,
            performanceStatus: "performing",
            settlementEvidenceSummary: "测试结算依据",
            paymentTermsSnapshot: {},
            contractFactsSnapshot: {},
            updatedByUserId: contractUserId
          }
        });
        await prisma.contractTakeoverFinanceFacts.create({
          data: {
            takeoverId,
            revision: 2,
            basedOnContractRevision: 3,
            basedOnFinanceBasisRevision: 4,
            zeroPaymentDeclared: false,
            excessTreatment: "historical_advance",
            excessReason: "历史实付超过期初结算的部分转历史预付款",
            updatedByUserId: financeUserId
          }
        });
        await prisma.fileObject.createMany({
          data: [
            {
              id: evidenceFileId,
              bucket: "test-private-bucket",
              objectKey: `takeover-route/${evidenceFileId}.pdf`,
              originalName: "历史结算依据.pdf",
              mimeType: "application/pdf",
              sizeBytes: 128,
              uploadedByUserId: contractUserId,
              contentSha256: "a".repeat(64)
            },
            {
              id: excessEvidenceFileId,
              bucket: "test-private-bucket",
              objectKey: `takeover-route/${excessEvidenceFileId}.pdf`,
              originalName: "历史超额认定依据.pdf",
              mimeType: "application/pdf",
              sizeBytes: 128,
              uploadedByUserId: financeUserId,
              contentSha256: "b".repeat(64)
            },
            ...voucherFileIds.map((fileId, index) => ({
              id: fileId,
              bucket: "test-private-bucket",
              objectKey: `takeover-route/${fileId}.pdf`,
              originalName: `历史付款凭证-${index + 1}.pdf`,
              mimeType: "application/pdf",
              sizeBytes: 128,
              uploadedByUserId: financeUserId,
              contentSha256: String(index + 1).repeat(64)
            }))
          ]
        });
        await prisma.contractTakeoverSettlementEvidence.create({
          data: {
            takeoverId,
            fileId: evidenceFileId,
            displayOrder: 0,
            createdByUserId: contractUserId
          }
        });
        await prisma.contractTakeoverExcessEvidence.create({
          data: {
            takeoverId,
            fileId: excessEvidenceFileId,
            displayOrder: 0,
            createdByUserId: financeUserId
          }
        });
        await prisma.$transaction(async (tx) => {
          await tx.contractTakeoverHistoricalPayment.createMany({
            data: [
              {
                id: paymentIds[0],
                takeoverId,
                rowKey: "payment-1",
                sequenceNo: 1,
                amountCents: 500n,
                paidAt: new Date("2026-01-10T00:00:00.000Z"),
                status: "draft"
              },
              {
                id: paymentIds[1],
                takeoverId,
                rowKey: "payment-2",
                sequenceNo: 2,
                amountCents: 200n,
                paidAt: new Date("2026-02-10T00:00:00.000Z"),
                status: "draft"
              }
            ]
          });
          await tx.contractTakeoverHistoricalPaymentAllocation.createMany({
            data: [
              {
                historicalPaymentId: paymentIds[0],
                allocationType: "settlement",
                amountCents: 500n,
                allocationOrder: 0
              },
              {
                historicalPaymentId: paymentIds[1],
                allocationType: "settlement",
                amountCents: 100n,
                allocationOrder: 0
              },
              {
                historicalPaymentId: paymentIds[1],
                allocationType: "historical_advance",
                amountCents: 100n,
                allocationOrder: 1
              }
            ]
          });
        });
        await prisma.contractTakeoverHistoricalPaymentVoucher.createMany({
          data: paymentIds.map((historicalPaymentId, index) => ({
            historicalPaymentId,
            fileId: voucherFileIds[index],
            displayOrder: 0,
            uploadedByUserId: financeUserId
          }))
        });

        const audit = new AuditService();
        const auth = new AuthService(prisma as never, {} as never, audit);
        const activation = new ContractTakeoverActivationService(audit);
        const takeovers = new ContractTakeoverService(
          prisma as never,
          audit,
          auth,
          undefined,
          activation
        );
        const moduleRef = await Test.createTestingModule({
          controllers: [ContractTakeoverController],
          providers: [
            { provide: ContractTakeoverService, useValue: takeovers },
            { provide: ContractTakeoverCorrectionService, useValue: {} },
            { provide: ProjectVisibilityService, useValue: {} },
            { provide: FileService, useValue: {} },
            { provide: ContractTakeoverExcelService, useValue: {} },
            { provide: ContractTaxFactsService, useValue: {} }
          ]
        }).compile();
        app = moduleRef.createNestApplication();
        app.getHttpAdapter().getInstance().set("json replacer", apiJsonReplacer);
        app.useGlobalGuards(new PermissionGuard(new Reflector(), prisma as never));
        app.useGlobalPipes(
          new ValidationPipe({
            transform: true,
            whitelist: true,
            forbidNonWhitelisted: true
          })
        );
        app.use((
          request: {
            user?: unknown;
            headers: Record<string, string | string[] | undefined>;
          },
          _response: unknown,
          next: () => void
        ) => {
          const userId = request.headers["x-test-user"] === financeUserId
            ? financeUserId
            : contractUserId;
          request.user = { id: userId, name: userId, phone: null };
          next();
        });
        await app.listen(0, "127.0.0.1");
        const appUrl = await app.getUrl();
        await prisma.$executeRawUnsafe(`
          CREATE FUNCTION "${dualTriggerFunction}"() RETURNS trigger AS $$
          BEGIN
            IF NEW."takeoverId" = '${takeoverId}' THEN
              PERFORM pg_sleep(0.25);
            END IF;
            RETURN NEW;
          END;
          $$ LANGUAGE plpgsql
        `);
        await prisma.$executeRawUnsafe(`
          CREATE TRIGGER "${dualTriggerName}"
          BEFORE UPDATE OF "confirmedRevision" ON "ContractTakeoverContractFacts"
          FOR EACH ROW EXECUTE FUNCTION "${dualTriggerFunction}"()
        `);

        const contractKey = randomUUID();
        const financeKey = randomUUID();
        const requests = [
          {
            route: "contract-side/confirmation",
            userId: contractUserId,
            body: {
              idempotencyKey: contractKey,
              expectedRevision: 3,
              currentPassword: password
            }
          },
          {
            route: "finance-side/confirmation",
            userId: financeUserId,
            body: {
              idempotencyKey: financeKey,
              expectedRevision: 2,
              currentPassword: password,
              basedOnContractRevision: 3,
              basedOnFinanceBasisRevision: 4
            }
          }
        ];
        const send = (request: {
          route: string;
          userId: string;
          body: Record<string, unknown>;
        }) => fetch(
          `${appUrl}/projects/${projectId}/contract-takeovers/${takeoverId}/${request.route}`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-test-user": request.userId
            },
            body: JSON.stringify(request.body)
          }
        );
        const resetActivatedFixture = async () => {
          const balanceAccounts =
            await prisma.contractTakeoverBalanceAccount.findMany({
              where: { takeoverId },
              select: { id: true }
            });
          await prisma.contractTakeover.update({
            where: { id: takeoverId },
            data: {
              takeoverStatus: "draft",
              confirmedByUserId: null,
              confirmedAt: null,
              historicalBalanceConfirmedByUserId: null,
              historicalBalanceConfirmedAt: null,
              activationIdempotencyKey: null,
              activatedAt: null,
              activatedByUserId: null,
              historicalInitialSettlementId: null
            }
          });
          await prisma.contractTakeoverBalanceEntry.deleteMany({
            where: { accountId: { in: balanceAccounts.map(({ id }) => id) } }
          });
          await prisma.contractTakeoverBalanceAccount.deleteMany({
            where: { takeoverId }
          });
          await prisma.contractTakeoverHistoricalPayment.updateMany({
            where: { id: { in: paymentIds } },
            data: { status: "draft", activatedAt: null }
          });
          await prisma.settlement.deleteMany({
            where: { sourceTakeoverId: takeoverId }
          });
          await prisma.contractVersion.update({
            where: { id: versionId },
            data: {
              status: "draft",
              effectiveAt: null,
              originalBaseAmountCents: null,
              cumulativeIncreaseCents: 0n,
              settlementMode: null,
              settlementModeSource: null,
              settlementModeConfirmedByUserId: null,
              settlementModeConfirmedAt: null
            }
          });
          await prisma.paymentTermsVersion.update({
            where: { id: termsId },
            data: { status: "draft" }
          });
          await prisma.contractTakeoverContractFacts.update({
            where: { takeoverId },
            data: {
              confirmedRevision: 3,
              confirmedByUserId: contractUserId,
              confirmedAt: new Date()
            }
          });
          await prisma.contractTakeoverFinanceFacts.update({
            where: { takeoverId },
            data: {
              confirmedRevision: null,
              confirmedContractRevision: null,
              confirmedFinanceBasisRevision: null,
              confirmedByUserId: null,
              confirmedAt: null
            }
          });
          await prisma.contractTakeoverConfirmationEvent.deleteMany({
            where: { takeoverId }
          });
          await prisma.auditLog.deleteMany({ where: { businessId: takeoverId } });
        };
        const contractResponse = send(requests[0]);
        await waitForPgSleep(prisma, "ContractTakeoverContractFacts");
        const financeResponse = send(requests[1]);
        const firstResponses = await Promise.all([
          contractResponse,
          financeResponse
        ]);
        expect(firstResponses.map((response) => response.status).sort())
          .toEqual([201, 409]);
        const conflictIndex = firstResponses.findIndex(
          (response) => response.status === 409
        );
        const firstSuccess = await firstResponses[1 - conflictIndex].json() as {
          activated: boolean;
          activationStatus: string;
        };
        const replayResponse = await send(requests[conflictIndex]);
        expect(replayResponse.status).toBe(201);
        const replayReceipt = await replayResponse.json() as {
          activated: boolean;
          activationStatus: string;
          activationIdempotencyKey: string;
          historicalInitialSettlementId: string;
        };
        const freshReadResponse = await send(requests[conflictIndex]);
        expect(freshReadResponse.status).toBe(201);
        expect(await freshReadResponse.json()).toEqual(replayReceipt);
        expect(firstSuccess.activated).toBe(false);
        expect(firstSuccess.activationStatus).toMatch(/^awaiting_/u);
        expect(replayReceipt).toMatchObject({
          activated: true,
          activationStatus: "activated",
          activationIdempotencyKey:
            requests[conflictIndex].body.idempotencyKey,
          historicalInitialSettlementId: expect.any(String)
        });
        expect(await prisma.contractTakeoverConfirmationEvent.count({
          where: { takeoverId }
        })).toBe(2);
        expect(await prisma.settlement.count({
          where: { sourceTakeoverId: takeoverId }
        })).toBe(1);
        expect(await prisma.auditLog.count({
          where: {
            businessId: takeoverId,
            action: "contract_takeover.activate"
          }
        })).toBe(1);
        expect(await prisma.auditLog.count({
          where: {
            businessId: takeoverId,
            action: {
              in: [
                "contract_takeover.contract_side.confirm",
                "contract_takeover.finance_side.confirm"
              ]
            }
          }
        })).toBe(2);
        expect(await prisma.contractTakeoverHistoricalPayment.count({
          where: { takeoverId, status: "activated" }
        })).toBe(2);
        expect(await prisma.contractTakeoverHistoricalPaymentVoucher.count({
          where: { historicalPaymentId: { in: paymentIds } }
        })).toBe(2);
        expect(await prisma.contractTakeoverHistoricalPaymentAllocation.aggregate({
          where: { historicalPaymentId: { in: paymentIds } },
          _sum: { amountCents: true }
        })).toEqual({ _sum: { amountCents: 700n } });
        expect(await prisma.contractTakeoverBalanceAccount.findUnique({
          where: {
            takeoverId_balanceType: {
              takeoverId,
              balanceType: "historical_advance"
            }
          },
          select: { openingCents: true, balanceCents: true }
        })).toEqual({ openingCents: 100n, balanceCents: 100n });
        expect(await prisma.settlement.findUnique({
          where: { sourceTakeoverId: takeoverId },
          select: { amountCents: true, paidAmountCents: true }
        })).toEqual({ amountCents: 600n, paidAmountCents: 600n });
        expect(await prisma.contractVersion.findUnique({
          where: { id: versionId },
          select: {
            companyEntityIdSnapshot: true,
            companyEntityVersionId: true,
            companyEntityNameSnapshot: true,
            companyEntityCreditCodeSnapshot: true
          }
        })).toEqual({
          companyEntityIdSnapshot: companyEntityId,
          companyEntityVersionId,
          companyEntityNameSnapshot: "测试建设有限公司",
          companyEntityCreditCodeSnapshot: "91310000TEST000061"
        });

        await resetActivatedFixture();
        await prisma.$executeRawUnsafe(`
          CREATE FUNCTION "${raceTriggerFunction}"() RETURNS trigger AS $$
          BEGIN
            IF NEW."takeoverId" = '${takeoverId}' THEN
              PERFORM pg_sleep(0.25);
            END IF;
            RETURN NEW;
          END;
          $$ LANGUAGE plpgsql
        `);
        await prisma.$executeRawUnsafe(`
          CREATE TRIGGER "${raceTriggerName}"
          BEFORE UPDATE OF "confirmedRevision" ON "ContractTakeoverFinanceFacts"
          FOR EACH ROW EXECUTE FUNCTION "${raceTriggerFunction}"()
        `);

        const financeConfirmation = send({
          route: "finance-side/confirmation",
          userId: financeUserId,
          body: {
            idempotencyKey: randomUUID(),
            expectedRevision: 2,
            currentPassword: password,
            basedOnContractRevision: 3,
            basedOnFinanceBasisRevision: 4
          }
        });
        await waitForPgSleep(prisma, "ContractTakeoverFinanceFacts");
        const contractWithdrawal = send({
          route: "contract-side/confirmation-withdrawal",
          userId: contractUserId,
          body: {
            idempotencyKey: randomUUID(),
            expectedRevision: 3,
            currentPassword: password,
            reason: "并发边界测试撤回"
          }
        });
        const [confirmationResponse, withdrawalResponse] =
          await Promise.all([financeConfirmation, contractWithdrawal]);
        expect(confirmationResponse.status).toBe(201);
        expect(withdrawalResponse.status).toBe(409);
        expect(await prisma.settlement.count({
          where: { sourceTakeoverId: takeoverId }
        })).toBe(1);
        expect(await prisma.auditLog.count({
          where: {
            businessId: takeoverId,
            action: "contract_takeover.activate"
          }
        })).toBe(1);

        await resetActivatedFixture();

        const baselineRaceConfirmation = send({
          route: "finance-side/confirmation",
          userId: financeUserId,
          body: {
            idempotencyKey: randomUUID(),
            expectedRevision: 2,
            currentPassword: password,
            basedOnContractRevision: 3,
            basedOnFinanceBasisRevision: 4
          }
        });
        await waitForPgSleep(prisma, "ContractTakeoverFinanceFacts");
        const baselineConfirmation = send({
          route: "change-baseline-confirmation",
          userId: contractUserId,
          body: {
            originalSignedAmountCents: "900",
            preTakeoverPositiveIncreaseCents: "100",
            currentPassword: password
          }
        });
        const [baselineRaceResponse, baselineResponse] = await Promise.all([
          baselineRaceConfirmation,
          baselineConfirmation
        ]);
        expect(baselineRaceResponse.status).toBe(201);
        expect(baselineResponse.status).toBe(409);
        expect(await prisma.contractVersion.findUnique({
          where: { id: versionId },
          select: { originalBaseAmountCents: true }
        })).toEqual({ originalBaseAmountCents: null });
        expect(await prisma.settlement.count({
          where: { sourceTakeoverId: takeoverId }
        })).toBe(1);
      } finally {
        await app?.close();
        await prisma.$executeRawUnsafe(
          `DROP TRIGGER IF EXISTS "${dualTriggerName}" ON "ContractTakeoverContractFacts"`
        ).catch(() => undefined);
        await prisma.$executeRawUnsafe(
          `DROP FUNCTION IF EXISTS "${dualTriggerFunction}"()`
        ).catch(() => undefined);
        await prisma.$executeRawUnsafe(
          `DROP TRIGGER IF EXISTS "${raceTriggerName}" ON "ContractTakeoverFinanceFacts"`
        ).catch(() => undefined);
        await prisma.$executeRawUnsafe(
          `DROP FUNCTION IF EXISTS "${raceTriggerFunction}"()`
        ).catch(() => undefined);
        await prisma.auditLog.deleteMany({ where: { businessId: takeoverId } });
        await prisma.contractTakeoverConfirmationEvent.deleteMany({
          where: { takeoverId }
        });
        await prisma.contractTakeoverSettlementEvidence.deleteMany({
          where: { takeoverId }
        });
        await prisma.contractTakeoverExcessEvidence.deleteMany({
          where: { takeoverId }
        });
        const balanceAccounts =
          await prisma.contractTakeoverBalanceAccount.findMany({
            where: { takeoverId },
            select: { id: true }
          });
        await prisma.contractTakeoverBalanceEntry.deleteMany({
          where: { accountId: { in: balanceAccounts.map(({ id }) => id) } }
        });
        await prisma.contractTakeoverBalanceAccount.deleteMany({
          where: { takeoverId }
        });
        await prisma.contractTakeoverHistoricalPaymentVoucher.deleteMany({
          where: { historicalPaymentId: { in: paymentIds } }
        });
        await prisma.$transaction(async (tx) => {
          await tx.contractTakeoverHistoricalPaymentAllocation.deleteMany({
            where: { historicalPaymentId: { in: paymentIds } }
          });
          await tx.contractTakeoverHistoricalPayment.deleteMany({
            where: { id: { in: paymentIds } }
          });
        });
        await prisma.contractTakeover.updateMany({
          where: { id: takeoverId },
          data: { historicalInitialSettlementId: null }
        });
        await prisma.contractTakeoverFinanceFacts.deleteMany({
          where: { takeoverId }
        });
        await prisma.contractTakeoverContractFacts.deleteMany({
          where: { takeoverId }
        });
        await prisma.contractTakeover.deleteMany({ where: { id: takeoverId } });
        await prisma.settlement.deleteMany({ where: { sourceTakeoverId: takeoverId } });
        await prisma.fileObject.deleteMany({
          where: {
            id: {
              in: [evidenceFileId, excessEvidenceFileId, ...voucherFileIds]
            }
          }
        });
        await prisma.paymentTermsVersion.deleteMany({ where: { id: termsId } });
        await prisma.contractVersion.deleteMany({ where: { id: versionId } });
        await prisma.contract.deleteMany({ where: { id: contractId } });
        await prisma.companyEntityVersion.deleteMany({
          where: { id: companyEntityVersionId }
        });
        await prisma.companyEntity.deleteMany({ where: { id: companyEntityId } });
        await prisma.userPosition.deleteMany({
          where: { userId: { in: [contractUserId, financeUserId] } }
        });
        await prisma.user.deleteMany({
          where: { id: { in: [contractUserId, financeUserId] } }
        });
        await prisma.project.deleteMany({ where: { id: projectId } });
        await prisma.$disconnect();
      }
    },
    30_000
  );
});

async function waitForPgSleep(prisma: PrismaClient, relation: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [result] = await prisma.$queryRaw<Array<{ sleeping: boolean }>>(
      Prisma.sql`
        SELECT EXISTS (
          SELECT 1
          FROM pg_stat_activity
          WHERE datname = current_database()
            AND wait_event = 'PgSleep'
            AND query LIKE ${`%${relation}%`}
        ) AS sleeping
      `
    );
    if (result?.sleeping) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`未观测到 ${relation} 的 PostgreSQL 并发屏障`);
}
