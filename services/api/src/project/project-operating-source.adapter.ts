import { BadRequestException } from "@nestjs/common";

import {
  frozenAffiliateFromJson,
  occurredBeforeEffectiveDate,
  optionalJsonText,
  readAffiliateSnapshot,
  readOperatingLedgerEffectiveDate,
  requiredJsonDate,
  requiredJsonMoney,
  requiredJsonRecord,
  requiredJsonText,
  sourceJson,
  stableNamedSubjectId
} from "../operating-ledger/formal-operating-source.helpers";
import type { AppendOperatingFactInput } from "../operating-ledger/operating-ledger.service";
import type {
  OperatingSourceAdapter,
  OperatingSourceFactInput,
  OperatingSourceLocator,
  OperatingSourceSnapshot
} from "../operating-ledger/operating-source-adapter";

export const PROJECT_UPSTREAM_SETTLEMENT_SOURCE_TYPE =
  "project_upstream_settlement";
export const PROJECT_PROXY_PAYMENT_SOURCE_TYPE = "project_proxy_payment";

export class ProjectUpstreamSettlementOperatingSourceAdapter
  implements OperatingSourceAdapter
{
  readonly sourceType = PROJECT_UPSTREAM_SETTLEMENT_SOURCE_TYPE;

  async readProjectSnapshots(
    tx: Parameters<OperatingSourceAdapter["readProjectSnapshots"]>[0],
    projectId: string
  ): Promise<readonly OperatingSourceSnapshot[]> {
    const rows = await tx.projectUpstreamSettlement.findMany({
      where: {
        projectId,
        status: "confirmed",
        confirmedByUserId: { not: null },
        confirmedAt: { not: null },
        voidedAt: null
      },
      orderBy: [{ settledAt: "asc" }, { id: "asc" }]
    });
    return Promise.all(rows.map((row) => this.snapshot(tx, row)));
  }

  async readSourceSnapshot(
    tx: Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0],
    locator: OperatingSourceLocator
  ): Promise<OperatingSourceSnapshot | null> {
    const row = await tx.projectUpstreamSettlement.findFirst({
      where: {
        id: locator.sourceBusinessId,
        projectId: locator.projectId,
        status: "confirmed",
        confirmedByUserId: { not: null },
        confirmedAt: { not: null },
        voidedAt: null
      }
    });
    return row ? this.snapshot(tx, row) : null;
  }

  toOperatingFactInput(snapshot: OperatingSourceSnapshot): OperatingSourceFactInput {
    const source = requiredJsonRecord(
      snapshot.sourceSnapshot,
      "业主结算正式来源"
    );
    const affiliate = frozenAffiliateFromJson(source, "业主结算");
    const ownerName = requiredJsonText(source, "approvingPartyName", "业主结算");
    const occurredAt = requiredJsonDate(source, "settledAt", "业主结算");
    const confirmedAt = requiredJsonDate(source, "confirmedAt", "业主结算");
    const effectiveDate = requiredJsonDate(
      source,
      "operatingLedgerEffectiveDate",
      "业主结算"
    );
    const amountCents = requiredJsonMoney(
      source,
      "approvedAmountCents",
      "业主结算"
    );
    if (amountCents <= 0n) {
      throw new BadRequestException("业主结算正式金额必须大于 0");
    }
    const creditor = {
      kind: "construction_enterprise" as const,
      id: affiliate.businessPartyVersionId
    };
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
        "confirmedByUserId",
        "业主结算"
      ),
      factKind: "owner_settlement",
      operatingLevel: "project",
      evidenceLevel: "A",
      amountCents,
      currencyCode: "CNY",
      direction: "inflow",
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
        authority: "confirmed_project_upstream_settlement",
        voucherFileId: requiredJsonText(source, "voucherFileId", "业主结算")
      }),
      subjects: {
        debtor: {
          kind: "owner",
          id: stableNamedSubjectId("owner", ownerName)
        },
        creditor
      },
        impacts: [
        {
          idempotencyKey: `${snapshot.sourceType}:${snapshot.sourceBusinessId}:confirmed_income`,
          sourceImpactKey: "confirmed_income",
          impactKind: "confirmed_income",
          amountCents,
          direction: "increase",
          subjectRole: "creditor",
          subject: creditor,
          description: "生效业主结算确认项目收入"
        },
        {
          idempotencyKey: `${snapshot.sourceType}:${snapshot.sourceBusinessId}:receivable_increase`,
          sourceImpactKey: "receivable_increase",
          impactKind: "receivable_increase",
          amountCents,
          direction: "increase",
          subjectRole: "creditor",
          subject: creditor,
          description: "生效业主结算增加项目应收"
        }
        ]
      }
    };
  }

  private async snapshot(
    tx: Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0],
    row: {
      id: string;
      projectId: string;
      settledAt: Date;
      approvedAmountCents: bigint;
      approvingPartyName: string;
      periodLabel: string;
      isFinal: boolean;
      affiliateAssignmentId: string | null;
      affiliateBusinessPartyVersionId: string | null;
      description: string | null;
      voucherFileId: string;
      documentVersion: number;
      confirmedByUserId: string | null;
      confirmedAt: Date | null;
    }
  ): Promise<OperatingSourceSnapshot> {
    if (!row.confirmedByUserId || !row.confirmedAt) {
      throw new BadRequestException("业主结算缺少正式确认人或确认时间");
    }
    const [effectiveDate, affiliate] = await Promise.all([
      readOperatingLedgerEffectiveDate(tx, row.projectId),
      readAffiliateSnapshot(tx, {
        projectId: row.projectId,
        occurredAt: row.settledAt,
        assignmentId: row.affiliateAssignmentId,
        businessPartyVersionId: row.affiliateBusinessPartyVersionId
      })
    ]);
    return {
      projectId: row.projectId,
      sourceType: this.sourceType,
      sourceBusinessId: row.id,
      sourceBusinessCode: `业主结算/${row.periodLabel}/${row.id}`,
      sourceVersion: row.documentVersion,
      status: "confirmed",
      sourceSnapshot: sourceJson({
        formalStatus: "confirmed",
        settledAt: row.settledAt.toISOString(),
        approvedAmountCents: row.approvedAmountCents.toString(),
        approvingPartyName: row.approvingPartyName,
        periodLabel: row.periodLabel,
        isFinal: row.isFinal,
        description: row.description,
        voucherFileId: row.voucherFileId,
        confirmedByUserId: row.confirmedByUserId,
        confirmedAt: row.confirmedAt.toISOString(),
        operatingLedgerEffectiveDate: effectiveDate.toISOString(),
        affiliate
      })
    };
  }
}

export class ProjectProxyPaymentOperatingSourceAdapter
  implements OperatingSourceAdapter
{
  readonly sourceType = PROJECT_PROXY_PAYMENT_SOURCE_TYPE;

  async readProjectSnapshots(
    tx: Parameters<OperatingSourceAdapter["readProjectSnapshots"]>[0],
    projectId: string
  ): Promise<readonly OperatingSourceSnapshot[]> {
    const rows = await tx.projectProxyPayment.findMany({
      where: { projectId, voidedAt: null },
      orderBy: [{ paidAt: "asc" }, { id: "asc" }]
    });
    return Promise.all(rows.map((row) => this.snapshot(tx, row)));
  }

  async readSourceSnapshot(
    tx: Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0],
    locator: OperatingSourceLocator
  ): Promise<OperatingSourceSnapshot | null> {
    const row = await tx.projectProxyPayment.findFirst({
      where: {
        id: locator.sourceBusinessId,
        projectId: locator.projectId,
        voidedAt: null
      }
    });
    return row ? this.snapshot(tx, row) : null;
  }

  toOperatingFactInput(snapshot: OperatingSourceSnapshot): OperatingSourceFactInput {
    const source = requiredJsonRecord(
      snapshot.sourceSnapshot,
      "施工企业付款正式来源"
    );
    const affiliate = frozenAffiliateFromJson(source, "施工企业付款");
    const occurredAt = requiredJsonDate(source, "paidAt", "施工企业付款");
    const confirmedAt = requiredJsonDate(source, "confirmedAt", "施工企业付款");
    const effectiveDate = requiredJsonDate(
      source,
      "operatingLedgerEffectiveDate",
      "施工企业付款"
    );
    const amountCents = requiredJsonMoney(
      source,
      "amountCents",
      "施工企业付款"
    );
    if (amountCents <= 0n) {
      throw new BadRequestException("施工企业付款金额必须大于 0");
    }
    const debtor = projectProxyPayerSubject(source, "debtor", "债务");
    const approvedPayer = projectProxyPayerSubject(
      source,
      "approvedPayer",
      "批准付款"
    );
    const actualPayer = projectProxyPayerSubject(
      source,
      "actualPayer",
      "实际付款"
    );
    const payee = {
      kind: "downstream_counterparty" as const,
      id: requiredJsonText(source, "payeeId", "施工企业付款")
    };
    const impacts: AppendOperatingFactInput["impacts"] = [];
    const payableSourceId = optionalJsonText(source, "payableSourceId");
    if (payableSourceId) {
      impacts.push({
        idempotencyKey: `${snapshot.sourceType}:${snapshot.sourceBusinessId}:payable`,
        sourceImpactKey: `payable:${payableSourceId}`,
        impactKind: "payable_decrease",
        amountCents,
        direction: "decrease",
        subjectRole: "payee",
        subject: payee,
        description: "施工企业实际付款清偿下游应付"
      });
    }
    impacts.push({
      idempotencyKey: `${snapshot.sourceType}:${snapshot.sourceBusinessId}:funds`,
      sourceImpactKey: "construction_enterprise_funds_decrease",
      impactKind: "construction_enterprise_funds_decrease",
      amountCents,
      direction: "decrease",
      subjectRole: "actual_payer",
      subject: actualPayer,
      description: "施工企业实际付款减少施工企业项目资金"
    });
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
        "recordedByUserId",
        "施工企业付款"
      ),
      factKind: "downstream_payment",
      operatingLevel: "construction_enterprise",
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
        authority: "project_proxy_payment_with_voucher",
        financeRecordRole: "financial_evidence_only",
        voucherFileId: requiredJsonText(
          source,
          "voucherFileId",
          "施工企业付款"
        )
      }),
      subjects: {
        debtor,
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
    row: {
      id: string;
      projectId: string;
      paidAt: Date;
      amountCents: bigint;
      generalContractorName: string;
      paidTargetName: string;
      paymentType: string;
      paymentSubjectType: string;
      affiliateAssignmentId: string | null;
      affiliateBusinessPartyVersionId: string | null;
      description: string | null;
      voucherFileId: string;
      recordedByUserId: string;
      contractId: string | null;
      settlementId: string | null;
      createdAt: Date;
    }
  ): Promise<OperatingSourceSnapshot> {
    if (row.paymentSubjectType !== "affiliate") {
      throw new BadRequestException("施工企业付款来源的实际付款主体类型不正确");
    }
    const [effectiveDate, affiliate, settlement] = await Promise.all([
      readOperatingLedgerEffectiveDate(tx, row.projectId),
      readAffiliateSnapshot(tx, {
        projectId: row.projectId,
        occurredAt: row.paidAt,
        assignmentId: row.affiliateAssignmentId,
        businessPartyVersionId: row.affiliateBusinessPartyVersionId
      }),
      row.settlementId
        ? tx.settlement.findUnique({
            where: { id: row.settlementId },
            select: { contractVersionId: true }
          })
        : null
    ]);
    if (row.settlementId && !settlement) {
      throw new BadRequestException("施工企业付款关联结算不存在");
    }
    const contractVersion = settlement?.contractVersionId
      ? await tx.contractVersion.findUnique({
          where: { id: settlement.contractVersionId },
          select: {
            id: true,
            signingSubjectType: true,
            affiliateAssignmentId: true,
            affiliateBusinessPartyVersionId: true
          }
        })
      : row.contractId
        ? await tx.contractVersion.findFirst({
            where: { contractId: row.contractId, status: "effective" },
            select: {
              id: true,
              signingSubjectType: true,
              affiliateAssignmentId: true,
              affiliateBusinessPartyVersionId: true
            },
            orderBy: { versionNo: "desc" }
          })
        : null;
    if ((row.contractId || row.settlementId) && !contractVersion) {
      throw new BadRequestException("施工企业付款关联的生效合同版本不存在");
    }
    if (
      contractVersion &&
      (contractVersion.signingSubjectType !== "affiliate" ||
        contractVersion.affiliateAssignmentId !== affiliate.assignmentId ||
        contractVersion.affiliateBusinessPartyVersionId !==
          affiliate.businessPartyVersionId)
    ) {
      throw new BadRequestException(
        "施工企业付款关联的合同签约主体与冻结施工企业不一致"
      );
    }
    const contractVersionId = contractVersion?.id;
    const counterparty = contractVersionId
      ? await tx.contractPartySnapshot.findFirst({
          where: { contractVersionId, roleKey: "party_b" },
          select: { businessPartyVersionId: true },
          orderBy: { displayOrder: "asc" }
        })
      : null;
    const payeeId =
      counterparty?.businessPartyVersionId ??
      stableNamedSubjectId("downstream", row.paidTargetName);
    return {
      projectId: row.projectId,
      sourceType: this.sourceType,
      sourceBusinessId: row.id,
      sourceBusinessCode: `施工企业付款/${row.id}`,
      sourceVersion: 1,
      status: "confirmed",
      sourceSnapshot: sourceJson({
        formalStatus: "confirmed",
        paymentType: row.paymentType,
        generalContractorName: row.generalContractorName,
        paidTargetName: row.paidTargetName,
        payeeId,
        amountCents: row.amountCents.toString(),
        paidAt: row.paidAt.toISOString(),
        confirmedAt: row.createdAt.toISOString(),
        recordedByUserId: row.recordedByUserId,
        voucherFileId: row.voucherFileId,
        debtorType: "affiliate",
        debtorId: affiliate.businessPartyVersionId,
        approvedPayerType: "affiliate",
        approvedPayerId: affiliate.businessPartyVersionId,
        actualPayerType: "affiliate",
        actualPayerId: affiliate.businessPartyVersionId,
        contractId: row.contractId,
        settlementId: row.settlementId,
        payableSourceId: row.settlementId ?? row.contractId,
        description: row.description,
        operatingLedgerEffectiveDate: effectiveDate.toISOString(),
        affiliate
      })
    };
  }
}

function projectProxyPayerSubject(
  source: Record<string, import("@prisma/client").Prisma.InputJsonValue>,
  field: "debtor" | "approvedPayer" | "actualPayer",
  label: string
) {
  const type = requiredJsonText(source, `${field}Type`, `施工企业付款${label}主体`);
  const id = requiredJsonText(source, `${field}Id`, `施工企业付款${label}主体`);
  if (type === "affiliate") {
    return { kind: "construction_enterprise" as const, id };
  }
  if (type === "our_company") {
    return { kind: "participating_company" as const, id };
  }
  throw new BadRequestException(`施工企业付款${label}主体类型不正确`);
}
