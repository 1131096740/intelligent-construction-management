import { BadRequestException, Injectable, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { approvalElapsedHours, canRemindApproval, type RoleKey } from "@jiangkong/shared-domain";
import { ApprovalDelegationService } from "../approval/approval-delegation.service";
import { ApprovalFormService } from "../approval/approval-form.service";
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import {
  ContractNumberingService,
  type ContractNumberOverride
} from "../contract-workbench/contract-numbering.service";
import { ContractReadinessService } from "../contract-workbench/contract-readiness.service";
import { PrismaService } from "../database/prisma.service";
import { FileService } from "../file/file.service";
import { centsToSafeNumber } from "../money/decimal-money";
import { renderSimplePdf } from "../pdf/simple-pdf";
import { ConfirmContractArchiveDto } from "./dto/confirm-contract-archive.dto";
import {
  CreateContractDraftDto,
  type CreatePaymentTermsStageDto
} from "./dto/create-contract.dto";
import { ReviewContractApprovalDto } from "./dto/review-contract-approval.dto";
import { UploadContractArchiveFileDto } from "./dto/upload-contract-archive-file.dto";

interface AssignApprovalDto {
  toUserId: string;
}

interface GenerateContractPdfArchiveDto {
  templateKey?: string;
  departmentScope?: string;
}

export interface SubmitContractApprovalDto extends ContractNumberOverride {
  numberRuleId: string;
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
  approvedRoleKeys?: RoleKey[];
  assignments?: ContractApprovalAssignment[];
}

const CONTRACT_APPROVAL_NODES = [
  {
    name: "董事长/总经理",
    mode: "any",
    roleKeys: ["chairman", "general_manager"]
  }
] satisfies ContractApprovalNode[];

const DOWNSTREAM_CONTRACT_OCCUPANCY_STATUSES = [
  "in_approval",
  "approved_pending_seal",
  "in_seal",
  "seal_approved_pending_archive",
  "pending_archive_confirm",
  "effective"
] as const;
const PAYMENT_STAGE_TYPES = new Set(["advance", "progress", "final", "retention", "other"]);
const PAYMENT_STAGE_BASES = new Set([
  "contract_amount",
  "current_settlement",
  "cumulative_settlement",
  "fixed_amount",
  "manual_amount"
]);
const PAYMENT_STAGE_TRIGGER_ANCHORS = new Set([
  "contract_effective",
  "settlement_effective",
  "final_settlement_effective"
]);
const ADVANCE_DEDUCTION_MODES = new Set([
  "none",
  "per_settlement_ratio",
  "after_cumulative_settlement_ratio"
]);

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
    private readonly approvalForms?: ApprovalFormService,
    @Optional()
    private readonly readiness?: ContractReadinessService,
    @Optional()
    private readonly numbering?: ContractNumberingService
  ) {}

  async createDraft(input: CreateContractDraftDto, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      // 校验模板版本：必须已发布才能用于新建草稿。
      const templateVersion = await tx.contractBusinessTemplateVersion.findUnique({
        where: { id: input.businessTemplateVersionId }
      });

      if (!templateVersion) {
        throw new Error("Business template version not found");
      }

      if (templateVersion.status !== "published") {
        throw new Error(
          `Business template version is not published (status: ${templateVersion.status})`
        );
      }
      const template = await tx.contractBusinessTemplate.findUnique({
        where: { id: templateVersion.templateId }
      });
      if (!template) {
        throw new Error("Business template not found");
      }
      if (template.contractTypeKey !== input.contractTypeKey) {
        throw new BadRequestException("Business template contract type does not match");
      }

      // 模板快照：将模板五类 schema 整体冻结到合同版本中。
      const templateSnapshot = {
        fieldSchema: templateVersion.fieldSchema,
        billSchema: templateVersion.billSchema,
        clauseSchema: templateVersion.clauseSchema,
        attachmentSchema: templateVersion.attachmentSchema,
        validationSchema: templateVersion.validationSchema
      };

      // 从 fieldSchema 中初始化 draftData（每个字段取 defaultValue，否则为 null）。
      const fields = (templateVersion.fieldSchema as Array<{ key: string; defaultValue?: unknown }>) ?? [];
      const draftData: Record<string, unknown> = {};
      for (const field of fields) {
        draftData[field.key] = field.defaultValue ?? null;
      }

      // clauseSnapshot 初始化为模板 clauseSchema 中的所有条款定义。
      const clauseSnapshot = (templateVersion.clauseSchema as unknown[]) ?? [];

      // 生成临时编号：草稿-YYYYMMDD-<8位数字>
      const now = new Date();
      const datePart = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
      const randomPart = Math.floor(Math.random() * 100_000_000).toString().padStart(8, "0");
      const temporaryCode = `草稿-${datePart}-${randomPart}`;

      const contract = await tx.contract.create({
        data: {
          projectId: input.projectId,
          contractTypeKey: input.contractTypeKey,
          ownerUserId: actorUserId,
          name: "",
          counterparty: "",
          code: null,
          temporaryCode
        }
      });

      const version = await tx.contractVersion.create({
        data: {
          contractId: contract.id,
          versionNo: 1,
          changeType: "original",
          status: "draft",
          amountCents: 0n,
          businessTemplateVersionId: input.businessTemplateVersionId,
          draftData: draftData as never,
          templateSnapshot: templateSnapshot as never,
          clauseSnapshot: clauseSnapshot as never
        }
      });

      // 每个 bill 定义创建对应的 ContractBill，金额列保持默认 0。
      const bills = (templateVersion.billSchema as Array<{
        key: string;
        name: string;
        amountRole: string;
        pricingMode: string;
        quantityScale: number;
        unitPriceScale: number;
        columns: unknown[];
      }>) ?? [];

      if (bills.length > 0) {
        await tx.contractBill.createMany({
          data: bills.map((bill) => ({
            contractVersionId: version.id,
            billKey: bill.key,
            name: bill.name,
            amountRole: bill.amountRole,
            pricingMode: bill.pricingMode,
            quantityScale: bill.quantityScale,
            unitPriceScale: bill.unitPriceScale,
            schemaSnapshot: { columns: bill.columns } as never
          }))
        });
      }

      // 创建空的付款条款版本（无阶段），兼容后续审批流。
      const terms = await tx.paymentTermsVersion.create({
        data: {
          contractId: contract.id,
          contractVersionId: version.id,
          versionNo: 1,
          status: "draft",
          originalText: input.paymentTermsOriginalText?.trim() ?? ""
        }
      });
      const paymentStages = this.normalizePaymentStages(input.paymentStages, terms.id);
      if (paymentStages.length > 0) {
        await tx.paymentTermsStage.createMany({ data: paymentStages });
      }

      await this.audit.record(tx, {
        actorUserId,
        action: "contract.draft.create",
        businessType: "contract",
        businessId: contract.id,
        metadata: {
          temporaryCode,
          projectId: input.projectId,
          contractTypeKey: input.contractTypeKey,
          businessTemplateVersionId: input.businessTemplateVersionId
        }
      });

      return { contract, version: { ...version, amountCents: String(version.amountCents ?? 0) }, terms };
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
        throw new Error("未找到合同版本，请刷新合同台账后重试");
      }

      if (version.status !== "seal_approved_pending_archive") {
        throw new Error("当前合同尚不能上传签字归档文件，请先完成合同审批和用章审批");
      }

      if (!this.files) {
        throw new Error("合同归档文件服务暂不可用，请稍后重试或联系管理员");
      }
      await this.files.assertCanDownloadFile(tx, input.fileId, actorUserId);

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

  async submitApproval(
    contractVersionId: string,
    actorUserId: string,
    rawInput?: unknown
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const [version] = await tx.$queryRaw<
          Array<NonNullable<Awaited<ReturnType<typeof tx.contractVersion.findUnique>>>>
        >(Prisma.sql`
          SELECT *
          FROM "ContractVersion"
          WHERE "id" = ${contractVersionId}
          FOR UPDATE
        `);
        if (!version) throw new Error("Contract version not found");

        const contract = await tx.contract.findUnique({
          where: { id: version.contractId }
        });
        if (!contract) throw new Error("Contract not found");
        if (contract.voidedAt) throw new Error("Cannot submit a voided contract");
        if (contract.ownerUserId && contract.ownerUserId !== actorUserId) {
          throw new Error("Only the contract owner can submit approval");
        }

        const input = contract.ownerUserId ? this.parseSubmissionInput(rawInput) : null;
        let formalCode = contract.code;
        let readinessSnapshot = version.readinessSnapshot;
        let templateSnapshot = version.templateSnapshot;
        if (input) {
          if (!this.readiness || !this.numbering) {
            throw new Error("Contract submission services are required");
          }
          const readiness = await this.readiness.check(tx, version, contract, true);
          if (readiness.blocking.length > 0) {
            throw new BadRequestException({
              message: "Contract is not ready for approval submission",
              readiness
            });
          }
          readinessSnapshot = readiness as unknown as Prisma.JsonValue;
        }

        await this.assertOwnerContractQuota(tx, contract.projectId, contract.id, version.amountCents);

        if (input) {
          formalCode = await this.numbering!.allocate(
            tx,
            input.numberRuleId,
            contract,
            actorUserId,
            input
          );
          const submissionSnapshot = await this.readiness!.freeze(tx, version);
          templateSnapshot = {
            ...(version.templateSnapshot as Prisma.JsonObject),
            submissionSnapshot
          } as unknown as Prisma.JsonValue;
        }

        const submitted = await tx.contractVersion.updateMany({
          where: {
            id: version.id,
            status: "draft",
            draftRevision: version.draftRevision
          },
          data: {
            status: "in_approval",
            ...(input
              ? {
                  readinessSnapshot: readinessSnapshot as Prisma.InputJsonValue,
                  templateSnapshot: templateSnapshot as Prisma.InputJsonValue,
                  clauseSnapshot: version.clauseSnapshot as Prisma.InputJsonValue
                }
              : {})
          }
        });
        if (submitted.count !== 1) {
          throw new Error("Contract approval submission conflict");
        }
        const parentGate = await tx.contract.updateMany({
          where: {
            id: contract.id,
            ownerUserId: contract.ownerUserId,
            voidedAt: null
          },
          data: {
            ownerUserId: contract.ownerUserId,
            ...(formalCode ? { code: formalCode } : {})
          }
        });
        if (parentGate.count !== 1) {
          throw new Error("Contract approval submission conflict");
        }

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
            toStatus: "in_approval",
            formalCode,
            draftRevision: version.draftRevision,
            ...(input
              ? {
                  numberRuleId: input.numberRuleId,
                  ...(input.overrideReason
                    ? { overrideReason: input.overrideReason }
                    : {}),
                  submissionSnapshot: (templateSnapshot as Prisma.JsonObject)
                    .submissionSnapshot
                }
              : {})
          }
        });

        return {
          ...version,
          amountCents: String(version.amountCents ?? 0),
          status: "in_approval",
          readinessSnapshot,
          templateSnapshot,
          formalCode
        };
      });
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "P2002"
      ) {
        throw new BadRequestException("Contract formal code already exists");
      }
      throw error;
    }
  }

  private async assertOwnerContractQuota(
    tx: Prisma.TransactionClient,
    projectId: string,
    currentContractId: string,
    amountCents: bigint | number
  ) {
    const requestedAmountCents = BigInt(amountCents);
    if (requestedAmountCents <= 0n) {
      throw new BadRequestException("Contract amount must be greater than zero");
    }

    await tx.$queryRaw(Prisma.sql`
      SELECT "id"
      FROM "Project"
      WHERE "id" = ${projectId}
      FOR UPDATE
    `);

    const ownerContracts = await tx.projectOwnerContract.findMany({
      where: { projectId, status: "effective", voidedAt: null },
      select: { amountCents: true }
    });
    const ownerQuotaCents = sumBigInt(ownerContracts.map((contract) => contract.amountCents));

    const projectContracts = await tx.contract.findMany({
      where: {
        projectId,
        voidedAt: null
      },
      select: { id: true }
    });
    const contractIds = projectContracts.map((contract) => contract.id);
    const occupyingVersions = contractIds.length
      ? await tx.contractVersion.findMany({
          where: {
            contractId: { in: contractIds },
            status: { in: [...DOWNSTREAM_CONTRACT_OCCUPANCY_STATUSES] }
          },
          select: {
            contractId: true,
            versionNo: true,
            amountCents: true
          }
        })
      : [];
    const contractOccupancies = maxContractOccupancies(occupyingVersions);
    const hasCurrentOccupancy = contractOccupancies.some(
      (version) => version.contractId === currentContractId
    );
    const occupiedCents =
      sumBigInt(
        contractOccupancies.map((version) =>
          version.contractId === currentContractId
            ? maxBigInt(version.amountCents, requestedAmountCents)
            : version.amountCents
        )
      ) + (hasCurrentOccupancy ? 0n : requestedAmountCents);

    if (ownerQuotaCents <= 0n || occupiedCents > ownerQuotaCents) {
      throw new BadRequestException("业主主合同额度不足");
    }
  }

  private parseSubmissionInput(rawInput: unknown): SubmitContractApprovalDto {
    if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) {
      throw new BadRequestException("Contract approval submission body is required");
    }
    const input = rawInput as Record<string, unknown>;
    if (typeof input.numberRuleId !== "string" || !input.numberRuleId.trim()) {
      throw new BadRequestException("numberRuleId is required");
    }
    if (
      input.formalCodeOverride !== undefined &&
      (typeof input.formalCodeOverride !== "string" ||
        !input.formalCodeOverride.trim())
    ) {
      throw new BadRequestException("formalCodeOverride must be a non-empty string");
    }
    if (
      input.overrideReason !== undefined &&
      (typeof input.overrideReason !== "string" || !input.overrideReason.trim())
    ) {
      throw new BadRequestException("overrideReason must be a non-empty string");
    }
    return {
      numberRuleId: input.numberRuleId.trim(),
      ...(input.formalCodeOverride === undefined
        ? {}
        : { formalCodeOverride: input.formalCodeOverride.trim() }),
      ...(input.overrideReason === undefined
        ? {}
        : { overrideReason: input.overrideReason.trim() })
    };
  }

  async reviewApproval(
    contractVersionId: string,
    actorUserId: string,
    input: ReviewContractApprovalDto
  ) {
    if (
      !["approve", "reject", "reject_previous", "return_to_applicant"].includes(
        input.decision
      )
    ) {
      throw new Error("不支持的合同审批处理方式，请刷新页面后重试");
    }
    requireApprovalCommentForReturn(input.decision, input.comment);

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

      if (input.decision === "reject_previous") {
        if (instance.currentNodeIndex === 0) {
          throw new Error("当前已是第一个审批节点，不能退回上一节点");
        }

        const previousNodeIndex = instance.currentNodeIndex - 1;
        const nextNodes = nodes.map((node, index) =>
          index === previousNodeIndex || index === instance.currentNodeIndex
            ? { ...node, approvedRoleKeys: [] }
            : node
        );
        const updated = await tx.contractVersion.update({
          where: { id: version.id },
          data: { status: "in_approval" }
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
          action: "contract.approval.reject_previous",
          businessType: "contract_version",
          businessId: version.id,
          metadata: {
            fromStatus: version.status,
            toStatus: "in_approval",
            fromNodeName: currentNode.name,
            toNodeName: nextNodes[previousNodeIndex].name,
            approvedRoleKey
          }
        });

        return updated;
      }

      if (input.decision === "return_to_applicant") {
        const updated = await tx.contractVersion.update({
          where: { id: version.id },
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
          action: "contract.approval.return_to_applicant",
          businessType: "contract_version",
          businessId: version.id,
          metadata: {
            fromStatus: version.status,
            toStatus: "draft",
            nodeName: currentNode.name,
            approvedRoleKey
          }
        });

        return updated;
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
        throw new Error("当前合同已离开审批中，不能撤回审批");
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
        throw new Error("只有合同审批申请人可以撤回审批");
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
        throw new Error("只有合同审批申请人可以发起催办");
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
        throw new Error("当前合同审批还未达到催办时间，请稍后再试");
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
      throw new Error("确认合同归档需要当前登录密码");
    }

    if (!this.auth) {
      throw new Error("当前密码校验服务暂不可用，请稍后重试或联系管理员");
    }

    await this.auth.confirmPassword(actorUserId, input.confirmationPassword);

    return this.prisma.$transaction(async (tx) => {
      const version = await tx.contractVersion.findUnique({
        where: { id: contractVersionId }
      });

      if (!version) {
        throw new Error("未找到合同版本，请刷新合同台账后重试");
      }

      if (version.status !== "pending_archive_confirm") {
        throw new Error("当前合同版本尚不能确认归档，请先完成用印并上传已签署合同归档文件");
      }

      const archiveFile = await tx.contractArchiveFile.findFirst({
        where: {
          id: input.archiveFileId,
          contractVersionId: version.id
        }
      });

      if (!archiveFile) {
        throw new Error("未找到待确认的合同归档文件，请刷新后重试");
      }

      if (archiveFile.status !== "pending_confirm") {
        throw new Error("该合同归档文件已处理，不能重复确认");
      }

      await this.assertStructuredSettlementPaymentStage(tx, version.id);

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

  private async assertStructuredSettlementPaymentStage(
    tx: Prisma.TransactionClient,
    contractVersionId: string
  ) {
    const terms = await tx.paymentTermsVersion.findFirst({
      where: { contractVersionId },
      select: { id: true }
    });
    if (!terms) {
      throw new BadRequestException(
        "合同付款条款还未结构化，不能确认归档生效。请先维护结算款、付款比例、付款期限和发票要求。"
      );
    }

    const stage = await tx.paymentTermsStage.findFirst({
      where: {
        paymentTermsVersionId: terms.id,
        basis: "current_settlement",
        ratioBps: { gt: 0 }
      },
      select: { id: true }
    });
    if (!stage) {
      throw new BadRequestException(
        "合同付款条款缺少结算款阶段，不能确认归档生效。请先维护结算款、付款比例、付款期限和发票要求。"
      );
    }
  }

  private normalizePaymentStages(
    stages: CreatePaymentTermsStageDto[] | undefined,
    paymentTermsVersionId: string
  ): Prisma.PaymentTermsStageCreateManyInput[] {
    if (stages === undefined) return [];
    if (!Array.isArray(stages) || stages.length === 0) {
      throw new BadRequestException(
        "付款条款至少要维护一条结算款、付款比例、付款期限和发票要求。"
      );
    }

    return stages.map((stage, index) =>
      this.normalizePaymentStage(stage, index, paymentTermsVersionId)
    );
  }

  private normalizePaymentStage(
    stage: CreatePaymentTermsStageDto,
    index: number,
    paymentTermsVersionId: string
  ): Prisma.PaymentTermsStageCreateManyInput {
    if (!stage || typeof stage !== "object") {
      throw new BadRequestException(`第 ${index + 1} 条付款条款格式不正确。`);
    }
    if (!stage.name?.trim()) {
      throw new BadRequestException(`第 ${index + 1} 条付款条款缺少阶段名称。`);
    }
    const stageType = stage.stageType ?? "progress";
    if (!PAYMENT_STAGE_TYPES.has(stageType)) {
      throw new BadRequestException(`第 ${index + 1} 条付款条款类型不在支持范围内。`);
    }
    if (!PAYMENT_STAGE_BASES.has(stage.basis)) {
      throw new BadRequestException(`第 ${index + 1} 条付款依据不在支持范围内。`);
    }
    if (
      stage.ratioBps !== undefined &&
      (!Number.isInteger(stage.ratioBps) || stage.ratioBps < 0 || stage.ratioBps > 10000)
    ) {
      throw new BadRequestException(`第 ${index + 1} 条付款比例必须在 0% 到 100% 之间。`);
    }
    if (
      stage.fixedAmountCents !== undefined &&
      (!Number.isInteger(stage.fixedAmountCents) || stage.fixedAmountCents <= 0)
    ) {
      throw new BadRequestException(`第 ${index + 1} 条固定金额必须大于 0。`);
    }
    const triggerAnchor = stage.triggerAnchor ?? "settlement_effective";
    if (!PAYMENT_STAGE_TRIGGER_ANCHORS.has(triggerAnchor)) {
      throw new BadRequestException(`第 ${index + 1} 条付款触发节点不在支持范围内。`);
    }
    if (!stage.triggerEvent?.trim()) {
      throw new BadRequestException(`第 ${index + 1} 条付款条款缺少触发说明。`);
    }
    if (!Number.isInteger(stage.dueDays) || stage.dueDays < 0) {
      throw new BadRequestException(`第 ${index + 1} 条付款期限必须是非负天数。`);
    }
    const advanceDeductionMode = stage.advanceDeductionMode ?? "none";
    if (!ADVANCE_DEDUCTION_MODES.has(advanceDeductionMode)) {
      throw new BadRequestException(`第 ${index + 1} 条预付款扣回方式不在支持范围内。`);
    }
    for (const [field, label] of [
      ["requiresInvoice", "是否要求发票"],
      ["allowsEarlyPayment", "是否允许提前付款"],
      ["allowsInstallments", "是否允许分次付款"]
    ] as const) {
      if (typeof stage[field] !== "boolean") {
        throw new BadRequestException(`第 ${index + 1} 条付款条款缺少${label}。`);
      }
    }

    return {
      paymentTermsVersionId,
      name: stage.name.trim(),
      stageType,
      basis: stage.basis,
      ratioBps: stage.ratioBps,
      fixedAmountCents: stage.fixedAmountCents,
      triggerAnchor,
      triggerEvent: stage.triggerEvent.trim(),
      dueDays: stage.dueDays,
      advanceDeductionMode,
      advanceDeductionRatioBps: stage.advanceDeductionRatioBps,
      advanceDeductionStartRatioBps: stage.advanceDeductionStartRatioBps,
      requiresInvoice: stage.requiresInvoice,
      allowsEarlyPayment: stage.allowsEarlyPayment,
      allowsInstallments: stage.allowsInstallments,
      retentionBps: stage.retentionBps,
      originalText: stage.originalText?.trim() || stage.triggerEvent.trim()
    };
  }

  async generatePdfArchive(
    contractVersionId: string,
    actorUserId: string,
    input: GenerateContractPdfArchiveDto = {}
  ) {
    if (!this.files) {
      throw new Error("合同归档 PDF 服务暂不可用，请稍后重试或联系管理员");
    }

    const templateKey = input.templateKey ?? "contract_archive";
    const departmentScope = input.departmentScope ?? "contract";
    const source = await this.prisma.$transaction(async (tx) => {
      const version = await tx.contractVersion.findUnique({
        where: { id: contractVersionId }
      });

      if (!version) {
        throw new Error("未找到合同版本，请刷新合同台账后重试");
      }

      if (version.status !== "effective") {
        throw new Error("当前合同版本尚未生效，暂不能生成归档 PDF");
      }

      const contract = await tx.contract.findUnique({ where: { id: version.contractId } });

      if (!contract) {
        throw new Error("未找到合同主数据，请刷新合同台账后重试");
      }

      const existingPdf = await tx.pdfDocument.findFirst({
        where: {
          businessType: "contract_version",
          businessId: version.id,
          templateKey
        }
      });

      if (existingPdf) {
        throw new Error("合同归档 PDF 已生成，请勿重复生成");
      }

      return { contract, version };
    });
    const buffer = renderSimplePdf([
      "合同归档单",
      `合同编号：${source.contract.code}`,
      `合同名称：${source.contract.name}`,
      `相对方：${source.contract.counterparty}`,
      `版本号：${source.version.versionNo}`,
      `合同金额：${this.formatYuan(source.version.amountCents)} 元`,
      `归档模板：${templateKey}`,
      `生成时间：${new Date().toISOString()}`
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

  private formatCents(value: number | bigint) {
    const safe = centsToSafeNumber(typeof value === "bigint" ? value : BigInt(value));
    return `${(safe / 100).toFixed(2)} CNY`;
  }

  private formatYuan(value: number | bigint) {
    return this.formatCents(value).replace(" CNY", "");
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
      throw new Error("请选择有效的审批接收人，不能选择当前操作人");
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

function requireApprovalCommentForReturn(decision: ReviewContractApprovalDto["decision"], comment?: string) {
  if (decision !== "approve" && !comment?.trim()) {
    throw new Error("请填写审批意见，说明驳回或退回原因");
  }
}

function sumBigInt(values: Array<bigint | number>): bigint {
  return values.reduce<bigint>((total, value) => total + BigInt(value), 0n);
}

function maxBigInt(left: bigint | number, right: bigint | number): bigint {
  const normalizedLeft = BigInt(left);
  const normalizedRight = BigInt(right);
  return normalizedLeft > normalizedRight ? normalizedLeft : normalizedRight;
}

function maxContractOccupancies<T extends { contractId: string; amountCents: bigint | number }>(
  versions: T[]
): T[] {
  return Array.from(
    versions.reduce((maxByContract, version) => {
      const current = maxByContract.get(version.contractId);
      if (!current || BigInt(version.amountCents) > BigInt(current.amountCents)) {
        maxByContract.set(version.contractId, version);
      }
      return maxByContract;
    }, new Map<string, T>()).values()
  );
}
