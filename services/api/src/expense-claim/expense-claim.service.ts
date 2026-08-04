import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { RoleKey } from "@jiangkong/shared-domain";
import { resolveApprovalReviewIdentity, type FrozenApprovalNode } from "../approval/approval-review-identity";
import { ApprovalFormService } from "../approval/approval-form.service";
import { snapshotApprovalSignature } from "../approval/approval-signature-snapshot";
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { BusinessNumberingService } from "../business-number/business-numbering.service";
import { PrismaService } from "../database/prisma.service";
import { FileService } from "../file/file.service";
import { moneyCentsToApi, parseMoneyCentsInput } from "../money/decimal-money";
import { ProjectFundingAvailabilityService } from "../project-funding/project-funding-availability.service";
import { renderExpenseClaimFinalPaymentPdf } from "./expense-claim-final-payment-pdf";
import type { CreateExpenseClaimDto, ExpenseClaimLineDto } from "./dto/create-expense-claim.dto";
import type { ReviewExpenseClaimDto } from "./dto/review-expense-claim.dto";
import type { RecordLoanDisbursementDto } from "./dto/record-loan-disbursement.dto";
import type { ConfirmEmployeeLoanRepaymentDto, RecordEmployeeLoanRepaymentDto } from "./dto/record-employee-loan-repayment.dto";
import type { AttachExpenseClaimAttachmentDto, RemoveExpenseClaimAttachmentDto } from "./dto/manage-expense-claim-attachment.dto";
import type { AdjustExpenseClaimPaymentSubjectDto } from "./dto/adjust-expense-claim-payment-subject.dto";
import type { RecordExpenseClaimPaymentDto, ReverseEmployeeLoanRepaymentDto } from "./dto/record-expense-claim-payment.dto";

type ExpenseClaimApprovalNode = FrozenApprovalNode & {
  name: string;
  mode: "any";
  roleKeys: RoleKey[];
  candidateUserIds: string[];
  candidateUserIdsByRole: Partial<Record<RoleKey, string[]>>;
  approvedRoleKeys?: RoleKey[];
};

const COMPREHENSIVE_ROLE: RoleKey = "comprehensive_director";
const FINAL_ROLES: RoleKey[] = ["chairman", "general_manager"];
const PAYMENT_SUBJECT_ADJUSTMENT_ROLES: RoleKey[] = ["finance_staff", "finance_director", "comprehensive_director"];
const INCIDENTAL_EXPENSE_CATEGORIES = [
  "temporary_service",
  "temporary_machinery_shift",
  "sporadic_labor",
  "other_incidental"
] as const;
const INCIDENTAL_EXPENSE_CATEGORY_SET = new Set<string>(
  INCIDENTAL_EXPENSE_CATEGORIES
);

@Injectable()
export class ExpenseClaimService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: BusinessNumberingService,
    private readonly audit: AuditService,
    @Optional()
    private readonly auth?: AuthService,
    private readonly visibility?: ProjectVisibilityService,
    @Optional()
    private readonly files?: FileService,
    @Optional()
    private readonly approvalForms?: ApprovalFormService,
    @Optional()
    private readonly projectFunding?: ProjectFundingAvailabilityService
  ) {}

  async createOptions(actorUserId: string) {
    const visibleProjectIds = this.visibility
      ? await this.visibility.visibleProjectIds(actorUserId)
      : [];
    const actorRoles = await this.loadRoleKeys(this.prisma, actorUserId);
    const canProxy = actorRoles.includes(COMPREHENSIVE_ROLE);
    const [companyEntities, projects, activeUsers] = await Promise.all([
      this.prisma.companyEntity.findMany({
        where: { isActive: true, dataStatus: "complete" },
        select: { id: true, name: true },
        orderBy: { createdAt: "asc" }
      }),
      visibleProjectIds.length
        ? this.prisma.project.findMany({
          where: { id: { in: visibleProjectIds }, isActive: true },
          select: { id: true, code: true, name: true },
          orderBy: { code: "asc" }
        })
        : [],
      this.prisma.user.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" }
      })
    ]);
    const actor = activeUsers.find((user) => user.id === actorUserId);
    return {
      companyEntities,
      projects,
      canProxy,
      availableActions: ["create_expense_claim"],
      applicantUsers: canProxy ? activeUsers : actor ? [actor] : [],
      factWitnessUsers: activeUsers,
      incidentalExpenseCategories: [
        { key: "temporary_service", label: "非材料临时服务" },
        { key: "temporary_machinery_shift", label: "临时机械台班" },
        { key: "sporadic_labor", label: "零星用工" },
        { key: "other_incidental", label: "其他非材料临时费用" }
      ]
    };
  }

  async listMine(actorUserId: string, view?: string) {
    const normalizedView = view === "drafts" || view === "in_progress" || view === "pending_funds" ? view : "all";
    const status = normalizedView === "drafts"
      ? ["draft"]
      : normalizedView === "in_progress"
        ? ["approval_pending"]
        : normalizedView === "pending_funds"
          ? ["approved_pending_payment", "partially_paid", "approved_pending_disbursement", "partially_disbursed"]
          : undefined;
    const rows = await this.prisma.expenseClaim.findMany({
      where: {
        OR: [{ applicantUserId: actorUserId }, { handledByUserId: actorUserId }],
        ...(status ? { status: { in: status } } : {})
      },
      orderBy: [{ updatedAt: "desc" }, { code: "asc" }],
      select: { id: true, code: true, claimType: true, incidentalExpenseCategory: true, status: true, projectId: true, companyEntityNameSnapshot: true, applicantNameSnapshot: true, handledByNameSnapshot: true, reason: true, requestedAmountCents: true, loanOffsetAmountCents: true, companyPayableAmountCents: true, fundedAmountCents: true, updatedAt: true }
    });
    const projectIds = [...new Set(rows.flatMap((row) => row.projectId ? [row.projectId] : []))];
    const projects = projectIds.length
      ? await this.prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, code: true, name: true } })
      : [];
    const projectsById = new Map(projects.map((project) => [project.id, project]));
    return rows.map((row) => ({
      ...row,
      project: row.projectId ? projectsById.get(row.projectId) ?? null : null,
      requestedAmountCents: moneyCentsToApi(row.requestedAmountCents),
      loanOffsetAmountCents: moneyCentsToApi(row.loanOffsetAmountCents),
      companyPayableAmountCents: moneyCentsToApi(row.companyPayableAmountCents),
      fundedAmountCents: moneyCentsToApi(row.fundedAmountCents)
    }));
  }

  async create(actorUserId: string, input: CreateExpenseClaimDto) {
    const claimType = input.claimType;
    const requestedAmountCents = positiveCents(input.requestedAmountCents, "申请金额必须大于零");
    const lines = claimType === "reimbursement" ? this.lines(input.lines) : [];
    const lineAmountCents = lines.reduce((total, line) => total + positiveCents(line.amountCents, "费用明细金额必须大于零"), 0n);
    if (claimType === "reimbursement" && lineAmountCents !== requestedAmountCents) {
      throw new BadRequestException("费用明细合计必须等于申请金额");
    }
    if (claimType === "loan" && !input.projectId?.trim()) {
      throw new BadRequestException("借款申请必须选择项目");
    }
    if (claimType === "incidental_expense" && !input.projectId?.trim()) {
      throw new BadRequestException("零星费用必须选择项目");
    }
    const incidentalExpenseCategory =
      input.incidentalExpenseCategory?.trim() || null;
    if (
      claimType === "incidental_expense" &&
      !INCIDENTAL_EXPENSE_CATEGORY_SET.has(incidentalExpenseCategory ?? "")
    ) {
      if (incidentalExpenseCategory === "sporadic_material") {
        throw new BadRequestException("材料费用必须走零星材料或材料采购流程");
      }
      throw new BadRequestException("零星费用分类不正确");
    }
    if (claimType !== "incidental_expense" && incidentalExpenseCategory) {
      throw new BadRequestException("只有零星费用可以填写零星费用分类");
    }

    return this.prisma.$transaction(async (tx) => {
      const [actor, company, project] = await Promise.all([
        tx.user.findUnique({ where: { id: actorUserId }, select: { id: true, name: true, phone: true, isActive: true } }),
        tx.companyEntity.findFirst({ where: { id: requiredText(input.companyEntityId, "使用单位不能为空"), isActive: true }, select: { id: true, name: true } }),
        input.projectId?.trim()
          ? tx.project.findFirst({ where: { id: input.projectId.trim(), isActive: true }, select: { id: true } })
          : Promise.resolve(null)
      ]);
      if (!actor?.isActive) throw new ForbiddenException("当前办理人不存在或已停用");
      if (!company) throw new NotFoundException("使用单位不存在或已停用");
      if (input.projectId?.trim() && !project) throw new NotFoundException("项目不存在或已停用");
      if (project && this.visibility) {
        const visibleProjectIds = await this.visibility.visibleProjectIds(actorUserId);
        if (!visibleProjectIds.includes(project.id)) throw new ForbiddenException("当前账号无权选择该项目");
      }

      const actorRoles = await this.loadRoleKeys(tx, actorUserId, project?.id);
      const applicant = await this.applicantSnapshot(tx, actor, input, actorRoles);
      const factWitness = await this.factWitnessSnapshot(tx, input, project?.id);
      const code = await this.numbering.allocateDaily(
        tx,
        claimType === "reimbursement"
          ? "BX"
          : claimType === "loan"
            ? "JK"
            : "LXFY"
      );
      const claim = await tx.expenseClaim.create({
        data: {
          code,
          claimType,
          incidentalExpenseCategory,
          status: "draft",
          companyEntityId: company.id,
          companyEntityNameSnapshot: company.name,
          paymentSubjectCompanyEntityId: company.id,
          paymentSubjectNameSnapshot: company.name,
          projectId: project?.id,
          factWitnessUserId: factWitness?.id ?? null,
          factWitnessNameSnapshot: factWitness?.name ?? null,
          applicantUserId: applicant.userId,
          applicantNameSnapshot: applicant.name,
          applicantPhoneSnapshot: applicant.phone,
          handledByUserId: actor.id,
          handledByNameSnapshot: actor.name,
          proxyReason: applicant.userId === actor.id ? null : "由综合部代办",
          reason: requiredText(input.reason, "事由不能为空"),
          requestedAmountCents,
          paymentMethod: optionalText(input.paymentMethod),
          payeeNameSnapshot: optionalText(input.payeeName),
          payeeAccountNameSnapshot: optionalText(input.payeeAccountName),
          payeeBankNameSnapshot: optionalText(input.payeeBankName),
          payeeBankAccountSnapshot: optionalText(input.payeeBankAccount),
          loanExpectedClearanceAt: input.loanExpectedClearanceOn ? dateOnly(input.loanExpectedClearanceOn, "预计清账日期") : null
        }
      });
      if (lines.length) {
        await tx.expenseClaimLine.createMany({
          data: lines.map((line, index) => ({
            expenseClaimId: claim.id,
            sortOrder: index + 1,
            expenseCategory: requiredText(line.expenseCategory, "费用类别不能为空"),
            occurredOn: dateOnly(line.occurredOn, "发生日期"),
            purpose: requiredText(line.purpose, "用途说明不能为空"),
            receiptCount: receiptCount(line.receiptCount),
            amountCents: positiveCents(line.amountCents, "费用明细金额必须大于零"),
            evidenceType: line.evidenceType,
            noEvidenceReason: line.evidenceType === "none" ? requiredText(line.noEvidenceReason, "无凭证原因必填") : null,
            remark: optionalText(line.remark)
          }))
        });
      }
      await this.audit.record(tx, {
        actorUserId,
        action:
          claimType === "incidental_expense"
            ? "incidental_expense.draft.create"
            : "expense_claim.draft.create",
        businessType:
          claimType === "incidental_expense"
            ? "incidental_expense"
            : "expense_claim",
        businessId: claim.id,
        metadata: {
          code,
          claimType,
          incidentalExpenseCategory,
          projectId: project?.id ?? null,
          requestedAmountCents: requestedAmountCents.toString()
        }
      });
      return { id: claim.id, code, status: claim.status, requestedAmountCents: moneyCentsToApi(requestedAmountCents) };
    });
  }

  async getMine(claimId: string, actorUserId: string) {
    const claim = await this.prisma.expenseClaim.findFirst({
      where: { id: claimId },
      select: {
        id: true, code: true, claimType: true, incidentalExpenseCategory: true, status: true, projectId: true, applicantUserId: true, handledByUserId: true, companyEntityNameSnapshot: true,
        paymentSubjectCompanyEntityId: true, paymentSubjectNameSnapshot: true, paymentSubjectAdjustmentReason: true, paymentSubjectAdjustedAt: true, paymentSubjectAdjustedByUserId: true, paymentSubjectAdjustedByRoleKey: true,
        applicantNameSnapshot: true, applicantPhoneSnapshot: true, handledByNameSnapshot: true, proxyReason: true,
        factWitnessNameSnapshot: true, reason: true, requestedAmountCents: true, loanOffsetAmountCents: true,
        companyPayableAmountCents: true, fundedAmountCents: true, paymentMethod: true, payeeNameSnapshot: true,
        payeeAccountNameSnapshot: true, payeeBankNameSnapshot: true, payeeBankAccountSnapshot: true,
        loanExpectedClearanceAt: true, submittedAt: true, approvedAt: true, updatedAt: true
      }
    });
    if (!claim) throw new NotFoundException("费用申请不存在或当前账号无权读取");
    const instance = claim.status === "approval_pending"
      ? await this.prisma.approvalInstance.findFirst({
        where: { businessType: "expense_claim", businessId: claim.id, status: "in_progress" },
        orderBy: { createdAt: "desc" },
        select: { currentNodeIndex: true, frozenNodes: true, applicantUserId: true }
      })
      : null;
    const node = instance
      ? (instance.frozenNodes as unknown as ExpenseClaimApprovalNode[])[instance.currentNodeIndex] ?? null
      : null;
    const roles = await this.loadRoleKeys(this.prisma, actorUserId, claim.projectId ?? undefined);
    const identity = node
      ? resolveApprovalReviewIdentity({ node, actorUserId, actorRoleKeys: roles })
      : null;
    const isOwner = claim.applicantUserId === actorUserId || claim.handledByUserId === actorUserId;
    const canAppendEvidence =
      !["draft", "rejected", "offset_completed"].includes(claim.status) &&
      (claim.handledByUserId === actorUserId ||
        roles.some((role) => ["comprehensive_director", "finance_staff", "finance_director"].includes(role)));
    const canAdjustPaymentSubject =
      claim.claimType === "reimbursement" &&
      claim.status === "approved_pending_payment" &&
      roles.some((role) => PAYMENT_SUBJECT_ADJUSTMENT_ROLES.includes(role));
    if (!isOwner && !identity && !canAppendEvidence) throw new NotFoundException("费用申请不存在或当前账号无权读取");
    const [project, lines, attachments, paymentSubjectCompanyEntities, paymentExecutions, finalPaymentPdf] = await Promise.all([
      claim.projectId
        ? this.prisma.project.findUnique({ where: { id: claim.projectId }, select: { id: true, code: true, name: true } })
        : Promise.resolve(null),
      this.prisma.expenseClaimLine.findMany({
        where: { expenseClaimId: claim.id },
        orderBy: { sortOrder: "asc" },
        select: { id: true, sortOrder: true, expenseCategory: true, occurredOn: true, purpose: true, receiptCount: true, amountCents: true, evidenceType: true, noEvidenceReason: true, remark: true }
      }),
      (this.prisma as unknown as {
        expenseClaimAttachment?: {
          findMany(args: {
            where: { expenseClaimId: string };
            orderBy: Array<{ createdAt: "asc" } | { id: "asc" }>;
            select: Record<string, true>;
          }): Promise<Array<{
            id: string; fileId: string; category: string; expenseCategory: string | null; stage: string;
            attachedByUserId: string; frozenAt: Date | null; removedAt: Date | null; createdAt: Date;
          }>>;
        };
      }).expenseClaimAttachment?.findMany({
        where: { expenseClaimId: claim.id },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true, fileId: true, category: true, expenseCategory: true, stage: true,
          attachedByUserId: true, frozenAt: true, removedAt: true, createdAt: true
        }
      }) ?? Promise.resolve([]),
      canAdjustPaymentSubject
        ? this.prisma.companyEntity.findMany({
          where: { isActive: true, dataStatus: "complete" },
          select: { id: true, name: true },
          orderBy: { createdAt: "asc" }
        })
        : Promise.resolve([]),
      claim.claimType === "reimbursement"
        ? this.prisma.expenseClaimPaymentExecution.findMany({
          where: { expenseClaimId: claim.id },
          select: { id: true, amountCents: true, paidAt: true, paymentMethod: true, voucherFileId: true, recordedByUserId: true, note: true, createdAt: true },
          orderBy: [{ paidAt: "asc" }, { createdAt: "asc" }]
        })
        : Promise.resolve([]),
      this.prisma.pdfDocument.findFirst({
        where: {
          businessType: "expense_claim",
          businessId: claim.id,
          templateKey: claim.claimType === "reimbursement" ? "expense_claim_final_payment_a5" : "expense_claim_loan_final_disbursement_a5"
        },
        select: { id: true, fileId: true, createdAt: true }
      })
    ]);
    const attachmentFileIds = attachments.map((attachment) => attachment.fileId);
    const attachmentUploaderIds = [...new Set(attachments.map((attachment) => attachment.attachedByUserId))];
    const [files, attachmentUploaders] = await Promise.all([
      attachmentFileIds.length
        ? this.prisma.fileObject.findMany({
            where: { id: { in: attachmentFileIds } },
            select: { id: true, originalName: true, mimeType: true, sizeBytes: true, storageStatus: true }
          })
        : Promise.resolve([]),
      attachmentUploaderIds.length
        ? this.prisma.user.findMany({ where: { id: { in: attachmentUploaderIds } }, select: { id: true, name: true } })
        : Promise.resolve([])
    ]);
    const fileById = new Map(files.map((file) => [file.id, file]));
    const uploaderNameById = new Map(attachmentUploaders.map((user) => [user.id, user.name]));
    const loanAccount = claim.claimType === "loan" && claim.applicantUserId && claim.projectId
      ? await this.prisma.employeeProjectLoanAccount.findUnique({
        where: { userId_scopeKey: { userId: claim.applicantUserId, scopeKey: `project:${claim.projectId}` } },
        select: { id: true, fundedAmountCents: true, offsetAmountCents: true, repaidAmountCents: true, reservedOffsetAmountCents: true, balanceAmountCents: true }
      })
      : null;
    const [loanDisbursements, loanRepayments] = loanAccount
      ? await Promise.all([
        this.prisma.employeeProjectLoanEntry.findMany({
          where: { loanAccountId: loanAccount.id, sourceExpenseClaimId: claim.id, entryType: "disbursement" },
          select: { id: true, amountCents: true, occurredAt: true, paymentMethod: true, voucherFileId: true, note: true },
          orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }]
        }),
        this.prisma.employeeLoanRepayment.findMany({
          where: { loanAccountId: loanAccount.id },
          select: { id: true, amountCents: true, repaidAt: true, paymentMethod: true, voucherFileId: true, status: true, confirmationNote: true, reversalReason: true, createdAt: true },
          orderBy: [{ repaidAt: "desc" }, { createdAt: "desc" }]
        })
      ])
      : [[], []];
    return {
      ...claim,
      project,
      requestedAmountCents: moneyCentsToApi(claim.requestedAmountCents),
      loanOffsetAmountCents: moneyCentsToApi(claim.loanOffsetAmountCents),
      companyPayableAmountCents: moneyCentsToApi(claim.companyPayableAmountCents),
      fundedAmountCents: moneyCentsToApi(claim.fundedAmountCents),
      approval: node ? {
        currentNodeName: node.name,
        canReview: Boolean(identity),
        requiresSelfReviewConfirmation: Boolean(identity && instance?.applicantUserId === actorUserId)
      } : null,
      attachmentPermissions: { canAppendEvidence },
      paymentSubjectPermissions: { canAdjust: canAdjustPaymentSubject },
      paymentSubjectCompanyEntities,
      fundsPermissions: {
        canRecordPayment: (claim.claimType === "reimbursement" || claim.claimType === "incidental_expense") && ["approved_pending_payment", "partially_paid"].includes(claim.status) && roles.includes("finance_staff"),
        canRecordReimbursementPayment: claim.claimType === "reimbursement" && ["approved_pending_payment", "partially_paid"].includes(claim.status) && roles.includes("finance_staff"),
        canGenerateFinalPaymentPdf: claim.claimType === "reimbursement" && claim.status === "paid" && roles.includes("finance_staff"),
        canGenerateLoanFinalDisbursementPdf: claim.claimType === "loan" && claim.status === "disbursed" && roles.includes("finance_staff"),
        canRecordLoanDisbursement: claim.claimType === "loan" && ["approved_pending_disbursement", "partially_disbursed"].includes(claim.status) && roles.includes("finance_staff"),
        canRecordLoanRepayment: claim.claimType === "loan" && roles.includes("finance_staff"),
        canConfirmLoanRepayment: claim.claimType === "loan" && roles.includes("finance_director"),
        canReverseLoanRepayment: claim.claimType === "loan" && roles.includes("finance_director")
      },
      paymentExecutions: paymentExecutions.map((execution) => ({ ...execution, amountCents: moneyCentsToApi(execution.amountCents) })),
      loanAccount: loanAccount && {
        ...loanAccount,
        fundedAmountCents: moneyCentsToApi(loanAccount.fundedAmountCents),
        offsetAmountCents: moneyCentsToApi(loanAccount.offsetAmountCents),
        repaidAmountCents: moneyCentsToApi(loanAccount.repaidAmountCents),
        reservedOffsetAmountCents: moneyCentsToApi(loanAccount.reservedOffsetAmountCents),
        balanceAmountCents: moneyCentsToApi(loanAccount.balanceAmountCents)
      },
      loanDisbursements: loanDisbursements.map((entry) => ({ ...entry, amountCents: moneyCentsToApi(entry.amountCents) })),
      loanRepayments: loanRepayments.map((repayment) => ({ ...repayment, amountCents: moneyCentsToApi(repayment.amountCents) })),
      finalPaymentPdf,
      lines: lines.map((line) => ({ ...line, amountCents: moneyCentsToApi(line.amountCents) })),
      attachments: attachments.map((attachment) => {
        const file = fileById.get(attachment.fileId);
        return {
          ...attachment,
          fileName: file?.originalName ?? "文件信息不可用",
          mimeType: file?.mimeType ?? "application/octet-stream",
          sizeBytes: file?.sizeBytes ?? 0,
          fileStatus: file?.storageStatus ?? "missing",
          attachedByName: uploaderNameById.get(attachment.attachedByUserId) ?? "未知用户"
        };
      })
    };
  }

  async getActionCapability(claimId: string, actorUserId: string) {
    const detail = await this.getMine(claimId, actorUserId);
    const availableActions: string[] = [];
    const isHandler = detail.handledByUserId === actorUserId;

    if (detail.status === "draft" && isHandler) {
      availableActions.push(
        "submit_expense_claim",
        "attach_expense_claim_attachment"
      );
      if (detail.attachments.some((attachment) => !attachment.removedAt)) {
        availableActions.push("remove_expense_claim_attachment");
      }
    }
    if (detail.approval?.canReview) {
      availableActions.push("review_expense_claim");
    }
    if (detail.attachmentPermissions.canAppendEvidence) {
      availableActions.push("append_expense_claim_attachment");
    }
    if (detail.paymentSubjectPermissions.canAdjust) {
      availableActions.push("adjust_expense_claim_payment_subject");
    }
    if (detail.fundsPermissions.canRecordPayment) {
      availableActions.push("record_expense_claim_payment");
    }
    if (detail.fundsPermissions.canGenerateFinalPaymentPdf) {
      availableActions.push("generate_expense_claim_final_payment_pdf");
    }
    if (detail.fundsPermissions.canRecordLoanDisbursement) {
      availableActions.push("record_expense_claim_loan_disbursement");
    }
    if (detail.fundsPermissions.canGenerateLoanFinalDisbursementPdf) {
      availableActions.push(
        "generate_expense_claim_final_disbursement_pdf"
      );
    }
    if (
      detail.fundsPermissions.canRecordLoanRepayment &&
      detail.loanAccount
    ) {
      availableActions.push("record_expense_claim_loan_repayment");
    }

    return {
      claimId: detail.id,
      availableActions,
      removableAttachmentIds:
        detail.status === "draft" && isHandler
          ? detail.attachments
              .filter((attachment) => !attachment.removedAt)
              .map((attachment) => attachment.id)
          : []
    };
  }

  async getRepaymentActionCapability(
    claimId: string,
    repaymentId: string,
    actorUserId: string
  ) {
    const detail = await this.getMine(claimId, actorUserId);
    const repayment = detail.loanRepayments.find(
      (candidate) => candidate.id === repaymentId
    );
    if (!repayment || !detail.loanAccount) {
      throw new NotFoundException("员工还款记录不存在或不属于当前借款账户");
    }

    const availableActions: string[] = [];
    if (
      repayment.status === "recorded" &&
      detail.fundsPermissions.canConfirmLoanRepayment &&
      BigInt(repayment.amountCents) <= BigInt(detail.loanAccount.balanceAmountCents)
    ) {
      availableActions.push("confirm_expense_claim_loan_repayment");
    }
    if (
      repayment.status === "confirmed" &&
      detail.fundsPermissions.canReverseLoanRepayment
    ) {
      const original = await this.prisma.employeeProjectLoanEntry.findFirst({
        where: {
          loanAccountId: detail.loanAccount.id,
          sourceRepaymentId: repayment.id,
          entryType: "repayment"
        },
        select: {
          id: true,
          amountCents: true,
          balanceDeltaCents: true
        }
      });
      if (
        original?.amountCents === BigInt(repayment.amountCents) &&
        original.balanceDeltaCents === -BigInt(repayment.amountCents)
      ) {
        availableActions.push("reverse_expense_claim_loan_repayment");
      }
    }

    return { claimId: detail.id, repaymentId: repayment.id, availableActions };
  }

  async assertActionAvailable(
    claimId: string,
    actorUserId: string,
    action: string
  ) {
    const capability = await this.getActionCapability(claimId, actorUserId);
    if (!capability.availableActions.includes(action)) {
      throw new ForbiddenException("当前费用申请不允许执行该文件上传动作");
    }
  }

  async adjustPaymentSubject(claimId: string, actorUserId: string, input: AdjustExpenseClaimPaymentSubjectDto) {
    const companyEntityId = requiredText(input.companyEntityId, "实际付款主体不能为空");
    const reason = requiredText(input.reason, "调整原因不能为空");
    return this.prisma.$transaction(async (tx) => {
      const claims = await tx.$queryRaw<Array<{
        id: string; claimType: string; status: string; projectId: string | null;
        paymentSubjectCompanyEntityId: string | null; paymentSubjectNameSnapshot: string | null;
      }>>(Prisma.sql`SELECT "id", "claimType", "status", "projectId", "paymentSubjectCompanyEntityId", "paymentSubjectNameSnapshot" FROM "ExpenseClaim" WHERE "id" = ${claimId} FOR UPDATE`);
      const claim = claims[0];
      if (!claim) throw new NotFoundException("费用申请不存在");
      if (claim.claimType !== "reimbursement" || claim.status !== "approved_pending_payment") {
        throw new BadRequestException("仅已批待公司付款的费用报销可以调整实际付款主体");
      }
      const roles = await this.loadRoleKeys(tx, actorUserId, claim.projectId ?? undefined);
      const adjustedByRoleKey = PAYMENT_SUBJECT_ADJUSTMENT_ROLES.find((role) => roles.includes(role));
      if (!adjustedByRoleKey) throw new ForbiddenException("当前岗位无权调整实际付款主体");
      const company = await tx.companyEntity.findFirst({
        where: { id: companyEntityId, isActive: true, dataStatus: "complete" },
        select: { id: true, name: true }
      });
      if (!company) throw new NotFoundException("实际付款主体不存在、未完成资料或已停用");
      if (company.id === claim.paymentSubjectCompanyEntityId) {
        throw new BadRequestException("实际付款主体未发生变化，无需调整");
      }
      const adjustedAt = new Date();
      const updated = await tx.expenseClaim.update({
        where: { id: claim.id },
        data: {
          paymentSubjectCompanyEntityId: company.id,
          paymentSubjectNameSnapshot: company.name,
          paymentSubjectAdjustmentReason: reason,
          paymentSubjectAdjustedAt: adjustedAt,
          paymentSubjectAdjustedByUserId: actorUserId,
          paymentSubjectAdjustedByRoleKey: adjustedByRoleKey
        },
        select: {
          id: true, paymentSubjectCompanyEntityId: true, paymentSubjectNameSnapshot: true,
          paymentSubjectAdjustmentReason: true, paymentSubjectAdjustedAt: true,
          paymentSubjectAdjustedByUserId: true, paymentSubjectAdjustedByRoleKey: true
        }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "expense_claim.payment_subject.adjust",
        businessType: "expense_claim",
        businessId: claim.id,
        metadata: {
          previousCompanyEntityId: claim.paymentSubjectCompanyEntityId,
          previousCompanyEntityName: claim.paymentSubjectNameSnapshot,
          companyEntityId: company.id,
          companyEntityName: company.name,
          reason,
          adjustedByRoleKey
        }
      });
      return updated;
    });
  }

  async attachAttachment(claimId: string, actorUserId: string, input: AttachExpenseClaimAttachmentDto) {
    if (!this.files) throw new ServiceUnavailableException("费用附件服务暂不可用，请稍后重试");
    const fileId = requiredText(input.fileId, "请选择费用附件");
    return this.prisma.$transaction(async (tx) => {
      const claims = await tx.$queryRaw<Array<{ id: string; status: string; handledByUserId: string }>>(
        Prisma.sql`SELECT "id", "status", "handledByUserId" FROM "ExpenseClaim" WHERE "id" = ${claimId} FOR UPDATE`
      );
      const claim = claims[0];
      if (!claim) throw new NotFoundException("费用申请不存在");
      if (claim.status !== "draft") throw new BadRequestException("费用申请提交后不能替换已冻结附件");
      if (claim.handledByUserId !== actorUserId) throw new ForbiddenException("只有经办人可以维护草稿费用附件");
      const file = await this.files!.assertFileHasNoBusinessBinding(tx, fileId);
      if (file.uploadedByUserId !== actorUserId) throw new ForbiddenException("费用附件必须由当前经办人本人上传");
      const attachment = await (tx as unknown as {
        expenseClaimAttachment: {
          create(args: { data: Record<string, unknown> }): Promise<{ id: string; fileId: string; category: string; expenseCategory: string | null; stage: string; createdAt: Date }>;
        };
      }).expenseClaimAttachment.create({
        data: {
          expenseClaimId: claim.id,
          fileId,
          category: input.category,
          expenseCategory: optionalText(input.expenseCategory),
          stage: "draft",
          attachedByUserId: actorUserId
        }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "expense_claim.attachment.attach",
        businessType: "expense_claim",
        businessId: claim.id,
        metadata: { attachmentId: attachment.id, fileId, category: input.category, expenseCategory: optionalText(input.expenseCategory) }
      });
      return attachment;
    });
  }

  async appendAttachment(claimId: string, actorUserId: string, input: AttachExpenseClaimAttachmentDto) {
    if (!this.files) throw new ServiceUnavailableException("费用附件服务暂不可用，请稍后重试");
    const fileId = requiredText(input.fileId, "请选择费用附件");
    return this.prisma.$transaction(async (tx) => {
      const claims = await tx.$queryRaw<Array<{ id: string; status: string; projectId: string | null; handledByUserId: string }>>(
        Prisma.sql`SELECT "id", "status", "projectId", "handledByUserId" FROM "ExpenseClaim" WHERE "id" = ${claimId} FOR UPDATE`
      );
      const claim = claims[0];
      if (!claim) throw new NotFoundException("费用申请不存在");
      if (claim.status === "draft" || claim.status === "rejected" || claim.status === "offset_completed") {
        throw new BadRequestException("当前费用申请不允许追加资料");
      }
      const roleKeys = await this.loadRoleKeys(tx, actorUserId, claim.projectId ?? undefined);
      const canAppend =
        claim.handledByUserId === actorUserId ||
        roleKeys.some((role) => ["comprehensive_director", "finance_staff", "finance_director"].includes(role));
      if (!canAppend) throw new ForbiddenException("当前账号无权追加费用资料");
      const file = await this.files!.assertFileHasNoBusinessBinding(tx, fileId);
      if (file.uploadedByUserId !== actorUserId) throw new ForbiddenException("费用附件必须由追加人本人上传");
      const attachment = await (tx as unknown as {
        expenseClaimAttachment: {
          create(args: { data: Record<string, unknown> }): Promise<{ id: string; fileId: string; category: string; expenseCategory: string | null; stage: string; createdAt: Date }>;
        };
      }).expenseClaimAttachment.create({
        data: {
          expenseClaimId: claim.id,
          fileId,
          category: input.category,
          expenseCategory: optionalText(input.expenseCategory),
          stage: "post_submit_append",
          attachedByUserId: actorUserId
        }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "expense_claim.attachment.append",
        businessType: "expense_claim",
        businessId: claim.id,
        metadata: { attachmentId: attachment.id, fileId, category: input.category, expenseCategory: optionalText(input.expenseCategory), status: claim.status }
      });
      return attachment;
    });
  }

  async removeAttachment(claimId: string, attachmentId: string, actorUserId: string, input: RemoveExpenseClaimAttachmentDto) {
    return this.prisma.$transaction(async (tx) => {
      const claims = await tx.$queryRaw<Array<{ id: string; status: string; handledByUserId: string }>>(
        Prisma.sql`SELECT "id", "status", "handledByUserId" FROM "ExpenseClaim" WHERE "id" = ${claimId} FOR UPDATE`
      );
      const claim = claims[0];
      if (!claim) throw new NotFoundException("费用申请不存在");
      if (claim.status !== "draft") throw new BadRequestException("费用申请提交后不能移除已冻结附件");
      if (claim.handledByUserId !== actorUserId) throw new ForbiddenException("只有经办人可以维护草稿费用附件");
      const attachments = await (tx as unknown as {
        expenseClaimAttachment: {
          findFirst(args: { where: { id: string; expenseClaimId: string; removedAt: null }; select: { id: true; fileId: true } }): Promise<{ id: string; fileId: string } | null>;
          update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<{ id: string; removedAt: Date | null }>;
        };
      }).expenseClaimAttachment;
      const attachment = await attachments.findFirst({
        where: { id: attachmentId, expenseClaimId: claim.id, removedAt: null },
        select: { id: true, fileId: true }
      });
      if (!attachment) throw new NotFoundException("费用附件不存在或已经移除");
      const removed = await attachments.update({
        where: { id: attachment.id },
        data: { removedAt: new Date(), removedByUserId: actorUserId, removalReason: optionalText(input.reason) }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "expense_claim.attachment.remove",
        businessType: "expense_claim",
        businessId: claim.id,
        metadata: { attachmentId: attachment.id, fileId: attachment.fileId, reason: optionalText(input.reason) }
      });
      return removed;
    });
  }

  async submit(claimId: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{
        id: string; claimType: string; status: string; projectId: string | null; applicantUserId: string | null; companyEntityId: string; requestedAmountCents: bigint; handledByUserId: string; factWitnessUserId: string | null;
      }>>(Prisma.sql`SELECT "id", "claimType", "status", "projectId", "applicantUserId", "companyEntityId", "requestedAmountCents", "handledByUserId", "factWitnessUserId" FROM "ExpenseClaim" WHERE "id" = ${claimId} FOR UPDATE`);
      const claim = rows[0];
      if (!claim) throw new NotFoundException("费用申请不存在");
      if (claim.handledByUserId !== actorUserId) throw new ForbiddenException("只有经办人可以提交费用申请");
      if (claim.status !== "draft") throw new BadRequestException("当前费用申请不可提交");
      const offset = await this.reserveLoanOffsets(tx, claim, actorUserId);
      const nodes = await this.freezeApprovalNodes(tx, claim);
      const instance = await tx.approvalInstance.create({
        data: {
          flowType: "expense_claim.approve",
          businessType: "expense_claim",
          businessId: claim.id,
          status: "in_progress",
          currentNodeIndex: 0,
          frozenNodes: nodes as unknown as Prisma.InputJsonValue,
          applicantUserId: actorUserId
        }
      });
      const attachments = (tx as unknown as {
        expenseClaimAttachment?: {
          updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
        };
      }).expenseClaimAttachment;
      if (attachments) {
        await attachments.updateMany({
          where: { expenseClaimId: claim.id, stage: "draft", removedAt: null },
          data: { stage: "approval_frozen", frozenAt: new Date() }
        });
      }
      const updated = await tx.expenseClaim.update({
        where: { id: claim.id },
        data: {
          status: "approval_pending",
          approvalInstanceId: instance.id,
          submittedAt: new Date(),
          loanOffsetAmountCents: offset.amountCents,
          companyPayableAmountCents:
            claim.claimType === "reimbursement"
              ? claim.requestedAmountCents - offset.amountCents
              : claim.claimType === "incidental_expense"
                ? claim.requestedAmountCents
                : 0n
        }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "expense_claim.submit",
        businessType: "expense_claim",
        businessId: claim.id,
        metadata: { claimType: claim.claimType, approvalInstanceId: instance.id }
      });
      const companyPayableAmountCents =
        claim.claimType === "reimbursement"
          ? claim.requestedAmountCents - offset.amountCents
          : claim.claimType === "incidental_expense"
            ? claim.requestedAmountCents
            : 0n;
      return { id: updated.id, status: updated.status, approvalInstanceId: instance.id, loanOffsetAmountCents: moneyCentsToApi(offset.amountCents), companyPayableAmountCents: moneyCentsToApi(companyPayableAmountCents) };
    });
  }

  async review(claimId: string, actorUserId: string, input: ReviewExpenseClaimDto) {
    const result = await this.prisma.$transaction(async (tx) => {
      const claims = await tx.$queryRaw<Array<{
        id: string; claimType: string; status: string; projectId: string | null; applicantUserId: string | null; handledByUserId: string; factWitnessUserId: string | null; requestedAmountCents: bigint; loanOffsetAmountCents: bigint; companyPayableAmountCents: bigint;
      }>>(Prisma.sql`SELECT "id", "claimType", "status", "projectId", "applicantUserId", "handledByUserId", "factWitnessUserId", "requestedAmountCents", "loanOffsetAmountCents", "companyPayableAmountCents" FROM "ExpenseClaim" WHERE "id" = ${claimId} FOR UPDATE`);
      const claim = claims[0];
      if (!claim) throw new NotFoundException("费用申请不存在");
      if (claim.status !== "approval_pending") throw new BadRequestException("当前费用申请不可审批");
      const instances = await tx.$queryRaw<Array<{
        id: string; currentNodeIndex: number; frozenNodes: unknown; applicantUserId: string;
      }>>(Prisma.sql`SELECT "id", "currentNodeIndex", "frozenNodes", "applicantUserId" FROM "ApprovalInstance" WHERE "businessType" = 'expense_claim' AND "businessId" = ${claim.id} AND "status" = 'in_progress' ORDER BY "createdAt" DESC LIMIT 1 FOR UPDATE`);
      const instance = instances[0];
      if (!instance) throw new BadRequestException("费用申请审批实例不存在");
      const nodes = instance.frozenNodes as ExpenseClaimApprovalNode[];
      const node = nodes[instance.currentNodeIndex];
      if (!node) throw new BadRequestException("费用申请当前审批节点不存在");
      const roles = await this.loadRoleKeys(tx, actorUserId, claim.projectId ?? undefined);
      const identity = resolveApprovalReviewIdentity({ node, actorUserId, actorRoleKeys: roles });
      if (!identity) throw new ForbiddenException("当前用户不是费用申请的冻结审批人");
      const selfReview = await this.confirmSelfReview(instance.applicantUserId, actorUserId, identity, input);

      if (input.decision === "reject") {
        const releasedAmountCents = await this.releaseLoanOffsetReservations(tx, claim.id, actorUserId, "审批驳回");
        const rejected = await tx.expenseClaim.update({ where: { id: claim.id }, data: { status: "rejected" } });
        await tx.approvalInstance.update({ where: { id: instance.id }, data: { status: "rejected" } });
        await tx.approvalActionLog.create({
          data: {
            approvalInstanceId: instance.id,
            action: "reject",
            actorUserId,
            comment: optionalText(input.comment),
            approvedRoleKey: identity.approvedRoleKey,
            representedUserId: identity.representedUserId,
            ...(selfReview.isSelfReview ? { metadata: selfReview.metadata } : {})
          }
        });
        await this.audit.record(tx, {
          actorUserId,
          action: "expense_claim.approval.reject",
          businessType: "expense_claim",
          businessId: claim.id,
          metadata: { nodeName: node.name, approvedRoleKey: identity.approvedRoleKey, releasedAmountCents: releasedAmountCents.toString(), ...selfReview.metadata }
        });
        return { id: rejected.id, status: rejected.status };
      }

      const signature = await snapshotApprovalSignature(tx, actorUserId, { required: true });
      const nextNodes = [...nodes];
      nextNodes[instance.currentNodeIndex] = { ...node, approvedRoleKeys: [identity.approvedRoleKey] };
      const nextNodeIndex = instance.currentNodeIndex + 1;
      const completed = nextNodeIndex >= nextNodes.length;
      const postedAmountCents = completed && claim.claimType === "reimbursement"
        ? await this.postLoanOffsetReservations(tx, claim, actorUserId)
        : 0n;
      const claimUpdate = completed
        ? claim.claimType === "reimbursement" || claim.claimType === "incidental_expense"
          ? { status: claim.companyPayableAmountCents > 0n ? "approved_pending_payment" : "offset_completed", approvedAt: new Date() }
          : { status: "approved_pending_disbursement", approvedAt: new Date() }
        : { status: "approval_pending" };
      const updated = await tx.expenseClaim.update({ where: { id: claim.id }, data: claimUpdate });
      await tx.approvalInstance.update({
        where: { id: instance.id },
        data: { currentNodeIndex: nextNodeIndex, frozenNodes: nextNodes as unknown as Prisma.InputJsonValue, status: completed ? "approved" : "in_progress" }
      });
      await tx.approvalActionLog.create({
        data: {
          approvalInstanceId: instance.id,
          action: "approve",
          actorUserId,
          comment: optionalText(input.comment),
          approvedRoleKey: identity.approvedRoleKey,
          representedUserId: identity.representedUserId,
          ...(selfReview.isSelfReview ? { metadata: selfReview.metadata } : {}),
          signatureFileIdSnapshot: signature.fileId,
          signatureSha256Snapshot: signature.sha256,
          signatureVersionIdSnapshot: signature.versionId
        }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "expense_claim.approval.approve",
        businessType: "expense_claim",
        businessId: claim.id,
        metadata: { nodeName: node.name, approvedRoleKey: identity.approvedRoleKey, completed, postedAmountCents: postedAmountCents.toString(), ...selfReview.metadata }
      });
      return { id: updated.id, status: updated.status, completed, approvalInstanceId: completed ? instance.id : null };
    });
    if (result.completed && result.approvalInstanceId) {
      await this.approvalForms
        ?.generateForInstance(result.approvalInstanceId, actorUserId)
        .catch(async () => {
          await this.audit.record(this.prisma, {
            actorUserId,
            action: "expense_claim.approval_form.generation_failed",
            businessType: "expense_claim",
            businessId: claimId,
            metadata: { approvalInstanceId: result.approvalInstanceId }
          });
        });
    }
    return { id: result.id, status: result.status, completed: result.completed };
  }

  async recordLoanDisbursement(claimId: string, actorUserId: string, input: RecordLoanDisbursementDto) {
    const amountCents = positiveCents(input.amountCents, "放款金额必须大于零");
    const voucherFileId = requiredText(input.voucherFileId, "放款凭证必填");
    const paymentMethod = requiredText(input.paymentMethod, "放款方式必填");
    const paidAt = dateOnly(input.paidAt, "放款日期");
    const note = optionalText(input.note);
    if (paidAt.getTime() > Date.now()) throw new BadRequestException("放款日期不能晚于当前时间");
    if (!input.confirmationPassword?.trim()) throw new BadRequestException("放款登记需要当前登录密码确认");
    if (!this.auth) throw new ServiceUnavailableException("放款身份确认服务暂不可用，请稍后重试");
    await this.auth.confirmPassword(actorUserId, input.confirmationPassword);

    const result = await this.prisma.$transaction(async (tx) => {
      const fundingScope = this.projectFunding
        ? await tx.expenseClaim.findUnique({
            where: { id: claimId },
            select: { id: true, projectId: true }
          })
        : null;
      if (this.projectFunding && !fundingScope?.projectId) {
        throw new BadRequestException(
          "借款申请未关联项目，不能登记放款"
        );
      }
      if (this.projectFunding && fundingScope?.projectId) {
        await this.projectFunding.lockFundingContext(
          tx,
          fundingScope.projectId
        );
      }
      const claims = await tx.$queryRaw<Array<{
        id: string; claimType: string; status: string; projectId: string | null; companyEntityId: string; applicantUserId: string | null; requestedAmountCents: bigint; fundedAmountCents: bigint;
      }>>(Prisma.sql`SELECT "id", "claimType", "status", "projectId", "companyEntityId", "applicantUserId", "requestedAmountCents", "fundedAmountCents" FROM "ExpenseClaim" WHERE "id" = ${claimId} FOR UPDATE`);
      const claim = claims[0];
      if (!claim) throw new NotFoundException("借款申请不存在");
      if (
        fundingScope &&
        (fundingScope.id !== claim.id ||
          fundingScope.projectId !== claim.projectId)
      ) {
        throw new ConflictException(
          "借款申请的项目资金范围已变化，请刷新后重试"
        );
      }
      if (claim.claimType !== "loan" || !claim.projectId || !claim.applicantUserId) throw new BadRequestException("当前申请不支持登记借款放款");
      const existingEntry = this.projectFunding
        ? await tx.employeeProjectLoanEntry.findFirst({
            where: {
              voucherFileId,
              entryType: "disbursement"
            }
          })
        : null;
      if (existingEntry) {
        if (
          existingEntry.sourceExpenseClaimId !== claim.id ||
          existingEntry.amountCents !== amountCents ||
          existingEntry.balanceDeltaCents !== amountCents ||
          existingEntry.occurredAt.getTime() !== paidAt.getTime() ||
          existingEntry.createdByUserId !== actorUserId ||
          existingEntry.paymentMethod !== paymentMethod ||
          existingEntry.note !== note
        ) {
          throw new ConflictException(
            "该放款凭证已绑定不同的借款放款事实"
          );
        }
        await this.projectFunding!.allocateExecution(tx, {
          projectId: claim.projectId,
          executionType: "employee_loan_disbursement",
          executionId: existingEntry.id,
          businessType: "expense_claim",
          businessId: claim.id,
          amountCents,
          occurredAt: paidAt,
          actorUserId
        });
        return {
          id: existingEntry.id,
          expenseClaimId: claim.id,
          loanAccountId: existingEntry.loanAccountId,
          amountCents: moneyCentsToApi(amountCents),
          fundedAmountCents:
            moneyCentsToApi(claim.fundedAmountCents),
          status: claim.status,
          replayed: true
        };
      }
      if (!["approved_pending_disbursement", "partially_disbursed"].includes(claim.status)) throw new BadRequestException("当前借款申请不可登记放款");
      if (amountCents > claim.requestedAmountCents - claim.fundedAmountCents) throw new BadRequestException("放款金额超过借款申请剩余批准金额");
      const voucher = await tx.fileObject.findUnique({ where: { id: voucherFileId }, select: { id: true, uploadedByUserId: true } });
      if (!voucher) throw new NotFoundException("放款凭证不存在");
      if (voucher.uploadedByUserId !== actorUserId) throw new BadRequestException("放款凭证必须由登记人本人上传");
      if (this.files) {
        await this.files.assertFileHasNoBusinessBinding(
          tx,
          voucherFileId
        );
      }
      const scopeKey = `project:${claim.projectId}`;
      await tx.employeeProjectLoanAccount.upsert({
        where: { userId_scopeKey: { userId: claim.applicantUserId, scopeKey } },
        create: { userId: claim.applicantUserId, projectId: claim.projectId, companyEntityId: claim.companyEntityId, scopeKey },
        update: {}
      });
      const accounts = await tx.$queryRaw<Array<{ id: string; fundedAmountCents: bigint; offsetAmountCents: bigint; repaidAmountCents: bigint; reservedOffsetAmountCents: bigint; balanceAmountCents: bigint }>>(Prisma.sql`SELECT "id", "fundedAmountCents", "offsetAmountCents", "repaidAmountCents", "reservedOffsetAmountCents", "balanceAmountCents" FROM "EmployeeProjectLoanAccount" WHERE "userId" = ${claim.applicantUserId} AND "scopeKey" = ${scopeKey} FOR UPDATE`);
      const account = accounts[0];
      if (!account) throw new BadRequestException("借款账户创建失败");
      const sequences = await tx.$queryRaw<Array<{ nextSequenceNo: bigint }>>(Prisma.sql`SELECT COALESCE(MAX("sequenceNo"), 0) + 1 AS "nextSequenceNo" FROM "EmployeeProjectLoanEntry" WHERE "loanAccountId" = ${account.id}`);
      const entry = await tx.employeeProjectLoanEntry.create({ data: { loanAccountId: account.id, sequenceNo: sequences[0]!.nextSequenceNo, entryType: "disbursement", amountCents, balanceDeltaCents: amountCents, sourceExpenseClaimId: claim.id, occurredAt: paidAt, createdByUserId: actorUserId, voucherFileId, paymentMethod, note } });
      const fundingAllocation =
        this.projectFunding
          ? await this.projectFunding.allocateExecution(tx, {
              projectId: claim.projectId,
              executionType: "employee_loan_disbursement",
              executionId: entry.id,
              businessType: "expense_claim",
              businessId: claim.id,
              amountCents,
              occurredAt: paidAt,
              actorUserId
            })
          : null;
      const fundedAmountCents = account.fundedAmountCents + amountCents;
      const balanceAmountCents = account.balanceAmountCents + amountCents;
      await tx.employeeProjectLoanAccount.update({ where: { id: account.id }, data: { fundedAmountCents, balanceAmountCents } });
      const claimFundedAmountCents = claim.fundedAmountCents + amountCents;
      const claimStatus = claimFundedAmountCents === claim.requestedAmountCents ? "disbursed" : "partially_disbursed";
      await tx.expenseClaim.update({ where: { id: claim.id }, data: { fundedAmountCents: claimFundedAmountCents, status: claimStatus } });
      await this.audit.record(tx, { actorUserId, action: "expense_claim.loan.disbursement.record", businessType: "expense_claim", businessId: claim.id, metadata: { loanAccountId: account.id, loanEntryId: entry.id, amountCents: amountCents.toString(), voucherFileId, paymentMethod, fundingAllocation: fundingAllocation ? { kind: fundingAllocation.kind, projectCashAmountCents: fundingAllocation.projectCashAmountCents.toString(), financingQuotaAmountCents: fundingAllocation.financingQuotaAmountCents.toString(), allocations: fundingAllocation.allocations.map((allocation) => ({ sourceType: allocation.sourceType, sourceId: allocation.sourceId, amountCents: allocation.amountCents.toString() })) } : null } });
      return { id: entry.id, expenseClaimId: claim.id, loanAccountId: account.id, amountCents: moneyCentsToApi(amountCents), fundedAmountCents: moneyCentsToApi(claimFundedAmountCents), status: claimStatus, replayed: false };
    });
    if (result.status === "disbursed" && !result.replayed) {
      await this.ensureLoanFinalDisbursementPdf(claimId, actorUserId).catch(async () => {
        await this.audit.record(this.prisma, { actorUserId, action: "expense_claim.loan.final_pdf.generation_failed", businessType: "expense_claim", businessId: claimId, metadata: {} });
      });
    }
    return {
      id: result.id,
      expenseClaimId: result.expenseClaimId,
      loanAccountId: result.loanAccountId,
      amountCents: result.amountCents,
      fundedAmountCents: result.fundedAmountCents,
      status: result.status
    };
  }

  async recordReimbursementPayment(claimId: string, actorUserId: string, input: RecordExpenseClaimPaymentDto) {
    return this.recordPayment(claimId, actorUserId, input);
  }

  async recordPayment(claimId: string, actorUserId: string, input: RecordExpenseClaimPaymentDto) {
    const amountCents = positiveCents(input.amountCents, "补付金额必须大于零");
    const voucherFileId = requiredText(input.voucherFileId, "补付凭证必填");
    const paymentMethod = requiredText(input.paymentMethod, "补付方式必填");
    const paidAt = dateOnly(input.paidAt, "付款日期");
    const note = optionalText(input.note);
    if (paidAt.getTime() > Date.now()) throw new BadRequestException("付款日期不能晚于当前时间");
    if (!this.auth || !input.confirmationPassword?.trim()) throw new BadRequestException("补付登记需要当前登录密码确认");
    await this.auth.confirmPassword(actorUserId, input.confirmationPassword);

    const result = await this.prisma.$transaction(async (tx) => {
      const fundingScope = this.projectFunding
        ? await tx.expenseClaim.findUnique({
            where: { id: claimId },
            select: { id: true, claimType: true, projectId: true }
          })
        : null;
      if (this.projectFunding && !fundingScope?.projectId) {
        throw new BadRequestException(
          fundingScope?.claimType === "incidental_expense"
            ? "零星费用未关联项目，不能登记实际支付"
            : "报销申请未关联项目，不能登记公司补付"
        );
      }
      if (this.projectFunding && fundingScope?.projectId) {
        await this.projectFunding.lockFundingContext(
          tx,
          fundingScope.projectId
        );
      }
      const claims = await tx.$queryRaw<Array<{ id: string; claimType: string; status: string; projectId: string | null; companyPayableAmountCents: bigint; fundedAmountCents: bigint }>>(Prisma.sql`SELECT "id", "claimType", "status", "projectId", "companyPayableAmountCents", "fundedAmountCents" FROM "ExpenseClaim" WHERE "id" = ${claimId} FOR UPDATE`);
      const claim = claims[0];
      if (!claim) throw new NotFoundException("费用申请不存在");
      if (
        fundingScope &&
        (fundingScope.id !== claim.id ||
          fundingScope.projectId !== claim.projectId)
      ) {
        throw new BadRequestException(
          "费用申请的项目资金范围已变化，请刷新后重试"
        );
      }
      if (
        claim.claimType !== "reimbursement" &&
        claim.claimType !== "incidental_expense"
      ) {
        throw new BadRequestException("当前费用申请不可登记实际支付");
      }
      const businessType =
        claim.claimType === "incidental_expense"
          ? "incidental_expense"
          : "expense_claim";
      const existingExecution = this.projectFunding
        ? await tx.expenseClaimPaymentExecution.findUnique({
            where: { voucherFileId }
          })
        : null;
      if (existingExecution) {
        if (
          existingExecution.expenseClaimId !== claim.id ||
          existingExecution.amountCents !== amountCents ||
          existingExecution.paidAt.getTime() !== paidAt.getTime() ||
          existingExecution.paymentMethod !== paymentMethod ||
          existingExecution.recordedByUserId !== actorUserId ||
          existingExecution.note !== note
        ) {
          throw new ConflictException(
            "该补付凭证已绑定不同的公司补付事实"
          );
        }
        await this.projectFunding!.allocateExecution(tx, {
          projectId: claim.projectId!,
          executionType: "expense_claim_payment_execution",
          executionId: existingExecution.id,
          businessType,
          businessId: claim.id,
          amountCents,
          occurredAt: paidAt,
          actorUserId
        });
        return {
          id: existingExecution.id,
          expenseClaimId: claim.id,
          paidAmountCents: moneyCentsToApi(claim.fundedAmountCents),
          status: claim.status,
          claimType: claim.claimType,
          replayed: true
        };
      }
      if (!["approved_pending_payment", "partially_paid"].includes(claim.status)) throw new BadRequestException("当前费用申请不可登记实际支付");
      if (amountCents > claim.companyPayableAmountCents - claim.fundedAmountCents) throw new BadRequestException("补付金额超过当前待付金额");
      const voucher = await tx.fileObject.findUnique({ where: { id: voucherFileId }, select: { id: true, uploadedByUserId: true } });
      if (!voucher) throw new NotFoundException("补付凭证不存在");
      if (voucher.uploadedByUserId !== actorUserId) throw new BadRequestException("补付凭证必须由登记人本人上传");
      if (this.files) {
        await this.files.assertFileHasNoBusinessBinding(
          tx,
          voucherFileId
        );
      }
      const execution = await tx.expenseClaimPaymentExecution.create({
        data: { expenseClaimId: claim.id, amountCents, paidAt, paymentMethod, voucherFileId, recordedByUserId: actorUserId, note }
      });
      const fundingAllocation =
        this.projectFunding && claim.projectId
          ? await this.projectFunding.allocateExecution(tx, {
              projectId: claim.projectId,
              executionType:
                "expense_claim_payment_execution",
              executionId: execution.id,
              businessType,
              businessId: claim.id,
              amountCents,
              occurredAt: paidAt,
              actorUserId
            })
          : null;
      const fundedAmountCents = claim.fundedAmountCents + amountCents;
      const status = fundedAmountCents === claim.companyPayableAmountCents ? "paid" : "partially_paid";
      await tx.expenseClaim.update({ where: { id: claim.id }, data: { fundedAmountCents, status } });
      await this.audit.record(tx, { actorUserId, action: claim.claimType === "incidental_expense" ? "incidental_expense.payment.record" : "expense_claim.reimbursement.payment.record", businessType, businessId: claim.id, metadata: { paymentExecutionId: execution.id, amountCents: amountCents.toString(), voucherFileId, paymentMethod, fundingAllocation: fundingAllocation ? { kind: fundingAllocation.kind, projectCashAmountCents: fundingAllocation.projectCashAmountCents.toString(), financingQuotaAmountCents: fundingAllocation.financingQuotaAmountCents.toString(), allocations: fundingAllocation.allocations.map((allocation) => ({ sourceType: allocation.sourceType, sourceId: allocation.sourceId, amountCents: allocation.amountCents.toString() })) } : null } });
      return { id: execution.id, expenseClaimId: claim.id, paidAmountCents: moneyCentsToApi(fundedAmountCents), status, claimType: claim.claimType, replayed: false };
    });
    if (result.status === "paid" && !result.replayed && result.claimType === "reimbursement") {
      await this.ensureReimbursementFinalPaymentPdf(claimId, actorUserId).catch(async () => {
        await this.audit.record(this.prisma, { actorUserId, action: "expense_claim.reimbursement.final_pdf.generation_failed", businessType: "expense_claim", businessId: claimId, metadata: {} });
      });
    }
    return {
      id: result.id,
      expenseClaimId: result.expenseClaimId,
      paidAmountCents: result.paidAmountCents,
      status: result.status
    };
  }

  async generateReimbursementFinalPaymentPdf(claimId: string, actorUserId: string) {
    return this.ensureReimbursementFinalPaymentPdf(claimId, actorUserId);
  }

  async generateLoanFinalDisbursementPdf(claimId: string, actorUserId: string) {
    return this.ensureLoanFinalDisbursementPdf(claimId, actorUserId);
  }

  async recordEmployeeLoanRepayment(claimId: string, actorUserId: string, input: RecordEmployeeLoanRepaymentDto) {
    const amountCents = positiveCents(input.amountCents, "还款金额必须大于零");
    const repaidAt = dateOnly(input.repaidAt, "还款日期");
    const paymentMethod = requiredText(input.paymentMethod, "还款方式必填");
    if (repaidAt.getTime() > Date.now()) throw new BadRequestException("还款日期不能晚于当前时间");
    if (!this.auth || !input.confirmationPassword?.trim()) throw new BadRequestException("还款登记需要当前登录密码确认");
    await this.auth.confirmPassword(actorUserId, input.confirmationPassword);
    return this.prisma.$transaction(async (tx) => {
      const claims = await tx.$queryRaw<Array<{ id: string; claimType: string; projectId: string | null; applicantUserId: string | null }>>(Prisma.sql`SELECT "id", "claimType", "projectId", "applicantUserId" FROM "ExpenseClaim" WHERE "id" = ${claimId} FOR UPDATE`);
      const claim = claims[0];
      if (!claim || claim.claimType !== "loan" || !claim.projectId || !claim.applicantUserId) throw new BadRequestException("当前借款不支持登记员工还款");
      const account = await tx.employeeProjectLoanAccount.findUnique({ where: { userId_scopeKey: { userId: claim.applicantUserId, scopeKey: `project:${claim.projectId}` } }, select: { id: true } });
      if (!account) throw new BadRequestException("借款账户不存在，不能登记还款");
      const voucherFileId = input.voucherFileId ? requiredText(input.voucherFileId, "还款凭证不正确") : null;
      if (voucherFileId) {
        const voucher = await tx.fileObject.findUnique({ where: { id: voucherFileId }, select: { id: true, uploadedByUserId: true } });
        if (!voucher || voucher.uploadedByUserId !== actorUserId) throw new BadRequestException("还款凭证必须由登记人本人上传");
      }
      const repayment = await tx.employeeLoanRepayment.create({ data: { loanAccountId: account.id, amountCents, repaidAt, paymentMethod, voucherFileId, status: "recorded", recordedByUserId: actorUserId } });
      await this.audit.record(tx, { actorUserId, action: "expense_claim.loan_repayment.record", businessType: "expense_claim", businessId: claim.id, metadata: { repaymentId: repayment.id, amountCents: amountCents.toString() } });
      return { id: repayment.id, status: repayment.status, amountCents: moneyCentsToApi(amountCents) };
    });
  }

  async confirmEmployeeLoanRepayment(claimId: string, repaymentId: string, actorUserId: string, input: ConfirmEmployeeLoanRepaymentDto) {
    if (!this.auth || !input.confirmationPassword?.trim()) throw new BadRequestException("还款确认需要当前登录密码确认");
    await this.auth.confirmPassword(actorUserId, input.confirmationPassword);
    return this.prisma.$transaction(async (tx) => {
      const claims = await tx.$queryRaw<Array<{ id: string; claimType: string; projectId: string | null; applicantUserId: string | null }>>(Prisma.sql`SELECT "id", "claimType", "projectId", "applicantUserId" FROM "ExpenseClaim" WHERE "id" = ${claimId} FOR UPDATE`);
      const claim = claims[0];
      if (!claim || claim.claimType !== "loan" || !claim.projectId || !claim.applicantUserId) throw new BadRequestException("当前借款不支持确认员工还款");
      const repayments = await tx.$queryRaw<Array<{ id: string; loanAccountId: string; amountCents: bigint; status: string }>>(Prisma.sql`SELECT "id", "loanAccountId", "amountCents", "status" FROM "EmployeeLoanRepayment" WHERE "id" = ${repaymentId} FOR UPDATE`);
      const repayment = repayments[0];
      if (!repayment || repayment.status !== "recorded") throw new BadRequestException("当前还款不可确认");
      const accounts = await tx.$queryRaw<Array<{ id: string; userId: string; scopeKey: string; balanceAmountCents: bigint; repaidAmountCents: bigint }>>(Prisma.sql`SELECT "id", "userId", "scopeKey", "balanceAmountCents", "repaidAmountCents" FROM "EmployeeProjectLoanAccount" WHERE "id" = ${repayment.loanAccountId} FOR UPDATE`);
      const account = accounts[0];
      if (!account || account.userId !== claim.applicantUserId || account.scopeKey !== `project:${claim.projectId}`) throw new BadRequestException("还款记录不属于当前借款账户");
      if (repayment.amountCents > account.balanceAmountCents) throw new BadRequestException("还款金额超过当前借款余额");
      const sequences = await tx.$queryRaw<Array<{ nextSequenceNo: bigint }>>(Prisma.sql`SELECT COALESCE(MAX("sequenceNo"), 0) + 1 AS "nextSequenceNo" FROM "EmployeeProjectLoanEntry" WHERE "loanAccountId" = ${account.id}`);
      const entry = await tx.employeeProjectLoanEntry.create({ data: { loanAccountId: account.id, sequenceNo: sequences[0]!.nextSequenceNo, entryType: "repayment", amountCents: repayment.amountCents, balanceDeltaCents: -repayment.amountCents, sourceRepaymentId: repayment.id, occurredAt: new Date(), createdByUserId: actorUserId } });
      await tx.employeeProjectLoanAccount.update({ where: { id: account.id }, data: { repaidAmountCents: account.repaidAmountCents + repayment.amountCents, balanceAmountCents: account.balanceAmountCents - repayment.amountCents } });
      const confirmed = await tx.employeeLoanRepayment.update({ where: { id: repayment.id }, data: { status: "confirmed", confirmedByUserId: actorUserId, confirmedAt: new Date(), confirmationNote: optionalText(input.confirmationNote) } });
      await this.audit.record(tx, { actorUserId, action: "expense_claim.loan_repayment.confirm", businessType: "expense_claim", businessId: claimId, metadata: { repaymentId: repayment.id, loanEntryId: entry.id, amountCents: repayment.amountCents.toString() } });
      return { id: confirmed.id, status: confirmed.status, amountCents: moneyCentsToApi(repayment.amountCents) };
    });
  }

  async reverseEmployeeLoanRepayment(claimId: string, repaymentId: string, actorUserId: string, input: ReverseEmployeeLoanRepaymentDto) {
    const reason = requiredText(input.reason, "还款更正原因必填");
    if (!this.auth || !input.confirmationPassword?.trim()) throw new BadRequestException("还款更正需要当前登录密码确认");
    await this.auth.confirmPassword(actorUserId, input.confirmationPassword);
    return this.prisma.$transaction(async (tx) => {
      const claims = await tx.$queryRaw<Array<{ id: string; claimType: string; projectId: string | null; applicantUserId: string | null }>>(Prisma.sql`SELECT "id", "claimType", "projectId", "applicantUserId" FROM "ExpenseClaim" WHERE "id" = ${claimId} FOR UPDATE`);
      const claim = claims[0];
      if (!claim || claim.claimType !== "loan" || !claim.projectId || !claim.applicantUserId) throw new BadRequestException("当前借款不支持更正员工还款");
      const repayments = await tx.$queryRaw<Array<{ id: string; loanAccountId: string; amountCents: bigint; status: string; confirmedByUserId: string | null }>>(Prisma.sql`SELECT "id", "loanAccountId", "amountCents", "status", "confirmedByUserId" FROM "EmployeeLoanRepayment" WHERE "id" = ${repaymentId} FOR UPDATE`);
      const repayment = repayments[0];
      if (!repayment || repayment.status !== "confirmed") throw new BadRequestException("当前还款不可更正");
      const accounts = await tx.$queryRaw<Array<{ id: string; userId: string; scopeKey: string; balanceAmountCents: bigint; repaidAmountCents: bigint }>>(Prisma.sql`SELECT "id", "userId", "scopeKey", "balanceAmountCents", "repaidAmountCents" FROM "EmployeeProjectLoanAccount" WHERE "id" = ${repayment.loanAccountId} FOR UPDATE`);
      const account = accounts[0];
      if (!account || account.userId !== claim.applicantUserId || account.scopeKey !== `project:${claim.projectId}`) throw new BadRequestException("还款记录不属于当前借款账户");
      const entries = await tx.$queryRaw<Array<{ id: string; entryType: string; amountCents: bigint; balanceDeltaCents: bigint; sourceRepaymentId: string | null }>>(Prisma.sql`SELECT "id", "entryType", "amountCents", "balanceDeltaCents", "sourceRepaymentId" FROM "EmployeeProjectLoanEntry" WHERE "loanAccountId" = ${account.id} AND "sourceRepaymentId" = ${repayment.id} FOR UPDATE`);
      const original = entries.find((entry) => entry.entryType === "repayment" && entry.sourceRepaymentId === repayment.id);
      if (!original || original.amountCents !== repayment.amountCents || original.balanceDeltaCents !== -repayment.amountCents) throw new BadRequestException("还款台账事实不完整，不能更正");
      const sequences = await tx.$queryRaw<Array<{ nextSequenceNo: bigint }>>(Prisma.sql`SELECT COALESCE(MAX("sequenceNo"), 0) + 1 AS "nextSequenceNo" FROM "EmployeeProjectLoanEntry" WHERE "loanAccountId" = ${account.id}`);
      const entry = await tx.employeeProjectLoanEntry.create({ data: { loanAccountId: account.id, sequenceNo: sequences[0]!.nextSequenceNo, entryType: "reversal", amountCents: repayment.amountCents, balanceDeltaCents: repayment.amountCents, reversalOfEntryId: original.id, occurredAt: new Date(), createdByUserId: actorUserId, note: reason } });
      await tx.employeeProjectLoanAccount.update({ where: { id: account.id }, data: { repaidAmountCents: account.repaidAmountCents - repayment.amountCents, balanceAmountCents: account.balanceAmountCents + repayment.amountCents } });
      const reversed = await tx.employeeLoanRepayment.update({ where: { id: repayment.id }, data: { status: "reversed", reversedAt: new Date(), reversedByUserId: actorUserId, reversalReason: reason } });
      await this.audit.record(tx, { actorUserId, action: "expense_claim.loan_repayment.reverse", businessType: "expense_claim", businessId: claim.id, metadata: { repaymentId: repayment.id, loanEntryId: entry.id, reversalOfEntryId: original.id, amountCents: repayment.amountCents.toString(), reason } });
      return { id: reversed.id, status: reversed.status, amountCents: moneyCentsToApi(repayment.amountCents) };
    });
  }

  private async ensureReimbursementFinalPaymentPdf(claimId: string, actorUserId: string) {
    if (!this.files) throw new ServiceUnavailableException("费用付讫归档文件服务暂不可用，请稍后重试");
    const [claim, existingPdf, payments] = await Promise.all([
      this.prisma.expenseClaim.findUnique({
        where: { id: claimId },
        select: {
          id: true, code: true, claimType: true, status: true, companyEntityNameSnapshot: true, paymentSubjectNameSnapshot: true,
          projectId: true, applicantNameSnapshot: true, reason: true, requestedAmountCents: true, loanOffsetAmountCents: true,
          companyPayableAmountCents: true, fundedAmountCents: true
        }
      }),
      this.prisma.pdfDocument.findFirst({ where: { businessType: "expense_claim", businessId: claimId, templateKey: "expense_claim_final_payment_a5" } }),
      this.prisma.expenseClaimPaymentExecution.findMany({
        where: { expenseClaimId: claimId },
        select: { paidAt: true, paymentMethod: true, amountCents: true, note: true },
        orderBy: [{ paidAt: "asc" }, { createdAt: "asc" }]
      })
    ]);
    if (!claim || claim.claimType !== "reimbursement") throw new NotFoundException("费用报销申请不存在");
    if (existingPdf) return { pdfDocumentId: existingPdf.id, fileId: existingPdf.fileId, existed: true };
    const paidAmount = payments.reduce((total, payment) => total + payment.amountCents, 0n);
    if (claim.status !== "paid" || claim.companyPayableAmountCents <= 0n || claim.fundedAmountCents !== claim.companyPayableAmountCents || paidAmount !== claim.companyPayableAmountCents) {
      throw new BadRequestException("公司补付全部完成后才能生成付讫归档 PDF");
    }
    const project = claim.projectId
      ? await this.prisma.project.findUnique({ where: { id: claim.projectId }, select: { code: true, name: true } })
      : null;
    const buffer = await renderExpenseClaimFinalPaymentPdf({
      code: claim.code,
      companyName: claim.companyEntityNameSnapshot,
      paymentSubjectName: claim.paymentSubjectNameSnapshot ?? claim.companyEntityNameSnapshot,
      projectName: project ? `${project.code} · ${project.name}` : "",
      applicantName: claim.applicantNameSnapshot,
      reason: claim.reason,
      requestedAmountCents: claim.requestedAmountCents,
      loanOffsetAmountCents: claim.loanOffsetAmountCents,
      companyPayableAmountCents: claim.companyPayableAmountCents,
      paidAmountCents: paidAmount,
      payments
    });
    const file = await this.files.uploadPrivateFile({ originalName: `${claim.code}-expense-claim-final-payment-a5.pdf`, mimeType: "application/pdf", sizeBytes: buffer.length, uploadedByUserId: actorUserId, buffer });
    return this.prisma.$transaction(async (tx) => {
      const duplicate = await tx.pdfDocument.findFirst({ where: { businessType: "expense_claim", businessId: claim.id, templateKey: "expense_claim_final_payment_a5" } });
      if (duplicate) return { pdfDocumentId: duplicate.id, fileId: duplicate.fileId, existed: true };
      const pdfDocument = await tx.pdfDocument.create({ data: { businessType: "expense_claim", businessId: claim.id, fileId: file.id, templateKey: "expense_claim_final_payment_a5" } });
      const archiveRecord = await tx.archiveRecord.create({ data: { businessType: "expense_claim", businessId: claim.id, fileId: file.id, departmentScope: "finance" } });
      await this.audit.record(tx, { actorUserId, action: "expense_claim.reimbursement.final_pdf.archive", businessType: "expense_claim", businessId: claim.id, metadata: { code: claim.code, fileId: file.id, pdfDocumentId: pdfDocument.id, archiveRecordId: archiveRecord.id } });
      return { pdfDocumentId: pdfDocument.id, fileId: file.id, existed: false };
    });
  }

  private async ensureLoanFinalDisbursementPdf(claimId: string, actorUserId: string) {
    if (!this.files) throw new ServiceUnavailableException("借款放款归档文件服务暂不可用，请稍后重试");
    const [claim, existingPdf, disbursements] = await Promise.all([
      this.prisma.expenseClaim.findUnique({ where: { id: claimId }, select: { id: true, code: true, claimType: true, status: true, companyEntityNameSnapshot: true, projectId: true, applicantNameSnapshot: true, reason: true, requestedAmountCents: true, fundedAmountCents: true } }),
      this.prisma.pdfDocument.findFirst({ where: { businessType: "expense_claim", businessId: claimId, templateKey: "expense_claim_loan_final_disbursement_a5" } }),
      this.prisma.employeeProjectLoanEntry.findMany({
        where: { sourceExpenseClaimId: claimId, entryType: "disbursement" },
        select: { occurredAt: true, paymentMethod: true, amountCents: true, note: true },
        orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }]
      })
    ]);
    if (!claim || claim.claimType !== "loan") throw new NotFoundException("借款申请不存在");
    if (existingPdf) return { pdfDocumentId: existingPdf.id, fileId: existingPdf.fileId, existed: true };
    const paidAmount = disbursements.reduce((total, payment) => total + payment.amountCents, 0n);
    if (claim.status !== "disbursed" || claim.fundedAmountCents !== claim.requestedAmountCents || paidAmount !== claim.requestedAmountCents) throw new BadRequestException("借款全部放款完成后才能生成归档 PDF");
    const project = claim.projectId ? await this.prisma.project.findUnique({ where: { id: claim.projectId }, select: { code: true, name: true } }) : null;
    const buffer = await renderExpenseClaimFinalPaymentPdf({
      title: "员工借款放款归档单",
      footerText: "放款归档版：仅在借款已全部实际放款后生成；放款事实、凭证与审批完成版均独立冻结，不得覆盖。",
      offsetLabel: "已冲销",
      payableLabel: "批准借款",
      paidLabel: "实际放款",
      code: claim.code,
      companyName: claim.companyEntityNameSnapshot,
      paymentSubjectName: claim.companyEntityNameSnapshot,
      projectName: project ? `${project.code} · ${project.name}` : "",
      applicantName: claim.applicantNameSnapshot,
      reason: claim.reason,
      requestedAmountCents: claim.requestedAmountCents,
      loanOffsetAmountCents: 0n,
      companyPayableAmountCents: claim.requestedAmountCents,
      paidAmountCents: paidAmount,
      payments: disbursements.map((payment) => ({ paidAt: payment.occurredAt, paymentMethod: payment.paymentMethod ?? "未记录", amountCents: payment.amountCents, note: payment.note }))
    });
    const file = await this.files.uploadPrivateFile({ originalName: `${claim.code}-loan-final-disbursement-a5.pdf`, mimeType: "application/pdf", sizeBytes: buffer.length, uploadedByUserId: actorUserId, buffer });
    return this.prisma.$transaction(async (tx) => {
      const duplicate = await tx.pdfDocument.findFirst({ where: { businessType: "expense_claim", businessId: claim.id, templateKey: "expense_claim_loan_final_disbursement_a5" } });
      if (duplicate) return { pdfDocumentId: duplicate.id, fileId: duplicate.fileId, existed: true };
      const pdfDocument = await tx.pdfDocument.create({ data: { businessType: "expense_claim", businessId: claim.id, fileId: file.id, templateKey: "expense_claim_loan_final_disbursement_a5" } });
      const archiveRecord = await tx.archiveRecord.create({ data: { businessType: "expense_claim", businessId: claim.id, fileId: file.id, departmentScope: "finance" } });
      await this.audit.record(tx, { actorUserId, action: "expense_claim.loan.final_pdf.archive", businessType: "expense_claim", businessId: claim.id, metadata: { code: claim.code, fileId: file.id, pdfDocumentId: pdfDocument.id, archiveRecordId: archiveRecord.id } });
      return { pdfDocumentId: pdfDocument.id, fileId: file.id, existed: false };
    });
  }

  private lines(lines: ExpenseClaimLineDto[] | undefined) {
    if (!lines?.length) throw new BadRequestException("报销至少需要一条费用明细");
    return lines;
  }

  private async applicantSnapshot(tx: Prisma.TransactionClient, actor: { id: string; name: string; phone: string | null; isActive: boolean }, input: CreateExpenseClaimDto, actorRoles: RoleKey[]) {
    const requestedId = input.applicantUserId?.trim();
    if (!requestedId) {
      if (!actorRoles.includes(COMPREHENSIVE_ROLE)) throw new ForbiddenException("只有综合部主管可以为无账号人员代办");
      return { userId: null, name: requiredText(input.applicantName, "无账号人员姓名必填"), phone: requiredText(input.applicantPhone, "无账号人员电话必填") };
    }
    const applicant = requestedId === actor.id ? actor : await tx.user.findUnique({ where: { id: requestedId }, select: { id: true, name: true, phone: true, isActive: true } });
    if (!applicant?.isActive) throw new NotFoundException("报销人或借款人不存在或已停用");
    if (applicant.id !== actor.id && !actorRoles.includes(COMPREHENSIVE_ROLE)) throw new ForbiddenException("只有综合部主管可以为其他系统人员代办");
    return { userId: applicant.id, name: applicant.name, phone: applicant.phone };
  }

  private async factWitnessSnapshot(tx: Prisma.TransactionClient, input: CreateExpenseClaimDto, projectId?: string) {
    if (projectId) return null;
    if (!input.factWitnessUserId?.trim()) throw new BadRequestException("非项目报销必须选择事实证明人");
    const witness = await tx.user.findUnique({ where: { id: input.factWitnessUserId.trim() }, select: { id: true, name: true, isActive: true } });
    if (!witness?.isActive) throw new NotFoundException("事实证明人不存在或已停用");
    return witness;
  }

  private async freezeApprovalNodes(
    tx: Prisma.TransactionClient,
    claim: { claimType: string; projectId: string | null; factWitnessUserId: string | null; handledByUserId: string }
  ): Promise<ExpenseClaimApprovalNode[]> {
    if (
      claim.claimType !== "reimbursement" &&
      claim.claimType !== "loan" &&
      claim.claimType !== "incidental_expense"
    ) {
      throw new BadRequestException("费用业务类型不正确");
    }
    const [assignments, memberships] = await Promise.all([
      tx.userPosition.findMany({
        where: claim.projectId ? { OR: [{ projectId: null }, { projectId: claim.projectId }] } : { projectId: null },
        select: { userId: true, positionId: true }
      }),
      claim.projectId
        ? tx.projectMember.findMany({ where: { projectId: claim.projectId }, select: { userId: true, positionKey: true } })
        : Promise.resolve([])
    ]);
    const positions = assignments.length
      ? await tx.position.findMany({ where: { id: { in: [...new Set(assignments.map((item) => item.positionId))] } }, select: { id: true, key: true } })
      : [];
    const roleByPosition = new Map(positions.map((position) => [position.id, position.key as RoleKey]));
    const candidatesByRole = new Map<RoleKey, Set<string>>();
    for (const assignment of assignments) {
      const role = roleByPosition.get(assignment.positionId);
      if (role) addCandidate(candidatesByRole, role, assignment.userId);
    }
    for (const membership of memberships) addCandidate(candidatesByRole, membership.positionKey as RoleKey, membership.userId);
    const candidateIds = [...new Set([...candidatesByRole.values()].flatMap((ids) => [...ids]))];
    const activeUsers = candidateIds.length
      ? await tx.user.findMany({ where: { id: { in: candidateIds }, isActive: true }, select: { id: true } })
      : [];
    const activeIds = new Set(activeUsers.map((user) => user.id));
    const node = (name: string, roleKeys: RoleKey[], selectedUserId?: string): ExpenseClaimApprovalNode => {
      const candidateUserIdsByRole = Object.fromEntries(roleKeys.map((role) => [role, [...(candidatesByRole.get(role) ?? [])].filter((id) => activeIds.has(id)).sort()])) as Partial<Record<RoleKey, string[]>>;
      const candidateUserIds = [...new Set(Object.values(candidateUserIdsByRole).flat())].sort();
      if (!candidateUserIds.length) throw new BadRequestException(`${name}缺少当前有效审批人，请先完成组织配置`);
      return { name, mode: "any", roleKeys, candidateUserIds, candidateUserIdsByRole, ...(selectedUserId ? { selectedUserId } : {}) };
    };
    const witnessNode = claim.projectId
      ? node("项目经理", ["project_manager"])
      : claim.factWitnessUserId && activeIds.has(claim.factWitnessUserId)
        ? { name: "事实证明人", mode: "any" as const, roleKeys: ["employee" as RoleKey], candidateUserIds: [claim.factWitnessUserId], candidateUserIdsByRole: { employee: [claim.factWitnessUserId] }, selectedUserId: claim.factWitnessUserId }
        : null;
    if (!witnessNode) throw new BadRequestException("事实证明人不存在或已停用，请重新选择后再提交");
    return [node("综合部主管", [COMPREHENSIVE_ROLE]), witnessNode, node("财务主管", ["finance_director"]), node("董事长/总经理", FINAL_ROLES)];
  }

  private async reserveLoanOffsets(
    tx: Prisma.TransactionClient,
    claim: { id: string; claimType: string; projectId: string | null; applicantUserId: string | null; companyEntityId: string; requestedAmountCents: bigint },
    actorUserId: string
  ) {
    if (claim.claimType !== "reimbursement" || !claim.projectId || !claim.applicantUserId) return { amountCents: 0n };
    const scopeKey = `project:${claim.projectId}`;
    const accounts = await tx.$queryRaw<Array<{ id: string; balanceAmountCents: bigint; reservedOffsetAmountCents: bigint }>>(Prisma.sql`SELECT "id", "balanceAmountCents", "reservedOffsetAmountCents" FROM "EmployeeProjectLoanAccount" WHERE "userId" = ${claim.applicantUserId} AND "scopeKey" = ${scopeKey} FOR UPDATE`);
    const account = accounts[0];
    if (!account) return { amountCents: 0n };
    const entries = await tx.employeeProjectLoanEntry.findMany({ where: { loanAccountId: account.id, entryType: "disbursement" }, orderBy: [{ occurredAt: "asc" }, { id: "asc" }], select: { id: true, amountCents: true } });
    const existing = await tx.expenseLoanOffsetReservation.findMany({ where: { loanAccountId: account.id, status: { in: ["reserved", "posted"] } }, select: { loanEntryId: true, amountCents: true } });
    const used = new Map<string, bigint>();
    for (const reservation of existing) {
      if (reservation.loanEntryId) used.set(reservation.loanEntryId, (used.get(reservation.loanEntryId) ?? 0n) + reservation.amountCents);
    }
    let remaining = claim.requestedAmountCents;
    const reservations: Array<{ expenseClaimId: string; loanAccountId: string; loanEntryId: string; amountCents: bigint; status: string; sequenceNo: number }> = [];
    for (const entry of entries) {
      const available = entry.amountCents - (used.get(entry.id) ?? 0n);
      if (available <= 0n || remaining <= 0n) continue;
      const amountCents = available < remaining ? available : remaining;
      reservations.push({ expenseClaimId: claim.id, loanAccountId: account.id, loanEntryId: entry.id, amountCents, status: "reserved", sequenceNo: reservations.length + 1 });
      remaining -= amountCents;
    }
    const amountCents = claim.requestedAmountCents - remaining;
    if (!reservations.length) return { amountCents: 0n };
    await tx.expenseLoanOffsetReservation.createMany({ data: reservations });
    await tx.employeeProjectLoanAccount.update({ where: { id: account.id }, data: { reservedOffsetAmountCents: account.reservedOffsetAmountCents + amountCents } });
    await this.audit.record(tx, { actorUserId, action: "expense_claim.loan_offset.reserve", businessType: "expense_claim", businessId: claim.id, metadata: { loanAccountId: account.id, amountCents: amountCents.toString(), allocationCount: reservations.length } });
    return { amountCents };
  }

  private async releaseLoanOffsetReservations(tx: Prisma.TransactionClient, expenseClaimId: string, actorUserId: string, reason: string) {
    const reservations = await tx.expenseLoanOffsetReservation.findMany({ where: { expenseClaimId, status: "reserved" }, select: { id: true, loanAccountId: true, amountCents: true } });
    if (!reservations.length) return 0n;
    const byAccount = groupReservationAmounts(reservations);
    for (const [loanAccountId, amountCents] of byAccount) {
      const accounts = await tx.$queryRaw<Array<{ id: string; reservedOffsetAmountCents: bigint }>>(Prisma.sql`SELECT "id", "reservedOffsetAmountCents" FROM "EmployeeProjectLoanAccount" WHERE "id" = ${loanAccountId} FOR UPDATE`);
      const account = accounts[0];
      if (!account || account.reservedOffsetAmountCents < amountCents) throw new BadRequestException("借款冲销预留状态异常，暂不能释放");
      await tx.employeeProjectLoanAccount.update({ where: { id: account.id }, data: { reservedOffsetAmountCents: account.reservedOffsetAmountCents - amountCents } });
    }
    await tx.expenseLoanOffsetReservation.updateMany({ where: { id: { in: reservations.map((item) => item.id) }, status: "reserved" }, data: { status: "released", releasedAt: new Date(), adjustedByUserId: actorUserId, adjustmentReason: reason } });
    const amountCents = reservations.reduce((total, item) => total + item.amountCents, 0n);
    await this.audit.record(tx, { actorUserId, action: "expense_claim.loan_offset.release", businessType: "expense_claim", businessId: expenseClaimId, metadata: { amountCents: amountCents.toString(), reason } });
    return amountCents;
  }

  private async postLoanOffsetReservations(
    tx: Prisma.TransactionClient,
    claim: { id: string; claimType: string; projectId: string | null; applicantUserId: string | null; loanOffsetAmountCents: bigint },
    actorUserId: string
  ) {
    const reservations = await tx.expenseLoanOffsetReservation.findMany({ where: { expenseClaimId: claim.id, status: "reserved" }, orderBy: { sequenceNo: "asc" }, select: { id: true, loanAccountId: true, amountCents: true } });
    if (!reservations.length) return 0n;
    const byAccount = groupReservationAmounts(reservations);
    for (const [loanAccountId, amountCents] of byAccount) {
      const accounts = await tx.$queryRaw<Array<{ id: string; offsetAmountCents: bigint; reservedOffsetAmountCents: bigint; balanceAmountCents: bigint }>>(Prisma.sql`SELECT "id", "offsetAmountCents", "reservedOffsetAmountCents", "balanceAmountCents" FROM "EmployeeProjectLoanAccount" WHERE "id" = ${loanAccountId} FOR UPDATE`);
      const account = accounts[0];
      if (!account || account.reservedOffsetAmountCents < amountCents || account.balanceAmountCents < amountCents) throw new BadRequestException("借款冲销预留状态异常，暂不能入账");
      const sequences = await tx.$queryRaw<Array<{ nextSequenceNo: bigint }>>(Prisma.sql`SELECT COALESCE(MAX("sequenceNo"), 0) + 1 AS "nextSequenceNo" FROM "EmployeeProjectLoanEntry" WHERE "loanAccountId" = ${account.id}`);
      const accountReservations = reservations.filter((item) => item.loanAccountId === account.id);
      for (const reservation of accountReservations) {
        await tx.employeeProjectLoanEntry.create({ data: { loanAccountId: account.id, sequenceNo: sequences[0]!.nextSequenceNo + BigInt(accountReservations.indexOf(reservation)), entryType: "offset", amountCents: reservation.amountCents, balanceDeltaCents: -reservation.amountCents, sourceExpenseClaimId: claim.id, sourceReservationId: reservation.id, occurredAt: new Date(), createdByUserId: actorUserId } });
      }
      await tx.employeeProjectLoanAccount.update({ where: { id: account.id }, data: { offsetAmountCents: account.offsetAmountCents + amountCents, reservedOffsetAmountCents: account.reservedOffsetAmountCents - amountCents, balanceAmountCents: account.balanceAmountCents - amountCents } });
    }
    await tx.expenseLoanOffsetReservation.updateMany({ where: { id: { in: reservations.map((item) => item.id) }, status: "reserved" }, data: { status: "posted", postedAt: new Date() } });
    const amountCents = reservations.reduce((total, item) => total + item.amountCents, 0n);
    if (amountCents !== claim.loanOffsetAmountCents) throw new BadRequestException("借款冲销预留金额与报销单不一致");
    await this.audit.record(tx, { actorUserId, action: "expense_claim.loan_offset.post", businessType: "expense_claim", businessId: claim.id, metadata: { amountCents: amountCents.toString() } });
    return amountCents;
  }

  private async confirmSelfReview(
    applicantUserId: string,
    actorUserId: string,
    identity: { representedUserId: string; viaAssignment: boolean },
    input: ReviewExpenseClaimDto
  ) {
    if (applicantUserId !== actorUserId) return { isSelfReview: false as const, metadata: {} };
    if (identity.representedUserId !== actorUserId || identity.viaAssignment) {
      throw new ForbiddenException("申请人不能通过转交或委托审批自己发起的费用申请");
    }
    const reason = input.selfReviewReason?.trim();
    if (!reason) throw new BadRequestException("审批自己发起的费用申请时，请填写自审原因");
    if (!input.confirmationPassword?.trim()) throw new BadRequestException("自审前，请输入当前密码完成二次确认");
    if (!this.auth) throw new ServiceUnavailableException("审批身份确认服务暂不可用，请稍后重试");
    await this.auth.confirmPassword(actorUserId, input.confirmationPassword);
    return { isSelfReview: true as const, metadata: { selfReview: true, selfReviewReason: reason } };
  }

  private async loadRoleKeys(tx: Prisma.TransactionClient, userId: string, projectId?: string): Promise<RoleKey[]> {
    const [assignments, memberships] = await Promise.all([
      tx.userPosition.findMany({ where: { userId, OR: [{ projectId: null }, ...(projectId ? [{ projectId }] : [])] }, select: { positionId: true } }),
      projectId ? tx.projectMember.findMany({ where: { userId, projectId }, select: { positionKey: true } }) : Promise.resolve([])
    ]);
    const positions = assignments.length ? await tx.position.findMany({ where: { id: { in: assignments.map((item) => item.positionId) } }, select: { key: true } }) : [];
    return [...new Set([...positions.map((item) => item.key as RoleKey), ...memberships.map((item) => item.positionKey as RoleKey)])];
  }
}

function requiredText(value: unknown, message: string) {
  if (typeof value !== "string" || !value.trim()) throw new BadRequestException(message);
  return value.trim();
}

function optionalText(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  return requiredText(value, "文字不能为空白");
}

function addCandidate(candidatesByRole: Map<RoleKey, Set<string>>, role: RoleKey, userId: string) {
  const candidates = candidatesByRole.get(role) ?? new Set<string>();
  candidates.add(userId);
  candidatesByRole.set(role, candidates);
}

function groupReservationAmounts(reservations: Array<{ loanAccountId: string; amountCents: bigint }>) {
  const grouped = new Map<string, bigint>();
  for (const reservation of reservations) {
    grouped.set(reservation.loanAccountId, (grouped.get(reservation.loanAccountId) ?? 0n) + reservation.amountCents);
  }
  return grouped;
}

function positiveCents(value: unknown, message: string) {
  if (typeof value !== "string") throw new BadRequestException(message);
  const cents = parseMoneyCentsInput(value, message);
  if (cents <= 0n) throw new BadRequestException(message);
  return cents;
}

function receiptCount(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 10000) {
    throw new BadRequestException("单据张数必须在 0 到 10000 之间");
  }
  return value;
}

function dateOnly(value: string, field: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw new BadRequestException(`${field}格式不正确`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new BadRequestException(`${field}格式不正确`);
  return date;
}
