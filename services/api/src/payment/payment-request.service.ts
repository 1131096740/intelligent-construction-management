import { Injectable, Optional } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  approvalElapsedHours,
  canCreatePaymentFromSettlementStatus,
  canRemindApproval,
  SettlementStatus,
  type RoleKey
} from "@jiangkong/shared-domain";
import { ApprovalDelegationService } from "../approval/approval-delegation.service";
import { ApprovalFormService } from "../approval/approval-form.service";
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";
import { FileService } from "../file/file.service";
import { renderSimplePdf } from "../pdf/simple-pdf";
import { CreatePaymentRequestDto } from "./dto/create-payment-request.dto";
import { RecordFinanceRecordDto } from "./dto/record-finance-record.dto";
import { RecordPaymentPdfArchiveDto } from "./dto/record-payment-pdf-archive.dto";
import { RecordPaymentExecutionDto } from "./dto/record-payment-execution.dto";
import { ReviewPaymentApprovalDto } from "./dto/review-payment-approval.dto";
import { PaymentAmountService, PaymentCapacity } from "./payment-amount.service";

interface AssignApprovalDto {
  toUserId: string;
}

interface GeneratePaymentPdfArchiveDto {
  templateKey?: string;
  departmentScope?: string;
}

interface PaymentApprovalAssignment {
  kind: "transfer" | "delegate";
  fromUserId: string;
  fromRoleKey: RoleKey;
  toUserId: string;
}

interface PaymentApprovalNode {
  name: string;
  mode: "any";
  roleKeys: RoleKey[];
  approvedRoleKeys?: RoleKey[];
  assignments?: PaymentApprovalAssignment[];
}

const PAYMENT_APPROVAL_NODES = [
  {
    name: "董事长/总经理",
    mode: "any",
    roleKeys: ["chairman", "general_manager"]
  }
] satisfies PaymentApprovalNode[];

@Injectable()
export class PaymentRequestService {
  constructor(
    private readonly amount: PaymentAmountService,
    @Optional()
    private readonly prisma?: PrismaService,
    @Optional()
    private readonly audit: AuditService = new AuditService(),
    @Optional()
    private readonly files?: FileService,
    @Optional()
    private readonly auth?: AuthService,
    @Optional()
    private readonly delegations?: ApprovalDelegationService,
    @Optional()
    private readonly approvalForms?: ApprovalFormService
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

  async create(input: CreatePaymentRequestDto, applicantUserId?: string) {
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

      const payment = await tx.paymentRequest.create({
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

      if (applicantUserId) {
        await tx.approvalInstance.create({
          data: {
            flowType: "payment.approve",
            businessType: "payment_request",
            businessId: payment.id,
            status: "in_progress",
            currentNodeIndex: 0,
            frozenNodes: PAYMENT_APPROVAL_NODES as unknown as Prisma.InputJsonValue,
            applicantUserId
          }
        });
      }

      return payment;
    });
  }

  // 申请人撤回进行中的付款审批：付款请求无草稿态，撤回为终态 withdrawn（重试须新建付款申请）。
  async withdrawApproval(paymentId: string, actorUserId: string) {
    if (!this.prisma) {
      throw new Error("Prisma service is required to withdraw payment approval");
    }

    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.paymentRequest.findFirst({
        where: { OR: [{ id: paymentId }, { code: paymentId }] }
      });

      if (!payment) {
        throw new Error("Payment request not found");
      }

      if (payment.status !== "approval_pending") {
        throw new Error(`Cannot withdraw payment approval from status ${payment.status}`);
      }

      const instance = await tx.approvalInstance.findFirst({
        where: {
          businessType: "payment_request",
          businessId: payment.id,
          flowType: "payment.approve",
          status: "in_progress"
        }
      });

      if (!instance) {
        throw new Error("Payment approval instance not found");
      }

      if (instance.applicantUserId !== actorUserId) {
        throw new Error("Only payment approval applicant can withdraw");
      }

      const updated = await tx.paymentRequest.update({
        where: { id: payment.id },
        data: { status: "withdrawn" }
      });

      await tx.approvalInstance.update({
        where: { id: instance.id },
        data: { status: "withdrawn" }
      });

      await tx.approvalActionLog.create({
        data: {
          approvalInstanceId: instance.id,
          action: "withdraw",
          actorUserId
        }
      });

      await this.audit.record(tx, {
        actorUserId,
        action: "payment.approval.withdraw",
        businessType: "payment_request",
        businessId: payment.id,
        metadata: {
          fromStatus: payment.status,
          toStatus: "withdrawn",
          applicantUserId: instance.applicantUserId
        }
      });

      return updated;
    });
  }

  // 超时催办：申请人督促当前冻结节点（董事长/总经理）处理；超时/重复节流由 shared-domain 判定。
  async remindApproval(paymentId: string, actorUserId: string, now: Date = new Date()) {
    if (!this.prisma) {
      throw new Error("Prisma service is required to remind payment approval");
    }

    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.paymentRequest.findFirst({
        where: { OR: [{ id: paymentId }, { code: paymentId }] }
      });

      if (!payment) {
        throw new Error("Payment request not found");
      }

      if (payment.status !== "approval_pending") {
        throw new Error(`Cannot remind payment approval from status ${payment.status}`);
      }

      const instance = await tx.approvalInstance.findFirst({
        where: {
          businessType: "payment_request",
          businessId: payment.id,
          flowType: "payment.approve",
          status: "in_progress"
        }
      });

      if (!instance) {
        throw new Error("Payment approval instance not found");
      }

      if (instance.applicantUserId !== actorUserId) {
        throw new Error("Only payment approval applicant can remind");
      }

      const lastRemind = await tx.approvalActionLog.findFirst({
        where: { approvalInstanceId: instance.id, action: "remind" },
        orderBy: { createdAt: "desc" }
      });

      // 催办不改写实例（不影响 updatedAt），仅记动作日志；超时与重复节流见 shared-domain。
      if (
        !canRemindApproval({
          status: instance.status,
          lastActivityAt: instance.updatedAt,
          lastRemindedAt: lastRemind?.createdAt ?? null,
          now
        })
      ) {
        throw new Error("Payment approval is not due for a reminder yet");
      }

      const nodes = instance.frozenNodes as unknown as Array<{ name: string }>;
      const currentNode = nodes[instance.currentNodeIndex];

      const log = await tx.approvalActionLog.create({
        data: {
          approvalInstanceId: instance.id,
          action: "remind",
          actorUserId
        }
      });

      await this.audit.record(tx, {
        actorUserId,
        action: "payment.approval.remind",
        businessType: "payment_request",
        businessId: payment.id,
        metadata: {
          approvalInstanceId: instance.id,
          currentNodeIndex: instance.currentNodeIndex,
          nodeName: currentNode?.name,
          overdueHours: Math.floor(approvalElapsedHours(instance.updatedAt, now))
        }
      });

      return log;
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
    if (
      !["approve", "reject", "reject_previous", "return_to_applicant"].includes(
        input.decision
      )
    ) {
      throw new Error("Unsupported payment approval decision");
    }

    let completedInstanceId: string | undefined;
    const result = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.paymentRequest.findFirst({
        where: { OR: [{ id: paymentId }, { code: paymentId }] }
      });

      if (!payment) {
        throw new Error("Payment request not found");
      }

      if (payment.status !== "approval_pending") {
        throw new Error(`Cannot review payment approval from status ${payment.status}`);
      }

      const instance = await tx.approvalInstance.findFirst({
        where: {
          businessType: "payment_request",
          businessId: payment.id,
          flowType: "payment.approve",
          status: "in_progress"
        }
      });

      if (!instance) {
        throw new Error("Payment approval instance not found");
      }

      const nodes = instance.frozenNodes as unknown as PaymentApprovalNode[];
      const currentNode = nodes[instance.currentNodeIndex];

      if (!currentNode) {
        throw new Error("Payment approval current node not found");
      }

      const actorRoleKeys = await this.loadActorRoleKeys(tx, actorUserId, payment.projectId);
      let approvedRoleKey =
        currentNode.roleKeys.find((role) => actorRoleKeys.includes(role)) ??
        currentNode.assignments?.find((assignment) => assignment.toUserId === actorUserId)
          ?.fromRoleKey;

      if (!approvedRoleKey) {
        approvedRoleKey = await this.resolveDelegatedRoleKey(
          tx,
          actorUserId,
          payment.projectId,
          currentNode.roleKeys
        );
      }

      if (!approvedRoleKey) {
        throw new Error(`Actor cannot approve payment node ${currentNode.name}`);
      }

      if (input.decision === "reject_previous") {
        if (instance.currentNodeIndex === 0) {
          throw new Error("Cannot reject payment approval to previous node from first node");
        }

        const previousNodeIndex = instance.currentNodeIndex - 1;
        const nextNodes = nodes.map((node, index) =>
          index === previousNodeIndex || index === instance.currentNodeIndex
            ? { ...node, approvedRoleKeys: [] }
            : node
        );
        const updated = await tx.paymentRequest.update({
          where: { id: payment.id },
          data: { status: "approval_pending" }
        });

        await tx.approvalInstance.update({
          where: { id: instance.id },
          data: {
            currentNodeIndex: previousNodeIndex,
            frozenNodes: nextNodes as unknown as Prisma.InputJsonValue,
            status: "in_progress"
          }
        });

        await tx.approvalActionLog.create({
          data: {
            approvalInstanceId: instance.id,
            action: "reject_previous",
            actorUserId,
            comment: input.comment?.trim() || undefined
          }
        });

        await this.audit.record(tx, {
          actorUserId,
          action: "payment.approval.reject_previous",
          businessType: "payment_request",
          businessId: payment.id,
          metadata: {
            code: payment.code,
            fromStatus: payment.status,
            toStatus: "approval_pending",
            fromNodeName: currentNode.name,
            toNodeName: nextNodes[previousNodeIndex].name,
            approvedRoleKey
          }
        });

        return updated;
      }

      if (input.decision === "return_to_applicant") {
        const updated = await tx.paymentRequest.update({
          where: { id: payment.id },
          data: { status: "draft" }
        });

        await tx.approvalInstance.update({
          where: { id: instance.id },
          data: { status: "returned_to_applicant" }
        });

        await tx.approvalActionLog.create({
          data: {
            approvalInstanceId: instance.id,
            action: "return_to_applicant",
            actorUserId,
            comment: input.comment?.trim() || undefined
          }
        });

        await this.audit.record(tx, {
          actorUserId,
          action: "payment.approval.return_to_applicant",
          businessType: "payment_request",
          businessId: payment.id,
          metadata: {
            code: payment.code,
            fromStatus: payment.status,
            toStatus: "draft",
            nodeName: currentNode.name,
            approvedRoleKey
          }
        });

        return updated;
      }

      if (input.decision === "reject") {
        const rejected = await tx.paymentRequest.update({
          where: { id: payment.id },
          data: {
            status: "rejected",
            approvedAmountCents: null
          }
        });
        await tx.approvalInstance.update({
          where: { id: instance.id },
          data: { status: "rejected" }
        });
        await tx.approvalActionLog.create({
          data: {
            approvalInstanceId: instance.id,
            action: "reject",
            actorUserId,
            comment: input.comment?.trim() || undefined
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
            toStatus: "rejected",
            nodeName: currentNode.name,
            approvedRoleKey
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
      await tx.approvalInstance.update({
        where: { id: instance.id },
        data: {
          currentNodeIndex: instance.currentNodeIndex + 1,
          status: "approved"
        }
      });
      await tx.approvalActionLog.create({
        data: {
          approvalInstanceId: instance.id,
          action: "approve",
          actorUserId,
          comment: input.comment?.trim() || undefined
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
          approvedAmountCents,
          nodeName: currentNode.name,
          approvedRoleKey
        }
      });
      completedInstanceId = instance.id;
      return approved;
    });

    if (completedInstanceId) {
      await this.approvalForms
        ?.generateForInstance(completedInstanceId, actorUserId)
        .catch(() => undefined);
    }

    return result;
  }

  transferApproval(paymentId: string, actorUserId: string, input: AssignApprovalDto) {
    return this.assignApproval("transfer", paymentId, actorUserId, input);
  }

  delegateApproval(paymentId: string, actorUserId: string, input: AssignApprovalDto) {
    return this.assignApproval("delegate", paymentId, actorUserId, input);
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

    if (!input.confirmationPassword?.trim()) {
      throw new Error("Payment execution confirmation password is required");
    }

    if (!this.auth) {
      throw new Error("Auth service is required to confirm payment execution");
    }

    await this.auth.confirmPassword(actorUserId, input.confirmationPassword);

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

  async generatePdfArchive(
    paymentId: string,
    actorUserId: string,
    input: GeneratePaymentPdfArchiveDto = {}
  ) {
    if (!this.prisma) {
      throw new Error("Prisma service is required to generate payment PDF archive");
    }

    if (!this.files) {
      throw new Error("File service is required to generate payment PDF archive");
    }

    const templateKey = input.templateKey ?? "payment_finance_archive";
    const departmentScope = input.departmentScope ?? "finance";
    const source = await this.prisma.$transaction(async (tx) => {
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
        throw new Error("Cannot generate payment PDF before finance entry is complete");
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

      return { payment, financeRecordedAmountCents };
    });
    const buffer = renderSimplePdf([
      "Payment Finance Archive",
      `Payment Code: ${source.payment.code}`,
      `Template: ${templateKey}`,
      `Requested Amount: ${this.formatCents(source.payment.requestedAmountCents)}`,
      `Approved Amount: ${this.formatCents(source.payment.approvedAmountCents ?? source.payment.requestedAmountCents)}`,
      `Paid Amount: ${this.formatCents(source.payment.paidAmountCents)}`,
      `Finance Recorded Amount: ${this.formatCents(source.financeRecordedAmountCents)}`,
      `Generated At: ${new Date().toISOString()}`
    ]);
    const file = await this.files.uploadPrivateFile({
      originalName: `${source.payment.code}-${templateKey}.pdf`,
      mimeType: "application/pdf",
      sizeBytes: buffer.length,
      uploadedByUserId: actorUserId,
      buffer
    });

    return this.recordPdfArchive(source.payment.id, actorUserId, {
      fileId: file.id,
      templateKey,
      departmentScope
    });
  }

  private async loadActorRoleKeys(
    tx: {
      userPosition: {
        findMany(input: unknown): Promise<Array<{ positionId: string; projectId: string | null }>>;
      };
      projectMember: { findMany(input: unknown): Promise<Array<{ positionKey: string }>> };
      position: { findMany(input: unknown): Promise<Array<{ id: string; key: string }>> };
    },
    actorUserId: string,
    projectId: string
  ): Promise<RoleKey[]> {
    const [globalPositions, projectPositions, projectMembers] = await Promise.all([
      tx.userPosition.findMany({ where: { userId: actorUserId, projectId: null } }),
      tx.userPosition.findMany({ where: { userId: actorUserId, projectId } }),
      tx.projectMember.findMany({ where: { userId: actorUserId, projectId } })
    ]);
    const positionIds = Array.from(
      new Set([...globalPositions, ...projectPositions].map((position) => position.positionId))
    );
    const positions = positionIds.length
      ? await tx.position.findMany({ where: { id: { in: positionIds } } })
      : [];
    const positionKeys = positions.map((position) => position.key as RoleKey);
    const memberKeys = projectMembers.map((member) => member.positionKey as RoleKey);

    return Array.from(new Set([...positionKeys, ...memberKeys]));
  }

  // 常驻委托台账消费：本人岗位/节点指派都不命中时，看是否有在窗口内的委托人持有该节点角色。
  private async resolveDelegatedRoleKey(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    projectId: string,
    nodeRoleKeys: RoleKey[]
  ): Promise<RoleKey | undefined> {
    if (!this.delegations) {
      return undefined;
    }

    const delegatorIds = await this.delegations.activeDelegatorIds(tx, actorUserId);

    for (const delegatorId of delegatorIds) {
      const delegatorRoleKeys = await this.loadActorRoleKeys(tx, delegatorId, projectId);
      const match = nodeRoleKeys.find((role) => delegatorRoleKeys.includes(role));

      if (match) {
        return match;
      }
    }

    return undefined;
  }

  private formatCents(value: number) {
    return `${(value / 100).toFixed(2)} CNY`;
  }

  private async assignApproval(
    kind: PaymentApprovalAssignment["kind"],
    paymentId: string,
    actorUserId: string,
    input: AssignApprovalDto
  ) {
    if (!this.prisma) {
      throw new Error("Prisma service is required to assign payment approval");
    }

    if (!input.toUserId || input.toUserId === actorUserId) {
      throw new Error("Payment approval assignment target is invalid");
    }

    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.paymentRequest.findFirst({
        where: { OR: [{ id: paymentId }, { code: paymentId }] }
      });

      if (!payment) {
        throw new Error("Payment request not found");
      }

      if (payment.status !== "approval_pending") {
        throw new Error(`Cannot assign payment approval from status ${payment.status}`);
      }

      const instance = await tx.approvalInstance.findFirst({
        where: {
          businessType: "payment_request",
          businessId: payment.id,
          flowType: "payment.approve",
          status: "in_progress"
        }
      });

      if (!instance) {
        throw new Error("Payment approval instance not found");
      }

      const nodes = instance.frozenNodes as unknown as PaymentApprovalNode[];
      const currentNode = nodes[instance.currentNodeIndex];

      if (!currentNode) {
        throw new Error("Payment approval current node not found");
      }

      const actorRoleKeys = await this.loadActorRoleKeys(tx, actorUserId, payment.projectId);
      const fromRoleKey = currentNode.roleKeys.find((role) => actorRoleKeys.includes(role));

      if (!fromRoleKey) {
        throw new Error(`Actor cannot assign payment node ${currentNode.name}`);
      }

      const nextNodes = [...nodes];
      const nextAssignments = [
        ...(currentNode.assignments ?? []).filter(
          (assignment) =>
            !(
              assignment.kind === kind &&
              assignment.fromUserId === actorUserId &&
              assignment.fromRoleKey === fromRoleKey
            )
        ),
        { kind, fromUserId: actorUserId, fromRoleKey, toUserId: input.toUserId }
      ];
      nextNodes[instance.currentNodeIndex] = { ...currentNode, assignments: nextAssignments };

      const updated = await tx.approvalInstance.update({
        where: { id: instance.id },
        data: { frozenNodes: nextNodes as unknown as Prisma.InputJsonValue }
      });

      await tx.approvalActionLog.create({
        data: {
          approvalInstanceId: instance.id,
          action: kind,
          actorUserId
        }
      });

      if (kind === "delegate") {
        const startsAt = new Date();
        await tx.approvalDelegation.create({
          data: {
            fromUserId: actorUserId,
            toUserId: input.toUserId,
            startsAt,
            // ponytail: 临时台账窗口；全局委托管理上线后由其维护 endsAt。
            endsAt: new Date(startsAt.getTime() + 30 * 24 * 60 * 60 * 1000)
          }
        });
      }

      await this.audit.record(tx, {
        actorUserId,
        action: `payment.approval.${kind}`,
        businessType: "payment_request",
        businessId: payment.id,
        metadata: {
          nodeName: currentNode.name,
          fromRoleKey,
          toUserId: input.toUserId
        }
      });

      return updated;
    });
  }
}
