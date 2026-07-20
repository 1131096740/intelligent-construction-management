import { ForbiddenException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { nonReceiptBusinessFileBindingIds } from "../file/file-business-binding";

export interface RetentionCategory {
  key: string;
  label: string;
  retentionDays: number;
  candidateCount: number;
  oldestCandidateAt: string | null;
  rule: string;
}

@Injectable()
export class DraftRetentionService {
  constructor(private readonly prisma: PrismaService) {}

  async preview() {
    const now = new Date();
    const before = (days: number) => new Date(now.getTime() - days * 86_400_000);
    const terminalJobStatuses = ["completed", "failed", "discarded", "invalidated"];
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
      generatedDocumentOldest,
      comparisons,
      comparisonOldest,
      checkpoints,
      checkpointOldest,
      unboundFiles
    ] = await Promise.all([
      this.prisma.settlementImport.count({ where: { status: { in: ["preview", "failed"] }, updatedAt: { lt: before(30) } } }),
      this.prisma.settlementImport.aggregate({ where: { status: { in: ["preview", "failed"] }, updatedAt: { lt: before(30) } }, _min: { updatedAt: true } }),
      this.prisma.settlementTemplatePreviewJob.count({ where: { status: { in: terminalJobStatuses }, updatedAt: { lt: before(30) } } }),
      this.prisma.settlementTemplatePreviewJob.aggregate({ where: { status: { in: terminalJobStatuses }, updatedAt: { lt: before(30) } }, _min: { updatedAt: true } }),
      this.prisma.contractLayoutPreviewJob.count({ where: { status: { in: terminalJobStatuses }, updatedAt: { lt: before(30) } } }),
      this.prisma.contractLayoutPreviewJob.aggregate({ where: { status: { in: terminalJobStatuses }, updatedAt: { lt: before(30) } }, _min: { updatedAt: true } }),
      this.prisma.contractBillImport.count({ where: { status: { in: ["preview", "failed"] }, createdAt: { lt: before(30) } } }),
      this.prisma.contractBillImport.aggregate({ where: { status: { in: ["preview", "failed"] }, createdAt: { lt: before(30) } }, _min: { createdAt: true } }),
      this.prisma.contractGeneratedDocument.count({ where: { status: { in: terminalJobStatuses }, updatedAt: { lt: before(30) } } }),
      this.prisma.contractGeneratedDocument.aggregate({ where: { status: { in: terminalJobStatuses }, updatedAt: { lt: before(30) } }, _min: { updatedAt: true } }),
      this.prisma.contractDocumentComparison.count({ where: { status: { in: terminalJobStatuses }, updatedAt: { lt: before(30) } } }),
      this.prisma.contractDocumentComparison.aggregate({ where: { status: { in: terminalJobStatuses }, updatedAt: { lt: before(30) } }, _min: { updatedAt: true } }),
      this.prisma.contractDraftCheckpoint.count({ where: { createdAt: { lt: before(90) } } }),
      this.prisma.contractDraftCheckpoint.aggregate({ where: { createdAt: { lt: before(90) } }, _min: { createdAt: true } }),
      this.unboundFilePreview(before(7))
    ]);
    const iso = (value: Date | null | undefined) => value?.toISOString() ?? null;
    const categories: RetentionCategory[] = [
      { key: "settlement_import_preview", label: "结算导入预览", retentionDays: 30, candidateCount: settlementImports, oldestCandidateAt: iso(settlementImportOldest._min.updatedAt), rule: "仅预览或失败且超过 30 天" },
      { key: "settlement_template_preview_job", label: "结算模板预览任务", retentionDays: 30, candidateCount: settlementPreviewJobs, oldestCandidateAt: iso(settlementPreviewOldest._min.updatedAt), rule: "仅终态任务且超过 30 天" },
      { key: "contract_layout_preview_job", label: "合同版式预览任务", retentionDays: 30, candidateCount: layoutPreviewJobs, oldestCandidateAt: iso(layoutPreviewOldest._min.updatedAt), rule: "仅终态任务且超过 30 天" },
      { key: "contract_bill_import_preview", label: "合同清单导入预览", retentionDays: 30, candidateCount: billImports, oldestCandidateAt: iso(billImportOldest._min.createdAt), rule: "仅预览或失败且超过 30 天" },
      { key: "contract_generated_document_job", label: "合同文档生成任务", retentionDays: 30, candidateCount: generatedDocuments, oldestCandidateAt: iso(generatedDocumentOldest._min.updatedAt), rule: "仅终态任务且超过 30 天，正式文档引用不得清理" },
      { key: "contract_document_comparison_job", label: "合同文档比较任务", retentionDays: 30, candidateCount: comparisons, oldestCandidateAt: iso(comparisonOldest._min.updatedAt), rule: "仅终态任务且超过 30 天" },
      { key: "contract_draft_checkpoint", label: "合同草稿检查点", retentionDays: 90, candidateCount: checkpoints, oldestCandidateAt: iso(checkpointOldest._min.createdAt), rule: "超过 90 天；业务草稿及最新检查点仍保留" },
      { key: "unbound_temporary_file", label: "未绑定临时文件", retentionDays: 7, candidateCount: unboundFiles.count, oldestCandidateAt: iso(unboundFiles.oldest), rule: "活动文件超过 7 天且中心绑定注册表、收货照片和替换链均无引用" }
    ];
    return {
      generatedAt: now.toISOString(),
      mode: "preview_only" as const,
      executionAllowed: false,
      policyVersion: "draft-retention-v1",
      totalCandidateCount: categories.reduce((sum, category) => sum + category.candidateCount, 0),
      categories,
      fileScanTruncated: unboundFiles.truncated,
      notice: "这是只读候选预览，不代表已删除。物理清理必须另行授权并在执行时重新扫描全部业务引用。"
    };
  }

  async controlledEntry(mode: "preview" | "execute") {
    if (mode === "execute") {
      throw new ForbiddenException("技术临时数据物理清理尚未获得独立授权，本次请求已拒绝且未写入任何数据");
    }
    return this.preview();
  }

  private async unboundFilePreview(cutoff: Date) {
    const files = await this.prisma.fileObject.findMany({
      where: { storageStatus: "active", createdAt: { lt: cutoff } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 501,
      select: { id: true, createdAt: true }
    });
    const scanned = files.slice(0, 500);
    if (!scanned.length) return { count: 0, oldest: null as Date | null, truncated: false };
    const ids = scanned.map((file) => file.id);
    const boundIds = await this.prisma.$transaction(async (tx) => {
      const [nonReceipt, receiptPhotos] = await Promise.all([
        nonReceiptBusinessFileBindingIds(tx, ids),
        tx.spotProcurementReceiptPhoto.findMany({
          where: { OR: [{ originalFileId: { in: ids } }, { watermarkedFileId: { in: ids } }] },
          select: { originalFileId: true, watermarkedFileId: true }
        })
      ]);
      return new Set([
        ...nonReceipt,
        ...receiptPhotos.flatMap((photo) => [photo.originalFileId, photo.watermarkedFileId])
      ]);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    const candidates = scanned.filter((file) => !boundIds.has(file.id));
    return {
      count: candidates.length,
      oldest: candidates[0]?.createdAt ?? null,
      truncated: files.length > 500
    };
  }
}
