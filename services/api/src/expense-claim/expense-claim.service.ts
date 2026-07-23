import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { RoleKey } from "@jiangkong/shared-domain";
import { AuditService } from "../audit/audit.service";
import { BusinessNumberingService } from "../business-number/business-numbering.service";
import { PrismaService } from "../database/prisma.service";
import { moneyCentsToApi, parseMoneyCentsInput } from "../money/decimal-money";
import type { CreateExpenseClaimDto, ExpenseClaimLineDto } from "./dto/create-expense-claim.dto";

type ExpenseClaimApprovalNode = {
  name: string;
  mode: "any";
  roleKeys: RoleKey[];
  candidateUserIds?: string[];
};

const COMPREHENSIVE_ROLE: RoleKey = "comprehensive_director";
const FINAL_ROLES: RoleKey[] = ["chairman", "general_manager"];

@Injectable()
export class ExpenseClaimService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: BusinessNumberingService,
    private readonly audit: AuditService
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
      const nodes = this.approvalNodes(claim.claimType, claim.projectId, claim.factWitnessUserId);
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

  private approvalNodes(claimType: string, projectId: string | null, factWitnessUserId: string | null): ExpenseClaimApprovalNode[] {
    if (claimType !== "reimbursement" && claimType !== "loan") throw new BadRequestException("费用业务类型不正确");
    const witnessNode = projectId
      ? { name: "项目经理", mode: "any" as const, roleKeys: ["project_manager" as RoleKey] }
      : { name: "事实证明人", mode: "any" as const, roleKeys: [] as RoleKey[], candidateUserIds: factWitnessUserId ? [factWitnessUserId] : [] };
    return [
      { name: "综合部主管", mode: "any", roleKeys: [COMPREHENSIVE_ROLE] },
      witnessNode,
      { name: "财务主管", mode: "any", roleKeys: ["finance_director"] },
      { name: "董事长/总经理", mode: "any", roleKeys: FINAL_ROLES }
    ];
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
