import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { businessAmountFromLegacyCents, type PrimaryCostCategoryCode } from "@jiangkong/shared-domain";

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
import {
  operatingNumericSnapshot,
  type OperatingMoneyInput
} from "../operating-ledger/operating-money-protocol";
import { readSignedSettlementOperatingNumericFacts } from "./signed-settlement-operating-precision";
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
 * 已签结算确认事实的经营来源。三类合同分别投影：
 * - downstream / outside_fact：确认成本并增加下游应付，负数冲减；实付只减少应付。
 * - upward：只形成施工企业应付我方的内部应收，不确认项目收入或成本。
 * 旧 `Settlement` 与新 `SignedContractSettlement` 属于同一经济事实的不同入口，
 * 跨来源去重键见 `settlement-source-dedup.ts`，同一合同版本同一结算期次只计一次。
 */
export const SIGNED_SETTLEMENT_OPERATING_SOURCE_TYPE =
  "signed_contract_settlement";

interface FrozenContractSource {
  sourceRecordId: string;
  sourceVersion: string;
  contractTypeKey: string | null;
  counterparty: string | null;
  counterpartyVersionId: string;
  payerKind: string;
  payerVersionId: string | null;
  companyEntityId: string | null;
  affiliateAssignmentId: string | null;
  affiliateBusinessPartyVersionId: string | null;
  operatingNumericFacts?: unknown;
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
      where: { projectId, state: "confirmed" },
      include: { attachments: { select: { fileId: true } } },
      orderBy: [{ reviewedAt: "asc" }, { id: "asc" }]
    });
    const snapshots: OperatingSourceSnapshot[] = [];
    for (const row of rows) {
      if (!["downstream", "outside_fact", "upward"].includes(row.contractKind)) continue;
      const source = frozenContractSource(row, row.contractKind);
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
      !["downstream", "outside_fact", "upward"].includes(row.contractKind) ||
      row.state !== "confirmed"
    ) {
      return null;
    }
    if (!frozenContractSource(row, row.contractKind)) return null;
    return this.snapshot(tx, row);
  }

  toOperatingFactInput(snapshot: OperatingSourceSnapshot): OperatingSourceFactInput {
    const source = requiredJsonRecord(
      snapshot.sourceSnapshot,
      "已签结算正式来源"
    );
    const affiliate = frozenAffiliateFromJson(source, "已签结算");
    const contractKind = requiredJsonText(source, "contractKind", "已签结算");
    if (!["downstream", "outside_fact", "upward"].includes(contractKind)) {
      throw new BadRequestException("已签结算合同类型不正确");
    }
    const occurredAt = requiredJsonDate(source, "occurredAt", "已签结算");
    const confirmedAt = requiredJsonDate(source, "confirmedAt", "已签结算");
    const effectiveDate = requiredJsonDate(
      source,
      "operatingLedgerEffectiveDate",
      "已签结算"
    );
    const signedAmountYuan = source.operatingNumericFacts === undefined
      ? undefined : requiredJsonText(source, "signedAmountYuan", "已签结算");
    const numericBasis = signedAmountYuan === undefined ? undefined
      : readSignedSettlementOperatingNumericFacts(source.operatingNumericFacts, signedAmountYuan, contractKind === "upward");
    let amount: OperatingMoneyInput;
    let positive: boolean;
    if (signedAmountYuan === undefined) {
      const signedCents = requiredJsonMoney(source, "amountCents", "已签结算");
      if (signedCents === 0n) throw new BadRequestException("零金额已签结算不产生经营金额事实");
      amount = { amountCents: absolute(signedCents) };
      positive = signedCents > 0n;
    } else {
      amount = settlementMoneyV2(signedAmountYuan.replace(/^-/u, ""));
      positive = !signedAmountYuan.startsWith("-");
    }
    const impactDirection = positive ? "increase" : "decrease";
    const debtor = payerSubject(source, affiliate.businessPartyVersionId);
    const counterpartyVersionId = requiredJsonText(
      source,
      "counterpartyVersionId",
      "已签结算"
    );
    const impacts: AppendOperatingFactInput["impacts"] = [];
    let creditor: { kind: "participating_company" | "downstream_counterparty"; id: string };
    let operatingLevel: "project" | "participating_company" = "project";
    if (contractKind === "upward") {
      // 对上结算只形成施工企业应付我方的内部应收；项目合并收入与成本不增加。
      creditor = { kind: "participating_company", id: counterpartyVersionId };
      operatingLevel = "participating_company";
      impacts.push({
        idempotencyKey: `${snapshot.sourceType}:${snapshot.sourceBusinessId}:internal-receivable`,
        sourceImpactKey: "receivable_increase",
        impactKind: "receivable_increase",
        ...amount,
        direction: impactDirection,
        subjectRole: "creditor",
        subject: creditor,
        description:
          positive
            ? "对上已签结算形成施工企业应付我方"
            : "对上已签结算冲减施工企业应付我方",
        impactSnapshot: sourceJson({
          relationship: "upward",
          projectConsolidation: "exclude_internal"
        })
      });
    } else {
      creditor = { kind: "downstream_counterparty", id: counterpartyVersionId };
      const signedPayableCents = numericBasis
        ? BigInt(numericBasis.payableDeltaCents)
        : requiredJsonMoney(source, "payableAmountCents", "已签结算");
      const contractTypeKey = optionalJsonText(source, "contractTypeKey");
      const costCategoryCode = settlementCostCategoryFor(
        contractTypeKey,
        contractKind
      );
      impacts.push({
        idempotencyKey: `${snapshot.sourceType}:${snapshot.sourceBusinessId}:confirmed_cost`,
        sourceImpactKey: "confirmed_cost",
        impactKind: "confirmed_cost",
        ...amount,
        direction: impactDirection,
        subjectRole: "debtor",
        subject: debtor,
        costCategoryCode,
        description:
          positive ? "已签结算确认项目成本" : "负向已签结算冲减项目成本"
      });
      if (signedPayableCents !== 0n) {
        impacts.push({
          idempotencyKey: `${snapshot.sourceType}:${snapshot.sourceBusinessId}:payable`,
          sourceImpactKey:
            signedPayableCents > 0n ? "payable_increase" : "payable_decrease",
          impactKind:
            signedPayableCents > 0n ? "payable_increase" : "payable_decrease",
          ...(numericBasis
            ? settlementMoneyV2(businessAmountFromLegacyCents(absolute(signedPayableCents))!)
            : { amountCents: absolute(signedPayableCents) }),
          direction: signedPayableCents > 0n ? "increase" : "decrease",
          subjectRole: "creditor",
          subject: creditor,
          description:
            signedPayableCents > 0n ? "已签结算增加下游应付" : "负向已签结算冲减下游应付"
        });
      }
    }
    const contractTypeKey = optionalJsonText(source, "contractTypeKey") ?? "";
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
        operatingLevel,
        evidenceLevel: "A",
        ...amount,
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
          contractKind,
          contractTypeKey: contractTypeKey || null,
          settlementNumber: optionalJsonText(source, "settlementNumber"),
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
    const frozen = frozenContractSource(row, row.contractKind);
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
    const signedYuan = new Prisma.Decimal(row.amountYuan);
    const signedAmountYuan = signedYuan.toFixed(4);
    let moneySnapshot: Prisma.InputJsonObject;
    if (frozen.operatingNumericFacts === undefined) {
      const signedCents = signedYuan.times(100).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
      if (signedCents.isZero()) {
        throw new BadRequestException("已签结算金额不足一分，无法登记经营金额");
      }
      moneySnapshot = { amountCents: signedCents.toFixed(0), payableAmountCents: signedCents.toFixed(0) };
    } else {
      const numericBasis = readSignedSettlementOperatingNumericFacts(
        frozen.operatingNumericFacts, signedAmountYuan, row.contractKind === "upward"
      );
      moneySnapshot = {
        signedAmountYuan,
        operatingNumericFacts: { ...numericBasis },
        numericFacts: operatingNumericSnapshot(settlementMoneyV2(signedAmountYuan.replace(/^-/u, "")))
      };
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
        settlementNumber: row.number,
        contractKind: row.contractKind,
        relationship:
          row.contractKind === "upward"
            ? "upward"
            : row.contractKind === "outside_fact"
              ? "outside"
              : frozen.payerKind === "construction_enterprise"
                ? "outside"
                : "inside",
        contractId: row.contractId,
        contractVersionId: frozen.sourceRecordId,
        contractVersionNo: frozen.sourceVersion,
        contractTypeKey: frozen.contractTypeKey,
        payerKind: frozen.payerKind,
        payerVersionId: frozen.payerVersionId,
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
        ...moneySnapshot,
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
  row: Pick<SignedSettlementRow, "confirmedContractSource" | "contractKind">,
  contractKind: string
): FrozenContractSource | null {
  const value = row.confirmedContractSource;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const contractTypeKey =
    typeof record.contractTypeKey === "string" ? record.contractTypeKey : null;
  if (
    contractKind === "downstream" &&
    (!contractTypeKey || !isDownstreamSettlementCostType(contractTypeKey))
  ) {
    return null;
  }
  if (contractKind !== "downstream" && contractKind !== "outside_fact" && contractKind !== "upward") {
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
    operatingNumericFacts: record.operatingNumericFacts,
    affiliateBusinessPartyVersionId: text(
      "affiliateBusinessPartyVersionId"
    )
  };
}

function settlementMoneyV2(amountYuan: string): Extract<OperatingMoneyInput, { numericProtocolVersion: 2 }> {
  return { numericProtocolVersion: 2, amountCents: null, amountYuan };
}

function payerSubject(
  source: Record<string, Prisma.InputJsonValue>,
  affiliateVersionId: string
) {
  const payerKind = requiredJsonText(source, "payerKind", "已签结算");
  if (payerKind === "construction_enterprise") {
    return {
      kind: "construction_enterprise" as const,
      id: affiliateVersionId
    };
  }
  if (payerKind === "participating_company") {
    return {
      kind: "participating_company" as const,
      id:
        optionalJsonText(source, "payerVersionId") ??
        requiredJsonText(source, "companyEntityVersionId", "已签结算")
    };
  }
  throw new BadRequestException("已签结算付款主体类型不正确");
}

function settlementCostCategoryFor(
  contractTypeKey: string | null,
  contractKind: string
): PrimaryCostCategoryCode {
  if (contractTypeKey && isDownstreamSettlementCostType(contractTypeKey)) {
    return settlementCostCategory(contractTypeKey);
  }
  // 表外合同类型不一定在标准成本分类内；保留为其他项目成本而不是丢失事实。
  if (contractKind === "outside_fact") return "other_project_cost";
  throw new BadRequestException("当前合同类型尚未接入经营成本分类");
}

function optionalJsonText(
  source: Record<string, Prisma.InputJsonValue>,
  key: string
): string | null {
  const value = source[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value;
}
