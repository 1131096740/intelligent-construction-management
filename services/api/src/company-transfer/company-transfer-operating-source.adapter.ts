import { repaymentOwnershipDate } from "./company-transfer-ownership";
import { legacyRepaymentSnapshot } from "./company-transfer-legacy-operating";
import type { OperatingImpactInput, OperatingFactSubjects } from "../operating-ledger/operating-ledger.service";
import type { OperatingSourceAdapter, OperatingSourceSnapshot, OperatingSourceFactInput } from "../operating-ledger/operating-source-adapter";
import { readAffiliateSnapshot, readOperatingLedgerEffectiveDate, sourceJson } from "../operating-ledger/formal-operating-source.helpers";
type CompanyImpact = Extract<OperatingImpactInput, { amountCents: bigint }>;
type CompanySubject = { kind: "participating_company"; id: string };
interface TransferOperatingSnapshot {
  thirdPartyRepayment?: boolean;
  repaymentDebtorCompanyId?: string | null;
  sourceCompanyId: string;
  destinationCompanyId: string;
  legacyRepayment?: boolean;
  originalSubjects?: OperatingFactSubjects;
  legacyImpacts?: Array<Omit<CompanyImpact, "amountCents" | "idempotencyKey"> & { originalImpactId: string }>;
  originalProxyId?: string;
  proxySource?: { debtor: CompanySubject; actualPayer: CompanySubject };
  eventKind: string;
  refundId?: string;
  companyId: string;
  amountCents: string;
  occurredAt: string;
  confirmedAt: string;
  confirmedByUserId: string;
  operatingLedgerEffectiveDate: string;
  affiliate: { assignmentId: string; businessPartyVersionId: string; name: string; creditCode?: string };
}

export class CompanyTransferOperatingSourceAdapter implements OperatingSourceAdapter {
  readonly sourceType = "company_transfer_event";
  async readProjectSnapshots(tx: Parameters<OperatingSourceAdapter["readProjectSnapshots"]>[0], projectId: string) {
    const transfers = await tx.companyTransfer.findMany({ where: { OR: [{ sourceProjectId: projectId }, { destinationProjectId: projectId }] }, select: { id: true } });
    const events = await tx.companyTransferEvent.findMany({ where: { transferId: { in: transfers.map(t => t.id) } } });
    const snapshots: OperatingSourceSnapshot[] = [];
    for (const event of events) {
      const locator = { projectId, sourceType: this.sourceType, sourceBusinessId: event.id };
      const snapshot = await this.readSourceSnapshot(tx, locator);
      if (snapshot) snapshots.push(snapshot);
      if (event.returnedIncomingEventId) {
        const destination = await this.readSourceSnapshot(tx, { ...locator, sourceBusinessId: `${event.id}:refund_destination` });
        if (destination) snapshots.push(destination);
      }
      if (event.kind !== "incoming" && !event.returnedIncomingEventId) continue;
      const transfer = await tx.companyTransfer.findUniqueOrThrow({ where: { id: event.transferId } });
      if (!transfer.originalFundMovementRelationshipId) continue;
      const root = await tx.fundMovementRelationshipEntry.findUniqueOrThrow({ where: { id: transfer.originalFundMovementRelationshipId } });
      for (const leg of await tx.fundMovementLeg.findMany({ where: { movementId: root.movementId, projectId } })) {
        const debt = await legacyRepaymentSnapshot(tx, event.id, leg.id, projectId);
        if (debt) snapshots.push(debt);
      }
    }
    return snapshots;
  }
  async readSourceSnapshot(tx: Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0], locator: Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[1]): Promise<OperatingSourceSnapshot | null> {
    const [eventId, marker, legId] = locator.sourceBusinessId.split(":");
    if (marker === "relationship") return legacyRepaymentSnapshot(tx, eventId, legId, locator.projectId);
    const e = await tx.companyTransferEvent.findUnique({ where: { id: eventId } });
    if (!e || marker && (marker !== "refund_destination" || !e.returnedIncomingEventId)) return null;
    const t = await tx.companyTransfer.findUniqueOrThrow({ where: { id: e.transferId } });
    const incoming = e.kind === "incoming" || marker === "refund_destination";
    const projectId = incoming ? t.destinationProjectId : t.sourceProjectId;
    if (!projectId || projectId !== locator.projectId) return null;
    const refund = e.returnedIncomingEventId ? await tx.paymentExecutionRefund.findUniqueOrThrow({
      where: { companyTransferReturnEventId: e.id },
      select: { id: true, companyTransferDebtCorrection: { select: { targetOriginalSource: true } } },
    }) : null;
    const correctedSource = refund?.companyTransferDebtCorrection?.targetOriginalSource;
    const originalProxyId = correctedSource
      ? correctedSource.startsWith("proxy:") ? correctedSource.split(":")[1] : null
      : t.originalProxyId;
    const proxy = originalProxyId ? await tx.contractProxyExecution.findUniqueOrThrow({ where: { id: originalProxyId } }) : null;
    const affiliate = await readAffiliateSnapshot(tx, {
      projectId, occurredAt: await repaymentOwnershipDate(tx, locator) ?? e.occurredAt,
    });
    const effective = await readOperatingLedgerEffectiveDate(tx, projectId);
    return {
      projectId, sourceType: this.sourceType, sourceBusinessId: locator.sourceBusinessId,
      sourceBusinessCode: t.code, sourceVersion: 1, status: "confirmed",
      sourceSnapshot: sourceJson({
        contractRelationship: "non_contract", originalProxyId, proxySource: proxy?.frozenSource ?? null,
        eventKind: marker === "refund_destination" ? "refund_destination" : e.kind,
        ...(refund && { refundId: refund.id, returnedIncomingEventId: e.returnedIncomingEventId }),
        transferKind: t.kind, transferId: t.id, sourceCompanyId: t.sourceCompanyId, destinationCompanyId: t.destinationCompanyId,
        repaymentDebtorCompanyId: t.repaymentDebtorCompanyId,
        thirdPartyRepayment: !!t.repaymentDebtorCompanyId && t.repaymentDebtorCompanyId !== t.sourceCompanyId,
        companyId: incoming ? t.destinationCompanyId : t.sourceCompanyId, amountCents: e.amountCents.toString(),
        occurredAt: e.occurredAt.toISOString(), confirmedAt: e.createdAt.toISOString(), confirmedByUserId: e.recordedByUserId,
        bankObservationId: e.observationId, affiliate, operatingLedgerEffectiveDate: effective.toISOString(), frozenParties: t.frozenParties,
      }),
    };
  }
  toOperatingFactInput(s: OperatingSourceSnapshot): OperatingSourceFactInput {
    const v = s.sourceSnapshot as unknown as TransferOperatingSnapshot;
    const refundDestination = v.eventKind === "refund_destination";
    const applyDebt = v.eventKind === "incoming" || refundDestination;
    const direction = v.eventKind === "outgoing" || refundDestination ? "decrease" : "increase";
    const key = `${this.sourceType}:${s.sourceBusinessId}`;
    const amountCents = BigInt(v.amountCents);
    const occurredAt = new Date(v.occurredAt);
    const subjects: OperatingFactSubjects = v.legacyRepayment
      ? v.originalSubjects ?? {}
      : v.proxySource
        ? { debtor: v.proxySource.debtor, actualPayer: v.proxySource.actualPayer }
        : v.thirdPartyRepayment && v.repaymentDebtorCompanyId
          ? { debtor: { kind: "participating_company", id: v.repaymentDebtorCompanyId },
              actualPayer: { kind: "participating_company", id: v.sourceCompanyId } }
          : {};
    const impacts: CompanyImpact[] = [];
    if (v.legacyRepayment) {
      for (const impact of v.legacyImpacts ?? []) {
        impacts.push({
          ...impact, sourceImpactKey: impact.originalImpactId, idempotencyKey: `${s.sourceBusinessId}:${impact.originalImpactId}`,
          amountCents, description: v.refundId ? "到账后退回恢复原资金往来" : "归还到账核销原资金往来",
          impactSnapshot: sourceJson({ originalImpactId: impact.originalImpactId }),
        });
      }
    } else {
      impacts.push({
        idempotencyKey: `${key}:funds`, sourceImpactKey: "funds", impactKind: `company_project_funds_${direction}`,
        amountCents, direction, subjectRole: "fund_holder", subject: { kind: "participating_company", id: v.companyId },
        description: "互转真实资金变化；不新增项目收入成本", impactSnapshot: sourceJson({ internalTransfer: true }),
      });
      if (applyDebt && v.originalProxyId && v.proxySource) {
        const debtDirection = refundDestination ? "increase" : "decrease";
        impacts.push({
          idempotencyKey: `${key}:relationship`, sourceImpactKey: "relationship",
          impactKind: `inter_subject_balance_${debtDirection}`, amountCents, direction: debtDirection,
          subjectRole: "actual_payer", subject: v.proxySource.actualPayer,
          description: refundDestination ? "到账后退回恢复原公司代付往来" : "归还已到账，核销原公司代付往来",
          impactSnapshot: sourceJson({ debtor: v.proxySource.debtor, actualPayer: v.proxySource.actualPayer, originalProxyId: v.originalProxyId, internalTransfer: true }),
        });
      }
      if (applyDebt && v.thirdPartyRepayment && v.repaymentDebtorCompanyId) {
        const debtDirection = refundDestination ? "decrease" : "increase";
        impacts.push({
          idempotencyKey: `${key}:on_behalf_relationship`, sourceImpactKey: "on_behalf_relationship",
          impactKind: `inter_subject_balance_${debtDirection}`, amountCents, direction: debtDirection,
          subjectRole: "actual_payer", subject: { kind: "participating_company", id: v.sourceCompanyId },
          description: refundDestination ? "到账后退回冲减原债务人应还第三家公司往来" : "第三家公司代还后，原债务人欠实际代还公司；与已清偿的原债权不重复计成本",
          impactSnapshot: sourceJson({
            debtorId: v.repaymentDebtorCompanyId, payerCompanyId: v.sourceCompanyId,
            originalCreditorCompanyId: v.destinationCompanyId, thirdPartyRepayment: true, internalTransfer: true,
          }),
        });
      }
    }
    return { entryKind: "original", input: {
      projectId: s.projectId, sourceType: this.sourceType, sourceBusinessId: s.sourceBusinessId,
      sourceBusinessCode: s.sourceBusinessCode, sourceVersion: 1, idempotencyKey: key,
      occurredAt, confirmedAt: new Date(v.confirmedAt), confirmedByUserId: v.confirmedByUserId,
      factKind: "company_transfer", operatingLevel: "participating_company", evidenceLevel: "A",
      amountCents, currencyCode: "CNY", direction: direction === "decrease" ? "outflow" : "inflow",
      isBeforeOperatingLedgerEffectiveDate: occurredAt < new Date(v.operatingLedgerEffectiveDate),
      affiliateAssignmentId: v.affiliate.assignmentId, affiliateBusinessPartyVersionId: v.affiliate.businessPartyVersionId,
      affiliateNameSnapshot: v.affiliate.name, affiliateCreditCodeSnapshot: v.affiliate.creditCode,
      sourceSnapshot: s.sourceSnapshot, basisSnapshot: sourceJson({ authority: "approved_company_transfer_verified_bank" }),
      subjects, impacts,
    } };
  }
}
