import { randomUUID, createHash } from "node:crypto";
import { ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { canPerform, type BusinessAction } from "@jiangkong/shared-domain";

import { activeScopedApprovalDelegatorIds } from "../approval/active-approval-delegations";
import { AuditService } from "../audit/audit.service";
import { AffiliateClearingAuthorityService, type ResolvedAffiliateClearingAuthority } from "../clearing/affiliate-clearing-authority.service";
import { assertClearingActorsDisjoint } from "../clearing/clearing-domain";
import { ClearingService } from "../clearing/clearing.service";
import { CompanyRoleResolverService } from "../auth/company-role-resolver.service";
import { PrismaService } from "../database/prisma.service";
import { OperatingSourceReplayService } from "../operating-ledger/operating-source-replay.service";
import { resolveAffiliateDeductionSource } from "../clearing/affiliate-clearing-authority.domain";
import { lockWageConflictBuckets } from "../clearing/wage-conflict-lock";
import { ConstructionEnterpriseClearingAdapter, type ConstructionEnterpriseHistoricalRow, type ResolvedClearingAuthorityForTakeover } from "./construction-enterprise-clearing.adapter";
import type {
  CompensateConstructionEnterpriseTakeoverDto,
  ConstructionEnterpriseTakeoverCommandDto,
  CreateConstructionEnterpriseTakeoverManifestDto,
  CreateConstructionEnterpriseTakeoverRowDto
} from "./construction-enterprise-clearing.dto";

type Tx = Prisma.TransactionClient;
type TakeoverIdentity = { actualUserId: string; delegatorUserId: string | null; actorIds: string[]; roles: string[] };
type StoredMapping = Prisma.OperatingTakeoverRowMappingGetPayload<{
  select: {
    id: true; projectId: true; rowNo: true; sourceType: true; sourceBusinessId: true;
    sourceVersion: true; sourceFingerprint: true; sourceCoordinate: true; normalizedRowHash: true;
    amountCents: true; evidenceLevel: true; coverageKind: true; coverageKey: true; periodStart: true;
    entryKind: true; mappingDecision: true; conflictGroupKey: true; sourceDiscriminator: true;
    governedSubjectKey: true; authorityCategory: true; authoritySnapshotRef: true;
    authorityFingerprint: true; authorityVersionId: true; authorityLineId: true;
    authorityLineFingerprint: true; obligationId: true; authoritativeGrossCapCents: true;
    currencyCode: true; authoritySnapshot: true; legacySourceSnapshot: true; readSetSnapshot: true;
    mappingFingerprint: true;
  }
}>;

const MAPPER_NAME = "construction-enterprise-clearing";
const MAPPER_VERSION = 1;
const SCHEMA_VERSION = 1;

@Injectable()
export class OperatingTakeoverCoordinatorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly roles: CompanyRoleResolverService,
    private readonly authorities: AffiliateClearingAuthorityService,
    private readonly clearing: ClearingService,
    private readonly adapter: ConstructionEnterpriseClearingAdapter,
    private readonly audit: AuditService,
    @Optional() private readonly operatingSources?: OperatingSourceReplayService
  ) {}

  async createManifest(
    projectId: string,
    actorUserId: string,
    input: CreateConstructionEnterpriseTakeoverManifestDto
  ) {
    if (input.expectedRevision !== 0) throw new ConflictException("新建接管 manifest 的 expectedRevision 必须为 0");
    if (!input.rows.length) throw new ConflictException("接管 manifest 至少需要一行");
    const identity = await this.resolveIdentity(actorUserId, input.delegatorUserId, "clearing.prepare", projectId, projectId);
    const commandFingerprint = fingerprint({ action: "manifest.create", projectId, input, actorIds: identity.actorIds });
    return this.serializable(async (tx) => {
      const replay = await this.replay(tx, input.idempotencyKey, commandFingerprint);
      if (replay) return replay;
      const mappings = await this.resolveMappings(tx, projectId, identity, input.rows);
      const candidateBaselineSha = process.env.BUILD_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA;
      if (!candidateBaselineSha || !/^[0-9a-f]{40}$/i.test(candidateBaselineSha)) throw new ConflictException("接管 manifest 缺少精确候选基线 SHA，必须失败关闭");
      const manifestFingerprint = fingerprint(mappings.map((mapping) => mapping.mappingFingerprint));
      const readSetFingerprint = fingerprint(mappings.map((mapping) => ({
        mappingFingerprint: mapping.mappingFingerprint,
        authorityFingerprint: mapping.authorityFingerprint,
        sourceFingerprint: mapping.sourceFingerprint
      })));
      const created = await tx.operatingTakeoverManifestVersion.create({
        data: {
          id: cryptoRandomId(),
          projectId,
          manifestNo: `OT215-${cryptoRandomId().slice(0, 8)}`,
          version: 1,
          status: "prepared",
          sourceScopeFingerprint: fingerprint(mappings.map((mapping) => ({ sourceType: mapping.sourceType, sourceBusinessId: mapping.sourceBusinessId, sourceVersion: mapping.sourceVersion, sourceFingerprint: mapping.sourceFingerprint }))),
          mapperName: MAPPER_NAME,
          mapperVersion: MAPPER_VERSION,
          schemaVersion: SCHEMA_VERSION,
          candidateBaselineSha,
          permissionSnapshotFingerprint: permissionFingerprint(projectId, identity.roles),
          readSetFingerprint,
          manifestFingerprint,
          createdByUserId: identity.actualUserId
        }
      });
      const storedMappings: StoredMapping[] = [];
      for (const [index, mapping] of mappings.entries()) {
        const stored = await tx.operatingTakeoverRowMapping.create({
          data: {
            id: cryptoRandomId(),
            manifestVersionId: created.id,
            projectId,
            rowNo: index + 1,
            sourceType: mapping.sourceType,
            sourceBusinessId: mapping.sourceBusinessId,
            sourceVersion: mapping.sourceVersion,
            sourceFingerprint: mapping.sourceFingerprint,
            sourceCoordinate: mapping.sourceCoordinate,
            normalizedRowHash: mapping.normalizedRowHash,
            amountCents: mapping.amountCents,
            evidenceLevel: mapping.evidenceLevel,
            coverageKind: mapping.authority?.coverageKind ?? null,
            coverageKey: mapping.authority?.coverageKey ?? null,
            periodStart: mapping.periodStart,
            entryKind: mapping.entryKind,
            mappingDecision: mapping.decision,
            conflictGroupKey: mapping.conflictGroupKey,
            sourceDiscriminator: mapping.sourceDiscriminator,
            governedSubjectKey: mapping.governedSubjectKey,
            authorityCategory: mapping.authority?.category ?? null,
            authoritySnapshotRef: mapping.authority?.authoritySnapshotRef ?? null,
            authorityFingerprint: mapping.authority?.authorityFingerprint ?? null,
            authorityVersionId: mapping.authority?.authorityVersionId ?? null,
            authorityLineId: mapping.authority?.authorityLineId ?? null,
            authorityLineFingerprint: mapping.authority?.authorityLineFingerprint ?? null,
            obligationId: mapping.authority?.obligationId ?? null,
            authoritativeGrossCapCents: mapping.authority?.authoritativeGrossCapCents ?? null,
            currencyCode: mapping.authority?.currencyCode ?? null,
            authoritySnapshot: jsonInput(mapping.authority),
            legacySourceSnapshot: jsonInput({ sourceType: mapping.sourceType, sourceBusinessId: mapping.sourceBusinessId, sourceVersion: mapping.sourceVersion, sourceFingerprint: mapping.sourceFingerprint, sourceCoordinate: mapping.sourceCoordinate, normalizedRowHash: mapping.normalizedRowHash }),
            readSetSnapshot: jsonInput({ authorityFingerprint: mapping.authority?.authorityFingerprint ?? null, sourceFingerprint: mapping.sourceFingerprint, mappingFingerprint: mapping.mappingFingerprint }),
            mappingFingerprint: mapping.mappingFingerprint
          }
        });
        storedMappings.push(stored);
      }
      const result = { manifestId: created.id, manifestFingerprint, status: created.status, rowCount: storedMappings.length };
      await this.writeReceipt(tx, projectId, created.id, input.idempotencyKey, "manifest.create", "clearing.prepare", input.expectedRevision, identity, commandFingerprint, "prepared", result, storedMappings);
      await this.audit.record(tx, { actorUserId: identity.actualUserId, action: "operating_takeover.manifest.create", businessType: "operating_takeover_manifest", businessId: created.id, metadata: jsonInput({ manifestFingerprint, rowCount: storedMappings.length }) });
      return result;
    });
  }

  async apply(projectId: string, manifestId: string, actorUserId: string, input: ConstructionEnterpriseTakeoverCommandDto) {
    return this.inactiveCommand(projectId, manifestId, actorUserId, input, "inactive_applied");
  }

  async abandonInactiveApply(projectId: string, manifestId: string, actorUserId: string, input: ConstructionEnterpriseTakeoverCommandDto) {
    return this.inactiveCommand(projectId, manifestId, actorUserId, input, "abandoned");
  }

  async attestManifest(projectId: string, manifestId: string, actorUserId: string, input: ConstructionEnterpriseTakeoverCommandDto) {
    const identity = await this.resolveIdentity(actorUserId, input.delegatorUserId, "clearing.attest", manifestId);
    return this.serializable(async (tx) => {
      const manifest = await this.loadAndRevalidate(tx, projectId, manifestId, identity, "clearing.attest");
      const rows = manifest.rows.filter((row) => row.mappingDecision === "FORMAL");
      const fp = fingerprint({ action: "manifest.attest", manifestId, expectedRevision: input.expectedRevision, actorIds: identity.actorIds, rows: rows.map((row) => row.mappingFingerprint) });
      const replay = await this.replay(tx, input.idempotencyKey, fp);
      if (replay) return replay;
      const result = { manifestId, status: "attested", rowCount: rows.length };
      await this.writeReceipt(tx, manifest.projectId, manifest.id, input.idempotencyKey, "manifest.attest", "clearing.attest", input.expectedRevision, identity, fp, "attested", result, rows);
      return result;
    });
  }

  async activate(projectId: string, manifestId: string, actorUserId: string, input: ConstructionEnterpriseTakeoverCommandDto) {
    const identity = await this.resolveIdentity(actorUserId, input.delegatorUserId, "clearing.confirm", manifestId);
    return this.serializable(async (tx) => {
      const manifest = await this.loadAndRevalidate(tx, projectId, manifestId, identity, "clearing.confirm");
      const fp = fingerprint({ action: "manifest.activate", manifestId, expectedRevision: input.expectedRevision, actorIds: identity.actorIds, rows: manifest.rows.map((row) => row.mappingFingerprint) });
      const replay = await this.replay(tx, input.idempotencyKey, fp);
      if (replay) return replay;
      const attest = await tx.operatingTakeoverCommandReceipt.findFirst({ where: { manifestVersionId: manifest.id, action: "manifest.attest", status: "attested" }, orderBy: { createdAt: "desc" } });
      const formalRows = manifest.rows.filter((row) => row.mappingDecision === "FORMAL");
      if (formalRows.some((row) => row.coverageKind === "ROLE_SUMMARY") && !attest) throw new ConflictException("B级岗位汇总缺少独立实名 attest，禁止激活");
      if (attest) assertClearingActorsDisjoint(jsonActorIds(attest.actorSetSnapshot), identity.actorIds);
      const preparers = await tx.operatingTakeoverCommandReceipt.findMany({ where: { manifestVersionId: manifest.id, action: { in: ["manifest.create", "manifest.inactive_applied"] } } });
      for (const preparer of preparers) assertClearingActorsDisjoint(jsonActorIds(preparer.actorSetSnapshot), identity.actorIds);
      const assignedWageAuthorities = formalRows
        .map((row) => authorityFromMapping(row))
        .filter((authority) => authority.sourceDiscriminator === "construction_enterprise_assigned_wage" && authority.periodStart);
      if (assignedWageAuthorities.length) {
        await lockWageConflictBuckets(tx, assignedWageAuthorities.map((authority) => ({
          projectId: authority.projectId,
          wageMonth: authority.periodStart!
        })));
        for (const authority of assignedWageAuthorities) await this.assertNoWageConflict(tx, authority);
      }
      const lines: StoredMapping[] = [];
      const results: Array<Record<string, unknown>> = [];
      const targetRefs = new Map<string, { targetKind: string; targetRef: string; decision: string }>();
      for (const row of [...manifest.rows].sort((left, right) => left.rowNo - right.rowNo)) {
        const legacySource = row.sourceType === "project_upstream_fund_fact"
          ? await this.revalidateLegacySource(tx, row)
          : null;
        const authority = row.mappingDecision === "FORMAL" ? authorityFromMapping(row) : null;
        if (legacySource && authority && (
          legacySource.sourceSnapshot.affiliateAssignmentId !== authority.constructionEnterpriseAssignmentId ||
          legacySource.sourceSnapshot.deductionCategory !== (authority.category === "assigned_management_salary" ? "management_fee" : "deposit") ||
          legacySource.sourceSnapshot.effectDirection !== "increase"
        )) {
          throw new ConflictException("legacy 来源与服务端权威身份、类别或方向不一致，必须失败关闭");
        }
        const existing = await tx.operatingTakeoverLegacySourceBridge.findFirst({ where: { projectId: manifest.projectId, sourceType: row.sourceType, sourceBusinessId: row.sourceBusinessId, sourceVersion: row.sourceVersion } });
        if (existing && (
          existing.sourceFingerprint !== row.sourceFingerprint ||
          existing.targetFingerprint !== fingerprint({ targetKind: existing.targetKind, targetRef: existing.targetRef, sourceFingerprint: row.sourceFingerprint })
        )) throw new ConflictException("legacy source 或目标指纹变化，整批拒绝写入");
        if (existing) {
          lines.push(row);
          targetRefs.set(row.id, { targetKind: existing.targetKind, targetRef: existing.targetRef, decision: "LINK" });
          results.push({ rowNo: row.rowNo, decision: "LINK", targetRef: existing.targetRef });
          continue;
        }
        let targetKind = "gap_issue";
        let targetRef = row.id;
        let decision = row.mappingDecision;
        if (row.mappingDecision === "FORMAL") {
          if (!authority) throw new ConflictException("正式 mapping 缺少服务端权威快照");
          let existingOperatingFactId: string | undefined;
          if (legacySource) {
            let legacyFact = await tx.operatingFact.findUnique({
              where: { sourceType_sourceBusinessId: { sourceType: row.sourceType, sourceBusinessId: row.sourceBusinessId } },
              include: { clearingImpactLinks: true }
            });
            if (!legacyFact && this.operatingSources) {
              await this.operatingSources.appendConfirmedSourceIfEnabledInTransaction(
                tx,
                { projectId: manifest.projectId, sourceType: row.sourceType, sourceBusinessId: row.sourceBusinessId },
                identity.actualUserId
              );
              legacyFact = await tx.operatingFact.findUnique({
                where: { sourceType_sourceBusinessId: { sourceType: row.sourceType, sourceBusinessId: row.sourceBusinessId } },
                include: { clearingImpactLinks: true }
              });
            }
            if (!legacyFact) throw new ConflictException("已确认 legacy 来源尚未形成正式经营事实，必须失败关闭");
            if (
              legacyFact.projectId !== manifest.projectId ||
              legacyFact.sourceType !== legacySource.sourceType ||
              legacyFact.sourceBusinessId !== legacySource.sourceBusinessId ||
              legacyFact.sourceVersion !== legacySource.sourceVersion ||
              legacyFact.factKind !== "construction_enterprise_deduction" ||
              legacyFact.entryKind !== "original" ||
              legacyFact.status !== "confirmed" ||
              legacyFact.amountCents !== row.amountCents ||
              legacyFact.affiliateAssignmentId !== authority.constructionEnterpriseAssignmentId ||
              legacyFact.affiliateBusinessPartyVersionId !== legacySource.sourceSnapshot.affiliateBusinessPartyVersionId
            ) {
              throw new ConflictException("既有 legacy 经营事实与权威清算来源不一致，必须失败关闭");
            }
            if (legacyFact.clearingImpactLinks.length) {
              const linkedEventVersionIds = new Set(legacyFact.clearingImpactLinks.map((link) => link.eventVersionId));
              if (linkedEventVersionIds.size !== 1) throw new ConflictException("legacy 来源已有多条清分影响链，必须失败关闭");
              const legacyLink = await tx.clearingImpactLink.findUnique({
                where: { id: legacyFact.clearingImpactLinks[0]!.id },
                include: { eventVersion: { include: { clearingEvent: true, confirmation: true } }, operatingImpact: true }
              });
              const expectedEventKinds = authority.category === "deposit"
                ? ["withheld"]
                : ["final_confirmed", "supplemental"];
              if (
                !legacyLink ||
                legacyLink.eventVersion.clearingEvent.clearingCaseId !== legacyLink.eventVersion.clearingCaseId ||
                !legacyLink.eventVersion.confirmation ||
                legacyLink.eventVersion.workflowStatus !== "confirmed" ||
                !expectedEventKinds.includes(legacyLink.eventVersion.clearingEvent.kind) ||
                legacyLink.eventVersion.amountCents !== legacyFact.amountCents ||
                legacyLink.operatingImpact.amountCents !== legacyLink.amountCents
              ) {
                throw new ConflictException("legacy 来源已有不完整或不一致的正式清分影响链，必须失败关闭");
              }
              const linkedCase = await tx.clearingCase.findUnique({ where: { id: legacyLink.eventVersion.clearingCaseId } });
              if (
                !linkedCase ||
                linkedCase.projectId !== authority.projectId ||
                linkedCase.constructionEnterpriseAssignmentId !== authority.constructionEnterpriseAssignmentId ||
                linkedCase.category !== authority.category ||
                linkedCase.governedSubjectKey !== authority.governedSubjectKey ||
                linkedCase.authorityVersionId !== authority.authorityVersionId ||
                linkedCase.authoritySnapshotRef !== authority.authoritySnapshotRef
              ) {
                throw new ConflictException("legacy 来源已关联其他清分权威事项，必须失败关闭");
              }
              targetKind = "clearing_event_version";
              targetRef = legacyLink.eventVersionId;
              decision = "LINK";
            } else {
              existingOperatingFactId = legacyFact.id;
            }
          }
          if (decision === "LINK") {
            lines.push(row);
            targetRefs.set(row.id, { targetKind, targetRef, decision });
            results.push({ rowNo: row.rowNo, decision, targetRef });
            continue;
          }
          const result = await this.clearing.planHistoricalImport(tx, {
            manifestId: manifest.id,
            mappingId: row.id,
            actorUserId: identity.actualUserId,
            delegatorUserId: identity.delegatorUserId,
            actorIds: identity.actorIds,
            attesterActorIds: attest ? jsonActorIds(attest.actorSetSnapshot) : undefined,
            category: authority.category,
            authority,
            amountCents: row.amountCents,
            evidenceLevel: row.evidenceLevel as "A" | "B",
            sourceType: row.sourceType,
            sourceBusinessId: row.sourceBusinessId,
            sourceVersion: row.sourceVersion,
            sourceFingerprint: row.sourceFingerprint,
            sourceSnapshot: jsonInput({
              ...(legacySource?.sourceSnapshot ?? {}),
              businessReason: stringSnapshot(row.legacySourceSnapshot, "businessReason"),
              evidenceRef: stringSnapshotNullable(row.legacySourceSnapshot, "evidenceRef")
            }),
            businessReason: stringSnapshot(row.legacySourceSnapshot, "businessReason"),
            entryKind: "original",
            existingOperatingFactId
          });
          targetKind = "clearing_event_version";
          targetRef = result.versionId;
          decision = "FORMAL";
        }
        try {
          await tx.operatingTakeoverLegacySourceBridge.create({ data: { id: cryptoRandomId(), projectId: manifest.projectId, rowMappingId: row.id, sourceType: row.sourceType, sourceBusinessId: row.sourceBusinessId, sourceVersion: row.sourceVersion, sourceFingerprint: row.sourceFingerprint, targetKind, targetRef, targetFingerprint: fingerprint({ targetKind, targetRef, sourceFingerprint: row.sourceFingerprint }), mappingDecision: decision, createdByUserId: identity.actualUserId } });
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            throw new ConflictException("legacy 来源或正式目标已被其他接管事务占用，必须失败关闭");
          }
          throw error;
        }
        lines.push(row);
        targetRefs.set(row.id, { targetKind, targetRef, decision });
        results.push({ rowNo: row.rowNo, decision, targetRef });
      }
      const result = { manifestId: manifest.id, status: "activated", formalCount: results.filter((item) => item.decision === "FORMAL").length, gapCount: results.filter((item) => item.decision === "GAP").length, lines: results };
      const receipt = await this.writeReceipt(tx, manifest.projectId, manifest.id, input.idempotencyKey, "manifest.activate", "clearing.confirm", input.expectedRevision, identity, fp, "activated", result, lines, attest?.id ?? undefined, targetRefs);
      return { ...result, activationReceiptId: receipt.id };
    });
  }

  async compensateActivation(projectId: string, manifestId: string, actorUserId: string, input: CompensateConstructionEnterpriseTakeoverDto) {
    const identity = await this.resolveIdentity(actorUserId, input.delegatorUserId, "clearing.confirm", manifestId);
    return this.serializable(async (tx) => {
      const manifest = await this.loadAndRevalidate(tx, projectId, manifestId, identity, "clearing.confirm");
      const activation = await tx.operatingTakeoverCommandReceipt.findUnique({ where: { id: input.activationReceiptId }, include: { lines: true } });
      if (!activation || activation.manifestVersionId !== manifest.id || activation.action !== "manifest.activate" || activation.status !== "activated") throw new ConflictException("激活回执不存在或不属于当前 manifest");
      const fp = fingerprint({ action: "manifest.compensate", manifestId, activationReceiptId: activation.id, expectedRevision: input.expectedRevision, actorIds: identity.actorIds });
      const replay = await this.replay(tx, input.idempotencyKey, fp);
      if (replay) return replay;
      const rowsById = new Map(manifest.rows.map((row) => [row.id, row]));
      const compensationResults: Array<Record<string, unknown>> = [];
      const receiptLines: StoredMapping[] = [];
      const reversesLineIds = new Map<string, string>();
      for (const line of [...activation.lines].sort((left, right) => right.causalOrdinal - left.causalOrdinal)) {
        if (line.decision !== "FORMAL" || !line.targetRef) continue;
        const row = rowsById.get(line.rowMappingId);
        if (!row) throw new ConflictException("激活回执缺少映射行，补偿必须失败关闭");
        const authority = authorityFromMapping(row);
        const result = await this.clearing.planHistoricalImport(tx, {
          manifestId: manifest.id,
          mappingId: row.id,
          actorUserId: identity.actualUserId,
          delegatorUserId: identity.delegatorUserId,
          actorIds: identity.actorIds,
          category: authority.category,
          authority,
          amountCents: line.amountCents,
          evidenceLevel: row.evidenceLevel as "A" | "B",
          sourceType: row.sourceType,
          sourceBusinessId: `${row.sourceBusinessId}:compensation:${input.idempotencyKey}`,
          sourceVersion: row.sourceVersion,
          sourceFingerprint: row.sourceFingerprint,
          sourceSnapshot: row.legacySourceSnapshot as Prisma.InputJsonObject,
          businessReason: "激活后按原激活回执逆因果补偿",
          entryKind: "reversal",
          adjustsEventVersionId: line.targetRef
        });
        receiptLines.push(row);
        reversesLineIds.set(row.id, line.id);
        compensationResults.push({ rowNo: row.rowNo, decision: "COMPENSATION", targetRef: result.versionId, reverses: line.targetRef });
      }
      const result = { manifestId: manifest.id, status: "compensated", compensationCount: compensationResults.length, lines: compensationResults };
      const receipt = await this.writeReceipt(tx, manifest.projectId, manifest.id, input.idempotencyKey, "manifest.compensate", "clearing.confirm", input.expectedRevision, identity, fp, "compensated", result, receiptLines, activation.id, undefined, reversesLineIds);
      return { ...result, compensationReceiptId: receipt.id };
    });
  }

  private async inactiveCommand(projectId: string, manifestId: string, actorUserId: string, input: ConstructionEnterpriseTakeoverCommandDto, status: "inactive_applied" | "abandoned") {
    const identity = await this.resolveIdentity(actorUserId, input.delegatorUserId, "clearing.prepare", manifestId);
    return this.serializable(async (tx) => {
      const manifest = await this.loadAndRevalidate(tx, projectId, manifestId, identity, "clearing.prepare");
      const fp = fingerprint({ action: `manifest.${status}`, manifestId, expectedRevision: input.expectedRevision, actorIds: identity.actorIds });
      const replay = await this.replay(tx, input.idempotencyKey, fp);
      if (replay) return replay;
      const activated = await tx.operatingTakeoverCommandReceipt.findFirst({ where: { manifestVersionId: manifest.id, action: "manifest.activate", status: "activated" } });
      if (activated) throw new ConflictException("manifest 已激活，不能执行激活前 abandoned");
      const result = { manifestId: manifest.id, status, formalFactCount: 0, ledgerMutation: false };
      await this.writeReceipt(tx, manifest.projectId, manifest.id, input.idempotencyKey, `manifest.${status}`, "clearing.prepare", input.expectedRevision, identity, fp, status, result, manifest.rows);
      return result;
    });
  }

  private async resolveMappings(tx: Tx, projectId: string, identity: TakeoverIdentity, rows: readonly CreateConstructionEnterpriseTakeoverRowDto[]) {
    const mappings = [];
    const wageGroups = new Set<string>();
    for (const [index, row] of rows.entries()) {
      const category = row.kind === "assigned_wage" ? "assigned_management_salary" as const : "deposit" as const;
      const resolved = await this.authorities.resolveCaseSelection(identity.actualUserId, {
        idempotencyKey: cryptoRandomId(),
        expectedRevision: 0,
        selectionRef: row.selectionRef,
        delegatorUserId: identity.delegatorUserId ?? undefined,
        ...(row.kind === "guarantee" && row.amountCents !== undefined ? { guaranteeTrancheAmountCents: row.amountCents } : {})
      }, category, tx);
      const authority = await this.authorities.revalidateResolvedAuthority(tx, resolved);
      if (row.period && authority.periodStart?.toISOString().slice(0, 7) !== row.period) throw new ConflictException("工资月份必须与服务端权威月份一致");
      await this.assertNoWageConflict(tx, authority);
      const amountCents = row.kind === "assigned_wage" ? authority.authoritativeGrossCapCents : authority.requestedTrancheAmountCents ?? authority.authoritativeGrossCapCents;
      const legacySource = authority.legacySource;
      const serverSource = {
        projectId,
        kind: row.kind,
        amountCents,
        evidenceLevel: authority.coverageKind === "ROLE_SUMMARY" ? "B" as const : "A" as const,
        periodStart: authority.periodStart,
        sourceType: legacySource?.sourceType ?? "construction_enterprise_takeover_selection",
        sourceBusinessId: legacySource?.sourceBusinessId ?? `${authority.authoritySnapshotRef}:${authority.coverageKey}:${index + 1}`,
        sourceVersion: legacySource?.sourceVersion ?? 1,
        sourceFingerprint: legacySource?.sourceFingerprint ?? fingerprint({ authorityFingerprint: authority.authorityFingerprint, sourceIndex: index + 1 }),
        sourceCoordinate: legacySource?.sourceCoordinate ?? `authority:${authority.authoritySnapshotRef}/${authority.coverageKey}/${index + 1}`,
        normalizedRowHash: legacySource?.normalizedRowHash ?? fingerprint({ kind: row.kind, amountCents: amountCents.toString(), period: authority.periodStart?.toISOString().slice(0, 10) ?? null, businessReason: row.businessReason, evidenceRef: row.evidenceRef ?? null })
      } satisfies ConstructionEnterpriseHistoricalRow;
      const mapped = this.adapter.map({ ...serverSource, authority: authority as unknown as ResolvedClearingAuthorityForTakeover });
      if (row.kind === "assigned_wage" && wageGroups.has(mapped.conflictGroupKey)) throw new ConflictException("同一人员或岗位同月工资在 manifest 内重复，必须整组阻断");
      if (row.kind === "assigned_wage") wageGroups.add(mapped.conflictGroupKey);
      mappings.push({
        ...mapped,
        authority,
        legacySourceSnapshot: {
          ...(legacySource?.sourceSnapshot ?? {}),
          businessReason: row.businessReason,
          evidenceRef: row.evidenceRef ?? null,
          selectionResolvedAt: new Date().toISOString()
        }
      });
    }
    return mappings;
  }

  private async assertNoWageConflict(tx: Tx, authority: ResolvedAffiliateClearingAuthority) {
    if (authority.sourceDiscriminator !== "construction_enterprise_assigned_wage" || !authority.periodStart) return;
    const month = authority.periodStart.toISOString().slice(0, 7);
    const personKey = authority.personAuthorityKey;
    if (personKey) {
      const existing = await tx.wagePersonLine.findFirst({ where: { employeeId: personKey, projectAllocations: { some: { projectId: authority.projectId } }, statementVersion: { sourceVersion: { wageMonth: month } } }, select: { id: true } });
      if (existing) throw new ConflictException("同人同月跨 #104/#105 工资来源冲突，必须整组阻断");
      return;
    }
    const existing = await tx.wagePersonLine.findFirst({ where: { projectAllocations: { some: { projectId: authority.projectId } }, statementVersion: { sourceVersion: { wageMonth: month } } }, select: { id: true } });
    if (existing) throw new ConflictException("B级岗位汇总与同项目同月 #105 工资来源重叠，必须整组阻断");
  }

  private async revalidateLegacySource(tx: Tx, row: StoredMapping) {
    const source = await tx.projectUpstreamFundFact.findUnique({
      where: { id: row.sourceBusinessId }
    });
    if (
      !source ||
      source.projectId !== row.projectId ||
      source.factType !== "affiliate_deduction" ||
      source.entryKind !== "original" ||
      source.status !== "confirmed" ||
      !source.confirmedByUserId ||
      !source.confirmedAt ||
      source.documentVersion !== row.sourceVersion ||
      source.amountCents !== row.amountCents
    ) {
      throw new ConflictException("legacy affiliate_deduction 来源已变化、未确认或金额不一致，必须失败关闭");
    }
    const resolved = resolveAffiliateDeductionSource(source);
    if (resolved.sourceFingerprint !== row.sourceFingerprint || resolved.normalizedRowHash !== row.normalizedRowHash) {
      throw new ConflictException("legacy affiliate_deduction 来源指纹漂移，必须失败关闭");
    }
    return resolved;
  }

  private async loadAndRevalidate(tx: Tx, projectId: string, manifestId: string, identity: TakeoverIdentity, action: BusinessAction) {
    const manifest = await tx.operatingTakeoverManifestVersion.findUnique({ where: { id: manifestId }, include: { rows: { orderBy: { rowNo: "asc" } } } });
    if (!manifest) throw new NotFoundException("接管 manifest 不存在");
    if (manifest.projectId !== projectId) throw new NotFoundException("接管 manifest 不属于当前项目");
    const refreshed = await this.resolveIdentity(identity.actualUserId, identity.delegatorUserId ?? undefined, action, manifestId, manifest.projectId);
    if (refreshed.actorIds.join("|") !== identity.actorIds.join("|") || refreshed.roles.join("|") !== identity.roles.join("|")) {
      throw new ConflictException("权限或委托在接管事务内发生变化，必须失败关闭");
    }
    if (!/^[0-9a-f]{64}$/i.test(manifest.permissionSnapshotFingerprint)) throw new ConflictException("manifest 权限快照损坏，必须失败关闭");
    for (const row of manifest.rows) {
      if (row.mappingDecision !== "FORMAL") continue;
      const authority = authorityFromMapping(row);
      const current = await this.authorities.revalidateResolvedAuthority(tx, authority);
      if (current.authorityFingerprint !== row.authorityFingerprint || current.governedSubjectKey !== row.governedSubjectKey || current.authoritativeGrossCapCents !== row.authoritativeGrossCapCents) throw new ConflictException("manifest authority read-set 已变化，必须失败关闭");
    }
    const readSet = fingerprint(manifest.rows.map((row) => ({ mappingFingerprint: row.mappingFingerprint, authorityFingerprint: row.authorityFingerprint, sourceFingerprint: row.sourceFingerprint })));
    if (readSet !== manifest.readSetFingerprint) throw new ConflictException("manifest read-set 指纹已变化，必须失败关闭");
    return manifest;
  }

  private async writeReceipt(tx: Tx, projectId: string, manifestId: string, idempotencyKey: string, action: string, permissionAction: BusinessAction, expectedRevision: number, identity: TakeoverIdentity, fp: string, status: string, result: unknown, rows: readonly StoredMapping[], causesReceiptId?: string, targetRefs?: ReadonlyMap<string, { targetKind: string; targetRef: string; decision: string }>, reversesLineIds?: ReadonlyMap<string, string>) {
    const receipt = await tx.operatingTakeoverCommandReceipt.create({ data: { id: cryptoRandomId(), manifestVersionId: manifestId, idempotencyKey, action, expectedRevision, actorUserId: identity.actualUserId, delegatorUserId: identity.delegatorUserId, actorSetSnapshot: identity.actorIds, permissionSnapshotFingerprint: permissionFingerprint(projectId, identity.roles, permissionAction), fingerprint: fp, status, resultSnapshot: jsonInput(result), causalityFingerprint: fingerprint(rows.map((row, index) => ({ row: row.id, ordinal: index + 1, target: targetRefs?.get(row.id)?.targetRef ?? row.governedSubjectKey }))), causesReceiptId } });
    for (const [index, row] of rows.entries()) {
      const target = targetRefs?.get(row.id);
      await tx.operatingTakeoverCommandReceiptLine.create({ data: { id: cryptoRandomId(), receiptId: receipt.id, rowMappingId: row.id, lineNo: index + 1, decision: target?.decision ?? row.mappingDecision, entryKind: row.entryKind, amountCents: row.amountCents, targetKind: target?.targetKind ?? (row.mappingDecision === "FORMAL" ? "clearing_event_version" : "gap_issue"), targetRef: target?.targetRef ?? null, causalOrdinal: index + 1, reversesLineId: reversesLineIds?.get(row.id) ?? null, causalityFingerprint: fingerprint({ receiptId: receipt.id, rowId: row.id, ordinal: index + 1, target: target?.targetRef ?? null, reversesLineId: reversesLineIds?.get(row.id) ?? null }), lineSnapshot: jsonInput({ mappingFingerprint: row.mappingFingerprint, authorityFingerprint: row.authorityFingerprint, sourceFingerprint: row.sourceFingerprint }) } });
    }
    return receipt;
  }

  private async replay(tx: Tx, idempotencyKey: string, fp: string) {
    const receipt = await tx.operatingTakeoverCommandReceipt.findUnique({ where: { idempotencyKey } });
    if (!receipt) return null;
    if (receipt.fingerprint !== fp) throw new ConflictException("同一幂等键不能用于不同接管请求");
    return receipt.resultSnapshot;
  }

  private async resolveIdentity(actorUserId: string, delegatorUserId: string | undefined, action: BusinessAction, resourceId: string, projectId?: string): Promise<TakeoverIdentity> {
    const roles = await this.roles.resolveActiveRoleScopes(actorUserId, projectId);
    const delegator = delegatorUserId?.trim() || null;
    if (!delegator) {
      if (!canPerform(action, roles)) throw new ForbiddenException("当前公司岗位无权执行历史接管动作");
      return { actualUserId: actorUserId, delegatorUserId: null, actorIds: [actorUserId], roles };
    }
    const active = await activeScopedApprovalDelegatorIds(this.prisma, actorUserId, { actionKey: action, resourceType: "operating_takeover_manifest", resourceId });
    if (!active.includes(delegator)) throw new ForbiddenException("指定委托不存在、已过期或超过一跳");
    const delegatedRoles = await this.roles.resolveActiveRoleScopes(delegator, projectId);
    if (!canPerform(action, delegatedRoles)) throw new ForbiddenException("委托人的公司岗位无权执行历史接管动作");
    return { actualUserId: actorUserId, delegatorUserId: delegator, actorIds: [actorUserId, delegator], roles: [...new Set([...roles, ...delegatedRoles])].sort() };
  }

  private serializable<T>(work: (tx: Tx) => Promise<T>) {
    return this.prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}

function authorityFromMapping(row: StoredMapping): ResolvedAffiliateClearingAuthority {
  if (!row.authorityCategory || !row.authoritySnapshotRef || !row.authorityFingerprint || !row.authorityVersionId || !row.sourceDiscriminator || !row.governedSubjectKey || !row.coverageKind || !row.coverageKey || row.authoritativeGrossCapCents === null || !row.currencyCode) throw new ConflictException("manifest 缺少完整服务端权威快照");
  if (
    (row.authorityCategory === "assigned_management_salary" && row.sourceDiscriminator !== "construction_enterprise_assigned_wage") ||
    (row.authorityCategory === "deposit" && row.sourceDiscriminator !== "construction_enterprise_guarantee") ||
    !["assigned_management_salary", "deposit"].includes(row.authorityCategory)
  ) {
    throw new ConflictException("manifest 权威类别与来源判别器不一致");
  }
  if (row.authorityCategory === "assigned_management_salary" && (!row.authorityLineId || !row.authorityLineFingerprint)) {
    throw new ConflictException("manifest 工资权威缺少不可变行坐标或指纹");
  }
  if (row.authorityCategory === "deposit" && !row.obligationId) {
    throw new ConflictException("manifest 保证金权威缺少 obligation 坐标");
  }
  return {
    projectId: row.projectId,
    constructionEnterpriseAssignmentId: stringSnapshot(row.authoritySnapshot, "constructionEnterpriseAssignmentId"),
    category: row.authorityCategory as "assigned_management_salary" | "deposit",
    governedSubjectKey: row.governedSubjectKey,
    authoritativeGrossCapCents: row.authoritativeGrossCapCents,
    currencyCode: row.currencyCode,
    authorityVersionId: row.authorityVersionId,
    authoritySnapshotRef: row.authoritySnapshotRef,
    sourceDiscriminator: row.sourceDiscriminator as ResolvedAffiliateClearingAuthority["sourceDiscriminator"],
    coverageKind: row.coverageKind as "PERSON" | "ROLE_SUMMARY",
    coverageKey: row.coverageKey,
    periodStart: row.periodStart,
    authorityFingerprint: row.authorityFingerprint,
    authorityLineId: row.authorityLineId ?? undefined,
    authorityLineFingerprint: row.authorityLineFingerprint ?? undefined,
    authorityLineEvidenceSha256: stringSnapshotNullable(row.authoritySnapshot, "authorityLineEvidenceSha256") ?? undefined,
    obligationId: row.obligationId ?? undefined,
    obligationFingerprint: stringSnapshotNullable(row.authoritySnapshot, "obligationFingerprint") ?? undefined,
    authorityEvidenceSha256: stringSnapshotNullable(row.authoritySnapshot, "authorityEvidenceSha256") ?? undefined,
    authorityEvidenceManifestSha256: stringSnapshotNullable(row.authoritySnapshot, "authorityEvidenceManifestSha256") ?? undefined,
    personAuthorityKey: stringSnapshotNullable(row.authoritySnapshot, "personAuthorityKey")
  };
}

function permissionFingerprint(projectId: string, roles: readonly string[], action: BusinessAction = "clearing.prepare") {
  return fingerprint({ projectId, action, roles: [...roles].sort() });
}

function fingerprint(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value: unknown): string {
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  return JSON.stringify(value);
}

function jsonInput(value: unknown): Prisma.InputJsonObject {
  return JSON.parse(stableJson(value ?? null)) as Prisma.InputJsonObject;
}

function jsonActorIds(value: Prisma.JsonValue): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function stringSnapshot(value: Prisma.JsonValue, key: string): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ConflictException("服务端冻结来源快照格式错误");
  const text = (value as Record<string, unknown>)[key];
  if (typeof text !== "string" || !text.trim()) throw new ConflictException("服务端冻结来源缺少业务原因");
  return text;
}

function stringSnapshotNullable(value: Prisma.JsonValue, key: string): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const text = (value as Record<string, unknown>)[key];
  return typeof text === "string" && text.trim() ? text : null;
}

function cryptoRandomId() {
  return randomUUID();
}
