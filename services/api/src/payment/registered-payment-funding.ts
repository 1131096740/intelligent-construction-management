import { registeredPaymentWriteAuthority } from "./registered-payment-approval";
import { chinaDateOnly } from "@jiangkong/shared-domain";
import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { CompanyRoleResolverService } from "../auth/company-role-resolver.service";
import { parseMoneyCentsInput } from "../money/decimal-money";
import type { PrismaService } from "../database/prisma.service";
import type { confirmRegisteredContractHistory } from "./registered-payment-contract-history";
import type { RecordRegisteredPaymentExecutionDto } from "./dto/record-registered-payment-execution.dto";

/** Server-only scope: real Project row and native DATE under a transaction lock.
 * NULL means explicitly unenabled, never a missing row or caller exemption. */
export async function lockRegisteredOperatingScope(tx: Prisma.TransactionClient, projectId: string): Promise<Date|null> {
  const rows=await tx.$queryRaw<Array<{projectId:string;effectiveDate:Date|null}>>(Prisma.sql`SELECT * FROM public."jg_registered_operating_scope_lock"(${projectId})`);
  const scope=rows[0];
  if(rows.length!==1 || scope?.projectId!==projectId || (scope.effectiveDate!==null && (!(scope.effectiveDate instanceof Date) || !Number.isFinite(scope.effectiveDate.getTime())))) throw new ConflictException("项目资金办理范围尚未准备，请保留填写并核对项目资料");
  return scope.effectiveDate;
}

function positiveMoneyCents(value: string, message: string) {
  const amount = parseMoneyCentsInput(value, "金额", message);
  if (amount <= 0n) throw new BadRequestException(message);
  return amount;
}

export async function assertRegisteredPaymentActor(tx: Prisma.TransactionClient, actorUserId: string) {
  let roles;
  try { roles = await new CompanyRoleResolverService(tx as PrismaService).resolveActiveRoleScopesInTransaction(tx, actorUserId); }
  catch { throw new ForbiddenException("当前付款登记账号或公司岗位不可用"); }
  if (!roles.some(role => ["finance_staff", "finance_director", "comprehensive_director"].includes(role))) throw new ForbiddenException("只有当前财务人员或综合部主管可以办理实际付款");
}

export function registeredPaymentFingerprint(paymentId: string, actorUserId: string, input: RecordRegisteredPaymentExecutionDto) {
  return createHash("sha256").update(JSON.stringify({ paymentId, actorUserId, amountCents: input.amountCents, paidAt: input.paidAt,
    scopeKey: input.scopeKey, registrationId: input.expectedRegistrationId, openingTreatment: input.openingTreatment,
    reason: input.openingReason.trim(), evidence: input.openingEvidence.trim(),
    allocations: [...input.sourceAllocations].sort((a,b) => a.sourceBatchId.localeCompare(b.sourceBatchId)),
    ...(input.contractHistoryConfirmation ? {contractHistoryConfirmation:{
      treatment:input.contractHistoryConfirmation.treatment,expectedFingerprint:input.contractHistoryConfirmation.expectedFingerprint,
      reason:input.contractHistoryConfirmation.reason.trim(),evidence:input.contractHistoryConfirmation.evidence.trim()
    }} : {}) })).digest("hex");
}

/** Reads the same formal source postings used by execution validation and the account page. */
export async function availableRegisteredBalance(tx: Prisma.TransactionClient, registration: Prisma.FundAccountBalanceRegistrationGetPayload<{ include: { sources: true } }>) {
  const covered = new Set(registration.coveredExecutionIds ?? []);
  const allocations = (await tx.registeredFundPaymentAllocation.findMany({ where: { accountId: registration.accountId } })).filter(row=>!covered.has(row.executionId));
  const paidCents = allocations.reduce((sum, row) => sum + row.amountCents, 0n);
  const registrations = await tx.fundAccountBalanceRegistration.findMany({ where: { accountId: registration.accountId }, select: { id: true } });
  const lineage = await tx.fundAccountSourceBatch.findMany({ where: { registrationId: { in: registrations.map(row=>row.id) } } });
  const isDescendant = (sourceId: string, ancestorId: string) => {
    const visited = new Set<string>();
    let next: string | null = sourceId;
    while (next && !visited.has(next)) {
      if (next === ancestorId) return true;
      visited.add(next);
      next = lineage.find(row=>row.id===next)?.previousSourceBatchId ?? null;
    }
    return false;
  };
  const paidBySource = new Map<string,bigint>();
  const pendingAllocations: Array<{executionId:string;amountCents:bigint;originalSourceBatchId:string;candidateSourceIds:string[]}> = [];
  for (const allocation of allocations) {
    const descendants = registration.sources.filter(source=>isDescendant(source.id,allocation.sourceBatchId));
    if (descendants.length !== 1) {
      pendingAllocations.push({executionId:allocation.executionId,amountCents:allocation.amountCents,originalSourceBatchId:allocation.sourceBatchId,candidateSourceIds:(descendants.length ? descendants : registration.sources).map(row=>row.id)});
      continue;
    }
    const sourceId = descendants[0].id;
    paidBySource.set(sourceId,(paidBySource.get(sourceId)??0n)+allocation.amountCents);
  }
  return { ...registration, pendingAllocations,
    balanceYuan: registration.balanceYuan === null ? null : registration.balanceYuan.minus(new Prisma.Decimal(paidCents.toString()).div(100)),
    sources: registration.sources.map(source => ({ ...source, amountYuan: source.amountYuan.minus(new Prisma.Decimal((paidBySource.get(source.id)??0n).toString()).div(100)) })) };

}

export async function prepareRegisteredFunding(tx: Prisma.TransactionClient, actorUserId: string, payment: { id: string; projectId: string; companyEntityIdSnapshot: string | null; companyEntityNameSnapshot: string | null; companyEntityCreditCodeSnapshot: string | null }, input: RecordRegisteredPaymentExecutionDto, historyRevision:bigint) {
  await assertRegisteredPaymentActor(tx, actorUserId);
  const writeAuthority=await registeredPaymentWriteAuthority(tx,payment.id,historyRevision);
  if (!input.openingReason.trim() || !input.openingEvidence.trim()) throw new BadRequestException("请填写期初归属确认原因和核对依据");
  const account = await tx.registeredFundAccount.findUnique({ where: { scopeKey: input.scopeKey } });
  if (!account) throw new ConflictException("资金账户尚未核对登记，请刷新资金资料");
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "RegisteredFundAccount" WHERE "id" = ${account.id} FOR UPDATE`);
  const current = await tx.fundAccountBalanceRegistration.findFirst({ where: { accountId: account.id, status: "confirmed" }, orderBy: { version: "desc" }, include: { sources: true } });
  if (!current || current.id !== input.expectedRegistrationId) throw new ConflictException("余额核对版本已变化，请刷新资金资料后重新确认期初归属");
  const available = await availableRegisteredBalance(tx, current);
  const amountCents = positiveMoneyCents(input.amountCents, "实付金额必须大于0");
  const allocations = input.sourceAllocations.map(line => ({ ...line, amount: positiveMoneyCents(line.amountCents, "来源分摊金额必须大于0") }));
  if (input.openingTreatment === "not_included") {
    if (available.balanceYuan === null) throw new ConflictException("资金余额尚未核对，不能将未知余额当作0或可用余额");
    if (available.balanceYuan.lt(new Prisma.Decimal(amountCents.toString()).div(100))) throw new ConflictException("登记资金余额不足，请核对实际资金");
    if (new Set(allocations.map(line=>line.sourceBatchId)).size !== allocations.length || allocations.reduce((sum,line)=>sum+line.amount,0n) !== amountCents) throw new BadRequestException("来源分摊必须逐笔明确且合计等于实付金额，不能自动分配来源");
    for (const line of allocations) {
      if (available.pendingAllocations.some(row=>row.candidateSourceIds.includes(line.sourceBatchId))) throw new ConflictException("所选来源可用分摊待核对，不能用核对原值或0代替可用余额");
      const source = available.sources.find(row=>row.id===line.sourceBatchId);
      if (!source || source.amountYuan.lt(new Prisma.Decimal(line.amount.toString()).div(100))) throw new ConflictException("所选来源可用余额不足，请重新核对来源");
      if (source.projectStatus === "project" && source.projectId !== payment.projectId) throw new ConflictException("所选来源的项目归属不足，差额须先由业务确认，不能自动形成垫资到账");
      if (source.projectStatus === "company_daily") throw new ConflictException("所选来源属于公司日常，请先明确此次项目付款的资金归属");
    }
  } else if (allocations.length) throw new BadRequestException("已含期初的历史实付不再分摊扣减当前资金来源");
  const company = account.companyEntityId ? await tx.companyEntity.findUnique({where:{id:account.companyEntityId}}) : null;
  if (account.kind === "company" && !company) throw new ConflictException("登记资金的我方公司档案不存在，请核对原资金资料");
  if (company?.isActive === false && company.id !== payment.companyEntityIdSnapshot) throw new ConflictException("停用公司不能新选为代付主体，请核对原单冻结付款主体");
  if (company?.isActive === false && (!payment.companyEntityNameSnapshot || !payment.companyEntityCreditCodeSnapshot)) throw new ConflictException("停用公司原单冻结主体资料不完整，请核对历史依据");
  // Keep original request/history/contract/settlement/account locks before the
  // strongest Project lock; acquire it before any financial CAS or fact write.
  const operatingLedgerEffectiveDateAtRegistration = await lockRegisteredOperatingScope(tx,payment.projectId);
  const touched = await tx.registeredFundAccount.updateMany({where:{id:account.id,writeRevision:account.writeRevision},data:{writeRevision:account.writeRevision+1}});
  if (touched.count !== 1) throw new ConflictException("资金登记已变化，请先查询原请求结果并刷新后重试");

  const actualPayer = account.kind === "public_cash" ? { kind: "public_cash", id: "public_cash", snapshot: { kind: "public_cash", scopeKey: "public_cash" } }
    : { kind: "participating_company", id: company!.id, snapshot: { kind: "participating_company", companyEntityId: company!.id, name: company!.isActive === false ? payment.companyEntityNameSnapshot : company!.name, creditCode: company!.isActive === false ? payment.companyEntityCreditCodeSnapshot : company!.unifiedSocialCreditCode ?? null } };
  return { account, current, allocations, actualPayer, writeAuthority, operatingLedgerEffectiveDateAtRegistration, fingerprint: registeredPaymentFingerprint(payment.id, actorUserId, input) };
}

export async function appendRegisteredFunding(tx: Prisma.TransactionClient, executionId: string, context: Awaited<ReturnType<typeof prepareRegisteredFunding>>, input: RecordRegisteredPaymentExecutionDto, contractHistoryConfirmation: Awaited<ReturnType<typeof confirmRegisteredContractHistory>>) {
  await tx.registeredPaymentFunding.create({ data: { executionId, operatingLedgerEffectiveDateAtRegistration:context.operatingLedgerEffectiveDateAtRegistration, accountId: context.account.id, balanceRegistrationId: context.current.id,
    actualPayerKind: context.actualPayer.kind, actualPayerId: context.actualPayer.id, actualPayerSnapshot: context.actualPayer.snapshot,
    ...(contractHistoryConfirmation ? {contractHistoryConfirmation} : {}),
    openingTreatment: input.openingTreatment, openingReason: input.openingReason.trim(), openingEvidence: input.openingEvidence.trim(), payloadFingerprint: context.fingerprint } });
  for (const line of context.allocations) await tx.registeredFundPaymentAllocation.create({ data: { id: randomUUID(), executionId, accountId: context.account.id, sourceBatchId: line.sourceBatchId, amountCents: line.amount } });
  await tx.registeredPaymentEvent.create({ data: { executionId, payload: { executionId, accountId: context.account.id, balanceRegistrationId: context.current.id, writeAuthority:context.writeAuthority } } });
}

/** Public account/review projections retain the canonical payment identity. */
export async function registeredPaymentSummaries(tx: Prisma.TransactionClient, filter: {accountIds: string[]} | {executionIds: string[]}) {
  const receipts = await tx.registeredPaymentFunding.findMany({where:"accountIds" in filter ? {accountId:{in:filter.accountIds}} : {executionId:{in:filter.executionIds}}});
  if (!receipts.length) return [];
  const facts = await tx.paymentExecution.findMany({where:{id:{in:receipts.map(row=>row.executionId)}}});
  const requests = await tx.paymentRequest.findMany({where:{id:{in:facts.map(row=>row.paymentRequestId)}}});
  const actors = await tx.user.findMany({where:{id:{in:facts.map(row=>row.executedByUserId)}},select:{id:true,name:true}});
  return receipts.flatMap(receipt=>{
    const fact = facts.find(row=>row.id===receipt.executionId);
    if (!fact) return [];
    return [{accountId:receipt.accountId,executionId:fact.id,paymentId:fact.paymentRequestId,code:requests.find(row=>row.id===fact.paymentRequestId)?.code??"原付款单",amountCents:fact.amountCents.toString(),amountYuan:new Prisma.Decimal(fact.amountCents.toString()).div(100).toFixed(2),paidAt:chinaDateOnly(fact.paidAt),registeredByName:actors.find(row=>row.id===fact.executedByUserId)?.name??"原登记人",openingEvidence:receipt.openingEvidence}];
  });
}


/** Same execution creates the existing formal inter-company consequence once. */
export async function appendRegisteredIntercompany(tx: Prisma.TransactionClient, executionId: string, actorUserId: string, payment: {projectId:string;contractId:string;contractVersionId:string;companyEntityIdSnapshot:string|null;companyEntityNameSnapshot:string|null;companyEntityCreditCodeSnapshot:string|null}, context: Awaited<ReturnType<typeof prepareRegisteredFunding>>, amountCents: bigint) {
  const creditorId=context.account.companyEntityId;
  if (!creditorId || creditorId===payment.companyEntityIdSnapshot) return;
  if (!payment.companyEntityIdSnapshot || !payment.companyEntityNameSnapshot) throw new ConflictException("原债务公司冻结身份不完整，不能登记跨公司实际付款");
  const debtor={companyEntityId:payment.companyEntityIdSnapshot,name:payment.companyEntityNameSnapshot,creditCode:payment.companyEntityCreditCodeSnapshot};
  await tx.interEntityRelationshipEntry.create({data:{id:randomUUID(),entryKind:"proxy_payment",direction:"increase",status:"confirmed",paymentExecutionId:executionId,
    originalDebtorCompanyId:payment.companyEntityIdSnapshot,creditorCompanyId:creditorId,approvedPayerCompanyId:payment.companyEntityIdSnapshot,
    debtorSnapshot:debtor,approvedPayerSnapshot:debtor,creditorSnapshot:context.actualPayer.snapshot,amountCents,currencyCode:"CNY",evidenceFileId:null,
    projectId:payment.projectId,contractId:payment.contractId,contractVersionId:payment.contractVersionId,sourceType:"registered_payment_execution",sourceAggregateId:executionId,
    sourceAllocationCount:1,sourceAllocationAmountCents:amountCents,reason:"按已实际支付的登记资金容器确认我方公司代付，原付款只计一次",
    idempotencyKey:`registered-payment:${executionId}:intercompany`,payloadFingerprint:context.fingerprint,createdByUserId:actorUserId,confirmedByUserId:actorUserId,confirmedAt:new Date()}});
}
