import { Injectable, NotFoundException, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  contractInvoiceTypeLabel,
  contractTaxModeLabel,
  type ContractInvoiceType,
  type ContractTaxMode,
  type CoreFlowTone,
  type DetailActionReadModel,
  type DraftLedgerView,
  type LifecycleLedgerPage,
  type RoleKey,
  type SettlementWorkbenchLedgerPage,
  type SettlementWorkbenchView,
  type SettlementDetailReadModel
} from "@jiangkong/shared-domain";
import {
  approvalReviewAccessOnFrozenNode,
  type ApprovalReviewAccess
} from "../approval/approval-node-access";
import { activeApprovalDelegatorIds } from "../approval/active-approval-delegations";
import { AuditService } from "../audit/audit.service";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import {
  detailAction,
  disabledActionReasons,
  primaryActionKey
} from "../core-flow/detail-actions";
import { approvalTimelineForBusiness } from "../core-flow/approval-timeline-read";
import {
  buildLedgerWorkbook,
  shanghaiDateStamp
} from "../core-flow/ledger-excel";
import { PrismaService } from "../database/prisma.service";
import { MeService } from "../me/me.service";
import {
  dbMoneyToBigInt,
  deriveTaxExclusiveUnitPrice,
  formatMoneyCentsAsYuan,
  moneyCentsToApi,
  sumDbMoneyToBigInt
} from "../money/decimal-money";
import { loadSettlementDraftLifecycles } from "./settlement-draft-lifecycle";

function emptyApprovalReviewAccess(): ApprovalReviewAccess {
  return { canAct: false, canReview: false, requiresSelfReviewConfirmation: false };
}

interface SettlementLineStore {
  settlementLine?: {
    findMany(args: {
      where: { settlementId: string };
      orderBy: { sortOrder: "asc" };
    }): Promise<
      Array<{
        id: string;
        sourceType: string;
        name: string;
        unit: string | null;
        quantity: { toString(): string } | string | number | null;
        unitPriceCents: bigint | null;
        unitPriceSnapshot?: { toString(): string } | string | number | null;
        taxRatePercentSnapshot?: { toString(): string } | string | number | null;
        calculationMode?: string;
        pricingModeSnapshot?: string | null;
        amountCents: bigint;
        taxExclusiveAmountCents?: bigint | null;
        taxAmountCents?: bigint | null;
        reason: string | null;
        overageReason?: string | null;
        remark: string | null;
      }>
    >;
  };
}

@Injectable()
export class SettlementReadService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    private readonly projectVisibility?: ProjectVisibilityService,
    @Optional()
    private readonly audit?: AuditService,
    @Optional()
    private readonly me?: MeService
  ) {}

  private async settlementLinesForSettlement(
    settlementId: string
  ): Promise<SettlementDetailReadModel["settlementLines"]> {
    const client = this.prisma as unknown as SettlementLineStore;
    if (!client.settlementLine) {
      return [];
    }

    const lines = await client.settlementLine.findMany({
      where: { settlementId },
      orderBy: { sortOrder: "asc" }
    });

    return lines.map((line) => {
      const nonContractSource = line.sourceType !== "contract_bill_row";
      const visaChange = line.sourceType === "visa_change";
      const unitPriceSnapshot = decimalText(line.unitPriceSnapshot);
      const taxRatePercent = decimalText(line.taxRatePercentSnapshot);
      const unitPrices = nonContractSource
        ? { inclusive: null, exclusive: null }
        : this.taxUnitPrices(
            unitPriceSnapshot,
            taxRatePercent,
            line.pricingModeSnapshot
          );
      const legacyUnitPrice =
        unitPriceSnapshot === null
          ? line.unitPriceCents === null
            ? "-"
            : this.formatMoney(line.unitPriceCents)
          : this.formatUnitPriceSnapshot(unitPriceSnapshot, line.pricingModeSnapshot);

      return {
        id: line.id,
        sourceType: visaChange
          ? "visa_change"
          : nonContractSource
            ? "manual_adjustment"
            : "contract_bill_row",
        sourceLabel: visaChange ? "签证/变更项" : nonContractSource ? "手工调整项" : "合同清单项",
        name: line.name,
        unit: line.unit ?? "-",
        quantity: this.formatQuantity(line.quantity),
        unitPrice: nonContractSource ? "-" : legacyUnitPrice,
        taxInclusiveUnitPrice: this.formatUnitPriceValue(unitPrices.inclusive),
        taxExclusiveUnitPrice: this.formatUnitPriceValue(unitPrices.exclusive),
        taxRate: taxRatePercent === null || nonContractSource ? "-" : `${taxRatePercent}%`,
        calculationMode:
          line.calculationMode === "normal_auto" ||
          line.calculationMode === "manual_amount" ||
          line.calculationMode === "visa_change" ||
          line.calculationMode === "manual_adjustment"
            ? line.calculationMode
            : "legacy",
        amount: this.formatMoney(line.amountCents),
        amountCents: moneyCentsToApi(line.amountCents),
        taxInclusiveAmount: this.formatMoney(line.amountCents),
        taxExclusiveAmount:
          nonContractSource || line.taxExclusiveAmountCents == null
            ? "-"
            : this.formatMoney(line.taxExclusiveAmountCents),
        taxAmount:
          nonContractSource || line.taxAmountCents == null
            ? "-"
            : this.formatMoney(line.taxAmountCents),
        taxBreakdownNote: nonContractSource
          ? visaChange
            ? "签证/变更项，不适用合同清单税额拆分"
            : "人工调整，不适用合同单价税额拆分"
          : "-",
        reason: line.reason ?? "-",
        overageReason: line.overageReason ?? "-",
        remark: line.remark ?? "-"
      };
    });
  }

  private taxUnitPrices(
    unitPrice: string | null,
    taxRatePercent: string | null,
    pricingMode: string | null | undefined
  ): { inclusive: string | null; exclusive: string | null } {
    if (unitPrice === null) return { inclusive: null, exclusive: null };
    if (pricingMode === "tax_exclusive") {
      if (taxRatePercent === null) return { inclusive: null, exclusive: unitPrice };
      const inclusive = new Prisma.Decimal(unitPrice)
        .mul(new Prisma.Decimal(taxRatePercent).div(100).add(1))
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
        .toFixed(2);
      return { inclusive, exclusive: unitPrice };
    }
    if (taxRatePercent === null) return { inclusive: unitPrice, exclusive: null };
    return {
      inclusive: unitPrice,
      exclusive: deriveTaxExclusiveUnitPrice({
        taxInclusiveUnitPrice: unitPrice,
        taxRatePercent
      })
    };
  }

  private formatUnitPriceValue(value: string | null): string {
    return value === null ? "-" : `¥${formatDecimalYuan(value)}`;
  }

  private formatUnitPriceSnapshot(value: string, pricingMode: string | null | undefined) {
    const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
    if (!match) return value;
    const integer = (match[1] ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const rawFraction = match[2] ?? "";
    const fraction = rawFraction.padEnd(2, "0").replace(/0+$/, (zeros) =>
      rawFraction.length <= 2 ? zeros : ""
    );
    const normalizedFraction = fraction.length < 2 ? fraction.padEnd(2, "0") : fraction;
    const pricingLabel =
      pricingMode === "tax_inclusive"
        ? "含税"
        : pricingMode === "tax_exclusive"
          ? "不含税"
          : "计价口径未标记";
    return `¥${integer}.${normalizedFraction}（${pricingLabel}）`;
  }

  private async settlementArchiveFilesForSettlement(
    settlement: { id: string; governanceVersion?: number | null }
  ): Promise<SettlementDetailReadModel["archiveFiles"]> {
    const client = this.prisma as unknown as {
      settlementArchiveFile?: {
        findMany(args: {
          where: { settlementId: string };
          orderBy: { createdAt: "desc" };
        }): Promise<
          Array<{
            id: string;
            fileId: string;
            uploadedByUserId: string;
            confirmedByUserId: string | null;
            confirmedAt: Date | null;
            status: string;
            createdAt: Date;
          }>
        >;
      };
      fileObject?: {
        findMany(args: { where: { id: { in: string[] } } }): Promise<
          Array<{
            id: string;
            originalName: string;
            mimeType: string;
            sizeBytes: number;
            storageStatus?: string;
          }>
        >;
      };
      user?: {
        findMany(args: { where: { id: { in: string[] } } }): Promise<
          Array<{ id: string; name: string }>
        >;
      };
      settlementDraft?: {
        findFirst(args: { where: { submittedSettlementId: string }; select: { id: true } }): Promise<{
          id: string;
        } | null>;
      };
      settlementSignedDocument?: {
        findMany(args: {
          where: {
            OR: Array<
              | { settlementId: string; purpose: string; status: string }
              | { settlementDraftId: string; purpose: string; status: string }
            >;
          };
          orderBy: Array<{ createdAt: "asc" } | { id: "asc" }>;
        }): Promise<
          Array<{
            id: string;
            purpose: string;
            fileId: string;
            status: string;
            generationStatus: string;
            uploadedByUserId: string | null;
            generatedByUserId: string | null;
            confirmedByUserId: string | null;
            confirmedAt: Date | null;
            createdAt: Date;
          }>
        >;
      };
    };

    if (settlement.governanceVersion === 1) {
      if (!client.settlementDraft || !client.settlementSignedDocument || !client.fileObject) {
        return [];
      }
      const draft = await client.settlementDraft.findFirst({
        where: { submittedSettlementId: settlement.id },
        select: { id: true }
      });
      const parentFilters: Array<
        | { settlementId: string; purpose: string; status: string }
        | { settlementDraftId: string; purpose: string; status: string }
      > = [
        {
          settlementId: settlement.id,
          purpose: "final_internal_signed_copy",
          status: "active"
        }
      ];
      if (draft) {
        parentFilters.unshift({
          settlementDraftId: draft.id,
          purpose: "counterparty_signed_original",
          status: "active"
        });
      }
      const documents = await client.settlementSignedDocument.findMany({
        where: { OR: parentFilters },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }]
      });
      const fileIds = [...new Set(documents.map((document) => document.fileId))];
      const actorIds = [
        ...new Set(
          documents
            .flatMap((document) => [
              document.uploadedByUserId,
              document.generatedByUserId,
              document.confirmedByUserId
            ])
            .filter((id): id is string => Boolean(id))
        )
      ];
      const [files, users] = await Promise.all([
        fileIds.length
          ? client.fileObject.findMany({ where: { id: { in: fileIds } } })
          : Promise.resolve([]),
        client.user && actorIds.length
          ? client.user.findMany({ where: { id: { in: actorIds } } })
          : Promise.resolve([])
      ]);
      const fileById = new Map(files.map((file) => [file.id, file]));
      const userById = new Map(users.map((user) => [user.id, user]));
      return documents.flatMap((document) => {
        const file = fileById.get(document.fileId);
        if (!file) return [];
        const purposeKey = document.purpose as
          | "counterparty_signed_original"
          | "final_internal_signed_copy";
        const generationStatus = document.generationStatus as
          | "not_applicable"
          | "pending"
          | "generating"
          | "completed"
          | "failed";
        const storageAvailable =
          file.storageStatus === undefined || file.storageStatus === "active";
        const generationComplete = ["not_applicable", "completed"].includes(
          document.generationStatus
        );
        const canDownload =
          document.status === "active" && storageAvailable && generationComplete;
        const actorId = document.uploadedByUserId ?? document.generatedByUserId;
        return [{
          recordId: document.id,
          fileId: file.id,
          fileName: file.originalName,
          purpose:
            purposeKey === "counterparty_signed_original"
              ? "乙方签章原件"
              : "我方审批签名合成件",
          purposeKey,
          generationStatus,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          status: document.status,
          statusLabel: canDownload
            ? "证据已冻结"
            : storageAvailable
              ? "文件生成中"
              : "文件暂不可用",
          uploadedByName: actorId
            ? userById.get(actorId)?.name ?? "经办人未读取"
            : "系统生成",
          uploadedAt: document.createdAt.toISOString(),
          confirmedByName: document.confirmedByUserId
            ? userById.get(document.confirmedByUserId)?.name ?? "确认人未读取"
            : null,
          confirmedAt: document.confirmedAt?.toISOString() ?? null,
          canDownload,
          disabledReason: canDownload
            ? null
            : storageAvailable
              ? "文件完成生成后开放下载"
              : "文件当前不可用，请联系管理员处理",
          downloadability: canDownload
            ? "available"
            : storageAvailable
              ? "pending_generation"
              : "unavailable"
        }];
      });
    }

    if (!client.settlementArchiveFile || !client.fileObject) {
      return [];
    }

    const archiveFiles = await client.settlementArchiveFile.findMany({
      where: { settlementId: settlement.id },
      orderBy: { createdAt: "desc" }
    });
    const fileIds = Array.from(new Set(archiveFiles.map((file) => file.fileId)));
    if (!fileIds.length) {
      return [];
    }

    const userIds = Array.from(
      new Set(
        archiveFiles
          .flatMap((file) => [file.uploadedByUserId, file.confirmedByUserId])
          .filter((id): id is string => Boolean(id))
      )
    );
    const [files, users] = await Promise.all([
      client.fileObject.findMany({ where: { id: { in: fileIds } } }),
      client.user && userIds.length
        ? client.user.findMany({ where: { id: { in: userIds } } })
        : Promise.resolve([])
    ]);
    const fileById = new Map(files.map((file) => [file.id, file]));
    const userById = new Map(users.map((user) => [user.id, user]));

    return archiveFiles.flatMap((archiveFile) => {
      const file = fileById.get(archiveFile.fileId);
      if (!file) {
        return [];
      }
      const canDownload =
        (archiveFile.status === "confirmed" || Boolean(archiveFile.confirmedAt)) &&
        (file.storageStatus === undefined || file.storageStatus === "active");

      return [
        {
          recordId: archiveFile.id,
          fileId: file.id,
          fileName: file.originalName,
          purpose: "结算签章归档件",
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          status: archiveFile.status,
          statusLabel: this.archiveFileStatusLabel(archiveFile.status),
          uploadedByName: userById.get(archiveFile.uploadedByUserId)?.name ?? "上传人未读取",
          uploadedAt: archiveFile.createdAt.toISOString(),
          confirmedByName: archiveFile.confirmedByUserId
            ? userById.get(archiveFile.confirmedByUserId)?.name ?? "确认人未读取"
            : null,
          confirmedAt: archiveFile.confirmedAt?.toISOString() ?? null,
          canDownload,
          disabledReason: canDownload ? null : "归档确认后开放下载"
        }
      ];
    });
  }

  private async paymentActivityForSettlement(settlementId: string): Promise<{
    requestedAmountCents: bigint;
    paidAmountCents: bigint;
    activeRequestCount: number;
  }> {
    const client = this.prisma as unknown as {
      paymentRequest?: {
        findMany(args: {
          where: { settlementId: string };
          select: { id: true; status: true; requestedAmountCents: true; paidAmountCents: true };
        }): Promise<
          Array<{
            id: string;
            status: string;
            requestedAmountCents: bigint;
            paidAmountCents: bigint;
          }>
        >;
      };
      paymentExecution?: {
        findMany(args: {
          where: { paymentRequestId: { in: string[] } };
          select: { amountCents: true };
        }): Promise<Array<{ amountCents: bigint }>>;
      };
    };

    if (!client.paymentRequest?.findMany) {
      return { requestedAmountCents: 0n, paidAmountCents: 0n, activeRequestCount: 0 };
    }

    const requests = await client.paymentRequest.findMany({
      where: { settlementId },
      select: { id: true, status: true, requestedAmountCents: true, paidAmountCents: true }
    });
    const activeRequests = requests.filter((request) => !["rejected", "withdrawn", "voided"].includes(request.status));
    const requestedAmountCents = sumDbMoneyToBigInt(
      activeRequests.map((request) => request.requestedAmountCents),
      "付款申请金额"
    );
    if (!activeRequests.length) {
      return { requestedAmountCents, paidAmountCents: 0n, activeRequestCount: 0 };
    }

    if (!client.paymentExecution?.findMany) {
      return {
        requestedAmountCents,
        paidAmountCents: sumDbMoneyToBigInt(
          activeRequests.map((request) => request.paidAmountCents),
          "付款实付金额"
        ),
        activeRequestCount: activeRequests.length
      };
    }

    const executions = await client.paymentExecution.findMany({
      where: { paymentRequestId: { in: activeRequests.map((request) => request.id) } },
      select: { amountCents: true }
    });
    return {
      requestedAmountCents,
      paidAmountCents: sumDbMoneyToBigInt(
        executions.map((execution) => execution.amountCents),
        "付款实付金额"
      ),
      activeRequestCount: activeRequests.length
    };
  }

  async listRecent(
    rawLimit?: string | number,
    visibleProjectIds?: string[],
    internalOptions?: { unbounded?: boolean }
  ) {
    const take = internalOptions?.unbounded ? undefined : this.limit(rawLimit);
    const settlements = await this.prisma.settlement.findMany({
      ...(visibleProjectIds ? { where: { projectId: { in: visibleProjectIds } } } : {}),
      ...(take === undefined ? {} : { take }),
      orderBy: { updatedAt: "desc" }
    });
    const contractIds = [...new Set(settlements.map((settlement) => settlement.contractId))];
    const termsIds = [...new Set(settlements.map((settlement) => settlement.paymentTermsVersionId))];
    const projectIds = [...new Set(settlements.map((settlement) => settlement.projectId))];
    const [contracts, terms, projects] = await Promise.all([
      contractIds.length
        ? this.prisma.contract.findMany({ where: { id: { in: contractIds } } })
        : Promise.resolve([]),
      termsIds.length
        ? this.prisma.paymentTermsVersion.findMany({ where: { id: { in: termsIds } } })
        : Promise.resolve([]),
      projectIds.length
        ? this.prisma.project.findMany({ where: { id: { in: projectIds } } })
        : Promise.resolve([])
    ]);
    const contractById = new Map(contracts.map((contract) => [contract.id, contract]));
    const termsById = new Map(terms.map((term) => [term.id, term]));
    const projectById = new Map(projects.map((project) => [project.id, project]));

    const rows = settlements.map((settlement) => {
      const contract = contractById.get(settlement.contractId);
      const termsVersion = termsById.get(settlement.paymentTermsVersionId);
      return this.settlementLedgerRow(
        settlement,
        contract,
        termsVersion,
        projectById.get(settlement.projectId)
      );
    });

    return {
      rows,
      summary: {
        total: rows.length,
        inApproval: settlements.filter((settlement) => settlement.status === "approval_pending").length,
        pendingArchive: settlements.filter((settlement) =>
          [
            "approved_pending_archive",
            "pending_generation",
            "archive_pending",
            "pending_archive_confirm"
          ].includes(settlement.status)
        ).length,
        effective: settlements.filter((settlement) => settlement.status === "effective").length,
        payable: settlements.filter((settlement) => settlement.status === "effective").length
      }
    };
  }

  async lifecycleLedger(
    view: DraftLedgerView,
    rawPage: string | number | undefined,
    rawPageSize: string | number | undefined,
    visibleProjectIds: string[],
    actorUserId: string
  ): Promise<LifecycleLedgerPage<Record<string, unknown>>> {
    const page = this.page(rawPage);
    const pageSize = this.pageSize(rawPageSize);
    const [settlements, drafts] = await Promise.all([
      this.prisma.settlement.findMany({
        where: { projectId: { in: visibleProjectIds } },
        orderBy: { updatedAt: "desc" }
      }),
      this.prisma.settlementDraft.findMany({
        where: { projectId: { in: visibleProjectIds }, ownerUserId: actorUserId },
        orderBy: { updatedAt: "desc" }
      })
    ]);
    const contractIds = [...new Set([
      ...settlements.map((item) => item.contractId),
      ...drafts.map((item) => item.contractId)
    ])];
    const termsIds = [...new Set(settlements.map((item) => item.paymentTermsVersionId))];
    const [contracts, terms, projects, draftLifecycles] = await Promise.all([
      contractIds.length ? this.prisma.contract.findMany({ where: { id: { in: contractIds } } }) : [],
      termsIds.length ? this.prisma.paymentTermsVersion.findMany({ where: { id: { in: termsIds } } }) : [],
      visibleProjectIds.length ? this.prisma.project.findMany({ where: { id: { in: visibleProjectIds } } }) : [],
      loadSettlementDraftLifecycles(this.prisma, drafts)
    ]);
    const contractById = new Map(contracts.map((contract) => [contract.id, contract]));
    const termsById = new Map(terms.map((term) => [term.id, term]));
    const projectById = new Map(projects.map((project) => [project.id, project]));
    const formal = settlements.filter((item) => !["approval_rejected", "withdrawn", "voided"].includes(item.status));
    const returned = settlements.filter((item) => item.status === "approval_rejected" && item.preparedByUserId === actorUserId);
    const endedFormal = settlements.filter((item) => ["withdrawn", "voided"].includes(item.status));
    const activeDrafts = drafts.filter((item) =>
      item.status === "draft" &&
      draftLifecycles.get(item.id)?.lifecycleKind !== "formal_record"
    );
    const endedDrafts = drafts.filter((item) =>
      item.status === "abandoned" &&
      draftLifecycles.get(item.id)?.lifecycleKind !== "formal_record"
    );
    const selectedFormal = view === "formal_ledger" ? formal
      : view === "returned_for_revision" ? returned
        : view === "ended" ? endedFormal
          : [];
    const formalRows = selectedFormal.map((settlement) => this.settlementLedgerRow(
      settlement,
      contractById.get(settlement.contractId),
      termsById.get(settlement.paymentTermsVersionId),
      projectById.get(settlement.projectId),
      {
        settlementId: settlement.id,
        projectId: settlement.projectId,
        lifecycleKind: "formal_record",
        lifecycleUpdatedAt: settlement.updatedAt.toISOString()
      }
    ));
    const selectedDrafts = view === "my_drafts" ? activeDrafts : view === "ended" ? endedDrafts : [];
    const draftRows = selectedDrafts.map((draft) => ({
      id: draft.id,
      projectId: draft.projectId,
      settlementNo: draft.code,
      contractNo: contractById.get(draft.contractId)?.code ?? contractById.get(draft.contractId)?.temporaryCode ?? draft.contractId,
      project: projectById.get(draft.projectId)?.name ?? draft.projectId,
      period: draft.periodLabel,
      amount: "-",
      paymentTermsVersion: "-",
      currentNode: draft.status === "abandoned" ? "已放弃" : "填写结算草稿",
      nodeTone: draft.status === "abandoned" ? "default" : "warning",
      ownerDepartment: "合同部",
      pendingOwner: "本人",
      stalledFor: this.stalledFor(draft.updatedAt),
      returnReason: draft.abandonReason ?? "-",
      nextAction: draft.status === "abandoned" ? "查看历史" : "继续填写",
      updatedAt: this.date(draft.updatedAt),
      lifecycleKind:
        draftLifecycles.get(draft.id)?.lifecycleKind ?? "pristine_draft",
      revision: draft.revision,
      lifecycleUpdatedAt: draft.updatedAt.toISOString(),
      abandonedAt: draft.abandonedAt?.toISOString() ?? null,
      abandonReason: draft.abandonReason ?? null,
      copyAvailable: draft.status === "abandoned" && draft.ownerUserId === actorUserId
    }));
    const rows = [...formalRows, ...draftRows].sort((a, b) => {
      const aTime = "lifecycleUpdatedAt" in a ? a.lifecycleUpdatedAt : "";
      const bTime = "lifecycleUpdatedAt" in b ? b.lifecycleUpdatedAt : "";
      return String(bTime).localeCompare(String(aTime));
    });
    const start = (page - 1) * pageSize;
    return {
      rows: rows.slice(start, start + pageSize),
      meta: { page, pageSize, total: rows.length, totalPages: Math.ceil(rows.length / pageSize) },
      summary: {
        formal_ledger: formal.length,
        my_drafts: activeDrafts.length,
        returned_for_revision: returned.length,
        ended: endedFormal.length + endedDrafts.length
      }
    };
  }

  async workbenchLedger(
    view: SettlementWorkbenchView,
    rawPage: string | number | undefined,
    rawPageSize: string | number | undefined,
    visibleProjectIds: string[],
    actorUserId: string
  ): Promise<SettlementWorkbenchLedgerPage<Record<string, unknown>>> {
    const page = this.page(rawPage);
    const pageSize = this.pageSize(rawPageSize);
    const [settlements, drafts, projects, pendingWorkItems] = await Promise.all([
      this.prisma.settlement.findMany({
        where: { projectId: { in: visibleProjectIds } },
        orderBy: { updatedAt: "desc" }
      }),
      this.prisma.settlementDraft.findMany({
        where: { projectId: { in: visibleProjectIds }, ownerUserId: actorUserId },
        orderBy: { updatedAt: "desc" }
      }),
      visibleProjectIds.length
        ? this.prisma.project.findMany({ where: { id: { in: visibleProjectIds } } })
        : Promise.resolve([]),
      this.me?.getSettlementPendingWorkItems(actorUserId) ?? Promise.resolve([])
    ]);
    const contractIds = [...new Set([
      ...settlements.map((item) => item.contractId),
      ...drafts.map((item) => item.contractId)
    ])];
    const termsIds = [...new Set(settlements.map((item) => item.paymentTermsVersionId))];
    const [contracts, terms, draftLifecycles] = await Promise.all([
      contractIds.length ? this.prisma.contract.findMany({ where: { id: { in: contractIds } } }) : [],
      termsIds.length ? this.prisma.paymentTermsVersion.findMany({ where: { id: { in: termsIds } } }) : [],
      loadSettlementDraftLifecycles(this.prisma, drafts)
    ]);
    const contractById = new Map(contracts.map((contract) => [contract.id, contract]));
    const termsById = new Map(terms.map((term) => [term.id, term]));
    const projectById = new Map(projects.map((project) => [project.id, project]));
    const pendingSettlementIds = new Set(
      pendingWorkItems
        .map((item) => item.businessId)
        .filter((businessId): businessId is string => Boolean(businessId))
    );
    const selectedSettlements = settlements.filter((settlement) =>
      this.matchesWorkbenchView(view, settlement, actorUserId, pendingSettlementIds)
    );
    const visibleDrafts = drafts.filter((draft) =>
      draftLifecycles.get(draft.id)?.lifecycleKind !== "formal_record"
    );
    const selectedDrafts = visibleDrafts.filter((draft) =>
      (view === "my_drafts" && draft.status === "draft") || view === "all"
    );
    const formalRows = selectedSettlements.map((settlement) => this.settlementLedgerRow(
      settlement,
      contractById.get(settlement.contractId),
      termsById.get(settlement.paymentTermsVersionId),
      projectById.get(settlement.projectId),
      {
        settlementId: settlement.id,
        projectId: settlement.projectId,
        status: settlement.status,
        lifecycleKind: "formal_record",
        lifecycleUpdatedAt: settlement.updatedAt.toISOString()
      }
    ));
    const draftRows = selectedDrafts.map((draft) => ({
      id: draft.id,
      projectId: draft.projectId,
      settlementNo: draft.code,
      contractNo: contractById.get(draft.contractId)?.code ??
        contractById.get(draft.contractId)?.temporaryCode ?? draft.contractId,
      project: projectById.get(draft.projectId)?.name ?? draft.projectId,
      period: draft.periodLabel,
      amount: "-",
      paymentTermsVersion: "-",
      currentNode: draft.status === "abandoned" ? "已放弃" : "填写结算草稿",
      nodeTone: draft.status === "abandoned" ? "default" : "warning",
      ownerDepartment: "合同部",
      pendingOwner: "本人",
      stalledFor: this.stalledFor(draft.updatedAt),
      returnReason: draft.abandonReason ?? "-",
      nextAction: draft.status === "abandoned" ? "查看历史" : "继续填写",
      updatedAt: this.date(draft.updatedAt),
      lifecycleKind:
        draftLifecycles.get(draft.id)?.lifecycleKind ?? "pristine_draft",
      revision: draft.revision,
      lifecycleUpdatedAt: draft.updatedAt.toISOString(),
      abandonedAt: draft.abandonedAt?.toISOString() ?? null,
      abandonReason: draft.abandonReason ?? null,
      copyAvailable: draft.status === "abandoned"
    }));
    const rows = [...formalRows, ...draftRows].sort((a, b) =>
      String("lifecycleUpdatedAt" in b ? b.lifecycleUpdatedAt : "")
        .localeCompare(String("lifecycleUpdatedAt" in a ? a.lifecycleUpdatedAt : ""))
    );
    const count = (targetView: SettlementWorkbenchView) =>
      settlements.filter((settlement) =>
        this.matchesWorkbenchView(targetView, settlement, actorUserId, pendingSettlementIds)
      ).length + visibleDrafts.filter((draft) =>
        (targetView === "my_drafts" && draft.status === "draft") || targetView === "all"
      ).length;
    return {
      rows: rows.slice((page - 1) * pageSize, page * pageSize),
      meta: { page, pageSize, total: rows.length, totalPages: Math.ceil(rows.length / pageSize) },
      summary: {
        pending_action: count("pending_action"),
        my_drafts: count("my_drafts"),
        in_approval: count("in_approval"),
        pending_archive: count("pending_archive"),
        effective: count("effective"),
        all: count("all")
      }
    };
  }

  async exportLedger(visibleProjectIds: string[], actorUserId: string) {
    const ledger = await this.listRecent(undefined, visibleProjectIds, {
      unbounded: true
    });
    const rows = ledger.rows.map((row) => ({
      settlementNo: row.settlementNo,
      contractNo: row.contractNo,
      project: row.project,
      period: row.period,
      amount: row.amount,
      paymentTermsVersion: row.paymentTermsVersion,
      currentNode: row.currentNode,
      pendingOwner: row.pendingOwner,
      stalledFor: row.stalledFor,
      returnReason: row.returnReason,
      nextAction: row.nextAction,
      updatedAt: row.updatedAt
    }));
    const buffer = await buildLedgerWorkbook({
      sheetName: "结算台账",
      columns: [
        { header: "结算编号", key: "settlementNo", width: 20 },
        { header: "合同编号", key: "contractNo", width: 20 },
        { header: "项目", key: "project", width: 24 },
        { header: "结算期间", key: "period", width: 14 },
        { header: "结算金额", key: "amount", width: 18 },
        { header: "付款条款版本", key: "paymentTermsVersion", width: 16 },
        { header: "当前节点", key: "currentNode", width: 18 },
        { header: "当前责任人", key: "pendingOwner", width: 18 },
        { header: "停留时间", key: "stalledFor", width: 14 },
        { header: "退回原因", key: "returnReason", width: 28 },
        { header: "下一步", key: "nextAction", width: 22 },
        { header: "更新时间", key: "updatedAt", width: 22 }
      ],
      rows
    });

    if (!this.audit) {
      throw new Error("结算台账导出审计服务暂不可用，请稍后重试");
    }
    await this.audit.record(this.prisma, {
      actorUserId,
      action: "settlement.ledger.export",
      businessType: "settlement_ledger",
      metadata: {
        exportedRows: rows.length,
        visibleProjectCount: visibleProjectIds.length,
        scope: "all_visible_records"
      }
    });

    return {
      buffer,
      fileName: `结算台账-${shanghaiDateStamp()}.xlsx`
    };
  }

  async getDetail(
    settlementId: string,
    visibleProjectIds?: string[],
    actorUserId?: string
  ): Promise<SettlementDetailReadModel> {
    if (process.env.SKIP_DATABASE_CONNECT === "true") {
      return this.sampleDetail(settlementId);
    }

    const settlement = await this.prisma.settlement.findFirst({
      where: {
        OR: [{ id: settlementId }, { code: settlementId }],
        ...(visibleProjectIds ? { projectId: { in: visibleProjectIds } } : {})
      }
    });

    if (!settlement) {
      throw new NotFoundException("未找到该结算单，请刷新结算台账后重试");
    }

    const [
      contract,
      contractVersion,
      terms,
      paymentRequest,
      archiveFiles,
      approvalTimeline,
      paymentActivity,
      settlementLines,
      generationClaim,
      historicalAdvanceDeductionCents
    ] = await Promise.all([
      this.prisma.contract.findUnique({ where: { id: settlement.contractId } }),
      this.prisma.contractVersion.findUnique({ where: { id: settlement.contractVersionId } }),
      this.prisma.paymentTermsVersion.findUnique({
        where: { id: settlement.paymentTermsVersionId }
      }),
      this.prisma.paymentRequest.findFirst({
        where: { settlementId: settlement.id },
        orderBy: { createdAt: "desc" }
      }),
      this.settlementArchiveFilesForSettlement(settlement),
      approvalTimelineForBusiness(this.prisma, "settlement", settlement.id),
      this.paymentActivityForSettlement(settlement.id),
      this.settlementLinesForSettlement(settlement.id),
      settlement.governanceVersion === 1
        ? this.prisma.settlementSignedDocumentGenerationClaim?.findUnique?.({
            where: { settlementId: settlement.id }
          }) ?? Promise.resolve(null)
        : Promise.resolve(null),
      this.historicalAdvanceDeductionCents(settlement.id)
    ]);

    if (!contract) {
      throw new NotFoundException("未找到结算关联合同，请刷新结算台账后重试");
    }

    if (!contractVersion) {
      throw new NotFoundException("未找到结算关联合同版本，请刷新结算台账后重试");
    }

    if (!terms) {
      throw new NotFoundException("未找到结算绑定的付款条款版本，请刷新结算台账后重试");
    }

    const stages = await this.prisma.paymentTermsStage.findMany({
      where: { paymentTermsVersionId: terms.id },
      orderBy: { createdAt: "asc" }
    });
    const generationFailed = this.signedDocumentGenerationNeedsRetry(generationClaim);
    const status = this.statusView(settlement.status, generationFailed);
    const roleKeys = await this.actorRoleKeys(actorUserId, settlement.projectId);
    const approvalReviewAccess = await this.canReviewCurrentApproval(
      "settlement",
      settlement.id,
      settlement.projectId,
      roleKeys,
      actorUserId
    );
    const availableActions = this.settlementActions(
      settlement.status,
      roleKeys,
      approvalReviewAccess,
      archiveFiles,
      settlement.governanceVersion,
      generationFailed
    );
    const taxFactSummary = await this.taxFactSummary(
      settlement,
      contractVersion,
      settlementLines
    );

    return {
      id: settlement.code,
      settlementId: settlement.id,
      title: `${settlement.code} · ${settlement.periodLabel}结算单`,
      meta: [
        { label: "当前状态", value: status.label, tone: status.tone },
        { label: "关联合同版本", value: `合同 v${contractVersion.versionNo}` },
        { label: "付款条款版本", value: `v${terms.versionNo} 随合同生效` },
        { label: "结算期间", value: settlement.periodLabel },
        { label: "责任部门", value: "合同部" },
        {
          label: "下一步动作",
          value: this.nextActionLabel(settlement.status, generationFailed),
          tone: status.tone
        }
      ],
      baseInfo: [
        { label: "结算编号", value: settlement.code },
        { label: "关联合同", value: `${contract.code} · ${contract.name}` },
        { label: "结算性质", value: this.settlementSourceLabel(settlement.sourceType) },
        { label: "是否最终结算", value: "否" },
        { label: "结算金额", value: this.formatMoney(settlement.amountCents) },
        { label: "创建人", value: "项目经理" }
      ],
      taxFactSummary,
      effectivenessSteps: this.effectivenessSteps(settlement.status, generationFailed),
      archiveResponsibilities:
        settlement.governanceVersion === 1
          ? [
              "乙方签章原件作为对方签署证据保留",
              "我方审批通过后由系统生成冻结签名合成件",
              "合同部主管确认合成件后结算生效",
              "财务只读取业务证据文件"
            ]
          : [
              "结算审批不经过董事长/总经理",
              "结算归档件由合同部成员上传",
              "归档由合同部主管确认",
              "财务只读取业务归档件"
            ],
      paymentRules: stages.map((stage) => ({
        id: stage.id,
        stage: stage.name,
        ratio: this.ratioLabel(stage.ratioBps),
        accountPeriod: `${stage.dueDays}天`,
        invoiceRequirement: stage.requiresInvoice ? "需提供发票" : "不要求发票",
        triggerCondition: stage.triggerEvent,
        paymentRequestStatus: paymentRequest?.status ?? this.defaultPaymentRequestStatus(settlement.status)
      })),
      settlementLines,
      payableCalculation: this.payableCalculation(
        settlement,
        paymentActivity,
        historicalAdvanceDeductionCents
      ),
      paymentBlockMessage: this.paymentBlockMessage(settlement.status),
      archiveFiles,
      approvalTimeline,
      availableActions,
      primaryAction: primaryActionKey(availableActions),
      disabledReasons: disabledActionReasons(availableActions),
      chainLinks: [
        { label: "关联合同", to: `/contracts/${contract.code}` },
        { label: "付款申请", to: paymentRequest ? `/payments/${paymentRequest.code}` : "/payments" },
        { label: "归档资料", to: "/archives" },
        { label: "审计日志", to: "/audit" }
      ]
    };
  }

  private sampleDetail(settlementId: string): SettlementDetailReadModel {
    return {
      id: settlementId,
      settlementId: "settlement-sample",
      title: "JS-2026-018 · 5月材料结算单",
      meta: [
        { label: "当前状态", value: "待归档确认", tone: "primary" },
        { label: "关联合同版本", value: "合同 v1" },
        { label: "付款条款版本", value: "v1 随合同生效" },
        { label: "结算期间", value: "2026-05" },
        { label: "责任部门", value: "合同部" },
        { label: "下一步动作", value: "主管确认归档", tone: "primary" }
      ],
      baseInfo: [
        { label: "结算编号", value: settlementId },
        { label: "关联合同", value: "HT-2026-001 · 钢材采购合同" },
        { label: "结算性质", value: "月度结算" },
        { label: "是否最终结算", value: "否" },
        { label: "结算金额", value: "¥320,000.00" },
        { label: "创建人", value: "项目经理 张工" }
      ],
      taxFactSummary: [
        { label: "发票类型", value: "增值税专用发票" },
        { label: "税率模式", value: "单一税率" },
        { label: "默认税率", value: "13%" },
        { label: "税务事实修订号", value: "1" }
      ],
      effectivenessSteps: [
        { label: "结算审批", status: "已通过", tone: "success" },
        { label: "签字盖章归档上传", status: "已上传", tone: "success" },
        { label: "合同部主管确认", status: "待处理", tone: "primary" },
        { label: "结算生效", status: "阻塞", tone: "danger" }
      ],
      archiveResponsibilities: [
        "结算审批不经过董事长/总经理",
        "结算归档件由合同部成员上传",
        "归档由合同部主管确认",
        "财务只读取业务归档件"
      ],
      paymentRules: [
        {
          id: "current-settlement-payment",
          stage: "当期结算款",
          ratio: "80%",
          accountPeriod: "30天",
          invoiceRequirement: "需提供发票",
          triggerCondition: "结算归档确认生效",
          paymentRequestStatus: "未开放"
        },
        {
          id: "retention-payment",
          stage: "质保金",
          ratio: "20%",
          accountPeriod: "365天",
          invoiceRequirement: "不要求发票",
          triggerCondition: "质保期满",
          paymentRequestStatus: "未开放"
        }
      ],
      settlementLines: [
        {
          id: "sample-line-1",
          sourceType: "contract_bill_row",
          sourceLabel: "合同清单项",
          name: "钢筋材料",
          unit: "吨",
          quantity: "10",
          unitPrice: "¥3,200.00",
          taxInclusiveUnitPrice: "¥3,200.00",
          taxExclusiveUnitPrice: "¥2,831.86",
          taxRate: "13%",
          calculationMode: "normal_auto",
          amount: "¥320,000.00",
          amountCents: "32000000",
          taxInclusiveAmount: "¥320,000.00",
          taxExclusiveAmount: "¥283,185.84",
          taxAmount: "¥36,814.16",
          taxBreakdownNote: "-",
          reason: "-",
          overageReason: "-",
          remark: "-"
        }
      ],
      payableCalculation: {
        items: [
          { label: "本期结算金额", value: "¥320,000.00" },
          { label: "本期可付金额", value: "¥256,000.00", tone: "success" },
          { label: "已申请付款", value: "¥0.00", tone: "default" },
          { label: "已实付金额", value: "¥0.00" },
          { label: "剩余可申请", value: "¥256,000.00", tone: "primary" }
        ],
        note: "剩余可申请按本结算可付金额扣减未作废/未驳回/未撤回的付款申请，最终以后端创建付款校验为准。"
      },
      paymentBlockMessage:
        "结算尚未生效，暂不可创建付款申请；付款比例和账期按绑定的付款条款版本执行。",
      archiveFiles: [],
      approvalTimeline: [],
      availableActions: [],
      primaryAction: null,
      disabledReasons: [],
      chainLinks: [
        { label: "关联合同", to: "/contracts/HT-2026-001" },
        { label: "付款申请", to: "/payments/FK-2026-006" },
        { label: "归档资料", to: "/archives" },
        { label: "审计日志", to: "/audit" }
      ]
    };
  }

  private async taxFactSummary(
    settlement: {
      contractVersionId: string;
      invoiceTypeSnapshot?: string | null;
      taxFactRevisionSnapshot?: number | null;
    },
    contractVersion: {
      invoiceType?: string | null;
      taxMode?: string | null;
      defaultTaxRatePercent?: { toString(): string } | string | number | null;
      taxFactRevision?: number | null;
    },
    lines: SettlementDetailReadModel["settlementLines"]
  ): Promise<SettlementDetailReadModel["taxFactSummary"]> {
    const snapshotRevision = settlement.taxFactRevisionSnapshot ?? null;
    const revisionClient = (this.prisma as unknown as {
      contractTaxFactRevision?: {
        findFirst(args: {
          where: {
            contractVersionId: string;
            revisionNo: number;
            status: string;
          };
        }): Promise<{
          invoiceType: string | null;
          taxMode: string | null;
          defaultTaxRatePercent: { toString(): string } | string | number | null;
        } | null>;
      };
    }).contractTaxFactRevision;
    const frozenRevision =
      snapshotRevision !== null && revisionClient
        ? await revisionClient.findFirst({
            where: {
              contractVersionId: settlement.contractVersionId,
              revisionNo: snapshotRevision,
              status: "confirmed"
            }
          })
        : null;
    const currentFactsStillMatch =
      snapshotRevision !== null &&
      snapshotRevision === (contractVersion.taxFactRevision ?? null);
    const lineRates = Array.from(
      new Set(
        lines
          .map((line) => line.taxRate.replace(/%$/u, ""))
          .filter((rate) => rate !== "-")
      )
    );
    const invoiceType =
      settlement.invoiceTypeSnapshot ??
      frozenRevision?.invoiceType ??
      (currentFactsStillMatch ? contractVersion.invoiceType ?? null : null);
    const taxMode =
      frozenRevision?.taxMode ??
      (currentFactsStillMatch ? contractVersion.taxMode ?? null : null) ??
      (lineRates.length > 1 ? "multiple_rate" : lineRates.length === 1 ? "single_rate" : null);
    const defaultTaxRate =
      decimalText(frozenRevision?.defaultTaxRatePercent) ??
      (currentFactsStillMatch
        ? decimalText(contractVersion.defaultTaxRatePercent)
        : null) ??
      (lineRates.length === 1 ? lineRates[0] : null);

    return [
      { label: "发票类型", value: invoiceTypeLabel(invoiceType) },
      { label: "税率模式", value: taxModeLabel(taxMode) },
      { label: "默认税率", value: defaultTaxRate === null ? "—" : `${defaultTaxRate}%` },
      {
        label: "税务事实修订号",
        value: snapshotRevision === null ? "历史结算未保存" : String(snapshotRevision)
      }
    ];
  }

  private payableCalculation(
    settlement: { amountCents: bigint; payableAmountCents?: bigint | null },
    paymentActivity: { requestedAmountCents: bigint; paidAmountCents: bigint; activeRequestCount: number },
    historicalAdvanceDeductionCents = 0n
  ): SettlementDetailReadModel["payableCalculation"] {
    const payableAmountCents = settlement.payableAmountCents ?? 0n;
    const remainingBalance = payableAmountCents - paymentActivity.requestedAmountCents;
    const remainingRequestableCents = remainingBalance > 0n ? remainingBalance : 0n;

    const historicalAdvanceItems =
      historicalAdvanceDeductionCents > 0n
        ? [
            {
              label: "本期期初应付",
              value: this.formatMoney(
                payableAmountCents +
                  historicalAdvanceDeductionCents
              )
            },
            {
              label: "历史预付款抵扣",
              value: this.formatMoney(
                historicalAdvanceDeductionCents
              ),
              tone: "warning" as const
            },
            {
              label: "抵扣后可申请金额",
              value: this.formatMoney(payableAmountCents),
              tone: "success" as const
            }
          ]
        : [
            {
              label: "本期可付金额",
              value: this.formatMoney(payableAmountCents),
              tone: "success" as const
            }
          ];

    return {
      items: [
        { label: "本期结算金额", value: this.formatMoney(settlement.amountCents) },
        ...historicalAdvanceItems,
        {
          label: "已申请付款",
          value: this.formatMoney(paymentActivity.requestedAmountCents),
          tone: paymentActivity.activeRequestCount > 0 ? "warning" : "default"
        },
        { label: "已实付金额", value: this.formatMoney(paymentActivity.paidAmountCents) },
        { label: "剩余可申请", value: this.formatMoney(remainingRequestableCents), tone: "primary" }
      ],
      note:
        historicalAdvanceDeductionCents > 0n
          ? "抵扣后可申请金额已扣除历史预付款；剩余可申请再扣减未作废/未驳回/未撤回的付款申请，最终以后端创建付款校验为准。"
          : "剩余可申请按本结算可付金额扣减未作废/未驳回/未撤回的付款申请，最终以后端创建付款校验为准。"
    };
  }

  private async historicalAdvanceDeductionCents(
    settlementId: string
  ): Promise<bigint> {
    const client = (this.prisma as unknown as {
      contractTakeoverBalanceEntry?: {
        findMany(args: unknown): Promise<
          Array<{
            id?: string;
            amountCents: bigint;
            reversesEntryId?: string | null;
          }>
        >;
      };
    }).contractTakeoverBalanceEntry;
    if (!client?.findMany) return 0n;
    const deductions = await client.findMany({
      where: {
        settlementId,
        entryKind: "deduction"
      },
      select: {
        id: true,
        amountCents: true
      }
    });
    if (deductions.length === 0) return 0n;
    const deductionIds = deductions
      .map((entry) => entry.id)
      .filter((id): id is string => Boolean(id));
    const reversals =
      deductionIds.length > 0
        ? await client.findMany({
            where: {
              reversesEntryId: { in: deductionIds },
              entryKind: "reversal"
            },
            select: {
              amountCents: true,
              reversesEntryId: true
            }
          })
        : [];
    const deducted = deductions.reduce(
      (total, entry) =>
        total +
        dbMoneyToBigInt(
          entry.amountCents,
          "历史预付款抵扣金额"
        ),
      0n
    );
    const reversed = reversals.reduce(
      (total, entry) =>
        total +
        dbMoneyToBigInt(
          entry.amountCents,
          "历史预付款反向金额"
        ),
      0n
    );
    return deducted > reversed ? deducted - reversed : 0n;
  }

  private async actorRoleKeys(actorUserId: string | undefined, projectId: string): Promise<RoleKey[]> {
    if (!actorUserId || !this.projectVisibility) {
      return [];
    }

    return this.projectVisibility.effectiveRoleKeys(actorUserId, projectId);
  }

  private async canReviewCurrentApproval(
    businessType: string,
    businessId: string,
    projectId: string,
    roleKeys: RoleKey[],
    actorUserId?: string
  ): Promise<ApprovalReviewAccess> {
    if (!actorUserId) {
      return emptyApprovalReviewAccess();
    }

    const approvalClient = (this.prisma as unknown as {
      approvalInstance?: {
        findFirst(args: {
          where: { businessType: string; businessId: string; status: string };
          orderBy: { createdAt: "desc" };
          select: { applicantUserId: true; frozenNodes: true; currentNodeIndex: true };
        }): Promise<{
          applicantUserId: string;
          frozenNodes: unknown;
          currentNodeIndex: number;
        } | null>;
      };
    }).approvalInstance;
    if (!approvalClient) {
      return emptyApprovalReviewAccess();
    }

    const instance = await approvalClient.findFirst({
      where: { businessType, businessId, status: "in_progress" },
      orderBy: { createdAt: "desc" },
      select: { applicantUserId: true, frozenNodes: true, currentNodeIndex: true }
    });

    if (!instance) {
      return emptyApprovalReviewAccess();
    }

    const directOrAssignedAccess = approvalReviewAccessOnFrozenNode(
      instance.frozenNodes,
      instance.currentNodeIndex,
      roleKeys,
      actorUserId,
      instance.applicantUserId,
      false
    );
    if (directOrAssignedAccess.canAct) {
      return directOrAssignedAccess;
    }

    const activeDelegators = await this.activeDelegatedApprovalIdentities(
      actorUserId,
      projectId
    );
    return approvalReviewAccessOnFrozenNode(
      instance.frozenNodes,
      instance.currentNodeIndex,
      roleKeys,
      actorUserId,
      instance.applicantUserId,
      activeDelegators
    );
  }

  private async activeDelegatedApprovalIdentities(
    actorUserId: string,
    projectId: string
  ): Promise<Array<{ userId: string; roleKeys: RoleKey[] }>> {
    if (!this.projectVisibility) return [];

    const delegatorIds = await activeApprovalDelegatorIds(this.prisma, actorUserId, new Date());
    const identities: Array<{ userId: string; roleKeys: RoleKey[] }> = [];
    for (const delegatorId of delegatorIds) {
      const delegatorRoleKeys = await this.projectVisibility.effectiveRoleKeys(
        delegatorId,
        projectId
      );
      identities.push({ userId: delegatorId, roleKeys: delegatorRoleKeys });
    }
    return identities;
  }

  private settlementActions(
    status: string,
    roleKeys: RoleKey[],
    approvalReviewAccess: ApprovalReviewAccess,
    archiveFiles: SettlementDetailReadModel["archiveFiles"],
    governanceVersion?: number | null,
    generationFailed = false
  ): DetailActionReadModel[] {
    const workflowActions = [
      detailAction({
        key: "download_approval_form",
        label: "下载最新审批 PDF",
        kind: "normal",
        roleKeys,
        enabled: true
      }),
      detailAction({
        key: "withdraw_approval",
        label: "撤回审批",
        kind: "normal",
        roleKeys,
        requiredAction: "settlement.create",
        enabled: status === "approval_pending"
      }),
      detailAction({
        key: "remind_approval",
        label: "催办审批",
        kind: "normal",
        roleKeys,
        requiredAction: "settlement.create",
        enabled: status === "approval_pending"
      }),
      detailAction({
        key: "transfer_approval",
        label: "转审",
        kind: "normal",
        roleKeys,
        skipRoleCheck: true,
        enabled: approvalReviewAccess.canAct,
        disabledReason: "当前用户不是当前审批节点处理人"
      }),
      detailAction({
        key: "delegate_approval",
        label: "委托",
        kind: "normal",
        roleKeys,
        skipRoleCheck: true,
        enabled: approvalReviewAccess.canAct,
        disabledReason: "当前用户不是当前审批节点处理人"
      }),
      ...(governanceVersion === 1
        ? []
        : [
            detailAction({
              key: "generate_pdf_archive",
              label: "生成 PDF 归档",
              kind: "normal",
              roleKeys,
              requiredAction: "settlement.archive.upload",
              enabled: Boolean(status)
            })
          ])
    ];

    if (status === "approval_pending") {
      return [
        detailAction({
          key: "review_approval",
          label: "处理结算审批",
          kind: "primary",
          roleKeys,
          requiredAction: "settlement.approve",
          skipRoleCheck: true,
          enabled: approvalReviewAccess.canReview,
          requiresSelfReviewConfirmation:
            approvalReviewAccess.requiresSelfReviewConfirmation,
          disabledReason: approvalReviewAccess.canAct
            ? "申请人不能审批自己发起的业务"
            : "当前用户不是当前审批节点处理人"
        }),
        ...workflowActions
      ];
    }

    if (status === "pending_generation" && governanceVersion === 1) {
      return [
        ...(generationFailed
          ? [
              detailAction({
                key: "retry_signed_document_generation",
                label: "重试生成结算签名合成件",
                kind: "primary",
                roleKeys,
                requiredAction: "settlement.archive.confirm",
                enabled: true
              })
            ]
          : []),
        ...workflowActions
      ];
    }

    if (status === "approved_pending_archive" && governanceVersion !== 1) {
      return [
        detailAction({
          key: "upload_archive",
          label: "上传结算归档件",
          kind: "primary",
          roleKeys,
          requiredAction: "settlement.archive.upload",
          enabled: true,
          requiresFile: true
        }),
        ...workflowActions
      ];
    }

    if (status === "archive_pending" || status === "pending_archive_confirm") {
      return [
        detailAction({
          key: "confirm_archive",
          label: "确认结算归档",
          kind: "primary",
          roleKeys,
          requiredAction: "settlement.archive.confirm",
          enabled: true,
          requiresPassword: true
        }),
        ...workflowActions
      ];
    }

    if (status === "effective") {
      return [
        detailAction({
          key: "create_payment",
          label: "发起付款申请",
          kind: "primary",
          roleKeys,
          requiredAction: "payment.create",
          enabled: true
        }),
        detailAction({
          key: "download_archive",
          label: "下载结算归档件",
          kind: "normal",
          roleKeys,
          enabled: archiveFiles.some((file) => file.canDownload),
          disabledReason: "暂无可下载归档件",
          requiresPassword: true
        }),
        ...workflowActions
      ];
    }

    return workflowActions;
  }

  private statusView(
    status: string,
    generationFailed = false
  ): { label: string; tone: CoreFlowTone } {
    if (status === "pending_generation" && generationFailed) {
      return { label: "最终结算文件生成失败", tone: "danger" };
    }
    const views: Record<string, { label: string; tone: CoreFlowTone }> = {
      approval_pending: { label: "审批中", tone: "primary" },
      approval_rejected: { label: "审批退回", tone: "danger" },
      withdrawn: { label: "已撤回", tone: "danger" },
      approved_pending_archive: { label: "待归档上传", tone: "primary" },
      pending_generation: { label: "系统生成最终结算文件中", tone: "primary" },
      archive_pending: { label: "待归档确认", tone: "primary" },
      pending_archive_confirm: { label: "待归档确认", tone: "primary" },
      effective: { label: "已生效", tone: "success" },
      rejected: { label: "已退回", tone: "danger" },
      voided: { label: "已作废", tone: "danger" }
    };

    return views[status] ?? { label: "结算状态未读取", tone: "default" };
  }

  private signedDocumentGenerationNeedsRetry(
    claim: {
      status?: string | null;
      claimedAt?: Date | null;
      uploadedFileId?: string | null;
      safeFailureCode?: string | null;
    } | null | undefined
  ): boolean {
    if (!claim) return true;
    if (claim.safeFailureCode) return true;
    if (claim.uploadedFileId && claim.status !== "completed") return true;
    return claim.status === "pending" &&
      claim.claimedAt instanceof Date &&
      Date.now() - claim.claimedAt.getTime() > 5 * 60 * 1000;
  }

  private archiveFileStatusLabel(status: string): string {
    if (status === "confirmed") return "已确认";
    if (status === "pending_confirm") return "待确认";
    return status;
  }

  private nextActionLabel(status: string, generationFailed = false): string {
    if (status === "pending_generation" && generationFailed) {
      return "审批结果不受影响，请合同部主管重试生成";
    }
    const labels: Record<string, string> = {
      approval_pending: "等待结算审批",
      approval_rejected: "退回修改",
      withdrawn: "申请人已撤回",
      approved_pending_archive: "上传签章归档件",
      pending_generation: "系统正在生成最终结算文件",
      archive_pending: "主管确认归档",
      pending_archive_confirm: "主管确认归档",
      effective: "可创建付款申请",
      rejected: "退回申请人",
      voided: "无"
    };

    return labels[status] ?? "待处理";
  }

  private currentOwnerLabel(status: string): string {
    const labels: Record<string, string> = {
      approval_pending: "审批节点处理人",
      approval_rejected: "项目经理",
      withdrawn: "项目经理",
      approved_pending_archive: "合同部成员",
      pending_generation: "系统处理",
      archive_pending: "合同部主管",
      pending_archive_confirm: "合同部主管",
      effective: "系统归档",
      rejected: "项目经理",
      voided: "系统归档"
    };

    return labels[status] ?? "合同部";
  }

  private returnReason(status: string): string {
    return ["approval_rejected", "rejected"].includes(status) ? "审批退回，查看审批历史" : "-";
  }

  private stalledFor(value: Date): string {
    const days = Math.max(0, Math.floor((Date.now() - value.getTime()) / 86_400_000));
    return days === 0 ? "今天" : `${days}天`;
  }

  private effectivenessSteps(
    status: string,
    generationFailed = false
  ): SettlementDetailReadModel["effectivenessSteps"] {
    if (status === "effective") {
      return [
        { label: "结算审批", status: "已通过", tone: "success" },
        { label: "签字盖章归档上传", status: "已上传", tone: "success" },
        { label: "合同部主管确认", status: "已确认", tone: "success" },
        { label: "结算生效", status: "已生效", tone: "success" }
      ];
    }

    if (status === "pending_generation") {
      return [
        { label: "结算审批", status: "已通过", tone: "success" },
        {
          label: "最终签名合成件",
          status: generationFailed ? "生成失败，待合同部主管重试" : "系统生成中",
          tone: generationFailed ? "danger" : "primary"
        },
        { label: "合同部主管确认", status: "未开始", tone: "default" },
        { label: "结算生效", status: "阻塞", tone: "danger" }
      ];
    }

    if (status === "archive_pending" || status === "pending_archive_confirm") {
      return [
        { label: "结算审批", status: "已通过", tone: "success" },
        { label: "签字盖章归档上传", status: "已上传", tone: "success" },
        { label: "合同部主管确认", status: "待处理", tone: "primary" },
        { label: "结算生效", status: "阻塞", tone: "danger" }
      ];
    }

    if (status === "approval_rejected" || status === "withdrawn") {
      return [
        {
          label: "结算审批",
          status: status === "withdrawn" ? "已撤回" : "已退回",
          tone: "danger"
        },
        { label: "签字盖章归档上传", status: "未开始", tone: "default" },
        { label: "合同部主管确认", status: "未开始", tone: "default" },
        { label: "结算生效", status: "阻塞", tone: "danger" }
      ];
    }

    return [
      { label: "结算审批", status: "处理中", tone: "primary" },
      { label: "签字盖章归档上传", status: "未开始", tone: "default" },
      { label: "合同部主管确认", status: "未开始", tone: "default" },
      { label: "结算生效", status: "阻塞", tone: "danger" }
    ];
  }

  private defaultPaymentRequestStatus(status: string): string {
    return status === "effective" ? "可创建" : "未开放";
  }

  private paymentBlockMessage(status: string): string {
    if (status === "effective") {
      return "结算已生效，可按绑定付款条款版本创建付款申请；付款比例和账期必须追溯当前版本。";
    }

    return "结算尚未生效，暂不可创建付款申请；付款比例和账期按绑定的付款条款版本执行。";
  }

  private settlementSourceLabel(sourceType?: string | null): string {
    return sourceType === "historical_takeover" ? "历史接管期初结算" : "月度结算";
  }

  private ratioLabel(ratioBps: number | null): string {
    if (ratioBps === null) {
      return "-";
    }

    return `${ratioBps / 100}%`;
  }

  private formatMoney(amountCents: bigint): string {
    return `¥${formatMoneyCentsAsYuan(dbMoneyToBigInt(amountCents, "结算金额"))}`;
  }

  private formatQuantity(value: { toString(): string } | string | number | null): string {
    if (value === null) return "-";
    return value
      .toString()
      .replace(/(\.\d*?)0+$/, "$1")
      .replace(/\.$/, "");
  }

  private settlementLedgerRow(
    settlement: {
      id: string; code: string; contractId: string; projectId: string; periodLabel: string;
      status: string; amountCents: bigint; paymentTermsVersionId: string; updatedAt: Date;
    },
    contract?: { code: string | null; temporaryCode: string | null } | null,
    termsVersion?: { versionNo: number } | null,
    project?: { name: string } | null,
    lifecycle: Record<string, unknown> = {}
  ) {
    const status = this.statusView(settlement.status);
    const nextAction = this.nextActionLabel(settlement.status);
    const pendingOwner = this.currentOwnerLabel(settlement.status);
    return {
      id: settlement.code,
      settlementNo: settlement.code,
      contractNo: contract?.code ?? contract?.temporaryCode ?? settlement.contractId,
      project: project?.name ?? settlement.projectId,
      period: settlement.periodLabel,
      amount: this.formatMoney(settlement.amountCents),
      paymentTermsVersion: termsVersion ? `v${termsVersion.versionNo}` : "-",
      currentNode: nextAction,
      nodeTone: status.tone,
      ownerDepartment: pendingOwner,
      pendingOwner,
      stalledFor: this.stalledFor(settlement.updatedAt),
      returnReason: this.returnReason(settlement.status),
      nextAction,
      updatedAt: this.date(settlement.updatedAt),
      ...lifecycle
    };
  }

  private matchesWorkbenchView(
    view: SettlementWorkbenchView,
    settlement: { id: string; status: string; preparedByUserId: string | null },
    actorUserId: string,
    pendingSettlementIds: ReadonlySet<string>
  ) {
    if (view === "all") return true;
    if (view === "pending_action") {
      return pendingSettlementIds.has(settlement.id) ||
        (settlement.status === "approval_rejected" && settlement.preparedByUserId === actorUserId);
    }
    if (view === "my_drafts") return false;
    if (view === "in_approval") return ["in_approval", "approval_pending"].includes(settlement.status);
    if (view === "pending_archive") {
      return ["pending_generation", "approved_pending_archive", "archive_pending", "pending_archive_confirm"]
        .includes(settlement.status);
    }
    return settlement.status === "effective";
  }

  private page(raw?: string | number) {
    const parsed = typeof raw === "number" ? raw : Number(raw ?? 1);
    return Number.isFinite(parsed) ? Math.max(1, Math.trunc(parsed)) : 1;
  }

  private pageSize(raw?: string | number) {
    const parsed = typeof raw === "number" ? raw : Number(raw ?? 20);
    return Number.isFinite(parsed) ? Math.min(100, Math.max(1, Math.trunc(parsed))) : 20;
  }

  private limit(rawLimit?: string | number) {
    const parsed = typeof rawLimit === "number" ? rawLimit : Number(rawLimit ?? 100);
    if (!Number.isFinite(parsed)) return 100;
    return Math.min(Math.max(Math.trunc(parsed), 1), 200);
  }

  private date(value: Date) {
    return value.toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" });
  }
}

function decimalText(
  value: { toString(): string } | string | number | null | undefined
): string | null {
  if (value === null || value === undefined) return null;
  return String(typeof value === "object" ? value.toString() : value)
    .replace(/(\.\d*?)0+$/u, "$1")
    .replace(/\.$/u, "");
}

function formatDecimalYuan(value: string): string {
  const [integer = "0", fraction = ""] = value.split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
  const normalizedFraction = fraction.padEnd(2, "0").replace(/0+$/u, "");
  return `${grouped}.${normalizedFraction.padEnd(2, "0")}`;
}

function invoiceTypeLabel(value: string | null): string {
  return value === "vat_general" || value === "vat_special"
    ? contractInvoiceTypeLabel(value as ContractInvoiceType)
    : "—";
}

function taxModeLabel(value: string | null): string {
  return value === "single_rate" || value === "multiple_rate"
    ? contractTaxModeLabel(value as ContractTaxMode)
    : "—";
}
