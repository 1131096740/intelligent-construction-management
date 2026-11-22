import { BadRequestException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { normalizeBusinessAmount } from "@jiangkong/shared-domain";
import type { OperatingSourceAdapter, OperatingSourceSnapshot } from "../operating-ledger/operating-source-adapter";
import { frozenAffiliateFromJson, occurredBeforeEffectiveDate, requiredJsonDate, requiredJsonRecord,
  requiredJsonText } from "../operating-ledger/formal-operating-source.helpers";

export const CONTRACT_WORK_COMPLETION_SOURCE = "contract_work_completion";
const label = "其他合同履约";

export class ContractWorkCompletionOperatingSourceAdapter implements OperatingSourceAdapter {
  readonly sourceType = CONTRACT_WORK_COMPLETION_SOURCE;

  readProjectSnapshots(tx: Parameters<OperatingSourceAdapter["readProjectSnapshots"]>[0], projectId: string) {
    return this.read(tx, projectId, null, null);
  }

  async readSourceSnapshot(tx: Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0],
    locator: Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[1]) {
    return (await this.read(tx, locator.projectId, locator.sourceBusinessId, null))[0] ?? null;
  }

  async readCompletionSnapshot(tx: Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0],
    projectId: string, completionId: string) {
    return (await this.read(tx, projectId, null, completionId))[0] ?? null;
  }

  private async read(tx: Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0],
    projectId: string, factId: string | null, completionId: string | null) {
    const rows = await tx.$queryRaw<{ id: string; projectId: string; costSnapshot: Prisma.JsonValue }[]>`
      SELECT * FROM public.jg_contract_work_completion_cost_sources_v1(${projectId}::text,${factId}::text,${completionId}::text)
    `;
    return rows.map(row => this.snapshot(row.id, row.projectId, row.costSnapshot));
  }

  private snapshot(id: string, projectId: string, raw: Prisma.JsonValue): OperatingSourceSnapshot {
    const sourceSnapshot = requiredJsonRecord(raw as Prisma.InputJsonValue, label);
    return { projectId, sourceType: this.sourceType, sourceBusinessId: id, sourceVersion: 1,
      sourceBusinessCode: requiredJsonText(sourceSnapshot, "businessCode", label), status: "confirmed", sourceSnapshot };
  }

  toOperatingFactInput(snapshot: OperatingSourceSnapshot): ReturnType<OperatingSourceAdapter["toOperatingFactInput"]> {
    const source = requiredJsonRecord(snapshot.sourceSnapshot, label);
    const affiliate = frozenAffiliateFromJson(source, label);
    const occurredAt = requiredJsonDate(source, "confirmedAt", label);
    const effectiveDate = requiredJsonDate(source, "operatingLedgerEffectiveDate", label);
    const numeric = requiredJsonRecord(source.numericFacts!, label);
    const amountYuan = normalizeBusinessAmount(requiredJsonText(numeric, "amountYuan", label));
    const kind = requiredJsonText(source, "debtorKind", label);
    if (numeric.protocolVersion !== 2 || numeric.amountState !== "known" || amountYuan === null || amountYuan === "0.0000"
      || (kind !== "participating_company" && kind !== "construction_enterprise")) {
      throw new BadRequestException("履约成本缺少四位金额或有效签约主体");
    }
    const debtor = { kind: kind === "participating_company" ? "participating_company" as const : "construction_enterprise" as const, id: requiredJsonText(source, "debtorId", label) };
    const key = `${this.sourceType}:${snapshot.sourceBusinessId}`;
    return { entryKind: "original", input: {
      ...snapshot, idempotencyKey: key, occurredAt, confirmedAt: occurredAt, confirmedByUserId: requiredJsonText(source, "confirmedByUserId", label),
      isBeforeOperatingLedgerEffectiveDate: occurredBeforeEffectiveDate(occurredAt, effectiveDate),
      factKind: "expense", operatingLevel: "project", evidenceLevel: "A", numericProtocolVersion: 2,
      amountCents: null, amountYuan, currencyCode: "CNY", direction: "neutral",
      affiliateAssignmentId: affiliate.assignmentId, affiliateBusinessPartyVersionId: affiliate.businessPartyVersionId,
      affiliateNameSnapshot: affiliate.name, ...(affiliate.creditCode ? { affiliateCreditCodeSnapshot: affiliate.creditCode } : {}),
      subjects: { debtor, costBearingCompany: debtor, creditor: { kind: "downstream_counterparty", id: requiredJsonText(source, "creditorId", label) } },
      basisSnapshot: { authority: this.sourceType, finalActionId: requiredJsonText(source, "finalActionId", label) },
      impacts: [{ idempotencyKey: `${key}:confirmed_cost`, sourceImpactKey: "confirmed_cost", impactKind: "confirmed_cost",
        amountCents: null, numericProtocolVersion: 2, amountYuan, direction: "increase", subjectRole: "debtor",
        subject: debtor, costCategoryCode: "other_project_cost", description: "三职责确认其他合同履约成本" }]
    } };
  }
}
