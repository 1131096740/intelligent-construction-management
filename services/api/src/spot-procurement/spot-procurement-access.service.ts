import { ForbiddenException, Injectable } from "@nestjs/common";
import { type Prisma } from "@prisma/client";
import {
  resolveEffectiveRoleKeys,
  type RoleKey
} from "@jiangkong/shared-domain";
import { PrismaService } from "../database/prisma.service";
import {
  SPOT_PROCUREMENT_BUSINESS_TYPES,
  SPOT_PROCUREMENT_RECEIPT_PDF_TEMPLATE_KEY
} from "./spot-procurement.constants";
import {
  isCurrentFormalReceiptPdfFact,
  RECEIPT_PDF_REFRESH_ACTION
} from "./spot-procurement-receipt-pdf-facts";

export type SpotProcurementFileAccessDecision =
  | "not_spot"
  | "allowed"
  | "denied";
export type SpotProcurementBusinessAccessDecision = "allowed" | "denied";

type AccessClient = PrismaService | Prisma.TransactionClient;

const APPLICATION_PROJECT_ROLES = new Set<RoleKey>([
  "material_director",
  "project_manager"
]);
const PAYMENT_PROJECT_ROLES = new Set<RoleKey>([
  "comprehensive_director",
  "project_manager",
  "finance_director"
]);
const RECEIPT_PROJECT_ROLES = new Set<RoleKey>(["material_director"]);
const INVOICE_EVIDENCE_PROJECT_ROLES = new Set<RoleKey>([
  "material_staff",
  "material_director",
  "finance_staff",
  "finance_director"
]);
const PAYMENT_EXECUTOR_VISIBLE_STATUSES = new Set([
  "approved_pending_payment",
  "partially_paid"
]);
const FINAL_OR_ROLES = new Set<RoleKey>(["chairman", "general_manager"]);
const REVIEW_ACTIONS = [
  "approve",
  "reject",
  "reject_previous",
  "return_to_applicant"
] as const;
const RESOURCE_FORBIDDEN_MESSAGE = "零星采购资源不存在或当前账号无权访问";

function currentNodeRoleKeys(frozenNodes: Prisma.JsonValue, currentNodeIndex: number) {
  if (!Array.isArray(frozenNodes)) return [];
  const current = frozenNodes[currentNodeIndex];
  if (!current || typeof current !== "object" || Array.isArray(current)) return [];
  const roleKeys = (current as { roleKeys?: unknown }).roleKeys;
  return Array.isArray(roleKeys)
    ? roleKeys.filter((roleKey): roleKey is RoleKey => typeof roleKey === "string")
    : [];
}

function frozenNodeRoleKeys(frozenNodes: Prisma.JsonValue) {
  if (!Array.isArray(frozenNodes)) return [];
  return frozenNodes.flatMap((node) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return [];
    const roleKeys = (node as { roleKeys?: unknown }).roleKeys;
    return Array.isArray(roleKeys)
      ? roleKeys.filter((roleKey): roleKey is RoleKey => typeof roleKey === "string")
      : [];
  });
}

@Injectable()
export class SpotProcurementAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async requireProcurementProjectId(procurementId: string): Promise<string> {
    const procurement = await this.prisma.spotProcurement.findUnique({
      where: { id: procurementId },
      select: { projectId: true }
    });
    if (!procurement) throw new ForbiddenException(RESOURCE_FORBIDDEN_MESSAGE);
    return procurement.projectId;
  }

  async findPaymentProjectId(paymentId: string): Promise<string | null> {
    const payment = await this.prisma.spotProcurementPayment.findUnique({
      where: { id: paymentId },
      select: { projectId: true }
    });
    return payment?.projectId ?? null;
  }

  async requirePaymentProjectId(paymentId: string): Promise<string> {
    const projectId = await this.findPaymentProjectId(paymentId);
    if (!projectId) throw new ForbiddenException(RESOURCE_FORBIDDEN_MESSAGE);
    return projectId;
  }

  async requireReceiptProjectId(receiptId: string): Promise<string> {
    const receipt = await this.prisma.spotProcurementReceipt.findUnique({
      where: { id: receiptId },
      select: { projectId: true }
    });
    if (!receipt) throw new ForbiddenException(RESOURCE_FORBIDDEN_MESSAGE);
    return receipt.projectId;
  }

  async requireInvoiceAllocationProjectId(
    allocationId: string
  ): Promise<string> {
    const allocation = await this.prisma.invoiceAllocation.findUnique({
      where: { id: allocationId },
      select: { projectId: true }
    });
    if (!allocation) {
      throw new ForbiddenException(RESOURCE_FORBIDDEN_MESSAGE);
    }
    return allocation.projectId;
  }

  async accessibleProcurementIds(
    procurementIds: readonly string[],
    actorUserId: string,
    client: AccessClient = this.prisma
  ): Promise<Set<string>> {
    const requestedIds = [...new Set(procurementIds)];
    if (!requestedIds.length) return new Set();

    const procurements = await client.spotProcurement.findMany({
      where: { id: { in: requestedIds } },
      select: {
        id: true,
        projectId: true,
        applicantUserId: true,
        handlerUserId: true
      }
    });
    if (!procurements.length) return new Set();

    const existingIds = procurements.map((procurement) => procurement.id);
    const versions = await client.spotProcurementVersion.findMany({
      where: { procurementId: { in: existingIds } },
      select: { id: true, procurementId: true, handlerUserId: true }
    });
    const approvals = versions.length
      ? await client.approvalInstance.findMany({
          where: {
            OR: versions.map((version) => ({
              businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.application,
              businessId: version.id
            }))
          },
          select: {
            id: true,
            businessType: true,
            businessId: true,
            status: true,
            currentNodeIndex: true,
            frozenNodes: true,
            applicantUserId: true
          }
        })
      : [];
    const actions = approvals.length
      ? await client.approvalActionLog.findMany({
          where: {
            approvalInstanceId: { in: approvals.map((approval) => approval.id) },
            actorUserId
          },
          select: { approvalInstanceId: true, actorUserId: true, action: true }
        })
      : [];

    const allowedIds = new Set<string>();
    for (const procurement of procurements) {
      if (
        procurement.applicantUserId === actorUserId ||
        procurement.handlerUserId === actorUserId
      ) {
        allowedIds.add(procurement.id);
      }
    }
    for (const version of versions) {
      if (version.handlerUserId === actorUserId) {
        allowedIds.add(version.procurementId);
      }
    }

    const procurementIdByVersionId = new Map(
      versions.map((version) => [version.id, version.procurementId])
    );
    const approvalById = new Map(approvals.map((approval) => [approval.id, approval]));
    for (const action of actions) {
      const approval = approvalById.get(action.approvalInstanceId);
      const procurementId = approval
        ? procurementIdByVersionId.get(approval.businessId)
        : undefined;
      if (procurementId) allowedIds.add(procurementId);
    }

    const requiredRolesByProcurementId = new Map<string, Set<RoleKey>>();
    for (const approval of approvals) {
      const procurementId = procurementIdByVersionId.get(approval.businessId);
      if (!procurementId) continue;
      const requiredRoles = requiredRolesByProcurementId.get(procurementId) ?? new Set<RoleKey>();
      for (const roleKey of frozenNodeRoleKeys(approval.frozenNodes)) {
        if (APPLICATION_PROJECT_ROLES.has(roleKey)) requiredRoles.add(roleKey);
      }
      requiredRolesByProcurementId.set(procurementId, requiredRoles);
    }

    const effectiveRolesByProjectId = await this.loadEffectiveRoleKeysByProject(
      client,
      actorUserId,
      procurements.map((procurement) => procurement.projectId)
    );
    for (const procurement of procurements) {
      const requiredRoles = requiredRolesByProcurementId.get(procurement.id);
      if (
        requiredRoles?.size &&
        (effectiveRolesByProjectId.get(procurement.projectId) ?? []).some((roleKey) =>
          requiredRoles.has(roleKey)
        )
      ) {
        allowedIds.add(procurement.id);
      }
    }

    return allowedIds;
  }

  async accessiblePaymentIds(
    paymentIds: readonly string[],
    actorUserId: string,
    client: AccessClient = this.prisma
  ): Promise<Set<string>> {
    const requestedIds = [...new Set(paymentIds)];
    if (!requestedIds.length) return new Set();

    const payments = await client.spotProcurementPayment.findMany({
      where: { id: { in: requestedIds } },
      select: {
        id: true,
        procurementId: true,
        projectId: true,
        handlerUserId: true,
        invalidatedByUserId: true,
        status: true
      }
    });
    if (!payments.length) return new Set();

    const procurementIds = [...new Set(payments.map((payment) => payment.procurementId))];
    const procurements = await client.spotProcurement.findMany({
      where: { id: { in: procurementIds } },
      select: {
        id: true,
        projectId: true,
        applicantUserId: true,
        handlerUserId: true
      }
    });
    const procurementById = new Map(
      procurements.map((procurement) => [procurement.id, procurement])
    );
    const validPayments = payments.filter((payment) => {
      const procurement = procurementById.get(payment.procurementId);
      return procurement?.projectId === payment.projectId;
    });
    if (!validPayments.length) return new Set();

    const validPaymentIds = validPayments.map((payment) => payment.id);
    const [approvals, executions, reservations, balanceEntries] = await Promise.all([
      client.approvalInstance.findMany({
        where: {
          OR: validPaymentIds.map((paymentId) => ({
            businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.payment,
            businessId: paymentId
          }))
        },
        select: {
          id: true,
          businessType: true,
          businessId: true,
          status: true,
          currentNodeIndex: true,
          frozenNodes: true,
          applicantUserId: true
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }]
      }),
      client.spotProcurementPaymentExecution.findMany({
        where: { paymentId: { in: validPaymentIds } },
        select: {
          paymentId: true,
          executedByUserId: true,
          voidedByUserId: true
        }
      }),
      client.supplierBalanceReservation.findMany({
        where: { paymentId: { in: validPaymentIds } },
        select: {
          paymentId: true,
          reservedByUserId: true,
          executedByUserId: true,
          releasedByUserId: true
        }
      }),
      client.supplierBalanceEntry.findMany({
        where: { paymentId: { in: validPaymentIds } },
        select: { paymentId: true, actorUserId: true }
      })
    ]);
    const actions = approvals.length
      ? await client.approvalActionLog.findMany({
          where: {
            approvalInstanceId: { in: approvals.map((approval) => approval.id) },
            actorUserId
          },
          select: { approvalInstanceId: true, actorUserId: true, action: true }
        })
      : [];

    const allowedIds = new Set<string>();
    for (const payment of validPayments) {
      const procurement = procurementById.get(payment.procurementId)!;
      if (
        procurement.applicantUserId === actorUserId ||
        procurement.handlerUserId === actorUserId ||
        payment.handlerUserId === actorUserId ||
        payment.invalidatedByUserId === actorUserId
      ) {
        allowedIds.add(payment.id);
      }
    }
    for (const execution of executions) {
      if (
        execution.executedByUserId === actorUserId ||
        execution.voidedByUserId === actorUserId
      ) {
        allowedIds.add(execution.paymentId);
      }
    }
    for (const reservation of reservations) {
      if (
        reservation.reservedByUserId === actorUserId ||
        reservation.executedByUserId === actorUserId ||
        reservation.releasedByUserId === actorUserId
      ) {
        allowedIds.add(reservation.paymentId);
      }
    }
    for (const entry of balanceEntries) {
      if (entry.paymentId && entry.actorUserId === actorUserId) {
        allowedIds.add(entry.paymentId);
      }
    }

    const approvalById = new Map(approvals.map((approval) => [approval.id, approval]));
    for (const action of actions) {
      const approval = approvalById.get(action.approvalInstanceId);
      if (approval) allowedIds.add(approval.businessId);
    }

    const requiredRolesByPaymentId = new Map<string, Set<RoleKey>>();
    for (const approval of approvals) {
      const requiredRoles = requiredRolesByPaymentId.get(approval.businessId) ?? new Set<RoleKey>();
      for (const roleKey of frozenNodeRoleKeys(approval.frozenNodes)) {
        if (PAYMENT_PROJECT_ROLES.has(roleKey)) requiredRoles.add(roleKey);
      }
      requiredRolesByPaymentId.set(approval.businessId, requiredRoles);
    }

    const projectIds = validPayments.map((payment) => payment.projectId);
    const globalRoleKeys = await this.loadPositionRoleKeys(client, actorUserId, null);
    const projectRolesByProjectId = new Map<string, RoleKey[]>();
    const effectiveRolesByProjectId = await this.loadEffectiveRoleKeysByProject(
      client,
      actorUserId,
      projectIds,
      globalRoleKeys,
      projectRolesByProjectId
    );
    for (const payment of validPayments) {
      const requiredRoles = requiredRolesByPaymentId.get(payment.id);
      if (
        requiredRoles?.size &&
        (effectiveRolesByProjectId.get(payment.projectId) ?? []).some((roleKey) =>
          requiredRoles.has(roleKey)
        )
      ) {
        allowedIds.add(payment.id);
      }
      if (
        PAYMENT_EXECUTOR_VISIBLE_STATUSES.has(payment.status) &&
        (projectRolesByProjectId.get(payment.projectId) ?? []).includes(
          "finance_staff"
        )
      ) {
        allowedIds.add(payment.id);
      }
    }

    const latestApprovalByBusinessId = new Map<
      string,
      (typeof approvals)[number]
    >();
    for (const approval of approvals) {
      if (!latestApprovalByBusinessId.has(approval.businessId)) {
        latestApprovalByBusinessId.set(
          approval.businessId,
          approval
        );
      }
    }
    const actorFinalRoles = globalRoleKeys.filter((roleKey) => FINAL_OR_ROLES.has(roleKey));
    if (actorFinalRoles.length) {
      for (const approval of latestApprovalByBusinessId.values()) {
        if (
          approval.status === "approval_pending" &&
          currentNodeRoleKeys(approval.frozenNodes, approval.currentNodeIndex).some((roleKey) =>
            actorFinalRoles.includes(roleKey)
          )
        ) {
          allowedIds.add(approval.businessId);
        }
      }
    }

    return allowedIds;
  }

  async accessibleReceiptIds(
    receiptIds: readonly string[],
    actorUserId: string,
    client: AccessClient = this.prisma
  ): Promise<Set<string>> {
    const requestedIds = [...new Set(receiptIds)];
    if (!requestedIds.length) return new Set();

    const receipts = await client.spotProcurementReceipt.findMany({
      where: { id: { in: requestedIds } },
      select: {
        id: true,
        projectId: true,
        procurementId: true,
        handlerUserId: true
      }
    });
    if (!receipts.length) return new Set();

    const procurements = await client.spotProcurement.findMany({
      where: {
        id: { in: [...new Set(receipts.map((receipt) => receipt.procurementId))] }
      },
      select: {
        id: true,
        projectId: true,
        applicantUserId: true,
        handlerUserId: true
      }
    });
    const procurementById = new Map(
      procurements.map((procurement) => [procurement.id, procurement])
    );
    const validReceipts = receipts.filter(
      (receipt) =>
        procurementById.get(receipt.procurementId)?.projectId === receipt.projectId
    );
    if (!validReceipts.length) return new Set();

    const allowedIds = new Set<string>();
    for (const receipt of validReceipts) {
      const procurement = procurementById.get(receipt.procurementId)!;
      if (
        procurement.applicantUserId === actorUserId ||
        receipt.handlerUserId === actorUserId
      ) {
        allowedIds.add(receipt.id);
      }
    }

    const effectiveRolesByProjectId = await this.loadEffectiveRoleKeysByProject(
      client,
      actorUserId,
      validReceipts.map((receipt) => receipt.projectId)
    );
    for (const receipt of validReceipts) {
      if (
        (effectiveRolesByProjectId.get(receipt.projectId) ?? []).some((roleKey) =>
          RECEIPT_PROJECT_ROLES.has(roleKey)
        )
      ) {
        allowedIds.add(receipt.id);
      }
    }

    const delegations = await client.spotProcurementReceiptDelegation.findMany({
      where: {
        receiptId: { in: validReceipts.map((receipt) => receipt.id) },
        delegateUserId: actorUserId,
        revokedAt: null
      },
      select: {
        receiptId: true,
        delegatorUserId: true,
        delegateUserId: true,
        revokedAt: true
      }
    });
    if (!delegations.length) return allowedIds;

    const actor = await client.user.findUnique({
      where: { id: actorUserId },
      select: { id: true, isActive: true }
    });
    if (!actor?.isActive) return allowedIds;

    const receiptById = new Map(validReceipts.map((receipt) => [receipt.id, receipt]));
    const candidateProjectIds = [
      ...new Set(
        delegations.flatMap((delegation) => {
          const receipt = receiptById.get(delegation.receiptId);
          return receipt && delegation.delegatorUserId === receipt.handlerUserId
            ? [receipt.projectId]
            : [];
        })
      )
    ];
    const affiliatedProjectIds = new Set<string>();
    for (const projectId of candidateProjectIds) {
      const [positions, memberships, rosterMemberships] = await Promise.all([
        client.userPosition.findMany({
          where: { userId: actorUserId, projectId },
          select: { id: true }
        }),
        client.projectMember.findMany({
          where: { userId: actorUserId, projectId },
          select: { id: true }
        }),
        client.projectRosterMember.findMany({
          where: { userId: actorUserId, projectId },
          select: { id: true }
        })
      ]);
      if (positions.length || memberships.length || rosterMemberships.length) {
        affiliatedProjectIds.add(projectId);
      }
    }

    for (const delegation of delegations) {
      const receipt = receiptById.get(delegation.receiptId);
      if (
        receipt &&
        delegation.delegatorUserId === receipt.handlerUserId &&
        affiliatedProjectIds.has(receipt.projectId)
      ) {
        allowedIds.add(receipt.id);
      }
    }

    return allowedIds;
  }

  async resolveProcurementViewAccess(
    procurementId: string,
    actorUserId: string,
    client: AccessClient = this.prisma
  ): Promise<SpotProcurementBusinessAccessDecision> {
    const accessibleIds = await this.accessibleProcurementIds(
      [procurementId],
      actorUserId,
      client
    );
    return accessibleIds.has(procurementId) ? "allowed" : "denied";
  }

  async resolvePaymentViewAccess(
    paymentId: string,
    actorUserId: string,
    client: AccessClient = this.prisma
  ): Promise<SpotProcurementBusinessAccessDecision> {
    const accessibleIds = await this.accessiblePaymentIds(
      [paymentId],
      actorUserId,
      client
    );
    return accessibleIds.has(paymentId) ? "allowed" : "denied";
  }

  async resolveReceiptViewAccess(
    receiptId: string,
    actorUserId: string,
    client: AccessClient = this.prisma
  ): Promise<SpotProcurementBusinessAccessDecision> {
    const accessibleIds = await this.accessibleReceiptIds(
      [receiptId],
      actorUserId,
      client
    );
    return accessibleIds.has(receiptId) ? "allowed" : "denied";
  }

  async resolveBusinessDownloadAccess(
    businessType: string,
    businessId: string,
    actorUserId: string,
    client: AccessClient = this.prisma
  ): Promise<SpotProcurementBusinessAccessDecision> {
    const versionIds = new Set<string>();
    const paymentIds = new Set<string>();
    if (businessType === SPOT_PROCUREMENT_BUSINESS_TYPES.application) {
      versionIds.add(businessId);
    } else if (businessType === SPOT_PROCUREMENT_BUSINESS_TYPES.payment) {
      paymentIds.add(businessId);
    } else if (businessType === SPOT_PROCUREMENT_BUSINESS_TYPES.receipt) {
      const bindings = await client.pdfDocument.findMany({
        where: {
          businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.receipt,
          businessId,
          templateKey:
            SPOT_PROCUREMENT_RECEIPT_PDF_TEMPLATE_KEY
        },
        select: {
          id: true,
          fileId: true,
          businessType: true,
          businessId: true,
          templateKey: true
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 2
      });
      if (bindings.length !== 1) return "denied";
      return this.resolveFormalReceiptPdfAccess(
        client,
        actorUserId,
        bindings[0]
      );
    } else {
      return "denied";
    }

    return this.resolveBoundBusinessAccess(
      client,
      actorUserId,
      versionIds,
      paymentIds,
      new Set([`${businessType}:${businessId}`])
    );
  }

  async resolveFileDownloadAccess(
    fileId: string,
    actorUserId: string,
    client: AccessClient = this.prisma
  ): Promise<SpotProcurementFileAccessDecision> {
    const [
      attachmentBindings,
      directPaymentBindings,
      legacyVoucherBindings,
      paymentInvoiceBindings,
      refundBindings,
      directPdfBindings,
      receiptPhotoBindings,
      invoiceRecordBindings,
      noInvoiceBindings,
      invoiceExceptionBindings
    ] =
      await Promise.all([
        client.spotProcurementAttachment.findMany({
          where: { fileId },
          select: { versionId: true }
        }),
        client.spotProcurementPayment.findMany({
          where: {
            OR: [
              { supportingAttachmentFileId: fileId },
              { merchantPaymentProofFileId: fileId }
            ]
          },
          select: {
            id: true,
            procurementId: true,
            projectId: true,
            handlerUserId: true
          }
        }),
        client.spotProcurementPaymentExecution.findMany({
          where: { voucherFileId: fileId },
          select: { paymentId: true, executedByUserId: true, voidedAt: true }
        }),
        client.spotProcurementPaymentInvoice.findMany({
          where: { fileId },
          select: {
            paymentId: true,
            uploadedByUserId: true,
            invalidatedByUserId: true
          }
        }),
        client.spotProcurementRefund.findMany({
          where: { voucherFileId: fileId },
          select: {
            id: true,
            discrepancyId: true,
            procurementId: true,
            recordedByUserId: true
          },
          take: 2
        }),
        client.pdfDocument.findMany({
          where: {
            fileId,
            businessType: {
              in: [
                SPOT_PROCUREMENT_BUSINESS_TYPES.application,
                SPOT_PROCUREMENT_BUSINESS_TYPES.payment,
                SPOT_PROCUREMENT_BUSINESS_TYPES.receipt
              ]
            }
          },
          select: {
            id: true,
            fileId: true,
            businessType: true,
            businessId: true,
            templateKey: true
          }
        }),
        client.spotProcurementReceiptPhoto.findMany({
          where: {
            OR: [{ originalFileId: fileId }, { watermarkedFileId: fileId }]
          },
          select: { receiptId: true }
        }),
        client.invoiceRecord.findMany({
          where: { fileId },
          select: {
            id: true,
            projectId: true,
            sourceBusinessType: true,
            sourceBusinessId: true,
            sourceProcurementId: true,
            uploadedByUserId: true,
            invalidatedByUserId: true
          },
          take: 2
        }),
        client.noInvoiceConfirmation.findMany({
          where: { proofFileId: fileId },
          select: {
            id: true,
            projectId: true,
            procurementId: true,
            submittedByUserId: true,
            reviewedByUserId: true,
            reversedByUserId: true
          },
          take: 2
        }),
        client.invoiceExceptionConfirmation.findMany({
          where: { proofFileId: fileId },
          select: {
            id: true,
            projectId: true,
            procurementId: true,
            submittedByUserId: true,
            reviewedByUserId: true,
            reversedByUserId: true
          },
          take: 2
        })
      ]);
    const executionVoucherBindings =
      await client.spotProcurementPaymentExecutionVoucher.findMany({
        where: { fileId },
        select: { paymentExecutionId: true }
      });
    const executionVoucherIds = executionVoucherBindings.map(
      (binding) => binding.paymentExecutionId
    );
    const executionVoucherExecutions = executionVoucherIds.length
      ? await client.spotProcurementPaymentExecution.findMany({
          where: { id: { in: executionVoucherIds } },
          select: { paymentId: true, executedByUserId: true, voidedAt: true }
        })
      : [];
    const voucherBindings = [
      ...legacyVoucherBindings,
      ...executionVoucherExecutions
    ];
    const replacementChain = await this.findReplacementDescendantFileIds(
      client,
      fileId
    );
    if (replacementChain.overflow) return "denied";
    const replacementPdfBindings = replacementChain.descendantFileIds.length
      ? await client.pdfDocument.findMany({
          where: {
            fileId: { in: replacementChain.descendantFileIds },
            businessType: {
              in: [
                SPOT_PROCUREMENT_BUSINESS_TYPES.application,
                SPOT_PROCUREMENT_BUSINESS_TYPES.payment,
                SPOT_PROCUREMENT_BUSINESS_TYPES.receipt
              ]
            }
          },
          select: {
            id: true,
            fileId: true,
            businessType: true,
            businessId: true,
            templateKey: true
          }
        })
      : [];
    const pdfBindings = [...directPdfBindings, ...replacementPdfBindings];

    const bound =
      attachmentBindings.length > 0 ||
      directPaymentBindings.length > 0 ||
      voucherBindings.length > 0 ||
      paymentInvoiceBindings.length > 0 ||
      refundBindings.length > 0 ||
      pdfBindings.length > 0 ||
      receiptPhotoBindings.length > 0 ||
      invoiceRecordBindings.length > 0 ||
      noInvoiceBindings.length > 0 ||
      invoiceExceptionBindings.length > 0;
    if (!bound) return "not_spot";

    const evidenceBindings = [
      ...invoiceRecordBindings.map((binding) => ({
        kind: "invoice" as const,
        projectId: binding.projectId,
        procurementId: binding.sourceProcurementId,
        sourceBusinessType: binding.sourceBusinessType,
        sourceBusinessId: binding.sourceBusinessId,
        participantUserIds: [
          binding.uploadedByUserId,
          binding.invalidatedByUserId
        ]
      })),
      ...noInvoiceBindings.map((binding) => ({
        kind: "no_invoice" as const,
        projectId: binding.projectId,
        procurementId: binding.procurementId,
        sourceBusinessType: null,
        sourceBusinessId: null,
        participantUserIds: [
          binding.submittedByUserId,
          binding.reviewedByUserId,
          binding.reversedByUserId
        ]
      })),
      ...invoiceExceptionBindings.map((binding) => ({
        kind: "invoice_exception" as const,
        projectId: binding.projectId,
        procurementId: binding.procurementId,
        sourceBusinessType: null,
        sourceBusinessId: null,
        participantUserIds: [
          binding.submittedByUserId,
          binding.reviewedByUserId,
          binding.reversedByUserId
        ]
      }))
    ];
    if (evidenceBindings.length > 0) {
      const hasOtherSpotBinding =
        attachmentBindings.length > 0 ||
        directPaymentBindings.length > 0 ||
        voucherBindings.length > 0 ||
        paymentInvoiceBindings.length > 0 ||
        refundBindings.length > 0 ||
        pdfBindings.length > 0 ||
        receiptPhotoBindings.length > 0;
      if (evidenceBindings.length !== 1 || hasOtherSpotBinding) {
        return "denied";
      }
      return this.resolveInvoiceEvidenceAccess(
        client,
        actorUserId,
        evidenceBindings[0]
      );
    }

    const receiptPhotoIds = new Set(
      receiptPhotoBindings.map((binding) => binding.receiptId)
    );
    const receiptPdfBindings = pdfBindings.filter(
      (binding) =>
        binding.businessType === SPOT_PROCUREMENT_BUSINESS_TYPES.receipt
    );
    const approvalPdfBindings = pdfBindings.filter(
      (binding) =>
        binding.businessType !== SPOT_PROCUREMENT_BUSINESS_TYPES.receipt
    );
    if (
      receiptPdfBindings.some(
        (binding) =>
          binding.templateKey !==
          SPOT_PROCUREMENT_RECEIPT_PDF_TEMPLATE_KEY
      )
    ) {
      return "denied";
    }

    const hasNonPdfBusinessBinding =
      attachmentBindings.length > 0 ||
      directPaymentBindings.length > 0 ||
      voucherBindings.length > 0 ||
      paymentInvoiceBindings.length > 0 ||
      refundBindings.length > 0;
    if (
      receiptPhotoIds.size > 1 ||
      (receiptPhotoIds.size > 0 &&
        (hasNonPdfBusinessBinding || pdfBindings.length > 0))
    ) {
      return "denied";
    }

    if (receiptPdfBindings.length > 0) {
      if (
        receiptPdfBindings.length !== 1 ||
        approvalPdfBindings.length > 0 ||
        hasNonPdfBusinessBinding
      ) {
        return "denied";
      }
      return this.resolveFormalReceiptPdfAccess(
        client,
        actorUserId,
        receiptPdfBindings[0]
      );
    }

    if (refundBindings.length > 0) {
      if (
        refundBindings.length !== 1 ||
        attachmentBindings.length > 0 ||
        directPaymentBindings.length > 0 ||
        voucherBindings.length > 0 ||
        paymentInvoiceBindings.length > 0 ||
        pdfBindings.length > 0 ||
        receiptPhotoBindings.length > 0
      ) {
        return "denied";
      }

      const refund = refundBindings[0];
      const discrepancies = await client.spotProcurementDiscrepancy.findMany({
        where: { id: { in: [refund.discrepancyId] } },
        select: { id: true, procurementId: true }
      });
      if (
        discrepancies.length !== 1 ||
        discrepancies[0].procurementId !== refund.procurementId
      ) {
        return "denied";
      }
      if (refund.recordedByUserId === actorUserId) {
        return "allowed";
      }

      const accessibleProcurementIds = await this.accessibleProcurementIds(
        [refund.procurementId],
        actorUserId,
        client
      );
      return accessibleProcurementIds.has(refund.procurementId)
        ? "allowed"
        : "denied";
    }

    const formalPdfBusinessKeys = new Set(
      approvalPdfBindings.map(
        (binding) => `${binding.businessType}:${binding.businessId}`
      )
    );
    if (formalPdfBusinessKeys.size > 1) return "denied";

    if (receiptPhotoIds.size) {
      const accessibleReceiptIds = await this.accessibleReceiptIds(
        [...receiptPhotoIds],
        actorUserId,
        client
      );
      return [...receiptPhotoIds].every((receiptId) =>
        accessibleReceiptIds.has(receiptId)
      )
        ? "allowed"
        : "denied";
    }

    if (!hasNonPdfBusinessBinding && !approvalPdfBindings.length) {
      return "denied";
    }

    const versionIds = new Set(attachmentBindings.map((binding) => binding.versionId));
    const paymentIds = new Set([
      ...directPaymentBindings.map((binding) => binding.id),
      ...voucherBindings.map((binding) => binding.paymentId),
      ...paymentInvoiceBindings.map((binding) => binding.paymentId)
    ]);
    for (const pdf of approvalPdfBindings) {
      if (pdf.businessType === SPOT_PROCUREMENT_BUSINESS_TYPES.application) {
        versionIds.add(pdf.businessId);
      } else if (pdf.businessType === SPOT_PROCUREMENT_BUSINESS_TYPES.payment) {
        paymentIds.add(pdf.businessId);
      }
    }
    if (versionIds.size > 0 && paymentIds.size > 0) return "denied";

    return this.resolveBoundBusinessAccess(
      client,
      actorUserId,
      versionIds,
      paymentIds,
      formalPdfBusinessKeys,
      new Set([
        ...voucherBindings.map((binding) => binding.executedByUserId),
        ...paymentInvoiceBindings.flatMap((binding) => [
          binding.uploadedByUserId,
          binding.invalidatedByUserId
        ])
      ].filter((userId): userId is string => Boolean(userId)))
    );
  }

  private async resolveFormalReceiptPdfAccess(
    client: AccessClient,
    actorUserId: string,
    binding: {
      id: string;
      fileId: string;
      businessType: string;
      businessId: string;
      templateKey: string;
    }
  ): Promise<SpotProcurementBusinessAccessDecision> {
    if (
      binding.businessType !== SPOT_PROCUREMENT_BUSINESS_TYPES.receipt ||
      binding.templateKey !==
        SPOT_PROCUREMENT_RECEIPT_PDF_TEMPLATE_KEY
    ) {
      return "denied";
    }

    const receipt = await client.spotProcurementReceipt.findUnique({
      where: { id: binding.businessId },
      select: { id: true, status: true, currentRevisionNo: true }
    });
    if (
      !receipt ||
      !Number.isSafeInteger(receipt.currentRevisionNo) ||
      receipt.currentRevisionNo <= 0
    ) {
      return "denied";
    }

    const [reviews, latestRefresh] = await Promise.all([
      client.spotProcurementReceiptReview.findMany({
        where: { receiptId: receipt.id },
        select: {
          id: true,
          receiptRevisionNo: true,
          decision: true
        },
        orderBy: [{ sequenceNo: "asc" }, { id: "asc" }]
      }),
      client.auditLog.findFirst({
        where: {
          action: RECEIPT_PDF_REFRESH_ACTION,
          businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.receipt,
          businessId: receipt.id
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { metadata: true }
      })
    ]);
    const latestReview = reviews.at(-1);
    if (
      !latestReview ||
      !isCurrentFormalReceiptPdfFact({
        binding,
        receipt,
        latestReview,
        refreshMetadata: latestRefresh?.metadata
      })
    ) {
      return "denied";
    }

    const accessibleReceiptIds = await this.accessibleReceiptIds(
      [receipt.id],
      actorUserId,
      client
    );
    return accessibleReceiptIds.has(receipt.id) ? "allowed" : "denied";
  }

  private async resolveInvoiceEvidenceAccess(
    client: AccessClient,
    actorUserId: string,
    binding: {
      kind: "invoice" | "no_invoice" | "invoice_exception";
      projectId: string;
      procurementId: string | null;
      sourceBusinessType: string | null;
      sourceBusinessId: string | null;
      participantUserIds: Array<string | null>;
    }
  ): Promise<SpotProcurementBusinessAccessDecision> {
    if (
      !binding.procurementId ||
      (binding.kind === "invoice" &&
        (binding.sourceBusinessType !== "spot_procurement" ||
          binding.sourceBusinessId !== binding.procurementId))
    ) {
      return "denied";
    }

    const procurements = await client.spotProcurement.findMany({
      where: { id: { in: [binding.procurementId] } },
      select: {
        id: true,
        projectId: true,
        applicantUserId: true,
        handlerUserId: true
      }
    });
    if (
      procurements.length !== 1 ||
      procurements[0].projectId !== binding.projectId
    ) {
      return "denied";
    }

    if (binding.participantUserIds.includes(actorUserId)) {
      return "allowed";
    }

    const accessibleProcurements = await this.accessibleProcurementIds(
      [binding.procurementId],
      actorUserId,
      client
    );
    if (accessibleProcurements.has(binding.procurementId)) {
      return "allowed";
    }

    const effectiveRoles = await this.loadEffectiveRoleKeysByProject(
      client,
      actorUserId,
      [binding.projectId]
    );
    return (effectiveRoles.get(binding.projectId) ?? []).some((role) =>
      INVOICE_EVIDENCE_PROJECT_ROLES.has(role)
    )
      ? "allowed"
      : "denied";
  }

  private async resolveBoundBusinessAccess(
    client: AccessClient,
    actorUserId: string,
    versionIds: ReadonlySet<string>,
    paymentIds: ReadonlySet<string>,
    formalPdfBusinessKeys: ReadonlySet<string>,
    directlyAssociatedActorUserIds: ReadonlySet<string> = new Set()
  ): Promise<SpotProcurementBusinessAccessDecision> {
    const [versions, payments] = await Promise.all([
      versionIds.size
        ? client.spotProcurementVersion.findMany({
            where: { id: { in: [...versionIds] } },
            select: { id: true, procurementId: true, handlerUserId: true }
          })
        : Promise.resolve([]),
      paymentIds.size
        ? client.spotProcurementPayment.findMany({
            where: { id: { in: [...paymentIds] } },
            select: {
              id: true,
              procurementId: true,
              projectId: true,
              handlerUserId: true
            }
          })
        : Promise.resolve([])
    ]);
    if (versions.length !== versionIds.size || payments.length !== paymentIds.size) {
      return "denied";
    }

    const procurementIds = new Set([
      ...versions.map((version) => version.procurementId),
      ...payments.map((payment) => payment.procurementId)
    ]);
    const procurements = procurementIds.size
      ? await client.spotProcurement.findMany({
          where: { id: { in: [...procurementIds] } },
          select: {
            id: true,
            projectId: true,
            applicantUserId: true,
            handlerUserId: true
          }
        })
      : [];
    if (!procurements.length || procurements.length !== procurementIds.size) {
      return "denied";
    }

    const approvalBusinessPairs = [
      ...versions.map((version) => ({
        businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.application,
        businessId: version.id
      })),
      ...payments.map((payment) => ({
        businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.payment,
        businessId: payment.id
      }))
    ];
    const approvals = approvalBusinessPairs.length
      ? await client.approvalInstance.findMany({
          where: { OR: approvalBusinessPairs },
          select: {
            id: true,
            businessType: true,
            businessId: true,
            status: true,
            currentNodeIndex: true,
            frozenNodes: true,
            applicantUserId: true,
            updatedAt: true
          },
          orderBy: { updatedAt: "desc" }
        })
      : [];

    // Stored Spot approval forms are formal archive downloads. A pending or
    // orphaned form must not become downloadable through any actor shortcut.
    for (const businessKey of formalPdfBusinessKeys) {
      const separatorIndex = businessKey.indexOf(":");
      const businessType = businessKey.slice(0, separatorIndex);
      const businessId = businessKey.slice(separatorIndex + 1);
      const latest = approvals.find(
        (approval) =>
          approval.businessType === businessType &&
          approval.businessId === businessId
      );
      if (latest?.status !== "approved") return "denied";
    }

    if (
      directlyAssociatedActorUserIds.has(actorUserId) ||
      procurements.some(
        (procurement) =>
          procurement.applicantUserId === actorUserId ||
          procurement.handlerUserId === actorUserId
      ) ||
      versions.some((version) => version.handlerUserId === actorUserId) ||
      payments.some((payment) => payment.handlerUserId === actorUserId)
    ) {
      return "allowed";
    }

    const [allExecutions, balanceReservations, balanceEntries] = paymentIds.size
      ? await Promise.all([
          client.spotProcurementPaymentExecution.findMany({
            where: { paymentId: { in: [...paymentIds] } },
            select: {
              executedByUserId: true,
              voidedByUserId: true
            }
          }),
          client.supplierBalanceReservation.findMany({
            where: { paymentId: { in: [...paymentIds] } },
            select: {
              executedByUserId: true,
              releasedByUserId: true
            }
          }),
          client.supplierBalanceEntry.findMany({
            where: { paymentId: { in: [...paymentIds] } },
            select: { actorUserId: true }
          })
        ])
      : [[], [], []];
    if (
      allExecutions.some(
        (execution) =>
          execution.executedByUserId === actorUserId ||
          execution.voidedByUserId === actorUserId
      ) ||
      balanceReservations.some(
        (reservation) =>
          reservation.executedByUserId === actorUserId ||
          reservation.releasedByUserId === actorUserId
      ) ||
      balanceEntries.some((entry) => entry.actorUserId === actorUserId)
    ) {
      return "allowed";
    }

    if (approvals.length) {
      const actions = await client.approvalActionLog.findMany({
        where: {
          approvalInstanceId: { in: approvals.map((approval) => approval.id) },
          actorUserId,
          action: { in: [...REVIEW_ACTIONS] }
        },
        select: { approvalInstanceId: true, actorUserId: true, action: true }
      });
      if (
        actions.some(
          (action) =>
            action.actorUserId === actorUserId &&
            REVIEW_ACTIONS.includes(action.action as (typeof REVIEW_ACTIONS)[number])
        )
      ) {
        return "allowed";
      }
    }

    const projectIdByProcurementId = new Map(
      procurements.map((procurement) => [procurement.id, procurement.projectId])
    );
    const versionById = new Map(versions.map((version) => [version.id, version]));
    const paymentById = new Map(payments.map((payment) => [payment.id, payment]));
    const workflowProjectRoles = new Map<string, Set<RoleKey>>();
    for (const approval of approvals) {
      const isApplication =
        approval.businessType === SPOT_PROCUREMENT_BUSINESS_TYPES.application;
      const version = isApplication ? versionById.get(approval.businessId) : undefined;
      const payment = isApplication ? undefined : paymentById.get(approval.businessId);
      const projectId = version
        ? projectIdByProcurementId.get(version.procurementId)
        : payment?.projectId;
      if (!projectId) continue;
      const allowedRoles = isApplication
        ? APPLICATION_PROJECT_ROLES
        : PAYMENT_PROJECT_ROLES;
      const roles = workflowProjectRoles.get(projectId) ?? new Set<RoleKey>();
      for (const roleKey of frozenNodeRoleKeys(approval.frozenNodes)) {
        if (allowedRoles.has(roleKey)) roles.add(roleKey);
      }
      workflowProjectRoles.set(projectId, roles);
    }

    const projectIds = [...new Set(procurements.map((procurement) => procurement.projectId))];
    const globalRoleKeys = await this.loadPositionRoleKeys(client, actorUserId, null);
    for (const projectId of projectIds) {
      const projectRoleKeys = [
        ...(await this.loadPositionRoleKeys(client, actorUserId, projectId)),
        ...(await client.projectMember.findMany({
          where: { userId: actorUserId, projectId },
          select: { positionKey: true }
        })).map((membership) => membership.positionKey as RoleKey)
      ];
      const effectiveRoleKeys = resolveEffectiveRoleKeys(
        globalRoleKeys,
        projectRoleKeys
      );
      const requiredRoles = workflowProjectRoles.get(projectId) ?? new Set<RoleKey>();
      if (effectiveRoleKeys.some((role) => requiredRoles.has(role))) {
        return "allowed";
      }
    }

    const actorFinalRoles = globalRoleKeys.filter((role) => FINAL_OR_ROLES.has(role));
    if (actorFinalRoles.length) {
      const activeFinalNode = approvals.some(
        (approval) =>
          approval.businessType === SPOT_PROCUREMENT_BUSINESS_TYPES.payment &&
          approval.status === "approval_pending" &&
          currentNodeRoleKeys(approval.frozenNodes, approval.currentNodeIndex).some((role) =>
            actorFinalRoles.includes(role)
          )
      );
      if (activeFinalNode) return "allowed";
    }

    return "denied";
  }

  private async findReplacementDescendantFileIds(
    client: AccessClient,
    fileId: string
  ): Promise<{ descendantFileIds: string[]; overflow: boolean }> {
    const visited = new Set<string>([fileId]);
    let frontier = [fileId];
    const descendants: string[] = [];
    for (let depth = 0; depth < 128 && frontier.length; depth += 1) {
      const rows = await client.fileObject.findMany({
        where: { supersedesFileObjectId: { in: frontier } },
        select: { id: true }
      });
      const next = rows
        .map((row) => row.id)
        .filter((id) => !visited.has(id));
      for (const id of next) {
        visited.add(id);
        descendants.push(id);
      }
      frontier = next;
    }
    return {
      descendantFileIds: descendants,
      overflow: frontier.length > 0
    };
  }

  private async loadPositionRoleKeys(
    client: AccessClient,
    actorUserId: string,
    projectId: string | null
  ): Promise<RoleKey[]> {
    const assignments = await client.userPosition.findMany({
      where: { userId: actorUserId, projectId },
      select: { positionId: true }
    });
    if (!assignments.length) return [];
    const positions = await client.position.findMany({
      where: { id: { in: assignments.map((assignment) => assignment.positionId) } },
      select: { key: true }
    });
    return positions.map((position) => position.key as RoleKey);
  }

  private async loadEffectiveRoleKeysByProject(
    client: AccessClient,
    actorUserId: string,
    projectIds: readonly string[],
    loadedGlobalRoleKeys?: readonly RoleKey[],
    projectRolesByProjectId?: Map<string, RoleKey[]>
  ): Promise<Map<string, RoleKey[]>> {
    const uniqueProjectIds = [...new Set(projectIds)];
    const globalRoleKeys = loadedGlobalRoleKeys
      ? [...loadedGlobalRoleKeys]
      : await this.loadPositionRoleKeys(client, actorUserId, null);
    const effectiveRolesByProjectId = new Map<string, RoleKey[]>();
    for (const projectId of uniqueProjectIds) {
      const [positionRoleKeys, memberships] = await Promise.all([
        this.loadPositionRoleKeys(client, actorUserId, projectId),
        client.projectMember.findMany({
          where: { userId: actorUserId, projectId },
          select: { positionKey: true }
        })
      ]);
      const projectRoleKeys = [
        ...positionRoleKeys,
        ...memberships.map(
          (membership) => membership.positionKey as RoleKey
        )
      ];
      projectRolesByProjectId?.set(
        projectId,
        [...new Set(projectRoleKeys)]
      );
      effectiveRolesByProjectId.set(
        projectId,
        resolveEffectiveRoleKeys(globalRoleKeys, projectRoleKeys)
      );
    }
    return effectiveRolesByProjectId;
  }
}
