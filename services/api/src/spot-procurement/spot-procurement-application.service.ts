import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { RoleKey } from "@jiangkong/shared-domain";
import {
  pendingRoleKeysForFrozenApprovalNode
} from "../approval/approval-node-access";
import { ApprovalFormService } from "../approval/approval-form.service";
import { assertOrdinaryApplicantCannotReview } from "../approval/approval-self-review";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { VatRateOptionService } from "../invoice-ledger/vat-rate-option.service";
import {
  collapseUnicodeWhitespace,
  trimUnicodeWhitespace
} from "../validation/unicode-whitespace";
import type {
  SpotProcurementAttachmentDto,
  SpotProcurementDraftDto,
  SpotProcurementLineDto
} from "./dto/create-spot-procurement.dto";
import type { CreateSpotProcurementDto } from "./dto/create-spot-procurement.dto";
import type { CreateSpotProcurementVersionDto } from "./dto/create-spot-procurement-version.dto";
import type { ReviewSpotProcurementDto } from "./dto/review-spot-procurement.dto";
import type { UpdateSpotProcurementDraftDto } from "./dto/update-spot-procurement-draft.dto";
import {
  procurementApprovalNodes,
  type SpotProcurementApprovalNode
} from "./spot-procurement-approval-nodes";
import { SpotProcurementBalanceService } from "./spot-procurement-balance.service";
import { calculateSpotProcurementDraft } from "./spot-procurement-money";
import { SpotProcurementPilotService } from "./spot-procurement-pilot.service";
import {
  normalizeSupplierName,
  supplierKey
} from "./spot-procurement-supplier";
import { SPOT_PROCUREMENT_BUSINESS_TYPES } from "./spot-procurement.constants";

const CREATE_ROLES = new Set<RoleKey>([
  "material_staff",
  "material_director"
]);
const VOID_ROLES = new Set<RoleKey>(["project_manager", "finance_director"]);
const ACTIVE_PAYMENT_STATUSES = new Set([
  "approval_pending",
  "approved",
  "approved_pending_payment",
  "partially_paid",
  "paid",
  "settled"
]);
const FROZEN_REVISION_STATUSES = {
  returned: "returned",
  withdrawn: "withdrawn"
} as const;
const WITHDRAW_REVISION_REASON = "申请人撤回采购审批";

type ProcurementLockRow = {
  id: string;
  projectId: string;
  code: string;
  supplierPartyId: string | null;
  supplierKey: string;
  supplierNameSnapshot: string;
  applicantUserId: string;
  handlerUserId: string;
  currentVersionId: string | null;
  status: string;
  approvedAmountCents: bigint;
  actualCostCents?: bigint | null;
  closedAt?: Date | null;
};

type VersionLockRow = {
  id: string;
  procurementId: string;
  versionNo: number;
  status: string;
  reason: string;
  note: string | null;
  supplierPartyId: string | null;
  supplierKey: string;
  supplierNameSnapshot: string;
  handlerUserId: string;
  totalAmountCents: bigint;
  changeReason: string | null;
  changeSummary: Prisma.JsonValue | null;
  submittedAt: Date | null;
  approvedAt: Date | null;
  createdByUserId: string;
};

type ApprovalInstanceLockRow = {
  id: string;
  status: string;
  currentNodeIndex: number;
  frozenNodes: Prisma.JsonValue;
  applicantUserId: string;
};

type LockedPaymentRow = {
  id: string;
  status: string;
};

type PreparedLine = {
  sortOrder: number;
  materialName: string;
  specification: string | null;
  unit: string;
  quantity: Prisma.Decimal;
  invoiceMode: string;
  invoiceType: string | null;
  vatRateOptionId: string | null;
  vatRateValueSnapshot: Prisma.Decimal | null;
  vatRateLabelSnapshot: string | null;
  unitPrice: Prisma.Decimal;
  amountCents: bigint;
  usageLocation: string | null;
  note: string | null;
};

type PreparedDraft = {
  supplierPartyId: string | null;
  supplierName: string;
  supplierKey: string;
  handlerUserId: string;
  reason: string;
  note: string | null;
  lines: PreparedLine[];
  attachments: Array<{
    fileId: string;
    category: string;
    uploadedByUserId: string;
  }>;
  totalAmountCents: bigint;
};

@Injectable()
export class SpotProcurementApplicationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly pilot: SpotProcurementPilotService,
    private readonly vatRates: VatRateOptionService,
    private readonly balances: SpotProcurementBalanceService,
    private readonly approvalForms: ApprovalFormService
  ) {}

  createDraft(actorUserId: string, input: CreateSpotProcurementDto) {
    return this.runWrite(() =>
      this.prisma.$transaction(async (tx) => {
        this.pilot.assertEnabled(input.projectId);
        await this.requireActiveProject(tx, input.projectId);
        const actorRoles = await this.loadActorRoleKeys(
          tx,
          actorUserId,
          input.projectId
        );
        this.requireAnyRole(actorRoles, CREATE_ROLES, "只有物资员或物资主管可以创建零星采购");

        const prepared = await this.prepareDraft(
          tx,
          actorUserId,
          input,
          [actorUserId],
          []
        );
        await this.requireHandlerRole(
          tx,
          prepared.handlerUserId,
          input.projectId,
          actorUserId,
          actorRoles
        );

        const procurement = await tx.spotProcurement.create({
          data: {
            projectId: input.projectId,
            code: requiredText(input.code, "采购编号不能为空"),
            supplierPartyId: prepared.supplierPartyId,
            supplierKey: prepared.supplierKey,
            supplierNameSnapshot: prepared.supplierName,
            applicantUserId: actorUserId,
            handlerUserId: prepared.handlerUserId,
            status: "draft",
            approvedAmountCents: 0n
          }
        });
        const version = await tx.spotProcurementVersion.create({
          data: {
            procurementId: procurement.id,
            versionNo: 1,
            status: "draft",
            reason: prepared.reason,
            note: prepared.note,
            supplierPartyId: prepared.supplierPartyId,
            supplierKey: prepared.supplierKey,
            supplierNameSnapshot: prepared.supplierName,
            handlerUserId: prepared.handlerUserId,
            totalAmountCents: prepared.totalAmountCents,
            createdByUserId: actorUserId
          }
        });
        await this.replaceVersionFacts(tx, version.id, prepared);
        await tx.spotProcurement.update({
          where: { id: procurement.id },
          data: { currentVersionId: version.id }
        });
        await this.audit.record(tx, {
          actorUserId,
          action: "spot_procurement.draft.create",
          businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.application,
          businessId: version.id,
          metadata: {
            projectId: input.projectId,
            procurementId: procurement.id,
            versionNo: 1,
            totalAmountCents: prepared.totalAmountCents.toString()
          }
        });
        return this.applicationReadModel(
          procurement.id,
          input.projectId,
          "draft",
          version.id,
          1,
          "draft",
          prepared.totalAmountCents
        );
      })
    );
  }

  updateDraft(
    procurementId: string,
    actorUserId: string,
    input: UpdateSpotProcurementDraftDto
  ) {
    return this.runWrite(() =>
      this.prisma.$transaction(async (tx) => {
        const procurement = await this.requireLockedProcurement(tx, procurementId);
        this.pilot.assertEnabled(procurement.projectId);
        const version = await this.requireLockedCurrentVersion(tx, procurement);
        this.assertEditableDraft(procurement, version);
        const actorRoles = await this.requireDraftOwnerRole(
          tx,
          procurement,
          actorUserId
        );
        await this.requireActiveApplicantRole(
          tx,
          procurement,
          actorUserId,
          actorRoles
        );
        const currentDraft = await this.storedDraft(tx, version);
        const mergedDraft: SpotProcurementDraftDto = {
          ...input,
          supplierPartyId:
            input.supplierPartyId === undefined
              ? currentDraft.supplierPartyId
              : input.supplierPartyId,
          handlerUserId:
            input.handlerUserId === undefined
              ? currentDraft.handlerUserId
              : input.handlerUserId,
          note: input.note === undefined ? currentDraft.note : input.note,
          attachments:
            input.attachments === undefined
              ? currentDraft.attachments
              : input.attachments
        };
        const prepared = await this.prepareDraft(
          tx,
          actorUserId,
          mergedDraft,
          [
            procurement.applicantUserId,
            procurement.handlerUserId,
            actorUserId
          ],
          currentDraft.attachments?.map((attachment) => attachment.fileId) ?? []
        );
        await this.requireHandlerRole(
          tx,
          prepared.handlerUserId,
          procurement.projectId,
          actorUserId,
          actorRoles
        );
        const revisionComparison =
          await this.recomputeRevisionChangeSummary(tx, version, prepared);

        await tx.spotProcurementVersion.update({
          where: { id: version.id },
          data: {
            reason: prepared.reason,
            note: prepared.note,
            supplierPartyId: prepared.supplierPartyId,
            supplierKey: prepared.supplierKey,
            supplierNameSnapshot: prepared.supplierName,
            handlerUserId: prepared.handlerUserId,
            totalAmountCents: prepared.totalAmountCents,
            ...(revisionComparison
              ? {
                  changeSummary:
                    revisionComparison.changeSummary as Prisma.InputJsonValue
                }
              : {})
          }
        });
        await this.replaceVersionFacts(tx, version.id, prepared);
        await tx.spotProcurement.update({
          where: { id: procurement.id },
          data: {
            supplierPartyId: prepared.supplierPartyId,
            supplierKey: prepared.supplierKey,
            supplierNameSnapshot: prepared.supplierName,
            handlerUserId: prepared.handlerUserId
          }
        });
        await this.audit.record(tx, {
          actorUserId,
          action: "spot_procurement.draft.update",
          businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.application,
          businessId: version.id,
          metadata: {
            procurementId,
            totalAmountCents: prepared.totalAmountCents.toString()
          }
        });
        return this.applicationReadModel(
          procurement.id,
          procurement.projectId,
          "draft",
          version.id,
          version.versionNo,
          "draft",
          prepared.totalAmountCents
        );
      })
    );
  }

  submit(procurementId: string, actorUserId: string) {
    return this.runWrite(async () => {
      let approvalBusinessId: string | null = null;
      const result = await this.prisma.$transaction(async (tx) => {
        const procurement = await this.requireLockedProcurement(tx, procurementId);
        this.pilot.assertEnabled(procurement.projectId);
        const version = await this.requireLockedCurrentVersion(tx, procurement);
        approvalBusinessId = version.id;
        this.assertEditableDraft(procurement, version);
        const actorRoles = await this.requireDraftOwnerRole(
          tx,
          procurement,
          actorUserId
        );
        const applicantRoles = await this.requireActiveApplicantRole(
          tx,
          procurement,
          actorUserId,
          actorRoles
        );
        const storedDraft = await this.storedDraft(tx, version);
        const prepared = await this.prepareDraft(
          tx,
          actorUserId,
          storedDraft,
          [
            procurement.applicantUserId,
            procurement.handlerUserId,
            actorUserId
          ],
          storedDraft.attachments?.map((attachment) => attachment.fileId) ?? []
        );
        await this.requireHandlerRole(
          tx,
          prepared.handlerUserId,
          procurement.projectId,
          actorUserId,
          actorRoles
        );
        if (prepared.totalAmountCents <= 0n) {
          throw new BadRequestException(
            "采购申请合计金额必须大于 0，不能提交审批"
          );
        }
        const revisionComparison =
          await this.recomputeRevisionChangeSummary(tx, version, prepared);
        if (
          revisionComparison &&
          revisionComparison.changeSummary.changes.length === 0 &&
          revisionComparison.previousVersion.status !==
            FROZEN_REVISION_STATUSES.withdrawn
        ) {
          throw new BadRequestException(
            "采购版本没有实际字段变化，不能提交审批"
          );
        }
        await this.replaceVersionFacts(tx, version.id, prepared);

        const now = new Date();
        const frozenNodes = procurementApprovalNodes(applicantRoles);
        const approval = await tx.approvalInstance.create({
          data: {
            flowType: "spot_procurement.approve",
            businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.application,
            businessId: version.id,
            status: "approval_pending",
            currentNodeIndex: 0,
            frozenNodes: frozenNodes as unknown as Prisma.InputJsonValue,
            applicantUserId: procurement.applicantUserId
          }
        });
        await tx.spotProcurementVersion.update({
          where: { id: version.id },
          data: {
            status: "approval_pending",
            submittedAt: now,
            totalAmountCents: prepared.totalAmountCents,
            ...(revisionComparison
              ? {
                  changeSummary:
                    revisionComparison.changeSummary as Prisma.InputJsonValue
                }
              : {})
          }
        });
        await tx.spotProcurement.update({
          where: { id: procurement.id },
          data: {
            status: "approval_pending",
            supplierPartyId: prepared.supplierPartyId,
            supplierKey: prepared.supplierKey,
            supplierNameSnapshot: prepared.supplierName,
            handlerUserId: prepared.handlerUserId
          }
        });
        if (applicantRoles.includes("material_director")) {
          await tx.approvalActionLog.create({
            data: {
              approvalInstanceId: approval.id,
              action: "node_skipped",
              actorUserId,
              comment: "申请人具备物资主管岗位，自动跳过物资主管审批",
              metadata: {
                skippedRoleKey: "material_director",
                reason: "applicant_has_material_director_role",
                applicantUserId: procurement.applicantUserId
              }
            }
          });
        }
        await this.audit.record(tx, {
          actorUserId,
          action: "spot_procurement.approval.submit",
          businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.application,
          businessId: version.id,
          metadata: {
            procurementId,
            approvalInstanceId: approval.id,
            frozenNodes: frozenNodes as unknown as Prisma.InputJsonValue,
            totalAmountCents: prepared.totalAmountCents.toString()
          }
        });
        return this.applicationReadModel(
          procurement.id,
          procurement.projectId,
          "approval_pending",
          version.id,
          version.versionNo,
          "approval_pending",
          prepared.totalAmountCents
        );
      });
      if (approvalBusinessId) {
        await this.approvalForms.tryRefreshLatestForBusiness(
          SPOT_PROCUREMENT_BUSINESS_TYPES.application,
          approvalBusinessId,
          actorUserId,
          "approval.submit"
        );
      }
      return result;
    });
  }

  withdrawApproval(procurementId: string, actorUserId: string) {
    return this.runWrite(async () => {
      let approvalBusinessId: string | null = null;
      const result = await this.prisma.$transaction(async (tx) => {
        const procurement = await this.requireLockedProcurement(tx, procurementId);
        this.pilot.assertEnabled(procurement.projectId);
        const version = await this.requireLockedCurrentVersion(tx, procurement);
        approvalBusinessId = version.id;
        if (
          procurement.status !== "approval_pending" ||
          version.status !== "approval_pending"
        ) {
          throw new ConflictException("当前采购申请不在审批中，不能撤回");
        }
        const approval = await this.requireLockedApprovalInstance(
          tx,
          version.id,
          "approval_pending"
        );
        if (
          actorUserId !== procurement.applicantUserId ||
          actorUserId !== approval.applicantUserId
        ) {
          throw new ForbiddenException("只有采购申请人可以撤回审批");
        }

        await tx.approvalInstance.update({
          where: { id: approval.id },
          data: { status: "withdrawn" }
        });
        await tx.approvalActionLog.create({
          data: {
            approvalInstanceId: approval.id,
            action: "withdraw",
            actorUserId,
            comment: WITHDRAW_REVISION_REASON
          }
        });
        const newVersion = await this.createRevisionDraftFromFrozenVersion(
          tx,
          procurement,
          version,
          actorUserId,
          FROZEN_REVISION_STATUSES.withdrawn,
          WITHDRAW_REVISION_REASON
        );
        await this.audit.record(tx, {
          actorUserId,
          action: "spot_procurement.approval.withdraw",
          businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.application,
          businessId: version.id,
          metadata: {
            procurementId: procurement.id,
            approvalInstanceId: approval.id,
            sourceVersionId: version.id,
            newVersionId: newVersion.id
          }
        });
        return this.applicationReadModel(
          procurement.id,
          procurement.projectId,
          "draft",
          newVersion.id,
          newVersion.versionNo,
          "draft",
          newVersion.totalAmountCents
        );
      });
      if (approvalBusinessId) {
        await this.approvalForms.tryRefreshLatestForBusiness(
          SPOT_PROCUREMENT_BUSINESS_TYPES.application,
          approvalBusinessId,
          actorUserId,
          "approval.withdraw"
        );
      }
      return result;
    });
  }

  review(
    procurementId: string,
    actorUserId: string,
    input: ReviewSpotProcurementDto
  ) {
    return this.runWrite(async () => {
      let approvalBusinessId: string | null = null;
      const result = await this.prisma.$transaction(async (tx) => {
        const procurement = await this.requireLockedProcurement(tx, procurementId);
        this.pilot.assertEnabled(procurement.projectId);
        const version = await this.requireLockedCurrentVersion(tx, procurement);
        approvalBusinessId = version.id;
        if (
          procurement.status !== "approval_pending" ||
          version.status !== "approval_pending"
        ) {
          throw new ConflictException("当前采购版本不在审批中");
        }
        const approval = await this.requireLockedApprovalInstance(
          tx,
          version.id,
          "approval_pending"
        );
        const actorRoles = await this.loadActorRoleKeys(
          tx,
          actorUserId,
          procurement.projectId
        );
        const pendingRoles = pendingRoleKeysForFrozenApprovalNode(
          approval.frozenNodes,
          approval.currentNodeIndex
        );
        const approvedRoleKey = pendingRoles.find((roleKey) =>
          actorRoles.includes(roleKey)
        );
        if (!approvedRoleKey) {
          throw new ForbiddenException("当前用户不是本审批节点处理人");
        }
        assertOrdinaryApplicantCannotReview({
          applicantUserId: approval.applicantUserId,
          actorUserId,
          actorRoleKeys: actorRoles,
          approvedRoleKey
        });

        const comment = optionalText(input.comment);
        if (input.decision !== "approve" && !comment) {
          throw new BadRequestException("驳回或退回采购申请时必须填写审批意见");
        }
        await tx.approvalActionLog.create({
          data: {
            approvalInstanceId: approval.id,
            action: input.decision,
            actorUserId,
            comment,
            metadata: { reviewRoleKey: approvedRoleKey }
          }
        });

        if (input.decision === "reject") {
          await tx.approvalInstance.update({
            where: { id: approval.id },
            data: { status: "rejected" }
          });
          await tx.spotProcurementVersion.update({
            where: { id: version.id },
            data: { status: "rejected" }
          });
          await tx.spotProcurement.update({
            where: { id: procurement.id },
            data: { status: "draft" }
          });
          await this.recordReviewAudit(
            tx,
            actorUserId,
            version.id,
            procurement.id,
            input.decision,
            approvedRoleKey
          );
          return this.applicationReadModel(
            procurement.id,
            procurement.projectId,
            "draft",
            version.id,
            version.versionNo,
            "rejected",
            version.totalAmountCents
          );
        }

        if (input.decision === "return_to_applicant") {
          await tx.approvalInstance.update({
            where: { id: approval.id },
            data: { status: "returned_to_applicant" }
          });
          const newVersion = await this.createRevisionDraftFromFrozenVersion(
            tx,
            procurement,
            version,
            actorUserId,
            FROZEN_REVISION_STATUSES.returned,
            comment as string
          );
          await this.recordReviewAudit(
            tx,
            actorUserId,
            version.id,
            procurement.id,
            input.decision,
            approvedRoleKey,
            {
              sourceVersionId: version.id,
              newVersionId: newVersion.id
            }
          );
          return this.applicationReadModel(
            procurement.id,
            procurement.projectId,
            "draft",
            newVersion.id,
            newVersion.versionNo,
            "draft",
            newVersion.totalAmountCents
          );
        }

        const nextNodes = this.approveCurrentNode(
          approval.frozenNodes,
          approval.currentNodeIndex,
          approvedRoleKey
        );
        const isFinalNode =
          approval.currentNodeIndex >= nextNodes.length - 1;
        if (!isFinalNode) {
          await tx.approvalInstance.update({
            where: { id: approval.id },
            data: {
              currentNodeIndex: approval.currentNodeIndex + 1,
              frozenNodes: nextNodes as unknown as Prisma.InputJsonValue
            }
          });
          await this.recordReviewAudit(
            tx,
            actorUserId,
            version.id,
            procurement.id,
            input.decision,
            approvedRoleKey
          );
          return this.applicationReadModel(
            procurement.id,
            procurement.projectId,
            "approval_pending",
            version.id,
            version.versionNo,
            "approval_pending",
            version.totalAmountCents
          );
        }

        const now = new Date();
        await tx.approvalInstance.update({
          where: { id: approval.id },
          data: {
            status: "approved",
            frozenNodes: nextNodes as unknown as Prisma.InputJsonValue
          }
        });
        await tx.spotProcurementVersion.updateMany({
          where: {
            procurementId: procurement.id,
            id: { not: version.id },
            status: "approved"
          },
          data: { status: "invalidated" }
        });
        await tx.spotProcurementVersion.update({
          where: { id: version.id },
          data: { status: "approved", approvedAt: now }
        });
        await tx.spotProcurement.update({
          where: { id: procurement.id },
          data: {
            status: "approved_in_progress",
            currentVersionId: version.id,
            approvedAmountCents: version.totalAmountCents
          }
        });
        const balanceSuggestion =
          await this.balances.suggestionWithClient(
            tx,
            procurement.projectId,
            version.supplierKey,
            version.totalAmountCents
          );
        const suggestedBalanceAmountCents = BigInt(
          balanceSuggestion.suggestedBalanceAmountCents
        );
        const payment = await tx.spotProcurementPayment.create({
          data: {
            projectId: procurement.projectId,
            procurementId: procurement.id,
            procurementVersionId: version.id,
            code: `${procurement.code}-V${version.versionNo}-P001`,
            status: "draft",
            settlementAmountCents: version.totalAmountCents,
            supplierBalanceAmountCents:
              suggestedBalanceAmountCents,
            companyPaymentAmountCents:
              version.totalAmountCents -
              suggestedBalanceAmountCents,
            paidAmountCents: 0n,
            executedSupplierBalanceAmountCents: 0n,
            canceledAmountCents: 0n,
            canceledCompanyPaymentAmountCents: 0n,
            canceledSupplierBalanceAmountCents: 0n,
            payeePartyId: version.supplierPartyId,
            payeeNameSnapshot: version.supplierNameSnapshot,
            handlerUserId: version.handlerUserId,
            createdByUserId: actorUserId,
            paymentNote: null
          }
        });
        await this.audit.record(tx, {
          actorUserId,
          action: "spot_procurement.payment.draft.auto_create",
          businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.payment,
          businessId: payment.id,
          metadata: {
            procurementId: procurement.id,
            procurementVersionId: version.id,
            paymentCode: payment.code,
            settlementAmountCents: version.totalAmountCents.toString(),
            availableBalanceAmountCents:
              balanceSuggestion.availableBalanceAmountCents,
            suggestedBalanceAmountCents:
              balanceSuggestion.suggestedBalanceAmountCents
          }
        });
        await this.recordReviewAudit(
          tx,
          actorUserId,
          version.id,
          procurement.id,
          input.decision,
          approvedRoleKey
        );
        return this.applicationReadModel(
          procurement.id,
          procurement.projectId,
          "approved_in_progress",
          version.id,
          version.versionNo,
          "approved",
          version.totalAmountCents
        );
      });
      if (approvalBusinessId) {
        await this.approvalForms.tryRefreshLatestForBusiness(
          SPOT_PROCUREMENT_BUSINESS_TYPES.application,
          approvalBusinessId,
          actorUserId,
          `approval.${input.decision}`
        );
      }
      return result;
    });
  }

  createVersion(
    procurementId: string,
    actorUserId: string,
    input: CreateSpotProcurementVersionDto
  ) {
    return this.runWrite(() =>
      this.prisma.$transaction(async (tx) => {
        const procurement = await this.requireLockedProcurement(tx, procurementId);
        this.pilot.assertEnabled(procurement.projectId);
        if (procurement.status === "closed") {
          throw new ConflictException("已办结采购不能创建新版本");
        }
        if (procurement.status === "voided") {
          throw new ConflictException("已撤销采购不能创建新版本");
        }
        const previousVersion = await this.requireLockedCurrentVersion(
          tx,
          procurement
        );
        if (!["approved", "rejected"].includes(previousVersion.status)) {
          throw new ConflictException(
            previousVersion.status === "draft"
              ? "当前采购版本仍是草稿，请直接编辑后提交"
              : "当前采购版本正在审批或状态不可变更，不能创建新版本"
          );
        }
        const actorRoles = await this.requireDraftOwnerRole(
          tx,
          procurement,
          actorUserId
        );
        await this.requireActiveApplicantRole(
          tx,
          procurement,
          actorUserId,
          actorRoles
        );
        const changeReason = requiredText(
          input.changeReason,
          "请填写采购版本变更原因"
        );
        const payments = await tx.spotProcurementPayment.findMany({
          where: { procurementId: procurement.id },
          select: { id: true, status: true }
        });
        const realExecution =
          await tx.spotProcurementPaymentExecution.findFirst({
            where: {
              paymentId: { in: payments.map((payment) => payment.id) },
              voidedAt: null
            },
            select: { id: true }
          });
        if (realExecution) {
          throw new ConflictException(
            "采购已发生真实付款，不能通过普通版本变更覆盖既有事实"
          );
        }
        if (
          payments.some((payment) =>
            ACTIVE_PAYMENT_STATUSES.has(payment.status)
          )
        ) {
          throw new ConflictException(
            "已有已提交或已批准付款未处理，不能切换采购版本"
          );
        }

        const previousDraft = await this.storedDraft(tx, previousVersion);
        const mergedDraft: SpotProcurementDraftDto = {
          ...input,
          supplierPartyId:
            input.supplierPartyId === undefined
              ? previousDraft.supplierPartyId
              : input.supplierPartyId,
          handlerUserId:
            input.handlerUserId === undefined
              ? previousDraft.handlerUserId
              : input.handlerUserId,
          note: input.note === undefined ? previousDraft.note : input.note,
          attachments:
            input.attachments === undefined
              ? previousDraft.attachments
              : input.attachments
        };
        const prepared = await this.prepareDraft(
          tx,
          actorUserId,
          mergedDraft,
          [
            procurement.applicantUserId,
            procurement.handlerUserId,
            actorUserId
          ],
          previousDraft.attachments?.map((attachment) => attachment.fileId) ?? []
        );
        await this.requireHandlerRole(
          tx,
          prepared.handlerUserId,
          procurement.projectId,
          actorUserId,
          actorRoles
        );
        const [previousLines, previousAttachments] = await Promise.all([
          tx.spotProcurementLine.findMany({
            where: { versionId: previousVersion.id },
            orderBy: { sortOrder: "asc" }
          }),
          tx.spotProcurementAttachment.findMany({
            where: { versionId: previousVersion.id },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }]
          })
        ]);
        const changeSummary = this.changeSummary(
          previousVersion,
          previousLines,
          previousAttachments,
          prepared
        );
        if (changeSummary.changes.length === 0) {
          throw new BadRequestException(
            "采购版本没有实际字段变化，请直接使用当前版本"
          );
        }
        const now = new Date();
        const draftPaymentIds = payments
          .filter((payment) => payment.status === "draft")
          .map((payment) => payment.id);
        if (draftPaymentIds.length) {
          const invalidated = await tx.spotProcurementPayment.updateMany({
            where: { id: { in: draftPaymentIds }, status: "draft" },
            data: {
              status: "invalidated",
              invalidatedAt: now,
              invalidatedByUserId: actorUserId,
              invalidatedReason: `采购版本变更：${changeReason}`
            }
          });
          if (invalidated.count !== draftPaymentIds.length) {
            throw new ConflictException(
              "付款状态已变化，请重试采购版本变更"
            );
          }
        }
        await tx.spotProcurementVersion.update({
          where: { id: previousVersion.id },
          data: { status: "invalidated" }
        });
        const versionNo = previousVersion.versionNo + 1;
        const version = await tx.spotProcurementVersion.create({
          data: {
            procurementId: procurement.id,
            versionNo,
            status: "draft",
            reason: prepared.reason,
            note: prepared.note,
            supplierPartyId: prepared.supplierPartyId,
            supplierKey: prepared.supplierKey,
            supplierNameSnapshot: prepared.supplierName,
            handlerUserId: prepared.handlerUserId,
            totalAmountCents: prepared.totalAmountCents,
            changeReason,
            changeSummary: changeSummary as Prisma.InputJsonValue,
            createdByUserId: actorUserId
          }
        });
        await this.replaceVersionFacts(tx, version.id, prepared);
        await tx.spotProcurement.update({
          where: { id: procurement.id },
          data: {
            currentVersionId: version.id,
            status: "draft",
            approvedAmountCents: 0n,
            supplierPartyId: prepared.supplierPartyId,
            supplierKey: prepared.supplierKey,
            supplierNameSnapshot: prepared.supplierName,
            handlerUserId: prepared.handlerUserId
          }
        });
        await this.audit.record(tx, {
          actorUserId,
          action: "spot_procurement.version.create",
          businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.application,
          businessId: version.id,
          metadata: {
            procurementId: procurement.id,
            previousVersionId: previousVersion.id,
            versionNo,
            changeReason,
            changeSummary: changeSummary as Prisma.InputJsonValue
          }
        });
        return this.applicationReadModel(
          procurement.id,
          procurement.projectId,
          "draft",
          version.id,
          versionNo,
          "draft",
          prepared.totalAmountCents
        );
      })
    );
  }

  voidProcurement(
    procurementId: string,
    actorUserId: string,
    reasonInput: string
  ) {
    return this.runWrite(() =>
      this.prisma.$transaction(async (tx) => {
        const procurement = await this.requireLockedProcurement(tx, procurementId);
        this.pilot.assertEnabled(procurement.projectId);
        if (procurement.status === "closed") {
          throw new ConflictException("采购已正式办结，不能撤销");
        }
        if (procurement.status === "voided") {
          throw new ConflictException("采购已经撤销，不能重复操作");
        }
        // 固定锁顺序：采购根单 -> 当前版本 -> 全部付款 -> 在途审批。
        // Task 5 的付款写路径必须沿用“版本 -> 付款”，不得反向取锁。
        const version = procurement.currentVersionId
          ? await this.requireLockedCurrentVersion(tx, procurement)
          : null;
        const payments = await this.lockProcurementPayments(
          tx,
          procurement.id
        );
        const actorRoles = await this.loadActorRoleKeys(
          tx,
          actorUserId,
          procurement.projectId
        );
        this.requireAnyRole(actorRoles, VOID_ROLES, "当前用户无权撤销零星采购");
        const reason = requiredText(reasonInput, "请填写采购撤销原因");
        const realExecution =
          await tx.spotProcurementPaymentExecution.findFirst({
            where: {
              paymentId: { in: payments.map((payment) => payment.id) },
              voidedAt: null
            },
            select: { id: true }
          });
        if (realExecution) {
          throw new ConflictException("采购已发生真实付款，不能直接撤销");
        }
        if (
          payments.some((payment) =>
            ACTIVE_PAYMENT_STATUSES.has(payment.status)
          )
        ) {
          throw new ConflictException("已有活动付款申请，需先退回或作废后再撤销采购");
        }
        const approval = version
          ? await this.lockApprovalInstance(
              tx,
              version.id,
              "approval_pending"
            )
          : null;
        const now = new Date();
        const draftPaymentIds = payments
          .filter((payment) => payment.status === "draft")
          .map((payment) => payment.id);
        if (draftPaymentIds.length) {
          const invalidated = await tx.spotProcurementPayment.updateMany({
            where: { id: { in: draftPaymentIds }, status: "draft" },
            data: {
              status: "invalidated",
              invalidatedAt: now,
              invalidatedByUserId: actorUserId,
              invalidatedReason: `采购撤销：${reason}`
            }
          });
          if (invalidated.count !== draftPaymentIds.length) {
            throw new ConflictException("付款状态已变化，请重试采购撤销");
          }
        }
        if (version) {
          await tx.spotProcurementVersion.update({
            where: { id: version.id },
            data: { status: "invalidated" }
          });
        }
        if (approval) {
          await tx.approvalInstance.update({
            where: { id: approval.id },
            data: { status: "voided" }
          });
          await tx.approvalActionLog.create({
            data: {
              approvalInstanceId: approval.id,
              action: "void",
              actorUserId,
              comment: reason
            }
          });
        }
        await tx.spotProcurement.update({
          where: { id: procurement.id },
          data: {
            status: "voided",
            voidedAt: now,
            voidedByUserId: actorUserId,
            voidReason: reason
          }
        });
        await this.audit.record(tx, {
          actorUserId,
          action: "spot_procurement.void",
          businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.application,
          businessId: version?.id ?? procurement.id,
          metadata: {
            procurementId: procurement.id,
            reason
          }
        });
        return {
          procurementId: procurement.id,
          projectId: procurement.projectId,
          status: "voided"
        };
      })
    );
  }

  private async prepareDraft(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    input: SpotProcurementDraftDto,
    allowedAttachmentUploaderUserIds: readonly string[],
    preauthorizedAttachmentFileIds: readonly string[]
  ): Promise<PreparedDraft> {
    const calculation = calculateSpotProcurementDraft(input);
    const supplierPartyId = optionalId(input.supplierPartyId);
    if (supplierPartyId) {
      const party = await tx.businessParty.findUnique({
        where: { id: supplierPartyId },
        select: { id: true, status: true }
      });
      if (!party) {
        throw new NotFoundException("供应商合作单位不存在");
      }
      if (party.status !== "active") {
        throw new BadRequestException("供应商合作单位已停用");
      }
    }
    const supplierName = normalizeSupplierName(input.supplierName);
    const attachments = input.attachments ?? [];
    const handlerUserId = optionalId(input.handlerUserId) ?? actorUserId;
    const attachmentUploaderByFileId = await this.requireActiveFiles(
      tx,
      attachments,
      new Set([
        ...allowedAttachmentUploaderUserIds,
        actorUserId,
        handlerUserId
      ]),
      new Set(preauthorizedAttachmentFileIds)
    );
    const lines: PreparedLine[] = [];
    for (const [index, line] of input.lines.entries()) {
      const amountCents = calculation.lines[index]?.amountCents;
      if (amountCents === undefined) {
        throw new BadRequestException("采购明细计算结果不完整");
      }
      let vatRateValueSnapshot: Prisma.Decimal | null = null;
      let vatRateLabelSnapshot: string | null = null;
      let vatRateOptionId: string | null = null;
      if (line.invoiceMode === "invoice") {
        const optionId = requiredText(
          line.vatRateOptionId,
          "有票明细必须选择税率"
        );
        const option = await this.vatRates.requireEnabledOption(optionId, tx);
        vatRateOptionId = option.id;
        vatRateValueSnapshot = new Prisma.Decimal(option.rateValue);
        vatRateLabelSnapshot = option.label;
      }
      lines.push({
        sortOrder: index + 1,
        materialName: requiredText(line.materialName, "材料名称不能为空"),
        specification: optionalText(line.specification),
        unit: requiredText(line.unit, "材料单位不能为空"),
        quantity: new Prisma.Decimal(line.quantity),
        invoiceMode: line.invoiceMode,
        invoiceType: line.invoiceMode === "invoice" ? line.invoiceType ?? null : null,
        vatRateOptionId,
        vatRateValueSnapshot,
        vatRateLabelSnapshot,
        unitPrice: new Prisma.Decimal(line.unitPrice),
        amountCents,
        usageLocation: optionalText(line.usageLocation),
        note: optionalText(line.note)
      });
    }
    return {
      supplierPartyId,
      supplierName,
      supplierKey: supplierKey({ supplierPartyId, supplierName }),
      handlerUserId,
      reason: requiredText(input.reason, "采购原因不能为空"),
      note: optionalText(input.note),
      lines,
      attachments: attachments.map((attachment) => ({
        fileId: attachment.fileId,
        category: attachment.category,
        uploadedByUserId:
          attachmentUploaderByFileId.get(attachment.fileId) ?? actorUserId
      })),
      totalAmountCents: calculation.totalAmountCents
    };
  }

  private async storedDraft(
    tx: Prisma.TransactionClient,
    version: VersionLockRow
  ): Promise<SpotProcurementDraftDto> {
    const { lines, attachments } = await this.loadFrozenVersionFacts(
      tx,
      version.id
    );
    return {
      supplierPartyId: version.supplierPartyId,
      supplierName: version.supplierNameSnapshot,
      handlerUserId: version.handlerUserId,
      reason: version.reason,
      note: version.note,
      lines: lines.map((line) => ({
        materialName: line.materialName,
        specification: line.specification ?? undefined,
        unit: line.unit,
        quantity: line.quantity.toString(),
        invoiceMode: line.invoiceMode as SpotProcurementLineDto["invoiceMode"],
        invoiceType:
          (line.invoiceType as SpotProcurementLineDto["invoiceType"]) ??
          undefined,
        vatRateOptionId: line.vatRateOptionId ?? undefined,
        unitPrice: line.unitPrice.toString(),
        usageLocation: line.usageLocation ?? undefined,
        note: line.note ?? undefined,
        amountCents: line.amountCents.toString()
      })),
      attachments: attachments.map((attachment) => ({
        fileId: attachment.fileId,
        category:
          attachment.category as SpotProcurementAttachmentDto["category"]
      })),
      totalAmountCents: version.totalAmountCents.toString()
    };
  }

  private async loadFrozenVersionFacts(
    tx: Prisma.TransactionClient,
    versionId: string
  ) {
    const [lines, attachments] = await Promise.all([
      tx.spotProcurementLine.findMany({
        where: { versionId },
        orderBy: { sortOrder: "asc" }
      }),
      tx.spotProcurementAttachment.findMany({
        where: { versionId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }]
      })
    ]);
    return { lines, attachments };
  }

  private async createRevisionDraftFromFrozenVersion(
    tx: Prisma.TransactionClient,
    procurement: ProcurementLockRow,
    sourceVersion: VersionLockRow,
    actorUserId: string,
    sourceTerminalStatus:
      | typeof FROZEN_REVISION_STATUSES.returned
      | typeof FROZEN_REVISION_STATUSES.withdrawn,
    changeReason: string
  ) {
    const { lines, attachments } = await this.loadFrozenVersionFacts(
      tx,
      sourceVersion.id
    );
    await tx.spotProcurementVersion.update({
      where: { id: sourceVersion.id },
      data: { status: sourceTerminalStatus }
    });
    const newVersion = await tx.spotProcurementVersion.create({
      data: {
        procurementId: procurement.id,
        versionNo: sourceVersion.versionNo + 1,
        status: "draft",
        reason: sourceVersion.reason,
        note: sourceVersion.note,
        supplierPartyId: sourceVersion.supplierPartyId,
        supplierKey: sourceVersion.supplierKey,
        supplierNameSnapshot: sourceVersion.supplierNameSnapshot,
        handlerUserId: sourceVersion.handlerUserId,
        totalAmountCents: sourceVersion.totalAmountCents,
        changeReason,
        changeSummary: { changes: [] },
        createdByUserId: actorUserId
      }
    });
    if (lines.length) {
      await tx.spotProcurementLine.createMany({
        data: lines.map((line) => ({
          versionId: newVersion.id,
          sortOrder: line.sortOrder,
          materialName: line.materialName,
          specification: line.specification,
          unit: line.unit,
          quantity: line.quantity,
          invoiceMode: line.invoiceMode,
          invoiceType: line.invoiceType,
          vatRateOptionId: line.vatRateOptionId,
          vatRateValueSnapshot: line.vatRateValueSnapshot,
          vatRateLabelSnapshot: line.vatRateLabelSnapshot,
          unitPrice: line.unitPrice,
          amountCents: line.amountCents,
          usageLocation: line.usageLocation,
          note: line.note
        }))
      });
    }
    if (attachments.length) {
      await tx.spotProcurementAttachment.createMany({
        data: attachments.map((attachment) => ({
          versionId: newVersion.id,
          fileId: attachment.fileId,
          category: attachment.category,
          uploadedByUserId: attachment.uploadedByUserId
        }))
      });
    }
    await tx.spotProcurement.update({
      where: { id: procurement.id },
      data: {
        currentVersionId: newVersion.id,
        status: "draft",
        supplierPartyId: sourceVersion.supplierPartyId,
        supplierKey: sourceVersion.supplierKey,
        supplierNameSnapshot: sourceVersion.supplierNameSnapshot,
        handlerUserId: sourceVersion.handlerUserId
      }
    });
    return newVersion;
  }

  private async replaceVersionFacts(
    tx: Prisma.TransactionClient,
    versionId: string,
    prepared: PreparedDraft
  ) {
    await tx.spotProcurementLine.deleteMany({ where: { versionId } });
    if (prepared.lines.length) {
      await tx.spotProcurementLine.createMany({
        data: prepared.lines.map((line) => ({ versionId, ...line }))
      });
    }
    await tx.spotProcurementAttachment.deleteMany({ where: { versionId } });
    if (prepared.attachments.length) {
      await tx.spotProcurementAttachment.createMany({
        data: prepared.attachments.map((attachment) => ({
          versionId,
          fileId: attachment.fileId,
          category: attachment.category,
          uploadedByUserId: attachment.uploadedByUserId
        }))
      });
    }
  }

  private async requireActiveFiles(
    tx: Prisma.TransactionClient,
    attachments: SpotProcurementAttachmentDto[],
    allowedUploaderUserIds: ReadonlySet<string>,
    preauthorizedFileIds: ReadonlySet<string>
  ) {
    const fileIds = attachments.map((attachment) => attachment.fileId);
    if (new Set(fileIds).size !== fileIds.length) {
      throw new BadRequestException("同一采购版本不能重复引用同一附件");
    }
    if (!fileIds.length) return new Map<string, string>();
    const files = await tx.fileObject.findMany({
      where: { id: { in: fileIds } },
      select: { id: true, storageStatus: true, uploadedByUserId: true }
    });
    const activeIds = new Set(
      files
        .filter((file) => file.storageStatus === "active")
        .map((file) => file.id)
    );
    if (fileIds.some((fileId) => !activeIds.has(fileId))) {
      throw new BadRequestException("采购附件不存在或已失效，请重新上传");
    }
    if (
      files.some(
        (file) =>
          !preauthorizedFileIds.has(file.id) &&
          !allowedUploaderUserIds.has(file.uploadedByUserId)
      )
    ) {
      throw new ForbiddenException(
        "采购附件必须由申请人、采购经办人或本次操作人上传"
      );
    }
    return new Map(files.map((file) => [file.id, file.uploadedByUserId]));
  }

  private async requireActiveProject(
    tx: Prisma.TransactionClient,
    projectId: string
  ) {
    const project = await tx.project.findUnique({
      where: { id: projectId },
      select: { id: true, isActive: true }
    });
    if (!project) {
      throw new NotFoundException("采购项目不存在");
    }
    if (project.isActive === false) {
      throw new BadRequestException("采购项目已停用");
    }
  }

  private async requireHandlerRole(
    tx: Prisma.TransactionClient,
    handlerUserId: string,
    projectId: string,
    actorUserId: string,
    actorRoles: RoleKey[]
  ) {
    await this.requireActiveUser(
      tx,
      handlerUserId,
      "采购经办人不存在或已停用"
    );
    const handlerRoles =
      handlerUserId === actorUserId
        ? actorRoles
        : await this.loadActorRoleKeys(tx, handlerUserId, projectId);
    this.requireAnyRole(
      handlerRoles,
      CREATE_ROLES,
      "采购经办人必须是本项目物资员或物资主管"
    );
  }

  private async requireActiveUser(
    tx: Prisma.TransactionClient,
    userId: string,
    message: string
  ) {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, isActive: true }
    });
    if (!user?.isActive) {
      throw new BadRequestException(message);
    }
  }

  private async requireActiveApplicantRole(
    tx: Prisma.TransactionClient,
    procurement: ProcurementLockRow,
    actorUserId: string,
    actorRoles: RoleKey[]
  ) {
    await this.requireActiveUser(
      tx,
      procurement.applicantUserId,
      "采购申请人不存在或已停用"
    );
    const applicantRoles =
      procurement.applicantUserId === actorUserId
        ? actorRoles
        : await this.loadActorRoleKeys(
            tx,
            procurement.applicantUserId,
            procurement.projectId
          );
    this.requireAnyRole(
      applicantRoles,
      CREATE_ROLES,
      "采购申请人当前不具备物资员或物资主管岗位"
    );
    return applicantRoles;
  }

  private async requireDraftOwnerRole(
    tx: Prisma.TransactionClient,
    procurement: ProcurementLockRow,
    actorUserId: string
  ) {
    if (
      actorUserId !== procurement.applicantUserId &&
      actorUserId !== procurement.handlerUserId
    ) {
      throw new ForbiddenException("只有采购申请人或经办人可以修改并提交采购");
    }
    const roles = await this.loadActorRoleKeys(
      tx,
      actorUserId,
      procurement.projectId
    );
    this.requireAnyRole(roles, CREATE_ROLES, "当前用户不再具备采购创建岗位");
    return roles;
  }

  private requireAnyRole(
    roles: readonly RoleKey[],
    allowed: ReadonlySet<RoleKey>,
    message: string
  ) {
    if (!roles.some((role) => allowed.has(role))) {
      throw new ForbiddenException(message);
    }
  }

  private assertEditableDraft(
    procurement: ProcurementLockRow,
    version: VersionLockRow
  ) {
    if (procurement.status !== "draft" || version.status !== "draft") {
      throw new ConflictException("当前采购版本不是可编辑草稿");
    }
  }

  private async loadActorRoleKeys(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    projectId: string
  ): Promise<RoleKey[]> {
    const [globalPositions, projectPositions, memberPositions] =
      await Promise.all([
        tx.userPosition.findMany({
          where: { userId: actorUserId, projectId: null },
          select: { positionId: true, projectId: true }
        }),
        tx.userPosition.findMany({
          where: { userId: actorUserId, projectId },
          select: { positionId: true, projectId: true }
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
    return [
      ...new Set([
        ...positions.map((position) => position.key as RoleKey),
        ...memberPositions.map(
          (position) => position.positionKey as RoleKey
        )
      ])
    ];
  }

  private async requireLockedProcurement(
    tx: Prisma.TransactionClient,
    procurementId: string
  ) {
    const rows = await tx.$queryRaw<Array<ProcurementLockRow>>(Prisma.sql`
      SELECT
        "id",
        "projectId",
        "code",
        "supplierPartyId",
        "supplierKey",
        "supplierNameSnapshot",
        "applicantUserId",
        "handlerUserId",
        "currentVersionId",
        "status",
        "approvedAmountCents",
        "actualCostCents",
        "closedAt"
      FROM "SpotProcurement"
      WHERE "id" = ${procurementId}
      LIMIT 1
      FOR UPDATE
    `);
    const procurement = rows[0];
    if (!procurement) {
      throw new NotFoundException("零星采购不存在");
    }
    return procurement;
  }

  private async requireLockedCurrentVersion(
    tx: Prisma.TransactionClient,
    procurement: ProcurementLockRow
  ) {
    if (!procurement.currentVersionId) {
      throw new ConflictException("零星采购缺少当前版本");
    }
    const rows = await tx.$queryRaw<Array<VersionLockRow>>(Prisma.sql`
      SELECT
        "id",
        "procurementId",
        "versionNo",
        "status",
        "reason",
        "note",
        "supplierPartyId",
        "supplierKey",
        "supplierNameSnapshot",
        "handlerUserId",
        "totalAmountCents",
        "changeReason",
        "changeSummary",
        "submittedAt",
        "approvedAt",
        "createdByUserId"
      FROM "SpotProcurementVersion"
      WHERE "id" = ${procurement.currentVersionId}
        AND "procurementId" = ${procurement.id}
      LIMIT 1
      FOR UPDATE
    `);
    const version = rows[0];
    if (!version) {
      throw new ConflictException("零星采购当前版本不存在或归属不正确");
    }
    return version;
  }

  private async requireLockedPreviousVersion(
    tx: Prisma.TransactionClient,
    version: VersionLockRow
  ) {
    if (version.versionNo <= 1) {
      throw new ConflictException("采购修订版本缺少可比较的前一版本");
    }
    const rows = await tx.$queryRaw<Array<VersionLockRow>>(Prisma.sql`
      SELECT
        "id",
        "procurementId",
        "versionNo",
        "status",
        "reason",
        "note",
        "supplierPartyId",
        "supplierKey",
        "supplierNameSnapshot",
        "handlerUserId",
        "totalAmountCents",
        "changeReason",
        "changeSummary",
        "submittedAt",
        "approvedAt",
        "createdByUserId"
      FROM "SpotProcurementVersion"
      WHERE "procurementId" = ${version.procurementId}
        AND "versionNo" = ${version.versionNo - 1}
      LIMIT 1
      FOR UPDATE
    `);
    const previousVersion = rows[0];
    if (!previousVersion) {
      throw new ConflictException("采购修订版本缺少前一冻结版本");
    }
    return previousVersion;
  }

  private async recomputeRevisionChangeSummary(
    tx: Prisma.TransactionClient,
    version: VersionLockRow,
    prepared: PreparedDraft
  ) {
    if (version.versionNo <= 1) return null;
    const previousVersion = await this.requireLockedPreviousVersion(tx, version);
    const { lines, attachments } = await this.loadFrozenVersionFacts(
      tx,
      previousVersion.id
    );
    return {
      previousVersion,
      changeSummary: this.changeSummary(
        previousVersion,
        lines,
        attachments,
        prepared
      )
    };
  }

  private async lockProcurementPayments(
    tx: Prisma.TransactionClient,
    procurementId: string
  ) {
    return tx.$queryRaw<Array<LockedPaymentRow>>(Prisma.sql`
      SELECT
        "id",
        "status"
      FROM "SpotProcurementPayment"
      WHERE "procurementId" = ${procurementId}
      ORDER BY "id"
      FOR UPDATE
    `);
  }

  private async requireLockedApprovalInstance(
    tx: Prisma.TransactionClient,
    versionId: string,
    status: string
  ) {
    const approval = await this.lockApprovalInstance(tx, versionId, status);
    if (!approval) {
      throw new ConflictException("当前采购审批实例不存在或状态已变化");
    }
    return approval;
  }

  private async lockApprovalInstance(
    tx: Prisma.TransactionClient,
    versionId: string,
    status: string
  ) {
    const rows = await tx.$queryRaw<Array<ApprovalInstanceLockRow>>(Prisma.sql`
      SELECT
        "id",
        "status",
        "currentNodeIndex",
        "frozenNodes",
        "applicantUserId"
      FROM "ApprovalInstance"
      WHERE "businessType" = ${SPOT_PROCUREMENT_BUSINESS_TYPES.application}
        AND "businessId" = ${versionId}
        AND "flowType" = 'spot_procurement.approve'
        AND "status" = ${status}
      LIMIT 1
      FOR UPDATE
    `);
    return rows[0] ?? null;
  }

  private approveCurrentNode(
    frozenNodes: Prisma.JsonValue,
    currentNodeIndex: number,
    approvedRoleKey: RoleKey
  ): SpotProcurementApprovalNode[] {
    if (!Array.isArray(frozenNodes)) {
      throw new ConflictException("采购审批节点快照损坏");
    }
    const nodes = frozenNodes.map((node) => {
      if (!node || typeof node !== "object" || Array.isArray(node)) {
        throw new ConflictException("采购审批节点快照损坏");
      }
      return { ...node } as unknown as SpotProcurementApprovalNode;
    });
    const current = nodes[currentNodeIndex];
    if (!current) {
      throw new ConflictException("采购审批当前节点不存在");
    }
    current.approvedRoleKeys = [
      ...new Set([...(current.approvedRoleKeys ?? []), approvedRoleKey])
    ];
    return nodes;
  }

  private async recordReviewAudit(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    versionId: string,
    procurementId: string,
    decision: string,
    approvedRoleKey: RoleKey,
    extraMetadata: Record<string, Prisma.InputJsonValue> = {}
  ) {
    await this.audit.record(tx, {
      actorUserId,
      action: `spot_procurement.approval.${decision}`,
      businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.application,
      businessId: versionId,
      metadata: {
        procurementId,
        reviewRoleKey: approvedRoleKey,
        ...extraMetadata
      }
    });
  }

  private changeSummary(
    previousVersion: VersionLockRow,
    previousLines: Array<{
      sortOrder: number;
      materialName: string;
      specification: string | null;
      unit: string;
      quantity: Prisma.Decimal;
      invoiceMode: string;
      invoiceType: string | null;
      vatRateOptionId: string | null;
      vatRateValueSnapshot: Prisma.Decimal | null;
      vatRateLabelSnapshot: string | null;
      unitPrice: Prisma.Decimal;
      amountCents: bigint;
      usageLocation: string | null;
      note: string | null;
    }>,
    previousAttachments: Array<{ fileId: string; category: string }>,
    prepared: PreparedDraft
  ) {
    const previous = {
      supplierPartyId: previousVersion.supplierPartyId,
      supplierName: previousVersion.supplierNameSnapshot,
      handlerUserId: previousVersion.handlerUserId,
      reason: previousVersion.reason,
      note: previousVersion.note,
      totalAmountCents: previousVersion.totalAmountCents.toString(),
      lines: previousLines.map((line) => ({
        materialName: line.materialName,
        specification: line.specification,
        unit: line.unit,
        quantity: line.quantity.toString(),
        invoiceMode: line.invoiceMode,
        invoiceType: line.invoiceType,
        vatRateOptionId: line.vatRateOptionId,
        vatRateValueSnapshot: line.vatRateValueSnapshot?.toString() ?? null,
        vatRateLabelSnapshot: line.vatRateLabelSnapshot,
        unitPrice: line.unitPrice.toString(),
        amountCents: line.amountCents.toString(),
        usageLocation: line.usageLocation,
        note: line.note
      })),
      attachments: this.sortedAttachmentFacts(previousAttachments)
    };
    const next = {
      supplierPartyId: prepared.supplierPartyId,
      supplierName: prepared.supplierName,
      handlerUserId: prepared.handlerUserId,
      reason: prepared.reason,
      note: prepared.note,
      totalAmountCents: prepared.totalAmountCents.toString(),
      lines: prepared.lines.map((line) => ({
        materialName: line.materialName,
        specification: line.specification,
        unit: line.unit,
        quantity: line.quantity.toString(),
        invoiceMode: line.invoiceMode,
        invoiceType: line.invoiceType,
        vatRateOptionId: line.vatRateOptionId,
        vatRateValueSnapshot: line.vatRateValueSnapshot?.toString() ?? null,
        vatRateLabelSnapshot: line.vatRateLabelSnapshot,
        unitPrice: line.unitPrice.toString(),
        amountCents: line.amountCents.toString(),
        usageLocation: line.usageLocation,
        note: line.note
      })),
      attachments: this.sortedAttachmentFacts(prepared.attachments)
    };
    const changes: Array<{
      field: string;
      before: Prisma.InputJsonValue | null;
      after: Prisma.InputJsonValue | null;
    }> = [];
    this.collectChanges("", previous, next, changes);
    return { changes };
  }

  private sortedAttachmentFacts(
    attachments: ReadonlyArray<{ fileId: string; category: string }>
  ) {
    return attachments
      .map((attachment) => ({
        fileId: attachment.fileId,
        category: attachment.category
      }))
      .sort((left, right) => {
        const leftKey = `${left.category}\u0000${left.fileId}`;
        const rightKey = `${right.category}\u0000${right.fileId}`;
        return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
      });
  }

  private collectChanges(
    path: string,
    before: unknown,
    after: unknown,
    changes: Array<{
      field: string;
      before: Prisma.InputJsonValue | null;
      after: Prisma.InputJsonValue | null;
    }>
  ) {
    if (Array.isArray(before) || Array.isArray(after)) {
      const beforeArray = Array.isArray(before) ? before : [];
      const afterArray = Array.isArray(after) ? after : [];
      const length = Math.max(beforeArray.length, afterArray.length);
      for (let index = 0; index < length; index += 1) {
        this.collectChanges(
          `${path}[${index}]`,
          beforeArray[index],
          afterArray[index],
          changes
        );
      }
      return;
    }
    if (isPlainObject(before) || isPlainObject(after)) {
      const beforeObject = isPlainObject(before) ? before : {};
      const afterObject = isPlainObject(after) ? after : {};
      const keys = new Set([
        ...Object.keys(beforeObject),
        ...Object.keys(afterObject)
      ]);
      for (const key of keys) {
        this.collectChanges(
          path ? `${path}.${key}` : key,
          beforeObject[key],
          afterObject[key],
          changes
        );
      }
      return;
    }
    if (before !== after) {
      changes.push({
        field: path,
        before: jsonScalar(before),
        after: jsonScalar(after)
      });
    }
  }

  private applicationReadModel(
    procurementId: string,
    projectId: string,
    status: string,
    versionId: string,
    versionNo: number,
    versionStatus: string,
    totalAmountCents: bigint
  ) {
    return {
      procurementId,
      projectId,
      status,
      currentVersionId: versionId,
      versionId,
      versionNo,
      versionStatus,
      totalAmountCents: totalAmountCents.toString()
    };
  }

  private async runWrite<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? error.code
          : undefined;
      if (code === "P2002") {
        throw new ConflictException("采购编号或版本数据已存在，请刷新后重试");
      }
      if (code === "P2034") {
        throw new ConflictException("采购数据已变化，请刷新后重试");
      }
      if (code === "P2003" || code === "P2025") {
        throw new ConflictException("采购关联数据已变化，请刷新后重试");
      }
      throw error;
    }
  }
}

function requiredText(value: unknown, message: string) {
  if (typeof value !== "string") {
    throw new BadRequestException(message);
  }
  const normalized = collapseUnicodeWhitespace(value);
  if (!normalized) {
    throw new BadRequestException(message);
  }
  return normalized;
}

function optionalText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new BadRequestException("文本字段格式不正确");
  }
  const normalized = collapseUnicodeWhitespace(value);
  return normalized || null;
}

function optionalId(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new BadRequestException("编号字段格式不正确");
  }
  const normalized = trimUnicodeWhitespace(value);
  return normalized || null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonScalar(value: unknown): Prisma.InputJsonValue | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  return String(value);
}
