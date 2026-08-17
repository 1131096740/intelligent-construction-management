import { BadRequestException } from "@nestjs/common";

import {
  occurredBeforeEffectiveDate,
  frozenAffiliateFromJson,
  readAffiliateSnapshot,
  readOperatingLedgerEffectiveDate,
  requiredJsonDate,
  requiredJsonMoney,
  requiredJsonRecord,
  requiredJsonText,
  sourceJson,
  stableNamedSubjectId
} from "../operating-ledger/formal-operating-source.helpers";
import type {
  OperatingSourceAdapter,
  OperatingSourceFactInput,
  OperatingSourceLocator,
  OperatingSourceSnapshot
} from "../operating-ledger/operating-source-adapter";

export const SPOT_PROCUREMENT_RECEIPT_REVIEW_SOURCE_TYPE =
  "spot_procurement_receipt_review";
export const SPOT_PROCUREMENT_PAYMENT_EXECUTION_SOURCE_TYPE =
  "spot_procurement_payment_execution";
export const SPOT_PROCUREMENT_REFUND_SOURCE_TYPE = "spot_procurement_refund";
export const SPOT_PROCUREMENT_INVOICE_RECORD_SOURCE_TYPE =
  "spot_procurement_invoice_record";

export class SpotProcurementReceiptOperatingSourceAdapter
  implements OperatingSourceAdapter
{
  readonly sourceType = SPOT_PROCUREMENT_RECEIPT_REVIEW_SOURCE_TYPE;

  async readProjectSnapshots(
    tx: Parameters<OperatingSourceAdapter["readProjectSnapshots"]>[0],
    projectId: string
  ): Promise<readonly OperatingSourceSnapshot[]> {
    const receipts = await tx.spotProcurementReceipt.findMany({
      where: {
        projectId,
        status: "reviewed",
        invalidatedAt: null,
        actualCostCents: { gt: 0 }
      },
      select: {
        id: true,
        procurementId: true,
        procurementVersionId: true,
        currentRevisionNo: true,
        actualCostCents: true
      },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }]
    });
    const snapshots = await Promise.all(
      receipts.map(async (receipt) => {
        const review = await tx.spotProcurementReceiptReview.findFirst({
          where: {
            receiptId: receipt.id,
            receiptRevisionNo: receipt.currentRevisionNo,
            procurementId: receipt.procurementId,
            procurementVersionId: receipt.procurementVersionId,
            decision: "approved"
          },
          select: {
            id: true,
            receiptId: true,
            receiptRevisionNo: true,
            procurementId: true,
            procurementVersionId: true,
            decision: true,
            reviewedByUserId: true,
            createdAt: true
          },
          orderBy: [{ sequenceNo: "desc" }, { id: "desc" }]
        });
        if (!review) {
          throw new BadRequestException("已复核收货确认缺少有效物资主管复核");
        }
        return this.snapshot(tx, receipt, review);
      })
    );
    return snapshots;
  }

  async readSourceSnapshot(
    tx: Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0],
    locator: OperatingSourceLocator
  ): Promise<OperatingSourceSnapshot | null> {
    const review = await tx.spotProcurementReceiptReview.findUnique({
      where: { id: locator.sourceBusinessId },
      select: {
        id: true,
        receiptId: true,
        receiptRevisionNo: true,
        procurementId: true,
        procurementVersionId: true,
        decision: true,
        reviewedByUserId: true,
        createdAt: true
      }
    });
    if (!review || review.decision !== "approved") return null;
    const receipt = await tx.spotProcurementReceipt.findFirst({
      where: {
        id: review.receiptId,
        projectId: locator.projectId,
        procurementId: review.procurementId,
        procurementVersionId: review.procurementVersionId,
        currentRevisionNo: review.receiptRevisionNo,
        status: "reviewed",
        invalidatedAt: null,
        actualCostCents: { gt: 0 }
      },
      select: {
        id: true,
        procurementId: true,
        procurementVersionId: true,
        currentRevisionNo: true,
        actualCostCents: true
      }
    });
    return receipt ? this.snapshot(tx, receipt, review) : null;
  }

  toOperatingFactInput(
    snapshot: OperatingSourceSnapshot
  ): OperatingSourceFactInput {
    const source = requiredJsonRecord(snapshot.sourceSnapshot, "零采收货复核正式来源");
    const affiliate = frozenAffiliateFromJson(source, "零采收货复核");
    const occurredAt = requiredJsonDate(source, "reviewedAt", "零采收货复核");
    const confirmedAt = requiredJsonDate(source, "confirmedAt", "零采收货复核");
    const effectiveDate = requiredJsonDate(
      source,
      "operatingLedgerEffectiveDate",
      "零采收货复核"
    );
    const amountCents = requiredJsonMoney(
      source,
      "actualCostCents",
      "零采收货复核"
    );
    if (amountCents <= 0n) {
      throw new BadRequestException("零采收货实际成本必须大于 0");
    }
    const costBearingCompany = {
      kind: "construction_enterprise" as const,
      id: affiliate.businessPartyVersionId
    };
    return {
      entryKind: "original",
      input: {
        projectId: snapshot.projectId,
        sourceType: snapshot.sourceType,
        sourceBusinessId: snapshot.sourceBusinessId,
        sourceBusinessCode: snapshot.sourceBusinessCode,
        sourceVersion: snapshot.sourceVersion,
        idempotencyKey: `${snapshot.sourceType}:${snapshot.sourceBusinessId}`,
        occurredAt,
        confirmedAt,
        confirmedByUserId: requiredJsonText(
          source,
          "reviewedByUserId",
          "零采收货复核"
        ),
        factKind: "expense",
        operatingLevel: "project",
        evidenceLevel: "A",
        amountCents,
        currencyCode: "CNY",
        direction: "outflow",
        isBeforeOperatingLedgerEffectiveDate: occurredBeforeEffectiveDate(
          occurredAt,
          effectiveDate
        ),
        affiliateAssignmentId: affiliate.assignmentId,
        affiliateBusinessPartyVersionId: affiliate.businessPartyVersionId,
        affiliateNameSnapshot: affiliate.name,
        ...(affiliate.creditCode
          ? { affiliateCreditCodeSnapshot: affiliate.creditCode }
          : {}),
        sourceSnapshot: snapshot.sourceSnapshot,
        basisSnapshot: sourceJson({
          authority: "spot_procurement_receipt_review",
          receiptId: requiredJsonText(source, "receiptId", "零采收货复核"),
          procurementId: requiredJsonText(
            source,
            "procurementId",
            "零采收货复核"
          )
        }),
        subjects: { costBearingCompany },
        impacts: [
          {
            idempotencyKey: `${snapshot.sourceType}:${snapshot.sourceBusinessId}:confirmed_cost`,
            sourceImpactKey: "confirmed_cost",
            impactKind: "confirmed_cost",
            amountCents,
            direction: "increase",
            subjectRole: "cost_bearing_company",
            subject: costBearingCompany,
            costCategoryCode: "material",
            description: "零星采购收货复核确认材料成本"
          }
        ]
      }
    };
  }

  private async snapshot(
    tx: Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0],
    receipt: {
      id: string;
      procurementId: string;
      procurementVersionId: string;
      currentRevisionNo: number;
      actualCostCents: bigint;
    },
    review: {
      id: string;
      receiptId: string;
      receiptRevisionNo: number;
      procurementId: string;
      procurementVersionId: string;
      decision: string;
      reviewedByUserId: string;
      createdAt: Date;
    }
  ): Promise<OperatingSourceSnapshot> {
    if (
      review.decision !== "approved" ||
      review.receiptId !== receipt.id ||
      review.receiptRevisionNo !== receipt.currentRevisionNo ||
      review.procurementId !== receipt.procurementId ||
      review.procurementVersionId !== receipt.procurementVersionId
    ) {
      throw new BadRequestException("零采收货复核坐标或正式状态不一致");
    }
    const procurement = await tx.spotProcurement.findFirst({
      where: {
        id: receipt.procurementId,
        currentVersionId: receipt.procurementVersionId,
        voidedAt: null
      },
      select: { id: true, projectId: true, code: true }
    });
    if (!procurement) {
      throw new BadRequestException("零采收货复核关联的当前采购不存在或已失效");
    }
    const [effectiveDate, affiliate] = await Promise.all([
      readOperatingLedgerEffectiveDate(tx, procurement.projectId),
      readAffiliateSnapshot(tx, {
        projectId: procurement.projectId,
        occurredAt: review.createdAt
      })
    ]);
    return {
      projectId: procurement.projectId,
      sourceType: this.sourceType,
      sourceBusinessId: review.id,
      sourceBusinessCode: `零采收货/${procurement.code}/第${receipt.currentRevisionNo}版`,
      sourceVersion: receipt.currentRevisionNo,
      status: "confirmed",
      sourceSnapshot: sourceJson({
        formalStatus: "confirmed",
        receiptId: receipt.id,
        procurementId: procurement.id,
        procurementCode: procurement.code,
        procurementVersionId: receipt.procurementVersionId,
        receiptRevisionNo: String(receipt.currentRevisionNo),
        actualCostCents: receipt.actualCostCents.toString(),
        reviewedAt: review.createdAt.toISOString(),
        confirmedAt: review.createdAt.toISOString(),
        reviewedByUserId: review.reviewedByUserId,
        operatingLedgerEffectiveDate: effectiveDate.toISOString(),
        affiliate
      })
    };
  }
}

export class SpotProcurementPaymentExecutionOperatingSourceAdapter
  implements OperatingSourceAdapter
{
  readonly sourceType = SPOT_PROCUREMENT_PAYMENT_EXECUTION_SOURCE_TYPE;

  async readProjectSnapshots(
    tx: Parameters<OperatingSourceAdapter["readProjectSnapshots"]>[0],
    projectId: string
  ): Promise<readonly OperatingSourceSnapshot[]> {
    const payments = await tx.spotProcurementPayment.findMany({
      where: {
        projectId,
        invalidatedAt: null,
        payeeNameSnapshot: { not: null }
      },
      select: {
        id: true,
        projectId: true,
        procurementId: true,
        procurementVersionId: true,
        code: true,
        paymentType: true,
        payerCompanyEntityId: true,
        payeePartyId: true,
        payeeUserId: true,
        payeeNameSnapshot: true
      }
    });
    if (!payments.length) return [];
    const executions = await tx.spotProcurementPaymentExecution.findMany({
      where: { paymentId: { in: payments.map((payment) => payment.id) }, voidedAt: null },
      select: {
        id: true,
        paymentId: true,
        amountCents: true,
        paidAt: true,
        executedByUserId: true,
        voucherFileId: true,
        createdAt: true
      },
      orderBy: [{ paidAt: "asc" }, { id: "asc" }]
    });
    const paymentById = new Map(payments.map((payment) => [payment.id, payment]));
    return Promise.all(
      executions.map(async (execution) => {
        const payment = paymentById.get(execution.paymentId);
        if (!payment) {
          throw new BadRequestException("零采实际付款缺少付款申请坐标");
        }
        return this.snapshot(tx, execution, payment);
      })
    );
  }

  async readSourceSnapshot(
    tx: Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0],
    locator: OperatingSourceLocator
  ): Promise<OperatingSourceSnapshot | null> {
    const execution = await tx.spotProcurementPaymentExecution.findUnique({
      where: { id: locator.sourceBusinessId },
      select: {
        id: true,
        paymentId: true,
        amountCents: true,
        paidAt: true,
        executedByUserId: true,
        voucherFileId: true,
        voidedAt: true,
        createdAt: true
      }
    });
    if (!execution || execution.voidedAt) return null;
    const payment = await tx.spotProcurementPayment.findFirst({
      where: {
        id: execution.paymentId,
        projectId: locator.projectId,
        invalidatedAt: null,
        payeeNameSnapshot: { not: null }
      },
      select: {
        id: true,
        projectId: true,
        procurementId: true,
        procurementVersionId: true,
        code: true,
        paymentType: true,
        payerCompanyEntityId: true,
        payeePartyId: true,
        payeeUserId: true,
        payeeNameSnapshot: true
      }
    });
    return payment ? this.snapshot(tx, execution, payment) : null;
  }

  toOperatingFactInput(
    snapshot: OperatingSourceSnapshot
  ): OperatingSourceFactInput {
    const source = requiredJsonRecord(snapshot.sourceSnapshot, "零采实际付款正式来源");
    const affiliate = frozenAffiliateFromJson(source, "零采实际付款");
    const occurredAt = requiredJsonDate(source, "paidAt", "零采实际付款");
    const confirmedAt = requiredJsonDate(source, "confirmedAt", "零采实际付款");
    const effectiveDate = requiredJsonDate(
      source,
      "operatingLedgerEffectiveDate",
      "零采实际付款"
    );
    const amountCents = requiredJsonMoney(source, "amountCents", "零采实际付款");
    if (amountCents <= 0n) {
      throw new BadRequestException("零采实际付款金额必须大于 0");
    }
    const isCompanyPayer = Boolean(source.paymentType);
    const actualPayer = isCompanyPayer
      ? {
          kind: "participating_company" as const,
          id: requiredJsonText(
            source,
            "payerCompanyEntityId",
            "零采实际付款"
          )
        }
      : {
          kind: "construction_enterprise" as const,
          id: affiliate.businessPartyVersionId
        };
    const payee = source.payeeUserId
      ? {
          kind: "employee" as const,
          id: requiredJsonText(source, "payeeUserId", "零采实际付款")
        }
      : {
          kind: "downstream_counterparty" as const,
          id: requiredJsonText(source, "payeeId", "零采实际付款")
        };
    return {
      entryKind: "original",
      input: {
        projectId: snapshot.projectId,
        sourceType: snapshot.sourceType,
        sourceBusinessId: snapshot.sourceBusinessId,
        sourceBusinessCode: snapshot.sourceBusinessCode,
        sourceVersion: snapshot.sourceVersion,
        idempotencyKey: `${snapshot.sourceType}:${snapshot.sourceBusinessId}`,
        occurredAt,
        confirmedAt,
        confirmedByUserId: requiredJsonText(
          source,
          "executedByUserId",
          "零采实际付款"
        ),
        factKind: "downstream_payment",
        operatingLevel: isCompanyPayer
          ? "participating_company"
          : "project",
        evidenceLevel: "A",
        amountCents,
        currencyCode: "CNY",
        direction: "outflow",
        isBeforeOperatingLedgerEffectiveDate: occurredBeforeEffectiveDate(
          occurredAt,
          effectiveDate
        ),
        affiliateAssignmentId: affiliate.assignmentId,
        affiliateBusinessPartyVersionId: affiliate.businessPartyVersionId,
        affiliateNameSnapshot: affiliate.name,
        ...(affiliate.creditCode
          ? { affiliateCreditCodeSnapshot: affiliate.creditCode }
          : {}),
        sourceSnapshot: snapshot.sourceSnapshot,
        basisSnapshot: sourceJson({
          authority: "spot_procurement_payment_execution",
          paymentId: requiredJsonText(source, "paymentId", "零采实际付款"),
          voucherFileIds: source.voucherFileIds
        }),
        subjects: { actualPayer, payee },
        impacts: [
          {
            idempotencyKey: `${snapshot.sourceType}:${snapshot.sourceBusinessId}:funds`,
            sourceImpactKey: isCompanyPayer
              ? "company_project_funds_decrease"
              : "construction_enterprise_funds_decrease",
            impactKind: isCompanyPayer
              ? "company_project_funds_decrease"
              : "construction_enterprise_funds_decrease",
            amountCents,
            direction: "decrease",
            subjectRole: "actual_payer",
            subject: actualPayer,
            description: isCompanyPayer
              ? "零星采购实际付款减少我方公司项目资金"
              : "零星采购实际付款减少施工企业项目资金"
          }
        ]
      }
    };
  }

  private async snapshot(
    tx: Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0],
    execution: {
      id: string;
      paymentId: string;
      amountCents: bigint;
      paidAt: Date;
      executedByUserId: string;
      voucherFileId: string | null;
      createdAt: Date;
    },
    payment: {
      id: string;
      projectId: string;
      procurementId: string;
      procurementVersionId: string;
      code: string;
      paymentType: string | null;
      payerCompanyEntityId: string | null;
      payeePartyId: string | null;
      payeeUserId: string | null;
      payeeNameSnapshot: string | null;
    }
  ): Promise<OperatingSourceSnapshot> {
    if (
      !payment.payeeNameSnapshot ||
      (payment.paymentType && !payment.payerCompanyEntityId)
    ) {
      throw new BadRequestException("零采实际付款缺少已冻结的主体或收款对象");
    }
    const procurement = await tx.spotProcurement.findFirst({
      where: {
        id: payment.procurementId,
        projectId: payment.projectId,
        currentVersionId: payment.procurementVersionId,
        voidedAt: null
      },
      select: { id: true, code: true }
    });
    if (!procurement) {
      throw new BadRequestException("零采实际付款关联的当前采购不存在或已失效");
    }
    const vouchers = await tx.spotProcurementPaymentExecutionVoucher.findMany({
      where: { paymentExecutionId: execution.id },
      select: { fileId: true },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }]
    });
    const voucherFileIds = vouchers.map((voucher) => voucher.fileId);
    if (!voucherFileIds.length && execution.voucherFileId) {
      voucherFileIds.push(execution.voucherFileId);
    }
    if (!voucherFileIds.length) {
      throw new BadRequestException("零采实际付款缺少已冻结的付款凭证");
    }
    const [effectiveDate, affiliate] = await Promise.all([
      readOperatingLedgerEffectiveDate(tx, payment.projectId),
      readAffiliateSnapshot(tx, {
        projectId: payment.projectId,
        occurredAt: execution.paidAt
      })
    ]);
    const payeeId = payment.payeePartyId
      ? payment.payeePartyId
      : stableNamedSubjectId("downstream", payment.payeeNameSnapshot);
    return {
      projectId: payment.projectId,
      sourceType: this.sourceType,
      sourceBusinessId: execution.id,
      sourceBusinessCode: `零采付款/${procurement.code}/${payment.code}`,
      sourceVersion: 1,
      status: "confirmed",
      sourceSnapshot: sourceJson({
        formalStatus: "confirmed",
        paymentId: payment.id,
        paymentCode: payment.code,
        procurementId: procurement.id,
        procurementCode: procurement.code,
        paymentType: payment.paymentType,
        payerCompanyEntityId: payment.payerCompanyEntityId,
        payeeId,
        payeeUserId: payment.payeeUserId,
        payeeNameSnapshot: payment.payeeNameSnapshot,
        amountCents: execution.amountCents.toString(),
        paidAt: execution.paidAt.toISOString(),
        confirmedAt: execution.createdAt.toISOString(),
        executedByUserId: execution.executedByUserId,
        voucherFileIds,
        operatingLedgerEffectiveDate: effectiveDate.toISOString(),
        affiliate
      })
    };
  }
}

export class SpotProcurementRefundOperatingSourceAdapter
  implements OperatingSourceAdapter
{
  readonly sourceType = SPOT_PROCUREMENT_REFUND_SOURCE_TYPE;

  async readProjectSnapshots(
    tx: Parameters<OperatingSourceAdapter["readProjectSnapshots"]>[0],
    projectId: string
  ): Promise<readonly OperatingSourceSnapshot[]> {
    const procurements = await tx.spotProcurement.findMany({
      where: { projectId, voidedAt: null },
      select: { id: true, projectId: true, code: true }
    });
    if (!procurements.length) return [];
    const refunds = await tx.spotProcurementRefund.findMany({
      where: { procurementId: { in: procurements.map((procurement) => procurement.id) } },
      select: {
        id: true,
        discrepancyId: true,
        procurementId: true,
        paymentId: true,
        amountCents: true,
        receivedAt: true,
        refundMethod: true,
        voucherFileId: true,
        recordedByUserId: true,
        createdAt: true
      },
      orderBy: [{ receivedAt: "asc" }, { id: "asc" }]
    });
    const procurementById = new Map(
      procurements.map((procurement) => [procurement.id, procurement])
    );
    return Promise.all(
      refunds.map(async (refund) => {
        const procurement = procurementById.get(refund.procurementId);
        if (!procurement) {
          throw new BadRequestException("零采退款缺少采购坐标");
        }
        return this.snapshot(tx, refund, procurement);
      })
    );
  }

  async readSourceSnapshot(
    tx: Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0],
    locator: OperatingSourceLocator
  ): Promise<OperatingSourceSnapshot | null> {
    const refund = await tx.spotProcurementRefund.findUnique({
      where: { id: locator.sourceBusinessId },
      select: {
        id: true,
        discrepancyId: true,
        procurementId: true,
        paymentId: true,
        amountCents: true,
        receivedAt: true,
        refundMethod: true,
        voucherFileId: true,
        recordedByUserId: true,
        createdAt: true
      }
    });
    if (!refund) return null;
    const procurement = await tx.spotProcurement.findFirst({
      where: { id: refund.procurementId, projectId: locator.projectId, voidedAt: null },
      select: { id: true, projectId: true, code: true }
    });
    return procurement ? this.snapshot(tx, refund, procurement) : null;
  }

  toOperatingFactInput(
    snapshot: OperatingSourceSnapshot
  ): OperatingSourceFactInput {
    const source = requiredJsonRecord(snapshot.sourceSnapshot, "零采退款正式来源");
    const affiliate = frozenAffiliateFromJson(source, "零采退款");
    const occurredAt = requiredJsonDate(source, "receivedAt", "零采退款");
    const confirmedAt = requiredJsonDate(source, "confirmedAt", "零采退款");
    const effectiveDate = requiredJsonDate(
      source,
      "operatingLedgerEffectiveDate",
      "零采退款"
    );
    const amountCents = requiredJsonMoney(source, "amountCents", "零采退款");
    if (amountCents <= 0n) {
      throw new BadRequestException("零采退款金额必须大于 0");
    }
    const isCompanyPayer = Boolean(source.paymentType);
    const actualPayer = source.refundCounterpartyUserId
      ? {
          kind: "employee" as const,
          id: requiredJsonText(source, "refundCounterpartyUserId", "零采退款")
        }
      : {
          kind: "downstream_counterparty" as const,
          id: requiredJsonText(source, "refundCounterpartyId", "零采退款")
        };
    const payee = isCompanyPayer
      ? {
          kind: "participating_company" as const,
          id: requiredJsonText(source, "payerCompanyEntityId", "零采退款")
        }
      : {
          kind: "construction_enterprise" as const,
          id: affiliate.businessPartyVersionId
        };
    return {
      entryKind: "original",
      input: {
        projectId: snapshot.projectId,
        sourceType: snapshot.sourceType,
        sourceBusinessId: snapshot.sourceBusinessId,
        sourceBusinessCode: snapshot.sourceBusinessCode,
        sourceVersion: snapshot.sourceVersion,
        idempotencyKey: `${snapshot.sourceType}:${snapshot.sourceBusinessId}`,
        occurredAt,
        confirmedAt,
        confirmedByUserId: requiredJsonText(
          source,
          "recordedByUserId",
          "零采退款"
        ),
        factKind: "fund_movement",
        operatingLevel: isCompanyPayer ? "participating_company" : "project",
        evidenceLevel: "A",
        amountCents,
        currencyCode: "CNY",
        direction: "inflow",
        isBeforeOperatingLedgerEffectiveDate: occurredBeforeEffectiveDate(
          occurredAt,
          effectiveDate
        ),
        affiliateAssignmentId: affiliate.assignmentId,
        affiliateBusinessPartyVersionId: affiliate.businessPartyVersionId,
        affiliateNameSnapshot: affiliate.name,
        ...(affiliate.creditCode
          ? { affiliateCreditCodeSnapshot: affiliate.creditCode }
          : {}),
        sourceSnapshot: snapshot.sourceSnapshot,
        basisSnapshot: sourceJson({
          authority: "spot_procurement_refund",
          originalPaymentId: requiredJsonText(source, "paymentId", "零采退款"),
          originalReceiptReviewId: requiredJsonText(
            source,
            "receiptReviewId",
            "零采退款"
          ),
          voucherFileId: requiredJsonText(source, "voucherFileId", "零采退款")
        }),
        subjects: { actualPayer, payee },
        impacts: [
          {
            idempotencyKey: `${snapshot.sourceType}:${snapshot.sourceBusinessId}:funds`,
            sourceImpactKey: isCompanyPayer
              ? "company_project_funds_increase"
              : "construction_enterprise_funds_increase",
            impactKind: isCompanyPayer
              ? "company_project_funds_increase"
              : "construction_enterprise_funds_increase",
            amountCents,
            direction: "increase",
            subjectRole: "payee",
            subject: payee,
            description: isCompanyPayer
              ? "零星采购退款冲减我方公司项目资金流出"
              : "零星采购退款冲减施工企业项目资金流出"
          }
        ]
      }
    };
  }

  private async snapshot(
    tx: Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0],
    refund: {
      id: string;
      discrepancyId: string;
      procurementId: string;
      paymentId: string | null;
      amountCents: bigint;
      receivedAt: Date;
      refundMethod: string;
      voucherFileId: string;
      recordedByUserId: string;
      createdAt: Date;
    },
    procurement: { id: string; projectId: string; code: string }
  ): Promise<OperatingSourceSnapshot> {
    if (!refund.paymentId) {
      throw new BadRequestException("零采退款缺少原付款申请，不能登记经营账");
    }
    const [discrepancy, payment] = await Promise.all([
      tx.spotProcurementDiscrepancy.findUnique({
        where: { id: refund.discrepancyId },
        select: { id: true, procurementId: true, receiptReviewId: true }
      }),
      tx.spotProcurementPayment.findFirst({
        where: {
          id: refund.paymentId,
          projectId: procurement.projectId,
          procurementId: procurement.id,
          invalidatedAt: null,
          payeeNameSnapshot: { not: null }
        },
        select: {
          id: true,
          paymentType: true,
          payerCompanyEntityId: true,
          payeePartyId: true,
          payeeUserId: true,
          payeeNameSnapshot: true
        }
      })
    ]);
    if (!discrepancy || discrepancy.procurementId !== procurement.id) {
      throw new BadRequestException("零采退款关联的差异事实不一致");
    }
    if (
      !payment ||
      !payment.payeeNameSnapshot ||
      (payment.paymentType && !payment.payerCompanyEntityId)
    ) {
      throw new BadRequestException("零采退款关联的原付款主体或收款对象不完整");
    }
    const [effectiveDate, affiliate] = await Promise.all([
      readOperatingLedgerEffectiveDate(tx, procurement.projectId),
      readAffiliateSnapshot(tx, {
        projectId: procurement.projectId,
        occurredAt: refund.receivedAt
      })
    ]);
    const refundCounterpartyId = payment.payeePartyId
      ? payment.payeePartyId
      : stableNamedSubjectId("downstream", payment.payeeNameSnapshot);
    return {
      projectId: procurement.projectId,
      sourceType: this.sourceType,
      sourceBusinessId: refund.id,
      sourceBusinessCode: `零采退款/${procurement.code}/${refund.id}`,
      sourceVersion: 1,
      status: "confirmed",
      sourceSnapshot: sourceJson({
        formalStatus: "confirmed",
        receiptReviewId: discrepancy.receiptReviewId,
        paymentId: payment.id,
        procurementId: procurement.id,
        procurementCode: procurement.code,
        amountCents: refund.amountCents.toString(),
        receivedAt: refund.receivedAt.toISOString(),
        confirmedAt: refund.createdAt.toISOString(),
        recordedByUserId: refund.recordedByUserId,
        refundMethod: refund.refundMethod,
        voucherFileId: refund.voucherFileId,
        payerCompanyEntityId: payment.payerCompanyEntityId,
        paymentType: payment.paymentType,
        refundCounterpartyId,
        refundCounterpartyUserId: payment.payeeUserId,
        operatingLedgerEffectiveDate: effectiveDate.toISOString(),
        affiliate
      })
    };
  }
}

export class SpotProcurementInvoiceOperatingSourceAdapter
  implements OperatingSourceAdapter
{
  readonly sourceType = SPOT_PROCUREMENT_INVOICE_RECORD_SOURCE_TYPE;

  async readProjectSnapshots(
    tx: Parameters<OperatingSourceAdapter["readProjectSnapshots"]>[0],
    projectId: string
  ): Promise<readonly OperatingSourceSnapshot[]> {
    const invoices = await tx.invoiceRecord.findMany({
      where: {
        projectId,
        status: "active",
        sourceProcurementId: { not: null }
      },
      select: {
        id: true,
        projectId: true,
        invoiceCode: true,
        invoiceNumber: true,
        externalIdentifier: true,
        issueDate: true,
        sellerName: true,
        buyerName: true,
        totalAmountCents: true,
        fileId: true,
        uploadedByUserId: true,
        sourceProcurementId: true,
        createdAt: true
      },
      orderBy: [{ issueDate: "asc" }, { id: "asc" }]
    });
    return Promise.all(invoices.map((invoice) => this.snapshot(tx, invoice)));
  }

  async readSourceSnapshot(
    tx: Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0],
    locator: OperatingSourceLocator
  ): Promise<OperatingSourceSnapshot | null> {
    const invoice = await tx.invoiceRecord.findFirst({
      where: {
        id: locator.sourceBusinessId,
        projectId: locator.projectId,
        status: "active",
        sourceProcurementId: { not: null }
      },
      select: {
        id: true,
        projectId: true,
        invoiceCode: true,
        invoiceNumber: true,
        externalIdentifier: true,
        issueDate: true,
        sellerName: true,
        buyerName: true,
        totalAmountCents: true,
        fileId: true,
        uploadedByUserId: true,
        sourceProcurementId: true,
        createdAt: true
      }
    });
    return invoice ? this.snapshot(tx, invoice) : null;
  }

  toOperatingFactInput(
    snapshot: OperatingSourceSnapshot
  ): OperatingSourceFactInput {
    const source = requiredJsonRecord(snapshot.sourceSnapshot, "零采发票正式来源");
    const affiliate = frozenAffiliateFromJson(source, "零采发票");
    const occurredAt = requiredJsonDate(source, "issueDate", "零采发票");
    const confirmedAt = requiredJsonDate(source, "confirmedAt", "零采发票");
    const effectiveDate = requiredJsonDate(
      source,
      "operatingLedgerEffectiveDate",
      "零采发票"
    );
    const amountCents = requiredJsonMoney(source, "totalAmountCents", "零采发票");
    if (amountCents <= 0n) {
      throw new BadRequestException("零采发票金额必须大于 0");
    }
    const payee = {
      kind: "downstream_counterparty" as const,
      id: requiredJsonText(source, "payeeId", "零采发票")
    };
    return {
      entryKind: "original",
      input: {
        projectId: snapshot.projectId,
        sourceType: snapshot.sourceType,
        sourceBusinessId: snapshot.sourceBusinessId,
        sourceBusinessCode: snapshot.sourceBusinessCode,
        sourceVersion: snapshot.sourceVersion,
        idempotencyKey: `${snapshot.sourceType}:${snapshot.sourceBusinessId}`,
        occurredAt,
        confirmedAt,
        confirmedByUserId: requiredJsonText(
          source,
          "uploadedByUserId",
          "零采发票"
        ),
        factKind: "invoice",
        operatingLevel: "project",
        evidenceLevel: "A",
        amountCents,
        currencyCode: "CNY",
        direction: "neutral",
        isBeforeOperatingLedgerEffectiveDate: occurredBeforeEffectiveDate(
          occurredAt,
          effectiveDate
        ),
        affiliateAssignmentId: affiliate.assignmentId,
        affiliateBusinessPartyVersionId: affiliate.businessPartyVersionId,
        affiliateNameSnapshot: affiliate.name,
        ...(affiliate.creditCode
          ? { affiliateCreditCodeSnapshot: affiliate.creditCode }
          : {}),
        sourceSnapshot: snapshot.sourceSnapshot,
        basisSnapshot: sourceJson({
          authority: "spot_procurement_invoice_record",
          invoiceIdentity: requiredJsonText(source, "invoiceIdentity", "零采发票"),
          fileId: requiredJsonText(source, "fileId", "零采发票")
        }),
        subjects: { payee },
        impacts: [
          {
            idempotencyKey: `${snapshot.sourceType}:${snapshot.sourceBusinessId}:reference`,
            sourceImpactKey: "invoice_reference",
            impactKind: "invoice_reference",
            amountCents,
            direction: "notice",
            subjectRole: "payee",
            subject: payee,
            description: "零星采购发票登记依据，不自动确认收入或成本"
          }
        ]
      }
    };
  }

  private async snapshot(
    tx: Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0],
    invoice: {
      id: string;
      projectId: string;
      invoiceCode: string | null;
      invoiceNumber: string | null;
      externalIdentifier: string | null;
      issueDate: Date;
      sellerName: string;
      buyerName: string;
      totalAmountCents: bigint;
      fileId: string;
      uploadedByUserId: string;
      sourceProcurementId: string | null;
      createdAt: Date;
    }
  ): Promise<OperatingSourceSnapshot> {
    if (!invoice.sourceProcurementId) {
      throw new BadRequestException("零采发票缺少关联采购，不能登记经营账");
    }
    const procurement = await tx.spotProcurement.findFirst({
      where: {
        id: invoice.sourceProcurementId,
        projectId: invoice.projectId,
        voidedAt: null
      },
      select: { id: true, code: true }
    });
    if (!procurement) {
      throw new BadRequestException("零采发票关联的采购不存在或已失效");
    }
    const [effectiveDate, affiliate] = await Promise.all([
      readOperatingLedgerEffectiveDate(tx, invoice.projectId),
      readAffiliateSnapshot(tx, {
        projectId: invoice.projectId,
        occurredAt: invoice.issueDate
      })
    ]);
    const invoiceIdentity =
      [invoice.invoiceCode, invoice.invoiceNumber].filter(Boolean).join("/") ||
      invoice.externalIdentifier;
    if (!invoiceIdentity) {
      throw new BadRequestException("零采发票缺少可识别票据编号");
    }
    const payeeId = stableNamedSubjectId("downstream", invoice.sellerName);
    return {
      projectId: invoice.projectId,
      sourceType: this.sourceType,
      sourceBusinessId: invoice.id,
      sourceBusinessCode: `零采发票/${procurement.code}/${invoiceIdentity}`,
      sourceVersion: 1,
      status: "confirmed",
      sourceSnapshot: sourceJson({
        formalStatus: "confirmed",
        invoiceRecordId: invoice.id,
        procurementId: procurement.id,
        procurementCode: procurement.code,
        invoiceIdentity,
        sellerName: invoice.sellerName,
        buyerName: invoice.buyerName,
        payeeId,
        totalAmountCents: invoice.totalAmountCents.toString(),
        issueDate: invoice.issueDate.toISOString(),
        confirmedAt: invoice.createdAt.toISOString(),
        uploadedByUserId: invoice.uploadedByUserId,
        fileId: invoice.fileId,
        operatingLedgerEffectiveDate: effectiveDate.toISOString(),
        affiliate
      })
    };
  }
}
