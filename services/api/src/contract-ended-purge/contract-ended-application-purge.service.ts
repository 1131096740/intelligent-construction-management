import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { addShanghaiCalendarMonths } from "../contract/contract-retention-calendar";
import { PrismaService } from "../database/prisma.service";
import {
  acquireFileBusinessBindingTransactionLock
} from "../file/file-business-binding";
import {
  buildFileBindingManifest,
  resolveContractVersionFileBindings,
  type ResolvedFileBinding
} from "../file/file-binding-manifest";
import {
  CleanupScopeError,
  FileCleanupSeamService,
  PartialDeletionError
} from "../file/file-cleanup-seam.service";
import {
  CosVersionedObjectStorage,
  type VersionedObjectStorage
} from "../file/versioned-object-storage";

export const ENDED_APPLICATION_PURGE_STORAGE = Symbol("ENDED_APPLICATION_PURGE_STORAGE");
export const ENDED_APPLICATION_PURGE_BATCH_SIZE = 20;

const ENDED_RETENTION_POLICY_ID = "contract-ended-retention-v1";
const TERMINAL_STATUSES = ["abandoned", "approval_rejected"];
const RESUMABLE_RECEIPT_STATUSES = ["object_cleanup_pending", "retryable"];
const RETENTION_MONTHS = 3;
const RELEASE_BUFFER_DAYS = 30;
const DAY_MS = 86_400_000;
const DELETABLE_AUDIT_ACTION_PREFIXES = [
  "contract.draft.",
  "contract.approval.",
  "contract.ended_retention.",
  "contract.bill.",
  "contract.document.",
  "contract.document_difference.",
  "contract.negotiation_round.",
  "contract.offline_revision.",
  "contract.tax_fact_revision."
];

interface PurgeAuditScope {
  deletable: Array<{ businessType: string; businessIds: string[] }>;
  protectedBusinessIds: string[];
}

interface LockedEndedApplication {
  id: string;
  contractId: string;
  projectId: string;
  source: string;
  code: string | null;
  status: string;
  changeType: string;
  versionNo: number;
  baseVersionId: string | null;
  supersedesVersionId: string | null;
  copiedFromContractVersionId: string | null;
  firstSubmittedAt: Date | null;
  abandonedAt: Date | null;
  abandonedByUserId: string | null;
  abandonReason: string | null;
  endedAt: Date | null;
  effectiveAt: Date | null;
}

class EndedApplicationPurgeSkippedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EndedApplicationPurgeSkippedError";
  }
}

function purgeAggregateHash(input: {
  contractId: string;
  contractVersionId: string;
  formalCode: string | null;
  approvalInstanceIds: string[];
  fileRows: Array<{
    fileId: string;
    bindingType: string;
    contentSha256?: string | null;
  }>;
}): string {
  return createHash("sha256")
    .update(JSON.stringify({
      contractId: input.contractId,
      contractVersionId: input.contractVersionId,
      formalCode: input.formalCode,
      approvalInstanceIds: [...input.approvalInstanceIds].sort(),
      files: [...input.fileRows]
        .map((row) => ({
          fileId: row.fileId,
          bindingType: row.bindingType,
          contentSha256: row.contentSha256 ?? null
        }))
        .sort((left, right) => left.fileId.localeCompare(right.fileId))
    }))
    .digest("hex");
}

function retryableFailureCode(error: unknown): string {
  if (error instanceof PartialDeletionError) return "object_cleanup_not_converged";
  if (error instanceof CleanupScopeError) return "file_cleanup_scope_blocked";
  return "ended_application_purge_retryable";
}

function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * DAY_MS);
}

function auditActionIsDeletable(action: string): boolean {
  return DELETABLE_AUDIT_ACTION_PREFIXES.some((prefix) => action.startsWith(prefix));
}

function auditScopeWhere(scope: PurgeAuditScope) {
  return scope.deletable.flatMap(({ businessType, businessIds }) =>
    businessIds.length > 0 ? [{ businessType, businessId: { in: businessIds } }] : []
  );
}

@Injectable()
export class ContractEndedApplicationPurgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fileCleanup: FileCleanupSeamService,
    @Inject(ENDED_APPLICATION_PURGE_STORAGE)
    private readonly storage: VersionedObjectStorage = new CosVersionedObjectStorage()
  ) {}

  async purgeEligibleApplications(
    now = new Date(),
    rawLimit: number = ENDED_APPLICATION_PURGE_BATCH_SIZE
  ) {
    const limit = this.limit(rawLimit);
    const batchId = randomUUID();
    const [resumableReceipts, terminalCandidates] = await Promise.all([
      this.prisma.contractEndedApplicationPurgeReceipt.findMany({
        where: { status: { in: RESUMABLE_RECEIPT_STATUSES } },
        orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
        take: limit,
        select: { contractVersionId: true }
      }),
      this.prisma.contractVersion.findMany({
        where: {
          status: { in: TERMINAL_STATUSES },
          OR: [{ endedAt: { not: null } }, { firstSubmittedAt: { not: null } }]
        },
        orderBy: [{ endedAt: "asc" }, { id: "asc" }],
        take: limit,
        select: { id: true }
      })
    ]);
    const candidates = [...new Set([
      ...resumableReceipts.map((receipt) => receipt.contractVersionId),
      ...terminalCandidates.map((candidate) => candidate.id)
    ])]
      .slice(0, limit)
      .map((id) => ({ id }));
    const results = await Promise.all(
      candidates.map((candidate) => this.purgeCandidate(candidate.id, batchId, now))
    );
    return {
      batchId,
      scannedCount: candidates.length,
      completedCount: results.filter((result) => result === "completed").length,
      retryableCount: results.filter((result) => result === "retryable").length,
      skippedCount: results.filter((result) => result === "skipped").length
    };
  }

  /**
   * 执行 #19 预检中已明确授权的两条 legacy abandoned 记录。
   *
   * 该入口不扫描候选，也不把 `manual_review`/`blocking` 记录带入批次；调用方
   * 必须先用精确预检报告完成候选 allowlist 与数据库 fingerprint 校验。这里仍
   * 在每条记录的两个 Serializable 事务中重新锁定并核验所有生命周期事实，
   * 以便报告与执行之间发生漂移时 fail-closed。
   */
  async purgeLegacyAuthorizedApplications(
    contractVersionIds: readonly string[],
    batchId: string,
    now = new Date()
  ): Promise<Array<{ contractVersionId: string; status: "completed" | "retryable" | "skipped" }>> {
    const ids = [...new Set(contractVersionIds)];
    if (ids.length < 1 || ids.length > 100 || ids.some((id) => !id.trim())) {
      throw new ConflictException("legacy 清理候选必须是 1 到 100 个非空合同版本 ID");
    }
    const results: Array<{
      contractVersionId: string;
      status: "completed" | "retryable" | "skipped";
    }> = [];
    for (const contractVersionId of ids) {
      results.push(await this.purgeLegacyCandidate(contractVersionId, batchId, now));
    }
    return results;
  }

  private limit(value: number): number {
    if (!Number.isInteger(value) || value < 1 || value > 100) {
      throw new ConflictException("结束申请清理批次大小必须是 1 到 100 的整数");
    }
    return value;
  }

  private async purgeCandidate(
    contractVersionId: string,
    batchId: string,
    now: Date
  ): Promise<"completed" | "retryable" | "skipped"> {
    try {
      const prepared = await this.prepare(contractVersionId, batchId, now);
      if (prepared.completed) return "completed";
      if (prepared.resumeObjectCleanup) {
        await this.finalizeObjectCleanup(prepared.receiptId);
        return "completed";
      }
      await this.purgeBusinessAggregate(contractVersionId, prepared.receiptId, now);
      await this.finalizeObjectCleanup(prepared.receiptId);
      return "completed";
    } catch (error) {
      if (error instanceof EndedApplicationPurgeSkippedError) return "skipped";
      await this.markRetryable(contractVersionId, retryableFailureCode(error));
      return "retryable";
    }
  }

  private async purgeLegacyCandidate(
    contractVersionId: string,
    batchId: string,
    now: Date
  ): Promise<{ contractVersionId: string; status: "completed" | "retryable" | "skipped" }> {
    try {
      const prepared = await this.prepareLegacy(contractVersionId, batchId, now);
      if (prepared.completed) {
        return { contractVersionId, status: "completed" };
      }
      if (prepared.resumeObjectCleanup) {
        await this.finalizeObjectCleanup(prepared.receiptId);
        return { contractVersionId, status: "completed" };
      }
      await this.purgeBusinessAggregate(contractVersionId, prepared.receiptId, now, "legacy");
      await this.finalizeObjectCleanup(prepared.receiptId);
      return { contractVersionId, status: "completed" };
    } catch (error) {
      if (error instanceof EndedApplicationPurgeSkippedError) {
        return { contractVersionId, status: "skipped" };
      }
      await this.markRetryable(contractVersionId, retryableFailureCode(error));
      return { contractVersionId, status: "retryable" };
    }
  }

  private async prepare(contractVersionId: string, batchId: string, now: Date) {
    return this.prisma.$transaction(async (tx) => {
      const existingReceipt = await tx.contractEndedApplicationPurgeReceipt.findUnique({
        where: { contractVersionId },
        select: { id: true, status: true, aggregateHash: true }
      });
      const locked = await this.lockEndedApplication(tx, contractVersionId);
      if (!locked) {
        if (existingReceipt?.status === "completed") {
          return { completed: true, receiptId: existingReceipt.id, resumeObjectCleanup: false };
        }
        if (existingReceipt?.aggregateHash && RESUMABLE_RECEIPT_STATUSES.includes(existingReceipt.status)) {
          return {
            completed: false,
            receiptId: existingReceipt.id,
            resumeObjectCleanup: true
          };
        }
        throw new EndedApplicationPurgeSkippedError("结束申请已不在可清理集合");
      }
      const policy = await tx.contractEndedApplicationRetentionPolicy.findUnique({
        where: { id: ENDED_RETENTION_POLICY_ID },
        select: { activatedAt: true }
      });
      if (!policy) {
        throw new EndedApplicationPurgeSkippedError("结束申请保留策略尚未初始化");
      }
      this.assertTerminalRetentionElapsed(locked, policy.activatedAt, now);
      await this.assertNoProtectionOrHold(tx, locked, policy.activatedAt, now);

      if (existingReceipt?.status === "completed") {
        throw new ConflictException("结束申请已完成清理但原业务记录仍存在");
      }
      if (existingReceipt) {
        await tx.contractEndedApplicationPurgeReceipt.update({
          where: { contractVersionId },
          data: { batchId, status: "purging", failureCode: null }
        });
      } else {
        await tx.contractEndedApplicationPurgeReceipt.create({
          data: {
            batchId,
            projectId: locked.projectId,
            contractId: locked.contractId,
            contractVersionId: locked.id,
            formalCode: locked.code,
            status: "purging"
          }
        });
      }
      const receipt = await tx.contractEndedApplicationPurgeReceipt.findUniqueOrThrow({
        where: { contractVersionId },
        select: { id: true }
      });
      return { completed: false, receiptId: receipt.id, resumeObjectCleanup: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private async prepareLegacy(contractVersionId: string, batchId: string, now: Date) {
    return this.prisma.$transaction(async (tx) => {
      const existingReceipt = await tx.contractEndedApplicationPurgeReceipt.findUnique({
        where: { contractVersionId },
        select: { id: true, status: true, aggregateHash: true }
      });
      const locked = await this.lockEndedApplication(tx, contractVersionId);
      if (!locked) {
        if (existingReceipt?.status === "completed") {
          return { completed: true, receiptId: existingReceipt.id, resumeObjectCleanup: false };
        }
        if (existingReceipt?.aggregateHash && RESUMABLE_RECEIPT_STATUSES.includes(existingReceipt.status)) {
          return { completed: false, receiptId: existingReceipt.id, resumeObjectCleanup: true };
        }
        throw new EndedApplicationPurgeSkippedError("legacy 合同记录已不在可清理集合");
      }
      const policy = await tx.contractEndedApplicationRetentionPolicy.findUnique({
        where: { id: ENDED_RETENTION_POLICY_ID },
        select: { activatedAt: true }
      });
      if (!policy) {
        throw new EndedApplicationPurgeSkippedError("结束申请保留策略尚未初始化");
      }
      await this.assertLegacyDeleteEligible(tx, locked, policy.activatedAt, now);
      if (existingReceipt?.status === "completed") {
        throw new ConflictException("legacy 合同清理已完成但原业务记录仍存在");
      }
      if (existingReceipt) {
        await tx.contractEndedApplicationPurgeReceipt.update({
          where: { contractVersionId },
          data: { batchId, status: "purging", failureCode: null }
        });
      } else {
        await tx.contractEndedApplicationPurgeReceipt.create({
          data: {
            batchId,
            projectId: locked.projectId,
            contractId: locked.contractId,
            contractVersionId: locked.id,
            formalCode: locked.code,
            status: "purging"
          }
        });
      }
      const receipt = await tx.contractEndedApplicationPurgeReceipt.findUniqueOrThrow({
        where: { contractVersionId },
        select: { id: true }
      });
      return { completed: false, receiptId: receipt.id, resumeObjectCleanup: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private async purgeBusinessAggregate(
    contractVersionId: string,
    receiptId: string,
    now: Date,
    mode: "ended" | "legacy" = "ended"
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const locked = await this.lockEndedApplication(tx, contractVersionId);
      if (!locked) {
        const receipt = await tx.contractEndedApplicationPurgeReceipt.findUnique({
          where: { contractVersionId },
          select: { status: true, id: true }
        });
        if (receipt?.status === "completed") return;
        throw new ConflictException("结束申请清理状态已变化");
      }
      const policy = await tx.contractEndedApplicationRetentionPolicy.findUnique({
        where: { id: ENDED_RETENTION_POLICY_ID },
        select: { activatedAt: true }
      });
      if (!policy) {
        throw new EndedApplicationPurgeSkippedError("结束申请保留策略尚未初始化");
      }
      if (mode === "legacy") {
        await this.assertLegacyDeleteEligible(tx, locked, policy.activatedAt, now);
      } else {
        this.assertTerminalRetentionElapsed(locked, policy.activatedAt, now);
        await this.assertNoProtectionOrHold(tx, locked, policy.activatedAt, now);
      }
      await acquireFileBusinessBindingTransactionLock(tx);

      const approvalInstances = await tx.approvalInstance.findMany({
        where: { businessType: "contract_version", businessId: locked.id },
        select: { id: true }
      });
      const manifest = await this.fileManifest(
        tx,
        locked.id,
        approvalInstances.map((item) => item.id)
      );
      const blockedExclusive = manifest.rows.filter(
        (row) => row.bindingType === "exclusive" && row.blockedReason
      );
      if (blockedExclusive.length > 0) {
        throw new CleanupScopeError("结束申请存在不可证明为精确对象的独占文件");
      }
      const exclusiveRows = manifest.rows.filter((row) => row.bindingType === "exclusive");
      await this.deleteAggregate(
        tx,
        locked,
        approvalInstances.map((item) => item.id),
        exclusiveRows.map((row) => row.fileId),
        receiptId
      );
      await tx.contractEndedApplicationPurgeReceipt.update({
        where: { contractVersionId },
        data: {
          status: "object_cleanup_pending",
          exclusiveFileCount: exclusiveRows.length,
          sharedFileCount: manifest.rows.filter((row) => row.bindingType === "shared").length,
          aggregateHash: purgeAggregateHash({
            contractId: locked.contractId,
            contractVersionId: locked.id,
            formalCode: locked.code,
            approvalInstanceIds: approvalInstances.map((item) => item.id),
            fileRows: manifest.rows
          }),
          failureCode: null,
          completedAt: null
        }
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  /**
   * 合同业务聚合已在前一独立事务中完全剥离；这里只能处理 receipt 指向的
   * 无业务绑定 FileObject。即使 COS 成功后数据库提交失败，也只留下可重试的
   * 技术行，不会留下合同业务记录指向已删对象。
   */
  private async finalizeObjectCleanup(receiptId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const receipt = await tx.contractEndedApplicationPurgeReceipt.findUnique({
        where: { id: receiptId },
        select: { id: true, status: true, exclusiveFileCount: true }
      });
      if (!receipt) {
        throw new ConflictException("结束申请清理回执不存在");
      }
      if (receipt.status === "completed") return;
      await acquireFileBusinessBindingTransactionLock(tx);
      const manifest = await this.resumableFileManifest(tx, receipt.id);
      if (manifest.rows.length !== receipt.exclusiveFileCount) {
        throw new CleanupScopeError("结束申请待清理文件数量与回执不一致");
      }
      const blocked = manifest.rows.filter(
        (row) => row.bindingType !== "exclusive" || row.blockedReason
      );
      if (blocked.length > 0) {
        throw new CleanupScopeError("结束申请待清理文件出现共享或不可证明范围");
      }
      this.assertConfiguredStorageBucket(manifest.rows);
      const objectKeys = [...new Set(manifest.rows.map((row) => row.objectKey))];
      if (objectKeys.length > 0) {
        await this.fileCleanup.deleteExactObjects(objectKeys, this.storage);
      }
      await tx.fileObject.deleteMany({ where: { purgeReceiptId: receipt.id } });
      await tx.contractEndedApplicationPurgeReceipt.update({
        where: { id: receipt.id },
        data: { status: "completed", failureCode: null, completedAt: new Date() }
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  /**
   * COS adapter 只按当前受控 COS_BUCKET 寻址。历史 FileObject 记录若来自其他桶，
   * 同名 objectKey 可能指向完全不同的对象；此时拒绝外部删除并保留 retryable receipt。
   * 非 COS 的测试/本地适配器本身不以环境桶寻址，保留其精确键语义。
   */
  private assertConfiguredStorageBucket(rows: Array<{ bucket: string }>): void {
    if (!(this.storage instanceof CosVersionedObjectStorage)) return;
    const configuredBucket = process.env.COS_BUCKET?.trim();
    if (!configuredBucket || rows.some((row) => row.bucket !== configuredBucket)) {
      throw new CleanupScopeError("结束申请待清理文件桶与受控 COS 桶不一致");
    }
  }

  private async lockEndedApplication(
    tx: Prisma.TransactionClient,
    contractVersionId: string
  ): Promise<LockedEndedApplication | null> {
    const rows = await tx.$queryRaw<LockedEndedApplication[]>(Prisma.sql`
      SELECT
        v."id", v."contractId", c."projectId", c."source", c."code",
        v."status", v."changeType", v."versionNo", v."baseVersionId",
        v."supersedesVersionId", v."copiedFromContractVersionId",
        v."firstSubmittedAt", v."abandonedAt", v."abandonedByUserId",
        v."abandonReason", v."endedAt", v."effectiveAt"
      FROM "ContractVersion" v
      INNER JOIN "Contract" c ON c."id" = v."contractId"
      WHERE v."id" = ${contractVersionId}
      FOR UPDATE OF c, v
    `);
    return rows[0] ?? null;
  }

  private assertTerminalRetentionElapsed(
    locked: LockedEndedApplication,
    policyActivatedAt: Date,
    now: Date
  ): void {
    if (!TERMINAL_STATUSES.includes(locked.status)) {
      throw new EndedApplicationPurgeSkippedError("合同并非放弃或最终驳回的结束申请");
    }
    if (
      locked.source !== "system" ||
      locked.changeType !== "original" ||
      locked.versionNo !== 1 ||
      locked.baseVersionId ||
      locked.supersedesVersionId ||
      locked.copiedFromContractVersionId
    ) {
      throw new EndedApplicationPurgeSkippedError("仅允许清理新建合同的首个结束申请");
    }
    if (locked.effectiveAt) {
      throw new EndedApplicationPurgeSkippedError("有效合同版本永久保护");
    }
    if (!locked.endedAt && !locked.firstSubmittedAt) {
      throw new EndedApplicationPurgeSkippedError("结束申请缺少可核验的保留起算日");
    }
    if (locked.status === "abandoned" && !locked.abandonedAt) {
      throw new EndedApplicationPurgeSkippedError("放弃申请缺少放弃事实");
    }
    const terminalAt = locked.endedAt ?? policyActivatedAt;
    if (addShanghaiCalendarMonths(terminalAt, RETENTION_MONTHS) > now) {
      throw new EndedApplicationPurgeSkippedError("结束申请尚在三个月保留期内");
    }
  }

  private async assertLegacyDeleteEligible(
    tx: Prisma.TransactionClient,
    locked: LockedEndedApplication,
    policyActivatedAt: Date,
    now: Date
  ): Promise<void> {
    if (
      locked.status !== "abandoned" ||
      locked.source !== "system" ||
      locked.changeType !== "original" ||
      locked.versionNo !== 1 ||
      locked.baseVersionId ||
      locked.supersedesVersionId ||
      locked.copiedFromContractVersionId ||
      locked.firstSubmittedAt ||
      locked.abandonedAt === null ||
      locked.abandonedByUserId === null ||
      locked.abandonReason !== null ||
      locked.endedAt ||
      locked.effectiveAt
    ) {
      throw new EndedApplicationPurgeSkippedError("legacy 记录不满足未提交放弃事实");
    }
    const approvalInstances = await tx.approvalInstance.findMany({
      where: { businessType: "contract_version", businessId: locked.id },
      select: { id: true }
    });
    const approvalAction = approvalInstances.length > 0
      ? await tx.approvalActionLog.findFirst({
          where: { approvalInstanceId: { in: approvalInstances.map((row) => row.id) } },
          select: { id: true }
        })
      : null;
    if (approvalInstances.length > 0 || approvalAction) {
      throw new EndedApplicationPurgeSkippedError("legacy 记录存在审批事实");
    }
    await this.assertNoProtectionOrHold(tx, locked, policyActivatedAt, now);
  }

  private async purgeAuditScope(
    tx: Prisma.TransactionClient,
    locked: LockedEndedApplication
  ): Promise<PurgeAuditScope> {
    const [bills, terms, rounds, offlineRevisions, generatedDocuments, taxFactRevisions] =
      await Promise.all([
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
        }),
        tx.contractGeneratedDocument.findMany({
          where: { contractVersionId: locked.id },
          select: { id: true }
        }),
        tx.contractTaxFactRevision.findMany({
          where: { contractVersionId: locked.id },
          select: { id: true }
        })
      ]);
    const billIds = bills.map((row) => row.id);
    const roundIds = rounds.map((row) => row.id);
    const offlineRevisionIds = offlineRevisions.map((row) => row.id);
    const [comparisons, billImports] = await Promise.all([
      tx.contractDocumentComparison.findMany({
        where: {
          OR: [
            { negotiationRoundId: { in: roundIds } },
            { offlineRevisionId: { in: offlineRevisionIds } }
          ]
        },
        select: { id: true }
      }),
      tx.contractBillImport.findMany({
        where: {
          OR: [
            { contractBillId: { in: billIds } },
            { sourceContractVersionId: locked.id },
            { targetContractVersionId: locked.id }
          ]
        },
        select: { id: true }
      })
    ]);
    const differences = await tx.contractDocumentDifference.findMany({
      where: { comparisonId: { in: comparisons.map((row) => row.id) } },
      select: { id: true }
    });
    const deletable = [
      { businessType: "contract", businessIds: [locked.contractId] },
      { businessType: "contract_version", businessIds: [locked.id] },
      { businessType: "contract_bill", businessIds: billIds },
      { businessType: "contract_bill_import", businessIds: billImports.map((row) => row.id) },
      { businessType: "contract_negotiation_round", businessIds: roundIds },
      { businessType: "contract_offline_revision", businessIds: offlineRevisionIds },
      {
        businessType: "contract_generated_document",
        businessIds: generatedDocuments.map((row) => row.id)
      },
      {
        businessType: "contract_document_difference",
        businessIds: differences.map((row) => row.id)
      },
      {
        businessType: "contract_tax_fact_revision",
        businessIds: taxFactRevisions.map((row) => row.id)
      }
    ];
    return {
      deletable,
      protectedBusinessIds: [
        locked.contractId,
        locked.id,
        ...billIds,
        ...terms.map((row) => row.id),
        ...roundIds,
        ...offlineRevisionIds,
        ...generatedDocuments.map((row) => row.id),
        ...taxFactRevisions.map((row) => row.id),
        ...comparisons.map((row) => row.id),
        ...differences.map((row) => row.id),
        ...billImports.map((row) => row.id)
      ]
    };
  }

  private async assertNoProtectionOrHold(
    tx: Prisma.TransactionClient,
    locked: LockedEndedApplication,
    policyActivatedAt: Date,
    now: Date
  ): Promise<void> {
    const [
      holds,
      siblingVersion,
      copiedVersion,
      historicalTakeover,
      settlementProcess,
      formalArtifacts,
      downstreamFacts,
      auditScope
    ] = await Promise.all([
      tx.contractEndedApplicationRetentionHold.findMany({
        where: { contractVersionId: locked.id },
        select: { releasedAt: true }
      }),
      tx.contractVersion.findFirst({
        where: { contractId: locked.contractId, id: { not: locked.id } },
        select: { id: true }
      }),
      tx.contractVersion.findFirst({
        where: { copiedFromContractVersionId: locked.id },
        select: { id: true }
      }),
      tx.contractTakeover.findFirst({
        where: { contractVersionId: locked.id },
        select: { id: true }
      }),
      tx.contractSettlementProcess.findFirst({
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
        }),
        tx.contractBillRowTransition.findFirst({
          where: {
            OR: [
              { fromContractVersionId: locked.id },
              { toContractVersionId: locked.id }
            ]
          },
          select: { id: true }
        })
      ]),
      this.purgeAuditScope(tx, locked)
    ]);
    const auditRows = await tx.auditLog.findMany({
      where: { businessId: { in: auditScope.protectedBusinessIds } },
      select: { action: true, businessType: true, businessId: true }
    });
    const nonDeletableAudit = auditRows.some((row) => {
      const matchingScope = auditScope.deletable.find(
        (scope) =>
          scope.businessType === row.businessType &&
          row.businessId !== null &&
          scope.businessIds.includes(row.businessId)
      );
      return !matchingScope || !auditActionIsDeletable(row.action);
    });
    if (holds.some((hold) => hold.releasedAt === null)) {
      throw new EndedApplicationPurgeSkippedError("结束申请存在人工保留");
    }
    const latestRelease = holds
      .filter((hold): hold is { releasedAt: Date } => hold.releasedAt instanceof Date)
      .sort((left, right) => right.releasedAt.getTime() - left.releasedAt.getTime())[0];
    const retentionEndsAt = addShanghaiCalendarMonths(
      locked.endedAt ?? policyActivatedAt,
      RETENTION_MONTHS
    );
    if (
      latestRelease &&
      latestRelease.releasedAt >= retentionEndsAt &&
      addDays(latestRelease.releasedAt, RELEASE_BUFFER_DAYS) > now
    ) {
      throw new EndedApplicationPurgeSkippedError("结束申请解除保留后的缓冲期尚未结束");
    }
    if (
      siblingVersion ||
      copiedVersion ||
      historicalTakeover ||
      settlementProcess ||
      formalArtifacts.some(Boolean) ||
      downstreamFacts.some(Boolean) ||
      nonDeletableAudit
    ) {
      throw new EndedApplicationPurgeSkippedError("结束申请存在正式、历史或共享业务引用");
    }
  }

  private async fileManifest(
    tx: Prisma.TransactionClient,
    contractVersionId: string,
    approvalInstanceIds: string[]
  ) {
    const [versionBindings, actionLogs, pdfDocuments, archiveRecords, claims] = await Promise.all([
      resolveContractVersionFileBindings(tx, [contractVersionId]),
      approvalInstanceIds.length
        ? tx.approvalActionLog.findMany({
            where: {
              approvalInstanceId: { in: approvalInstanceIds },
              signatureFileIdSnapshot: { not: null }
            },
            select: { id: true, signatureFileIdSnapshot: true }
          })
        : Promise.resolve([]),
      tx.pdfDocument.findMany({
        where: {
          OR: [
            { businessType: "contract_version", businessId: contractVersionId },
            ...(approvalInstanceIds.length
              ? [{ approvalInstanceId: { in: approvalInstanceIds } }]
              : [])
          ]
        },
        select: { id: true, fileId: true }
      }),
      tx.archiveRecord.findMany({
        where: { businessType: "contract_version", businessId: contractVersionId },
        select: { id: true, fileId: true }
      }),
      approvalInstanceIds.length
        ? tx.approvalFormGenerationClaim.findMany({
            where: {
              approvalInstanceId: { in: approvalInstanceIds },
              uploadedFileId: { not: null }
            },
            select: { approvalInstanceId: true, uploadedFileId: true }
          })
        : Promise.resolve([])
    ]);
    const applicationBindings: ResolvedFileBinding[] = [
      ...versionBindings,
      ...actionLogs.flatMap((row) => row.signatureFileIdSnapshot
        ? [{
            table: "ApprovalActionLog",
            column: "signatureFileIdSnapshot",
            rowId: row.id,
            fileId: row.signatureFileIdSnapshot
          }]
        : []),
      ...pdfDocuments.map((row) => ({
        table: "PdfDocument",
        column: "fileId",
        rowId: row.id,
        fileId: row.fileId
      })),
      ...archiveRecords.map((row) => ({
        table: "ArchiveRecord",
        column: "fileId",
        rowId: row.id,
        fileId: row.fileId
      })),
      ...claims.flatMap((row) => row.uploadedFileId
        ? [{
            table: "ApprovalFormGenerationClaim",
            column: "uploadedFileId",
            rowId: row.approvalInstanceId,
            fileId: row.uploadedFileId
          }]
        : [])
    ];
    return buildFileBindingManifest({
      tx,
      target: { contractVersionIds: [contractVersionId] },
      applicationBindings
    });
  }

  private async resumableFileManifest(
    tx: Prisma.TransactionClient,
    receiptId: string
  ) {
    const files = await tx.fileObject.findMany({
      where: { purgeReceiptId: receiptId },
      select: { id: true }
    });
    return buildFileBindingManifest({
      tx,
      target: { contractVersionIds: [receiptId] },
      applicationBindings: files.map((file) => ({
        table: "FileObject",
        column: "purgeReceiptId",
        rowId: file.id,
        fileId: file.id
      }))
    });
  }

  private async deleteAggregate(
    tx: Prisma.TransactionClient,
    locked: LockedEndedApplication,
    approvalInstanceIds: string[],
    exclusiveFileIds: string[],
    receiptId: string
  ): Promise<void> {
    const auditScope = await this.purgeAuditScope(tx, locked);
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
      where: { id: locked.id, status: { in: TERMINAL_STATUSES } },
      data: { latestDraftPreviewDocumentId: null }
    });
    await tx.contractOfflineRevision.deleteMany({ where: { contractVersionId: locked.id } });
    await tx.contractNegotiationRound.deleteMany({ where: { contractVersionId: locked.id } });
    await tx.contractGeneratedDocument.deleteMany({ where: { contractVersionId: locked.id } });
    await tx.contractDraftAttachment.deleteMany({ where: { contractVersionId: locked.id } });
    await tx.contractArchiveFile.deleteMany({ where: { contractVersionId: locked.id } });
    await tx.contractFormalFile.deleteMany({ where: { contractVersionId: locked.id } });
    await tx.contractVersionAuthorizationLink.deleteMany({ where: { contractVersionId: locked.id } });
    await tx.contractPartySnapshot.deleteMany({ where: { contractVersionId: locked.id } });
    await tx.contractAuthorization.deleteMany({ where: { originContractVersionId: locked.id } });
    await tx.contractSealTask.deleteMany({ where: { contractVersionId: locked.id } });
    await tx.contractDraftCheckpoint.deleteMany({ where: { contractVersionId: locked.id } });
    await tx.contractTaxFactRevision.deleteMany({ where: { contractVersionId: locked.id } });
    await tx.contractDraftEditLease.deleteMany({ where: { contractVersionId: locked.id } });
    await tx.contractDraftSaveRequest.deleteMany({ where: { contractVersionId: locked.id } });
    await tx.contractDraftSubmissionRequest.deleteMany({ where: { contractVersionId: locked.id } });
    await tx.contractBillRowCarryForward.deleteMany({ where: { contractVersionId: locked.id } });
    await tx.contractBillImport.deleteMany({
      where: {
        OR: [
          { contractBillId: { in: billIds } },
          { sourceContractVersionId: locked.id },
          { targetContractVersionId: locked.id }
        ]
      }
    });
    await tx.contractBillRow.deleteMany({ where: { contractBillId: { in: billIds } } });
    await tx.contractBill.deleteMany({ where: { contractVersionId: locked.id } });
    await tx.contractBillRowLineage.deleteMany({
      where: { createdInContractVersionId: locked.id }
    });
    await tx.paymentTermsStage.deleteMany({ where: { paymentTermsVersionId: { in: termIds } } });
    await tx.paymentTermsVersion.deleteMany({ where: { contractVersionId: locked.id } });
    if (approvalInstanceIds.length > 0) {
      await tx.approvalFormGenerationClaim.deleteMany({
        where: { approvalInstanceId: { in: approvalInstanceIds } }
      });
      await tx.pdfDocument.deleteMany({
        where: {
          OR: [
            { businessType: "contract_version", businessId: locked.id },
            { approvalInstanceId: { in: approvalInstanceIds } }
          ]
        }
      });
      await tx.approvalActionLog.deleteMany({
        where: { approvalInstanceId: { in: approvalInstanceIds } }
      });
      await tx.approvalInstance.deleteMany({ where: { id: { in: approvalInstanceIds } } });
    } else {
      await tx.pdfDocument.deleteMany({
        where: { businessType: "contract_version", businessId: locked.id }
      });
    }
    await tx.archiveRecord.deleteMany({
      where: { businessType: "contract_version", businessId: locked.id }
    });
    await tx.auditLog.deleteMany({
      where: {
        AND: [
          { OR: auditScopeWhere(auditScope) },
          {
            OR: DELETABLE_AUDIT_ACTION_PREFIXES.map((prefix) => ({
              action: { startsWith: prefix }
            }))
          }
        ]
      }
    });
    await tx.contractEndedApplicationRetentionHold.deleteMany({
      where: { contractVersionId: locked.id }
    });
    if (locked.code) {
      await tx.contractNumberTombstone.createMany({
        data: [{ formalCode: locked.code }],
        skipDuplicates: true
      });
    }
    const deletedVersion = await tx.contractVersion.deleteMany({
      where: { id: locked.id, status: { in: TERMINAL_STATUSES } }
    });
    if (deletedVersion.count !== 1) {
      throw new ConflictException("结束申请清理状态已变化");
    }
    if (exclusiveFileIds.length > 0) {
      const marked = await tx.fileObject.updateMany({
        where: { id: { in: exclusiveFileIds }, purgeReceiptId: null },
        data: { purgeReceiptId: receiptId }
      });
      if (marked.count !== exclusiveFileIds.length) {
        throw new ConflictException("结束申请独占文件的清理回执状态已变化");
      }
    }
    const remainingVersions = await tx.contractVersion.count({
      where: { contractId: locked.contractId }
    });
    if (remainingVersions !== 0) {
      throw new ConflictException("合同仍有关联版本，拒绝删除合同根记录");
    }
    await tx.contract.deleteMany({ where: { id: locked.contractId } });
  }

  private async markRetryable(contractVersionId: string, failureCode: string): Promise<void> {
    await this.prisma.contractEndedApplicationPurgeReceipt.updateMany({
      where: { contractVersionId, status: { not: "completed" } },
      data: { status: "retryable", failureCode }
    });
  }
}
