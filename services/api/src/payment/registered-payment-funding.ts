import { assertPublicCashCustodian } from "../fund-account/public-cash-custodian";
import { confirmedProjectAdvancePayload, planRegisteredProjectAdvance, registeredProjectAdvanceReceiptStatus, type ConfirmedProjectAdvance } from "./registered-payment-project-advance";
import { readRegisteredCompanyOwnedSources } from "../fund-account/registered-company-owned-fund-source";
import { FUND_ACCOUNT_TRANSFER_HELD_STATES } from "../fund-account/fund-account-transfer-state";
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
  return roles;
}

export function registeredPaymentFingerprint(paymentId: string, actorUserId: string, input: Omit<RecordRegisteredPaymentExecutionDto, "confirmationPassword">) {
  return createHash("sha256").update(JSON.stringify({ paymentId, actorUserId, amountCents: input.amountCents, paidAt: input.paidAt,
    scopeKey: input.scopeKey, registrationId: input.expectedRegistrationId, openingTreatment: input.openingTreatment,
    reason: input.openingReason.trim(), evidence: input.openingEvidence.trim(),
    allocations: [...input.sourceAllocations].sort((a,b) => a.sourceBatchId.localeCompare(b.sourceBatchId)),
    ...(input.contractHistoryConfirmation ? {contractHistoryConfirmation:{
      treatment:input.contractHistoryConfirmation.treatment,expectedFingerprint:input.contractHistoryConfirmation.expectedFingerprint,
      reason:input.contractHistoryConfirmation.reason.trim(),evidence:input.contractHistoryConfirmation.evidence.trim()
    }} : {}),
    ...(input.confirmedProjectAdvance ? { confirmedProjectAdvance: confirmedProjectAdvancePayload(input.confirmedProjectAdvance) } : {}) })).digest("hex");
}

type TransferSourceIdentity = {
  sourceStatus: string;
  sourceName: string | null;
  projectStatus: string;
  projectId: string | null;
};

export function sameTransferSourceIdentity(origin: TransferSourceIdentity, current: TransferSourceIdentity): boolean {
  return origin.sourceStatus === current.sourceStatus && origin.sourceName === current.sourceName &&
    origin.projectStatus === current.projectStatus && origin.projectId === current.projectId;
}

export const RegisteredBalanceDecimal = Prisma.Decimal.clone({ precision: 30 });

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
  const heldLines = await tx.registeredFundTransferLine.findMany({
    where: { transfer: { sourceAccountId: registration.accountId, status: { in: [...FUND_ACCOUNT_TRANSFER_HELD_STATES] } } },
    include: { sourceBatch: true }
  });
  const heldBySource = new Map<string, Prisma.Decimal>();
  const heldTransferAllocations = heldLines.map(line => {
    const candidates = registration.sources.filter(source => isDescendant(source.id, line.sourceBatchId));
    const candidateSourceIds = candidates.map(source => source.id);
    if (candidateSourceIds.length === 1) {
      const sourceId = candidateSourceIds[0];
      heldBySource.set(sourceId, (heldBySource.get(sourceId) ?? new RegisteredBalanceDecimal(0)).plus(line.amountYuan));
    }
    return { transferId: line.transferId, amountYuan: line.amountYuan, sourceBatchId: line.sourceBatchId, candidateSourceIds,
      preservesSourceIdentity: candidates.length === 1 && sameTransferSourceIdentity(line.sourceBatch, candidates[0]) };
  });
  const heldYuan = heldLines.reduce((total, line) => total.plus(line.amountYuan), new RegisteredBalanceDecimal(0));
  return { ...registration, pendingAllocations, heldTransferAllocations,
    balanceYuan: registration.balanceYuan === null ? null : new RegisteredBalanceDecimal(registration.balanceYuan.toFixed(4)).minus(new RegisteredBalanceDecimal(paidCents.toString()).div(100)).minus(heldYuan),
    sources: registration.sources.map(source => ({ ...source, amountYuan: new RegisteredBalanceDecimal(source.amountYuan.toFixed(4)).minus(new RegisteredBalanceDecimal((paidBySource.get(source.id)??0n).toString()).div(100)).minus(heldBySource.get(source.id) ?? 0) })) };

}

export async function prepareRegisteredFunding(tx: Prisma.TransactionClient, actorUserId: string, payment: { id: string; projectId: string; companyEntityIdSnapshot: string | null; companyEntityNameSnapshot: string | null; companyEntityCreditCodeSnapshot: string | null }, input: RecordRegisteredPaymentExecutionDto, historyRevision:bigint) {
  const roles = await assertRegisteredPaymentActor(tx, actorUserId);
  const writeAuthority=await registeredPaymentWriteAuthority(tx,payment.id,historyRevision);
  if (!input.openingReason.trim() || !input.openingEvidence.trim()) throw new BadRequestException("请填写期初归属确认原因和核对依据");
  const account = await tx.registeredFundAccount.findUnique({ where: { scopeKey: input.scopeKey } });
  if (!account) throw new ConflictException("资金账户尚未核对登记，请刷新资金资料");
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "RegisteredFundAccount" WHERE "id" = ${account.id} FOR UPDATE`);
  if (account.kind === "public_cash" && !roles.some(role => role === "finance_staff" || role === "finance_director")) {
    await assertPublicCashCustodian(tx, account.id, actorUserId);
  }
  const current = await tx.fundAccountBalanceRegistration.findFirst({ where: { accountId: account.id, status: "confirmed" }, orderBy: { version: "desc" }, include: { sources: true } });
  if (!current || current.id !== input.expectedRegistrationId) throw new ConflictException("余额核对版本已变化，请刷新资金资料后重新确认期初归属");
  const available = await availableRegisteredBalance(tx, current);
  const amountCents = positiveMoneyCents(input.amountCents, "实付金额必须大于0");
  const projectAllocations = input.sourceAllocations.map(line => ({ ...line, amount: positiveMoneyCents(line.amountCents, "来源分摊金额必须大于0") }));
  let allocations = projectAllocations;
  let projectAdvance: ReturnType<typeof planRegisteredProjectAdvance> = null;
  let needsMixedFundingFence = false;
  if (input.confirmedProjectAdvance) {
    const companyOwnership = await readRegisteredCompanyOwnedSources(tx, input.confirmedProjectAdvance.sourceAllocations.map(line => line.sourceBatchId));
    projectAdvance = planRegisteredProjectAdvance({
      projectId: payment.projectId, payerCompanyId: account.kind === "company" ? account.companyEntityId : null,
      debtorCompanyId: payment.companyEntityIdSnapshot,
      paidCents: amountCents, openingTreatment: input.openingTreatment, projectAllocations,
      sources: available.sources.map(source => ({ ...source, ownedByCompanyId: companyOwnership.get(source.id) ?? null })),
      confirmed: input.confirmedProjectAdvance
    });
    if (projectAdvance) allocations = [...projectAllocations, ...projectAdvance.companyAllocations];
  }
  if (input.openingTreatment === "not_included") {
    if (available.balanceYuan === null) throw new ConflictException("资金余额尚未核对，不能将未知余额当作0或可用余额");
    if (available.balanceYuan.lt(new Prisma.Decimal(amountCents.toString()).div(100))) throw new ConflictException("登记资金余额不足，请核对实际资金");
    const selectedAmount = allocations.reduce((sum, line) => sum + line.amount, 0n);
    const uniqueLineage = new Set(allocations.map(line => line.sourceBatchId)).size === allocations.length;
    const sources = new Map(available.sources.map(source => [source.id, source]));
    const awaitingReconciliation = (sourceBatchId: string) =>
      available.pendingAllocations.some(row => row.candidateSourceIds.includes(sourceBatchId)) ||
      available.heldTransferAllocations.some(row => row.candidateSourceIds.length !== 1 &&
        (row.candidateSourceIds.length === 0 || row.candidateSourceIds.includes(sourceBatchId)));
    const currentProjectAllocations = allocations.filter(line => {
      const source = sources.get(line.sourceBatchId);
      return source?.projectStatus === "project" && source.projectId === payment.projectId;
    });
    const mixesUnassignedSource = selectedAmount === amountCents && currentProjectAllocations.length > 0 &&
      allocations.some(line => sources.get(line.sourceBatchId)?.projectStatus === "pending") &&
      allocations.every(line => {
        const source = sources.get(line.sourceBatchId);
        return source?.projectStatus === "pending" || (source?.projectStatus === "project" && source.projectId === payment.projectId);
      });
    needsMixedFundingFence = mixesUnassignedSource && account.kind === "company" &&
      account.companyEntityId === payment.companyEntityIdSnapshot;
    if (!projectAdvance && uniqueLineage && account.kind === "company" &&
        (selectedAmount < amountCents || mixesUnassignedSource) && allocations.every(line => {
          const source = sources.get(line.sourceBatchId);
          return source && !awaitingReconciliation(source.id) &&
            !source.amountYuan.lt(new RegisteredBalanceDecimal(line.amount.toString()).div(100));
        })) {
      planRegisteredProjectAdvance({
        projectId: payment.projectId, payerCompanyId: account.companyEntityId, debtorCompanyId: payment.companyEntityIdSnapshot,
        paidCents: amountCents, openingTreatment: input.openingTreatment,
        projectAllocations: mixesUnassignedSource ? currentProjectAllocations : allocations,
        sources: available.sources.map(source => ({ ...source, ownedByCompanyId: null }))
      });
    }
    if (!uniqueLineage || selectedAmount !== amountCents) throw new BadRequestException("来源分摊必须逐笔明确且合计等于实付金额，不能自动分配来源");
    for (const line of allocations) {
      if (awaitingReconciliation(line.sourceBatchId)) throw new ConflictException("所选来源可用分摊待核对，不能用核对原值或0代替可用余额");
      const source = sources.get(line.sourceBatchId);
      if (!source || source.amountYuan.lt(new Prisma.Decimal(line.amount.toString()).div(100))) throw new ConflictException("所选来源可用余额不足，请重新核对来源");
      if (source.projectStatus === "project" && source.projectId !== payment.projectId) throw new ConflictException("所选来源的项目归属不足，差额须先由业务确认，不能自动形成垫资到账");
      if (source.projectStatus === "company_daily") throw new ConflictException("所选来源属于公司日常，请先明确此次项目付款的资金归属");
    }
  } else if (allocations.length) throw new BadRequestException("已含期初的历史实付不再分摊扣减当前资金来源");
  const company = account.companyEntityId ? await tx.companyEntity.findUnique({where:{id:account.companyEntityId}}) : null;
  if (account.kind === "company" && !company) throw new ConflictException("登记资金的我方公司档案不存在，请核对原资金资料");
  if (projectAdvance && !company?.isActive) throw new ConflictException("付款公司档案已停用，不能新确认项目垫资");
  if (company?.isActive === false && company.id !== payment.companyEntityIdSnapshot) throw new ConflictException("停用公司不能新选为代付主体，请核对原单冻结付款主体");
  if (company?.isActive === false && (!payment.companyEntityNameSnapshot || !payment.companyEntityCreditCodeSnapshot)) throw new ConflictException("停用公司原单冻结主体资料不完整，请核对历史依据");
  // Keep original request/history/contract/settlement/account locks before the
  // strongest Project lock; acquire it before any financial CAS or fact write.
  const operatingLedgerEffectiveDateAtRegistration = await lockRegisteredOperatingScope(tx,payment.projectId);
  const touched = await tx.registeredFundAccount.updateMany({where:{id:account.id,writeRevision:account.writeRevision},data:{writeRevision:account.writeRevision+1}});
  if (touched.count !== 1) throw new ConflictException("资金登记已变化，请先查询原请求结果并刷新后重试");

  const actualPayer = account.kind === "public_cash" ? { kind: "public_cash", id: "public_cash", snapshot: { kind: "public_cash", scopeKey: "public_cash" } }
    : { kind: "participating_company", id: company!.id, snapshot: { kind: "participating_company", companyEntityId: company!.id, name: company!.isActive === false ? payment.companyEntityNameSnapshot : company!.name, creditCode: company!.isActive === false ? payment.companyEntityCreditCodeSnapshot : company!.unifiedSocialCreditCode ?? null } };
  return { account, current, allocations, actualPayer, projectAdvance, needsMixedFundingFence, projectId: payment.projectId, writeAuthority, operatingLedgerEffectiveDateAtRegistration, fingerprint: registeredPaymentFingerprint(payment.id, actorUserId, input) };
}

export async function appendRegisteredFunding(tx: Prisma.TransactionClient, executionId: string, context: Awaited<ReturnType<typeof prepareRegisteredFunding>>, input: RecordRegisteredPaymentExecutionDto, actorUserId: string, contractHistoryConfirmation: Awaited<ReturnType<typeof confirmRegisteredContractHistory>>) {
  await tx.registeredPaymentFunding.create({ data: { executionId, operatingLedgerEffectiveDateAtRegistration:context.operatingLedgerEffectiveDateAtRegistration, accountId: context.account.id, balanceRegistrationId: context.current.id,
    actualPayerKind: context.actualPayer.kind, actualPayerId: context.actualPayer.id, actualPayerSnapshot: context.actualPayer.snapshot,
    ...(contractHistoryConfirmation ? {contractHistoryConfirmation} : {}),
    openingTreatment: input.openingTreatment, openingReason: input.openingReason.trim(), openingEvidence: input.openingEvidence.trim(), payloadFingerprint: context.fingerprint } });
  for (const line of context.allocations) await tx.registeredFundPaymentAllocation.create({ data: { id: randomUUID(), executionId, accountId: context.account.id, sourceBatchId: line.sourceBatchId, amountCents: line.amount } });
  if (context.projectAdvance) {
    const { amount, companyId, reason, evidence, companyAllocations } = context.projectAdvance;
    await tx.registeredPaymentProjectAdvance.create({ data: {
      executionId, projectId: context.projectId, accountId: context.account.id, creditorCompanyId: companyId,
      confirmedByUserId: actorUserId, amountCents: amount, reason, evidence,
      companyAllocations: companyAllocations.map(line => ({ sourceBatchId: line.sourceBatchId, amountCents: line.amountCents }))
    } });
  }
  await tx.registeredPaymentEvent.create({ data: { executionId, payload: { executionId, accountId: context.account.id, balanceRegistrationId: context.current.id, writeAuthority:context.writeAuthority } } });
}

/** Run only the prepared Task26 constraints before reporting a new registered payment. */
export async function enforceRegisteredPaymentAdvanceConstraints(
  tx: Prisma.TransactionClient,
  context: Awaited<ReturnType<typeof prepareRegisteredFunding>>,
) {
  if (!context.projectAdvance && !context.needsMixedFundingFence) return;
  const [catalog] = await tx.$queryRaw<Array<{ present: number; valid: number }>>(Prisma.sql`
    WITH expected(name, relation, handler) AS (VALUES
      ('RegisteredPaymentProjectAdvance_payment',
       to_regclass('public."RegisteredPaymentProjectAdvance"'),
       to_regprocedure('public.jg_registered_payment_project_advance_check()')),
      ('RegisteredFundPaymentAllocation_project_mixed_funding',
       to_regclass('public."RegisteredFundPaymentAllocation"'),
       to_regprocedure('public.jg_registered_payment_project_mixed_funding_check()'))
    )
    SELECT count(found_trigger.oid)::int AS present, count(*) FILTER (
      WHERE found_trigger.tgrelid = expected.relation AND found_trigger.tgfoid = expected.handler
      AND found_trigger.tgtype = 5 AND found_trigger.tgenabled = 'O' AND found_trigger.tgdeferrable AND found_trigger.tginitdeferred
      AND NOT found_trigger.tgisinternal AND constraint_row.condeferrable AND constraint_row.condeferred
    )::int AS valid
    FROM expected
    JOIN pg_catalog.pg_trigger found_trigger ON found_trigger.tgname::text = expected.name
    JOIN pg_catalog.pg_class relation ON relation.oid = found_trigger.tgrelid AND relation.relnamespace = 'public'::regnamespace
    LEFT JOIN pg_catalog.pg_constraint constraint_row
      ON constraint_row.oid = found_trigger.tgconstraint AND constraint_row.conname::text = expected.name
      AND constraint_row.connamespace = 'public'::regnamespace
  `);
  if (catalog.present === 0 && !context.projectAdvance) return;
  if (catalog.present !== 2 || catalog.valid !== 2) {
    throw new ConflictException("项目垫资登记校验暂不可用，请联系财务核对，暂勿重复登记");
  }
  await tx.$executeRaw(Prisma.sql`SET CONSTRAINTS
    public."RegisteredPaymentProjectAdvance_payment",
    public."RegisteredFundPaymentAllocation_project_mixed_funding" IMMEDIATE`);
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
export async function readRegisteredProjectAdvanceStatus(
  tx: Prisma.TransactionClient,
  executionId: string,
  expected: { actorUserId: string; projectId: string; accountId: string; companyId: string; input: ConfirmedProjectAdvance }
) {
  const receipt = await tx.registeredPaymentProjectAdvance.findUnique({ where: { executionId } });
  if (receipt && (receipt.confirmedByUserId !== expected.actorUserId || receipt.projectId !== expected.projectId ||
      receipt.accountId !== expected.accountId || receipt.creditorCompanyId !== expected.companyId)) return "mismatch";
  return registeredProjectAdvanceReceiptStatus(expected.input, receipt);
}

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
