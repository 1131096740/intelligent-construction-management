import { Injectable, Optional } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { approvalElapsedHours, canRemindApproval, type RoleKey } from "@jiangkong/shared-domain";
import { ApprovalDelegationService } from "../approval/approval-delegation.service";
import { ApprovalFormService } from "../approval/approval-form.service";
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";
import { FileService } from "../file/file.service";
import { renderSimplePdf } from "../pdf/simple-pdf";
import { ConfirmContractArchiveDto } from "./dto/confirm-contract-archive.dto";
import { CreateContractDto } from "./dto/create-contract.dto";
import { ReviewContractApprovalDto } from "./dto/review-contract-approval.dto";
import { UploadContractArchiveFileDto } from "./dto/upload-contract-archive-file.dto";

interface AssignApprovalDto {
  toUserId: string;
}

interface GenerateContractPdfArchiveDto {
  templateKey?: string;
  departmentScope?: string;
}

interface ContractApprovalAssignment {
  kind: "transfer" | "delegate";
  fromUserId: string;
  fromRoleKey: RoleKey;
  toUserId: string;
}

interface ContractApprovalNode {
  name: string;
  mode: "any";
  roleKeys: RoleKey[];
  assignments?: ContractApprovalAssignment[];
}

const CONTRACT_APPROVAL_NODES = [
  {
    name: "董事长/总经理",
    mode: "any",
    roleKeys: ["chairman", "general_manager"]
  }
] satisfies ContractApprovalNode[];

@Injectable()
export class ContractService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService = new AuditService(),
    @Optional()
    private readonly auth?: AuthService,
    @Optional()
    private readonly delegations?: ApprovalDelegationService,
    @Optional()
    private readonly files?: FileService,
    @Optional()
    private readonly approvalForms?: ApprovalFormService
  ) {}

  async createDraft(input: CreateContractDto) {
    return this.prisma.$transaction(async (tx) => {
      // 快照我方主体名称：合同效力期内名称固定，字典后续改名不影响历史合同/审批单。
      let companyEntityName: string | null = null;
      if (input.companyEntityId) {
        const entity = await tx.companyEntity.findUnique({
          where: { id: input.companyEntityId }
        });
        if (!entity) {
          throw new Error("Company entity not found");
        }
        companyEntityName = entity.name;
      }

      const contract = await tx.contract.create({
        data: {
          projectId: input.projectId,
          code: input.code,
          name: input.name,
          counterparty: input.counterparty,
          companyEntityId: input.companyEntityId ?? null,
          companyEntityName
        }
      });

      const version = await tx.contractVersion.create({
        data: {
          contractId: contract.id,
          versionNo: 1,
          changeType: "original",
          status: "draft",
          amountCents: input.amountCents
        }
      });

      const terms = await tx.paymentTermsVersion.create({
        data: {
          contractId: contract.id,
          contractVersionId: version.id,
          versionNo: 1,
          status: "draft",
          originalText: input.paymentTermsOriginalText
        }
      });

      await tx.paymentTermsStage.createMany({
        data: input.paymentStages.map((stage) => ({
          paymentTermsVersionId: terms.id,
          name: stage.name,
          basis: stage.basis,
          ratioBps: stage.ratioBps,
          fixedAmountCents: stage.fixedAmountCents,
          triggerEvent: stage.triggerEvent,
          dueDays: stage.dueDays,
          requiresInvoice: stage.requiresInvoice,
          allowsEarlyPayment: stage.allowsEarlyPayment,
          allowsInstallments: stage.allowsInstallments,
          retentionBps: stage.retentionBps,
          originalText: stage.originalText
        }))
      });

      return { contract, version, terms };
    });
  }

  async uploadArchiveFile(
    contractVersionId: string,
    actorUserId: string,
    input: UploadContractArchiveFileDto
  ) {
    return this.prisma.$transaction(async (tx) => {
      const version = await tx.contractVersion.findUnique({
        where: { id: contractVersionId }
      });

      if (!version) {
        throw new Error("Contract version not found");
      }

      if (version.status !== "seal_approved_pending_archive") {
        throw new Error(`Cannot upload contract archive from status ${version.status}`);
      }

      const file = await tx.fileObject.findUnique({
        where: { id: input.fileId }
      });

      if (!file) {
        throw new Error("Contract archive file not found");
      }

      const archiveFile = await tx.contractArchiveFile.create({
        data: {
          contractVersionId: version.id,
          fileId: input.fileId,
          uploadedByUserId: actorUserId,
          status: "pending_confirm"
        }
      });

      await tx.contractVersion.update({
        where: { id: version.id },
        data: { status: "pending_archive_confirm" }
      });

      await this.audit.record(tx, {
        actorUserId,
        action: "contract.archive.upload",
        businessType: "contract_version",
        businessId: version.id,
        metadata: {
          fileId: input.fileId,
          archiveFileId: archiveFile.id
        }
      });

      return archiveFile;
    });
  }

  async submitApproval(contractVersionId: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const version = await tx.contractVersion.findUnique({
        where: { id: contractVersionId }
      });

      if (!version) {
        throw new Error("Contract version not found");
      }

      if (version.status !== "draft") {
        throw new Error(`Cannot submit contract version from status ${version.status}`);
      }

      const updated = await tx.contractVersion.update({
        where: { id: version.id },
        data: { status: "in_approval" }
      });

      await tx.approvalInstance.create({
        data: {
          flowType: "contract.approve",
          businessType: "contract_version",
          businessId: version.id,
          status: "in_progress",
          currentNodeIndex: 0,
          frozenNodes: CONTRACT_APPROVAL_NODES as unknown as Prisma.InputJsonValue,
          applicantUserId: actorUserId
        }
      });

      await this.audit.record(tx, {
        actorUserId,
        action: "contract.approval.submit",
        businessType: "contract_version",
        businessId: version.id,
        metadata: {
          fromStatus: version.status,
          toStatus: "in_approval"
        }
      });

      return updated;
    });
  }

  async reviewApproval(
    contractVersionId: string,
    actorUserId: string,
    input: ReviewContractApprovalDto
  ) {
    let completedInstanceId: string | undefined;
    const result = await this.prisma.$transaction(async (tx) => {
      const version = await tx.contractVersion.findUnique({
        where: { id: contractVersionId }
      });

      if (!version) {
        throw new Error("Contract version not found");
      }

      if (version.status !== "in_approval") {
        throw new Error(`Cannot review contract approval from status ${version.status}`);
      }

      const instance = await tx.approvalInstance.findFirst({
        where: {
          businessType: "contract_version",
          businessId: version.id,
          flowType: "contract.approve",
          status: "in_progress"
        }
      });

      if (!instance) {
        throw new Error("Contract approval instance not found");
      }

      const nodes = instance.frozenNodes as unknown as ContractApprovalNode[];
      const currentNode = nodes[instance.currentNodeIndex];

      if (!currentNode) {
        throw new Error("Contract approval current node not found");
      }

      const actorRoleKeys = await this.loadActorRoleKeys(tx, actorUserId, version.contractId);
      let approvedRoleKey =
        currentNode.roleKeys.find((role) => actorRoleKeys.includes(role)) ??
        currentNode.assignments?.find((assignment) => assignment.toUserId === actorUserId)
          ?.fromRoleKey;

      if (!approvedRoleKey) {
        approvedRoleKey = await this.resolveDelegatedRoleKey(
          tx,
          actorUserId,
          version.contractId,
          currentNode.roleKeys
        );
      }

      if (!approvedRoleKey) {
        throw new Error(`Actor cannot approve contract node ${currentNode.name}`);
      }

      const nextStatus =
        input.decision === "approve" ? "approved_pending_seal" : "approval_rejected";
      const updated = await tx.contractVersion.update({
        where: { id: version.id },
        data: { status: nextStatus }
      });

      await tx.approvalInstance.update({
        where: { id: instance.id },
        data: {
          currentNodeIndex: input.decision === "approve" ? instance.currentNodeIndex + 1 : instance.currentNodeIndex,
          status: input.decision === "approve" ? "approved" : "rejected"
        }
      });

      await tx.approvalActionLog.create({
        data: {
          approvalInstanceId: instance.id,
          action: input.decision === "approve" ? "approve" : "reject",
          actorUserId,
          comment: input.comment?.trim() || undefined
        }
      });

      if (input.decision === "approve") {
        completedInstanceId = instance.id;
      }

      await this.audit.record(tx, {
        actorUserId,
        action:
          input.decision === "approve" ? "contract.approval.approve" : "contract.approval.reject",
        businessType: "contract_version",
        businessId: version.id,
        metadata: {
          fromStatus: version.status,
          toStatus: nextStatus,
          nodeName: currentNode.name,
          approvedRoleKey
        }
      });

      return updated;
    });

    if (completedInstanceId) {
      await this.approvalForms
        ?.generateForInstance(completedInstanceId, actorUserId)
        .catch(() => undefined);
    }

    return result;
  }

  // 申请人撤回进行中的合同审批：版本退回 draft 以便修改后重新提交（同一版本，不新建版本）。
  async withdrawApproval(contractVersionId: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const version = await tx.contractVersion.findUnique({
        where: { id: contractVersionId }
      });

      if (!version) {
        throw new Error("Contract version not found");
      }

      if (version.status !== "in_approval") {
        throw new Error(`Cannot withdraw contract approval from status ${version.status}`);
      }

      const instance = await tx.approvalInstance.findFirst({
        where: {
          businessType: "contract_version",
          businessId: version.id,
          flowType: "contract.approve",
          status: "in_progress"
        }
      });

      if (!instance) {
        throw new Error("Contract approval instance not found");
      }

      if (instance.applicantUserId !== actorUserId) {
        throw new Error("Only contract approval applicant can withdraw");
      }

      const updated = await tx.contractVersion.update({
        where: { id: version.id },
        data: { status: "draft" }
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
        action: "contract.approval.withdraw",
        businessType: "contract_version",
        businessId: version.id,
        metadata: {
          fromStatus: version.status,
          toStatus: "draft",
          applicantUserId: instance.applicantUserId
        }
      });

      return updated;
    });
  }

  // 超时催办：申请人督促当前冻结节点（董事长/总经理）处理；是否超时/重复节流由 shared-domain 判定。
  async remindApproval(
    contractVersionId: string,
    actorUserId: string,
    now: Date = new Date()
  ) {
    return this.prisma.$transaction(async (tx) => {
      const version = await tx.contractVersion.findUnique({
        where: { id: contractVersionId }
      });

      if (!version) {
        throw new Error("Contract version not found");
      }

      if (version.status !== "in_approval") {
        throw new Error(`Cannot remind contract approval from status ${version.status}`);
      }

      const instance = await tx.approvalInstance.findFirst({
        where: {
          businessType: "contract_version",
          businessId: version.id,
          flowType: "contract.approve",
          status: "in_progress"
        }
      });

      if (!instance) {
        throw new Error("Contract approval instance not found");
      }

      if (instance.applicantUserId !== actorUserId) {
        throw new Error("Only contract approval applicant can remind");
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
        throw new Error("Contract approval is not due for a reminder yet");
      }

      const nodes = instance.frozenNodes as unknown as typeof CONTRACT_APPROVAL_NODES;
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
        action: "contract.approval.remind",
        businessType: "contract_version",
        businessId: version.id,
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
    contractVersionId: string,
    actorUserId: string,
    input: AssignApprovalDto
  ) {
    return this.assignApproval("transfer", contractVersionId, actorUserId, input);
  }

  delegateApproval(
    contractVersionId: string,
    actorUserId: string,
    input: AssignApprovalDto
  ) {
    return this.assignApproval("delegate", contractVersionId, actorUserId, input);
  }

  async approveSeal(contractVersionId: string, actorUserId: string) {
    return this.updateVersionStatus({
      contractVersionId,
      expectedStatus: "approved_pending_seal",
      nextStatus: "seal_approved_pending_archive",
      actorUserId,
      action: "contract.seal.approve"
    });
  }

  async confirmArchiveFile(
    contractVersionId: string,
    actorUserId: string,
    input: ConfirmContractArchiveDto
  ) {
    if (!input.confirmationPassword?.trim()) {
      throw new Error("Contract archive confirmation password is required");
    }

    if (!this.auth) {
      throw new Error("Auth service is required to confirm contract archive");
    }

    await this.auth.confirmPassword(actorUserId, input.confirmationPassword);

    return this.prisma.$transaction(async (tx) => {
      const version = await tx.contractVersion.findUnique({
        where: { id: contractVersionId }
      });

      if (!version) {
        throw new Error("Contract version not found");
      }

      if (version.status !== "pending_archive_confirm") {
        throw new Error(`Cannot confirm contract archive from status ${version.status}`);
      }

      const archiveFile = await tx.contractArchiveFile.findFirst({
        where: {
          id: input.archiveFileId,
          contractVersionId: version.id
        }
      });

      if (!archiveFile) {
        throw new Error("Contract archive file not found");
      }

      if (archiveFile.status !== "pending_confirm") {
        throw new Error(`Cannot confirm contract archive file from status ${archiveFile.status}`);
      }

      const confirmedAt = new Date();
      await tx.contractArchiveFile.update({
        where: { id: archiveFile.id },
        data: {
          confirmedByUserId: actorUserId,
          confirmedAt,
          status: "confirmed"
        }
      });

      const effectiveVersion = await tx.contractVersion.update({
        where: { id: version.id },
        data: {
          status: "effective",
          effectiveAt: confirmedAt
        }
      });

      await tx.paymentTermsVersion.updateMany({
        where: { contractVersionId: version.id },
        data: { status: "effective" }
      });

      await this.audit.record(tx, {
        actorUserId,
        action: "contract.archive.confirm",
        businessType: "contract_version",
        businessId: version.id,
        metadata: {
          archiveFileId: archiveFile.id
        }
      });

      return effectiveVersion;
    });
  }

  async generatePdfArchive(
    contractVersionId: string,
    actorUserId: string,
    input: GenerateContractPdfArchiveDto = {}
  ) {
    if (!this.files) {
      throw new Error("File service is required to generate contract PDF archive");
    }

    const templateKey = input.templateKey ?? "contract_archive";
    const departmentScope = input.departmentScope ?? "contract";
    const source = await this.prisma.$transaction(async (tx) => {
      const version = await tx.contractVersion.findUnique({
        where: { id: contractVersionId }
      });

      if (!version) {
        throw new Error("Contract version not found");
      }

      if (version.status !== "effective") {
        throw new Error(`Cannot generate contract PDF from status ${version.status}`);
      }

      const contract = await tx.contract.findUnique({ where: { id: version.contractId } });

      if (!contract) {
        throw new Error("Contract not found");
      }

      const existingPdf = await tx.pdfDocument.findFirst({
        where: {
          businessType: "contract_version",
          businessId: version.id,
          templateKey
        }
      });

      if (existingPdf) {
        throw new Error("Contract PDF archive already exists");
      }

      return { contract, version };
    });
    const buffer = renderSimplePdf([
      "Contract Archive",
      `Contract Code: ${source.contract.code}`,
      `Contract Name: ${source.contract.name}`,
      `Counterparty: ${source.contract.counterparty}`,
      `Version: ${source.version.versionNo}`,
      `Amount: ${this.formatCents(source.version.amountCents)}`,
      `Template: ${templateKey}`,
      `Generated At: ${new Date().toISOString()}`
    ]);
    const file = await this.files.uploadPrivateFile({
      originalName: `${source.contract.code}-v${source.version.versionNo}-${templateKey}.pdf`,
      mimeType: "application/pdf",
      sizeBytes: buffer.length,
      uploadedByUserId: actorUserId,
      buffer
    });

    return this.prisma.$transaction(async (tx) => {
      const pdfDocument = await tx.pdfDocument.create({
        data: {
          businessType: "contract_version",
          businessId: source.version.id,
          fileId: file.id,
          templateKey
        }
      });
      const archiveRecord = await tx.archiveRecord.create({
        data: {
          businessType: "contract_version",
          businessId: source.version.id,
          fileId: file.id,
          departmentScope
        }
      });

      await this.audit.record(tx, {
        actorUserId,
        action: "contract.pdf_archive.generate",
        businessType: "contract_version",
        businessId: source.version.id,
        metadata: {
          code: source.contract.code,
          pdfDocumentId: pdfDocument.id,
          archiveRecordId: archiveRecord.id,
          fileId: file.id,
          templateKey,
          departmentScope
        }
      });

      return { pdfDocument, archiveRecord };
    });
  }

  private async updateVersionStatus(input: {
    contractVersionId: string;
    expectedStatus: string;
    nextStatus: string;
    actorUserId: string;
    action: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const version = await tx.contractVersion.findUnique({
        where: { id: input.contractVersionId }
      });

      if (!version) {
        throw new Error("Contract version not found");
      }

      if (version.status !== input.expectedStatus) {
        throw new Error(
          `Cannot ${input.action} contract version from status ${version.status}`
        );
      }

      const updated = await tx.contractVersion.update({
        where: { id: version.id },
        data: { status: input.nextStatus }
      });

      await this.audit.record(tx, {
        actorUserId: input.actorUserId,
        action: input.action,
        businessType: "contract_version",
        businessId: version.id,
        metadata: {
          fromStatus: version.status,
          toStatus: input.nextStatus
        }
      });

      return updated;
    });
  }

  private async loadActorRoleKeys(
    tx: {
      contract: { findUnique(input: unknown): Promise<{ projectId: string } | null> };
      userPosition: {
        findMany(input: unknown): Promise<Array<{ positionId: string; projectId: string | null }>>;
      };
      projectMember: { findMany(input: unknown): Promise<Array<{ positionKey: string }>> };
      position: { findMany(input: unknown): Promise<Array<{ id: string; key: string }>> };
    },
    actorUserId: string,
    contractId: string
  ): Promise<RoleKey[]> {
    const contract = await tx.contract.findUnique({ where: { id: contractId } });

    if (!contract) {
      throw new Error("Contract not found");
    }

    const [globalPositions, projectPositions, projectMembers] = await Promise.all([
      tx.userPosition.findMany({ where: { userId: actorUserId, projectId: null } }),
      tx.userPosition.findMany({ where: { userId: actorUserId, projectId: contract.projectId } }),
      tx.projectMember.findMany({ where: { userId: actorUserId, projectId: contract.projectId } })
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

  private formatCents(value: number) {
    return `${(value / 100).toFixed(2)} CNY`;
  }

  // 常驻委托台账消费：本人岗位/节点指派都不命中时，看是否有在窗口内的委托人持有该节点角色。
  private async resolveDelegatedRoleKey(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    contractId: string,
    nodeRoleKeys: RoleKey[]
  ): Promise<RoleKey | undefined> {
    if (!this.delegations) {
      return undefined;
    }

    const delegatorIds = await this.delegations.activeDelegatorIds(tx, actorUserId);

    for (const delegatorId of delegatorIds) {
      const delegatorRoleKeys = await this.loadActorRoleKeys(tx, delegatorId, contractId);
      const match = nodeRoleKeys.find((role) => delegatorRoleKeys.includes(role));

      if (match) {
        return match;
      }
    }

    return undefined;
  }

  private async assignApproval(
    kind: ContractApprovalAssignment["kind"],
    contractVersionId: string,
    actorUserId: string,
    input: AssignApprovalDto
  ) {
    if (!input.toUserId || input.toUserId === actorUserId) {
      throw new Error("Contract approval assignment target is invalid");
    }

    return this.prisma.$transaction(async (tx) => {
      const version = await tx.contractVersion.findUnique({
        where: { id: contractVersionId }
      });

      if (!version) {
        throw new Error("Contract version not found");
      }

      if (version.status !== "in_approval") {
        throw new Error(`Cannot assign contract approval from status ${version.status}`);
      }

      const instance = await tx.approvalInstance.findFirst({
        where: {
          businessType: "contract_version",
          businessId: version.id,
          flowType: "contract.approve",
          status: "in_progress"
        }
      });

      if (!instance) {
        throw new Error("Contract approval instance not found");
      }

      const nodes = instance.frozenNodes as unknown as ContractApprovalNode[];
      const currentNode = nodes[instance.currentNodeIndex];

      if (!currentNode) {
        throw new Error("Contract approval current node not found");
      }

      const actorRoleKeys = await this.loadActorRoleKeys(tx, actorUserId, version.contractId);
      const fromRoleKey = currentNode.roleKeys.find((role) => actorRoleKeys.includes(role));

      if (!fromRoleKey) {
        throw new Error(`Actor cannot assign contract node ${currentNode.name}`);
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
        action: `contract.approval.${kind}`,
        businessType: "contract_version",
        businessId: version.id,
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
