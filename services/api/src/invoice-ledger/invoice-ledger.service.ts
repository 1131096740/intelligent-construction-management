import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  resolveEffectiveRoleKeys,
  VAT_INVOICE_TYPES,
  type RoleKey,
  type VatInvoiceType
} from "@jiangkong/shared-domain";
import { createHash } from "node:crypto";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import {
  missingOperatingSourceReplayService,
  OperatingSourceReplayService,
  type OperatingSourceAppendPort
} from "../operating-ledger/operating-source-replay.service";
import { FileService } from "../file/file.service";
import { parseMoneyCentsInput } from "../money/decimal-money";
import {
  collapseUnicodeWhitespace,
  isUnicodeBlank
} from "../validation/unicode-whitespace";
import { SpotProcurementPilotService } from "../spot-procurement/spot-procurement-pilot.service";
import { SpotProcurementClosureService } from "../spot-procurement/spot-procurement-closure.service";
import { SPOT_PROCUREMENT_INVOICE_RECORD_SOURCE_TYPE } from "../spot-procurement/spot-procurement-operating-source.adapter";
import type { CreateInvoiceExceptionConfirmationDto } from "./dto/create-invoice-exception-confirmation.dto";
import type { CreateNoInvoiceConfirmationDto } from "./dto/create-no-invoice-confirmation.dto";
import type {
  CreateProcurementInvoiceDto,
  ProcurementInvoiceAllocationDto,
  ProcurementInvoiceLineDto
} from "./dto/create-procurement-invoice.dto";
import type { ReverseInvoiceAllocationDto } from "./dto/reverse-invoice-allocation.dto";
import type { ReverseInvoiceClearingAllocationDto } from "./dto/reverse-invoice-clearing-allocation.dto";
import type { CreateGlobalInvoiceDto } from "./dto/create-global-invoice.dto";
import type { VoidGlobalInvoiceDto } from "./dto/void-global-invoice.dto";
import type { ReviewInvoiceExceptionConfirmationDto } from "./dto/review-invoice-exception-confirmation.dto";
import type { ReviewNoInvoiceConfirmationDto } from "./dto/review-no-invoice-confirmation.dto";

const HANDLER_INVOICE_ROLES = new Set<RoleKey>([
  "material_staff",
  "material_director"
]);
const CURRENT_CONFIRMATION_STATUSES = ["pending_review", "confirmed"] as const;
const INVOICE_RECORD_SOURCE_BUSINESS_TYPE = "spot_procurement";
const MONEY_RESERVE_CONFLICT_MESSAGE =
  "票据覆盖额度已变化，请刷新后重试";
const TICKET_WRITE_CONFLICT_MESSAGE =
  "零星采购票据事实已变化，请刷新后重试";
const MAX_TEXT_LENGTH = 500;

type ProcurementLockRow = {
  id: string;
  projectId: string;
  code: string;
  handlerUserId: string;
  currentVersionId: string | null;
  status: string;
  actualCostCents: bigint | null;
};

type VersionLockRow = {
  id: string;
  procurementId: string;
  status: string;
  handlerUserId: string;
};

type ReceiptLockRow = {
  id: string;
  projectId: string;
  procurementId: string;
  procurementVersionId: string;
  status: string;
  currentRevisionNo: number;
  actualCostCents: bigint;
};

type ReceiptRevisionLockRow = {
  id: string;
  receiptId: string;
  revisionNo: number;
  procurementId: string;
  procurementVersionId: string;
  actualCostCents: bigint;
};

type ReceiptReviewLockRow = {
  id: string;
  receiptId: string;
  receiptRevisionNo: number;
  procurementId: string;
  procurementVersionId: string;
  sequenceNo: number;
  decision: string;
};

type ProcurementLineLockRow = {
  id: string;
  versionId: string;
  invoiceMode: string;
  invoiceType: string | null;
  vatRateOptionId: string | null;
  vatRateValueSnapshot: Prisma.Decimal | null;
  vatRateLabelSnapshot: string | null;
  unitPrice: Prisma.Decimal;
};

type ReceiptLineLockRow = {
  id: string;
  receiptId: string;
  receiptRevisionNo: number;
  procurementId: string;
  procurementVersionId: string;
  procurementLineId: string;
  actualCostCents: bigint;
};

type PaymentLockRow = {
  id: string;
  projectId: string;
  procurementId: string;
  procurementVersionId: string;
  paymentType: string | null;
  invalidatedAt: Date | null;
};

type PaymentExecutionRow = {
  paymentId: string;
  amountCents: bigint;
};

type ExecutedBalanceRow = {
  paymentId: string;
  amountCents: bigint;
  releasedAmountCents: bigint;
};

type LockedContext = {
  procurement: ProcurementLockRow;
  version: VersionLockRow;
  receipt: ReceiptLockRow;
  revision: ReceiptRevisionLockRow;
  review: ReceiptReviewLockRow;
  procurementLines: ProcurementLineLockRow[];
  receiptLines: ReceiptLineLockRow[];
  payments: PaymentLockRow[];
  settledByPaymentId: Map<string, bigint>;
  settledAmountCents: bigint;
};

type CoverageReserve = {
  normalInvoiceCents: bigint;
  pendingNoInvoiceCents: bigint;
  confirmedNoInvoiceCents: bigint;
  pendingExceptionCents: bigint;
  confirmedExceptionCents: bigint;
};

type PreparedInvoiceLine = {
  lineNo: number;
  description: string | null;
  vatRateOptionId: string;
  vatRateValueSnapshot: Prisma.Decimal;
  vatRateLabelSnapshot: string;
  taxInclusiveAmountCents: bigint;
  allocations: PreparedInvoiceAllocation[];
};

type PreparedInvoiceAllocation = {
  procurementLineId: string;
  paymentId: string | null;
  amountCents: bigint;
};

type InvoiceHeaderFacts = {
  identityKey: string;
  identityKind: InvoiceIdentityKind;
  owningCompanyEntityId: string;
  direction: "inbound" | "outbound";
  invoiceType: VatInvoiceType;
  invoiceCode: string | null;
  invoiceNumber: string | null;
  externalIdentifier: string | null;
  issueDate: Date;
  sellerName: string;
  sellerTaxId: string;
  buyerName: string;
  buyerTaxId: string;
  taxExclusiveAmountCents: bigint;
  taxAmountCents: bigint;
  totalAmountCents: bigint;
  fileId: string;
};

type InvoiceIdentityKind = "digital" | "traditional" | "other";

type InvoiceRecordWithLines = {
  id: string;
  projectId: string | null;
  identityKey: string;
  identityKind: string;
  owningCompanyEntityId: string | null;
  direction: string | null;
  invoiceType: string;
  invoiceCode: string | null;
  invoiceNumber: string | null;
  externalIdentifier: string | null;
  issueDate: Date;
  sellerName: string;
  sellerTaxId: string | null;
  buyerName: string;
  buyerTaxId: string | null;
  taxExclusiveAmountCents: bigint | null;
  taxAmountCents: bigint | null;
  totalAmountCents: bigint;
  allocatableAmountCents: bigint;
  allocatedAmountCents: bigint;
  status: string;
  fileId: string;
  sourceBusinessType: string;
  sourceBusinessId: string;
  sourceProcurementId: string | null;
  lines: Array<{
    id: string;
    invoiceRecordId: string;
    lineNo: number;
    description: string | null;
    vatRateOptionId: string;
    vatRateValueSnapshot: Prisma.Decimal;
    vatRateLabelSnapshot: string;
    taxInclusiveAmountCents: bigint;
    allocatedAmountCents: bigint;
  }>;
};

type ConfirmationReviewInput = {
  operation: "confirm" | "return" | "reverse";
  comment?: string;
  confirmReversal?: boolean;
};

type ActorRoleScopes = {
  effectiveRoleKeys: RoleKey[];
  projectRoleKeys: RoleKey[];
};

@Injectable()
export class InvoiceLedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly files: FileService,
    private readonly pilot: SpotProcurementPilotService,
    private readonly closure: SpotProcurementClosureService,
    @Inject(OperatingSourceReplayService)
    private readonly operatingSources: OperatingSourceAppendPort =
      missingOperatingSourceReplayService()
  ) {}

  async createProcurementInvoice(
    procurementId: string,
    actorUserId: string,
    input: CreateProcurementInvoiceDto
  ) {
    const header = this.prepareInvoiceHeader(input);
    await this.files.assertCanDownloadFileById(header.fileId, actorUserId);

    return this.runWrite(() =>
      this.runSerializable(async (tx) => {
        const context = await this.lockCurrentContext(tx, procurementId);
        this.pilot.assertEnabled(context.procurement.projectId);
        this.assertLegacyInvoiceLedgerMutationAllowed(context);
        await this.requireInvoiceManager(
          tx,
          actorUserId,
          context
        );
        this.requireAnySettlement(context);

        const preparedLines = await this.prepareInvoiceLines(
          tx,
          input.lines,
          header.totalAmountCents
        );
        let invoice = await this.lockInvoiceByIdentity(
          tx,
          header.identityKey
        );
        let created = false;
        if (invoice) {
          this.assertSameInvoiceFacts(
            invoice,
            header,
            preparedLines,
            context
          );
        } else {
          const file = await this.files.assertFileHasNoBusinessBinding(
            tx,
            header.fileId
          );
          if (file.uploadedByUserId !== actorUserId) {
            throw new ForbiddenException(
              "只能将本人上传且尚未绑定的文件登记为发票"
            );
          }
          invoice = await this.createInvoiceRecord(
            tx,
            context,
            actorUserId,
            header,
            preparedLines
          );
          created = true;
          await this.operatingSources.appendConfirmedSourceIfEnabledInTransaction(
            tx,
            {
              projectId: context.procurement.projectId,
              sourceType: SPOT_PROCUREMENT_INVOICE_RECORD_SOURCE_TYPE,
              sourceBusinessId: invoice.id
            },
            actorUserId
          );
          await this.audit.record(tx, {
            actorUserId,
            action: "spot_procurement.invoice.create",
            businessType: "invoice_record",
            businessId: invoice.id,
            metadata: {
              projectId: context.procurement.projectId,
              procurementId,
              invoiceType: header.invoiceType,
              totalAmountCents: header.totalAmountCents.toString(),
              lineCount: preparedLines.length
            }
          });
        }

        const lineByNumber = new Map(
          invoice.lines.map((line) => [line.lineNo, line])
        );
        const procurementLineById = new Map(
          context.procurementLines.map((line) => [line.id, line])
        );
        const receiptLineByProcurementLineId = new Map(
          context.receiptLines.map((line) => [
            line.procurementLineId,
            line
          ])
        );
        const allocations: Array<{
          id: string;
          invoiceLineId: string;
          procurementLineId: string;
          paymentId: string | null;
          amountCents: bigint;
          existing: boolean;
        }> = [];
        const exceptionCandidates: Array<{
          invoiceLineId: string;
          procurementLineId: string;
          paymentId: string | null;
          amountCents: string;
          reason: string;
        }> = [];

        for (const preparedLine of preparedLines) {
          const invoiceLine = lineByNumber.get(preparedLine.lineNo);
          if (!invoiceLine) {
            throw new ConflictException(
              "发票明细已变化，请刷新后重试"
            );
          }
          for (const requested of preparedLine.allocations) {
            const procurementLine = procurementLineById.get(
              requested.procurementLineId
            );
            const receiptLine = receiptLineByProcurementLineId.get(
              requested.procurementLineId
            );
            if (!procurementLine || !receiptLine) {
              throw new BadRequestException(
                "发票分摊只能选择当前有效收货明细"
              );
            }
            this.assertPaymentTarget(context, requested.paymentId);
            if (procurementLine.invoiceMode !== "invoice") {
              throw new ConflictException(
                "原冻结无票材料不能按普通发票覆盖，请走无票确认"
              );
            }

            const mismatchReason = this.invoiceMismatchReason(
              header.invoiceType,
              preparedLine.vatRateValueSnapshot,
              procurementLine
            );
            if (mismatchReason) {
              exceptionCandidates.push({
                invoiceLineId: invoiceLine.id,
                procurementLineId: procurementLine.id,
                paymentId: requested.paymentId,
                amountCents: requested.amountCents.toString(),
                reason: mismatchReason
              });
              await this.audit.record(tx, {
                actorUserId,
                action: "spot_procurement.invoice.mismatch_detected",
                businessType: "invoice_record",
                businessId: invoice.id,
                metadata: {
                  projectId: context.procurement.projectId,
                  procurementId,
                  invoiceLineId: invoiceLine.id,
                  procurementLineId: procurementLine.id,
                  paymentId: requested.paymentId,
                  amountCents: requested.amountCents.toString(),
                  reason: mismatchReason
                }
              });
              continue;
            }

            const existingAllocation =
              await tx.invoiceAllocation.findFirst({
                where: {
                  invoiceLineId: invoiceLine.id,
                  procurementLineId: procurementLine.id,
                  paymentId: requested.paymentId,
                  invalidatedAt: null
                }
              });
            if (existingAllocation) {
              if (
                existingAllocation.procurementId !== procurementId ||
                existingAllocation.procurementVersionId !==
                  context.version.id ||
                existingAllocation.receiptId !== context.receipt.id ||
                existingAllocation.receiptRevisionNo !==
                  context.receipt.currentRevisionNo ||
                existingAllocation.amountCents !== requested.amountCents
              ) {
                throw new ConflictException(
                  "该发票明细已按不同事实分摊"
                );
              }
              allocations.push({
                id: existingAllocation.id,
                invoiceLineId: invoiceLine.id,
                procurementLineId: procurementLine.id,
                paymentId: requested.paymentId,
                amountCents: requested.amountCents,
                existing: true
              });
              continue;
            }

            await this.assertReserveCapacity(tx, context, {
              procurementLineId: procurementLine.id,
              invoiceLineId: invoiceLine.id,
              paymentId: requested.paymentId,
              amountCents: requested.amountCents,
              invoiceLineLimitCents:
                invoiceLine.taxInclusiveAmountCents
            });
            const allocation = await tx.invoiceAllocation.create({
              data: {
                projectId: context.procurement.projectId,
                invoiceLineId: invoiceLine.id,
                receiptId: context.receipt.id,
                receiptRevisionNo:
                  context.receipt.currentRevisionNo,
                procurementId,
                procurementVersionId: context.version.id,
                procurementLineId: procurementLine.id,
                paymentId: requested.paymentId,
                amountCents: requested.amountCents,
                createdByUserId: actorUserId
              }
            });
            allocations.push({
              id: allocation.id,
              invoiceLineId: invoiceLine.id,
              procurementLineId: procurementLine.id,
              paymentId: requested.paymentId,
              amountCents: requested.amountCents,
              existing: false
            });
            await this.audit.record(tx, {
              actorUserId,
              action: "spot_procurement.invoice.allocate",
              businessType: "invoice_allocation",
              businessId: allocation.id,
              metadata: {
                projectId: context.procurement.projectId,
                procurementId,
                invoiceRecordId: invoice.id,
                invoiceLineId: invoiceLine.id,
                procurementLineId: procurementLine.id,
                paymentId: requested.paymentId,
                amountCents: requested.amountCents.toString()
              }
            });
          }
        }

        await this.recomputeInvoiceCounters(tx, invoice.id);
        const refreshedRecord = await tx.invoiceRecord.findUnique({
          where: { id: invoice.id }
        });
        if (!refreshedRecord) {
          throw new ConflictException(
            "发票记录已变化，请刷新后重试"
          );
        }
        const refreshed: InvoiceRecordWithLines = {
          ...refreshedRecord,
          lines: await tx.invoiceLine.findMany({
            where: { invoiceRecordId: refreshedRecord.id },
            orderBy: [{ lineNo: "asc" }, { id: "asc" }]
          })
        };
        await this.closure.recalculateAndClose(
          tx,
          procurementId,
          "invoice.allocate",
          actorUserId
        );
        return {
          invoice: this.invoiceReadModel(refreshed),
          allocations: allocations.map((allocation) => ({
            ...allocation,
            amountCents: allocation.amountCents.toString()
          })),
          exceptionCandidates,
          created
        };
      })
    );
  }

  async createGlobalInvoice(actorUserId: string, input: CreateGlobalInvoiceDto) {
    const header = this.prepareInvoiceHeader(input);
    const idempotencyKey = requiredId(input.idempotencyKey, "请填写幂等键");
    const fingerprint = createHash("sha256").update(JSON.stringify([
      "global-invoice", 1, actorUserId, header.identityKey, header.identityKind,
      header.owningCompanyEntityId, header.direction, header.invoiceType,
      header.invoiceCode, header.invoiceNumber, header.externalIdentifier,
      header.issueDate.toISOString(), header.sellerName, header.sellerTaxId,
      header.buyerName, header.buyerTaxId,
      header.taxExclusiveAmountCents.toString(), header.taxAmountCents.toString(),
      header.totalAmountCents.toString(), header.fileId
    ]), "utf8").digest("hex");
    await this.files.assertCanDownloadFileById(header.fileId, actorUserId);
    return this.runWrite(() => this.runSerializable(async (tx) => {
      await this.requireGlobalInvoiceManager(tx, actorUserId);
      const replay = await tx.invoiceRecord.findUnique({ where: { commandIdempotencyKey: idempotencyKey } });
      if (replay) {
        if (replay.commandFingerprint !== fingerprint) throw new ConflictException("幂等键已用于不同的全局发票请求");
        return { id: replay.id, replayed: true };
      }
      const existing = await this.lockInvoiceByIdentity(tx, header.identityKey);
      if (existing) throw new ConflictException("该发票身份已用于不同的发票事实");
      const file = await this.files.assertFileHasNoBusinessBinding(tx, header.fileId);
      if (file.uploadedByUserId !== actorUserId) throw new ForbiddenException("只能登记本人上传且尚未绑定的发票文件");
      const invoice = await tx.invoiceRecord.create({ data: {
        projectId: null, identityKey: header.identityKey, identityKind: header.identityKind,
        owningCompanyEntityId: header.owningCompanyEntityId, direction: header.direction,
        invoiceType: header.invoiceType, invoiceCode: header.invoiceCode, invoiceNumber: header.invoiceNumber,
        externalIdentifier: header.externalIdentifier, issueDate: header.issueDate,
        sellerName: header.sellerName, sellerTaxId: header.sellerTaxId,
        buyerName: header.buyerName, buyerTaxId: header.buyerTaxId,
        taxExclusiveAmountCents: header.taxExclusiveAmountCents, taxAmountCents: header.taxAmountCents,
        totalAmountCents: header.totalAmountCents, allocatableAmountCents: header.totalAmountCents,
        fileId: header.fileId, uploadedByUserId: actorUserId,
        sourceBusinessType: "global_clearing_invoice", sourceBusinessId: header.identityKey,
        sourceProcurementId: null,
        commandIdempotencyKey: idempotencyKey, commandFingerprint: fingerprint
      } });
      await this.audit.record(tx, { actorUserId, action: "invoice.global.create", businessType: "invoice_record", businessId: invoice.id, metadata: { owningCompanyEntityId: header.owningCompanyEntityId, direction: header.direction, totalAmountCents: header.totalAmountCents.toString() } });
      return { id: invoice.id, replayed: false };
    }));
  }

  async voidGlobalInvoice(invoiceRecordId: string, actorUserId: string, input: VoidGlobalInvoiceDto) {
    const normalizedInvoiceRecordId = requiredId(invoiceRecordId, "请选择需要作废的全局发票");
    const reasonCode = requiredText(input.reasonCode, "作废原因", 100);
    const idempotencyKey = requiredId(input.idempotencyKey, "请填写幂等键");
    const requestFingerprint = createHash("sha256").update(JSON.stringify([
      "global-invoice-void", 1, actorUserId, normalizedInvoiceRecordId, reasonCode
    ]), "utf8").digest("hex");
    return this.runWrite(() => this.runSerializable(async (tx) => {
      await this.requireGlobalInvoiceManager(tx, actorUserId);
      const replay = await tx.invoiceLifecycleEvent.findUnique({ where: { idempotencyKey } });
      if (replay) {
        if (replay.requestFingerprint !== requestFingerprint) throw new ConflictException("幂等键已用于不同的发票作废请求");
        return { id: replay.id, replayed: true };
      }
      const invoice = await tx.invoiceRecord.findUnique({ where: { id: normalizedInvoiceRecordId } });
      if (!invoice || invoice.projectId !== null || invoice.sourceBusinessType !== "global_clearing_invoice") {
        throw new NotFoundException("可作废的全局发票不存在");
      }
      const event = await tx.invoiceLifecycleEvent.create({ data: {
        invoiceRecordId: invoice.id, kind: "void", reasonCode, createdByUserId: actorUserId,
        idempotencyKey, requestFingerprint
      } });
      await this.audit.record(tx, { actorUserId, action: "invoice.global.void", businessType: "invoice_lifecycle_event", businessId: event.id, metadata: { invoiceRecordId: invoice.id, reasonCode } });
      return { id: event.id, replayed: false };
    }));
  }

  async createClearingAllocation(
    actorUserId: string,
    input: {
      invoiceRecordId: string;
      clearingCaseId: string;
      clearingEventVersionId: string;
      amountCents: string;
      structuredReasonCode?: string;
      idempotencyKey: string;
    }
  ) {
    const invoiceRecordId = requiredId(input.invoiceRecordId, "请选择全局发票");
    const clearingCaseId = requiredId(input.clearingCaseId, "请选择清算案件");
    const clearingEventVersionId = requiredId(input.clearingEventVersionId, "请选择已确认清算版本");
    const amountCents = positiveMoney(input.amountCents, "发票清算分配金额");
    const idempotencyKey = requiredId(input.idempotencyKey, "请填写幂等键");
    const structuredReasonCode = optionalText(input.structuredReasonCode, 100);
    const requestFingerprint = createHash("sha256").update(JSON.stringify([
      "invoice-clearing-allocation", 1, invoiceRecordId, clearingCaseId,
      clearingEventVersionId, amountCents.toString(), structuredReasonCode
    ]), "utf8").digest("hex");
    return this.runWrite(() => this.runSerializable(async (tx) => {
      const replay = await tx.invoiceClearingAllocation.findUnique({ where: { idempotencyKey } });
      if (replay) {
        if (replay.requestFingerprint !== requestFingerprint) throw new ConflictException("幂等键已用于不同的发票清算请求");
        return { id: replay.id, replayed: true };
      }
      const [invoice, clearingCase, version] = await Promise.all([
        tx.invoiceRecord.findUnique({ where: { id: invoiceRecordId } }),
        tx.clearingCase.findUnique({ where: { id: clearingCaseId } }),
        tx.clearingEventVersion.findUnique({ where: { id: clearingEventVersionId }, include: { confirmation: true } })
      ]);
      if (!invoice?.owningCompanyEntityId) throw new ConflictException("发票缺少归属我方公司主体，不能用于清算");
      if (!clearingCase || !version?.confirmation || version.clearingCaseId !== clearingCase.id) throw new ConflictException("发票分配必须引用同一案件的已确认清算版本");
      const projectCompany = await tx.projectParticipatingCompany.findFirst({
        where: {
          projectId: clearingCase.projectId,
          companyEntityId: invoice.owningCompanyEntityId,
          effectiveFrom: { lte: new Date() },
          OR: [{ endedAt: null }, { endedAt: { gte: new Date() } }]
        },
        select: { id: true }
      });
      if (!projectCompany) throw new ConflictException("发票归属我方主体未在清算项目有效参与公司范围内");
      await this.requireFinanceDirector(tx, actorUserId, clearingCase.projectId);
      const existingAllocations = await tx.invoiceClearingAllocation.findMany({
        where: { invoiceRecordId },
        select: { amountCents: true, reversesAllocationId: true }
      });
      const used = existingAllocations.reduce(
        (total, row) => total + (row.reversesAllocationId ? -row.amountCents : row.amountCents),
        0n
      );
      if (used + amountCents > invoice.totalAmountCents) throw new ConflictException("有效发票清算分配累计超过票面含税额");
      const allocation = await tx.invoiceClearingAllocation.create({ data: { invoiceRecordId, projectId: clearingCase.projectId, clearingCaseId, clearingEventVersionId, amountCents, structuredReasonCode, createdByUserId: actorUserId, idempotencyKey, requestFingerprint } });
      await this.audit.record(tx, { actorUserId, action: "invoice.clearing.allocate", businessType: "invoice_clearing_allocation", businessId: allocation.id, metadata: { invoiceRecordId, clearingCaseId, clearingEventVersionId, amountCents: amountCents.toString() } });
      return { id: allocation.id, replayed: false };
    }));
  }

  async reverseClearingAllocation(
    allocationId: string,
    actorUserId: string,
    input: ReverseInvoiceClearingAllocationDto
  ) {
    const normalizedAllocationId = requiredId(allocationId, "请选择需要反向的清算发票分配");
    const amountCents = positiveMoney(input.amountCents, "反向分配金额");
    const structuredReasonCode = requiredText(input.structuredReasonCode, "结构化更正原因", 100);
    const idempotencyKey = requiredId(input.idempotencyKey, "请填写幂等键");
    const requestFingerprint = createHash("sha256").update(JSON.stringify([
      "invoice-clearing-allocation-reversal", 1, actorUserId, normalizedAllocationId,
      amountCents.toString(), structuredReasonCode
    ]), "utf8").digest("hex");
    return this.runWrite(() => this.runSerializable(async (tx) => {
      const replay = await tx.invoiceClearingAllocation.findUnique({ where: { idempotencyKey } });
      if (replay) {
        if (replay.requestFingerprint !== requestFingerprint) throw new ConflictException("幂等键已用于不同的发票清算反向请求");
        return { id: replay.id, replayed: true };
      }
      const allocation = await tx.invoiceClearingAllocation.findUnique({ where: { id: normalizedAllocationId } });
      if (!allocation || allocation.reversesAllocationId) throw new NotFoundException("可反向的清算发票分配不存在");
      await this.requireFinanceDirector(tx, actorUserId, allocation.projectId);
      const reversed = await tx.invoiceClearingAllocation.aggregate({ where: { reversesAllocationId: allocation.id }, _sum: { amountCents: true } });
      if ((reversed._sum.amountCents ?? 0n) + amountCents > allocation.amountCents) {
        throw new ConflictException("反向分配金额超过原清算发票分配的剩余有效金额");
      }
      const reversal = await tx.invoiceClearingAllocation.create({ data: {
        invoiceRecordId: allocation.invoiceRecordId, projectId: allocation.projectId,
        clearingCaseId: allocation.clearingCaseId, clearingEventVersionId: allocation.clearingEventVersionId,
        amountCents, structuredReasonCode, reversesAllocationId: allocation.id,
        createdByUserId: actorUserId, idempotencyKey, requestFingerprint
      } });
      await this.audit.record(tx, { actorUserId, action: "invoice.clearing.allocation.reverse", businessType: "invoice_clearing_allocation", businessId: reversal.id, metadata: { reversesAllocationId: allocation.id, amountCents: amountCents.toString(), structuredReasonCode } });
      return { id: reversal.id, replayed: false };
    }));
  }

  async reverseAllocation(
    allocationId: string,
    actorUserId: string,
    input: ReverseInvoiceAllocationDto
  ) {
    const normalizedAllocationId = requiredId(
      allocationId,
      "请选择需要冲销的发票分摊"
    );
    const reason = requiredText(
      input.reason,
      "发票分摊冲销原因",
      MAX_TEXT_LENGTH
    );
    if (input.confirmReversal !== true) {
      throw new BadRequestException("请明确确认冲销本次发票分摊");
    }
    const pointer = await this.prisma.invoiceAllocation.findUnique({
      where: { id: normalizedAllocationId },
      select: { procurementId: true }
    });
    if (!pointer) {
      throw new NotFoundException("发票分摊不存在");
    }

    return this.runWrite(() =>
      this.runSerializable(async (tx) => {
        const context = await this.lockCurrentContext(
          tx,
          pointer.procurementId
        );
        this.pilot.assertEnabled(context.procurement.projectId);
        this.assertLegacyInvoiceLedgerMutationAllowed(context);
        await this.requireFinanceDirector(
          tx,
          actorUserId,
          context.procurement.projectId
        );
        const allocations = await tx.$queryRaw<
          Array<{
            id: string;
            projectId: string;
            invoiceLineId: string;
            receiptId: string;
            receiptRevisionNo: number;
            procurementId: string;
            procurementVersionId: string;
            procurementLineId: string;
            paymentId: string | null;
            amountCents: bigint;
            invalidatedAt: Date | null;
            invalidatedByUserId: string | null;
            invalidationReason: string | null;
          }>
        >(Prisma.sql`
          SELECT *
          FROM "InvoiceAllocation"
          WHERE "id" = ${normalizedAllocationId}
          FOR UPDATE
        `);
        const allocation = allocations[0];
        if (!allocation) {
          throw new NotFoundException("发票分摊不存在");
        }
        this.assertCurrentCoordinates(context, allocation);
        if (allocation.invalidatedAt) {
          if (
            allocation.invalidatedByUserId === actorUserId &&
            allocation.invalidationReason === reason
          ) {
            return {
              allocationId: allocation.id,
              status: "reversed",
              reversedAt: allocation.invalidatedAt.toISOString(),
              reversedByUserId: actorUserId,
              reason
            };
          }
          throw new ConflictException("该发票分摊已经冲销");
        }
        const now = new Date();
        const updated = await tx.invoiceAllocation.updateMany({
          where: {
            id: allocation.id,
            invalidatedAt: null
          },
          data: {
            invalidatedAt: now,
            invalidatedByUserId: actorUserId,
            invalidationReason: reason
          }
        });
        if (updated.count !== 1) {
          throw new ConflictException(
            "发票分摊状态已变化，请刷新后重试"
          );
        }
        const invoiceLine = await tx.invoiceLine.findUnique({
          where: { id: allocation.invoiceLineId },
          select: { invoiceRecordId: true }
        });
        if (!invoiceLine) {
          throw new ConflictException(
            "发票明细不存在，请联系管理员核对"
          );
        }
        await this.recomputeInvoiceCounters(
          tx,
          invoiceLine.invoiceRecordId
        );
        await this.audit.record(tx, {
          actorUserId,
          action: "spot_procurement.invoice.allocation.reverse",
          businessType: "invoice_allocation",
          businessId: allocation.id,
          metadata: {
            projectId: context.procurement.projectId,
            procurementId: context.procurement.id,
            invoiceLineId: allocation.invoiceLineId,
            procurementLineId: allocation.procurementLineId,
            paymentId: allocation.paymentId,
            amountCents: allocation.amountCents.toString(),
            reason,
            explicitConfirmation: true
          }
        });
        await this.closure.recalculateAndClose(
          tx,
          context.procurement.id,
          "invoice.allocation.reverse",
          actorUserId
        );
        return {
          allocationId: allocation.id,
          status: "reversed",
          reversedAt: now.toISOString(),
          reversedByUserId: actorUserId,
          reason
        };
      })
    );
  }

  async createNoInvoiceConfirmation(
    procurementId: string,
    actorUserId: string,
    input: CreateNoInvoiceConfirmationDto
  ) {
    const prepared = this.prepareConfirmationInput(input);
    await this.files.assertCanDownloadFileById(
      prepared.proofFileId,
      actorUserId
    );

    return this.runWrite(() =>
      this.runSerializable(async (tx) => {
        const context = await this.lockCurrentContext(tx, procurementId);
        this.pilot.assertEnabled(context.procurement.projectId);
        this.assertLegacyInvoiceLedgerMutationAllowed(context);
        await this.requireConfirmationSubmitter(
          tx,
          context,
          actorUserId
        );
        this.requireAnySettlement(context);
        const procurementLine = this.requireProcurementLine(
          context,
          prepared.procurementLineId
        );
        if (procurementLine.invoiceMode !== "no_invoice") {
          throw new ConflictException(
            "原冻结有票材料不能直接申请无票；未实付请新建版本，已实付请走票据异常"
          );
        }
        this.assertPaymentTarget(context, prepared.paymentId);
        const currentConfirmation =
          await tx.noInvoiceConfirmation.findFirst({
            where: {
              procurementLineId: procurementLine.id,
              status: { in: [...CURRENT_CONFIRMATION_STATUSES] }
            }
          });
        if (currentConfirmation) {
          if (
            currentConfirmation.procurementId === procurementId &&
            currentConfirmation.procurementVersionId ===
              context.version.id &&
            currentConfirmation.receiptId === context.receipt.id &&
            currentConfirmation.receiptRevisionNo ===
              context.receipt.currentRevisionNo &&
            currentConfirmation.paymentId === prepared.paymentId &&
            currentConfirmation.amountCents ===
              prepared.amountCents &&
            currentConfirmation.reason === prepared.reason &&
            currentConfirmation.proofFileId ===
              prepared.proofFileId &&
            currentConfirmation.submittedByUserId === actorUserId
          ) {
            return this.confirmationReadModel(currentConfirmation);
          }
          throw new ConflictException(
            "该采购明细已有待复核或已确认的无票事实"
          );
        }
        const file = await this.files.assertFileHasNoBusinessBinding(
          tx,
          prepared.proofFileId
        );
        if (file.uploadedByUserId !== actorUserId) {
          throw new ForbiddenException(
            "只能使用本人上传且尚未绑定的无票证明"
          );
        }
        await this.assertConfirmationCoversRemaining(
          tx,
          context,
          procurementLine.id,
          prepared.amountCents,
          "无票确认"
        );
        await this.assertReserveCapacity(tx, context, {
          procurementLineId: procurementLine.id,
          paymentId: prepared.paymentId,
          amountCents: prepared.amountCents
        });
        const confirmation = await tx.noInvoiceConfirmation.create({
          data: {
            projectId: context.procurement.projectId,
            receiptId: context.receipt.id,
            receiptRevisionNo: context.receipt.currentRevisionNo,
            procurementId,
            procurementVersionId: context.version.id,
            procurementLineId: procurementLine.id,
            paymentId: prepared.paymentId,
            amountCents: prepared.amountCents,
            reason: prepared.reason,
            proofFileId: prepared.proofFileId,
            submittedByUserId: actorUserId
          }
        });
        await this.audit.record(tx, {
          actorUserId,
          action: "spot_procurement.no_invoice.submit",
          businessType: "no_invoice_confirmation",
          businessId: confirmation.id,
          metadata: {
            projectId: context.procurement.projectId,
            procurementId,
            procurementLineId: procurementLine.id,
            paymentId: prepared.paymentId,
            amountCents: prepared.amountCents.toString()
          }
        });
        return this.confirmationReadModel(confirmation);
      })
    );
  }

  async reviewNoInvoiceConfirmation(
    procurementId: string,
    confirmationId: string,
    actorUserId: string,
    input: ReviewNoInvoiceConfirmationDto
  ) {
    return this.reviewConfirmation(
      "no_invoice",
      procurementId,
      confirmationId,
      actorUserId,
      input
    );
  }

  async createInvoiceException(
    procurementId: string,
    actorUserId: string,
    input: CreateInvoiceExceptionConfirmationDto
  ) {
    const prepared = this.prepareConfirmationInput(input);
    const invoiceLineId = optionalId(input.invoiceLineId);
    await this.files.assertCanDownloadFileById(
      prepared.proofFileId,
      actorUserId
    );

    return this.runWrite(() =>
      this.runSerializable(async (tx) => {
        const context = await this.lockCurrentContext(tx, procurementId);
        this.pilot.assertEnabled(context.procurement.projectId);
        this.assertLegacyInvoiceLedgerMutationAllowed(context);
        await this.requireConfirmationSubmitter(
          tx,
          context,
          actorUserId
        );
        this.requireAnySettlement(context);
        const procurementLine = this.requireProcurementLine(
          context,
          prepared.procurementLineId
        );
        if (
          procurementLine.invoiceMode !== "invoice" ||
          !procurementLine.invoiceType ||
          !procurementLine.vatRateOptionId ||
          !procurementLine.vatRateValueSnapshot ||
          !procurementLine.vatRateLabelSnapshot
        ) {
          throw new ConflictException(
            "只有原冻结有票材料才能发起票据异常"
          );
        }
        this.assertPaymentTarget(context, prepared.paymentId);
        const currentConfirmation =
          await tx.invoiceExceptionConfirmation.findFirst({
            where: {
              procurementLineId: procurementLine.id,
              status: { in: [...CURRENT_CONFIRMATION_STATUSES] }
            }
          });
        if (currentConfirmation) {
          if (
            currentConfirmation.procurementId === procurementId &&
            currentConfirmation.procurementVersionId ===
              context.version.id &&
            currentConfirmation.receiptId === context.receipt.id &&
            currentConfirmation.receiptRevisionNo ===
              context.receipt.currentRevisionNo &&
            currentConfirmation.paymentId === prepared.paymentId &&
            currentConfirmation.invoiceLineId === invoiceLineId &&
            currentConfirmation.amountCents ===
              prepared.amountCents &&
            currentConfirmation.reason === prepared.reason &&
            currentConfirmation.proofFileId ===
              prepared.proofFileId &&
            currentConfirmation.submittedByUserId === actorUserId
          ) {
            return this.confirmationReadModel(currentConfirmation);
          }
          throw new ConflictException(
            "该采购明细已有待复核或已确认的票据异常"
          );
        }
        let invoiceLine:
          | {
              id: string;
              taxInclusiveAmountCents: bigint;
              vatRateValueSnapshot: Prisma.Decimal;
              record: {
                invoiceType: string;
                status: string;
                sourceProcurementId: string | null;
              };
            }
          | null = null;
        if (invoiceLineId) {
          const storedInvoiceLine = await tx.invoiceLine.findUnique({
            where: { id: invoiceLineId },
            select: {
              id: true,
              invoiceRecordId: true,
              taxInclusiveAmountCents: true,
              vatRateValueSnapshot: true
            }
          });
          const storedInvoiceRecord = storedInvoiceLine
            ? await tx.invoiceRecord.findUnique({
                where: { id: storedInvoiceLine.invoiceRecordId },
                select: {
                  invoiceType: true,
                  status: true,
                  sourceProcurementId: true
                }
              })
            : null;
          invoiceLine =
            storedInvoiceLine && storedInvoiceRecord
              ? {
                  id: storedInvoiceLine.id,
                  taxInclusiveAmountCents:
                    storedInvoiceLine.taxInclusiveAmountCents,
                  vatRateValueSnapshot:
                    storedInvoiceLine.vatRateValueSnapshot,
                  record: storedInvoiceRecord
                }
              : null;
          if (
            !invoiceLine ||
            invoiceLine.record.status !== "active" ||
            invoiceLine.record.sourceProcurementId !== procurementId
          ) {
            throw new BadRequestException(
              "票据异常关联的发票明细不存在或不属于当前采购"
            );
          }
          if (
            !this.invoiceMismatchReason(
              invoiceLine.record.invoiceType,
              invoiceLine.vatRateValueSnapshot,
              procurementLine
            )
          ) {
            throw new ConflictException(
              "该发票明细与冻结票据条件一致，应走正常发票分摊"
            );
          }
        }
        const file = await this.files.assertFileHasNoBusinessBinding(
          tx,
          prepared.proofFileId
        );
        if (file.uploadedByUserId !== actorUserId) {
          throw new ForbiddenException(
            "只能使用本人上传且尚未绑定的票据异常证明"
          );
        }
        await this.assertConfirmationCoversRemaining(
          tx,
          context,
          procurementLine.id,
          prepared.amountCents,
          "票据异常"
        );
        await this.assertReserveCapacity(tx, context, {
          procurementLineId: procurementLine.id,
          invoiceLineId: invoiceLine?.id,
          paymentId: prepared.paymentId,
          amountCents: prepared.amountCents,
          invoiceLineLimitCents:
            invoiceLine?.taxInclusiveAmountCents
        });
        const confirmation =
          await tx.invoiceExceptionConfirmation.create({
            data: {
              projectId: context.procurement.projectId,
              receiptId: context.receipt.id,
              receiptRevisionNo:
                context.receipt.currentRevisionNo,
              procurementId,
              procurementVersionId: context.version.id,
              procurementLineId: procurementLine.id,
              paymentId: prepared.paymentId,
              invoiceLineId: invoiceLine?.id ?? null,
              expectedInvoiceType: procurementLine.invoiceType,
              expectedVatRateOptionId:
                procurementLine.vatRateOptionId,
              expectedVatRateValueSnapshot:
                procurementLine.vatRateValueSnapshot,
              expectedVatRateLabelSnapshot:
                procurementLine.vatRateLabelSnapshot,
              expectedUnitPriceSnapshot:
                procurementLine.unitPrice,
              amountCents: prepared.amountCents,
              reason: prepared.reason,
              proofFileId: prepared.proofFileId,
              submittedByUserId: actorUserId
            }
          });
        await this.audit.record(tx, {
          actorUserId,
          action: "spot_procurement.invoice_exception.submit",
          businessType: "invoice_exception_confirmation",
          businessId: confirmation.id,
          metadata: {
            projectId: context.procurement.projectId,
            procurementId,
            procurementLineId: procurementLine.id,
            paymentId: prepared.paymentId,
            invoiceLineId: invoiceLine?.id ?? null,
            amountCents: prepared.amountCents.toString()
          }
        });
        return this.confirmationReadModel(confirmation);
      })
    );
  }

  async reviewInvoiceException(
    procurementId: string,
    confirmationId: string,
    actorUserId: string,
    input: ReviewInvoiceExceptionConfirmationDto
  ) {
    return this.reviewConfirmation(
      "invoice_exception",
      procurementId,
      confirmationId,
      actorUserId,
      input
    );
  }

  async coverageForProcurementIds(
    procurementIds: readonly string[],
    client: PrismaService | Prisma.TransactionClient = this.prisma
  ) {
    const ids = [...new Set(procurementIds)].filter(Boolean);
    if (!ids.length) return new Map<string, ReturnType<typeof coverageReadModel>>();
    const procurements = await client.spotProcurement.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        currentVersionId: true,
        actualCostCents: true
      }
    });
    const coordinates = procurements.filter(
      (
        row
      ): row is typeof row & {
        currentVersionId: string;
      } => Boolean(row.currentVersionId)
    );
    const [receipts, allocations, noInvoices, exceptions] =
      await Promise.all([
        client.spotProcurementReceipt.findMany({
          where: {
            procurementId: { in: coordinates.map((row) => row.id) }
          },
          select: {
            procurementId: true,
            procurementVersionId: true,
            currentRevisionNo: true,
            actualCostCents: true,
            status: true
          }
        }),
        client.invoiceAllocation.findMany({
          where: {
            procurementId: { in: coordinates.map((row) => row.id) },
            invalidatedAt: null
          },
          select: {
            procurementId: true,
            procurementVersionId: true,
            receiptRevisionNo: true,
            amountCents: true,
            paymentId: true
          }
        }),
        client.noInvoiceConfirmation.findMany({
          where: {
            procurementId: { in: coordinates.map((row) => row.id) },
            status: { in: [...CURRENT_CONFIRMATION_STATUSES] }
          },
          select: {
            procurementId: true,
            procurementVersionId: true,
            receiptRevisionNo: true,
            status: true,
            amountCents: true,
            paymentId: true
          }
        }),
        client.invoiceExceptionConfirmation.findMany({
          where: {
            procurementId: { in: coordinates.map((row) => row.id) },
            status: { in: [...CURRENT_CONFIRMATION_STATUSES] }
          },
          select: {
            procurementId: true,
            procurementVersionId: true,
            receiptRevisionNo: true,
            status: true,
            amountCents: true,
            paymentId: true
          }
        })
      ]);
    const receiptByProcurementId = new Map(
      receipts.map((receipt) => [receipt.procurementId, receipt])
    );
    const result = new Map<
      string,
      ReturnType<typeof coverageReadModel>
    >();
    for (const procurement of procurements) {
      const receipt = receiptByProcurementId.get(procurement.id);
      if (
        !receipt ||
        !procurement.currentVersionId ||
        receipt.procurementVersionId !==
          procurement.currentVersionId ||
        !["reviewed", "locked"].includes(receipt.status)
      ) {
        result.set(
          procurement.id,
          coverageReadModel({
            available: false,
            actualCostCents:
              procurement.actualCostCents ?? 0n,
            normalInvoiceCents: 0n,
            confirmedNoInvoiceCents: 0n,
            confirmedExceptionCents: 0n,
            pendingCount: 0,
            inconsistent: false
          })
        );
        continue;
      }
      const sameCoordinates = (row: {
        procurementId: string;
        procurementVersionId: string;
        receiptRevisionNo: number;
      }) =>
        row.procurementId === procurement.id &&
        row.procurementVersionId ===
          procurement.currentVersionId &&
        row.receiptRevisionNo === receipt.currentRevisionNo;
      const currentAllocations = allocations.filter(sameCoordinates);
      const currentNoInvoices = noInvoices.filter(sameCoordinates);
      const currentExceptions = exceptions.filter(sameCoordinates);
      const inconsistent =
        procurement.actualCostCents !== receipt.actualCostCents ||
        allocations.some(
          (row) =>
            row.procurementId === procurement.id &&
            !sameCoordinates(row)
        ) ||
        noInvoices.some(
          (row) =>
            row.procurementId === procurement.id &&
            !sameCoordinates(row)
        ) ||
        exceptions.some(
          (row) =>
            row.procurementId === procurement.id &&
            !sameCoordinates(row)
        );
      result.set(
        procurement.id,
        coverageReadModel({
          available: true,
          actualCostCents: receipt.actualCostCents,
          normalInvoiceCents: sumBigInt(
            currentAllocations.map((row) => row.amountCents)
          ),
          confirmedNoInvoiceCents: sumBigInt(
            currentNoInvoices
              .filter((row) => row.status === "confirmed")
              .map((row) => row.amountCents)
          ),
          confirmedExceptionCents: sumBigInt(
            currentExceptions
              .filter((row) => row.status === "confirmed")
              .map((row) => row.amountCents)
          ),
          pendingCount:
            currentNoInvoices.filter(
              (row) => row.status === "pending_review"
            ).length +
            currentExceptions.filter(
              (row) => row.status === "pending_review"
            ).length,
          inconsistent
        })
      );
    }
    return result;
  }

  async coverageForPaymentIds(
    paymentIds: readonly string[],
    client: PrismaService | Prisma.TransactionClient = this.prisma
  ) {
    const ids = [...new Set(paymentIds)].filter(Boolean);
    if (!ids.length) return new Map<string, ReturnType<typeof paymentCoverageReadModel>>();
    const payments = await client.spotProcurementPayment.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        procurementId: true,
        procurementVersionId: true
      }
    });
    const procurementCoverage = await this.coverageForProcurementIds(
      payments.map((payment) => payment.procurementId),
      client
    );
    const [receipts, allocations, noInvoices, exceptions] =
      await Promise.all([
        client.spotProcurementReceipt.findMany({
          where: {
            procurementId: {
              in: payments.map((payment) => payment.procurementId)
            }
          },
          select: {
            id: true,
            procurementId: true,
            procurementVersionId: true,
            currentRevisionNo: true,
            status: true
          }
        }),
        client.invoiceAllocation.findMany({
          where: { paymentId: { in: ids }, invalidatedAt: null },
          select: {
            paymentId: true,
            procurementId: true,
            procurementVersionId: true,
            receiptId: true,
            receiptRevisionNo: true,
            amountCents: true
          }
        }),
        client.noInvoiceConfirmation.findMany({
          where: {
            paymentId: { in: ids },
            status: { in: [...CURRENT_CONFIRMATION_STATUSES] }
          },
          select: {
            paymentId: true,
            procurementId: true,
            procurementVersionId: true,
            receiptId: true,
            receiptRevisionNo: true,
            status: true,
            amountCents: true
          }
        }),
        client.invoiceExceptionConfirmation.findMany({
          where: {
            paymentId: { in: ids },
            status: { in: [...CURRENT_CONFIRMATION_STATUSES] }
          },
          select: {
            paymentId: true,
            procurementId: true,
            procurementVersionId: true,
            receiptId: true,
            receiptRevisionNo: true,
            status: true,
            amountCents: true
          }
        })
      ]);
    const receiptByProcurementId = new Map(
      receipts.map((receipt) => [receipt.procurementId, receipt])
    );
    return new Map(
      payments.map((payment) => {
        const base =
          procurementCoverage.get(payment.procurementId) ??
          coverageReadModel({
            available: false,
            actualCostCents: 0n,
            normalInvoiceCents: 0n,
            confirmedNoInvoiceCents: 0n,
            confirmedExceptionCents: 0n,
            pendingCount: 0,
            inconsistent: false
          });
        const receipt = receiptByProcurementId.get(
          payment.procurementId
        );
        const sameCoordinates = (row: {
          procurementId: string;
          procurementVersionId: string;
          receiptId: string;
          receiptRevisionNo: number;
        }) =>
          Boolean(receipt) &&
          ["reviewed", "locked"].includes(receipt?.status ?? "") &&
          row.procurementId === payment.procurementId &&
          row.procurementVersionId ===
            payment.procurementVersionId &&
          row.receiptId === receipt?.id &&
          row.receiptRevisionNo ===
            receipt?.currentRevisionNo &&
          receipt?.procurementVersionId ===
            payment.procurementVersionId;
        const paymentAllocations = allocations.filter(
          (row) => row.paymentId === payment.id
        );
        const paymentNoInvoices = noInvoices.filter(
          (row) => row.paymentId === payment.id
        );
        const paymentExceptions = exceptions.filter(
          (row) => row.paymentId === payment.id
        );
        const currentAllocations =
          paymentAllocations.filter(sameCoordinates);
        const currentNoInvoices =
          paymentNoInvoices.filter(sameCoordinates);
        const currentExceptions =
          paymentExceptions.filter(sameCoordinates);
        const inconsistent = [
          ...paymentAllocations,
          ...paymentNoInvoices,
          ...paymentExceptions
        ].some((row) => !sameCoordinates(row));
        return [
          payment.id,
          paymentCoverageReadModel(base, {
            normalInvoiceCents: sumBigInt(
              currentAllocations.map((row) => row.amountCents)
            ),
            confirmedNoInvoiceCents: sumBigInt(
              currentNoInvoices
                .filter(
                  (row) => row.status === "confirmed"
                )
                .map((row) => row.amountCents)
            ),
            confirmedExceptionCents: sumBigInt(
              currentExceptions
                .filter(
                  (row) => row.status === "confirmed"
                )
                .map((row) => row.amountCents)
            ),
            pendingCount:
              currentNoInvoices.filter(
                (row) => row.status === "pending_review"
              ).length +
              currentExceptions.filter(
                (row) => row.status === "pending_review"
              ).length,
            inconsistent
          })
        ] as const;
      })
    );
  }

  async detailForProcurement(
    procurementId: string,
    client: PrismaService | Prisma.TransactionClient = this.prisma
  ) {
    const procurement = await client.spotProcurement.findUnique({
      where: { id: procurementId },
      select: { id: true, currentVersionId: true }
    });
    if (!procurement?.currentVersionId) {
      return ticketLedgerDetailUnavailable();
    }
    const receipt = await client.spotProcurementReceipt.findUnique({
      where: { procurementId },
      select: {
        id: true,
        procurementVersionId: true,
        currentRevisionNo: true,
        status: true
      }
    });
    if (
      !receipt ||
      receipt.procurementVersionId !==
        procurement.currentVersionId ||
      !["reviewed", "locked"].includes(receipt.status)
    ) {
      return ticketLedgerDetailUnavailable();
    }
    const coordinates = {
      procurementId,
      procurementVersionId: procurement.currentVersionId,
      receiptId: receipt.id,
      receiptRevisionNo: receipt.currentRevisionNo
    };
    const [
      invoiceRecords,
      allocations,
      noInvoiceConfirmations,
      invoiceExceptions
    ] = await Promise.all([
      client.invoiceRecord.findMany({
        where: {
          sourceBusinessType: INVOICE_RECORD_SOURCE_BUSINESS_TYPE,
          sourceProcurementId: procurementId,
          status: "active"
        },
        select: {
          id: true,
          invoiceType: true,
          invoiceCode: true,
          invoiceNumber: true,
          externalIdentifier: true,
          issueDate: true,
          sellerName: true,
          buyerName: true,
          totalAmountCents: true,
          allocatableAmountCents: true,
          allocatedAmountCents: true,
          status: true,
          fileId: true,
          uploadedByUserId: true,
          createdAt: true
        },
        orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }, { id: "desc" }]
      }),
      client.invoiceAllocation.findMany({
        where: coordinates,
        select: {
          id: true,
          invoiceLineId: true,
          procurementLineId: true,
          paymentId: true,
          amountCents: true,
          createdByUserId: true,
          invalidatedAt: true,
          invalidatedByUserId: true,
          invalidationReason: true,
          createdAt: true
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }]
      }),
      client.noInvoiceConfirmation.findMany({
        where: coordinates,
        select: {
          id: true,
          procurementLineId: true,
          paymentId: true,
          amountCents: true,
          reason: true,
          proofFileId: true,
          status: true,
          submittedByUserId: true,
          submittedAt: true,
          reviewedByUserId: true,
          reviewedAt: true,
          reviewComment: true,
          reversedAt: true,
          reversedByUserId: true,
          reversalReason: true
        },
        orderBy: [{ submittedAt: "asc" }, { id: "asc" }]
      }),
      client.invoiceExceptionConfirmation.findMany({
        where: coordinates,
        select: {
          id: true,
          procurementLineId: true,
          paymentId: true,
          invoiceLineId: true,
          expectedInvoiceType: true,
          expectedVatRateOptionId: true,
          expectedVatRateValueSnapshot: true,
          expectedVatRateLabelSnapshot: true,
          expectedUnitPriceSnapshot: true,
          amountCents: true,
          reason: true,
          proofFileId: true,
          status: true,
          submittedByUserId: true,
          submittedAt: true,
          reviewedByUserId: true,
          reviewedAt: true,
          reviewComment: true,
          reversedAt: true,
          reversedByUserId: true,
          reversalReason: true
        },
        orderBy: [{ submittedAt: "asc" }, { id: "asc" }]
      })
    ]);
    const invoiceLines = invoiceRecords.length
      ? await client.invoiceLine.findMany({
          where: {
            invoiceRecordId: {
              in: invoiceRecords.map((record) => record.id)
            }
          },
          select: {
            id: true,
            invoiceRecordId: true,
            lineNo: true,
            description: true,
            vatRateOptionId: true,
            vatRateValueSnapshot: true,
            vatRateLabelSnapshot: true,
            taxInclusiveAmountCents: true,
            allocatedAmountCents: true
          },
          orderBy: [{ invoiceRecordId: "asc" }, { lineNo: "asc" }]
        })
      : [];
    const activeAllocationByInvoiceLineId = sumRowsByKey(
      allocations.filter(
        (allocation) => allocation.invalidatedAt === null
      ),
      (allocation) => allocation.invoiceLineId
    );
    const activeExceptionByInvoiceLineId = sumRowsByKey(
      invoiceExceptions.filter(
        (
          confirmation
        ): confirmation is typeof confirmation & {
          invoiceLineId: string;
        } =>
          Boolean(confirmation.invoiceLineId) &&
          CURRENT_CONFIRMATION_STATUSES.includes(
            confirmation.status as (typeof CURRENT_CONFIRMATION_STATUSES)[number]
          )
      ),
      (confirmation) => confirmation.invoiceLineId
    );
    const linesByRecordId = new Map<
      string,
      Array<{
        id: string;
        lineNo: number;
        description: string | null;
        vatRateOptionId: string;
        vatRateValue: string;
        vatRateLabel: string;
        taxInclusiveAmountCents: string;
        activeAllocatedAmountCents: string;
        activeExceptionReservedAmountCents: string;
        remainingAmountCents: string;
      }>
    >();
    for (const line of invoiceLines) {
      const activeAllocatedAmountCents =
        activeAllocationByInvoiceLineId.get(line.id) ?? 0n;
      const activeExceptionReservedAmountCents =
        activeExceptionByInvoiceLineId.get(line.id) ?? 0n;
      const reservedAmountCents =
        activeAllocatedAmountCents +
        activeExceptionReservedAmountCents;
      const current = linesByRecordId.get(line.invoiceRecordId) ?? [];
      current.push({
        id: line.id,
        lineNo: line.lineNo,
        description: line.description,
        vatRateOptionId: line.vatRateOptionId,
        vatRateValue: line.vatRateValueSnapshot.toString(),
        vatRateLabel: line.vatRateLabelSnapshot,
        taxInclusiveAmountCents:
          line.taxInclusiveAmountCents.toString(),
        activeAllocatedAmountCents:
          activeAllocatedAmountCents.toString(),
        activeExceptionReservedAmountCents:
          activeExceptionReservedAmountCents.toString(),
        remainingAmountCents: (
          line.taxInclusiveAmountCents > reservedAmountCents
            ? line.taxInclusiveAmountCents - reservedAmountCents
            : 0n
        ).toString()
      });
      linesByRecordId.set(line.invoiceRecordId, current);
    }
    const confirmationHistory = (confirmation: {
      id: string;
      procurementLineId: string;
      paymentId: string | null;
      amountCents: bigint;
      reason: string;
      proofFileId: string;
      status: string;
      submittedByUserId: string;
      submittedAt: Date;
      reviewedByUserId: string | null;
      reviewedAt: Date | null;
      reviewComment: string | null;
      reversedAt: Date | null;
      reversedByUserId: string | null;
      reversalReason: string | null;
    }) => ({
      id: confirmation.id,
      procurementLineId: confirmation.procurementLineId,
      paymentId: confirmation.paymentId,
      amountCents: confirmation.amountCents.toString(),
      reason: confirmation.reason,
      proofFileId: confirmation.proofFileId,
      status: confirmation.status,
      submittedByUserId: confirmation.submittedByUserId,
      submittedAt: confirmation.submittedAt.toISOString(),
      review: {
        reviewedByUserId: confirmation.reviewedByUserId,
        reviewedAt: isoText(confirmation.reviewedAt),
        comment: confirmation.reviewComment
      },
      reversal: {
        reversedByUserId: confirmation.reversedByUserId,
        reversedAt: isoText(confirmation.reversedAt),
        reason: confirmation.reversalReason
      }
    });

    return {
      available: true as const,
      currentCoordinates: coordinates,
      invoices: invoiceRecords.map((record) => ({
        id: record.id,
        invoiceType: record.invoiceType,
        invoiceCode: record.invoiceCode,
        invoiceNumber: record.invoiceNumber,
        externalIdentifier: record.externalIdentifier,
        issueDate: dateOnlyText(record.issueDate),
        sellerName: record.sellerName,
        buyerName: record.buyerName,
        totalAmountCents: record.totalAmountCents.toString(),
        allocatableAmountCents:
          record.allocatableAmountCents.toString(),
        allocatedAmountCents:
          record.allocatedAmountCents.toString(),
        status: record.status,
        fileId: record.fileId,
        uploadedByUserId: record.uploadedByUserId,
        createdAt: record.createdAt.toISOString(),
        lines: linesByRecordId.get(record.id) ?? []
      })),
      allocations: allocations.map((allocation) => ({
        id: allocation.id,
        invoiceLineId: allocation.invoiceLineId,
        procurementLineId: allocation.procurementLineId,
        paymentId: allocation.paymentId,
        amountCents: allocation.amountCents.toString(),
        status:
          allocation.invalidatedAt === null ? "active" : "reversed",
        createdByUserId: allocation.createdByUserId,
        createdAt: allocation.createdAt.toISOString(),
        reversal: {
          reversedByUserId: allocation.invalidatedByUserId,
          reversedAt: isoText(allocation.invalidatedAt),
          reason: allocation.invalidationReason
        }
      })),
      noInvoiceConfirmations: noInvoiceConfirmations.map(
        confirmationHistory
      ),
      invoiceExceptions: invoiceExceptions.map(
        (confirmation) => ({
          ...confirmationHistory(confirmation),
          invoiceLineId: confirmation.invoiceLineId,
          expectedInvoiceType: confirmation.expectedInvoiceType,
          expectedVatRateOptionId:
            confirmation.expectedVatRateOptionId,
          expectedVatRateValue:
            confirmation.expectedVatRateValueSnapshot.toString(),
          expectedVatRateLabel:
            confirmation.expectedVatRateLabelSnapshot,
          expectedUnitPrice:
            confirmation.expectedUnitPriceSnapshot.toString()
        })
      )
    };
  }

  async detailForPayment(
    paymentId: string,
    client: PrismaService | Prisma.TransactionClient = this.prisma
  ) {
    const payment = await client.spotProcurementPayment.findUnique({
      where: { id: paymentId },
      select: {
        id: true,
        procurementId: true,
        procurementVersionId: true,
        invalidatedAt: true
      }
    });
    if (!payment) {
      return {
        ...ticketLedgerDetailUnavailable(),
        paymentId,
        paymentCurrent: false
      };
    }
    const detail = await this.detailForProcurement(
      payment.procurementId,
      client
    );
    if (!detail.available) {
      return {
        ...detail,
        paymentId,
        paymentCurrent: false
      };
    }
    const allocations = detail.allocations.filter(
      (allocation) => allocation.paymentId === paymentId
    );
    const noInvoiceConfirmations =
      detail.noInvoiceConfirmations.filter(
        (confirmation) => confirmation.paymentId === paymentId
      );
    const invoiceExceptions = detail.invoiceExceptions.filter(
      (confirmation) => confirmation.paymentId === paymentId
    );
    const relatedInvoiceLineIds = new Set([
      ...allocations.map((allocation) => allocation.invoiceLineId),
      ...invoiceExceptions.flatMap((confirmation) =>
        confirmation.invoiceLineId
          ? [confirmation.invoiceLineId]
          : []
      )
    ]);

    return {
      ...detail,
      paymentId,
      paymentCurrent:
        payment.invalidatedAt === null &&
        payment.procurementVersionId ===
          detail.currentCoordinates?.procurementVersionId,
      invoices: detail.invoices.filter((invoice) =>
        invoice.lines.some((line) =>
          relatedInvoiceLineIds.has(line.id)
        )
      ),
      allocations,
      noInvoiceConfirmations,
      invoiceExceptions
    };
  }

  private async reviewConfirmation(
    kind: "no_invoice" | "invoice_exception",
    procurementId: string,
    confirmationIdInput: string,
    actorUserId: string,
    input: ConfirmationReviewInput
  ) {
    const confirmationId = requiredId(
      confirmationIdInput,
      "请选择需要复核的票据确认"
    );
    const operation = input.operation;
    if (!["confirm", "return", "reverse"].includes(operation)) {
      throw new BadRequestException("票据复核操作不正确");
    }
    const comment = optionalText(input.comment, MAX_TEXT_LENGTH);
    if (
      (operation === "return" || operation === "reverse") &&
      !comment
    ) {
      throw new BadRequestException(
        operation === "return"
          ? "退回票据确认必须填写原因"
          : "冲销票据确认必须填写原因"
      );
    }
    if (operation === "reverse" && input.confirmReversal !== true) {
      throw new BadRequestException("请明确确认冲销本次票据确认");
    }

    return this.runWrite(() =>
      this.runSerializable(async (tx) => {
        const context = await this.lockCurrentContext(tx, procurementId);
        this.pilot.assertEnabled(context.procurement.projectId);
        this.assertLegacyInvoiceLedgerMutationAllowed(context);
        await this.requireFinanceDirector(
          tx,
          actorUserId,
          context.procurement.projectId
        );
        const rows =
          kind === "no_invoice"
            ? await tx.$queryRaw<
                Array<{
                  id: string;
                  projectId: string;
                  receiptId: string;
                  receiptRevisionNo: number;
                  procurementId: string;
                  procurementVersionId: string;
                  procurementLineId: string;
                  paymentId: string | null;
                  amountCents: bigint;
                  status: string;
                  reviewedByUserId: string | null;
                  reviewedAt: Date | null;
                  reviewComment: string | null;
                  reversedAt: Date | null;
                  reversedByUserId: string | null;
                  reversalReason: string | null;
                }>
              >(Prisma.sql`
                SELECT *
                FROM "NoInvoiceConfirmation"
                WHERE "id" = ${confirmationId}
                FOR UPDATE
              `)
            : await tx.$queryRaw<
                Array<{
                  id: string;
                  projectId: string;
                  receiptId: string;
                  receiptRevisionNo: number;
                  procurementId: string;
                  procurementVersionId: string;
                  procurementLineId: string;
                  paymentId: string | null;
                  amountCents: bigint;
                  status: string;
                  reviewedByUserId: string | null;
                  reviewedAt: Date | null;
                  reviewComment: string | null;
                  reversedAt: Date | null;
                  reversedByUserId: string | null;
                  reversalReason: string | null;
                }>
              >(Prisma.sql`
                SELECT *
                FROM "InvoiceExceptionConfirmation"
                WHERE "id" = ${confirmationId}
                FOR UPDATE
              `);
        const confirmation = rows[0];
        if (!confirmation || confirmation.procurementId !== procurementId) {
          throw new NotFoundException("票据确认不存在");
        }
        this.assertCurrentCoordinates(context, confirmation);
        if (
          (operation === "confirm" &&
            confirmation.status === "confirmed") ||
          (operation === "return" &&
            confirmation.status === "returned") ||
          (operation === "reverse" &&
            confirmation.status === "reversed")
        ) {
          const sameActor =
            operation === "reverse"
              ? confirmation.reversedByUserId === actorUserId
              : confirmation.reviewedByUserId === actorUserId;
          const sameComment =
            operation === "confirm"
              ? confirmation.reviewComment === comment
              : operation === "return"
                ? confirmation.reviewComment === comment
                : confirmation.reversalReason === comment;
          const effectiveAt =
            operation === "reverse"
              ? confirmation.reversedAt
              : confirmation.reviewedAt;
          if (sameActor && sameComment && effectiveAt) {
            return {
              confirmationId: confirmation.id,
              status: confirmation.status,
              operation,
              reviewedByUserId: actorUserId,
              reviewedAt: effectiveAt.toISOString(),
              comment
            };
          }
        }
        if (
          operation !== "reverse" &&
          confirmation.status !== "pending_review"
        ) {
          throw new ConflictException(
            "当前票据确认已完成复核，不能重复处理"
          );
        }
        if (
          operation === "reverse" &&
          confirmation.status !== "confirmed"
        ) {
          throw new ConflictException(
            "只有已确认票据事实可以冲销"
          );
        }

        const now = new Date();
        const data =
          operation === "confirm"
            ? {
                status: "confirmed",
                reviewedByUserId: actorUserId,
                reviewedAt: now,
                reviewComment: comment
              }
            : operation === "return"
              ? {
                  status: "returned",
                  reviewedByUserId: actorUserId,
                  reviewedAt: now,
                  reviewComment: comment
                }
              : {
                  status: "reversed",
                  reversedAt: now,
                  reversedByUserId: actorUserId,
                  reversalReason: comment
                };
        const updateWhere = {
          id: confirmation.id,
          status: confirmation.status
        };
        const updated =
          kind === "no_invoice"
            ? await tx.noInvoiceConfirmation.updateMany({
                where: updateWhere,
                data
              })
            : await tx.invoiceExceptionConfirmation.updateMany({
                where: updateWhere,
                data
              });
        if (updated.count !== 1) {
          throw new ConflictException(
            "票据确认状态已变化，请刷新后重试"
          );
        }
        await this.audit.record(tx, {
          actorUserId,
          action: `spot_procurement.${
            kind === "no_invoice"
              ? "no_invoice"
              : "invoice_exception"
          }.${operation}`,
          businessType:
            kind === "no_invoice"
              ? "no_invoice_confirmation"
              : "invoice_exception_confirmation",
          businessId: confirmation.id,
          metadata: {
            projectId: context.procurement.projectId,
            procurementId,
            procurementLineId: confirmation.procurementLineId,
            paymentId: confirmation.paymentId,
            amountCents: confirmation.amountCents.toString(),
            comment,
            explicitConfirmation:
              operation === "reverse" ? true : undefined
          }
        });
        await this.closure.recalculateAndClose(
          tx,
          procurementId,
          `ticket.${kind}.${operation}`,
          actorUserId
        );
        return {
          confirmationId: confirmation.id,
          status:
            operation === "confirm"
              ? "confirmed"
              : operation === "return"
                ? "returned"
                : "reversed",
          operation,
          reviewedByUserId: actorUserId,
          reviewedAt: now.toISOString(),
          comment
        };
      })
    );
  }

  private async lockCurrentContext(
    tx: Prisma.TransactionClient,
    procurementIdInput: string
  ): Promise<LockedContext> {
    const procurementId = requiredId(
      procurementIdInput,
      "请选择零星采购"
    );
    const procurements = await tx.$queryRaw<ProcurementLockRow[]>(
      Prisma.sql`
        SELECT
          "id",
          "projectId",
          "code",
          "handlerUserId",
          "currentVersionId",
          "status",
          "actualCostCents"
        FROM "SpotProcurement"
        WHERE "id" = ${procurementId}
        FOR UPDATE
      `
    );
    const procurement = procurements[0];
    if (!procurement) {
      throw new NotFoundException("零星采购不存在");
    }
    if (
      procurement.status !== "approved_in_progress" ||
      !procurement.currentVersionId
    ) {
      throw new ConflictException(
        procurement.status === "closed"
          ? "零星采购已办结，不能更正票据"
          : "零星采购当前状态不能登记或更正票据"
      );
    }

    const versions = await tx.$queryRaw<VersionLockRow[]>(
      Prisma.sql`
        SELECT
          "id",
          "procurementId",
          "status",
          "handlerUserId"
        FROM "SpotProcurementVersion"
        WHERE "id" = ${procurement.currentVersionId}
        FOR UPDATE
      `
    );
    const version = versions[0];
    if (
      !version ||
      version.procurementId !== procurement.id ||
      version.status !== "approved"
    ) {
      throw new ConflictException(
        "零星采购当前有效版本不存在或已失效"
      );
    }

    const receipts = await tx.$queryRaw<ReceiptLockRow[]>(
      Prisma.sql`
        SELECT
          "id",
          "projectId",
          "procurementId",
          "procurementVersionId",
          "status",
          "currentRevisionNo",
          "actualCostCents"
        FROM "SpotProcurementReceipt"
        WHERE "procurementId" = ${procurement.id}
        FOR UPDATE
      `
    );
    const receipt = receipts[0];
    if (
      !receipt ||
      receipt.projectId !== procurement.projectId ||
      receipt.procurementVersionId !== version.id ||
      receipt.status !== "reviewed"
    ) {
      throw new ConflictException(
        "最终收货尚未通过当前有效复核，不能登记票据"
      );
    }
    const revisions = await tx.$queryRaw<ReceiptRevisionLockRow[]>(
      Prisma.sql`
        SELECT
          "id",
          "receiptId",
          "revisionNo",
          "procurementId",
          "procurementVersionId",
          "actualCostCents"
        FROM "SpotProcurementReceiptRevision"
        WHERE "receiptId" = ${receipt.id}
          AND "revisionNo" = ${receipt.currentRevisionNo}
        FOR UPDATE
      `
    );
    const revision = revisions[0];
    if (
      !revision ||
      revision.procurementId !== procurement.id ||
      revision.procurementVersionId !== version.id ||
      revision.actualCostCents !== receipt.actualCostCents
    ) {
      throw new ConflictException(
        "当前收货修订坐标或金额不一致，请联系管理员核对"
      );
    }
    const reviews = await tx.$queryRaw<ReceiptReviewLockRow[]>(
      Prisma.sql`
        SELECT
          "id",
          "receiptId",
          "receiptRevisionNo",
          "procurementId",
          "procurementVersionId",
          "sequenceNo",
          "decision"
        FROM "SpotProcurementReceiptReview"
        WHERE "receiptId" = ${receipt.id}
        ORDER BY "sequenceNo" DESC, "id" DESC
        LIMIT 1
        FOR UPDATE
      `
    );
    const review = reviews[0];
    if (
      !review ||
      review.decision !== "approved" ||
      review.receiptRevisionNo !== receipt.currentRevisionNo ||
      review.procurementId !== procurement.id ||
      review.procurementVersionId !== version.id
    ) {
      throw new ConflictException(
        "当前收货缺少有效物资主管复核"
      );
    }

    const procurementLines =
      await tx.$queryRaw<ProcurementLineLockRow[]>(Prisma.sql`
        SELECT
          "id",
          "versionId",
          "invoiceMode",
          "invoiceType",
          "vatRateOptionId",
          "vatRateValueSnapshot",
          "vatRateLabelSnapshot",
          "unitPrice"
        FROM "SpotProcurementLine"
        WHERE "versionId" = ${version.id}
        ORDER BY "id"
        FOR UPDATE
      `);
    const receiptLines =
      await tx.$queryRaw<ReceiptLineLockRow[]>(Prisma.sql`
        SELECT
          "id",
          "receiptId",
          "receiptRevisionNo",
          "procurementId",
          "procurementVersionId",
          "procurementLineId",
          "actualCostCents"
        FROM "SpotProcurementReceiptLine"
        WHERE "receiptId" = ${receipt.id}
          AND "receiptRevisionNo" = ${receipt.currentRevisionNo}
        ORDER BY "procurementLineId", "id"
        FOR UPDATE
      `);
    if (
      procurementLines.length !== receiptLines.length ||
      receiptLines.some(
        (line) =>
          line.procurementId !== procurement.id ||
          line.procurementVersionId !== version.id
      )
    ) {
      throw new ConflictException(
        "当前收货明细与采购版本不一致，请联系管理员核对"
      );
    }
    const actualCostCents = sumBigInt(
      receiptLines.map((line) => line.actualCostCents)
    );
    if (
      actualCostCents !== receipt.actualCostCents ||
      procurement.actualCostCents !== actualCostCents
    ) {
      throw new ConflictException(
        "零星采购实际成本与收货明细不一致，请联系管理员核对"
      );
    }

    const payments = await tx.$queryRaw<PaymentLockRow[]>(
      Prisma.sql`
        SELECT
          "id",
          "projectId",
          "procurementId",
          "procurementVersionId",
          "paymentType",
          "invalidatedAt"
        FROM "SpotProcurementPayment"
        WHERE "procurementId" = ${procurement.id}
        ORDER BY "id"
        FOR UPDATE
      `
    );
    const paymentIds = payments
      .filter(
        (payment) =>
          payment.procurementVersionId === version.id &&
          !payment.invalidatedAt
      )
      .map((payment) => payment.id);
    const executions = paymentIds.length
      ? await tx.$queryRaw<PaymentExecutionRow[]>(Prisma.sql`
          SELECT "paymentId", "amountCents"
          FROM "SpotProcurementPaymentExecution"
          WHERE "paymentId" IN (${Prisma.join(paymentIds)})
            AND "voidedAt" IS NULL
          ORDER BY "paymentId", "id"
          FOR UPDATE
        `)
      : [];
    const balances = paymentIds.length
      ? await tx.$queryRaw<ExecutedBalanceRow[]>(Prisma.sql`
          SELECT
            "paymentId",
            "amountCents",
            "releasedAmountCents"
          FROM "SupplierBalanceReservation"
          WHERE "paymentId" IN (${Prisma.join(paymentIds)})
            AND "status" = 'executed'
          ORDER BY "paymentId", "id"
          FOR UPDATE
        `)
      : [];
    const settledByPaymentId = new Map<string, bigint>();
    for (const execution of executions) {
      settledByPaymentId.set(
        execution.paymentId,
        (settledByPaymentId.get(execution.paymentId) ?? 0n) +
          execution.amountCents
      );
    }
    for (const balance of balances) {
      const effective =
        balance.amountCents - balance.releasedAmountCents;
      if (effective < 0n) {
        throw new ConflictException(
          "供应商余额执行事实不一致，请联系管理员核对"
        );
      }
      settledByPaymentId.set(
        balance.paymentId,
        (settledByPaymentId.get(balance.paymentId) ?? 0n) +
          effective
      );
    }

    return {
      procurement,
      version,
      receipt,
      revision,
      review,
      procurementLines,
      receiptLines,
      payments,
      settledByPaymentId,
      settledAmountCents: sumBigInt([
        ...settledByPaymentId.values()
      ])
    };
  }

  private assertLegacyInvoiceLedgerMutationAllowed(context: LockedContext) {
    if (context.payments.some((payment) => payment.paymentType !== null)) {
      throw new ConflictException(
        "零星采购真实表单不支持结构化票据、无票确认或票据异常，请改为追加付款级发票附件"
      );
    }
  }

  private prepareInvoiceHeader(
    input: CreateProcurementInvoiceDto | CreateGlobalInvoiceDto
  ): InvoiceHeaderFacts {
    const owningCompanyEntityId = requiredId(
      input.owningCompanyEntityId,
      "请选择发票归属的我方公司主体"
    );
    if (input.direction !== "inbound" && input.direction !== "outbound") {
      throw new BadRequestException("发票方向只能为进项或销项");
    }
    const sellerTaxId = requiredText(input.sellerTaxId, "销售方税号", 64);
    const buyerTaxId = requiredText(input.buyerTaxId, "购买方税号", 64);
    if (
      !VAT_INVOICE_TYPES.includes(
        input.invoiceType as VatInvoiceType
      )
    ) {
      throw new BadRequestException(
        "发票类型只能为增值税普通发票或专用发票"
      );
    }
    const invoiceCode = optionalIdentityText(
      input.invoiceCode,
      "发票代码",
      100
    );
    const invoiceNumber = optionalIdentityText(
      input.invoiceNumber,
      "发票号码",
      100
    );
    const externalIdentifier = optionalIdentityText(
      input.externalIdentifier,
      "可识别票据编号",
      200
    );
    const identityKind = this.resolveInvoiceIdentityKind(
      input.invoiceIdentityKind,
      invoiceCode,
      invoiceNumber,
      externalIdentifier
    );
    const identityPreimage = JSON.stringify(
      identityKind === "digital"
        ? ["invoice", 1, "digital", invoiceNumber]
        : identityKind === "traditional"
          ? ["invoice", 1, "code-number", invoiceCode, invoiceNumber]
          : ["invoice", 1, "external", externalIdentifier]
    );
    const totalAmountCents = positiveMoney(
      input.totalAmountCents,
      "发票价税合计金额"
    );
    const taxExclusiveAmountCents = nonNegativeMoney(
      input.taxExclusiveAmountCents,
      "发票不含税金额"
    );
    const taxAmountCents = nonNegativeMoney(input.taxAmountCents, "发票税额");
    if (taxExclusiveAmountCents + taxAmountCents !== totalAmountCents) {
      throw new BadRequestException("发票不含税金额与税额之和必须等于价税合计金额");
    }
    return {
      identityKey: createHash("sha256")
        .update(identityPreimage, "utf8")
        .digest("hex"),
      identityKind,
      owningCompanyEntityId,
      direction: input.direction,
      invoiceType: input.invoiceType as VatInvoiceType,
      invoiceCode,
      invoiceNumber,
      externalIdentifier,
      issueDate: strictDateOnly(input.issueDate, "开票日期"),
      sellerName: requiredText(
        input.sellerName,
        "销售方名称",
        200
      ),
      sellerTaxId,
      buyerName: requiredText(
        input.buyerName,
        "购买方名称",
        200
      ),
      buyerTaxId,
      taxExclusiveAmountCents,
      taxAmountCents,
      totalAmountCents,
      fileId: requiredId(input.fileId, "请选择发票文件")
    };
  }

  private resolveInvoiceIdentityKind(
    requestedKind: CreateProcurementInvoiceDto["invoiceIdentityKind"],
    invoiceCode: string | null,
    invoiceNumber: string | null,
    externalIdentifier: string | null
  ): InvoiceIdentityKind {
    const inferredKind: InvoiceIdentityKind | null =
      invoiceCode && invoiceNumber
        ? "traditional"
        : externalIdentifier
          ? "other"
          : null;
    const kind = requestedKind ?? inferredKind;
    if (!kind) {
      if (invoiceCode || invoiceNumber) {
        throw new BadRequestException(
          "发票代码和号码必须同时填写；否则请填写可识别票据编号"
        );
      }
      throw new BadRequestException(
        "请填写发票代码和号码、20 位数电票号码或可识别票据编号"
      );
    }
    if (kind === "digital") {
      if (
        invoiceCode ||
        externalIdentifier ||
        !invoiceNumber ||
        !/^\d{20}$/u.test(invoiceNumber)
      ) {
        throw new BadRequestException(
          "数电票必须填写 20 位发票号码，且不能同时填写代码或其他凭证编号"
        );
      }
      return kind;
    }
    if (kind === "traditional") {
      if (!invoiceCode || !invoiceNumber || externalIdentifier) {
        throw new BadRequestException(
          "传统发票必须同时填写发票代码和号码，且不能填写其他凭证编号"
        );
      }
      return kind;
    }
    if (invoiceCode || invoiceNumber || !externalIdentifier) {
      throw new BadRequestException(
        "其他受控凭证只能填写可识别票据编号"
      );
    }
    return kind;
  }

  private async prepareInvoiceLines(
    tx: Prisma.TransactionClient,
    inputLines: ProcurementInvoiceLineDto[],
    totalAmountCents: bigint
  ): Promise<PreparedInvoiceLine[]> {
    if (!Array.isArray(inputLines) || inputLines.length === 0) {
      throw new BadRequestException("发票至少需要一条明细");
    }
    const vatOptionIds = [
      ...new Set(
        inputLines.map((line) =>
          requiredId(line.vatRateOptionId, "请选择实际税率")
        )
      )
    ];
    const options = await tx.vatRateOption.findMany({
      where: { id: { in: vatOptionIds } }
    });
    const optionById = new Map(
      options.map((option) => [option.id, option])
    );
    if (optionById.size !== vatOptionIds.length) {
      throw new BadRequestException("发票明细包含不存在的税率选项");
    }

    const prepared = inputLines.map((line, index) => {
      const vatRateOptionId = requiredId(
        line.vatRateOptionId,
        "请选择实际税率"
      );
      const option = optionById.get(vatRateOptionId)!;
      const allocations = Array.isArray(line.allocations)
        ? line.allocations.map((allocation) =>
            this.prepareInvoiceAllocation(allocation)
          )
        : [];
      const duplicateTargets = new Set<string>();
      for (const allocation of allocations) {
        const key = `${allocation.procurementLineId}\u001f${
          allocation.paymentId ?? ""
        }`;
        if (duplicateTargets.has(key)) {
          throw new BadRequestException(
            "同一发票明细不能重复填写相同采购行和付款归属"
          );
        }
        duplicateTargets.add(key);
      }
      return {
        lineNo: index + 1,
        description: optionalText(line.description, 500),
        vatRateOptionId,
        vatRateValueSnapshot: option.rateValue,
        vatRateLabelSnapshot: option.label,
        taxInclusiveAmountCents: positiveMoney(
          line.taxInclusiveAmountCents,
          `第 ${index + 1} 条发票明细价税合计`
        ),
        allocations
      };
    });
    if (
      sumBigInt(
        prepared.map((line) => line.taxInclusiveAmountCents)
      ) !== totalAmountCents
    ) {
      throw new BadRequestException(
        "发票各明细价税合计必须等于发票总金额"
      );
    }
    if (
      prepared.every((line) => line.allocations.length === 0)
    ) {
      throw new BadRequestException(
        "本次至少填写一条发票分摊"
      );
    }
    for (const line of prepared) {
      if (
        sumBigInt(line.allocations.map((row) => row.amountCents)) >
        line.taxInclusiveAmountCents
      ) {
        throw new BadRequestException(
          `第 ${line.lineNo} 条发票明细分摊金额超过价税合计`
        );
      }
    }
    return prepared;
  }

  private prepareInvoiceAllocation(
    allocation: ProcurementInvoiceAllocationDto
  ): PreparedInvoiceAllocation {
    return {
      procurementLineId: requiredId(
        allocation.procurementLineId,
        "请选择采购明细"
      ),
      paymentId: optionalId(allocation.paymentId),
      amountCents: positiveMoney(
        allocation.amountCents,
        "发票分摊金额"
      )
    };
  }

  private prepareConfirmationInput(input: {
    procurementLineId: string;
    paymentId?: string;
    amountCents: string;
    reason: string;
    proofFileId: string;
  }) {
    return {
      procurementLineId: requiredId(
        input.procurementLineId,
        "请选择采购明细"
      ),
      paymentId: optionalId(input.paymentId),
      amountCents: positiveMoney(
        input.amountCents,
        "票据确认金额"
      ),
      reason: requiredText(
        input.reason,
        "票据确认原因",
        MAX_TEXT_LENGTH
      ),
      proofFileId: requiredId(
        input.proofFileId,
        "请上传替代证明"
      )
    };
  }

  private async lockInvoiceByIdentity(
    tx: Prisma.TransactionClient,
    identityKey: string
  ): Promise<InvoiceRecordWithLines | null> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`
        SELECT "id"
        FROM "InvoiceRecord"
        WHERE "identityKey" = ${identityKey}
        FOR UPDATE
      `
    );
    if (!rows[0]) return null;
    const record = await tx.invoiceRecord.findUnique({
      where: { id: rows[0].id }
    });
    if (!record) return null;
    return {
      ...record,
      lines: await tx.invoiceLine.findMany({
        where: { invoiceRecordId: record.id },
        orderBy: [{ lineNo: "asc" }, { id: "asc" }]
      })
    };
  }

  private async createInvoiceRecord(
    tx: Prisma.TransactionClient,
    context: LockedContext,
    actorUserId: string,
    header: InvoiceHeaderFacts,
    lines: PreparedInvoiceLine[]
  ): Promise<InvoiceRecordWithLines> {
    const record = await tx.invoiceRecord.create({
      data: {
        projectId: context.procurement.projectId,
        identityKey: header.identityKey,
        identityKind: header.identityKind,
        owningCompanyEntityId: header.owningCompanyEntityId,
        direction: header.direction,
        invoiceType: header.invoiceType,
        invoiceCode: header.invoiceCode,
        invoiceNumber: header.invoiceNumber,
        externalIdentifier: header.externalIdentifier,
        issueDate: header.issueDate,
        sellerName: header.sellerName,
        sellerTaxId: header.sellerTaxId,
        buyerName: header.buyerName,
        buyerTaxId: header.buyerTaxId,
        taxExclusiveAmountCents: header.taxExclusiveAmountCents,
        taxAmountCents: header.taxAmountCents,
        totalAmountCents: header.totalAmountCents,
        allocatableAmountCents: header.totalAmountCents,
        fileId: header.fileId,
        uploadedByUserId: actorUserId,
        sourceBusinessType:
          INVOICE_RECORD_SOURCE_BUSINESS_TYPE,
        sourceBusinessId: context.procurement.id,
        sourceProcurementId: context.procurement.id
      }
    });
    const createdLines = [];
    for (const line of lines) {
      createdLines.push(
        await tx.invoiceLine.create({
          data: {
            projectId: context.procurement.projectId,
            invoiceRecordId: record.id,
            lineNo: line.lineNo,
            description: line.description,
            vatRateOptionId: line.vatRateOptionId,
            vatRateValueSnapshot:
              line.vatRateValueSnapshot,
            vatRateLabelSnapshot:
              line.vatRateLabelSnapshot,
            taxInclusiveAmountCents:
              line.taxInclusiveAmountCents
          }
        })
      );
    }
    return { ...record, lines: createdLines };
  }

  private assertSameInvoiceFacts(
    invoice: InvoiceRecordWithLines,
    header: InvoiceHeaderFacts,
    lines: PreparedInvoiceLine[],
    context: LockedContext
  ) {
    if (
      invoice.projectId !== context.procurement.projectId ||
      invoice.sourceBusinessType !==
        INVOICE_RECORD_SOURCE_BUSINESS_TYPE ||
      invoice.sourceBusinessId !== context.procurement.id ||
      invoice.sourceProcurementId !== context.procurement.id ||
      invoice.status !== "active" ||
      invoice.invoiceType !== header.invoiceType ||
      invoice.identityKind !== header.identityKind ||
      invoice.owningCompanyEntityId !== header.owningCompanyEntityId ||
      invoice.direction !== header.direction ||
      invoice.invoiceCode !== header.invoiceCode ||
      invoice.invoiceNumber !== header.invoiceNumber ||
      invoice.externalIdentifier !== header.externalIdentifier ||
      invoice.issueDate.getTime() !== header.issueDate.getTime() ||
      invoice.sellerName !== header.sellerName ||
      invoice.sellerTaxId !== header.sellerTaxId ||
      invoice.buyerName !== header.buyerName ||
      invoice.buyerTaxId !== header.buyerTaxId ||
      invoice.taxExclusiveAmountCents !== header.taxExclusiveAmountCents ||
      invoice.taxAmountCents !== header.taxAmountCents ||
      invoice.totalAmountCents !== header.totalAmountCents ||
      invoice.allocatableAmountCents !== header.totalAmountCents ||
      invoice.fileId !== header.fileId ||
      invoice.lines.length !== lines.length
    ) {
      throw new ConflictException(
        "该发票身份已用于不同的发票事实"
      );
    }
    for (const line of lines) {
      const existing = invoice.lines.find(
        (candidate) => candidate.lineNo === line.lineNo
      );
      if (
        !existing ||
        existing.description !== line.description ||
        existing.vatRateOptionId !== line.vatRateOptionId ||
        !existing.vatRateValueSnapshot.equals(
          line.vatRateValueSnapshot
        ) ||
        existing.vatRateLabelSnapshot !==
          line.vatRateLabelSnapshot ||
        existing.taxInclusiveAmountCents !==
          line.taxInclusiveAmountCents
      ) {
        throw new ConflictException(
          "该发票身份已用于不同的发票明细"
        );
      }
    }
  }

  private async assertReserveCapacity(
    tx: Prisma.TransactionClient,
    context: LockedContext,
    input: {
      procurementLineId: string;
      invoiceLineId?: string;
      paymentId: string | null;
      amountCents: bigint;
      invoiceLineLimitCents?: bigint;
    }
  ) {
    const receiptLine = context.receiptLines.find(
      (line) =>
        line.procurementLineId === input.procurementLineId
    );
    if (!receiptLine) {
      throw new BadRequestException(
        "票据确认只能选择当前有效收货明细"
      );
    }
    const reserve = await this.currentLineReserve(
      tx,
      context,
      input.procurementLineId
    );
    if (
      reserve.normalInvoiceCents +
        reserve.pendingNoInvoiceCents +
        reserve.confirmedNoInvoiceCents +
        reserve.pendingExceptionCents +
        reserve.confirmedExceptionCents +
        input.amountCents >
      receiptLine.actualCostCents
    ) {
      throw new ConflictException(
        "票据金额超过该采购明细的当前实际成本"
      );
    }
    if (input.paymentId) {
      const settled =
        context.settledByPaymentId.get(input.paymentId) ?? 0n;
      const paymentReserved =
        await this.currentPaymentReservedAmount(
          tx,
          context,
          input.paymentId
        );
      if (paymentReserved + input.amountCents > settled) {
        throw new ConflictException(
          "票据金额超过所选付款单的实际结算金额"
        );
      }
    }
    if (input.invoiceLineId) {
      if (input.invoiceLineLimitCents === undefined) {
        throw new ConflictException(
          "发票明细上限不存在，请联系管理员核对"
        );
      }
      const invoiceLineReserved =
        await this.currentInvoiceLineReservedAmount(
          tx,
          input.invoiceLineId
        );
      if (
        invoiceLineReserved + input.amountCents >
        input.invoiceLineLimitCents
      ) {
        throw new ConflictException(
          "累计分摊或异常金额超过发票明细价税合计"
        );
      }
    }
  }

  private async assertConfirmationCoversRemaining(
    tx: Prisma.TransactionClient,
    context: LockedContext,
    procurementLineId: string,
    amountCents: bigint,
    label: string
  ) {
    const receiptLine = context.receiptLines.find(
      (line) => line.procurementLineId === procurementLineId
    );
    if (!receiptLine) {
      throw new BadRequestException(
        "票据确认只能选择当前有效收货明细"
      );
    }
    const reserve = await this.currentLineReserve(
      tx,
      context,
      procurementLineId
    );
    const occupied =
      reserve.normalInvoiceCents +
      reserve.pendingNoInvoiceCents +
      reserve.confirmedNoInvoiceCents +
      reserve.pendingExceptionCents +
      reserve.confirmedExceptionCents;
    const remaining =
      receiptLine.actualCostCents > occupied
        ? receiptLine.actualCostCents - occupied
        : 0n;
    if (amountCents !== remaining || remaining <= 0n) {
      throw new ConflictException(
        `${label}金额必须一次覆盖该采购明细当前剩余的 ${remaining.toString()} 分`
      );
    }
  }

  private async currentLineReserve(
    tx: Prisma.TransactionClient,
    context: LockedContext,
    procurementLineId: string
  ): Promise<CoverageReserve> {
    const [allocations, noInvoices, exceptions] = await Promise.all([
      tx.invoiceAllocation.findMany({
        where: {
          procurementId: context.procurement.id,
          procurementVersionId: context.version.id,
          receiptId: context.receipt.id,
          receiptRevisionNo: context.receipt.currentRevisionNo,
          procurementLineId,
          invalidatedAt: null
        },
        select: { amountCents: true }
      }),
      tx.noInvoiceConfirmation.findMany({
        where: {
          procurementId: context.procurement.id,
          procurementVersionId: context.version.id,
          receiptId: context.receipt.id,
          receiptRevisionNo: context.receipt.currentRevisionNo,
          procurementLineId,
          status: { in: [...CURRENT_CONFIRMATION_STATUSES] }
        },
        select: { status: true, amountCents: true }
      }),
      tx.invoiceExceptionConfirmation.findMany({
        where: {
          procurementId: context.procurement.id,
          procurementVersionId: context.version.id,
          receiptId: context.receipt.id,
          receiptRevisionNo: context.receipt.currentRevisionNo,
          procurementLineId,
          status: { in: [...CURRENT_CONFIRMATION_STATUSES] }
        },
        select: { status: true, amountCents: true }
      })
    ]);
    return {
      normalInvoiceCents: sumBigInt(
        allocations.map((row) => row.amountCents)
      ),
      pendingNoInvoiceCents: sumBigInt(
        noInvoices
          .filter((row) => row.status === "pending_review")
          .map((row) => row.amountCents)
      ),
      confirmedNoInvoiceCents: sumBigInt(
        noInvoices
          .filter((row) => row.status === "confirmed")
          .map((row) => row.amountCents)
      ),
      pendingExceptionCents: sumBigInt(
        exceptions
          .filter((row) => row.status === "pending_review")
          .map((row) => row.amountCents)
      ),
      confirmedExceptionCents: sumBigInt(
        exceptions
          .filter((row) => row.status === "confirmed")
          .map((row) => row.amountCents)
      )
    };
  }

  private async currentPaymentReservedAmount(
    tx: Prisma.TransactionClient,
    context: LockedContext,
    paymentId: string
  ) {
    const where = {
      procurementId: context.procurement.id,
      procurementVersionId: context.version.id,
      receiptId: context.receipt.id,
      receiptRevisionNo: context.receipt.currentRevisionNo,
      paymentId
    };
    const [allocations, noInvoices, exceptions] = await Promise.all([
      tx.invoiceAllocation.findMany({
        where: { ...where, invalidatedAt: null },
        select: { amountCents: true }
      }),
      tx.noInvoiceConfirmation.findMany({
        where: {
          ...where,
          status: { in: [...CURRENT_CONFIRMATION_STATUSES] }
        },
        select: { amountCents: true }
      }),
      tx.invoiceExceptionConfirmation.findMany({
        where: {
          ...where,
          status: { in: [...CURRENT_CONFIRMATION_STATUSES] }
        },
        select: { amountCents: true }
      })
    ]);
    return sumBigInt([
      ...allocations.map((row) => row.amountCents),
      ...noInvoices.map((row) => row.amountCents),
      ...exceptions.map((row) => row.amountCents)
    ]);
  }

  private async currentInvoiceLineReservedAmount(
    tx: Prisma.TransactionClient,
    invoiceLineId: string
  ) {
    const [allocations, exceptions] = await Promise.all([
      tx.invoiceAllocation.findMany({
        where: { invoiceLineId, invalidatedAt: null },
        select: { amountCents: true }
      }),
      tx.invoiceExceptionConfirmation.findMany({
        where: {
          invoiceLineId,
          status: { in: [...CURRENT_CONFIRMATION_STATUSES] }
        },
        select: { amountCents: true }
      })
    ]);
    return sumBigInt([
      ...allocations.map((row) => row.amountCents),
      ...exceptions.map((row) => row.amountCents)
    ]);
  }

  private async recomputeInvoiceCounters(
    tx: Prisma.TransactionClient,
    invoiceRecordId: string
  ) {
    const lines = await tx.invoiceLine.findMany({
      where: { invoiceRecordId },
      select: { id: true, taxInclusiveAmountCents: true },
      orderBy: [{ id: "asc" }]
    });
    let recordAllocatedAmountCents = 0n;
    for (const line of lines) {
      const allocations = await tx.invoiceAllocation.findMany({
        where: {
          invoiceLineId: line.id,
          invalidatedAt: null
        },
        select: { amountCents: true }
      });
      const allocatedAmountCents = sumBigInt(
        allocations.map((row) => row.amountCents)
      );
      if (allocatedAmountCents > line.taxInclusiveAmountCents) {
        throw new ConflictException(
          "发票明细有效分摊超过价税合计，请联系管理员核对"
        );
      }
      await tx.invoiceLine.update({
        where: { id: line.id },
        data: { allocatedAmountCents }
      });
      recordAllocatedAmountCents += allocatedAmountCents;
    }
    const record = await tx.invoiceRecord.findUnique({
      where: { id: invoiceRecordId },
      select: { allocatableAmountCents: true }
    });
    if (!record) {
      throw new ConflictException(
        "发票记录不存在，请联系管理员核对"
      );
    }
    if (
      recordAllocatedAmountCents > record.allocatableAmountCents
    ) {
      throw new ConflictException(
        "发票有效分摊超过可分摊金额，请联系管理员核对"
      );
    }
    await tx.invoiceRecord.update({
      where: { id: invoiceRecordId },
      data: { allocatedAmountCents: recordAllocatedAmountCents }
    });
  }

  private invoiceMismatchReason(
    actualInvoiceType: string,
    actualRate: Prisma.Decimal,
    procurementLine: ProcurementLineLockRow
  ) {
    if (
      procurementLine.invoiceMode !== "invoice" ||
      !procurementLine.invoiceType ||
      !procurementLine.vatRateValueSnapshot
    ) {
      return "采购审批未冻结为有票明细";
    }
    if (actualInvoiceType !== procurementLine.invoiceType) {
      return "实际发票类型与采购审批冻结条件不一致";
    }
    if (
      !actualRate.equals(
        procurementLine.vatRateValueSnapshot
      )
    ) {
      return "实际税率与采购审批冻结条件不一致";
    }
    return null;
  }

  private assertPaymentTarget(
    context: LockedContext,
    paymentId: string | null
  ) {
    if (!paymentId) return;
    const payment = context.payments.find(
      (candidate) => candidate.id === paymentId
    );
    if (
      !payment ||
      payment.projectId !== context.procurement.projectId ||
      payment.procurementVersionId !== context.version.id ||
      payment.invalidatedAt
    ) {
      throw new BadRequestException(
        "票据关联的付款单不存在或不属于当前采购版本"
      );
    }
    if ((context.settledByPaymentId.get(paymentId) ?? 0n) <= 0n) {
      throw new ConflictException(
        "所选付款单尚无有效公司实付或供应商余额抵扣"
      );
    }
  }

  private requireAnySettlement(context: LockedContext) {
    if (context.settledAmountCents <= 0n) {
      throw new ConflictException(
        "尚未发生公司实际付款或供应商余额抵扣，不能登记票据；请先变更采购条件"
      );
    }
  }

  private assertCurrentHandler(
    context: LockedContext,
    actorUserId: string
  ) {
    if (
      context.procurement.handlerUserId !== actorUserId ||
      context.version.handlerUserId !== actorUserId
    ) {
      throw new ForbiddenException(
        "只有当前采购经办人可以发起无票或票据异常确认"
      );
    }
  }

  private async requireConfirmationSubmitter(
    tx: Prisma.TransactionClient,
    context: LockedContext,
    actorUserId: string
  ) {
    await this.requireActiveUser(tx, actorUserId);
    this.assertCurrentHandler(context, actorUserId);
    const roles = await this.loadActorRoleScopes(
      tx,
      actorUserId,
      context.procurement.projectId
    );
    if (
      !roles.effectiveRoleKeys.some((role) =>
        HANDLER_INVOICE_ROLES.has(role)
      )
    ) {
      throw new ForbiddenException(
        "当前采购经办人不再具备物资员或物资主管岗位"
      );
    }
  }

  private requireProcurementLine(
    context: LockedContext,
    procurementLineId: string
  ) {
    const line = context.procurementLines.find(
      (candidate) => candidate.id === procurementLineId
    );
    const receiptLine = context.receiptLines.find(
      (candidate) =>
        candidate.procurementLineId === procurementLineId
    );
    if (!line || !receiptLine) {
      throw new BadRequestException(
        "采购明细不存在或不属于当前有效收货"
      );
    }
    return line;
  }

  private assertCurrentCoordinates(
    context: LockedContext,
    fact: {
      projectId: string;
      receiptId: string;
      receiptRevisionNo: number;
      procurementId: string;
      procurementVersionId: string;
      procurementLineId: string;
      paymentId: string | null;
    }
  ) {
    if (
      fact.projectId !== context.procurement.projectId ||
      fact.receiptId !== context.receipt.id ||
      fact.receiptRevisionNo !==
        context.receipt.currentRevisionNo ||
      fact.procurementId !== context.procurement.id ||
      fact.procurementVersionId !== context.version.id ||
      !context.receiptLines.some(
        (line) =>
          line.procurementLineId === fact.procurementLineId
      )
    ) {
      throw new ConflictException(
        "票据事实不属于当前有效采购和收货修订"
      );
    }
    this.assertPaymentTarget(context, fact.paymentId);
  }

  private async requireInvoiceManager(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    context: LockedContext
  ) {
    await this.requireActiveUser(tx, actorUserId);
    const roles = await this.loadActorRoleScopes(
      tx,
      actorUserId,
      context.procurement.projectId
    );
    const isCurrentMaterialHandler =
      context.procurement.handlerUserId === actorUserId &&
      context.version.handlerUserId === actorUserId &&
      roles.effectiveRoleKeys.some((role) =>
        HANDLER_INVOICE_ROLES.has(role)
      );
    const isMaterialDirector =
      roles.effectiveRoleKeys.includes("material_director");
    const isProjectFinanceStaff =
      roles.projectRoleKeys.includes("finance_staff");
    const isFinanceDirector =
      roles.effectiveRoleKeys.includes("finance_director");
    if (
      !isCurrentMaterialHandler &&
      !isMaterialDirector &&
      !isProjectFinanceStaff &&
      !isFinanceDirector
    ) {
      throw new ForbiddenException(
        "当前账号无权登记零星采购发票"
      );
    }
  }

  private async requireFinanceDirector(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    projectId: string
  ) {
    await this.requireActiveUser(tx, actorUserId);
    const roles = await this.loadActorRoleScopes(
      tx,
      actorUserId,
      projectId
    );
    if (!roles.effectiveRoleKeys.includes("finance_director")) {
      throw new ForbiddenException(
        "只有财务主管可以复核或冲销票据事实"
      );
    }
  }

  private async requireGlobalInvoiceManager(tx: Prisma.TransactionClient, actorUserId: string) {
    await this.requireActiveUser(tx, actorUserId);
    const positions = await tx.userPosition.findMany({ where: { userId: actorUserId, projectId: null }, select: { positionId: true } });
    const positionIds = positions.map((position) => position.positionId);
    const roles = positionIds.length
      ? await tx.position.findMany({ where: { id: { in: positionIds } }, select: { key: true } })
      : [];
    if (!roles.some((role) => role.key === "finance_staff" || role.key === "finance_director")) {
      throw new ForbiddenException("只有全局财务人员可以登记全局发票");
    }
  }

  private async requireActiveUser(
    tx: Prisma.TransactionClient,
    actorUserId: string
  ) {
    const user = await tx.user.findUnique({
      where: { id: actorUserId },
      select: { id: true, isActive: true }
    });
    if (!user?.isActive) {
      throw new ForbiddenException("当前账号不存在或已停用");
    }
  }

  private async loadActorRoleScopes(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    projectId: string
  ): Promise<ActorRoleScopes> {
    const [globalPositions, projectPositions, projectMembers] =
      await Promise.all([
        tx.userPosition.findMany({
          where: { userId: actorUserId, projectId: null },
          select: { positionId: true }
        }),
        tx.userPosition.findMany({
          where: { userId: actorUserId, projectId },
          select: { positionId: true }
        }),
        tx.projectMember.findMany({
          where: { userId: actorUserId, projectId },
          select: { positionKey: true }
        })
      ]);
    const positionIds = [
      ...new Set(
        [...globalPositions, ...projectPositions].map(
          (position) => position.positionId
        )
      )
    ];
    const positions = positionIds.length
      ? await tx.position.findMany({
          where: { id: { in: positionIds } },
          select: { id: true, key: true }
        })
      : [];
    const keyByPositionId = new Map(
      positions.map((position) => [
        position.id,
        position.key as RoleKey
      ])
    );
    const globalRoleKeys = globalPositions.flatMap((position) => {
      const role = keyByPositionId.get(position.positionId);
      return role ? [role] : [];
    });
    const projectRoleKeys = [
      ...projectPositions.flatMap((position) => {
        const role = keyByPositionId.get(position.positionId);
        return role ? [role] : [];
      }),
      ...projectMembers.map(
        (member) => member.positionKey as RoleKey
      )
    ];
    return {
      effectiveRoleKeys: resolveEffectiveRoleKeys(
        globalRoleKeys,
        projectRoleKeys
      ),
      projectRoleKeys: [...new Set(projectRoleKeys)]
    };
  }

  private invoiceReadModel(invoice: InvoiceRecordWithLines) {
    return {
      id: invoice.id,
      projectId: invoice.projectId,
      invoiceType: invoice.invoiceType,
      identityKind: invoice.identityKind,
      owningCompanyEntityId: invoice.owningCompanyEntityId,
      direction: invoice.direction,
      invoiceCode: invoice.invoiceCode,
      invoiceNumber: invoice.invoiceNumber,
      externalIdentifier: invoice.externalIdentifier,
      issueDate: dateOnlyText(invoice.issueDate),
      sellerName: invoice.sellerName,
      sellerTaxId: invoice.sellerTaxId,
      buyerName: invoice.buyerName,
      buyerTaxId: invoice.buyerTaxId,
      taxExclusiveAmountCents:
        invoice.taxExclusiveAmountCents?.toString() ?? null,
      taxAmountCents: invoice.taxAmountCents?.toString() ?? null,
      totalAmountCents: invoice.totalAmountCents.toString(),
      allocatableAmountCents:
        invoice.allocatableAmountCents.toString(),
      allocatedAmountCents:
        invoice.allocatedAmountCents.toString(),
      status: invoice.status,
      fileId: invoice.fileId,
      lines: invoice.lines.map((line) => ({
        id: line.id,
        lineNo: line.lineNo,
        description: line.description,
        vatRateOptionId: line.vatRateOptionId,
        vatRateValue: line.vatRateValueSnapshot.toString(),
        vatRateLabel: line.vatRateLabelSnapshot,
        taxInclusiveAmountCents:
          line.taxInclusiveAmountCents.toString(),
        allocatedAmountCents:
          line.allocatedAmountCents.toString()
      }))
    };
  }

  private confirmationReadModel(confirmation: {
    id: string;
    procurementLineId: string;
    paymentId: string | null;
    amountCents: bigint;
    reason: string;
    proofFileId: string;
    status: string;
    submittedByUserId: string;
    submittedAt: Date;
  }) {
    return {
      id: confirmation.id,
      procurementLineId: confirmation.procurementLineId,
      paymentId: confirmation.paymentId,
      amountCents: confirmation.amountCents.toString(),
      reason: confirmation.reason,
      proofFileId: confirmation.proofFileId,
      status: confirmation.status,
      submittedByUserId: confirmation.submittedByUserId,
      submittedAt: confirmation.submittedAt.toISOString()
    };
  }

  private runSerializable<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>
  ) {
    return this.prisma.$transaction(operation, {
      isolationLevel:
        Prisma.TransactionIsolationLevel.Serializable
    });
  }

  private async runWrite<T>(
    operation: () => Promise<T>
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const code = prismaErrorCode(error);
      if (code === "P2034") {
        throw new ConflictException(MONEY_RESERVE_CONFLICT_MESSAGE);
      }
      if (
        code === "P2002" ||
        code === "P2003" ||
        code === "P2025" ||
        code === "P2010"
      ) {
        throw new ConflictException(TICKET_WRITE_CONFLICT_MESSAGE);
      }
      throw error;
    }
  }
}

function positiveMoney(value: string, fieldName: string) {
  const amount = parseMoneyCentsInput(
    value,
    fieldName,
    `${fieldName}必须按分填写为大于 0 的整数`
  );
  if (amount <= 0n) {
    throw new BadRequestException(
      `${fieldName}必须按分填写为大于 0 的整数`
    );
  }
  return amount;
}

function nonNegativeMoney(value: string, fieldName: string) {
  return parseMoneyCentsInput(
    value,
    fieldName,
    `${fieldName}必须按分填写为 0 或更大的整数`
  );
}

function requiredId(value: unknown, message: string) {
  if (
    typeof value !== "string" ||
    isUnicodeBlank(value)
  ) {
    throw new BadRequestException(message);
  }
  return collapseUnicodeWhitespace(value);
}

function optionalId(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return requiredId(value, "业务标识不能为空白");
}

function requiredText(
  value: unknown,
  fieldName: string,
  maxLength: number
) {
  if (
    typeof value !== "string" ||
    isUnicodeBlank(value)
  ) {
    throw new BadRequestException(`${fieldName}不能为空白`);
  }
  const normalized = collapseUnicodeWhitespace(value);
  if (Array.from(normalized).length > maxLength) {
    throw new BadRequestException(
      `${fieldName}不能超过 ${maxLength} 个字符`
    );
  }
  return normalized;
}

function optionalText(value: unknown, maxLength: number) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return requiredText(value, "备注", maxLength);
}

function optionalIdentityText(
  value: unknown,
  fieldName: string,
  maxLength: number
) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string" || isUnicodeBlank(value)) {
    throw new BadRequestException(`${fieldName}不能为空白`);
  }
  const compatibilityNormalized = value.normalize("NFKC");
  if (/[\p{Cc}\p{Cf}]/u.test(compatibilityNormalized)) {
    throw new BadRequestException(
      `${fieldName}不能包含控制字符或不可见格式字符`
    );
  }
  const normalized = collapseUnicodeWhitespace(
    compatibilityNormalized
  ).toUpperCase();
  if (Array.from(normalized).length > maxLength) {
    throw new BadRequestException(
      `${fieldName}不能超过 ${maxLength} 个字符`
    );
  }
  return normalized;
}

function strictDateOnly(value: unknown, fieldName: string) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(value)
  ) {
    throw new BadRequestException(
      `${fieldName}必须按 YYYY-MM-DD 填写且日期有效`
    );
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new BadRequestException(
      `${fieldName}必须按 YYYY-MM-DD 填写且日期有效`
    );
  }
  return date;
}

function dateOnlyText(value: Date) {
  return value.toISOString().slice(0, 10);
}

function sumBigInt(values: Iterable<bigint>) {
  let result = 0n;
  for (const value of values) result += value;
  return result;
}

function sumRowsByKey<T extends { amountCents: bigint }>(
  rows: readonly T[],
  keyOf: (row: T) => string
) {
  const result = new Map<string, bigint>();
  for (const row of rows) {
    const key = keyOf(row);
    result.set(key, (result.get(key) ?? 0n) + row.amountCents);
  }
  return result;
}

function isoText(value: Date | null) {
  return value?.toISOString() ?? null;
}

function ticketLedgerDetailUnavailable() {
  return {
    available: false as const,
    currentCoordinates: null,
    invoices: [],
    allocations: [],
    noInvoiceConfirmations: [],
    invoiceExceptions: []
  };
}

function coverageReadModel(input: {
  available: boolean;
  actualCostCents: bigint;
  normalInvoiceCents: bigint;
  confirmedNoInvoiceCents: bigint;
  confirmedExceptionCents: bigint;
  pendingCount: number;
  inconsistent?: boolean;
}) {
  const effectiveCoveredCents =
    input.normalInvoiceCents +
    input.confirmedNoInvoiceCents +
    input.confirmedExceptionCents;
  const remainingCents =
    input.actualCostCents > effectiveCoveredCents
      ? input.actualCostCents - effectiveCoveredCents
      : 0n;
  const status = input.inconsistent
    ? "inconsistent"
    : !input.available
    ? "not_ready"
    : input.pendingCount > 0
      ? "pending_review"
      : remainingCents === 0n
        ? "fully_covered"
        : "partially_covered";
  const label =
    status === "inconsistent"
      ? "票据坐标或金额异常，需核对"
      : status === "not_ready"
      ? "收货复核后核对票据"
      : status === "pending_review"
        ? `${input.pendingCount} 项票据待复核`
        : status === "fully_covered"
          ? "票据已全额覆盖"
          : `尚差 ${remainingCents.toString()} 分`;
  return {
    available: input.available,
    status,
    label,
    actualCostCents: input.actualCostCents.toString(),
    normalInvoiceCents: input.normalInvoiceCents.toString(),
    confirmedNoInvoiceCents:
      input.confirmedNoInvoiceCents.toString(),
    confirmedExceptionCents:
      input.confirmedExceptionCents.toString(),
    effectiveCoveredCents: effectiveCoveredCents.toString(),
    remainingCents: remainingCents.toString(),
    pendingCount: input.pendingCount
  };
}

function paymentCoverageReadModel(
  procurementCoverage: ReturnType<typeof coverageReadModel>,
  input: {
    normalInvoiceCents: bigint;
    confirmedNoInvoiceCents: bigint;
    confirmedExceptionCents: bigint;
    pendingCount: number;
    inconsistent?: boolean;
  }
) {
  const attributedCents =
    input.normalInvoiceCents +
    input.confirmedNoInvoiceCents +
    input.confirmedExceptionCents;
  return {
    ...procurementCoverage,
    ...(input.inconsistent
      ? {
          status: "inconsistent",
          label: "付款票据归属坐标异常，需核对"
        }
      : {}),
    paymentAttribution: {
      normalInvoiceCents: input.normalInvoiceCents.toString(),
      confirmedNoInvoiceCents:
        input.confirmedNoInvoiceCents.toString(),
      confirmedExceptionCents:
        input.confirmedExceptionCents.toString(),
      attributedCents: attributedCents.toString(),
      pendingCount: input.pendingCount,
      inconsistent: Boolean(input.inconsistent),
      countsTowardProcurementCoverageAgain: false
    }
  };
}

function prismaErrorCode(error: unknown) {
  if (!error || typeof error !== "object") return undefined;
  const code = (error as { code?: unknown }).code;
  if (code === "P2010") {
    const meta = (error as { meta?: unknown }).meta;
    const databaseCode =
      meta &&
      typeof meta === "object" &&
      "code" in meta
        ? (meta as { code?: unknown }).code
        : undefined;
    if (
      databaseCode === "23505" ||
      databaseCode === "23503" ||
      databaseCode === "23514" ||
      databaseCode === "40001" ||
      databaseCode === "40P01"
    ) {
      return "P2010";
    }
  }
  return typeof code === "string" ? code : undefined;
}
