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

const EFFECTIVE_SETTLEMENT_STATUSES = ["effective", "partially_paid", "paid"];
const CONTRACT_COST_CATEGORY: Readonly<Record<string, PrimaryCostCategoryCode>> = {
  material_purchase: "material",
  equipment_rental: "machinery_and_rental",
  labor_subcontract: "crew_and_labor",
  professional_subcontract: "professional_subcontract"
};

export class SettlementOperatingSourceAdapter implements OperatingSourceAdapter {
  readonly sourceType = "settlement";

  async readProjectSnapshots(
    tx: Parameters<OperatingSourceAdapter["readProjectSnapshots"]>[0],
    projectId: string
  ): Promise<readonly OperatingSourceSnapshot[]> {
    const rows = await tx.settlement.findMany({
      where: { projectId, status: { in: EFFECTIVE_SETTLEMENT_STATUSES } },
      orderBy: [{ periodEnd: "asc" }, { id: "asc" }]
    });
    const snapshots = await Promise.all(rows.map((row) => this.snapshot(tx, row)));
    return snapshots.filter(
      (snapshot): snapshot is OperatingSourceSnapshot => snapshot !== null
    );
  }

  async readSourceSnapshot(
    tx: Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0],
    locator: OperatingSourceLocator
  ): Promise<OperatingSourceSnapshot | null> {
    const row = await tx.settlement.findFirst({
      where: {
        id: locator.sourceBusinessId,
        projectId: locator.projectId,
        status: { in: EFFECTIVE_SETTLEMENT_STATUSES }
      }
    });
    return row ? this.snapshot(tx, row) : null;
  }

  toOperatingFactInput(snapshot: OperatingSourceSnapshot): OperatingSourceFactInput {
    const source = requiredJsonRecord(snapshot.sourceSnapshot, "下游结算正式来源");
    const affiliate = frozenAffiliateFromJson(source, "下游结算");
    const occurredAt = requiredJsonDate(source, "occurredAt", "下游结算");
    const confirmedAt = requiredJsonDate(source, "confirmedAt", "下游结算");
    const effectiveDate = requiredJsonDate(
      source,
      "operatingLedgerEffectiveDate",
      "下游结算"
    );
    const signedAmountCents = requiredJsonMoney(source, "amountCents", "下游结算");
    const signedPayableCents = requiredJsonMoney(
      source,
      "payableAmountCents",
      "下游结算"
    );
    if (signedAmountCents === 0n) {
      throw new BadRequestException("零金额结算不产生经营金额事实");
    }
    const amountCents = absolute(signedAmountCents);
    const costCategoryCode = costCategory(
      requiredJsonText(source, "contractTypeKey", "下游结算")
    );
    const debtor = payerSubject(source, affiliate.businessPartyVersionId);
    const creditor = {
      kind: "downstream_counterparty" as const,
      id: requiredJsonText(source, "counterpartyVersionId", "下游结算")
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
          signedAmountCents > 0n ? "生效结算确认项目成本" : "负向结算冲减项目成本"
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
          signedPayableCents > 0n ? "生效结算增加下游应付" : "负向结算冲减下游应付"
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
        "下游结算"
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
        authority: "confirmed_settlement_archive",
        archiveEvidenceId: requiredJsonText(
          source,
          "archiveEvidenceId",
          "下游结算"
        )
      }),
      subjects: { debtor, creditor },
        impacts
      }
    };
  }

  private async snapshot(
    tx: Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0],
    row: {
      id: string;
      projectId: string;
      contractId: string;
      contractVersionId: string;
      code: string;
      amountCents: bigint;
      payableAmountCents: bigint;
      periodEnd: Date | null;
      calculationVersion: number | null;
      governanceVersion: number | null;
      sourceType?: string;
      sourceTakeoverId?: string | null;
      updatedAt: Date;
    }
  ): Promise<OperatingSourceSnapshot | null> {
    const [contract, version, counterparty, confirmation] = await Promise.all([
      tx.contract.findUnique({
        where: { id: row.contractId },
        select: { contractTypeKey: true }
      }),
      tx.contractVersion.findUnique({
        where: { id: row.contractVersionId },
        select: {
          signingSubjectType: true,
          companyEntityVersionId: true,
          affiliateAssignmentId: true,
          affiliateBusinessPartyVersionId: true
        }
      }),
      tx.contractPartySnapshot.findFirst({
        where: { contractVersionId: row.contractVersionId, roleKey: "party_b" },
        select: { businessPartyVersionId: true, snapshot: true },
        orderBy: { displayOrder: "asc" }
      }),
      this.confirmation(
        tx,
        row.id,
        row.governanceVersion,
        row.sourceType,
        row.sourceTakeoverId
      )
    ]);
    if (!confirmation) return null;
    if (!contract?.contractTypeKey || !version || !counterparty?.businessPartyVersionId) {
      throw new BadRequestException("生效结算缺少合同类型、签约主体或下游相对方快照");
    }
    const occurredAt = row.periodEnd ?? confirmation.occurredAt;
    const [effectiveDate, affiliate] = await Promise.all([
      readOperatingLedgerEffectiveDate(tx, row.projectId),
      readAffiliateSnapshot(tx, {
        projectId: row.projectId,
        occurredAt,
        assignmentId: version.affiliateAssignmentId,
        businessPartyVersionId: version.affiliateBusinessPartyVersionId
      })
    ]);
    const counterpartySnapshot = counterparty.snapshot as Record<string, unknown>;
    return {
      projectId: row.projectId,
      sourceType: this.sourceType,
      sourceBusinessId: row.id,
      sourceBusinessCode: row.code,
      sourceVersion: row.calculationVersion ?? row.governanceVersion ?? 1,
      status: "confirmed",
      sourceSnapshot: sourceJson({
        formalStatus: "confirmed",
        contractId: row.contractId,
        contractVersionId: row.contractVersionId,
        contractTypeKey: contract.contractTypeKey,
        signingSubjectType: version.signingSubjectType,
        companyEntityVersionId: version.companyEntityVersionId,
        counterpartyVersionId: counterparty.businessPartyVersionId,
        counterpartyName:
          typeof counterpartySnapshot.name === "string"
            ? counterpartySnapshot.name
            : null,
        amountCents: row.amountCents.toString(),
        payableAmountCents: row.payableAmountCents.toString(),
        occurredAt: occurredAt.toISOString(),
        confirmedByUserId: confirmation.confirmedByUserId,
        confirmedAt: confirmation.confirmedAt.toISOString(),
        archiveEvidenceId: confirmation.evidenceId,
        operatingLedgerEffectiveDate: effectiveDate.toISOString(),
        affiliate
      })
    };
  }

  private async confirmation(
    tx: Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0],
    settlementId: string,
    governanceVersion: number | null,
    sourceType?: string,
    sourceTakeoverId?: string | null
  ): Promise<{
    evidenceId: string;
    confirmedByUserId: string;
    confirmedAt: Date;
    occurredAt: Date;
  } | null> {
    if (sourceType === "historical_takeover" && sourceTakeoverId) {
      const [takeover, facts, evidence] = await Promise.all([
        tx.contractTakeover.findUnique({
          where: { id: sourceTakeoverId },
          select: {
            activatedAt: true,
            activatedByUserId: true,
            confirmedByUserId: true,
            takeoverLevel: true,
            signedAt: true
          }
        }),
        tx.contractTakeoverContractFacts.findUnique({
          where: { takeoverId: sourceTakeoverId },
          select: { signedAt: true, contractFactsSnapshot: true }
        }),
        tx.contractTakeoverSettlementEvidence.findFirst({
          where: { takeoverId: sourceTakeoverId },
          select: { id: true }
        })
      ]);
      const confirmedByUserId =
        takeover?.activatedByUserId ?? takeover?.confirmedByUserId;
      if (
        !takeover?.activatedAt ||
        !confirmedByUserId ||
        !evidence ||
        !["A", "B"].includes(takeover.takeoverLevel)
      ) {
        return null;
      }
      const historicalDate = readHistoricalSettlementDate(facts, takeover.signedAt);
      return {
        evidenceId: evidence.id,
        confirmedByUserId,
        confirmedAt: takeover.activatedAt,
        occurredAt: historicalDate
      };
    }
    if (governanceVersion === 1) {
      const document = await tx.settlementSignedDocument.findFirst({
        where: {
          settlementId,
          purpose: "final_internal_signed_copy",
          status: "active",
          confirmedByUserId: { not: null },
          confirmedAt: { not: null }
        },
        select: { id: true, confirmedByUserId: true, confirmedAt: true },
        orderBy: { confirmedAt: "desc" }
      });
      return document?.confirmedByUserId && document.confirmedAt
        ? {
            evidenceId: document.id,
            confirmedByUserId: document.confirmedByUserId,
            confirmedAt: document.confirmedAt,
            occurredAt: document.confirmedAt
          }
        : null;
    }
    const archive = await tx.settlementArchiveFile.findFirst({
      where: {
        settlementId,
        status: "confirmed",
        confirmedByUserId: { not: null },
        confirmedAt: { not: null }
      },
      select: { id: true, confirmedByUserId: true, confirmedAt: true },
      orderBy: { confirmedAt: "desc" }
    });
    return archive?.confirmedByUserId && archive.confirmedAt
      ? {
          evidenceId: archive.id,
          confirmedByUserId: archive.confirmedByUserId,
          confirmedAt: archive.confirmedAt,
          occurredAt: archive.confirmedAt
        }
      : null;
  }
}

function readHistoricalSettlementDate(
  facts: {
    signedAt: Date;
    contractFactsSnapshot: Prisma.JsonValue;
  } | null,
  fallback: Date
): Date {
  if (
    facts?.contractFactsSnapshot &&
    typeof facts.contractFactsSnapshot === "object" &&
    !Array.isArray(facts.contractFactsSnapshot)
  ) {
    const candidate = (facts.contractFactsSnapshot as Record<string, unknown>)[
      "settlementCutoffDate"
    ];
    if (typeof candidate === "string") {
      const parsed = new Date(candidate);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
  }
  return facts?.signedAt ?? fallback;
}

function costCategory(contractTypeKey: string): PrimaryCostCategoryCode {
  const category = CONTRACT_COST_CATEGORY[contractTypeKey];
  if (!category) {
    throw new BadRequestException("当前合同类型尚未接入经营成本分类");
  }
  return category;
}

function payerSubject(
  source: Record<string, import("@prisma/client").Prisma.InputJsonValue>,
  affiliateVersionId: string
) {
  const signingSubjectType = requiredJsonText(
    source,
    "signingSubjectType",
    "下游结算"
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
      id: requiredJsonText(source, "companyEntityVersionId", "下游结算")
    };
  }
  throw new BadRequestException("下游结算签约主体类型不正确");
}

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value;
}
