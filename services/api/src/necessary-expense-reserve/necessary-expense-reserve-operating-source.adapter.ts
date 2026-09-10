import { BadRequestException } from "@nestjs/common";
import {
  NECESSARY_EXPENSE_RESERVE_SOURCE_TYPE
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

export class NecessaryExpenseReserveOperatingSourceAdapter
  implements OperatingSourceAdapter {
  readonly sourceType = NECESSARY_EXPENSE_RESERVE_SOURCE_TYPE;

  async readProjectSnapshots(
    tx: Parameters<OperatingSourceAdapter["readProjectSnapshots"]>[0],
    projectId: string
  ): Promise<readonly OperatingSourceSnapshot[]> {
    const rows = await tx.projectNecessaryExpenseReserveEntry.findMany({
      where: { status: "confirmed", reserve: { projectId } },
      include: { reserve: true },
      orderBy: [{ confirmedAt: "asc" }, { id: "asc" }]
    });
    return rows.map((row) => this.snapshot(row));
  }

  async readSourceSnapshot(
    tx: Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0],
    locator: OperatingSourceLocator
  ): Promise<OperatingSourceSnapshot | null> {
    if (locator.sourceType !== this.sourceType) return null;
    const row = await tx.projectNecessaryExpenseReserveEntry.findFirst({
      where: {
        id: locator.sourceBusinessId,
        status: "confirmed",
        reserve: { projectId: locator.projectId }
      },
      include: { reserve: true }
    });
    return row ? this.snapshot(row) : null;
  }

  toOperatingFactInput(snapshot: OperatingSourceSnapshot): OperatingSourceFactInput {
    const source = requiredJsonRecord(snapshot.sourceSnapshot, "必要费用准备正式来源");
    if (requiredJsonText(source, "schema", "必要费用准备") !== "project_necessary_expense_reserve_entry/V1") {
      throw new BadRequestException("必要费用准备来源快照版本不正确");
    }
    const reserveId = requiredJsonText(source, "reserveId", "必要费用准备");
    const entryId = requiredJsonText(source, "entryId", "必要费用准备");
    const entryKind = requiredJsonText(source, "entryKind", "必要费用准备");
    const amountCents = requiredJsonMoney(source, "amountCents", "必要费用准备");
    const occurredAt = requiredJsonDate(source, "occurredAt", "必要费用准备");
    const confirmedAt = requiredJsonDate(source, "confirmedAt", "必要费用准备");
    const effectiveDate = source.operatingLedgerEffectiveDate
      ? requiredJsonDate(source, "operatingLedgerEffectiveDate", "必要费用准备")
      : occurredAt;
    const affiliate = requiredJsonRecord(source.affiliate, "必要费用准备施工企业");
    const holder = requiredJsonRecord(source.fundHolder, "必要费用准备资金持有主体");
    const holderKind = requiredJsonText(holder, "kind", "必要费用准备");
    if (holderKind !== "construction_enterprise" && holderKind !== "participating_company") {
      throw new BadRequestException("必要费用准备资金持有主体不正确");
    }
    if (entryId !== snapshot.sourceBusinessId || snapshot.sourceType !== this.sourceType) {
      throw new BadRequestException("必要费用准备来源坐标不一致");
    }
    const direction = entryKind === "establish" || entryKind === "increase"
      ? "increase" as const
      : entryKind === "release" || entryKind === "technical_reversal"
        ? "decrease" as const
        : null;
    if (!direction) throw new BadRequestException("必要费用准备分录类型不正确");
    const technicalReversal = entryKind === "technical_reversal";
    const adjustsEntryId = optionalJsonText(source, "adjustsEntryId");
    if (technicalReversal && !adjustsEntryId) {
      throw new BadRequestException("必要费用准备技术冲销缺少原经营事实引用");
    }
    const fingerprint = requiredJsonText(source, "fingerprint", "必要费用准备");
    const adjustsEntryKind = technicalReversal
      ? requiredJsonText(source, "adjustsEntryKind", "必要费用准备技术冲销")
      : null;
    if (
      adjustsEntryKind &&
      adjustsEntryKind !== "establish" &&
      adjustsEntryKind !== "increase"
    ) {
      throw new BadRequestException("必要费用准备技术冲销只能引用建立或增加分录");
    }
    const adjustsEntryFingerprint = technicalReversal
      ? requiredJsonText(source, "adjustsEntryFingerprint", "必要费用准备技术冲销")
      : null;
    const holderSubject = {
      kind: holderKind,
      id: requiredJsonText(holder, "id", "必要费用准备")
    } as const;
    const impact: AppendOperatingFactInput["impacts"][number] = {
      idempotencyKey: `necessary-expense-reserve:${entryId}:cash-restriction`,
      sourceImpactKey: technicalReversal
        ? `${adjustsEntryKind}:cash-restriction`
        : `${entryKind}:cash-restriction`,
      impactKind: technicalReversal
        ? "necessary_expense_reserve_increase"
        : direction === "increase"
        ? "necessary_expense_reserve_increase"
        : "necessary_expense_reserve_decrease",
      amountCents,
      direction,
      subjectRole: "fund_holder",
      subject: holderSubject,
      description: "其他必要费用准备",
      impactSnapshot: sourceJson({
        reserveId,
        entryId: technicalReversal ? adjustsEntryId : entryId,
        fingerprint: technicalReversal ? adjustsEntryFingerprint : fingerprint,
        economicIdentityKey: requiredJsonText(source, "economicIdentityKey", "必要费用准备"),
        sourceIdentityKey: requiredJsonText(source, "sourceIdentityKey", "必要费用准备")
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
        idempotencyKey: `necessary-expense-reserve:${entryId}:fact`,
        occurredAt,
        confirmedAt,
        confirmedByUserId: requiredJsonText(source, "confirmedByUserId", "必要费用准备"),
        factKind: "project_cash_restriction",
        operatingLevel: holderKind === "construction_enterprise"
          ? "construction_enterprise"
          : "participating_company",
        evidenceLevel: requiredJsonText(source, "evidenceLevel", "必要费用准备") as "A" | "B",
        amountCents,
        currencyCode: "CNY",
        direction: "neutral",
        isBeforeOperatingLedgerEffectiveDate: occurredBeforeEffectiveDate(occurredAt, effectiveDate),
        affiliateAssignmentId: requiredJsonText(affiliate, "assignmentId", "必要费用准备"),
        affiliateBusinessPartyVersionId: requiredJsonText(
          affiliate,
          "businessPartyVersionId",
          "必要费用准备"
        ),
        affiliateNameSnapshot: requiredJsonText(affiliate, "name", "必要费用准备"),
        ...(optionalJsonText(affiliate, "creditCode")
          ? { affiliateCreditCodeSnapshot: optionalJsonText(affiliate, "creditCode") }
          : {}),
        sourceSnapshot: snapshot.sourceSnapshot,
        basisSnapshot: sourceJson({
          evidenceFileId: requiredJsonText(source, "evidenceFileId", "必要费用准备"),
          evidenceSha256: requiredJsonText(source, "evidenceSha256", "必要费用准备")
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
    reserve: { projectId: string; businessCode: string };
  }): OperatingSourceSnapshot {
    if (
      row.status !== "confirmed" ||
      !row.confirmedAt ||
      !row.confirmedByUserId ||
      !row.payloadSnapshot ||
      typeof row.payloadSnapshot !== "object" ||
      Array.isArray(row.payloadSnapshot)
    ) {
      throw new BadRequestException("必要费用准备只有已确认冻结快照可以进入经营账");
    }
    return {
      projectId: row.reserve.projectId,
      sourceType: this.sourceType,
      sourceBusinessId: row.id,
      sourceBusinessCode: row.reserve.businessCode,
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
