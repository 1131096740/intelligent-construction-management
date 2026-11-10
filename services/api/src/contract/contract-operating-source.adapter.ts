import { assertUpwardDirectArchivePersistentProof } from "./contract-upward-direct-archive-proof";
import { economicExcludedAt, economicExcludedYuanAt } from "../contract-ledger/contract-economic-coverage";
import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { chinaDateOnly, normalizeBusinessAmount, businessAmountFromLegacyCents } from "@jiangkong/shared-domain";
import { downstreamContractRelationship } from "@jiangkong/shared-domain";
import {
  frozenAffiliateFromJson, occurredBeforeEffectiveDate, readAffiliateSnapshot,
  readOperatingLedgerEffectiveDate, requiredJsonDate, requiredJsonMoney,
  requiredJsonRecord, requiredJsonText, sourceJson
} from "../operating-ledger/formal-operating-source.helpers";
import { readQualifiedGeneratedUpwardReference } from "./contract-generated-upward-operating";
import { readGeneratedArchiveOperatingPolicy } from "./contract-generated-archive-operating-policy";
import { assertContractV2ArchivePersistentProof } from "./contract-v2-archive-persistent-proof";
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
    const sources = await Promise.all(versions.map((version) => this.snapshot(tx, projectId, version.id)));
    return sources.filter((source): source is OperatingSourceSnapshot => source !== null);
  }
  async readSourceSnapshot(tx: Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0], locator: OperatingSourceLocator) {
    const version = await tx.contractVersion.findUnique({ where: { id: locator.sourceBusinessId } });
    if (!version?.effectiveAt) return null;
    const contract = await tx.contract.findFirst({ where: { id: version.contractId, projectId: locator.projectId } });
    return contract ? this.snapshot(tx, locator.projectId, version.id) : null;
  }
  private async snapshot(tx: Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0], projectId: string, versionId: string): Promise<OperatingSourceSnapshot | null> {
    const version = await tx.contractVersion.findUniqueOrThrow({ where: { id: versionId } });
    const contract = await tx.contract.findUniqueOrThrow({ where: { id: version.contractId } });
    if (contract.projectId !== projectId || !version.effectiveAt) throw new BadRequestException("合同尚未正式生效");
    if (version.numericProtocolVersion === 2 && version.signingSubjectType === "upward") {
      const direct = await tx.contractArchiveFile.findFirst({ where: { contractVersionId: version.id,
        archiveProtocolVersion: 2, archiveSource: "direct_signed", status: "confirmed" } });
      if (direct) { await assertUpwardDirectArchivePersistentProof(tx, contract, version, direct); return null; }
    }
    if (version.numericProtocolVersion === 2 && (version.signingSubjectType === "upward" || version.signingSubjectType === "affiliate")) {
      const archive = await tx.contractArchiveFile.findFirst({ where: { contractVersionId: version.id,
        archiveProtocolVersion: 2, archiveSource: "generated_approval", status: "confirmed" } });
      if (archive?.archiveProtocolVersion === 2 && archive.archiveSource === "generated_approval") {
        if (version.signingSubjectType === "upward") {
          await readQualifiedGeneratedUpwardReference(tx, contract, version, archive);
          return null;
        }
        await assertContractV2ArchivePersistentProof(tx, contract, version, archive);
        const policy = readGeneratedArchiveOperatingPolicy({ archive, contract, version });
        if (!policy) return null;
        if (policy.mode !== "outside_downstream_commitment") throw new BadRequestException("表外归档未形成可核对的下游承诺");
        const source = policy.fact.input;
        return { projectId, sourceType: this.sourceType, sourceBusinessId: version.id, sourceBusinessCode: source.sourceBusinessCode,
          sourceVersion: source.sourceVersion, status: "confirmed", sourceSnapshot: source.sourceSnapshot };
      }
    }
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
    if (archive?.archiveProtocolVersion === 2) {
      if (!archive.authoritySnapshot || !archive.authoritySha256 || !archive.confirmedAt || archive.confirmedAt.getTime() !== version.effectiveAt.getTime()) throw new BadRequestException("新归档经营来源缺少真实权威");
      const authority = requiredJsonRecord(archive.authoritySnapshot, "合同归档");
      const basis = requiredJsonRecord(authority.sourceBasis!, "归档独立依据");
      const locator = requiredJsonRecord(basis.sourceLocator!, "归档来源");
      const money = requiredJsonRecord(basis.money!, "归档金额");
      const subjects = requiredJsonRecord(basis.subjects!, "签约主体");
      const parties = subjects.parties;
      if (authority.projectId !== projectId || authority.contractVersionId !== version.id || locator.sourceVersion !== version.versionNo) throw new BadRequestException("新归档经营来源的项目或版本不一致");
      if (!Array.isArray(parties) || !version.companyEntityIdSnapshot || !counterparty?.businessPartyVersionId) throw new BadRequestException("新归档经营来源的受控签约主体不完整");
      const frozenParty = parties.filter(party => party && typeof party === "object" && !Array.isArray(party) && party.roleKey === "party_b" && party.businessPartyVersionId === counterparty.businessPartyVersionId);
      if (frozenParty.length !== 1 || version.signingSubjectType !== "our_company") throw new BadRequestException("新归档签约主体不一致");
      return { projectId, sourceType: this.sourceType, sourceBusinessId: version.id, sourceBusinessCode: contract.code ?? contract.temporaryCode ?? contract.name,
        sourceVersion: version.versionNo, status: "confirmed", sourceSnapshot: sourceJson({
          contractId: contract.id, contractVersionId: version.id, contractRelationship: relationship, signingSubjectType: version.signingSubjectType,
          companyEntityVersionId: version.companyEntityVersionId, companyEntityIdSnapshot: version.companyEntityIdSnapshot, companyEntityNameSnapshot: version.companyEntityNameSnapshot,
          counterpartyVersionId: counterparty.businessPartyVersionId, counterpartyName: contract.counterparty,
          archiveProtocolVersion: 2, archiveAuthorityId: archive.id, archiveAuthoritySha256: archive.authoritySha256, sourceBasisSha256: authority.sourceBasisSha256, sourceBasis: basis,
          amountNature: money.amountState === "unknown" ? "uncapped" : "fixed", numericProtocolVersion: 2, amountYuan: money.amountYuan, amountState: money.amountState, sourceAmountStatus: version.amountLimitType,
          currentAmount: { protocolVersion: 2, amountState: money.amountState, amountYuan: money.amountYuan, sourceAmountStatus: version.amountLimitType }, priorAmount: null,
          economicExcludedYuan: money.economicExcludedYuan, commitmentDeltaYuan: money.commitmentDeltaYuan, supersedesVersionId: null,
          occurredAt: version.effectiveAt.toISOString(), confirmedAt: archive.confirmedAt.toISOString(), confirmedByUserId: archive.confirmedByUserId,
          operatingLedgerEffectiveDate: effectiveDate.toISOString(), archiveBusinessDay: chinaDateOnly(archive.confirmedAt), affiliate
        }) };
    }
    if (!counterparty?.businessPartyVersionId) throw new BadRequestException("合同承诺缺少受控相对方快照，请先核对签约主体");
    const numeric2 = version.numericProtocolVersion === 2;
    const knownAmount = version.amountLimitType !== "uncapped";
    const priorAmount = predecessor && predecessor.amountLimitType !== "uncapped" ? predecessor.amountCents : 0n;
    const economicRef = `contract:${contract.id}`;
    const economicExcludedCents = numeric2?null:await economicExcludedAt(tx, projectId, economicRef, version.effectiveAt, `${version.id}:${version.documentContentRevision}`);
    const Decimal=Prisma.Decimal.clone({precision:60});
    const economicExcludedYuan=numeric2?await economicExcludedYuanAt(tx,projectId,economicRef,version.effectiveAt,`${version.id}:${version.documentContentRevision}`):null;
    let priorAppliedExclusion = 0n;
    let priorAppliedExclusionYuan = new Decimal(0);
    if (predecessor) {
      const fact = await tx.operatingFact.findFirst({ where: { projectId, sourceType: this.sourceType, sourceBusinessId: predecessor.id } });
      const priorSnapshot = fact?.sourceSnapshot as Record<string, unknown> | undefined;
      priorAppliedExclusion = typeof priorSnapshot?.economicExcludedCents === "string" ? BigInt(priorSnapshot.economicExcludedCents) : 0n;
      if(numeric2)priorAppliedExclusionYuan=new Decimal(typeof priorSnapshot?.economicExcludedYuan==="string"?normalizeBusinessAmount(priorSnapshot.economicExcludedYuan,{allowNegative:true})!:businessAmountFromLegacyCents(priorAppliedExclusion)!);
      const laterReviews = await tx.contractEconomicReview.findMany({ where: { projectId, status: "confirmed", confirmedAt: { gt: predecessor.effectiveAt!, lte: version.effectiveAt } } });
      for (const review of laterReviews) if (Array.isArray(review.frozenSources)) for (const raw of review.frozenSources) {
        const d = raw as Record<string, unknown>;
        if (d.ref !== economicRef || d.formal !== true)continue;
        if(numeric2){
          if(d.coverageNumericProtocolVersion===2||d.numericProtocolVersion===2){
            if(typeof d.excludedDeltaYuan!=="string")throw new BadRequestException("前版履约复核缺少四位排除金额");
            priorAppliedExclusionYuan=priorAppliedExclusionYuan.plus(normalizeBusinessAmount(d.excludedDeltaYuan,{allowNegative:true})!);
          }else if(typeof d.excludedDeltaCents==="string")priorAppliedExclusionYuan=priorAppliedExclusionYuan.plus(businessAmountFromLegacyCents(d.excludedDeltaCents)!);
        }else if(typeof d.excludedDeltaCents==="string")priorAppliedExclusion+=BigInt(d.excludedDeltaCents);
        else if(d.coverageNumericProtocolVersion===2||d.numericProtocolVersion===2)throw new BadRequestException("原分合同不能按分读取新版履约复核，请使用四位元协议");
      }
    }
    // V2 authority is the decimal source; the old cents column is display compatibility only.
    const sourceAmountYuan = numeric2 ? normalizeBusinessAmount(version.amountYuan === null ? null : version.amountYuan.toString()) : null;
    const priorAmountYuan = !predecessor ? "0.0000" : predecessor.numericProtocolVersion === 2
      ? normalizeBusinessAmount(predecessor.amountYuan === null ? null : predecessor.amountYuan.toString())
      : predecessor.amountLimitType === "uncapped" ? null : businessAmountFromLegacyCents(predecessor.amountCents);
    const excludedYuan = numeric2?economicExcludedYuan!:businessAmountFromLegacyCents(economicExcludedCents!)!;
    const priorExcludedYuan = numeric2?priorAppliedExclusionYuan.toFixed(4):businessAmountFromLegacyCents(priorAppliedExclusion)!;
    if (numeric2 && sourceAmountYuan !== null && new Prisma.Decimal(excludedYuan).gt(sourceAmountYuan)) throw new BadRequestException("已确认重叠范围超过合同新金额，请先复核");
    const deltaYuan = numeric2 && sourceAmountYuan !== null && priorAmountYuan !== null
      ? normalizeBusinessAmount(new Decimal(sourceAmountYuan).minus(priorAmountYuan).minus(excludedYuan).plus(priorExcludedYuan).toFixed(4), { allowNegative: true }) : null;
    if (!numeric2 && knownAmount && economicExcludedCents! > version.amountCents) throw new BadRequestException("已确认重叠范围超过合同新金额，请先复核");
    const delta = !numeric2?(knownAmount ? version.amountCents : 0n) - priorAmount - economicExcludedCents! + priorAppliedExclusion:null;
    return {
      projectId, sourceType: this.sourceType, sourceBusinessId: version.id,
      sourceBusinessCode: contract.code ?? contract.temporaryCode ?? contract.name,
      sourceVersion: version.versionNo, status: "confirmed",
      sourceSnapshot: sourceJson({
        contractId: contract.id, contractVersionId: version.id, contractRelationship: relationship,
        signingSubjectType: version.signingSubjectType, companyEntityVersionId: version.companyEntityVersionId,
        companyEntityIdSnapshot: version.companyEntityIdSnapshot, companyEntityNameSnapshot: version.companyEntityNameSnapshot,
        counterpartyName: contract.counterparty, counterpartyVersionId: counterparty.businessPartyVersionId, amountNature: knownAmount ? "fixed" : "uncapped",
        ...(numeric2 ? { numericProtocolVersion: 2, currentAmount: { protocolVersion: 2, amountState: sourceAmountYuan === null ? "unknown" : "known", amountYuan: sourceAmountYuan, sourceAmountStatus: version.amountLimitType },
          priorAmount: predecessor ? { versionId: predecessor.id, protocolVersion: predecessor.numericProtocolVersion ?? 1, amountState: priorAmountYuan === null ? "unknown" : "known", amountYuan: priorAmountYuan, sourceAmountStatus: predecessor.amountLimitType } : null,
          amountYuan: sourceAmountYuan, amountState: sourceAmountYuan === null ? "unknown" : "known", sourceAmountStatus: version.amountLimitType, economicExcludedYuan: excludedYuan, commitmentDeltaYuan: deltaYuan }
          : { amountCents: version.amountCents.toString(), economicExcludedCents: economicExcludedCents!.toString(), commitmentDeltaCents: delta!.toString() }),
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
    const numeric2 = source.numericProtocolVersion === 2;
    const deltaYuan = numeric2 ? normalizeBusinessAmount(source.commitmentDeltaYuan === null ? null : requiredJsonText(source, "commitmentDeltaYuan", "合同承诺"), { allowNegative: true }) : null;
    const delta = numeric2 ? null : requiredJsonMoney(source, "commitmentDeltaCents", "合同承诺");
    const money = numeric2
      ? { numericProtocolVersion: 2 as const, amountCents: null, amountYuan: deltaYuan === null ? null : new Prisma.Decimal(deltaYuan).abs().toFixed(4) }
      : { amountCents: delta! < 0n ? -delta! : delta! };
    const direction = numeric2 ? deltaYuan === null ? "notice" : new Prisma.Decimal(deltaYuan).lt(0) ? "decrease" : "increase" : delta! < 0n ? "decrease" : "increase";
    if (source.signingSubjectType === "draft_unconfirmed") throw new Error("合同签约主体待补充，不能形成正式经营事实");
    const debtor = source.signingSubjectType === "affiliate"
      ? { kind: "construction_enterprise" as const, id: affiliate.businessPartyVersionId }
      : { kind: "participating_company" as const, id: requiredJsonText(source, source.archiveProtocolVersion === 2 ? "companyEntityIdSnapshot" : "companyEntityVersionId", "合同签约主体") };
    const frozenOutside = source.archiveProtocolVersion === 2 && source.contractRelationship === "outside"
      && source.signingSubjectType === "affiliate" && typeof source.archiveAuthorityId === "string";
    const creditor = { kind: "downstream_counterparty" as const,
      id: requiredJsonText(source, frozenOutside ? "counterpartySubjectId" : "counterpartyVersionId", "合同相对方") };
    return { entryKind: "original", input: {
      projectId: snapshot.projectId, sourceType: snapshot.sourceType, sourceBusinessId: snapshot.sourceBusinessId,
      sourceBusinessCode: snapshot.sourceBusinessCode, sourceVersion: snapshot.sourceVersion,
      idempotencyKey: `${snapshot.sourceType}:${snapshot.sourceBusinessId}`, occurredAt,
      confirmedAt: requiredJsonDate(source, "confirmedAt", "合同承诺"),
      confirmedByUserId: requiredJsonText(source, "confirmedByUserId", "合同承诺"),
      factKind: "downstream_contract", operatingLevel: "project", evidenceLevel: "A",
      ...money, currencyCode: "CNY", direction: "neutral",
      isBeforeOperatingLedgerEffectiveDate: source.archiveProtocolVersion === 2
        ? requiredJsonText(source, "archiveBusinessDay", "归档业务日") < requiredJsonDate(source, "operatingLedgerEffectiveDate", "合同承诺").toISOString().slice(0, 10)
        : occurredBeforeEffectiveDate(occurredAt, requiredJsonDate(source, "operatingLedgerEffectiveDate", "合同承诺")),
      affiliateAssignmentId: affiliate.assignmentId, affiliateBusinessPartyVersionId: affiliate.businessPartyVersionId,
      affiliateNameSnapshot: affiliate.name, affiliateCreditCodeSnapshot: affiliate.creditCode, sourceSnapshot: snapshot.sourceSnapshot,
      basisSnapshot: sourceJson({ authority: "effective_contract_version", amountNature: source.amountNature }),
      subjects: { debtor, creditor }, impacts: [{
        idempotencyKey: `${snapshot.sourceType}:${snapshot.sourceBusinessId}:commitment`,
        sourceImpactKey: "contract_commitment_reference", impactKind: "contract_commitment_reference",
        ...money, direction,
        subjectRole: "debtor", subject: debtor, description: frozenOutside ? "表外原合同承诺，不形成成本或应付"
          : "生效合同版本净增减，仅影响承诺，不形成成本或应付"
      }]
    } };
  }
}
