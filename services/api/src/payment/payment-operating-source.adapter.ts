import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import {
  frozenAffiliateFromJson,
  occurredBeforeEffectiveDate,
  readAffiliateSnapshot,
  readOperatingLedgerEffectiveDate,
  requiredJsonDate,
  requiredJsonMoney,
  requiredJsonRecord,
  requiredJsonText,
  sourceJson
} from "../operating-ledger/formal-operating-source.helpers";
import type {
  AppendOperatingFactInput,
  OperatingSubjectReference
} from "../operating-ledger/operating-ledger.service";
import type {
  OperatingSourceAdapter,
  OperatingSourceFactInput,
  OperatingSourceLocator,
  OperatingSourceSnapshot
} from "../operating-ledger/operating-source-adapter";

export const PAYMENT_EXECUTION_SOURCE_TYPE = "payment_execution";

export class PaymentExecutionOperatingSourceAdapter
  implements OperatingSourceAdapter
{
  readonly sourceType = PAYMENT_EXECUTION_SOURCE_TYPE;

  async readProjectSnapshots(
    tx: Parameters<OperatingSourceAdapter["readProjectSnapshots"]>[0],
    projectId: string
  ): Promise<readonly OperatingSourceSnapshot[]> {
    const requests = await tx.paymentRequest.findMany({
      where: { projectId },
      select: { id: true }
    });
    if (!requests.length) return [];
    const rows = await tx.paymentExecution.findMany({
      where: { paymentRequestId: { in: requests.map((request) => request.id) } },
      orderBy: [{ paidAt: "asc" }, { id: "asc" }]
    });
    return Promise.all(rows.map((row) => this.snapshot(tx, row)));
  }

  async readSourceSnapshot(
    tx: Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0],
    locator: OperatingSourceLocator
  ): Promise<OperatingSourceSnapshot | null> {
    const row = await tx.paymentExecution.findUnique({
      where: { id: locator.sourceBusinessId }
    });
    if (!row) return null;
    const request = await tx.paymentRequest.findUnique({
      where: { id: row.paymentRequestId }
    });
    if (!request || request.projectId !== locator.projectId) return null;
    return this.snapshot(tx, row, request);
  }

  toOperatingFactInput(snapshot: OperatingSourceSnapshot): OperatingSourceFactInput {
    const source = requiredJsonRecord(snapshot.sourceSnapshot, "付款执行正式来源");
    const affiliate = frozenAffiliateFromJson(source, "付款执行");
    const occurredAt = requiredJsonDate(source, "paidAt", "付款执行");
    const confirmedAt = requiredJsonDate(source, "confirmedAt", "付款执行");
    const effectiveDate = requiredJsonDate(
      source,
      "operatingLedgerEffectiveDate",
      "付款执行"
    );
    const amountCents = requiredJsonMoney(source, "amountCents", "付款执行");
    if (amountCents <= 0n) throw new BadRequestException("付款执行金额必须大于 0");

    const approvedPayer = payerSubject(
      requiredJsonText(source, "approvedPayerType", "付款执行"),
      requiredJsonText(source, "approvedPayerId", "付款执行")
    );
    const actualPayer = payerSubject(
      requiredJsonText(source, "actualPayerType", "付款执行"),
      requiredJsonText(source, "actualPayerId", "付款执行")
    );
    const payee = {
      kind: "downstream_counterparty" as const,
      id: requiredJsonText(source, "payeeVersionId", "付款执行")
    };
    const payableBySource = payableAllocations(source);
    const impacts: AppendOperatingFactInput["impacts"] = [...payableBySource].map(
      ([sourceId, allocatedCents]) => ({
        idempotencyKey: `${snapshot.sourceType}:${snapshot.sourceBusinessId}:payable:${sourceId}`,
        sourceImpactKey: `payable:${sourceId}`,
        impactKind: "payable_decrease",
        amountCents: allocatedCents,
        direction: "decrease",
        subjectRole: "payee",
        subject: payee,
        description: "实际付款清偿下游应付"
      })
    );
    impacts.push({
      idempotencyKey: `${snapshot.sourceType}:${snapshot.sourceBusinessId}:funds`,
      sourceImpactKey:
        actualPayer.kind === "construction_enterprise"
          ? "construction_enterprise_funds_decrease"
          : "company_project_funds_decrease",
      impactKind:
        actualPayer.kind === "construction_enterprise"
          ? "construction_enterprise_funds_decrease"
          : "company_project_funds_decrease",
      amountCents,
      direction: "decrease",
      subjectRole: "actual_payer",
      subject: actualPayer,
      description: "实际付款减少付款主体项目资金"
    });
    if (!sameSubject(approvedPayer, actualPayer)) {
      impacts.push({
        idempotencyKey: `${snapshot.sourceType}:${snapshot.sourceBusinessId}:proxy`,
        sourceImpactKey: "inter_subject_proxy_payment",
        impactKind: "inter_subject_balance_increase",
        amountCents,
        direction: "increase",
        subjectRole: "actual_payer",
        subject: actualPayer,
        description: "实际付款主体代原债务主体付款形成主体间往来",
        impactSnapshot: sourceJson({ approvedPayer, actualPayer })
      });
    }
    return {
      entryKind: "original",
      input: {
        projectId: snapshot.projectId,
      sourceType: snapshot.sourceType,
      sourceBusinessId: snapshot.sourceBusinessId,
      sourceBusinessCode: snapshot.sourceBusinessCode,
      sourceVersion: snapshot.sourceVersion,
      idempotencyKey: `${snapshot.sourceType}:${snapshot.sourceBusinessId}`,
      occurredAt,
      confirmedAt,
      confirmedByUserId: requiredJsonText(
        source,
        "executedByUserId",
        "付款执行"
      ),
      factKind: "downstream_payment",
      operatingLevel: sameSubject(approvedPayer, actualPayer)
        ? "project"
        : "inter_subject",
      evidenceLevel: "A",
      amountCents,
      currencyCode: "CNY",
      direction: "outflow",
      isBeforeOperatingLedgerEffectiveDate: occurredBeforeEffectiveDate(
        occurredAt,
        effectiveDate
      ),
      affiliateAssignmentId: affiliate.assignmentId,
      affiliateBusinessPartyVersionId: affiliate.businessPartyVersionId,
      affiliateNameSnapshot: affiliate.name,
      ...(affiliate.creditCode
        ? { affiliateCreditCodeSnapshot: affiliate.creditCode }
        : {}),
      sourceSnapshot: snapshot.sourceSnapshot,
      basisSnapshot: sourceJson({
        authority: "payment_execution_with_voucher",
        financeRecordRole: "financial_evidence_only",
        voucherFileId: requiredJsonText(source, "voucherFileId", "付款执行")
      }),
      subjects: {
        debtor: approvedPayer,
        approvedPayer,
        actualPayer,
        payee
      },
        impacts
      }
    };
  }

  private async snapshot(
    tx: Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0],
    row: PaymentExecutionRow,
    loadedRequest?: PaymentRequestRow
  ): Promise<OperatingSourceSnapshot> {
    const request =
      loadedRequest ??
      (await tx.paymentRequest.findUnique({ where: { id: row.paymentRequestId } }));
    if (!request) throw new BadRequestException("付款执行缺少付款申请");
    const [version, counterparty, allocations, executionTotal, effectiveDate] =
      await Promise.all([
        tx.contractVersion.findUnique({
          where: { id: request.contractVersionId },
          select: {
            signingSubjectType: true,
            companyEntityIdSnapshot: true,
            companyEntityVersionId: true,
            affiliateAssignmentId: true,
            affiliateBusinessPartyVersionId: true
          }
        }),
        tx.contractPartySnapshot.findFirst({
          where: {
            contractVersionId: request.contractVersionId,
            roleKey: "party_b"
          },
          select: { businessPartyVersionId: true, snapshot: true },
          orderBy: { displayOrder: "asc" }
        }),
        tx.paymentExecutionAllocation.findMany({
          where: { paymentExecutionId: row.id },
          select: {
            allocationType: true,
            sourceRowId: true,
            settlementId: true,
            amountCents: true,
            allocationOrder: true
          },
          orderBy: [{ allocationType: "asc" }, { allocationOrder: "asc" }]
        }),
        tx.paymentExecution.aggregate({
          where: { paymentRequestId: request.id },
          _sum: { amountCents: true }
        }),
        readOperatingLedgerEffectiveDate(tx, request.projectId)
      ]);
    if (!version || !counterparty?.businessPartyVersionId) {
      throw new BadRequestException("付款执行缺少合同主体或下游相对方快照");
    }
    const approvedAmountCents =
      request.approvedAmountCents ?? request.requestedAmountCents;
    if ((executionTotal._sum.amountCents ?? 0n) > approvedAmountCents) {
      throw new BadRequestException("付款执行累计金额超过付款申请批复金额");
    }
    const affiliate = await readAffiliateSnapshot(tx, {
      projectId: request.projectId,
      occurredAt: row.paidAt,
      assignmentId: version.affiliateAssignmentId,
      businessPartyVersionId: version.affiliateBusinessPartyVersionId
    });
    const approvedPayer = approvedPayerIdentity(version, request);
    const actualPayer = actualPayerIdentity(row, affiliate.businessPartyVersionId);
    const dueAllocations = allocations.filter(
      (allocation) => allocation.allocationType === "contract_due_payment"
    );
    if (dueAllocations.reduce((sum, allocation) => sum + allocation.amountCents, 0n) > row.amountCents) {
      throw new BadRequestException("付款执行应付核销金额不能超过本次实付金额");
    }
    if (
      request.sourceType === "contract_due" &&
      !request.settlementId &&
      dueAllocations.reduce((sum, allocation) => sum + allocation.amountCents, 0n) !==
        row.amountCents
    ) {
      throw new BadRequestException("合同到期付款必须完整关联本次应付核销来源");
    }
    const payable = dueAllocations.map((allocation) => ({
      sourceId: allocation.settlementId ?? allocation.sourceRowId,
      amountCents: allocation.amountCents.toString()
    }));
    if (request.settlementId && payable.length === 0) {
      payable.push({ sourceId: request.settlementId, amountCents: row.amountCents.toString() });
    }
    return {
      projectId: request.projectId,
      sourceType: this.sourceType,
      sourceBusinessId: row.id,
      sourceBusinessCode: `${request.code}/实付/${row.id}`,
      sourceVersion: 1,
      status: "confirmed",
      sourceSnapshot: sourceJson({
        formalStatus: "confirmed",
        paymentRequestId: request.id,
        paymentRequestCode: request.code,
        paymentSourceType: request.sourceType,
        contractId: request.contractId,
        contractVersionId: request.contractVersionId,
        settlementId: request.settlementId,
        approvedAmountCents: approvedAmountCents.toString(),
        amountCents: row.amountCents.toString(),
        paidAt: row.paidAt.toISOString(),
        confirmedAt: row.createdAt.toISOString(),
        executedByUserId: row.executedByUserId,
        voucherFileId: row.voucherFileId,
        approvedPayerType: approvedPayer.type,
        approvedPayerId: approvedPayer.id,
        actualPayerType: actualPayer.type,
        actualPayerId: actualPayer.id,
        payeeVersionId: counterparty.businessPartyVersionId,
        payableAllocations: payable,
        operatingLedgerEffectiveDate: effectiveDate.toISOString(),
        affiliate
      })
    };
  }
}

interface PaymentExecutionRow {
  id: string;
  paymentRequestId: string;
  settlementId: string | null;
  paymentSubjectType: string;
  companyEntityIdSnapshot: string;
  amountCents: bigint;
  paidAt: Date;
  executedByUserId: string;
  voucherFileId: string;
  createdAt: Date;
}

interface PaymentRequestRow {
  id: string;
  projectId: string;
  settlementId: string | null;
  sourceType: string;
  contractId: string;
  contractVersionId: string;
  code: string;
  requestedAmountCents: bigint;
  approvedAmountCents: bigint | null;
  paymentSubjectType: string;
}

function approvedPayerIdentity(
  version: {
    signingSubjectType: string;
    companyEntityIdSnapshot: string | null;
    companyEntityVersionId: string | null;
    affiliateBusinessPartyVersionId: string | null;
  },
  request: Pick<PaymentRequestRow, "paymentSubjectType">
): { type: "affiliate" | "our_company"; id: string } {
  if (
    request.paymentSubjectType === "affiliate" ||
    version.signingSubjectType === "affiliate"
  ) {
    if (!version.affiliateBusinessPartyVersionId) {
      throw new BadRequestException("付款申请缺少施工企业付款主体快照");
    }
    return { type: "affiliate", id: version.affiliateBusinessPartyVersionId };
  }
  if (!version.companyEntityIdSnapshot || !version.companyEntityVersionId) {
    throw new BadRequestException("付款申请缺少我方公司付款主体快照");
  }
  return { type: "our_company", id: version.companyEntityIdSnapshot };
}

function actualPayerIdentity(
  row: Pick<
    PaymentExecutionRow,
    "paymentSubjectType" | "companyEntityIdSnapshot"
  >,
  affiliateVersionId: string
): { type: "affiliate" | "our_company"; id: string } {
  return row.paymentSubjectType === "affiliate"
    ? { type: "affiliate", id: affiliateVersionId }
    : { type: "our_company", id: row.companyEntityIdSnapshot };
}

function payerSubject(
  type: string,
  id: string
): OperatingSubjectReference {
  if (type === "affiliate") return { kind: "construction_enterprise", id };
  if (type === "our_company") return { kind: "participating_company", id };
  throw new BadRequestException("付款主体类型不正确");
}

function payableAllocations(
  source: Record<string, Prisma.InputJsonValue>
): ReadonlyMap<string, bigint> {
  const value = source.payableAllocations;
  if (!Array.isArray(value)) {
    throw new BadRequestException("付款执行快照缺少应付核销明细");
  }
  const result = new Map<string, bigint>();
  for (const entry of value) {
    const allocation = requiredJsonRecord(entry, "付款执行应付核销");
    const sourceId = requiredJsonText(allocation, "sourceId", "付款执行应付核销");
    const amountCents = requiredJsonMoney(
      allocation,
      "amountCents",
      "付款执行应付核销"
    );
    if (amountCents <= 0n) {
      throw new BadRequestException("付款执行应付核销金额必须大于 0");
    }
    result.set(sourceId, (result.get(sourceId) ?? 0n) + amountCents);
  }
  return result;
}

function sameSubject(
  left: OperatingSubjectReference,
  right: OperatingSubjectReference
): boolean {
  return left.kind === right.kind && left.id === right.id;
}
