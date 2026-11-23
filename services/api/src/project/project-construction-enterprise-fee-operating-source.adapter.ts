import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import {
  frozenAffiliateFromJson,
  readAffiliateSnapshot,
  readOperatingLedgerEffectiveDate,
  requiredJsonDate,
  requiredJsonMoney,
  requiredJsonRecord,
  requiredJsonText,
  optionalJsonText,
  sourceJson
} from "../operating-ledger/formal-operating-source.helpers";
import type { AppendOperatingFactInput } from "../operating-ledger/operating-ledger.service";
import type {
  OperatingSourceAdapter,
  OperatingSourceFactInput,
  OperatingSourceLocator,
  OperatingSourceSnapshot
} from "../operating-ledger/operating-source-adapter";

/**
 * #414 / OPS-08：施工企业实际扣费的**成本贡献**来源。
 *
 * 与 `project_upstream_fund_fact` 分开：
 * - 上游资金来源只登记施工企业持有资金减少，绝不产 `confirmed_cost`（POL-08 口径）；
 * - 本来源只在扣费确认（或更正确认）事务内追加，恰好产生一条 `confirmed_cost`；
 * - 反向事实产 `decrease`，重登事实产 `increase`，净额由经营投影统一汇总；
 * - 付款、已签结算、履约确认等其他来源不因此改变。
 */
export const CONSTRUCTION_ENTERPRISE_FEE_SOURCE_TYPE =
  "construction_enterprise_fee";

interface AffiliateDeductionSourceRow {
  id: string;
  projectId: string;
  entryKind: string;
  adjustsFactId: string | null;
  effectDirection: string;
  occurredAt: Date;
  amountCents: bigint;
  counterpartyName: string;
  basisType: string;
  deductionCategory: string | null;
  description: string | null;
  evidenceFileId: string | null;
  documentVersion: number;
  fileContentSha256Snapshot: string | null;
  affiliateAssignmentId: string;
  affiliateBusinessPartyVersionId: string;
  affiliateNameSnapshot: string;
  recordedByUserId: string;
  confirmedByUserId: string | null;
  confirmedAt: Date | null;
}

function sourceEntryKind(value: string): OperatingSourceFactInput["entryKind"] {
  if (value === "original") return "original";
  if (value === "reversal") return "reversal";
  if (value === "correction" || value === "reclassification") return "correction";
  throw new BadRequestException("施工企业扣费成本来源登记类型不正确");
}

function sourceDirection(value: string): "increase" | "decrease" {
  if (value === "increase") return "increase";
  if (value === "decrease") return "decrease";
  throw new BadRequestException("施工企业扣费成本来源方向不正确");
}

export class ConstructionEnterpriseFeeOperatingSourceAdapter
  implements OperatingSourceAdapter
{
  readonly sourceType = CONSTRUCTION_ENTERPRISE_FEE_SOURCE_TYPE;

  async readProjectSnapshots(
    tx: Parameters<OperatingSourceAdapter["readProjectSnapshots"]>[0],
    projectId: string
  ): Promise<readonly OperatingSourceSnapshot[]> {
    const rows = await tx.projectUpstreamFundFact.findMany({
      where: {
        projectId,
        factType: "affiliate_deduction",
        status: "confirmed",
        confirmedByUserId: { not: null },
        confirmedAt: { not: null }
      },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }]
    });
    return Promise.all(rows.map((row) => this.snapshot(tx, row)));
  }

  async readSourceSnapshot(
    tx: Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0],
    locator: OperatingSourceLocator
  ): Promise<OperatingSourceSnapshot | null> {
    const row = await tx.projectUpstreamFundFact.findFirst({
      where: {
        id: locator.sourceBusinessId,
        projectId: locator.projectId,
        factType: "affiliate_deduction",
        status: "confirmed",
        confirmedByUserId: { not: null },
        confirmedAt: { not: null }
      }
    });
    return row ? this.snapshot(tx, row) : null;
  }

  toOperatingFactInput(snapshot: OperatingSourceSnapshot): OperatingSourceFactInput {
    const source = requiredJsonRecord(snapshot.sourceSnapshot, "施工企业扣费成本");
    const affiliate = frozenAffiliateFromJson(source, "施工企业扣费成本");
    const entryKind = sourceEntryKind(requiredJsonText(source, "entryKind", "施工企业扣费成本"));
    const effectDirection = sourceDirection(
      requiredJsonText(source, "effectDirection", "施工企业扣费成本")
    );
    const amountCents = requiredJsonMoney(source, "amountCents", "施工企业扣费成本");
    if (amountCents <= 0n) {
      throw new BadRequestException("施工企业扣费成本金额必须大于 0");
    }
    const occurredAt = requiredJsonDate(source, "occurredAt", "施工企业扣费成本");
    const confirmedAt = requiredJsonDate(source, "confirmedAt", "施工企业扣费成本");
    const effectiveDate = requiredJsonDate(
      source,
      "operatingLedgerEffectiveDate",
      "施工企业扣费成本"
    );
    const confirmedByUserId = requiredJsonText(
      source,
      "confirmedByUserId",
      "施工企业扣费成本"
    );
    const enterprise = {
      kind: "construction_enterprise" as const,
      id: affiliate.businessPartyVersionId
    };
    const feeName = optionalJsonText(source, "feeName") ?? "施工企业扣费";
    const adjustsFactId = optionalJsonText(source, "adjustsFactId");
    const direction = effectDirection;
    const impacts: AppendOperatingFactInput["impacts"] = [
      {
        idempotencyKey: `${snapshot.sourceType}:${snapshot.sourceBusinessId}:confirmed_cost`,
        sourceImpactKey: "confirmed_cost",
        impactKind: "confirmed_cost",
        amountCents,
        direction,
        subjectRole: "cost_bearing_company",
        subject: enterprise,
        costCategoryCode: "other_project_cost",
        description:
          entryKind === "reversal"
            ? `施工企业扣费冲减项目成本：${feeName}`
            : `施工企业扣费确认项目成本：${feeName}`
      }
    ];
    return {
      entryKind,
      input: {
        projectId: snapshot.projectId,
        sourceType: snapshot.sourceType,
        sourceBusinessId: snapshot.sourceBusinessId,
        sourceBusinessCode: snapshot.sourceBusinessCode,
        sourceVersion: snapshot.sourceVersion,
        idempotencyKey: `${snapshot.sourceType}:${snapshot.sourceBusinessId}`,
        occurredAt,
        confirmedAt,
        confirmedByUserId,
        affiliateAssignmentId: requiredJsonText(source, "affiliateAssignmentId", "施工企业扣费成本"),
        affiliateBusinessPartyVersionId: requiredJsonText(
          source,
          "affiliateBusinessPartyVersionId",
          "施工企业扣费成本"
        ),
        affiliateNameSnapshot: requiredJsonText(
          source,
          "affiliateNameSnapshot",
          "施工企业扣费成本"
        ),
        ...(optionalJsonText(source, "affiliateCreditCodeSnapshot")
          ? { affiliateCreditCodeSnapshot: optionalJsonText(source, "affiliateCreditCodeSnapshot") }
          : {}),
        factKind: "expense",
        operatingLevel: "construction_enterprise",
        evidenceLevel: optionalJsonText(source, "evidenceFileId") ? "A" : "B",
        amountCents,
        currencyCode: "CNY",
        direction: "outflow",
        isBeforeOperatingLedgerEffectiveDate: occurredAt < effectiveDate,
        subjects: { costBearingCompany: enterprise },
        impacts,
        ...(entryKind === "original" || !adjustsFactId ? {} : { adjustsFactId }),
        sourceSnapshot: snapshot.sourceSnapshot,
        basisSnapshot: sourceJson({
          authority: "confirmed_project_upstream_fund_fact",
          feeName,
          deductionCategory: optionalJsonText(source, "deductionCategory"),
          basisType: requiredJsonText(source, "basisType", "施工企业扣费成本"),
          evidenceFileId: optionalJsonText(source, "evidenceFileId") ?? null
        })
      }
    };
  }

  private async snapshot(
    tx: Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0],
    row: AffiliateDeductionSourceRow
  ): Promise<OperatingSourceSnapshot> {
    if (!row.confirmedByUserId || !row.confirmedAt) {
      throw new BadRequestException("施工企业扣费缺少正式确认人或确认时间");
    }
    const [effectiveDate, affiliate] = await Promise.all([
      readOperatingLedgerEffectiveDate(tx, row.projectId),
      readAffiliateSnapshot(tx, {
        projectId: row.projectId,
        occurredAt: row.occurredAt,
        assignmentId: row.affiliateAssignmentId,
        businessPartyVersionId: row.affiliateBusinessPartyVersionId
      })
    ]);
    return {
      projectId: row.projectId,
      sourceType: this.sourceType,
      sourceBusinessId: row.id,
      sourceBusinessCode: `施工企业扣费/${row.id}`,
      sourceVersion: 1,
      status: "confirmed",
      sourceSnapshot: {
        entryKind: row.entryKind,
        adjustsFactId: row.adjustsFactId,
        effectDirection: row.effectDirection,
        amountCents: row.amountCents.toString(),
        occurredAt: row.occurredAt.toISOString(),
        confirmedAt: row.confirmedAt.toISOString(),
        confirmedByUserId: row.confirmedByUserId,
        affiliate: {
          assignmentId: affiliate.assignmentId,
          businessPartyVersionId: affiliate.businessPartyVersionId,
          name: affiliate.name,
          ...(affiliate.creditCode ? { creditCode: affiliate.creditCode } : {})
        },
        affiliateAssignmentId: affiliate.assignmentId,
        affiliateBusinessPartyVersionId: affiliate.businessPartyVersionId,
        affiliateNameSnapshot: affiliate.name,
        affiliateCreditCodeSnapshot: affiliate.creditCode ?? null,
        feeName: row.description,
        deductionCategory: row.deductionCategory,
        basisType: row.basisType,
        evidenceFileId: row.evidenceFileId,
        operatingLedgerEffectiveDate: effectiveDate.toISOString(),
        isBeforeOperatingLedgerEffectiveDate: row.occurredAt < effectiveDate
      } as Prisma.InputJsonObject
    };
  }
}
