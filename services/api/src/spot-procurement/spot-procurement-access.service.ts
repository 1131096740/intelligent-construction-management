import { ForbiddenException, Injectable } from "@nestjs/common";
import { type Prisma } from "@prisma/client";
import {
  resolveEffectiveRoleKeys,
  type RoleKey
} from "@jiangkong/shared-domain";
import { PrismaService } from "../database/prisma.service";
import { SPOT_PROCUREMENT_BUSINESS_TYPES } from "./spot-procurement.constants";

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

  async requireReceiptProjectId(receiptId: string): Promise<never> {
    // Task 7B: material receipt/delegate models do not exist yet. Never infer
    // a project from request payloads while the real resource cannot be read.
    void receiptId;
    throw new ForbiddenException(RESOURCE_FORBIDDEN_MESSAGE);
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
    const [attachmentBindings, directPaymentBindings, voucherBindings, directPdfBindings] =
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
        client.pdfDocument.findMany({
          where: {
            fileId,
            businessType: {
              in: [
                SPOT_PROCUREMENT_BUSINESS_TYPES.application,
                SPOT_PROCUREMENT_BUSINESS_TYPES.payment
              ]
            }
          },
          select: { businessType: true, businessId: true, templateKey: true }
        })
      ]);
    const replacementChain = directPdfBindings.length
      ? { descendantFileIds: [] as string[], overflow: false }
      : await this.findReplacementDescendantFileIds(client, fileId);
    if (replacementChain.overflow) return "denied";
    const pdfBindings = directPdfBindings.length
      ? directPdfBindings
      : replacementChain.descendantFileIds.length
        ? await client.pdfDocument.findMany({
            where: {
              fileId: { in: replacementChain.descendantFileIds },
              businessType: {
                in: [
                  SPOT_PROCUREMENT_BUSINESS_TYPES.application,
                  SPOT_PROCUREMENT_BUSINESS_TYPES.payment
                ]
              }
            },
            select: { businessType: true, businessId: true, templateKey: true }
          })
        : [];

    const bound =
      attachmentBindings.length > 0 ||
      directPaymentBindings.length > 0 ||
      voucherBindings.length > 0 ||
      pdfBindings.length > 0;
    if (!bound) return "not_spot";

    const versionIds = new Set(attachmentBindings.map((binding) => binding.versionId));
    const paymentIds = new Set([
      ...directPaymentBindings.map((binding) => binding.id),
      ...voucherBindings.map((binding) => binding.paymentId)
    ]);
    for (const pdf of pdfBindings) {
      if (pdf.businessType === SPOT_PROCUREMENT_BUSINESS_TYPES.application) {
        versionIds.add(pdf.businessId);
      } else if (pdf.businessType === SPOT_PROCUREMENT_BUSINESS_TYPES.payment) {
        paymentIds.add(pdf.businessId);
      }
    }

    return this.resolveBoundBusinessAccess(
      client,
      actorUserId,
      versionIds,
      paymentIds,
      new Set(pdfBindings.map((pdf) => `${pdf.businessType}:${pdf.businessId}`)),
      new Set(voucherBindings.map((binding) => binding.executedByUserId))
    );
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
}
