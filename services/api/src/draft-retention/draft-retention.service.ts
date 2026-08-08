import { ForbiddenException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { nonReceiptBusinessFileBindingIds } from "../file/file-business-binding";

export type RetentionApplyScope =
  | "temporary"
  | "business_purge"
  | "retain_only";

export interface RetentionCategory {
  key: string;
  label: string;
  retentionDays: number | null;
  candidateCount: number;
  oldestCandidateAt: string | null;
  applyScope: RetentionApplyScope;
  rule: string;
  blockedReason?: string;
}

const DAY_MS = 86_400_000;
const TERMINAL_JOB_STATUSES = [
  "completed",
  "failed",
  "discarded",
  "invalidated"
];

function iso(value: Date | null | undefined) {
  return value?.toISOString() ?? null;
}

@Injectable()
export class DraftRetentionService {
  constructor(private readonly prisma: PrismaService) {}

  async preview(now = new Date()) {
    const before = (days: number) =>
      new Date(now.getTime() - days * DAY_MS);
    const [
      settlementImports,
      settlementImportOldest,
      settlementPreviewJobs,
      settlementPreviewOldest,
      layoutPreviewJobs,
      layoutPreviewOldest,
      billImports,
      billImportOldest,
      generatedDocuments,
      failedGeneratedDocuments,
      failedGeneratedDocumentOldest,
      saveReceipts,
      saveReceiptOldest,
      abandonedDrafts,
      abandonedDraftOldest,
      unboundFiles
    ] = await Promise.all([
      this.prisma.settlementImport.count({
        where: {
          status: { in: ["preview", "failed"] },
          updatedAt: { lt: before(7) }
        }
      }),
      this.prisma.settlementImport.aggregate({
        where: {
          status: { in: ["preview", "failed"] },
          updatedAt: { lt: before(7) }
        },
        _min: { updatedAt: true }
      }),
      this.prisma.settlementTemplatePreviewJob.count({
        where: {
          status: { in: TERMINAL_JOB_STATUSES },
          updatedAt: { lt: before(7) }
        }
      }),
      this.prisma.settlementTemplatePreviewJob.aggregate({
        where: {
          status: { in: TERMINAL_JOB_STATUSES },
          updatedAt: { lt: before(7) }
        },
        _min: { updatedAt: true }
      }),
      this.prisma.contractLayoutPreviewJob.count({
        where: { status: { in: TERMINAL_JOB_STATUSES } }
      }),
      this.prisma.contractLayoutPreviewJob.aggregate({
        where: { status: { in: TERMINAL_JOB_STATUSES } },
        _min: { updatedAt: true }
      }),
      this.prisma.contractBillImport.count({
        where: {
          status: { in: ["preview", "failed"] },
          createdAt: { lt: before(7) }
        }
      }),
      this.prisma.contractBillImport.aggregate({
        where: {
          status: { in: ["preview", "failed"] },
          createdAt: { lt: before(7) }
        },
        _min: { createdAt: true }
      }),
      this.prisma.contractGeneratedDocument.findMany({
        where: {
          purpose: "draft",
          status: { in: ["success", "stale"] }
        },
        orderBy: [
          { contractVersionId: "asc" },
          { sourceRevision: "desc" },
          { updatedAt: "desc" },
          { id: "desc" }
        ],
        select: { id: true, contractVersionId: true, updatedAt: true }
      }),
      this.prisma.contractGeneratedDocument.count({
        where: {
          purpose: "draft",
          status: "failed"
        }
      }),
      this.prisma.contractGeneratedDocument.aggregate({
        where: { purpose: "draft", status: "failed" },
        _min: { updatedAt: true }
      }),
      this.prisma.contractDraftSaveRequest.count({
        where: { createdAt: { lt: before(7) } }
      }),
      this.prisma.contractDraftSaveRequest.aggregate({
        where: { createdAt: { lt: before(7) } },
        _min: { createdAt: true }
      }),
      this.prisma.contractVersion.count({
        where: {
          status: "abandoned",
          abandonedAt: { lt: before(7) },
          abandonReason: null,
          changeType: "original",
          versionNo: 1
        }
      }),
      this.prisma.contractVersion.aggregate({
        where: {
          status: "abandoned",
          abandonedAt: { lt: before(7) },
          abandonReason: null,
          changeType: "original",
          versionNo: 1
        },
        _min: { abandonedAt: true }
      }),
      this.unboundFilePreview(before(1))
    ]);
    const seenGeneratedVersions = new Set<string>();
    const supersededGeneratedDocuments = generatedDocuments.filter(
      (document) => {
        if (seenGeneratedVersions.has(document.contractVersionId)) return true;
        seenGeneratedVersions.add(document.contractVersionId);
        return false;
      }
    );
    const categories: RetentionCategory[] = [
      {
        key: "unbound_temporary_file",
        label: "未绑定上传文件",
        retentionDays: 1,
        candidateCount: unboundFiles.truncated ? 0 : unboundFiles.count,
        oldestCandidateAt: iso(unboundFiles.oldest),
        applyScope: "temporary",
        rule: "活动文件超过 24 小时，且全量业务绑定与 replacement chain 均无引用",
        ...(unboundFiles.truncated
          ? { blockedReason: "FILE_SCAN_TRUNCATED" }
          : {})
      },
      {
        key: "contract_bill_import_preview",
        label: "合同清单 Excel 导入预览和失败记录",
        retentionDays: 7,
        candidateCount: billImports,
        oldestCandidateAt: iso(billImportOldest._min.createdAt),
        applyScope: "temporary",
        rule: "仅 preview/failed 且超过 7 天；已应用导入永久保留"
      },
      {
        key: "settlement_contract_import_preview",
        label: "结算/合同导入预览文件",
        retentionDays: 7,
        candidateCount: settlementImports + settlementPreviewJobs,
        oldestCandidateAt:
          [
            settlementImportOldest._min.updatedAt,
            settlementPreviewOldest._min.updatedAt
          ]
            .filter((value): value is Date => value instanceof Date)
            .sort((left, right) => left.getTime() - right.getTime())[0]
            ?.toISOString() ?? null,
        applyScope: "temporary",
        rule: "仅预览或失败记录且超过 7 天；正式结算及其文件永久保留"
      },
      {
        key: "render_intermediate_file",
        label: "DOCX/PDF 渲染中间临时文件",
        retentionDays: 0,
        candidateCount: layoutPreviewJobs + failedGeneratedDocuments,
        oldestCandidateAt:
          [
            layoutPreviewOldest._min.updatedAt,
            failedGeneratedDocumentOldest._min.updatedAt
          ]
            .filter((value): value is Date => value instanceof Date)
            .sort((left, right) => left.getTime() - right.getTime())[0]
            ?.toISOString() ?? null,
        applyScope: "temporary",
        rule: "成功绑定或失败收尾后立即清理；正式文件、审批冻结文件和归档禁止删除"
      },
      {
        key: "contract_draft_preview_superseded",
        label: "合同草稿旧预览",
        retentionDays: 0,
        candidateCount: supersededGeneratedDocuments.length,
        oldestCandidateAt: iso(
          supersededGeneratedDocuments
            .map((document) => document.updatedAt)
            .sort((left, right) => left.getTime() - right.getTime())[0]
        ),
        applyScope: "temporary",
        rule: "每个合同版本仅保留最新一组成功 DOCX/PDF；其余成功草稿预览进入候选"
      },
      {
        key: "contract_draft_save_receipt",
        label: "合同草稿自动保存技术收据",
        retentionDays: 7,
        candidateCount: saveReceipts,
        oldestCandidateAt: iso(saveReceiptOldest._min.createdAt),
        applyScope: "temporary",
        rule: "仅 ContractDraftSaveRequest 超过 7 天；提交审批幂等记录和 AuditLog 永久保留"
      },
      {
        key: "pristine_abandoned_contract_draft",
        label: "已逻辑删除的纯净合同草稿",
        retentionDays: 7,
        candidateCount: abandonedDrafts,
        oldestCandidateAt: iso(abandonedDraftOldest._min.abandonedAt),
        applyScope: "business_purge",
        rule: "至少 7 天宽限且执行前重新锁定证明全程纯净；仅 abandoned 原始草稿可候选，effective/superseded（含历史生效版本）永久排除；默认永远只预览"
      },
      {
        key: "contract_draft_checkpoint",
        label: "合同草稿检查点",
        retentionDays: null,
        candidateCount: 0,
        oldestCandidateAt: null,
        applyScope: "retain_only",
        rule: "Release C1 只读保留；Release C2 必须另行授权后才可讨论删除"
      }
    ];
    return {
      generatedAt: now.toISOString(),
      mode: "preview_only" as const,
      executionAllowed: false,
      policyVersion: "contract-draft-retention-v2",
      businessDraftPurgeEnabled: false,
      totalCandidateCount: categories.reduce(
        (sum, category) => sum + category.candidateCount,
        0
      ),
      categories,
      fileScanTruncated: unboundFiles.truncated,
      notice:
        "这是只读候选预览。临时保留 apply 与业务草稿物理 purge 使用不同授权门；任何正式文件、审批冻结文件、归档、历史付款凭证和 checkpoint 均不在本次删除范围。"
    };
  }

  async controlledEntry(mode: "preview" | "execute") {
    if (mode === "execute") {
      throw new ForbiddenException(
        "保留策略执行只允许受控运维脚本；HTTP 入口拒绝物理删除"
      );
    }
    return this.preview();
  }

  private async unboundFilePreview(cutoff: Date) {
    const files = await this.prisma.fileObject.findMany({
      where: {
        storageStatus: { in: ["active", "deleting"] },
        createdAt: { lt: cutoff }
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 501,
      select: {
        id: true,
        createdAt: true,
        supersedesFileObjectId: true
      }
    });
    if (files.length > 500) {
      return {
        count: 0,
        oldest: files[0]?.createdAt ?? null,
        truncated: true
      };
    }
    if (!files.length) {
      return { count: 0, oldest: null as Date | null, truncated: false };
    }
    const chainBound = new Set(
      files.flatMap((file) =>
        file.supersedesFileObjectId
          ? [file.id, file.supersedesFileObjectId]
          : []
      )
    );
    const pending = files.filter((file) => !chainBound.has(file.id));
    if (!pending.length) {
      return { count: 0, oldest: null as Date | null, truncated: false };
    }
    const pendingIds = pending.map((file) => file.id);
    const boundIds = await this.prisma.$transaction(
      async (tx) => {
        const [nonReceipt, receiptPhotos, replacements] = await Promise.all([
          nonReceiptBusinessFileBindingIds(tx, pendingIds),
          tx.spotProcurementReceiptPhoto.findMany({
            where: {
              OR: [
                { originalFileId: { in: pendingIds } },
                { watermarkedFileId: { in: pendingIds } }
              ]
            },
            select: {
              originalFileId: true,
              watermarkedFileId: true
            }
          }),
          tx.fileObject.findMany({
            where: { supersedesFileObjectId: { in: pendingIds } },
            select: { id: true, supersedesFileObjectId: true }
          })
        ]);
        return new Set([
          ...nonReceipt,
          ...receiptPhotos.flatMap((photo) => [
            photo.originalFileId,
            photo.watermarkedFileId
          ]),
          ...replacements.flatMap((file) => [
            file.id,
            file.supersedesFileObjectId
          ])
        ]);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
    );
    const candidates = pending.filter((file) => !boundIds.has(file.id));
    return {
      count: candidates.length,
      oldest: candidates[0]?.createdAt ?? null,
      truncated: false
    };
  }
}
