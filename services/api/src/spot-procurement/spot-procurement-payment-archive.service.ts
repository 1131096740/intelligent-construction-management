import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { resolve } from "node:path";
import { PDFDocument as PdfLibDocument } from "pdf-lib";
import PDFDocument = require("pdfkit");
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { FileService } from "../file/file.service";
import { dbMoneyToBigInt, formatMoneyCentsAsYuan } from "../money/decimal-money";
import { SPOT_PROCUREMENT_APPROVAL_ORIGINAL_TEMPLATE_KEY } from "./spot-procurement-form-renderer";

const FONT_PATH = resolve(__dirname, "../../assets/fonts/NotoSansSC-Regular.otf");
const LEGACY_APPROVAL_FORM_TEMPLATE_KEY = "approval_form";

type ArchiveFile = {
  fileId: string;
  fileRole: string;
  sortOrder: number;
};

type ArchiveSnapshot = {
  trigger: string;
  paymentCode: string;
  projectName: string;
  merchantName: string | null;
  payeeName: string | null;
  merchantPayeeMismatchNote: string | null;
  payerCompanyName: string | null;
  approvalAmountCents: string;
  paidAmountCents: string;
  refundAmountCents: string;
  netPaidAmountCents: string;
  remainingAmountCents: string;
  paymentStatus: string;
  generatedAt: string;
};

/**
 * 付款归档包是追加型事实：每次业务触发均新增一个版本，历史版本及其文件
 * 永不替换。归档包的主文件为 A4 明细页，关联文件按 A5 原件、明细、依据、
 * 实付凭证、发票的固定顺序保存。
 */
@Injectable()
export class SpotProcurementPaymentArchiveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FileService,
    private readonly audit: AuditService
  ) {}

  async tryCreateVersion(
    paymentId: string,
    actorUserId: string,
    trigger: string
  ): Promise<void> {
    try {
      await this.createVersion(paymentId, actorUserId, trigger);
    } catch (error) {
      await this.audit
        .record(this.prisma, {
          actorUserId,
          action: "spot_procurement.payment_archive.generate_failed",
          businessType: "spot_procurement_payment",
          businessId: paymentId,
          metadata: {
            trigger,
            retryable: true,
            errorType: safeErrorType(error),
            errorSummary: "付款归档版本生成失败，可稍后重试"
          }
        })
        .catch(() => undefined);
    }
  }

  async createVersion(paymentId: string, actorUserId: string, trigger: string) {
    const source = await this.prisma.$transaction(async (tx) =>
      this.loadSource(tx, paymentId, trigger)
    );
    const detailBuffer = await renderPaymentArchiveDetail(source.detail);
    const detailFile = await this.files.uploadPrivateFile({
      buffer: detailBuffer,
      originalName: `项目零星付款明细附页-${source.payment.code}.pdf`,
      mimeType: "application/pdf",
      sizeBytes: detailBuffer.length,
      uploadedByUserId: actorUserId
    });
    let packageFile: { id: string };
    try {
      const original = await this.files.getFileBuffer(source.approvalOriginalFileId);
      const packageBuffer = await mergeArchivePdf(
        original.buffer,
        detailBuffer
      );
      packageFile = await this.files.uploadPrivateFile({
        buffer: packageBuffer,
        originalName: `项目零星付款归档包-${source.payment.code}.pdf`,
        mimeType: "application/pdf",
        sizeBytes: packageBuffer.length,
        uploadedByUserId: actorUserId
      });
    } catch (error) {
      await this.quarantineUnlinkedDetailFile(detailFile.id, actorUserId);
      throw error;
    }

    let linked = false;
    try {
      const archive = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`
          SELECT "id" FROM "SpotProcurementPayment"
          WHERE "id" = ${paymentId}
          FOR UPDATE
        `);
        const latest = await tx.spotProcurementPaymentArchive.findFirst({
          where: { paymentId },
          orderBy: [{ versionNo: "desc" }, { id: "desc" }],
          select: { versionNo: true }
        });
        const archive = await tx.spotProcurementPaymentArchive.create({
          data: {
            paymentId,
            versionNo: (latest?.versionNo ?? 0) + 1,
            archiveTrigger: trigger,
            status: "generated",
            generatedPackageFileId: packageFile.id,
            snapshot: source.snapshot as unknown as Prisma.InputJsonValue,
            createdByUserId: actorUserId
          }
        });
        const archiveFiles = [
          source.files[0],
          {
            fileId: detailFile.id,
            fileRole: "payment_detail_pdf",
            sortOrder: 0
          },
          ...source.files.slice(1),
          {
            fileId: packageFile.id,
            fileRole: "payment_archive_package_pdf",
            sortOrder: 0
          }
        ].map((file, sortOrder) => ({
          ...file,
          archiveId: archive.id,
          sortOrder
        }));
        await tx.spotProcurementPaymentArchiveFile.createMany({ data: archiveFiles });
        await this.audit.record(tx, {
          actorUserId,
          action: "spot_procurement.payment_archive.create",
          businessType: "spot_procurement_payment_archive",
          businessId: archive.id,
          metadata: {
            paymentId,
            versionNo: archive.versionNo,
            trigger,
            detailFileId: detailFile.id,
            packageFileId: packageFile.id
          }
        });
        return archive;
      });
      linked = true;
      return archive;
    } finally {
      if (!linked) {
        await this.quarantineUnlinkedDetailFile(detailFile.id, actorUserId);
        await this.quarantineUnlinkedDetailFile(packageFile.id, actorUserId);
      }
    }
  }

  private async quarantineUnlinkedDetailFile(
    fileId: string,
    actorUserId: string
  ): Promise<void> {
    await this.prisma
      .$transaction(async (tx) => {
        const binding = await tx.spotProcurementPaymentArchiveFile.findFirst({
          where: { fileId },
          select: { id: true }
        });
        if (binding) return;
        const updated = await tx.fileObject.updateMany({
          where: {
            id: fileId,
            uploadedByUserId: actorUserId,
            storageStatus: "active"
          },
          data: { storageStatus: "quarantined" }
        });
        if (updated.count === 1) {
          await this.audit.record(tx, {
            actorUserId,
            action: "spot_procurement.payment_archive.orphan_file",
            businessType: "spot_procurement_payment_archive",
            businessId: fileId,
            metadata: { fileId, reason: "archive_association_failed" }
          });
        }
      })
      .catch(() => undefined);
  }

  private async loadSource(
    tx: Prisma.TransactionClient,
    paymentId: string,
    trigger: string
  ) {
    const payment = await tx.spotProcurementPayment.findUnique({
      where: { id: paymentId }
    });
    if (!payment || !payment.factsFrozenAt) {
      throw new Error("付款审批尚未完成，不能生成付款归档版本");
    }
    const [project, procurement, version, originalApproval, paymentLines, channels, methods,
      attachments, executions, invoices, discrepancy] = await Promise.all([
      tx.project.findUnique({ where: { id: payment.projectId } }),
      tx.spotProcurement.findUnique({ where: { id: payment.procurementId } }),
      tx.spotProcurementVersion.findUnique({ where: { id: payment.procurementVersionId } }),
      tx.pdfDocument.findFirst({
        where: {
          businessType: "spot_procurement_payment",
          businessId: payment.id,
          templateKey: {
            in: [
              SPOT_PROCUREMENT_APPROVAL_ORIGINAL_TEMPLATE_KEY,
              LEGACY_APPROVAL_FORM_TEMPLATE_KEY
            ]
          }
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }]
      }),
      tx.spotProcurementPaymentLine.findMany({
        where: { paymentId: payment.id },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }]
      }),
      tx.spotProcurementPaymentChannel.findMany({
        where: { paymentId: payment.id },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }]
      }),
      tx.spotProcurementPaymentMethodOption.findMany({
        where: { paymentId: payment.id },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }]
      }),
      tx.spotProcurementPaymentAttachment.findMany({
        where: { paymentId: payment.id },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }]
      }),
      tx.spotProcurementPaymentExecution.findMany({
        where: { paymentId: payment.id },
        orderBy: [{ paidAt: "asc" }, { id: "asc" }]
      }),
      tx.spotProcurementPaymentInvoice.findMany({
        where: { paymentId: payment.id },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }]
      }),
      tx.spotProcurementDiscrepancy.findFirst({
        where: {
          procurementId: payment.procurementId,
          procurementVersionId: payment.procurementVersionId,
          invalidatedAt: null
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }]
      })
    ]);
    if (!project || !procurement || !version || !originalApproval) {
      throw new Error("付款归档缺少项目、采购版本或 A5 审批原件");
    }
    const materialIds = paymentLines.map((line) => line.procurementLineId);
    const [materials, vouchers, refund] = await Promise.all([
      materialIds.length
        ? tx.spotProcurementLine.findMany({ where: { id: { in: materialIds } } })
        : Promise.resolve([]),
      executions.length
        ? tx.spotProcurementPaymentExecutionVoucher.findMany({
            where: { paymentExecutionId: { in: executions.map((execution) => execution.id) } },
            orderBy: [{ sortOrder: "asc" }, { id: "asc" }]
          })
        : Promise.resolve([]),
      discrepancy
        ? tx.spotProcurementRefund.findUnique({ where: { discrepancyId: discrepancy.id } })
        : Promise.resolve(null)
    ]);
    const materialById = new Map(materials.map((material) => [material.id, material]));
    const paidAmountCents = executions
      .filter((execution) => !execution.voidedAt)
      .reduce(
        (total, execution) => total + dbMoneyToBigInt(execution.amountCents, "实际付款"),
        0n
      );
    const refundAmountCents = refund?.amountCents ?? 0n;
    const approvalAmountCents = dbMoneyToBigInt(payment.approvalAmountCents, "审批金额");
    const snapshot: ArchiveSnapshot = {
      trigger,
      paymentCode: payment.code,
      projectName: project.name,
      merchantName: payment.merchantNameSnapshot,
      payeeName: payment.payeeNameSnapshot,
      merchantPayeeMismatchNote: payment.merchantPayeeMismatchNote,
      payerCompanyName: payment.payerCompanyNameSnapshot,
      approvalAmountCents: approvalAmountCents.toString(),
      paidAmountCents: paidAmountCents.toString(),
      refundAmountCents: refundAmountCents.toString(),
      netPaidAmountCents: (paidAmountCents - refundAmountCents).toString(),
      remainingAmountCents: (approvalAmountCents - paidAmountCents).toString(),
      paymentStatus: payment.status,
      generatedAt: new Date().toISOString()
    };
    const files: ArchiveFile[] = [
      { fileId: originalApproval.fileId, fileRole: "payment_approval_original_pdf", sortOrder: 0 },
      ...attachments.map((attachment, index) => ({
        fileId: attachment.fileId,
        fileRole: `payment_supporting_attachment:${attachment.category}`,
        sortOrder: index
      })),
      ...executions.flatMap((execution, executionIndex) => {
        const bound = vouchers
          .filter((voucher) => voucher.paymentExecutionId === execution.id)
          .map((voucher, voucherIndex) => ({
            fileId: voucher.fileId,
            fileRole: execution.voidedAt
              ? `voided_execution_voucher:${executionIndex + 1}`
              : `payment_execution_voucher:${executionIndex + 1}`,
            sortOrder: voucherIndex
          }));
        return execution.voucherFileId
          ? [
              ...bound,
              {
                fileId: execution.voucherFileId,
                fileRole: `legacy_payment_execution_voucher:${executionIndex + 1}`,
                sortOrder: bound.length
              }
            ]
          : bound;
      }),
      ...invoices.map((invoice, index) => ({
        fileId: invoice.fileId,
        fileRole:
          invoice.status === "active"
            ? "payment_invoice"
            : "invalidated_payment_invoice",
        sortOrder: index
      })),
      ...(refund ? [{ fileId: refund.voucherFileId, fileRole: "refund_voucher", sortOrder: 0 }] : [])
    ];
    return {
      payment,
      approvalOriginalFileId: originalApproval.fileId,
      snapshot,
      files,
      detail: {
        snapshot,
        version,
        paymentLines: paymentLines.map((line) => ({
          materialName: materialById.get(line.procurementLineId)?.materialName ?? "材料未读取",
          specification: materialById.get(line.procurementLineId)?.specification ?? null,
          unit: materialById.get(line.procurementLineId)?.unit ?? "—",
          quantity: line.paymentQuantity.toString(),
          unitPrice: line.unitPrice.toString(),
          amountCents: dbMoneyToBigInt(line.amountCents, "付款明细金额"),
          expectedInvoiceCondition: line.expectedInvoiceCondition,
          vatRateLabel: line.vatRateLabelSnapshot
        })),
        channels: channels.map((channel) => ({
          type: channel.channelType,
          accountName: channel.accountNameSnapshot,
          accountNumber: channel.accountNumberSnapshot,
          bankName: channel.bankNameSnapshot,
          note: channel.channelNote,
          primary: channel.isPrimary
        })),
        attachmentDirectory: attachments.map(
          (attachment, index) => `${index + 1}. ${attachment.category}`
        ),
        methods: methods.map((method) => method.paymentMethod),
        executions: executions.map((execution) => ({
          amountCents: dbMoneyToBigInt(execution.amountCents, "实际付款"),
          paidAt: execution.paidAt,
          method: execution.paymentMethod,
          voidedAt: execution.voidedAt
        })),
        refund: refund
          ? {
              amountCents: dbMoneyToBigInt(refund.amountCents, "退款金额"),
              receivedAt: refund.receivedAt,
              method: refund.refundMethod
            }
          : null
      }
    };
  }
}

async function mergeArchivePdf(
  approvalOriginalBuffer: Buffer,
  detailBuffer: Buffer
): Promise<Buffer> {
  const packagePdf = await PdfLibDocument.create();
  for (const buffer of [approvalOriginalBuffer, detailBuffer]) {
    const source = await PdfLibDocument.load(buffer);
    const pages = await packagePdf.copyPages(source, source.getPageIndices());
    pages.forEach((page) => packagePdf.addPage(page));
  }
  return Buffer.from(await packagePdf.save());
}

async function renderPaymentArchiveDetail(input: {
  snapshot: ArchiveSnapshot;
  version: { reason: string };
  paymentLines: Array<{
    materialName: string;
    specification: string | null;
    unit: string;
    quantity: string;
    unitPrice: string;
    amountCents: bigint;
    expectedInvoiceCondition: string;
    vatRateLabel: string | null;
  }>;
  channels: Array<{
    type: string;
    accountName: string | null;
    accountNumber: string | null;
    bankName: string | null;
    note: string | null;
    primary: boolean;
  }>;
  attachmentDirectory: string[];
  methods: string[];
  executions: Array<{
    amountCents: bigint;
    paidAt: Date;
    method: string;
    voidedAt: Date | null;
  }>;
  refund: { amountCents: bigint; receivedAt: Date; method: string } | null;
}): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 38, bufferPages: true });
  doc.registerFont("cn", FONT_PATH);
  doc.font("cn");
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolvePromise, rejectPromise) => {
    doc.on("end", () => resolvePromise(Buffer.concat(chunks)));
    doc.on("error", rejectPromise);
  });
  const width = doc.page.width - 76;
  doc.fontSize(18).text("项目零星付款明细附页", 38, 34, { width, align: "center" });
  let y = 68;
  const rows = [
    ["项目名称", input.snapshot.projectName],
    ["付款申请编号", input.snapshot.paymentCode],
    ["实际商户", input.snapshot.merchantName ?? "未填写"],
    ["收款对象", input.snapshot.payeeName ?? "未填写"],
    ["商户/收款对象差异说明", input.snapshot.merchantPayeeMismatchNote ?? "无"],
    ["付款主体", input.snapshot.payerCompanyName ?? "未确认"],
    ["付款事由", input.version.reason],
    ["审批金额", yuan(input.snapshot.approvalAmountCents)],
    ["累计实付", yuan(input.snapshot.paidAmountCents)],
    ["退款金额", yuan(input.snapshot.refundAmountCents)],
    ["净付金额", yuan(input.snapshot.netPaidAmountCents)],
    ["剩余金额", yuan(input.snapshot.remainingAmountCents)],
    ["当前状态", input.snapshot.paymentStatus],
    ["拟付款方式", input.methods.map(paymentMethodLabel).join("、") || "未读取"],
    ["归档触发", input.snapshot.trigger]
  ];
  for (const [label, value] of rows) {
    y = drawPairRow(doc, y, label, value, width);
  }
  y += 10;
  doc.fontSize(11).text("付款材料明细", 38, y);
  y += 18;
  y = drawTableHeader(doc, y, width, [36, 148, 74, 64, 70, 92], ["序号", "材料", "数量", "单价", "金额", "预计票据"]);
  input.paymentLines.forEach((line, index) => {
    const material = [line.materialName, line.specification].filter(Boolean).join(" ");
    y = drawTableHeader(doc, y, width, [36, 148, 74, 64, 70, 92], [
      String(index + 1),
      material,
      `${line.quantity} ${line.unit}`,
      line.unitPrice,
      formatMoneyCentsAsYuan(line.amountCents),
      [line.expectedInvoiceCondition, line.vatRateLabel].filter(Boolean).join("；")
    ]);
  });
  y += 10;
  doc.fontSize(11).text("收款渠道", 38, y);
  y += 18;
  input.channels.forEach((channel, index) => {
    const value = [
      `${index + 1}. ${paymentMethodLabel(channel.type)}${channel.primary ? "（主渠道）" : ""}`,
      channel.accountName ? `户名：${channel.accountName}` : null,
      channel.accountNumber ? `账号：${channel.accountNumber}` : null,
      channel.bankName ? `开户行：${channel.bankName}` : null,
      channel.note ? `备注：${channel.note}` : null
    ]
      .filter(Boolean)
      .join("；");
    y = drawTextRow(doc, y, value, width);
  });
  y += 10;
  doc.fontSize(11).text("付款依据附件目录", 38, y);
  y += 18;
  if (!input.attachmentDirectory.length) {
    y = drawTextRow(doc, y, "无（附件为可选资料）", width);
  } else {
    input.attachmentDirectory.forEach((entry) => {
      y = drawTextRow(doc, y, entry, width);
    });
  }
  y += 10;
  doc.fontSize(11).text("实际付款与退款", 38, y);
  y += 18;
  input.executions.forEach((execution, index) => {
    y = drawTextRow(
      doc,
      y,
      `${index + 1}. ${formatDate(execution.paidAt)} ${paymentMethodLabel(execution.method)} ${yuan(execution.amountCents)}${execution.voidedAt ? "（已作废）" : ""}`,
      width
    );
  });
  if (input.refund) {
    y = drawTextRow(
      doc,
      y,
      `退款：${formatDate(input.refund.receivedAt)} ${paymentMethodLabel(input.refund.method)} ${yuan(input.refund.amountCents)}`,
      width
    );
  }
  doc.fontSize(8).fillColor("#555555").text(
    "本附页为付款归档版本明细；A5 审批原件及附件、付款凭证、发票以关联文件形式永久保存。",
    38,
    Math.min(y + 12, doc.page.height - 56),
    { width }
  );
  doc.end();
  return done;
}

function drawPairRow(doc: PDFKit.PDFDocument, y: number, label: string, value: string, width: number) {
  const height = Math.max(23, doc.heightOfString(value, { width: width - 118 }) + 10);
  doc.rect(38, y, 100, height).stroke();
  doc.rect(138, y, width - 100, height).stroke();
  doc.fontSize(9).fillColor("#111111").text(label, 43, y + 6, { width: 90, align: "center" });
  doc.fontSize(9).text(value, 143, y + 6, { width: width - 110 });
  return y + height;
}

function drawTableHeader(
  doc: PDFKit.PDFDocument,
  y: number,
  width: number,
  widths: number[],
  values: string[]
) {
  const height = 28;
  let x = 38;
  widths.forEach((columnWidth, index) => {
    doc.rect(x, y, columnWidth, height).stroke();
    doc.fontSize(8).fillColor("#111111").text(values[index] ?? "", x + 3, y + 5, {
      width: columnWidth - 6,
      height: height - 8,
      align: index === 1 || index === 5 ? "left" : "center"
    });
    x += columnWidth;
  });
  if (x < 38 + width) doc.rect(x, y, 38 + width - x, height).stroke();
  return y + height;
}

function drawTextRow(doc: PDFKit.PDFDocument, y: number, value: string, width: number) {
  const height = Math.max(22, doc.heightOfString(value, { width: width - 10 }) + 10);
  doc.rect(38, y, width, height).stroke();
  doc.fontSize(9).fillColor("#111111").text(value, 43, y + 5, { width: width - 10 });
  return y + height;
}

function yuan(value: string | bigint) {
  return `${formatMoneyCentsAsYuan(typeof value === "bigint" ? value : BigInt(value))} 元`;
}

function formatDate(value: Date) {
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

function paymentMethodLabel(value: string) {
  const labels: Record<string, string> = {
    cash: "现金",
    wechat: "微信",
    alipay: "支付宝",
    bank_transfer: "网银转账",
    other: "其他"
  };
  return labels[value] ?? value;
}

function safeErrorType(error: unknown) {
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String((error as { name?: unknown }).name ?? "")
      : "";
  return /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(name) ? name : "UnknownError";
}
