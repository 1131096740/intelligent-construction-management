import { chinaDateOnly } from "@jiangkong/shared-domain";
import { readRegisteredCompanyOwnedSources } from "./registered-company-owned-fund-source";
import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { currentPublicCashCustodian } from "./public-cash-custodian";
import { parseMoneyCentsInput } from "../money/decimal-money";
import { assertRegisteredPaymentActor, availableRegisteredBalance, RegisteredBalanceDecimal } from "../payment/registered-payment-funding";

export interface RegisteredOperationalFunding {
  scopeKey: string;
  expectedRegistrationId: string;
  sourceAllocations: Array<{ sourceBatchId: string; amountCents: string }>;
}

export type OperationalPaymentSource = "expense_claim_payment_execution" | "spot_procurement_payment_execution";

interface OperationalPayment {
  sourceType: OperationalPaymentSource;
  executionId: string;
  actorUserId: string;
  projectId: string | null;
  originalDebtorCompanyId: string | null;
  amountCents: bigint;
  paidAt: Date;
}

function executionReference(input: Pick<OperationalPayment, "sourceType" | "executionId">) {
  return input.sourceType === "expense_claim_payment_execution"
    ? { expenseExecutionId: input.executionId }
    : { spotExecutionId: input.executionId };
}

function validateFunding(input: OperationalPayment, funding: RegisteredOperationalFunding) {
  const lines = funding.sourceAllocations.map(line => ({
    sourceBatchId: line.sourceBatchId, amountCents: parseMoneyCentsInput(line.amountCents, "金额", "请填写有效的资金来源金额"),
  })).sort((a, b) => a.sourceBatchId.localeCompare(b.sourceBatchId));
  if (new Set(lines.map(line => line.sourceBatchId)).size !== lines.length ||
      lines.some(line => line.amountCents <= 0n) ||
      lines.reduce((sum, line) => sum + line.amountCents, 0n) !== input.amountCents) {
    throw new BadRequestException("资金来源必须逐笔明确，合计等于实际付款金额");
  }
  const payloadFingerprint = createHash("sha256").update(JSON.stringify([
    input.sourceType, input.executionId, input.actorUserId, input.projectId, input.originalDebtorCompanyId,
    input.amountCents.toString(), input.paidAt.toISOString(), funding.scopeKey, funding.expectedRegistrationId,
    lines.map(line => [line.sourceBatchId, line.amountCents.toString()]),
  ])).digest("hex");
  return { lines, payloadFingerprint };
}

type StoredOperationalPayer = { id: string; actualPayerCompanyId: string | null; originalDebtorCompanyId: string };
type CompanyOperationalPayment = { actualPayerCompanyId: string; relationshipEntryId: string | null };
type CashOperationalPayment = { actualPayerKind: "public_cash"; actualPayerCompanyId: null; relationshipEntryId: null };
type OperationalPaymentResult = CompanyOperationalPayment | CashOperationalPayment;
type SpotOperationalPayment = OperationalPayment & { sourceType: "spot_procurement_payment_execution" };

function result(row: StoredOperationalPayer): OperationalPaymentResult {
  if (row.actualPayerCompanyId === null) {
    return { actualPayerKind: "public_cash", actualPayerCompanyId: null, relationshipEntryId: null };
  }
  return {
    actualPayerCompanyId: row.actualPayerCompanyId,
    relationshipEntryId: row.actualPayerCompanyId !== row.originalDebtorCompanyId ? row.id : null,
  };
}

export function observeRegisteredOperationalPaymentSource(
  tx: Prisma.TransactionClient, input: Pick<OperationalPayment, "sourceType" | "executionId">,
) {
  return tx.registeredOperationalPayment.findUnique({ where: executionReference(input), select: {
    id: true, actualPayerCompanyId: true, actualPayerName: true, originalDebtorCompanyId: true,
  } });
}

export function readRegisteredOperationalPayment(
  tx: Prisma.TransactionClient, input: SpotOperationalPayment & { funding?: RegisteredOperationalFunding },
): Promise<CompanyOperationalPayment | null>;
export function readRegisteredOperationalPayment(
  tx: Prisma.TransactionClient, input: OperationalPayment & { funding?: RegisteredOperationalFunding },
): Promise<OperationalPaymentResult | null>;
export async function readRegisteredOperationalPayment(
  tx: Prisma.TransactionClient, input: OperationalPayment & { funding?: RegisteredOperationalFunding },
) {
  const row = await tx.registeredOperationalPayment.findUnique({ where: executionReference(input) });
  if (!row && !input.funding) return null;
  if (!row || (input.sourceType === "spot_procurement_payment_execution" && row.actualPayerCompanyId === null) ||
      !input.funding || validateFunding(input, input.funding).payloadFingerprint !== row.payloadFingerprint) {
    throw new ConflictException("原实付记录的资金凭据与本次提交不同，请查询原实付结果");
  }
  return result(row);
}

export function appendRegisteredOperationalPayment(
  tx: Prisma.TransactionClient, input: SpotOperationalPayment & { funding: RegisteredOperationalFunding },
): Promise<CompanyOperationalPayment>;
export function appendRegisteredOperationalPayment(
  tx: Prisma.TransactionClient, input: OperationalPayment & { funding: RegisteredOperationalFunding },
): Promise<OperationalPaymentResult>;
export async function appendRegisteredOperationalPayment(
  tx: Prisma.TransactionClient, input: OperationalPayment & { funding: RegisteredOperationalFunding },
) {
  const { projectId, originalDebtorCompanyId, funding, actorUserId, paidAt } = input;
  if (!projectId || !originalDebtorCompanyId) throw new ConflictException("项目或原债务公司尚未明确，请核对原单");
  const { lines, payloadFingerprint } = validateFunding(input, funding);
  const roles = await assertRegisteredPaymentActor(tx, actorUserId);
  const account = await tx.registeredFundAccount.findUnique({ where: { scopeKey: funding.scopeKey }, include: { company: true } });
  const isPublicCash = input.sourceType === "expense_claim_payment_execution" && funding.scopeKey === "public_cash";
  const company = account?.company;
  if (!account || (isPublicCash
    ? account.kind !== "public_cash" || account.companyEntityId !== null
    : account.kind !== "company" || !company?.isActive || !company.unifiedSocialCreditCode)) {
    throw new ConflictException(isPublicCash ? "公共现金账户尚未核对登记" : "请选择具有有效法人资料的登记公司账户");
  }
  await tx.$queryRaw(Prisma.sql`SELECT id FROM public."RegisteredFundAccount" WHERE id = ${account.id} FOR UPDATE`);
  if (isPublicCash && (!roles.includes("comprehensive_director") ||
    await currentPublicCashCustodian(tx, account.id) !== actorUserId)) {
    throw new ForbiddenException("只有当前具名公共现金保管人可以登记本笔付款");
  }
  const current = await tx.fundAccountBalanceRegistration.findFirst({
    where: { accountId: account.id, status: "confirmed" }, orderBy: { version: "desc" }, include: { sources: true },
  });
  if (!current || current.id !== funding.expectedRegistrationId) throw new ConflictException("登记余额版本已变化，请核对原实付结果并刷新");
  if (chinaDateOnly(paidAt) <= current.asOfDate) {
    throw new ConflictException("所选登记余额已覆盖付款日期，请先核对历史实付，避免再次扣减");
  }
  const available = await availableRegisteredBalance(tx, current);
  const amountYuan = new RegisteredBalanceDecimal(input.amountCents.toString()).div(100);
  if (available.balanceYuan === null || available.balanceYuan.lt(amountYuan) ||
      available.heldTransferAllocations.some(hold => hold.candidateSourceIds.length !== 1)) {
    throw new ConflictException("实际付款账户余额不足或待核对");
  }
  const debit = new Map(lines.map(line => [line.sourceBatchId, new RegisteredBalanceDecimal(line.amountCents.toString()).div(100)]));
  const unassigned = company && company.id !== originalDebtorCompanyId
    ? available.sources.filter(source => debit.has(source.id) && source.projectStatus !== "project").map(source => source.id) : [];
  const provenOwned = await readRegisteredCompanyOwnedSources(tx, unassigned);
  for (const [sourceBatchId, amount] of debit) {
    const source = available.sources.find(item => item.id === sourceBatchId);
    const eligible = source && (source.projectStatus === "project" ? source.projectId === projectId :
      isPublicCash ? source.projectStatus === "pending" : provenOwned.get(source.id) === company?.id);
    if (!source || !eligible || source.amountYuan.lt(amount) ||
        available.pendingAllocations.some(pending => pending.candidateSourceIds.includes(sourceBatchId))) {
      throw new ConflictException("所选项目资金来源余额不足或待核对");
    }
  }
  await tx.registeredFundAccount.update({ where: { id: account.id }, data: { writeRevision: { increment: 1 } } });
  const id = randomUUID();
  const latest = await tx.fundAccountBalanceRegistration.findFirstOrThrow({ where: { accountId: account.id }, orderBy: { version: "desc" } });
  const registration = await tx.fundAccountBalanceRegistration.create({ data: {
    kind: "operational_payment", status: "confirmed", accountId: account.id, previousRegistrationId: current.id,
    version: latest.version + 1, balanceYuan: new RegisteredBalanceDecimal(current.balanceYuan!.toFixed(4)).minus(amountYuan),
    coveredExecutionIds: current.coveredExecutionIds, asOfDate: current.asOfDate,
    evidenceReference: input.executionId, reconciliationNote: "按原业务实际付款来源扣减", reason: "登记资金实际付款",
    idempotencyKey: `operational-payment:${id}`, payloadFingerprint,
    createdByUserId: actorUserId, confirmedByUserId: actorUserId, confirmedAt: new Date(),
  } });
  await tx.fundAccountSourceBatch.createMany({ data: current.sources.map(source => ({
    registrationId: registration.id, lineNo: source.lineNo, previousSourceBatchId: source.id, sourceStatus: source.sourceStatus,
    sourceName: source.sourceName, projectStatus: source.projectStatus, projectId: source.projectId,
    amountYuan: new RegisteredBalanceDecimal(source.amountYuan.toFixed(4)).minus(debit.get(source.id) ?? 0),
  })) });
  const row = await tx.registeredOperationalPayment.create({ data: {
    id, ...executionReference(input), accountId: account.id, registrationId: registration.id,
    previousRegistrationId: current.id, actualPayerCompanyId: isPublicCash ? null : company!.id, originalDebtorCompanyId,
    actualPayerName: isPublicCash ? "公共现金" : company!.name, projectId, actorUserId, amountCents: input.amountCents, paidAt, payloadFingerprint,
    allocations: { create: lines },
  } });
  await tx.$executeRaw`SET CONSTRAINTS public."RegisteredOperationalPayment_conservation", public."FundAccountBalanceRegistration_operational_payment" IMMEDIATE`;
  return result(row);
}
