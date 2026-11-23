import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { PrimaryCostCategoryCode } from "@jiangkong/shared-domain";

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
import type { AppendOperatingFactInput } from "../operating-ledger/operating-ledger.service";
import type {
  OperatingSourceAdapter,
  OperatingSourceFactInput,
  OperatingSourceLocator,
  OperatingSourceSnapshot
} from "../operating-ledger/operating-source-adapter";
import {
  isDownstreamSettlementCostType,
  settlementCostCategory
} from "./settlement-operating-source.adapter";

/**
 * 已签结算确认事实的经营来源。它与旧 `settlement` 来源同口径：
 * 正数确认成本并增加下游应付，负数冲减成本并减少应付；实付只减少应付，
 * 不再次确认成本。旧 `Settlement` 与新 `SignedContractSettlement` 是
 * 互不重复的事实来源（历史基线只由旧来源/接管基线表达）。
 */
export const SIGNED_SETTLEMENT_OPERATING_SOURCE_TYPE =
  "signed_contract_settlement";

interface FrozenContractSource {
  sourceRecordId: string;
  sourceVersion: string;
  contractTypeKey: string;
  counterparty: string | null;
  counterpartyVersionId: string;
  payerKind: string;
  payerVersionId: string | null;
  companyEntityId: string | null;
  affiliateAssignmentId: string | null;
  affiliateBusinessPartyVersionId: string | null;
}

export class SignedSettlementOperatingSourceAdapter
  implements OperatingSourceAdapter
{
  readonly sourceType = SIGNED_SETTLEMENT_OPERATING_SOURCE_TYPE;

  async readProjectSnapshots(
    tx: Parameters<OperatingSourceAdapter["readProjectSnapshots"]>[0],
    projectId: string
  ): Promise<readonly OperatingSourceSnapshot[]> {
    const rows = await tx.signedContractSettlement.findMany({
      where: { projectId, contractKind: "downstream", state: "confirmed" },
      include: { attachments: { select: { fileId: true } } },
      orderBy: [{ reviewedAt: "asc" }, { id: "asc" }]
    });
    const snapshots: OperatingSourceSnapshot[] = [];
    for (const row of rows) {
      if (row.contractKind !== "downstream") continue;
      const source = frozenContractSource(row);
      if (!source) continue;
      const snapshot = await this.snapshot(tx, row);
      if (snapshot) snapshots.push(snapshot);
    }
    return snapshots;
  }

  async readSourceSnapshot(
    tx: Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0],
    locator: OperatingSourceLocator
  ): Promise<OperatingSourceSnapshot | null> {
    const row = await tx.signedContractSettlement.findUnique({
      where: { id: locator.sourceBusinessId },
      include: { attachments: { select: { fileId: true } } }
    });
    if (
      !row ||
      row.projectId !== locator.projectId ||
      row.contractKind !== "downstream" ||
      row.state !== "confirmed"
    ) {
      return null;
    }
    if (!frozenContractSource(row)) return null;
    return this.snapshot(tx, row);
  }

  toOperatingFactInput(snapshot: OperatingSourceSnapshot): OperatingSourceFactInput {
    const source = requiredJsonRecord(
      snapshot.sourceSnapshot,
      "已签结算正式来源"
    );
    const affiliate = frozenAffiliateFromJson(source, "已签结算");
    const occurredAt = requiredJsonDate(source, "occurredAt", "已签结算");
    const confirmedAt = requiredJsonDate(source, "confirmedAt", "已签结算");
    const effectiveDate = requiredJsonDate(
      source,
      "operatingLedgerEffectiveDate",
      "已签结算"
    );
    const signedAmountCents = requiredJsonMoney(
      source,
      "amountCents",
      "已签结算"
    );
    const signedPayableCents = requiredJsonMoney(
      source,
      "payableAmountCents",
      "已签结算"
    );
    if (signedAmountCents === 0n) {
      throw new BadRequestException("零金额已签结算不产生经营金额事实");
    }
    const amountCents = absolute(signedAmountCents);
    const costCategoryCode: PrimaryCostCategoryCode = settlementCostCategory(
      requiredJsonText(source, "contractTypeKey", "已签结算")
    );
    const debtor = payerSubject(source, affiliate.businessPartyVersionId);
    const creditor = {
      kind: "downstream_counterparty" as const,
      id: requiredJsonText(source, "counterpartyVersionId", "已签结算")
    };
    const impactDirection = signedAmountCents > 0n ? "increase" : "decrease";
    const impacts: AppendOperatingFactInput["impacts"] = [
      {
        idempotencyKey: `${snapshot.sourceType}:${snapshot.sourceBusinessId}:confirmed_cost`,
        sourceImpactKey: "confirmed_cost",
        impactKind: "confirmed_cost",
        amountCents,
        direction: impactDirection,
        subjectRole: "debtor",
        subject: debtor,
        costCategoryCode,
        description:
          signedAmountCents > 0n ? "已签结算确认项目成本" : "负向已签结算冲减项目成本"
      }
    ];
    if (signedPayableCents !== 0n) {
      impacts.push({
        idempotencyKey: `${snapshot.sourceType}:${snapshot.sourceBusinessId}:payable`,
        sourceImpactKey:
          signedPayableCents > 0n ? "payable_increase" : "payable_decrease",
        impactKind:
          signedPayableCents > 0n ? "payable_increase" : "payable_decrease",
        amountCents: absolute(signedPayableCents),
        direction: signedPayableCents > 0n ? "increase" : "decrease",
        subjectRole: "creditor",
        subject: creditor,
        description:
          signedPayableCents > 0n ? "已签结算增加下游应付" : "负向已签结算冲减下游应付"
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
          "confirmedByUserId",
          "已签结算"
        ),
        factKind: "downstream_settlement",
        operatingLevel: "project",
        evidenceLevel: "A",
        amountCents,
        currencyCode: "CNY",
        direction: "neutral",
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
          authority: "confirmed_signed_settlement",
          settlementId: snapshot.sourceBusinessId,
          confirmationNo: snapshot.sourceVersion,
          attachmentFileIds: (source.attachmentFileIds ??
            []) as Prisma.InputJsonArray
        }),
        subjects: { debtor, creditor },
        impacts
      }
    };
  }

  private async snapshot(
    tx: Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0],
    row: SignedSettlementRow
  ): Promise<OperatingSourceSnapshot | null> {
    const frozen = frozenContractSource(row);
    if (!frozen) return null;
    if (
      !row.number ||
      row.amountYuan === null ||
      row.reviewedAt === null ||
      row.reviewedByUserId === null ||
      row.confirmationNo === null
    ) {
      throw new BadRequestException("已确认已签结算的编号、金额或复核事实不完整");
    }
    const signedCents = new Prisma.Decimal(row.amountYuan)
      .times(100)
      .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
    if (signedCents.isZero()) {
      throw new BadRequestException("已签结算金额不足一分，无法登记经营金额");
    }
    const attachmentFileIds = row.attachments.map(
      (attachment) => attachment.fileId
    );
    const occurredAt = row.reviewedAt;
    const [effectiveDate, affiliate] = await Promise.all([
      readOperatingLedgerEffectiveDate(tx, row.projectId),
      readAffiliateSnapshot(tx, {
        projectId: row.projectId,
        occurredAt,
        assignmentId: frozen.affiliateAssignmentId,
        businessPartyVersionId: frozen.affiliateBusinessPartyVersionId
      })
    ]);
    return {
      projectId: row.projectId,
      sourceType: this.sourceType,
      sourceBusinessId: row.id,
      sourceBusinessCode: row.number,
      sourceVersion: Number(row.confirmationNo),
      status: "confirmed",
      sourceSnapshot: sourceJson({
        formalStatus: "confirmed",
        settlementId: row.id,
        contractId: row.contractId,
        contractVersionId: frozen.sourceRecordId,
        contractVersionNo: frozen.sourceVersion,
        contractTypeKey: frozen.contractTypeKey,
        signingSubjectType:
          frozen.payerKind === "construction_enterprise"
            ? "affiliate"
            : "our_company",
        companyEntityVersionId:
          frozen.payerKind === "construction_enterprise"
            ? null
            : frozen.payerVersionId,
        companyEntityIdSnapshot: frozen.companyEntityId,
        counterpartyVersionId: frozen.counterpartyVersionId,
        counterpartyName: frozen.counterparty,
        amountCents: signedCents.toFixed(0),
        payableAmountCents: signedCents.toFixed(0),
        occurredAt: occurredAt.toISOString(),
        confirmedByUserId: row.reviewedByUserId,
        confirmedAt: occurredAt.toISOString(),
        attachmentFileIds,
        operatingLedgerEffectiveDate: effectiveDate.toISOString(),
        affiliate
      })
    };
  }
}

interface SignedSettlementRow {
  id: string;
  projectId: string;
  contractId: string;
  contractKind: string;
  state: string;
  number: string | null;
  amountYuan: Prisma.Decimal | string | null;
  confirmationNo: bigint | null;
  reviewedAt: Date | null;
  reviewedByUserId: string | null;
  confirmedContractSource: Prisma.JsonValue | null;
  attachments: ReadonlyArray<{ fileId: string }>;
}

function frozenContractSource(
  row: Pick<SignedSettlementRow, "confirmedContractSource">
): FrozenContractSource | null {
  const value = row.confirmedContractSource;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const contractTypeKey =
    typeof record.contractTypeKey === "string" ? record.contractTypeKey : null;
  if (!contractTypeKey || !isDownstreamSettlementCostType(contractTypeKey)) {
    return null;
  }
  const text = (key: string): string | null =>
    typeof record[key] === "string" && (record[key] as string).length > 0
      ? (record[key] as string)
      : null;
  const sourceRecordId = text("sourceRecordId");
  const counterpartyVersionId = text("counterpartyVersionId");
  const versionNo =
    typeof record.sourceVersion === "number" ||
    typeof record.sourceVersion === "string"
      ? String(record.sourceVersion)
      : null;
  if (!sourceRecordId || !counterpartyVersionId || !versionNo) return null;
  return {
    sourceRecordId,
    sourceVersion: versionNo,
    contractTypeKey,
    counterparty: text("counterparty"),
    counterpartyVersionId,
    payerKind: text("payerKind") ?? "participating_company",
    payerVersionId: text("payerVersionId"),
    companyEntityId: text("companyEntityId"),
    affiliateAssignmentId: text("affiliateAssignmentId"),
    affiliateBusinessPartyVersionId: text(
      "affiliateBusinessPartyVersionId"
    )
  };
}

function payerSubject(
  source: Record<string, Prisma.InputJsonValue>,
  affiliateVersionId: string
) {
  const signingSubjectType = requiredJsonText(
    source,
    "signingSubjectType",
    "已签结算"
  );
  if (signingSubjectType === "affiliate") {
    return {
      kind: "construction_enterprise" as const,
      id: affiliateVersionId
    };
  }
  if (signingSubjectType === "our_company") {
    return {
      kind: "participating_company" as const,
      id: requiredJsonText(source, "companyEntityVersionId", "已签结算")
    };
  }
  throw new BadRequestException("已签结算签约主体类型不正确");
}

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value;
}
