import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  approvalElapsedHours,
  canCreateSettlementFromContractStatus,
  canRemindApproval,
  ContractVersionStatus,
  SettlementStatus,
  type RoleKey
} from "@jiangkong/shared-domain";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { AssignSettlementApprovalDto } from "./dto/assign-settlement-approval.dto";
import { ConfirmSettlementArchiveDto } from "./dto/confirm-settlement-archive.dto";
import { CreateSettlementDto } from "./dto/create-settlement.dto";
import { ReviewSettlementApprovalDto } from "./dto/review-settlement-approval.dto";
import { UploadSettlementArchiveFileDto } from "./dto/upload-settlement-archive-file.dto";

type SettlementContractKind = "material_mechanical" | "labor_professional";

interface SettlementApprovalNode {
  name: string;
  mode: "all" | "any";
  roleKeys: RoleKey[];
  approvedRoleKeys?: RoleKey[];
  assignments?: SettlementApprovalAssignment[];
}

interface SettlementApprovalAssignment {
  kind: "transfer" | "delegate";
  fromUserId: string;
  fromRoleKey: RoleKey;
  toUserId: string;
}

const MATERIAL_MECHANICAL_SETTLEMENT_NODES: SettlementApprovalNode[] = [
  { name: "物资员", mode: "any", roleKeys: ["material_staff"] },
  { name: "物资主管", mode: "any", roleKeys: ["material_director"] },
  { name: "合同部主管 + 预算部主管", mode: "all", roleKeys: ["contract_director", "budget_director"] },
  { name: "项目经理", mode: "any", roleKeys: ["project_manager"] },
  { name: "财务总监", mode: "any", roleKeys: ["finance_director"] }
];

const LABOR_PROFESSIONAL_SETTLEMENT_NODES: SettlementApprovalNode[] = [
  { name: "工长", mode: "any", roleKeys: ["engineering_foreman"] },
  { name: "项目总工", mode: "any", roleKeys: ["engineering_director"] },
  { name: "工程技术部", mode: "any", roleKeys: ["engineering_tech"] },
  { name: "合同部主管 + 预算部主管", mode: "all", roleKeys: ["contract_director", "budget_director"] },
  { name: "项目经理", mode: "any", roleKeys: ["project_manager"] },
  { name: "财务总监", mode: "any", roleKeys: ["finance_director"] }
];

@Injectable()
export class SettlementService {
  constructor(
    private readonly prisma?: PrismaService,
    private readonly audit: AuditService = new AuditService()
  ) {}

  assertContractVersionEffective(status: ContractVersionStatus): void {
    if (!canCreateSettlementFromContractStatus(status)) {
      throw new Error("Cannot create settlement from a non-effective contract version");
    }
  }

  async create(input: CreateSettlementDto, applicantUserId?: string) {
    if (!this.prisma) {
      throw new Error("Prisma service is required to create settlement");
    }

    return this.prisma.$transaction(async (tx) => {
      const version = await tx.contractVersion.findUnique({
        where: { id: input.contractVersionId }
      });

      if (!version) {
        throw new Error("Contract version not found");
      }

      this.assertContractVersionEffective(version.status as ContractVersionStatus);

      const [contract, terms] = await Promise.all([
        tx.contract.findUnique({ where: { id: version.contractId } }),
        tx.paymentTermsVersion.findFirst({
          where: {
            contractVersionId: version.id,
            status: "effective"
          },
          orderBy: { versionNo: "desc" }
        })
      ]);

      if (!contract) {
        throw new Error("Contract not found");
      }

      if (!terms) {
        throw new Error("Effective payment terms version not found");
      }

      const currentSettlementStage = await tx.paymentTermsStage.findFirst({
        where: {
          paymentTermsVersionId: terms.id,
          basis: "current_settlement"
        },
        orderBy: { createdAt: "asc" }
      });
      const payableAmountCents = this.calculatePayableAmount(
        input.amountCents,
        currentSettlementStage?.ratioBps ?? null
      );

      const settlement = await tx.settlement.create({
        data: {
          projectId: contract.projectId,
          contractId: version.contractId,
          contractVersionId: version.id,
          paymentTermsVersionId: terms.id,
          code: input.code,
          periodLabel: input.periodLabel,
          status: "approval_pending",
          amountCents: input.amountCents,
          payableAmountCents,
          paidAmountCents: 0
        }
      });

      if (applicantUserId) {
        await tx.approvalInstance.create({
          data: {
            flowType: "settlement.approve",
            businessType: "settlement",
            businessId: settlement.id,
            status: "in_progress",
            currentNodeIndex: 0,
            frozenNodes: this.settlementApprovalNodesFor(contract) as unknown as Prisma.InputJsonValue,
            applicantUserId
          }
        });
      }

      return settlement;
    });
  }

  private calculatePayableAmount(amountCents: number, ratioBps: number | null): number {
    if (ratioBps === null) {
      return amountCents;
    }

    return Math.floor((amountCents * ratioBps) / 10000);
  }

  async uploadArchiveFile(
    settlementId: string,
    actorUserId: string,
    input: UploadSettlementArchiveFileDto
  ) {
    if (!this.prisma) {
      throw new Error("Prisma service is required to upload settlement archive file");
    }

    return this.prisma.$transaction(async (tx) => {
      const settlement = await tx.settlement.findUnique({
        where: { id: settlementId }
      });

      if (!settlement) {
        throw new Error("Settlement not found");
      }

      if (settlement.status !== "approved_pending_archive") {
        throw new Error(`Cannot upload settlement archive from status ${settlement.status}`);
      }

      const file = await tx.fileObject.findUnique({
        where: { id: input.fileId }
      });

      if (!file) {
        throw new Error("Settlement archive file not found");
      }

      const archiveFile = await tx.settlementArchiveFile.create({
        data: {
          settlementId: settlement.id,
          fileId: input.fileId,
          uploadedByUserId: actorUserId,
          status: "pending_confirm"
        }
      });

      await tx.settlement.update({
        where: { id: settlement.id },
        data: { status: "pending_archive_confirm" satisfies SettlementStatus }
      });

      await this.audit.record(tx, {
        actorUserId,
        action: "settlement.archive.upload",
        businessType: "settlement",
        businessId: settlement.id,
        metadata: {
          fileId: input.fileId,
          archiveFileId: archiveFile.id
        }
      });

      return archiveFile;
    });
  }

  async reviewApproval(
    settlementId: string,
    actorUserId: string,
    input: ReviewSettlementApprovalDto
  ) {
    if (!this.prisma) {
      throw new Error("Prisma service is required to review settlement approval");
    }

    return this.prisma.$transaction(async (tx) => {
      const settlement = await tx.settlement.findUnique({
        where: { id: settlementId }
      });

      if (!settlement) {
        throw new Error("Settlement not found");
      }

      if (settlement.status !== "approval_pending") {
        throw new Error(`Cannot review settlement approval from status ${settlement.status}`);
      }

      const instance = await tx.approvalInstance.findFirst({
        where: {
          businessType: "settlement",
          businessId: settlement.id,
          flowType: "settlement.approve",
          status: "in_progress"
        }
      });

      if (!instance) {
        throw new Error("Settlement approval instance not found");
      }

      const nodes = instance.frozenNodes as unknown as SettlementApprovalNode[];
      const currentNode = nodes[instance.currentNodeIndex];

      if (!currentNode) {
        throw new Error("Settlement approval current node not found");
      }

      const actorRoleKeys = await this.loadActorRoleKeys(tx, actorUserId, settlement.projectId);
      const approvedRoleKey =
        currentNode.roleKeys.find((role) => actorRoleKeys.includes(role)) ??
        currentNode.assignments?.find((assignment) => assignment.toUserId === actorUserId)
          ?.fromRoleKey;

      if (!approvedRoleKey) {
        throw new Error(`Actor cannot approve settlement node ${currentNode.name}`);
      }

      if (input.decision === "reject_previous") {
        if (instance.currentNodeIndex === 0) {
          throw new Error("Cannot reject settlement approval to previous node from first node");
        }

        const previousNodeIndex = instance.currentNodeIndex - 1;
        const nextNodes = nodes.map((node, index) =>
          index === previousNodeIndex || index === instance.currentNodeIndex
            ? { ...node, approvedRoleKeys: [] }
            : node
        );
        const updated = await tx.settlement.update({
          where: { id: settlement.id },
          data: { status: "approval_pending" satisfies SettlementStatus }
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
            actorUserId
          }
        });

        await this.audit.record(tx, {
          actorUserId,
          action: "settlement.approval.reject_previous",
          businessType: "settlement",
          businessId: settlement.id,
          metadata: {
            fromStatus: settlement.status,
            toStatus: "approval_pending",
            fromNodeName: currentNode.name,
            toNodeName: nextNodes[previousNodeIndex].name
          }
        });

        return updated;
      }

      if (input.decision === "return_to_applicant") {
        const updated = await tx.settlement.update({
          where: { id: settlement.id },
          data: { status: "approval_rejected" satisfies SettlementStatus }
        });

        await tx.approvalInstance.update({
          where: { id: instance.id },
          data: { status: "returned_to_applicant" }
        });

        await tx.approvalActionLog.create({
          data: {
            approvalInstanceId: instance.id,
            action: "return_to_applicant",
            actorUserId
          }
        });

        await this.audit.record(tx, {
          actorUserId,
          action: "settlement.approval.return_to_applicant",
          businessType: "settlement",
          businessId: settlement.id,
          metadata: {
            fromStatus: settlement.status,
            toStatus: "approval_rejected",
            nodeName: currentNode.name
          }
        });

        return updated;
      }

      if (input.decision === "reject") {
        const updated = await tx.settlement.update({
          where: { id: settlement.id },
          data: { status: "approval_rejected" satisfies SettlementStatus }
        });

        await tx.approvalInstance.update({
          where: { id: instance.id },
          data: { status: "rejected" }
        });

        await tx.approvalActionLog.create({
          data: {
            approvalInstanceId: instance.id,
            action: "reject",
            actorUserId
          }
        });

        await this.audit.record(tx, {
          actorUserId,
          action: "settlement.approval.reject",
          businessType: "settlement",
          businessId: settlement.id,
          metadata: {
            fromStatus: settlement.status,
            toStatus: "approval_rejected",
            nodeName: currentNode.name
          }
        });

        return updated;
      }

      const nextNodes = [...nodes];
      const nextNode = { ...currentNode };
      const approvedRoleKeys = new Set(nextNode.approvedRoleKeys ?? []);
      approvedRoleKeys.add(approvedRoleKey);
      nextNode.approvedRoleKeys = [...approvedRoleKeys];
      nextNodes[instance.currentNodeIndex] = nextNode;

      const nodeCompleted =
        nextNode.mode === "any" || nextNode.roleKeys.every((role) => approvedRoleKeys.has(role));
      const nextNodeIndex = nodeCompleted ? instance.currentNodeIndex + 1 : instance.currentNodeIndex;
      const flowCompleted = nextNodeIndex >= nextNodes.length;
      const nextStatus = flowCompleted ? "approved_pending_archive" : "approval_pending";
      const updated = await tx.settlement.update({
        where: { id: settlement.id },
        data: { status: nextStatus satisfies SettlementStatus }
      });

      await tx.approvalInstance.update({
        where: { id: instance.id },
        data: {
          currentNodeIndex: nextNodeIndex,
          frozenNodes: nextNodes as unknown as Prisma.InputJsonValue,
          status: flowCompleted ? "approved" : "in_progress"
        }
      });

      await tx.approvalActionLog.create({
        data: {
          approvalInstanceId: instance.id,
          action: "approve",
          actorUserId
        }
      });

      await this.audit.record(tx, {
        actorUserId,
        action: "settlement.approval.approve",
        businessType: "settlement",
        businessId: settlement.id,
        metadata: {
          fromStatus: settlement.status,
          toStatus: nextStatus,
          nodeName: currentNode.name,
          nodeCompleted
        }
      });

      return updated;
    });
  }

  async withdrawApproval(settlementId: string, actorUserId: string) {
    if (!this.prisma) {
      throw new Error("Prisma service is required to withdraw settlement approval");
    }

    return this.prisma.$transaction(async (tx) => {
      const settlement = await tx.settlement.findUnique({
        where: { id: settlementId }
      });

      if (!settlement) {
        throw new Error("Settlement not found");
      }

      if (settlement.status !== "approval_pending") {
        throw new Error(`Cannot withdraw settlement approval from status ${settlement.status}`);
      }

      const instance = await tx.approvalInstance.findFirst({
        where: {
          businessType: "settlement",
          businessId: settlement.id,
          flowType: "settlement.approve",
          status: "in_progress"
        }
      });

      if (!instance) {
        throw new Error("Settlement approval instance not found");
      }

      if (instance.applicantUserId !== actorUserId) {
        throw new Error("Only settlement approval applicant can withdraw");
      }

      const updated = await tx.settlement.update({
        where: { id: settlement.id },
        data: { status: "withdrawn" satisfies SettlementStatus }
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
        action: "settlement.approval.withdraw",
        businessType: "settlement",
        businessId: settlement.id,
        metadata: {
          fromStatus: settlement.status,
          toStatus: "withdrawn",
          applicantUserId: instance.applicantUserId
        }
      });

      return updated;
    });
  }

  async remindApproval(settlementId: string, actorUserId: string, now: Date = new Date()) {
    if (!this.prisma) {
      throw new Error("Prisma service is required to remind settlement approval");
    }

    return this.prisma.$transaction(async (tx) => {
      const settlement = await tx.settlement.findUnique({
        where: { id: settlementId }
      });

      if (!settlement) {
        throw new Error("Settlement not found");
      }

      if (settlement.status !== "approval_pending") {
        throw new Error(`Cannot remind settlement approval from status ${settlement.status}`);
      }

      const instance = await tx.approvalInstance.findFirst({
        where: {
          businessType: "settlement",
          businessId: settlement.id,
          flowType: "settlement.approve",
          status: "in_progress"
        }
      });

      if (!instance) {
        throw new Error("Settlement approval instance not found");
      }

      // 催办由申请人发起，督促当前冻结节点的审批人处理。
      if (instance.applicantUserId !== actorUserId) {
        throw new Error("Only settlement approval applicant can remind");
      }

      const lastRemind = await tx.approvalActionLog.findFirst({
        where: { approvalInstanceId: instance.id, action: "remind" },
        orderBy: { createdAt: "desc" }
      });

      // 催办不改写实例本身（不影响 updatedAt），仅记动作日志；超时与重复节流见 shared-domain。
      if (
        !canRemindApproval({
          status: instance.status,
          lastActivityAt: instance.updatedAt,
          lastRemindedAt: lastRemind?.createdAt ?? null,
          now
        })
      ) {
        throw new Error("Settlement approval is not due for a reminder yet");
      }

      const nodes = instance.frozenNodes as unknown as SettlementApprovalNode[];
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
        action: "settlement.approval.remind",
        businessType: "settlement",
        businessId: settlement.id,
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

  transferApproval(
    settlementId: string,
    actorUserId: string,
    input: AssignSettlementApprovalDto
  ) {
    return this.assignApproval("transfer", settlementId, actorUserId, input);
  }

  delegateApproval(
    settlementId: string,
    actorUserId: string,
    input: AssignSettlementApprovalDto
  ) {
    return this.assignApproval("delegate", settlementId, actorUserId, input);
  }

  async confirmArchiveFile(
    settlementId: string,
    actorUserId: string,
    input: ConfirmSettlementArchiveDto
  ) {
    if (!this.prisma) {
      throw new Error("Prisma service is required to confirm settlement archive file");
    }

    return this.prisma.$transaction(async (tx) => {
      const settlement = await tx.settlement.findUnique({
        where: { id: settlementId }
      });

      if (!settlement) {
        throw new Error("Settlement not found");
      }

      if (settlement.status !== "pending_archive_confirm") {
        throw new Error(`Cannot confirm settlement archive from status ${settlement.status}`);
      }

      const archiveFile = await tx.settlementArchiveFile.findFirst({
        where: {
          id: input.archiveFileId,
          settlementId: settlement.id
        }
      });

      if (!archiveFile) {
        throw new Error("Settlement archive file not found");
      }

      if (archiveFile.status !== "pending_confirm") {
        throw new Error(`Cannot confirm settlement archive file from status ${archiveFile.status}`);
      }

      const confirmedAt = new Date();
      await tx.settlementArchiveFile.update({
        where: { id: archiveFile.id },
        data: {
          confirmedByUserId: actorUserId,
          confirmedAt,
          status: "confirmed"
        }
      });

      const effectiveSettlement = await tx.settlement.update({
        where: { id: settlement.id },
        data: { status: "effective" satisfies SettlementStatus }
      });

      await this.audit.record(tx, {
        actorUserId,
        action: "settlement.archive.confirm",
        businessType: "settlement",
        businessId: settlement.id,
        metadata: {
          archiveFileId: archiveFile.id
        }
      });

      return effectiveSettlement;
    });
  }

  private settlementApprovalNodesFor(contract: { name: string; counterparty: string }) {
    const kind = this.inferSettlementContractKind(contract);
    const nodes =
      kind === "labor_professional"
        ? LABOR_PROFESSIONAL_SETTLEMENT_NODES
        : MATERIAL_MECHANICAL_SETTLEMENT_NODES;

    return nodes.map((node) => ({ ...node, roleKeys: [...node.roleKeys] }));
  }

  private inferSettlementContractKind(contract: {
    name: string;
    counterparty: string;
  }): SettlementContractKind {
    const text = `${contract.name} ${contract.counterparty}`;

    if (text.includes("劳务") || text.includes("专业") || text.includes("分包")) {
      return "labor_professional";
    }

    return "material_mechanical";
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

  private async assignApproval(
    kind: SettlementApprovalAssignment["kind"],
    settlementId: string,
    actorUserId: string,
    input: AssignSettlementApprovalDto
  ) {
    if (!this.prisma) {
      throw new Error("Prisma service is required to assign settlement approval");
    }

    if (!input.toUserId || input.toUserId === actorUserId) {
      throw new Error("Settlement approval assignment target is invalid");
    }

    return this.prisma.$transaction(async (tx) => {
      const settlement = await tx.settlement.findUnique({
        where: { id: settlementId }
      });

      if (!settlement) {
        throw new Error("Settlement not found");
      }

      if (settlement.status !== "approval_pending") {
        throw new Error(`Cannot assign settlement approval from status ${settlement.status}`);
      }

      const instance = await tx.approvalInstance.findFirst({
        where: {
          businessType: "settlement",
          businessId: settlement.id,
          flowType: "settlement.approve",
          status: "in_progress"
        }
      });

      if (!instance) {
        throw new Error("Settlement approval instance not found");
      }

      const nodes = instance.frozenNodes as unknown as SettlementApprovalNode[];
      const currentNode = nodes[instance.currentNodeIndex];

      if (!currentNode) {
        throw new Error("Settlement approval current node not found");
      }

      const actorRoleKeys = await this.loadActorRoleKeys(tx, actorUserId, settlement.projectId);
      const fromRoleKey = currentNode.roleKeys.find((role) => actorRoleKeys.includes(role));

      if (!fromRoleKey) {
        throw new Error(`Actor cannot assign settlement node ${currentNode.name}`);
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
        action: `settlement.approval.${kind}`,
        businessType: "settlement",
        businessId: settlement.id,
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
