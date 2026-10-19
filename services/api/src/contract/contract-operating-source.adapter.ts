import { economicExcludedAt } from "../contract-ledger/contract-economic-coverage";
import { BadRequestException } from "@nestjs/common";
import { downstreamContractRelationship } from "@jiangkong/shared-domain";
import {
  frozenAffiliateFromJson, occurredBeforeEffectiveDate, readAffiliateSnapshot,
  readOperatingLedgerEffectiveDate, requiredJsonDate, requiredJsonMoney,
  requiredJsonRecord, requiredJsonText, sourceJson
} from "../operating-ledger/formal-operating-source.helpers";
import type { OperatingSourceAdapter, OperatingSourceSnapshot, OperatingSourceLocator, OperatingSourceFactInput } from "../operating-ledger/operating-source-adapter";

/** 每个已生效版本只投影相对于直接前版的增减；保留 superseded 版本供历史日期回读。 */
export class ContractOperatingSourceAdapter implements OperatingSourceAdapter {
  readonly sourceType = "contract_version";
  async readProjectSnapshots(tx: Parameters<OperatingSourceAdapter["readProjectSnapshots"]>[0], projectId: string) {
    const contracts = await tx.contract.findMany({ where: { projectId }, select: { id: true } });
    const versions = await tx.contractVersion.findMany({
      where: { contractId: { in: contracts.map((c) => c.id) }, effectiveAt: { not: null } },
      orderBy: [{ effectiveAt: "asc" }, { versionNo: "asc" }]
    });
    return Promise.all(versions.map((version) => this.snapshot(tx, projectId, version.id)));
  }
  async readSourceSnapshot(tx: Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0], locator: OperatingSourceLocator) {
    const version = await tx.contractVersion.findUnique({ where: { id: locator.sourceBusinessId } });
    if (!version?.effectiveAt) return null;
    const contract = await tx.contract.findFirst({ where: { id: version.contractId, projectId: locator.projectId } });
    return contract ? this.snapshot(tx, locator.projectId, version.id) : null;
  }
  private async snapshot(tx: Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0], projectId: string, versionId: string): Promise<OperatingSourceSnapshot> {
    const version = await tx.contractVersion.findUniqueOrThrow({ where: { id: versionId } });
    const contract = await tx.contract.findUniqueOrThrow({ where: { id: version.contractId } });
    if (contract.projectId !== projectId || !version.effectiveAt) throw new BadRequestException("合同尚未正式生效");
    const relationship = downstreamContractRelationship(version);
    if (relationship === "unclassified") throw new BadRequestException("生效合同缺少签约主体快照，请先核对，不能默认为表内");
    const predecessor = version.supersedesVersionId
      ? await tx.contractVersion.findUniqueOrThrow({ where: { id: version.supersedesVersionId } }) : null;
    if (predecessor && (predecessor.contractId !== contract.id || !predecessor.effectiveAt)) {
      throw new BadRequestException("合同承诺缺少有效的直接前版依据");
    }
    const [archive, formalFile, takeover, effectiveDate, affiliate, counterparty] = await Promise.all([
      tx.contractArchiveFile.findFirst({ where: { contractVersionId: version.id, status: "confirmed", confirmedAt: { not: null }, confirmedByUserId: { not: null } }, orderBy: { confirmedAt: "asc" } }),
      tx.contractFormalFile.findFirst({ where: { contractVersionId: version.id, purpose: "mutually_signed_final", status: "active", confirmedAt: { not: null }, confirmedByUserId: { not: null } }, orderBy: { confirmedAt: "asc" } }),
      tx.contractTakeover.findFirst({ where: { contractVersionId: version.id, activatedAt: { not: null } } }),
      readOperatingLedgerEffectiveDate(tx, projectId),
      readAffiliateSnapshot(tx, { projectId, occurredAt: version.effectiveAt, assignmentId: version.affiliateAssignmentId, businessPartyVersionId: version.affiliateBusinessPartyVersionId }),
      tx.contractPartySnapshot.findFirst({ where: { contractVersionId: version.id, roleKey: "party_b" }, select: { businessPartyVersionId: true }, orderBy: { displayOrder: "asc" } })
    ]);
    const confirmedByUserId = archive?.confirmedByUserId ?? formalFile?.confirmedByUserId ?? takeover?.activatedByUserId;
    if (!confirmedByUserId) throw new BadRequestException("生效合同缺少归档或接管确认依据");
    if (!counterparty?.businessPartyVersionId) throw new BadRequestException("合同承诺缺少受控相对方快照，请先核对签约主体");
    const knownAmount = version.amountLimitType !== "uncapped";
    const priorAmount = predecessor && predecessor.amountLimitType !== "uncapped" ? predecessor.amountCents : 0n;
    const economicRef = `contract:${contract.id}`;
    const economicExcludedCents = await economicExcludedAt(tx, projectId, economicRef, version.effectiveAt, `${version.id}:${version.documentContentRevision}`);
    let priorAppliedExclusion = 0n;
    if (predecessor) {
      const fact = await tx.operatingFact.findFirst({ where: { projectId, sourceType: this.sourceType, sourceBusinessId: predecessor.id } });
      const priorSnapshot = fact?.sourceSnapshot as Record<string, unknown> | undefined;
      priorAppliedExclusion = typeof priorSnapshot?.economicExcludedCents === "string" ? BigInt(priorSnapshot.economicExcludedCents) : 0n;
      const laterReviews = await tx.contractEconomicReview.findMany({ where: { projectId, status: "confirmed", confirmedAt: { gt: predecessor.effectiveAt!, lte: version.effectiveAt } } });
      for (const review of laterReviews) if (Array.isArray(review.frozenSources)) for (const raw of review.frozenSources) {
        const d = raw as Record<string, unknown>;
        if (d.ref === economicRef && d.formal === true && typeof d.excludedDeltaCents === "string") priorAppliedExclusion += BigInt(d.excludedDeltaCents);
      }
    }
    if (knownAmount && economicExcludedCents > version.amountCents) throw new BadRequestException("已确认重叠范围超过合同新金额，请先复核");
    const delta = (knownAmount ? version.amountCents : 0n) - priorAmount - economicExcludedCents + priorAppliedExclusion;
    return {
      projectId, sourceType: this.sourceType, sourceBusinessId: version.id,
      sourceBusinessCode: contract.code ?? contract.temporaryCode ?? contract.name,
      sourceVersion: version.versionNo, status: "confirmed",
      sourceSnapshot: sourceJson({
        contractId: contract.id, contractVersionId: version.id, contractRelationship: relationship,
        signingSubjectType: version.signingSubjectType, companyEntityVersionId: version.companyEntityVersionId,
        companyEntityIdSnapshot: version.companyEntityIdSnapshot, companyEntityNameSnapshot: version.companyEntityNameSnapshot,
        counterpartyName: contract.counterparty, counterpartyVersionId: counterparty.businessPartyVersionId, amountNature: knownAmount ? "fixed" : "uncapped",
        amountCents: version.amountCents.toString(), economicExcludedCents: economicExcludedCents.toString(), commitmentDeltaCents: delta.toString(),
        supersedesVersionId: version.supersedesVersionId, occurredAt: version.effectiveAt.toISOString(),
        confirmedAt: version.effectiveAt.toISOString(), confirmedByUserId,
        operatingLedgerEffectiveDate: effectiveDate.toISOString(), affiliate
      })
    };
  }
  toOperatingFactInput(snapshot: OperatingSourceSnapshot): OperatingSourceFactInput {
    const source = requiredJsonRecord(snapshot.sourceSnapshot, "合同承诺");
    const affiliate = frozenAffiliateFromJson(source, "合同承诺");
    const occurredAt = requiredJsonDate(source, "occurredAt", "合同承诺");
    const delta = requiredJsonMoney(source, "commitmentDeltaCents", "合同承诺");
    const debtor = source.signingSubjectType === "affiliate"
      ? { kind: "construction_enterprise" as const, id: affiliate.businessPartyVersionId }
      : { kind: "participating_company" as const, id: requiredJsonText(source, "companyEntityVersionId", "合同签约主体") };
    const creditor = { kind: "downstream_counterparty" as const, id: requiredJsonText(source, "counterpartyVersionId", "合同相对方") };
    return { entryKind: "original", input: {
      projectId: snapshot.projectId, sourceType: snapshot.sourceType, sourceBusinessId: snapshot.sourceBusinessId,
      sourceBusinessCode: snapshot.sourceBusinessCode, sourceVersion: snapshot.sourceVersion,
      idempotencyKey: `${snapshot.sourceType}:${snapshot.sourceBusinessId}`, occurredAt,
      confirmedAt: requiredJsonDate(source, "confirmedAt", "合同承诺"),
      confirmedByUserId: requiredJsonText(source, "confirmedByUserId", "合同承诺"),
      factKind: "downstream_contract", operatingLevel: "project", evidenceLevel: "A",
      amountCents: delta < 0n ? -delta : delta, currencyCode: "CNY", direction: "neutral",
      isBeforeOperatingLedgerEffectiveDate: occurredBeforeEffectiveDate(occurredAt, requiredJsonDate(source, "operatingLedgerEffectiveDate", "合同承诺")),
      affiliateAssignmentId: affiliate.assignmentId, affiliateBusinessPartyVersionId: affiliate.businessPartyVersionId,
      affiliateNameSnapshot: affiliate.name, affiliateCreditCodeSnapshot: affiliate.creditCode, sourceSnapshot: snapshot.sourceSnapshot,
      basisSnapshot: sourceJson({ authority: "effective_contract_version", amountNature: source.amountNature }),
      subjects: { debtor, creditor }, impacts: [{
        idempotencyKey: `${snapshot.sourceType}:${snapshot.sourceBusinessId}:commitment`,
        sourceImpactKey: "contract_commitment_reference", impactKind: "contract_commitment_reference",
        amountCents: delta < 0n ? -delta : delta, direction: delta < 0n ? "decrease" : "increase",
        subjectRole: "debtor", subject: debtor, description: "生效合同版本净增减，仅影响承诺，不形成成本或应付"
      }]
    } };
  }
}
