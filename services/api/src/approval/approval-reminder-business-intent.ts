import { normalizeBusinessAmount } from "@jiangkong/shared-domain";
import type { Prisma } from "@prisma/client";
import { approvalDutyTarget, approvalIndependentDutyTarget, companyTransferDutyTarget, type ApprovalDutySmsIntent } from "./approval-duty-sms-intent";
import { formatMoneyCentsAsPlainYuan } from "../money/decimal-money";

type Scope = { projectId:string|null; projectName?:string; applicantName?:string; businessLabel:string; dutyName:string };
const yuan = (amount:bigint) => `${formatMoneyCentsAsPlainYuan(amount)} 元`;
const known = (...names: Array<string|null|undefined>) => [...new Set(names.filter((value): value is string=>Boolean(value?.trim())))];

export async function contractReminderIntent(tx: Prisma.TransactionClient, versionId: string, scope: Scope): Promise<ApprovalDutySmsIntent|null> {
  if (!scope.projectId || !scope.projectName || !scope.applicantName) return null;
  const version = await tx.contractVersion.findUnique({where:{id:versionId},select:{
    contractId:true,companyEntityNameSnapshot:true,amountYuan:true,amountCents:true,amountLimitType:true,
  }});
  if (!version) return null;
  const contract = await tx.contract.findUnique({where:{id:version.contractId},select:{
    projectId:true,code:true,name:true,companyEntityName:true,counterparty:true,
  }});
  if (!contract || contract.projectId !== scope.projectId || !contract.code || !contract.name) return null;
  const amountText = version.amountLimitType === "uncapped" ? "金额待确定"
    : version.amountYuan != null ? `${version.amountYuan.toFixed(4)} 元`
    : version.amountCents != null ? yuan(version.amountCents) : "金额待确定";
  return {businessLabel:scope.businessLabel,dutyName:scope.dutyName,businessCode:contract.code,scopeName:scope.projectName,
    initiatorName:scope.applicantName,subject:contract.name,
    participants:known(version.companyEntityNameSnapshot ?? contract.companyEntityName,contract.counterparty),
    amountText,targetPath:approvalDutyTarget("contract",contract.code)};
}

export async function paymentReminderIntent(tx: Prisma.TransactionClient, paymentId:string, scope: Scope): Promise<ApprovalDutySmsIntent|null> {
  if (!scope.projectId || !scope.projectName || !scope.applicantName) return null;
  const payment=await tx.paymentRequest.findUnique({where:{id:paymentId},select:{
    id:true,projectId:true,code:true,contractId:true,contractVersionId:true,settlementId:true,paymentMatter:true,requestedAmountCents:true,paidAmountCents:true,
  }});
  if (!payment || payment.projectId !== scope.projectId) return null;
  const [contract,version,settlement]=await Promise.all([
    tx.contract.findUnique({where:{id:payment.contractId},select:{projectId:true,name:true,counterparty:true}}),
    tx.contractVersion.findUnique({where:{id:payment.contractVersionId},select:{contractId:true,companyEntityNameSnapshot:true}}),
    payment.settlementId ? tx.settlement.findUnique({where:{id:payment.settlementId,contractId:payment.contractId,projectId:payment.projectId},
      select:{finalCumulativeAmountCents:true,payableAmountCents:true}}) : null,
  ]);
  if (!contract || contract.projectId !== payment.projectId || version?.contractId !== payment.contractId || !payment.code ||
      (!payment.paymentMatter?.trim() && !contract.name)) return null;
  const cumulative = settlement?.finalCumulativeAmountCents;
  const payable = settlement?.payableAmountCents;
  return {businessLabel:scope.businessLabel,dutyName:scope.dutyName,businessCode:payment.code,scopeName:scope.projectName,
    initiatorName:scope.applicantName,subject:payment.paymentMatter?.trim() || contract.name,
    participants:known(version.companyEntityNameSnapshot,contract.counterparty),amountText:yuan(payment.requestedAmountCents),
    details:[`本申请已付 ${yuan(payment.paidAmountCents)}`,...(cumulative != null ? [`关联累计结算 ${yuan(cumulative)}`]
      : payable != null ? [`关联结算应付 ${yuan(payable)}`] : [])],targetPath:approvalDutyTarget("payment",payment.id)};
}

export async function companyTransferReminderIntent(tx: Prisma.TransactionClient, id: string, roundId: string,
    applicantId: string, scope: Scope): Promise<ApprovalDutySmsIntent | null> {
  if (scope.projectId !== null || !scope.applicantName) return null;
  const row = await tx.companyTransfer.findUnique({ where: { id }, select: {
    code: true, status: true, approvalInstanceId: true, applicantUserId: true, sourceProjectId: true,
    destinationProjectId: true, amountCents: true, frozenParties: true
  } });
  if (row?.status !== "submitted" || row.approvalInstanceId !== roundId || row.applicantUserId !== applicantId) return null;
  const parties = row.frozenParties as { source?: { name?: unknown }; destination?: { name?: unknown } } | null;
  if (typeof parties?.source?.name !== "string" || !parties.source.name.trim() ||
    typeof parties.destination?.name !== "string" || !parties.destination.name.trim()) return null;
  return {
    businessLabel: scope.businessLabel, dutyName: scope.dutyName, businessCode: row.code,
    scopeName: row.sourceProjectId || row.destinationProjectId ? "项目资金" : "公司自有资金",
    initiatorName: scope.applicantName, subject: "公司互转审批", participants: known(parties.source.name, parties.destination.name),
    amountText: yuan(row.amountCents), targetPath: companyTransferDutyTarget(id)
  };
}

export async function spotApplicationReminderIntent(tx: Prisma.TransactionClient, versionId: string, scope: Scope): Promise<ApprovalDutySmsIntent | null> {
  if (!scope.projectId || !scope.projectName || !scope.applicantName) return null;
  const version = await tx.spotProcurementVersion.findUnique({ where: { id: versionId }, select: {
    procurementId: true, status: true, reason: true, purchaserNameSnapshot: true, supplierNameSnapshot: true, estimatedTotalAmount: true
  } });
  if (version?.status !== "approval_pending") return null;
  const row = await tx.spotProcurement.findUnique({ where: { id: version.procurementId }, select: {
    id: true, projectId: true, currentVersionId: true, status: true, code: true
  } });
  if (row?.status !== "approval_pending" || row.projectId !== scope.projectId || row.currentVersionId !== versionId) return null;
  const estimate = normalizeBusinessAmount(version.estimatedTotalAmount?.toString() ?? null);
  return {
    businessLabel: scope.businessLabel, dutyName: scope.dutyName, businessCode: row.code, scopeName: scope.projectName,
    initiatorName: scope.applicantName, subject: version.reason.trim() || "零星采购申请",
    participants: known(version.purchaserNameSnapshot, version.supplierNameSnapshot),
    amountText: estimate === null ? "待确定" : `预计 ${estimate} 元`, targetPath: approvalDutyTarget("spotProcurement", row.id)
  };
}

export async function spotPaymentReminderIntent(tx: Prisma.TransactionClient, paymentId: string, scope: Scope): Promise<ApprovalDutySmsIntent | null> {
  if (!scope.projectId || !scope.projectName || !scope.applicantName) return null;
  const row = await tx.spotProcurementPayment.findUnique({ where: { id: paymentId }, select: {
    projectId: true, status: true, code: true, submittedAt: true, approvalAmountCents: true, merchantNameSnapshot: true, payeeNameSnapshot: true
  } });
  if (row?.status !== "approval_pending" || !row.submittedAt || row.projectId !== scope.projectId || row.approvalAmountCents <= 0n) return null;
  return {
    businessLabel: scope.businessLabel, dutyName: scope.dutyName, businessCode: row.code, scopeName: scope.projectName,
    initiatorName: scope.applicantName, subject: "零星采购付款申请",
    participants: known(row.merchantNameSnapshot, row.payeeNameSnapshot), amountText: yuan(row.approvalAmountCents),
    targetPath: approvalDutyTarget("spotPayment", paymentId)
  };
}

export async function expenseReminderIntent(tx: Prisma.TransactionClient, claimId:string, scope: Scope): Promise<ApprovalDutySmsIntent|null> {
  const claim=await tx.expenseClaim.findUnique({where:{id:claimId},select:{
    id:true,code:true,projectId:true,claimType:true,reason:true,applicantNameSnapshot:true,
    companyEntityNameSnapshot:true,payeeNameSnapshot:true,requestedAmountCents:true,
  }});
  if (!claim || claim.projectId !== scope.projectId || !claim.applicantNameSnapshot || !claim.code ||
      (claim.projectId && !scope.projectName)) return null;
  const labels:Record<string,string> = {reimbursement:"费用报销",incidental_expense:"零星费用",loan:"项目借款"};
  const subject=claim.reason?.trim() || labels[claim.claimType];
  if (!subject) return null;
  const lines=claim.claimType === "reimbursement" ? await tx.expenseClaimLine.findMany({
    where:{expenseClaimId:claim.id},select:{expenseCategory:true,amountCents:true},orderBy:{sortOrder:"asc"},take:3,
  }) : [];
  return {businessLabel:scope.businessLabel,dutyName:scope.dutyName,businessCode:claim.code,scopeName:scope.projectName ?? "公司日常",
    initiatorName:claim.applicantNameSnapshot,subject,participants:known(claim.companyEntityNameSnapshot,claim.payeeNameSnapshot),
    amountText:yuan(claim.requestedAmountCents),details:lines.map(line=>`${line.expenseCategory.trim().slice(0,24)} ${yuan(line.amountCents)}`),
    targetPath:approvalDutyTarget("expense",claim.id)};
}

export async function independentFinancialReminderIntent(tx: Prisma.TransactionClient, kind:string, businessId:string,
    scope: Scope, businessCode:string): Promise<ApprovalDutySmsIntent|null> {
  if (!scope.applicantName || (scope.projectId && !scope.projectName)) return null;
  const base = {
    businessLabel:scope.businessLabel,dutyName:scope.dutyName,businessCode,
    scopeName:scope.projectName ?? "公司级核验",initiatorName:scope.applicantName,
  };
  if (kind === "loan_repayment") {
    const row = await tx.employeeLoanRepayment.findUnique({where:{id:businessId},select:{loanAccountId:true,status:true,amountCents:true}});
    if (!row || row.status !== "recorded" || !scope.projectId) return null;
    const loan = await tx.employeeProjectLoanAccount.findUnique({where:{id:row.loanAccountId},select:{scopeKey:true,userId:true}});
    if (!loan || loan.scopeKey !== `project:${scope.projectId}`) return null;
    const borrower = await tx.user.findUnique({where:{id:loan.userId},select:{name:true}});
    return {...base,subject:"员工借款还款确认",participants:known(borrower?.name),amountText:yuan(row.amountCents),
      targetPath:approvalIndependentDutyTarget(kind,businessId)};
  }
  if (kind === "contract_proxy_execution") {
    const row = await tx.contractProxyExecution.findUnique({where:{id:businessId},select:{
      projectId:true,status:true,amountCents:true,entryKind:true,frozenSource:true,
    }});
    if (!row || row.status !== "pending_confirm" || row.projectId !== scope.projectId) return null;
    const operations:Record<string,string> = {payment:"代付核对",refund:"代付退款核对",repayment:"代付归还核对"};
    const subject = operations[row.entryKind];
    const source = row.frozenSource;
    if (!subject || !source || typeof source !== "object" || Array.isArray(source)) return null;
    const partyName = (value:Prisma.JsonValue | undefined) => value && typeof value === "object" && !Array.isArray(value) &&
      typeof value.name === "string" ? value.name : undefined;
    const participants = known(partyName(source.debtor),partyName(source.payee),row.entryKind === "payment" ? partyName(source.actualPayer) : undefined);
    if (!participants.length) return null;
    return {...base,subject,participants,amountText:yuan(row.amountCents),targetPath:approvalIndependentDutyTarget(kind,businessId)};
  }
  if (kind === "contract_bank_verification") {
    const row = await tx.contractBankVerificationRequest.findUnique({where:{id:businessId},select:{
      projectId:true,status:true,companyName:true,direction:true,amountCents:true,
    }});
    if (!row || row.status !== "pending_confirm" || row.projectId !== scope.projectId || !row.companyName ||
        !["inflow","outflow"].includes(row.direction)) return null;
    return {...base,subject:row.direction === "inflow" ? "银行到账核验" : "银行出款核验",participants:[row.companyName],
      amountText:yuan(row.amountCents),targetPath:approvalIndependentDutyTarget(kind,businessId)};
  }
  return null;
}
