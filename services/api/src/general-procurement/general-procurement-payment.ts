import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { PrismaService } from "../database/prisma.service";
import type { CreateExpenseClaimDto } from "../expense-claim/dto/create-expense-claim.dto";
import { generalProcurementActor } from "./general-procurement-access";

export function procurementPaymentFingerprint(input: CreateExpenseClaimDto, actorUserId: string) {
  return createHash("sha256").update(JSON.stringify([actorUserId, input.generalProcurementId, input.actualPurchaseBatchId ?? null, input.claimType, input.incidentalExpenseCategory,
    input.projectId, input.companyEntityId, input.reason.trim(), input.requestedAmountCents,
    input.paymentMethod?.trim() || null, input.payeeName?.trim() || null, input.payeeAccountName?.trim() || null,
    input.payeeBankName?.trim() || null, input.payeeBankAccount?.trim() || null])).digest("hex");
}

export async function prepareProcurementPayment(
  tx: Prisma.TransactionClient,
  prisma: PrismaService,
  actorUserId: string,
  input: CreateExpenseClaimDto,
  amount: bigint,
  assertBatchCommit?: (tx: Prisma.TransactionClient, input: { batchId: string; amountCents: bigint }) => Promise<void>
) {
  const id = input.generalProcurementId;
  if (!id) {
    if (input.actualPurchaseBatchId) throw new BadRequestException("实际采购批次付款必须关联原综合采购申请");
    if (input.generalProcurementRequestKey || input.incidentalExpenseCategory?.startsWith("procurement_")) throw new BadRequestException("综合采购付款必须从已归档的申请发起");
    return null;
  }
  if (input.actualPurchaseBatchId) {
    if (input.claimType !== "incidental_expense" || !input.projectId?.trim()) throw new BadRequestException("综合采购批次付款请使用零星费用并选择项目");
    if (!input.generalProcurementRequestKey) throw new BadRequestException("请从实际采购批次发起付款并携带请款提交标识");
    const batch = await tx.actualPurchaseBatch.findUnique({ where: { id: input.actualPurchaseBatchId } });
    if (!batch || batch.kind !== "general" || batch.procurementId !== id) throw new BadRequestException("实际采购批次不属于该综合采购申请");
    if (batch.status === "voided") throw new ConflictException("实际采购批次已作废，不能发起付款");
    if (batch.projectId !== input.projectId || batch.companyEntityId !== input.companyEntityId) throw new BadRequestException("付款项目或费用承担公司必须与实际采购批次一致");
    if ((input.applicantUserId && input.applicantUserId !== actorUserId) || input.lines) throw new BadRequestException("综合采购批次付款请使用当前综合部经办人及采购原始资料");
    const position = await tx.position.findUnique({ where: { key: "comprehensive_director" }, select: { id: true } });
    const director = position
      ? await tx.userPosition.findFirst({ where: { userId: actorUserId, projectId: null, positionId: position.id }, select: { id: true } })
      : null;
    if (!director) throw new ForbiddenException("综合采购付款由公司综合部主管统一发起");
    const fingerprint = procurementPaymentFingerprint(input, actorUserId);
    const existingBatchClaim = await tx.expenseClaim.findUnique({ where: { generalProcurementRequestKey: input.generalProcurementRequestKey } });
    if (existingBatchClaim) {
      if (existingBatchClaim.generalProcurementFingerprint !== fingerprint) throw new ConflictException("重复请款内容不一致，请刷新后核对");
      return { fingerprint, existing: existingBatchClaim };
    }
    if (!assertBatchCommit) throw new ConflictException("实际采购批次容量校验未启用，请联系管理员核对");
    await assertBatchCommit(tx, { batchId: batch.id, amountCents: amount });
    return { fingerprint, existing: null };
  }
  if (input.claimType !== "incidental_expense" || !input.generalProcurementRequestKey) throw new BadRequestException("请从综合采购申请重新发起付款");
  const actor = await generalProcurementActor(tx, new ProjectVisibilityService(prisma), actorUserId, input.projectId ?? "");
  if (!actor.globalRoleKeys.includes("comprehensive_director")) throw new ForbiddenException("综合采购付款由公司综合部主管统一发起");
  if ((input.applicantUserId && input.applicantUserId !== actorUserId) || input.applicantName || input.applicantPhone || input.factWitnessUserId || input.loanExpectedClearanceOn || input.lines) throw new BadRequestException("综合采购付款请使用当前综合部经办人及采购原始资料");
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "GeneralProcurement" WHERE "id" = ${id} FOR UPDATE`);
  const source = await tx.generalProcurement.findUnique({ where: { id } });
  if (!source || source.status !== "archived") throw new ConflictException("采购申请完成审批并由综合部归档后才能请款");
  if (source.requestProtocolVersion !== 1 || source.requestedAmountCents == null || source.projectId == null || source.companyEntityId == null) throw new ConflictException("请从实际采购记录办理后续付款");
  if (source.projectId !== input.projectId || source.companyEntityId !== input.companyEntityId || `procurement_${source.category}` !== input.incidentalExpenseCategory) throw new BadRequestException("请款项目、费用承担公司和类别必须与采购申请一致");
  const fingerprint = procurementPaymentFingerprint(input, actorUserId);
  const deleted = await tx.auditLog.findFirst({ where: { action: "expense_claim.draft.delete", metadata: { path: ["requestKey"], equals: input.generalProcurementRequestKey } }, select: { id: true } });
  if (deleted) throw new ConflictException("此付款草稿已删除，请重新发起请款");
  const existing = await tx.expenseClaim.findUnique({ where: { generalProcurementRequestKey: input.generalProcurementRequestKey } });
  if (existing) {
    if (existing.generalProcurementFingerprint !== fingerprint) throw new ConflictException("重复请款内容不一致，请刷新后核对");
    return { fingerprint, existing };
  }
  const reserved = await tx.expenseClaim.aggregate({ where: { generalProcurementId: id, status: { not: "rejected" } }, _sum: { requestedAmountCents: true } });
  if ((reserved._sum.requestedAmountCents ?? 0n) + amount > source.requestedAmountCents) throw new ConflictException("累计请款金额超过采购批准金额，请刷新后核对剩余额度");
  return { fingerprint, existing: null };
}
