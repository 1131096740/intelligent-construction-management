import { Injectable } from "@nestjs/common";
import {
  canCreatePaymentFromSettlementStatus,
  SettlementStatus
} from "@jiangkong/shared-domain";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { CreatePaymentRequestDto } from "./dto/create-payment-request.dto";
import { RecordFinanceRecordDto } from "./dto/record-finance-record.dto";
import { RecordPaymentPdfArchiveDto } from "./dto/record-payment-pdf-archive.dto";
import { RecordPaymentExecutionDto } from "./dto/record-payment-execution.dto";
import { ReviewPaymentApprovalDto } from "./dto/review-payment-approval.dto";
import { PaymentAmountService, PaymentCapacity } from "./payment-amount.service";

@Injectable()
export class PaymentRequestService {
  constructor(
    private readonly amount: PaymentAmountService,
    private readonly prisma?: PrismaService,
    private readonly audit: AuditService = new AuditService()
  ) {}

  assertSettlementEffective(status: SettlementStatus): void {
    if (!canCreatePaymentFromSettlementStatus(status)) {
      throw new Error("Cannot create payment request from a non-effective settlement");
    }
  }

  assertRequestAllowed(
    status: SettlementStatus,
    capacity: PaymentCapacity,
    requestedAmountCents: number
  ): void {
    this.assertSettlementEffective(status);
    this.amount.assertCanRequest(capacity, requestedAmountCents);
  }

  async create(input: CreatePaymentRequestDto) {
    if (!this.prisma) {
      throw new Error("Prisma service is required to create payment request");
    }

    return this.prisma.$transaction(async (tx) => {
      const settlement = await tx.settlement.findUnique({
        where: { id: input.settlementId }
      });

      if (!settlement) {
        throw new Error("Settlement not found");
      }

      this.assertSettlementEffective(settlement.status as SettlementStatus);

      const existingApprovedOrPending = await tx.paymentRequest.findMany({
        where: {
          settlementId: settlement.id,
          status: {
            in: ["approval_pending", "approved_pending_payment"]
          }
        }
      });
      const approvedPendingPaymentCents = existingApprovedOrPending.reduce(
        (total, payment) =>
          total + Math.max(payment.requestedAmountCents - payment.paidAmountCents, 0),
        0
      );
      const capacity: PaymentCapacity = {
        payableAmountCents: settlement.payableAmountCents,
        approvedPendingPaymentCents,
        paidAmountCents: settlement.paidAmountCents
      };

      this.amount.assertCanRequest(capacity, input.requestedAmountCents);

      return tx.paymentRequest.create({
        data: {
          projectId: settlement.projectId,
          settlementId: settlement.id,
          contractId: settlement.contractId,
          contractVersionId: settlement.contractVersionId,
          paymentTermsVersionId: settlement.paymentTermsVersionId,
          code: input.code,
          status: "approval_pending",
          requestedAmountCents: input.requestedAmountCents,
          approvedAmountCents: null,
          paidAmountCents: 0
        }
      });
    });
  }

  async reviewApproval(
    paymentId: string,
    actorUserId: string,
    input: ReviewPaymentApprovalDto
  ) {
    if (!this.prisma) {
      throw new Error("Prisma service is required to review payment approval");
    }

    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.paymentRequest.findFirst({
        where: { OR: [{ id: paymentId }, { code: paymentId }] }
      });

      if (!payment) {
        throw new Error("Payment request not found");
      }

      if (payment.status !== "approval_pending") {
        throw new Error(`Cannot review payment approval from status ${payment.status}`);
      }

      if (input.decision === "reject") {
        const rejected = await tx.paymentRequest.update({
          where: { id: payment.id },
          data: {
            status: "rejected",
            approvedAmountCents: null
          }
        });
        await this.audit.record(tx, {
          actorUserId,
          action: "payment.approval.reject",
          businessType: "payment_request",
          businessId: payment.id,
          metadata: {
            code: payment.code,
            fromStatus: payment.status,
            toStatus: "rejected"
          }
        });
        return rejected;
      }

      const approvedAmountCents = input.approvedAmountCents ?? payment.requestedAmountCents;
      if (approvedAmountCents > payment.requestedAmountCents) {
        throw new Error("Approved amount cannot exceed requested amount");
      }

      const approved = await tx.paymentRequest.update({
        where: { id: payment.id },
        data: {
          status: "approved_pending_payment",
          approvedAmountCents
        }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "payment.approval.approve",
        businessType: "payment_request",
        businessId: payment.id,
        metadata: {
          code: payment.code,
          fromStatus: payment.status,
          toStatus: "approved_pending_payment",
          requestedAmountCents: payment.requestedAmountCents,
          approvedAmountCents
        }
      });
      return approved;
    });
  }

  async recordExecution(
    paymentId: string,
    actorUserId: string,
    input: RecordPaymentExecutionDto
  ) {
    if (!this.prisma) {
      throw new Error("Prisma service is required to record payment execution");
    }

    if (typeof input.amountCents !== "number" || input.amountCents <= 0) {
      throw new Error("Payment execution amount must be greater than zero");
    }

    if (!input.voucherFileId?.trim()) {
      throw new Error("Payment voucher file is required");
    }

    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.paymentRequest.findFirst({
        where: { OR: [{ id: paymentId }, { code: paymentId }] }
      });

      if (!payment) {
        throw new Error("Payment request not found");
      }

      if (!["approved_pending_payment", "partially_paid"].includes(payment.status)) {
        throw new Error(`Cannot record payment execution from status ${payment.status}`);
      }

      const approvedAmountCents = payment.approvedAmountCents ?? payment.requestedAmountCents;
      const remainingAmountCents = approvedAmountCents - payment.paidAmountCents;
      if (input.amountCents > remainingAmountCents) {
        throw new Error(
          `Payment execution exceeds approved remaining amount: ${remainingAmountCents}`
        );
      }

      const settlement = await tx.settlement.findUnique({
        where: { id: payment.settlementId }
      });

      if (!settlement) {
        throw new Error("Payment settlement not found");
      }

      const newPaymentPaidAmountCents = payment.paidAmountCents + input.amountCents;
      const newPaymentStatus =
        newPaymentPaidAmountCents >= approvedAmountCents ? "paid" : "partially_paid";
      const newSettlementPaidAmountCents = settlement.paidAmountCents + input.amountCents;
      const newSettlementStatus =
        newSettlementPaidAmountCents >= settlement.payableAmountCents ? "paid" : "partially_paid";

      const execution = await tx.paymentExecution.create({
        data: {
          paymentRequestId: payment.id,
          settlementId: payment.settlementId,
          amountCents: input.amountCents,
          paidAt: new Date(input.paidAt),
          executedByUserId: actorUserId,
          voucherFileId: input.voucherFileId
        }
      });

      await tx.paymentRequest.update({
        where: { id: payment.id },
        data: {
          paidAmountCents: newPaymentPaidAmountCents,
          status: newPaymentStatus
        }
      });

      await tx.settlement.update({
        where: { id: settlement.id },
        data: {
          paidAmountCents: newSettlementPaidAmountCents,
          status: newSettlementStatus
        }
      });

      await this.audit.record(tx, {
        actorUserId,
        action: "payment.execution.record",
        businessType: "payment_request",
        businessId: payment.id,
        metadata: {
          code: payment.code,
          executionId: execution.id,
          amountCents: input.amountCents,
          voucherFileId: input.voucherFileId,
          fromStatus: payment.status,
          toStatus: newPaymentStatus
        }
      });

      return execution;
    });
  }

  async recordFinance(paymentId: string, actorUserId: string, input: RecordFinanceRecordDto) {
    if (!this.prisma) {
      throw new Error("Prisma service is required to record finance entry");
    }

    if (typeof input.amountCents !== "number" || input.amountCents <= 0) {
      throw new Error("Finance record amount must be greater than zero");
    }

    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.paymentRequest.findFirst({
        where: { OR: [{ id: paymentId }, { code: paymentId }] }
      });

      if (!payment) {
        throw new Error("Payment request not found");
      }

      if (payment.paidAmountCents <= 0) {
        throw new Error("Cannot record finance entry before actual payment execution");
      }

      const existingRecords = await tx.financeRecord.findMany({
        where: { paymentRequestId: payment.id }
      });
      const recordedAmountCents = existingRecords.reduce(
        (total, record) => total + record.amountCents,
        0
      );
      const unrecordedPaidAmountCents = payment.paidAmountCents - recordedAmountCents;
      if (input.amountCents > unrecordedPaidAmountCents) {
        throw new Error(
          `Finance record exceeds unrecorded paid amount: ${unrecordedPaidAmountCents}`
        );
      }

      const financeRecord = await tx.financeRecord.create({
        data: {
          projectId: payment.projectId,
          paymentRequestId: payment.id,
          settlementId: payment.settlementId,
          direction: "outflow",
          amountCents: input.amountCents,
          occurredAt: new Date(input.occurredAt),
          createdByUserId: actorUserId
        }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "payment.finance.record",
        businessType: "payment_request",
        businessId: payment.id,
        metadata: {
          financeRecordId: financeRecord.id,
          amountCents: input.amountCents,
          direction: "outflow"
        }
      });
      return financeRecord;
    });
  }

  async recordPdfArchive(
    paymentId: string,
    actorUserId: string,
    input: RecordPaymentPdfArchiveDto
  ) {
    if (!this.prisma) {
      throw new Error("Prisma service is required to record payment PDF archive");
    }

    const templateKey = input.templateKey ?? "payment_finance_archive";
    const departmentScope = input.departmentScope ?? "finance";

    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.paymentRequest.findFirst({
        where: { OR: [{ id: paymentId }, { code: paymentId }] }
      });

      if (!payment) {
        throw new Error("Payment request not found");
      }

      const financeRecords = await tx.financeRecord.findMany({
        where: { paymentRequestId: payment.id }
      });
      const financeRecordedAmountCents = financeRecords.reduce(
        (total, record) => total + record.amountCents,
        0
      );

      if (payment.paidAmountCents <= 0 || financeRecordedAmountCents < payment.paidAmountCents) {
        throw new Error("Cannot archive payment PDF before finance entry is complete");
      }

      const file = await tx.fileObject.findUnique({
        where: { id: input.fileId }
      });

      if (!file) {
        throw new Error("Payment archive file not found");
      }

      const existingPdf = await tx.pdfDocument.findFirst({
        where: {
          businessType: "payment_request",
          businessId: payment.id,
          templateKey
        }
      });

      if (existingPdf) {
        throw new Error("Payment PDF archive already exists");
      }

      const pdfDocument = await tx.pdfDocument.create({
        data: {
          businessType: "payment_request",
          businessId: payment.id,
          fileId: input.fileId,
          templateKey
        }
      });
      const archiveRecord = await tx.archiveRecord.create({
        data: {
          businessType: "payment_request",
          businessId: payment.id,
          fileId: input.fileId,
          departmentScope
        }
      });

      await this.audit.record(tx, {
        actorUserId,
        action: "payment.pdf_archive.record",
        businessType: "payment_request",
        businessId: payment.id,
        metadata: {
          code: payment.code,
          pdfDocumentId: pdfDocument.id,
          archiveRecordId: archiveRecord.id,
          fileId: input.fileId,
          templateKey,
          departmentScope
        }
      });

      return { pdfDocument, archiveRecord };
    });
  }
}
