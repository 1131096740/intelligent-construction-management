import { BadRequestException } from "@nestjs/common";
import {
  PROJECT_FUND_DISPUTE_SOURCE_TYPE
} from "@jiangkong/shared-domain";

import {
  occurredBeforeEffectiveDate,
  optionalJsonText,
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

export class ProjectFundDisputeOperatingSourceAdapter
  implements OperatingSourceAdapter {
  readonly sourceType = PROJECT_FUND_DISPUTE_SOURCE_TYPE;

  async readProjectSnapshots(
    tx: Parameters<OperatingSourceAdapter["readProjectSnapshots"]>[0],
    projectId: string
  ): Promise<readonly OperatingSourceSnapshot[]> {
    const rows = await tx.projectFundDisputeEntry.findMany({
      where: { status: "confirmed", dispute: { projectId } },
      include: { dispute: true },
      orderBy: [{ confirmedAt: "asc" }, { id: "asc" }]
    });
    return rows.map((row) => this.snapshot(row));
  }

  async readSourceSnapshot(
    tx: Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0],
    locator: OperatingSourceLocator
  ): Promise<OperatingSourceSnapshot | null> {
    if (locator.sourceType !== this.sourceType) return null;
    const row = await tx.projectFundDisputeEntry.findFirst({
      where: {
        id: locator.sourceBusinessId,
        status: "confirmed",
        dispute: { projectId: locator.projectId }
      },
      include: { dispute: true }
    });
    return row ? this.snapshot(row) : null;
  }

  toOperatingFactInput(snapshot: OperatingSourceSnapshot): OperatingSourceFactInput {
    const source = requiredJsonRecord(snapshot.sourceSnapshot, "一般争议资金正式来源");
    if (requiredJsonText(source, "schema", "一般争议资金") !== "project_fund_dispute_entry/V1") {
      throw new BadRequestException("一般争议资金来源快照版本不正确");
    }
    const disputeId = requiredJsonText(source, "disputeId", "一般争议资金");
    const entryId = requiredJsonText(source, "entryId", "一般争议资金");
    const entryKind = requiredJsonText(source, "entryKind", "一般争议资金");
    const amountCents = requiredJsonMoney(source, "amountCents", "一般争议资金");
    const occurredAt = requiredJsonDate(source, "occurredAt", "一般争议资金");
    const confirmedAt = requiredJsonDate(source, "confirmedAt", "一般争议资金");
    const effectiveDate = source.operatingLedgerEffectiveDate
      ? requiredJsonDate(source, "operatingLedgerEffectiveDate", "一般争议资金")
      : occurredAt;
    const affiliate = requiredJsonRecord(source.affiliate, "一般争议资金施工企业");
    const holder = requiredJsonRecord(source.fundHolder, "一般争议资金资金持有主体");
    const holderKind = requiredJsonText(holder, "kind", "一般争议资金");
    if (holderKind !== "construction_enterprise" && holderKind !== "participating_company") {
      throw new BadRequestException("一般争议资金资金持有主体不正确");
    }
    if (entryId !== snapshot.sourceBusinessId || snapshot.sourceType !== this.sourceType) {
      throw new BadRequestException("一般争议资金来源坐标不一致");
    }
    const direction = entryKind === "establish" || entryKind === "increase"
      ? "increase" as const
      : entryKind === "release" || entryKind === "technical_reversal"
        ? "decrease" as const
        : null;
    if (!direction) throw new BadRequestException("一般争议资金分录类型不正确");
    const technicalReversal = entryKind === "technical_reversal";
    const adjustsEntryId = optionalJsonText(source, "adjustsEntryId");
    if (technicalReversal && !adjustsEntryId) {
      throw new BadRequestException("一般争议资金技术冲销缺少原经营事实引用");
    }
    const fingerprint = requiredJsonText(source, "fingerprint", "一般争议资金");
    const adjustsEntryKind = technicalReversal
      ? requiredJsonText(source, "adjustsEntryKind", "一般争议资金技术冲销")
      : null;
    if (
      adjustsEntryKind &&
      adjustsEntryKind !== "establish" &&
      adjustsEntryKind !== "increase"
    ) {
      throw new BadRequestException("一般争议资金技术冲销只能引用建立或增加分录");
    }
    const adjustsEntryFingerprint = technicalReversal
      ? requiredJsonText(source, "adjustsEntryFingerprint", "一般争议资金技术冲销")
      : null;
    const holderSubject = {
      kind: holderKind,
      id: requiredJsonText(holder, "id", "一般争议资金")
    } as const;
    const impact: AppendOperatingFactInput["impacts"][number] = {
      idempotencyKey: `project-fund-dispute:${entryId}:cash-restriction`,
      sourceImpactKey: technicalReversal
        ? `${adjustsEntryKind}:cash-restriction`
        : `${entryKind}:cash-restriction`,
      impactKind: technicalReversal
        ? "project_disputed_funds_increase"
        : direction === "increase"
        ? "project_disputed_funds_increase"
        : "project_disputed_funds_decrease",
      amountCents,
      direction,
      subjectRole: "fund_holder",
      subject: holderSubject,
      description: "一般争议资金",
      impactSnapshot: sourceJson({
        disputeId,
        entryId: technicalReversal ? adjustsEntryId : entryId,
        fingerprint: technicalReversal ? adjustsEntryFingerprint : fingerprint,
        economicIdentityKey: requiredJsonText(source, "economicIdentityKey", "一般争议资金"),
        sourceIdentityKey: requiredJsonText(source, "sourceIdentityKey", "一般争议资金")
      })
    };
    return {
      entryKind: technicalReversal ? "reversal" : "original",
      input: {
        projectId: snapshot.projectId,
        sourceType: snapshot.sourceType,
        sourceBusinessId: snapshot.sourceBusinessId,
        sourceBusinessCode: snapshot.sourceBusinessCode,
        sourceVersion: snapshot.sourceVersion,
        idempotencyKey: `project-fund-dispute:${entryId}:fact`,
        occurredAt,
        confirmedAt,
        confirmedByUserId: requiredJsonText(source, "confirmedByUserId", "一般争议资金"),
        factKind: "project_cash_restriction",
        operatingLevel: holderKind === "construction_enterprise"
          ? "construction_enterprise"
          : "participating_company",
        evidenceLevel: requiredJsonText(source, "evidenceLevel", "一般争议资金") as "A" | "B",
        amountCents,
        currencyCode: "CNY",
        direction: "neutral",
        isBeforeOperatingLedgerEffectiveDate: occurredBeforeEffectiveDate(occurredAt, effectiveDate),
        affiliateAssignmentId: requiredJsonText(affiliate, "assignmentId", "一般争议资金"),
        affiliateBusinessPartyVersionId: requiredJsonText(
          affiliate,
          "businessPartyVersionId",
          "一般争议资金"
        ),
        affiliateNameSnapshot: requiredJsonText(affiliate, "name", "一般争议资金"),
        ...(optionalJsonText(affiliate, "creditCode")
          ? { affiliateCreditCodeSnapshot: optionalJsonText(affiliate, "creditCode") }
          : {}),
        sourceSnapshot: snapshot.sourceSnapshot,
        basisSnapshot: sourceJson({
          evidenceFileId: requiredJsonText(source, "evidenceFileId", "一般争议资金"),
          evidenceSha256: requiredJsonText(source, "evidenceSha256", "一般争议资金")
        }),
        subjects: {},
        impacts: [impact],
        // Replay resolves the source entry coordinate to the immutable fact id.
        ...(technicalReversal ? { adjustsFactId: adjustsEntryId } : {})
      }
    };
  }

  private snapshot(row: {
    id: string;
    draftRevision: number;
    status: string;
    payloadSnapshot: unknown;
    confirmedAt: Date | null;
    confirmedByUserId: string | null;
    dispute: { projectId: string; businessCode: string };
  }): OperatingSourceSnapshot {
    if (
      row.status !== "confirmed" ||
      !row.confirmedAt ||
      !row.confirmedByUserId ||
      !row.payloadSnapshot ||
      typeof row.payloadSnapshot !== "object" ||
      Array.isArray(row.payloadSnapshot)
    ) {
      throw new BadRequestException("一般争议资金只有已确认冻结快照可以进入经营账");
    }
    return {
      projectId: row.dispute.projectId,
      sourceType: this.sourceType,
      sourceBusinessId: row.id,
      sourceBusinessCode: row.dispute.businessCode,
      sourceVersion: row.draftRevision,
      status: "confirmed",
      sourceSnapshot: {
        ...(row.payloadSnapshot as Record<string, unknown>),
        confirmedAt: row.confirmedAt.toISOString(),
        confirmedByUserId: row.confirmedByUserId
      } as never
    };
  }
}
