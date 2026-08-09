import { PrismaClient } from "@prisma/client";
import { FileCleanupSeamService } from "../file/file-cleanup-seam.service";
import {
  CosVersionedObjectStorage,
  InMemoryVersionedObjectStorage
} from "../file/versioned-object-storage";
import { ContractEndedApplicationPurgeService } from "../contract-ended-purge/contract-ended-application-purge.service";

const TEST_DATABASE = "jiangkong_contract_draft_aggregate_test";

function localPurgeDatabaseUrl(value: string | undefined) {
  if (!value || process.env.NODE_ENV === "production") {
    throw new Error("结束申请物理清理测试必须连接非生产专用数据库");
  }
  const url = new URL(value);
  if (
    !["postgresql:", "postgres:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "::1"].includes(url.hostname) ||
    url.pathname !== `/${TEST_DATABASE}`
  ) {
    throw new Error("结束申请物理清理测试拒绝非本机专用数据库");
  }
  return url.toString();
}

describe("contract ended application purge PostgreSQL evidence", () => {
  const integrationTest =
    process.env.RUN_CONTRACT_DRAFT_AGGREGATE_DATABASE === "1" ? it : it.skip;

  integrationTest("retries object cleanup after business detachment, preserves shared evidence, and leaves only its formal-code tombstone", async () => {
    const databaseUrl = localPurgeDatabaseUrl(
      process.env.CONTRACT_DRAFT_AGGREGATE_DATABASE_URL
    );
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const suffix = `${process.pid}-${Date.now()}`;
    const ownerId = `ended-purge-owner-${suffix}`;
    const projectId = `ended-purge-project-${suffix}`;
    const contractId = `ended-purge-contract-${suffix}`;
    const contractVersionId = `${contractId}-v1`;
    const approvalInstanceId = `ended-purge-approval-${suffix}`;
    const formalCode = `HT-ENDED-PURGE-${suffix}`;
    const generatedDocumentId = `ended-purge-generated-document-${suffix}`;
    const draftFileId = `ended-purge-draft-file-${suffix}`;
    const actionFileId = `ended-purge-action-file-${suffix}`;
    const pdfFileId = `ended-purge-pdf-file-${suffix}`;
    const claimFileId = `ended-purge-claim-file-${suffix}`;
    const sharedFileId = `ended-purge-shared-file-${suffix}`;
    const keys = {
      draft: `uploads/ended-purge-draft-${suffix}.pdf`,
      action: `uploads/ended-purge-action-${suffix}.png`,
      pdf: `uploads/ended-purge-form-${suffix}.pdf`,
      claim: `uploads/ended-purge-claim-${suffix}.pdf`,
      shared: `uploads/ended-purge-shared-${suffix}.pdf`
    };
    const storage = new InMemoryVersionedObjectStorage();

    try {
      await prisma.user.create({
        data: { id: ownerId, name: "结束申请物理清理测试经办人", mustChangePassword: false }
      });
      await prisma.project.create({
        data: {
          id: projectId,
          code: `ENDED-PURGE-${suffix}`,
          name: "结束申请物理清理 PostgreSQL 测试项目"
        }
      });
      await prisma.contract.create({
        data: {
          id: contractId,
          projectId,
          code: formalCode,
          temporaryCode: `TMP-ENDED-PURGE-${suffix}`,
          name: "到期最终驳回清理测试合同",
          counterparty: "测试相对方",
          ownerUserId: ownerId
        }
      });
      const terminalAt = new Date("2026-08-31T10:15:00.000Z");
      await prisma.contractVersion.create({
        data: {
          id: contractVersionId,
          contractId,
          versionNo: 1,
          changeType: "original",
          status: "approval_rejected",
          firstSubmittedAt: terminalAt,
          endedAt: terminalAt,
          amountCents: 100n,
          draftData: {},
          templateSnapshot: {},
          clauseSnapshot: []
        }
      });
      await prisma.approvalInstance.create({
        data: {
          id: approvalInstanceId,
          flowType: "contract.approve",
          businessType: "contract_version",
          businessId: contractVersionId,
          status: "rejected",
          currentNodeIndex: 0,
          frozenNodes: [],
          applicantUserId: ownerId
        }
      });
      await Promise.all([
        prisma.fileObject.create({
          data: {
            id: draftFileId,
            bucket: "local-test",
            objectKey: keys.draft,
            originalName: "草稿附件.pdf",
            mimeType: "application/pdf",
            sizeBytes: 100,
            uploadedByUserId: ownerId
          }
        }),
        prisma.fileObject.create({
          data: {
            id: actionFileId,
            bucket: "local-test",
            objectKey: keys.action,
            originalName: "审批签名.png",
            mimeType: "image/png",
            sizeBytes: 101,
            uploadedByUserId: ownerId
          }
        }),
        prisma.fileObject.create({
          data: {
            id: pdfFileId,
            bucket: "local-test",
            objectKey: keys.pdf,
            originalName: "审批表.pdf",
            mimeType: "application/pdf",
            sizeBytes: 102,
            uploadedByUserId: ownerId
          }
        }),
        prisma.fileObject.create({
          data: {
            id: claimFileId,
            bucket: "local-test",
            objectKey: keys.claim,
            originalName: "审批声明.pdf",
            mimeType: "application/pdf",
            sizeBytes: 103,
            uploadedByUserId: ownerId
          }
        }),
        prisma.fileObject.create({
          data: {
            id: sharedFileId,
            bucket: "local-test",
            objectKey: keys.shared,
            originalName: "共享证据.pdf",
            mimeType: "application/pdf",
            sizeBytes: 104,
            uploadedByUserId: ownerId
          }
        })
      ]);
      await Promise.all([
        prisma.contractDraftAttachment.createMany({
          data: [
            {
              contractVersionId,
              slotKey: "draft",
              fileId: draftFileId,
              displayOrder: 0,
              createdByUserId: ownerId
            },
            {
              contractVersionId,
              slotKey: "evidence",
              fileId: sharedFileId,
              displayOrder: 0,
              createdByUserId: ownerId
            }
          ]
        }),
        prisma.approvalActionLog.create({
          data: {
            approvalInstanceId,
            action: "reject",
            actorUserId: ownerId,
            signatureFileIdSnapshot: actionFileId
          }
        }),
        prisma.pdfDocument.create({
          data: {
            businessType: "contract_version",
            businessId: contractVersionId,
            fileId: pdfFileId,
            templateKey: "approval_form",
            approvalInstanceId
          }
        }),
        prisma.approvalFormGenerationClaim.create({
          data: {
            approvalInstanceId,
            claimToken: `claim-${suffix}`,
            status: "uploaded",
            claimedAt: terminalAt,
            uploadedFileId: claimFileId
          }
        }),
        prisma.contractDraftSubmissionRequest.create({
          data: {
            idempotencyKey: `submission-${suffix}`,
            contractVersionId,
            expectedRevision: 1,
            applicantUserId: ownerId,
            requestSha256: "a".repeat(64),
            approvalInstanceId,
            formalCode,
            responseSnapshot: {}
          }
        }),
        prisma.contractGeneratedDocument.create({
          data: {
            id: generatedDocumentId,
            contractVersionId,
            layoutTemplateVersionId: `ended-purge-layout-${suffix}`,
            purpose: "external",
            sourceRevision: 1,
            inputSnapshot: {},
            idempotencyKey: `ended-purge-generated-document-${suffix}`,
            engineVersion: "test",
            createdByUserId: ownerId
          }
        }),
        prisma.auditLog.createMany({
          data: [
            {
              actorUserId: ownerId,
              action: "contract.approval.reject",
              businessType: "contract_version",
              businessId: contractVersionId
            },
            {
              actorUserId: ownerId,
              action: "contract.draft.create",
              businessType: "contract",
              businessId: contractId
            },
            {
              actorUserId: ownerId,
              action: "contract.document.queue",
              businessType: "contract_generated_document",
              businessId: generatedDocumentId
            },
            {
              actorUserId: ownerId,
              action: "external.evidence.keep",
              businessType: "external_business",
              businessId: `external-${suffix}`
            }
          ]
        }),
        prisma.archiveRecord.create({
          data: {
            businessType: "external_business",
            businessId: `external-${suffix}`,
            fileId: sharedFileId,
            departmentScope: "测试"
          }
        })
      ]);
      storage.seed(keys.draft, [
        { versionId: "v1", isLatest: false },
        { versionId: "delete-marker", isLatest: true, isDeleteMarker: true }
      ]);
      storage.seed(keys.action, [{ versionId: "v1", isLatest: true }]);
      storage.seed(keys.pdf, [{ versionId: "v1", isLatest: true }]);
      storage.seed(keys.claim, [{ versionId: "v1", isLatest: true }]);
      storage.seed(keys.shared, [{ versionId: "v1", isLatest: true }]);
      storage.simulateNextListFailure();
      storage.simulateNextListFailure();
      storage.simulateNextListFailure();

      const service = new ContractEndedApplicationPurgeService(
        prisma as never,
        new FileCleanupSeamService(prisma as never),
        storage
      );
      const failed = await service.purgeEligibleApplications(
        new Date("2026-12-02T10:15:00.000Z"),
        10
      );

      expect(failed).toMatchObject({
        scannedCount: 1,
        completedCount: 0,
        retryableCount: 1,
        skippedCount: 0
      });
      await expect(prisma.contract.findUnique({
        where: { id: contractId },
        select: { id: true }
      })).resolves.toBeNull();
      await expect(prisma.fileObject.count({
        where: { id: { in: [draftFileId, actionFileId, pdfFileId, claimFileId] } }
      })).resolves.toBe(4);
      await expect(prisma.contractEndedApplicationPurgeReceipt.findUnique({
        where: { contractVersionId },
        select: { status: true, completedAt: true }
      })).resolves.toEqual({ status: "retryable", completedAt: null });

      const recovered = await service.purgeEligibleApplications(
        new Date("2026-12-02T10:15:00.000Z"),
        10
      );
      expect(recovered).toMatchObject({
        scannedCount: 1,
        completedCount: 1,
        retryableCount: 0,
        skippedCount: 0
      });
      await expect(prisma.contract.findUnique({
        where: { id: contractId },
        select: { id: true }
      })).resolves.toBeNull();
      await expect(prisma.contractVersion.count({
        where: { id: contractVersionId }
      })).resolves.toBe(0);
      await expect(prisma.approvalInstance.count({
        where: { id: approvalInstanceId }
      })).resolves.toBe(0);
      await expect(prisma.approvalActionLog.count({
        where: { approvalInstanceId }
      })).resolves.toBe(0);
      await expect(prisma.auditLog.count({
        where: { businessId: { in: [contractVersionId, contractId, generatedDocumentId] } }
      })).resolves.toBe(0);
      await expect(prisma.contractNumberTombstone.findUnique({
        where: { formalCode },
        select: { formalCode: true }
      })).resolves.toEqual({ formalCode });
      await expect(prisma.contractEndedApplicationPurgeReceipt.findUnique({
        where: { contractVersionId },
        select: {
          status: true,
          exclusiveFileCount: true,
          sharedFileCount: true,
          completedAt: true
        }
      })).resolves.toMatchObject({
        status: "completed",
        exclusiveFileCount: 4,
        sharedFileCount: 1,
        completedAt: expect.any(Date)
      });
      await expect(prisma.fileObject.count({
        where: { id: { in: [draftFileId, actionFileId, pdfFileId, claimFileId] } }
      })).resolves.toBe(0);
      await expect(prisma.fileObject.count({ where: { id: sharedFileId } })).resolves.toBe(1);
      await expect(storage.isConverged(keys.draft)).resolves.toBe(true);
      await expect(storage.isConverged(keys.action)).resolves.toBe(true);
      await expect(storage.isConverged(keys.pdf)).resolves.toBe(true);
      await expect(storage.isConverged(keys.claim)).resolves.toBe(true);
      await expect(storage.isConverged(keys.shared)).resolves.toBe(false);
      await expect(service.purgeEligibleApplications(
        new Date("2026-12-02T10:15:00.000Z"),
        10
      )).resolves.toMatchObject({
        scannedCount: 0,
        completedCount: 0,
        retryableCount: 0,
        skippedCount: 0
      });
    } finally {
      await prisma.archiveRecord.deleteMany({ where: { businessId: `external-${suffix}` } });
      await prisma.auditLog.deleteMany({
        where: {
          businessId: {
            in: [contractId, contractVersionId, generatedDocumentId, `external-${suffix}`]
          }
        }
      });
      await prisma.contractEndedApplicationPurgeReceipt.deleteMany({
        where: { contractVersionId }
      }).catch(() => undefined);
      await prisma.contractNumberTombstone.deleteMany({ where: { formalCode } });
      await prisma.contractEndedApplicationRetentionHold.deleteMany({ where: { contractVersionId } });
      await prisma.approvalFormGenerationClaim.deleteMany({ where: { approvalInstanceId } });
      await prisma.pdfDocument.deleteMany({ where: { approvalInstanceId } });
      await prisma.approvalActionLog.deleteMany({ where: { approvalInstanceId } });
      await prisma.contractDraftSubmissionRequest.deleteMany({ where: { contractVersionId } });
      await prisma.approvalInstance.deleteMany({ where: { id: approvalInstanceId } });
      await prisma.contractGeneratedDocument.deleteMany({ where: { id: generatedDocumentId } });
      await prisma.contractDraftAttachment.deleteMany({ where: { contractVersionId } });
      await prisma.contractVersion.deleteMany({ where: { id: contractVersionId } });
      await prisma.contract.deleteMany({ where: { id: contractId } });
      await prisma.fileObject.deleteMany({
        where: { id: { in: [draftFileId, actionFileId, pdfFileId, claimFileId, sharedFileId] } }
      });
      await prisma.project.deleteMany({ where: { id: projectId } });
      await prisma.user.deleteMany({ where: { id: ownerId } });
      await prisma.$disconnect();
    }
  }, 30_000);

  integrationTest("refuses a historical bucket mismatch before any COS deletion and leaves a retryable technical receipt", async () => {
    const databaseUrl = localPurgeDatabaseUrl(
      process.env.CONTRACT_DRAFT_AGGREGATE_DATABASE_URL
    );
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const suffix = `${process.pid}-${Date.now()}`;
    const ownerId = `ended-purge-bucket-owner-${suffix}`;
    const projectId = `ended-purge-bucket-project-${suffix}`;
    const contractId = `ended-purge-bucket-contract-${suffix}`;
    const contractVersionId = `${contractId}-v1`;
    const formalCode = `HT-ENDED-PURGE-BUCKET-${suffix}`;
    const fileId = `ended-purge-bucket-file-${suffix}`;
    const originalBucket = process.env.COS_BUCKET;
    const fetchImpl = jest.fn(async () => {
      throw new Error("bucket mismatch must block before COS access");
    });
    process.env.COS_BUCKET = "current-controlled-bucket";

    try {
      await prisma.user.create({
        data: { id: ownerId, name: "结束申请桶保护测试经办人", mustChangePassword: false }
      });
      await prisma.project.create({
        data: {
          id: projectId,
          code: `ENDED-PURGE-BUCKET-${suffix}`,
          name: "结束申请桶保护 PostgreSQL 测试项目"
        }
      });
      await prisma.contract.create({
        data: {
          id: contractId,
          projectId,
          code: formalCode,
          temporaryCode: `TMP-${formalCode}`,
          name: "历史桶失配清理测试合同",
          counterparty: "测试相对方",
          ownerUserId: ownerId
        }
      });
      await prisma.contractVersion.create({
        data: {
          id: contractVersionId,
          contractId,
          versionNo: 1,
          changeType: "original",
          status: "approval_rejected",
          firstSubmittedAt: new Date("2026-08-31T10:15:00.000Z"),
          endedAt: new Date("2026-08-31T10:15:00.000Z"),
          amountCents: 100n,
          draftData: {},
          templateSnapshot: {},
          clauseSnapshot: []
        }
      });
      await prisma.fileObject.create({
        data: {
          id: fileId,
          bucket: "legacy-private-bucket",
          objectKey: `uploads/ended-purge-bucket-${suffix}.pdf`,
          originalName: "历史桶草稿.pdf",
          mimeType: "application/pdf",
          sizeBytes: 100,
          uploadedByUserId: ownerId
        }
      });
      await prisma.contractDraftAttachment.create({
        data: {
          contractVersionId,
          slotKey: "draft",
          fileId,
          displayOrder: 0,
          createdByUserId: ownerId
        }
      });

      const service = new ContractEndedApplicationPurgeService(
        prisma as never,
        new FileCleanupSeamService(prisma as never),
        new CosVersionedObjectStorage({ fetchImpl: fetchImpl as typeof fetch })
      );
      await expect(service.purgeEligibleApplications(
        new Date("2026-12-02T10:15:00.000Z"),
        10
      )).resolves.toMatchObject({
        scannedCount: 1,
        completedCount: 0,
        retryableCount: 1,
        skippedCount: 0
      });
      expect(fetchImpl).not.toHaveBeenCalled();
      await expect(prisma.contract.findUnique({
        where: { id: contractId },
        select: { id: true }
      })).resolves.toBeNull();
      await expect(prisma.fileObject.findUnique({
        where: { id: fileId },
        select: { bucket: true, purgeReceiptId: true }
      })).resolves.toMatchObject({
        bucket: "legacy-private-bucket",
        purgeReceiptId: expect.any(String)
      });
      await expect(prisma.contractEndedApplicationPurgeReceipt.findUnique({
        where: { contractVersionId },
        select: { status: true }
      })).resolves.toEqual({ status: "retryable" });
    } finally {
      if (originalBucket === undefined) {
        delete process.env.COS_BUCKET;
      } else {
        process.env.COS_BUCKET = originalBucket;
      }
      await prisma.contractDraftAttachment.deleteMany({ where: { contractVersionId } });
      await prisma.contractEndedApplicationPurgeReceipt.deleteMany({ where: { contractVersionId } });
      await prisma.contractNumberTombstone.deleteMany({ where: { formalCode } });
      await prisma.contractVersion.deleteMany({ where: { id: contractVersionId } });
      await prisma.contract.deleteMany({ where: { id: contractId } });
      await prisma.fileObject.deleteMany({ where: { id: fileId } });
      await prisma.project.deleteMany({ where: { id: projectId } });
      await prisma.user.deleteMany({ where: { id: ownerId } });
      await prisma.$disconnect();
    }
  }, 30_000);

  integrationTest("rejects active or recently released holds, effective or historical records, and non-deletable contract audit without deleting business data", async () => {
    const databaseUrl = localPurgeDatabaseUrl(
      process.env.CONTRACT_DRAFT_AGGREGATE_DATABASE_URL
    );
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const suffix = `${process.pid}-${Date.now()}`;
    const ownerId = `ended-purge-protected-owner-${suffix}`;
    const projectId = `ended-purge-protected-project-${suffix}`;
    const terminalAt = new Date("2026-08-31T10:15:00.000Z");
    const now = new Date("2026-12-02T10:15:00.000Z");
    const candidates = [
      { kind: "active-hold", source: "system", effectiveAt: null },
      { kind: "released-buffer", source: "system", effectiveAt: null },
      { kind: "non-deletable-audit", source: "system", effectiveAt: null },
      { kind: "non-deletable-nested-audit", source: "system", effectiveAt: null },
      { kind: "copied-source", source: "system", effectiveAt: null },
      { kind: "effective", source: "system", effectiveAt: terminalAt },
      { kind: "historical", source: "historical_takeover", effectiveAt: null }
    ].map((candidate) => ({
      ...candidate,
      contractId: `ended-purge-protected-${candidate.kind}-${suffix}`,
      contractVersionId: `ended-purge-protected-${candidate.kind}-${suffix}-v1`,
      formalCode: `HT-ENDED-PURGE-${candidate.kind}-${suffix}`
    }));
    const activeHold = candidates.find((candidate) => candidate.kind === "active-hold")!;
    const releasedBuffer = candidates.find((candidate) => candidate.kind === "released-buffer")!;
    const auditProtected = candidates.find((candidate) => candidate.kind === "non-deletable-audit")!;
    const nestedAuditProtected = candidates.find(
      (candidate) => candidate.kind === "non-deletable-nested-audit"
    )!;
    const copiedSource = candidates.find((candidate) => candidate.kind === "copied-source")!;
    const nestedGeneratedDocumentId = `ended-purge-protected-document-${suffix}`;
    const copiedContractId = `ended-purge-copy-target-${suffix}`;
    const copiedVersionId = `${copiedContractId}-v1`;

    try {
      await prisma.user.create({
        data: { id: ownerId, name: "结束申请保护测试经办人", mustChangePassword: false }
      });
      await prisma.project.create({
        data: {
          id: projectId,
          code: `ENDED-PURGE-PROTECTED-${suffix}`,
          name: "结束申请保护 PostgreSQL 测试项目"
        }
      });
      await Promise.all(candidates.map((candidate) => prisma.contract.create({
        data: {
          id: candidate.contractId,
          projectId,
          source: candidate.source,
          code: candidate.formalCode,
          temporaryCode: `TMP-${candidate.formalCode}`,
          name: `结束申请保护-${candidate.kind}`,
          counterparty: "测试相对方",
          ownerUserId: ownerId
        }
      })));
      await Promise.all(candidates.map((candidate) => prisma.contractVersion.create({
        data: {
          id: candidate.contractVersionId,
          contractId: candidate.contractId,
          versionNo: 1,
          changeType: "original",
          status: "approval_rejected",
          firstSubmittedAt: terminalAt,
          endedAt: terminalAt,
          effectiveAt: candidate.effectiveAt,
          amountCents: 100n,
          draftData: {},
          templateSnapshot: {},
          clauseSnapshot: []
        }
      })));
      await prisma.contract.create({
        data: {
          id: copiedContractId,
          projectId,
          code: `HT-ENDED-PURGE-COPY-TARGET-${suffix}`,
          temporaryCode: `TMP-ENDED-PURGE-COPY-TARGET-${suffix}`,
          name: "结束申请复制引用保护合同",
          counterparty: "测试相对方",
          ownerUserId: ownerId
        }
      });
      await prisma.contractVersion.create({
        data: {
          id: copiedVersionId,
          contractId: copiedContractId,
          versionNo: 1,
          changeType: "original",
          status: "draft",
          copiedFromContractVersionId: copiedSource.contractVersionId,
          amountCents: 100n,
          draftData: {},
          templateSnapshot: {},
          clauseSnapshot: []
        }
      });
      await Promise.all([
        prisma.contractEndedApplicationRetentionHold.create({
          data: {
            contractVersionId: activeHold.contractVersionId,
            reason: "争议未解决",
            createdByUserId: ownerId
          }
        }),
        prisma.contractEndedApplicationRetentionHold.create({
          data: {
            contractVersionId: releasedBuffer.contractVersionId,
            reason: "已释放但仍在缓冲",
            createdByUserId: ownerId,
            releasedAt: new Date("2026-12-01T10:15:00.000Z"),
            releasedByUserId: ownerId,
            releaseReason: "材料已补齐"
          }
        }),
        prisma.auditLog.create({
          data: {
            actorUserId: ownerId,
            action: "contract.formal_file.upload",
            businessType: "contract",
            businessId: auditProtected.contractId
          }
        }),
        prisma.contractGeneratedDocument.create({
          data: {
            id: nestedGeneratedDocumentId,
            contractVersionId: nestedAuditProtected.contractVersionId,
            layoutTemplateVersionId: `ended-purge-protected-layout-${suffix}`,
            purpose: "external",
            sourceRevision: 1,
            inputSnapshot: {},
            idempotencyKey: `ended-purge-protected-document-${suffix}`,
            engineVersion: "test",
            createdByUserId: ownerId
          }
        }),
        prisma.auditLog.create({
          data: {
            actorUserId: ownerId,
            action: "external.evidence.keep",
            businessType: "contract_generated_document",
            businessId: nestedGeneratedDocumentId
          }
        })
      ]);

      const service = new ContractEndedApplicationPurgeService(
        prisma as never,
        new FileCleanupSeamService(prisma as never),
        new InMemoryVersionedObjectStorage()
      );
      await expect(service.purgeEligibleApplications(now, 10)).resolves.toMatchObject({
        scannedCount: 7,
        completedCount: 0,
        retryableCount: 0,
        skippedCount: 7
      });
      await expect(prisma.contractVersion.count({
        where: { id: { in: candidates.map((candidate) => candidate.contractVersionId) } }
      })).resolves.toBe(7);
      await expect(prisma.contract.count({
        where: { id: { in: candidates.map((candidate) => candidate.contractId) } }
      })).resolves.toBe(7);
      await expect(prisma.contractEndedApplicationPurgeReceipt.count({
        where: { contractVersionId: { in: candidates.map((candidate) => candidate.contractVersionId) } }
      })).resolves.toBe(0);
      await expect(prisma.contractEndedApplicationRetentionHold.count({
        where: { contractVersionId: { in: [activeHold.contractVersionId, releasedBuffer.contractVersionId] } }
      })).resolves.toBe(2);
      await expect(prisma.auditLog.count({
        where: { businessId: auditProtected.contractId, action: "contract.formal_file.upload" }
      })).resolves.toBe(1);
      await expect(prisma.auditLog.count({
        where: { businessId: nestedGeneratedDocumentId, action: "external.evidence.keep" }
      })).resolves.toBe(1);
      await expect(prisma.contractGeneratedDocument.count({
        where: { id: nestedGeneratedDocumentId }
      })).resolves.toBe(1);
      await expect(prisma.contractVersion.count({ where: { id: copiedVersionId } })).resolves.toBe(1);
    } finally {
      await prisma.auditLog.deleteMany({
        where: {
          businessId: {
            in: [...candidates.map((candidate) => candidate.contractId), nestedGeneratedDocumentId]
          }
        }
      });
      await prisma.contractGeneratedDocument.deleteMany({
        where: { id: nestedGeneratedDocumentId }
      });
      await prisma.contractEndedApplicationRetentionHold.deleteMany({
        where: { contractVersionId: { in: candidates.map((candidate) => candidate.contractVersionId) } }
      });
      await prisma.contractVersion.deleteMany({ where: { id: copiedVersionId } });
      await prisma.contract.deleteMany({ where: { id: copiedContractId } });
      await prisma.contractEndedApplicationPurgeReceipt.deleteMany({
        where: { contractVersionId: { in: candidates.map((candidate) => candidate.contractVersionId) } }
      });
      await prisma.contractNumberTombstone.deleteMany({
        where: { formalCode: { in: candidates.map((candidate) => candidate.formalCode) } }
      });
      await prisma.contractVersion.deleteMany({
        where: { id: { in: candidates.map((candidate) => candidate.contractVersionId) } }
      });
      await prisma.contract.deleteMany({
        where: { id: { in: candidates.map((candidate) => candidate.contractId) } }
      });
      await prisma.project.deleteMany({ where: { id: projectId } });
      await prisma.user.deleteMany({ where: { id: ownerId } });
      await prisma.$disconnect();
    }
  }, 30_000);

  integrationTest("retries after COS converges but final technical receipt persistence fails", async () => {
    const databaseUrl = localPurgeDatabaseUrl(
      process.env.CONTRACT_DRAFT_AGGREGATE_DATABASE_URL
    );
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const suffix = `${process.pid}-${Date.now()}`;
    const ownerId = `ended-purge-commit-owner-${suffix}`;
    const projectId = `ended-purge-commit-project-${suffix}`;
    const contractId = `ended-purge-commit-contract-${suffix}`;
    const contractVersionId = `${contractId}-v1`;
    const formalCode = `HT-ENDED-PURGE-COMMIT-${suffix}`;
    const fileId = `ended-purge-commit-file-${suffix}`;
    const objectKey = `uploads/ended-purge-commit-${suffix}.pdf`;
    const storage = new InMemoryVersionedObjectStorage();
    let completedReceiptUpdateFailed = false;
    prisma.$use(async (params, next) => {
      if (
        !completedReceiptUpdateFailed &&
        params.model === "ContractEndedApplicationPurgeReceipt" &&
        params.action === "update" &&
        params.args.data?.status === "completed"
      ) {
        completedReceiptUpdateFailed = true;
        throw new Error("simulated receipt persistence failure after COS convergence");
      }
      return next(params);
    });

    try {
      await prisma.user.create({
        data: { id: ownerId, name: "结束申请补偿测试经办人", mustChangePassword: false }
      });
      await prisma.project.create({
        data: {
          id: projectId,
          code: `ENDED-PURGE-COMMIT-${suffix}`,
          name: "结束申请补偿 PostgreSQL 测试项目"
        }
      });
      await prisma.contract.create({
        data: {
          id: contractId,
          projectId,
          code: formalCode,
          temporaryCode: `TMP-${formalCode}`,
          name: "结束申请 COS 后回执失败测试合同",
          counterparty: "测试相对方",
          ownerUserId: ownerId
        }
      });
      await prisma.contractVersion.create({
        data: {
          id: contractVersionId,
          contractId,
          versionNo: 1,
          changeType: "original",
          status: "approval_rejected",
          firstSubmittedAt: new Date("2026-08-31T10:15:00.000Z"),
          endedAt: new Date("2026-08-31T10:15:00.000Z"),
          amountCents: 100n,
          draftData: {},
          templateSnapshot: {},
          clauseSnapshot: []
        }
      });
      await prisma.fileObject.create({
        data: {
          id: fileId,
          bucket: "local-test",
          objectKey,
          originalName: "补偿测试附件.pdf",
          mimeType: "application/pdf",
          sizeBytes: 100,
          uploadedByUserId: ownerId
        }
      });
      await prisma.contractDraftAttachment.create({
        data: {
          contractVersionId,
          slotKey: "draft",
          fileId,
          displayOrder: 0,
          createdByUserId: ownerId
        }
      });
      storage.seed(objectKey, [{ versionId: "v1", isLatest: true }]);

      const service = new ContractEndedApplicationPurgeService(
        prisma as never,
        new FileCleanupSeamService(prisma as never),
        storage
      );
      await expect(service.purgeEligibleApplications(
        new Date("2026-12-02T10:15:00.000Z"),
        10
      )).resolves.toMatchObject({
        scannedCount: 1,
        completedCount: 0,
        retryableCount: 1,
        skippedCount: 0
      });
      expect(completedReceiptUpdateFailed).toBe(true);
      await expect(storage.isConverged(objectKey)).resolves.toBe(true);
      await expect(prisma.contract.findUnique({
        where: { id: contractId },
        select: { id: true }
      })).resolves.toBeNull();
      await expect(prisma.fileObject.count({ where: { id: fileId } })).resolves.toBe(1);
      await expect(prisma.contractEndedApplicationPurgeReceipt.findUnique({
        where: { contractVersionId },
        select: { status: true }
      })).resolves.toEqual({ status: "retryable" });

      await expect(service.purgeEligibleApplications(
        new Date("2026-12-02T10:15:00.000Z"),
        10
      )).resolves.toMatchObject({
        scannedCount: 1,
        completedCount: 1,
        retryableCount: 0,
        skippedCount: 0
      });
      await expect(prisma.fileObject.count({ where: { id: fileId } })).resolves.toBe(0);
      await expect(prisma.contractEndedApplicationPurgeReceipt.findUnique({
        where: { contractVersionId },
        select: { status: true, completedAt: true }
      })).resolves.toMatchObject({ status: "completed", completedAt: expect.any(Date) });
    } finally {
      await prisma.contractDraftAttachment.deleteMany({ where: { contractVersionId } });
      await prisma.contractEndedApplicationPurgeReceipt.deleteMany({ where: { contractVersionId } });
      await prisma.contractNumberTombstone.deleteMany({ where: { formalCode } });
      await prisma.contractVersion.deleteMany({ where: { id: contractVersionId } });
      await prisma.contract.deleteMany({ where: { id: contractId } });
      await prisma.fileObject.deleteMany({ where: { id: fileId } });
      await prisma.project.deleteMany({ where: { id: projectId } });
      await prisma.user.deleteMany({ where: { id: ownerId } });
      await prisma.$disconnect();
    }
  }, 30_000);

  integrationTest("fails closed when the ended-application retention policy is absent", async () => {
    const databaseUrl = localPurgeDatabaseUrl(
      process.env.CONTRACT_DRAFT_AGGREGATE_DATABASE_URL
    );
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const suffix = `${process.pid}-${Date.now()}`;
    const ownerId = `ended-purge-policy-owner-${suffix}`;
    const projectId = `ended-purge-policy-project-${suffix}`;
    const contractId = `ended-purge-policy-contract-${suffix}`;
    const contractVersionId = `${contractId}-v1`;
    const formalCode = `HT-ENDED-PURGE-POLICY-${suffix}`;
    const originalPolicy = await prisma.contractEndedApplicationRetentionPolicy.findUnique({
      where: { id: "contract-ended-retention-v1" },
      select: { activatedAt: true }
    });

    try {
      await prisma.user.create({
        data: { id: ownerId, name: "结束申请策略测试经办人", mustChangePassword: false }
      });
      await prisma.project.create({
        data: {
          id: projectId,
          code: `ENDED-PURGE-POLICY-${suffix}`,
          name: "结束申请策略缺失 PostgreSQL 测试项目"
        }
      });
      await prisma.contract.create({
        data: {
          id: contractId,
          projectId,
          code: formalCode,
          temporaryCode: `TMP-${formalCode}`,
          name: "结束申请策略缺失测试合同",
          counterparty: "测试相对方",
          ownerUserId: ownerId
        }
      });
      await prisma.contractVersion.create({
        data: {
          id: contractVersionId,
          contractId,
          versionNo: 1,
          changeType: "original",
          status: "approval_rejected",
          firstSubmittedAt: new Date("2026-08-31T10:15:00.000Z"),
          endedAt: new Date("2026-08-31T10:15:00.000Z"),
          amountCents: 100n,
          draftData: {},
          templateSnapshot: {},
          clauseSnapshot: []
        }
      });
      await prisma.contractEndedApplicationRetentionPolicy.deleteMany({
        where: { id: "contract-ended-retention-v1" }
      });

      const service = new ContractEndedApplicationPurgeService(
        prisma as never,
        new FileCleanupSeamService(prisma as never),
        new InMemoryVersionedObjectStorage()
      );
      await expect(service.purgeEligibleApplications(
        new Date("2026-12-02T10:15:00.000Z"),
        10
      )).resolves.toMatchObject({
        scannedCount: 1,
        completedCount: 0,
        retryableCount: 0,
        skippedCount: 1
      });
      await expect(prisma.contractVersion.count({ where: { id: contractVersionId } })).resolves.toBe(1);
      await expect(prisma.contractEndedApplicationPurgeReceipt.count({
        where: { contractVersionId }
      })).resolves.toBe(0);
    } finally {
      if (originalPolicy) {
        await prisma.contractEndedApplicationRetentionPolicy.upsert({
          where: { id: "contract-ended-retention-v1" },
          create: { id: "contract-ended-retention-v1", activatedAt: originalPolicy.activatedAt },
          update: { activatedAt: originalPolicy.activatedAt }
        });
      }
      await prisma.contractEndedApplicationPurgeReceipt.deleteMany({
        where: { contractVersionId }
      });
      await prisma.contractNumberTombstone.deleteMany({ where: { formalCode } });
      await prisma.contractVersion.deleteMany({ where: { id: contractVersionId } });
      await prisma.contract.deleteMany({ where: { id: contractId } });
      await prisma.project.deleteMany({ where: { id: projectId } });
      await prisma.user.deleteMany({ where: { id: ownerId } });
      await prisma.$disconnect();
    }
  }, 30_000);
});
