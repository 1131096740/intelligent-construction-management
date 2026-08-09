import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { PrismaService } from "../database/prisma.service";
import { addShanghaiCalendarMonths } from "../contract/contract-retention-calendar";
import {
  acquireFileBusinessBindingTransactionLock
} from "../file/file-business-binding";
import { buildContractFileBindingManifest } from "../file/file-binding-manifest";
import {
  CleanupScopeError,
  FileCleanupSeamService,
  PartialDeletionError
} from "../file/file-cleanup-seam.service";
import {
  CosVersionedObjectStorage,
  type VersionedObjectStorage
} from "../file/versioned-object-storage";
import type { DeleteContractDraftDto } from "./dto/contract-workbench.dto";

export const PRISTINE_DRAFT_DELETION_STORAGE = Symbol(
  "PRISTINE_DRAFT_DELETION_STORAGE"
);

interface LockedPristineDraft {
  id: string;
  contractId: string;
  projectId: string;
  name: string;
  code: string | null;
  ownerUserId: string | null;
  changeType: string;
  status: string;
  draftRevision: number;
  firstSubmittedAt: Date | null;
  effectiveAt: Date | null;
  baseVersionId: string | null;
  supersedesVersionId: string | null;
  copiedFromContractVersionId: string | null;
}

interface DeletionReceipt {
  id: string;
  contractVersionId: string;
  ownerUserId: string | null;
  deletedByUserId: string;
  requestedRevision: number;
  status: string;
  completedAt: Date | null;
}

class CleanupBlockedError extends Error {
  constructor() {
    super("草稿文件清理边界尚未满足");
    this.name = "CleanupBlockedError";
  }
}

export function threeCalendarMonthsAfter(value: Date): Date {
  return addShanghaiCalendarMonths(value, 3);
}

function deletionAggregateHash(input: {
  contractId: string;
  contractVersionId: string;
  formalCode: string | null;
  fileRows: Array<{
    fileId: string;
    bindingType: string;
    contentSha256?: string | null;
  }>;
}): string {
  const files = [...input.fileRows]
    .map((row) => ({
      fileId: row.fileId,
      bindingType: row.bindingType,
      contentSha256: row.contentSha256 ?? null
    }))
    .sort((left, right) => left.fileId.localeCompare(right.fileId));
  return createHash("sha256")
    .update(JSON.stringify({
      contractId: input.contractId,
      contractVersionId: input.contractVersionId,
      formalCode: input.formalCode,
      files
    }))
    .digest("hex");
}

function retryableFailureCode(error: unknown): string {
  if (error instanceof PartialDeletionError) return "object_cleanup_not_converged";
  if (error instanceof CleanupScopeError || error instanceof CleanupBlockedError) {
    return "file_cleanup_scope_blocked";
  }
  return "cleanup_retryable";
}

@Injectable()
export class PristineDraftDeletionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fileCleanup: FileCleanupSeamService,
    @Inject(PRISTINE_DRAFT_DELETION_STORAGE)
    private readonly storage: VersionedObjectStorage = new CosVersionedObjectStorage()
  ) {}

  async deletePristineDraft(
    contractVersionId: string,
    actorUserId: string,
    input: DeleteContractDraftDto
  ) {
    const begun = await this.begin(contractVersionId, actorUserId, input.expectedRevision);
    if (begun.completed) {
      return this.deletedResponse(contractVersionId, true);
    }

    try {
      await this.purge(contractVersionId);
      return this.deletedResponse(contractVersionId, false);
    } catch (error) {
      await this.markRetryable(contractVersionId, retryableFailureCode(error));
      return {
        contractVersionId,
        status: "deleting" as const,
        lifecycleKind: "pristine_draft" as const,
        retryable: true
      };
    }
  }

  private deletedResponse(contractVersionId: string, idempotent: boolean) {
    return {
      contractVersionId,
      status: "deleted" as const,
      lifecycleKind: "pristine_draft" as const,
      idempotent
    };
  }

  private async begin(
    contractVersionId: string,
    actorUserId: string,
    expectedRevision: number
  ): Promise<{ completed: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<LockedPristineDraft[]>(Prisma.sql`
        SELECT
          v."id", v."contractId", c."projectId", c."name", c."code", c."ownerUserId",
          v."changeType", v."status", v."draftRevision", v."firstSubmittedAt",
          v."effectiveAt", v."baseVersionId", v."supersedesVersionId",
          v."copiedFromContractVersionId"
        FROM "ContractVersion" v
        JOIN "Contract" c ON c."id" = v."contractId"
        WHERE v."id" = ${contractVersionId}
        FOR UPDATE OF c, v
      `);
      if (!locked) {
        const receipt = await tx.contractPristineDraftDeletionReceipt.findUnique({
          where: { contractVersionId },
          select: {
            id: true,
            contractVersionId: true,
            ownerUserId: true,
            deletedByUserId: true,
            requestedRevision: true,
            status: true,
            completedAt: true
          }
        });
        if (receipt?.status === "completed") {
          await this.assertReceiptActor(tx, receipt, actorUserId);
          return { completed: true };
        }
        throw new NotFoundException("未找到合同草稿，请刷新合同工作台后重试");
      }

      const canOperate = locked.ownerUserId === actorUserId ||
        await this.hasGlobalDraftDeletionRole(tx, actorUserId);
      if (!canOperate) {
        throw new ForbiddenException("只有当前合同经办人或合同部主管可以删除纯净草稿");
      }

      if (locked.status === "deleting") {
        const receipt = await tx.contractPristineDraftDeletionReceipt.findUnique({
          where: { contractVersionId },
          select: {
            id: true,
            contractVersionId: true,
            ownerUserId: true,
            deletedByUserId: true,
            requestedRevision: true,
            status: true,
            completedAt: true
          }
        });
        if (!receipt) {
          throw new ConflictException("草稿删除状态不完整，请联系系统管理员处理");
        }
        if (receipt.requestedRevision !== expectedRevision) {
          throw new ConflictException("删除确认对应的草稿修订已变化，请刷新后重试");
        }
        return { completed: receipt.status === "completed" };
      }

      this.assertEligibleVersion(locked, expectedRevision);
      await this.assertNoSubmissionOrFormalFacts(tx, locked);

      const now = new Date();
      await tx.contractPristineDraftDeletionReceipt.create({
        data: {
          projectId: locked.projectId,
          contractId: locked.contractId,
          contractVersionId: locked.id,
          contractName: locked.name,
          formalCode: locked.code,
          ownerUserId: locked.ownerUserId,
          deletedByUserId: actorUserId,
          requestedRevision: expectedRevision,
          status: "deleting",
          expiresAt: threeCalendarMonthsAfter(now)
        }
      });
      const transitioned = await tx.contractVersion.updateMany({
        where: {
          id: locked.id,
          status: "draft",
          draftRevision: expectedRevision,
          firstSubmittedAt: null,
          effectiveAt: null
        },
        data: {
          status: "deleting",
          draftRevision: { increment: 1 }
        }
      });
      if (transitioned.count !== 1) {
        throw new ConflictException("合同草稿已被其他操作更新，请刷新后重试");
      }
      await tx.contractDraftEditLease.deleteMany({
        where: { contractVersionId: locked.id }
      });
      return { completed: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private assertEligibleVersion(
    locked: LockedPristineDraft,
    expectedRevision: number
  ): void {
    if (locked.status !== "draft") {
      throw new ConflictException("只有从未提交的合同草稿可以立即删除");
    }
    if (locked.draftRevision !== expectedRevision) {
      throw new ConflictException("合同草稿已被更新，请刷新后再删除");
    }
    if (locked.firstSubmittedAt || locked.effectiveAt || locked.changeType !== "original" ||
      locked.baseVersionId || locked.supersedesVersionId || locked.copiedFromContractVersionId) {
      throw new ConflictException("当前合同已有提交、变更或正式业务事实，不能立即删除");
    }
  }

  private async assertNoSubmissionOrFormalFacts(
    tx: Prisma.TransactionClient,
    locked: LockedPristineDraft
  ): Promise<void> {
    const [
      submission,
      approval,
      downstream,
      takeover,
      formalArtifacts,
      siblingVersion,
      billTransition,
      settlementFacts
    ] = await Promise.all([
      tx.contractDraftSubmissionRequest.findFirst({
        where: { contractVersionId: locked.id },
        select: { idempotencyKey: true }
      }),
      tx.approvalInstance.findFirst({
        where: { businessId: locked.id },
        select: { id: true }
      }),
      tx.contractSettlementProcess.findFirst({
        where: { contractVersionId: locked.id },
        select: { id: true }
      }),
      tx.contractTakeover.findFirst({
        where: { contractVersionId: locked.id },
        select: { id: true }
      }),
      Promise.all([
        tx.contractArchiveFile.findFirst({
          where: { contractVersionId: locked.id },
          select: { id: true }
        }),
        tx.contractFormalFile.findFirst({
          where: { contractVersionId: locked.id },
          select: { id: true }
        }),
        tx.contractAuthorization.findFirst({
          where: { originContractVersionId: locked.id },
          select: { id: true }
        }),
        tx.contractSealTask.findFirst({
          where: { contractVersionId: locked.id },
          select: { id: true }
        })
      ]),
      tx.contractVersion.findFirst({
        where: { contractId: locked.contractId, id: { not: locked.id } },
        select: { id: true }
      }),
      tx.contractBillRowTransition.findFirst({
        where: {
          OR: [
            { fromContractVersionId: locked.id },
            { toContractVersionId: locked.id }
          ]
        },
        select: { id: true }
      }),
      Promise.all([
        tx.settlementDraft.findFirst({
          where: { contractVersionId: locked.id },
          select: { id: true }
        }),
        tx.settlement.findFirst({
          where: { contractVersionId: locked.id },
          select: { id: true }
        }),
        tx.settlementImport.findFirst({
          where: { contractVersionId: locked.id },
          select: { id: true }
        }),
        tx.paymentRequest.findFirst({
          where: { contractVersionId: locked.id },
          select: { id: true }
        })
      ])
    ]);
    if (
      submission ||
      approval ||
      downstream ||
      takeover ||
      siblingVersion ||
      billTransition ||
      formalArtifacts.some(Boolean) ||
      settlementFacts.some(Boolean)
    ) {
      throw new ConflictException("当前合同已有提交、审批或下游业务事实，不能立即删除");
    }
  }

  private async purge(contractVersionId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<LockedPristineDraft[]>(Prisma.sql`
        SELECT
          v."id", v."contractId", c."projectId", c."name", c."code", c."ownerUserId",
          v."changeType", v."status", v."draftRevision", v."firstSubmittedAt",
          v."effectiveAt", v."baseVersionId", v."supersedesVersionId",
          v."copiedFromContractVersionId"
        FROM "ContractVersion" v
        JOIN "Contract" c ON c."id" = v."contractId"
        WHERE v."id" = ${contractVersionId}
        FOR UPDATE OF c, v
      `);
      if (!locked) {
        const receipt = await tx.contractPristineDraftDeletionReceipt.findUnique({
          where: { contractVersionId },
          select: { status: true }
        });
        if (receipt?.status === "completed") return;
        throw new ConflictException("草稿删除状态已变化，请刷新后重试");
      }
      if (locked.status !== "deleting") {
        throw new ConflictException("合同草稿不处于待删除状态");
      }

      await acquireFileBusinessBindingTransactionLock(tx);
      const manifest = await buildContractFileBindingManifest(
        tx,
        { contractVersionIds: [contractVersionId] }
      );
      const blockedExclusive = manifest.rows.filter(
        (row) => row.bindingType === "exclusive" && row.blockedReason
      );
      if (blockedExclusive.length > 0) {
        throw new CleanupBlockedError();
      }
      const exclusiveRows = manifest.rows.filter(
        (row) => row.bindingType === "exclusive"
      );
      const objectKeys = [...new Set(exclusiveRows.map((row) => row.objectKey))];
      if (objectKeys.length > 0) {
        await this.fileCleanup.deleteExactObjects(objectKeys, this.storage);
      }

      await this.deleteAggregate(tx, locked, exclusiveRows.map((row) => row.fileId));
      const aggregateHash = deletionAggregateHash({
        contractId: locked.contractId,
        contractVersionId: locked.id,
        formalCode: locked.code,
        fileRows: manifest.rows
      });
      const completedAt = new Date();
      await tx.contractPristineDraftDeletionReceipt.update({
        where: { contractVersionId },
        data: {
          status: "completed",
          exclusiveFileCount: exclusiveRows.length,
          sharedFileCount: manifest.rows.filter((row) => row.bindingType === "shared").length,
          aggregateHash,
          failureCode: null,
          completedAt,
          expiresAt: threeCalendarMonthsAfter(completedAt)
        }
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private async deleteAggregate(
    tx: Prisma.TransactionClient,
    locked: LockedPristineDraft,
    exclusiveFileIds: string[]
  ): Promise<void> {
    const [bills, terms, rounds, offlineRevisions] = await Promise.all([
      tx.contractBill.findMany({
        where: { contractVersionId: locked.id },
        select: { id: true }
      }),
      tx.paymentTermsVersion.findMany({
        where: { contractVersionId: locked.id },
        select: { id: true }
      }),
      tx.contractNegotiationRound.findMany({
        where: { contractVersionId: locked.id },
        select: { id: true }
      }),
      tx.contractOfflineRevision.findMany({
        where: { contractVersionId: locked.id },
        select: { id: true }
      })
    ]);
    const billIds = bills.map((row) => row.id);
    const termIds = terms.map((row) => row.id);
    const roundIds = rounds.map((row) => row.id);
    const offlineRevisionIds = offlineRevisions.map((row) => row.id);
    const comparisons = await tx.contractDocumentComparison.findMany({
      where: {
        OR: [
          { negotiationRoundId: { in: roundIds } },
          { offlineRevisionId: { in: offlineRevisionIds } }
        ]
      },
      select: { id: true }
    });

    await tx.contractDocumentDifference.deleteMany({
      where: { comparisonId: { in: comparisons.map((row) => row.id) } }
    });
    await tx.contractDocumentComparison.deleteMany({
      where: { id: { in: comparisons.map((row) => row.id) } }
    });
    await tx.contractVersion.updateMany({
      where: { id: locked.id, status: "deleting" },
      data: { latestDraftPreviewDocumentId: null }
    });
    await tx.contractOfflineRevision.deleteMany({
      where: { contractVersionId: locked.id }
    });
    await tx.contractNegotiationRound.deleteMany({
      where: { contractVersionId: locked.id }
    });
    await tx.contractGeneratedDocument.deleteMany({
      where: { contractVersionId: locked.id }
    });
    await tx.contractDraftAttachment.deleteMany({
      where: { contractVersionId: locked.id }
    });
    await tx.contractArchiveFile.deleteMany({
      where: { contractVersionId: locked.id }
    });
    await tx.contractFormalFile.deleteMany({
      where: { contractVersionId: locked.id }
    });
    await tx.contractVersionAuthorizationLink.deleteMany({
      where: { contractVersionId: locked.id }
    });
    await tx.contractPartySnapshot.deleteMany({
      where: { contractVersionId: locked.id }
    });
    await tx.contractAuthorization.deleteMany({
      where: { originContractVersionId: locked.id }
    });
    await tx.contractSealTask.deleteMany({
      where: { contractVersionId: locked.id }
    });
    await tx.contractDraftCheckpoint.deleteMany({
      where: { contractVersionId: locked.id }
    });
    await tx.contractTaxFactRevision.deleteMany({
      where: { contractVersionId: locked.id }
    });
    await tx.contractDraftEditLease.deleteMany({
      where: { contractVersionId: locked.id }
    });
    await tx.contractDraftSaveRequest.deleteMany({
      where: { contractVersionId: locked.id }
    });
    await tx.contractDraftSubmissionRequest.deleteMany({
      where: { contractVersionId: locked.id }
    });
    await tx.contractBillRowCarryForward.deleteMany({
      where: { contractVersionId: locked.id }
    });
    await tx.contractBillImport.deleteMany({
      where: {
        OR: [
          { contractBillId: { in: billIds } },
          { sourceContractVersionId: locked.id },
          { targetContractVersionId: locked.id }
        ]
      }
    });
    await tx.contractBillRow.deleteMany({
      where: { contractBillId: { in: billIds } }
    });
    await tx.contractBill.deleteMany({
      where: { contractVersionId: locked.id }
    });
    await tx.contractBillRowLineage.deleteMany({
      where: { createdInContractVersionId: locked.id }
    });
    await tx.paymentTermsStage.deleteMany({
      where: { paymentTermsVersionId: { in: termIds } }
    });
    await tx.paymentTermsVersion.deleteMany({
      where: { contractVersionId: locked.id }
    });
    await tx.auditLog.deleteMany({
      where: { businessType: "contract_version", businessId: locked.id }
    });
    if (locked.code) {
      await tx.contractNumberTombstone.createMany({
        data: [{ formalCode: locked.code }],
        skipDuplicates: true
      });
    }
    const deletedVersion = await tx.contractVersion.deleteMany({
      where: { id: locked.id, status: "deleting" }
    });
    if (deletedVersion.count !== 1) {
      throw new ConflictException("合同草稿删除状态已变化，请刷新后重试");
    }
    await tx.fileObject.deleteMany({
      where: { id: { in: exclusiveFileIds } }
    });
    if (await tx.contractVersion.count({ where: { contractId: locked.contractId } }) === 0) {
      await tx.contract.deleteMany({ where: { id: locked.contractId } });
    }
  }

  private async markRetryable(
    contractVersionId: string,
    failureCode: string
  ): Promise<void> {
    await this.prisma.contractPristineDraftDeletionReceipt.updateMany({
      where: { contractVersionId, status: { not: "completed" } },
      data: { status: "retryable", failureCode }
    });
  }

  private async assertReceiptActor(
    tx: Prisma.TransactionClient,
    receipt: DeletionReceipt,
    actorUserId: string
  ): Promise<void> {
    if (
      actorUserId === receipt.ownerUserId ||
      actorUserId === receipt.deletedByUserId ||
      await this.hasGlobalDraftDeletionRole(tx, actorUserId)
    ) {
      return;
    }
    throw new ForbiddenException("当前账号无权读取已删除草稿的回执");
  }

  private async hasGlobalDraftDeletionRole(
    tx: Pick<Prisma.TransactionClient, "userPosition" | "position">,
    actorUserId: string
  ): Promise<boolean> {
    const assignments = await tx.userPosition.findMany({
      where: { userId: actorUserId, projectId: null },
      select: { positionId: true }
    });
    if (!assignments.length) return false;
    const positions = await tx.position.findMany({
      where: { id: { in: assignments.map((assignment) => assignment.positionId) } },
      select: { key: true }
    });
    return positions.some((position) => position.key === "contract_director");
  }
}
