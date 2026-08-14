import { BadRequestException } from "@nestjs/common";

import {
  frozenAffiliateFromJson,
  occurredBeforeEffectiveDate,
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
  OperatingSourceLocator,
  OperatingSourceSnapshot
} from "../operating-ledger/operating-source-adapter";

export const PROJECT_UPSTREAM_SETTLEMENT_SOURCE_TYPE =
  "project_upstream_settlement";

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

  toOperatingFactInput(snapshot: OperatingSourceSnapshot): AppendOperatingFactInput {
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
