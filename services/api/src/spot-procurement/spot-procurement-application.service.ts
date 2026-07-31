import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  resolveEffectiveRoleKeys,
  type RoleKey
} from "@jiangkong/shared-domain";
import { pendingRoleKeysForFrozenApprovalNode } from "../approval/approval-node-access";
import { ApprovalFormService } from "../approval/approval-form.service";
import { assertOrdinaryApplicantCannotReview } from "../approval/approval-self-review";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import {
  collapseUnicodeWhitespace,
  trimUnicodeWhitespace
} from "../validation/unicode-whitespace";
import type {
  SpotProcurementAttachmentDto,
  SpotProcurementDraftDto
} from "./dto/create-spot-procurement.dto";
import type { CreateSpotProcurementDto } from "./dto/create-spot-procurement.dto";
import type { CreateSpotProcurementVersionDto } from "./dto/create-spot-procurement-version.dto";
import type { ConfirmAbnormalTerminationDto } from "./dto/confirm-abnormal-termination.dto";
import type { AbandonSpotProcurementDraftDto } from "./dto/abandon-spot-procurement-draft.dto";
import type { ReviewSpotProcurementDto } from "./dto/review-spot-procurement.dto";
import type { RequestAbnormalTerminationDto } from "./dto/request-abnormal-termination.dto";
import type { UpdateSpotProcurementDraftDto } from "./dto/update-spot-procurement-draft.dto";
import {
  procurementApprovalNodes,
  type SpotProcurementApprovalNode
} from "./spot-procurement-approval-nodes";
import { SpotProcurementPilotService } from "./spot-procurement-pilot.service";
import { SpotProcurementPaymentArchiveService } from "./spot-procurement-payment-archive.service";
import { SpotProcurementBalanceService } from "./spot-procurement-balance.service";
import { SPOT_PROCUREMENT_BUSINESS_TYPES } from "./spot-procurement.constants";

const CREATE_ROLES = new Set<RoleKey>([
  "material_staff",
  "material_director"
]);
const VOID_ROLES = new Set<RoleKey>(["project_manager", "finance_director"]);
const ABNORMAL_TERMINATION_REQUEST_ROLES = new Set<RoleKey>([
  "finance_staff"
]);
const ABNORMAL_TERMINATION_CONFIRM_ROLES = new Set<RoleKey>([
  "finance_director"
]);

type ProcurementLockRow = {
  id: string;
  projectId: string;
  code: string;
  applicantUserId: string;
  handlerUserId: string;
  currentVersionId: string | null;
  status: string;
  closedAt: Date | null;
  supplierKey: string | null;
  abandonedAt: Date | null;
  abandonedByUserId: string | null;
  abandonReason: string | null;
};

type AbandonmentVersionRow = { id: string; submittedAt: Date | null };
type AbandonmentPaymentRow = {
  id: string;
  status: string;
  submittedAt: Date | null;
  supplierBalanceAmountCents: bigint;
};
type AbandonmentApprovalRow = {
  id: string;
  businessType: string;
  status: string;
};
type AbandonmentReservationRow = {
  accountId: string;
  paymentId: string;
  amountCents: bigint;
  releasedAmountCents: bigint;
  status: string;
};
type AbandonmentReceiptRow = {
  id: string;
  status: string;
  currentRevisionNo: number;
  firstSubmittedAt: Date | null;
  submittedAt: Date | null;
  invalidatedAt: Date | null;
};

type TerminationFacts = {
  versions: AbandonmentVersionRow[];
  payments: AbandonmentPaymentRow[];
  approvals: AbandonmentApprovalRow[];
  approvalActionCount: number;
  reservations: AbandonmentReservationRow[];
  executionCount: number;
  receipt: AbandonmentReceiptRow | null;
  activeDelegationIds: string[];
  receiptReviewCount: number;
  discrepancyCount: number;
  refundCount: number;
  archiveCount: number;
};

type VersionLockRow = {
  id: string;
  procurementId: string;
  versionNo: number;
  status: string;
  reason: string;
  note: string | null;
  handlerUserId: string;
  applicationDepartmentSnapshot: string;
  applicationNameSnapshot: string;
  purchaserNameSnapshot: string;
  purchaserDepartmentId: string | null;
  purchaserDepartmentNameSnapshot: string;
  requestedArrivalAt: Date;
  changeReason: string | null;
  changeSummary: Prisma.JsonValue | null;
  submittedAt: Date | null;
  approvedAt: Date | null;
  createdByUserId: string;
};

type ApprovalLockRow = {
  id: string;
  status: string;
  currentNodeIndex: number;
  frozenNodes: Prisma.JsonValue;
  applicantUserId: string;
};

type AbnormalTerminationLockRow = {
  id: string;
  procurementId: string;
  status: string;
  reason: string;
  requestedByUserId: string;
  requestedAt: Date;
  confirmedByUserId: string | null;
  confirmedAt: Date | null;
};

type PurchaserSnapshot = {
  userId: string;
  name: string;
  departmentId: string | null;
  departmentName: string;
};

type PreparedDraft = {
  applicationDepartment: string;
  applicationName: string;
  requestedArrivalAt: Date;
  purchaser: PurchaserSnapshot;
  reason: string;
  note: string | null;
  lines: Array<{
    sortOrder: number;
    materialName: string;
    specification: string | null;
    unit: string;
    quantity: Prisma.Decimal;
    note: string | null;
  }>;
  attachments: Array<{
    fileId: string;
    category: string;
    uploadedByUserId: string;
  }>;
};

@Injectable()
export class SpotProcurementApplicationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly pilot: SpotProcurementPilotService,
    private readonly approvalForms: ApprovalFormService,
    private readonly archives?: SpotProcurementPaymentArchiveService,
    private readonly balances?: SpotProcurementBalanceService
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
        const purchaser = await this.requireCurrentPurchaser(
          tx,
          actorUserId,
          input.projectId,
          actorRoles
        );
        const prepared = await this.prepareDraft(
          tx,
          input,
          purchaser,
          new Set([actorUserId]),
          new Set()
        );
        const procurement = await tx.spotProcurement.create({
          data: {
            projectId: input.projectId,
            code: await this.nextApplicationCode(tx),
            supplierPartyId: null,
            supplierKey: null,
            supplierNameSnapshot: null,
            applicantUserId: actorUserId,
            handlerUserId: purchaser.userId,
            status: "draft",
            approvedAmountCents: null
          }
        });
        const version = await tx.spotProcurementVersion.create({
          data: this.versionCreateData(procurement.id, 1, "draft", prepared, actorUserId)
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
            applicationDepartment: prepared.applicationDepartment,
            applicationName: prepared.applicationName
          }
        });
        return this.applicationReadModel(procurement, version);
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
        const actorRoles = await this.requireDraftOwnerRole(tx, procurement, actorUserId);
        const purchaser = await this.requireFrozenPurchaser(
          tx,
          version,
          actorUserId,
          procurement.projectId,
          actorRoles
        );
        const current = await this.storedDraft(tx, version);
        const merged: SpotProcurementDraftDto = {
          ...current,
          ...input,
          note: input.note === undefined ? current.note : input.note,
          attachments: input.attachments === undefined ? current.attachments : input.attachments
        };
        const prepared = await this.prepareDraft(
          tx,
          merged,
          purchaser,
          new Set([procurement.applicantUserId, actorUserId]),
          new Set(current.attachments?.map((attachment) => attachment.fileId) ?? [])
        );
        await tx.spotProcurementVersion.update({
          where: { id: version.id },
          data: this.versionUpdateData(prepared)
        });
        await this.replaceVersionFacts(tx, version.id, prepared);
        await this.audit.record(tx, {
          actorUserId,
          action: "spot_procurement.draft.update",
          businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.application,
          businessId: version.id,
          metadata: { procurementId, versionNo: version.versionNo }
        });
        return this.applicationReadModel(procurement, {
          ...version,
          ...this.versionUpdateData(prepared)
        });
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
        const actorRoles = await this.requireDraftOwnerRole(tx, procurement, actorUserId);
        const lineCount = await tx.spotProcurementLine.count({
          where: { versionId: version.id }
        });
        if (lineCount < 1) {
          throw new BadRequestException("请至少填写一条采购明细后再提交审批");
        }
        const now = new Date();
        const frozenNodes = procurementApprovalNodes(actorRoles);
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
          data: { status: "approval_pending", submittedAt: now }
        });
        await tx.spotProcurement.update({
          where: { id: procurement.id },
          data: { status: "approval_pending" }
        });
        if (actorRoles.includes("material_director")) {
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
            frozenNodes: frozenNodes as unknown as Prisma.InputJsonValue
          }
        });
        return this.applicationReadModel(
          { ...procurement, status: "approval_pending" },
          { ...version, status: "approval_pending" }
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
        const version = await this.requireLockedCurrentVersion(tx, procurement);
        approvalBusinessId = version.id;
        if (procurement.status !== "approval_pending" || version.status !== "approval_pending") {
          throw new ConflictException("当前采购申请不在审批中，不能撤回");
        }
        if (actorUserId !== procurement.applicantUserId) {
          throw new ForbiddenException("只有采购申请人可以撤回审批");
        }
        const approval = await this.requireLockedApprovalInstance(tx, version.id, "approval_pending");
        await tx.approvalInstance.update({ where: { id: approval.id }, data: { status: "withdrawn" } });
        await tx.approvalActionLog.create({
          data: { approvalInstanceId: approval.id, action: "withdraw", actorUserId, comment: "申请人撤回采购审批" }
        });
        const draft = await this.createRevisionFromVersion(
          tx,
          procurement,
          version,
          actorUserId,
          "withdrawn",
          "申请人撤回采购审批"
        );
        await this.audit.record(tx, {
          actorUserId,
          action: "spot_procurement.approval.withdraw",
          businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.application,
          businessId: version.id,
          metadata: { procurementId, sourceVersionId: version.id, newVersionId: draft.id }
        });
        return this.applicationReadModel({ ...procurement, status: "draft" }, draft);
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
        if (procurement.status !== "approval_pending" || version.status !== "approval_pending") {
          throw new ConflictException("当前采购版本不在审批中");
        }
        const approval = await this.requireLockedApprovalInstance(tx, version.id, "approval_pending");
        const actorRoles = await this.loadActorRoleKeys(tx, actorUserId, procurement.projectId);
        const pendingRoles = pendingRoleKeysForFrozenApprovalNode(
          approval.frozenNodes,
          approval.currentNodeIndex
        );
        const approvedRoleKey = pendingRoles.find((roleKey) => actorRoles.includes(roleKey));
        if (!approvedRoleKey) {
          throw new ForbiddenException("当前用户不是本审批节点处理人");
        }
        assertOrdinaryApplicantCannotReview({
          applicantUserId: approval.applicantUserId,
          actorUserId,
          actorRoleKeys: actorRoles,
          approvedRoleKey
        });
        if (
          input.expectedVersionId !== version.id ||
          input.expectedApprovalInstanceId !== approval.id ||
          input.expectedNodeIndex !== approval.currentNodeIndex
        ) {
          throw new ConflictException("采购审批坐标已变化，请刷新页面后重试");
        }
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
          await tx.approvalInstance.update({ where: { id: approval.id }, data: { status: "rejected" } });
          await tx.spotProcurementVersion.update({ where: { id: version.id }, data: { status: "rejected" } });
          await tx.spotProcurement.update({ where: { id: procurement.id }, data: { status: "draft" } });
          await this.recordReviewAudit(tx, actorUserId, version.id, procurement.id, input.decision, approvedRoleKey);
          return this.applicationReadModel({ ...procurement, status: "draft" }, { ...version, status: "rejected" });
        }
        if (input.decision === "return_to_applicant") {
          await tx.approvalInstance.update({ where: { id: approval.id }, data: { status: "returned_to_applicant" } });
          const draft = await this.createRevisionFromVersion(
            tx,
            procurement,
            version,
            actorUserId,
            "returned",
            comment as string
          );
          await this.recordReviewAudit(tx, actorUserId, version.id, procurement.id, input.decision, approvedRoleKey, {
            sourceVersionId: version.id,
            newVersionId: draft.id
          });
          return this.applicationReadModel({ ...procurement, status: "draft" }, draft);
        }
        const nextNodes = this.approveCurrentNode(approval.frozenNodes, approval.currentNodeIndex, approvedRoleKey);
        const isFinalNode = approval.currentNodeIndex >= nextNodes.length - 1;
        if (!isFinalNode) {
          await tx.approvalInstance.update({
            where: { id: approval.id },
            data: {
              currentNodeIndex: approval.currentNodeIndex + 1,
              frozenNodes: nextNodes as unknown as Prisma.InputJsonValue
            }
          });
          await this.recordReviewAudit(tx, actorUserId, version.id, procurement.id, input.decision, approvedRoleKey);
          return this.applicationReadModel(procurement, version);
        }
        const now = new Date();
        await tx.approvalInstance.update({
          where: { id: approval.id },
          data: { status: "approved", frozenNodes: nextNodes as unknown as Prisma.InputJsonValue }
        });
        await tx.spotProcurementVersion.updateMany({
          where: { procurementId: procurement.id, id: { not: version.id }, status: "approved" },
          data: { status: "invalidated" }
        });
        await tx.spotProcurementVersion.update({ where: { id: version.id }, data: { status: "approved", approvedAt: now } });
        await tx.spotProcurement.update({
          where: { id: procurement.id },
          data: { status: "approved_in_progress", currentVersionId: version.id, approvedAmountCents: null }
        });
        const payment = await tx.spotProcurementPayment.create({
          data: {
            projectId: procurement.projectId,
            procurementId: procurement.id,
            procurementVersionId: version.id,
            code: `${procurement.code}-V${version.versionNo}-P001`,
            status: "draft",
            settlementAmountCents: 0n,
            supplierBalanceAmountCents: 0n,
            companyPaymentAmountCents: 0n,
            paidAmountCents: 0n,
            executedSupplierBalanceAmountCents: 0n,
            canceledAmountCents: 0n,
            canceledCompanyPaymentAmountCents: 0n,
            canceledSupplierBalanceAmountCents: 0n,
            payeeNameSnapshot: null,
            handlerUserId: version.handlerUserId,
            createdByUserId: actorUserId,
            paymentNote: null,
            draftOrigin: "auto_after_procurement_approval"
          }
        });
        const receipt = await tx.spotProcurementReceipt.create({
          data: {
            projectId: procurement.projectId,
            procurementId: procurement.id,
            procurementVersionId: version.id,
            status: "draft",
            currentRevisionNo: 1,
            handlerUserId: version.handlerUserId,
            note: null,
            actualCostCents: 0n,
            createdByUserId: actorUserId
          }
        });
        await tx.spotProcurementReceiptRevision.create({
          data: {
            receiptId: receipt.id,
            revisionNo: 1,
            procurementId: procurement.id,
            procurementVersionId: version.id,
            handlerUserId: version.handlerUserId,
            note: null,
            actualCostCents: 0n,
            createdByUserId: actorUserId
          }
        });
        await this.audit.record(tx, {
          actorUserId,
          action: "spot_procurement.receipt.draft.auto_create",
          businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.receipt,
          businessId: receipt.id,
          metadata: {
            procurementId: procurement.id,
            procurementVersionId: version.id,
            receiptRevisionNo: 1,
            reason: "采购审批完成后预建收货单，等待首次实际付款开放"
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
            reason: "采购审批完成后创建唯一无价付款草稿"
          }
        });
        await this.recordReviewAudit(tx, actorUserId, version.id, procurement.id, input.decision, approvedRoleKey);
        return this.applicationReadModel(
          { ...procurement, status: "approved_in_progress" },
          { ...version, status: "approved" }
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
        if (["closed", "voided", "abandoned", "abnormally_terminated"].includes(procurement.status)) {
          throw new ConflictException("当前采购状态不允许创建新版本");
        }
        const previous = await this.requireLockedCurrentVersion(tx, procurement);
        if (!["approved", "rejected"].includes(previous.status)) {
          throw new ConflictException("当前采购版本未完成审批或驳回，不能创建新版本");
        }
        const actorRoles = await this.requireDraftOwnerRole(tx, procurement, actorUserId);
        const purchaser = await this.requireFrozenPurchaser(tx, previous, actorUserId, procurement.projectId, actorRoles);
        const changeReason = requiredText(input.changeReason, "请填写采购版本变更原因");
        const previousDraft = await this.storedDraft(tx, previous);
        const prepared = await this.prepareDraft(
          tx,
          { ...previousDraft, ...input, attachments: input.attachments ?? previousDraft.attachments },
          purchaser,
          new Set([procurement.applicantUserId, actorUserId]),
          new Set(previousDraft.attachments?.map((attachment) => attachment.fileId) ?? [])
        );
        const payments = await tx.spotProcurementPayment.findMany({
          where: { procurementId: procurement.id },
          select: { id: true, status: true }
        });
        const execution = await tx.spotProcurementPaymentExecution.findFirst({
          where: { paymentId: { in: payments.map((payment) => payment.id) }, voidedAt: null },
          select: { id: true }
        });
        if (execution) {
          throw new ConflictException("采购已发生真实付款，不能通过普通版本变更覆盖既有事实");
        }
        const now = new Date();
        const draftPayments = payments.filter((payment) => payment.status === "draft").map((payment) => payment.id);
        if (draftPayments.length) {
          await tx.spotProcurementPayment.updateMany({
            where: { id: { in: draftPayments }, status: "draft" },
            data: {
              status: "invalidated",
              invalidatedAt: now,
              invalidatedByUserId: actorUserId,
              invalidatedReason: `采购版本变更：${changeReason}`
            }
          });
        }
        await tx.spotProcurementVersion.update({ where: { id: previous.id }, data: { status: "invalidated" } });
        const version = await tx.spotProcurementVersion.create({
          data: {
            ...this.versionCreateData(procurement.id, previous.versionNo + 1, "draft", prepared, actorUserId),
            changeReason,
            changeSummary: { changes: ["采购申请材料范围或数量已变更，重新审批"] }
          }
        });
        await this.replaceVersionFacts(tx, version.id, prepared);
        await tx.spotProcurement.update({
          where: { id: procurement.id },
          data: { currentVersionId: version.id, status: "draft", approvedAmountCents: null, actualCostCents: null }
        });
        await this.audit.record(tx, {
          actorUserId,
          action: "spot_procurement.version.create",
          businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.application,
          businessId: version.id,
          metadata: { procurementId, previousVersionId: previous.id, versionNo: version.versionNo, changeReason }
        });
        return this.applicationReadModel({ ...procurement, status: "draft" }, version);
      })
    );
  }

  abandonDraft(
    procurementId: string,
    actorUserId: string,
    input: AbandonSpotProcurementDraftDto
  ) {
    return this.runWrite(() =>
      this.prisma.$transaction(async (tx) => {
        const procurement = await this.requireLockedProcurement(tx, procurementId);
        this.pilot.assertEnabled(procurement.projectId);
        if (procurement.status === "abandoned") {
          if (procurement.abandonedByUserId !== actorUserId) {
            throw new ForbiddenException("只有当前采购经办人可以查看放弃结果");
          }
          return {
            procurementId,
            status: "abandoned",
            action: procurement.abandonReason
              ? "abandon_application"
              : "delete_pristine_draft",
            abandonedAt: procurement.abandonedAt,
            idempotent: true
          };
        }
        if (procurement.status !== "draft") {
          throw new ConflictException("当前采购应使用撤销或异常终止，不能放弃草稿");
        }
        const currentVersion = await this.requireLockedCurrentVersion(tx, procurement);
        if (currentVersion.status !== "draft") {
          throw new ConflictException("当前采购版本不是可放弃草稿");
        }
        await this.requireDraftHandlerRole(tx, procurement, actorUserId);
        const facts = await this.lockTerminationFacts(tx, procurement);
        this.assertNoFormalTerminationFacts(facts);

        const hasApprovalHistory =
          facts.versions.some((version) => version.submittedAt !== null) ||
          facts.approvals.length > 0 ||
          facts.approvalActionCount > 0;
        const expectedAction = hasApprovalHistory
          ? "abandon_application"
          : "delete_pristine_draft";
        if (input.action !== expectedAction) {
          throw new ConflictException(
            hasApprovalHistory
              ? "该采购已有提交或审批历史，只能放弃申请"
              : "该采购从未提交，请使用删除草稿"
          );
        }
        const reason = hasApprovalHistory
          ? requiredText(input.reason, "放弃采购申请必须填写原因")
          : null;
        const now = new Date();
        await this.releaseResidualReservations(
          tx,
          procurement,
          facts,
          actorUserId,
          reason ?? "删除从未提交的采购草稿"
        );
        await this.invalidateSafeChildren(
          tx,
          procurementId,
          facts,
          actorUserId,
          `采购${hasApprovalHistory ? "申请放弃" : "草稿删除"}：${reason ?? "从未提交"}`,
          now
        );
        await tx.approvalInstance.updateMany({
          where: {
            id: { in: facts.approvals.map((approval) => approval.id) },
            status: {
              in: ["approval_pending", "in_progress", "returned_to_applicant"]
            }
          },
          data: { status: "cancelled" }
        });
        await tx.spotProcurementVersion.update({
          where: { id: currentVersion.id },
          data: {
            status: "abandoned",
            abandonedAt: now,
            abandonedByUserId: actorUserId,
            abandonReason: reason
          }
        });
        const updated = await tx.spotProcurement.updateMany({
          where: { id: procurementId, status: "draft", currentVersionId: currentVersion.id },
          data: {
            status: "abandoned",
            abandonedAt: now,
            abandonedByUserId: actorUserId,
            abandonReason: reason
          }
        });
        if (updated.count !== 1) {
          throw new ConflictException("采购草稿已变化，请刷新后重试");
        }
        await this.audit.record(tx, {
          actorUserId,
          action: hasApprovalHistory
            ? "spot_procurement.application.abandon"
            : "spot_procurement.draft.delete",
          businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.application,
          businessId: procurementId,
          metadata: {
            projectId: procurement.projectId,
            currentVersionId: currentVersion.id,
            reason,
            invalidatedPaymentIds: facts.payments
              .filter((payment) => payment.status === "draft")
              .map((payment) => payment.id),
            invalidatedReceiptId:
              facts.receipt && facts.receipt.invalidatedAt === null
                ? facts.receipt.id
                : null
          }
        });
        return {
          procurementId,
          status: "abandoned",
          action: expectedAction,
          abandonedAt: now,
          idempotent: false
        };
      })
    );
  }

  voidProcurement(procurementId: string, actorUserId: string, reasonInput: string) {
    return this.runWrite(() =>
      this.prisma.$transaction(async (tx) => {
        const procurement = await this.requireLockedProcurement(tx, procurementId);
        this.pilot.assertEnabled(procurement.projectId);
        if (["closed", "voided", "abandoned", "abnormally_terminated"].includes(procurement.status)) {
          throw new ConflictException("当前采购状态不允许撤销");
        }
        const actorRoles = await this.loadActorRoleKeys(tx, actorUserId, procurement.projectId);
        this.requireAnyRole(actorRoles, VOID_ROLES, "当前用户无权撤销零星采购");
        const reason = requiredText(reasonInput, "请填写采购撤销原因");
        const facts = await this.lockTerminationFacts(tx, procurement);
        this.assertNoFormalTerminationFacts(facts);
        const now = new Date();
        await this.releaseResidualReservations(
          tx,
          procurement,
          facts,
          actorUserId,
          `采购撤销：${reason}`
        );
        await this.invalidateSafeChildren(
          tx,
          procurementId,
          facts,
          actorUserId,
          `采购撤销：${reason}`,
          now
        );
        if (procurement.currentVersionId) {
          await tx.spotProcurementVersion.update({ where: { id: procurement.currentVersionId }, data: { status: "invalidated" } });
          await tx.approvalInstance.updateMany({
            where: {
              businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.application,
              businessId: procurement.currentVersionId,
              status: {
                in: ["approval_pending", "in_progress", "returned_to_applicant"]
              }
            },
            data: { status: "cancelled" }
          });
        }
        await tx.spotProcurement.update({
          where: { id: procurementId },
          data: { status: "voided", voidedAt: now, voidedByUserId: actorUserId, voidReason: reason }
        });
        await this.audit.record(tx, {
          actorUserId,
          action: "spot_procurement.void",
          businessType: SPOT_PROCUREMENT_BUSINESS_TYPES.application,
          businessId: procurementId,
          metadata: { reason }
        });
        return { procurementId, status: "voided" };
      })
    );
  }

  requestAbnormalTermination(
    procurementId: string,
    actorUserId: string,
    input: RequestAbnormalTerminationDto
  ) {
    const reason = requiredText(input.reason, "请填写异常终止原因");
    return this.runWrite(() =>
      this.prisma.$transaction(async (tx) => {
        const procurement = await this.requireLockedProcurement(tx, procurementId);
        this.pilot.assertEnabled(procurement.projectId);
        this.assertAbnormalTerminationAllowed(procurement);
        const roles = await this.loadActorRoleKeys(
          tx,
          actorUserId,
          procurement.projectId
        );
        if (
          actorUserId !== procurement.handlerUserId &&
          !roles.some((role) =>
            ABNORMAL_TERMINATION_REQUEST_ROLES.has(role)
          )
        ) {
          throw new ForbiddenException(
            "只有采购经办人或本项目财务人员可以发起异常终止"
          );
        }
        await this.requireActualPayment(tx, procurement.id);
        const existing = await this.lockAbnormalTermination(tx, procurement.id);
        if (existing) {
          if (
            existing.status === "requested" &&
            existing.requestedByUserId === actorUserId &&
            existing.reason === reason
          ) {
            return abnormalTerminationReadModel(existing);
          }
          throw new ConflictException("当前采购已存在异常终止处理事实");
        }
        const termination =
          await tx.spotProcurementAbnormalTermination.create({
            data: {
              procurementId: procurement.id,
              status: "requested",
              reason,
              requestedByUserId: actorUserId
            }
          });
        await this.audit.record(tx, {
          actorUserId,
          action: "spot_procurement.abnormal_termination.request",
          businessType: "spot_procurement_abnormal_termination",
          businessId: termination.id,
          metadata: {
            procurementId: procurement.id,
            projectId: procurement.projectId,
            reason
          }
        });
        return abnormalTerminationReadModel(termination);
      })
    );
  }

  confirmAbnormalTermination(
    procurementId: string,
    actorUserId: string,
    input: ConfirmAbnormalTerminationDto
  ) {
    if (input.confirmTermination !== true) {
      throw new BadRequestException("请明确确认异常终止本次零星采购");
    }
    return this.runWrite(async () => {
      const result = await this.prisma.$transaction(async (tx) => {
        const procurement = await this.requireLockedProcurement(tx, procurementId);
        this.pilot.assertEnabled(procurement.projectId);
        this.assertAbnormalTerminationAllowed(procurement);
        const roles = await this.loadActorRoleKeys(
          tx,
          actorUserId,
          procurement.projectId
        );
        this.requireAnyRole(
          roles,
          ABNORMAL_TERMINATION_CONFIRM_ROLES,
          "只有本项目财务主管可以确认异常终止"
        );
        await this.requireActualPayment(tx, procurement.id);
        const termination = await this.lockAbnormalTermination(tx, procurement.id);
        if (!termination || termination.status !== "requested") {
          throw new ConflictException("当前采购不存在待确认的异常终止申请");
        }
        const now = new Date();
        const confirmed =
          await tx.spotProcurementAbnormalTermination.updateMany({
            where: { id: termination.id, status: "requested" },
            data: {
              status: "confirmed",
              confirmedByUserId: actorUserId,
              confirmedAt: now
            }
          });
        if (confirmed.count !== 1) {
          throw new ConflictException("异常终止状态已变化，请刷新后重试");
        }
        const terminated = await tx.spotProcurement.updateMany({
          where: {
            id: procurement.id,
            status: "approved_in_progress",
            closedAt: null,
            voidedAt: null
          },
          data: { status: "abnormally_terminated" }
        });
        if (terminated.count !== 1) {
          throw new ConflictException("采购状态已变化，不能确认异常终止");
        }
        await this.audit.record(tx, {
          actorUserId,
          action: "spot_procurement.abnormal_termination.confirm",
          businessType: "spot_procurement_abnormal_termination",
          businessId: termination.id,
          metadata: {
            procurementId: procurement.id,
            projectId: procurement.projectId,
            requestedByUserId: termination.requestedByUserId,
            reason: termination.reason,
            statusBefore: termination.status,
            statusAfter: "confirmed"
          }
        });
        return abnormalTerminationReadModel({
          ...termination,
          status: "confirmed",
          confirmedByUserId: actorUserId,
          confirmedAt: now
        });
      });
      if (this.archives) {
        const payments = await this.prisma.spotProcurementPayment.findMany({
          where: { procurementId },
          select: { id: true }
        });
        await Promise.all(
          payments.map((payment) =>
            this.archives!.tryCreateVersion(
              payment.id,
              actorUserId,
              "procurement.abnormal_termination.confirmed"
            )
          )
        );
      }
      return result;
    });
  }

  applicationTextSuggestions(actorUserId: string, projectId: string, keyword?: string) {
    return this.prisma.$transaction(async (tx) => {
      this.pilot.assertEnabled(projectId);
      await this.requireActiveProject(tx, projectId);
      const roles = await this.loadActorRoleKeys(tx, actorUserId, projectId);
      this.requireAnyRole(roles, CREATE_ROLES, "当前用户无权查看采购申请历史建议");
      const filter = optionalText(keyword);
      const rows = await tx.$queryRaw<Array<{
        applicationDepartment: string;
        applicationName: string;
        versionId: string;
      }>>(Prisma.sql`
        SELECT DISTINCT ON (
          version."applicationDepartmentSnapshot",
          version."applicationNameSnapshot"
        )
          version."applicationDepartmentSnapshot" AS "applicationDepartment",
          version."applicationNameSnapshot" AS "applicationName",
          version."id" AS "versionId"
        FROM "SpotProcurementVersion" version
        INNER JOIN "SpotProcurement" procurement
          ON procurement."id" = version."procurementId"
        WHERE procurement."projectId" = ${projectId}
          AND (${filter}::TEXT IS NULL
            OR version."applicationDepartmentSnapshot" ILIKE ${filter ? `%${filter}%` : null}
            OR version."applicationNameSnapshot" ILIKE ${filter ? `%${filter}%` : null})
        ORDER BY
          version."applicationDepartmentSnapshot",
          version."applicationNameSnapshot",
          version."createdAt" DESC,
          version."id" DESC
        LIMIT 20
      `);
      return rows;
    });
  }

  private async prepareDraft(
    tx: Prisma.TransactionClient,
    input: SpotProcurementDraftDto,
    purchaser: PurchaserSnapshot,
    allowedAttachmentUploaderUserIds: ReadonlySet<string>,
    preauthorizedAttachmentFileIds: ReadonlySet<string>
  ): Promise<PreparedDraft> {
    const requestedArrivalAt = new Date(input.requestedArrivalAt);
    if (Number.isNaN(requestedArrivalAt.getTime())) {
      throw new BadRequestException("要求采购到位日期格式不正确");
    }
    const attachments = input.attachments ?? [];
    const uploaderByFileId = await this.requireActiveFiles(
      tx,
      attachments,
      allowedAttachmentUploaderUserIds,
      preauthorizedAttachmentFileIds
    );
    return {
      applicationDepartment: requiredText(input.applicationDepartment, "申请部门不能为空"),
      applicationName: requiredText(input.applicationName, "申请人不能为空"),
      requestedArrivalAt,
      purchaser,
      reason: requiredText(input.reason, "采购原因不能为空"),
      note: optionalText(input.note),
      lines: input.lines.map((line, index) => ({
        sortOrder: index + 1,
        materialName: requiredText(line.materialName, "材料名称不能为空"),
        specification: optionalText(line.specification),
        unit: requiredText(line.unit, "材料单位不能为空"),
        quantity: new Prisma.Decimal(line.quantity),
        note: optionalText(line.note)
      })),
      attachments: attachments.map((attachment) => ({
        fileId: attachment.fileId,
        category: attachment.category,
        uploadedByUserId: uploaderByFileId.get(attachment.fileId) ?? purchaser.userId
      }))
    };
  }

  private versionCreateData(
    procurementId: string,
    versionNo: number,
    status: string,
    prepared: PreparedDraft,
    createdByUserId: string
  ) {
    return {
      procurementId,
      versionNo,
      status,
      reason: prepared.reason,
      note: prepared.note,
      supplierPartyId: null,
      supplierKey: null,
      supplierNameSnapshot: null,
      handlerUserId: prepared.purchaser.userId,
      applicationDepartmentSnapshot: prepared.applicationDepartment,
      applicationNameSnapshot: prepared.applicationName,
      purchaserNameSnapshot: prepared.purchaser.name,
      purchaserDepartmentId: prepared.purchaser.departmentId,
      purchaserDepartmentNameSnapshot: prepared.purchaser.departmentName,
      requestedArrivalAt: prepared.requestedArrivalAt,
      totalAmountCents: null,
      createdByUserId
    };
  }

  private versionUpdateData(prepared: PreparedDraft) {
    return {
      reason: prepared.reason,
      note: prepared.note,
      applicationDepartmentSnapshot: prepared.applicationDepartment,
      applicationNameSnapshot: prepared.applicationName,
      requestedArrivalAt: prepared.requestedArrivalAt
    };
  }

  private async storedDraft(tx: Prisma.TransactionClient, version: VersionLockRow): Promise<SpotProcurementDraftDto> {
    const { lines, attachments } = await this.loadFrozenVersionFacts(tx, version.id);
    return {
      applicationDepartment: version.applicationDepartmentSnapshot,
      applicationName: version.applicationNameSnapshot,
      requestedArrivalAt: version.requestedArrivalAt.toISOString(),
      reason: version.reason,
      note: version.note,
      lines: lines.map((line) => ({
        materialName: line.materialName,
        specification: line.specification ?? undefined,
        unit: line.unit,
        quantity: line.quantity.toString(),
        note: line.note ?? undefined
      })),
      attachments: attachments.map((attachment) => ({
        fileId: attachment.fileId,
        category: attachment.category as SpotProcurementAttachmentDto["category"]
      }))
    };
  }

  private async createRevisionFromVersion(
    tx: Prisma.TransactionClient,
    procurement: ProcurementLockRow,
    source: VersionLockRow,
    actorUserId: string,
    sourceStatus: "returned" | "withdrawn",
    changeReason: string
  ): Promise<VersionLockRow> {
    const { lines, attachments } = await this.loadFrozenVersionFacts(tx, source.id);
    await tx.spotProcurementVersion.update({ where: { id: source.id }, data: { status: sourceStatus } });
    const version = await tx.spotProcurementVersion.create({
      data: {
        procurementId: procurement.id,
        versionNo: source.versionNo + 1,
        status: "draft",
        reason: source.reason,
        note: source.note,
        supplierPartyId: null,
        supplierKey: null,
        supplierNameSnapshot: null,
        handlerUserId: source.handlerUserId,
        applicationDepartmentSnapshot: source.applicationDepartmentSnapshot,
        applicationNameSnapshot: source.applicationNameSnapshot,
        purchaserNameSnapshot: source.purchaserNameSnapshot,
        purchaserDepartmentId: source.purchaserDepartmentId,
        purchaserDepartmentNameSnapshot: source.purchaserDepartmentNameSnapshot,
        requestedArrivalAt: source.requestedArrivalAt,
        totalAmountCents: null,
        changeReason,
        changeSummary: { changes: [] },
        createdByUserId: actorUserId
      }
    });
    if (lines.length) {
      await tx.spotProcurementLine.createMany({
        data: lines.map((line) => ({
          versionId: version.id,
          sortOrder: line.sortOrder,
          materialName: line.materialName,
          specification: line.specification,
          unit: line.unit,
          quantity: line.quantity,
          invoiceMode: null,
          invoiceType: null,
          vatRateOptionId: null,
          vatRateValueSnapshot: null,
          vatRateLabelSnapshot: null,
          unitPrice: null,
          amountCents: null,
          usageLocation: null,
          note: line.note
        }))
      });
    }
    if (attachments.length) {
      await tx.spotProcurementAttachment.createMany({
        data: attachments.map((attachment) => ({
          versionId: version.id,
          fileId: attachment.fileId,
          category: attachment.category,
          uploadedByUserId: attachment.uploadedByUserId
        }))
      });
    }
    await tx.spotProcurement.update({
      where: { id: procurement.id },
      data: { currentVersionId: version.id, status: "draft", approvedAmountCents: null, actualCostCents: null }
    });
    return version as unknown as VersionLockRow;
  }

  private async replaceVersionFacts(tx: Prisma.TransactionClient, versionId: string, prepared: PreparedDraft) {
    await tx.spotProcurementLine.deleteMany({ where: { versionId } });
    await tx.spotProcurementLine.createMany({
      data: prepared.lines.map((line) => ({
        versionId,
        ...line,
        invoiceMode: null,
        invoiceType: null,
        vatRateOptionId: null,
        vatRateValueSnapshot: null,
        vatRateLabelSnapshot: null,
        unitPrice: null,
        amountCents: null,
        usageLocation: null
      }))
    });
    await tx.spotProcurementAttachment.deleteMany({ where: { versionId } });
    if (prepared.attachments.length) {
      await tx.spotProcurementAttachment.createMany({
        data: prepared.attachments.map((attachment) => ({ versionId, ...attachment }))
      });
    }
  }

  private async loadFrozenVersionFacts(tx: Prisma.TransactionClient, versionId: string) {
    const [lines, attachments] = await Promise.all([
      tx.spotProcurementLine.findMany({ where: { versionId }, orderBy: { sortOrder: "asc" } }),
      tx.spotProcurementAttachment.findMany({ where: { versionId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] })
    ]);
    return { lines, attachments };
  }

  private async requireActiveFiles(
    tx: Prisma.TransactionClient,
    attachments: SpotProcurementAttachmentDto[],
    allowedUploaderUserIds: ReadonlySet<string>,
    preauthorizedFileIds: ReadonlySet<string>
  ) {
    const fileIds = attachments.map((attachment) => attachment.fileId);
    if (new Set(fileIds).size !== fileIds.length) throw new BadRequestException("同一采购版本不能重复引用同一附件");
    if (!fileIds.length) return new Map<string, string>();
    const files = await tx.fileObject.findMany({
      where: { id: { in: fileIds } },
      select: { id: true, storageStatus: true, uploadedByUserId: true }
    });
    if (files.length !== fileIds.length || files.some((file) => file.storageStatus !== "active")) {
      throw new BadRequestException("采购附件不存在或已失效，请重新上传");
    }
    if (files.some((file) => !preauthorizedFileIds.has(file.id) && !allowedUploaderUserIds.has(file.uploadedByUserId))) {
      throw new ForbiddenException("采购附件必须由采购人或本次操作人上传");
    }
    return new Map(files.map((file) => [file.id, file.uploadedByUserId]));
  }

  private async requireCurrentPurchaser(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    _projectId: string,
    actorRoles: RoleKey[]
  ): Promise<PurchaserSnapshot> {
    this.requireAnyRole(actorRoles, CREATE_ROLES, "采购人必须是本项目物资员或物资主管");
    const user = await tx.user.findUnique({
      where: { id: actorUserId },
      select: { id: true, name: true, departmentId: true, isActive: true }
    });
    if (!user?.isActive) throw new BadRequestException("采购人不存在或已停用");
    const department = user.departmentId
      ? await tx.department.findUnique({ where: { id: user.departmentId }, select: { name: true, isActive: true } })
      : null;
    if (department && !department.isActive) throw new BadRequestException("采购人所属部门已停用");
    return {
      userId: user.id,
      name: requiredText(user.name, "采购人姓名不能为空"),
      departmentId: user.departmentId,
      departmentName: department?.name ?? "未分配部门"
    };
  }

  private async requireFrozenPurchaser(
    tx: Prisma.TransactionClient,
    version: VersionLockRow,
    actorUserId: string,
    projectId: string,
    actorRoles: RoleKey[]
  ) {
    if (version.handlerUserId !== actorUserId) throw new ForbiddenException("只有原采购人可以修改并提交采购");
    await this.requireCurrentPurchaser(tx, actorUserId, projectId, actorRoles);
    return {
      userId: version.handlerUserId,
      name: version.purchaserNameSnapshot,
      departmentId: version.purchaserDepartmentId,
      departmentName: version.purchaserDepartmentNameSnapshot
    };
  }

  private async requireActiveProject(tx: Prisma.TransactionClient, projectId: string) {
    const project = await tx.project.findUnique({ where: { id: projectId }, select: { id: true, isActive: true } });
    if (!project) throw new NotFoundException("采购项目不存在");
    if (!project.isActive) throw new BadRequestException("采购项目已停用");
  }

  private async lockTerminationFacts(
    tx: Prisma.TransactionClient,
    procurement: ProcurementLockRow
  ): Promise<TerminationFacts> {
    const versions = await tx.$queryRaw<AbandonmentVersionRow[]>(Prisma.sql`
      SELECT "id", "submittedAt"
      FROM "SpotProcurementVersion"
      WHERE "procurementId" = ${procurement.id}
      ORDER BY "id"
      FOR UPDATE
    `);
    const payments = await tx.$queryRaw<AbandonmentPaymentRow[]>(Prisma.sql`
      SELECT "id", "status", "submittedAt", "supplierBalanceAmountCents"
      FROM "SpotProcurementPayment"
      WHERE "procurementId" = ${procurement.id}
      ORDER BY "id"
      FOR UPDATE
    `);
    const versionIds = versions.map((version) => version.id);
    const paymentIds = payments.map((payment) => payment.id);
    const approvals = await tx.$queryRaw<AbandonmentApprovalRow[]>(Prisma.sql`
      SELECT "id", "businessType", "status"
      FROM "ApprovalInstance"
      WHERE
        ("businessType" = ${SPOT_PROCUREMENT_BUSINESS_TYPES.application}
          AND "businessId" IN (${Prisma.join(versionIds)}))
        ${paymentIds.length
          ? Prisma.sql`OR ("businessType" = ${SPOT_PROCUREMENT_BUSINESS_TYPES.payment}
              AND "businessId" IN (${Prisma.join(paymentIds)}))`
          : Prisma.empty}
      ORDER BY "id"
      FOR UPDATE
    `);
    const approvalIds = approvals.map((approval) => approval.id);
    const approvalActions = approvalIds.length
      ? await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT "id"
          FROM "ApprovalActionLog"
          WHERE "approvalInstanceId" IN (${Prisma.join(approvalIds)})
          ORDER BY "id"
          FOR UPDATE
        `)
      : [];
    const reservations = paymentIds.length
      ? await tx.$queryRaw<AbandonmentReservationRow[]>(Prisma.sql`
          SELECT "accountId", "paymentId", "amountCents", "releasedAmountCents", "status"
          FROM "SupplierBalanceReservation"
          WHERE "paymentId" IN (${Prisma.join(paymentIds)})
          ORDER BY "paymentId"
          FOR UPDATE
        `)
      : [];
    const reservationAccountIds = [...new Set(
      reservations.map((reservation) => reservation.accountId)
    )].sort();
    if (reservationAccountIds.length) {
      await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id"
        FROM "SupplierBalanceAccount"
        WHERE "id" IN (${Prisma.join(reservationAccountIds)})
        ORDER BY "id"
        FOR UPDATE
      `);
    }
    const executions = paymentIds.length
      ? await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT "id"
          FROM "SpotProcurementPaymentExecution"
          WHERE "paymentId" IN (${Prisma.join(paymentIds)})
          ORDER BY "id"
          FOR UPDATE
        `)
      : [];
    const receipts = await tx.$queryRaw<AbandonmentReceiptRow[]>(Prisma.sql`
      SELECT "id", "status", "currentRevisionNo", "firstSubmittedAt",
        "submittedAt", "invalidatedAt"
      FROM "SpotProcurementReceipt"
      WHERE "procurementId" = ${procurement.id}
      FOR UPDATE
    `);
    const receipt = receipts[0] ?? null;
    if (receipt) {
      await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id"
        FROM "SpotProcurementReceiptRevision"
        WHERE "receiptId" = ${receipt.id}
          AND "revisionNo" = ${receipt.currentRevisionNo}
        FOR UPDATE
      `);
    }
    const delegations = receipt
      ? await tx.$queryRaw<Array<{ id: string; revokedAt: Date | null }>>(Prisma.sql`
          SELECT "id", "revokedAt"
          FROM "SpotProcurementReceiptDelegation"
          WHERE "receiptId" = ${receipt.id}
          ORDER BY "id"
          FOR UPDATE
        `)
      : [];
    const reviews = receipt
      ? await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT "id"
          FROM "SpotProcurementReceiptReview"
          WHERE "receiptId" = ${receipt.id}
          ORDER BY "id"
          FOR UPDATE
        `)
      : [];
    const discrepancies = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "SpotProcurementDiscrepancy"
      WHERE "procurementId" = ${procurement.id}
      ORDER BY "id"
      FOR UPDATE
    `);
    const refunds = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "SpotProcurementRefund"
      WHERE "procurementId" = ${procurement.id}
      ORDER BY "id"
      FOR UPDATE
    `);
    const paymentArchives = paymentIds.length
      ? await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT "id"
          FROM "SpotProcurementPaymentArchive"
          WHERE "paymentId" IN (${Prisma.join(paymentIds)})
          ORDER BY "id"
          FOR UPDATE
        `)
      : [];
    const archiveBusinessIds = [...versionIds, ...paymentIds, procurement.id];
    const archiveRecords = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "ArchiveRecord"
      WHERE "businessId" IN (${Prisma.join(archiveBusinessIds)})
      ORDER BY "id"
      FOR UPDATE
    `);
    return {
      versions,
      payments,
      approvals,
      approvalActionCount: approvalActions.length,
      reservations,
      executionCount: executions.length,
      receipt,
      activeDelegationIds: delegations
        .filter((delegation) => delegation.revokedAt === null)
        .map((delegation) => delegation.id),
      receiptReviewCount: reviews.length,
      discrepancyCount: discrepancies.length,
      refundCount: refunds.length,
      archiveCount: paymentArchives.length + archiveRecords.length
    };
  }

  private assertNoFormalTerminationFacts(facts: TerminationFacts) {
    const paymentApprovalIds = new Set(
      facts.approvals
        .filter(
          (approval) =>
            approval.businessType === SPOT_PROCUREMENT_BUSINESS_TYPES.payment
        )
        .map((approval) => approval.id)
    );
    if (
      facts.payments.some(
        (payment) =>
          payment.submittedAt !== null ||
          !["draft", "invalidated"].includes(payment.status)
      ) ||
      paymentApprovalIds.size > 0
    ) {
      throw new ConflictException("采购已形成正式付款申请，不能放弃或撤销");
    }
    if (facts.executionCount > 0) {
      throw new ConflictException("采购已发生实际付款历史，不能放弃或撤销");
    }
    if (facts.reservations.some((reservation) => reservation.status === "executed")) {
      throw new ConflictException("采购已执行供应商余额抵扣，不能放弃或撤销");
    }
    if (
      facts.receipt &&
      facts.receipt.invalidatedAt === null &&
      (facts.receipt.firstSubmittedAt !== null ||
        facts.receipt.submittedAt !== null ||
        facts.receipt.status !== "draft")
    ) {
      throw new ConflictException("采购收货单已提交或生效，不能放弃或撤销");
    }
    if (facts.receiptReviewCount > 0) {
      throw new ConflictException("采购已有收货复核历史，不能放弃或撤销");
    }
    if (facts.discrepancyCount > 0) {
      throw new ConflictException("采购已形成收货差异事实，不能放弃或撤销");
    }
    if (facts.refundCount > 0) {
      throw new ConflictException("采购已形成退款事实，不能放弃或撤销");
    }
    if (facts.archiveCount > 0) {
      throw new ConflictException("采购已形成归档证据，不能放弃或撤销");
    }
  }

  private async releaseResidualReservations(
    tx: Prisma.TransactionClient,
    procurement: ProcurementLockRow,
    facts: TerminationFacts,
    actorUserId: string,
    reason: string
  ) {
    for (const reservation of facts.reservations) {
      const remaining = reservation.amountCents - reservation.releasedAmountCents;
      if (reservation.status !== "reserved" || remaining <= 0n) continue;
      if (!procurement.supplierKey || !this.balances) {
        throw new ConflictException("供应商余额预留信息异常，请联系财务处理");
      }
      await this.balances.releaseForShortage(tx, {
        paymentId: reservation.paymentId,
        expectedReservedAmountCents: reservation.amountCents,
        releaseAmountCents: remaining,
        expectedProjectId: procurement.projectId,
        expectedSupplierKey: procurement.supplierKey,
        actorUserId,
        reason
      });
    }
  }

  private async invalidateSafeChildren(
    tx: Prisma.TransactionClient,
    procurementId: string,
    facts: TerminationFacts,
    actorUserId: string,
    reason: string,
    now: Date
  ) {
    const draftPaymentIds = facts.payments
      .filter((payment) => payment.status === "draft")
      .map((payment) => payment.id);
    if (draftPaymentIds.length) {
      await tx.spotProcurementPayment.updateMany({
        where: { id: { in: draftPaymentIds }, status: "draft", submittedAt: null },
        data: {
          status: "invalidated",
          invalidatedAt: now,
          invalidatedByUserId: actorUserId,
          invalidatedReason: reason
        }
      });
    }
    if (facts.receipt && facts.receipt.invalidatedAt === null) {
      await tx.spotProcurementReceipt.updateMany({
        where: {
          id: facts.receipt.id,
          procurementId,
          status: "draft",
          firstSubmittedAt: null,
          submittedAt: null,
          invalidatedAt: null
        },
        data: {
          status: "invalidated",
          invalidatedAt: now,
          invalidatedByUserId: actorUserId,
          invalidationReason: reason
        }
      });
      if (facts.activeDelegationIds.length) {
        await tx.spotProcurementReceiptDelegation.updateMany({
          where: { id: { in: facts.activeDelegationIds }, revokedAt: null },
          data: {
            revokedAt: now,
            revokedByUserId: actorUserId,
            revocationReason: reason
          }
        });
      }
    }
  }

  private async requireDraftOwnerRole(tx: Prisma.TransactionClient, procurement: ProcurementLockRow, actorUserId: string) {
    if (actorUserId !== procurement.applicantUserId || actorUserId !== procurement.handlerUserId) {
      throw new ForbiddenException("只有采购人可以修改并提交采购");
    }
    const roles = await this.loadActorRoleKeys(tx, actorUserId, procurement.projectId);
    this.requireAnyRole(roles, CREATE_ROLES, "当前用户不再具备采购创建岗位");
    return roles;
  }

  private async requireDraftHandlerRole(
    tx: Prisma.TransactionClient,
    procurement: ProcurementLockRow,
    actorUserId: string
  ) {
    if (actorUserId !== procurement.handlerUserId) {
      throw new ForbiddenException("只有当前采购经办人可以放弃采购草稿");
    }
    const roles = await this.loadActorRoleKeys(
      tx,
      actorUserId,
      procurement.projectId
    );
    this.requireAnyRole(roles, CREATE_ROLES, "当前经办人不再具备物资岗位");
  }

  private assertEditableDraft(procurement: ProcurementLockRow, version: VersionLockRow) {
    if (procurement.status !== "draft" || version.status !== "draft") {
      throw new ConflictException("当前采购版本不是可编辑草稿");
    }
  }

  private async requireLockedProcurement(tx: Prisma.TransactionClient, procurementId: string) {
    const rows = await tx.$queryRaw<Array<ProcurementLockRow>>(Prisma.sql`
      SELECT "id", "projectId", "code", "applicantUserId", "handlerUserId", "currentVersionId", "status", "closedAt",
        "supplierKey", "abandonedAt", "abandonedByUserId", "abandonReason"
      FROM "SpotProcurement" WHERE "id" = ${procurementId} LIMIT 1 FOR UPDATE
    `);
    if (!rows[0]) throw new NotFoundException("零星采购不存在");
    return rows[0];
  }

  private assertAbnormalTerminationAllowed(procurement: ProcurementLockRow) {
    if (procurement.status === "closed") {
      throw new ConflictException("零星采购已经正常办结，不能异常终止");
    }
    if (procurement.status === "abnormally_terminated") {
      throw new ConflictException("零星采购已经异常终止");
    }
    if (procurement.status === "voided") {
      throw new ConflictException("已撤销的零星采购不能异常终止");
    }
    if (procurement.status !== "approved_in_progress") {
      throw new ConflictException("当前采购状态不允许异常终止");
    }
  }

  private async requireActualPayment(
    tx: Prisma.TransactionClient,
    procurementId: string
  ) {
    const payments = await tx.spotProcurementPayment.findMany({
      where: { procurementId },
      select: { id: true }
    });
    if (!payments.length) {
      throw new ConflictException("采购尚未发生真实付款，不能异常终止");
    }
    const execution =
      await tx.spotProcurementPaymentExecution.findFirst({
        where: {
          paymentId: { in: payments.map((payment) => payment.id) },
          voidedAt: null
        },
        select: { id: true }
      });
    if (!execution) {
      throw new ConflictException("采购尚未发生真实付款，不能异常终止");
    }
  }

  private async lockAbnormalTermination(
    tx: Prisma.TransactionClient,
    procurementId: string
  ) {
    const rows = await tx.$queryRaw<AbnormalTerminationLockRow[]>(Prisma.sql`
      SELECT
        "id", "procurementId", "status", "reason", "requestedByUserId",
        "requestedAt", "confirmedByUserId", "confirmedAt"
      FROM "SpotProcurementAbnormalTermination"
      WHERE "procurementId" = ${procurementId}
      LIMIT 1
      FOR UPDATE
    `);
    return rows[0] ?? null;
  }

  private async requireLockedCurrentVersion(tx: Prisma.TransactionClient, procurement: ProcurementLockRow) {
    if (!procurement.currentVersionId) throw new ConflictException("零星采购缺少当前版本");
    const rows = await tx.$queryRaw<Array<VersionLockRow>>(Prisma.sql`
      SELECT
        "id", "procurementId", "versionNo", "status", "reason", "note", "handlerUserId",
        "applicationDepartmentSnapshot", "applicationNameSnapshot", "purchaserNameSnapshot",
        "purchaserDepartmentId", "purchaserDepartmentNameSnapshot", "requestedArrivalAt",
        "changeReason", "changeSummary", "submittedAt", "approvedAt", "createdByUserId"
      FROM "SpotProcurementVersion"
      WHERE "id" = ${procurement.currentVersionId} AND "procurementId" = ${procurement.id}
      LIMIT 1 FOR UPDATE
    `);
    if (!rows[0]) throw new ConflictException("零星采购当前版本不存在或归属不正确");
    return rows[0];
  }

  private async requireLockedApprovalInstance(tx: Prisma.TransactionClient, versionId: string, status: string) {
    const rows = await tx.$queryRaw<Array<ApprovalLockRow>>(Prisma.sql`
      SELECT "id", "status", "currentNodeIndex", "frozenNodes", "applicantUserId"
      FROM "ApprovalInstance"
      WHERE "businessType" = ${SPOT_PROCUREMENT_BUSINESS_TYPES.application}
        AND "businessId" = ${versionId}
        AND "flowType" = 'spot_procurement.approve'
        AND "status" = ${status}
      ORDER BY "updatedAt" DESC, "id" DESC
      FOR UPDATE
    `);
    if (rows.length !== 1) {
      throw new ConflictException("当前采购审批实例不存在、重复或状态已变化");
    }
    return rows[0];
  }

  private approveCurrentNode(frozenNodes: Prisma.JsonValue, currentNodeIndex: number, approvedRoleKey: RoleKey) {
    if (!Array.isArray(frozenNodes)) throw new ConflictException("采购审批节点快照损坏");
    const nodes = frozenNodes.map((node) => ({ ...(node as object) })) as SpotProcurementApprovalNode[];
    const current = nodes[currentNodeIndex];
    if (!current) throw new ConflictException("采购审批当前节点不存在");
    current.approvedRoleKeys = [...new Set([...(current.approvedRoleKeys ?? []), approvedRoleKey])];
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
      metadata: { procurementId, reviewRoleKey: approvedRoleKey, ...extraMetadata }
    });
  }

  private applicationReadModel(procurement: Pick<ProcurementLockRow, "id" | "projectId" | "code" | "status">, version: Pick<VersionLockRow, "id" | "versionNo" | "status">) {
    return {
      procurementId: procurement.id,
      projectId: procurement.projectId,
      code: procurement.code,
      status: procurement.status,
      currentVersionId: version.id,
      versionId: version.id,
      versionNo: version.versionNo,
      versionStatus: version.status,
      totalAmountCents: null,
      amountStatus: "pending_payment_application"
    };
  }

  private async nextApplicationCode(tx: Prisma.TransactionClient) {
    const dateKey = shanghaiDateKey(new Date());
    const prefix = `LXCG-${dateKey}-`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`spot-procurement-code:${dateKey}`}))`;
    const existing = await tx.spotProcurement.findMany({
      where: { code: { startsWith: prefix } },
      select: { code: true }
    });
    const sequence =
      Math.max(
        0,
        ...existing.map((procurement) => applicationCodeSequence(procurement.code, prefix))
      ) + 1;
    return `${prefix}${String(sequence).padStart(3, "0")}`;
  }

  private async loadActorRoleKeys(tx: Prisma.TransactionClient, actorUserId: string, projectId: string): Promise<RoleKey[]> {
    const [globalPositions, projectPositions, memberPositions] = await Promise.all([
      tx.userPosition.findMany({ where: { userId: actorUserId, projectId: null }, select: { positionId: true } }),
      tx.userPosition.findMany({ where: { userId: actorUserId, projectId }, select: { positionId: true } }),
      tx.projectMember.findMany({ where: { userId: actorUserId, projectId }, select: { positionKey: true } })
    ]);
    const positionIds = [...new Set([...globalPositions, ...projectPositions].map((position) => position.positionId))];
    const positions = positionIds.length
      ? await tx.position.findMany({ where: { id: { in: positionIds } }, select: { id: true, key: true } })
      : [];
    const keyByPositionId = new Map(positions.map((position) => [position.id, position.key as RoleKey]));
    return resolveEffectiveRoleKeys(
      globalPositions.flatMap((position) => {
        const key = keyByPositionId.get(position.positionId);
        return key ? [key] : [];
      }),
      [
        ...projectPositions.flatMap((position) => {
          const key = keyByPositionId.get(position.positionId);
          return key ? [key] : [];
        }),
        ...memberPositions.map((position) => position.positionKey as RoleKey)
      ]
    );
  }

  private requireAnyRole(roles: readonly RoleKey[], allowed: ReadonlySet<RoleKey>, message: string) {
    if (!roles.some((role) => allowed.has(role))) throw new ForbiddenException(message);
  }

  private async runWrite<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      const code = prismaErrorCode(error);
      if (["P2002", "P2034", "P2003", "P2025"].includes(code ?? "")) {
        throw new ConflictException("采购数据已变化，请刷新后重试");
      }
      throw error;
    }
  }
}

function requiredText(value: unknown, message: string) {
  const normalized = typeof value === "string" ? collapseUnicodeWhitespace(value) : "";
  if (!normalized) throw new BadRequestException(message);
  return normalized;
}

function optionalText(value: unknown) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new BadRequestException("文字字段格式不正确");
  return trimUnicodeWhitespace(value) || null;
}

function shanghaiDateKey(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(value);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}${values.get("month")}${values.get("day")}`;
}

function applicationCodeSequence(code: string, prefix: string) {
  const suffix = code.slice(prefix.length);
  return /^\d+$/u.test(suffix) ? Number(suffix) : 0;
}

function abnormalTerminationReadModel(termination: {
  id: string;
  procurementId: string;
  status: string;
  reason: string;
  requestedByUserId: string;
  requestedAt: Date;
  confirmedByUserId: string | null;
  confirmedAt: Date | null;
}) {
  return {
    id: termination.id,
    procurementId: termination.procurementId,
    status: termination.status,
    reason: termination.reason,
    requestedByUserId: termination.requestedByUserId,
    requestedAt: termination.requestedAt.toISOString(),
    confirmedByUserId: termination.confirmedByUserId,
    confirmedAt: termination.confirmedAt?.toISOString() ?? null
  };
}

function prismaErrorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : null;
}
