import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Optional, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { RoleKey } from "@jiangkong/shared-domain";
import { resolveApprovalReviewIdentity, type FrozenApprovalNode } from "../approval/approval-review-identity";
import { snapshotApprovalSignature } from "../approval/approval-signature-snapshot";
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { BusinessNumberingService } from "../business-number/business-numbering.service";
import { PrismaService } from "../database/prisma.service";
import { moneyCentsToApi, parseMoneyCentsInput } from "../money/decimal-money";
import type { CreateExpenseClaimDto, ExpenseClaimLineDto } from "./dto/create-expense-claim.dto";
import type { ReviewExpenseClaimDto } from "./dto/review-expense-claim.dto";
import type { RecordLoanDisbursementDto } from "./dto/record-loan-disbursement.dto";

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

@Injectable()
export class ExpenseClaimService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: BusinessNumberingService,
    private readonly audit: AuditService,
    @Optional()
    private readonly auth?: AuthService
  ) {}

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

      const actorRoles = await this.loadRoleKeys(tx, actorUserId, project?.id);
      const applicant = await this.applicantSnapshot(tx, actor, input, actorRoles);
      const factWitness = await this.factWitnessSnapshot(tx, input, project?.id);
      const code = await this.numbering.allocateDaily(tx, claimType === "reimbursement" ? "BX" : "JK");
      const claim = await tx.expenseClaim.create({
        data: {
          code,
          claimType,
          status: "draft",
          companyEntityId: company.id,
          companyEntityNameSnapshot: company.name,
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
        action: "expense_claim.draft.create",
        businessType: "expense_claim",
        businessId: claim.id,
        metadata: { code, claimType, projectId: project?.id ?? null, requestedAmountCents: requestedAmountCents.toString() }
      });
      return { id: claim.id, code, status: claim.status, requestedAmountCents: moneyCentsToApi(requestedAmountCents) };
    });
  }

  async submit(claimId: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{
        id: string; claimType: string; status: string; projectId: string | null; handledByUserId: string; factWitnessUserId: string | null;
      }>>(Prisma.sql`SELECT "id", "claimType", "status", "projectId", "handledByUserId", "factWitnessUserId" FROM "ExpenseClaim" WHERE "id" = ${claimId} FOR UPDATE`);
      const claim = rows[0];
      if (!claim) throw new NotFoundException("费用申请不存在");
      if (claim.handledByUserId !== actorUserId) throw new ForbiddenException("只有经办人可以提交费用申请");
      if (claim.status !== "draft") throw new BadRequestException("当前费用申请不可提交");
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
      const updated = await tx.expenseClaim.update({
        where: { id: claim.id },
        data: { status: "approval_pending", approvalInstanceId: instance.id, submittedAt: new Date() }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "expense_claim.submit",
        businessType: "expense_claim",
        businessId: claim.id,
        metadata: { claimType: claim.claimType, approvalInstanceId: instance.id }
      });
      return { id: updated.id, status: updated.status, approvalInstanceId: instance.id };
    });
  }

  async review(claimId: string, actorUserId: string, input: ReviewExpenseClaimDto) {
    return this.prisma.$transaction(async (tx) => {
      const claims = await tx.$queryRaw<Array<{
        id: string; claimType: string; status: string; projectId: string | null; handledByUserId: string; factWitnessUserId: string | null; requestedAmountCents: bigint;
      }>>(Prisma.sql`SELECT "id", "claimType", "status", "projectId", "handledByUserId", "factWitnessUserId", "requestedAmountCents" FROM "ExpenseClaim" WHERE "id" = ${claimId} FOR UPDATE`);
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
      const signature = await snapshotApprovalSignature(tx, actorUserId, { required: selfReview.isSelfReview });

      if (input.decision === "reject") {
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
            ...(selfReview.isSelfReview ? {
              metadata: selfReview.metadata,
              signatureFileIdSnapshot: signature.fileId,
              signatureSha256Snapshot: signature.sha256,
              signatureVersionIdSnapshot: signature.versionId
            } : {})
          }
        });
        await this.audit.record(tx, {
          actorUserId,
          action: "expense_claim.approval.reject",
          businessType: "expense_claim",
          businessId: claim.id,
          metadata: { nodeName: node.name, approvedRoleKey: identity.approvedRoleKey, ...selfReview.metadata }
        });
        return { id: rejected.id, status: rejected.status };
      }

      const nextNodes = [...nodes];
      nextNodes[instance.currentNodeIndex] = { ...node, approvedRoleKeys: [identity.approvedRoleKey] };
      const nextNodeIndex = instance.currentNodeIndex + 1;
      const completed = nextNodeIndex >= nextNodes.length;
      const claimUpdate = completed
        ? claim.claimType === "reimbursement"
          ? { status: "approved_pending_payment", approvedAt: new Date(), companyPayableAmountCents: claim.requestedAmountCents }
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
          ...(selfReview.isSelfReview ? {
            metadata: selfReview.metadata,
            signatureFileIdSnapshot: signature.fileId,
            signatureSha256Snapshot: signature.sha256,
            signatureVersionIdSnapshot: signature.versionId
          } : {})
        }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "expense_claim.approval.approve",
        businessType: "expense_claim",
        businessId: claim.id,
        metadata: { nodeName: node.name, approvedRoleKey: identity.approvedRoleKey, completed, ...selfReview.metadata }
      });
      return { id: updated.id, status: updated.status, completed };
    });
  }

  async recordLoanDisbursement(claimId: string, actorUserId: string, input: RecordLoanDisbursementDto) {
    const amountCents = positiveCents(input.amountCents, "放款金额必须大于零");
    const voucherFileId = requiredText(input.voucherFileId, "放款凭证必填");
    const paymentMethod = requiredText(input.paymentMethod, "放款方式必填");
    const paidAt = dateOnly(input.paidAt, "放款日期");
    if (paidAt.getTime() > Date.now()) throw new BadRequestException("放款日期不能晚于当前时间");
    if (!input.confirmationPassword?.trim()) throw new BadRequestException("放款登记需要当前登录密码确认");
    if (!this.auth) throw new ServiceUnavailableException("放款身份确认服务暂不可用，请稍后重试");
    await this.auth.confirmPassword(actorUserId, input.confirmationPassword);

    return this.prisma.$transaction(async (tx) => {
      const claims = await tx.$queryRaw<Array<{
        id: string; claimType: string; status: string; projectId: string | null; companyEntityId: string; applicantUserId: string | null; requestedAmountCents: bigint; fundedAmountCents: bigint;
      }>>(Prisma.sql`SELECT "id", "claimType", "status", "projectId", "companyEntityId", "applicantUserId", "requestedAmountCents", "fundedAmountCents" FROM "ExpenseClaim" WHERE "id" = ${claimId} FOR UPDATE`);
      const claim = claims[0];
      if (!claim) throw new NotFoundException("借款申请不存在");
      if (claim.claimType !== "loan" || !claim.projectId || !claim.applicantUserId) throw new BadRequestException("当前申请不支持登记借款放款");
      if (!["approved_pending_disbursement", "partially_disbursed"].includes(claim.status)) throw new BadRequestException("当前借款申请不可登记放款");
      if (amountCents > claim.requestedAmountCents - claim.fundedAmountCents) throw new BadRequestException("放款金额超过借款申请剩余批准金额");
      const voucher = await tx.fileObject.findUnique({ where: { id: voucherFileId }, select: { id: true, uploadedByUserId: true } });
      if (!voucher) throw new NotFoundException("放款凭证不存在");
      if (voucher.uploadedByUserId !== actorUserId) throw new BadRequestException("放款凭证必须由登记人本人上传");
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
      const entry = await tx.employeeProjectLoanEntry.create({ data: { loanAccountId: account.id, sequenceNo: sequences[0]!.nextSequenceNo, entryType: "disbursement", amountCents, balanceDeltaCents: amountCents, sourceExpenseClaimId: claim.id, occurredAt: paidAt, createdByUserId: actorUserId, voucherFileId, paymentMethod, note: optionalText(input.note) } });
      const fundedAmountCents = account.fundedAmountCents + amountCents;
      const balanceAmountCents = account.balanceAmountCents + amountCents;
      await tx.employeeProjectLoanAccount.update({ where: { id: account.id }, data: { fundedAmountCents, balanceAmountCents } });
      const claimFundedAmountCents = claim.fundedAmountCents + amountCents;
      const claimStatus = claimFundedAmountCents === claim.requestedAmountCents ? "disbursed" : "partially_disbursed";
      await tx.expenseClaim.update({ where: { id: claim.id }, data: { fundedAmountCents: claimFundedAmountCents, status: claimStatus } });
      await this.audit.record(tx, { actorUserId, action: "expense_claim.loan.disbursement.record", businessType: "expense_claim", businessId: claim.id, metadata: { loanAccountId: account.id, loanEntryId: entry.id, amountCents: amountCents.toString(), voucherFileId, paymentMethod } });
      return { id: entry.id, expenseClaimId: claim.id, loanAccountId: account.id, amountCents: moneyCentsToApi(amountCents), fundedAmountCents: moneyCentsToApi(claimFundedAmountCents), status: claimStatus };
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
    if (claim.claimType !== "reimbursement" && claim.claimType !== "loan") throw new BadRequestException("费用业务类型不正确");
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
