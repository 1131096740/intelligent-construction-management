import "reflect-metadata";
import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { PrismaClient } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { PermissionGuard } from "../auth/guards/permission.guard";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { AuditService } from "../audit/audit.service";
import { ContractDraftController } from "../contract-workbench/contract-draft.controller";
import { ContractDraftAggregateService } from "../contract-workbench/contract-draft-aggregate.service";
import { ContractDraftEditLeaseService } from "../contract-workbench/contract-draft-edit-lease.service";
import { ContractDocumentService } from "../contract-document/contract-document.service";
import { ContractWorkbenchService } from "../contract-workbench/contract-workbench.service";
import { ContractController } from "../contract/contract.controller";
import { ContractAuthorizationService } from "../contract/contract-authorization.service";
import { ContractApprovalRouteService } from "../contract/contract-approval-route.service";
import { ContractFormalFileService } from "../contract/contract-formal-file.service";
import { ContractReadService } from "../contract/contract-read.service";
import { ContractService } from "../contract/contract.service";
import { ContractReadinessService } from "../contract-workbench/contract-readiness.service";
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
    "projects lifecycle capabilities and executes governed workbench submission routes",
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
      const contractDirectorId = `lifecycle-route-contract-director-${suffix}`;
      const materialDirectorId = `lifecycle-route-material-director-${suffix}`;
      const financeDirectorId = `lifecycle-route-finance-director-${suffix}`;
      const chairmanId = `lifecycle-route-chairman-${suffix}`;
      const projectManagerId = `lifecycle-route-project-manager-${suffix}`;
      const projectId = `lifecycle-route-project-${suffix}`;
      const contractStaffPositionId = `lifecycle-route-contract-staff-${suffix}`;
      const superAdminPositionId = `lifecycle-route-super-admin-${suffix}`;
      const contractDirectorPositionId = `lifecycle-route-contract-director-position-${suffix}`;
      const materialDirectorPositionId = `lifecycle-route-material-director-position-${suffix}`;
      const financeDirectorPositionId = `lifecycle-route-finance-director-position-${suffix}`;
      const chairmanPositionId = `lifecycle-route-chairman-position-${suffix}`;
      const submissionUserIds = [
        ownerId,
        intruderId,
        adminId,
        contractDirectorId,
        materialDirectorId,
        financeDirectorId,
        chairmanId,
        projectManagerId
      ];
      const stages = [
        ["unsubmitted_draft", "unsubmitted_draft", "draft"],
        ["returned_editable", "returned_editable", "draft"],
        ["abandoned_ended", "ended_retained", "abandoned"],
        ["rejected_ended", "ended_retained", "approval_rejected"],
        ["protected_formal", "protected_formal", "effective"]
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
            },
            {
              id: contractDirectorId,
              name: "合同生命周期路由合同部主管",
              mustChangePassword: false
            },
            {
              id: materialDirectorId,
              name: "合同生命周期路由物资主管",
              mustChangePassword: false
            },
            {
              id: financeDirectorId,
              name: "合同生命周期路由财务主管",
              mustChangePassword: false
            },
            {
              id: chairmanId,
              name: "合同生命周期路由董事长",
              mustChangePassword: false
            },
            {
              id: projectManagerId,
              name: "合同生命周期路由项目经理",
              mustChangePassword: false
            }
          ]
        });
        await prisma.position.createMany({
          data: [
            { id: contractStaffPositionId, key: "contract_staff", name: "合同员" },
            { id: superAdminPositionId, key: "super_admin", name: "系统管理员" },
            { id: contractDirectorPositionId, key: "contract_director", name: "合同部主管" },
            { id: materialDirectorPositionId, key: "material_director", name: "物资主管" },
            { id: financeDirectorPositionId, key: "finance_director", name: "财务主管" },
            { id: chairmanPositionId, key: "chairman", name: "董事长" }
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
            },
            {
              id: `lifecycle-route-contract-director-user-position-${suffix}`,
              userId: contractDirectorId,
              positionId: contractDirectorPositionId,
              projectId: null
            },
            {
              id: `lifecycle-route-material-director-user-position-${suffix}`,
              userId: materialDirectorId,
              positionId: materialDirectorPositionId,
              projectId: null
            },
            {
              id: `lifecycle-route-finance-director-user-position-${suffix}`,
              userId: financeDirectorId,
              positionId: financeDirectorPositionId,
              projectId: null
            },
            {
              id: `lifecycle-route-chairman-user-position-${suffix}`,
              userId: chairmanId,
              positionId: chairmanPositionId,
              projectId: null
            }
          ]
        });
        await prisma.projectMember.createMany({
          data: [
            {
              id: `lifecycle-route-owner-project-member-${suffix}`,
              projectId,
              userId: ownerId,
              positionKey: "contract_staff"
            },
            {
              id: `lifecycle-route-project-manager-member-${suffix}`,
              projectId,
              userId: projectManagerId,
              positionKey: "project_manager"
            }
          ]
        });
        for (const [[label, stage, status], contractId] of stages.map(
          (stage, index) => [stage, contractIds[index]] as const
        )) {
          await prisma.contract.create({
            data: {
              id: contractId,
              projectId,
              name: `合同生命周期 ${label}`,
              counterparty: "测试相对方",
              ownerUserId: ownerId,
              temporaryCode: `TMP-${label}-${suffix}`
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
              ...(stage === "returned_editable" || status === "approval_rejected" || status === "abandoned"
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
        const audit = new AuditService();
        const uploadedPdfs = new Map<string, {
          buffer: Buffer;
          file: {
            id: string;
            storageStatus: string;
            mimeType: string;
            sizeBytes: number;
            contentSha256: string;
          };
        }>();
        const formalFiles = new ContractFormalFileService(
          prisma as never,
          audit,
          {
            getFileBuffer: jest.fn(async (fileId: string) => {
              const uploaded = uploadedPdfs.get(fileId);
              if (!uploaded) throw new Error("测试合同 PDF 不存在");
              return uploaded;
            })
          } as never
        );
        const authorizations = new ContractAuthorizationService(
          prisma as never,
          formalFiles,
          audit
        );
        const contractService = new ContractService(
          prisma as never,
          audit,
          undefined,
          undefined,
          undefined,
          undefined,
          new ContractReadinessService(prisma as never),
          undefined,
          new ContractApprovalRouteService(),
          formalFiles,
          authorizations
        );
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
        expect(body.rows).toHaveLength(5);
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
          "draft",
          "effective"
        ]);
        expect(
          body.rows
            .filter((row) => row.contractLifecycleStage === "ended_retained")
            .map((row) => row.status)
            .sort()
        ).toEqual(["abandoned", "approval_rejected"]);
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
          status: "abandoned",
          action: "delete_pristine_draft",
          abandonedAt: expect.any(String),
          abandonedByUserId: ownerId,
          idempotent: false
        });
        await expect(prisma.contractVersion.findUnique({
          where: { id: draftVersionId },
          select: { status: true, abandonedAt: true, abandonedByUserId: true }
        })).resolves.toEqual({
          status: "abandoned",
          abandonedAt: expect.any(Date),
          abandonedByUserId: ownerId
        });

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
          status: "abandoned",
          idempotent: true
        });

        const submissionSuffix = `${suffix}-submission`;
        const submittedContractId = `lifecycle-route-submit-${submissionSuffix}`;
        const conflictedContractId = `lifecycle-route-conflict-${submissionSuffix}`;
        const rollbackContractId = `lifecycle-route-rollback-${submissionSuffix}`;
        const submittedVersionId = `${submittedContractId}-v1`;
        const conflictedVersionId = `${conflictedContractId}-v1`;
        const rollbackVersionId = `${rollbackContractId}-v1`;
        const submissionContractIds = [
          submittedContractId,
          conflictedContractId,
          rollbackContractId
        ];
        const submissionVersionIds = [
          submittedVersionId,
          conflictedVersionId,
          rollbackVersionId
        ];
        const companyEntityId = `lifecycle-route-company-${submissionSuffix}`;
        const companyEntityVersionId = `${companyEntityId}-v1`;
        const layoutTemplateId = `lifecycle-route-layout-${submissionSuffix}`;
        const layoutTemplateVersionId = `${layoutTemplateId}-v1`;
        const submissionTemplate = {
          fieldSchema: [],
          clauseSchema: [],
          validationSchema: [],
          billSchema: [],
          attachmentSchema: []
        };
        const sourcePdf = await PDFDocument.create();
        sourcePdf.addPage([595, 842]);
        const sourcePdfBuffer = Buffer.from(
          await sourcePdf.save({ useObjectStreams: false })
        );
        const sourcePdfSha256 = createHash("sha256")
          .update(sourcePdfBuffer)
          .digest("hex");
        const seedGovernedSubmissionDraft = async (
          contractId: string,
          versionId: string,
          index: number
        ) => {
          const originalFileId = `lifecycle-route-counterparty-original-file-${index}-${submissionSuffix}`;
          const previewFileId = `lifecycle-route-counterparty-preview-file-${index}-${submissionSuffix}`;
          const originalFormalFileId = `lifecycle-route-counterparty-original-${index}-${submissionSuffix}`;
          const previewFormalFileId = `lifecycle-route-counterparty-preview-${index}-${submissionSuffix}`;
          const leaseToken = `lifecycle-route-lease-${index}-${submissionSuffix}`;
          await prisma.contract.create({
            data: {
              id: contractId,
              projectId,
              code: `SUBMIT-${index}-${submissionSuffix}`,
              name: `合同提交路由验收 ${index + 1}`,
              counterparty: "合同提交路由验收相对方",
              ownerUserId: ownerId,
              companyEntityId,
              companyEntityName: "合同生命周期测试公司",
              contractTypeKey: "material_purchase"
            }
          });
          await prisma.contractVersion.create({
            data: {
              id: versionId,
              contractId,
              versionNo: 1,
              changeType: "original",
              status: "draft",
              amountCents: 100n,
              amountLimitType: "capped",
              pricingNature: "fixed_total",
              amountSource: "manual",
              invoiceType: "vat_special",
              taxMode: "single_rate",
              defaultTaxRatePercent: 13,
              contractGovernanceVersion: 1,
              layoutTemplateVersionId,
              draftData: {
                companyEntitySelection: {
                  id: companyEntityId,
                  versionId: companyEntityVersionId,
                  versionNo: 1,
                  name: "合同生命周期测试公司",
                  unifiedSocialCreditCode: "91310000LIFECYCLE01"
                }
              },
              templateSnapshot: submissionTemplate,
              clauseSnapshot: []
            }
          });
          await prisma.contractPartySnapshot.create({
            data: {
              contractVersionId: versionId,
              roleKey: "party_b",
              displayOrder: 0,
              snapshot: { name: "合同提交路由验收相对方" }
            }
          });
          await prisma.paymentTermsVersion.create({
            data: {
              id: `lifecycle-route-payment-terms-${index}-${submissionSuffix}`,
              contractId,
              contractVersionId: versionId,
              versionNo: 1,
              status: "draft",
              originalText: "验收后支付"
            }
          });
          await prisma.contractVersionAuthorizationLink.createMany({
            data: [
              {
                contractVersionId: versionId,
                side: "first_party",
                required: false
              },
              {
                contractVersionId: versionId,
                side: "counterparty",
                required: false
              }
            ]
          });
          await prisma.contractDraftEditLease.create({
            data: {
              contractVersionId: versionId,
              holderUserId: ownerId,
              tokenHash: createHash("sha256").update(leaseToken).digest("hex"),
              expiresAt: new Date(Date.now() + 120_000)
            }
          });
          for (const fileId of [originalFileId, previewFileId]) {
            await prisma.fileObject.create({
              data: {
                id: fileId,
                bucket: "local-contract-lifecycle-test",
                objectKey: `contract-lifecycle/${fileId}.pdf`,
                originalName: "合同乙方签章测试文件.pdf",
                mimeType: "application/pdf",
                sizeBytes: sourcePdfBuffer.length,
                uploadedByUserId: ownerId,
                contentSha256: sourcePdfSha256,
                storageStatus: "active"
              }
            });
            uploadedPdfs.set(fileId, {
              buffer: sourcePdfBuffer,
              file: {
                id: fileId,
                storageStatus: "active",
                mimeType: "application/pdf",
                sizeBytes: sourcePdfBuffer.length,
                contentSha256: sourcePdfSha256
              }
            });
          }
          await prisma.contractFormalFile.createMany({
            data: [
              {
                id: originalFormalFileId,
                contractVersionId: versionId,
                purpose: "counterparty_signed",
                fileId: originalFileId,
                contentSha256: sourcePdfSha256,
                pageCount: 1,
                sourceRevision: 1,
                status: "active",
                uploadedByUserId: ownerId,
                declarationSnapshot: { kind: "counterparty_signed_original" },
                declaredByUserId: ownerId,
                declaredAt: new Date()
              },
              {
                id: previewFormalFileId,
                contractVersionId: versionId,
                purpose: "counterparty_signed_preview",
                fileId: previewFileId,
                contentSha256: sourcePdfSha256,
                pageCount: 1,
                sourceRevision: 1,
                status: "active",
                uploadedByUserId: ownerId,
                declarationSnapshot: { kind: "counterparty_signed_preview" },
                declaredByUserId: ownerId,
                declaredAt: new Date(),
                confirmedByUserId: ownerId,
                confirmedAt: new Date(),
                confirmationSnapshot: { confirmedAtRevision: 1 }
              }
            ]
          });
          return {
            contractId,
            versionId,
            originalFileId,
            previewFileId,
            originalFormalFileId,
            previewFormalFileId,
            leaseToken
          };
        };
        try {
          await prisma.companyEntity.create({
            data: {
              id: companyEntityId,
              name: "合同生命周期测试公司",
              unifiedSocialCreditCode: "91310000LIFECYCLE01",
              registeredAddress: "上海市合同生命周期路由测试地址",
              dataStatus: "complete",
              currentVersionNo: 1,
              isActive: true
            }
          });
          await prisma.companyEntityVersion.create({
            data: {
              id: companyEntityVersionId,
              companyEntityId,
              versionNo: 1,
              name: "合同生命周期测试公司",
              unifiedSocialCreditCode: "91310000LIFECYCLE01",
              registeredAddress: "上海市合同生命周期路由测试地址",
              isActive: true,
              action: "create",
              actorUserId: ownerId,
              actorRoleKey: "contract_staff"
            }
          });
          await prisma.contractLayoutTemplate.create({
            data: {
              id: layoutTemplateId,
              name: "合同生命周期路由测试版式",
              contractTypeKey: "material_purchase",
              createdByUserId: ownerId
            }
          });
          await prisma.contractLayoutTemplateVersion.create({
            data: {
              id: layoutTemplateVersionId,
              layoutTemplateId,
              versionNo: 1,
              status: "published",
              docxFileId: `lifecycle-route-layout-docx-${submissionSuffix}`,
              placeholderSchema: [],
              publishedByUserId: ownerId,
              publishedAt: new Date()
            }
          });
          const [submittedFixture, conflictedFixture, rollbackFixture] = await Promise.all([
            seedGovernedSubmissionDraft(submittedContractId, submittedVersionId, 0),
            seedGovernedSubmissionDraft(conflictedContractId, conflictedVersionId, 1),
            seedGovernedSubmissionDraft(rollbackContractId, rollbackVersionId, 2)
          ]);
          await prisma.contractFormalFile.create({
            data: {
              contractVersionId: conflictedVersionId,
              purpose: "mutually_signed_final",
              fileId: `lifecycle-route-final-file-${submissionSuffix}`,
              contentSha256: "a".repeat(64),
              pageCount: 1,
              sourceRevision: 1,
              status: "active",
              uploadedByUserId: ownerId,
              declarationSnapshot: {},
              declaredByUserId: ownerId,
              declaredAt: new Date()
            }
          });

          const submit = async (
            fixture: Awaited<ReturnType<typeof seedGovernedSubmissionDraft>>,
            idempotencyKey: string
          ) => fetch(
            `${await app!.getUrl()}/contract-drafts/${fixture.versionId}/submission`,
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-contract-draft-lease": fixture.leaseToken
              },
              body: JSON.stringify({ expectedRevision: 1, idempotencyKey })
            }
          );

          const submittedIdempotencyKey = randomUUID();
          const submitted = await submit(submittedFixture, submittedIdempotencyKey);
          expect(submitted.status).toBe(201);
          const submittedBody = await submitted.json() as {
            approvalInstanceId: string;
            contractVersionId: string;
            draftRevision: number;
            firstSubmittedAt: string;
            formalCode: string;
            status: string;
          };
          expect(submittedBody).toMatchObject({
            approvalInstanceId: expect.any(String),
            contractVersionId: submittedVersionId,
            draftRevision: 1,
            status: "in_approval",
            formalCode: `SUBMIT-0-${submissionSuffix}`
          });
          const duplicate = await submit(submittedFixture, submittedIdempotencyKey);
          expect(duplicate.status).toBe(201);
          expect(await duplicate.json()).toEqual(submittedBody);

          const [submittedVersion, submittedApproval, submissionReceipt, approvalBridge] = await Promise.all([
            prisma.contractVersion.findUnique({
              where: { id: submittedVersionId },
              select: {
                status: true,
                updatedAt: true,
                firstSubmittedAt: true,
                templateSnapshot: true
              }
            }),
            prisma.approvalInstance.findFirst({
              where: {
                businessType: "contract_version",
                businessId: submittedVersionId,
                flowType: "contract.approve"
              },
              select: { id: true, currentNodeIndex: true, updatedAt: true }
            }),
            prisma.contractDraftSubmissionRequest.findUnique({
              where: { idempotencyKey: submittedIdempotencyKey },
              select: {
                approvalInstanceId: true,
                contractVersionId: true,
                expectedRevision: true,
                responseSnapshot: true
              }
            }),
            prisma.contractFormalFile.findFirst({
              where: {
                contractVersionId: submittedVersionId,
                purpose: "approval_original",
                status: "active"
              },
              select: {
                id: true,
                fileId: true,
                contentSha256: true,
                sourceRevision: true,
                declarationSnapshot: true
              }
            })
          ]);
          expect(submittedVersion).toMatchObject({
            status: "in_approval",
            firstSubmittedAt: expect.any(Date)
          });
          expect(submittedApproval).toMatchObject({
            id: expect.any(String),
            currentNodeIndex: 0,
            updatedAt: expect.any(Date)
          });
          expect(submissionReceipt).toMatchObject({
            approvalInstanceId: submittedBody.approvalInstanceId,
            contractVersionId: submittedVersionId,
            expectedRevision: 1,
            responseSnapshot: submittedBody
          });
          expect(approvalBridge).toMatchObject({
            id: expect.any(String),
            fileId: submittedFixture.previewFileId,
            contentSha256: sourcePdfSha256,
            sourceRevision: 1,
            declarationSnapshot: {
              _counterparty_confirmed: {
                formalFileId: submittedFixture.previewFormalFileId,
                sourceFiles: [
                  {
                    formalFileId: submittedFixture.originalFormalFileId,
                    fileId: submittedFixture.originalFileId,
                    contentSha256: sourcePdfSha256,
                    sourceRevision: 1
                  }
                ]
              }
            }
          });
          expect(submittedVersion!.templateSnapshot).toMatchObject({
            submissionSnapshot: {
              counterpartySignedPreview: {
                id: submittedFixture.previewFormalFileId,
                fileId: submittedFixture.previewFileId,
                contentSha256: sourcePdfSha256,
                sourceRevision: 1
              },
              governance: {
                formalFile: {
                  id: approvalBridge!.id,
                  fileId: submittedFixture.previewFileId,
                  contentSha256: sourcePdfSha256,
                  sourceRevision: 1,
                  declarationSnapshot: approvalBridge!.declarationSnapshot
                }
              }
            }
          });

          const withdrawn = await fetch(
            `${await app!.getUrl()}/contracts/${submittedVersionId}/approval-withdrawal`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                expectedContractUpdatedAt: submittedVersion!.updatedAt.toISOString(),
                expectedApprovalInstanceId: submittedApproval!.id,
                expectedNodeIndex: submittedApproval!.currentNodeIndex,
                expectedApprovalUpdatedAt: submittedApproval!.updatedAt.toISOString()
              })
            }
          );
          expect(withdrawn.status).toBe(201);
          await expect(prisma.contractVersion.findUnique({
            where: { id: submittedVersionId },
            select: { status: true, firstSubmittedAt: true }
          })).resolves.toMatchObject({
            status: "draft",
            firstSubmittedAt: expect.any(Date)
          });

          const conflict = await submit(conflictedFixture, randomUUID());
          expect(conflict.status).toBe(409);
          expect(await conflict.json()).toMatchObject({
            code: "DRAFT_NOT_EDITABLE"
          });

          const originalRecord = audit.record.bind(audit);
          const auditFailure = jest.spyOn(audit, "record").mockImplementation((client, input) => {
            if (
              input.action === "contract.approval.submit" &&
              input.businessId === rollbackVersionId
            ) {
              throw new Error("injected contract submission audit failure");
            }
            return originalRecord(client, input);
          });
          try {
            const rollback = await submit(rollbackFixture, randomUUID());
            expect(rollback.status).toBe(500);
          } finally {
            auditFailure.mockRestore();
          }
          await expect(prisma.contractVersion.findUnique({
            where: { id: rollbackVersionId },
            select: { status: true, firstSubmittedAt: true }
          })).resolves.toEqual({ status: "draft", firstSubmittedAt: null });
          await expect(prisma.approvalInstance.count({
            where: { businessId: rollbackVersionId, flowType: "contract.approve" }
          })).resolves.toBe(0);
          await expect(prisma.contractDraftSubmissionRequest.count({
            where: { contractVersionId: rollbackVersionId }
          })).resolves.toBe(0);
          await expect(prisma.contractFormalFile.count({
            where: {
              contractVersionId: rollbackVersionId,
              purpose: "approval_original",
              status: "active"
            }
          })).resolves.toBe(0);
          await expect(prisma.auditLog.count({
            where: {
              action: {
                in: [
                  "contract.approval.submit",
                  "contract.formal_file.approval_bridge_from_counterparty"
                ]
              },
              businessId: rollbackVersionId
            }
          })).resolves.toBe(0);
        } finally {
          await prisma.auditLog.deleteMany({
            where: { businessId: { in: submissionVersionIds } }
          });
          await prisma.contractDraftSubmissionRequest.deleteMany({
            where: { contractVersionId: { in: submissionVersionIds } }
          });
          const submissionApprovalInstances = await prisma.approvalInstance.findMany({
            where: { businessId: { in: submissionVersionIds } },
            select: { id: true }
          });
          await prisma.approvalActionLog.deleteMany({
            where: { approvalInstanceId: { in: submissionApprovalInstances.map((item) => item.id) } }
          });
          await prisma.approvalInstance.deleteMany({
            where: { businessId: { in: submissionVersionIds } }
          });
          await prisma.contractDraftEditLease.deleteMany({
            where: { contractVersionId: { in: submissionVersionIds } }
          });
          await prisma.contractVersionAuthorizationLink.deleteMany({
            where: { contractVersionId: { in: submissionVersionIds } }
          });
          await prisma.contractPartySnapshot.deleteMany({
            where: { contractVersionId: { in: submissionVersionIds } }
          });
          const paymentTerms = await prisma.paymentTermsVersion.findMany({
            where: { contractVersionId: { in: submissionVersionIds } },
            select: { id: true }
          });
          await prisma.paymentTermsStage.deleteMany({
            where: { paymentTermsVersionId: { in: paymentTerms.map((item) => item.id) } }
          });
          await prisma.paymentTermsVersion.deleteMany({
            where: { contractVersionId: { in: submissionVersionIds } }
          });
          await prisma.contractFormalFile.deleteMany({
            where: { contractVersionId: { in: submissionVersionIds } }
          });
          await prisma.fileObject.deleteMany({
            where: {
              id: {
                in: submissionVersionIds.flatMap((_versionId, index) => [
                  `lifecycle-route-counterparty-original-file-${index}-${submissionSuffix}`,
                  `lifecycle-route-counterparty-preview-file-${index}-${submissionSuffix}`
                ])
              }
            }
          });
          await prisma.contractVersion.deleteMany({
            where: { id: { in: submissionVersionIds } }
          });
          await prisma.contract.deleteMany({
            where: { id: { in: submissionContractIds } }
          });
          await prisma.contractLayoutTemplateVersion.deleteMany({
            where: { id: layoutTemplateVersionId }
          });
          await prisma.contractLayoutTemplate.deleteMany({
            where: { id: layoutTemplateId }
          });
          await prisma.companyEntityVersion.deleteMany({
            where: { id: companyEntityVersionId }
          });
          await prisma.companyEntity.deleteMany({ where: { id: companyEntityId } });
        }
      } finally {
        if (app) await app.close();
        await prisma.projectMember.deleteMany({ where: { projectId } });
        await prisma.userPosition.deleteMany({
          where: { userId: { in: submissionUserIds } }
        });
        await prisma.contractVersion.deleteMany({
          where: { contractId: { in: contractIds } }
        });
        await prisma.contract.deleteMany({ where: { id: { in: contractIds } } });
        await prisma.project.deleteMany({ where: { id: projectId } });
        await prisma.position.deleteMany({
          where: {
            id: {
              in: [
                contractStaffPositionId,
                superAdminPositionId,
                contractDirectorPositionId,
                materialDirectorPositionId,
                financeDirectorPositionId,
                chairmanPositionId
              ]
            }
          }
        });
        await prisma.user.deleteMany({
          where: { id: { in: submissionUserIds } }
        });
        await prisma.$disconnect();
      }
    },
    60_000
  );
});
