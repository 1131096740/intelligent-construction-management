import { economicDocuments } from "../contract-ledger/contract-economic-coverage";
import { approvalEvidenceMetadata } from "./approval-evidence";
import { approvalDate as formatDate } from "./approval-date";
import type { Prisma } from "@prisma/client";
import { BadRequestException } from "@nestjs/common";
import { ADDITIONAL_APPROVAL_TITLES, type ApprovalBusinessFacts } from "./approval-business-facts";
import { formatMoneyCentsAsYuan } from "../money/decimal-money";

/** Freeze display facts inside the domain's existing approval transaction. */
export async function ledgerApprovalFacts(tx: Prisma.TransactionClient, businessType: string, id: string): Promise<ApprovalBusinessFacts> {
  const row = businessType === "company_transfer" ? await tx.companyTransfer.findUniqueOrThrow({ where: { id } })
    : businessType === "contract_economic_review" ? await tx.contractEconomicReview.findUniqueOrThrow({ where: { id } })
    : businessType === "contract_bank_verification" ? await tx.contractBankVerificationRequest.findUniqueOrThrow({ where: { id } })
    : businessType === "contract_proxy_execution" ? await tx.contractProxyExecution.findUniqueOrThrow({ where: { id } })
    : businessType === "upward_contract_amount_revision" ? await tx.upwardContractAmountRevision.findUniqueOrThrow({ where: { id } })
    : businessType === "upward_receipt_match" ? await tx.upwardReceiptMatch.findUniqueOrThrow({ where: { id } }) : null;
  if (!row) throw new BadRequestException("审批业务事实不完整");
  const money = (value: bigint | string) => `${formatMoneyCentsAsYuan(BigInt(value))} 元`;
  const title = ADDITIONAL_APPROVAL_TITLES[businessType];
  const summary: ApprovalBusinessFacts["summary"] = [];
  const projectId = "projectId" in row ? row.projectId : row.sourceProjectId;
  let companyName = "companyName" in row ? row.companyName : "";
  let code = `${title} ${formatDate(row.createdAt)}`;
  if ("code" in row) {
    code = row.code;
    const parties = row.frozenParties as { source: { name: string }; destination: { name: string } };
    companyName = parties.source.name;
    summary.push({ label: "办理类别", value: ({ storage: "资金转存", loan: "临时借款调剂", repayment: "归还已有往来" } as Record<string, string>)[row.kind] ?? "公司互转" },
      { label: "转出公司", value: parties.source.name }, { label: "转入公司", value: parties.destination.name });
    for (const [label, project] of [["转出资金归属", row.sourceProjectId], ["转入资金归属", row.destinationProjectId]] as const) {
      summary.push({ label, value: project ? (await tx.project.findUniqueOrThrow({ where: { id: project }, select: { name: true } })).name : "公司自有资金" });
    }
    summary.push({ label: "转出账号尾号", value: row.sourceAccountLast4 }, { label: "转入账号尾号", value: row.destinationAccountLast4 });
    if (row.originalTransferId) summary.push({ label: "原借款单号", value: (await tx.companyTransfer.findUniqueOrThrow({ where: { id: row.originalTransferId }, select: { code: true } })).code });
    if (row.originalProxyId) {
      const original = await tx.contractProxyExecution.findUniqueOrThrow({ where: { id: row.originalProxyId } });
      const source = approvalEvidenceMetadata(original.frozenSource);
      summary.push({ label: "原代付依据", value: `${typeof source.reference === "string" ? source.reference : "原代付"} · ${money(original.amountCents)} · ${formatDate(original.occurredAt)}` });
    }
    if (row.originalFundMovementRelationshipId || row.originalInterEntityRelationshipId) summary.push({ label: "原往来类别", value: row.originalFundMovementRelationshipId ? "已确认资金移动借款往来" : "已确认跨主体代付往来" });
  } else if (projectId) summary.push({ label: "所属项目", value: (await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { name: true } })).name });
  if ("bankReference" in row && "accountLast4" in row && "direction" in row) code = row.bankReference;
  if ("bankReference" in row && "accountLast4" in row && "direction" in row) summary.push({ label: "开户公司", value: row.companyName }, { label: "银行流水号", value: row.bankReference }, { label: "银行账号尾号", value: row.accountLast4 }, { label: "资金方向", value: row.direction === "inflow" ? "收入" : "支出" });
  if ("amountCents" in row) summary.push({ label: "金额", value: row.amountCents === null ? "未约定总额" : `${formatMoneyCentsAsYuan(row.amountCents)} 元` });
  if ("occurredAt" in row) summary.push({ label: "发生日期", value: formatDate(row.occurredAt) });
  if ("amountNature" in row) {
    const contract = await tx.projectAffiliateCompanyContract.findUniqueOrThrow({ where: { id: row.contractId } });
    companyName = contract.companyEntityNameSnapshot;
    code = `${contract.contractReference} 金额修订 ${formatDate(row.effectiveAt)}`;
    summary.push({ label: "对上合同编号", value: contract.contractReference }, { label: "对上合同名称", value: contract.contractName },
      { label: "金额性质", value: row.amountNature === "fixed" ? "固定合同额" : "未约定总额" }, { label: "修订生效日期", value: formatDate(row.effectiveAt) });
  }
  if ("frozenSource" in row) {
    const source = approvalEvidenceMetadata(row.frozenSource);
    if (typeof source.reference === "string") summary.push({ label: "结算或付款依据", value: source.reference });
    if (typeof source.companyName === "string") companyName = source.companyName;
    if ("entryKind" in row) {
      code = `${typeof source.reference === "string" ? source.reference : "原付款依据"} · ${row.bankReference}`;
      summary.push({ label: "办理类别", value: ({ payment: "代付", refund: "退款", repayment: "归还" } as Record<string, string>)[row.entryKind] ?? "往来确认" });
      const originalPayer = approvalEvidenceMetadata(source.actualPayer);
      const debtor = approvalEvidenceMetadata(source.debtor);
      const originalPayee = approvalEvidenceMetadata(source.payee);
      const payer = row.entryKind === "refund" ? originalPayee : row.entryKind === "repayment" ? debtor : originalPayer;
      const payee = row.entryKind === "payment" ? originalPayee : originalPayer;
      for (const [person, label] of [[debtor, "原债务人"], [originalPayer, "原代付人"], [payer, "本次付款人"], [payee, "本次收款人"]] as const) {
        if (typeof person.name === "string") summary.push({ label, value: person.name });
      }
      if (Array.isArray(source.allocations)) for (const allocation of source.allocations) {
        const part = approvalEvidenceMetadata(allocation);
        if (typeof part.reference === "string" && typeof part.amountCents === "string") summary.push({ label: "关联分摊", value: `${part.reference} · ${money(part.amountCents)}` });
      }
    } else if ("receiptFactId" in row) {
      const receipt = await tx.operatingFact.findUniqueOrThrow({ where: { id: row.receiptFactId } });
      const claim = receipt.fundExecutionId ? await tx.bankTransactionClaim.findFirst({ where: { fundExecutionId: receipt.fundExecutionId } }) : null;
      const observation = claim ? await tx.verifiedBankTransactionObservation.findUnique({ where: { id: claim.observationId } }) : null;
      const bank = observation?.transactionSourceType === "contract_bank_verification" ? await tx.contractBankVerificationRequest.findUnique({ where: { id: observation.transactionSourceId } }) : null;
      code = `${typeof source.reference === "string" ? source.reference : "对上结算"} · ${bank?.bankReference ?? formatDate(row.occurredAt)}`;
      summary.push({ label: "核销方向", value: row.originalId ? "冲回原到账核销" : "到账核销" },
        { label: "到账依据", value: `${formatDate(receipt.occurredAt)} · ${money(receipt.amountCents)}${bank ? ` · 流水 ${bank.bankReference}` : ""}` });
    }
  }
  if ("coverage" in row && Array.isArray(row.coverage)) {
    const documents = await economicDocuments(tx, row.projectId, row.targetSourceRef ? { targetRef: row.targetSourceRef, targetVersionId: row.targetVersionId ?? undefined } : undefined);
    for (const [ref, label] of [[row.leftSourceRef, "左方文书"], [row.rightSourceRef, "右方文书"]]) {
      const document = documents.find(item => item.ref === ref);
      if (!document) throw new BadRequestException("复核关联文书缺失，不能冻结审批单");
      summary.push({ label, value: `${document.reference} · ${document.title} · ${document.counterparty}` });
    }
    code = `${documents.find(item => item.ref === row.leftSourceRef)?.reference || "左方文书"} / ${documents.find(item => item.ref === row.rightSourceRef)?.reference || "右方文书"} · ${formatDate(row.createdAt)}`;
    summary.push({ label: "履约关系", value: ({ independent: "独立履约", supplement: "补充履约", replacement: "替代文书", shared_evidence: "共同依据" } as Record<string, string>)[row.relation] ?? "履约复核" });
    for (const item of row.coverage) {
      if (item && typeof item === "object" && !Array.isArray(item) && typeof item.scope === "string" && typeof item.leftAmountCents === "string" && typeof item.rightAmountCents === "string") summary.push({ label: "履约分项", value: `${item.scope}：左方 ${money(item.leftAmountCents)}；右方 ${money(item.rightAmountCents)}；由${item.owner === "left" ? "左方" : "右方"}计入及结算` });
    }
  }
  summary.push({ label: "事由及依据", value: row.reason });
  return { title, code, companyName, projectId, summary };
}
